"""The CaseRepository graph contract (Step 1 of docs/STORAGE_AND_PERFORMANCE.md).

These exercise the storage boundary directly, not through the HTTP API, so they
pin the behaviour the SQLite backend must reproduce. The ``repo`` fixture is a
fresh `Case`, which delegates the graph to `SqliteCase` — the only live backend
now that the in-file JSON path is gone (legacy json cases convert to sqlite on
open; see tests/test_migrations.py).
"""

from __future__ import annotations

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


def test_sync_links_restates_a_source_set(repo):
    src = repo.add_entity("proof", "P", {"spec": "proofs/p.json"}, by="user")
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

    proof = repo.add_entity("proof", "P", {"spec": "proofs/p.json"}, by="user")
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
    p = repo.add_entity("person", "Ada Lovelace", by="user")
    repo.add_entity("account", "@ada", by="user")
    sugg = repo.add_entity("person", "Alan Turing", by="user", status="suggested")

    people = repo.page_entities(limit=50, types=["person"])
    assert {e["id"] for e in people["items"]} == {p["id"], sugg["id"]}

    suggested = repo.page_entities(limit=50, status="suggested")
    assert [e["id"] for e in suggested["items"]] == [sugg["id"]]

    hits = repo.page_entities(limit=50, query="lovelace")  # case-insensitive label search
    assert [e["id"] for e in hits["items"]] == [p["id"]]


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
