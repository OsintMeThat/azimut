"""The Notebook's web folder (`engine/notes_web.py`, `POST /notes/web`): the HTML report
laid out as a folder to put online, the link card X shows, the steps to publish it,
and the rules a published page keeps.

The folder is built once from the ambush register (`ambushfixture.py`), with and without
the address it will live at, and read back the way a browser and a crawler would.
"""

from __future__ import annotations

import ast
import hashlib
import io
import os
import re
from datetime import datetime
from pathlib import Path

import pytest
from PIL import Image

from azimut import config
from azimut.api import notes as notes_api
from azimut.engine import notefill, notelook, notes_html, notes_markdown, notes_web
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from ambushfixture import CLIP_SECRET, DIAGRAM, DIAGRAM_SVG, PNG_SECRET, ambush_case, ambush_note
from test_notes_html import parse
from test_notes_html_api import ambush  # noqa: F401  (the fixture, for the routes)
from test_notes_pdf import exports_of

TITLE = "Ambush on the Wadi Sahm road"
ADDRESS = "https://desk.github.io/articles/wadi-sahm/"
LOOK = NoteLook.model_validate({
    "style": "report", "toc": True, "numbered": True, "web": "story",
    "cover": {"on": True, "subtitle": "What open sources show", "date": "2025-10-28"},
})
NOW = datetime(2025, 10, 28, 12, 0).astimezone()
JS_SETUP = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "githubPagesSetup.js"


@pytest.fixture(scope="module")
def folder(tmp_path_factory):
    """The register as a filed note, its web folder built with and without an address."""
    home = tmp_path_factory.mktemp("web-folder")
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("AZIMUT_HOME", str(home))
        patch.setattr(config, "_pointer_dir", lambda: home / ".pointer")
        patch.setattr(config, "DEFAULT_ROOT", home)
        patch.setattr(notefill.Identity, "from_settings", classmethod(lambda cls: notefill.Identity()))
        config.forget_workspace_root()
        case = Case.create("Wadi Sahm ambush")
        made = ambush_case(case)
        text = ambush_note(made)
        note = case.create_note(TITLE, "", content=text)["id"]
        notelook.save(case, note, LOOK)
        diagrams = {notes_markdown.diagram_key(DIAGRAM): DIAGRAM_SVG}
        addressed = notes_web.build(case, note, base_url=ADDRESS, diagrams=diagrams, now=NOW)
        bare = notes_web.build(case, note, diagrams=diagrams, now=NOW)
        single = notes_html.render(case, title=TITLE, text=text, look=LOOK, note_id=note, public=True,
                                   diagrams=diagrams, created=NOW, resolve=notes_markdown.case_resolver(case))
        yield {"case": case, "note": note, "made": made, "addressed": addressed, "bare": bare, "single": single,
               "home": home}
        config.forget_workspace_root()


def _metas(document: bytes) -> dict[str, str]:
    page = parse(document)
    said = {}
    for meta in page.find("meta"):
        key = meta.attrs.get("property") or meta.attrs.get("name") or meta.attrs.get("http-equiv")
        if key:
            said[key] = meta.attrs.get("content", "")
    for link in page.find("link"):
        said[f"link:{link.attrs.get('rel')}"] = link.attrs.get("href", "")
    return said


# -- the folder ------------------------------------------------------------------------


def test_the_folder_holds_its_page_its_files_its_card_and_its_how_to(folder):
    built = folder["addressed"]
    files = built.files
    assert built.index == "index.html" and built.name == "wadi-sahm" and built.address == ADDRESS
    assert {"index.html", "share.jpg", ".nojekyll", "HOW-TO-PUBLISH.md"} <= set(files)
    assert files[".nojekyll"] == b""
    assets = [path for path in files if path.startswith("assets/")]
    assert len(assets) > 10 and set(files) - set(assets) == {"index.html", "share.jpg", ".nojekyll", "HOW-TO-PUBLISH.md"}
    for path in assets:
        # named by what it holds, so a picture shown twice is one file and a new one a new name
        match = re.fullmatch(r"assets/([0-9a-f]{8,16})-([a-z0-9-]+)\.(jpg|png|gif|svg|mp4|webm|woff|css|js)", path)
        assert match, path
        assert hashlib.sha256(files[path]).hexdigest().startswith(match.group(1))
    assert {path.rsplit(".", 1)[1] for path in assets} >= {"jpg", "png", "woff", "css", "js"}
    assert built.sha256 == hashlib.sha256(files["index.html"]).hexdigest()
    assert built.weight >= sum(len(data) for data in files.values()) - len(files["HOW-TO-PUBLISH.md"]) - 4096


def test_every_file_the_page_names_is_in_the_folder_and_every_file_is_named(folder):
    files = folder["addressed"].files
    page = parse(files["index.html"])
    named = set()
    for node in page.walk():
        for attr in ("src", "poster", "href"):
            value = node.attrs.get(attr, "")
            if value.startswith("assets/"):
                named.add(value)
    css_path = next(path for path in files if path.endswith("-reader.css"))
    css = files[css_path].decode("utf-8")
    fonts = "\n".join(node.text for node in page.find("style"))
    named |= {f"assets/{found}" for found in re.findall(r"url\(\"?([0-9a-f]{8,16}-[\w-]+\.\w+)", css)}
    named |= set(re.findall(r"url\((assets/[^)]+)\)", fonts))
    assert named <= set(files)
    assert named == {path for path in files if path.startswith("assets/")}


def test_it_is_the_html_report_itself_its_files_named_in_place_of_data_addresses(folder):
    """The same renderer, not a copy of it: the body is the single file's, word for word,
    once each picture's address is set aside."""

    def body(document: bytes) -> str:
        text = document.decode("utf-8")
        inner = text[text.index("<body>"): text.rindex("<script")]
        return re.sub(r'(src|poster)="[^"]*"', r'\1=""', inner)

    built = folder["addressed"].files["index.html"]
    assert body(built) == body(folder["single"].html)
    page = parse(built)
    assert page.one("html").attrs["data-web"] == "story" and page.one("html").attrs["data-edition"] == "public"
    assert page.one("section", "az-story") and page.one("figure", data_kind="pair")


def test_the_head_says_what_a_link_card_reads_with_the_address(folder):
    said = _metas(folder["addressed"].files["index.html"])
    assert said["description"] == "What open sources show"
    assert said["link:canonical"] == ADDRESS
    assert said["og:type"] == "article" and said["og:title"] == TITLE
    assert said["og:url"] == ADDRESS and said["og:image"] == f"{ADDRESS}share.jpg"
    assert said["og:image:width"] == "1200" and said["og:image:height"] == "630"
    assert said["twitter:card"] == "summary_large_image" and said["twitter:image"] == f"{ADDRESS}share.jpg"
    assert said["twitter:title"] == TITLE and said["og:description"] == "What open sources show"


def test_without_an_address_the_card_is_relative_and_nothing_claims_a_place(folder):
    built = folder["bare"]
    said = _metas(built.files["index.html"])
    assert "link:canonical" not in said and "og:url" not in said
    assert said["og:image"] == "share.jpg" and said["twitter:image"] == "share.jpg"
    assert said["twitter:card"] == "summary_large_image"
    assert built.name == "ambush-on-the-wadi-sahm-road-2025-10-28" and built.address == ""
    # the export says nothing of it; the check before it does
    assert notes_web.NO_ADDRESS not in built.warnings


def test_the_description_is_the_first_paragraph_when_the_cover_has_no_subtitle(folder, monkeypatch):
    case, note = folder["case"], folder["note"]
    notelook.save(case, note, NoteLook.model_validate({"style": "report"}))
    try:
        built = notes_web.build(case, note, check=True, now=NOW)
    finally:
        notelook.save(case, note, LOOK)
    description = _metas(built.files["index.html"])["description"]
    assert description.startswith("At least 60 vehicles were in the column when it was hit")
    assert len(description) <= notes_html.DESCRIPTION_CHARS and description.endswith("…")
    assert "[" not in description and "\x00" not in description


def test_the_policy_lets_the_page_load_its_own_files_and_nothing_else(folder):
    document = folder["addressed"].files["index.html"]
    policy = _metas(document)["Content-Security-Policy"]
    assert policy == notes_web.folder_csp()
    rules = dict(rule.split(" ", 1) for rule in policy.split("; "))
    assert rules["default-src"] == "'none'"
    for name in ("img-src", "media-src", "font-src"):
        assert rules[name] == "'self'"
    assert rules["script-src"] == "'self'" and "unsafe-inline" not in rules["script-src"]
    assert rules["base-uri"] == "'none'" and rules["form-action"] == "'none'"
    assert "http" not in policy and "data:" not in policy
    page = parse(document)
    scripts = page.find("script")
    assert len(scripts) == 1 and scripts[0].attrs["src"].startswith("assets/") and not scripts[0].text.strip()
    # a live map's tile hosts are added in one place, to the directive that needs them
    wider = notes_web.folder_csp({"img-src": ["https://tiles.example.org"], "connect-src": ["https://tiles.example.org"]})
    assert "img-src 'self' https://tiles.example.org" in wider and "connect-src https://tiles.example.org" in wider


# -- what a published folder never holds -------------------------------------------------


def test_no_media_is_a_data_address_anywhere_in_the_folder(folder):
    files = folder["addressed"].files
    for path, data in files.items():
        if path.endswith((".html", ".css", ".js", ".md")):
            text = data.decode("utf-8")
            assert not re.search(r"data:(image|video|audio|font)/", text), path
    page = parse(files["index.html"])
    for node in page.walk():
        for attr in ("src", "poster", "href"):
            assert not node.attrs.get(attr, "").startswith("data:"), (node.tag, attr)


def test_no_internal_passage_guidance_or_secret_leaves_in_any_file(folder):
    for built in (folder["addressed"], folder["bare"]):
        for path, data in built.files.items():
            assert b"asked not to be named" not in data and b"Keep their handle out" not in data, path
            assert b"Write the summary first" not in data, path
            assert b"[!internal]" not in data, path
            assert PNG_SECRET.encode() not in data and CLIP_SECRET.encode() not in data, path
            assert str(folder["case"].path).encode() not in data and str(folder["home"]).encode() not in data, path
            assert str(Path.home()).encode() not in data, path


def test_no_picture_keeps_its_exif_or_its_text(folder):
    files = folder["addressed"].files
    jpegs = pngs = 0
    for path, data in files.items():
        if path.endswith(".jpg"):
            jpegs += 1
            with Image.open(io.BytesIO(data)) as picture:
                assert not picture.getexif(), path
            assert b"Exif" not in data[:4096], path
        elif path.endswith(".png"):
            pngs += 1
            with Image.open(io.BytesIO(data)) as picture:
                assert not getattr(picture, "text", {}), path
    assert jpegs > 3 and pngs


@pytest.mark.skipif(not notes_html.ffmpeg_engine.ffmpeg_available(), reason="ffmpeg not installed")
def test_a_clip_is_a_file_of_its_own_without_its_metadata(folder):
    files = folder["addressed"].files
    video = parse(files["index.html"]).one("video", "az-clip")
    assert video.attrs["src"].endswith(".mp4") and video.attrs["poster"].endswith(".jpg")
    assert CLIP_SECRET.encode() not in files[video.attrs["src"]]


def test_a_public_edition_only(folder):
    with pytest.raises(notes_web.NotesWebError):
        notes_web.build(folder["case"], folder["note"], edition="internal")
    with pytest.raises(notes_web.NotesWebError):
        notes_web.build(folder["case"], "nosuchnote")


# -- the card --------------------------------------------------------------------------


def test_the_card_is_a_1200_by_630_jpeg_with_no_metadata(folder):
    data = folder["addressed"].files["share.jpg"]
    with Image.open(io.BytesIO(data)) as card:
        assert card.format == "JPEG" and card.size == (1200, 630) and card.mode == "RGB"
        assert not card.getexif()
    assert len(data) < 600_000


def test_the_card_opens_on_the_cover_picture_else_the_first_credited_one(folder, tmp_path):
    case, made = folder["case"], folder["made"]
    text = ambush_note(made)
    plain = notes_html.render(case, title=TITLE, text=text, look=NoteLook(), public=True, check=True)
    # the first picture that came from somewhere, as the story layout opens on it
    assert plain.hero is not None and plain.hero.path.name
    capture = case.resolve_inside(made["capture"]["path"])
    covered = notes_html.render(case, title=TITLE, text=text, public=True, check=True, look=NoteLook.model_validate(
        {"style": "report", "cover": {"on": True, "image": made["capture"]["id"]}}))
    assert covered.hero is not None and covered.hero.path == capture
    assert covered.hero.credit.startswith("Imagery: Esri World Imagery")
    # never a graphic picture
    assert all("graphic" not in str(hero.path) for hero in (plain.hero, covered.hero))


def test_with_no_picture_the_card_is_the_title_on_the_paper(tmp_path):
    card = notes_web.share_card(title="A note with no picture at all", day=NOW.date(), look=None, hero=None,
                                description="What the note is about, in a sentence.")
    with Image.open(io.BytesIO(card)) as image:
        assert image.size == (1200, 630)
        # the paper is white and the accent band runs along its top
        assert image.getpixel((600, 600)) == pytest.approx((255, 255, 255), abs=3)
        assert image.getpixel((600, 4)) != image.getpixel((600, 600))
    # a title too long for three lines still fits, cut with an ellipsis
    long = notes_web.share_card(title="word " * 80, day=NOW.date(), look=None, hero=None)
    with Image.open(io.BytesIO(long)) as image:
        assert image.size == (1200, 630)


# -- writing it ----------------------------------------------------------------------------


def test_the_folder_is_swapped_in_whole_and_replaces_the_one_before(folder, tmp_path):
    target = tmp_path / "web" / "wadi-sahm"
    notes_web.write(folder["addressed"], target)
    assert (target / "index.html").read_bytes() == folder["addressed"].files["index.html"]
    assert (target / ".nojekyll").exists() and (target / "assets").is_dir()
    (target / "assets" / "stale-from-before.jpg").write_bytes(b"old")
    notes_web.write(folder["bare"], target)
    assert not (target / "assets" / "stale-from-before.jpg").exists()
    assert (target / "index.html").read_bytes() == folder["bare"].files["index.html"]
    # nothing is left beside it: no staging folder, no folder moved aside
    assert [path.name for path in target.parent.iterdir()] == ["wadi-sahm"]
    if os.name == "posix":
        # readable as any folder to publish, not private as a temporary one is made
        assert target.stat().st_mode & 0o777 == 0o755


def test_a_folder_that_cannot_be_written_whole_is_not_written_at_all(folder, tmp_path):
    target = tmp_path / "web" / "wadi-sahm"
    notes_web.write(folder["addressed"], target)
    broken = notes_web.WebBuild(files={"index.html": b"new", "../outside.txt": b"x"}, name="wadi-sahm", title=TITLE)
    with pytest.raises(notes_web.NotesWebError):
        notes_web.write(broken, target)
    assert (target / "index.html").read_bytes() == folder["addressed"].files["index.html"]
    assert not (tmp_path / "web" / "outside.txt").exists() and not (tmp_path / "outside.txt").exists()
    assert [path.name for path in target.parent.iterdir()] == ["wadi-sahm"]


# -- the address -------------------------------------------------------------------------


def test_an_address_is_https_and_nothing_but_an_address():
    assert notes_web.address("") == "" and notes_web.address(None) == ""
    assert notes_web.address(" https://Desk.GitHub.io/articles/wadi-sahm ") == "https://desk.github.io/articles/wadi-sahm/"
    assert notes_web.address("https://desk.github.io") == "https://desk.github.io/"
    for wrong in ("http://desk.github.io/a/", "ftp://desk.github.io/", "desk.github.io/a/", "https://me:pw@desk.github.io/",
                  "https://me@desk.github.io/", "https://localhost/a/", "https://desk.github.io/a/?x=1",
                  "https://desk.github.io/a/#top", "https://desk.github.io/a b/", 'https://desk.github.io/"><script>',
                  "javascript:alert(1)", "https://" + "a" * 300 + ".io/", "https://desk.github.io:99999/"):
        with pytest.raises(notes_web.NotesWebError):
            notes_web.address(wrong)


def test_the_folder_is_named_after_its_address_else_its_note_and_day():
    day = NOW.date()
    assert notes_web.folder_name("Ambush", day, "https://desk.github.io/articles/wadi-sahm/") == "wadi-sahm"
    assert notes_web.folder_name("Ambush", day, "https://desk.github.io/") == "ambush-2025-10-28"
    assert notes_web.folder_name("L'attaque à Ḥajjah", day) == "l-attaque-a-hajjah-2025-10-28"
    assert notes_web.folder_name("", day) == "note-2025-10-28"
    marked = notes_web.folder_name("Ambush", day, note_id="n1")
    assert re.fullmatch(r"ambush-[0-9a-f]{8}-2025-10-28", marked)


# -- how to publish -----------------------------------------------------------------------


def _js_constants(source: str) -> dict[str, object]:
    found: dict[str, object] = {}
    pattern = r"export const (PAGES_\w+) = (?:Object\.freeze\((\[.*?\])\)|('(?:[^'\\]|\\.)*'));"
    for match in re.finditer(pattern, source, re.S):
        found[match.group(1)] = ast.literal_eval(match.group(2) or match.group(3))
    return found


def test_the_app_and_the_folder_say_the_same_steps():
    said = _js_constants(JS_SETUP.read_text(encoding="utf-8"))
    assert said["PAGES_INTRO"] == notes_web.PAGES_INTRO
    assert said["PAGES_PUBLIC"] == notes_web.PAGES_PUBLIC
    assert said["PAGES_STEPS"] == list(notes_web.PAGES_STEPS)
    assert said["PAGES_UPDATE"] == notes_web.PAGES_UPDATE
    assert said["PAGES_CARD"] == notes_web.PAGES_CARD


def test_the_how_to_is_markdown_github_pages_reads_as_it_is(folder):
    text = folder["addressed"].files["HOW-TO-PUBLISH.md"].decode("utf-8")
    assert text.startswith("# Publish this folder on GitHub Pages\n")
    assert f"`{ADDRESS}`" in text and "`wadi-sahm`" in text
    for number, step in enumerate(notes_web.PAGES_STEPS, 1):
        assert f"\n{number}. " in text
    assert "Settings › Pages" in text and "free" in text and "public" in text
    # nothing a Pages build would read as a template, and no address a page could take for markup
    assert "{{" not in text and "{%" not in text and "<" not in text
    bare = folder["bare"].files["HOW-TO-PUBLISH.md"].decode("utf-8")
    assert "exported with no address" in bare


# -- the routes ----------------------------------------------------------------------------


def test_the_route_writes_the_folder_and_keeps_its_record(client, ambush):  # noqa: F811
    cid, note = ambush["cid"], ambush["note"]
    answer = client.post(f"/api/cases/{cid}/notes/web", json={"notes": [note], "base_url": ADDRESS,
                                                               "changes": " First public edition. "})
    assert answer.status_code == 200, answer.text
    said = answer.json()
    written = said["written"][0]
    assert written["file"] == "wadi-sahm" and written["edition"] == "public" and written["address"] == ADDRESS
    assert said["path"].endswith(str(Path("exports") / "web"))
    target = exports_of(cid) / "web" / "wadi-sahm"
    index = (target / "index.html").read_bytes()
    assert (target / "share.jpg").is_file() and (target / ".nojekyll").is_file() and (target / "HOW-TO-PUBLISH.md").is_file()
    assert _metas(index)["og:image"] == f"{ADDRESS}share.jpg"
    record = client.get(f"/api/cases/{cid}/notes/{note}/editions").json()["editions"][0]
    assert record["format"] == "web" and record["file"] == "wadi-sahm" and record["folder"] == "exports"
    assert record["sha256"] == hashlib.sha256(index).hexdigest() and record["address"] == ADDRESS
    assert record["changes"] == "First public edition." and record["edition"] == "public"
    ref = {"at": record["at"], "file": record["file"], "folder": record["folder"]}
    check = f"/api/cases/{cid}/notes/{note}/editions/check"
    assert client.post(check, json=ref).json() == {"state": "unchanged"}
    (target / "index.html").write_bytes(index + b"<!-- edited -->")
    assert client.post(check, json=ref).json() == {"state": "changed"}
    # a second export replaces the folder, and lists the first among its corrections as a web page
    again = client.post(f"/api/cases/{cid}/notes/web", json={"notes": [note], "base_url": ADDRESS})
    assert again.status_code == 200, again.text
    corrections = parse((target / "index.html").read_bytes()).one("section", "az-corrections").words()
    assert "Web page" in corrections and "First public edition." in corrections
    assert sorted(path.name for path in (exports_of(cid) / "web").iterdir()) == ["wadi-sahm"]


def test_the_route_shows_the_folder_itself(client, ambush, monkeypatch):  # noqa: F811
    cid, note = ambush["cid"], ambush["note"]
    shown = []
    monkeypatch.setattr(notes_api.reveal_engine, "reveal", lambda path, workspace_only=True: shown.append(path))
    written = client.post(f"/api/cases/{cid}/notes/web", json={"notes": [note]}).json()["written"][0]
    ref = {"at": written["at"], "file": written["file"], "folder": written["folder"]}
    assert client.post(f"/api/cases/{cid}/notes/{note}/editions/reveal", json=ref).status_code == 200
    assert shown == [exports_of(cid) / "web" / written["file"]]


def test_the_route_checks_the_address_at_its_edge(client, ambush):  # noqa: F811
    cid, note = ambush["cid"], ambush["note"]
    route = f"/api/cases/{cid}/notes/web"
    for wrong in ("http://desk.github.io/a/", "https://me:pw@desk.github.io/a/", "https://desk.github.io/a/?x=1"):
        answer = client.post(route, json={"notes": [note], "base_url": wrong})
        assert answer.status_code == 422, wrong
    assert client.post(route, json={"notes": [note], "base_url": "https://a.io/" + "a" * 300}).status_code == 422
    assert client.post(route, json={"notes": [note], "edition": "internal"}).status_code == 422
    assert client.post(route, json={"notes": [note, "case"], "base_url": ADDRESS}).status_code == 422
    assert client.post(route, json={"notes": [note], "diagrams": {"bad key!": "<svg/>"}}).status_code == 422
    assert not (exports_of(cid) / "web").exists()


def test_the_check_weighs_the_folder_and_says_when_it_has_no_address(client, ambush):  # noqa: F811
    cid, note = ambush["cid"], ambush["note"]
    route = f"/api/cases/{cid}/notes/pdf/check"
    bare = client.post(route, json={"notes": [note], "format": "web", "edition": "internal"}).json()["notes"][0]
    kinds = [warning["kind"] for warning in bare["warnings"]]
    assert "address" in kinds and "internal" in kinds and "count" in kinds
    said = next(warning for warning in bare["warnings"] if warning["kind"] == "address")
    assert said == {"text": notes_web.NO_ADDRESS, "line": None, "kind": "address"}
    assert bare["weight"] > 100_000 and bare["internal"] == 1
    addressed = client.post(route, json={"notes": [note], "format": "web", "base_url": ADDRESS}).json()["notes"][0]
    assert all(warning["kind"] != "address" for warning in addressed["warnings"])
    assert client.post(route, json={"notes": [note], "format": "web", "base_url": "http://x.io/"}).status_code == 422
    assert not exports_of(cid).exists() or not (exports_of(cid) / "web").exists()


def test_a_web_record_that_is_not_what_an_export_writes_is_dropped():
    good = {"at": "2026-03-12T10:00:00Z", "edition": "public", "file": "wadi-sahm", "folder": "exports",
            "format": "web", "sha256": "a" * 64, "text_sha256": "b" * 64, "address": ADDRESS}
    assert notes_api._edition_record(good) == good
    # an address that is not one is left out of the record, never shown
    assert "address" not in notes_api._edition_record({**good, "address": "javascript:alert(1)"})
    for broken in ({**good, "sha256": "nope"}, {**good, "file": "../up"}, {**good, "file": "a/b"}):
        assert notes_api._edition_record(broken) is None
