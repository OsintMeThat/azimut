"""Placement: where the derivation chain puts an entity (ONTOLOGY §3).

The chain is read backwards as geography, and the artifact holding the point is
rarely the one being read. A proof stands at the point of the capture it composes,
one hop back — and a video reaches that same capture three hops away, through the
proof that sat a frame of it beside the satellite view. That V is the geolocation
gesture: putting a frame next to a capture *is* the assertion they are one place.

What must hold: the point is found however far round the V it sits, the nearest
artifact is the one credited, what the analyst typed beats what the panels froze,
and nothing about this walks a relation or invents a point.
"""

import base64
import io

from PIL import Image
import pytest

from azimut.engine import media as media_engine
from azimut.engine import satellite as satellite_engine
from azimut.workspace import Case

import graph_read


def _png_bytes(color=(200, 30, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _png_b64() -> str:
    return base64.b64encode(_png_bytes((10, 10, 10))).decode()


@pytest.fixture()
def sat_tiles(monkeypatch):
    """Captures without the network: every tile is a solid green square."""
    from azimut.engine import tiles

    monkeypatch.setattr(
        tiles, "_default_fetch", lambda client, url: Image.new("RGB", (256, 256), (10, 120, 10))
    )


def _new_case(client, name="Placement"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, cid, name, color=(200, 30, 30)):
    """A file collected into the case — the stand-in for a downloaded video."""
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(_png_bytes(color)), "image/png")},
    ).json()["item"]["path"]


def _frame_of(cid, source_path, name="frame.png", color=(90, 90, 90)):
    """A frame filed the way Inspect files one: the sidecar names what it was cut
    from, and the link layer turns that path into the `derived-from` edge."""
    return media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (32, 24), color),
        name,
        {"type": "inspect", "from": source_path},
        by="inspect",
        dedupe=False,
    )["item"]["path"]


def _sat(client, cid, lat, lon):
    """A saved capture — the only collected type that records a point."""
    return client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": lat, "lon": lon, "zoom": 16, "width": 256, "height": 256},
    ).json()["path"]


def _save_proof(client, cid, title, srcs, **spec_extra):
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)], **spec_extra}
    return client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": title, "spec": spec, "png_base64": _png_b64()},
    ).json()


def _id(cid, **attrs):
    found = graph_read.entity(cid, **attrs)
    assert found is not None, f"no entity with {attrs}"
    return found["id"]


def _placement(client, cid, entity_id):
    res = client.get(f"/api/cases/{cid}/entities/{entity_id}/placement")
    assert res.status_code == 200, res.text
    return res.json()


def _points(client, cid, entity_id):
    return [(p["lat"], p["lon"]) for p in _placement(client, cid, entity_id)["points"]]


# ── the one hop the map already reads ───────────────────────────────────────


def test_a_proof_is_placed_at_the_capture_it_composes(client, sat_tiles):
    cid = _new_case(client)
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Kyiv bridge", [cap])

    found = _placement(client, cid, _id(cid, spec="proofs/.meta/Kyiv bridge.json"))
    assert [(p["lat"], p["lon"]) for p in found["points"]] == [(50.4501, 30.5234)]
    # the row names what carries the point, because nothing else in the panel does
    assert found["points"][0]["via"]["type"] == "capture"
    assert found["points"][0]["depth"] == 1
    assert found["truncated"] is False


def test_a_proof_states_its_own_point_over_the_one_its_panels_give(client, sat_tiles):
    """What the analyst typed wins, it is credited to nobody — nothing placed it —
    and the overridden panel is not listed underneath. A proof that says where it is
    says it once, which is what the map already does with the same precedence."""
    cid = _new_case(client)
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Corrected", [cap], coordsText="48.8584, 2.2945")

    found = _placement(client, cid, _id(cid, spec="proofs/.meta/Corrected.json"))
    assert [(p["lat"], p["lon"]) for p in found["points"]] == [(48.8584, 2.2945)]
    assert found["points"][0]["via"] is None
    assert found["points"][0]["depth"] == 0


def test_a_capture_reports_nothing(client, sat_tiles):
    """Its point is its own, written at the save and already read under Info. Listing
    it here would show one datum twice in one panel, for the one type that never
    derived it from anything."""
    cid = _new_case(client)
    cap = _sat(client, cid, 50.4501, 30.5234)

    assert _placement(client, cid, _id(cid, path=cap)) == {"points": [], "truncated": False}


# ── the V: what the panel could not show before ─────────────────────────────


def test_a_video_is_placed_through_the_proof_that_used_its_frame(client, sat_tiles):
    """video ◀ frame ◀ proof ▶ capture. Nothing joins the video to the capture, and
    that is the whole point: they share a descendant, and sharing it is the claim."""
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    cap = _sat(client, cid, 50.4501, 30.5234)
    # the composer freezes the panels' point into the spec, so the proof itself
    # carries one — which is what makes it, not the capture, the nearest placement
    _save_proof(client, cid, "Roofline", [frame, cap], coords={"lat": 50.4501, "lon": 30.5234})

    found = _placement(client, cid, _id(cid, path=video))
    assert [(p["lat"], p["lon"]) for p in found["points"]] == [(50.4501, 30.5234)]
    assert found["points"][0]["via"]["type"] == "proof"
    assert found["points"][0]["via"]["label"] == "Roofline"
    assert found["points"][0]["depth"] == 2


def test_a_video_reaches_the_capture_when_the_proof_states_no_point(client, sat_tiles):
    """A proof saved with no frozen coordinates places nothing itself, so the walk
    carries on to the capture and credits that instead. The row is still true — it
    just names a different artifact."""
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Roofline", [frame, cap])

    found = _placement(client, cid, _id(cid, path=video))
    assert [(p["lat"], p["lon"]) for p in found["points"]] == [(50.4501, 30.5234)]
    assert found["points"][0]["via"]["type"] == "capture"
    assert found["points"][0]["depth"] == 3


def test_an_inspect_session_is_placed_through_the_media_it_points_at(client, sat_tiles):
    """`depends-on` is walked too: a session is a pointer at a file, and the file's
    own placement is the session's."""
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Roofline", [frame, cap], coords={"lat": 50.4501, "lon": 30.5234})
    client.post(
        f"/api/cases/{cid}/inspect/sessions",
        json={"title": "Pass", "spec": {"source": {"path": video, "kind": "image"}}},
    )

    assert _points(client, cid, _id(cid, spec=".inspect/Pass.json")) == [(50.4501, 30.5234)]


# ── what the list refuses to do ─────────────────────────────────────────────


def test_two_captures_of_one_roof_stay_two_points(client, sat_tiles):
    """Metres apart is not the same point. Merging them would assert they are one
    place, which is the analyst's call and not a rounding this may make."""
    cid = _new_case(client)
    a = _sat(client, cid, 50.45010, 30.52340)
    b = _sat(client, cid, 50.45012, 30.52341)
    _save_proof(client, cid, "Two views", [a, b])

    assert len(_points(client, cid, _id(cid, spec="proofs/.meta/Two views.json"))) == 2


def test_one_point_reached_twice_is_listed_once(client, sat_tiles):
    """Two panels cropped from one capture are one point, and it comes back once."""
    cid = _new_case(client)
    cap = _sat(client, cid, 50.4501, 30.5234)
    frame = _frame_of(cid, cap, "crop.png")
    _save_proof(client, cid, "Same roof", [cap, frame])

    assert _points(client, cid, _id(cid, spec="proofs/.meta/Same roof.json")) == [
        (50.4501, 30.5234)
    ]


def test_the_walk_stops_at_the_artifact_holding_the_point(client, sat_tiles):
    """A second proof reusing the same capture is somebody else's argument, not this
    video's, so the walk does not carry on through the capture to collect it."""
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    shared = _sat(client, cid, 50.4501, 30.5234)
    elsewhere = _sat(client, cid, 48.8584, 2.2945)
    _save_proof(client, cid, "Mine", [frame, shared])
    _save_proof(client, cid, "Somebody else's", [shared, elsewhere])

    # the shared capture is reached and reported; what hangs off its far side is not
    assert _points(client, cid, _id(cid, path=video)) == [(50.4501, 30.5234)]


def test_a_relation_never_places_anything(client, sat_tiles):
    """Only chain edges are geography. A stated relation is a claim about the world,
    and walking one here would let an opinion place a file."""
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    cap = _sat(client, cid, 50.4501, 30.5234)
    case = Case.open(cid)
    place = satellite_engine.save_place(case, 50.4501, 30.5234, title="Roof")
    case.add_link(_id(cid, path=video), place["id"], "depicts", by="user")

    assert _points(client, cid, _id(cid, path=video)) == []
    assert _points(client, cid, _id(cid, path=cap)) == []


def test_an_unlocated_chain_reports_no_point(client):
    cid = _new_case(client)
    photo = _upload(client, cid, "a.png")
    _save_proof(client, cid, "Photos only", [photo])

    assert _points(client, cid, _id(cid, path=photo)) == []


def test_a_missing_entity_is_a_404(client):
    cid = _new_case(client)
    assert client.get(f"/api/cases/{cid}/entities/e_nope/placement").status_code == 404


# ── bounds ──────────────────────────────────────────────────────────────────


def test_the_list_is_capped_and_says_so(client, sat_tiles, monkeypatch):
    """Past the cap the panel is a wall rather than a reading, so it stops and
    reports that it stopped instead of trailing off in silence."""
    monkeypatch.setattr(satellite_engine, "PLACEMENT_LIMIT", 3)
    cid = _new_case(client)
    caps = [_sat(client, cid, 50.0 + i / 100, 30.0) for i in range(5)]
    _save_proof(client, cid, "Many", caps)

    found = _placement(client, cid, _id(cid, spec="proofs/.meta/Many.json"))
    assert len(found["points"]) == 3
    assert found["truncated"] is True


def test_the_walk_stops_before_the_far_side_of_a_long_chain(client, sat_tiles, monkeypatch):
    """A bound that only capped the output would still read the whole graph to fill
    it. This one stops the walk itself."""
    monkeypatch.setattr(satellite_engine, "PLACEMENT_DEPTH", 1)
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Roofline", [frame, cap])

    # the frame is one hop from the video; the proof and its capture are further
    assert _points(client, cid, _id(cid, path=video)) == []
    assert _points(client, cid, _id(cid, path=frame)) == []


# ── outputs outlive their sources ───────────────────────────────────────────


def test_a_deleted_capture_leaves_the_proof_its_frozen_point(client, sat_tiles):
    """`derived-from` never cascades, and the spec keeps the coordinates the panels
    gave it — so the proof stays placed, and so does the video behind it."""
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Roofline", [frame, cap], coords={"lat": 50.4501, "lon": 30.5234})

    client.delete(f"/api/cases/{cid}/entities/{_id(cid, path=cap)}")

    proof_id = _id(cid, spec="proofs/.meta/Roofline.json")
    assert _points(client, cid, proof_id) == [(50.4501, 30.5234)]
    assert _points(client, cid, _id(cid, path=video)) == [(50.4501, 30.5234)]
