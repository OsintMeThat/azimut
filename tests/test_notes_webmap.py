"""A web map: a note laid out as a map page (`look.web = "map"`, `engine/notes_html.py`), its
layers drawn and carded as the app's own map draws them (`engine/notes_maps.py`), its view
counter, and its row on the Notebook's home."""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from azimut.engine import maplayers, notefill, notelook, notes_html, notes_maps, notes_web
from azimut.engine.notelook import NoteLook

from test_notes_maps import _case, _fixture_map, _markers, _note_with, _tracked_line
from test_notes_pdf_golden import CREATED, golden_case

TEXT = """The front line and the armour left on the road, 15 and 16 November.

::: map
title: The road
layer: Front
ground: e_ground1
:::

Each marker is one vehicle, numbered as in the register.
"""
MAP_PAGE = NoteLook.model_validate({"style": "article", "web": "map"})


def _page(tmp_path: Path, monkeypatch, *, text: str = TEXT, look: NoteLook = MAP_PAGE, folder: bool = False,
          identity: notefill.Identity | None = None) -> tuple[str, notes_html.RenderedHtml, notes_html.Folder | None]:
    monkeypatch.setattr(notes_maps, "derive", lambda *_, **__: _fixture_map())
    made = notes_html.Folder(csp=notes_web.folder_csp()) if folder else None
    rendered = notes_html.render(golden_case(tmp_path), title="Armour on the road", text=text, look=look, public=True,
                                 created=CREATED, identity=identity or notefill.Identity(), folder=made)
    return rendered.html.decode("utf-8"), rendered, made


# -- the look --------------------------------------------------------------------------------


def test_a_look_lays_a_page_out_as_a_map_page_and_keeps_a_counter_code_only_once_set():
    look = NoteLook.model_validate({"web": "map", "counter": "  My-Desk "})
    assert (look.web, look.counter) == ("map", "my-desk")
    assert "counter" not in NoteLook.model_validate({"web": "map"}).model_dump(mode="json")
    for wrong in ("my desk", "-desk", "desk.goatcounter.com", "x" * 51):
        with pytest.raises(ValidationError):
            NoteLook.model_validate({"counter": wrong})
    # a look written later, holding a code this build cannot read, keeps the rest
    assert notelook.parse({"web": "map", "counter": "not a code!"}) == NoteLook(web="map")


# -- the page -------------------------------------------------------------------------------


def test_a_map_page_is_its_title_subtitle_and_first_map_with_the_other_words_beside(tmp_path, monkeypatch):
    page, rendered, _ = _page(tmp_path, monkeypatch)
    assert 'data-web="map"' in page and not rendered.warnings
    head = re.search(r'<header class="az-mappage-head".*?</header>', page, re.S).group(0)
    assert '<h1 class="az-title" dir="auto">Armour on the road</h1>' in head
    # the note's first paragraph is the subtitle, said once
    assert '<p class="az-mappage-sub" dir="auto">The front line and the armour left on the road, 15 and 16 November.</p>' in head
    assert page.count("The front line and the armour left") == 1
    main = re.search(r'<main class="az-mappage-main" id="main">(.*?)</main>', page, re.S).group(1)
    assert main.strip().startswith('<figure class="az-figure az-map') and main.count("<figure") == 1
    about = page[page.index('<section class="az-mappage-about"'):]
    assert "Each marker is one vehicle" in about and 'class="az-footer"' in about
    # no cover, no contents: the map is the page
    assert 'class="az-cover"' not in page and 'class="az-contents' not in page
    # the legend says what each row stands for, which the page's switcher reads
    assert '<li data-layer="Vehicles" data-group="Destroyed" data-kind="point" data-key="Destroyed">' in page
    # its own sheet and script, which no other page carries
    assert ".az-mappage-panel" in page and "function mapPage()" in page


def test_the_page_pane_s_copy_of_a_map_page_is_a_map_page_too(tmp_path, monkeypatch):
    """The Page pane's copy writes each element's line for a double-click (`data-line`): a
    map page read there is still its map, its subtitle and the words beside it."""
    monkeypatch.setattr(notes_maps, "derive", lambda *_, **__: _fixture_map())
    rendered = notes_html.render(golden_case(tmp_path), title="Armour on the road", text=TEXT, look=MAP_PAGE, public=True,
                                 created=CREATED, identity=notefill.Identity(), light=True)
    page = rendered.html.decode("utf-8")
    assert 'data-web="map"' in page and notes_html.NO_MAP_PAGE not in rendered.warnings
    head = re.search(r'<header class="az-mappage-head".*?</header>', page, re.S).group(0)
    assert "The front line and the armour left on the road" in head
    main = re.search(r'<main class="az-mappage-main" id="main">(.*?)</main>', page, re.S).group(1)
    assert main.strip().startswith('<figure class="az-figure az-map')
    assert re.search(r'<figure class="az-figure az-map[^>]*data-line="\d+">', main)


def test_a_map_page_says_the_looks_subtitle_and_the_analysts_name_linked_to_their_site(tmp_path, monkeypatch):
    look = NoteLook.model_validate({"style": "article", "web": "map", "cover": {"subtitle": "Its own line"}})
    who = notefill.Identity(name="A. Analyst", organisation="Desk", site="https://desk.github.io/maps/")
    page, _, _ = _page(tmp_path, monkeypatch, look=look, identity=who)
    assert '<p class="az-mappage-sub" dir="auto">Its own line</p>' in page
    assert ('<a class="az-mappage-site" href="https://desk.github.io/maps/" target="_blank" rel="noopener noreferrer">'
            'Desk</a>') in page
    # the note's first paragraph is then words like the others
    assert "The front line and the armour left" in page[page.index('<section class="az-mappage-about"'):]
    # with no site set, the name alone
    page, _, _ = _page(tmp_path, monkeypatch, identity=notefill.Identity(name="A. Analyst"))
    assert '<span class="az-mappage-site">A. Analyst</span>' in page


def test_a_map_page_header_carries_the_analysts_logo_with_their_name_and_their_handle(tmp_path, monkeypatch):
    """Settings › Publishing's logo goes before the name, both opening the Website, and the
    proofs' handle follows, opening the X account it names; another platform's stays unlinked."""
    logo = tmp_path / "logo.png"
    Image.new("RGB", (200, 200), (120, 60, 200)).save(logo, "PNG")
    who = notefill.Identity(name="A. Analyst", logo=logo, site="https://desk.example.org/", handle="@desk_maps")
    page, _, _ = _page(tmp_path, monkeypatch, identity=who)
    head = page[page.index('<header class="az-mappage-head"'):page.index("</header>")]
    site = head[head.index('<a class="az-mappage-site" href="https://desk.example.org/"'):]
    assert site.index('class="az-my-logo"') < site.index("A. Analyst</a>")
    assert ('<a class="az-mappage-handle" href="https://x.com/desk_maps" target="_blank" rel="noopener noreferrer">'
            '@desk_maps</a>') in head
    # the same logo and handle on the map itself, for a phone's header and a screenshot
    main = page[page.index('<main class="az-mappage-main"'):page.index("</main>")]
    mark = main[main.index('<a class="az-mappage-mark" href="https://x.com/desk_maps"'):]
    assert main.index('figure class="az-figure az-map') < main.index("az-mappage-mark")
    assert mark.index('class="az-my-logo"') < mark.index("<span>@desk_maps</span></a>")
    other = notefill.Identity(name="A. Analyst", handle="@desk.bsky.social")
    page, _, _ = _page(tmp_path, monkeypatch, identity=other)
    assert '<span class="az-mappage-handle">@desk.bsky.social</span>' in page
    assert 'class="az-my-logo"' not in page[page.index('<header class="az-mappage-head"'):page.index("</header>")]


def test_the_handle_comes_from_the_proofs_setting_and_names_an_x_account_only_when_it_is_one(monkeypatch):
    monkeypatch.setattr(notefill.config, "load_settings", lambda: {"report_name": "A. Analyst",
                                                                   "signature_handle": " @desk_maps "})
    assert notefill.Identity.from_settings().handle == "@desk_maps"
    assert notefill.Identity(handle="desk_maps").handle_url() == "https://x.com/desk_maps"
    assert notefill.Identity(handle="@desk.bsky.social").handle_url() == ""
    assert notefill.Identity().handle_url() == ""


def test_a_map_page_with_no_map_reads_as_an_article_and_says_so(tmp_path, monkeypatch):
    page, rendered, _ = _page(tmp_path, monkeypatch, text="Words, and no map.\n")
    assert 'class="az-mappage' not in page and '<main class="az-body" id="main">' in page
    assert rendered.warnings == [notes_html.NO_MAP_PAGE]
    assert "function mapPage()" not in page


def test_an_article_keeps_the_page_it_had(tmp_path, monkeypatch):
    page, _, _ = _page(tmp_path, monkeypatch, look=NoteLook(style="article", counter="desk"))
    assert 'class="az-mappage' not in page and "function mapPage()" not in page and ".az-mappage-panel" not in page
    assert 'data-key=' not in page and "goatcounter" not in page


def test_the_view_counter_is_the_web_folders_alone_its_one_host_let_in(tmp_path, monkeypatch):
    look = NoteLook.model_validate({"style": "article", "web": "map", "counter": "desk"})
    # one file reaches nothing: no counter, the same policy
    page, _, _ = _page(tmp_path, monkeypatch, look=look)
    assert "goatcounter" not in page and "data-counter" not in page
    assert f'content="{notes_html.CSP}"' in page
    page, _, folder = _page(tmp_path, monkeypatch, look=look, folder=True)
    assert '<span class="az-mappage-views" data-counter="desk" hidden></span>' in page
    policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', page).group(1)
    directives = {part.split()[0]: part.split()[1:] for part in policy.split("; ")}
    assert directives["img-src"] == ["'self'", "https://desk.goatcounter.com"]
    assert directives["connect-src"] == ["https://desk.goatcounter.com"]
    assert directives["default-src"] == ["'none'"] and directives["script-src"] == ["'self'"]
    counter = next(path for path in folder.files if "reader-count" in path)
    assert f'<script src="{counter}"></script>' in page
    assert b"goatcounter.com" in folder.files[counter]
    # with no code, no host and no script
    page, _, folder = _page(tmp_path, monkeypatch, folder=True)
    assert "goatcounter" not in page and not any("reader-count" in path for path in folder.files)


def test_a_policy_is_widened_by_directive_none_giving_way():
    assert notes_html.widen_policy("default-src 'none'; img-src 'self'", {"img-src": ["https://a.b"], "connect-src": ["https://a.b"]}) == \
        "default-src 'none'; img-src 'self' https://a.b; connect-src https://a.b"
    assert notes_html.widen_policy("img-src 'none'", {"img-src": ["https://a.b"]}) == "img-src https://a.b"


# -- the layers, as the app's map draws them -------------------------------------------------


def _vehicle(client, cid, name, **changes) -> str:
    made = client.post(f"/api/cases/{cid}/map-layers/{name}/markers",
                       json={"lat": 12.72, "lon": 43.50, "name": "#9", "colour": "#e53935", "symbol": "badge-tank"}).json()
    key = made["marker"]["properties"]["key"]
    edited = client.patch(f"/api/cases/{cid}/map-layers/{name}/markers/{key}", json=changes)
    assert edited.status_code == 200, edited.text
    return key


def test_a_marker_keeps_its_bearing_provenance_confidence_and_name_size(client):
    cid, case = _case(client)
    name = _markers(client, cid)
    _vehicle(client, cid, name, bearing=95, provenance="external", confidence="probable", label="on", label_size=14,
             date="2026-11-16")
    derived = notes_maps.derive(case, notes_maps.MapBlock(layers=[name]))
    turned = next(one for one in derived.data["features"] if one["label"] == "#9")
    style = turned["style"]
    assert (style["bearing"], style["external"], style["confidence"], style["label_size"]) == (95.0, True, "probable", 14.0)
    assert "tip" not in style, "a badge stands on its middle"
    assert style["icon"].endswith("-x") and derived.icons[style["icon"]]["external"] is True
    svg = notes_maps.svg(derived)
    group = re.search(rf'<g class="az-f az-point[^"]*" data-id="{turned["id"]}".*?</g>', svg).group(0)
    assert f'd="{notes_maps.BEARING_WEDGE}" transform="rotate(95)"' in group
    assert 'opacity="0.8"' in group and 'y="-32"' in group
    # its rim dashed, as a point somebody else geolocated wears it
    assert 'stroke-dasharray="6 4"' in notes_maps.symbol_svg(style["icon"], derived.icons[style["icon"]])


def test_a_plain_marker_stands_on_its_tip(client):
    cid, case = _case(client)
    name = client.post(f"/api/cases/{cid}/map-layers/editable", json={"title": "Pins"}).json()["name"]
    client.post(f"/api/cases/{cid}/map-layers/{name}/markers", json={"lat": 12.7, "lon": 43.5, "name": "Pin", "colour": "#0072b2"})
    derived = notes_maps.derive(case, notes_maps.MapBlock(layers=[name]))
    pin = derived.data["features"][0]
    assert pin["style"]["tip"] is True
    assert f'y="{notes_maps.TIP_TOP:g}"' in notes_maps.svg(derived)


def test_a_card_says_what_the_apps_card_says(client):
    cid, case = _case(client)
    name = _markers(client, cid)
    _vehicle(client, cid, name, description="BATT UMG (identified)\nState: burned\nPosition: approximate, 450 m",
             status="damaged", provenance="external", confidence="claimed", credit="Footage: a channel",
             links=[f"https://x.com/desk/status/{n}" for n in range(4)])
    derived = notes_maps.derive(case, notes_maps.MapBlock(layers=[name]))
    card = next(one for one in derived.data["features"] if one["label"] == "#9")["card"]
    assert card["text"] == "BATT UMG (identified)"
    assert card["rows"] == [{"label": "State", "value": "burned"}, {"label": "Position", "value": "approximate, 450 m"}]
    assert card["facts"] == "Damaged · Geolocated by someone else · Claimed"
    assert card["at"] == [12.72, 43.5]
    assert card["source"]["url"] == "https://x.com/desk/status/0" and len(card["links"]) == 3
    assert card["credit"] == "Footage: a channel"
    # Azimut's own fields stay out of a personal layer's card
    assert not any(row["label"] in ("key", "symbol", "group", "picture_path") for row in card["rows"])
    # a card that shows only its sentence keeps its rows, its words
    trimmed = notes_maps.derive(case, notes_maps.parse_block(f"layer: {name}\ncard: picture")).data["features"]
    assert not any("rows" in one["card"] or "text" in one["card"] for one in trimmed)


def test_a_line_says_its_length_and_a_feature_followed_over_time_its_history(client):
    cid, case = _case(client)
    name = _tracked_line(case)
    derived = notes_maps.derive(case, notes_maps.MapBlock(layers=[name]))
    card = derived.data["features"][0]["card"]
    assert re.fullmatch(r"Length \d+\.\d km", card["size"])
    assert [one["day"] for one in card["history"]] == ["6 October 2026 to 13 October 2026",
                                                       "14 October 2026 to 14 November 2026"]


def test_a_layer_made_elsewhere_shows_its_own_columns_and_a_personal_one_only_its_words():
    properties = {"name": "Strike", "description": "Seen twice", "category": "Strikes", "key": "k", "index": 3,
                  "Gear": "BMP-2", "Source type": "Video", "pass_date": "2026-01-03", "picture_path": "media/a.png"}
    card = notes_maps._layer_card(properties, "Strikes", "", "", columns=True)
    assert card["rows"] == [{"label": "Gear", "value": "BMP-2"}, {"label": "Source type", "value": "Video"},
                            {"label": "pass_date", "value": "2026-01-03"}]
    assert "rows" not in notes_maps._layer_card(properties, "Strikes", "", "")


def _icon_png(size=(40, 60)) -> bytes:
    picture = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    picture.paste(Image.new("RGBA", size, (20, 120, 200, 255)), (10, 5))
    buffer = io.BytesIO()
    picture.save(buffer, "PNG")
    return buffer.getvalue()


def test_an_own_icon_is_drawn_as_it_is_or_inked_in_a_disc(monkeypatch):
    monkeypatch.setattr(maplayers, "icon", lambda *_: _icon_png())
    icons = notes_maps._Icons(case=None)  # type: ignore[arg-type]
    plain = icons.layer_icon("Layer", "k1", {"colour": "#e53935"})
    disc = icons.layer_icon("Layer", "k1", {"colour": "#e53935", "icon_mode": "disc"}, status="destroyed", external=True)
    assert plain != disc and icons.used[plain]["size"] == [96, 96]
    # as it is: its whole picture at the share the map draws it at, past the marker's square
    drawn = notes_maps.symbol_svg(plain, icons.used[plain])
    assert 'overflow="visible" data-side="68"' in drawn and 'width="67.2" height="67.2"' in drawn
    # in a disc: cropped to what it paints, inked in the disc's glyph colour, its marks over it
    look = icons.used[disc]
    assert look["size"] == [40, 60] and look["mode"] == "disc"
    with Image.open(io.BytesIO(look["png"])) as cropped:
        assert cropped.size == (40, 60)
    drawn = notes_maps.symbol_svg(disc, look)
    assert 'data-ink="#ffffff"' in drawn and 'feComposite in2="SourceAlpha" operator="in"' in drawn
    assert 'stroke-dasharray="6 4"' in drawn and drawn.count('stroke="#fff" stroke-width="4.2"') == 2


# -- the Notebook's home --------------------------------------------------------------------


def test_a_web_maps_row_shows_its_grounds_picture_and_where_it_was_published(client):
    cid, case = _case(client)
    picture = io.BytesIO()
    Image.new("RGB", (32, 20), (90, 110, 80)).save(picture, "PNG")
    where = case.resolve_inside("media/ground.png")
    where.parent.mkdir(parents=True, exist_ok=True)
    where.write_bytes(picture.getvalue())
    ground = case.add_entity("capture", "Ground", {"path": "media/ground.png", "kind": "image"}, by="test")["id"]
    note = _note_with(client, cid, f"::: map\nlayer: Nothing\nground: {ground}\n:::\n", title="Road map")
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "article", "web": "map"})
    _note_with(client, cid, "Words.", title="Plain")
    rows = {row["title"]: row for row in client.get(f"/api/cases/{cid}/notes/index").json()["items"]}
    assert "map" not in rows["Plain"]
    assert rows["Road map"]["map"] == {"picture": "media/ground.png", "address": ""}
    published = {"at": "2026-11-20T10:00:00Z", "edition": "public", "format": "github", "file": "road-map",
                 "address": "https://desk.github.io/maps/road-map/", "repository": "desk/maps", "branch": "main",
                 "path": "road-map", "commit": "a" * 40, "sha256": "b" * 64, "text_sha256": "c" * 64}
    case.update_entity(note["id"], {"attrs": {"editions": [published]}})
    row = next(one for one in client.get(f"/api/cases/{cid}/notes/index").json()["items"] if one["title"] == "Road map")
    assert row["map"]["address"] == "https://desk.github.io/maps/road-map/"


def test_the_header_links_the_name_only_to_the_site_set_in_settings(client):
    """The web map's header links the analyst's name to the Website of Settings › Publishing,
    never to the GitHub Pages site root, which may hold no page; with none set, no link."""
    from azimut import config

    put = client.put("/api/settings/prefs", json={"report_name": "A. Analyst", "report_site": "desk.example.org"})
    assert put.status_code == 200, put.text
    assert client.get("/api/settings").json()["report_site"] == "https://desk.example.org/"
    settings = config.load_settings()
    settings["github_site"] = "https://desk.github.io/"
    config.save_settings(settings)
    assert notefill.Identity.from_settings().site == "https://desk.example.org/"
    assert client.put("/api/settings/prefs", json={"report_site": ""}).status_code == 200
    assert notefill.Identity.from_settings().site == ""
    refused = client.put("/api/settings/prefs", json={"report_site": "http://desk.example.org"})
    assert refused.status_code == 422 and "website" in refused.json()["detail"].lower()
