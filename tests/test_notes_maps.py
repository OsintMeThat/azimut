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

LINE_DAYS = {
    "2026-10-06": [[43.46, 12.79], [43.50, 12.78], [43.55, 12.77]],
    "2026-10-14": [[43.47, 12.75], [43.51, 12.74], [43.55, 12.72]],
}


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
    assert [row["name"] for row in sources["layers"]] == [name] and sources["provider"] == "esri-world-imagery"
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


def _fixture_map() -> notes_maps.Derived:
    ground = io.BytesIO()
    Image.new("RGB", (160, 100), (52, 74, 60)).save(ground, "PNG")
    tank = "s-badge-tank-e53935-destroyed"
    card = {"title": "#1", "kicker": "Vehicles", "day": "15 November 2026", "text": "Burned on the road.",
            "source": {"label": "x.com", "url": "https://x.com/desk/status/1"}}
    data = {
        "version": 1, "title": "The line", "view": {"center": [43.5, 12.75], "zoom": 10, "bearing": 0},
        "bounds": [43.40, 12.68, 43.60, 12.82],
        "ground": {"src": "data:image/png;base64," + base64.b64encode(ground.getvalue()).decode(),
                   "bounds": [43.40, 12.68, 43.60, 12.82], "credit": "Imagery: Esri, test", "size": [160, 100]},
        "details": [],
        "days": ["2026-10-06", "2026-10-14", "2026-10-20", "2026-11-15", "2026-11-16"], "day": "2026-11-16",
        "features": [
            {"id": "l0f0", "kind": "line", "coords": [LINE_DAYS["2026-10-06"]], "from": "2026-10-06",
             "until": "2026-10-13", "label": "Forward line", "of": "l0f0", "layer": "Line", "group": "Features",
             "style": {"color": "#1e88e5", "width": 3}, "card": {"title": "Forward line", "day": "6 to 13 October 2026"}},
            {"id": "l0f0s1", "kind": "line", "coords": [LINE_DAYS["2026-10-14"]], "from": "2026-10-14",
             "until": "2026-11-14", "label": "Forward line", "of": "l0f0", "layer": "Line", "group": "Features",
             "style": {"color": "#1e88e5", "width": 3}, "card": {"title": "Forward line", "day": "14 October to 14 November 2026"}},
            {"id": "l1f0", "kind": "point", "coords": [43.495, 12.745], "from": "2026-11-15", "until": None,
             "label": "#1", "of": "l1f0", "layer": "Vehicles", "group": "Destroyed",
             "style": {"color": "#e53935", "icon": tank, "status": "destroyed", "size": 1, "label": True}, "card": card},
            {"id": "l1f1", "kind": "point", "coords": [43.4951, 12.7451], "from": "2026-11-16", "until": None,
             "label": "#2", "of": "l1f1", "layer": "Vehicles", "group": "Destroyed",
             "style": {"color": "#e53935", "icon": tank, "status": "destroyed", "size": 1, "label": True},
             "card": {**card, "title": "#2", "day": "16 November 2026"}},
            {"id": "p0", "kind": "point", "coords": [43.52, 12.72], "from": "2026-10-20", "until": None,
             "label": "Heights, crest", "of": "p0", "layer": "Proofs", "group": "Proofs",
             "style": {"color": notes_maps.PROOF_COLOUR, "icon": "", "width": 2, "size": 1.0, "proof": True},
             "card": {"title": "Heights", "kicker": "Proof", "day": "20 October 2026", "text": "Seen on the heights.",
                      "proof": {"name": "Heights", "figure": "#fig-1"},
                      "verify": [{"label": "Check on Esri Wayback", "url": "https://livingatlas.arcgis.com/wayback/"}]}},
        ],
        "steps": [
            {"id": "p0", "label": "", "text": "Seen on the heights.", "name": "Heights", "day": "2026-10-20",
             "view": {"center": [43.52, 12.72], "zoom": 12, "bearing": 0, "pitch": 0}, "focus": ["p0"]},
            {"id": "s1", "label": "The road", "day": "2026-11-16",
             "view": {"center": [43.495, 12.745], "zoom": 13, "bearing": 0, "pitch": 0}, "focus": []},
        ],
        "credits": ["Imagery: Esri, test"],
    }
    legend = [{"label": "Forward line", "layer": "Line", "kind": "line", "style": {"color": "#1e88e5"}, "count": 1},
              {"label": "Destroyed", "layer": "Vehicles", "kind": "point", "style": data["features"][2]["style"], "count": 2},
              {"label": "Proofs", "layer": "Proofs", "kind": "point", "style": data["features"][4]["style"], "count": 1}]
    return notes_maps.Derived(data=data, legend=legend,
                              icons={tank: {"symbol": "badge-tank", "colour": "#e53935", "status": "destroyed"}})


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
