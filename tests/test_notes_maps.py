"""A map in a note (`engine/notes_maps.py`): the `::: map` block, what it shows of the
case's layers, plates and proofs, how the HTML report, the PDF and the check read it,
the put that files its ground, and what it leans on for a delete."""

from __future__ import annotations

import base64
import io
import json
import os
import re
from html.parser import HTMLParser
from pathlib import Path

import pytest
from PIL import Image

from azimut import layout
from azimut.engine import layerediting, notes_html, notes_maps, notes_pdf, notes_web, tiles
from azimut.engine import uses as uses_engine
from azimut.workspace import Case

from mapfixture import LINE_DAYS
from mapfixture import fixture_map as _fixture_map


def _png(size=(64, 48), colour=(200, 30, 30)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture()
def tiles_here(monkeypatch):
    """Every tile a flat green square, fetched from nowhere; the URLs asked for, kept."""
    asked: list[str] = []

    def tile(_client, url):
        asked.append(url)
        return Image.new("RGB", (256, 256), (70, 96, 64))

    monkeypatch.setattr(tiles, "_default_fetch", tile)
    return asked


def _case(client, name="Front") -> tuple[str, Case]:
    cid = client.post("/api/cases", json={"name": name}).json()["id"]
    return cid, Case.open(cid)


def _tracked_line(case: Case, title="Line") -> str:
    """A personal layer followed over time: one line that moves on 14 October and goes on 15 November."""
    name = layerediting.create(case, title)["name"]
    with case.lock:
        spec = layerediting._spec(case, name)
        layerediting.set_track(spec, {"on": True})
        layerediting._save(case, name, spec)
    made = layerediting.add_shape(case, name, geometry={"type": "LineString", "coordinates": LINE_DAYS["2026-10-06"]},
                                  name="Forward line", colour="#1e88e5", description="Where it stood.", group=None,
                                  at="2026-10-06")
    with case.lock:
        spec = layerediting._spec(case, name)
        feature = next(one for one in spec["document"]["features"] if one["properties"]["key"] == made["key"])
        layerediting.write_state(feature, "2026-10-14", geometry={"type": "LineString",
                                                                  "coordinates": LINE_DAYS["2026-10-14"]})
        layerediting.write_state(feature, "2026-11-15", gone=True)
        layerediting._save(case, name, spec)
    return name


def _markers(client, cid, title="Vehicles") -> str:
    name = client.post(f"/api/cases/{cid}/map-layers/editable", json={"title": title}).json()["name"]
    for number, (lat, lon, day) in enumerate([(12.745, 43.495, "2026-11-15"), (12.7451, 43.4951, "2026-11-16"),
                                             (12.70, 43.53, "2026-11-16")]):
        made = client.post(f"/api/cases/{cid}/map-layers/{name}/markers",
                           json={"lat": lat, "lon": lon, "name": f"#{number + 1}", "colour": "#e53935",
                                 "symbol": "badge-tank"})
        assert made.status_code == 200, made.text
        key = made.json()["marker"]["properties"]["key"]
        dated = client.patch(f"/api/cases/{cid}/map-layers/{name}/markers/{key}",
                             json={"date": day, "status": "destroyed", "links": [f"https://x.com/desk/status/{number}"]})
        assert dated.status_code == 200, dated.text
    return name


def _proof(client, cid, title, when, points, description="Seen on the heights.") -> dict:
    res = client.post(f"/api/cases/{cid}/proofs", json={
        "title": title,
        "spec": {"when": when, "points": [{"coords": coords, "label": label, **({"pov": True} if pov else {})}
                                          for coords, label, pov in points],
                 "coordsText": points[0][0], "description": description, "panels": []},
        "png_base64": base64.b64encode(_png()).decode(),
    })
    assert res.status_code == 200, res.text
    return res.json()


def _ground(client, cid, lat=12.76, lon=43.50, zoom=12) -> str:
    res = client.post(f"/api/cases/{cid}/satellite/capture", json={
        "lat": lat, "lon": lon, "zoom": zoom, "width": 800, "height": 500, "marker_style": "none"})
    assert res.status_code == 200, res.text
    return res.json()["entity"]["id"]


class _Tags(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str]]] = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, {key: value or "" for key, value in attrs}))


def _tags(document: bytes) -> list[tuple[str, dict[str, str]]]:
    parser = _Tags()
    parser.feed(document.decode("utf-8"))
    return parser.tags


def _map_data(document: bytes, number: int = 0) -> dict:
    found = re.findall(r'<script type="application/json" class="az-map-data">(.*?)</script>', document.decode("utf-8"),
                       re.S)
    return json.loads(found[number])


# -- the block -----------------------------------------------------------------------------


def test_a_block_reads_its_lines_each_layer_on_its_own_even_with_a_comma():
    block = notes_maps.parse_block(
        "title: Front line, 1 Sep to 15 Nov\nlayer: Vehicles, by kind\nlayers: Line\nlayer: Line\n"
        "proofs: 2026-09-01..2026-11-15\nground: e_abc123\ndetail: e_def456\nview: 12.82, 43.478, 10.65, 15\n"
        "colour: red\n")
    assert block.title == "Front line, 1 Sep to 15 Nov"
    assert block.layers == ["Vehicles, by kind", "Line"]
    assert block.period() == ("2026-09-01", "2026-11-15")
    assert block.ground == "e_abc123" and block.details == ["e_def456"]
    assert block.view == (12.82, 43.478, 10.65, 15.0)
    assert block.unread == ["colour: red"]
    written = notes_maps.block_text(block)
    again = notes_maps.parse_block(written.split("\n", 1)[1].rsplit("\n", 1)[0])
    assert (again.title, again.layers, again.proofs, again.ground, again.details) == \
        (block.title, block.layers, block.proofs, block.ground, block.details)


@pytest.mark.parametrize("written, period", [
    ("all", ("", "")), ("2026-10-01", ("2026-10-01", "2026-10-01")), ("..2026-10-01", ("", "2026-10-01")),
    ("2026-10-01..", ("2026-10-01", "")), ("2026-11-01..2026-10-01", ("2026-10-01", "2026-11-01")),
    ("last week", None), ("", None),
])
def test_a_period_of_proofs_reads_open_ends_one_day_and_all(written, period):
    assert notes_maps.proof_period(written) == period


def test_a_view_that_is_no_place_is_unread_and_a_fenced_block_is_no_map():
    assert notes_maps.parse_block("view: 95, 10, 4").view is None
    text = "```\n::: map\nlayer: A\n:::\n```\n\n::: map\nlayer: B\n:::\n"
    assert [block.layers for block in notes_maps.blocks_in(text)] == [["B"]]


# -- what it shows ---------------------------------------------------------------------------


def test_a_layer_followed_over_time_is_one_feature_a_state_each_with_its_days(client):
    cid, case = _case(client)
    name = _tracked_line(case)
    derived = notes_maps.derive(case, notes_maps.MapBlock(layers=[name]))
    shown = [(one["from"], one["until"], one["coords"][0][0]) for one in derived.data["features"]]
    assert shown == [("2026-10-06", "2026-10-13", LINE_DAYS["2026-10-06"][0]),
                     ("2026-10-14", "2026-11-14", LINE_DAYS["2026-10-14"][0])]
    # both states are one feature over time, which the slider shows moving
    assert len({one["of"] for one in derived.data["features"]}) == 1
    assert derived.data["days"] == ["2026-10-06", "2026-10-14", "2026-11-15"]
    assert derived.data["day"] == "2026-11-15"
    assert [notes_maps.shows_on(one, "2026-10-20") for one in derived.data["features"]] == [False, True]
    style = derived.data["features"][0]["style"]
    assert style["color"] == "#1e88e5" and style["width"] > 0
    assert derived.legend[0]["label"] == "Forward line"


def test_markers_keep_their_symbol_status_day_and_source_in_their_card(client):
    cid, case = _case(client)
    name = _markers(client, cid)
    derived = notes_maps.derive(case, notes_maps.MapBlock(layers=[name]))
    first = derived.data["features"][0]
    assert first["kind"] == "point" and first["from"] == "2026-11-15" and first["until"] is None
    assert first["style"]["status"] == "destroyed" and first["style"]["icon"] in derived.icons
    assert derived.icons[first["style"]["icon"]] == {"symbol": "badge-tank", "colour": "#e53935", "status": "destroyed"}
    assert first["card"]["source"] == {"label": "x.com", "url": "https://x.com/desk/status/0"}
    assert first["card"]["day"] == "15 November 2026"


def test_a_plate_brings_its_layers_as_it_draws_them_its_steps_and_their_framing(client):
    cid, case = _case(client)
    line = _tracked_line(case)
    vehicles = _markers(client, cid)
    plate = client.post(f"/api/cases/{cid}/map-plates", json={"title": "Losses", "spec": {
        "time": {"at": "2026-11-16"},
        "steps": {"2026-11-16": [{"id": "s0", "name": "Every vehicle"}, {"id": "s1", "name": "Main road"}]},
        "framing": {"s1": {"map": {"lat": 12.745, "lon": 43.495, "zoom": 15.4}}},
        "elements": [{"id": "map", "kind": "map", "box": [10, 20, 200, 150],
                      "view": {"lat": 12.76, "lon": 43.5, "zoom": 11},
                      "layers": [{"name": vehicles}, {"name": line, "hidden": ["Features"]}]}],
    }})
    assert plate.status_code == 200, plate.text
    derived = notes_maps.derive(case, notes_maps.MapBlock(plate=plate.json()["name"]))
    data = derived.data
    assert {one["layer"] for one in data["features"]} == {"Vehicles"}, "a group the plate hides stays out"
    assert [(step["label"], step["day"]) for step in data["steps"]] == [("Every vehicle", "2026-11-16"),
                                                                         ("Main road", "2026-11-16")]
    assert data["steps"][0]["view"]["zoom"] == 11, "a step with no framing of its own keeps the map's"
    assert data["steps"][1]["view"] == {"center": [43.495, 12.745], "zoom": 15.4, "bearing": 0, "pitch": 0}
    assert data["view"]["zoom"] == 11 and data["day"] == "2026-11-16"


def test_a_period_of_proofs_is_a_point_a_proof_point_and_a_step_a_proof_in_date_order(client):
    cid, case = _case(client)
    late = _proof(client, cid, "Heights", "2026-10-20~", [("12.7295, 43.5002", "POV", True)])
    _proof(client, cid, "Airport", "2026-10-09", [("12.8636, 43.5205", "Gate", False), ("12.8700, 43.5300", "Tower", False)])
    _proof(client, cid, "Elsewhere", "2026-12-01", [("13.0, 44.0", "", False)])
    derived = notes_maps.derive(case, notes_maps.MapBlock(proofs="2026-10-01..2026-11-15"),
                                anchors={late["id"]: "fig-1"}, round_pov=True)
    data = derived.data
    assert [one["label"] for one in data["features"]] == ["Airport, Gate", "Airport, Tower", "Heights, POV"]
    assert [step["day"] for step in data["steps"]] == ["2026-10-09", "2026-10-20"]
    assert data["steps"][0]["focus"] == ["p0", "p0q1"] and data["steps"][0]["label"] == ""
    heights = data["features"][2]
    assert heights["style"]["pov"] and heights["card"]["proof"] == {"name": "Heights", "figure": "#fig-1"}
    assert heights["card"]["day"] == "about 20 October 2026"
    # a point of view rounded on demand, said by the check
    assert heights["coords"] != [43.5002, 12.7295] and derived.pov and derived.pov[0].startswith("Heights: ")


def test_a_stale_name_is_said_and_never_breaks_the_page(client):
    cid, case = _case(client)
    text = "# Map\n\n::: map\ntitle: Gone\nlayer: Nothing here\nplate: No plate\nground: e_missing1\n:::\n"
    rendered = notes_html.render(case, title="Map", text=text)
    kinds = dict(zip(rendered.warnings, rendered.warning_kinds))
    assert kinds['The map "Gone" names a layer no longer in the case: "Nothing here".'] == "missing"
    assert kinds['The map "Gone" names a plate no longer in the case: "No plate".'] == "missing"
    assert kinds['The map "Gone": its ground picture is no longer in the case.'] == "missing"
    # each said at the line that names it
    lines = dict(zip(rendered.warnings, rendered.warning_lines))
    assert lines['The map "Gone" names a layer no longer in the case: "Nothing here".'] == 4
    assert lines['The map "Gone": its ground picture is no longer in the case.'] == 6
    assert b'data-kind="map"' in rendered.html


# -- the page --------------------------------------------------------------------------------


def test_a_map_in_a_web_folder_keeps_every_picture_as_a_file_its_policy_lets_in(client, tiles_here):
    cid, case = _case(client)
    name = _tracked_line(case)
    vehicles = _markers(client, cid)
    ground = _ground(client, cid)
    _proof(client, cid, "Heights", "2026-10-20", [("12.7500, 43.5000", "Heights", False)])
    text = (f"# Map\n\n::: map\ntitle: The line\nlayer: {name}\nlayer: {vehicles}\nproofs: all\n"
            f"ground: {ground}\n:::\n")
    folder = notes_html.Folder(csp=notes_web.folder_csp())
    rendered = notes_html.render(case, title="Map", text=text, public=True, folder=folder)
    page = rendered.html.decode("utf-8")
    # the ground, the cards' pictures and the marks' pictograms are files, never data: addresses
    assert not re.search(r"data:(image|video|audio|font)/", page)
    for path, data in folder.files.items():
        if path.endswith((".css", ".js")):
            assert not re.search(r"data:(image|video|audio|font)/", data.decode("utf-8")), path
    named = set(re.findall(r'(?:src|href)="(assets/[^"]+)"', page))
    assert named and named <= set(folder.files)
    ground_tag = next(attrs for tag, attrs in _tags(rendered.html) if tag == "img" and attrs.get("id") == "map-1-ground")
    assert ground_tag["src"] in folder.files
    # the map's own reader travels in the folder's script, which the policy lets in from the folder
    script = next(data.decode("utf-8") for path, data in folder.files.items() if path.endswith(".js"))
    assert "az-map" in script
    assert "script-src 'self'" in notes_web.folder_csp()


def test_a_mark_drawn_with_a_layers_own_picture_is_a_file_in_a_web_folder(client, tiles_here, monkeypatch):
    # a layer imported with its own icons draws its marks with them, as pictures
    real = notes_maps.symbol_svg
    monkeypatch.setattr(notes_maps, "symbol_svg",
                        lambda key, icon, prefix="az-map": real(key, {"png": _png((16, 16))}, prefix))
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    ground = _ground(client, cid)
    text = f"# Map\n\n::: map\ntitle: Vehicles\nlayer: {vehicles}\nground: {ground}\n:::\n"
    single = notes_html.render(case, title="Map", text=text, public=True).html.decode("utf-8")
    assert '<image href="data:image/png;base64,' in single
    folder = notes_html.Folder(csp=notes_web.folder_csp())
    page = notes_html.render(case, title="Map", text=text, public=True, folder=folder).html.decode("utf-8")
    assert "data:image/" not in page
    lifted = re.findall(r'<image href="(assets/[^"]+\.png)"', page)
    assert lifted and set(lifted) <= set(folder.files)


def test_the_html_map_is_a_figure_of_the_ground_and_its_drawing_with_its_data_beside(client, tiles_here):
    cid, case = _case(client)
    name = _tracked_line(case)
    ground = _ground(client, cid)
    text = f"# Map\n\n::: map\ntitle: The line\nlayer: {name}\nground: {ground}\n:::\n\nAfter it.\n"
    rendered = notes_html.render(case, title="Map", text=text, public=True)
    tags = _tags(rendered.html)
    figure = next(attrs for tag, attrs in tags if tag == "figure" and attrs.get("data-kind") == "map")
    assert figure["id"] == "map-1" and figure["data-days"] == "3"
    ground_img = next(attrs for tag, attrs in tags if tag == "img" and "az-map-ground" in attrs.get("class", ""))
    assert ground_img["id"] == "map-1-ground" and ground_img["src"].startswith("data:image/")
    shapes = [attrs for tag, attrs in tags if tag == "g" and "az-f" in attrs.get("class", "").split()]
    # the line as on its last day is gone, its earlier states drawn and marked off
    assert len(shapes) == 2 and all("az-off" in shape["class"] for shape in shapes)
    assert {shape["data-from"] for shape in shapes} == {"2026-10-06", "2026-10-14"}
    data = _map_data(rendered.html)
    assert data["version"] == 1 and data["ground"]["src"] == "#map-1-ground", "the picture is held once, in the img"
    assert data["ground"]["credit"].startswith("Imagery: ")
    assert len(data["features"]) == 2 and data["features"][0]["coords"] == [LINE_DAYS["2026-10-06"]]
    # the data runs nothing and reaches nothing
    assert "</" not in re.search(r'class="az-map-data">(.*?)</script>', rendered.html.decode(), re.S).group(1)
    assert b"As on <time datetime=\"2026-11-15\">" in rendered.html
    assert not any("ground picture" in warning for warning in rendered.warnings)


def test_overlapping_marks_are_spread_round_their_place_their_data_never_moved(client):
    cid, case = _case(client)
    name = _markers(client, cid)
    derived = notes_maps.derive(case, notes_maps.MapBlock(layers=[name]))
    drawing = notes_maps.svg(derived)
    assert drawing.count('class="az-leader"') == 2, "the two marks a metre apart each get a leader to their spot"
    marks = re.findall(r'data-x="([\d.]+)" data-y="([\d.]+)"[^>]*transform="translate\(([\d.]+) ([\d.]+)\)', drawing)
    moved = [mark for mark in marks if (mark[0], mark[1]) != (mark[2], mark[3])]
    assert len(moved) == 2
    spread = notes_maps.arrange([("a", 0, 0), ("b", 1, 1), ("c", 200, 200)])
    assert set(spread) == {"a", "b"} and abs(spread["a"][0] - spread["b"][0]) >= notes_maps.SPREAD_PX * 0.9
    assert [one["coords"] for one in derived.data["features"][:2]] == [[43.495, 12.745], [43.4951, 12.7451]]


def test_proofs_shown_in_the_page_are_figures_a_map_card_links_to(client):
    cid, case = _case(client)
    proof = _proof(client, cid, "Heights", "2026-10-20", [("12.7295, 43.5002", "Crest", False)])
    text = (f"# Map\n\n::: map\nproofs: all\n:::\n\n![Heights](azimut://media/{proof['id']})\n")
    rendered = notes_html.render(case, title="Map", text=text)
    data = _map_data(rendered.html)
    assert data["features"][0]["card"]["proof"]["figure"] == "#fig-1"
    assert data["features"][0]["card"]["media"]["src"].startswith("data:image/")
    assert any(tag == "figure" and attrs.get("id") == "fig-1" and attrs.get("data-kind") == "proof"
               for tag, attrs in _tags(rendered.html))


def test_the_story_layout_gives_a_map_a_stage_and_a_card_to_each_of_its_steps(client):
    from azimut.engine.notelook import NoteLook

    cid, case = _case(client)
    _proof(client, cid, "Heights", "2026-10-20", [("12.7295, 43.5002", "Crest", False)])
    _proof(client, cid, "Airport", "2026-10-09", [("12.8636, 43.5205", "Gate", False)])
    text = "# Map\n\n::: map\ntitle: Proofs\nproofs: all\n:::\n\nWhat the proofs show.\n"
    rendered = notes_html.render(case, title="Map", text=text, look=NoteLook(web="story"))
    page = rendered.html.decode()
    scene = page[page.index('<section class="az-story az-scenes"'):]
    assert '<figure class="az-figure az-map" data-kind="map" id="map-1"' in scene
    cards = re.findall(r'<div class="az-story-step[^"]*" data-step="1"(?: data-map-step="(\d)")?', scene)
    assert cards == ["", "0", "1"], "the words after the map, then a card a step"
    assert "Seen on the heights." in scene


def test_a_story_card_of_a_map_step_says_its_words_under_its_name(client, monkeypatch):
    """A step with a name and words (`step: day | name | … | words`) shows both on its card,
    not only its name."""
    from azimut.engine.notelook import NoteLook

    cid, case = _case(client)
    derived = _fixture_map()
    derived.data["steps"][1]["text"] = "A government camera films the convoy at the foot of the hills."
    monkeypatch.setattr(notes_maps, "derive", lambda *args, **kwargs: derived)
    text = "::: map\ntitle: The line\n:::\n\nWhat the line shows.\n"
    rendered = notes_html.render(case, title="Map", text=text, look=NoteLook(web="story"))
    page = rendered.html.decode()
    card = re.search(r'<div class="az-story-step az-map-card-step"[^>]*data-map-step="1"[^>]*>(.*?)</div>', page, re.S).group(1)
    assert '<p class="az-map-step-label" dir="auto">The road</p>' in card
    assert '<p class="az-map-step-words" dir="auto">A government camera films the convoy at the foot of the hills.</p>' in card
    # a step with words and no name says its words once, as its name
    first = re.search(r'<div class="az-story-step az-map-card-step"[^>]*data-map-step="0"[^>]*>(.*?)</div>', page, re.S).group(1)
    assert "az-map-step-words" not in first and "Seen on the heights." in first


# -- the check ---------------------------------------------------------------------------------


def test_the_check_says_a_map_with_no_ground_and_one_too_heavy(client, monkeypatch):
    cid, case = _case(client)
    name = _tracked_line(case)
    monkeypatch.setattr(notes_maps, "MAP_BYTES", 500)
    rendered = notes_html.render(case, title="Map", text=f"::: map\ntitle: Line\nlayer: {name}\n:::\n", check=True)
    said = " ".join(rendered.warnings)
    assert 'The map "Line" has no ground picture' in said
    assert re.search(r'The map "Line" weighs [\d.]+ MB, past the 0 MB a map aims for\.', said)


# -- the picture, for a PDF ---------------------------------------------------------------------


def test_render_png_draws_the_ground_and_the_features_as_on_the_maps_day():
    data = {
        "bounds": [43.0, 12.0, 44.0, 13.0],
        "ground": None,
        "day": "2026-10-20",
        "features": [
            {"id": "a", "kind": "area", "coords": [[[[43.2, 12.2], [43.8, 12.2], [43.8, 12.8], [43.2, 12.8], [43.2, 12.2]]]],
             "from": None, "until": None, "style": {"color": "#00ff00", "opacity": 1.0, "width": 2}},
            {"id": "gone", "kind": "point", "coords": [43.5, 12.5], "from": None, "until": "2026-10-01",
             "style": {"color": "#ff0000", "icon": "s-badge-tank-ff0000"}},
        ],
    }
    picture = Image.open(io.BytesIO(notes_maps.render_png(data, 400)))
    assert picture.format == "PNG" and picture.width == 400
    middle = picture.getpixel((200, picture.height // 2))
    assert middle[1] > 200 and middle[0] < 60, "the area is there, the marker gone by the map's day is not"
    shown = Image.open(io.BytesIO(notes_maps.render_png(data, 400, day="2026-09-01")))
    assert shown.getpixel((200, shown.height // 2))[0] > 150, "on an earlier day the marker stands over the area"


def test_svg_paths_with_arcs_and_curves_are_read_for_pillow():
    rings = notes_maps.path_points("M12 5.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6Z")
    points, closed = rings[0]
    assert closed and all(abs(((x - 12) ** 2 + (y - 12) ** 2) ** 0.5 - 6.8) < 0.05 for x, y in points)
    assert notes_maps.path_points("M0 0h4v4H0Z")[0][0] == [(0, 0), (4, 0), (4, 4), (0, 4)]


def test_every_marker_of_the_map_draws_into_a_picture():
    for symbol in [*notes_maps.drawings()["badges"], "pin", "star", "circle", "flag"]:
        image = notes_maps._marker_image({"symbol": symbol, "colour": "#e53935", "status": "destroyed"}, 32)
        assert image.getbbox() is not None, symbol


def test_the_pdf_prints_a_map_as_its_picture_with_its_credit(client, tiles_here):
    cid, case = _case(client)
    name = _tracked_line(case)
    ground = _ground(client, cid)
    text = f"# Map\n\n::: map\ntitle: The line\nlayer: {name}\nground: {ground}\n:::\n"
    rendered = notes_pdf.render(case, title="Map", text=text)
    assert rendered.pdf.startswith(b"%PDF") and b"/Subtype /Image" in rendered.pdf
    assert not [warning for warning in rendered.warnings if "map" in warning.lower()]
    plain = notes_pdf.render(case, title="Map", text="# Map\n\nNo map here.\n")
    assert b"/Subtype /Image" not in plain.pdf


# -- the put --------------------------------------------------------------------------------------


def test_a_put_files_the_ground_once_and_answers_the_block(client, tiles_here):
    cid, case = _case(client)
    name = _markers(client, cid)
    sources = client.get(f"/api/cases/{cid}/notes/maps/sources").json()
    assert [row["name"] for row in sources["layers"]] == [name] and sources["provider"] == "s2cloudless~2025"
    first = client.post(f"/api/cases/{cid}/notes/maps", json={"title": "Losses", "layers": [name]}).json()
    block = notes_maps.parse_block(first["text"].split("\n", 1)[1].rsplit("\n", 1)[0])
    assert block.layers == [name] and block.ground == first["ground"]["id"] and block.view is not None
    assert first["fresh"] is True and first["filed"] == [block.ground] and tiles_here
    again = client.post(f"/api/cases/{cid}/notes/maps", json={"title": "Losses", "layers": [name]}).json()
    assert again["ground"]["id"] == block.ground and again["fresh"] is False and again["filed"] == []
    derived = notes_maps.derive(case, block)
    west, south, east, north = derived.data["bounds"]
    assert all(west < lon < east and south < lat < north for lon, lat in (one["coords"] for one in derived.data["features"]))


def test_a_put_offline_writes_the_block_with_no_ground_and_says_so(client, monkeypatch):
    cid, _ = _case(client)
    name = _markers(client, cid)

    def offline(_client, _url):
        raise OSError("no network")

    monkeypatch.setattr(tiles, "_default_fetch", offline)
    answer = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [name]})
    assert answer.status_code == 200, answer.text
    assert "ground:" not in answer.json()["text"] and answer.json()["warnings"]


def test_a_put_refuses_what_the_case_does_not_hold(client):
    cid, _ = _case(client)
    gone = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": ["Nothing"]})
    assert gone.status_code == 422 and "no longer in the case" in gone.json()["detail"]
    nothing = client.post(f"/api/cases/{cid}/notes/maps", json={})
    assert nothing.status_code == 422
    period = client.post(f"/api/cases/{cid}/notes/maps", json={"proofs": "last week"})
    assert period.status_code == 422


def test_opening_a_note_with_a_map_fetches_nothing(client, monkeypatch):
    cid, case = _case(client)
    name = _tracked_line(case)

    def never(*_args, **_kwargs):
        raise AssertionError("a map in a note never fetches a tile")

    monkeypatch.setattr(tiles, "_default_fetch", never)
    rendered = notes_html.render(case, title="Map", text=f"::: map\nlayer: {name}\n:::\n")
    assert b"az-map-data" in rendered.html


# -- what it leans on ---------------------------------------------------------------------------------


def test_a_map_in_a_note_uses_its_layer_its_plate_and_its_ground(client, tiles_here):
    cid, case = _case(client)
    name = _tracked_line(case)
    ground = _ground(client, cid)
    note = client.post(f"/api/cases/{cid}/notes", json={
        "title": "Front map", "content": f"::: map\nlayer: {name}\nground: {ground}\nproofs: all\n:::\n"})
    assert note.status_code == 200, note.text
    used = uses_engine.used_refs(case)
    assert layout.layer_spec_rel(name) in used and ground in used
    layer_id = client.get(f"/api/cases/{cid}/entities/lookup",
                          params={"attr": "spec", "value": layout.layer_spec_rel(name)}).json()["entity"]["id"]
    impact = client.post(f"/api/cases/{cid}/delete-impact", json={"ids": [layer_id]}).json()
    assert {row["label"]: row["how"] for row in impact["touched"]} == {"Front map": ["maps it"]}
    ground_impact = client.post(f"/api/cases/{cid}/delete-impact", json={"ids": [ground]}).json()
    assert [row["how"] for row in ground_impact["touched"]] == [["is the ground of a map in it"]]
    # the note's own text is what it leans with: taken out, nothing is used any more
    client.put(f"/api/cases/{cid}/notes/{note.json()['id']}", json={"text": "No map.\n"})
    assert ground not in uses_engine.used_refs(case)


# -- the figure the reader's script and its tests read ---------------------------------------------

#: The markup of one map, as the engine writes it, which the reader's tests and the browser
#: tests open (`frontend/src/lib/notes/mapFigure.fixture.html`). It is the figure a live map
#: will mount in later, so its shape is held here: a change to it is a change to this file,
#: written again with `UPDATE_MAP_FIXTURE=1`.
FIXTURE = Path(__file__).resolve().parents[1] / "frontend/src/lib/notes/mapFigure.fixture.html"


def test_the_map_figure_fixture_is_what_the_engine_writes():
    caption = '<span class="az-caption" dir="auto">The line</span>\n'
    written = notes_html._map_figure(_fixture_map(), "map-1", caption)
    if os.environ.get("UPDATE_MAP_FIXTURE"):
        FIXTURE.write_text(written, encoding="utf-8")
    assert FIXTURE.read_text(encoding="utf-8") == written


def test_a_line_gone_by_the_maps_day_leaves_its_last_place_faint():
    features = _fixture_map().data["features"]
    assert notes_maps.traces(features, "2026-11-16") == {"l0f0s1"}, "gone from the map: its last place"
    assert notes_maps.traces(features, "2026-10-20") == {"l0f0"}, "moved on: where it stood before"
    assert notes_maps.traces(features, "2026-10-06") == set()
    drawing = notes_maps.svg(_fixture_map())
    assert re.search(r'class="az-f az-line az-off az-past" data-id="l0f0s1"', drawing)
    assert re.search(r'class="az-f az-line az-off" data-id="l0f0"', drawing)


# -- how it is shown: the settings card's lines --------------------------------------------------

#: An old block, as a put wrote it before the settings card: it must read, write and draw as it did.
OLD_BLOCK = ("title: The front\nlayer: Front line\nproofs: 2026-10-19..2026-11-02\nground: e_c76d8fac71\n"
             "detail: e_893ad279dc\nview: 12.73976, 43.51350, 12.05")


@pytest.mark.parametrize("line, field, value", [
    ("base: dark", "base", "dark"),
    ("base: Topographic", "base", "topographic"),
    ("hide: Vehicles, by kind", "hidden", ["Vehicles, by kind"]),
    ("colour: Front = line = #D55E00", "colours", {"Front = line": "#d55e00"}),
    ("proof points: filmed", "proof_points", "filmed"),
    ("labels: off", "labels", "off"),
    ("crowds: off", "crowds", "off"),
    ("crowds: 20", "crowds", "20"),
    ("north: on", "north", "on"),
    ("scale: off", "scale", "off"),
    ("frame: 43.4, 12.6, 43.6, 12.8", "frame", (43.4, 12.6, 43.6, 12.8)),
    ("timeline: off", "timeline", "off"),
    ("opens on: 2026-10-21", "opens_on", "2026-10-21"),
    ("speed: slow", "speed", "slow"),
    ("card: source, picture", "card", ["picture", "source"]),
    ("card: none", "card", []),
    ("size: full", "size", "full"),
    ("legend: folded", "legend", "folded"),
    ("Proof  Points : every", "proof_points", "every"),
])
def test_each_setting_reads_its_one_line(line, field, value):
    block = notes_maps.parse_block(f"layer: Front\n{line}")
    assert getattr(block, field) == value and block.unread == []


@pytest.mark.parametrize("line", [
    "base: night", "hide: a/b", "colour: Front = red", "colour: #d55e00", "proof points: some", "labels: maybe",
    "crowds: 1", "crowds: many", "north: up", "frame: 43.6, 12.6, 43.4, 12.8", "frame: 1, 2, 3",
    "timeline: yes", "opens on: 21 October", "speed: quick", "card: picture, map", "size: tiny", "legend: open",
    "step: 21-10-2026 | x", "step: | | 95, 10, 4", "step: | | | not an id! |", "step: |  |  |  | ",
])
def test_a_setting_it_cannot_read_is_kept_to_be_said(line):
    block = notes_maps.parse_block(f"layer: Front\n{line}")
    assert block.unread == [line.strip()]
    derived = notes_maps.derive(None, block)
    assert any("reads no line" in message for message, _, _ in derived.warnings)


def test_a_step_reads_its_parts_any_of_them_empty_and_writes_them_back():
    block = notes_maps.parse_block("layer: A\nstep: 2026-10-21 | The quay | 12.7, 43.5, 13 | e_abc | Words | with a bar\n"
                                   "step: | Only a name\nstep: 2026-10-22")
    assert block.steps == [
        notes_maps.Step(day="2026-10-21", label="The quay", view=(12.7, 43.5, 13.0), proof="e_abc", words="Words | with a bar"),
        notes_maps.Step(label="Only a name"), notes_maps.Step(day="2026-10-22")]
    assert [notes_maps.step_line(step) for step in block.steps] == [
        "step: 2026-10-21 | The quay | 12.70000, 43.50000, 13 | e_abc | Words | with a bar",
        "step: | Only a name", "step: 2026-10-22"]


def test_the_settings_are_written_after_the_view_in_the_cards_order_and_read_back_the_same():
    written = ("layer: Front\nstep: 2026-10-21 | Quay\nlegend: hidden\nsize: half\ncard: picture\nspeed: fast\n"
               "opens on: 2026-10-21\ntimeline: off\nframe: 43.4, 12.6, 43.6, 12.8\nscale: on\nnorth: on\ncrowds: 8\n"
               "labels: on\nproof points: filmed\ncolour: Front = #d55e00\nhide: Vehicles\nbase: map\nview: 12.7, 43.5, 12")
    block = notes_maps.parse_block(written)
    text = notes_maps.block_text(block)
    assert text.split("\n") == [
        "::: map", "layer: Front", "view: 12.70000, 43.50000, 12", "base: map", "hide: Vehicles",
        "colour: Front = #d55e00", "proof points: filmed", "labels: on", "crowds: 8", "north: on", "scale: on",
        "frame: 43.40000, 12.60000, 43.60000, 12.80000", "timeline: off", "opens on: 2026-10-21", "speed: fast",
        "card: picture", "size: half", "legend: hidden", "step: 2026-10-21 | Quay", ":::"]
    again = notes_maps.parse_block(text.split("\n", 1)[1].rsplit("\n", 1)[0])
    assert {**again.__dict__, "where": {}} == {**block.__dict__, "where": {}}
    assert notes_maps.block_text(again) == text


def test_an_old_block_reads_writes_and_derives_as_it_did():
    block = notes_maps.parse_block(OLD_BLOCK)
    assert block.unread == [] and notes_maps.settings_lines(block) == []
    assert notes_maps.block_text(block) == f"::: map\n{OLD_BLOCK}\n:::"
    data = notes_maps.derive(None, block).data
    assert set(data) == {"version", "title", "view", "bounds", "ground", "details", "days", "day", "features", "steps",
                         "credits"}, "nothing new rides in an old map's data"


def test_hiding_colouring_and_naming_a_layer_shape_what_the_map_draws(client):
    cid, case = _case(client)
    line = _tracked_line(case)
    vehicles = _markers(client, cid)
    shown = notes_maps.derive(case, notes_maps.parse_block(
        f"layer: {line}\nlayer: {vehicles}\nhide: {line}\ncolour: {vehicles} = #009e73\nlabels: off")).data
    assert {one["layer"] for one in shown["features"]} == {"Vehicles"}
    assert {one["style"]["color"] for one in shown["features"]} == {"#009e73"}
    assert all(one["style"]["icon"].startswith("s-badge-tank-009e73") for one in shown["features"])
    assert not any(one["style"].get("label") for one in shown["features"])
    named = notes_maps.derive(case, notes_maps.parse_block(f"layer: {line}\nlabels: on")).data
    assert all(one["style"]["label"] and one["at"] for one in named["features"]), "a named line says its name on its middle"
    # its ids stay as they were: a hidden layer keeps its place in the count
    assert {one["id"][:2] for one in shown["features"]} == {"l1"}


def test_a_name_put_by_hand_is_written_there_once_and_never_rides_in_the_data(client):
    """Both parts of an area are one feature on a notes map, its name written once, where the analyst put it."""
    cid, case = _case(client)
    name = client.post(f"/api/cases/{cid}/map-layers/editable", json={"title": "Zones"}).json()["name"]
    url = f"/api/cases/{cid}/map-layers/{name}"
    parts = {"type": "MultiPolygon", "coordinates": [
        [[[43.40, 12.70], [43.45, 12.70], [43.45, 12.75], [43.40, 12.70]]],
        [[[43.50, 12.70], [43.55, 12.70], [43.55, 12.75], [43.50, 12.70]]]]}
    placed = client.post(f"{url}/shapes", json={"geometry": parts, "name": "Held ground", "label": "on"}).json()["key"]
    client.post(f"{url}/shapes", json={"geometry": {"type": "LineString", "coordinates": [[43.4, 12.6], [43.5, 12.6]]},
                                        "name": "Road", "label": "on"})
    assert client.patch(f"{url}/markers/{placed}", json={"label_at": [43.47, 12.78]}).status_code == 200
    data = notes_maps.derive(case, notes_maps.parse_block(f"layer: {name}")).data
    shown = [(one["label"], one.get("at"), bool(one["style"].get("label"))) for one in data["features"]]
    assert shown == [("Held ground", [43.47, 12.78], True),
                     ("Road", [43.45, pytest.approx(12.6, abs=1e-4)], True)], "where it was put; a name nobody moved on its middle"
    assert not any("label_at" in one for one in data["features"])
    # the page with no script and the print write it there too
    derived = notes_maps.derive(case, notes_maps.parse_block(f"layer: {name}"))
    assert notes_maps.svg(derived).count(">Held ground</text>") == 1


def test_proofs_only_where_they_were_filmed(client):
    cid, case = _case(client)
    _proof(client, cid, "Heights", "2026-10-20", [("12.7295, 43.5002", "POV", True), ("12.7400, 43.5100", "Crest", False)])
    _proof(client, cid, "Airport", "2026-10-09", [("12.8636, 43.5205", "Gate", False)])
    every = notes_maps.derive(case, notes_maps.parse_block("proofs: all")).data
    filmed = notes_maps.derive(case, notes_maps.parse_block("proofs: all\nproof points: filmed")).data
    assert [one["label"] for one in every["features"]] == ["Airport, Gate", "Heights, POV", "Heights, Crest"]
    assert [one["label"] for one in filmed["features"]] == ["Heights, POV"]
    assert [step["day"] for step in filmed["steps"]] == ["2026-10-20"]


def test_the_day_it_opens_on_the_timeline_play_crowds_north_and_scale_ride_in_its_data(client):
    cid, case = _case(client)
    line = _tracked_line(case)
    data = notes_maps.derive(case, notes_maps.parse_block(
        f"layer: {line}\nopens on: 2026-10-21\ntimeline: off\nspeed: slow\ncrowds: off\nnorth: on\nscale: off")).data
    assert "2026-10-21" in data["days"] and data["day"] == "2026-10-21", "a day of its own becomes a stop"
    assert (data["timeline"], data["speed"], data["crowds"], data["north"], data["scale"]) == (False, 2200, 0, True, "off")
    plain = notes_maps.derive(case, notes_maps.parse_block(f"layer: {line}\nspeed: normal\ncrowds: 12")).data
    assert "speed" not in plain and plain["crowds"] == 12


def test_a_frame_is_what_the_map_shows_its_ground_laid_where_it_stands(client, tiles_here):
    cid, case = _case(client)
    line = _tracked_line(case)
    ground = _ground(client, cid)
    whole = notes_maps.derive(case, notes_maps.parse_block(f"layer: {line}\nground: {ground}"))
    west, south, east, north = whole.data["bounds"]
    part = [west + (east - west) * 0.25, south + (north - south) * 0.25, east - (east - west) * 0.25, north - (north - south) * 0.25]
    framed = notes_maps.derive(case, notes_maps.parse_block(f"layer: {line}\nground: {ground}\nframe: {', '.join(map(str, part))}"))
    assert framed.data["bounds"] == [round(value, 6) for value in part]
    assert framed.data["ground"]["bounds"] == whole.data["bounds"]
    framed.data["ground"]["src"] = "data:image/png;base64,AAAA"
    figure = notes_html._map_figure(framed, "map-1", "")
    place = re.search(r'class="az-map-ground"[^>]* style="left:(-?[\d.]+)%;top:(-?[\d.]+)%;width:([\d.]+)%;height:([\d.]+)%"',
                      figure)
    assert place and [round(float(value)) for value in place.groups()] == [-50, -50, 200, 200]
    # the picture for the PDF lays the ground the same way: its middle, magnified
    picture = Image.open(io.BytesIO(notes_maps.render_png(framed.data, 400, ground=framed.ground)))
    assert picture.size[0] == 400


def test_a_card_says_only_what_the_block_asks(client):
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    _proof(client, cid, "Heights", "2026-10-20", [("12.7295, 43.5002", "POV", True)])
    data = notes_maps.derive(case, notes_maps.parse_block(f"layer: {vehicles}\nproofs: all\ncard: sentence")).data
    for feature in data["features"]:
        assert not {"media", "source", "links", "verify"} & set(feature["card"]), feature["card"]
        assert feature["card"]["title"]
    assert any(feature["card"].get("text") for feature in data["features"])


def test_its_own_steps_are_played_in_their_order_a_proofs_step_opening_its_card(client):
    cid, case = _case(client)
    early = _proof(client, cid, "Airport", "2026-10-09", [("12.8636, 43.5205", "Gate", False)])
    late = _proof(client, cid, "Heights", "2026-10-20", [("12.7295, 43.5002", "POV", True)])
    derived = notes_maps.derive(case, notes_maps.parse_block("proofs: all"))
    assert derived.step_proofs == {"p0": early["id"], "p1": late["id"]}
    own = notes_maps.derive(case, notes_maps.parse_block(
        f"proofs: all\nstep: 2026-10-20 | | | {late['id']} | The heights first\nstep: | The airport | 12.86, 43.52, 14 | "
        f"{early['id']}\nstep: | Whole map"))
    steps = own.data["steps"]
    assert [step["label"] for step in steps] == ["", "The airport", "Whole map"]
    assert steps[0]["focus"] == ["p1"] and steps[0]["text"] == "The heights first" and steps[0]["name"] == "Heights"
    assert steps[0]["view"]["center"] == [43.5002, 12.7295] and steps[0]["view"]["zoom"] is not None
    assert steps[1]["view"] == {"center": [43.52, 12.86], "zoom": 14, "bearing": 0, "pitch": 0}
    assert steps[2]["view"]["zoom"] == own.data["view"]["zoom"], "a step that frames nothing keeps the map's view"
    assert own.step_proofs == {"s0": late["id"], "s1": early["id"]}


def test_a_map_shown_otherwise_carries_its_sheet_its_size_legend_north_and_base(client):
    cid, case = _case(client)
    line = _tracked_line(case)
    plain = notes_html.render(case, title="Map", text=f"::: map\nlayer: {line}\n:::\n").html.decode()
    # the settings' own sheet (`reader.mapset.css`) comes only with a map that sets something;
    # the map's own sheet names the north arrow too, for its place in full screen
    assert ".az-map-north svg" not in plain and "az-size-" not in plain and "data-base" not in plain
    shown = notes_html.render(case, title="Map", text=f"::: map\nlayer: {line}\nsize: half\nlegend: folded\nnorth: on\n"
                                                      "base: dark\nscale: off\n:::\n").html.decode()
    assert 'class="az-figure az-map az-size-half"' in shown
    assert '<details class="az-map-key"><summary>Legend</summary>' in shown
    assert 'class="az-map-north" role="img" aria-label="North is up"' in shown and 'data-base="dark"' in shown
    assert ".az-map-north svg" in shown and '"scale":"off"' in shown and '"base":"dark"' in shown
    hidden = notes_html.render(case, title="Map", text=f"::: map\nlayer: {line}\nlegend: hidden\n:::\n").html.decode()
    assert 'class="az-map-legend"' not in hidden


def test_a_dark_map_goes_live_in_the_dark_style_of_the_same_host(client, monkeypatch):
    cid, case = _case(client)
    line = _tracked_line(case)
    live = notes_html.LiveMaps(csp=notes_web.folder_csp(notes_web.LIVE_SOURCES), style=notes_web.LIVE_STYLE,
                               dark=notes_web.LIVE_DARK, version="5.0.0", files={"maplibre-gl.js": b"x"})
    for text, dark in ((f"::: map\nlayer: {line}\n:::\n", False), (f"::: map\nlayer: {line}\nbase: dark\n:::\n", True)):
        folder = notes_html.Folder(csp=notes_web.folder_csp(), live=live)
        page = notes_html.render(case, title="Map", text=text, folder=folder).html.decode()
        said = json.loads(re.search(r'<script type="application/json" id="az-gl">(.*?)</script>', page).group(1))
        assert ("dark" in said) is dark
        assert notes_web.LIVE_DARK.startswith(notes_web.LIVE_HOST)


def test_the_pdf_picture_draws_a_north_arrow_a_scale_a_dark_base_and_an_area_named_on_its_middle():
    base = notes_maps.derive(None, notes_maps.parse_block("layer: A")).data
    ground = Image.new("RGB", (400, 250), (230, 230, 225))
    data = {**base, "bounds": [43.4, 12.6, 43.6, 12.8], "ground": {"src": "", "bounds": [43.4, 12.6, 43.6, 12.8]},
            "features": [{"id": "a", "kind": "area", "coords": [[[[43.45, 12.65], [43.55, 12.65], [43.55, 12.75],
                                                                   [43.45, 12.75], [43.45, 12.65]]]],
                          "from": None, "until": None, "label": "about 15 km²", "style": {"color": "#d55e00", "label": True},
                          "card": {}, "of": "a", "layer": "Drawn", "group": ""}]}
    data["features"][0]["at"] = notes_maps.label_anchor(data["features"][0])
    assert data["features"][0]["at"] == [43.5, pytest.approx(12.700021, abs=1e-4)]

    def pixels(extra):
        return Image.open(io.BytesIO(notes_maps.render_png({**data, **extra}, 400, ground=ground))).convert("RGB")

    plain, marked = pixels({}), pixels({"north": True, "scale": "on"})
    width, height = plain.size
    corner = (width - 30, 0, width, 30)
    assert plain.crop(corner).tobytes() != marked.crop(corner).tobytes(), "the north arrow, top right"
    foot = (0, height - 14, 70, height)
    assert plain.crop(foot).tobytes() != marked.crop(foot).tobytes(), "the scale, bottom left"
    assert sum(pixels({"base": "dark"}).getpixel((5, 5))) < 200 < sum(plain.getpixel((5, 5))), "a dark base turns its street map dark"
    centre = plain.crop((width // 2 - 25, height // 2 - 8, width // 2 + 25, height // 2 + 8))
    assert max(sum(centre.getpixel((x, y))) for x in range(centre.width) for y in range(centre.height)) > 700, \
        "the area's name, white, on its middle"


# -- the settings card's calls ---------------------------------------------------------------------


def _note_with(client, cid, text, title="Front map") -> dict:
    made = client.post(f"/api/cases/{cid}/notes", json={"title": title, "content": text})
    assert made.status_code == 200, made.text
    return made.json()


def test_the_card_reads_what_the_map_shows_its_layers_steps_and_colours_fetching_nothing(client, monkeypatch):
    cid, case = _case(client)
    line = _tracked_line(case)
    vehicles = _markers(client, cid)
    proof = _proof(client, cid, "Heights", "2026-10-20", [("12.7295, 43.5002", "POV", True)])
    monkeypatch.setattr(tiles, "_default_fetch", lambda *_: (_ for _ in ()).throw(AssertionError("no tile")))
    answer = client.post(f"/api/cases/{cid}/notes/maps/describe",
                         json={"text": f"::: map\ntitle: Front\nlayer: {line}\nhide: {line}\nproofs: all\n:::"}).json()
    assert answer["base"] == "satellite" and answer["ground"] is None and answer["svg"].startswith("<svg")
    assert [(row["name"], row["on"], row["own"], row["from"]) for row in answer["layers"]] == [(line, False, False, "line")]
    assert [row["name"] for row in answer["others"]] == [vehicles]
    assert answer["steps"] == [{"label": "", "day": "2026-10-20", "text": "Seen on the heights.", "name": "Heights",
                                "proof": proof["id"], "view": [12.7295, 43.5002, answer["steps"][0]["view"][2]]}]
    assert answer["drawings"] == [], "a layer the analyst made elsewhere is never listed as drawn on the map"
    assert answer["extent"] and answer["proofs"]["count"] == 1


def test_a_base_files_its_own_ground_on_the_press_and_answers_its_lines(client, tiles_here):
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles]}).json()
    asked = len(tiles_here)
    street = client.post(f"/api/cases/{cid}/notes/maps/ground", json={"text": put["text"], "base": "map"}).json()
    assert street["base"] == "map" and street["ground"] != put["ground"]["id"] and street["filed"] == [street["ground"]]
    assert len(tiles_here) > asked and all("openstreetmap" in url for url in tiles_here[asked:])
    sidecar = case.media_items_by_paths([case.get_entity(street["ground"])["attrs"]["path"]])[0]["source"]
    assert sidecar["provider"] == "osm"
    # the same view again is cited, nothing fetched: a dark base is the street map drawn dark
    asked = len(tiles_here)
    dark = client.post(f"/api/cases/{cid}/notes/maps/ground", json={"text": put["text"], "base": "dark"}).json()
    assert dark["ground"] == street["ground"] and dark["filed"] == [] and len(tiles_here) == asked
    text = put["text"].replace("\n:::", "\nbase: map\n:::").replace(put["ground"]["id"], street["ground"])
    derived = notes_maps.derive(case, notes_maps.parse_block(text.split("\n", 1)[1].rsplit("\n", 1)[0]))
    assert derived.data["credits"][0].startswith("Map: ") and derived.data["base"] == "map"


def test_a_base_that_cannot_be_fetched_keeps_the_ground_and_says_so(client, tiles_here, monkeypatch):
    cid, _ = _case(client)
    vehicles = _markers(client, cid)
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles]}).json()

    def offline(_client, _url):
        raise OSError("no network")

    monkeypatch.setattr(tiles, "_default_fetch", offline)
    refused = client.post(f"/api/cases/{cid}/notes/maps/ground", json={"text": put["text"], "base": "topographic"})
    assert refused.status_code == 503
    assert refused.json()["detail"] == ("The topographic map could not be fetched, so the map keeps its ground. "
                                        "Try again once online.")


#: What a map's Draw tab shows once moved closer: a part of its ground, as the card sends it.
DRAW_VIEW = {"west": 43.490, "south": 12.740, "east": 43.502, "north": 12.748}


def test_the_draw_tabs_view_is_filed_as_a_close_up_its_ground_kept_and_cited_again(client, tiles_here):
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles], "provider": "esri-world-imagery"}).json()
    asked = len(tiles_here)
    filed = client.post(f"/api/cases/{cid}/notes/maps/detail", json={"text": put["text"], **DRAW_VIEW}).json()
    assert filed["detail"] != put["ground"]["id"]
    assert filed["details"] == [filed["detail"]] and filed["filed"] == [filed["detail"]]
    assert len(tiles_here) > asked and all("arcgisonline" in url for url in tiles_here[asked:])
    # the picture holds the whole view, sharper than the ground
    path = case.get_entity(filed["detail"])["attrs"]["path"]
    sidecar = case.media_items_by_paths([path])[0]["source"]
    west, south, east, north = notes_maps.ground_bounds(sidecar)
    assert west <= DRAW_VIEW["west"] and south <= DRAW_VIEW["south"]
    assert east >= DRAW_VIEW["east"] and north >= DRAW_VIEW["north"]
    assert sidecar["zoom"] > case.media_items_by_paths([put["ground"]["attrs"]["path"]])[0]["source"]["zoom"]
    # the same view again is cited, nothing fetched
    asked = len(tiles_here)
    again = client.post(f"/api/cases/{cid}/notes/maps/detail", json={"text": put["text"], **DRAW_VIEW}).json()
    assert again["detail"] == filed["detail"] and again["filed"] == [] and len(tiles_here) == asked
    # written as one more line, the card lays it where it stands, still fetching nothing
    text = put["text"].replace("\n:::", f"\ndetail: {filed['detail']}\n:::")
    already = client.post(f"/api/cases/{cid}/notes/maps/detail", json={"text": text, **DRAW_VIEW}).json()
    assert already["details"] == [filed["detail"]] and already["filed"] == []
    described = client.post(f"/api/cases/{cid}/notes/maps/describe", json={"text": text}).json()
    assert described["ground"]["id"] == put["ground"]["id"] and len(tiles_here) == asked
    assert described["details"] == [{"id": filed["detail"], "path": path, "bounds": [west, south, east, north]}]
    # a street map's view is a street map's close-up
    street = client.post(f"/api/cases/{cid}/notes/maps/detail",
                         json={"text": text, "base": "map", **DRAW_VIEW}).json()
    assert street["details"] == [filed["detail"], street["detail"]]
    street_path = case.get_entity(street["detail"])["attrs"]["path"]
    assert case.media_items_by_paths([street_path])[0]["source"]["provider"] == "osm"


def test_a_view_offline_or_one_close_up_too_many_keeps_the_map_and_says_so(client, tiles_here, monkeypatch):
    cid, _ = _case(client)
    vehicles = _markers(client, cid)
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles]}).json()
    asked = len(tiles_here)
    full = put["text"].replace("\n:::", "".join(f"\ndetail: e_{number:010d}" for number in range(8)) + "\n:::")
    refused = client.post(f"/api/cases/{cid}/notes/maps/detail", json={"text": full, **DRAW_VIEW})
    assert refused.status_code == 422
    assert refused.json()["detail"] == "This map keeps 8 close-ups at most. Take one out in its source first."
    nowhere = client.post(f"/api/cases/{cid}/notes/maps/detail",
                          json={"text": put["text"], **DRAW_VIEW, "east": DRAW_VIEW["west"]})
    assert nowhere.status_code == 422 and len(tiles_here) == asked

    def offline(_client, _url):
        raise OSError("no network")

    monkeypatch.setattr(tiles, "_default_fetch", offline)
    refused = client.post(f"/api/cases/{cid}/notes/maps/detail", json={"text": put["text"], **DRAW_VIEW})
    assert refused.status_code == 503
    assert refused.json()["detail"] == ("The imagery of this view could not be fetched, so the map keeps what it has. "
                                        "Try again once online.")


def test_an_empty_map_is_a_layer_of_its_own_and_a_ground_drawn_on_from_its_card(client, tiles_here):
    cid, case = _case(client)
    started = client.post(f"/api/cases/{cid}/notes/maps/scratch", json={
        "title": "The quay", "west": 43.30, "south": 12.60, "east": 43.40, "north": 12.66, "base": "topographic"}).json()
    block = notes_maps.parse_block(started["text"].split("\n", 1)[1].rsplit("\n", 1)[0])
    assert block.title == "The quay" and block.layers == [started["layer"]] and block.base == "topographic"
    assert block.ground == started["ground"]["id"] and block.view is not None
    layer = case.find_entity(attr="spec", value=layout.layer_spec_rel(started["layer"]))
    assert started["filed"] == [block.ground, layer["id"]], "Undo of the put sends both to the Trash"
    # three points and a line, each with its name, its day or days and its colour
    drawn = []
    for number, (lon, lat) in enumerate([(43.33, 12.62), (43.35, 12.63), (43.37, 12.64)]):
        answer = client.post(f"/api/cases/{cid}/notes/maps/features", json={
            "layer": started["layer"], "kind": "point", "coords": [lon, lat], "name": f"Post {number + 1}",
            "colour": "#D55E00", "start": "2026-10-0" + str(number + 1)})
        assert answer.status_code == 200, answer.text
        drawn.append(answer.json()["key"])
    road = client.post(f"/api/cases/{cid}/notes/maps/features", json={
        "layer": started["layer"], "kind": "line", "coords": [[43.32, 12.61], [43.36, 12.63], [43.38, 12.65]],
        "name": "Road", "colour": "#0072b2", "start": "2026-10-02", "end": "2026-10-10", "label": True}).json()
    area = client.post(f"/api/cases/{cid}/notes/maps/features", json={
        "layer": started["layer"], "kind": "area", "coords": [[43.31, 12.61], [43.34, 12.61], [43.34, 12.64]],
        "name": "about 15 km²", "colour": "#d55e00", "highlight": True}).json()
    described = client.post(f"/api/cases/{cid}/notes/maps/describe", json={"text": started["text"]}).json()
    rows = {row["name"]: row for row in described["drawings"]}
    assert set(rows) == {"Post 1", "Post 2", "Post 3", "Road", "about 15 km²"}
    assert rows["Road"]["from"] == "2026-10-02" and rows["Road"]["until"] == "2026-10-10" and rows["Road"]["label"]
    assert rows["about 15 km²"]["highlight"] and rows["about 15 km²"]["label"] and rows["Post 1"]["colour"] == "#d55e00"
    assert described["layers"][0]["own"]
    data = notes_maps.derive(case, block).data
    shown = {one["label"]: one for one in data["features"]}
    assert shown["Road"]["from"] == "2026-10-02" and shown["Road"]["until"] == "2026-10-10" and shown["Road"]["at"]
    assert shown["about 15 km²"]["style"]["dash"] == "dashed" and shown["about 15 km²"]["at"]
    # renamed, its days moved, taken out and put back
    edited = client.patch(f"/api/cases/{cid}/notes/maps/features/{road['key']}",
                          json={"layer": started["layer"], "name": "Coast road", "end": "", "label": False})
    assert edited.status_code == 200, edited.text
    gone = client.delete(f"/api/cases/{cid}/notes/maps/features/{area['key']}", params={"layer": started["layer"]})
    assert gone.status_code == 200
    back = client.post(f"/api/cases/{cid}/notes/maps/features/{area['key']}/restore", params={"layer": started["layer"]})
    assert back.status_code == 200
    rows = {row["name"]: row for row in client.post(f"/api/cases/{cid}/notes/maps/describe",
                                                    json={"text": started["text"]}).json()["drawings"]}
    assert rows["Coast road"]["until"] == "" and not rows["Coast road"]["label"] and "about 15 km²" in rows
    # what was drawn is case data: the note that maps it uses the layer, the step's proof too
    _note_with(client, cid, started["text"])
    assert layout.layer_spec_rel(started["layer"]) in uses_engine.used_refs(case)


def test_a_drawing_refuses_what_is_no_place_and_a_period_that_is_no_day(client):
    cid, case = _case(client)
    layer = client.post(f"/api/cases/{cid}/notes/maps/layer", json={"title": "Drawn"}).json()["name"]
    bad = client.post(f"/api/cases/{cid}/notes/maps/features", json={"layer": layer, "kind": "point", "coords": [400, 12]})
    assert bad.status_code == 422
    day = client.post(f"/api/cases/{cid}/notes/maps/features", json={"layer": layer, "kind": "point", "coords": [43, 12],
                                                                     "start": "21 October"})
    assert day.status_code == 422 and day.json()["detail"] == "Write a day as YYYY-MM-DD"
    two = client.post(f"/api/cases/{cid}/notes/maps/features", json={"layer": layer, "kind": "area",
                                                                     "coords": [[43, 12], [43.1, 12]]})
    assert two.status_code == 422
    frame = client.post(f"/api/cases/{cid}/notes/maps/scratch", json={"west": 43, "south": 12, "east": 42, "north": 13})
    assert frame.status_code == 422


def test_a_step_names_its_proof_a_use_the_delete_preview_says(client):
    cid, case = _case(client)
    proof = _proof(client, cid, "Heights", "2026-10-20", [("12.7295, 43.5002", "POV", True)])
    _note_with(client, cid, f"::: map\nproofs: all\nstep: 2026-10-20 | | | {proof['id']} | Heights first\n:::\n")
    assert proof["id"] in uses_engine.used_refs(case)
    impact = client.post(f"/api/cases/{cid}/delete-impact", json={"ids": [proof["id"]]}).json()
    assert ["is a step of a map in it"] in [row["how"] for row in impact["touched"]]


def test_an_infographics_map_panel_honours_the_maps_settings(client, monkeypatch):
    from azimut.engine import notes_infographic

    cid, case = _case(client)
    line = _tracked_line(case)
    vehicles = _markers(client, cid)
    drawn: list[dict] = []
    real = notes_maps.render_png

    def kept(data, *args, **kwargs):
        drawn.append(data)
        return real(data, *args, **kwargs)

    monkeypatch.setattr(notes_maps, "render_png", kept)
    body = (":::: infographic\ntitle: Losses\n\n::: map\ntitle: Where they lie\n"
            f"layer: {line}\nlayer: {vehicles}\nhide: {line}\nnorth: on\nscale: on\nbase: dark\nopens on: 2026-11-15\n:::\n\n::::")
    page = notes_infographic.read(case, body)
    data = drawn[-1]
    assert {one["layer"] for one in data["features"]} == {"Vehicles"}
    assert (data["north"], data["scale"], data["base"], data["day"]) == (True, "on", "dark", "2026-11-15")
    assert page.bands, "the panel is laid out"


def test_the_pdf_the_picture_and_the_html_page_read_a_map_panel_as_a_notes_map(client, monkeypatch):
    """What the builder's map card writes in a panel is read as the same lines in a map of the
    note: the PDF's picture and Export as a picture draw it from the same data, and the HTML page
    draws the same live map, its legend folded and its north arrow on."""
    cid, case = _case(client)
    line = _tracked_line(case)
    vehicles = _markers(client, cid)
    _proof(client, cid, "Heights", "2026-10-20", [("12.7295, 43.5002", "POV", True)])
    lines = (f"title: Where they lie\nlayer: {line}\nlayer: {vehicles}\nproofs: all\nhide: {line}\n"
             f"colour: {vehicles} = #009e73\nlabels: off\ncrowds: off\nnorth: on\nscale: on\nbase: dark\n"
             "frame: 43.45000, 12.68000, 43.56000, 12.77000\ntimeline: off\nopens on: 2026-11-15\nspeed: slow\n"
             "card: sentence\nlegend: folded\nstep: 2026-11-15 | The quay | 12.74000, 43.50000, 14")
    alone = f"# Front\n\n::: map\n{lines}\n:::\n"
    graphic = f":::: infographic\ntitle: Losses\n\n::: map\n{lines}\n:::\n::::"
    inside = f"# Front\n\n{graphic}\n"
    drawn: list[dict] = []
    real = notes_maps.render_png

    def kept(data, *args, **kwargs):
        drawn.append(data)
        return real(data, *args, **kwargs)

    monkeypatch.setattr(notes_maps, "render_png", kept)
    notes_pdf.render(case, title="Front", text=alone)
    printed = drawn[-1]
    assert {one["layer"] for one in printed["features"]} - {"Proofs"} == {"Vehicles"}
    assert (printed["north"], printed["scale"], printed["base"], printed["day"]) == (True, "on", "dark", "2026-11-15")
    drawn.clear()
    notes_pdf.render(case, title="Front", text=inside)
    assert drawn and all(one == printed for one in drawn), "the PDF prints the panel as it prints the note's map"
    drawn.clear()
    picture = client.post(f"/api/cases/{cid}/notes/infographic", json={"text": graphic, "format": "png", "size": "x"})
    assert picture.status_code == 200 and drawn[-1] == printed, "Export as a picture draws the same map"

    page_alone = notes_html.render(case, title="Front", text=alone).html
    page_inside = notes_html.render(case, title="Front", text=inside).html
    assert _map_data(page_inside) == _map_data(page_alone)
    panel = page_inside.decode("utf-8")
    panel = panel[panel.index('data-panel="map"'):]
    panel = panel[:panel.index("</figure>")]
    assert 'class="az-map-north"' in panel and 'data-base="dark"' in panel and 'data-steps="1"' in panel
    assert '<details class="az-map-key"><summary>Legend</summary>' in panel


# -- the imagery: Sentinel-2 or Esri, streamed live, filed for the file and the PDF ----------------


def _block(text: str) -> notes_maps.MapBlock:
    return notes_maps.parse_block(text.split("\n", 1)[1].rsplit("\n", 1)[0])


def _provider_of(case: Case, entity_id: str) -> str:
    return case.media_items_by_paths([case.get_entity(entity_id)["attrs"]["path"]])[0]["source"]["provider"]


@pytest.mark.parametrize("line, field, value", [
    ("imagery: sentinel", "imagery", "sentinel"), ("Imagery: ESRI", "imagery", "esri"), ("bounds: ground", "bounds", "ground"),
])
def test_imagery_and_bounds_read_their_one_line(line, field, value):
    block = notes_maps.parse_block(f"layer: Front\n{line}")
    assert getattr(block, field) == value and block.unread == []


@pytest.mark.parametrize("line", ["imagery: google", "imagery: sentinel-1", "bounds: world", "bounds: off"])
def test_imagery_or_bounds_it_cannot_read_is_kept_to_be_said(line):
    assert notes_maps.parse_block(f"layer: Front\n{line}").unread == [line]


def test_imagery_is_written_after_the_base_and_bounds_after_the_frame():
    block = notes_maps.parse_block("layer: Front\nbounds: ground\nframe: 43.4, 12.6, 43.6, 12.8\nimagery: esri\n"
                                   "hide: Vehicles\nbase: map\nview: 12.7, 43.5, 12")
    assert notes_maps.block_text(block).split("\n") == [
        "::: map", "layer: Front", "view: 12.70000, 43.50000, 12", "base: map", "imagery: esri", "hide: Vehicles",
        "frame: 43.40000, 12.60000, 43.60000, 12.80000", "bounds: ground", ":::"]


def test_a_put_files_sentinel_2_unless_it_names_esri_and_its_block_says_which(client, tiles_here):
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    sources = client.get(f"/api/cases/{cid}/notes/maps/sources").json()
    assert sources["provider"] == "s2cloudless~2025"
    assert sources["providers"][:2] == [{"id": "s2cloudless~2025", "label": "Sentinel-2 · free"},
                                        {"id": "esri-world-imagery", "label": "Esri · sharper"}]
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles]}).json()
    block = _block(put["text"])
    assert block.imagery == "sentinel" and "imagery: sentinel" in put["text"].split("\n")
    assert tiles_here and all("tiles.maps.eox.at" in url and "s2cloudless-2025" in url for url in tiles_here)
    assert _provider_of(case, block.ground) == "s2cloudless~2025"
    credit = notes_maps.derive(case, block).data["ground"]["credit"]
    assert credit.startswith("Imagery: EOxCloudless https://cloudless.eox.at") and credit.endswith("a year's mosaic, not a day")
    asked = len(tiles_here)
    esri = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles], "provider": "esri-world-imagery"}).json()
    assert _block(esri["text"]).imagery == "esri" and _provider_of(case, _block(esri["text"]).ground) == "esri-world-imagery"
    assert all("arcgisonline" in url for url in tiles_here[asked:])
    other = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles], "provider": "osm"}).json()
    assert _block(other["text"]).imagery == "", "another basemap's ground is drawn as filed"


def test_a_ground_is_filed_from_the_imagery_its_block_names_and_from_esri_when_it_names_none(client, tiles_here):
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles], "provider": "osm"}).json()
    plain = put["text"]
    for imagery, provider in (("", "esri-world-imagery"), ("sentinel", "s2cloudless~2025"), ("esri", "esri-world-imagery")):
        text = plain.replace("\n:::", f"\nimagery: {imagery}\n:::") if imagery else plain
        ground = client.post(f"/api/cases/{cid}/notes/maps/ground", json={"text": text, "base": "satellite"}).json()
        assert _provider_of(case, ground["ground"]) == provider, imagery
        detail = client.post(f"/api/cases/{cid}/notes/maps/detail", json={"text": text, **DRAW_VIEW}).json()
        assert _provider_of(case, detail["detail"]) == provider, imagery
    # another base takes its own map, whatever the imagery
    street = client.post(f"/api/cases/{cid}/notes/maps/ground",
                         json={"text": plain.replace("\n:::", "\nimagery: sentinel\n:::"), "base": "map"}).json()
    assert _provider_of(case, street["ground"]) == "osm"


def test_satellite_still_files_no_capture_of_a_years_mosaic(client, tiles_here):
    cid, _ = _case(client)
    for provider in ("s2cloudless", "s2cloudless~2025"):
        refused = client.post(f"/api/cases/{cid}/satellite/capture", json={
            "lat": 12.76, "lon": 43.5, "zoom": 12, "width": 800, "height": 500, "provider": provider})
        assert refused.status_code == 422 and "view-only" in refused.json()["detail"]
    assert tiles_here == []


def test_a_view_closer_than_its_map_is_where_the_page_opens_it_and_its_ground_is_filed_whole_again(client, tiles_here):
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles]}).json()
    block = _block(put["text"])
    whole = notes_maps.derive(case, block).data
    assert "opens" not in whole, "a put's view frames the whole map"
    # Draw › Open here: the view of a part of it
    lat, lon, zoom = notes_maps.fit_view([DRAW_VIEW["west"], DRAW_VIEW["south"], DRAW_VIEW["east"], DRAW_VIEW["north"]],
                                         1200, 750, pad=0)
    text = put["text"].replace(next(line for line in put["text"].split("\n") if line.startswith("view: ")),
                               f"view: {lat:.5f}, {lon:.5f}, {zoom:.2f}")
    opens = notes_maps.derive(case, _block(text)).data["opens"]
    assert opens[0] <= DRAW_VIEW["west"] + 1e-4 and opens[2] >= DRAW_VIEW["east"] - 1e-4
    assert opens[2] - opens[0] < (whole["bounds"][2] - whole["bounds"][0]) / 2
    # the ground filed again on another press covers what it covered, the view kept for the page
    again = client.post(f"/api/cases/{cid}/notes/maps/ground", json={"text": text, "base": "satellite"}).json()
    refiled = notes_maps.derive(case, _block(text.replace(block.ground, again["ground"]))).data
    assert refiled["bounds"] == pytest.approx(whole["bounds"], abs=2e-4) and refiled["opens"] == opens
    twice = client.post(f"/api/cases/{cid}/notes/maps/ground", json={"text": text, "base": "satellite"}).json()
    assert twice["ground"] == again["ground"] and twice["filed"] == []


def test_a_live_map_streams_the_imagery_its_block_names_and_keeps_its_reader_inside_when_asked(client):
    cid, case = _case(client)
    name = _tracked_line(case)
    plain = notes_maps.derive(case, notes_maps.parse_block(f"layer: {name}")).data
    assert not {"imagery", "inside", "opens"} & set(plain)
    sentinel = notes_maps.derive(case, notes_maps.parse_block(f"layer: {name}\nimagery: sentinel\nbounds: ground")).data
    assert sentinel["imagery"]["tiles"].startswith("https://tiles.maps.eox.at/") and sentinel["imagery"]["native"] == 14
    assert sentinel["imagery"]["link"] == "https://cloudless.eox.at"
    assert sentinel["imagery"]["credit"].endswith("Contains modified Copernicus Sentinel data 2025) · "
                                                  "CC BY-NC-SA 4.0, non-commercial use, a year's mosaic, not a day")
    assert sentinel["inside"] is True
    esri = notes_maps.derive(case, notes_maps.parse_block(f"layer: {name}\nimagery: esri")).data["imagery"]
    assert esri["tiles"].startswith("https://services.arcgisonline.com/") and esri["credit"].startswith("Imagery: Esri")
    dark = notes_maps.derive(case, notes_maps.parse_block(f"layer: {name}\nimagery: esri\nbase: dark")).data
    assert "imagery" not in dark, "a street or a dark base streams no imagery"


def test_the_check_says_esris_terms_for_a_public_page_only(client, tiles_here):
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"title": "Losses", "layers": [vehicles],
                                                             "provider": "esri-world-imagery"}).json()
    said = 'The map "Losses": Esri’s terms limit reuse, so publishing it is your responsibility.'
    note = _note_with(client, cid, f"# Front\n\n> [!internal]\n> Ours.\n\n{put['text']}\n")["id"]
    route = f"/api/cases/{cid}/notes/pdf/check"

    def warned(**body) -> list[dict]:
        return client.post(route, json={"notes": [note], **body}).json()["notes"][0]["warnings"]

    for body in ({"format": "html", "edition": "public"}, {"format": "web"}):
        found = [warning for warning in warned(**body) if warning["text"] == said]
        assert len(found) == 1 and found[0]["kind"] == "other", body
    for body in ({"format": "html", "edition": "internal"}, {"format": "pdf", "edition": "public"}):
        assert not [warning for warning in warned(**body) if "Esri" in warning["text"]], body
    ready = client.post(route, json={"notes": [note], "format": "html", "edition": "public", "ready": True}).json()
    assert next(one for one in ready["notes"][0]["warnings"] if one["text"] == said)["group"] == "figures"
    # Sentinel-2 says nothing
    sentinel = put["text"].replace("imagery: esri", "imagery: sentinel")
    other = _note_with(client, cid, f"# Front\n\n{sentinel}\n", title="Free")["id"]
    public = client.post(route, json={"notes": [other], "format": "html", "edition": "public"}).json()["notes"][0]
    assert not [warning for warning in public["warnings"] if "Esri" in warning["text"]]


def test_the_card_says_esris_terms_in_the_checks_words():
    source = (Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "notes" / "editor" / "mapText.js").read_text("utf-8")
    assert f"export const ESRI_TERMS = '{notes_maps.ESRI_TERMS}';" in source


@pytest.mark.parametrize("frame", [(43.4336, 12.65808, 43.7528, 12.98971), (43.455, 12.68, 43.56, 12.77),
                                   (43.49, 12.74, 43.502, 12.748)])
def test_a_ground_filed_for_a_frame_holds_all_of_it(client, tiles_here, frame):
    """Rounded down, a frame's edge fell a fraction of a pixel outside its ground and the card said
    part of it had no ground, as many times as it was filed again (seen on Bab al-Mandab's map)."""
    cid, case = _case(client)
    vehicles = _markers(client, cid)
    put = client.post(f"/api/cases/{cid}/notes/maps", json={"layers": [vehicles]}).json()
    text = put["text"].replace("\n:::", "\nframe: " + ", ".join(f"{value:.5f}" for value in frame) + "\n:::")
    for imagery in ("sentinel", "esri"):
        filed = client.post(f"/api/cases/{cid}/notes/maps/ground",
                            json={"text": text.replace("imagery: sentinel", f"imagery: {imagery}"), "base": "satellite"}).json()
        bounds = notes_maps.derive(case, _block(text.replace(put["ground"]["id"], filed["ground"]))).data["ground"]["bounds"]
        assert bounds[0] <= frame[0] and bounds[1] <= frame[1] and bounds[2] >= frame[2] and bounds[3] >= frame[3], imagery
