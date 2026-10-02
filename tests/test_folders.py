"""Folders: one list whichever door a folder came in by, renames that carry their
items and files, removals that leave no copy behind, and the work folder."""

import io
import json
import sqlite3
from contextlib import closing

import graph_read
import pytest
from PIL import Image

from azimut.engine import bundles
from azimut.engine.media import _sidecar_path
from azimut.workspace import Case


def _png(color=(30, 60, 90)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buf, "PNG")
    return buf.getvalue()


def _case(client, name="Folders") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, cid, name="shot.png", color=(30, 60, 90)) -> dict:
    res = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(_png(color)), "image/png")},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _file(client, cid, path, folder):
    res = client.patch(f"/api/cases/{cid}/media", json={"path": path, "folder": folder})
    assert res.status_code == 200, res.text


def _sidecar(cid, path) -> dict:
    media = Case.open(cid).resolve_inside(path)
    return json.loads(_sidecar_path(media).read_text(encoding="utf-8"))


def _media_folder_counts(client, cid) -> dict:
    return client.get(f"/api/cases/{cid}/media/page").json()["facets"]["folder_counts"]


# -- one list -------------------------------------------------------------------


def test_a_folder_named_while_saving_is_listed_everywhere_a_folder_is_picked(client):
    """Typed into a save dialog's picker, a folder used to exist only on the item."""
    cid = _case(client)
    client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "place", "label": "Hangar", "attrs": {"folder": "Airbase/North"}},
    )
    assert client.get(f"/api/cases/{cid}/folders").json() == ["Airbase", "Airbase/North"]
    assert client.get(f"/api/cases/{cid}").json()["folders"] == ["Airbase", "Airbase/North"]


def test_a_folder_known_only_through_its_items_is_listed_and_outlives_them(client):
    """A case filed before the rule: the item names a folder the table never had."""
    cid = _case(client)
    entity = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "place", "label": "Pier", "attrs": {"folder": "Port"}},
    ).json()
    # `closing`: a bare `with connect()` only commits, and Windows cannot delete a
    # workspace whose case.db is still open.
    with closing(sqlite3.connect(Case.open(cid).db_path)) as conn, conn:
        conn.execute("DELETE FROM folders")
    assert client.get(f"/api/cases/{cid}/folders").json() == ["Port"]

    client.patch(f"/api/cases/{cid}/entities/{entity['id']}", json={"attrs": {"folder": ""}})
    assert client.get(f"/api/cases/{cid}/folders").json() == ["Port"]


def test_restoring_an_item_brings_back_the_folder_removed_since(client):
    cid = _case(client)
    entity = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "place", "label": "Pier", "attrs": {"folder": "Port"}},
    ).json()
    deleted = client.delete(f"/api/cases/{cid}/entities/{entity['id']}").json()
    client.delete(f"/api/cases/{cid}/folders", params={"name": "Port"})
    assert client.get(f"/api/cases/{cid}/folders").json() == []

    client.post(f"/api/cases/{cid}/trash/{deleted['trash']}/restore", json={})
    assert client.get(f"/api/cases/{cid}/folders").json() == ["Port"]


# -- rename ---------------------------------------------------------------------


def test_renaming_a_folder_carries_its_subfolders_items_and_their_files(client):
    cid = _case(client)
    client.post(f"/api/cases/{cid}/folders", json={"name": "Airbase/Empty"})
    note = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Log", "folder": "Airbase/North"}
    ).json()
    place = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "place", "label": "Hangar", "attrs": {"folder": "Airbase"}},
    ).json()
    path = _upload(client, cid)["item"]["path"]
    _file(client, cid, path, "Airbase/North")
    client.post(f"/api/cases/{cid}/folders", json={"name": "Other"})

    res = client.post(
        f"/api/cases/{cid}/folders/rename", json={"source": "Airbase", "target": "Isfahan"}
    )
    assert res.status_code == 200, res.text
    assert res.json() == ["Isfahan", "Isfahan/Empty", "Isfahan/North", "Other"]

    by_id = {e["id"]: e for e in graph_read.entities(cid)}
    assert by_id[place["id"]]["attrs"]["folder"] == "Isfahan"
    moved = by_id[note["id"]]["attrs"]
    assert moved["folder"] == "Isfahan/North"
    assert moved["path"] == "notes/Isfahan/North/Log.md"
    assert Case.open(cid).resolve_inside(moved["path"]).is_file()
    assert graph_read.entity(cid, path=path)["attrs"]["folder"] == "Isfahan/North"
    assert _sidecar(cid, path)["folder"] == "Isfahan/North"
    assert _media_folder_counts(client, cid) == {"Isfahan/North": 1}
    # a search finds an item by the folder's new name, not its old one
    hits = client.get(f"/api/cases/{cid}/catalog/entities", params={"q": "isfahan"}).json()
    assert {item["id"] for item in hits["items"]} >= {place["id"]}


def test_a_rename_onto_another_folder_is_refused_ignoring_case(client):
    cid = _case(client)
    client.post(f"/api/cases/{cid}/folders", json={"name": "Port"})
    client.post(f"/api/cases/{cid}/folders", json={"name": "Airbase"})

    res = client.post(f"/api/cases/{cid}/folders/rename", json={"source": "Port", "target": "airbase"})
    assert res.status_code == 400
    assert "already" in res.json()["detail"]
    assert client.get(f"/api/cases/{cid}/folders").json() == ["Airbase", "Port"]


def test_a_rename_that_only_changes_case_is_allowed(client):
    cid = _case(client)
    client.post(f"/api/cases/{cid}/folders", json={"name": "port/east"})
    res = client.post(f"/api/cases/{cid}/folders/rename", json={"source": "port", "target": "Port"})
    assert res.json() == ["Port", "Port/east"]


def test_a_rename_is_refused_into_itself_too_deep_or_for_a_missing_folder(client):
    cid = _case(client)
    client.post(f"/api/cases/{cid}/folders", json={"name": "A/B/C"})

    def rename(source, target):
        return client.post(
            f"/api/cases/{cid}/folders/rename", json={"source": source, "target": target}
        )

    assert rename("A", "A/B/D").status_code == 400
    assert rename("A", "W/X/Y").status_code == 400  # A/B/C would sit five deep
    assert rename("Nope", "Yes").status_code == 400
    assert client.get(f"/api/cases/{cid}/folders").json() == ["A", "A/B", "A/B/C"]


# -- remove ---------------------------------------------------------------------


def test_removing_a_folder_clears_every_copy_of_it(client):
    """The media sidecar and browse index kept the folder, so the Media Library's
    folder filter still listed one Files had removed."""
    cid = _case(client)
    path = _upload(client, cid)["item"]["path"]
    _file(client, cid, path, "Port/Docks")
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "Log", "folder": "Port"}).json()

    client.delete(f"/api/cases/{cid}/folders", params={"name": "Port"})

    assert client.get(f"/api/cases/{cid}/folders").json() == []
    assert "folder" not in _sidecar(cid, path)
    assert _media_folder_counts(client, cid) == {}
    attrs = next(e for e in graph_read.entities(cid) if e["id"] == note["id"])["attrs"]
    assert attrs["path"] == "notes/Log.md"
    assert Case.open(cid).resolve_inside(attrs["path"]).is_file()


# -- the work folder ------------------------------------------------------------


def _work(client, cid, folder):
    res = client.put(f"/api/cases/{cid}/work-folder", json={"folder": folder})
    assert res.status_code == 200, res.text
    return res.json()["work_folder"]


def test_the_work_folder_is_kept_on_the_case_and_registered(client):
    cid = _case(client)
    assert client.get(f"/api/cases/{cid}").json().get("work_folder") is None
    assert _work(client, cid, " Airbase / North ") == "Airbase/North"
    case = client.get(f"/api/cases/{cid}").json()
    assert case["work_folder"] == "Airbase/North"
    assert case["folders"] == ["Airbase", "Airbase/North"]
    assert _work(client, cid, None) is None
    assert "work_folder" not in client.get(f"/api/cases/{cid}").json()


def test_new_files_and_saved_work_land_in_the_work_folder(client):
    cid = _case(client)
    _work(client, cid, "Airbase")

    uploaded = _upload(client, cid)
    assert uploaded["entity"]["attrs"]["folder"] == "Airbase"
    assert _sidecar(cid, uploaded["item"]["path"])["folder"] == "Airbase"
    assert _media_folder_counts(client, cid) == {"Airbase": 1}

    place = client.post(f"/api/cases/{cid}/entities", json={"type": "place", "label": "Gate"}).json()
    assert place["attrs"]["folder"] == "Airbase"


def test_the_work_folder_never_files_subjects_or_statements(client):
    cid = _case(client)
    _work(client, cid, "Airbase")
    person = client.post(f"/api/cases/{cid}/entities", json={"type": "person", "label": "Pilot"}).json()
    claim = client.post(f"/api/cases/{cid}/entities", json={"type": "claim", "label": "Seen"}).json()
    assert "folder" not in person["attrs"]
    assert "folder" not in claim["attrs"]


def test_choosing_no_folder_wins_over_the_work_folder(client):
    cid = _case(client)
    _work(client, cid, "Airbase")
    place = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "place", "label": "Gate", "attrs": {"folder": ""}},
    ).json()
    assert not place["attrs"]["folder"]
    saved = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 1.0, "lon": 2.0, "zoom": 12, "title": "Pin", "folder": ""},
    ).json()
    assert not saved["attrs"]["folder"]
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "Loose", "folder": ""}).json()
    assert not note["attrs"].get("folder")


def test_a_bookmark_from_the_extension_lands_in_the_work_folder(client):
    cid = _case(client)
    _work(client, cid, "Leads")
    token = client.post("/api/settings/ingest-token").json()["ingest_token"]
    res = client.post(
        "/api/ingest/bookmark",
        data={"url": "https://example.org/post", "case_id": cid, "title": "Post"},
        headers={"X-Azimut-Token": token},
    )
    assert res.status_code == 200, res.text
    entity = next(e for e in graph_read.entities(cid) if e["id"] == res.json()["entity_id"])
    assert entity["attrs"]["folder"] == "Leads"


def test_the_work_folder_follows_a_rename_and_leaves_with_a_removal(client):
    cid = _case(client)
    _work(client, cid, "Airbase/North")
    client.post(f"/api/cases/{cid}/folders/rename", json={"source": "Airbase", "target": "Isfahan"})
    assert client.get(f"/api/cases/{cid}").json()["work_folder"] == "Isfahan/North"
    client.delete(f"/api/cases/{cid}/folders", params={"name": "Isfahan"})
    assert "work_folder" not in client.get(f"/api/cases/{cid}").json()


def test_a_bundle_carries_the_work_folder(client):
    cid = _case(client, "Travels")
    _work(client, cid, "Airbase")
    source = Case.open(cid)
    destination = Case.create(bundles.imported_name("Travels"))
    result = bundles.import_into(destination, bundles.export_case(source))
    assert Case.open(result["case_id"]).work_folder() == "Airbase"


@pytest.mark.parametrize("name", ["..", ".", "Airbase/..", "./North", "..."])
def test_a_folder_name_made_only_of_dots_is_refused(client, name):
    """`..` would mirror onto its parent's directory under a label that is not its
    own, so it is refused wherever a new folder name comes in."""
    cid = _case(client)
    client.post(f"/api/cases/{cid}/folders", json={"name": "Airbase"})
    assert client.post(f"/api/cases/{cid}/folders", json={"name": name}).status_code in (400, 409, 422)
    res = client.post(f"/api/cases/{cid}/folders/rename", json={"source": "Airbase", "target": name})
    assert res.status_code in (400, 409, 422)
    assert client.get(f"/api/cases/{cid}/folders").json() == ["Airbase"]


def test_a_folder_named_with_dots_and_letters_is_kept(client):
    cid = _case(client)
    assert client.post(f"/api/cases/{cid}/folders", json={"name": "v1.2"}).status_code == 200
