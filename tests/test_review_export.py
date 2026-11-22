"""Export for review (`engine/reviewexport.py`): one note and only what its public web page
needs, as a plain case bundle somebody else imports and publishes.

The proof: a rich article is exported, the bundle imported back as a new case, and the
article's web page and the web map it links to are built again from the imported case. They
must be the pages built from the original, file for file, while the picture only an internal
passage named stays behind and the source case is not touched by a byte.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import sqlite3
import zipfile
from contextlib import closing
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import pytest
from PIL import Image

from azimut import config, layout
from azimut.engine import bundles, media, notelook, notes_web, reviewexport, thumbnails, tiles, workqueue
from azimut.workspace import Case

from fullcase import build_full_case
from jobwait import WAIT

NOW = datetime(2026, 11, 22, 12, 0).astimezone()


def _png(size=(64, 48), colour=(200, 30, 30)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "PNG")
    return buffer.getvalue()


def _ok(response, what: str):
    assert response.status_code == 200, f"{what}: {response.text}"
    return response.json()


def _lookup(client, cid: str, attr: str, value: str) -> str:
    return _ok(client.get(f"/api/cases/{cid}/entities/lookup", params={"attr": attr, "value": value}),
               value)["entity"]["id"]


def _upload(client, cid: str, name: str, colour) -> tuple[str, str]:
    item = _ok(client.post(f"/api/cases/{cid}/media/upload",
                           files={"file": (name, io.BytesIO(_png(colour=colour)), "image/png")}), name)
    return item["entity"]["id"], item["item"]["path"]


def _ground(client, cid: str, lat: float, lon: float) -> str:
    made = _ok(client.post(f"/api/cases/{cid}/satellite/capture", json={
        "lat": lat, "lon": lon, "zoom": 14, "width": 640, "height": 400, "marker_style": "none"}), "ground")
    return made["entity"]["id"]


def _note(client, cid: str, title: str, text: str, look: dict | None = None) -> str:
    note = _ok(client.post(f"/api/cases/{cid}/notes", json={"title": title, "content": ""}), title)["id"]
    if look is not None:
        _ok(client.put(f"/api/cases/{cid}/notes/{note}/look", json=look), f"{title} look")
    _ok(client.put(f"/api/cases/{cid}/notes/{note}", json={"text": text}), title)
    return note


def _where(before: bytes, after: bytes) -> str:
    """Where two files first part, a little of each around it, for a failure to name."""
    at = next((index for index, (one, two) in enumerate(zip(before, after)) if one != two), min(len(before), len(after)))
    return f"at byte {at}:\n  was {before[max(0, at - 160):at + 160]!r}\n  now {after[max(0, at - 160):at + 160]!r}"


#: The fingerprint a page prints of the text it was made from (`notes_html`, its footer).
FINGERPRINT = re.compile(rb'(<span class="az-fingerprint">Source SHA-256 <code>)[0-9a-f]{64}(</code>)')


def _fingerprinted(files: dict[str, bytes]) -> dict[str, bytes]:
    """A page's files with the fingerprint of its source text set aside: the one difference the
    copy makes on purpose. A picture written by the sender's file address (`/files/<case>/…`)
    is written by its record in the copy, since the receiving case has another name, so the
    source the page fingerprints says the same picture in other words."""
    return {name: FINGERPRINT.sub(rb"\1-\2", data) if name == notes_web.INDEX else data
            for name, data in files.items()}


def _tree(root: Path) -> dict[str, str]:
    """Every file under a folder with its digest: what "not touched by a byte" compares."""
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob("*")) if path.is_file()}


@pytest.fixture()
def flat_tiles(monkeypatch):
    """Every map tile one flat square, fetched from nowhere."""
    monkeypatch.setattr(tiles, "_default_fetch", lambda _client, _url: Image.new("RGB", (256, 256), (70, 96, 64)))


@pytest.fixture()
def article(client, flat_tiles):
    """A full case, and in it an article that shows, cites and maps a good part of it."""
    full = build_full_case(client, name="Harbour desk")
    cid = full.case_id
    photo = _lookup(client, cid, "path", full.photo)
    piece = _lookup(client, cid, "path", full.piece)
    pair = _lookup(client, cid, "path", full.compare_pair)
    layer = Path(full.layer).stem
    editable = Path(full.editable_layer).stem
    plate = Path(full.map_plate).stem
    # a proof dated in the map's period, made from the photo, depicting the tower
    proof = _ok(client.post(f"/api/cases/{cid}/proofs", json={
        "title": "Gate proof",
        "spec": {"when": "2026-10-09", "points": [{"coords": "48.8584, 2.2945", "label": "Gate"}],
                 "coordsText": "48.8584, 2.2945", "description": "The gate seen from the quay.",
                 "panels": [{"id": "p0", "src": full.photo, "natural": [80, 60]}]},
        "png_base64": base64.b64encode(_png((120, 80), (30, 90, 160))).decode(),
    }), "proof")
    proof_id = _lookup(client, cid, "spec", proof["spec_path"])
    _ok(client.post(f"/api/cases/{cid}/links", json={"from_id": proof_id, "to_id": full.place_id, "type": "depicts"}),
        "depicts")
    # the editable layer also follows the photo, which stands where it was located, and the proof
    _ok(client.post(f"/api/cases/{cid}/map-layers/{editable}/links", json={"items": [
        {"id": photo, "lat": 48.8584, "lon": 2.2945}, {"id": proof_id, "lat": 48.8584, "lon": 2.2945}]}), "follow")
    ground = _ground(client, cid, 48.8584, 2.2945)
    page_ground = _ground(client, cid, 48.85, 2.30)
    # pictures only internal passages name, and a person named nowhere else in public
    secret, secret_path = _upload(client, cid, "secret.png", (250, 0, 250))
    chapter_secret, _ = _upload(client, cid, "chapter-secret.png", (0, 250, 250))
    # a picture written by its file's address, which no record files
    case = Case.open(cid)
    loose = case.media_dir / "loose.png"
    loose.write_bytes(_png(colour=(10, 200, 10)))
    item = {"path": "media/loose.png", "filename": "loose.png", "title": "Loose frame", "kind": "image",
            "sha256": media.sha256_file(loose), "size": loose.stat().st_size, "added_at": "2026-11-01T10:00:00Z",
            "source": {"type": "manual", "original_name": "loose.png"}, "thumbnail": None}
    media._write_sidecar(loose, item)
    case.upsert_media_item(item)

    map_page = _note(client, cid, "Harbour map", (
        "Where everything stands.\n\n"
        f"::: map\ntitle: The harbour\nlayer: {layer}\nground: {page_ground}\n:::\n"),
        look={"style": "article", "web": "map"})
    chapter = _note(client, cid, "Background", (
        "## Background\n\n"
        f"The ship [[entity:{full.vessel_id}|MV Aurora]] berthed here, as [[media:{piece}|the piece]] shows.\n\n"
        f"> [!internal]\n> Not for print: [[media:{chapter_secret}|chapter secret]].\n"))
    text = (
        "# Harbour article\n\n"
        f"The photo [[media:{photo}|photo of the quay]]{{caption=\"The quay at dawn\"}} was posted online.\n\n"
        f"![Harbour change](azimut://media/{pair})\n\n"
        f"![Loose frame](/files/{quote(cid)}/media/loose.png)\n\n"
        f"[[media:{proof_id}|Gate proof]]\n\n"
        f"The ship [[entity:{full.vessel_id}|MV Aurora]] and [the harbour thread](https://example.test/thread/48).\n\n"
        f"[[include:{chapter}]]\n\n"
        f"::: map\ntitle: Situation\nlayer: {editable}\nlayer: {layer}\nplate: {plate}\n"
        f"proofs: 2026-10-01..2026-10-31\nground: {ground}\n:::\n\n"
        f"::: post\npost: {full.social_post_id}\nhighlight: no vehicles left\n:::\n\n"
        f"::: chart\nkind: bars\ntitle: Candidates by status\ncount: rows\nby: Status\nfrom: sheet:{full.sheet_id}\n"
        "| Subject | Status |\n| --- | --- |\n| Quai sud | ruled out |\n| Pont nord | to do |\n:::\n\n"
        f"::: chart\nkind: pictures\n| Picture | # |\n| --- | --- |\n| {piece} | #1 |\n:::\n\n"
        f"> [!internal]\n> Only for the desk: [[media:{secret}|the secret]] and [[entity:{full.person_id}|A. Nadeau]].\n\n"
        f"The whole harbour is on [[entity:{map_page}|the map]].\n"
    )
    note = _note(client, cid, "Harbour article", text, look={
        "style": "article", "cover": {"on": True, "subtitle": "What the case shows", "image": photo,
                                      "date": "2026-11-20"},
        "author": "Guest Writer", "author_image": piece})
    assert workqueue.wait_until_idle(timeout=WAIT)
    return {"full": full, "cid": cid, "note": note, "chapter": chapter, "map_page": map_page, "photo": photo,
            "piece": piece, "pair": pair, "proof": proof_id, "secret": secret, "secret_path": secret_path,
            "chapter_secret": chapter_secret, "ground": ground, "layer": layer, "editable": editable}


def _import(bundle: Path) -> Case:
    header = bundles.inspect_bundle(bundle)
    assert header["sealed"] is False
    destination = bundles.create_import_case(header["case_name"])
    answer = bundles.import_into(destination, bundle)
    assert answer["left_out"] == []
    imported = Case.open(answer["case_id"])
    # the import queues each picture's thumbnail, which a picture wall shows: let them land
    assert workqueue.wait_until_idle(timeout=WAIT)
    for item in imported.list_media_items():
        if item.get("kind") in thumbnails.THUMBNAILED_KINDS and item.get("sha256"):
            thumbnails.generate(imported, item["path"], item["sha256"], item["kind"])
    return imported


def test_the_imported_article_and_its_map_page_are_the_pages_the_original_builds(article):
    case = Case.open(article["cid"])
    before = {one: notes_web.build(case, article[one], now=NOW) for one in ("note", "map_page")}
    untouched = _tree(case.path)

    found = reviewexport.contents(case, article["note"])
    bundle = reviewexport.export(case, article["note"])

    # the source case is never written, and nothing is left beside the bundle
    assert _tree(case.path) == untouched
    assert bundle.name == "Harbour article (for review).azimut.zip"
    assert [one.name for one in config.bundles_dir().iterdir()] == [bundle.name]

    imported = _import(bundle)
    assert imported.read()["name"] == "Harbour article (for review) (imported)"
    after = {one: notes_web.build(imported, article[one], now=NOW) for one in ("note", "map_page")}
    for one in ("note", "map_page"):
        was, now = _fingerprinted(before[one].files), _fingerprinted(after[one].files)
        assert sorted(now) == sorted(was)
        for name, data in was.items():
            assert now[name] == data, f"{one}: {name} differs {_where(data, now[name])}"
        assert after[one].warnings == before[one].warnings
    # the map page holds no file address: its fingerprint is the original's too
    assert after["map_page"].files[notes_web.INDEX] == before["map_page"].files[notes_web.INDEX]

    # what an internal passage alone named stayed behind, in the bundle as in the case it made
    for gone in (article["secret"], article["chapter_secret"], article["full"].person_id):
        assert gone not in found.entities and imported.get_entity(gone) is None
    assert not imported.resolve_inside(article["secret_path"]).exists()
    with zipfile.ZipFile(bundle) as archive:
        names = archive.namelist()
        assert not [name for name in names if name.endswith("secret.png")]
        carried = b"".join(archive.read(name) for name in names if name.endswith(".md"))
    assert b"Only for the desk" not in carried and b"Not for print" not in carried
    assert found.internal == 2

    # the rest of the case stayed: a note it never named, a sheet, a horizon view, the jobs
    full = article["full"]
    for left in (full.map_note_id, full.note_id, full.post_note_id, full.person_id, full.claim_id):
        assert imported.get_entity(left) is None
    assert not imported.resolve_inside(full.horizon_view).exists()
    assert not imported.resolve_inside(layout.note_editions_rel(full.note_id)).exists()
    with closing(sqlite3.connect(imported.db_path)) as conn:
        assert conn.execute("SELECT COUNT(*) FROM analysis_views").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM graph_pins").fetchone()[0] == 0
        attrs = json.loads(conn.execute("SELECT attrs_json FROM entities WHERE id = ?",
                                        (article["note"],)).fetchone()[0])
    assert set(attrs) <= {"path", "look"}


def test_what_the_dialog_lists_is_what_leaves(article):
    case = Case.open(article["cid"])
    found = reviewexport.contents(case, article["note"])
    groups = {group["key"]: group for group in found.groups()}
    assert groups["note"]["names"] == ["Harbour article"]
    assert groups["chapters"]["names"] == ["Background"]
    assert groups["pages"]["names"] == ["Harbour map"]
    assert {"Situation", "The harbour"} <= set(found.maps)
    assert "Loose frame" in groups["pictures"]["names"]
    assert {"Checkpoints", "Working checkpoints", "Situation"} <= set(groups["layers"]["names"])
    assert groups["posts"]["count"] == 1 and groups["sheets"]["names"] == ["Candidates"]
    assert "MV Aurora" in groups["records"]["names"]
    # the account that posted the photo, the place the proof depicts, the bookmark a link finds
    assert {"@harbourwatch", "Tower", "Harbour watch thread"} <= set(groups["sources"]["names"])
    bundle = reviewexport.export(case, article["note"])
    with zipfile.ZipFile(bundle) as archive:
        members = {name.removeprefix("case/azimut/") for name in archive.namelist()}
    for rel in found.files:
        if (case.tool_root / rel).is_file():
            assert rel in members, rel
    imported = _import(bundle)
    held = {entity["id"] for entity in imported.list_entities()}
    # every record the dialog listed, and the loose frame filed as one of its own
    assert set(found.entities) <= held and len(held) == len(found.entities) + 1


def test_an_article_with_no_author_is_signed_with_the_name_and_logo_given(client, monkeypatch):
    cid = _ok(client.post("/api/cases", json={"name": "Desk"}), "case")["id"]
    picture, _ = _upload(client, cid, "shot.png", (90, 90, 90))
    note = _note(client, cid, "Short piece", f"Words.\n\n[[media:{picture}|shot]]\n")
    config.signature_path().parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (120, 120), (200, 40, 40, 255)).save(config.signature_path())
    monkeypatch.setattr(reviewexport, "report_name", lambda: "Guest Analyst")

    shown = _ok(client.get(f"/api/cases/{cid}/notes/{note}/review"), "preview")
    assert (shown["author"], shown["picture"]) == ("Guest Analyst", reviewexport.LOGO)
    assert shown["pictures"] == [{"value": reviewexport.LOGO, "label": "Your logo"}]
    assert shown["file"] == "Short piece (for review).azimut.zip"

    case = Case.open(cid)
    bundle = reviewexport.export(case, note, author="Guest Analyst", picture=reviewexport.LOGO)
    imported = _import(bundle)
    look = notelook.stored(imported, note)
    assert look is not None and look.author == "Guest Analyst"
    face = imported.get_entity(look.author_image)
    assert face is not None and face["type"] == "media" and face["attrs"]["kind"] == "image"
    assert imported.resolve_inside(face["attrs"]["path"]).read_bytes() == config.signature_path().read_bytes()
    page = notes_web.build(imported, note, now=NOW)
    assert "author.png" in page.files and b"Guest Analyst" in page.files["index.html"]
    # the source note keeps no author of its own
    assert notelook.stored(case, note) is None


def test_an_export_that_fails_leaves_nothing_behind(client, monkeypatch):
    cid = _ok(client.post("/api/cases", json={"name": "Desk"}), "case")["id"]
    note = _note(client, cid, "Piece", "Words.\n")
    case = Case.open(cid)

    def broken(*_args, **_kwargs):
        raise bundles.BundleError("the disk is full")

    monkeypatch.setattr(bundles, "export_case", broken)
    with pytest.raises(bundles.BundleError):
        reviewexport.export(case, note)
    assert list(config.bundles_dir().iterdir()) == []


def test_the_route_queues_the_export_and_the_job_names_its_file(client):
    cid = _ok(client.post("/api/cases", json={"name": "Desk"}), "case")["id"]
    note = _note(client, cid, "Piece", "Words.\n\n> [!internal]\n> Not this.\n")
    shown = _ok(client.get(f"/api/cases/{cid}/notes/{note}/review"), "preview")
    assert shown["internal"] == 1 and shown["groups"][0] == {"key": "note", "label": "Note", "count": 1,
                                                             "names": ["Piece"]}
    started = _ok(client.post(f"/api/cases/{cid}/notes/{note}/review", json={"author": "Guest"}), "queue")
    assert started["file"] == "Piece (for review).azimut.zip"
    assert workqueue.wait_until_idle(timeout=WAIT)
    job = _ok(client.get(f"/api/cases/{cid}/bundle/jobs/{started['job_id']}"), "job")
    assert (job["state"], job["file"]) == ("ready", "Piece (for review).azimut.zip")
    assert (config.bundles_dir() / job["file"]).is_file()
    # a picture that is no picture of the case, or the case notes, are refused at the edge
    refused = client.post(f"/api/cases/{cid}/notes/{note}/review", json={"picture": "e_nothing00"})
    assert refused.status_code == 400
    assert client.get(f"/api/cases/{cid}/notes/case/review").status_code == 400


def test_a_copy_an_interrupted_export_left_is_swept_at_the_next_start(tmp_workspace):
    config.bundles_dir().mkdir(parents=True)
    left = config.bundles_dir() / f"{reviewexport.STAGING_PREFIX}abc123"
    (left / "case").mkdir(parents=True)
    (left / "case" / "file.txt").write_text("half", encoding="utf-8")
    kept = config.bundles_dir() / "kept.azimut.zip"
    kept.write_bytes(b"zip")
    assert reviewexport.sweep_staging() == 1
    assert not left.exists() and kept.is_file()
