"""Bugs found by a review of the whole tree, each pinned by the case that broke.

Grouped here rather than scattered into the suites they touch because what they
have in common is the failure mode, not the module: every one of these was
silent — a destroyed file, a dropped qualifier, a stalled queue — and none of
them raised anything a user would have reported as an error.
"""

from __future__ import annotations

import base64
import json
import threading

import pytest

from azimut import config, layout, workspace
from azimut.engine import geo, workqueue
from azimut.engine.coords import utm_zone
from azimut.workspace import Case, CaseError

# A one-pixel PNG, and the asset name the proofs route derives from its bytes.
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000155a72b0e0000000049454e44ae426082"
)
PNG_B64 = base64.b64encode(PNG_BYTES).decode()
ASSET_NAME = "126ddc670c86a4f3.png"


def _case(client) -> str:
    return client.post("/api/cases", json={"name": "Regression"}).json()["id"]


# -- traversal ---------------------------------------------------------------
#
# The id and the artifact name both arrive as one URL path segment. A segment
# cannot hold a `/` — the ASGI server decodes `%2F` before routing, and the route
# stops matching — but it can hold a `\`, which is a separator on Windows and an
# ordinary character everywhere else. So these run on every OS and would have
# passed on Linux while the Windows binary was the one that could be walked out
# of.


@pytest.mark.parametrize(
    "case_id",
    ["..", ".", "../elsewhere", "..\\elsewhere", "sub/case", "C:case"],
)
def test_case_id_names_one_folder_in_the_workspace(tmp_workspace, case_id):
    with pytest.raises(CaseError):
        Case.locate(case_id)


def test_case_cannot_be_located_outside_the_workspace(tmp_workspace, tmp_path):
    outside = tmp_path / "case-backup"
    (outside / layout.TOOL_DIR).mkdir(parents=True)
    (outside / layout.TOOL_DIR / "case.json").write_text(
        json.dumps({"azimut": {"schema": 3, "storage": "sqlite"}, "name": "victim"})
    )
    import os

    escape = os.path.relpath(outside, config.cases_dir())
    with pytest.raises(CaseError):
        Case.locate(escape)


def test_grid_delete_cannot_name_the_case_manifest(client):
    case_id = _case(client)
    manifest = Case.locate(case_id).path / layout.TOOL_DIR / "case.json"
    assert manifest.is_file()

    client.request(
        "DELETE", f"/api/cases/{case_id}/search-grids/..%5Ccase", follow_redirects=False
    )
    assert manifest.is_file()


@pytest.mark.parametrize(
    ("route", "kind"),
    [
        ("proofs", "proof"),
        ("drafts", "draft"),
        ("inspect/sessions", "session"),
    ],
)
def test_artifact_delete_cannot_name_the_case_manifest(client, route, kind):
    case_id = _case(client)
    manifest = Case.locate(case_id).path / layout.TOOL_DIR / "case.json"

    client.request("DELETE", f"/api/cases/{case_id}/{route}/..%5C..%5Ccase")
    assert manifest.is_file(), f"{kind} delete removed the manifest"


# -- destructive-before-valid ------------------------------------------------


def test_refused_proof_rename_keeps_the_export_and_the_pasted_images(client):
    case_id = _case(client)
    saved = client.post(
        f"/api/cases/{case_id}/proofs",
        json={
            "title": "Alpha",
            "spec": {"panels": [], "pastes": [{"id": "x1", "asset": ASSET_NAME}]},
            "png_base64": PNG_B64,
            "assets": [{"name": ASSET_NAME, "data": PNG_B64}],
        },
    )
    assert saved.status_code == 200
    case = Case.locate(case_id)
    export = case.resolve_inside(layout.proof_export_rel("Alpha"))
    assets = case.resolve_inside(layout.proof_assets_rel("Alpha"))
    assert export.is_file() and assets.is_dir()

    refused = client.post(
        f"/api/cases/{case_id}/proofs",
        json={
            "title": "Beta",
            "rename_from": "Alpha",
            "spec": {"panels": [], "pastes": [{"id": "x1", "asset": ASSET_NAME}]},
            "png_base64": "!!!not base64!!!",
            "assets": [],
        },
    )
    assert refused.status_code == 422
    # The proof is still Alpha, so everything Alpha owned has to still be there.
    assert case.resolve_inside(layout.proof_spec_rel("Alpha")).is_file()
    assert export.is_file(), "the export was deleted before the payload was judged"
    assert assets.is_dir(), "the pasted images were moved before the payload was judged"
    assert not case.resolve_inside(layout.proof_assets_rel("Beta")).exists()


# -- restore fidelity --------------------------------------------------------


def test_trash_restore_brings_back_the_link_qualifier(client):
    case_id = _case(client)
    a = client.post(f"/api/cases/{case_id}/entities", json={"type": "person", "label": "A"}).json()
    b = client.post(f"/api/cases/{case_id}/entities", json={"type": "person", "label": "B"}).json()
    link = client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": a["id"], "to_id": b["id"], "type": "associated-with"},
    ).json()
    qualified = client.patch(
        f"/api/cases/{case_id}/links/{link['id']}", json={"nature": "brother of"}
    )
    assert qualified.json()["nature"] == "brother of"

    client.request("DELETE", f"/api/cases/{case_id}/entities/{a['id']}")
    group = client.get(f"/api/cases/{case_id}/trash").json()["groups"][0]
    restored = client.post(f"/api/cases/{case_id}/trash/{group['id']}/restore")
    assert restored.json()["links"] == 1

    links = Case.locate(case_id).list_links()
    assert [entry.get("nature") for entry in links] == ["brother of"]


# -- corrupt state a user cannot get back out of -----------------------------


@pytest.mark.parametrize("payload", ['{"schema": 0}', "null", "[]", '"x"', "123"])
def test_unusable_settings_file_falls_back_to_defaults(tmp_workspace, payload):
    path = config.settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload, encoding="utf-8")
    assert config.load_settings()["schema"] == config.SETTINGS_SCHEMA


def test_one_corrupt_manifest_does_not_hide_the_other_cases(client):
    good = _case(client)
    broken = client.post("/api/cases", json={"name": "Broken"}).json()["id"]
    (Case.locate(broken).path / layout.TOOL_DIR / "case.json").write_text("{ not json")

    listed = client.get("/api/cases")
    assert listed.status_code == 200
    by_id = {row["id"]: row for row in listed.json()}
    assert by_id[good]["health"] == "ok"
    assert by_id[broken]["health"] == "needs-attention"
    # And a new case can still be created, which reads the list to check the name.
    assert client.post("/api/cases", json={"name": "Later"}).status_code == 200


# -- parsers that answered when they should have declined --------------------


@pytest.mark.parametrize("text", ["2023", "1984", "0000", "12345678"])
def test_bare_digits_are_not_a_location(text):
    assert geo.parse_coords(text) is None


def test_geohashes_still_parse():
    assert geo.parse_coords("u09tvw0f") is not None


def test_utm_zone_stops_at_the_antimeridian():
    assert utm_zone(0, 180) == 60
    assert utm_zone(0, 179.9) == 60
    assert utm_zone(0, -180) == 1


# -- queues and snapshots ----------------------------------------------------


def test_a_job_queued_during_a_drain_is_still_drained(monkeypatch):
    """The lost wakeup: `wake` is a no-op while a case is pending, so the mark
    must be taken *before* the drain, not cleared after it."""
    drained: list[int] = []
    started = threading.Event()
    release = threading.Event()

    class FakeCase:
        id = "case-a"

    case = FakeCase()

    def fake_drain(target):
        drained.append(1)
        if len(drained) == 1:
            started.set()
            release.wait(5)

    monkeypatch.setattr(workqueue, "drain", fake_drain)
    monkeypatch.setattr(workqueue, "_pending", {})
    monkeypatch.setattr(workqueue, "_worker_running", False)

    workqueue.wake(case)
    assert started.wait(5)
    workqueue.wake(case)  # enqueued while the first drain is still running
    release.set()

    for _ in range(100):
        if len(drained) >= 2:
            break
        threading.Event().wait(0.05)
    assert len(drained) >= 2, "the job queued during the drain was never picked up"


def test_bundle_snapshot_reads_one_consistent_state(client):
    """Entities and links come from one transaction, so a snapshot can never
    carry an edge whose endpoints it does not also carry."""
    case_id = _case(client)
    a = client.post(f"/api/cases/{case_id}/entities", json={"type": "person", "label": "A"}).json()
    b = client.post(f"/api/cases/{case_id}/entities", json={"type": "person", "label": "B"}).json()
    client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": a["id"], "to_id": b["id"], "type": "associated-with"},
    )
    snap = Case.locate(case_id).snapshot()
    ids = {entity["id"] for entity in snap["entities"]}
    assert all(link["from"] in ids and link["to"] in ids for link in snap["links"])


def test_names_one_child_is_judged_on_both_path_flavours():
    assert layout.names_one_child("Rooftop angle")
    assert layout.names_one_child("proof.json")
    for hostile in ("", ".", "..", "a/b", "a\\b", "..\\..\\case", "C:x", "a/"):
        assert not layout.names_one_child(hostile), hostile


def test_workspace_module_exposes_the_guard_it_documents():
    # `Case.locate` is the only door to a case; keep the guard wired to it.
    assert workspace.layout.names_one_child is layout.names_one_child
