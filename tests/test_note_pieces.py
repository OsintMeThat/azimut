"""A note handed to Post: its public edition, as the pieces a thread starts from.

The red line is the editions': no internal passage ever leaves, not when the whole
note goes and not when a selection starts inside one, where the `[!internal]` marker
is not in the stretch at all. Below that, each block of the note becomes what the
contract between the Notebook and Post says (`engine/notepieces.py`), a note in
Arabic keeps its words as written, and what stays out is counted once.
"""

from __future__ import annotations

import hashlib
from urllib.parse import quote

import pytest

from azimut.api import notes as notes_api
from azimut.engine import notepieces, notes_markdown, notes_pdf
from azimut.workspace import Case

from sourcesfixture import NOTICE_URL, sourced_case
from test_notes_report import make_case, make_note

VALUES = {"date": "12 March 2026", "name": "", "role": "", "organisation": ""}
NOTHING_LEFT = {"internal": 0, "tables": 0, "diagrams": 0, "other": 0}


def hand(text, case=None, selection=None, **options):
    return notepieces.hand(case, title=options.pop("title", "Lead"), text=text, selection=selection,
                           values=options.pop("values", VALUES), **options)


def said(handed) -> str:
    """Everything the pieces carry, as one text to look for a leak in."""
    return "\n".join(str(value) for piece in handed.pieces for value in piece.values())


def units(text: str, part: str) -> int:
    """Where ``part`` starts in ``text`` as a browser counts it: UTF-16 code units."""
    return len(text[: text.index(part)].encode("utf-16-le")) // 2


def span(text: str, first: str, last: str) -> tuple[int, int]:
    """The browser's selection from the start of ``first`` to the end of ``last``."""
    return units(text, first), units(text, last) + len(last.encode("utf-16-le")) // 2


# -- what becomes what ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "pieces"),
    [
        ("# Findings", [{"kind": "text", "text": "Findings", "heading": True}]),
        ("### A **bold** heading", [{"kind": "text", "text": "A bold heading", "heading": True}]),
        ("Seen *at* the `quay`\non Tuesday.", [{"kind": "text", "text": "Seen at the quay on Tuesday."}]),
        ("Line one  \nline two", [{"kind": "text", "text": "Line one\nline two"}]),
        # a list keeps its lines, a bullet written `*` said as `- `, a list inside two spaces deeper
        ("* one\n* two\n  - inner\n- [ ] a task", [
            {"kind": "text", "text": "- one\n- two\n  - inner"}, {"kind": "text", "text": "- [ ] a task"}]),
        ("3. third\n4. fourth", [{"kind": "text", "text": "3. third\n4. fourth"}]),
        ("> A plain quote\n> on two lines.", [{"kind": "text", "text": "A plain quote on two lines."}]),
        ("> [!unverified] The bridge was hit.", [{"kind": "text", "text": "Unverified: The bridge was hit."}]),
        ("> [!confirmed]\n> Seen from the ridge.\n>\n> - one\n> - two",
         [{"kind": "text", "text": "Confirmed: Seen from the ridge.\n- one\n- two"}]),
        # an unknown kind stays a quote with its marker written, as the PDF leaves it
        ("> [!rumour] Heard at the port.", [{"kind": "text", "text": "[!rumour] Heard at the port."}]),
        ("Seen at [[entity:p1|Berth 12]] by [[entity:a1|@portwatch]].",
         [{"kind": "text", "text": "Seen at Berth 12 by @portwatch."}]),
        ("Read [the notice](https://example.org/notice) first.",
         [{"kind": "text", "text": "Read the notice https://example.org/notice first."}]),
        ("At [https://example.org/a](https://example.org/a).", [{"kind": "text", "text": "At https://example.org/a."}]),
        # a link a reader of the post cannot open keeps its words only
        ("See [the dashboard](http://localhost:8477/x) and [the file](notes/a.md).",
         [{"kind": "text", "text": "See the dashboard and the file."}]),
        ("[The port's notice](https://example.org/notice)",
         [{"kind": "source", "url": "https://example.org/notice", "label": "The port's notice"}]),
        ("[https://example.org/notice](https://example.org/notice)",
         [{"kind": "source", "url": "https://example.org/notice"}]),
        ("https://example.org/bare", [{"kind": "source", "url": "https://example.org/bare"}]),
        ("A ¶ with ~~struck~~ words.", [{"kind": "text", "text": "A ¶ with struck words."}]),
    ],
)
def test_each_block_becomes_its_piece(text, pieces):
    handed = hand(text)
    assert handed.pieces == pieces
    assert handed.left == NOTHING_LEFT


def test_a_note_keeps_its_order_and_its_placeholders_filled():
    text = "# {title}\n\nWritten {date}.\n\n## Next\n\nMore."
    assert hand(text, title="Port strike").pieces == [
        {"kind": "text", "text": "Port strike", "heading": True},
        {"kind": "text", "text": "Written 12 March 2026."},
        {"kind": "text", "text": "Next", "heading": True},
        {"kind": "text", "text": "More."},
    ]


def test_the_cover_corners_page_breaks_and_comments_go_silently():
    text = (
        "# Cover title\n\n::: top-right\nTLP:CLEAR\n:::\n\n<!-- cover -->\n"
        "Body words.\n\n<!-- pagebreak -->\n\n<!-- a comment of the analyst -->\n\n"
        "<!--? Guidance for whoever writes here -->\n\n::: bottom-left\nSigned\n:::\n\n"
        "::: center\nCentred words.\n:::\n\n---\n\nAfter the rule."
    )
    handed = hand(text)
    assert handed.pieces == [
        {"kind": "text", "text": "Body words."},
        {"kind": "text", "text": "Centred words."},
        {"kind": "text", "text": "After the rule."},
    ]
    assert handed.left == NOTHING_LEFT


def test_tables_diagrams_and_code_are_left_out_and_counted():
    text = (
        "Before.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\ngraph TD; A-->B;\n```\n\n"
        "```mermaid\ngraph LR; C-->D;\n```\n\n```python\nprint('x')\n```\n\n    indented code\n\n"
        "<div>raw html</div>\n\n- item\n\n  | c |\n  |---|\n  | 3 |\n\nAfter."
    )
    handed = hand(text)
    assert handed.pieces == [
        {"kind": "text", "text": "Before."}, {"kind": "text", "text": "- item"}, {"kind": "text", "text": "After."}]
    assert handed.left == {"internal": 0, "tables": 2, "diagrams": 2, "other": 3}


def test_a_chapter_goes_with_its_title_as_a_heading():
    chapters = {"c1": ("Chapter one", "Chapter words.\n\n> [!internal] Chapter secret.\n")}
    handed = hand("Intro.\n\n[[include:c1]]\n\n[[include:gone]]\n\nOutro.", resolve=chapters.get)
    assert handed.pieces == [
        {"kind": "text", "text": "Intro."},
        {"kind": "text", "text": "Chapter one", "heading": True},
        {"kind": "text", "text": "Chapter words."},
        {"kind": "text", "text": "Outro."},
    ]
    assert "secret" not in said(handed)
    # the chapter's passage is counted, and the note no longer there is said once
    assert handed.left == {"internal": 1, "tables": 0, "diagrams": 0, "other": 1}


def test_a_note_holds_at_most_as_many_pieces_as_post_takes(monkeypatch):
    monkeypatch.setattr(notepieces, "MAX_PIECES", 3)
    handed = hand("\n\n".join(f"Paragraph {n}." for n in range(5)))
    assert [piece["text"] for piece in handed.pieces] == ["Paragraph 0.", "Paragraph 1.", "Paragraph 2."]
    assert handed.left["other"] == 2


# -- pictures, read in the case ------------------------------------------------------


@pytest.fixture()
def sourced(client):
    cid = make_case(client, "Pieces case")
    case = Case.open(cid)
    return cid, case, sourced_case(case)


def _file(case, path: str, data: bytes, label: str, kind: str):
    case.resolve_inside(path).parent.mkdir(parents=True, exist_ok=True)
    case.resolve_inside(path).write_bytes(data)
    return case.add_entity("media", label, attrs={"path": path, "kind": kind,
                                                  "sha256": hashlib.sha256(data).hexdigest()}, by="user")["id"]


def test_a_picture_a_video_and_a_gif_go_by_their_path_and_type(sourced):
    cid, case, made = sourced
    gif = _file(case, "media/Smoke loop.gif", b"GIF89a fake", "Smoke loop", "image")
    text = (
        f"The frame:\n\n[[media:{made['frame']['id']}|Frame]]{{width=70% align=center}}\n\n"
        f"[[media:{made['video']['id']}|Video]]\n[[media:{gif}|Loop]]\n\n"
        f"![pasted](/files/{quote(cid)}/{quote(made['paste']['path'])})"
    )
    handed = hand(text, case)
    assert handed.pieces == [
        {"kind": "text", "text": "The frame:"},
        {"kind": "media", "path": made["frame"]["path"], "type": "image", "id": made["frame"]["id"]},
        {"kind": "media", "path": made["video"]["path"], "type": "video", "id": made["video"]["id"]},
        {"kind": "media", "path": "media/Smoke loop.gif", "type": "gif", "id": gif},
        {"kind": "media", "path": made["paste"]["path"], "type": "image", "id": made["paste"]["id"]},
    ]
    assert handed.left == NOTHING_LEFT


def test_a_picture_in_words_goes_after_them(sourced):
    _, case, made = sourced
    handed = hand(f"Seen here [[media:{made['photo']['id']}|crane]] at noon.", case)
    assert handed.pieces == [
        {"kind": "text", "text": "Seen here at noon."},
        {"kind": "media", "path": made["photo"]["path"], "type": "image", "id": made["photo"]["id"]},
    ]


def test_a_proofs_picture_goes_as_the_proof(sourced):
    cid, case, made = sourced
    by_reference = hand(f"[[media:{made['proof']['id']}|Proof]]{{width=60%}}", case)
    assert by_reference.pieces == [{"kind": "proof", "name": "Strike geolocated", "id": made["proof"]["id"]}]
    # written as its file, it is the same proof
    by_file = hand(f"![Proof](/files/{quote(cid)}/{quote(made['proof']['path'])})", case)
    assert by_file.pieces == by_reference.pieces


def test_a_saved_proof_is_named_by_its_spec(client):
    cid = make_case(client, "Saved proof")
    case = Case.open(cid)
    case.resolve_inside("proofs/Depot strike.png").parent.mkdir(parents=True, exist_ok=True)
    case.resolve_inside("proofs/Depot strike.png").write_bytes(b"\x89PNG not decoded here")
    proof = case.add_entity("proof", "Depot strike, renamed in Details", attrs={
        "spec": "proofs/.meta/Depot strike.json", "path": "proofs/Depot strike.png"}, by="proof-composer")
    assert hand(f"[[media:{proof['id']}|Depot]]", case).pieces == [
        {"kind": "proof", "name": "Depot strike", "id": proof["id"]}]


def test_pictures_post_cannot_have_are_counted(sourced):
    cid, case, made = sourced
    sound = _file(case, "media/Siren.mp3", b"ID3 not audio", "Siren", "audio")
    gone = _file(case, "media/Gone.png", b"png", "Gone", "image")
    case.resolve_inside("media/Gone.png").unlink()
    text = (
        "Words.\n\n[[media:nosuchid|Deleted]]\n\n![remote](https://example.org/a.png)\n\n"
        f"![logo](azimut:my-logo)\n\n[[media:{sound}|Siren]]\n\n[[media:{gone}|Gone]]\n\n"
        f"![outside](/files/{quote(cid)}/..%2F..%2Fsettings.json)\n\n"
        f"![no file](/files/{quote(cid)}/media/nothing.png)"
    )
    handed = hand(text, case)
    assert handed.pieces == [{"kind": "text", "text": "Words."}]
    assert handed.left == {"internal": 0, "tables": 0, "diagrams": 0, "other": 7}


def test_without_a_case_no_picture_goes():
    handed = hand("[[media:m1|Roof]]")
    assert handed.pieces == [] and handed.left["other"] == 1


# -- the red line: no internal passage leaves -----------------------------------------

SECRET = """# Findings

Public words.

> [!internal] Secret words about the source.
> ## Hidden heading
> See https://leak.example.org/only-internal for the raw feed.
lazy secret line

- public item
  > [!INTERNAL] secret in a list
- next public item

>     [!internal] code in a quote is internal to the editor

> [!confirmed] Kept.
>
> > [!internal] nested secret
>
> after the nested one

More public words.
"""


def test_the_whole_note_carries_no_internal_passage():
    handed = hand(SECRET)
    for trace in ("ecret", "Hidden", "leak.example", "nternal", "INTERNAL", "lazy"):
        assert trace not in said(handed), trace
    assert handed.pieces == [
        {"kind": "text", "text": "Findings", "heading": True},
        {"kind": "text", "text": "Public words."},
        {"kind": "text", "text": "- public item\n- next public item"},
        # the nested passage is blanked whole, which closes the callout around it
        {"kind": "text", "text": "Confirmed: Kept."},
        {"kind": "text", "text": "after the nested one"},
        {"kind": "text", "text": "More public words."},
    ]
    assert handed.left["internal"] == notes_pdf.internal_passages(SECRET) == 4


@pytest.mark.parametrize(
    ("first", "last", "kept", "internal"),
    [
        # starts inside a passage, past its marker: none of it goes
        ("Secret words", "public item", ["- public item"], 1),
        ("## Hidden", "next public item", ["- public item\n- next public item"], 2),
        ("raw feed", "More public words.", [
            "- public item\n- next public item", "Confirmed: Kept.", "after the nested one", "More public words."], 4),
        ("lazy secret", "public item", ["- public item"], 1),
        ("nested secret", "after the nested one", ["after the nested one"], 1),
        # ends inside one
        ("Public words.", "Secret words", ["Public words."], 1),
        # all of it inside one
        ("Secret words", "raw feed", [], 1),
        # touches none
        ("Public words.", "Public words.", ["Public words."], 0),
    ],
)
def test_a_selection_carries_no_internal_passage_wherever_it_starts(first, last, kept, internal):
    selection = span(SECRET, first, last)
    handed = hand(SECRET, selection=selection)
    for trace in ("ecret", "Hidden", "leak.example", "nternal", "INTERNAL", "lazy"):
        assert trace not in said(handed), trace
    assert [piece["text"] for piece in handed.pieces] == kept
    assert handed.left["internal"] == internal


def test_the_stretch_alone_would_have_leaked():
    """What the route guards against: the stretch read on its own has no marker left."""
    start, end = span(SECRET, "Secret words", "raw feed")
    alone = SECRET[start:end]
    assert "[!internal]" not in alone and notes_pdf.internal_passages(alone) == 0
    assert "Secret words" in said(hand(alone))
    assert said(hand(SECRET, selection=(start, end))) == ""


def test_a_selection_in_the_cover_or_past_the_end_hands_nothing_of_it():
    text = "Cover words\n<!-- cover -->\nBody."
    assert hand(text, selection=span(text, "Cover", "Body.")).pieces == [{"kind": "text", "text": "Body."}]
    assert hand(text, selection=(0, 10_000)).pieces == [{"kind": "text", "text": "Body."}]
    assert hand(text, selection=(9_000, 10_000)).pieces == []


def test_a_selection_cut_through_an_aligned_block_leaves_no_fence():
    text = "::: center\nCentred words.\n:::\n\nAfter."
    handed = hand(text, selection=span(text, "Centred", "After."))
    assert [piece["text"] for piece in handed.pieces] == ["Centred words.", "After."]
    assert ":::" not in said(handed)


def test_nothing_goes_when_a_passage_survives_the_stripping(monkeypatch):
    """The belt under the stripping, the public PDF's own: no pieces rather than a leak."""
    monkeypatch.setattr(notes_markdown, "strip_internal", lambda text: (text, 0))
    with pytest.raises(notepieces.NotePiecesError):
        hand(SECRET)


# -- right to left ---------------------------------------------------------------------

ARABIC = """# ضربة على مرفأ الحديدة

شوهد الدخان فوق [[entity:p1|الرصيف ١٢]] صباح الثلاثاء، 14.7980, 42.9540.

- نُشر الفيديو على [حساب الميناء](https://example.org/حساب)
- التاريخ غير مؤكد

> [!unverified] لم نتحقق من الساعة.

> [!internal] مصدر داخلي لا يُنشر.

שלום עולם 🌊 مرحبا بالعالم.
"""


def test_a_note_in_arabic_keeps_its_words_as_written():
    handed = hand(ARABIC)
    assert handed.pieces == [
        {"kind": "text", "text": "ضربة على مرفأ الحديدة", "heading": True},
        {"kind": "text", "text": "شوهد الدخان فوق الرصيف ١٢ صباح الثلاثاء، 14.7980, 42.9540."},
        {"kind": "text", "text": "- نُشر الفيديو على حساب الميناء https://example.org/حساب\n- التاريخ غير مؤكد"},
        {"kind": "text", "text": "Unverified: لم نتحقق من الساعة."},
        {"kind": "text", "text": "שלום עולם 🌊 مرحبا بالعالم."},
    ]
    assert "مصدر داخلي" not in said(handed)
    assert handed.left["internal"] == 1


def test_a_selection_after_an_emoji_is_cut_where_the_browser_said():
    """A browser counts an emoji as two units, Python as one character."""
    text = "🌊🌊 Before.\n\nمرحبا 🌊 بالعالم.\n\nAfter."
    handed = hand(text, selection=span(text, "مرحبا", "بالعالم."))
    assert handed.pieces == [{"kind": "text", "text": "مرحبا 🌊 بالعالم."}]


def test_an_address_that_would_read_back_broken_stays_encoded():
    handed = hand("[Feed](https://example.org/a%0Ab%20c) and [Arabic](https://example.org/%D8%AD)")
    assert handed.pieces == [{"kind": "text", "text": "Feed https://example.org/a%0Ab%20c and Arabic https://example.org/ح"}]


# -- the route ---------------------------------------------------------------------------


def test_the_route_answers_the_title_the_pieces_and_what_stayed_out(client):
    cid = make_case(client, "Route case")
    note = make_note(client, cid, title="Port strike", content="saved words are not what is read")
    text = f"# {{title}}\n\nPublic.\n\n> [!internal] Secret.\n\n[Notice]({NOTICE_URL})\n\n| a |\n|---|\n| 1 |\n"
    answer = client.post(f"/api/cases/{cid}/notes/{note['id']}/pieces", json={"text": text})
    assert answer.status_code == 200, answer.text
    assert answer.json() == {
        "title": "Port strike",
        "pieces": [
            {"kind": "text", "text": "Port strike", "heading": True},
            {"kind": "text", "text": "Public."},
            {"kind": "source", "url": NOTICE_URL, "label": "Notice"},
        ],
        "left": {"internal": 1, "tables": 1, "diagrams": 0, "other": 0},
    }
    # nothing is written: the note on disk is as it was
    assert client.get(f"/api/cases/{cid}/notes/{note['id']}").json()["text"] == "saved words are not what is read"


def test_the_route_cuts_the_selection_out_of_the_whole_note(client):
    cid = make_case(client, "Selection case")
    note = make_note(client, cid)
    start, end = span(SECRET, "Secret words", "public item")
    answer = client.post(f"/api/cases/{cid}/notes/{note['id']}/pieces",
                         json={"text": SECRET, "selection": {"start": start, "end": end}})
    assert answer.status_code == 200, answer.text
    assert answer.json()["pieces"] == [{"kind": "text", "text": "- public item"}]
    assert answer.json()["left"]["internal"] == 1


def test_the_case_notes_go_as_well(client):
    cid = make_case(client, "Case notes")
    answer = client.post(f"/api/cases/{cid}/notes/case/pieces", json={"text": "Log of the day."})
    assert answer.json() == {"title": "Case notes", "pieces": [{"kind": "text", "text": "Log of the day."}],
                             "left": NOTHING_LEFT}


def test_the_route_refuses_what_it_cannot_read(client, monkeypatch):
    cid = make_case(client, "Refusals")
    note = make_note(client, cid)
    road = f"/api/cases/{cid}/notes/{note['id']}/pieces"
    assert client.post(f"/api/cases/{cid}/notes/nosuchnote/pieces", json={"text": "x"}).status_code == 404
    # a proof is not a note
    proof = Case.open(cid).add_entity("proof", "Not a note", attrs={}, by="user")
    assert client.post(f"/api/cases/{cid}/notes/{proof['id']}/pieces", json={"text": "x"}).status_code == 404
    assert client.post(road, json={"text": "x", "selection": {"start": 5, "end": 2}}).status_code == 422
    assert client.post(road, json={"text": "x", "selection": {"start": -1, "end": 2}}).status_code == 422
    monkeypatch.setattr(notes_api, "MAX_NOTE_BODY_BYTES", 64)
    assert client.post(road, json={"text": "é" * 40}).status_code == 413
    monkeypatch.setattr(notes_markdown, "strip_internal", lambda text: (text, 0))
    refused = client.post(road, json={"text": "> [!internal] Secret."})
    assert refused.status_code == 422 and "Secret" not in refused.text


def test_the_body_is_bounded_before_it_is_read(client, monkeypatch):
    cid = make_case(client, "Bounded")
    note = make_note(client, cid)
    monkeypatch.setattr(notes_api, "MAX_NOTE_BODY_BYTES", 32)
    answer = client.post(f"/api/cases/{cid}/notes/{note['id']}/pieces", json={"text": "x" * 200})
    assert answer.status_code == 413 and answer.json()["detail"] == "request body too large"
