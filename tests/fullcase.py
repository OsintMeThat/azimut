"""One case holding an artifact from every tool, built through the real API.

The gates that keep the trash and the bundle honest all need the same thing: a
case that actually contains what a case can contain. Building it once, through
the endpoints the app itself serves, is what makes those gates cheap — a new
tool adds its artifact here and the gates cover it for free.

Nothing is written by hand. If a tool changes where it files its work, this
fixture changes with it, and the gates read the result rather than a
hand-maintained list of paths.

Standard library plus Pillow, and it lives under ``tests/`` so hatchling never
packages it into the wheel or the frozen binaries.
"""

from __future__ import annotations

import base64
import hashlib
import io
from dataclasses import dataclass, field

from PIL import Image
from azimut import layout


def _png(size: tuple[int, int] = (80, 60), color: tuple[int, int, int] = (120, 60, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


@dataclass
class FullCase:
    """What was planted, so a gate can name it rather than rediscover it."""

    case_id: str
    photo: str = ""
    piece: str = ""
    collage: str = ""
    capture: str = ""
    session: str = ""
    proof: str = ""
    proof_asset: str = ""
    draft: str = ""
    note_id: str = ""
    note: str = ""  # its case-relative path
    place_id: str = ""
    grid: str = ""
    person_id: str = ""
    org_id: str = ""
    account_id: str = ""
    network_id: str = ""
    vessel_id: str = ""
    structure_id: str = ""
    bookmark_id: str = ""
    claim_id: str = ""
    entity_types: set[str] = field(default_factory=set)


def build_full_case(client, name: str = "Full case") -> FullCase:
    """Fill one case through every tool that files an artifact.

    Returns once the background queue is idle, so a caller can move or delete the
    case directory without racing an enrichment or a thumbnail write.
    """
    from azimut.engine import workqueue

    case_id = client.post("/api/cases", json={"name": name}).json()["id"]
    full = FullCase(case_id=case_id)

    # -- media: two uploads, and a collage composed from both ----------------
    def upload(filename: str, data: bytes) -> str:
        res = client.post(
            f"/api/cases/{case_id}/media/upload",
            files={"file": (filename, io.BytesIO(data), "image/png")},
        )
        assert res.status_code == 200, res.text
        return res.json()["item"]["path"]

    full.photo = upload("photo.png", _png(color=(10, 20, 30)))
    full.piece = upload("piece.png", _png(color=(200, 100, 50), size=(60, 60)))

    collage = client.post(
        f"/api/cases/{case_id}/inspect/compose",
        json={
            "width": 200,
            "height": 120,
            "nodes": [
                {"src": {"path": full.photo},
                 "quad": [[5, 5], [95, 5], [95, 110], [5, 110]]},
                {"src": {"path": full.piece},
                 "quad": [[105, 5], [195, 5], [195, 110], [105, 110]]},
            ],
            "label": "Collage",
        },
    )
    assert collage.status_code == 200, collage.text
    full.collage = collage.json()["item"]["path"]

    # -- capture: a screenshot, which needs no network ------------------------
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    shot = client.post(
        f"/api/cases/{case_id}/satellite/screenshot",
        files={"image": ("shot.png", _png(color=(40, 80, 40)), "image/png")},
        data={"lat": "48.8584", "lon": "2.2945", "zoom": "18",
              "provider": "google-js", "bearing": "45"},
    )
    assert shot.status_code == 200, shot.text
    full.capture = client.get(f"/api/cases/{case_id}/satellite").json()[0]["path"]

    # -- inspect session: adjustments over the photo (depends-on) -------------
    session = client.post(
        f"/api/cases/{case_id}/inspect/sessions",
        json={
            "title": "Photo pass",
            "spec": {"source": {"path": full.photo}, "ops": [
                {"op": "brightness", "params": {"value": 1.2}}
            ]},
        },
    )
    assert session.status_code == 200, session.text
    full.session = f".inspect/{session.json()['name']}.json"

    # -- a place, and a relation to the photo ---------------------------------
    place = client.post(
        f"/api/cases/{case_id}/satellite/place",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 17, "title": "Tower"},
    )
    assert place.status_code == 200, place.text
    full.place_id = place.json()["id"]
    photo_entity = client.get(
        f"/api/cases/{case_id}/entities/lookup", params={"attr": "path", "value": full.photo}
    ).json()["entity"]
    related = client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": photo_entity["id"], "to_id": full.place_id, "type": "located-at"},
    )
    assert related.status_code == 200, related.text

    # -- the hand-made vocabulary: one entity per family, and the verbs ------
    # These own nothing on disk, so they are here for the registry and bundle
    # gates rather than for the file ones: a type that reaches the graph without
    # deciding what it owns fails `test_every_type_in_a_full_case_declares...`.
    def entity(type_: str, label: str, attrs: dict | None = None) -> str:
        res = client.post(
            f"/api/cases/{case_id}/entities",
            json={"type": type_, "label": label, "attrs": attrs or {}},
        )
        assert res.status_code == 200, res.text
        return res.json()["id"]

    full.person_id = entity("person", "A. Nadeau")
    full.org_id = entity("organization", "Northwind Shipping")
    full.account_id = entity("account", "@harbourwatch", {})
    full.network_id = entity("network", "203.0.113.0/24", {"asn": "AS64496"})
    full.vessel_id = entity("vessel", "MV Aurora", {"imo": "9074729"})
    full.structure_id = entity("structure", "Quay 4 warehouse", {"kind": "warehouse"})

    for from_id, to_id, verb in (
        (full.person_id, full.account_id, "owns"),
        (full.person_id, full.network_id, "owns"),
        (full.org_id, full.vessel_id, "owns"),
        (full.account_id, photo_entity["id"], "posted"),
        (full.vessel_id, photo_entity["id"], "appears-in"),
        (full.structure_id, full.place_id, "sited-at"),
    ):
        stated = client.post(
            f"/api/cases/{case_id}/links",
            json={"from_id": from_id, "to_id": to_id, "type": verb},
        )
        assert stated.status_code == 200, f"{verb}: {stated.text}"

    # -- proof: one panel from the case, one pasted image ---------------------
    pasted = _png(size=(40, 30), color=(220, 220, 40))
    asset_name = f"{hashlib.sha256(pasted).hexdigest()[:16]}.png"
    proof = client.post(
        f"/api/cases/{case_id}/proofs",
        json={
            "title": "Convoy proof",
            "png_base64": base64.b64encode(_png(size=(200, 120))).decode(),
            "spec": {
                "panels": [{"id": "p0", "src": full.photo, "natural": [80, 60]}],
                "shapes": [],
                "pastes": [{"id": "x0", "asset": asset_name, "natural": [40, 30],
                            "x": 10, "y": 10, "scale": 1}],
            },
            "assets": [{"name": asset_name, "data": base64.b64encode(pasted).decode()}],
        },
    )
    assert proof.status_code == 200, proof.text
    full.proof = proof.json()["spec_path"]
    full.proof_asset = f"{layout.proof_assets_rel(proof.json()['name'])}/{asset_name}"

    # -- post: derived from the proof and the photo ---------------------------
    draft = client.post(
        f"/api/cases/{case_id}/drafts",
        json={
            "title": "Thread draft",
            "state": {"proofPng": proof.json()["png"], "mediaPaths": [full.photo]},
        },
    )
    assert draft.status_code == 200, draft.text
    full.draft = draft.json()["draft"]

    # -- a filed note, the free-form notes, a folder, and a saved grid --------
    client.post(f"/api/cases/{case_id}/folders", json={"name": "Sources/Telegram"})
    note = client.post(
        f"/api/cases/{case_id}/notes",
        json={"title": "Witness", "folder": "Sources/Telegram", "content": "# Witness\n"},
    )
    assert note.status_code == 200, note.text
    full.note_id = note.json()["id"]
    full.note = note.json()["attrs"]["path"]
    client.put(f"/api/cases/{case_id}/notes", json={"text": "# Full case\n\nRunning notes.\n"})

    # -- a claim, with its three dedicated connectors --------------------------
    # The reified statement carries one confidence for the whole assertion. Its
    # connectors only identify the subject, place and supporting material.
    # The source it rests on, graded on the axis that is never multiplied into the
    # edge's own rating: the bundle has to carry both and keep them apart.
    full.bookmark_id = entity(
        "bookmark",
        "Harbour watch thread",
        {
            "url": "https://example.test/thread/48",
            "fetched_at": "2026-08-01T09:12:00+00:00",
            "archive_url": "https://web.archive.test/web/2026/https://example.test/thread/48",
            "reliability": "B",
        },
    )

    full.claim_id = entity(
        "claim",
        "Where was the photo taken?",
        {"method": "spans counted against Esri imagery", "confidence": "probable"},
    )
    for to_id, verb in (
        (photo_entity["id"], "about"),
        (full.place_id, "at"),
        (full.note_id, "cites"),
        (full.bookmark_id, "cites"),
    ):
        stated = client.post(
            f"/api/cases/{case_id}/links",
            json={"from_id": full.claim_id, "to_id": to_id, "type": verb},
        )
        assert stated.status_code == 200, f"{verb}: {stated.text}"

    grid = client.put(
        f"/api/cases/{case_id}/search-grids/north-sweep",
        json={
            "title": "North sweep",
            "spec": {
                "azimut_grid": 1,
                "cell_m": 500,
                "anchor": {"lat": 48.0, "lon": 2.0},
                "lat_step": 0.0045,
                "lon_step": 0.0067,
                "aoi": {"type": "rect",
                        "bounds": {"south": 48.0, "west": 2.0, "north": 48.02, "east": 2.02}},
                "statuses": {"0:0": "cleared"},
            },
        },
    )
    assert grid.status_code == 200, grid.text
    full.grid = f".search/{grid.json()['name']}.json"

    # Enrichment and thumbnails were queued along the way; let them land, or the
    # caller's first delete races a background write into the same case.
    workqueue.wait_until_idle(timeout=20)

    entities = client.get(
        f"/api/cases/{case_id}/catalog/entities", params={"limit": 500}
    ).json()["items"]
    full.entity_types = {e["type"] for e in entities}
    return full
