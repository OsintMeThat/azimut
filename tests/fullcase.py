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
    place_id: str = ""
    grid: str = ""
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
    full.session = f"inspect/{session.json()['name']}.json"

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
    full.proof_asset = f"proofs/{proof.json()['name']}.assets/{asset_name}"

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
    client.put(f"/api/cases/{case_id}/notes", json={"text": "# Full case\n\nRunning notes.\n"})

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
    full.grid = f"search/{grid.json()['name']}.json"

    # Enrichment and thumbnails were queued along the way; let them land, or the
    # caller's first delete races a background write into the same case.
    workqueue.wait_until_idle(timeout=20)

    entities = client.get(
        f"/api/cases/{case_id}/catalog/entities", params={"limit": 500}
    ).json()["items"]
    full.entity_types = {e["type"] for e in entities}
    return full
