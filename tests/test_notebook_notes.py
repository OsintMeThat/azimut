"""The Notebook's notes read as text: mentions, tasks, search, citations, templates.

The editor writes Markdown; the home, the case search, Details and the To-do read
it back through `engine/notetext.py`, and a save restates what the note points at
as `mentions` edges.
"""

from __future__ import annotations

import pytest

from azimut.engine import notelinks, notetext
from azimut.engine import notes_pdf as pdf_engine
from azimut.workspace import Case

from test_notes_pdf import FakeCase, pdf_text


def make_case(client, name="Notebook case"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def mentions_of(cid, note_id):
    return {
        link["to"]
        for link in Case.open(cid).links_of(note_id)
        if link["type"] == "mentions" and link["from"] == note_id
    }


# -- the text itself -----------------------------------------------------------


def test_mentions_are_read_once_each_in_order():
    text = "[[entity:b1|Quay]] then [[entity:a2|Mast]] and [[entity:b1|Quay]] [[media:m3|clip]]"
    assert notetext.mentioned_ids(text) == ["b1", "a2"]


def test_a_line_is_said_without_its_marks():
    line = "## **Convoy** seen near [[entity:p1|Quay]] ![photo](x.png) [map](https://e.x)"
    assert notetext.plain_line(line) == "Convoy seen near Quay photo map"
    assert notetext.plain_line("> [!confirmed] The mast is the one") == "The mast is the one"
    assert notetext.plain_line("- [ ] Check the date") == "Check the date"


def test_the_excerpt_skips_a_heading_that_repeats_the_title_and_diagrams():
    text = "# Rooftop\n\n```mermaid\nflowchart LR\n  A --> B\n```\nThe water tower stands north."
    assert notetext.excerpt(text, "Rooftop") == "The water tower stands north."
    assert notetext.excerpt("# Ship\nA photo.", "Case notes") == "Ship. A photo."
    assert notetext.word_count(text) == 6


def test_tasks_are_found_outside_code_and_ticked_by_line():
    text = "- [ ] Check the date\n```\n- [ ] not a task\n```\n1. [x] Archive the post\r\n- [ ]   \n"
    found = notetext.tasks(text)
    assert [(task.line, task.done, task.text) for task in found] == [
        (0, False, "Check the date"),
        (4, True, "Archive the post"),
    ]
    ticked = notetext.set_task(text, 0, True, "Check the date")
    assert ticked.splitlines()[0] == "- [x] Check the date"
    # the line ending of a line not touched is kept as it was
    assert "Archive the post\r\n" in ticked
    assert notetext.set_task(ticked, 4, False, "Archive the post").splitlines()[4] == "1. [ ] Archive the post"


def test_a_task_that_moved_is_not_ticked_blindly():
    text = "- [ ] Check the date\n- [ ] Archive\n"
    with pytest.raises(ValueError):
        notetext.set_task(text, 1, True, "Check the date")
    with pytest.raises(ValueError):
        notetext.set_task(text, 9, True, "Check the date")


def test_search_needs_every_word_folds_accents_and_cuts_a_snippet():
    text = "First line.\nThe convoy left Hodeïda at dawn, " + "slowly " * 60 + "north."
    line, snippet = notetext.find(text, "hodeida CONVOY")
    assert line == 1
    assert snippet.startswith("The convoy left Hodeïda")
    assert snippet.endswith("…")
    assert notetext.find(text, "convoy tank") is None
    assert notetext.find(text, "   ") is None


def test_citations_are_the_lines_naming_the_record():
    text = "Intro.\nThe mast at [[entity:p1|Quay]] is red.\n[[media:p1|Quay picture]]\nOther [[entity:p2|X]]"
    assert notetext.citations(text, "p1") == [(1, "The mast at Quay is red."), (2, "Quay picture")]


# -- a save restates what the note points at ------------------------------------


def test_a_save_turns_each_reference_into_a_mention_and_takes_it_back(client):
    cid = make_case(client)
    case = Case.open(cid)
    place = case.add_entity("place", "Quay", {"lat": 1.0, "lon": 2.0}, by="user")
    person = case.add_entity("person", "Driver", {}, by="user")
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "Lead"}).json()

    client.put(
        f"/api/cases/{cid}/notes/{note['id']}",
        json={"text": f"At [[entity:{place['id']}|Quay]], [[entity:{person['id']}|Driver]]."},
    )
    assert mentions_of(cid, note["id"]) == {place["id"], person["id"]}

    client.put(f"/api/cases/{cid}/notes/{note['id']}", json={"text": f"[[entity:{place['id']}|Quay]]"})
    assert mentions_of(cid, note["id"]) == {place["id"]}


def test_a_mention_stated_by_hand_outlives_the_text(client):
    cid = make_case(client)
    case = Case.open(cid)
    place = case.add_entity("place", "Quay", {"lat": 1.0, "lon": 2.0}, by="user")
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "Lead"}).json()
    case.add_link(note["id"], place["id"], "mentions", by="user")

    client.put(f"/api/cases/{cid}/notes/{note['id']}", json={"text": "Nothing named."})

    assert mentions_of(cid, note["id"]) == {place["id"]}


def test_a_note_from_a_template_mentions_what_it_starts_with(client):
    cid = make_case(client)
    place = Case.open(cid).add_entity("place", "Quay", {"lat": 1.0, "lon": 2.0}, by="user")
    note = client.post(
        f"/api/cases/{cid}/notes",
        json={"title": "Lead", "content": f"About [[entity:{place['id']}|Quay]] and [[entity:e_gone|Gone]]"},
    ).json()
    assert mentions_of(cid, note["id"]) == {place["id"]}


# -- the routes the home, the search, Details and the To-do read ----------------


def test_the_index_lists_case_notes_first_with_what_each_card_shows(client):
    cid = make_case(client)
    place = Case.open(cid).add_entity("place", "Quay", {"lat": 1.0, "lon": 2.0}, by="user")
    client.put(f"/api/cases/{cid}/notes", json={"text": "- [ ] Call back\n- [x] Archive\n"})
    note = client.post(
        f"/api/cases/{cid}/notes",
        json={"title": "Rooftop", "folder": "Leads",
              "content": f"# Rooftop\n\nThe tower near [[entity:{place['id']}|Quay]]."},
    ).json()

    items = client.get(f"/api/cases/{cid}/notes/index").json()["items"]

    assert [row["id"] for row in items] == ["case", note["id"]]
    assert items[0]["tasks"] == {"open": 1, "done": 1}
    rooftop = items[1]
    assert rooftop["title"] == "Rooftop" and rooftop["folder"] == "Leads"
    assert rooftop["excerpt"] == "The tower near Quay."
    assert rooftop["mentions"] == 1 and rooftop["words"] == 5
    assert rooftop["updated_at"].endswith("Z")


def test_search_reads_inside_notes_and_their_titles(client):
    cid = make_case(client)
    client.put(f"/api/cases/{cid}/notes", json={"text": "Nothing here.\nThe convoy turned at the café."})
    note = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Convoy route", "content": "Second line\nno match\n"}
    ).json()

    found = client.get(f"/api/cases/{cid}/notes/search", params={"q": "cafe convoy"}).json()
    assert found["total"] == 1
    assert found["items"][0] == {
        "id": "case", "title": "Case notes", "folder": "", "line": 1,
        "snippet": "The convoy turned at the café.",
    }

    by_title = client.get(f"/api/cases/{cid}/notes/search", params={"q": "route"}).json()
    assert [row["id"] for row in by_title["items"]] == [note["id"]]
    assert client.get(f"/api/cases/{cid}/notes/search", params={"q": ""}).json() == {"items": [], "total": 0}


def test_citations_name_each_note_and_the_line(client):
    cid = make_case(client)
    place = Case.open(cid).add_entity("place", "Quay", {"lat": 1.0, "lon": 2.0}, by="user")
    client.put(f"/api/cases/{cid}/notes", json={"text": f"Met at [[entity:{place['id']}|Quay]]."})
    note = client.post(
        f"/api/cases/{cid}/notes",
        json={"title": "Lead", "content": f"Intro\n\n[[entity:{place['id']}|Quay]] is red."},
    ).json()

    items = client.get(f"/api/cases/{cid}/notes/citations/{place['id']}").json()["items"]

    assert [(row["id"], row["lines"]) for row in items] == [
        ("case", [{"line": 0, "text": "Met at Quay."}]),
        (note["id"], [{"line": 2, "text": "Quay is red."}]),
    ]


def test_tasks_are_listed_and_ticked_from_outside_the_editor(client):
    cid = make_case(client)
    note = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Lead", "content": "- [ ] Check the date\n- [x] Done\n"}
    ).json()

    items = client.get(f"/api/cases/{cid}/notes/tasks").json()["items"]
    assert items == [{"id": note["id"], "title": "Lead", "folder": "", "done": 1,
                      "tasks": [{"line": 0, "text": "Check the date"}]}]

    ticked = client.post(
        f"/api/cases/{cid}/notes/{note['id']}/task", json={"line": 0, "text": "Check the date", "done": True}
    )
    assert ticked.status_code == 200
    assert client.get(f"/api/cases/{cid}/notes/{note['id']}").json()["text"].startswith("- [x] Check the date")
    assert client.get(f"/api/cases/{cid}/notes/tasks").json()["items"] == []

    stale = client.post(
        f"/api/cases/{cid}/notes/{note['id']}/task", json={"line": 1, "text": "Check the date", "done": False}
    )
    assert stale.status_code == 409


def test_a_task_in_the_case_notes_is_ticked_too(client):
    cid = make_case(client)
    client.put(f"/api/cases/{cid}/notes", json={"text": "- [ ] Call back\n"})
    response = client.post(f"/api/cases/{cid}/notes/case/task", json={"line": 0, "text": "Call back", "done": True})
    assert response.status_code == 200
    assert client.get(f"/api/cases/{cid}/notes").json()["text"] == "- [x] Call back\n"


# -- templates and the PDF ------------------------------------------------------


def test_a_note_template_keeps_its_body_and_folder(client):
    saved = client.post(
        "/api/templates/note",
        json={"name": "Geolocation", "data": {"body": "## Claim\n\n## Method\n", "folder": "Leads"}},
    )
    assert saved.status_code == 200
    listed = client.get("/api/templates").json()["note"]
    assert [(t["name"], t["data"]) for t in listed] == [
        ("Geolocation", {"body": "## Claim\n\n## Method\n", "folder": "Leads"})
    ]
    too_long = client.post("/api/templates/note", json={"name": "Huge", "data": {"body": "x" * 60_001}})
    assert too_long.status_code == 422


def test_a_callout_prints_its_kind_and_not_its_marker(tmp_path):
    out = pdf_engine.render(
        FakeCase(tmp_path), title="Callouts",
        text="> [!confirmed] The mast matches.\n\n> [!lead]\n> Ask the source.\n\n> [!odd] Kept as written.\n",
    )
    text = pdf_text(out.pdf)
    assert "CONFIRMED" in text and "The mast matches." in text
    assert "LEAD" in text and "Ask the source." in text
    assert "[!confirmed]" not in text and "[!lead]" not in text
    assert "[!odd] Kept as written." in text


# -- notes written before mentions were edges -------------------------------------


def test_an_old_note_gets_its_citations_once_the_case_opens(client):
    """A note written by an earlier Notebook cites records the graph never heard of.
    Opening the case restates them once, without touching the note's file."""
    cid = make_case(client)
    case = Case.open(cid)
    place = case.add_entity("place", "Quay", {"lat": 1.0, "lon": 2.0}, by="user")
    note = case.create_note("Old lead", "", f"Seen at [[entity:{place['id']}|Quay]].\n")
    file = case.resolve_inside(note["attrs"]["path"])
    before = file.read_bytes()
    case.set_setting(notelinks.RESTATED, None)
    assert mentions_of(cid, note["id"]) == set()

    assert client.get(f"/api/cases/{cid}").status_code == 200
    assert mentions_of(cid, note["id"]) == {place["id"]}
    assert file.read_bytes() == before

    # once only: a mention taken away by hand is not put back on the next open
    link = next(link for link in Case.open(cid).links_of(note["id"]) if link["type"] == "mentions")
    Case.open(cid).remove_link(link["id"])
    client.get(f"/api/cases/{cid}")
    assert mentions_of(cid, note["id"]) == set()
