"""What changed between two editions of a note.

A public edition keeps the text it printed (`engine/noteeditions.py`): content-addressed
by the SHA-256 its record keeps, once however many formats printed it, the newest ten
per note, owned by the note so the Trash and a bundle carry it. `/editions/compare` reads
two of them, or one and the note now, and says what changed (`engine/notediff.py`): each
figure in a plain sentence, the words paragraph by paragraph. Nothing is written by the
comparison and nothing of it reaches a file.
"""

from __future__ import annotations

import hashlib
import io
from datetime import datetime, timezone

import pytest
from PIL import Image

from azimut import layout
from azimut.api import notes as notes_api
from azimut.engine import artifacts, bundles, notediff, noteeditions, notelook
from azimut.engine import notes_html, notes_markdown
from azimut.workspace import Case

from notecase import make_case, make_note

CHART = """::: chart
kind: bars
title: At least 41 armoured vehicles, by model
count: At least
| Model | At least |
| --- | ---: |
| Streit Cougar | 8 |
| Oshkosh M-ATV | 7 |
:::"""

TABLE = """| Model | Count | Grade |
| --- | ---: | --- |
| Streit Cougar | 8 | confirmed |
| BATT UMG | 2 | confirmed |"""


def _note(picture: str) -> str:
    return (
        "## Summary\n\nTwo videos show at least 60 vehicles, at least 41 of them armoured.\n\n"
        "> [!internal] Our source in Aden said 70.\n\n"
        f"[[media:{picture}|Figure 1]]{{width=100% caption=\"Figure 1. Left behind.\"}}\n\n"
        f"## The count\n\n{TABLE}\n\n{CHART}\n\n## Method\n\nWe counted each vehicle once.\n"
    )


def _picture(client, cid, name, colour):
    data = io.BytesIO()
    Image.new("RGB", (64, 48), colour).save(data, "PNG")
    answer = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, data.getvalue(), "image/png")})
    assert answer.status_code == 200, answer.text
    path = answer.json()["item"]["path"]
    return client.get(f"/api/cases/{cid}/entities/lookup", params={"attr": "path", "value": path}).json()["entity"]["id"]


@pytest.fixture
def article(client):
    cid = make_case(client, "Corrections")
    first = _picture(client, cid, "m-atv.png", (200, 30, 30))
    second = _picture(client, cid, "tygor.png", (30, 30, 200))
    note = make_note(client, cid, title="Front", content=_note(first))
    return {"cid": cid, "note": note["id"], "first": first, "second": second}


def _export(client, cid, note, edition="public", fmt="html", changes=""):
    route = {"html": "html", "pdf": "pdf"}[fmt]
    body = {"notes": [note], "edition": edition}
    if changes:
        body["changes"] = changes
    answer = client.post(f"/api/cases/{cid}/notes/{route}", json=body)
    assert answer.status_code == 200, answer.text
    return answer.json()


def _editions(client, cid, note):
    answer = client.get(f"/api/cases/{cid}/notes/{note}/editions")
    assert answer.status_code == 200, answer.text
    return answer.json()


def _compare(client, cid, note, before, after="now"):
    return client.post(f"/api/cases/{cid}/notes/{note}/editions/compare", json={"before": before, "after": after})


def _save(client, cid, note, text):
    answer = client.put(f"/api/cases/{cid}/notes/{note}", json={"text": text})
    assert answer.status_code == 200, answer.text


def _said(answer) -> list[str]:
    return [sentence["said"] for sentence in answer["sentences"]]


# -- the text kept ----------------------------------------------------------------------


def test_a_public_export_keeps_the_text_it_printed_and_nothing_internal(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    listed = _editions(client, cid, note)
    sha = listed["editions"][0]["text_sha256"]
    assert listed["kept"] == [sha]
    case = Case.open(cid)
    kept = case.resolve_inside(layout.note_edition_text_rel(note, sha))
    text = kept.read_text(encoding="utf-8")
    assert hashlib.sha256(kept.read_bytes()).hexdigest() == sha
    assert "at least 41 of them armoured" in text and "Our source in Aden" not in text
    # what the dialog compares against is what the export printed, to the byte
    now = noteeditions.printed_now(case, title="Front", text=case.read_note(note), look=notelook.stored(case, note),
                                   note_id=note, resolve=notes_markdown.case_resolver(case))
    assert now == text


def test_an_internal_edition_keeps_no_text(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note, edition="internal")
    listed = _editions(client, cid, note)
    assert listed["editions"][0]["edition"] == "internal" and listed["kept"] == []
    assert not Case.open(cid).resolve_inside(layout.note_editions_rel(note)).exists()


def test_one_text_printed_as_a_pdf_and_a_page_is_kept_once(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note, fmt="pdf")
    _export(client, cid, note, fmt="html")
    listed = _editions(client, cid, note)
    assert len(listed["editions"]) == 2 and len(listed["kept"]) == 1
    assert {edition["text_sha256"] for edition in listed["editions"]} == set(listed["kept"])
    folder = Case.open(cid).resolve_inside(layout.note_editions_rel(note))
    assert [path.name for path in folder.iterdir()] == [f"{listed['kept'][0]}.md"]


def test_a_note_keeps_its_newest_texts_and_lets_the_oldest_go(client, article, monkeypatch):
    monkeypatch.setattr(noteeditions, "MAX_KEPT", 2)
    cid, note = article["cid"], article["note"]
    for count in (61, 62, 63):
        _save(client, cid, note, _note(article["first"]).replace("at least 60", f"at least {count}"))
        _export(client, cid, note)
    listed = _editions(client, cid, note)
    texts = [edition["text_sha256"] for edition in listed["editions"]]
    assert len(listed["editions"]) == 3 and listed["kept"] == texts[:2]
    folder = Case.open(cid).resolve_inside(layout.note_editions_rel(note))
    assert sorted(path.stem for path in folder.iterdir()) == sorted(texts[:2])
    # the oldest is still listed, only no longer compared
    assert _compare(client, cid, note, texts[2]).status_code == 404


def test_a_text_too_long_to_keep_is_not_kept(client, article, monkeypatch):
    monkeypatch.setattr(noteeditions, "MAX_TEXT_BYTES", 100)
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    listed = _editions(client, cid, note)
    assert listed["kept"] == []
    assert _compare(client, cid, note, listed["editions"][0]["text_sha256"]).status_code == 404


def test_a_kept_text_whose_bytes_changed_is_never_read_as_an_edition(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    sha = _editions(client, cid, note)["kept"][0]
    case = Case.open(cid)
    path = case.resolve_inside(layout.note_edition_text_rel(note, sha))
    path.write_text(path.read_text(encoding="utf-8") + "\nAdded by hand.", encoding="utf-8")
    assert noteeditions.read(case, note, sha) is None
    assert _compare(client, cid, note, sha).status_code == 404


def test_the_case_notes_keep_theirs_apart(client):
    cid = make_case(client, "Case notes")
    client.put(f"/api/cases/{cid}/notes", json={"text": "# Running notes\n\nAt least 3 trucks.\n"})
    _export(client, cid, "case")
    listed = _editions(client, cid, "case")
    assert len(listed["kept"]) == 1
    assert Case.open(cid).resolve_inside(layout.note_edition_text_rel("case", listed["kept"][0])).is_file()
    client.put(f"/api/cases/{cid}/notes", json={"text": "# Running notes\n\nAt least 4 trucks.\n"})
    answer = _compare(client, cid, "case", listed["kept"][0]).json()
    assert answer["paragraphs"][0]["parts"] == [["=", "At least"], ["-", "3"], ["+", "4"], ["=", "trucks."]]


def test_a_wordpress_draft_keeps_the_text_it_sent(client, article, monkeypatch):
    """A draft's record goes through its own writer: the text it sent is kept the same way."""
    cid, note = article["cid"], article["note"]
    case = Case.open(cid)
    record = {"at": "2026-11-19T10:00:00Z", "edition": "public", "format": "wordpress",
              "site": "https://blog.example.org", "post": 7, "edit": "https://blog.example.org/wp-admin/post.php?post=7",
              "preview": "https://blog.example.org/?p=7", "text_sha256": hashlib.sha256(b"Sent text.").hexdigest()}
    notes_api._record_draft(case, note, record, text="Sent text.")
    assert _editions(client, cid, note)["kept"] == [record["text_sha256"]]


# -- the Trash, a rename, a bundle, the doctor --------------------------------------------


def test_the_texts_go_to_the_trash_with_the_note_and_come_back_with_it(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    sha = _editions(client, cid, note)["kept"][0]
    case = Case.open(cid)
    folder = case.resolve_inside(layout.note_editions_rel(note))
    assert layout.note_editions_rel(note) in artifacts.owned(case, case.get_entity(note))

    group = client.delete(f"/api/cases/{cid}/entities/{note}").json()["trash"]
    assert not folder.exists()
    # the last note's folder gone, nothing is left of the editions under notes/
    assert not case.resolve_inside(f"notes/{layout.NOTE_EDITIONS_DIR}").exists()

    restored = client.post(f"/api/cases/{cid}/trash/{group}/restore")
    assert restored.status_code == 200, restored.text
    assert _editions(client, cid, note)["kept"] == [sha]
    assert _compare(client, cid, note, sha).json()["same"] is True


def test_a_renamed_or_refiled_note_keeps_its_texts(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    sha = _editions(client, cid, note)["kept"][0]
    client.post(f"/api/cases/{cid}/folders", json={"name": "Published"})
    moved = client.patch(f"/api/cases/{cid}/entities/{note}", json={"label": "Front, corrected",
                                                                    "attrs": {"folder": "Published"}})
    assert moved.status_code == 200, moved.text
    assert moved.json()["attrs"]["path"].startswith("notes/Published/")
    assert _editions(client, cid, note)["kept"] == [sha]
    assert _compare(client, cid, note, sha).json()["same"] is True


def test_a_bundle_carries_the_texts_and_the_imported_case_compares(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    sha = _editions(client, cid, note)["kept"][0]
    case = Case.open(cid)
    rel = layout.note_editions_rel(note)
    assert bundles.classify_case_entry(rel) == "bundled"
    landed = Case.open(bundles.import_into(Case.create(bundles.imported_name(case.id)), bundles.export_case(case))["case_id"])
    assert noteeditions.read(landed, note, sha) is not None
    assert _compare(client, landed.id, note, sha).json()["same"] is True


def test_the_doctor_never_reads_a_kept_text_as_a_note(client, article):
    """A database rebuilt from the files files every note again, and no kept text as one."""
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    case = Case.open(cid)
    assert case.resolve_inside(layout.note_editions_rel(note)).is_dir()
    case.db_path.unlink()
    repaired = client.post(f"/api/cases/{cid}/doctor/repair", json={"action": "rebuild"})
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["repair"]["counts"]["notes"] == 1
    paths = [entity["attrs"]["path"] for entity in Case.open(cid).list_entities() if entity.get("type") == "note"]
    assert paths == ["notes/Front.md"]


# -- the comparison, through the route ----------------------------------------------------


def test_the_note_unchanged_since_its_edition_compares_as_the_same(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    sha = _editions(client, cid, note)["kept"][0]
    assert _compare(client, cid, note, sha).json() == {
        "same": True, "sentences": [], "paragraphs": [], "unchanged": 0, "more": 0}


def test_a_correction_is_said_figure_by_figure_and_word_by_word(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    first = _editions(client, cid, note)["kept"][0]
    corrected = (_note(article["second"])
                 .replace("at least 41 of them", "at least 42 of them")
                 .replace("| Streit Cougar | 8 | confirmed |", "| Streit Cougar | 9 | confirmed |")
                 .replace("| Oshkosh M-ATV | 7 |", "| Oshkosh M-ATV | 7 |\n| Harrow Tygor E1 | 1 |"))
    _save(client, cid, note, corrected)
    against_now = _compare(client, cid, note, first)
    assert against_now.status_code == 200, against_now.text
    answer = against_now.json()
    said = _said(answer)
    # in reading order; a count its column calls a floor is said as one
    assert said == [
        "“Figure 1” shows another picture: “tygor” in place of “m-atv”.",
        "In the table under “The count”, the row “Streit Cougar” now reads 9 under “Count”, not 8.",
        "The chart “At least 41 armoured vehicles…” now counts at least 16, not 15.",
        "The chart “At least 41 armoured vehicles…” gains the row “Harrow Tygor E1”.",
    ]
    words = [paragraph for paragraph in answer["paragraphs"] if paragraph["under"] == "Summary"]
    assert words[0]["parts"][1:3] == [["-", "41"], ["+", "42"]]
    assert all("Aden" not in str(paragraph) for paragraph in answer["paragraphs"])
    # the second edition, then the two compared: the same answer as against the note now
    _export(client, cid, note, changes="The count is 42.")
    second = _editions(client, cid, note)["kept"][0]
    assert _compare(client, cid, note, first, second).json() == answer
    # nothing of the comparison went into the page the second export wrote
    page = sorted(layout.subdir(Case.open(cid).path, "exports").glob("*.html"))[-1].read_text(encoding="utf-8")
    assert "shows another picture" not in page and "now counts" not in page


def test_the_compare_route_reads_only_what_the_note_kept(client, article):
    cid, note = article["cid"], article["note"]
    _export(client, cid, note)
    assert _compare(client, cid, note, "f" * 64).status_code == 404
    assert _compare(client, cid, note, "../../etc").status_code == 422
    assert client.post(f"/api/cases/{cid}/notes/{note}/editions/compare",
                       json={"before": "now", "after": "now"}).status_code == 422
    other = make_note(client, cid, title="Other")
    sha = _editions(client, cid, note)["kept"][0]
    # another note's text is not this one's edition
    assert _compare(client, cid, other["id"], sha).status_code == 404


def test_the_note_now_is_what_its_next_html_export_prints(client, article):
    """The page the analyst compares against is the one an export would print: the same
    text, so the same SHA-256 the next record keeps."""
    cid, note = article["cid"], article["note"]
    look = client.put(f"/api/cases/{cid}/notes/{note}/look", json={"style": "report", "cover": {"on": True}})
    assert look.status_code == 200, look.text
    case = Case.open(cid)
    now = noteeditions.printed_now(case, title="Front", text=case.read_note(note), look=notelook.stored(case, note),
                                   note_id=note, resolve=notes_markdown.case_resolver(case),
                                   created=datetime(2026, 11, 19, tzinfo=timezone.utc))
    rendered = notes_html.render(case, title="Front", text=case.read_note(note), look=notelook.stored(case, note),
                                 note_id=note, resolve=notes_markdown.case_resolver(case), public=True, light=True,
                                 created=datetime(2026, 11, 19, tzinfo=timezone.utc))
    assert hashlib.sha256(now.encode("utf-8")).hexdigest() == rendered.text_sha256


# -- the comparison, as text ----------------------------------------------------------------


def test_a_reworded_paragraph_shows_its_words_with_a_little_context():
    old = "## Summary\n\n" + " ".join(f"w{index}" for index in range(40)) + "\n"
    new = old.replace("w20", "twenty")
    answer = notediff.compare(old, new)
    parts = answer.paragraphs[0]["parts"]
    assert parts[0] == ["=", "… " + " ".join(f"w{index}" for index in range(12, 20))]
    assert parts[1:3] == [["-", "w20"], ["+", "twenty"]]
    assert parts[3] == ["=", " ".join(f"w{index}" for index in range(21, 29)) + " …"]
    assert answer.unchanged == 1  # the heading


def test_a_paragraph_rewritten_whole_is_one_taken_out_and_one_added():
    old = "## Method\n\nWe counted each vehicle once.\n\nWe kept no duplicates.\n"
    new = "## Method\n\nA second analyst checked every frame of both videos.\n\nWe kept no duplicates.\n"
    answer = notediff.compare(old, new)
    assert [(paragraph["state"], paragraph["under"]) for paragraph in answer.paragraphs] == [
        ("removed", "Method"), ("added", "Method")]
    assert answer.paragraphs[0]["parts"] == [["-", "We counted each vehicle once."]]


def test_a_link_sent_elsewhere_is_said_even_when_its_words_are_the_same():
    old = "## Sources\n\nAs [BBC, 6 Oct](https://www.bbc.com/a) said.\n"
    new = "## Sources\n\nAs [BBC, 6 Oct](https://www.bbc.com/b) said.\n"
    answer = notediff.compare(old, new)
    assert [sentence["said"] for sentence in answer.sentences] == [
        "In “Sources”, the link “BBC, 6 Oct” now leads to another address."]
    assert answer.paragraphs == []


def test_a_chart_s_kind_title_and_settings_are_said_in_words():
    old = CHART
    new = (CHART.replace("kind: bars", "kind: donut")
           .replace("title: At least 41 armoured vehicles, by model", "title: Armoured vehicles by model")
           .replace("count: At least", "count: At least\norder: Oshkosh M-ATV, Streit Cougar"))
    said = [sentence["said"] for sentence in notediff.compare(old, new).sentences]
    assert "The chart “At least 41 armoured vehicles…” is now titled “Armoured vehicles by model”." in said
    assert "The chart “Armoured vehicles by model” is now drawn as donut, not bars." in said
    assert "The chart “Armoured vehicles by model” changed its order." in said


def test_a_chart_added_or_taken_out_is_one_sentence():
    old = "## Count\n\nWords.\n"
    new = f"## Count\n\nWords.\n\n{CHART}\n"
    assert [s["said"] for s in notediff.compare(old, new).sentences] == [
        "In “Count”, a chart was added: “At least 41 armoured vehicles…”."]
    assert [s["said"] for s in notediff.compare(new, old).sentences] == [
        "The chart “At least 41 armoured vehicles…” was taken out."]


def test_a_row_numbered_by_its_first_column_is_named_by_what_it_is():
    old = "| # | Model | Grade |\n| ---: | --- | --- |\n| 12 | Al-Wahsh | Almost sure |\n| 13 | Al-Wahsh | Almost sure |"
    new = old.replace("| 12 | Al-Wahsh | Almost sure |", "| 12 | Al-Wahsh | Confirmed |")
    assert [s["said"] for s in notediff.compare(old, new).sentences] == [
        "In the first table, the row “12 · Al-Wahsh” now reads Confirmed under “Grade”, not Almost sure."]


def test_a_map_s_settings_are_said_one_by_one():
    old = "::: map\ntitle: The front by day\nlayer: Vehicles\nbase: light\n:::"
    new = "::: map\ntitle: The front by day\nlayer: Vehicles\nlayer: Line\nbase: dark\nlegend: on\n:::"
    assert [s["said"] for s in notediff.compare(old, new).sentences] == [
        "The map “The front by day” changed: layer “Line” added; base now “dark”, not “light”; legend set to “on”."]


def test_an_infographic_s_band_and_its_panels_are_compared():
    old = (":::: infographic\ntitle: At least 60 vehicles lost\nkicker: Bab al-Mandab\n\n" + CHART + "\n::::\n")
    new = old.replace("title: At least 60 vehicles lost", "title: At least 61 vehicles lost").replace(
        "| Oshkosh M-ATV | 7 |", "| Oshkosh M-ATV | 8 |")
    said = [s["said"] for s in notediff.compare(old, new).sentences]
    assert said == [
        "The infographic “At least 61 vehicles lost” changed: title now “At least 61 vehicles lost”, not “At least 60 vehicles lost”.",
        "The chart “At least 41 armoured vehicles…” now counts at least 16, not 15.",
        "In the chart “At least 41 armoured vehicles…”, the row “Oshkosh M-ATV” now reads 8, not 7.",
    ]


def test_a_picture_renamed_captioned_or_moved_on_the_page_is_said_so():
    old = '## Ground\n\n![Wreck at the junction](media/a.jpg){width=50% caption="Figure 2. A wreck."}\n'
    new = '## Ground\n\n![Wreck at the junction](media/a.jpg){width=100% caption="Figure 2. A burnt wreck."}\n'
    answer = notediff.compare(old, new)
    assert [s["said"] for s in answer.sentences] == [
        "The caption of “Wreck at the junction” was rewritten.", "“Wreck at the junction” is laid out differently."]
    assert answer.paragraphs == [{"state": "changed", "under": "Ground", "heading": False, "what": "The caption of “Wreck at the junction”",
                                  "parts": [["=", "Figure 2. A"], ["+", "burnt"], ["=", "wreck."]]}]
    added = notediff.compare("## Ground\n\nWords.\n", "## Ground\n\nWords.\n\n![Wreck](media/b.jpg)\n")
    assert [s["said"] for s in added.sentences] == ["In “Ground”, a picture was added: “Wreck”."]


def test_a_diagram_redrawn_is_one_sentence_and_never_its_source():
    old = "## Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n"
    new = old.replace("A --> B", "A --> C")
    answer = notediff.compare(old, new)
    assert [s["said"] for s in answer.sentences] == ["In “Flow”, a diagram was redrawn."]
    assert answer.paragraphs == []


def test_a_long_comparison_lists_its_first_changes_and_counts_the_rest(monkeypatch):
    monkeypatch.setattr(notediff, "MAX_PARAGRAPHS", 3)
    old = "\n\n".join(f"Paragraph {index} says {index}." for index in range(10))
    new = "\n\n".join(f"Paragraph {index} says {index + 1}." for index in range(10))
    answer = notediff.compare(old, new)
    assert len(answer.paragraphs) == 3 and answer.more == 7


def test_a_key_figure_rewritten_is_that_row_reading_otherwise_in_a_chart_named_by_its_kind():
    old = ("## Key figures\n\n::: chart\nkind: key figures\n| Figure | Words |\n| --- | --- |\n"
           "| at least 60 | vehicles burned |\n| at least 41 | of them armoured |\n:::\n")
    new = old.replace("| at least 41 |", "| at least 42 |")
    assert [s["said"] for s in notediff.compare(old, new).sentences] == [
        "In the key figures chart under “Key figures”, the row “at least 41” now reads “at least 42”."]
