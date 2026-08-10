"""Photo galleries on hand-made entities stay presentation state, not relations."""

from __future__ import annotations

import io

from PIL import Image

from azimut.sqlite_backend import SqliteCase


GALLERY_TYPES = {
    "person",
    "organization",
    "vehicle",
    "vessel",
    "aircraft",
    "structure",
    "equipment-type",
}


def _png(color: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (48, 36), color).save(buffer, "PNG")
    return buffer.getvalue()


def _case(client, name: str = "Entity photos") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _entity(client, case_id: str, type_: str, label: str) -> dict:
    response = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": type_, "label": label, "attrs": {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _upload(client, case_id: str, name: str, color: tuple[int, int, int]) -> dict:
    response = client.post(
        f"/api/cases/{case_id}/media/upload",
        files={"file": (name, io.BytesIO(_png(color)), "image/png")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _upload_direct(
    client, case_id: str, entity_id: str, name: str, color: tuple[int, int, int]
) -> dict:
    response = client.post(
        f"/api/cases/{case_id}/entities/{entity_id}/images/upload",
        files={"file": (name, io.BytesIO(_png(color)), "image/png")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_registry_marks_exactly_the_types_with_photo_galleries(client):
    rows = client.get("/api/cases/entity-types").json()

    assert {row["type"] for row in rows if row["image_gallery"]} == GALLERY_TYPES


def test_repository_keeps_one_primary_and_promotes_the_next(tmp_path):
    store = SqliteCase.create(tmp_path / "case.db", name="Gallery store")
    subject = store.add_entity("person", "Unknown subject", by="user")
    first = store.add_entity(
        "media", "First", attrs={"path": "media/first.png", "kind": "image"}, by="user"
    )
    second = store.add_entity(
        "media", "Second", attrs={"path": "media/second.png", "kind": "image"}, by="user"
    )
    for entity, filename in ((first, "first.png"), (second, "second.png")):
        store.upsert_media_item(
            {
                "path": f"media/{filename}",
                "filename": filename,
                "kind": "image",
                "thumbnail": f"media/.thumbs/{filename}.jpg",
            },
            entity_id=entity["id"],
        )

    assert store.add_entity_images(subject["id"], [first["id"], second["id"]]) == 2
    assert [row["primary"] for row in store.entity_images(subject["id"])] == [True, False]
    store.set_primary_entity_image(subject["id"], second["id"])
    assert store.entity_image_thumbs([subject["id"]]) == {
        subject["id"]: "media/.thumbs/second.png.jpg"
    }
    store.remove_entity(second["id"])

    assert [row["media_id"] for row in store.entity_images(subject["id"])] == [first["id"]]
    assert store.entity_images(subject["id"])[0]["primary"] is True


def test_attach_choose_primary_and_detach_without_deleting_media(client):
    case_id = _case(client)
    subject = _entity(client, case_id, "person", "Unknown subject")
    first = _upload(client, case_id, "first.png", (20, 30, 40))
    second = _upload(client, case_id, "second.png", (80, 90, 100))
    media_ids = [first["entity"]["id"], second["entity"]["id"]]

    attached = client.post(
        f"/api/cases/{case_id}/entities/{subject['id']}/images",
        json={"media_ids": media_ids},
    )

    assert attached.status_code == 200, attached.text
    assert attached.json()["added"] == 2
    assert [image["media_id"] for image in attached.json()["images"]] == media_ids
    assert [image["primary"] for image in attached.json()["images"]] == [True, False]
    assert attached.json()["images"][0]["thumbnail"] == first["item"]["thumbnail"]
    assert client.post(
        f"/api/cases/{case_id}/entities/{subject['id']}/images",
        json={"media_ids": media_ids},
    ).json()["added"] == 0

    promoted = client.put(
        f"/api/cases/{case_id}/entities/{subject['id']}/images/{media_ids[1]}/primary"
    )
    assert [image["primary"] for image in promoted.json()["images"]] == [False, True]

    detached = client.delete(
        f"/api/cases/{case_id}/entities/{subject['id']}/images/{media_ids[1]}"
    )
    assert detached.status_code == 200, detached.text
    assert detached.json()["images"][0]["media_id"] == media_ids[0]
    assert detached.json()["images"][0]["primary"] is True
    assert client.get(f"/files/{case_id}/{second['item']['path']}").status_code == 200


def test_computer_upload_stays_out_of_media_library_and_deletes_private_files(client):
    case_id = _case(client, "Private entity photo")
    subject = _entity(client, case_id, "organization", "Unknown organization")

    first = _upload_direct(client, case_id, subject["id"], "portrait.png", (20, 40, 60))
    second = _upload_direct(client, case_id, subject["id"], "logo.png", (80, 100, 120))

    assert client.get(f"/api/cases/{case_id}/media").json() == []
    assert [image["primary"] for image in second["images"]] == [True, False]
    assert all(image["direct"] for image in second["images"])
    assert all(image["media_id"] is None for image in second["images"])
    assert all(
        image["path"].startswith(".data/entity-images/")
        and image["thumbnail"].startswith(".data/entity-images/.thumbs/")
        for image in second["images"]
    )
    catalog = client.get(f"/api/cases/{case_id}/catalog/entities").json()
    assert [(item["id"], item["type"]) for item in catalog["items"]] == [
        (subject["id"], "organization")
    ]

    private = first["images"][0]
    rendered = client.get(f"/files/{case_id}/{private['path']}")
    thumbnail = client.get(f"/files/{case_id}/{private['thumbnail']}")
    assert rendered.status_code == 200
    assert thumbnail.status_code == 200
    with Image.open(io.BytesIO(rendered.content)) as image:
        assert image.format == "JPEG"
        assert max(image.size) <= 2048
    with Image.open(io.BytesIO(thumbnail.content)) as image:
        assert image.format == "JPEG"
        assert max(image.size) <= 512

    removed = client.delete(
        f"/api/cases/{case_id}/entities/{subject['id']}/images/{private['id']}"
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["images"][0]["primary"] is True
    assert client.get(f"/files/{case_id}/{private['path']}").status_code == 404
    assert client.get(f"/files/{case_id}/{private['thumbnail']}").status_code == 404


def test_catalog_and_graph_use_the_primary_photo_thumbnail(client):
    case_id = _case(client, "Photo previews")
    subject = _entity(client, case_id, "aircraft", "Unknown airframe")
    uploaded = _upload_direct(
        client, case_id, subject["id"], "airframe.png", (40, 60, 80)
    )

    catalog = client.get(
        f"/api/cases/{case_id}/catalog/entities", params={"type": "aircraft"}
    ).json()
    node = next(
        node
        for node in client.get(f"/api/cases/{case_id}/graph").json()["nodes"]
        if node["id"] == subject["id"]
    )

    assert catalog["items"][0]["thumb"] == uploaded["images"][0]["thumbnail"]
    assert node["thumb"] == uploaded["images"][0]["thumbnail"]


def test_gallery_rejects_unsupported_entities_and_non_images(client, monkeypatch):
    case_id = _case(client, "Photo validation")
    unsupported = _entity(client, case_id, "account", "@unknown")
    subject = _entity(client, case_id, "vehicle", "Unknown vehicle")
    image = _upload(client, case_id, "vehicle.png", (10, 20, 30))
    document = client.post(
        f"/api/cases/{case_id}/media/upload",
        files={"file": ("notes.txt", io.BytesIO(b"notes"), "text/plain")},
    ).json()

    wrong_target = client.post(
        f"/api/cases/{case_id}/entities/{unsupported['id']}/images",
        json={"media_ids": [image["entity"]["id"]]},
    )
    wrong_media = client.post(
        f"/api/cases/{case_id}/entities/{subject['id']}/images",
        json={"media_ids": [document["entity"]["id"]]},
    )

    assert wrong_target.status_code == 400
    assert wrong_media.status_code == 400

    unreadable = client.post(
        f"/api/cases/{case_id}/entities/{subject['id']}/images/upload",
        files={"file": ("broken.png", io.BytesIO(b"not an image"), "image/png")},
    )
    assert unreadable.status_code == 400
    assert len(client.get(f"/api/cases/{case_id}/media").json()) == 2

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 800)
    oversized = client.post(
        f"/api/cases/{case_id}/entities/{subject['id']}/images/upload",
        files={
            "file": (
                "oversized.png",
                io.BytesIO(_png((30, 40, 50))),
                "image/png",
            )
        },
    )
    assert oversized.status_code == 400


def test_a_photo_past_the_limit_is_refused_before_anything_is_written(
    client, monkeypatch, tmp_path
):
    """The same bound the two other image surfaces enforce, on the third.

    The pixel clamp further in answers a decompression bomb; it does not answer a
    file that is simply enormous, which would be buffered to disk and decoded
    before anything looked at its size.
    """
    from azimut import layout
    from azimut.api import cases
    from azimut.workspace import Case

    monkeypatch.setattr(cases, "MAX_IMAGE_BYTES", 100)
    case_id = _case(client, "Bounded photos")
    subject = _entity(client, case_id, "person", "Unknown subject")

    refused = client.post(
        f"/api/cases/{case_id}/entities/{subject['id']}/images/upload",
        files={"file": ("huge.png", io.BytesIO(_png((10, 20, 30))), "image/png")},
    )

    assert refused.status_code == 413
    assert "under" in refused.json()["detail"]
    assert not layout.entity_images(Case.open(case_id).path).exists()
    assert client.get(
        f"/api/cases/{case_id}/entities/{subject['id']}/images"
    ).json()["images"] == []
