"""A map page's cover (`notes_web.map_cover`): the picture of a web map in the site's lists and on its
link card, drawn from the map itself as the page shows it once loaded: its band, its ground cut to
fill its part with no band round it and its marks over it, and its legend."""

from __future__ import annotations

import dataclasses
import io
from pathlib import Path

from PIL import Image, ImageDraw

from azimut.engine import notefill, notes_html, notes_maps, notes_web, site
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from ambushfixture import _image
from mapfixture import fixture_map
from notecase import make_case, make_note
from test_notes_pdf_golden import CREATED, golden_case

WIDTH, HEIGHT = notes_web.SHARE_SIZE
MAGENTA = "#ff00ff"


def _ground(tmp_path: Path, size: tuple[int, int] = (800, 560)) -> Path:
    """A green ground with a gentle grain, so no two of its edges read as one flat colour."""
    picture = Image.new("RGB", size)
    draw = ImageDraw.Draw(picture)
    for x in range(size[0]):
        draw.line([(x, 0), (x, size[1])], fill=(40 + x % 23, 150 + x * 30 // size[0], 80))
    path = tmp_path / "ground.png"
    picture.save(path)
    return path


def _with_ground(tmp_path: Path, **change) -> notes_maps.Derived:
    derived = fixture_map()
    data = {**derived.data, **change}
    return dataclasses.replace(derived, data=data, ground=_ground(tmp_path))


def _one_point(derived: notes_maps.Derived, lon: float, lat: float) -> notes_maps.Derived:
    """The map with one more mark, a filled magenta circle, alone where it is."""
    icon = f"s-circle-{MAGENTA.lstrip('#')}"
    point = {"id": "m0", "kind": "point", "coords": [lon, lat], "from": None, "until": None, "label": "", "of": "m0",
             "layer": "Marks", "group": "Marks", "style": {"color": MAGENTA, "icon": icon, "size": 1}}
    data = {**derived.data, "features": [*derived.data["features"], point]}
    return dataclasses.replace(derived, data=data,
                               icons={**derived.icons, icon: {"symbol": "circle", "colour": MAGENTA, "status": ""}})


def _cover(derived: notes_maps.Derived, **page) -> Image.Image:
    made = notes_web.map_cover(notes_html.MapPage(derived, **page), title="Armour on the road",
                               description="The line and the armour left on the road, 15 and 16 November.")
    picture = Image.open(io.BytesIO(made))
    assert picture.format == "JPEG" and picture.size == (WIDTH, HEIGHT)
    return picture.convert("RGB")


def _green(pixel: tuple[int, ...]) -> bool:
    return pixel[1] > pixel[0] + 25 and pixel[1] > pixel[2] + 10


def _map_top(cover: Image.Image) -> int:
    """Where the map starts under the band: the first green row of the cover's left column."""
    found = next((y for y in range(HEIGHT) if _green(cover.getpixel((3, y)))), None)
    assert found is not None, "no ground along the map's left edge: a band stands there"
    return found


def _near(pixel: tuple[int, ...], colour: str, by: int = 60) -> bool:
    wanted = Image.new("RGB", (1, 1), colour).getpixel((0, 0))
    return sum(abs(a - b) for a, b in zip(pixel, wanted)) <= by


def test_the_cover_is_the_band_the_map_with_no_band_and_the_legend(tmp_path):
    derived = _with_ground(tmp_path)
    cover = _cover(derived, who="Desk", handle="@desk_maps")
    top = _map_top(cover)
    # the band: the page's dark, the title in white on it
    assert 70 < top < 140
    band = cover.crop((0, 0, WIDTH, top - 2))
    assert all(_near(band.getpixel((x, 4)), "#0f1012", 12) for x in range(0, WIDTH, 50))
    assert max(band.getpixel((x, y))[0] for x in range(24, 400) for y in range(10, top - 10)) > 240
    # the map: its frame is narrower than its part of the cover, which its ground fills to every edge
    right = WIDTH - notes_web.MAP_PANEL - 1
    edges = [(1, y) for y in range(top + 2, HEIGHT - 30, 25)] + [(right - 1, y) for y in range(top + 2, HEIGHT - 60, 25)]
    edges += [(x, top + 1) for x in range(0, right, 40)] + [(x, HEIGHT - 2) for x in range(0, right - 420, 40)]
    flat = [spot for spot in edges if not _green(cover.getpixel(spot))]
    assert not flat, flat
    # the legend's column, the page's dark again, with each row's symbol in its colour
    column = cover.crop((right + 2, top, WIDTH, HEIGHT))
    colours = list(column.get_flattened_data())
    for colour in ("#1e88e5", "#e53935", notes_maps.PROOF_COLOUR):
        assert sum(_near(pixel, colour, 70) for pixel in colours) > 20, colour
    assert _near(column.getpixel((column.width - 5, column.height - 5)), "#0f1012", 12)


def test_the_legend_is_listed_as_the_pages_switcher_lists_it(tmp_path):
    derived = fixture_map()
    listed = [(layer, [(row["label"], row["count"]) for row in rows]) for layer, rows in notes_web.map_legend(derived)]
    assert listed == [("Line", [("Forward line", 1)]), ("Vehicles", [("Destroyed", 2)]), ("Proofs", [("Proofs", 1)])]
    # one layer is not named over its rows
    alone = dataclasses.replace(derived, legend=[row for row in derived.legend if row["layer"] == "Vehicles"])
    assert notes_web.map_legend(alone) == [("", alone.legend)]
    # a map that hides its legend has none, and its map takes the cover's whole width
    hidden = dataclasses.replace(_with_ground(tmp_path), display={"legend": "hidden"})
    assert notes_web.map_legend(hidden) == []
    cover = _cover(hidden)
    top = _map_top(cover)
    assert all(_green(cover.getpixel((x, top + 20))) for x in range(WIDTH - 300, WIDTH, 20))


def test_a_mark_stands_where_the_projection_puts_it(tmp_path):
    derived = _one_point(_with_ground(tmp_path), 43.43, 12.79)
    cover = _cover(derived)
    top = _map_top(cover)
    width, height = WIDTH - notes_web.MAP_PANEL, HEIGHT - top
    west, south, east, north = notes_web.cover_frame(derived.data, width, height)
    x0, y0 = notes_maps.mercator(west, north)
    x1, y1 = notes_maps.mercator(east, south)
    mx, my = notes_maps.mercator(43.43, 12.79)
    at = (round((mx - x0) / (x1 - x0) * width), top + round((my - y0) / (y1 - y0) * height))
    assert 30 < at[0] < width - 30 and top + 30 < at[1] < HEIGHT - 30
    assert _near(cover.getpixel(at), MAGENTA, 90), cover.getpixel(at)
    # and nowhere else
    assert not _near(cover.getpixel((width - at[0], at[1])), MAGENTA, 90)


def test_the_cover_slides_to_keep_the_marks_and_holds_where_the_page_opens_whole(tmp_path):
    ground = [43.0, 12.0, 44.0, 12.5]
    marks = [{"id": f"m{n}", "kind": "point", "coords": [43.9 + n * 0.01, 12.25], "style": {}} for n in range(4)]
    data = {"bounds": ground, "ground": {"bounds": ground}, "features": marks, "day": ""}
    # the ground is wider than the cover: cut to its shape, slid east to hold the marks, never past the ground
    west, south, east, north = notes_web.cover_frame(data, 800, 530)
    assert (round(south, 6), round(north, 6)) == (12.0, 12.5) and east <= 44.0 + 1e-9
    assert all(west < 43.9 + n * 0.01 < east for n in range(4))
    # with no mark it stays on the middle
    west, _, east, _ = notes_web.cover_frame({**data, "features": []}, 800, 530)
    assert abs((west + east) / 2 - 43.5) < 1e-6
    # where the page opens is held whole when the ground reaches round it, as its live map shows it
    opens = [43.4, 12.2, 43.6, 12.3]
    west, south, east, north = notes_web.cover_frame({**data, "opens": opens, "features": []}, 800, 530)
    assert west <= 43.4 and east >= 43.6 and south <= 12.2 and north >= 12.3
    assert abs((east - west) / 0.2 - 1) < 0.01 or abs((north - south) / 0.1 - 1) < 0.02


def test_a_map_with_no_ground_is_drawn_plain_and_on_land_when_wide_enough(tmp_path):
    derived = _one_point(fixture_map(), 43.45, 12.75)
    plain = dataclasses.replace(derived, data={**derived.data, "ground": None, "credits": []})
    cover = _cover(plain)
    # its band and its column still the page's dark; its map the plain background a map has with no ground
    assert _near(cover.getpixel((600, 5)), "#0f1012", 12)
    spots = [cover.getpixel((x, 600)) for x in range(10, 500, 40)]
    assert sum(_near(spot, notes_maps.PLAIN_GROUND, 20) for spot in spots) >= len(spots) - 2
    assert any(_near(cover.getpixel((x, y)), MAGENTA, 90) for x in range(0, 864, 2) for y in range(140, 630, 2))
    # a map as wide as a region stands on the site atlas's land, the sea round it
    wide = dataclasses.replace(plain, data={**plain.data, "bounds": [41.0, 11.0, 46.5, 15.0]})
    cover = _cover(wide)
    area = cover.crop((0, 140, 860, 620)).resize((86, 48))
    sea, land, _ = notes_web.LAND_LIGHT
    found = list(area.get_flattened_data())
    assert sum(_near(pixel, "#%02x%02x%02x" % sea, 14) for pixel in found) > 200
    assert sum(_near(pixel, "#%02x%02x%02x" % land, 14) for pixel in found) > 200


def test_a_crowd_on_the_cover_is_its_count_where_the_pdf_spreads_every_mark():
    derived = fixture_map()
    crowd = [{"id": f"c{n}", "kind": "point", "coords": [43.5 + n * 1e-6, 12.75], "from": None, "until": None,
              "label": "", "style": {"color": "#e53935", "icon": "s-badge-tank-e53935-destroyed"}} for n in range(20)]
    data = {**derived.data, "features": crowd, "ground": None, "day": ""}
    project = notes_maps._Projector(data["bounds"])
    x, y = project(43.5, 12.75)
    middle = (round(x * 800 / project.width), round(y * 800 / project.width))

    def at(picture: Image.Image) -> tuple[int, ...]:
        # inside the count's disc, under its number
        return picture.getpixel((middle[0], middle[1] + 10))

    counted = notes_maps.picture(data, 800, icons=derived.icons, as_page=True)
    spread = notes_maps.picture(data, 800, icons=derived.icons)
    # the count's dark disc where the crowd stands; spread, a mark of the crowd's red there
    assert sum(at(counted)) < 120, at(counted)
    assert _near(at(spread), "#e53935", 120) or sum(at(spread)) > 300
    # a map that turns its crowds off spreads them on its cover too
    assert notes_maps.picture({**data, "crowds": 0}, 800, icons=derived.icons, as_page=True).tobytes() == spread.tobytes()


def _map_note(client, monkeypatch, tmp_path, derived: notes_maps.Derived) -> tuple[Case, str]:
    cid = make_case(client, "Maps")
    monkeypatch.setattr(notes_maps, "derive", lambda *_, **__: derived)
    text = "The road, in one line.\n\n::: map\ntitle: The road\nlayer: Front\n:::\n\nWords beside it.\n"
    made = make_note(client, cid, title="The road", content=text)
    client.put(f"/api/cases/{cid}/notes/{made['id']}/look", json={"style": "article", "web": "map"})
    return Case.open(cid), made["id"]


def test_a_published_map_page_lists_and_shares_its_cover_and_a_list_picture_still_wins(client, monkeypatch, tmp_path):
    case, note_id = _map_note(client, monkeypatch, tmp_path, _with_ground(tmp_path))
    placement = site.Placement(site.Site(title="The Desk", address="https://octo.github.io/articles/"))
    made = notes_web.build(case, note_id, base_url="https://octo.github.io/articles/the-road/", placement=placement)
    assert made.card is not None and made.card.layout == "map" and made.card.image == "cover.jpg"
    # the card and the list's picture are the map's cover, not its bare ground
    assert made.files["cover.jpg"] == made.files["share.jpg"]
    cover = Image.open(io.BytesIO(made.files["cover.jpg"])).convert("RGB")
    assert cover.size == (WIDTH, HEIGHT) and _near(cover.getpixel((600, 5)), "#0f1012", 12)
    assert _green(cover.getpixel((3, _map_top(cover) + 5)))
    # a web folder exported with no site carries the same card
    alone = notes_web.build(case, note_id, base_url="https://octo.github.io/articles/the-road/")
    assert alone.files["share.jpg"] == made.files["share.jpg"] and "cover.jpg" not in alone.files
    # the analyst's list picture still stands in the list, the card staying the map's
    designed = _image(case, "Designed", Image.new("RGB", (1200, 630), (30, 30, 200)), {"type": "clipboard"})
    client.put(f"/api/cases/{case.id}/notes/{note_id}/look", json={"style": "article", "web": "map",
                                                                     "list_image": designed["id"]})
    listed = notes_web.build(case, note_id, base_url="https://octo.github.io/articles/the-road/", placement=placement)
    centre = Image.open(io.BytesIO(listed.files["cover.jpg"])).convert("RGB").getpixel((600, 315))
    assert centre[2] > 150 and centre[0] < 80
    assert listed.files["share.jpg"] == made.files["share.jpg"]
    # the check before the export draws no cover
    checked = notes_web.build(case, note_id, base_url="https://octo.github.io/articles/the-road/", check=True)
    assert "share.jpg" not in checked.files


def test_the_rendered_map_page_names_its_map_and_its_analyst(tmp_path, monkeypatch):
    derived = fixture_map()
    monkeypatch.setattr(notes_maps, "derive", lambda *_, **__: derived)
    logo = tmp_path / "logo.png"
    Image.new("RGB", (120, 120), (120, 60, 200)).save(logo)
    text = "Its line.\n\n::: map\ntitle: The road\nlayer: Front\n:::\n"
    look = NoteLook.model_validate({"style": "article", "web": "map"})
    who = notefill.Identity(name="A. Analyst", organisation="Desk", logo=logo, handle="@desk_maps")
    rendered = notes_html.render(golden_case(tmp_path), title="The road", text=text, look=look, public=True,
                                 created=CREATED, identity=who)
    assert rendered.map_page is not None and rendered.map_page.map is derived
    assert (rendered.map_page.who, rendered.map_page.handle, rendered.map_page.logo) == ("Desk", "@desk_maps", logo)
    # an article holding the same map has no map page to draw
    article = notes_html.render(golden_case(tmp_path), title="The road", text=text, public=True, created=CREATED,
                                identity=who)
    assert article.map_page is None
