"""Proofs: save spec+PNG, list, reload, entity upsert, delete."""

import base64

import graph_read
import io

import pytest
from PIL import Image
from azimut import layout
from azimut.workspace import Case


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
    assert saved["name"] == "Kharkiv strike proof"
    assert saved["png"] == "proofs/Kharkiv strike proof.png"

    listed = client.get(f"/api/cases/{cid}/proofs").json()
    assert len(listed) == 1
    assert listed[0]["panels"] == 2 and listed[0]["shapes"] == 1

    spec = client.get(f"/api/cases/{cid}/proofs/{saved['name']}").json()
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
    assert entity["attrs"]["path"] == layout.proof_export_rel(saved['name'])


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
    assert renamed["name"] == "Rooftop angle"
    assert renamed["png"] == "proofs/Rooftop angle.png"
    assert client.get(f"/api/cases/{cid}/proofs/{saved['name']}").status_code == 404
    assert client.get(f"/files/{cid}/proofs/{saved['name']}.png").status_code == 404
    assert client.get(f"/files/{cid}/proofs/{renamed['name']}.png").status_code == 200

    proofs = [e for e in graph_read.entities(cid) if e["type"] == "proof"]
    assert len(proofs) == 1
    assert proofs[0]["id"] == before["id"]
    assert proofs[0]["attrs"]["spec"] == "proofs/.meta/Rooftop angle.json"
    assert proofs[0]["attrs"]["path"] == "proofs/Rooftop angle.png"
    assert proofs[0]["attrs"]["folder"] == "Reports"


def test_rename_without_fresh_pixels_carries_the_export_along(client):
    # A save that ships no PNG (spec-only) must not strand the export under the
    # old name — the proof would lose its picture on a pure rename.
    cid = client.post("/api/cases", json={"name": "CarryPng"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Proof 1", "spec": SPEC, "png_base64": _png_b64()},
    ).json()
    renamed = client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": saved["name"], "title": "Carried", "spec": SPEC},
    ).json()

    assert renamed["png"] == "proofs/Carried.png"
    assert client.get(f"/files/{cid}/proofs/Carried.png").status_code == 200
    assert client.get(f"/files/{cid}/proofs/{saved['name']}.png").status_code == 404
    entity = next(e for e in graph_read.entities(cid) if e["type"] == "proof")
    assert entity["attrs"]["path"] == "proofs/Carried.png"


def test_rename_onto_a_taken_name_is_refused(client):
    cid = client.post("/api/cases", json={"name": "ClashProof"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Proof 1", "spec": SPEC, "png_base64": _png_b64()},
    )
    second = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Proof 2", "spec": SPEC, "png_base64": _png_b64()},
    ).json()

    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "rename_from": second["name"],
            "title": "Proof 1",
            "spec": SPEC,
            "png_base64": _png_b64(),
        },
    )
    assert res.status_code == 409
    listed = sorted(p["name"] for p in client.get(f"/api/cases/{cid}/proofs").json())
    assert listed == ["Proof 1", "Proof 2"]
    assert client.get(f"/files/{cid}/proofs/{second['name']}.png").status_code == 200


def test_rename_keeps_the_creation_date(client):
    cid = client.post("/api/cases", json={"name": "BornProof"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs", json={"title": "Proof 1", "spec": SPEC}
    ).json()
    born = client.get(f"/api/cases/{cid}/proofs/{saved['name']}").json()["created_at"]

    client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": saved["name"], "title": "Renamed", "spec": SPEC},
    )
    assert client.get(f"/api/cases/{cid}/proofs/Renamed").json()["created_at"] == born


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

    # and the entity carries it too, so a surface drawing a few hundred entities at
    # once — the graph — reads a preview off the row it already has instead of
    # opening one spec file per proof
    entity = case.find_entity(attr="spec", value=saved["spec_path"])
    assert entity["attrs"]["thumb"] == saved["thumb"]
    node = next(
        row
        for row in client.get(f"/api/cases/{cid}/graph").json()["nodes"]
        if row["id"] == entity["id"]
    )
    assert node["thumb"] == saved["thumb"]


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


def test_the_graph_adopts_a_thumbnail_a_proof_only_recorded_in_its_spec(client):
    """The migration has to cover the ordinary proof, not only the broken one.

    A proof saved before the entity recorded a thumbnail still has a perfectly good
    one in its spec, so nothing about it needs repairing — and it would draw as a
    glyph forever if the only thing that copied the path across were the repair of a
    missing thumbnail. The graph adopts it on the first view, then reads the row."""
    from azimut.api.cases import get_case

    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Older proof", "spec": SPEC, "png_base64": _big_png_b64()},
    ).json()
    case = get_case(cid)
    entity = case.find_entity(attr="spec", value=saved["spec_path"])
    # what an older save left behind: the spec knows its thumbnail, the entity does not
    case.update_entity(entity["id"], {"attrs": {"thumb": ""}})

    node = next(
        row
        for row in client.get(f"/api/cases/{cid}/graph").json()["nodes"]
        if row["id"] == entity["id"]
    )
    assert node["thumb"] == saved["thumb"]
    # recorded on the entity, so no later view opens the spec file again
    assert case.get_entity(entity["id"])["attrs"]["thumb"] == saved["thumb"]

    hood = client.get(
        f"/api/cases/{cid}/graph/neighborhood", params={"root": entity["id"]}
    ).json()
    assert hood["nodes"][0]["thumb"] == saved["thumb"]


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
    assert row["name"] == "Kyiv bridge"
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
        "First thread",
        "Follow-up",
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


# -- the place a proof files (engine/satellite.place_for_proof) -----------------
#
# A geolocation is concluded in the composer, so the point becomes a node here
# rather than on every capture taken while looking for it.


def _depicts(cid):
    return graph_read.links(cid, "depicts")


def _places(cid):
    return [e for e in graph_read.entities(cid) if e["type"] == "place"]


def _save(client, cid, title, spec):
    return client.post(f"/api/cases/{cid}/proofs", json={"title": title, "spec": spec}).json()


def _with_coords(text=None, point=None, *srcs, pov=False):
    spec = _panels(*srcs)
    if text is not None:
        spec["coordsText"] = text
    if point is not None:
        spec["coords"] = point
    if pov:
        spec["pov"] = True
    return spec


def _located_at(cid):
    return graph_read.links(cid, "located-at")


def test_saving_a_proof_files_the_point_it_carries(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    saved = _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234"))

    places = _places(cid)
    assert len(places) == 1
    assert (places[0]["attrs"]["lat"], places[0]["attrs"]["lon"]) == (50.4501, 30.5234)
    # the analyst's own answer, so there is nothing left to review
    assert places[0]["provenance"]["status"] == "confirmed"
    assert saved["place"] == {"filed": True, "id": places[0]["id"], "label": places[0]["label"]}

    # and the proof says it shows that place
    edges = _depicts(cid)
    assert len(edges) == 1
    assert edges[0]["to"] == places[0]["id"]
    assert edges[0]["provenance"]["status"] == "confirmed"


def test_a_proof_with_no_point_files_nothing(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    assert _save(client, cid, "No point", _panels("media/frame.png"))["place"] is None
    assert _places(cid) == []


def test_the_typed_point_wins_over_the_one_the_panels_gave(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    _save(client, cid, "Corrected", _with_coords("50.4501, 30.5234", {"lat": 1.0, "lon": 2.0}))
    # the composer's field is the analyst's correction; the frozen panel point loses
    assert [(p["attrs"]["lat"], p["attrs"]["lon"]) for p in _places(cid)] == [(50.4501, 30.5234)]


def test_a_point_the_case_already_holds_is_neither_filed_twice_nor_asked_about(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/satellite/place", json={"lat": 50.4501, "lon": 30.5234}
    )
    saved = _save(client, cid, "Same point", _with_coords("50.4501, 30.5234"))

    assert saved["place"] is None  # nothing to file, so nothing to ask
    assert len(_places(cid)) == 1
    # the pin was already there, so it is reused rather than minted again — but the
    # proof still says it concludes there, or the point it states would be unreadable
    assert [lk["to"] for lk in _depicts(cid)] == [_places(cid)[0]["id"]]


def test_resaving_a_proof_stays_silent(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    spec = _with_coords("50.4501, 30.5234")
    assert _save(client, cid, "Roof match", spec)["place"]["filed"] is True
    # the point is in the case now: saving again must not ask, nor pin it twice
    assert _save(client, cid, "Roof match", spec)["place"] is None
    assert len(_places(cid)) == 1


def test_the_composer_is_asked_when_the_setting_is_off(client):
    client.put("/api/settings/prefs", json={"proof_place_auto": False})
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    saved = _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234"))

    assert saved["place"] == {
        "filed": False, "lat": 50.4501, "lon": 30.5234, "pov": False
    }
    assert _places(cid) == []  # nothing is written until the analyst says yes

    filed = client.post(
        f"/api/cases/{cid}/proofs/Roof match/place",
        json={"lat": 50.4501, "lon": 30.5234},
    ).json()
    assert filed["type"] == "place"
    assert _depicts(cid)[0]["from"] == graph_read.entity(cid, spec=layout.proof_spec_rel("Roof match"))["id"]


def test_answering_twice_files_one_place(client):
    """Two tabs answering the same question must not pin the point twice."""
    client.put("/api/settings/prefs", json={"proof_place_auto": False})
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234"))

    body = {"lat": 50.4501, "lon": 30.5234}
    first = client.post(f"/api/cases/{cid}/proofs/Roof match/place", json=body).json()
    second = client.post(f"/api/cases/{cid}/proofs/Roof match/place", json=body).json()
    assert first["id"] == second["id"]
    assert len(_places(cid)) == 1


def test_the_material_the_proof_composes_states_the_same_point(client, sat_tiles):
    """The video the proof was built from says it too, and says it confirmed.

    Putting a frame beside a capture and writing the coordinates *is* the
    geolocation, so there is nothing left to review: asking the analyst to accept
    their own act is the click that teaches people to click through the ones that
    matter.
    """
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    case = Case.open(cid)
    video = case.add_entity(
        "media", "clip.mp4", {"path": "media/clip.mp4", "kind": "video"}, by="user"
    )
    frame = case.add_entity(
        "media", "frame.png", {"path": "media/frame.png", "kind": "image"}, by="user"
    )
    case.add_link(frame["id"], video["id"], "derived-from", by="inspect")
    cap = _sat(client, cid, 50.4501, 30.5234)

    _save(client, cid, "Roof match", _with_coords(
        "50.4501, 30.5234", None, "media/frame.png", cap["path"]
    ))

    place = _places(cid)[0]
    stated = {
        lk["from"]: lk["provenance"]["status"]
        for lk in _depicts(cid)
        if lk["to"] == place["id"]
    }
    # the frame, the capture, and the video two hops up
    assert stated[frame["id"]] == "confirmed"
    assert stated[video["id"]] == "confirmed"
    assert stated[graph_read.entity(cid, path=cap["path"])["id"]] == "confirmed"


def test_a_source_the_verb_does_not_accept_is_skipped(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    case = Case.open(cid)
    audio = case.add_entity(
        "media", "call.mp3", {"path": "media/call.mp3", "kind": "audio"}, by="user"
    )
    case.add_entity("media", "frame.png", {"path": "media/frame.png", "kind": "image"}, by="user")
    _save(client, cid, "Roof match", _with_coords(
        "50.4501, 30.5234", None, "media/frame.png", "media/call.mp3"
    ))

    # `shows` is about pixels: an audio file in the chain is skipped, not refused
    assert audio["id"] not in {lk["from"] for lk in _depicts(cid)}


def test_pov_says_the_footage_was_recorded_there(client, sat_tiles):
    """The one thing a composition cannot deduce, so the composer asks it.

    Recorded-at and shows are independent claims — a rooftop shot is recorded
    somewhere it never shows — and a match between a frame and an imagery says
    only that they meet, not whether the camera or its subject was located.
    """
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    case = Case.open(cid)
    video = case.add_entity(
        "media", "clip.mp4", {"path": "media/clip.mp4", "kind": "video"}, by="user"
    )
    cap = _sat(client, cid, 50.4501, 30.5234)

    _save(client, cid, "From the roof", _with_coords(
        "50.4501, 30.5234", None, "media/clip.mp4", cap["path"], pov=True
    ))

    place = _places(cid)[0]
    assert [lk["from"] for lk in _located_at(cid)] == [video["id"]]
    # the capture is orbital imagery and the proof was composed: neither was
    # recorded anywhere, so both keep saying they show the place
    shows = {lk["from"] for lk in _depicts(cid) if lk["to"] == place["id"]}
    assert graph_read.entity(cid, path=cap["path"])["id"] in shows
    assert video["id"] not in shows


def test_without_pov_the_footage_only_shows_the_place(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    case = Case.open(cid)
    video = case.add_entity(
        "media", "clip.mp4", {"path": "media/clip.mp4", "kind": "video"}, by="user"
    )
    _save(client, cid, "Skyline", _with_coords("50.4501, 30.5234", None, "media/clip.mp4"))

    assert _located_at(cid) == []
    assert [lk["from"] for lk in _depicts(cid) if lk["from"] == video["id"]] == [video["id"]]


def test_pov_reaches_a_recording_the_other_verb_refuses(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    case = Case.open(cid)
    audio = case.add_entity(
        "media", "call.mp3", {"path": "media/call.mp3", "kind": "audio"}, by="user"
    )
    _save(client, cid, "Where it was taped", _with_coords(
        "50.4501, 30.5234", None, "media/call.mp3", pov=True
    ))
    # a recording has a place it was made, though it shows nothing
    assert [lk["from"] for lk in _located_at(cid)] == [audio["id"]]


def test_the_answer_to_the_question_reads_pov_off_the_saved_proof(client):
    client.put("/api/settings/prefs", json={"proof_place_auto": False})
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    case = Case.open(cid)
    video = case.add_entity(
        "media", "clip.mp4", {"path": "media/clip.mp4", "kind": "video"}, by="user"
    )
    saved = _save(client, cid, "From the roof", _with_coords(
        "50.4501, 30.5234", None, "media/clip.mp4", pov=True
    ))
    assert saved["place"]["pov"] is True  # so the question can say what it means

    client.post(
        f"/api/cases/{cid}/proofs/From the roof/place",
        json={"lat": 50.4501, "lon": 30.5234},
    )
    # POV is a property of the proof, not of the answer: the body never carries it
    assert [lk["from"] for lk in _located_at(cid)] == [video["id"]]


# -- re-saving restates the point (engine/satellite.restate_proof_point) --------
#
# A proof states one point, and a save is the restatement of it — the rule its
# panels already follow. Correcting the coordinates moves the edges rather than
# leaving the case holding two answers, and POV changes the verb it wrote before.


def _proof(cid):
    return [e for e in graph_read.entities(cid) if e["type"] == "proof"][0]


def _video(cid, name="clip.mp4"):
    return Case.open(cid).add_entity(
        "media", name, {"path": f"media/{name}", "kind": "video"}, by="user"
    )


def _place_by_lat(cid, lat):
    return [p for p in _places(cid) if p["attrs"]["lat"] == lat][0]


def test_correcting_the_coordinates_moves_the_point_instead_of_adding_one(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    video = _video(cid)
    _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234", None, "media/clip.mp4"))
    _save(client, cid, "Roof match", _with_coords("48.8584, 2.2945", None, "media/clip.mp4"))

    # the proof and the footage state the corrected point, and only it: a
    # withdrawn answer is not a second geolocation
    corrected = _place_by_lat(cid, 48.8584)
    assert {lk["to"] for lk in _depicts(cid)} == {corrected["id"]}
    assert {lk["from"] for lk in _depicts(cid)} == {_proof(cid)["id"], video["id"]}


def test_the_point_it_moved_off_is_offered_for_deletion(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234"))
    abandoned = _places(cid)[0]

    saved = _save(client, cid, "Roof match", _with_coords("48.8584, 2.2945"))

    # a point nobody points at is the analyst's leftover to keep or drop: the save
    # names it and stops there rather than sweeping it
    assert saved["orphans"] == [{"id": abandoned["id"], "label": abandoned["label"]}]
    assert abandoned["id"] in {p["id"] for p in _places(cid)}


def test_a_point_something_else_still_holds_is_neither_stripped_nor_offered(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    case = Case.open(cid)
    photo = case.add_entity(
        "media", "roof.jpg", {"path": "media/roof.jpg", "kind": "image"}, by="user"
    )
    _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234"))
    stays = _places(cid)[0]
    # the analyst's own statement about the same point, made in Details
    case.add_link(photo["id"], stays["id"], "depicts", by="user")

    saved = _save(client, cid, "Roof match", _with_coords("48.8584, 2.2945"))

    assert saved["orphans"] == []  # something still holds it, so there is nothing to ask
    # and a claim the composer did not write is not the composer's to withdraw
    assert [lk["from"] for lk in _depicts(cid) if lk["to"] == stays["id"]] == [photo["id"]]


def test_toggling_pov_restates_the_verb_on_the_footage(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    video = _video(cid)
    _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234", None, "media/clip.mp4"))
    assert [lk["from"] for lk in _depicts(cid)] == [_proof(cid)["id"], video["id"]]

    _save(client, cid, "Roof match", _with_coords(
        "50.4501, 30.5234", None, "media/clip.mp4", pov=True
    ))

    # the point still stands and was never filed twice; what changed is what it means
    assert len(_places(cid)) == 1
    assert [lk["from"] for lk in _located_at(cid)] == [video["id"]]
    # the proof itself was composed, so it shows the place either way
    assert [lk["from"] for lk in _depicts(cid)] == [_proof(cid)["id"]]

    _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234", None, "media/clip.mp4"))
    assert _located_at(cid) == []  # and the answer can be taken back
    assert {lk["from"] for lk in _depicts(cid)} == {_proof(cid)["id"], video["id"]}


def test_turning_pov_off_drops_the_edge_the_other_verb_refuses(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    case = Case.open(cid)
    case.add_entity("media", "call.mp3", {"path": "media/call.mp3", "kind": "audio"}, by="user")
    spec = _with_coords("50.4501, 30.5234", None, "media/call.mp3", pov=True)
    _save(client, cid, "Where it was taped", spec)
    assert len(_located_at(cid)) == 1

    _save(client, cid, "Where it was taped", _with_coords(
        "50.4501, 30.5234", None, "media/call.mp3"
    ))

    # a recording shows nothing, so withdrawing "recorded there" leaves it unplaced
    assert _located_at(cid) == []
    assert [lk["from"] for lk in _depicts(cid)] == [_proof(cid)["id"]]


def test_clearing_the_coordinates_withdraws_the_point(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    _video(cid)
    _save(client, cid, "Roof match", _with_coords("50.4501, 30.5234", None, "media/clip.mp4"))
    filed = _places(cid)[0]

    saved = _save(client, cid, "Roof match", _panels("media/clip.mp4"))

    # an emptied coordinate field is an answer taken back, not the last one frozen
    assert _depicts(cid) == []
    assert saved["orphans"] == [{"id": filed["id"], "label": filed["label"]}]


def test_a_point_another_proof_still_concludes_on_keeps_its_material(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]
    video = _video(cid)
    spec = _with_coords("50.4501, 30.5234", None, "media/clip.mp4")
    _save(client, cid, "First", spec)
    _save(client, cid, "Second", spec)
    shared = _places(cid)[0]

    saved = _save(client, cid, "Second", _with_coords("48.8584, 2.2945", None, "media/clip.mp4"))

    # the edges two proofs wrote on one video are indistinguishable, so moving one
    # off must not undo the conclusion the other still states
    assert saved["orphans"] == []
    holding = {lk["from"] for lk in _depicts(cid) if lk["to"] == shared["id"]}
    assert video["id"] in holding
    assert graph_read.entity(cid, spec=layout.proof_spec_rel("First"))["id"] in holding
