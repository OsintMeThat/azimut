"""A note's two editions, and the record of every PDF it was exported as.

The red line: a public edition never carries an internal passage (`> [!internal]`),
in any form. Not its words, not a heading of it in the contents or the bookmarks,
not a source only it cites, not a credit, not a `[n]`, not a link. Each test below
reads a public PDF back the way a reader would (its text, its outline, its links)
and looks for every trace a passage could leave, beside the internal edition of the
same note, which keeps them all.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pytest
from pypdf import PdfReader

from azimut import layout
from azimut.api import notes as notes_api
from azimut.engine import notelook, notes_pdf
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from sourcesfixture import ACCOUNT_URL, NOTICE_URL, PHOTO_URL, POST_URL, sourced_case
from test_notes_pages import link_targets
from test_notes_pdf import pdf_text
from test_notes_pdf_golden import CREATED, GOLDEN, NOTES, drawing, golden_case
from test_notes_report import make_case, make_note

DAY = "2026-03-12"
LEAK_URL = "https://leak.example.org/only-internal"


@pytest.fixture
def pinned(monkeypatch):
    """The export's clock at a fixed moment: a file is named after its day."""
    monkeypatch.setattr(notes_api, "_now", lambda: datetime(2026, 3, 12, 9, 30, tzinfo=timezone.utc))


def outline(data: bytes) -> list[str]:
    """Every bookmark of a PDF, nested ones included."""
    titles: list[str] = []

    def walk(items):
        for item in items:
            if isinstance(item, list):
                walk(item)
            else:
                titles.append(str(item.title))

    walk(PdfReader(BytesIO(data)).outline)
    return titles


def everything(data: bytes) -> str:
    """All a reader of a PDF can find in it: its text, bookmarks, links and metadata."""
    reader = PdfReader(BytesIO(data))
    said = [pdf_text(data), *outline(data), *link_targets(data)]
    said.extend(str(value) for value in (reader.metadata or {}).values())
    return "\n".join(said)


def squash(text: str) -> str:
    return "".join(text.split())


def numbers(text: str) -> list[int]:
    return sorted({int(found) for found in re.findall(r"\[(\d+)\]", text)})


# -- the passage, as text ------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "kept", "count"),
    [
        # a passage is its whole quote, lazy lines and all
        ("Intro\n\n> [!internal] secret\n> more\nlazy\n\nAfter", "Intro\n\n\n\n\n\nAfter", 1),
        # any case, and the marker alone on its line
        ("> [!INTERNAL]\n> secret\n\nok", "\n\n\nok", 1),
        # inside another callout, the rest of that callout stays
        ("> [!confirmed] yes\n>\n> > [!internal] secret\n>\n> after", "> [!confirmed] yes\n>\n\n>\n> after", 1),
        # inside a list, the other items stay
        ("- item\n  > [!internal] x\n- next", "- item\n\n- next", 1),
        # an example in a code block is not a passage
        ("```\n> [!internal] in code\n```", "```\n> [!internal] in code\n```", 0),
        # the editor reads a quote's first line: what it shows as internal goes too
        (">     [!internal] code in a quote\n\nok", "\n\nok", 1),
        # the marker in a quote's second paragraph is internal to the PDF: it goes too
        (">\n> [!internal] second\n\nok", "\n\n\nok", 1),
        # two passages, and one inside the other counted once
        ("> [!internal] a\n\n> [!internal] b\n> > [!internal] c\n\nok", "\n\n\n\n\nok", 2),
        ("No passage here, only [!internal] in a sentence.", "No passage here, only [!internal] in a sentence.", 0),
    ],
)
def test_a_passage_is_blanked_whole_and_lines_are_kept(text, kept, count):
    assert notes_pdf.strip_internal(text) == (kept, count)
    assert notes_pdf.internal_passages(text) == count


def test_a_centred_block_written_on_from_a_passage_goes_with_it():
    """The editor reads the lines under a passage as part of it until a blank line,
    so the public edition leaves them out with it."""
    text = "> [!internal] s\n::: center\ncentred\n:::\n\nend"
    assert notes_pdf.strip_internal(text) == ("\n\n\n\n\nend", 1)


def test_other_callouts_and_quotes_are_untouched():
    text = "> [!confirmed] yes\n\n> [!note] aside\n\n> plain quote\n"
    assert notes_pdf.strip_internal(text) == (text, 0)


# -- the page ------------------------------------------------------------------------

NOTE = """# Findings

Public words.

> [!internal] Secret words about the source.
> ## Hidden heading
> See https://leak.example.org/only-internal for the raw feed.

## Open section

More public words.
"""


@pytest.mark.parametrize("style", ["plain", "report", "brief", "journal"])
def test_the_public_edition_drops_the_passage_in_every_style(style):
    look = NoteLook.model_validate({"style": style, "toc": True})
    internal = notes_pdf.render(None, title="Findings", text=NOTE, look=look)
    public = notes_pdf.render(None, title="Findings", text=NOTE, look=look, public=True)

    seen = squash(everything(internal.pdf))
    assert "Secretwords" in seen and "Hiddenheading" in seen and "INTERNAL" in seen
    assert LEAK_URL in everything(internal.pdf)
    assert "Hidden heading" in " ".join(outline(internal.pdf))

    said = everything(public.pdf)
    for trace in ("Secret", "Hidden", "leak.example", "INTERNAL", "Internal"):
        assert trace not in said and trace not in squash(said), trace
    assert "Morepublicwords." in squash(said) and "Publicwords." in squash(said)
    assert internal.internal == public.internal == 1
    assert internal.text_sha256 != public.text_sha256


def test_the_internal_edition_prints_the_passage_in_a_marked_box():
    """Boxed even in the plain look, whose other callouts are only barred."""
    text = "Before.\n\n> [!{}] The passage.\n\nAfter.\n"
    boxed = drawing(notes_pdf.render(None, title="T", text=text.format("internal")).pdf).decode("latin-1")
    barred = drawing(notes_pdf.render(None, title="T", text=text.format("note")).pdf).decode("latin-1")
    # a filled box is painted behind the passage, where a plain callout has a bar only
    assert " re f" in boxed and " re f" not in barred
    assert "INTERNAL" in pdf_text(notes_pdf.render(None, title="T", text=text.format("internal")).pdf)


def test_a_note_without_a_passage_prints_the_same_in_both_editions(tmp_path):
    case = golden_case(tmp_path)
    for name, (title, text) in NOTES.items():
        public = notes_pdf.render(case, title=title, text=text, created=CREATED, public=True)
        assert hashlib.sha256(drawing(public.pdf)).hexdigest() == GOLDEN[name], name
        internal = notes_pdf.render(case, title=title, text=text, created=CREATED)
        assert public.internal == internal.internal == 0
        assert public.text_sha256 == internal.text_sha256


def test_a_chapter_written_inside_a_passage_is_left_out_with_it():
    chapters = {"c1": ("Chapter one", "Chapter words.\n")}
    text = "Intro.\n\n> [!internal] Not for outside.\n[[include:c1]]\n\nOutro.\n"
    public = notes_pdf.render(None, title="R", text=text, resolve=chapters.get, public=True)
    assert "Chapter" not in pdf_text(public.pdf)
    assert "Intro." in pdf_text(public.pdf) and "Outro." in pdf_text(public.pdf)
    internal = notes_pdf.render(None, title="R", text=text, resolve=chapters.get)
    assert "Chapter words." in pdf_text(internal.pdf)


def test_a_diagram_inside_a_passage_is_not_asked_for_by_the_public_edition():
    text = "Body.\n\n> [!internal]\n> ```mermaid\n> graph TD; S-->T;\n> ```\n"
    assert notes_pdf.mermaid_sources(text) == ["graph TD; S-->T;\n"]
    assert notes_pdf.mermaid_sources(text, public=True) == []


def test_the_public_edition_refuses_to_print_if_a_passage_were_left(monkeypatch):
    """The belt under the stripping: a page is never made with one still on it."""
    monkeypatch.setattr(notes_pdf, "strip_internal", lambda text: (text, 0))
    with pytest.raises(notes_pdf.NotesPdfError):
        notes_pdf.render(None, title="T", text=NOTE, public=True)


# -- the red line, in a case ---------------------------------------------------------


@pytest.fixture()
def report(client):
    """A report citing the case's items, with internal passages in it and in its chapter."""
    cid = make_case(client)
    case = Case.open(cid)
    made = sourced_case(case)
    m = {name: item["id"] for name, item in made.items()}
    chapter = make_note(client, cid, title="Witness chapter", content=(
        "Chapter public words.\n\n"
        f"> [!internal] Chapter secret: [[entity:{m['video']}|the original video]] is the only copy.\n"
    ))
    text = (
        "# Strike\n\n"
        f"[[entity:{m['notice']}|The port authority]] closed the berths.\n\n"
        "> [!internal] Secret words.\n"
        f"> [[entity:{m['account']}|@portwatch]] told us first, see {LEAK_URL}.\n>\n"
        f"> [[media:{m['photo']}|Crane]]{{width=40%}}\n>\n"
        f"> [[media:{m['paste']}|Pasted]]{{width=40%}}\n>\n"
        "> ## Hidden heading\n\n"
        f"[[media:{m['capture']}|Port from above]]{{width=50%}}\n\n"
        f"[[include:{chapter['id']}]]\n"
    )
    note = make_note(client, cid, title="Strike", content=text)
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report", "toc": True})
    return cid, note, chapter


def test_a_public_report_carries_no_trace_of_a_passage_nor_of_what_only_it_cites(client, report, pinned):
    cid, note, _ = report
    for edition in ("internal", "public"):
        response = client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"]], "edition": edition})
        assert response.status_code == 200, response.text
        assert response.json()["written"][0]["file"] == f"Strike - {edition} - {DAY}.pdf"
    exports = layout.subdir(Case.open(cid).path, "exports")
    internal = (exports / f"Strike - internal - {DAY}.pdf").read_bytes()
    public = (exports / f"Strike - public - {DAY}.pdf").read_bytes()

    kept = everything(internal)
    for trace in ("Secret words", "Chapter secret", "Hidden heading", "@portwatch", "Crane on the quay",
                  "Strike on the port", LEAK_URL, ACCOUNT_URL, PHOTO_URL, POST_URL):
        assert squash(trace) in squash(kept), trace

    said = everything(public)
    for trace in ("Secret", "Chapter secret", "Hidden heading", "@portwatch", "portwatch", "Crane", "Port News",
                  "t.me", "Strike on the port", "Port Watch", "Pasted", "leak.example", "INTERNAL",
                  ACCOUNT_URL, PHOTO_URL, POST_URL):
        assert squash(trace) not in squash(said), trace
    # what is public stays, the chapter's own words included
    for trace in ("Chapter public words.", "Port authority notice", NOTICE_URL, "Witness chapter"):
        assert squash(trace) in squash(said), trace
    assert "Hidden heading" not in outline(public) and "Hidden heading" in outline(internal)

    # the sources are numbered without a gap: one number per entry, from 1
    internal_numbers, public_numbers = numbers(pdf_text(internal)), numbers(pdf_text(public))
    assert public_numbers == list(range(1, len(public_numbers) + 1))
    assert internal_numbers == list(range(1, len(internal_numbers) + 1))
    assert len(public_numbers) < len(internal_numbers)


def test_the_check_counts_passages_and_says_what_the_public_edition_leaves_out(client, report):
    cid, note, chapter = report
    route = f"/api/cases/{cid}/notes/pdf/check"
    internal = client.post(route, json={"notes": [note["id"], chapter["id"]]}).json()["notes"]
    assert [item["internal"] for item in internal] == [2, 1]
    kinds = [warning["kind"] for warning in internal[0]["warnings"]]
    assert "internal" not in kinds
    # a picture with no source, cited only inside a passage, is warned about in the internal edition only
    assert any('"Pasted"' in warning["text"] for warning in internal[0]["warnings"])

    public = client.post(route, json={"notes": [note["id"], chapter["id"]], "edition": "public"}).json()["notes"]
    assert [item["internal"] for item in public] == [2, 1]
    assert public[0]["warnings"][-1] == {"text": "2 internal passages left out.", "line": None, "kind": "internal"}
    assert public[1]["warnings"] == [{"text": "1 internal passage left out.", "line": None, "kind": "internal"}]
    assert not any('"Pasted"' in warning["text"] for warning in public[0]["warnings"])
    assert client.post(route, json={"notes": [note["id"]], "edition": "secret"}).status_code == 422


def test_the_preview_draws_the_edition_asked_for_and_says_how_many_passages(client, report):
    cid, note, _ = report
    text = Case.open(cid).read_note(note["id"])
    route = f"/api/cases/{cid}/notes/preview"
    internal = client.post(route, json={"note": note["id"], "text": text})
    public = client.post(route, json={"note": note["id"], "text": text, "edition": "public"})
    assert internal.status_code == public.status_code == 200
    assert internal.headers["x-note-internal"] == public.headers["x-note-internal"] == "2"
    assert "Secret" in pdf_text(internal.content) and "Secret" not in pdf_text(public.content)
    plain = client.post(route, json={"note": note["id"], "text": "Nothing to hide.\n"})
    assert plain.headers["x-note-internal"] == "0"


def test_the_diagrams_asked_for_follow_the_edition(client):
    cid = make_case(client)
    note = make_note(client, cid, title="D", content="> [!internal]\n> ```mermaid\n> graph TD; S-->T;\n> ```\n")
    route = f"/api/cases/{cid}/notes/pdf/diagrams"
    assert len(client.post(route, json={"notes": [note["id"]]}).json()["diagrams"]) == 1
    assert client.post(route, json={"notes": [note["id"]], "edition": "public"}).json()["diagrams"] == []


def test_a_template_with_a_passage_prints_both_editions(client, pinned):
    body = "## Findings\n\n<!--? What was found -->\n\n> [!internal] Who told us, and how to reach them.\n"
    saved = client.post("/api/templates/note", json={"name": "With a source", "data": {"body": body}})
    assert saved.status_code == 200, saved.text
    route = "/api/templates/note/preview"
    public = client.post(route, json={"title": "T", "text": body, "edition": "public"})
    internal = client.post(route, json={"title": "T", "text": body})
    assert public.headers["x-note-internal"] == internal.headers["x-note-internal"] == "1"
    assert "Who told us" in pdf_text(internal.content) and "Who told us" not in pdf_text(public.content)

    cid = make_case(client)
    note = make_note(client, cid, title="From the template", content=saved.json()["data"]["body"])
    client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"]], "edition": "public"})
    written = layout.subdir(Case.open(cid).path, "exports") / f"From the template - public - {DAY}.pdf"
    assert "Who told us" not in pdf_text(written.read_bytes())


def test_search_and_excerpts_read_a_passage_as_the_analyst_s_text(client):
    cid = make_case(client)
    make_note(client, cid, title="Lead", content="> [!internal] Ask the harbour master first.\n")
    found = client.get(f"/api/cases/{cid}/notes/search", params={"q": "harbour master"}).json()
    assert [item["title"] for item in found["items"]] == ["Lead"]
    rows = client.get(f"/api/cases/{cid}/notes/index").json()["items"]
    assert "harbour master" in next(row for row in rows if row["title"] == "Lead")["excerpt"]


# -- the record ----------------------------------------------------------------------


def test_each_export_is_a_new_file_and_the_note_records_it(client, pinned):
    cid = make_case(client)
    note = make_note(client, cid, title="Rooftop", content="Public.\n\n> [!internal] Private.\n")
    route = f"/api/cases/{cid}/notes/pdf"
    for edition in ("internal", "public", "public"):
        assert client.post(route, json={"notes": [note["id"]], "edition": edition}).status_code == 200
    exports = layout.subdir(Case.open(cid).path, "exports")
    assert sorted(path.name for path in exports.glob("*.pdf")) == [
        f"Rooftop - internal - {DAY}.pdf", f"Rooftop - public - {DAY} (2).pdf", f"Rooftop - public - {DAY}.pdf",
    ]

    editions = client.get(f"/api/cases/{cid}/notes/{note['id']}/editions").json()["editions"]
    assert [(item["edition"], item["file"]) for item in editions] == [
        ("public", f"Rooftop - public - {DAY} (2).pdf"),
        ("public", f"Rooftop - public - {DAY}.pdf"),
        ("internal", f"Rooftop - internal - {DAY}.pdf"),
    ]
    first = editions[-1]
    assert set(first) == {"at", "edition", "file", "folder", "pages", "pdf_sha256", "text_sha256"}
    assert first["at"] == "2026-03-12T09:30:00Z" and first["folder"] == "exports"
    data = (exports / first["file"]).read_bytes()
    assert first["pdf_sha256"] == hashlib.sha256(data).hexdigest()
    assert first["pages"] == len(PdfReader(BytesIO(data)).pages)
    # each edition has the fingerprint of the text it printed; two of one edition share it
    assert editions[0]["text_sha256"] == editions[1]["text_sha256"] != first["text_sha256"]
    # the record is the note's attr, beside the note and nothing else
    stored = Case.open(cid).get_entity(note["id"])["attrs"][notes_api.EDITIONS_ATTR]
    assert stored == editions


def test_a_note_with_no_passage_has_one_edition_named_by_its_day_alone(client, pinned):
    """Nothing to choose: whichever edition is asked for, the file says only its day
    and the record says public, since the note is shareable as it stands. A chapter's
    passage is a passage of the note that includes it."""
    cid = make_case(client)
    plain = make_note(client, cid, title="Plain", content="Nothing to hide.\n")
    chapter = make_note(client, cid, title="Chapter", content="> [!internal] Who told us.\n")
    report = make_note(client, cid, title="Report", content=f"Intro.\n\n[[include:{chapter['id']}]]\n")
    route = f"/api/cases/{cid}/notes/pdf"
    for edition in ("internal", "public"):
        written = client.post(route, json={"notes": [plain["id"], report["id"]], "edition": edition}).json()["written"]
        assert [(row["file"], row["edition"]) for row in written] == [
            (f"Plain - {DAY}.pdf" if edition == "internal" else f"Plain - {DAY} (2).pdf", "public"),
            (f"Report - {edition} - {DAY}.pdf", edition),
        ]
    editions = client.get(f"/api/cases/{cid}/notes/{plain['id']}/editions").json()["editions"]
    assert [(item["edition"], item["file"]) for item in editions] == [
        ("public", f"Plain - {DAY} (2).pdf"), ("public", f"Plain - {DAY}.pdf"),
    ]


def test_the_record_keeps_the_newest_fifty(client, pinned, monkeypatch):
    monkeypatch.setattr(notes_api, "MAX_EDITIONS", 3)
    cid = make_case(client)
    note = make_note(client, cid, title="Often", content="Words.\n")
    for _ in range(5):
        client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"]]})
    editions = client.get(f"/api/cases/{cid}/notes/{note['id']}/editions").json()["editions"]
    assert [item["file"] for item in editions] == [f"Often - {DAY} ({n}).pdf" for n in (5, 4, 3)]
    # the files themselves stay
    assert len(list(layout.subdir(Case.open(cid).path, "exports").glob("*.pdf"))) == 5


def test_the_case_notes_keep_their_record_in_the_case(client, pinned):
    cid = make_case(client)
    client.put(f"/api/cases/{cid}/notes", json={"text": "Scratch.\n"})
    client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": ["case"], "edition": "public"})
    editions = client.get(f"/api/cases/{cid}/notes/case/editions").json()["editions"]
    assert [item["file"] for item in editions] == [f"Case notes - {DAY}.pdf"]
    assert json.loads(Case.open(cid).get_setting(notes_api.CASE_EDITIONS)) == editions


def test_check_says_unchanged_changed_or_missing(client, pinned):
    cid = make_case(client)
    note = make_note(client, cid, title="Rooftop", content="Words.\n")
    client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"]]})
    record = client.get(f"/api/cases/{cid}/notes/{note['id']}/editions").json()["editions"][0]
    ref = {"at": record["at"], "file": record["file"]}
    route = f"/api/cases/{cid}/notes/{note['id']}/editions/check"
    assert client.post(route, json=ref).json() == {"state": "unchanged"}
    path = layout.subdir(Case.open(cid).path, "exports") / record["file"]
    path.write_bytes(path.read_bytes() + b"\n% edited")
    assert client.post(route, json=ref).json() == {"state": "changed"}
    path.unlink()
    assert client.post(route, json=ref).json() == {"state": "missing"}
    assert client.post(route, json={**ref, "file": "other.pdf"}).status_code == 404


def test_show_opens_the_folder_the_record_names(client, pinned, monkeypatch, tmp_path):
    from azimut.engine import reveal as reveal_engine

    opened: list[Path] = []
    monkeypatch.setattr(reveal_engine, "reveal", lambda path, **_: opened.append(path))
    cid = make_case(client)
    note = make_note(client, cid, title="Rooftop", content="Words.\n")
    client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"]]})
    # a folder of the analyst's own, recorded as the absolute path it is
    own = tmp_path / "reports"
    own.mkdir()
    monkeypatch.setattr(notes_api.exportdir, "destination", lambda kind, path: own)
    client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"]], "edition": "public"})
    editions = client.get(f"/api/cases/{cid}/notes/{note['id']}/editions").json()["editions"]
    assert [item["folder"] for item in editions] == [str(own), "exports"]

    route = f"/api/cases/{cid}/notes/{note['id']}/editions"
    # one name, one second, two folders: the folder the record gives tells them apart
    assert editions[0]["at"] == editions[1]["at"] and editions[0]["file"] == editions[1]["file"]
    for record in editions:
        ref = {"at": record["at"], "file": record["file"], "folder": record["folder"]}
        assert client.post(f"{route}/reveal", json=ref).status_code == 200
        assert client.post(f"{route}/check", json=ref).json() == {"state": "unchanged"}
    assert opened == [own, layout.subdir(Case.open(cid).path, "exports")]


def test_a_record_that_is_not_what_an_export_writes_is_dropped(client, pinned):
    """The record is case data, and may come in a bundle from another machine."""
    cid = make_case(client)
    note = make_note(client, cid, title="Rooftop", content="Words.\n")
    good = {"at": "2026-03-12T09:30:00Z", "edition": "public", "file": "Rooftop.pdf", "folder": "exports",
            "pages": 1, "pdf_sha256": "a" * 64, "text_sha256": "b" * 64}
    elsewhere = {**good, "file": "Elsewhere.pdf", "folder": "C:\\Reports"}
    bad = [
        {**good, "file": "../../secret.pdf"},
        {**good, "file": "a/b.pdf"},
        {**good, "edition": "draft"},
        {**good, "pdf_sha256": "nope"},
        {**good, "pages": True},
        {**good, "at": "yesterday"},
        "not a record",
    ]
    Case.open(cid).update_entity(note["id"], {"attrs": {"editions": [good, *bad, elsewhere]}})
    route = f"/api/cases/{cid}/notes/{note['id']}/editions"
    assert client.get(route).json()["editions"] == [good, elsewhere]
    assert client.post(f"{route}/check", json={"at": good["at"], "file": "../../secret.pdf"}).status_code == 404
    # a folder another machine named is not one this machine can open
    ref = {"at": elsewhere["at"], "file": elsewhere["file"]}
    assert client.post(f"{route}/check", json=ref).json() == {"state": "missing"}
    assert client.post(f"{route}/reveal", json=ref).status_code == 409


def test_the_editions_routes_answer_only_for_a_note(client):
    cid = make_case(client)
    place = Case.open(cid).add_entity("place", "Quay", attrs={}, by="user")
    assert client.get(f"/api/cases/{cid}/notes/{place['id']}/editions").status_code == 404
    assert client.get(f"/api/cases/{cid}/notes/nope/editions").status_code == 404
    assert client.get(f"/api/cases/{cid}/notes/case/editions").json() == {"editions": []}


def test_the_file_name_keeps_room_for_its_number_and_its_marker(pinned):
    peers = {"summary": ["n1", "n2"]}
    day = datetime(2026, 3, 12).date()
    assert notes_api._pdf_filename("Rooftop", "n0", {}, "public", day) == "Rooftop - public - 2026-03-12.pdf"
    marked = notes_api._pdf_filename("Summary", "n1", peers, "internal", day)
    assert re.fullmatch(r"Summary \[[0-9a-f]{16}\] - internal - 2026-03-12\.pdf", marked)
    long = notes_api._pdf_filename("Long " * 40, "n0", {}, "internal", day)
    assert long.endswith(" - internal - 2026-03-12.pdf")
    assert len(long) + notes_api.COUNTER_ROOM <= layout.MAX_MEDIA_NAME
    # one edition only: the day alone
    assert notes_api._pdf_filename("Rooftop", "n0", {}, "", day) == "Rooftop - 2026-03-12.pdf"
    alone = notes_api._pdf_filename("Summary", "n1", peers, "", day)
    assert re.fullmatch(r"Summary \[[0-9a-f]{16}\] - 2026-03-12\.pdf", alone)
    assert notelook.CASE_NOTE == notes_api.CASE_NOTE


def test_the_record_travels_with_the_case_in_a_bundle(client, pinned):
    """No schema bump: the record is the note's attr and the case notes' setting, which a
    bundle carries as it carries the note; the PDFs in the case's own exports go too."""
    from azimut.engine import bundles

    cid = make_case(client)
    note = make_note(client, cid, title="Rooftop", content="Public.\n\n> [!internal] Private.\n")
    client.put(f"/api/cases/{cid}/notes", json={"text": "Scratch.\n"})
    client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"], "case"], "edition": "public"})
    before = {key: client.get(f"/api/cases/{cid}/notes/{key}/editions").json()["editions"] for key in (note["id"], "case")}

    exported = bundles.export_case(Case.open(cid))
    destination = Case.create(bundles.imported_name("Notes case"))
    imported = bundles.import_into(destination, exported)["case_id"]
    for key, editions in before.items():
        route = f"/api/cases/{imported}/notes/{key}/editions"
        assert client.get(route).json()["editions"] == editions
        ref = {"at": editions[0]["at"], "file": editions[0]["file"]}
        assert client.post(f"{route}/check", json=ref).json() == {"state": "unchanged"}
