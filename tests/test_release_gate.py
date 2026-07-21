"""Release gate for the storage migration (docs/STORAGE_AND_PERFORMANCE.md
step 7).

The doc's release gate is part manual (record the reference-machine numbers, dry-
run real disposable cases) and part automatable. This file pins the automatable
checks so they run on the CI matrix (three OSes + the 3.11 floor) on every change:

- a legacy json case migrates and every current workflow still answers;
- a *closed* case folder copy opens identically — the "case bundle / copy is
  complete" guarantee (rollback journal, no WAL to checkpoint);
- a large migrated case opens through bounded queries, never shipping its graph;
- the frozen-binary packaging constraints hold (static bundled, dev tooling out,
  no new runtime dependency, case.db under the workspace root).
"""

from __future__ import annotations

import shutil
import tomllib
from pathlib import Path

from bigcase import build_big_case
from legacy_case import write_legacy_json_case

from azimut import workspace
from azimut.engine import links as link_engine
from azimut.engine import media as media_engine
from azimut.engine import thumbnails
from azimut.workspace import Case

_PROV = {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"}


# -- functional + migration -------------------------------------------------


def test_legacy_json_case_migrates_and_every_workflow_answers(tmp_workspace):
    """A legacy json case (unicode, folders, a derivation chain, a media sidecar)
    migrates on open and every read path — snapshot, bounded catalog, neighbour
    chain, media listing, durable jobs — works on the result, with a recoverable
    backup left behind."""
    legacy = write_legacy_json_case(
        "Réunion",  # non-ASCII survives the round trip
        entities=[
            {"id": "e_p", "type": "person", "label": "Ada", "attrs": {"folder": "People"}, "provenance": _PROV},
            {"id": "e_m", "type": "media", "label": "shot", "attrs": {"path": "media/shot.jpg", "sha256": "a" * 64, "kind": "image"}, "provenance": _PROV},
            {"id": "e_pr", "type": "proof", "label": "Proof", "attrs": {"spec": "proofs/p.json"}, "provenance": _PROV},
        ],
        links=[{"id": "l1", "from": "e_pr", "to": "e_m", "type": "derived-from", "provenance": _PROV}],
        folders=["People"],
    )
    # a real media file + sidecar so the media listing has something to read
    (legacy.path / "media" / "shot.jpg").write_bytes(b"\xff\xd8\xff\xe0jpeg")
    (legacy.path / "media" / ("shot.jpg" + media_engine.SIDECAR_SUFFIX)).write_text(
        '{"filename": "shot.jpg", "kind": "image", "sha256": "%s", "size": 5,'
        ' "added_at": "2026-01-01T00:00:00Z", "source": {}, "thumbnail": null}' % ("a" * 64),
        encoding="utf-8",
    )

    case = Case.open(legacy.id)  # migrates json -> sqlite

    # storage flipped, graph preserved, backup recoverable
    assert case.read()["azimut"] == {"schema": workspace.CASE_SCHEMA, "storage": "sqlite"}
    assert (case.path / "case.pre-migrate-v2.json").exists()
    assert {e["id"] for e in case.snapshot()["entities"]} == {"e_p", "e_m", "e_pr"}

    # bounded reads
    assert "entities" not in case.overview() and "links" not in case.overview()
    assert case.catalog_summary()["total"] == 3
    people = case.page_entities(types=["person"])
    assert [e["id"] for e in people["items"]] == ["e_p"]
    chain = link_engine.chain_of(case, "e_pr")
    assert [s["entity"]["id"] for s in chain["sources"]] == ["e_m"]

    # media + durable jobs both live on the migrated case
    assert media_engine.list_media(case)[0]["filename"] == "shot.jpg"
    case.enqueue_job("thumbnail", key="media/shot.jpg")
    assert case.count_jobs() == {"queued": 1}


def test_a_closed_case_folder_copy_opens_identically(tmp_workspace):
    """Copying a closed case directory yields a complete, openable case — the
    doc's "case bundle / manual copy is guaranteed when the case is closed". The
    rollback journal (no WAL) means no checkpoint is owed, so a plain folder copy
    carries the whole graph."""
    src = Case.create("Bundle")
    p = src.add_entity("person", "Ada", {"handle": "@ada"}, by="user")
    m = src.add_entity("media", "shot", {"path": "media/x.jpg"}, by="user")
    src.add_link(p["id"], m["id"], "depicts", by="user")
    src.add_folder("People/Kyiv")
    src.enqueue_job("thumbnail", key="media/x.jpg")  # a live job travels too
    original = src.snapshot()

    dest = workspace.config.cases_dir() / "bundle-copy"
    shutil.copytree(src.path, dest)
    copy = Case.open("bundle-copy")

    copied = copy.snapshot()
    assert copied["entities"] == original["entities"]
    assert copied["links"] == original["links"]
    assert copied["folders"] == original["folders"]
    assert copy.count_jobs() == {"queued": 1}


# -- load: bounded loading on a large migrated case -------------------------


def test_large_migrated_case_opens_through_bounded_queries(tmp_workspace):
    case, summary = build_big_case(
        name="Load", entities=600, links=800, media=150, notes=30, artifacts=40,
        write_media_files=False,
    )
    opened = Case.open(summary.case_id)  # migrate json -> sqlite

    # case-open ships the manifest + folders, never the graph arrays
    overview = opened.overview()
    assert "entities" not in overview and "links" not in overview

    # the catalog is read in bounded pages, not one materialised list
    page = opened.page_entities(limit=100)
    assert len(page["items"]) == 100 and page["next_cursor"] is not None
    walked, cursor = 0, None
    while True:
        pg = opened.page_entities(limit=250, cursor=cursor)
        walked += len(pg["items"])
        cursor = pg["next_cursor"]
        if cursor is None:
            break
    assert walked == summary.entities == opened.catalog_summary()["total"]


# -- packaging: frozen-binary constraints -----------------------------------


def _pyproject() -> dict:
    root = Path(__file__).resolve().parent.parent
    return tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))


def test_wheel_bundles_the_frontend_and_leaves_dev_tooling_out():
    cfg = _pyproject()
    assert "src/azimut/static/**" in cfg["tool"]["hatch"]["build"]["artifacts"]
    assert cfg["tool"]["hatch"]["build"]["targets"]["wheel"]["packages"] == ["src/azimut"]
    # the synthetic fixture and the benchmark live outside the packaged tree, so
    # hatchling never ships them (doc "dev-only tooling stays out of the artifact")
    root = Path(__file__).resolve().parent.parent
    assert (root / "tests" / "bigcase.py").exists()
    assert not (root / "src" / "azimut" / "bigcase.py").exists()
    assert (root / "bench").is_dir() and not (root / "src" / "azimut" / "bench").exists()


def test_storage_and_jobs_add_no_new_runtime_dependency():
    """The store, the durable queue and the thumbnail worker stay on the standard
    library plus deps already declared — nothing that would need a new wheel on
    the three release binaries."""
    declared = " ".join(_pyproject()["project"]["dependencies"]).lower()
    # sqlite3/threading/subprocess are stdlib; Pillow (declared) does the imaging.
    assert "pillow" in declared
    src = Path(__file__).resolve().parent.parent / "src" / "azimut"
    text = (src / "sqlite_backend.py").read_text() + (src / "engine" / "thumbnails.py").read_text()
    assert "import sqlite3" in (src / "sqlite_backend.py").read_text()
    for banned in ("import numpy", "import pandas", "import redis", "import celery"):
        assert banned not in text  # no heavyweight queue/DB dependency slipped in


def test_case_db_lives_under_the_workspace_root(tmp_workspace):
    case = Case.create("Where")
    assert case.path.is_relative_to(workspace.config.workspace_root())
    assert (case.path / "case.db").exists()  # beside the case, never beside the binary
    # thumbnails cache under the case's media dir, also inside the workspace
    assert thumbnails._thumb_dir(case).is_relative_to(workspace.config.workspace_root())


def test_release_tooling_is_bounded_and_built_from_the_lock():
    cfg = _pyproject()
    assert cfg["build-system"]["requires"] == ["hatchling>=1.27,<2"]
    release = cfg["dependency-groups"]["release"]
    assert any(dep.startswith("build>=") and "<2" in dep for dep in release)
    assert any(dep.startswith("hatchling>=") and "<2" in dep for dep in release)
    assert any(dep.startswith("pyinstaller>=") and "<7" in dep for dep in release)

    root = Path(__file__).resolve().parent.parent
    workflow = (root / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    assert "pipx run build" not in workflow
    assert "uv pip install . pyinstaller" not in workflow
    assert "python -m build --no-isolation" in workflow
    assert "--group release" in workflow
    assert workflow.count('node-version: "20.20.2"') == 2
    assert "--no-build-isolation" in workflow
    assert "--no-editable" in workflow
    assert "uv run python" not in workflow


def test_release_binary_runs_the_application_smoke_test():
    root = Path(__file__).resolve().parent.parent
    workflow = (root / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    smoke = (root / "scripts" / "smoke_binary.py").read_text(encoding="utf-8")

    assert "scripts/smoke_binary.py" in workflow
    assert "/api/health" in smoke
    assert "/api/settings/ffmpeg" in smoke
    assert 'ffmpeg.get("source") != "bundled"' in smoke
