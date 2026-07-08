"""Case lifecycle, notes, entities and links through the REST API."""


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_case_lifecycle(client):
    created = client.post("/api/cases", json={"name": "Kharkiv Strike"}).json()
    assert created["id"] == "kharkiv-strike"
    assert created["entities"] == []

    # duplicate name → 409
    assert client.post("/api/cases", json={"name": "Kharkiv Strike"}).status_code == 409

    listed = client.get("/api/cases").json()
    assert [c["id"] for c in listed] == ["kharkiv-strike"]

    client.patch("/api/cases/kharkiv-strike", json={"name": "Kharkiv Strike v2"})
    assert client.get("/api/cases/kharkiv-strike").json()["name"] == "Kharkiv Strike v2"

    assert client.delete("/api/cases/kharkiv-strike").json()["status"] == "deleted"
    assert client.get("/api/cases/kharkiv-strike").status_code == 404


def test_scratch_promote(client):
    scratch = client.post("/api/cases/scratch").json()
    assert scratch["id"].startswith("scratch_")
    assert client.get(f"/api/cases/{scratch['id']}").json()["scratch"] is True

    promoted = client.post(
        f"/api/cases/{scratch['id']}/promote", json={"name": "Real Case"}
    ).json()
    assert promoted["id"] == "real-case"
    assert client.get("/api/cases/real-case").json()["scratch"] is False
    # old scratch id is gone
    assert client.get(f"/api/cases/{scratch['id']}").status_code == 404


def test_notes_roundtrip(client):
    case = client.post("/api/cases", json={"name": "Notes"}).json()
    client.put(f"/api/cases/{case['id']}/notes", json={"text": "# hello\n\nworld"})
    assert client.get(f"/api/cases/{case['id']}/notes").json()["text"] == "# hello\n\nworld"


def test_entities_and_links(client):
    cid = client.post("/api/cases", json={"name": "Graph"}).json()["id"]

    person = client.post(
        f"/api/cases/{cid}/entities", json={"type": "person", "label": "John Doe"}
    ).json()
    account = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "account", "label": "@johnd", "status": "suggested"},
    ).json()
    assert person["provenance"]["status"] == "confirmed"
    assert account["provenance"]["status"] == "suggested"

    # confirm the suggestion (spec §3.5: analyst decides)
    patched = client.patch(
        f"/api/cases/{cid}/entities/{account['id']}", json={"status": "confirmed"}
    ).json()
    assert patched["provenance"]["status"] == "confirmed"

    link = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": person["id"], "to_id": account["id"], "type": "owns"},
    ).json()
    assert link["type"] == "owns"

    # unknown entity in a link → 404
    assert (
        client.post(
            f"/api/cases/{cid}/links",
            json={"from_id": person["id"], "to_id": "e_nope", "type": "owns"},
        ).status_code
        == 404
    )

    # deleting an entity cascades to its links
    client.delete(f"/api/cases/{cid}/entities/{account['id']}")
    data = client.get(f"/api/cases/{cid}").json()
    assert len(data["entities"]) == 1
    assert data["links"] == []


# ---------------------------------------------------------------------------
# Satellite capture notes (PATCH /api/cases/{id}/satellite)
# Uses a pre-written sidecar to avoid a live tile fetch.
# ---------------------------------------------------------------------------

import json
import os


def _plant_capture(client, cid: str) -> dict:
    """Write a fake satellite PNG + sidecar directly into the case directory."""
    import ozimut.config as cfg
    from pathlib import Path

    case_dir = cfg.cases_dir() / cid
    sat_dir = case_dir / "satellite"
    sat_dir.mkdir(parents=True, exist_ok=True)

    fname = "sat_test_z16_esri.png"
    (sat_dir / fname).write_bytes(b"\x89PNG\r\n\x1a\n")  # minimal PNG magic bytes
    sidecar = {
        "filename": fname,
        "provider": "esri-world-imagery",
        "provider_label": "Esri World Imagery",
        "zoom": 16,
        "lat": 50.0,
        "lon": 30.0,
        "fetched_at": "2026-07-08T12:00:00Z",
        "tiles": 9,
        "tiles_missing": 0,
    }
    (sat_dir / (fname + ".json")).write_text(
        json.dumps(sidecar, indent=2) + "\n", encoding="utf-8"
    )
    sidecar["path"] = f"satellite/{fname}"
    return sidecar


def test_satellite_patch_notes(client):
    cid = client.post("/api/cases", json={"name": "SatNotes"}).json()["id"]
    capture = _plant_capture(client, cid)

    updated = client.patch(
        f"/api/cases/{cid}/satellite",
        json={"path": capture["path"], "notes": "good reference point"},
    ).json()
    assert updated["notes"] == "good reference point"

    # persisted: shows up in listing
    listed = client.get(f"/api/cases/{cid}/satellite").json()
    assert listed[0]["notes"] == "good reference point"


def test_satellite_patch_clear_notes(client):
    cid = client.post("/api/cases", json={"name": "SatClear"}).json()["id"]
    capture = _plant_capture(client, cid)

    client.patch(
        f"/api/cases/{cid}/satellite",
        json={"path": capture["path"], "notes": "initial"},
    )
    updated = client.patch(
        f"/api/cases/{cid}/satellite",
        json={"path": capture["path"], "notes": ""},
    ).json()
    assert "notes" not in updated


def test_satellite_patch_not_found(client):
    cid = client.post("/api/cases", json={"name": "SatMissing"}).json()["id"]
    res = client.patch(
        f"/api/cases/{cid}/satellite",
        json={"path": "satellite/nonexistent.png", "notes": "x"},
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Folders (case-level organisational buckets)
# ---------------------------------------------------------------------------


def test_folders_crud(client):
    cid = client.post("/api/cases", json={"name": "Folders"}).json()["id"]

    # empty by default
    assert client.get(f"/api/cases/{cid}/folders").json() == []

    # create, deduped and sorted case-insensitively
    client.post(f"/api/cases/{cid}/folders", json={"name": "Videos"})
    folders = client.post(f"/api/cases/{cid}/folders", json={"name": "Aerial"}).json()
    assert folders == ["Aerial", "Videos"]
    # idempotent
    assert client.post(f"/api/cases/{cid}/folders", json={"name": "Videos"}).json() == [
        "Aerial",
        "Videos",
    ]

    # persisted in case.json
    assert client.get(f"/api/cases/{cid}").json()["folders"] == ["Aerial", "Videos"]

    # delete
    remaining = client.delete(f"/api/cases/{cid}/folders", params={"name": "Videos"}).json()
    assert remaining == ["Aerial"]


def test_delete_folder_unassigns_entities(client):
    cid = client.post("/api/cases", json={"name": "Unassign"}).json()["id"]
    client.post(f"/api/cases/{cid}/folders", json={"name": "Suspects"})
    ent = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "person", "label": "John", "attrs": {"folder": "Suspects"}},
    ).json()

    client.delete(f"/api/cases/{cid}/folders", params={"name": "Suspects"})
    data = client.get(f"/api/cases/{cid}").json()
    assert data["folders"] == []
    entity = next(e for e in data["entities"] if e["id"] == ent["id"])
    assert "folder" not in entity["attrs"]

