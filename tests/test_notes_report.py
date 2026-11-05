"""The Report Builder: a note's look, its chapters, its guidance, and the page preview.

A look says how a note prints (`engine/notelook.py`) and is kept beside the note,
never in its Markdown. The styles that use it are drawn in `engine/notes_style.py`
and walked in `engine/notes_pdf.py`; the plain document they leave alone is held
by `test_notes_pdf_golden.py`.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError
from pypdf import PdfReader

from azimut import layout
from azimut.api import notes as notes_api
from azimut.engine import notelinks, notelook, notes_pdf, notes_style, notetext
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from test_notes_pdf import FakeCase, png, png_bytes

# -- helpers -----------------------------------------------------------------


def pdf_pages(data: bytes) -> list[str]:
    return [page.extract_text() for page in PdfReader(BytesIO(data)).pages]


def squash(text: str) -> str:
    """Text without its spaces: letter-spaced capitals read back with gaps in them."""
    return re.sub(r"\s+", "", text)


def look(**values) -> NoteLook:
    return NoteLook.model_validate(values)


def render(text, case=None, title="Rooftop", resolve=None, note_id="", **values):
    return notes_pdf.render(
        case, title=title, text=text, look=look(**values), resolve=resolve, note_id=note_id
    )


def make_case(client, name="Report case"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def make_note(client, cid, title="Rooftop", content="Body.\n", folder=""):
    response = client.post(
        f"/api/cases/{cid}/notes", json={"title": title, "content": content, "folder": folder}
    )
    assert response.status_code == 200, response.text
    return response.json()


def upload_picture(client, cid, name="cover.png", size=(320, 180)):
    buffer = io.BytesIO()
    Image.new("RGB", size, (40, 90, 140)).save(buffer, "PNG")
    response = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(buffer.getvalue()), "image/png")},
    )
    assert response.status_code == 200, response.text
    path = response.json()["item"]["path"]
    entity = client.get(
        f"/api/cases/{cid}/entities/lookup", params={"attr": "path", "value": path}
    ).json()["entity"]
    return entity["id"]


def tree(path: Path) -> dict[str, tuple[int, int]]:
    """Every file under a case, with its size and modification time."""
    return {
        str(file.relative_to(path)): (file.stat().st_size, file.stat().st_mtime_ns)
        for file in path.rglob("*")
        if file.is_file() and "-wal" not in file.name and "-shm" not in file.name
    }


REPORT = """# Rooftop

## Summary

> [!confirmed] The mast matches frame 12.

Body text for the summary.

## Method

1. First step.
2. Second step.

### Shadows

The shadow gives the hour.

![frame](/files/demo/media/frame.png "The frame")

| Source | Status |
|---|---|
| Channel A | Confirmed |

> [!lead] Ask the port.

- [ ] Check the date
- [x] Geolocate
"""

# -- the look itself -----------------------------------------------------------


def test_a_missing_look_is_the_plain_default():
    default = NoteLook()
    assert default.model_dump() == {
        "style": "plain", "page": "a4", "accent": "", "tlp": "",
        "cover": {"on": False, "subtitle": "", "image": "", "date": ""},
        "toc": False, "numbered": False,
    }
    assert default.is_default
    assert look(style="plain", cover={}).is_default
    assert not look(style="report").is_default
    assert look(accent="#AABBCC").accent == "#aabbcc"


@pytest.mark.parametrize(
    "bad",
    [
        {"style": "fancy"},
        {"page": "a3"},
        {"accent": "red"},
        {"accent": "#abc"},
        {"tlp": "white"},
        {"toc": "yes"},
        {"colour": "#000000"},
        {"cover": {"subtitle": "x" * 201}},
        {"cover": {"date": "2026-02-30"}},
        {"cover": {"date": "4 Nov 2026"}},
        {"cover": {"image": "../etc/passwd"}},
        {"cover": {"on": True, "logo": "x"}},
    ],
)
def test_a_look_refuses_what_it_does_not_know(bad):
    with pytest.raises(ValidationError):
        NoteLook.model_validate(bad)


def test_a_stored_look_from_a_later_version_keeps_what_this_one_knows():
    stored = {"style": "report", "toc": True, "watermark": "DRAFT", "cover": {"on": True, "ribbon": 1}}
    parsed = notelook.parse(stored)
    assert parsed is not None and parsed.style == "report" and parsed.toc and parsed.cover.on
    assert notelook.parse("not json") is None
    assert notelook.parse({"style": 12}) is None
    assert notelook.parse(None) is None


def test_a_template_look_holds_no_case_picture_and_no_day():
    assert notelook.TemplateLook.model_validate({"style": "report", "cover": {"on": True}})
    with pytest.raises(ValidationError):
        notelook.TemplateLook.model_validate({"cover": {"image": "abc"}})
    with pytest.raises(ValidationError):
        notelook.TemplateLook.model_validate({"cover": {"date": "2026-11-04"}})


def test_an_accent_recolours_the_style_and_a4_stays_round():
    theme = notes_style.theme_for(look(style="report", accent="#7a1f5c"))
    assert theme.accent == (122, 31, 92)
    assert theme.tint == notes_style.mix((122, 31, 92), notes_style.WHITE, 0.92)
    assert notes_style.theme_for(NoteLook()) is notes_style.PLAIN
    letter = notes_style.theme_for(look(page="letter"))
    assert (letter.page_width, letter.page_height, letter.page_format) == (215.9, 279.4, "Letter")


# -- storage and routes --------------------------------------------------------


def test_a_note_keeps_its_look_beside_its_markdown(client):
    cid = make_case(client)
    note = make_note(client, cid, content="# Rooftop\n\nBody.\n")
    case = Case.open(cid)
    file = case.resolve_inside(note["attrs"]["path"])
    before = file.read_bytes(), file.stat().st_mtime_ns

    assert client.get(f"/api/cases/{cid}/notes/{note['id']}/look").json() == {
        "look": NoteLook().model_dump(mode="json")
    }
    saved = client.put(
        f"/api/cases/{cid}/notes/{note['id']}/look",
        json={"style": "report", "tlp": "amber", "toc": True},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["look"]["style"] == "report"
    assert saved.json()["look"]["cover"] == {"on": False, "subtitle": "", "image": "", "date": ""}

    entity = Case.open(cid).get_entity(note["id"])
    assert entity["attrs"]["look"]["tlp"] == "amber"
    assert client.get(f"/api/cases/{cid}/notes/{note['id']}/look").json()["look"]["toc"] is True
    # the Markdown is never touched
    assert (file.read_bytes(), file.stat().st_mtime_ns) == before

    # back to the default is stored as nothing at all
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={})
    assert notelook.stored(Case.open(cid), note["id"]) is None


def test_the_case_notes_keep_their_look_in_the_case_settings(client):
    cid = make_case(client)
    client.put(f"/api/cases/{cid}/notes", json={"text": "Running notes.\n"})
    response = client.put(f"/api/cases/{cid}/notes/case/look", json={"style": "journal"})
    assert response.status_code == 200
    stored = json.loads(Case.open(cid).get_setting(notelook.CASE_LOOK))
    assert stored["style"] == "journal"
    assert client.get(f"/api/cases/{cid}/notes/case/look").json()["look"]["style"] == "journal"
    assert Case.open(cid).read_notes() == "Running notes.\n"
    client.put(f"/api/cases/{cid}/notes/case/look", json={"style": "plain"})
    assert Case.open(cid).get_setting(notelook.CASE_LOOK) is None


def test_the_look_routes_refuse_what_they_cannot_trust(client):
    cid = make_case(client)
    note = make_note(client, cid)
    route = f"/api/cases/{cid}/notes/{note['id']}/look"
    assert client.get(f"/api/cases/{cid}/notes/nope/look").status_code == 404
    assert client.put(f"/api/cases/{cid}/notes/nope/look", json={}).status_code == 404
    assert client.put(route, json={"style": "report", "extra": 1}).status_code == 422
    assert client.put(route, json={"cover": {"image": "missing"}}).status_code == 422
    assert client.put(route, json={"accent": "#12345"}).status_code == 422


def test_a_cover_picture_is_a_picture_the_note_shows(client):
    cid = make_case(client)
    note = make_note(client, cid)
    picture = upload_picture(client, cid)
    route = f"/api/cases/{cid}/notes/{note['id']}/look"
    assert client.put(route, json={"style": "report", "cover": {"on": True, "image": picture}}).status_code == 200

    def derived():
        return {
            link["to"] for link in Case.open(cid).links_of(note["id"])
            if link["type"] == "derived-from" and link["from"] == note["id"]
        }

    assert derived() == {picture}
    # saving the text keeps the cover's edge, since the look still shows it
    client.put(f"/api/cases/{cid}/notes/{note['id']}", json={"text": "New body.\n"})
    assert derived() == {picture}
    client.put(route, json={"style": "report"})
    assert derived() == set()


def test_the_index_says_how_each_note_prints_and_what_it_includes(client):
    cid = make_case(client)
    chapter = make_note(client, cid, title="Chapter")
    report = make_note(
        client, cid, title="Report",
        content=f"Intro.\n\n[[include:{chapter['id']}]]\n\n[[include:case]]\n",
    )
    client.put(f"/api/cases/{cid}/notes/{report['id']}/look", json={"style": "report", "toc": True})
    rows = {row["id"]: row for row in client.get(f"/api/cases/{cid}/notes/index").json()["items"]}
    assert rows["case"]["look"] is None and rows["case"]["includes"] == 0
    assert rows[chapter["id"]]["look"] is None
    assert rows[report["id"]]["look"]["style"] == "report"
    assert rows[report["id"]]["includes"] == 2
    assert "include" not in rows[report["id"]]["excerpt"]
    assert rows[report["id"]]["excerpt"] == "Intro."


def test_reading_notes_and_looks_writes_nothing(client):
    """Opening is reading: the index, a look and a preview leave the case as it was."""
    cid = make_case(client)
    note = make_note(client, cid, content="# Rooftop\n\nBody.\n")
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report"})
    client.get(f"/api/cases/{cid}/notes/index")  # the first read may restate old mentions
    case = Case.open(cid)
    before = tree(case.path)
    client.get(f"/api/cases/{cid}/notes/index")
    client.get(f"/api/cases/{cid}/notes/{note['id']}/look")
    client.get(f"/api/cases/{cid}/notes/case/look")
    response = client.post(
        f"/api/cases/{cid}/notes/preview", json={"note": note["id"], "text": "Unsaved words.\n"}
    )
    assert response.status_code == 200
    assert tree(case.path) == before
    assert not list(layout.subdir(case.path, "exports").glob("*.pdf"))


# -- the preview ---------------------------------------------------------------


def test_the_preview_is_the_pdf_of_the_unsaved_text(client):
    cid = make_case(client)
    note = make_note(client, cid, content="Saved words.\n")
    response = client.post(
        f"/api/cases/{cid}/notes/preview",
        json={"note": note["id"], "text": "# Rooftop\n\nUnsaved words.\n\n![x](https://example.org/x.png)\n"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "no-store"
    text = "\n".join(pdf_pages(response.content))
    assert "Unsaved words." in text and "Saved words." not in text
    pages = json.loads(response.headers["x-note-pages"])
    assert pages == [0]
    warnings = json.loads(response.headers["x-note-warnings"])
    assert any("remote image" in warning for warning in warnings)
    assert json.loads(response.headers["x-note-diagrams"]) == []
    for name in ("x-note-pages", "x-note-warnings", "x-note-diagrams"):
        assert response.headers[name].isascii()


def test_the_preview_asks_for_the_diagrams_it_drew_as_source(client):
    cid = make_case(client)
    chapter = make_note(client, cid, title="Chapter", content="```mermaid\ngraph LR; C-->D;\n```\n")
    text = f"```mermaid\ngraph TD; A-->B;\n```\n\n[[include:{chapter['id']}]]\n"
    first = client.post(f"/api/cases/{cid}/notes/preview", json={"note": "case", "text": text})
    pending = json.loads(first.headers["x-note-diagrams"])
    keys = [notes_pdf.diagram_key("graph TD; A-->B;"), notes_pdf.diagram_key("graph LR; C-->D;")]
    assert [item["key"] for item in pending] == keys
    assert "graph TD" in pending[0]["source"]
    drawn = {key: base64.b64encode(png_bytes()).decode("ascii") for key in keys}
    second = client.post(
        f"/api/cases/{cid}/notes/preview", json={"note": "case", "text": text, "diagrams": drawn}
    )
    assert json.loads(second.headers["x-note-diagrams"]) == []
    assert "Diagram not drawn." not in "\n".join(pdf_pages(second.content))


def test_the_preview_prints_the_look_it_is_given_or_the_stored_one(client):
    cid = make_case(client)
    note = make_note(client, cid)
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report", "tlp": "red"})
    stored = client.post(f"/api/cases/{cid}/notes/preview", json={"note": note["id"], "text": "Body."})
    assert "TLP:RED" in pdf_pages(stored.content)[0]
    tried = client.post(
        f"/api/cases/{cid}/notes/preview",
        json={"note": note["id"], "text": "Body.", "look": {"style": "brief", "tlp": "green"}},
    )
    assert "TLP:GREEN" in pdf_pages(tried.content)[0]
    assert client.post(
        f"/api/cases/{cid}/notes/preview", json={"note": note["id"], "text": "x", "look": {"bogus": 1}}
    ).status_code == 422


def test_the_preview_maps_each_page_to_the_line_it_starts_at(client):
    cid = make_case(client)
    chapter = make_note(client, cid, title="Chapter", content="Chapter text.\n")
    text = "Intro line.\n\n" + "\n\n".join(f"Paragraph {n}. " + "word " * 120 for n in range(12))
    text += f"\n\n[[include:{chapter['id']}]]\n"
    response = client.post(
        f"/api/cases/{cid}/notes/preview",
        json={"note": "case", "text": text, "look": {"style": "report"}},
    )
    pages = json.loads(response.headers["x-note-pages"])
    assert len(pages) == len(PdfReader(BytesIO(response.content)).pages)
    assert pages[0] == 0
    assert pages == sorted(pages) and pages[1] > 0
    include_line = text.split("\n").index(f"[[include:{chapter['id']}]]")
    # a chapter opens a page in a report, and that page is the include line's
    assert pages[-1] == include_line


def test_the_preview_is_bounded_like_a_save_and_an_export(client, monkeypatch):
    cid = make_case(client)
    route = f"/api/cases/{cid}/notes/preview"
    monkeypatch.setattr(notes_api, "MAX_PREVIEW_BODY_BYTES", 30)
    heavy = client.post(route, content=b"x" * 40, headers={"content-type": "application/json"})
    assert heavy.status_code == 413
    monkeypatch.setattr(notes_api, "MAX_PREVIEW_BODY_BYTES", 10_000_000)
    monkeypatch.setattr(notes_api, "MAX_NOTE_BODY_BYTES", 10)
    assert client.post(route, json={"text": "é" * 8}).status_code == 413
    monkeypatch.setattr(notes_api, "MAX_NOTE_BODY_BYTES", 8 * 1024 * 1024)
    too_many = {"text": "x", "diagrams": {f"k{n}": "AAAA" for n in range(200)}}
    assert client.post(route, json=too_many).status_code == 422
    assert client.post(route, json={"note": "../x", "text": "x"}).status_code == 422
    assert client.post(route, json={"note": "nope", "text": "x"}).status_code == 404


def test_one_preview_is_laid_out_at_a_time(client, monkeypatch):
    cid = make_case(client)
    busy = threading.Lock()
    busy.acquire()
    monkeypatch.setattr(notes_api, "_preview_turn", busy)
    monkeypatch.setattr(notes_api, "PREVIEW_WAIT_SECONDS", 0.05)
    response = client.post(f"/api/cases/{cid}/notes/preview", json={"text": "x"})
    assert response.status_code == 503
    busy.release()
    assert client.post(f"/api/cases/{cid}/notes/preview", json={"text": "x"}).status_code == 200


def test_a_template_preview_reads_no_case_and_draws_placeholders(client, monkeypatch):
    def explode(*args, **kwargs):
        raise AssertionError("a template's preview must not read a case")

    monkeypatch.setattr(Case, "open", explode)
    monkeypatch.setattr(Case, "get_entity", explode)
    monkeypatch.setattr(Case, "resolve_inside", explode)
    text = (
        "<!--? Say what happened. -->\n\n"
        "See [[entity:abc123|The quay]].\n\n"
        "[[media:m1|Key frame]]{width=60% align=center}\n\n"
        "![x](/files/somecase/media/a.png)\n\n"
        "[[include:abc123]]\n"
    )
    response = client.post(
        "/api/templates/note/preview",
        json={"title": "Situation report", "text": text, "look": {"style": "report", "numbered": True}},
    )
    assert response.status_code == 200, response.text
    printed = "\n".join(pdf_pages(response.content))
    assert "The quay" in printed
    assert printed.count(notes_pdf.CASE_PICTURE) >= 2
    assert notes_pdf.CASE_CHAPTER in printed
    assert "Say what happened" not in printed
    assert json.loads(response.headers["x-note-pages"]) == [0]


def test_the_template_preview_is_bounded_before_it_is_parsed(client, monkeypatch):
    from azimut.api import templates as templates_api

    monkeypatch.setattr(templates_api, "MAX_PREVIEW_BODY_BYTES", 20)
    response = client.post(
        "/api/templates/note/preview", content=b"x" * 40, headers={"content-type": "application/json"}
    )
    assert response.status_code == 413


# -- the styles ----------------------------------------------------------------


@pytest.mark.parametrize("style", ["plain", "report", "brief", "journal"])
@pytest.mark.parametrize("page", ["a4", "letter"])
def test_every_style_prints_on_either_page_size(tmp_path, style, page):
    png(tmp_path, "media/frame.png", size=(640, 360))
    out = render(REPORT, FakeCase(tmp_path), style=style, page=page, tlp="amber")
    reader = PdfReader(BytesIO(out.pdf))
    width = float(reader.pages[0].mediabox.width)
    assert width == pytest.approx(612.0 if page == "letter" else 595.28, abs=0.5)
    printed = "\n".join(page.extract_text() for page in reader.pages)
    for words in ("Body text for the summary.", "Channel A", "Ask the port.", "Check the date"):
        assert words in printed
    # FIRST TLP 2.0: the label in the header and the footer of every page
    for text in (page.extract_text() for page in reader.pages):
        assert text.count("TLP:AMBER") >= 2
    assert len(out.pages) == len(reader.pages)
    # every styled look carries bookmarks; plain keeps the document it always was
    assert bool(reader.outline) is (style != "plain")


def test_a_report_has_a_cover_contents_bookmarks_and_numbers(tmp_path):
    png(tmp_path, "media/frame.png", size=(640, 360))
    png(tmp_path, "media/cover.png", size=(1200, 700))
    case = FakeCase(tmp_path, {
        "cv": {"id": "cv", "label": "Cover", "type": "media", "attrs": {"path": "media/cover.png", "kind": "image"}},
    })
    out = render(
        REPORT, case, style="report", toc=True, numbered=True, tlp="amber-strict",
        cover={"on": True, "subtitle": "What the footage shows", "image": "cv", "date": "2026-11-04"},
    )
    reader = PdfReader(BytesIO(out.pdf))
    cover = squash(reader.pages[0].extract_text())
    contents = squash(reader.pages[1].extract_text())
    assert "Rooftop" in cover and "Whatthefootageshows" in cover and "4November2026" in cover
    assert "TLP:AMBER+STRICT" in cover and "restrictedtotheorganizationonly" in cover
    assert len(reader.pages[0].images) == 1
    assert "Contents" in contents
    for entry in ("1Summary", "2Method", "2.1Shadows"):
        assert entry in contents
    body = squash("\n".join(page.extract_text() for page in reader.pages[2:]))
    assert "Figure1" in body and "Theframe" in body
    assert "Page3/" in body
    titles = [item.title for item in reader.outline if not isinstance(item, list)]
    assert titles[:2] == ["1  Summary", "2  Method"]
    # a report lists its sources: the frame is a file the case says nothing about,
    # and its one open task is worth a word before it goes out
    assert "Sources" in contents and titles[-1] == "Sources"
    assert list(zip(out.warnings, out.warning_lines, out.warning_kinds)) == [
        ('Picture "frame" has no source.', 17, "unsourced"),
        ("1 task is still open.", 25, "open-task"),
    ]


def test_a_cover_picture_that_is_gone_is_said_not_failed(tmp_path):
    out = render("Body.", FakeCase(tmp_path), style="report", cover={"on": True, "image": "gone"})
    assert any("cover picture" in warning for warning in out.warnings)
    assert "Rooftop" in pdf_pages(out.pdf)[0]


def test_plain_shows_a_tlp_label_only_when_one_is_set(tmp_path):
    marked = render("Body.", FakeCase(tmp_path), style="plain", tlp="red")
    assert pdf_pages(marked.pdf)[0].count("TLP:RED") == 2
    unmarked = render("Body.", FakeCase(tmp_path), style="plain")
    assert "TLP" not in pdf_pages(unmarked.pdf)[0]


def test_a_brief_lifts_its_first_verdict_to_the_top(tmp_path):
    text = (
        "## Key points\n\n- One.\n\n> [!lead] Follow the ship.\n\n"
        "> [!unverified] The cargo is unknown.\n\n> [!confirmed] Second verdict stays.\n"
    )
    out = render(text, FakeCase(tmp_path), style="brief")
    printed = squash(pdf_pages(out.pdf)[0])
    assert printed.count("Thecargoisunknown.") == 1
    assert printed.index("Thecargoisunknown.") < printed.index("KEYPOINTS")
    assert printed.index("KEYPOINTS") < printed.index("Secondverdictstays.")
    assert "BRIEF" in printed


def test_a_journal_sets_each_entry_time_in_the_gutter(tmp_path):
    text = (
        "### 2026-11-02 09:31 (UTC+3)\nFirst video spotted.\n\n"
        "### 2026-11-02 10:05 (UTC+3) Geolocation started\nCranes match.\n\n"
        "### 2026-11-03 07:45 (UTC+3)\nDeparture claim.\n\n"
        "### Not a log entry\nPlain heading.\n"
    )
    out = render(text, FakeCase(tmp_path), style="journal")
    printed = squash(pdf_pages(out.pdf)[0])
    for words in ("09:31", "10:05", "07:45", "UTC+3", "MONDAY2NOVEMBER2026", "TUESDAY3NOVEMBER2026",
                  "Geolocationstarted",
                  "3ENTRIES", "Notalogentry"):
        assert words in printed
    assert "2026-11-0209:31" not in printed


def test_numbered_figures_count_pictures_and_drawn_diagrams(tmp_path):
    png(tmp_path, "media/a.png")
    text = (
        "![first](/files/demo/media/a.png)\n\n```mermaid\ngraph TD; A-->B;\n```\n\n"
        "![second](/files/demo/media/a.png \"Titled\")\n"
    )
    key = notes_pdf.diagram_key("graph TD; A-->B;")
    out = notes_pdf.render(
        FakeCase(tmp_path), title="F", text=text, diagrams={key: png_bytes()},
        look=look(style="report", numbered=True),
    )
    printed = "\n".join(pdf_pages(out.pdf))
    assert "Figure 1" in printed and "first" in printed
    assert "Figure 2" in printed
    assert "Figure 3" in printed and "Titled" in printed


def test_an_italic_word_in_a_heading_no_longer_fails_the_document(tmp_path):
    """The sans face has no italic, and asking for one failed the whole export."""
    for style in ("plain", "brief"):
        out = render("# An *italic* heading\n\nBody *with* emphasis.\n", FakeCase(tmp_path), style=style)
        assert "italic" in pdf_pages(out.pdf)[0].lower()


def test_a_boxed_callout_follows_its_text_over_a_page(tmp_path):
    long = "> [!note] " + " ".join(["A sentence in a long callout."] * 400) + "\n\nAfter.\n"
    out = render(long, FakeCase(tmp_path), style="report")
    pages = pdf_pages(out.pdf)
    assert len(pages) >= 2 and "After." in pages[-1]


def test_a_table_measured_over_a_page_break_keeps_the_page_map_honest(tmp_path):
    rows = "\n".join(f"| row {n} | " + "value " * 30 + "|" for n in range(60))
    out = render("| A | B |\n|---|---|\n" + rows + "\n", FakeCase(tmp_path), style="journal")
    assert len(out.pages) == len(PdfReader(BytesIO(out.pdf)).pages)


# -- guidance and chapters -----------------------------------------------------


def test_guidance_is_never_printed_or_counted(tmp_path):
    text = (
        "<!--? Say what happened, where and when. -->\nThe ship docked.\n\n"
        "> [!confirmed] <!--? the verdict -->Moored at berth 4.\n\n"
        "```\n<!--? kept inside code -->\n```\n"
    )
    for style in ("plain", "report", "brief", "journal"):
        printed = "\n".join(pdf_pages(render(text, FakeCase(tmp_path), style=style).pdf))
        assert "Say what happened" not in printed and "the verdict" not in printed
        assert "kept inside code" in printed
    assert notetext.word_count(text) == notetext.word_count(
        "The ship docked.\n> [!confirmed] Moored at berth 4.\n```\n<!--? kept inside code -->\n```"
    )
    assert notetext.excerpt(text) .startswith("The ship docked.")
    assert notetext.find(text, "happened") is None
    assert notetext.tasks("<!--? - [ ] not a task -->\n- [ ] real\n")[0].text == "real"


def test_a_plain_note_with_contents_gets_its_bookmarks(tmp_path):
    out = render("## One\n\nA.\n\n## Two\n\nB.\n", FakeCase(tmp_path), toc=True)
    reader = PdfReader(BytesIO(out.pdf))
    assert [item.title for item in reader.outline] == ["One", "Two"]
    assert "Contents" in squash(reader.pages[0].extract_text()).replace("CONTENTS", "Contents")


def test_the_diagram_header_holds_what_fits_and_the_rest_comes_next_time(monkeypatch):
    monkeypatch.setattr(notes_api, "MAX_DIAGRAM_HEADER_BYTES", 120)
    pending = [(f"k{n}", "graph TD; A-->B;" * 2) for n in range(5)]
    kept = json.loads(notes_api._diagram_header(pending))
    assert 0 < len(kept) < 5
    assert len(notes_api._diagram_header(pending)) <= 120


def test_an_old_note_s_chapters_are_restated_once_the_case_opens(client):
    cid = make_case(client)
    chapter = make_note(client, cid, title="Chapter")
    report = make_note(client, cid, title="Report")
    case = Case.open(cid)
    case.write_note(report["id"], f"[[include:{chapter['id']}]]\n")
    case.set_setting(notelinks.RESTATED, None)
    assert notelinks.restate_once(case) >= 1
    assert any(
        link["type"] == "mentions" and link["to"] == chapter["id"]
        for link in Case.open(cid).links_of(report["id"])
    )


def test_includes_are_read_outside_code_and_never_excerpted():
    text = "Intro.\n\n[[include:abc]]\n\n```\n[[include:inside]]\n```\n[[include:case]]\n"
    assert notetext.included_ids(text) == ["abc", "case"]
    assert notetext.excerpt(text) == "Intro."
    assert notetext.word_count("[[include:abc]]\n") == 0


def chapters(notes):
    return lambda note_id: notes.get(note_id)


def test_an_included_note_prints_as_a_chapter_with_its_headings_moved_under_it(tmp_path):
    notes = {
        "a": ("Geolocation", "# Geolocation\n\n## Horizon\n\nHills line up.\n"),
        "b": ("Chronolocation", "### Shadows\n\nMorning.\n"),
    }
    text = "Intro.\n\n[[include:a]]\n\n[[include:b]]\n\nClosing.\n"
    out = render(text, FakeCase(tmp_path), resolve=chapters(notes), style="report", numbered=True, toc=True)
    printed = squash("\n".join(pdf_pages(out.pdf)))
    assert "CHAPTER1" in printed and "CHAPTER2" in printed
    assert "1.1Horizon" in printed and "2.1Shadows" in printed
    assert printed.count("Geolocation") >= 2  # the chapter and its contents line
    assert "Closing." in printed and "[[include" not in printed
    pieces = notes_pdf.expand("Host", text, resolve=chapters(notes))
    assert [piece.kind for piece in pieces] == ["text", "chapter", "text", "chapter", "text", "text"]


def test_a_chapter_loop_a_missing_note_and_a_third_level_print_an_aside(tmp_path):
    notes = {
        "a": ("A", "[[include:b]]\n"),
        "b": ("B", "[[include:c]]\n\n[[include:host]]\n"),
        "c": ("C", "Too deep.\n"),
    }
    text = "[[include:a]]\n\n[[include:gone]]\n"
    out = render(text, FakeCase(tmp_path), resolve=chapters(notes), note_id="host", style="report")
    printed = " ".join(" ".join(pdf_pages(out.pdf)).split())
    assert "Chapters go two levels deep" in printed and "Too deep." not in printed
    assert "already printed above" in printed
    assert "no longer in the case" in printed


def test_a_note_including_itself_does_not_loop(tmp_path):
    out = render("[[include:me]]\n", FakeCase(tmp_path), resolve=chapters({"me": ("Me", "[[include:me]]")}),
                 note_id="me")
    assert "already printed above" in " ".join(" ".join(pdf_pages(out.pdf)).split())


def test_the_diagrams_inside_chapters_are_asked_for(tmp_path):
    notes = {"a": ("A", "```mermaid\ngraph LR; C-->D;\n```\n")}
    sources = notes_pdf.mermaid_sources("[[include:a]]\n", resolve=chapters(notes))
    assert [source.strip() for source in sources] == ["graph LR; C-->D;"]


def test_an_include_is_a_mention_of_the_note_it_prints(client):
    cid = make_case(client)
    chapter = make_note(client, cid, title="Chapter")
    report = make_note(client, cid, title="Report")
    client.put(
        f"/api/cases/{cid}/notes/{report['id']}",
        json={"text": f"[[include:{chapter['id']}]]\n\n[[include:case]]\n\n[[include:{report['id']}]]\n"},
    )
    mentions = {
        link["to"] for link in Case.open(cid).links_of(report["id"])
        if link["type"] == "mentions" and link["from"] == report["id"]
    }
    assert mentions == {chapter["id"]}
    client.put(f"/api/cases/{cid}/notes/{report['id']}", json={"text": "No chapters now.\n"})
    assert not [
        link for link in Case.open(cid).links_of(report["id"])
        if link["type"] == "mentions" and link["from"] == report["id"]
    ]


# -- export --------------------------------------------------------------------


def test_the_export_prints_each_note_in_its_own_look_with_its_chapters(client):
    cid = make_case(client)
    chapter = make_note(client, cid, title="Chapter", content="Chapter words.\n\n```mermaid\ngraph TD; Q-->R;\n```\n")
    report = make_note(client, cid, title="Report", content=f"Intro.\n\n[[include:{chapter['id']}]]\n")
    plain = make_note(client, cid, title="Plain", content="Plain words.\n")
    client.put(f"/api/cases/{cid}/notes/{report['id']}/look", json={"style": "report", "tlp": "green"})

    pending = client.post(
        f"/api/cases/{cid}/notes/pdf/diagrams", json={"notes": [report["id"]]}
    ).json()["diagrams"]
    assert [row["key"] for row in pending] == [notes_pdf.diagram_key("graph TD; Q-->R;")]

    written = client.post(
        f"/api/cases/{cid}/notes/pdf", json={"notes": [report["id"], plain["id"]]}
    ).json()["written"]
    exports = layout.subdir(Case.open(cid).path, "exports")
    assert [row["file"] for row in written] == ["Report.pdf", "Plain.pdf"]
    report_pdf = squash("\n".join(pdf_pages((exports / "Report.pdf").read_bytes())))
    assert "TLP:GREEN" in report_pdf and "Chapterwords." in report_pdf and "CHAPTER1" in report_pdf
    plain_pdf = "\n".join(pdf_pages((exports / "Plain.pdf").read_bytes()))
    assert "TLP" not in plain_pdf and "AZIMUT NOTES" in plain_pdf


# -- templates -----------------------------------------------------------------


def test_a_note_template_from_before_looks_stays_valid(client):
    old = client.post("/api/templates/note", json={"name": "Old", "data": {"body": "# T\n", "folder": "x"}})
    assert old.status_code == 200
    assert old.json()["data"] == {"body": "# T\n", "folder": "x"}
    with_look = client.post(
        "/api/templates/note",
        json={"name": "Report", "data": {"body": "<!--? Intro -->\n", "look": {"style": "report", "toc": True}}},
    )
    assert with_look.status_code == 200
    assert with_look.json()["data"]["look"]["toc"] is True
    listed = {row["name"]: row for row in client.get("/api/templates").json()["note"]}
    assert listed["Report"]["data"]["look"]["style"] == "report"


@pytest.mark.parametrize(
    "bad",
    [
        {"cover": {"on": True, "image": "abc123"}},
        {"cover": {"date": "2026-11-04"}},
        {"style": "report", "unknown": True},
    ],
)
def test_a_template_look_with_case_content_is_refused(client, bad):
    response = client.post("/api/templates/note", json={"name": "T", "data": {"body": "x", "look": bad}})
    assert response.status_code == 422


# -- travel --------------------------------------------------------------------


def test_looks_travel_in_a_case_bundle(client):
    from azimut.engine import bundles

    cid = make_case(client)
    note = make_note(client, cid)
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "brief", "tlp": "amber"})
    client.put(f"/api/cases/{cid}/notes/case/look", json={"style": "journal"})
    case = Case.open(cid)
    exported = bundles.export_case(case)
    landed = Case.open(bundles.import_into(Case.create(bundles.imported_name(case.id)), exported)["case_id"])
    moved = [entity for entity in landed.list_entities() if entity["type"] == "note"]
    assert notelook.stored(landed, moved[0]["id"]).style == "brief"
    assert notelook.stored(landed, "case").style == "journal"


def test_a_case_with_looks_reads_as_plain_to_an_older_reader(client):
    """What 0.3.3 sees: one more attr it never reads, one more setting it never asks
    for, and include lines that are text. Nothing here may need a schema bump."""
    from azimut.workspace import CASE_SCHEMA

    cid = make_case(client)
    note = make_note(client, cid, content="[[include:case]]\n")
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report", "toc": True})
    assert CASE_SCHEMA == 11
    case = Case.open(cid)
    assert case.read_note(note["id"]) == "[[include:case]]\n"
    attrs = case.get_entity(note["id"])["attrs"]
    assert set(attrs) - {"look"} >= {"path", "folder"}
    assert isinstance(attrs["look"], dict)


def test_no_case_file_is_left_behind_by_a_preview_failure(client, monkeypatch):
    cid = make_case(client)

    def fail(*args, **kwargs):
        raise notes_pdf.NotesPdfError("the note could not be laid out: test")

    monkeypatch.setattr(notes_pdf, "render", fail)
    response = client.post(f"/api/cases/{cid}/notes/preview", json={"text": "x"})
    assert response.status_code == 422
    # and the turn was given back
    assert notes_api._preview_turn.acquire(blocking=False)
    notes_api._preview_turn.release()




# -- pictures decoded once -------------------------------------------------------


@pytest.fixture()
def decoded():
    notes_pdf.DECODED.clear()
    yield notes_pdf.DECODED
    notes_pdf.DECODED.clear()


def test_a_picture_decoded_once_makes_the_same_document(tmp_path, decoded):
    from datetime import datetime, timezone

    from PIL import ImageCms

    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    (tmp_path / "media").mkdir()
    Image.new("RGB", (300, 200), (90, 30, 30)).save(tmp_path / "media/a.png", icc_profile=profile)
    png(tmp_path, "media/b.png", size=(200, 100))
    text = "![a](/files/demo/media/a.png)\n\n![b](/files/demo/media/b.png)\n\n![a again](/files/demo/media/a.png)\n"
    pinned = datetime(2026, 1, 2, tzinfo=timezone.utc)
    first = notes_pdf.render(FakeCase(tmp_path), title="P", text=text, created=pinned)
    assert decoded.held[0] == 2
    second = notes_pdf.render(FakeCase(tmp_path), title="P", text=text, created=pinned)
    assert second.pdf == first.pdf
    # an edited picture is read again rather than served stale
    Image.new("RGB", (300, 200), (10, 200, 10)).save(tmp_path / "media/a.png")
    os.utime(tmp_path / "media/a.png", ns=(1, 1))
    third = notes_pdf.render(FakeCase(tmp_path), title="P", text=text, created=pinned)
    assert third.pdf != first.pdf
    assert decoded.held[0] == 2


def test_the_kept_pictures_are_bounded(tmp_path, decoded, monkeypatch):
    monkeypatch.setattr(decoded, "MAX_ENTRIES", 2)
    for n in range(4):
        png(tmp_path, f"media/p{n}.png", size=(120 + n, 80))
    text = "\n\n".join(f"![p](/files/demo/media/p{n}.png)" for n in range(4))
    notes_pdf.render(FakeCase(tmp_path), title="P", text=text)
    assert decoded.held[0] == 2
    # the next document keeps what it uses, and drops what the last one left
    notes_pdf.render(FakeCase(tmp_path), title="P", text="![p](/files/demo/media/p3.png)")
    assert decoded.held[0] == 2
    monkeypatch.setattr(decoded, "MAX_BYTES", 10)
    decoded.clear()
    notes_pdf.render(FakeCase(tmp_path), title="P", text=text)
    assert decoded.held == (0, 0)
