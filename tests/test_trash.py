"""The trash: a delete you can take back.

What is asserted here is the contract the rest of the app relies on — the graph
still hard-deletes, so nothing else has to filter deleted rows out, and the undo
puts back the entity, its files, its links and the scars its delete wrote.
"""

from pathlib import Path

import fullcase
from azimut import layout
from azimut.engine import workqueue
from azimut.workspace import Case


def entity_of(client, case_id: str, attr: str, value: str) -> dict:
    return client.get(
        f"/api/cases/{case_id}/entities/lookup", params={"attr": attr, "value": value}
    ).json()["entity"]


def trash_of(client, case_id: str) -> dict:
    return client.get(f"/api/cases/{case_id}/trash").json()


def test_a_deleted_artifact_waits_in_the_trash_instead_of_going(client):
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    note = entity_of(client, full.case_id, "path", full.note)

    deleted = client.delete(f"/api/cases/{full.case_id}/entities/{note['id']}").json()

    # gone from the graph and from disk, exactly as before...
    assert entity_of(client, full.case_id, "path", note["attrs"]["path"]) is None
    assert not case.resolve_inside(note["attrs"]["path"]).exists()
    # ...but the file is aside, and the case says so
    listed = trash_of(client, full.case_id)
    assert listed["groups"][0]["id"] == deleted["trash"]
    assert listed["groups"][0]["label"] == note["label"]
    assert listed["items"] == 1
    assert listed["size_bytes"] > 0
    # ...under a numbered slot, not under a copy of the case tree: the group
    # directory is flat, so the trash can never be the longest path in the case.
    group_dir = case.trash_dir / deleted["trash"]
    assert [p.name for p in group_dir.iterdir()] == ["0"]
    assert (group_dir / "0").is_file()


def test_undo_brings_back_the_entity_its_id_and_its_file(client):
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    photo = entity_of(client, full.case_id, "path", full.photo)

    group = client.delete(f"/api/cases/{full.case_id}/entities/{photo['id']}").json()["trash"]
    restored = client.post(f"/api/cases/{full.case_id}/trash/{group}/restore")
    assert restored.status_code == 200, restored.text

    back = entity_of(client, full.case_id, "path", full.photo)
    # the same id: every spec, draft and link recorded elsewhere still points at it
    assert back["id"] == photo["id"]
    assert case.resolve_inside(full.photo).is_file()
    assert case.resolve_inside(layout.sidecar_rel(full.photo)).is_file()
    # and it is browsable again — the media index row came back with it
    listed = client.get(f"/api/cases/{full.case_id}/media").json()
    assert any(item["path"] == full.photo for item in listed)
    assert trash_of(client, full.case_id)["groups"] == []


def test_a_cascade_comes_back_as_one_piece(client):
    """An Inspect session only depends on its subject, so deleting the photo
    takes the session too. Undo has to bring both, or the analyst gets half a
    case back."""
    full = fullcase.build_full_case(client)
    photo = entity_of(client, full.case_id, "path", full.photo)
    session = entity_of(client, full.case_id, "spec", full.session)

    deleted = client.delete(f"/api/cases/{full.case_id}/entities/{photo['id']}").json()
    assert session["id"] in deleted["deleted"]
    assert trash_of(client, full.case_id)["groups"][0]["item_count"] == len(deleted["deleted"])

    client.post(f"/api/cases/{full.case_id}/trash/{deleted['trash']}/restore")

    assert entity_of(client, full.case_id, "spec", full.session)["id"] == session["id"]
    # the depends-on edge is back too, so a second delete still cascades
    chain = client.get(f"/api/cases/{full.case_id}/entities/{photo['id']}/chain").json()
    assert any(d["entity"]["id"] == session["id"] for d in chain["dependents"])


def test_undo_lifts_the_scar_that_delete_wrote(client):
    """A proof survives its panel's deletion, carrying a tombstone. Restoring the
    panel makes the proof whole again — the scar goes, the derivation returns."""
    full = fullcase.build_full_case(client)
    photo = entity_of(client, full.case_id, "path", full.photo)
    proof = entity_of(client, full.case_id, "spec", full.proof)

    group = client.delete(f"/api/cases/{full.case_id}/entities/{photo['id']}").json()["trash"]
    scarred = client.get(f"/api/cases/{full.case_id}/entities/{proof['id']}/chain").json()
    assert [lost["path"] for lost in scarred["lost"]] == [full.photo]

    client.post(f"/api/cases/{full.case_id}/trash/{group}/restore")

    healed = client.get(f"/api/cases/{full.case_id}/entities/{proof['id']}/chain").json()
    assert healed["lost"] == []
    assert any(s["entity"]["id"] == photo["id"] for s in healed["sources"])


def test_a_relation_survives_the_round_trip(client):
    """Relations vanish untraced — no cascade, no tombstone — so the trash is the
    only thing that can bring one back."""
    full = fullcase.build_full_case(client)
    photo = entity_of(client, full.case_id, "path", full.photo)

    group = client.delete(f"/api/cases/{full.case_id}/entities/{photo['id']}").json()["trash"]
    client.post(f"/api/cases/{full.case_id}/trash/{group}/restore")

    chain = client.get(f"/api/cases/{full.case_id}/entities/{photo['id']}/chain").json()
    stated = [r for r in chain["relations"] if r["link"]["type"] == "located-at"]
    assert [r["entity"]["id"] for r in stated] == [full.place_id]


def test_a_proof_takes_its_pasted_images_into_the_trash_and_back(client):
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    proof = entity_of(client, full.case_id, "spec", full.proof)

    group = client.delete(f"/api/cases/{full.case_id}/entities/{proof['id']}").json()["trash"]
    # The assets folder travels whole, as one slot — a directory the group holds
    # under a number, with the pasted image still inside it.
    group_dir = case.trash_dir / group
    asset_name = Path(full.proof_asset).name
    assert [p.name for p in sorted(group_dir.rglob(asset_name))] == [asset_name]
    assert not case.resolve_inside(full.proof_asset).exists()

    client.post(f"/api/cases/{full.case_id}/trash/{group}/restore")
    assert case.resolve_inside(full.proof_asset).is_file()


def test_restoring_onto_an_occupied_path_refuses_rather_than_renames(client):
    """Rewriting a restored artifact's path behind the analyst is worse than a
    clear failure, so the whole group refuses and names the file."""
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    note = entity_of(client, full.case_id, "path", full.note)
    rel = note["attrs"]["path"]

    group = client.delete(f"/api/cases/{full.case_id}/entities/{note['id']}").json()["trash"]
    # the delete pruned the note's mirrored folder, so re-make it to put
    # something in the way
    occupied = case.resolve_inside(rel)
    occupied.parent.mkdir(parents=True, exist_ok=True)
    occupied.write_text("something else wrote here", encoding="utf-8")

    refused = client.post(f"/api/cases/{full.case_id}/trash/{group}/restore")
    assert refused.status_code == 409
    assert rel in refused.json()["detail"]
    # nothing moved: the group is intact and can be restored once the path is free
    assert trash_of(client, full.case_id)["groups"][0]["id"] == group
    case.resolve_inside(rel).unlink()
    assert client.post(f"/api/cases/{full.case_id}/trash/{group}/restore").status_code == 200


def test_purging_is_where_the_bytes_go(client):
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    note = entity_of(client, full.case_id, "path", full.note)

    group = client.delete(f"/api/cases/{full.case_id}/entities/{note['id']}").json()["trash"]
    assert client.delete(f"/api/cases/{full.case_id}/trash/{group}").status_code == 200

    assert not (case.trash_dir / group).exists()
    assert trash_of(client, full.case_id)["groups"] == []
    # and it cannot be restored afterwards
    assert client.post(f"/api/cases/{full.case_id}/trash/{group}/restore").status_code == 404


def test_emptying_the_trash_clears_every_group(client):
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    for attr, value in (("spec", full.proof), ("draft", full.draft)):
        entity = entity_of(client, full.case_id, attr, value)
        client.delete(f"/api/cases/{full.case_id}/entities/{entity['id']}")
    assert len(trash_of(client, full.case_id)["groups"]) == 2

    assert client.delete(f"/api/cases/{full.case_id}/trash").json() == {"purged": 2}
    assert trash_of(client, full.case_id)["groups"] == []
    assert not case.trash_dir.exists()


def test_a_restored_media_gets_its_thumbnail_back(client):
    """Thumbnails never travel — they are a shared cache — so the restore has to
    ask for a new one rather than expect the old file to be waiting."""
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    photo = entity_of(client, full.case_id, "path", full.photo)
    thumb = client.get(f"/api/cases/{full.case_id}/media").json()
    thumb_rel = next(item["thumbnail"] for item in thumb if item["path"] == full.photo)

    group = client.delete(f"/api/cases/{full.case_id}/entities/{photo['id']}").json()["trash"]
    assert not (case.trash_dir / group / thumb_rel).exists()
    assert not case.resolve_inside(thumb_rel).exists()

    client.post(f"/api/cases/{full.case_id}/trash/{group}/restore")
    workqueue.wait_until_idle(timeout=20)
    assert case.resolve_inside(thumb_rel).is_file()


def test_deleting_a_case_takes_its_trash_with_it(client):
    """Deleting a whole case stays immediate — the trash is inside the case, so
    there is nothing left to hold anything for."""
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    note = entity_of(client, full.case_id, "path", full.note)
    client.delete(f"/api/cases/{full.case_id}/entities/{note['id']}")

    assert client.delete(f"/api/cases/{full.case_id}").status_code == 200
    assert not case.path.exists()
