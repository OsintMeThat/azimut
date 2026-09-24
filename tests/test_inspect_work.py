"""Inspect's work, one per file, the collages laid out from it, and the 0.3.1 merge.

The API half drives the routes the Examine tools call. The migration half builds
cases the way 0.3.0 left them — named sessions, several per file, collages inside —
stamps them back to that schema and opens them, which is exactly what an upgrade does.
"""

from __future__ import annotations

import io
import json

import graph_read
import pytest
from PIL import Image

from azimut import layout, workspace
from azimut.engine import inspectwork
from azimut.engine import links as link_engine
from azimut.workspace import Case


def _png(color=(120, 60, 30), size=(80, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _case(client, name="Work") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, cid, name, color=(120, 60, 30)) -> str:
    res = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(_png(color)), "image/png")},
    )
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _frame(path, frame_id="fr_a", **extra):
    return {"id": frame_id, "path": path, "time": None, "adjust": {}, "crop": None, **extra}


def _save(client, cid, path, frames, **spec):
    return client.put(
        f"/api/cases/{cid}/inspect/work", json={"path": path, "spec": {"frames": frames, **spec}}
    )


def _work(client, cid, path):
    return client.get(f"/api/cases/{cid}/inspect/work", params={"path": path}).json()["work"]


def _of_type(cid, type_):
    return [e for e in graph_read.entities(cid) if e["type"] == type_]


def _piece(path, piece_id="nd_1"):
    return {
        "id": piece_id, "save": {"path": path, "time": None, "ops": []},
        "w": 80, "h": 60, "quad": [[0, 0], [80, 0], [80, 60], [0, 60]],
    }


# -- work ---------------------------------------------------------------------


def test_a_file_with_nothing_done_to_it_has_no_work(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")

    assert _work(client, cid, photo) is None
    assert client.get(f"/api/cases/{cid}/inspect/works").json() == []
    assert _of_type(cid, "inspect-session") == []


def test_the_first_save_files_one_work_named_after_the_file(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")

    saved = _save(client, cid, photo, [_frame(photo, adjust={"brightness": 1.3})])

    assert saved.status_code == 200, saved.text
    assert saved.json() == {"name": "roof", "title": "roof"}
    work = _work(client, cid, photo)
    assert work["spec"]["azimut_inspect"] == inspectwork.WORK_VERSION
    assert work["spec"]["source"] == {"path": photo, "kind": "image"}
    assert work["spec"]["frames"][0]["adjust"] == {"brightness": 1.3}
    [entity] = _of_type(cid, "inspect-session")
    assert entity["attrs"]["spec"] == ".inspect/roof.json"
    [row] = client.get(f"/api/cases/{cid}/inspect/works").json()
    assert row["source"] == photo and row["frames"] == 1 and row["kind"] == "image"


def test_saving_again_rewrites_the_same_work(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo)])
    created = _work(client, cid, photo)["spec"]["created_at"]

    _save(client, cid, photo, [_frame(photo), _frame(photo, "fr_b")], activeFrameId="fr_b")

    work = _work(client, cid, photo)
    assert [f["id"] for f in work["spec"]["frames"]] == ["fr_a", "fr_b"]
    assert work["spec"]["activeFrameId"] == "fr_b"
    assert work["spec"]["created_at"] == created
    assert len(_of_type(cid, "inspect-session")) == 1
    assert len(link_engine_links(cid, "depends-on")) == 1


def link_engine_links(cid, type_):
    return [link for link in graph_read.links(cid) if link["type"] == type_]


def test_a_work_takes_the_next_free_name(client):
    cid = _case(client)
    other = _upload(client, cid, "gate.png", (1, 2, 3))
    photo = _upload(client, cid, "roof.png", (4, 5, 6))
    _save(client, cid, other, [_frame(other)])
    [gate] = _of_type(cid, "inspect-session")
    client.patch(f"/api/cases/{cid}/entities/{gate['id']}", json={"label": "roof"})

    assert _save(client, cid, photo, [_frame(photo)]).json()["name"] == "roof 2"


def test_a_frame_cut_from_another_file_is_refused(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png", (1, 1, 1))
    other = _upload(client, cid, "gate.png", (2, 2, 2))

    res = _save(client, cid, photo, [_frame(other)])

    assert res.status_code == 400
    assert "file it is saved with" in res.json()["detail"]
    assert _work(client, cid, photo) is None


def test_only_an_image_or_a_video_holds_work(client):
    cid = _case(client)
    upload = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("notes.txt", io.BytesIO(b"plain words"), "text/plain")},
    ).json()["item"]["path"]

    res = _save(client, cid, upload, [])

    assert res.status_code == 400
    assert "images and videos" in res.json()["detail"]


def test_a_file_outside_the_case_is_refused(client):
    cid = _case(client)

    res = _save(client, cid, "media/nowhere.png", [])

    assert res.status_code == 400
    assert _of_type(cid, "inspect-session") == []


def test_unknown_frame_fields_are_not_stored(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")

    _save(client, cid, photo, [_frame(photo, url="blob:http://x", secret="y")])

    frame = _work(client, cid, photo)["spec"]["frames"][0]
    assert "url" not in frame and "secret" not in frame


def test_a_runaway_frame_count_is_refused(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    frames = [_frame(photo, f"fr_{i}") for i in range(inspectwork.MAX_FRAMES + 1)]

    assert _save(client, cid, photo, frames).status_code == 400


def test_a_work_renamed_from_details_keeps_saving_under_its_new_name(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo)])
    [entity] = _of_type(cid, "inspect-session")
    client.patch(f"/api/cases/{cid}/entities/{entity['id']}", json={"label": "Roof pass"})

    saved = _save(client, cid, photo, [_frame(photo), _frame(photo, "fr_b")])

    assert saved.json()["name"] == "Roof pass"
    assert len(_of_type(cid, "inspect-session")) == 1
    assert client.get(f"/api/cases/{cid}/inspect/works/Roof pass").json()["spec"]["frames"][1]["id"] == "fr_b"


def test_a_renamed_file_carries_its_work_along(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo)])

    renamed = client.patch(f"/api/cases/{cid}/media", json={"path": photo, "title": "North roof"})
    assert renamed.status_code == 200, renamed.text
    moved = renamed.json()["path"]

    work = _work(client, cid, moved)
    assert work["spec"]["source"]["path"] == moved
    assert work["spec"]["frames"][0]["path"] == moved
    assert _work(client, cid, photo) is None
    # named after the file, so it takes the file's new name with it
    assert work["name"] == "North roof"
    [entity] = _of_type(cid, "inspect-session")
    assert entity["label"] == "North roof"
    assert entity["attrs"]["spec"] == ".inspect/North roof.json"
    assert [row["name"] for row in client.get(f"/api/cases/{cid}/inspect/works").json()] == ["North roof"]


def test_a_long_file_name_cut_to_fit_is_still_followed(client):
    cid = _case(client)
    photo = _upload(client, cid, "clip.png")
    # a download keeps the title it came with, longer than any filename may be
    title = "@Suriyak - The second phase of Operation: what the convoy footage shows, day 2"
    case = Case.open(cid)
    case.update_entity(case.find_entity(attr="path", value=photo)["id"], {"label": title})
    _save(client, cid, photo, [_frame(photo)])
    [entity] = _of_type(cid, "inspect-session")
    assert entity["label"] != title and len(entity["label"]) <= layout.MAX_SLUG

    moved = client.patch(f"/api/cases/{cid}/media", json={"path": photo, "title": "Convoy"}).json()["path"]

    assert _work(client, cid, moved)["name"] == "Convoy"


def test_a_name_the_app_derived_from_the_file_describes_nothing():
    long = "@Suriyak - The second phase of Operation: what the convoy footage shows, day 2"
    cut = layout.slugify(long, "Inspect")
    assert inspectwork._describes_nothing(cut, long)
    assert inspectwork._describes_nothing(inspectwork._free_title({cut.casefold()}, long, "Inspect"), long)
    assert inspectwork._describes_nothing(layout.slugify("Strike: day 2?", "Inspect"), "Strike: day 2?")
    assert inspectwork._describes_nothing("Roof 3", "Roof")
    assert not inspectwork._describes_nothing("Roof pass", "Roof")
    assert not inspectwork._describes_nothing("Roof 2 pass", "Roof")
    assert not inspectwork._describes_nothing("Roo 2", "Roof")


def test_a_renamed_file_leaves_a_typed_work_name_alone(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo)])
    [entity] = _of_type(cid, "inspect-session")
    client.patch(f"/api/cases/{cid}/entities/{entity['id']}", json={"label": "Roof pass"})

    moved = client.patch(f"/api/cases/{cid}/media", json={"path": photo, "title": "North roof"}).json()["path"]

    assert _work(client, cid, moved)["name"] == "Roof pass"


def test_a_file_rename_cut_short_still_carries_its_work_along(client, monkeypatch):
    from azimut.engine import media as media_engine

    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo)])
    case = Case.open(cid)
    follow = inspectwork.follow_file_rename

    def interrupt(*_args):
        raise RuntimeError("simulated interruption")

    monkeypatch.setattr(inspectwork, "follow_file_rename", interrupt)
    with pytest.raises(RuntimeError, match="simulated interruption"):
        media_engine.rename_media(case, photo, "North roof")
    monkeypatch.setattr(inspectwork, "follow_file_rename", follow)
    media_engine.recover_media_rename(case)
    media_engine.recover_media_rename(case)

    assert _work(client, cid, "media/North roof.png")["name"] == "North roof"
    assert len(_of_type(cid, "inspect-session")) == 1


def test_clearing_a_work_sends_it_to_the_trash(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo)])

    cleared = client.delete(f"/api/cases/{cid}/inspect/work", params={"path": photo}).json()

    assert cleared["trash"]
    assert _work(client, cid, photo) is None
    assert graph_read.entity(cid, path=photo) is not None  # the file stands
    client.post(f"/api/cases/{cid}/trash/{cleared['trash']}/restore")
    assert [f["id"] for f in _work(client, cid, photo)["spec"]["frames"]] == ["fr_a"]


def test_restoring_a_cleared_work_merges_it_into_the_one_made_since(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo, "fr_old")])
    cleared = client.delete(f"/api/cases/{cid}/inspect/work", params={"path": photo}).json()
    # starting over takes a name the Trash is not holding, so the restore can land
    assert _save(client, cid, photo, [_frame(photo, "fr_new")]).json()["name"] == "roof 2"

    restored = client.post(f"/api/cases/{cid}/trash/{cleared['trash']}/restore")

    assert restored.status_code == 200, restored.text
    work = _work(client, cid, photo)
    assert [f["id"] for f in work["spec"]["frames"]] == ["fr_new", "fr_old"]
    assert work["name"] == "roof"  # the made-up number goes once the name is free
    assert len(_of_type(cid, "inspect-session")) == 1


def test_a_work_reopens_by_name(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo)])

    assert client.get(f"/api/cases/{cid}/inspect/works/roof").json()["spec"]["source"]["path"] == photo
    assert client.get(f"/api/cases/{cid}/inspect/works/nothing").status_code == 404


# -- collages -----------------------------------------------------------------


def _save_collage(client, cid, title, pieces, name=None, **spec):
    return client.post(
        f"/api/cases/{cid}/collages",
        json={"name": name, "title": title, "spec": {"width": 400, "height": 200, "nodes": pieces, **spec}},
    )


def test_a_new_collage_takes_the_next_free_name(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")

    first = _save_collage(client, cid, "Collage 1", [_piece(photo)]).json()
    second = _save_collage(client, cid, "Collage 1", [_piece(photo)]).json()

    assert first["name"] == "Collage 1"
    assert second["name"] == "Collage 1 2"
    assert {e["attrs"]["spec"] for e in _of_type(cid, "collage")} == {
        ".collages/Collage 1.json", ".collages/Collage 1 2.json",
    }
    assert [row["pieces"] for row in client.get(f"/api/cases/{cid}/collages").json()] == [1, 1]


def test_saving_a_collage_again_rewrites_it_in_place(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save_collage(client, cid, "Strip", [_piece(photo)])

    saved = _save_collage(client, cid, "Strip", [_piece(photo), _piece(photo, "nd_2")], name="Strip")

    assert saved.json()["name"] == "Strip"
    loaded = client.get(f"/api/cases/{cid}/collages/Strip").json()
    assert [n["id"] for n in loaded["spec"]["nodes"]] == ["nd_1", "nd_2"]
    assert len(_of_type(cid, "collage")) == 1


def test_renaming_a_collage_moves_its_file_and_keeps_its_entity(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save_collage(client, cid, "Strip", [_piece(photo)])
    [before] = _of_type(cid, "collage")

    renamed = _save_collage(client, cid, "Harbour strip", [_piece(photo)], name="Strip")

    assert renamed.json()["name"] == "Harbour strip"
    [after] = _of_type(cid, "collage")
    assert after["id"] == before["id"]
    assert after["attrs"]["spec"] == ".collages/Harbour strip.json"
    assert client.get(f"/api/cases/{cid}/collages/Strip").status_code == 404


def test_a_collage_cannot_be_renamed_onto_another(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save_collage(client, cid, "A", [_piece(photo)])
    _save_collage(client, cid, "B", [_piece(photo)])

    res = _save_collage(client, cid, "A", [_piece(photo)], name="B")

    assert res.status_code == 409
    assert len(_of_type(cid, "collage")) == 2


def test_deleting_a_collage_leaves_its_exported_picture(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save_collage(client, cid, "Strip", [_piece(photo)])
    exported = client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={"width": 80, "height": 60, "label": "Strip",
              "nodes": [{"src": {"path": photo}, "quad": [[0, 0], [80, 0], [80, 60], [0, 60]]}]},
    ).json()["item"]["path"]

    deleted = client.delete(f"/api/cases/{cid}/collages/Strip").json()

    assert deleted["trash"]
    assert _of_type(cid, "collage") == []
    assert graph_read.entity(cid, path=exported) is not None


def test_a_piece_without_a_source_is_refused(client):
    cid = _case(client)

    res = _save_collage(client, cid, "Strip", [{"id": "nd_1", "quad": [[0, 0]] * 4}])

    assert res.status_code == 400
    assert _of_type(cid, "collage") == []


def test_a_renamed_file_is_followed_into_the_collages_using_it(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save_collage(client, cid, "Strip", [_piece(photo)])

    moved = client.patch(f"/api/cases/{cid}/media", json={"path": photo, "title": "North roof"}).json()["path"]

    piece = client.get(f"/api/cases/{cid}/collages/Strip").json()["spec"]["nodes"][0]
    assert piece["save"]["path"] == moved


# -- 0.3.0 → 0.3.1 ----------------------------------------------------------------


def _legacy_session(
    case, title, subject, *, frames=(), collages=None, collage=None,
    updated="2026-01-01T00:00:00Z", notes=None, folder=None, kind="image",
):
    """A session exactly as 0.3.0's save route wrote one: spec, entity, depends-on."""
    rel = layout.session_rel(title)
    spec = {
        "azimut_inspect": 1, "title": title, "created_at": updated, "updated_at": updated,
        "source": {"path": subject, "kind": kind}, "videoAdjust": {}, "videoRotation": 0,
        "frames": list(frames), "activeFrameId": frames[0]["id"] if frames else None,
    }
    if collages is not None:
        spec["collages"] = collages
    if collage is not None:
        spec["collage"] = collage
    path = case.resolve_inside(rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(spec), encoding="utf-8")
    attrs = {"spec": rel}
    if notes:
        attrs["notes"] = notes
    if folder:
        attrs["folder"] = folder
    entity = case.add_entity("inspect-session", title, attrs=attrs, by="inspect")
    link_engine.sync(case, entity["id"], link_engine.DEPENDS_ON, [subject], by="inspect")
    return entity


def _legacy_collage(name, pieces, cid="cl_1"):
    return {"id": cid, "name": name, "width": 800, "height": 400, "background": "#12141c",
            "transparent": True, "nodes": pieces}


def _as_0_3_0(case) -> Case:
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.LAYOUT_SCHEMA
    case._write_json(manifest)
    return Case.open(case.id)


def test_opening_a_0_3_0_case_merges_the_sessions_of_one_file(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    case = Case.open(cid)
    older = _legacy_session(case, "Inspect 1", photo, frames=[_frame(photo, "fr_1")],
                            updated="2026-01-01T00:00:00Z")
    newer = _legacy_session(case, "Inspect 2", photo, frames=[_frame(photo, "fr_2")],
                            updated="2026-02-01T00:00:00Z")

    opened = _as_0_3_0(case)

    assert opened.read()["azimut"]["schema"] == workspace.CASE_SCHEMA
    [work] = _of_type(cid, "inspect-session")
    assert work["id"] == newer["id"]  # the latest session is the one that carries on
    assert graph_read.entity(cid, spec=older["attrs"]["spec"]) is None
    assert not opened.resolve_inside(older["attrs"]["spec"]).exists()
    spec = _work(client, cid, photo)["spec"]
    assert spec["azimut_inspect"] == inspectwork.WORK_VERSION
    assert [f["id"] for f in spec["frames"]] == ["fr_2", "fr_1"]
    assert spec["created_at"] == "2026-01-01T00:00:00Z"
    assert len(link_engine_links(cid, "depends-on")) == 1
    # two made-up names described nothing, so the work takes the file's
    assert work["label"] == "roof"
    # the merge cannot be taken back, so both sessions are kept as they were
    for rel in (older["attrs"]["spec"], newer["attrs"]["spec"]):
        kept = opened.resolve_inside(layout.legacy_session_rel(rel.split("/")[-1][:-5]))
        assert json.loads(kept.read_text(encoding="utf-8"))["azimut_inspect"] == 1


def test_sessions_on_different_files_stay_apart(client):
    cid = _case(client)
    roof = _upload(client, cid, "roof.png", (1, 1, 1))
    gate = _upload(client, cid, "gate.png", (2, 2, 2))
    case = Case.open(cid)
    _legacy_session(case, "Roof pass", roof, frames=[_frame(roof)])
    _legacy_session(case, "Gate pass", gate, frames=[_frame(gate)])

    _as_0_3_0(case)

    assert sorted(e["label"] for e in _of_type(cid, "inspect-session")) == ["Gate pass", "Roof pass"]


def test_the_merge_keeps_every_note_and_typed_name(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    case = Case.open(cid)
    _legacy_session(case, "Chimney count", photo, updated="2026-01-01T00:00:00Z",
                    notes="Three chimneys on the east side.", folder="Rooftops")
    _legacy_session(case, "Antenna check", photo, updated="2026-01-02T00:00:00Z")
    _legacy_session(case, "Inspect 7", photo, updated="2026-03-01T00:00:00Z", notes="Latest pass.")

    _as_0_3_0(case)

    [work] = _of_type(cid, "inspect-session")
    # the survivor's own name was made up, so it takes the newest typed one
    assert work["label"] == "Antenna check"
    notes = work["attrs"]["notes"]
    assert notes.startswith("Latest pass.")
    assert "“Chimney count”: Three chimneys on the east side." in notes
    assert "Merged with “Antenna check”." in notes
    assert "Inspect" not in notes.split("Latest pass.", 1)[1]
    assert work["attrs"]["folder"] == "Rooftops"


def test_relations_follow_the_merge(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    case = Case.open(cid)
    merged_away = _legacy_session(case, "Old pass", photo, updated="2026-01-01T00:00:00Z")
    survivor = _legacy_session(case, "New pass", photo, updated="2026-02-01T00:00:00Z")
    note = case.create_note("Working notes", "", "# notes")
    mention = case.add_link(note["id"], merged_away["id"], "mentions", by="user")
    case.update_link(mention["id"], {"nature": "cited"})

    _as_0_3_0(case)

    mentions = link_engine_links(cid, "mentions")
    assert [(m["from"], m["to"]) for m in mentions] == [(note["id"], survivor["id"])]
    assert mentions[0].get("nature") == "cited"


def test_collages_leave_their_sessions_as_documents(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    case = Case.open(cid)
    _legacy_session(case, "Harbour pan", photo, folder="Harbour",
                    collages=[_legacy_collage("Collage 1", [_piece(photo)])])
    _legacy_session(case, "Two layouts", _upload(client, cid, "gate.png", (3, 3, 3)), collages=[
        _legacy_collage("Collage 1", [_piece(photo)], "cl_a"),
        _legacy_collage("Wide view", [_piece(photo)], "cl_b"),
        _legacy_collage("Collage 3", [], "cl_c"),  # nothing on it, nothing to keep
    ])
    _legacy_session(case, "Inspect 4", _upload(client, cid, "mast.png", (4, 4, 4)),
                    collages=[_legacy_collage("Collage 2", [_piece(photo)])])

    _as_0_3_0(case)

    collages = {e["label"]: e for e in _of_type(cid, "collage")}
    assert set(collages) == {"Harbour pan", "Two layouts · Collage 1", "Wide view", "Collage 1"}
    assert collages["Harbour pan"]["attrs"]["folder"] == "Harbour"
    loaded = client.get(f"/api/cases/{cid}/collages/Harbour pan").json()["spec"]
    assert loaded["nodes"][0]["save"]["path"] == photo
    assert loaded["width"] == 800
    # the work keeps its frames and loses its collages
    for row in client.get(f"/api/cases/{cid}/inspect/works").json():
        spec = client.get(f"/api/cases/{cid}/inspect/works/{row['name']}").json()["spec"]
        assert "collages" not in spec and "collage" not in spec


def test_a_session_from_before_the_collage_array_still_yields_its_collage(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    case = Case.open(cid)
    _legacy_session(case, "Old layout", photo,
                    collage={"width": 800, "height": 400, "nodes": [_piece(photo)]})

    _as_0_3_0(case)

    assert [e["label"] for e in _of_type(cid, "collage")] == ["Old layout"]


def test_an_interrupted_migration_resumes_without_repeating_itself(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    case = Case.open(cid)
    _legacy_session(case, "Pass A", photo, frames=[_frame(photo, "fr_a")], notes="A said this.",
                    updated="2026-01-01T00:00:00Z",
                    collages=[_legacy_collage("Collage 1", [_piece(photo)])])
    _legacy_session(case, "Pass B", photo, frames=[_frame(photo, "fr_b")],
                    updated="2026-02-01T00:00:00Z")
    group = inspectwork._group(case, photo)
    done = inspectwork._migrated_collages(case)
    # the first run got as far as the collage and died
    [(rel_a, spec_a)] = [(r, s) for r, s in group if s["title"] == "Pass A"]
    inspectwork._extract_collages(case, rel_a, spec_a, "Pass A", None, done)

    inspectwork.normalize(case)
    inspectwork.normalize(case)

    assert [e["label"] for e in _of_type(cid, "collage")] == ["Pass A"]
    [work] = _of_type(cid, "inspect-session")
    assert work["attrs"]["notes"].count("A said this.") == 1
    spec = _work(client, cid, photo)["spec"]
    assert [f["id"] for f in spec["frames"]] == ["fr_b", "fr_a"]


def test_a_session_whose_file_cannot_be_named_is_left_alone(client):
    cid = _case(client)
    case = Case.open(cid)
    rel = layout.session_rel("Broken")
    path = case.resolve_inside(rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"azimut_inspect": 1, "title": "Broken"}), encoding="utf-8")

    _as_0_3_0(case)

    assert path.exists()
    assert client.get(f"/api/cases/{cid}/inspect/works").json() == []


def test_restoring_a_pre_0_3_1_session_from_the_trash_merges_it(client):
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    _save(client, cid, photo, [_frame(photo, "fr_now")])
    case = Case.open(cid)
    # A session deleted under 0.3.0 comes back out of the Trash after the upgrade.
    old = _legacy_session(case, "Old pass", photo, frames=[_frame(photo, "fr_then")],
                          collages=[_legacy_collage("Collage 1", [_piece(photo)])])
    deleted = client.delete(f"/api/cases/{cid}/entities/{old['id']}").json()

    client.post(f"/api/cases/{cid}/trash/{deleted['trash']}/restore")

    [work] = _of_type(cid, "inspect-session")
    spec = _work(client, cid, photo)["spec"]
    assert [f["id"] for f in spec["frames"]] == ["fr_now", "fr_then"]
    assert [e["label"] for e in _of_type(cid, "collage")] == ["Old pass"]
    assert "Merged with “Old pass”." in work["attrs"]["notes"]
