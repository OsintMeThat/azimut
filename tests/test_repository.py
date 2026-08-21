"""The CaseRepository graph contract (Step 1 of docs/STORAGE_AND_PERFORMANCE.md).

These exercise the storage boundary directly, not through the HTTP API, so they
pin the behaviour the SQLite backend must reproduce. The ``repo`` fixture is a
fresh `Case`, which delegates the graph to `SqliteCase` — the only live backend
now that the in-file JSON path is gone (legacy json cases convert to sqlite on
open; see tests/test_migrations.py).
"""

from __future__ import annotations

import threading
from contextlib import contextmanager

import pytest

from azimut.workspace import Case, CaseError


@pytest.fixture()
def repo(tmp_workspace):
    """A fresh case through `Case`, which delegates the graph to `SqliteCase` —
    the only backend now that the live in-file JSON path is gone (legacy json
    cases are converted to sqlite on open, covered in tests/test_migrations.py)."""
    return Case.create("Contract")


def test_add_get_and_list_entities(repo):
    e = repo.add_entity("person", "Ada", {"handle": "@ada"}, by="user")
    assert repo.get_entity(e["id"]) == e
    assert e in repo.list_entities()
    assert repo.get_entity("nope") is None


def test_reads_do_not_expose_stored_state_for_mutation(repo):
    repo.add_entity("person", "Ada", by="user")
    repo.list_entities().clear()  # mutating a read must not touch the store
    assert len(repo.list_entities()) == 1


def test_update_entity_patches_label_attrs_and_status(repo):
    e = repo.add_entity("place", "Kyiv", {"lat": 50.4}, by="user")
    updated = repo.update_entity(e["id"], {"label": "Kyiv Oblast", "attrs": {"lon": 30.5}})
    assert updated["label"] == "Kyiv Oblast"
    # attrs merge rather than replace
    assert updated["attrs"] == {"lat": 50.4, "lon": 30.5}

    repo.update_entity(e["id"], {"status": "suggested"})
    assert repo.get_entity(e["id"])["provenance"]["status"] == "suggested"


def test_remove_entity_drops_its_incident_links(repo):
    a = repo.add_entity("person", "A", by="user")
    b = repo.add_entity("account", "B", by="user")
    repo.add_link(a["id"], b["id"], "owns", by="user")

    repo.remove_entity(b["id"])
    assert repo.get_entity(b["id"]) is None
    assert repo.list_links() == []  # the dangling edge went with it

    with pytest.raises(CaseError):
        repo.remove_entity("missing")


def test_add_link_validates_endpoints_and_dedupes(repo):
    a = repo.add_entity("person", "A", by="user")
    b = repo.add_entity("account", "B", by="user")

    with pytest.raises(CaseError):
        repo.add_link(a["id"], "ghost", "owns", by="user")

    first = repo.add_link(a["id"], b["id"], "owns", by="user", unique=True)
    again = repo.add_link(a["id"], b["id"], "owns", by="user", unique=True)
    assert first["id"] == again["id"]  # unique returns the existing edge
    assert len(repo.list_links()) == 1


def test_update_link_changes_suggestion_status_without_rebuilding_edge(repo):
    media = repo.add_entity("media", "Photo", by="user")
    place = repo.add_entity("place", "Point", by="enrich", status="suggested")
    link = repo.add_link(
        media["id"],
        place["id"],
        "located-at",
        by="enrich",
        status="suggested",
    )

    updated = repo.update_link(link["id"], {"status": "confirmed"})

    assert updated["id"] == link["id"]
    assert updated["provenance"]["by"] == "enrich"
    assert updated["provenance"]["status"] == "confirmed"


def test_sync_links_restates_a_source_set(repo):
    src = repo.add_entity("proof", "P", {"spec": "proofs/.meta/p.json"}, by="user")
    m1 = repo.add_entity("media", "m1", by="user")
    m2 = repo.add_entity("media", "m2", by="user")
    m3 = repo.add_entity("media", "m3", by="user")

    repo.sync_links(src["id"], "derived-from", [m1["id"], m2["id"]], by="user")
    assert {lk["to"] for lk in repo.list_links()} == {m1["id"], m2["id"]}

    # restating drops m1, keeps m2 (same edge id), adds m3
    kept = next(lk for lk in repo.list_links() if lk["to"] == m2["id"])
    repo.sync_links(src["id"], "derived-from", [m2["id"], m3["id"]], by="user")
    tos = {lk["to"] for lk in repo.list_links()}
    assert tos == {m2["id"], m3["id"]}
    still = next(lk for lk in repo.list_links() if lk["to"] == m2["id"])
    assert still["id"] == kept["id"]


def test_sync_links_can_restate_only_what_its_own_author_wrote(repo):
    """A caller whose list is not the whole truth about that type says so, and the edge
    another author wrote outlives the restatement. Without it, a sheet reconciling the
    entities its cells point at deleted the relations somebody stated by hand."""
    sheet = repo.add_entity("sheet", "Worklist", {"path": "sheets/w.csv"}, by="user")
    theirs = repo.add_entity("person", "Ivanov", by="user")
    ours = repo.add_entity("person", "Petrov", by="user")
    by_hand = repo.add_link(sheet["id"], theirs["id"], "mentions", by="user")
    repo.sync_links(sheet["id"], "mentions", [ours["id"]], by="sheet", own_only=True)

    held = {lk["id"]: lk for lk in repo.list_links()}
    assert by_hand["id"] in held
    assert {lk["to"] for lk in held.values()} == {theirs["id"], ours["id"]}

    # and the sheet still lets go of its own
    repo.sync_links(sheet["id"], "mentions", [], by="sheet", own_only=True)
    assert [lk["to"] for lk in repo.list_links()] == [theirs["id"]]


def test_remove_link(repo):
    a = repo.add_entity("person", "A", by="user")
    b = repo.add_entity("account", "B", by="user")
    lk = repo.add_link(a["id"], b["id"], "owns", by="user")
    repo.remove_link(lk["id"])
    assert repo.list_links() == []
    with pytest.raises(CaseError):
        repo.remove_link("missing")


def test_links_of_returns_only_incident_edges(repo):
    a = repo.add_entity("person", "A", by="user")
    b = repo.add_entity("account", "B", by="user")
    c = repo.add_entity("media", "C", by="user")
    ab = repo.add_link(a["id"], b["id"], "owns", by="user")
    ca = repo.add_link(c["id"], a["id"], "derived-from", by="user")
    repo.add_link(b["id"], c["id"], "mentions", by="user")  # touches neither a's pair directly

    incident = {lk["id"] for lk in repo.links_of(a["id"])}
    assert incident == {ab["id"], ca["id"]}  # both endpoints, nothing else
    assert repo.links_of("ghost") == []


def test_derivation_subgraph_walks_the_derived_from_closure(repo):
    from azimut.engine import links as link_engine

    proof = repo.add_entity("proof", "P", {"spec": "proofs/.meta/p.json"}, by="user")
    frame = repo.add_entity("media", "frame", {"path": "media/f.jpg"}, by="user")
    video = repo.add_entity("media", "clip", {"path": "media/c.mp4"}, by="user")
    other = repo.add_entity("media", "unrelated", {"path": "media/o.jpg"}, by="user")
    repo.add_link(proof["id"], frame["id"], "derived-from", by="user")
    repo.add_link(frame["id"], video["id"], "derived-from", by="user")
    repo.add_link(proof["id"], other["id"], "mentions", by="user")  # not a derivation

    sub = link_engine.derivation_subgraph(repo, proof["id"])
    ids = {e["id"] for e in sub["entities"]}
    assert ids == {proof["id"], frame["id"], video["id"]}  # closure, not the mentions edge
    assert other["id"] not in ids
    assert {(lk["from"], lk["to"]) for lk in sub["links"]} == {
        (proof["id"], frame["id"]),
        (frame["id"], video["id"]),
    }
    assert link_engine.derivation_subgraph(repo, "ghost") is None


def test_count_dependents_groups_incoming_edges_by_target(repo):
    capture = repo.add_entity("capture", "worked", {"lat": 50.4}, by="user")
    quiet = repo.add_entity("capture", "untouched", {"lat": 51.5}, by="user")
    photo = repo.add_entity("media", "photo", {"path": "media/x.jpg"}, by="user")
    for name in ("P1", "P2"):
        proof = repo.add_entity("proof", name, {"spec": f"proofs/.meta/{name}.json"}, by="user")
        repo.add_link(proof["id"], capture["id"], "derived-from", by="user")
    repo.add_link(photo["id"], capture["id"], "derived-from", by="user")  # wrong source type
    post = repo.add_entity("post", "draft", {"draft": ".drafts/d.json"}, by="user")
    repo.add_link(post["id"], capture["id"], "mentions", by="user")  # wrong link type

    counts = repo.count_dependents(link_type="derived-from", from_type="proof")
    assert counts == {capture["id"]: 2}  # untouched targets are absent, not zero
    assert quiet["id"] not in counts
    assert repo.count_dependents(link_type="derived-from", from_type="post") == {}


def test_find_entity_by_attr(repo):
    repo.add_entity("media", "photo", {"path": "media/x.jpg"}, by="user")
    found = repo.find_entity(attr="path", value="media/x.jpg")
    assert found is not None and found["label"] == "photo"
    assert repo.find_entity(attr="path", value="media/none.jpg") is None


def test_folders_materialize_ancestors_and_removal_unfiles(repo):
    repo.add_folder("Sources/Telegram")
    assert set(repo.list_folders()) >= {"Sources", "Sources/Telegram"}

    e = repo.add_entity("media", "m", {"folder": "Sources/Telegram"}, by="user")
    repo.remove_folder("Sources")
    assert repo.list_folders() == []
    # the entity survives but is unfiled
    assert "folder" not in repo.get_entity(e["id"])["attrs"]


def test_page_entities_walks_the_whole_catalog_in_order(repo):
    ids = [repo.add_entity("person", f"P{i}", by="user")["id"] for i in range(5)]

    seen: list[str] = []
    cursor = None
    while True:
        page = repo.page_entities(limit=2, cursor=cursor)
        assert len(page["items"]) <= 2  # the page size is honoured
        seen.extend(e["id"] for e in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert seen == ids  # every entity once, in insertion order, no duplicates


def test_page_entities_filters_by_type_status_and_query(repo):
    p = repo.add_entity(
        "person",
        "Ada Lovelace",
        {"folder": "Researchers", "notes": "analytical engine"},
        by="user",
    )
    account = repo.add_entity("account", "@ada", by="user")
    sugg = repo.add_entity("person", "Alan Turing", by="user", status="suggested")

    people = repo.page_entities(limit=50, types=["person"])
    assert {e["id"] for e in people["items"]} == {p["id"], sugg["id"]}

    suggested = repo.page_entities(limit=50, status="suggested")
    assert [e["id"] for e in suggested["items"]] == [sugg["id"]]

    hits = repo.page_entities(limit=50, query="lovelace")  # case-insensitive label search
    assert [e["id"] for e in hits["items"]] == [p["id"]]
    assert [e["id"] for e in repo.page_entities(query="analytical engine")["items"]] == [
        p["id"]
    ]
    assert [e["id"] for e in repo.page_entities(query="researchers")["items"]] == [p["id"]]
    assert [e["id"] for e in repo.page_entities(query="account")["items"]] == [account["id"]]


def test_page_entities_cursor_is_stable_when_an_import_appends(repo):
    first = [repo.add_entity("person", f"P{i}", by="user")["id"] for i in range(3)]
    page1 = repo.page_entities(limit=2)
    assert [e["id"] for e in page1["items"]] == first[:2]

    # a background import lands a new entity between the two page reads
    late = repo.add_entity("person", "Late", by="user")["id"]

    page2 = repo.page_entities(limit=2, cursor=page1["next_cursor"])
    rest = [e["id"] for e in page2["items"]]
    # the page already seen is not reshuffled, and the late row is not lost
    assert first[2] in rest
    assert first[0] not in rest and first[1] not in rest

    seen = [e["id"] for e in page1["items"]] + rest
    cursor = page2["next_cursor"]
    while cursor is not None:
        page = repo.page_entities(limit=2, cursor=cursor)
        seen.extend(e["id"] for e in page["items"])
        cursor = page["next_cursor"]
    assert sorted(seen) == sorted(first + [late]) and len(seen) == len(set(seen))


def test_catalog_summary_counts_by_type_and_status(repo):
    repo.add_entity("person", "A", by="user")
    repo.add_entity("person", "B", by="user", status="suggested")
    repo.add_entity("account", "C", by="user")

    summary = repo.catalog_summary()
    assert summary["total"] == 3
    assert summary["by_type"] == {"person": 2, "account": 1}
    assert summary["by_status"] == {"confirmed": 2, "suggested": 1}


def test_page_entities_filters_by_folder_and_unfiled(repo):
    repo.add_folder("Sources/Telegram")
    filed = repo.add_entity("media", "m1", {"folder": "Sources/Telegram"}, by="user")
    loose = repo.add_entity("media", "m2", by="user")

    in_folder = repo.page_entities(limit=50, folder="Sources/Telegram")
    assert [e["id"] for e in in_folder["items"]] == [filed["id"]]

    unfiled = repo.page_entities(limit=50, unfiled=True)
    assert [e["id"] for e in unfiled["items"]] == [loose["id"]]


def test_page_entities_can_include_descendant_folders(repo):
    parent = repo.add_entity("media", "parent", {"folder": "Sources"}, by="user")
    child = repo.add_entity(
        "media", "child", {"folder": "Sources/Telegram"}, by="user"
    )
    repo.add_entity("media", "other", {"folder": "Research"}, by="user")

    exact = repo.page_entities(folder="Sources")
    recursive = repo.page_entities(folder="Sources", recursive=True)

    assert [e["id"] for e in exact["items"]] == [parent["id"]]
    assert [e["id"] for e in recursive["items"]] == [parent["id"], child["id"]]


def test_page_entities_folder_filter_follows_an_edit(repo):
    e = repo.add_entity("media", "m", {"folder": "A"}, by="user")
    repo.add_entity("media", "other", {"folder": "B"}, by="user")

    repo.update_entity(e["id"], {"attrs": {"folder": "B"}})  # move it A -> B
    assert e["id"] in {x["id"] for x in repo.page_entities(limit=50, folder="B")["items"]}
    assert repo.page_entities(limit=50, folder="A")["items"] == []


def test_catalog_summary_counts_by_folder(repo):
    repo.add_entity("media", "a", {"folder": "X"}, by="user")
    repo.add_entity("media", "b", {"folder": "X"}, by="user")
    repo.add_entity("media", "c", by="user")  # unfiled — not counted under a folder

    assert repo.catalog_summary()["by_folder"] == {"X": 2}


# -- filtering on a field, and on having a neighbour ---------------------------
#
# Until these, a case could show every video and every place and never the set that
# is both: `kind=video` was not expressible anywhere in the app.


def test_the_store_that_ships_can_read_inside_a_stored_field():
    """The exact path is the one that ships, proved per platform rather than assumed.

    The extension set is per-binary (docs/STORAGE_AND_PERFORMANCE.md), so this runs in
    CI on Windows, macOS, Linux and the 3.11 floor. The `LIKE` fallback beside it is
    belt and braces, and it matches at any depth where this is top-level exact — so if
    this ever fails on a platform, that difference is what ships there.
    """
    from azimut.store import filters

    assert filters._has_json1() is True


def test_page_entities_filters_on_one_stored_field(repo):
    video = repo.add_entity("media", "clip", {"kind": "video"}, by="user")
    repo.add_entity("media", "still", {"kind": "image"}, by="user")

    page = repo.page_entities(limit=50, attr="kind", attr_value="video")
    assert [e["id"] for e in page["items"]] == [video["id"]]
    assert page["total"] == 1


def test_a_field_filter_reaches_what_the_vocabulary_does_not_declare(repo):
    """`kind` is written by the importer and declared nowhere, and it is the field an
    analyst most wants to filter on. A registry-driven menu would never offer it."""
    from azimut.engine import entities as entity_engine

    assert entity_engine.entity_type("media").attrs == ()
    repo.add_entity("media", "clip", {"kind": "video"}, by="user")

    assert repo.page_entities(attr="kind", attr_value="video")["total"] == 1


def test_a_number_in_a_field_is_matched_as_the_menu_spells_it(repo):
    """The value select offers text, so both sides of the control have to agree on the
    spelling. `100` also matching `1000` is the classic form of getting this wrong."""
    hundred = repo.add_entity("place", "block", {"radius_m": 100}, by="user")
    repo.add_entity("place", "town", {"radius_m": 1000}, by="user")

    page = repo.page_entities(attr="radius_m", attr_value="100")
    assert [e["id"] for e in page["items"]] == [hundred["id"]]


def test_a_field_name_the_store_cannot_ask_for_is_refused(repo):
    """The key reaches SQL inside a JSON path, which the database parses rather than
    binds, so the character set is closed instead of escaped."""
    with pytest.raises(CaseError):
        repo.page_entities(attr='kind"] or 1=1 --', attr_value="video")


def test_choosing_a_field_without_a_value_is_not_a_term(repo):
    """Half of one act: the field is picked, the value select has just been populated.
    Read as a term, the table would empty itself between two clicks."""
    repo.add_entity("media", "clip", {"kind": "video"}, by="user")

    assert repo.page_entities(attr="kind")["total"] == 1


def test_page_entities_filters_on_having_a_neighbour(repo):
    """*Which videos have coordinates* is this test and the field filter together, and
    the count is the answer: the page is which ones."""
    placed = repo.add_entity("media", "clip", {"kind": "video"}, by="user")
    loose = repo.add_entity("media", "orphan", {"kind": "video"}, by="user")
    place = repo.add_entity("place", "quay", {"lat": 1.0, "lon": 2.0}, by="user")
    repo.add_link(placed["id"], place["id"], "located-at", by="user")

    page = repo.page_entities(types=["media"], attr="kind", attr_value="video", linked="place")
    assert [e["id"] for e in page["items"]] == [placed["id"]]
    assert page["total"] == 1
    assert loose["id"] not in {e["id"] for e in page["items"]}


def test_having_a_neighbour_reads_the_pair_not_the_direction(repo):
    """"Linked to a place" is a question about the pair. Which end states the verb is a
    property of the vocabulary, and the analyst is not asking about the vocabulary."""
    place = repo.add_entity("place", "quay", {"lat": 1.0, "lon": 2.0}, by="user")
    media = repo.add_entity("media", "clip", {"path": "media/clip.mp4"}, by="user")
    repo.add_link(media["id"], place["id"], "located-at", by="user")

    assert repo.page_entities(types=["place"], linked="media")["total"] == 1
    assert repo.page_entities(types=["media"], linked="place")["total"] == 1


def test_attr_facets_offer_the_fields_and_values_the_case_holds(repo):
    repo.add_entity("media", "a", {"kind": "video", "path": "media/a.mp4"}, by="user")
    repo.add_entity("media", "b", {"kind": "video", "path": "media/b.mp4"}, by="user")
    repo.add_entity("media", "c", {"kind": "image", "path": "media/c.jpg"}, by="user")
    repo.add_entity("person", "d", {"nationality": "FR"}, by="user")

    facets = {row["key"]: row for row in repo.attr_facets(types=["media"])}
    assert "nationality" not in facets  # narrowed to the type the menu is filtering
    assert facets["kind"]["entities"] == 3
    # Commonest value first, so the menu opens on the answer rather than on the
    # alphabet.
    assert facets["kind"]["values"] == [
        {"value": "video", "count": 2},
        {"value": "image", "count": 1},
    ]


def test_a_field_with_too_many_values_is_not_offered_as_a_menu(repo):
    """A select over five thousand file paths is not a way to choose, and offering it
    would be the typed query this app refuses. It says it was cut."""
    for n in range(6):
        repo.add_entity("media", f"m{n}", {"path": f"media/{n}.mp4"}, by="user")

    facets = {row["key"]: row for row in repo.attr_facets(types=["media"], limit=3)}
    assert facets["path"]["truncated"] is True
    assert facets["path"]["values"] == []
    assert facets["path"]["entities"] == 6


def test_a_value_a_menu_cannot_show_is_not_offered(repo):
    """A footprint is a shape and a quoted paragraph is a stored value; neither is a
    choice. A boolean is left out because the two sides of the control would not agree
    on how to spell it."""
    ring = [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [0.0, 0.0]]
    repo.add_entity(
        "place", "shape",
        {
            "footprint": {"type": "Polygon", "coordinates": [ring]},
            "verbatim": "x" * 500,
            "flagged": True,
            "radius_m": 25,
        },
        by="user",
    )

    facets = {row["key"]: row for row in repo.attr_facets()}
    assert set(facets) == {"radius_m"}
    assert facets["radius_m"]["values"] == [{"value": "25", "count": 1}]


def test_the_field_filter_answers_the_same_without_json1(repo, monkeypatch):
    """The fallback is what a binary whose SQLite lacks JSON1 would run, so it is
    exercised on every platform rather than only where it might one day be needed."""
    from azimut.store import filters

    monkeypatch.setattr(filters, "_has_json1", lambda: False)
    video = repo.add_entity("media", "clip", {"kind": "video"}, by="user")
    repo.add_entity("media", "still", {"kind": "image"}, by="user")
    hundred = repo.add_entity("place", "block", {"radius_m": 100}, by="user")
    repo.add_entity("place", "town", {"radius_m": 1000}, by="user")

    assert [e["id"] for e in repo.page_entities(attr="kind", attr_value="video")["items"]] == [
        video["id"]
    ]
    assert [
        e["id"] for e in repo.page_entities(attr="radius_m", attr_value="100")["items"]
    ] == [hundred["id"]]


def test_snapshot_carries_manifest_and_graph(repo):
    repo.add_entity("person", "Ada", by="user")
    snap = repo.snapshot()
    assert snap["name"] == "Contract"
    assert isinstance(snap["entities"], list) and len(snap["entities"]) == 1
    assert isinstance(snap["links"], list)
    assert isinstance(snap["folders"], list)


# -- durable jobs (thumbnail and background-job model) ---------------------


def test_enqueue_is_idempotent_on_key(repo):
    first = repo.enqueue_job("thumbnail", key="media/a.jpg", payload={"path": "media/a.jpg"})
    again = repo.enqueue_job("thumbnail", key="media/a.jpg")
    assert first["id"] == again["id"]  # a keyed re-enqueue never stacks a duplicate
    assert repo.count_jobs() == {"queued": 1}
    # a different key is a distinct job
    repo.enqueue_job("thumbnail", key="media/b.jpg")
    assert repo.count_jobs() == {"queued": 2}
    repo.enqueue_job("enrich", key="media/a.jpg")
    assert repo.count_jobs() == {"queued": 3}
    assert repo.count_jobs(kind="thumbnail") == {"queued": 2}
    assert repo.count_jobs(kind="enrich") == {"queued": 1}


def test_replace_path_references_updates_exact_structured_values(repo):
    old = "media/before.png"
    new = "media/After.png"
    sentence = f"Prose mentions {old} and must remain unchanged."
    entity = repo.add_entity(
        "bookmark",
        "Reference",
        {"path": old, "nested": [old, {"again": old}], "notes": sentence},
        by="user",
    )
    job = repo.enqueue_job(
        "thumbnail",
        key=old,
        payload={"path": old, "nested": [old], "notes": sentence},
    )

    repo.replace_path_references(old, new)

    attrs = repo.get_entity(entity["id"])["attrs"]
    assert attrs["path"] == new
    assert attrs["nested"] == [new, {"again": new}]
    assert attrs["notes"] == sentence
    queued = repo.get_job(job["id"])
    assert queued["key"] == new
    assert queued["payload"] == {"path": new, "nested": [new], "notes": sentence}


def test_claim_takes_one_queued_job_oldest_first(repo):
    a = repo.enqueue_job("thumbnail", key="media/a.jpg")
    repo.enqueue_job("thumbnail", key="media/b.jpg")

    claimed = repo.claim_job(kinds=["thumbnail"])
    assert claimed["id"] == a["id"]  # oldest first
    assert claimed["state"] == "running" and claimed["attempts"] == 1

    # kind filter excludes other kinds
    repo.enqueue_job("exif", key="media/a.jpg")
    assert repo.claim_job(kinds=["nonesuch"]) is None


def test_fail_retries_until_the_budget_then_fails(repo):
    job = repo.enqueue_job("thumbnail", key="media/a.jpg", max_attempts=2)
    c1 = repo.claim_job()
    after1 = repo.fail_job(c1["id"], "boom")
    assert after1["state"] == "queued"  # attempt 1 of 2 — retry
    c2 = repo.claim_job()
    after2 = repo.fail_job(c2["id"], "boom again")
    assert after2["state"] == "failed" and after2["attempts"] == 2
    assert after2["error"] == "boom again"
    assert repo.claim_job() is None  # nothing queued once it has failed for good
    assert job["id"] == after2["id"]


def test_complete_and_cancel_are_terminal(repo):
    a = repo.enqueue_job("thumbnail", key="media/a.jpg")
    b = repo.enqueue_job("thumbnail", key="media/b.jpg")
    repo.claim_job()  # a -> running
    repo.complete_job(a["id"])
    repo.cancel_job(b["id"])
    assert repo.get_job(a["id"])["state"] == "ready"
    assert repo.get_job(b["id"])["state"] == "cancelled"
    assert repo.claim_job() is None


def test_reenqueue_resurrects_a_finished_job(repo):
    a = repo.enqueue_job("thumbnail", key="media/a.jpg")
    repo.claim_job()
    repo.complete_job(a["id"])
    again = repo.enqueue_job("thumbnail", key="media/a.jpg")  # regenerate
    assert again["id"] == a["id"] and again["state"] == "queued" and again["attempts"] == 0


def test_recover_returns_interrupted_running_jobs(repo):
    a = repo.enqueue_job("thumbnail", key="media/a.jpg")
    b = repo.enqueue_job("thumbnail", key="media/b.jpg", max_attempts=1)
    repo.claim_job()  # a -> running, attempts 1 (< max, recoverable)
    # b has spent its single attempt already
    repo.claim_job()  # b -> running, attempts 1 (== max, unrecoverable)

    assert repo.recover_jobs() == 2
    assert repo.get_job(a["id"])["state"] == "queued"
    assert repo.get_job(b["id"])["state"] == "failed"


def test_prune_drops_only_terminal_jobs(repo):
    done = repo.enqueue_job("thumbnail", key="media/a.jpg")
    repo.claim_job()
    repo.complete_job(done["id"])
    live = repo.enqueue_job("thumbnail", key="media/b.jpg")

    assert repo.prune_jobs() == 1  # the ready one goes, the queued one stays
    assert [j["id"] for j in repo.list_jobs()] == [live["id"]]


def test_count_incident_links_groups_relations_in_either_direction(repo):
    """The bulk "has this row relations?" read behind the map popup: the saved
    index is loaded whole on case open, so it carries a count and lets the popup
    fetch the edges. Excluding the chain types leaves exactly what `chain_of`
    reports as relations, which is what keeps the two from disagreeing."""
    photo = repo.add_entity("media", "photo", {"path": "media/x.jpg"}, by="user")
    other = repo.add_entity("media", "other", {"path": "media/y.jpg"}, by="user")
    place = repo.add_entity("place", "point", {"lat": 48.0}, by="user")
    quiet = repo.add_entity("place", "untouched", {"lat": 49.0}, by="user")
    proof = repo.add_entity("proof", "P", {"spec": "proofs/.meta/p.json"}, by="user")

    repo.add_link(photo["id"], place["id"], "located-at", by="enrich", status="suggested")
    repo.add_link(photo["id"], other["id"], "same-image-as", by="enrich", status="suggested")
    repo.add_link(proof["id"], photo["id"], "derived-from", by="user")  # chain, excluded

    counts = repo.count_incident_links(exclude_types=["derived-from", "depends-on"])

    assert counts[photo["id"]] == 2  # counted at either end
    assert counts[place["id"]] == 1
    assert counts[other["id"]] == 1
    assert quiet["id"] not in counts  # untouched rows are absent, not zero
    assert proof["id"] not in counts

    # excluding nothing counts every edge, chain included
    assert repo.count_incident_links(exclude_types=[])[proof["id"]] == 1


def test_links_among_holds_an_edge_whose_ends_bind_in_two_statements(repo):
    """The closed set must not thin out as the set it closes over grows.

    An id set larger than one SQL statement can bind cannot go into an ``IN (…)``,
    and an edge with **both** ends in the set has ends that can fall in two different
    chunks of it. Asked chunk by chunk, no chunk held such an edge and neither did the
    answer: a drawn view past the chunk size lost most of its edges, its nodes drew as
    unconnected dots, and each one went on reporting the lost edges as connections
    still to open under a control that could never bring one in.
    """
    from azimut.store.sql import _ID_CHUNK

    hub = repo.add_entity("person", "hub", by="user")["id"]
    # One chunk over the boundary, so the star's arms are bound in three statements
    # while the hub is bound in one.
    spokes = [
        repo.add_entity("person", f"spoke {i:04d}", by="user")["id"]
        for i in range(_ID_CHUNK * 2 + 1)
    ]
    for spoke in spokes:
        repo.add_link(hub, spoke, "owns", by="user")

    among = repo.links_among([hub, *spokes])

    assert len(among) == len(spokes)
    # Recorded order survives being read in several statements: parallel edges are
    # bowed to their own side of the line in payload order, so a set of edges that
    # came back shuffled would redraw the picture differently on every read.
    assert among == repo.links_among([hub, *spokes])
    assert [link["id"] for link in among] == [
        link["id"] for link in repo.list_links() if link["from"] == hub
    ]
    # Still closed: an id nobody passed in cannot arrive at the far end of an edge.
    assert repo.links_among([hub, *spokes[:3]]) == among[:3]


@contextmanager
def _statements(case):
    """Every SQL statement one case runs, in order. What proves a read is bounded."""
    seen: list[str] = []
    plain = case._sqlite._connect

    @contextmanager
    def traced():
        with plain() as conn:
            conn.set_trace_callback(seen.append)
            yield conn

    case._sqlite._connect = traced
    try:
        yield seen
    finally:
        del case._sqlite._connect


def test_the_closed_set_costs_one_statement_whatever_the_drawing_holds(repo):
    """The cost the node ceiling was hiding rather than removing.

    Closing over an id set by asking every **pair** of chunks is the square of the
    set: nine statements at 650 nodes, four hundred at 5 000. Lifting the ceiling on
    top of that would have moved the freeze from the canvas to the database, which is
    why this lands with the limit and not after it.
    """
    from azimut.store.sql import _ID_CHUNK

    hub = repo.add_entity("person", "hub", by="user")["id"]
    spokes = [
        repo.add_entity("person", f"spoke {i:04d}", by="user")["id"]
        for i in range(_ID_CHUNK * 3)
    ]
    for spoke in spokes:
        repo.add_link(hub, spoke, "owns", by="user")

    with _statements(repo) as ran:
        among = repo.links_among([hub, *spokes])

    assert len(among) == len(spokes)
    # Four chunks would have been sixteen statements. The scope table is filled with
    # one `executemany`, and the question itself is asked once.
    reads = [sql for sql in ran if sql.lstrip().upper().startswith("SELECT")]
    assert len(reads) == 1
    assert "JOIN scope" in reads[0]


def test_one_hop_costs_one_statement_too(repo):
    """The open set could always be chunked, and is asked through the same table."""
    from azimut.store.sql import _ID_CHUNK

    hub = repo.add_entity("person", "hub", by="user")["id"]
    spokes = [
        repo.add_entity("person", f"spoke {i:04d}", by="user")["id"]
        for i in range(_ID_CHUNK * 2)
    ]
    for spoke in spokes:
        repo.add_link(hub, spoke, "owns", by="user")

    with _statements(repo) as ran:
        touching = repo.links_touching(spokes)

    assert len(touching) == len(spokes)
    assert len([sql for sql in ran if sql.lstrip().upper().startswith("SELECT")]) == 1


def test_the_scope_table_does_not_survive_the_read_that_filled_it(repo):
    """A temp table left standing would answer the next question with the last one's
    ids. It belongs to the connection, and each read opens its own."""
    from azimut.store.sql import _SCOPE

    hub = repo.add_entity("person", "hub", by="user")["id"]
    other = repo.add_entity("person", "other", by="user")["id"]
    repo.add_link(hub, other, "owns", by="user")
    assert len(repo.links_among([hub, other])) == 1

    with repo._sqlite._connect() as conn:
        left = conn.execute(
            "SELECT name FROM temp.sqlite_master WHERE name = ?", (_SCOPE,)
        ).fetchall()
    assert left == []

    # And two reads in a row see their own set, not the one before it.
    assert repo.links_among([hub]) == []
    assert len(repo.links_among([hub, other])) == 1


def test_every_case_wide_ordering_is_served_by_an_index(repo):
    """The catalog orders the *whole case* by identity and by when a row was filed,
    so those two pages have to cost what a page costs and not what the case costs.

    Without an index behind the ordering the keyset cursor bounds what comes back
    and not what it takes to find it: SQLite reads the filtered set and sorts it in
    a temp B-tree for every page. This holds the plan to the index, in both
    directions and with a cursor in hand, which is the shape a second page runs.
    """
    from azimut.store.cursors import _PAGE_ORDERS

    repo.add_entity("person", "Ada", by="user")
    plans: dict[str, list[str]] = {}
    with repo._sqlite._connect() as conn:
        for order, (expression, _key, descending) in _PAGE_ORDERS.items():
            way = "<" if descending else ">"
            direction = "DESC" if descending else "ASC"
            sql = (
                "SELECT rowid AS _rowid, * FROM entities"
                f" WHERE ({expression} {way} ? OR ({expression} = ? AND rowid {way} ?))"
                f" ORDER BY {expression} {direction}, rowid {direction} LIMIT ?"
            )
            plans[order] = [
                row[-1] for row in conn.execute(
                    "EXPLAIN QUERY PLAN " + sql, ("a", "a", 1, 101)
                )
            ]

    assert set(plans) == set(_PAGE_ORDERS)
    for order, plan in plans.items():
        detail = " | ".join(plan)
        assert "TEMP B-TREE" not in detail.upper(), f"{order} sorts in memory: {detail}"
        assert "USING INDEX" in detail.upper(), f"{order} has no index to walk: {detail}"


def test_an_ordered_page_reads_the_case_in_order_and_pages_without_repeating(repo):
    """The ordering covers the whole case rather than the page, and the cursor keys
    on the sort plus the row's own seat, so the second page starts where the first
    stopped even when two rows share a label."""
    for label in ("delta", "Alpha", "charlie", "Alpha", "bravo"):
        repo.add_entity("person", label, by="user")

    first = repo.page_entities(limit=2, order="label")
    second = repo.page_entities(limit=2, cursor=first["next_cursor"], order="label")
    third = repo.page_entities(limit=2, cursor=second["next_cursor"], order="label")

    seen = [e["label"] for e in (*first["items"], *second["items"], *third["items"])]
    assert seen == ["Alpha", "Alpha", "bravo", "charlie", "delta"]
    assert first["total"] == 5
    assert third["next_cursor"] is None
    assert [e["label"] for e in repo.page_entities(order="-label")["items"]] == [
        "delta", "charlie", "bravo", "Alpha", "Alpha",
    ]


# -- writing several things as one ---------------------------------------------


def test_a_batch_commits_everything_inside_it(repo):
    """The plain case: a handful of writes, one transaction, all of them there."""
    with repo.batch():
        person = repo.add_entity("person", "Ada", by="user")
        unit = repo.add_entity("organization", "3rd Brigade", by="user")
        repo.add_link(person["id"], unit["id"], "member-of", by="user")

    assert [e["label"] for e in repo.list_entities()] == ["Ada", "3rd Brigade"]
    assert [link["type"] for link in repo.list_links()] == ["member-of"]


def test_a_failed_batch_leaves_the_case_exactly_as_it_was(repo):
    """What the primitive exists for. Thirty-nine writes and a fortieth that raises
    used to leave thirty-nine standing; the case is now either before or after."""
    kept = repo.add_entity("person", "Already here", by="user")

    with pytest.raises(CaseError):
        with repo.batch():
            for index in range(39):
                repo.add_entity("person", f"Promoted {index}", by="user")
            repo.add_link(kept["id"], "no-such-entity", "member-of", by="user")

    assert [e["label"] for e in repo.list_entities()] == ["Already here"]
    assert repo.list_links() == []


def test_a_batch_sees_what_it_has_written(repo):
    """A planner writes an entity and immediately links it, so the read has to run on
    the batch's own connection: another one would be looking at the file as it was."""
    with repo.batch():
        person = repo.add_entity("person", "Ada", by="user")
        assert repo.get_entity(person["id"])["label"] == "Ada"
        assert repo.entity_count() == 1


def test_a_batch_is_invisible_to_another_thread_until_it_commits(repo):
    """Two promises in one: uncommitted rows belong to the batch and to nothing else,
    and the batch's connection is the batch thread's own. One handle is shared by the
    request threads and the job worker, so a batch that leaked its connection sideways
    would hand another thread an open transaction and raise from somewhere unrelated."""
    seen: list[int] = []

    def elsewhere() -> None:
        seen.append(repo.entity_count())

    with repo.batch():
        repo.add_entity("person", "Ada", by="user")
        reader = threading.Thread(target=elsewhere)
        reader.start()
        reader.join()

    assert seen == [0]
    assert repo.entity_count() == 1


def test_a_batch_does_not_nest(repo):
    """An inner batch would either commit early and break the outer promise or do
    nothing and break its own, so it says which caller is wrong instead."""
    with pytest.raises(CaseError):
        with repo.batch():
            with repo.batch():
                pass


def test_a_batch_that_raised_can_be_followed_by_another(repo):
    """The ambient connection is cleared on the way out however the way out went, or
    the first failure would poison every write the case sees afterwards."""
    with pytest.raises(CaseError):
        with repo.batch():
            repo.add_link("nope", "nope-either", "member-of", by="user")

    with repo.batch():
        repo.add_entity("person", "Ada", by="user")
    assert repo.entity_count() == 1
