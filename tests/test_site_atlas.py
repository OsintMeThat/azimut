"""The map of places on Azimut's default home (`engine/siteatlas.py`, `engine/sitehome.py`), and the home put
online before any article.

The land is a file made once from the Natural Earth outline the map plate ships (`scripts/make_site_atlas.py`);
the pins are drawn in the page, framed to fit, each a link, with no request anywhere but the site itself.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

from azimut.engine import githubpages, site, siteatlas, sitehome, sitesync
from azimut.engine.notelook import NotePlace
from azimut.engine.site import Card, Site

from githubfake import FakeGitHub
from test_site_publish import _connect, _edit, _new_note

ROOT = Path(__file__).resolve().parent.parent
HOME = Site(title="Desk", address="https://octo.github.io/articles/")


@pytest.fixture()
def fake(monkeypatch):
    stand_in = FakeGitHub()
    real = githubpages.client
    monkeypatch.setattr(githubpages, "client", lambda transport=None: real(stand_in.transport()))
    monkeypatch.setattr(githubpages.time, "sleep", lambda seconds: None)
    return stand_in


@pytest.fixture(autouse=True)
def an_empty_memory():
    sitesync._kept.clear()
    sitesync._plain.clear()
    sitesync._weight = 0


def _line(folder: str, title: str, day: str, place: tuple[float, float, str] | None, **more) -> dict:
    card = Card(title=title, summary="S.", date=day, author=more.pop("author", "Desk"),
                place=NotePlace(lat=place[0], lon=place[1], name=place[2]) if place else None, **more)
    return site.line_of(card, folder)


def _home(lines: list[dict], home: Site = HOME) -> str:
    return site.fill(sitehome.home(home, lines, [], []), lines, [], home.title, home.prefix)


BAB = (12.725, 43.5075, "Bab al-Mandab")
PERIM = (12.66, 43.42, "Perim Island")
CARACAS = (10.443637, -66.9184, "Caracas")


# -- the projection and the land ------------------------------------------------------------------------------------


def test_the_projection_is_equal_earth_over_the_whole_atlas():
    assert siteatlas.project(0, 0) == (siteatlas.WIDTH / 2, siteatlas.HEIGHT / 2)
    west, east = siteatlas.project(-180, 0), siteatlas.project(180, 0)
    assert west[0] == pytest.approx(0) and east[0] == pytest.approx(siteatlas.WIDTH)
    north, south = siteatlas.project(0, 90), siteatlas.project(0, -90)
    assert north[1] == pytest.approx(0, abs=0.5) and south[1] == pytest.approx(siteatlas.HEIGHT, abs=0.5)
    assert siteatlas.WIDTH / siteatlas.HEIGHT == pytest.approx(2.0555, abs=0.01)
    # Equal Earth as d3-geo draws it (geoEqualEarthRaw, read off the frontend's copy): Bab al-Mandab, Caracas, a pole
    for (lon, lat), (raw_x, raw_y) in (((43.5075, 12.725), (0.6465252, 0.2566732)), ((-66.9184, 10.443637), (-0.9982680, 0.2109547)),
                                       ((-180, 90), (-1.6035886, 1.3173628))):
        x, y = siteatlas.project(lon, lat)
        assert (x - siteatlas.WIDTH / 2) / siteatlas.SCALE == pytest.approx(raw_x, abs=1e-6)
        assert (siteatlas.HEIGHT / 2 - y) / siteatlas.SCALE == pytest.approx(raw_y, abs=1e-3)


def test_the_land_is_one_small_path_of_natural_earth_made_by_the_script_from_what_azimut_ships():
    data = siteatlas.land()
    text = data.decode("utf-8")
    assert len(data) < 40 * 1024
    assert text.startswith('<svg xmlns="http://www.w3.org/2000/svg" ')
    assert f'viewBox="0 0 {siteatlas.WIDTH} {siteatlas.HEIGHT}"' in text and "Natural Earth" in text
    assert text.count("<path ") == 1 and "<script" not in text and "href" not in text
    # the file is what the script makes from the plate's outline: neither can drift from the other
    spec = importlib.util.spec_from_file_location("make_site_atlas", ROOT / "scripts" / "make_site_atlas.py")
    assert spec is not None and spec.loader is not None
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    assert script.make() == text
    assert "Natural Earth" in json.loads((ROOT / "frontend/src/lib/plate/world.json").read_text())["source"]


def test_the_land_reads_back_as_rings_and_a_point_of_it_back_in_degrees():
    """What a web map with no ground stands on in its cover (`notes_web.map_cover`)."""
    for lon, lat in ((43.5075, 12.725), (-66.9184, 10.443637), (151.2, -33.87), (-179.5, 71.0), (0.0, 0.0)):
        back = siteatlas.unproject(*siteatlas.project(lon, lat))
        assert back == (pytest.approx(lon, abs=1e-9), pytest.approx(lat, abs=1e-9))
    rings = siteatlas.rings()
    path = re.search(r' d="([^"]+)"', siteatlas.land().decode("utf-8"))
    assert path is not None and len(rings) == path.group(1).count("M") > 200
    for (left, top, right, bottom), corners in rings:
        assert len(corners) >= 3 and 0 <= left <= right <= siteatlas.WIDTH and 0 <= top <= bottom <= siteatlas.HEIGHT
        assert (left, top, right, bottom) == (min(x for x, _ in corners), min(y for _, y in corners),
                                             max(x for x, _ in corners), max(y for _, y in corners))
    # the Arabian peninsula holds Sanaa, the Red Sea west of it none
    sanaa, sea = siteatlas.project(44.2, 15.35), siteatlas.project(39.5, 18.0)
    holding = [corners for box, corners in rings if box[0] <= sanaa[0] <= box[2] and box[1] <= sanaa[1] <= box[3]]
    assert any(_inside(sanaa, corners) for corners in holding)
    assert not any(_inside(sea, corners) for _, corners in rings)


def _inside(point: tuple[float, float], corners: tuple[tuple[float, float], ...]) -> bool:
    x, y = point
    inside = False
    for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


# -- framing and grouping -------------------------------------------------------------------------------------------


def test_one_pin_is_framed_on_its_region_and_several_fill_the_middle_of_the_frame():
    left, top, wide, high = siteatlas.frame([siteatlas.project(43.5, 12.7)])
    assert wide == pytest.approx(siteatlas.MIN_SPAN) and wide / high == pytest.approx(siteatlas.ASPECT)
    x, y = siteatlas.project(43.5, 12.7)
    assert left + wide / 2 == pytest.approx(x) and top + high / 2 == pytest.approx(y)
    points = [siteatlas.project(43.5, 12.7), siteatlas.project(-66.9, 10.4)]
    left, top, wide, high = siteatlas.frame(points)
    span = abs(points[0][0] - points[1][0])
    assert span / wide == pytest.approx(siteatlas.FILL)
    assert all(left < px < left + wide and top < py < top + high for px, py in points)


def test_the_frame_never_passes_the_world_and_stays_on_the_atlas():
    corners = [siteatlas.project(-179, 70), siteatlas.project(179, -50)]
    left, top, wide, high = siteatlas.frame(corners)
    assert wide == pytest.approx(siteatlas.WIDTH) and left == pytest.approx(0)
    # a pin at the edge of the world: the frame moves in rather than show what is not there
    left, top, wide, high = siteatlas.frame([siteatlas.project(178, 60)])
    assert left + wide <= siteatlas.WIDTH + 1e-6 and top >= 0


def test_articles_at_one_spot_make_one_pin_and_the_rest_their_own():
    lines = [_line("bab", "Bab", "2026-11-20", BAB), _line("perim", "Perim", "2026-10-02", PERIM),
             _line("caracas", "Caracas", "2026-01-03", CARACAS), _line("nowhere", "Nowhere", "2026-01-01", None)]
    chosen = siteatlas.placed(lines)
    assert [line["title"] for line in chosen] == ["Bab", "Perim", "Caracas"]
    pins = siteatlas.pins(chosen, siteatlas.frame([siteatlas.project(43.5, 12.7), siteatlas.project(-66.9, 10.4)])[2])
    assert [[line["title"] for line in pin.lines] for pin in pins] == [["Bab", "Perim"], ["Caracas"]]
    # framed as close as the map goes, a place a few degrees off stands apart
    aden = _line("aden", "Gulf of Aden", "2026-09-01", (12.8, 47.5, "Gulf of Aden"))
    assert len(siteatlas.pins([chosen[0], aden], siteatlas.MIN_SPAN)) == 2
    assert len(siteatlas.pins(chosen[:2], siteatlas.MIN_SPAN)) == 1


# -- the map on the home --------------------------------------------------------------------------------------------


def test_the_home_shows_no_map_until_an_article_stands_somewhere():
    page = _home([_line("story", "A story", "2026-11-20", None)])
    assert "site-map" not in page and sitehome.ATLAS not in page
    assert sitehome.ATLAS not in sitehome.kit(HOME) and sitehome.ATLAS in sitehome.kit(HOME, atlas=True)
    assert sitehome.kit(HOME, atlas=True)[sitehome.ATLAS] == siteatlas.land()


def test_the_map_has_a_pin_link_for_each_placed_article_framed_to_fit_with_no_style_or_request_elsewhere():
    lines = site.listing([_line("bab", "The Bab front", "2026-11-20", BAB), _line("perim", "Perim's runway", "2026-10-02", PERIM),
                          _line("caracas", "A night in Caracas", "2026-01-03", CARACAS, author="A. Guest"),
                          _line("story", "No place", "2026-01-01", None)])
    page = _home(lines)
    section = page[page.index('<section class="site-map"'):page.index("</section>") + 10]
    # under the header, above the tabs
    assert page.index("</header>") < page.index('<section class="site-map"') < page.index('<nav class="site-tabs"')
    assert f'<image href="{sitehome.ATLAS}" x="0" y="0" width="{siteatlas.WIDTH}" height="{siteatlas.HEIGHT}"/>' in section
    viewbox = [float(n) for n in re.search(r'viewBox="([^"]+)"', section).group(1).split()]
    assert viewbox[2] / viewbox[3] == pytest.approx(siteatlas.ASPECT, rel=0.01)
    links = re.findall(r'<a class="az-pin( az-many)?" href="([^"]+)" data-pin="(\d)"', section)
    assert links == [(" az-many", "/articles/bab/", "0"), (" az-many", "/articles/perim/", "0"), ("", "/articles/caracas/", "1")]
    assert "<title>The Bab front · 20 November 2026 · Bab al-Mandab</title>" in section
    # the author shows on a guest's pin, never the site's own name
    assert 'data-by="A. Guest"' in section and "A night in Caracas · 3 January 2026 · A. Guest · Caracas" in section
    assert 'data-by="Desk"' not in section
    for x_y in re.findall(r'd="M([\d.]+) ([\d.]+)l', section):
        x, y = map(float, x_y)
        assert viewbox[0] < x < viewbox[0] + viewbox[2] and viewbox[1] < y < viewbox[1] + viewbox[3]
    # the home's policy as it was: no inline style, no other host
    assert "style=" not in page and "http://" not in section.replace("http://www.w3.org", "")
    policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', page).group(1)
    assert policy == sitehome.POLICY


def test_a_hostile_title_or_place_stays_text_and_the_pins_are_bounded():
    hostile = _line("x", '<script>alert(1)</script> "q"', "2026-11-20", (1.0, 2.0, '<img src=x onerror=alert(1)>'))
    page = _home([hostile])
    assert "<script>alert" not in page and "<img src=x" not in page and "&lt;img src=x onerror=alert(1)&gt;" in page
    many = [_line(f"a{n}", f"A{n}", "2026-11-20", (float(n % 80), float(n), "")) for n in range(siteatlas.MAX_PINS + 20)]
    assert _home(many).count('class="az-pin') == siteatlas.MAX_PINS


def test_the_script_writes_the_card_as_text_and_reaches_nothing():
    js = sitehome.TABS_JS
    assert ".site-map" in js and "textContent" in js
    assert "innerHTML" not in js and "fetch(" not in js and "XMLHttpRequest" not in js
    css = sitehome.CSS
    assert "vector-effect:non-scaling-stroke" in css and ".az-pin:focus-visible" in css


def test_a_publish_with_a_place_writes_the_land_once_and_a_home_with_none_never_does(client, fake):
    fake.make_repo()
    _connect(client)
    note = _new_note(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    assert sitehome.ATLAS not in fake.files() and "site-map" not in fake.files()["index.html"].decode()
    placed = client.post(note["url"], json={"short_name": "port-strike", "role": "article",
                                            "place": {"lat": 12.725, "lon": 43.5075, "name": "Bab al-Mandab"}})
    assert placed.status_code == 200, placed.text
    assert sitehome.ATLAS in placed.json()["site"]["written"]
    assert fake.files()[sitehome.ATLAS] == siteatlas.land()
    home = fake.files()["index.html"].decode()
    assert 'class="site-map"' in home and '<a class="az-pin" href="/articles/port-strike/"' in home
    again = client.post(note["url"], json={"short_name": "port-strike", "role": "article",
                                           "place": {"lat": 12.725, "lon": 43.5075, "name": "Bab al-Mandab"}})
    assert sitehome.ATLAS not in again.json()["site"]["written"]


# -- the home put online before any article ---------------------------------------------------------------------------


def test_update_the_site_puts_the_home_online_before_any_article_with_its_feed_and_sitemap(client, fake):
    fake.make_repo()
    _connect(client)
    said = client.post("/api/publishing/github/site").json()
    files = fake.files()
    assert said["updated"] is True and {"index.html", "feed.xml", "sitemap.xml", "articles.json"} <= set(said["written"])
    home = files["index.html"].decode()
    assert site.owns_home(home) and "No articles yet." in home and "site-map" not in home
    assert site.owns_feed(files["feed.xml"].decode()) and site.owns_sitemap(files["sitemap.xml"].decode())
    assert sitehome.ATLAS not in files


def test_the_analysts_own_home_is_never_written_over(client, fake):
    fake.make_repo()
    _connect(client)
    _edit(fake, "index.html", b"<!doctype html><p>mine, with no marker</p>")
    client.post("/api/publishing/github/site")
    assert fake.files()["index.html"] == b"<!doctype html><p>mine, with no marker</p>"
    assert sitehome.STYLE not in fake.files()
