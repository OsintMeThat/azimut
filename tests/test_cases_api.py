"""Case lifecycle, notes, entities and links through the REST API."""

import json
from pathlib import Path

import graph_read
from fastapi.testclient import TestClient

from azimut import layout
from azimut.workspace import Case


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_entity_status_is_validated_consistently(client):
    cid = client.post("/api/cases", json={"name": "Statuses"}).json()["id"]
    invalid_create = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "person", "label": "Lead", "status": "pending"},
    )
    assert invalid_create.status_code == 422
    assert graph_read.entities(cid) == []

    entity = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "person", "label": "Lead", "status": "suggested"},
    ).json()
    invalid_patch = client.patch(
        f"/api/cases/{cid}/entities/{entity['id']}", json={"status": "pending"}
    )
    assert invalid_patch.status_code == 422
    saved = next(item for item in graph_read.entities(cid) if item["id"] == entity["id"])
    assert saved["provenance"]["status"] == "suggested"


def test_list_cases_filters_by_name(client):
    for name in ("Kharkiv Strike", "Bakhmut Front", "Kharkiv Bridge"):
        client.post("/api/cases", json={"name": name})

    hits = client.get("/api/cases", params={"q": "kharkiv"}).json()
    assert {c["name"] for c in hits} == {"Kharkiv Strike", "Kharkiv Bridge"}
    # unfiltered still returns everything
    assert len(client.get("/api/cases").json()) == 3


def test_list_cases_respects_limit(client):
    for name in ("One", "Two", "Three", "Four"):
        client.post("/api/cases", json={"name": name})
    assert len(client.get("/api/cases", params={"limit": 2}).json()) == 2


def test_case_lifecycle(client):
    created = client.post("/api/cases", json={"name": "Kharkiv Strike"}).json()
    assert created["id"] == "kharkiv-strike"
    assert graph_read.entities(created["id"]) == []

    # duplicate name → 409
    assert client.post("/api/cases", json={"name": "Kharkiv Strike"}).status_code == 409

    listed = client.get("/api/cases").json()
    assert [c["id"] for c in listed] == ["kharkiv-strike"]

    client.patch("/api/cases/kharkiv-strike", json={"name": "Kharkiv Strike v2"})
    assert client.get("/api/cases/kharkiv-strike").json()["name"] == "Kharkiv Strike v2"

    assert client.delete("/api/cases/kharkiv-strike").json()["status"] == "deleted"
    assert client.get("/api/cases/kharkiv-strike").status_code == 404


def test_duplicate_name_rejected_case_insensitively(client):
    client.post("/api/cases", json={"name": "Alpha Site"})

    # a differently-cased name maps to the same case → 409
    assert client.post("/api/cases", json={"name": "alpha site"}).status_code == 409
    # a genuinely new name is fine
    assert client.post("/api/cases", json={"name": "Beta Site"}).status_code == 200


def test_rename_rejects_existing_name_but_allows_self(client):
    a = client.post("/api/cases", json={"name": "One"}).json()
    client.post("/api/cases", json={"name": "Two"})

    # renaming onto another case's name (any casing) → 409
    assert client.patch(f"/api/cases/{a['id']}", json={"name": "two"}).status_code == 409
    # renaming to its own current name is allowed (no false positive)
    assert client.patch(f"/api/cases/{a['id']}", json={"name": "One"}).status_code == 200


def test_promote_rejects_existing_name(client):
    client.post("/api/cases", json={"name": "Taken"})
    scratch = client.post("/api/cases/scratch").json()
    res = client.post(f"/api/cases/{scratch['id']}/promote", json={"name": "Taken"})
    assert res.status_code == 409


def test_delete_wipes_whole_case_folder(client):
    import azimut.config as cfg

    cid = client.post("/api/cases", json={"name": "Doomed"}).json()["id"]
    # plant content across subdirs so we can prove the whole tree is gone
    _plant_capture(client, cid)
    case_dir = cfg.cases_dir() / cid
    assert case_dir.exists()

    assert client.delete(f"/api/cases/{cid}").json()["status"] == "deleted"
    assert not case_dir.exists()
    assert client.get(f"/api/cases/{cid}").status_code == 404


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


def test_filed_notes_are_markdown_files(client):

    cid = client.post("/api/cases", json={"name": "Notebook"}).json()["id"]
    note = client.post(
        f"/api/cases/{cid}/notes",
        json={"title": "Lead", "folder": "Research", "content": "# First lead"},
    ).json()

    # the name is the filename, and the notebook's folder is mirrored on disk
    assert note["attrs"] == {"folder": "Research", "path": "notes/Research/Lead.md"}
    assert Case.open(cid).resolve_inside(note["attrs"]["path"]).read_text(
        encoding="utf-8"
    ) == "# First lead"
    assert client.get(f"/api/cases/{cid}/notes/{note['id']}").json()["text"] == "# First lead"

    client.put(f"/api/cases/{cid}/notes/{note['id']}", json={"text": "Updated"})
    assert client.get(f"/api/cases/{cid}/notes/{note['id']}").json()["text"] == "Updated"


def test_deleting_filed_note_removes_markdown_file(client):

    cid = client.post("/api/cases", json={"name": "Notebook delete"}).json()["id"]
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "Disposable"}).json()
    path = Case.open(cid).resolve_inside(note["attrs"]["path"])
    assert path.exists()

    client.delete(f"/api/cases/{cid}/entities/{note['id']}")
    assert not path.exists()


def test_entities_and_deletion_cleanup(client):
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

    from azimut.workspace import Case

    link = Case.open(cid).add_link(person["id"], account["id"], "owns", by="user")
    assert link["type"] == "owns"

    # deleting an entity cascades to its links
    client.delete(f"/api/cases/{cid}/entities/{account['id']}")
    assert len(graph_read.entities(cid)) == 1
    assert graph_read.links(cid) == []


def test_catalog_pagination_and_summary(client):
    cid = client.post("/api/cases", json={"name": "Catalog"}).json()["id"]
    for i in range(5):
        client.post(f"/api/cases/{cid}/entities", json={"type": "person", "label": f"P{i}"})
    client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "account", "label": "@acct", "status": "suggested"},
    )

    # walk the whole catalog in bounded pages
    seen: list[str] = []
    cursor = None
    while True:
        params: dict[str, object] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = client.get(f"/api/cases/{cid}/catalog/entities", params=params).json()
        assert len(page["items"]) <= 2
        seen.extend(e["label"] for e in page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == ["P0", "P1", "P2", "P3", "P4", "@acct"]

    # server-side filters
    people = client.get(
        f"/api/cases/{cid}/catalog/entities", params={"type": "person"}
    ).json()
    assert {e["label"] for e in people["items"]} == {"P0", "P1", "P2", "P3", "P4"}
    suggested = client.get(
        f"/api/cases/{cid}/catalog/entities", params={"status": "suggested"}
    ).json()
    assert [e["label"] for e in suggested["items"]] == ["@acct"]

    # summary counts without shipping the graph
    summary = client.get(f"/api/cases/{cid}/catalog/summary").json()
    assert summary["total"] == 6
    assert summary["by_type"] == {"person": 5, "account": 1}
    assert summary["by_status"] == {"confirmed": 5, "suggested": 1}


def test_catalog_filters_by_folder(client):
    cid = client.post("/api/cases", json={"name": "Foldered"}).json()["id"]
    client.post(f"/api/cases/{cid}/folders", json={"name": "Alpha"})
    client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "person", "label": "filed", "attrs": {"folder": "Alpha"}},
    )
    client.post(f"/api/cases/{cid}/entities", json={"type": "person", "label": "loose"})

    in_alpha = client.get(
        f"/api/cases/{cid}/catalog/entities", params={"folder": "Alpha"}
    ).json()
    assert [e["label"] for e in in_alpha["items"]] == ["filed"]

    unfiled = client.get(
        f"/api/cases/{cid}/catalog/entities", params={"unfiled": "true"}
    ).json()
    assert [e["label"] for e in unfiled["items"]] == ["loose"]

    assert client.get(f"/api/cases/{cid}/catalog/summary").json()["by_folder"] == {"Alpha": 1}


def test_catalog_searches_notes_and_descendant_folders(client):
    cid = client.post("/api/cases", json={"name": "Search"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/entities",
        json={
            "type": "media",
            "label": "frame",
            "attrs": {"folder": "Sources/Telegram", "notes": "bridge crossing"},
        },
    )
    client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "media", "label": "other", "attrs": {"folder": "Research"}},
    )

    page = client.get(
        f"/api/cases/{cid}/catalog/entities",
        params={"folder": "Sources", "recursive": "true", "q": "bridge"},
    ).json()
    assert page["total"] == 1
    assert [entity["label"] for entity in page["items"]] == ["frame"]


def test_catalog_rejects_a_bad_cursor(client):
    cid = client.post("/api/cases", json={"name": "BadCursor"}).json()["id"]
    res = client.get(f"/api/cases/{cid}/catalog/entities", params={"cursor": "not-an-int"})
    assert res.status_code == 400


def test_catalog_clamps_the_page_size(client):
    cid = client.post("/api/cases", json={"name": "Clamp"}).json()["id"]
    for i in range(3):
        client.post(f"/api/cases/{cid}/entities", json={"type": "person", "label": f"P{i}"})
    # a limit below 1 is clamped up to 1 so a page always makes progress
    page = client.get(f"/api/cases/{cid}/catalog/entities", params={"limit": 0}).json()
    assert len(page["items"]) == 1 and page["next_cursor"] is not None


# ---------------------------------------------------------------------------
# Satellite capture notes (PATCH /api/cases/{id}/satellite)
# Uses a pre-written sidecar to avoid a live tile fetch.
# ---------------------------------------------------------------------------



def _plant_capture(client, cid: str) -> dict:
    """File a fake satellite capture through the media pipeline (its real store)."""
    from PIL import Image

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    prov = {
        "provider": "esri-world-imagery",
        "provider_label": "Esri World Imagery",
        "zoom": 16,
        "lat": 50.0,
        "lon": 30.0,
        "bearing": 0.0,
        "fetched_at": "2026-07-08T12:00:00Z",
        "tiles": 9,
        "tiles_missing": 0,
    }
    result = media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (32, 32), (10, 120, 10)),
        "sat_test_z16_esri.png",
        {"type": "satellite", **prov},
        by="satellite",
        entity_type="capture",
        extra_attrs={"coords": "50.000000, 30.000000", "lat": 50.0, "lon": 30.0,
                     "zoom": 16, "bearing": 0.0},
        title="50.000000, 30.000000",
        dedupe=False,
    )
    return {"path": result["item"]["path"], **prov}


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
    entity = next(e for e in graph_read.entities(cid) if e["id"] == ent["id"])
    assert "folder" not in entity["attrs"]


def test_nested_folder_materialises_ancestors(client):
    cid = client.post("/api/cases", json={"name": "Nested"}).json()["id"]

    # creating a leaf path also creates every ancestor node
    folders = client.post(
        f"/api/cases/{cid}/folders", json={"name": "Sources/Telegram/Group A"}
    ).json()
    assert folders == ["Sources", "Sources/Telegram", "Sources/Telegram/Group A"]

    # segments are trimmed and empty ones dropped
    folders = client.post(
        f"/api/cases/{cid}/folders", json={"name": " Sources / Signal "}
    ).json()
    assert "Sources/Signal" in folders


def test_delete_folder_cascades_subtree(client):
    cid = client.post("/api/cases", json={"name": "Cascade"}).json()["id"]
    client.post(f"/api/cases/{cid}/folders", json={"name": "Sources/Telegram"})
    deep = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "note", "label": "chat log",
              "attrs": {"folder": "Sources/Telegram"}},
    ).json()

    # deleting the parent removes the whole subtree and unfiles its entities
    remaining = client.delete(
        f"/api/cases/{cid}/folders", params={"name": "Sources"}
    ).json()
    assert remaining == []
    entity = next(e for e in graph_read.entities(cid) if e["id"] == deep["id"])
    assert "folder" not in entity["attrs"]


def test_delete_media_entity_removes_file(client):
    import io

    cid = client.post("/api/cases", json={"name": "Sync"}).json()["id"]
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00"
        b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    item = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("frame.png", io.BytesIO(png), "image/png")},
    ).json()["item"]
    entity = next(
        e for e in graph_read.entities(cid)
        if e["type"] == "media"
    )

    # deleting the media entity from the sidebar deletes the underlying file too
    client.delete(f"/api/cases/{cid}/entities/{entity['id']}")
    assert client.get(f"/files/{cid}/{item['path']}").status_code == 404
    assert not any(
        e["type"] == "media" for e in graph_read.entities(cid)
    )



def test_cleanup_scratch_reaps_only_old_empty_sessions(tmp_workspace):
    import json as jsonlib

    from azimut.workspace import Case

    old_stamp = "2000-01-01T00:00:00Z"

    def _age(case):
        data = jsonlib.loads(case.json_path.read_text(encoding="utf-8"))
        data["updated_at"] = old_stamp
        case.json_path.write_text(jsonlib.dumps(data), encoding="utf-8")

    # old and empty → reaped
    empty_old = Case.create("Scratch session", scratch=True)
    _age(empty_old)
    # old but holding an entity → kept
    with_entity = Case.create("Scratch session", scratch=True)
    with_entity.add_entity("place", "Somewhere", attrs={}, by="test")
    _age(with_entity)
    # old but holding a media file → kept
    with_file = Case.create("Scratch session", scratch=True)
    (with_file.subdir("media") / "shot.png").write_bytes(b"png")
    _age(with_file)
    # fresh and empty → kept (it may be in use right now)
    empty_new = Case.create("Scratch session", scratch=True)

    assert Case.cleanup_scratch() == 1
    assert not empty_old.path.exists()
    assert with_entity.path.exists()
    assert with_file.path.exists()
    assert empty_new.path.exists()


def test_cleanup_scratch_treats_a_stranded_sidecar_temp_file_as_debris(tmp_workspace):
    """A sidecar write renames a scratch file into place. A power cut in that window
    strands one, and counting it as content would keep an empty scratch session
    alive forever — the exact accumulation cleanup exists to stop."""
    import json as jsonlib

    from azimut.workspace import Case

    stranded = Case.create("Scratch session", scratch=True)
    (stranded.subdir("media") / ".shot.png.azimut.json.deadbeef.tmp").write_bytes(b"{}")
    data = jsonlib.loads(stranded.json_path.read_text(encoding="utf-8"))
    data["updated_at"] = "2000-01-01T00:00:00Z"
    stranded.json_path.write_text(jsonlib.dumps(data), encoding="utf-8")

    assert Case.cleanup_scratch() == 1
    assert not stranded.path.exists()


def test_renaming_a_note_moves_its_file(client):
    """The name is the filename, as it already is for proofs, sessions and
    drafts. Notes were the last holdout."""
    cid = client.post("/api/cases", json={"name": "Renames"}).json()["id"]
    note = client.post(
        f"/api/cases/{cid}/notes",
        json={"title": "Draft lead", "folder": "Research", "content": "# body"},
    ).json()
    case = Case.open(cid)
    assert note["attrs"]["path"] == "notes/Research/Draft lead.md"

    renamed = client.patch(
        f"/api/cases/{cid}/entities/{note['id']}", json={"label": "Confirmed lead"}
    ).json()

    assert renamed["attrs"]["path"] == "notes/Research/Confirmed lead.md"
    assert case.resolve_inside(renamed["attrs"]["path"]).read_text(encoding="utf-8") == "# body"
    assert not case.resolve_inside(note["attrs"]["path"]).exists()


def test_moving_a_note_between_folders_moves_its_file(client):
    """The notebook's tree is mirrored on disk, so filing a note is a move."""
    cid = client.post("/api/cases", json={"name": "Filing"}).json()["id"]
    note = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Summary", "folder": "Video 1"}
    ).json()
    case = Case.open(cid)
    assert note["attrs"]["path"] == "notes/Video 1/Summary.md"

    moved = client.patch(
        f"/api/cases/{cid}/entities/{note['id']}", json={"attrs": {"folder": "Video 2"}}
    ).json()

    assert moved["attrs"]["path"] == "notes/Video 2/Summary.md"
    # the emptied folder does not linger: a mirror that keeps every directory a
    # note passed through stops being a mirror
    assert not case.resolve_inside("notes/Video 1").exists()


def test_a_note_moves_cleanly_under_a_symlinked_workspace(monkeypatch, tmp_path):
    """The same move, reached through a symlink, still prunes what it emptied.

    macOS reaches every temporary directory as `/var` → `/private/var`, and a
    workspace under a linked or synced folder does the same anywhere. The case
    knows its directory by the path it was given while `resolve_inside` hands
    back the resolved one, so a containment check comparing the two spellings
    answers "outside" about a directory that is inside — and the pruning it
    guards silently stops happening.
    """
    real = tmp_path / "real"
    real.mkdir()
    linked = tmp_path / "linked"
    linked.symlink_to(real, target_is_directory=True)
    monkeypatch.setenv("AZIMUT_HOME", str(linked))
    from azimut.server import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        cid = client.post("/api/cases", json={"name": "Filing"}).json()["id"]
        note = client.post(
            f"/api/cases/{cid}/notes", json={"title": "Summary", "folder": "Video 1"}
        ).json()
        case = Case.open(cid)
        assert case.resolve_inside(note["attrs"]["path"]).is_file()

        client.patch(
            f"/api/cases/{cid}/entities/{note['id']}", json={"attrs": {"folder": "Video 2"}}
        )

        assert not case.resolve_inside("notes/Video 1").exists()


def test_the_same_title_lives_in_two_folders(client):
    """Uniqueness is scoped to the folder. This is why the tree is mirrored at
    all: one folder per video is the analyst's whole workflow."""
    cid = client.post("/api/cases", json={"name": "Two videos"}).json()["id"]
    first = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Summary", "folder": "Video 1"}
    ).json()
    second = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Summary", "folder": "Video 2"}
    ).json()

    assert first["attrs"]["path"] == "notes/Video 1/Summary.md"
    assert second["attrs"]["path"] == "notes/Video 2/Summary.md"


def test_the_same_title_twice_in_one_folder_takes_a_suffix(client):
    """A note is the most frequent thing an analyst creates, so a taken name is
    numbered rather than refused."""
    cid = client.post("/api/cases", json={"name": "Same name"}).json()["id"]
    first = client.post(f"/api/cases/{cid}/notes", json={"title": "Lead", "folder": ""}).json()
    second = client.post(f"/api/cases/{cid}/notes", json={"title": "Lead", "folder": ""}).json()

    assert first["attrs"]["path"] == "notes/Lead.md"
    assert second["attrs"]["path"] == "notes/Lead-2.md"
    assert Case.open(cid).resolve_inside(second["attrs"]["path"]).exists()


def test_details_title_edit_moves_every_named_tool_file(client):
    """The shared Details editor bypasses the tool-specific save routes, so its
    generic entity patch must still keep labels and filenames aligned."""
    cid = client.post("/api/cases", json={"name": "Details renames"}).json()["id"]
    case = Case.open(cid)
    fixtures = [
        (
            "proof",
            "spec",
            layout.proof_spec_rel("Old proof"),
            "New proof",
            layout.proof_spec_rel("New proof"),
        ),
        (
            "inspect-session",
            "spec",
            layout.session_rel("Old inspect"),
            "New inspect",
            layout.session_rel("New inspect"),
        ),
        (
            "post",
            "draft",
            layout.draft_rel("Old post"),
            "New post",
            layout.draft_rel("New post"),
        ),
    ]
    entities = []
    for type_, attribute, old, new_label, new in fixtures:
        path = case.resolve_inside(old)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"title": Path(old).stem}), encoding="utf-8")
        attrs = {attribute: old}
        if type_ == "proof":
            export = layout.proof_export_rel("Old proof")
            case.resolve_inside(export).write_bytes(b"png")
            attrs["path"] = export
        entity = case.add_entity(type_, Path(old).stem, attrs, by="user")
        entities.append((entity, old, new_label, new))

    for entity, old, new_label, new in entities:
        updated = client.patch(
            f"/api/cases/{cid}/entities/{entity['id']}",
            json={"label": new_label},
        ).json()
        attribute = "draft" if entity["type"] == "post" else "spec"
        assert updated["label"] == new_label
        assert updated["attrs"][attribute] == new
        assert not case.resolve_inside(old).exists()
        assert case.resolve_inside(new).is_file()
        body = json.loads(case.resolve_inside(new).read_text(encoding="utf-8"))
        assert body["title"] == new_label

    proof = next(entity for entity in case.list_entities() if entity["type"] == "proof")
    assert proof["attrs"]["path"] == layout.proof_export_rel("New proof")
    assert case.resolve_inside(proof["attrs"]["path"]).is_file()
