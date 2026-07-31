"""Pasted images: pixels a proof shows that the case does not hold.

A paste rides along with the save, lands in ``proofs/.meta/<name>.assets/`` under its
own hash, follows the proof through a rename, and goes away with it. What it must
never do is claim a source: no media, no entity, no ``derived-from`` edge.
"""

import base64
import hashlib
import io

import graph_read
from PIL import Image
from azimut import layout


def _png(size=(60, 40), color=(90, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _asset(data: bytes) -> dict[str, str]:
    """The payload the composer sends: content hash for a name, base64 body."""
    return {
        "name": f"{hashlib.sha256(data).hexdigest()[:16]}.png",
        "data": base64.b64encode(data).decode(),
    }


def _spec(*asset_names: str, panels=()) -> dict:
    return {
        "panels": [{"id": f"p{i}", "src": s, "natural": [800, 600]} for i, s in enumerate(panels)],
        "shapes": [],
        "pastes": [
            {
                "id": f"x{i}",
                "asset": n,
                "natural": [60, 40],
                "x": 10,
                "y": 20,
                "scale": 1,
                "frame": {"color": "#40c4ff", "width": 6},
            }
            for i, n in enumerate(asset_names)
        ],
    }


def _case(client, name: str) -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def test_a_pasted_image_lands_beside_the_proof_and_is_served(client):
    cid = _case(client, "Pastes")
    data = _png()
    asset = _asset(data)

    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Pasted proof", "spec": _spec(asset["name"]), "assets": [asset]},
    ).json()

    rel = f"{layout.proof_assets_rel(saved['name'])}/{asset['name']}"
    served = client.get(f"/files/{cid}/{rel}")
    assert served.status_code == 200
    assert served.content == data  # the exact bytes, so reopening renders the paste

    # the paste round-trips through the spec, frame and all
    paste = client.get(f"/api/cases/{cid}/proofs/{saved['name']}").json()["pastes"][0]
    assert paste["asset"] == asset["name"]
    assert paste["frame"] == {"color": "#40c4ff", "width": 6}


def test_a_paste_claims_no_source(client):
    """The guarantee: a paste is pixels, not evidence. Nothing in the graph."""
    cid = _case(client, "NoSource")
    asset = _asset(_png())

    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Pasted proof", "spec": _spec(asset["name"]), "assets": [asset]},
    )

    # the proof itself, and nothing filed for the paste
    entities = graph_read.entities(cid)
    assert [e["type"] for e in entities] == ["proof"]
    assert not any(asset["name"] in str(e["attrs"]) for e in entities)
    # a panel would have earned a derived-from edge here; a paste earns none
    assert graph_read.links(cid, "derived-from") == []


def test_dropping_a_paste_takes_its_file_and_its_folder(client):
    cid = _case(client, "Pruned")
    keep, drop = _asset(_png(color=(10, 90, 10))), _asset(_png(color=(90, 10, 90)))
    body = {"title": "Two pastes", "spec": _spec(keep["name"], drop["name"])}
    saved = client.post(
        f"/api/cases/{cid}/proofs", json={**body, "assets": [keep, drop]}
    ).json()
    folder = layout.proof_assets_rel(saved['name'])
    assert client.get(f"/files/{cid}/{folder}/{drop['name']}").status_code == 200

    # resave with only one paste left: the other file goes, no new upload needed
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": saved["name"], "title": "Two pastes", "spec": _spec(keep["name"])},
    )
    assert client.get(f"/files/{cid}/{folder}/{keep['name']}").status_code == 200
    assert client.get(f"/files/{cid}/{folder}/{drop['name']}").status_code == 404

    # drop the last one and the folder itself goes
    from azimut.api.cases import get_case

    client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": saved["name"], "title": "Two pastes", "spec": _spec()},
    )
    assert not get_case(cid).resolve_inside(folder).exists()


def test_rename_carries_the_pasted_images(client):
    cid = _case(client, "RenamePastes")
    asset = _asset(_png())
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Before", "spec": _spec(asset["name"]), "assets": [asset]},
    ).json()

    # renamed with no fresh upload: the folder moves rather than the paste dying
    renamed = client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": saved["name"], "title": "After", "spec": _spec(asset["name"])},
    ).json()

    assert renamed["name"] == "After"
    after = layout.proof_assets_rel("After")
    before = layout.proof_assets_rel("Before")
    assert client.get(f"/files/{cid}/{after}/{asset['name']}").status_code == 200
    assert client.get(f"/files/{cid}/{before}/{asset['name']}").status_code == 404


def test_delete_removes_the_pasted_images(client):
    from azimut.api.cases import get_case

    cid = _case(client, "DeletePastes")
    asset = _asset(_png())
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Temp", "spec": _spec(asset["name"]), "assets": [asset]},
    ).json()

    client.delete(f"/api/cases/{cid}/proofs/{saved['name']}")
    assert not get_case(cid).resolve_inside(layout.proof_assets_rel(saved['name'])).exists()


def test_the_same_paste_reuploaded_lands_once(client):
    cid = _case(client, "Idempotent")
    asset = _asset(_png())
    saved = None
    for _ in range(2):
        saved = client.post(
            f"/api/cases/{cid}/proofs",
            json={
                "rename_from": saved["name"] if saved else None,
                "title": "Same",
                "spec": _spec(asset["name"]),
                "assets": [asset],
            },
        ).json()

    from azimut.api.cases import get_case

    folder = get_case(cid).resolve_inside(layout.proof_assets_rel("Same"))
    assert [p.name for p in folder.iterdir()] == [asset["name"]]


def test_an_asset_name_that_does_not_match_its_content_is_refused(client):
    cid = _case(client, "Tampered")
    asset = _asset(_png())
    asset["data"] = base64.b64encode(_png(color=(1, 2, 3))).decode()  # other pixels

    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Tampered", "spec": _spec(asset["name"]), "assets": [asset]},
    )
    assert res.status_code == 422


def test_an_asset_name_outside_the_folder_is_refused(client):
    cid = _case(client, "Traversal")
    data = _png()
    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "title": "Traversal",
            "spec": _spec("../../case.db"),
            "assets": [{"name": "../../case.db", "data": base64.b64encode(data).decode()}],
        },
    )
    assert res.status_code == 422


def test_too_many_pasted_images_are_refused(client):
    cid = _case(client, "TooMany")
    assets = [_asset(_png(color=(i, i, i))) for i in range(13)]
    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "title": "Too many",
            "spec": _spec(*[a["name"] for a in assets]),
            "assets": assets,
        },
    )
    assert res.status_code == 422


def test_a_refused_batch_writes_nothing(client):
    """Assets are decoded before the spec is touched, so a bad save is a no-op."""
    cid = _case(client, "AllOrNothing")
    good = _asset(_png())
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Kept", "spec": _spec(good["name"]), "assets": [good]},
    ).json()
    before = client.get(f"/api/cases/{cid}/proofs/{saved['name']}").json()

    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "rename_from": saved["name"],
            "title": "Kept",
            "spec": _spec(good["name"], "0123456789abcdef.png"),
            "assets": [good, {"name": "0123456789abcdef.png", "data": "not base64!!"}],
        },
    )
    assert res.status_code == 422
    after = client.get(f"/api/cases/{cid}/proofs/{saved['name']}").json()
    assert after == before  # untouched, down to updated_at
    kept = layout.proof_assets_rel("Kept")
    assert client.get(f"/files/{cid}/{kept}/{good['name']}").status_code == 200


def test_a_proof_without_pastes_keeps_no_assets_folder(client):
    from azimut.api.cases import get_case

    cid = _case(client, "Plain")
    client.post(
        f"/api/cases/{cid}/proofs", json={"title": "Plain", "spec": _spec(panels=["media/a.jpg"])}
    )
    assert not get_case(cid).resolve_inside(layout.proof_assets_rel("Plain")).exists()
