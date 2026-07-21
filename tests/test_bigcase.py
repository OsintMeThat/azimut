"""The synthetic large-case generator produces a valid, deterministic case.

These pin the fixture itself (Step 0 of docs/STORAGE_AND_PERFORMANCE.md) so the
JSON baseline and the later JSON-vs-SQLite contract tests all stress the same
shape. Counts are kept small here; the bench harness runs the real sizes.
"""

from __future__ import annotations

import json

from azimut.engine import links as link_engine
from azimut.workspace import Case
from bigcase import build_big_case


def _build(**kw):
    return build_big_case(
        entities=300, links=400, media=100, notes=20, artifacts=30, **kw
    )


def test_builds_a_case_that_opens_with_matching_counts(tmp_workspace):
    _, summary = _build()

    # Opening the legacy json case migrates it to sqlite; the graph is preserved.
    reopened = Case.open(summary.case_id)
    data = reopened.snapshot()
    assert data["azimut"]["storage"] == "sqlite"
    assert len(data["entities"]) == summary.entities == 300
    assert len(data["links"]) == summary.links
    # entity ids are unique
    ids = [e["id"] for e in data["entities"]]
    assert len(ids) == len(set(ids))


def test_folder_tree_is_well_formed(tmp_workspace):
    case, _ = _build()
    data = case.read()
    folders = set(data["folders"])
    # every folder an entity is filed under exists as a node
    for entity in data["entities"]:
        folder = entity["attrs"].get("folder")
        if folder:
            assert folder in folders
    # and every node carries its ancestors
    for folder in folders:
        parts = folder.split("/")
        for i in range(1, len(parts)):
            assert "/".join(parts[:i]) in folders


def test_notes_are_file_backed_not_inline(tmp_workspace):
    case, _ = _build()
    note_entities = [e for e in case.read()["entities"] if e["type"] == "note"]
    assert note_entities
    for note in note_entities:
        assert "content" not in note["attrs"]  # body lives on disk, not in the graph
        rel = note["attrs"]["path"]
        assert (case.path / rel).read_text(encoding="utf-8").startswith("# Note")


def test_media_sidecars_present_and_some_files_missing(tmp_workspace):
    case, summary = _build(seed=7)
    # the fixture deliberately models missing source files
    assert summary.media_files_missing > 0
    media_dir = case.subdir("media")
    present = list(media_dir.glob("img_*.jpg"))
    sidecars = list(media_dir.glob("*.azimut.json"))
    assert present and len(sidecars) == len(present)
    assert len(present) == summary.media - summary.media_files_missing


def test_derivations_are_valid_and_cascade(tmp_workspace):
    _, summary = _build(seed=3)
    assert summary.depends_on_links > 0
    # open (migrate) the case so the graph API reads it through sqlite
    case = Case.open(summary.case_id)
    data = case.snapshot()
    ids = {e["id"] for e in data["entities"]}
    for link in data["links"]:
        assert link["from"] in ids and link["to"] in ids

    dep = next(lk for lk in data["links"] if lk["type"] == "depends-on")
    session_id, subject_id = dep["from"], dep["to"]
    plan = link_engine.plan_delete(case, subject_id)
    assert session_id in {e["id"] for e in plan["cascade"]}


def test_generation_is_deterministic_for_a_seed(tmp_workspace):
    a, _ = build_big_case(name="Case A", entities=200, links=250, media=60,
                          notes=10, artifacts=20, seed=42)
    b, _ = build_big_case(name="Case B", entities=200, links=250, media=60,
                          notes=10, artifacts=20, seed=42)
    da, db = a.read(), b.read()
    # identical graph regardless of the case name
    assert json.dumps(da["entities"]) == json.dumps(db["entities"])
    assert json.dumps(da["links"]) == json.dumps(db["links"])
