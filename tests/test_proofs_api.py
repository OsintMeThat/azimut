"""Proofs: save spec+PNG, list, reload, entity upsert, delete."""

import base64

import graph_read
import io

import pytest
from PIL import Image


def _png_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (80, 50), (40, 40, 60)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


SPEC = {
    "templateId": "dark-house",
    "captionSize": 24,
    "legendSize": 22,
    "footerSize": 18,
    "footer": "Custom footer line",
    "panels": [
        {"id": "p1", "src": "media/frame.png", "caption": "Frame", "row": 0, "natural": [1280, 720], "meta": {}},
        {"id": "p2", "src": "satellite/sat.png", "caption": "Esri", "row": 1, "natural": [1000, 700],
         "meta": {"kind": "satellite", "attribution": "Esri", "lat": 1.0, "lon": 2.0}},
    ],
    "shapes": [
        {"id": "s1", "panel": "p1", "kind": "rect", "x": 10, "y": 10, "w": 100, "h": 50,
         "color": "#ff5252", "strokeWidth": 4, "comment": "blue roof"},
    ],
    "coords": {"lat": 1.0, "lon": 2.0},
    "notes": {"#ff5252": "blue roof matches"},
}


def test_save_load_roundtrip(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]

    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Kharkiv strike proof", "spec": SPEC, "png_base64": _png_b64()},
    ).json()
    assert saved["name"] == "kharkiv-strike-proof"
    assert saved["png"] == "proofs/kharkiv-strike-proof.png"

    listed = client.get(f"/api/cases/{cid}/proofs").json()
    assert len(listed) == 1
    assert listed[0]["panels"] == 2 and listed[0]["shapes"] == 1

    spec = client.get(f"/api/cases/{cid}/proofs/kharkiv-strike-proof").json()
    assert spec["title"] == "Kharkiv strike proof"
    assert spec["shapes"][0]["comment"] == "blue roof"
    assert spec["notes"] == {"#ff5252": "blue roof matches"}  # legend text is per color
    assert spec["panels"][0]["id"] == "p1"  # panel ids survive → shapes stay bound
    # multi-row layout + text sizes + custom footer survive the round-trip
    assert [p["row"] for p in spec["panels"]] == [0, 1]
    assert spec["captionSize"] == 24
    assert spec["legendSize"] == 22
    assert spec["footerSize"] == 18
    assert spec["footer"] == "Custom footer line"
    assert spec["templateId"] == "dark-house"

    # PNG served
    assert client.get(f"/files/{cid}/{saved['png']}").status_code == 200

    # proof entity filed once, updated on resave
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": saved["name"], "title": "Kharkiv strike proof", "spec": SPEC},
    )
    entities = [e for e in graph_read.entities(cid) if e["type"] == "proof"]
    assert len(entities) == 1
    assert entities[0]["label"] == "Kharkiv strike proof"


def test_resave_with_png_adds_the_path_to_the_entity(client):
    cid = client.post("/api/cases", json={"name": "SpecFirst"}).json()["id"]

    # first save is spec-only: no PNG, so the entity has no path
    saved = client.post(
        f"/api/cases/{cid}/proofs", json={"title": "Draft proof", "spec": SPEC}
    ).json()
    entity = next(
        e for e in graph_read.entities(cid) if e["type"] == "proof"
    )
    assert "path" not in entity["attrs"]

    # exporting later re-saves with the PNG — the entity must gain the path,
    # or the sidebar preview and delete_by_path can't see the file
    client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "rename_from": saved["name"],
            "title": "Draft proof",
            "spec": SPEC,
            "png_base64": _png_b64(),
        },
    )
    entity = next(
        e for e in graph_read.entities(cid) if e["type"] == "proof"
    )
    assert entity["attrs"]["path"] == f"proofs/{saved['name']}.png"


def test_invalid_png_rejected(client):
    cid = client.post("/api/cases", json={"name": "Bad"}).json()["id"]
    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "x", "spec": SPEC, "png_base64": "not-base64!!!"},
    )
    assert res.status_code == 422


def test_rename_moves_the_spec_and_the_export(client):
    # The name in the composer header is the filename. Renaming a saved proof
    # takes its spec, its PNG and its entity along, so nothing is orphaned and
    # the proof keeps its folder and links.
    cid = client.post("/api/cases", json={"name": "RenameProof"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Proof 1", "spec": SPEC, "png_base64": _png_b64()},
    ).json()
    before = next(e for e in graph_read.entities(cid) if e["type"] == "proof")
    client.patch(f"/api/cases/{cid}/entities/{before['id']}", json={"attrs": {"folder": "Reports"}})

    renamed = client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "rename_from": saved["name"],
            "title": "Rooftop angle",
            "spec": SPEC,
            "png_base64": _png_b64(),
        },
    ).json()
    assert renamed["name"] == "rooftop-angle"
    assert renamed["png"] == "proofs/rooftop-angle.png"
    assert client.get(f"/api/cases/{cid}/proofs/proof-1").status_code == 404
    assert client.get(f"/files/{cid}/proofs/proof-1.png").status_code == 404
    assert client.get(f"/files/{cid}/proofs/rooftop-angle.png").status_code == 200

    proofs = [e for e in graph_read.entities(cid) if e["type"] == "proof"]
    assert len(proofs) == 1
    assert proofs[0]["id"] == before["id"]
    assert proofs[0]["attrs"]["spec"] == "proofs/rooftop-angle.json"
    assert proofs[0]["attrs"]["path"] == "proofs/rooftop-angle.png"
    assert proofs[0]["attrs"]["folder"] == "Reports"


def test_rename_without_fresh_pixels_carries_the_export_along(client):
    # A save that ships no PNG (spec-only) must not strand the export under the
    # old name — the proof would lose its picture on a pure rename.
    cid = client.post("/api/cases", json={"name": "CarryPng"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Proof 1", "spec": SPEC, "png_base64": _png_b64()},
    )
    renamed = client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": "proof-1", "title": "Carried", "spec": SPEC},
    ).json()

    assert renamed["png"] == "proofs/carried.png"
    assert client.get(f"/files/{cid}/proofs/carried.png").status_code == 200
    assert client.get(f"/files/{cid}/proofs/proof-1.png").status_code == 404
    entity = next(e for e in graph_read.entities(cid) if e["type"] == "proof")
    assert entity["attrs"]["path"] == "proofs/carried.png"


def test_rename_onto_a_taken_name_is_refused(client):
    cid = client.post("/api/cases", json={"name": "ClashProof"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Proof 1", "spec": SPEC, "png_base64": _png_b64()},
    )
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Proof 2", "spec": SPEC, "png_base64": _png_b64()},
    )

    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "rename_from": "proof-2",
            "title": "Proof 1",
            "spec": SPEC,
            "png_base64": _png_b64(),
        },
    )
    assert res.status_code == 409
    listed = sorted(p["name"] for p in client.get(f"/api/cases/{cid}/proofs").json())
    assert listed == ["proof-1", "proof-2"]
    assert client.get(f"/files/{cid}/proofs/proof-2.png").status_code == 200


def test_rename_keeps_the_creation_date(client):
    cid = client.post("/api/cases", json={"name": "BornProof"}).json()["id"]
    client.post(f"/api/cases/{cid}/proofs", json={"title": "Proof 1", "spec": SPEC})
    born = client.get(f"/api/cases/{cid}/proofs/proof-1").json()["created_at"]

    client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": "proof-1", "title": "Renamed", "spec": SPEC},
    )
    assert client.get(f"/api/cases/{cid}/proofs/renamed").json()["created_at"] == born


def test_delete_proof(client):
    cid = client.post("/api/cases", json={"name": "DelProof"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Temp", "spec": SPEC, "png_base64": _png_b64()},
    ).json()
    client.delete(f"/api/cases/{cid}/proofs/{saved['name']}")
    assert client.get(f"/api/cases/{cid}/proofs").json() == []
    assert client.get(f"/api/cases/{cid}/proofs/{saved['name']}").status_code == 404
    assert [e for e in graph_read.entities(cid) if e["type"] == "proof"] == []


def _big_png_b64(size=(2400, 1600)) -> str:
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 90, 140)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_save_produces_a_thumbnail_of_the_export(client):
    from azimut.api.cases import get_case

    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Wide proof", "spec": SPEC, "png_base64": _big_png_b64()},
    ).json()

    assert saved["thumb"] and saved["thumb"] != saved["png"]
    case = get_case(cid)
    thumb, png = case.resolve_inside(saved["thumb"]), case.resolve_inside(saved["png"])
    assert thumb.stat().st_size < png.stat().st_size
    assert client.get(f"/files/{cid}/{saved['thumb']}").status_code == 200

    # the listing hands it to the open dialog, so the row never loads the export
    assert client.get(f"/api/cases/{cid}/proofs").json()[0]["thumb"] == saved["thumb"]


def test_listing_backfills_a_proof_saved_before_thumbnails(client):
    import json

    from azimut.api.cases import get_case

    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Old proof", "spec": SPEC, "png_base64": _big_png_b64()},
    ).json()

    # roll the proof back to what an older save left on disk: a spec with no
    # thumbnail recorded, and nothing in the cache
    case = get_case(cid)
    spec_path = case.resolve_inside(saved["spec_path"])
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    del spec["thumb"]
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    case.resolve_inside(saved["thumb"]).unlink()

    listed = client.get(f"/api/cases/{cid}/proofs").json()[0]
    assert listed["thumb"] == saved["thumb"]
    assert case.resolve_inside(listed["thumb"]).is_file()
    # recorded, so the next listing costs nothing
    assert json.loads(spec_path.read_text(encoding="utf-8"))["thumb"] == saved["thumb"]


def test_listing_falls_back_to_the_export_when_no_thumbnail_can_be_made(client):
    from azimut.api.cases import get_case

    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Broken proof", "spec": SPEC, "png_base64": _png_b64()},
    ).json()

    case = get_case(cid)
    case.resolve_inside(saved["thumb"]).unlink()
    case.resolve_inside(saved["png"]).write_bytes(b"not an image")
    # rewrite the spec so the recorded thumbnail is not simply reused
    spec_path = case.resolve_inside(saved["spec_path"])
    spec_path.write_text(spec_path.read_text(encoding="utf-8").replace(saved["thumb"], ""), encoding="utf-8")

    listed = client.get(f"/api/cases/{cid}/proofs").json()[0]
    assert not listed["thumb"]
    assert listed["png"] == saved["png"]  # the row still shows something


def test_cache_repair_keeps_proof_thumbnails(client):
    from azimut.api.cases import get_case
    from azimut.engine import thumbnails

    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Kept proof", "spec": SPEC, "png_base64": _big_png_b64()},
    ).json()

    case = get_case(cid)
    thumbnails.repair(case)  # no media sidecar references it, but a proof does
    assert case.resolve_inside(saved["thumb"]).is_file()


# -- the proofs index: proofs placed on the map ---------------------------------------
# A proof carries no coordinates of its own (ONTOLOGY: `spec` + `path`), so the
# map reads them one hop back through `derived-from`. What must hold: the point
# is inherited, a proof composed of panels from two places is at both, and one
# with no located source still lists.


@pytest.fixture()
def sat_tiles(monkeypatch):
    """Captures without the network: every tile is a solid green square."""
    from azimut.engine import tiles

    monkeypatch.setattr(
        tiles, "_default_fetch", lambda client, url: Image.new("RGB", (256, 256), (10, 120, 10))
    )


def _panels(*srcs):
    return {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)]}


def _sat(client, cid, lat, lon):
    """A saved capture — the only kind of panel that carries a point."""
    return client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": lat, "lon": lon, "zoom": 16, "width": 256, "height": 256},
    ).json()


def _proof_index(client, cid):
    return client.get(f"/api/cases/{cid}/proofs/index").json()


def test_index_inherits_the_point_from_the_capture_it_composes(client, sat_tiles):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    cap = _sat(client, cid, 50.4501, 30.5234)
    client.post(
        f"/api/cases/{cid}/proofs", json={"title": "Kyiv bridge", "spec": _panels(cap["path"])}
    )

    row = _proof_index(client, cid)[0]
    assert row["kind"] == "proof"
    assert row["title"] == "Kyiv bridge"
    assert row["name"] == "kyiv-bridge"
    assert (row["lat"], row["lon"]) == (50.4501, 30.5234)
    assert row["notes"] == ""
    assert row["folder"] == ""  # unfiled, never null


def test_index_places_a_proof_at_each_of_its_source_points(client, sat_tiles):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    kyiv = _sat(client, cid, 50.4501, 30.5234)
    paris = _sat(client, cid, 48.8584, 2.2945)
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Two cities", "spec": _panels(kyiv["path"], paris["path"])},
    )

    rows = _proof_index(client, cid)
    assert len({r["id"] for r in rows}) == 1  # one proof…
    assert sorted(r["lat"] for r in rows) == [48.8584, 50.4501]  # …at both its places
    assert len({r["key"] for r in rows}) == 2  # but two marks, so two render keys


def test_index_folds_panels_that_share_one_point_into_one_row(client, sat_tiles):
    """Two zooms of the same roof are one place, so they are one mark."""
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    a = _sat(client, cid, 50.4501, 30.5234)
    b = _sat(client, cid, 50.4501, 30.5234)
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Same roof", "spec": _panels(a["path"], b["path"])},
    )

    rows = _proof_index(client, cid)
    assert [(r["title"], r["lat"]) for r in rows] == [("Same roof", 50.4501)]


def test_index_lists_a_proof_with_no_located_source_without_a_point(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/proofs", json={"title": "Photos only", "spec": _panels("media/x.jpg")}
    )

    row = _proof_index(client, cid)[0]
    assert row["lat"] is None and row["lon"] is None  # it files under Unlocated
    assert row["title"] == "Photos only"


def test_index_carries_the_geography_of_the_source(client, sat_tiles, monkeypatch):
    from azimut.engine import geo

    monkeypatch.setattr(
        geo,
        "reverse_geocode",
        lambda lat, lon, timeout=8, language=None: {
            "display_name": "x",
            "attribution": "x",
            "address": {"country_code": "ua", "country": "Ukraine", "state": "Donetsk Oblast"},
        },
    )
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    cap = _sat(client, cid, 48.0159, 37.8029)
    client.post(f"/api/cases/{cid}/proofs", json={"title": "Donetsk", "spec": _panels(cap["path"])})

    row = _proof_index(client, cid)[0]
    assert row["geo"]["country"] == "Ukraine"
    assert row["continent"] == "Europe"
    assert row["country_en"] == "Ukraine"


def test_index_lists_the_posts_written_from_a_proof(client, sat_tiles):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    cap = _sat(client, cid, 50.4501, 30.5234)
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Cited", "spec": _panels(cap["path"]), "png_base64": _png_b64()},
    ).json()
    client.post(
        f"/api/cases/{cid}/drafts",
        json={
            "title": "First thread",
            "state": {"proofPng": saved["png"], "target": "bluesky"},
        },
    )
    client.post(
        f"/api/cases/{cid}/drafts",
        json={
            "title": "Follow-up",
            "state": {"proofPng": saved["png"], "target": "mastodon"},
        },
    )

    row = _proof_index(client, cid)[0]
    assert row["posts"] == 2
    assert {post["title"] for post in row["linked_posts"]} == {
        "First thread",
        "Follow-up",
    }
    assert {post["target"] for post in row["linked_posts"]} == {
        "bluesky",
        "mastodon",
    }
    assert {post["name"] for post in row["linked_posts"]} == {
        "first-thread",
        "follow-up",
    }


# -- a proof's own point ---------------------------------------------------------------
# A proof does carry coordinates: `coordsText` is what the analyst typed in the
# composer, `coords` is what the panels gave it, frozen at save. Both outlive the
# capture they came from, so they are read before the derivation is walked.


def test_index_prefers_the_coordinates_typed_into_the_composer(client, sat_tiles):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    cap = _sat(client, cid, 50.4501, 30.5234)
    client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "title": "Corrected",
            "spec": {**_panels(cap["path"]), "coordsText": "48.8584, 2.2945"},
        },
    )

    rows = _proof_index(client, cid)
    # the analyst overrode the imagery: one point, theirs
    assert [(r["lat"], r["lon"]) for r in rows] == [(48.8584, 2.2945)]


def test_index_reads_a_hand_typed_point_in_any_supported_format(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Typed", "spec": {"panels": [], "coordsText": "48°51'30.2\"N 2°17'40.2\"E"}},
    )

    row = _proof_index(client, cid)[0]
    assert row["lat"] == pytest.approx(48.8584, abs=1e-3)
    assert row["lon"] == pytest.approx(2.2945, abs=1e-3)


def test_index_keeps_the_point_after_the_capture_is_deleted(client, sat_tiles):
    """The whole reason a proof stores its own point: outputs outlive sources."""
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    cap = _sat(client, cid, 50.4501, 30.5234)
    client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "title": "Orphaned",
            "spec": {**_panels(cap["path"]), "coords": {"lat": 50.4501, "lon": 30.5234}},
        },
    )
    entity = next(e for e in graph_read.entities(cid) if e["type"] == "capture")
    client.delete(f"/api/cases/{cid}/entities/{entity['id']}")

    row = _proof_index(client, cid)[0]
    assert (row["lat"], row["lon"]) == (50.4501, 30.5234)  # scarred, not unplaced


def test_index_ignores_a_hand_typed_point_it_cannot_read(client, sat_tiles):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    cap = _sat(client, cid, 50.4501, 30.5234)
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Prose", "spec": {**_panels(cap["path"]), "coordsText": "near the bridge"}},
    )

    # unreadable text is not a point, so the derivation still answers
    assert [(r["lat"], r["lon"]) for r in _proof_index(client, cid)] == [(50.4501, 30.5234)]


def test_index_carries_the_my_work_folder_of_the_proof(client, sat_tiles):
    """A proof is filed like any other artifact, so the panel can group it by
    folder as well as by place."""
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    cap = _sat(client, cid, 50.4501, 30.5234)
    client.post(f"/api/cases/{cid}/proofs", json={"title": "Filed", "spec": _panels(cap["path"])})
    entity = next(e for e in graph_read.entities(cid) if e["type"] == "proof")
    client.patch(f"/api/cases/{cid}/entities/{entity['id']}", json={"attrs": {"folder": "recon/bridges"}})

    assert _proof_index(client, cid)[0]["folder"] == "recon/bridges"
