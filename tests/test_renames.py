"""A rename carries every reference to what it renames (`engine/renames.py`).

A proof, a post, a collage, a comparison, a Horizon view, a map plate, a sheet and an
Inspect work are named by their file, so a rename moves files, and whatever names them
has to follow: a post its proof, a thread its places, a note its picture. Each rename is
read back from what leans on it, a rename cut short finishes on the next open, and the
full case is renamed through every route to prove nothing still names an old file.
"""

from __future__ import annotations

import base64
import io
import json
from urllib.parse import quote, unquote

import pytest
from PIL import Image

from azimut import layout
from azimut.engine import media as media_engine
from azimut.engine import renames as rename_engine
from azimut.engine import scenes as scene_engine
from azimut.workspace import Case

import casefold


def _png(color=(40, 40, 60), size=(80, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _case(client, name="Renames") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, cid, name, color=(200, 30, 30)) -> str:
    res = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(_png(color)), "image/png")},
    )
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _proof(client, cid, title, **spec) -> dict:
    res = client.post(f"/api/cases/{cid}/proofs", json={
        "title": title, "spec": {"panels": [], **spec},
        "png_base64": base64.b64encode(_png()).decode(),
    })
    assert res.status_code == 200, res.text
    return res.json()


def _rename_proof(client, cid, name, title):
    """What the header's name field and the strip's Rename send: the proof as it is,
    under another title."""
    spec = client.get(f"/api/cases/{cid}/proofs/{quote(name, safe='')}").json()
    return client.post(f"/api/cases/{cid}/proofs", json={"rename_from": name, "title": title, "spec": spec})


def _rename_from_details(client, cid, entity_id, label):
    return client.patch(f"/api/cases/{cid}/entities/{entity_id}", json={"label": label})


def _draft(client, cid, title, state) -> dict:
    res = client.post(f"/api/cases/{cid}/drafts", json={"title": title, "state": state})
    assert res.status_code == 200, res.text
    return res.json()


def _state(client, cid, name) -> dict:
    return client.get(f"/api/cases/{cid}/drafts/{quote(name, safe='')}").json()["state"]


def _address(cid, rel) -> str:
    """A case file's address as the Notebook writes it (`lib/fileUrl.js`)."""
    return f"/files/{quote(cid, safe='')}/" + "/".join(quote(part, safe="-_.!~*'()") for part in rel.split("/"))


def _note(client, cid, content) -> str:
    res = client.post(f"/api/cases/{cid}/notes", json={"title": "Findings", "content": content})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _note_text(client, cid, note_id) -> str:
    return client.get(f"/api/cases/{cid}/notes/{note_id}").json()["text"]


def _entity(cid, attr, value):
    return Case.open(cid).find_entity(attr=attr, value=value)


# -- the post that lost its proof ------------------------------------------------------


def test_a_renamed_proof_stays_the_proof_of_its_post(client):
    cid = _case(client)
    saved = _proof(client, cid, "2097290341648855301")
    assert saved["png"] == "proofs/2097290341648855301.png"
    post = _draft(client, cid, "Strike", {"proofPng": saved["png"]})

    # an empty title takes it back to a technical name
    renamed = _rename_proof(client, cid, "2097290341648855301", "")
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["png"] == "proofs/Proof 1.png"

    assert _state(client, cid, post["name"])["proofPng"] == "proofs/Proof 1.png"
    listed = client.get(f"/api/cases/{cid}/drafts").json()
    assert [row["proof"] for row in listed] == ["proofs/Proof 1.png"]
    assert [row["picture"] for row in listed] == ["proofs/Proof 1.png"]
    # the proof the post shows is the one the case lists, so it is not offered to post again
    assert [row["png"] for row in client.get(f"/api/cases/{cid}/proofs").json()] == ["proofs/Proof 1.png"]
    assert client.get(f"/files/{cid}/proofs/Proof 1.png").status_code == 200


def test_a_post_marked_posted_keeps_its_record_on_a_renamed_proof(client):
    cid = _case(client)
    saved = _proof(client, cid, "Bridge")
    url = "https://x.com/desk/status/1850000000000000001"
    post = _draft(client, cid, "Bridge post", {"proofPng": saved["png"]})
    marked = client.put(f"/api/cases/{cid}/drafts/{post['name']}/publish", json={"posted": True, "url": url})
    assert marked.status_code == 200, marked.text
    assert _entity(cid, "path", saved["png"])["attrs"]["posted"][0]["url"] == url

    assert _rename_proof(client, cid, "Bridge", "Road bridge").status_code == 200

    proof = _entity(cid, "path", "proofs/Road bridge.png")
    assert proof["attrs"]["posted"][0]["url"] == url
    # taken back, the record leaves the proof it is on now
    client.put(f"/api/cases/{cid}/drafts/{post['name']}/publish", json={"posted": False})
    assert not _entity(cid, "path", "proofs/Road bridge.png")["attrs"].get("posted")


@pytest.mark.parametrize("route", ["composer", "details"])
def test_every_reference_to_a_renamed_proof_follows_it(client, route):
    cid = _case(client)
    photo = _upload(client, cid, "photo.png")
    saved = _proof(client, cid, "Depot")
    png, spec = saved["png"], saved["spec_path"]

    post = _draft(client, cid, "Depot post", {
        "proofPng": png, "mediaPaths": [photo],
        "alt": {png: "Smoke over the depot", photo: "The photo"},
    })
    thread = _draft(client, cid, "Depot thread", {
        "kind": "video", "video": photo, "first": "place:Depot",
        "extraTweets": [
            {"text": "My own words", "mediaPaths": [png], "mediaType": "images", "key": "place:Depot", "edited": True},
            {"text": "", "mediaPaths": [], "mediaType": "none", "key": "place:Depot yard"},
        ],
    })
    note = _note(client, cid, f"# Findings\n\n![The depot]({_address(cid, png)}){{width=50%}}\n\nDepot burnt.\n")
    plate = client.post(f"/api/cases/{cid}/map-plates", json={
        "title": "Situation", "spec": {"elements": [{"id": "pic", "kind": "image", "box": [1, 1, 50, 50], "src": png}]},
    })
    assert plate.status_code == 200, plate.text
    case = Case.open(cid)
    media_engine.merge_item(case, photo, {"source": {"type": "inspect", "from": png}})
    # a date the proof stated, grown past what a save writes, so a save without a date keeps it
    claim = case.add_entity("claim", scene_engine.dating_label("Depot"),
                            {scene_engine.DATED_BY: spec, "quote": "Shadows run west"}, by="test")

    if route == "composer":
        assert _rename_proof(client, cid, "Depot", "Fuel depot").status_code == 200
    else:
        proof = _entity(cid, "spec", spec)
        res = _rename_from_details(client, cid, proof["id"], "Fuel depot")
        assert res.status_code == 200, res.text
    new_png, new_spec = "proofs/Fuel depot.png", layout.proof_spec_rel("Fuel depot")

    state = _state(client, cid, post["name"])
    assert state["proofPng"] == new_png
    assert state["alt"] == {photo: "The photo", new_png: "Smoke over the depot"}
    threaded = _state(client, cid, thread["name"])
    assert threaded["first"] == "place:Fuel depot"
    assert [(one["key"], one["mediaPaths"]) for one in threaded["extraTweets"]] == [
        ("place:Fuel depot", [new_png]), ("place:Depot yard", []),
    ]
    assert threaded["extraTweets"][0]["text"] == "My own words"
    assert _address(cid, new_png) in _note_text(client, cid, note)
    assert "Depot burnt." in _note_text(client, cid, note)
    shown = client.get(f"/api/cases/{cid}/map-plates/Situation").json()["spec"]["elements"][0]["src"]
    assert shown == new_png
    assert media_engine.read_item(Case.open(cid), photo)["source"]["from"] == new_png
    stated = Case.open(cid).get_entity(claim["id"])
    assert stated["attrs"][scene_engine.DATED_BY] == new_spec
    assert stated["label"] == scene_engine.dating_label("Fuel depot")

    proof = _entity(cid, "spec", new_spec)
    assert proof["label"] == "Fuel depot"
    assert proof["attrs"]["path"] == new_png
    assert json.loads(Case.open(cid).resolve_inside(new_spec).read_text(encoding="utf-8"))["title"] == "Fuel depot"
    assert _names_anywhere(Case.open(cid), {png, spec}) == []


def test_a_reworded_dating_statement_keeps_its_words_through_a_rename(client):
    cid = _case(client)
    saved = _proof(client, cid, "Depot")
    case = Case.open(cid)
    claim = case.add_entity("claim", "Filmed the morning after",
                            {scene_engine.DATED_BY: saved["spec_path"], "quote": "Shadows run west"}, by="test")

    assert _rename_proof(client, cid, "Depot", "Fuel depot").status_code == 200

    assert Case.open(cid).get_entity(claim["id"])["label"] == "Filmed the morning after"


@pytest.mark.parametrize("folded", [False, True], ids=["linux", "windows-macos"])
def test_a_change_of_case_carries_the_post_along(client, monkeypatch, folded):
    cid = _case(client)
    saved = _proof(client, cid, "", **{})
    assert saved["name"] == "Proof 1"
    post = _draft(client, cid, "Strike", {"proofPng": saved["png"]})
    if folded:
        casefold.fold_names(monkeypatch, "proofs")

    renamed = _rename_proof(client, cid, "Proof 1", "proof 1")

    assert renamed.status_code == 200, renamed.text
    case = Case.open(cid)
    assert [p.name for p in (case.tool_root / "proofs" / layout.META_DIR).glob("*.json")] == ["proof 1.json"]
    assert [p.name for p in (case.tool_root / "proofs").glob("*.png")] == ["proof 1.png"]
    assert _state(client, cid, post["name"])["proofPng"] == "proofs/proof 1.png"


# -- a rename cut short ------------------------------------------------------------------


def _cut(monkeypatch, where):
    """Make the rename stop where a crash would."""
    if where == "between-the-files":
        real = rename_engine._move
        calls = []

        def move(*args, **kwargs):
            calls.append(args)
            if len(calls) == 2:
                raise RuntimeError("simulated interruption")
            return real(*args, **kwargs)

        monkeypatch.setattr(rename_engine, "_move", move)
        return lambda: monkeypatch.setattr(rename_engine, "_move", real)
    if where == "after-the-files":
        real_replace = Case.replace_path_references

        def interrupt(*_args):
            raise RuntimeError("simulated interruption")

        monkeypatch.setattr(Case, "replace_path_references", interrupt)
        return lambda: monkeypatch.setattr(Case, "replace_path_references", real_replace)
    real_named = rename_engine._NAMED["proof"]

    def stop(*_args):
        raise RuntimeError("simulated interruption")

    monkeypatch.setitem(rename_engine._NAMED, "proof", stop)
    return lambda: monkeypatch.setitem(rename_engine._NAMED, "proof", real_named)


@pytest.mark.parametrize("where", ["between-the-files", "after-the-files", "after-the-references"])
def test_a_proof_rename_cut_short_finishes_on_the_next_open(client, monkeypatch, where):
    cid = _case(client)
    pasted = _png((220, 220, 40), (30, 20))
    import hashlib

    asset = f"{hashlib.sha256(pasted).hexdigest()[:16]}.png"
    saved = client.post(f"/api/cases/{cid}/proofs", json={
        "title": "Depot", "png_base64": base64.b64encode(_png()).decode(),
        "spec": {"panels": [], "pastes": [{"id": "x0", "asset": asset, "natural": [30, 20], "x": 1, "y": 1, "scale": 1}]},
        "assets": [{"name": asset, "data": base64.b64encode(pasted).decode()}],
    }).json()
    post = _draft(client, cid, "Depot post", {"proofPng": saved["png"]})
    thread = _draft(client, cid, "Depot thread", {
        "kind": "video", "extraTweets": [{"text": "Mine", "mediaPaths": [], "mediaType": "none", "key": "place:Depot"}],
    })
    resume = _cut(monkeypatch, where)

    with pytest.raises(RuntimeError, match="simulated interruption"):
        _rename_proof(client, cid, "Depot", "Fuel depot")
    journal = rename_engine.record_journal(Case.locate(cid))
    assert journal.is_file()

    resume()
    case = Case.open(cid)

    assert not journal.exists()
    new_spec = layout.proof_spec_rel("Fuel depot")
    assert case.resolve_inside(new_spec).is_file()
    assert not case.resolve_inside(saved["spec_path"]).exists()
    assert case.resolve_inside("proofs/Fuel depot.png").is_file()
    assert not case.resolve_inside(saved["png"]).exists()
    assert case.resolve_inside(f"{layout.proof_assets_rel('Fuel depot')}/{asset}").is_file()
    proof = case.find_entity(attr="spec", value=new_spec)
    assert proof["label"] == "Fuel depot"
    assert proof["attrs"]["path"] == "proofs/Fuel depot.png"
    assert [row["name"] for row in client.get(f"/api/cases/{cid}/proofs").json()] == ["Fuel depot"]
    assert client.get(f"/api/cases/{cid}/proofs/Fuel depot").json()["title"] == "Fuel depot"
    assert _state(client, cid, post["name"])["proofPng"] == "proofs/Fuel depot.png"
    assert _state(client, cid, thread["name"])["extraTweets"][0]["key"] == "place:Fuel depot"


def test_a_file_rename_cut_short_inside_its_work_s_rename_finishes_both(client, monkeypatch):
    """Renaming a file renames the Inspect work still named after it, so one rename runs
    inside the other: each keeps its own journal, and the next open finishes both."""
    cid = _case(client)
    photo = _upload(client, cid, "roof.png")
    work = client.put(f"/api/cases/{cid}/inspect/work", json={"path": photo, "spec": {"frames": [
        {"id": "fr_a", "path": photo, "time": None, "adjust": {}, "crop": None},
    ]}})
    assert work.status_code == 200, work.text
    real = rename_engine._retitle

    def stop(*_args):
        raise RuntimeError("simulated interruption")

    monkeypatch.setattr(rename_engine, "_retitle", stop)
    with pytest.raises(RuntimeError, match="simulated interruption"):
        client.patch(f"/api/cases/{cid}/media", json={"path": photo, "title": "North roof"})
    case = Case.locate(cid)
    assert rename_engine.record_journal(case).is_file()
    assert rename_engine.media_journal(case).is_file()

    monkeypatch.setattr(rename_engine, "_retitle", real)
    case = Case.open(cid)

    assert not rename_engine.record_journal(case).exists()
    assert not rename_engine.media_journal(case).exists()
    opened = client.get(f"/api/cases/{cid}/inspect/work", params={"path": "media/North roof.png"}).json()["work"]
    assert opened["name"] == "North roof"
    works = [e for e in case.list_entities() if e["type"] == "inspect-session"]
    assert [(e["label"], e["attrs"]["spec"]) for e in works] == [("North roof", layout.session_rel("North roof"))]


def test_a_rename_waits_for_one_cut_short_to_finish(client, monkeypatch):
    cid = _case(client)
    _proof(client, cid, "Depot")
    _proof(client, cid, "Yard")
    resume = _cut(monkeypatch, "after-the-files")
    with pytest.raises(RuntimeError):
        _rename_proof(client, cid, "Depot", "Fuel depot")
    resume()
    case = Case.locate(cid)  # no open, so nothing has finished it yet

    rename_engine.rename_record(case, "proof", layout.proof_spec_rel("Yard"), layout.proof_spec_rel("Rail yard"))

    labels = sorted(e["label"] for e in Case.open(cid).list_entities() if e["type"] == "proof")
    assert labels == ["Fuel depot", "Rail yard"]
    assert not rename_engine.record_journal(case).exists()


# -- the Media Library and the delete preview read it as before --------------------------


def test_uses_and_the_delete_preview_see_a_renamed_proof_as_before(client):
    cid = _case(client)
    panel = _upload(client, cid, "panel.png")
    clip = _upload(client, cid, "clip.png", (10, 200, 10))
    spare = _upload(client, cid, "spare.png", (10, 10, 200))
    res = client.post(f"/api/cases/{cid}/proofs", json={"title": "Bridge", "spec": {
        "panels": [{"id": "p0", "src": panel}],
        "scene": {"video": clip, "moments": [{"start": 2.0, "end": 5.0}]},
    }})
    assert res.status_code == 200, res.text

    def unused():
        page = client.get(f"/api/cases/{cid}/media/page", params={"unused": "true"}).json()
        return sorted(item["path"] for item in page["items"])

    def touched(path):
        impact = client.post(f"/api/cases/{cid}/delete-impact", json={"paths": [path]}).json()
        return {row["label"]: row["how"] for row in impact["touched"]}

    assert unused() == [spare]
    assert touched(clip) == {"Bridge": ["geolocates a scene of it"]}

    assert _rename_proof(client, cid, "Bridge", "Road bridge").status_code == 200

    assert unused() == [spare]
    assert touched(clip) == {"Road bridge": ["geolocates a scene of it"]}
    proof = _entity(cid, "spec", layout.proof_spec_rel("Road bridge"))
    impact = client.post(f"/api/cases/{cid}/delete-impact", json={"ids": [proof["id"]]}).json()
    assert impact["counts"]["blocking"] == 0


# -- the other renames ---------------------------------------------------------------------


def test_a_media_rename_carries_a_post_s_descriptions_and_a_note_s_picture(client):
    cid = _case(client)
    photo = _upload(client, cid, "port (1).png")
    assert photo == "media/port (1).png"
    post = _draft(client, cid, "Post", {"mediaPaths": [photo], "alt": {photo: "Smoke over the port"}})
    note = _note(client, cid, f"![Port]({_address(cid, photo)})\n")

    renamed = client.patch(f"/api/cases/{cid}/media", json={"path": photo, "title": "Port smoke (2)"})
    assert renamed.status_code == 200, renamed.text
    new = renamed.json()["path"]

    state = _state(client, cid, post["name"])
    assert state["mediaPaths"] == [new]
    assert state["alt"] == {new: "Smoke over the port"}
    assert _note_text(client, cid, note) == f"![Port]({_address(cid, new)})\n"


def test_a_note_s_picture_of_another_case_is_left_alone(client):
    cid = _case(client)
    photo = _upload(client, cid, "photo.png")
    elsewhere = f"![Port](/files/another-case/{photo})\n"
    note = _note(client, cid, elsewhere)

    client.patch(f"/api/cases/{cid}/media", json={"path": photo, "title": "Port smoke"})

    assert _note_text(client, cid, note) == elsewhere


def test_a_missing_file_relinked_by_the_doctor_carries_its_post(client):
    cid = _case(client)
    photo = _upload(client, cid, "photo.png")
    post = _draft(client, cid, "Post", {"mediaPaths": [photo]})
    case = Case.open(cid)
    entity = case.find_entity(attr="path", value=photo)
    replacement = case.media_dir / "found again.png"
    replacement.write_bytes(_png((1, 2, 3)))
    case.resolve_inside(photo).unlink()

    media_engine.relink_existing(case, entity["id"], "media/found again.png")

    assert _state(client, cid, post["name"])["mediaPaths"] == ["media/found again.png"]


# -- the whole case, renamed through every route ------------------------------------------


def _strings(value, key=""):
    if isinstance(value, str):
        yield key, value
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item, key)
    elif isinstance(value, dict):
        for inner, item in value.items():
            yield f"{key}.{inner}" if key else str(inner), str(inner)
            yield from _strings(item, f"{key}.{inner}" if key else str(inner))


#: What is not the case's own record of anything: the Trash, the database's folder (the
#: journal included), and caches rebuilt from what travels.
_NOT_RECORDS = (f"{layout.TRASH_DIR}/", f"{layout.DATA_DIR}/", "media/.thumbs/",
                f"{layout.LAYERS_DIR}/{layout.LAYER_CACHE_DIR}/", f"{layout.INSPECT_DIR}/.v1/")


def _names_anywhere(case: Case, olds: set[str]) -> list[str]:
    """Wherever a record, an entity or a note still names one of these paths."""
    found = []
    root = case.tool_root
    for path in sorted(root.rglob("*.json")):
        rel = path.relative_to(root).as_posix()
        if rel.startswith(_NOT_RECORDS):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        found += [f"{rel} · {key}" for key, value in _strings(data) if value in olds]
    for entity in case.list_entities():
        found += [
            f"{entity['label']} · {key}" for key, value in _strings(entity.get("attrs") or {}) if value in olds
        ]
    notes = [case.notes_path] + [
        case.resolve_inside(e["attrs"]["path"]) for e in case.list_entities() if e["type"] == "note"
    ]
    for note in notes:
        text = note.read_text(encoding="utf-8") if note.is_file() else ""
        found += [f"{note.name} · {old}" for old in olds if unquote(_address(case.id, old)) in unquote(text)]
    return found
