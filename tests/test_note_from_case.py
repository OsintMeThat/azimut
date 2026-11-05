"""The Notebook's *From the case*: the geolocations of a period, read off the case.

What must hold: a geolocation is every Geo Proof, and every picture or video the case
collected that stands at a confirmed point; a suggested point does not count, nor a
file with no point, nor what the case made itself; a file a proof was made from is
shown by that proof; a period is days on the case's clock, read by what the item shows
or by when it was geolocated; a note holds 200 at most and says how many there were.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from azimut import sqlite_backend
from azimut.engine import links as link_engine
from azimut.engine import media as media_engine
from azimut.engine import notefromcase, satellite, workqueue
from azimut.workspace import Case


def _case(client) -> tuple[str, Case]:
    cid = client.post("/api/cases", json={"name": "Geolocations"}).json()["id"]
    return cid, Case.open(cid)


def _file(case: Case, title: str, source: dict[str, Any], **item: Any) -> str:
    """A picture brought into the case, its sidecar saying what is given."""
    filed = media_engine.import_image(
        case, Image.new("RGB", (64, 48), (90, 60, 30)), f"{title}.png",
        {"type": "upload", **source}, title=title, dedupe=False,
    )
    if item:
        # after the import's own enrichment, which writes the item again
        workqueue.wait_until_idle(timeout=60)
        case.upsert_media_item({**filed["item"], **item}, entity_id=filed["entity"]["id"])
    return filed["entity"]["id"]


def _place(case: Case, label: str, lat: float, lon: float, status: str = "confirmed") -> str:
    return case.add_entity("place", label, {"lat": lat, "lon": lon}, by="user", status=status)["id"]


def _proof(case: Case, title: str, made_from: list[str], place: str | None, **attrs: Any) -> str:
    """A proof as the composer files one: made from its panels, depicting its point,
    and posing that point on the files it was made from."""
    proof = case.add_entity("proof", title, {"kind": "image", **attrs}, by="proof-composer")["id"]
    for one in made_from:
        case.add_link(proof, one, link_engine.DERIVED_FROM, by="proof-composer")
    if place:
        case.add_link(proof, place, link_engine.DEPICTS, by="proof-composer")
        for one in made_from:
            case.add_link(one, place, link_engine.DEPICTS, by="proof-composer")
    return proof


def _read(client, cid: str, **query: str) -> dict[str, Any]:
    res = client.get(f"/api/cases/{cid}/notes/from-case", params=query)
    assert res.status_code == 200, res.text
    return res.json()


def _ids(found: dict[str, Any]) -> list[str]:
    return [item["id"] for item in found["items"]]


def test_a_file_counts_once_its_place_is_confirmed(client):
    cid, case = _case(client)
    photo = _file(case, "Quay", {"upload_date": "20260312"})
    gps = _place(case, "48.01590, 37.80290", 48.0159, 37.8029, status="suggested")
    edge = case.add_link(photo, gps, link_engine.LOCATED_AT, by="enrich", status="suggested")

    # a point only a tool proposed is not a geolocation yet
    assert _read(client, cid)["total"] == 0

    link_engine.confirm_relation(case, edge["id"])
    [item] = _read(client, cid)["items"]
    assert item["id"] == photo and item["type"] == "media"
    assert item["sources"] == [{"id": photo, "label": "Quay", "media_kind": "image"}]
    [point] = item["points"]
    assert (point["lat"], point["lon"]) == (48.0159, 37.8029)
    assert point["place"]["id"] == gps
    assert item["shown"]["kind"] == "published" and item["day"] == "2026-03-12"


def test_a_file_with_no_place_and_what_the_case_made_do_not_count(client):
    cid, case = _case(client)
    _file(case, "Loose", {"upload_date": "20260312"})
    port = _place(case, "Port", 14.798, 42.954)
    capture = _file(case, "From above", {"type": "satellite", "imagery_date": "2026-03-10"})
    case.add_link(capture, port, link_engine.DEPICTS, by="user")
    assert _read(client, cid)["total"] == 0


def test_a_proof_is_one_geolocation_with_the_file_it_was_made_from(client):
    cid, case = _case(client)
    video = _file(case, "Strike video", {"type": "download", "upload_date": "20260311"})
    frame = media_engine.import_image(
        case, Image.new("RGB", (32, 24), (10, 10, 10)), "frame.png",
        {"type": "inspect", "from": "media/Strike video.png"}, by="inspect", dedupe=False,
    )["entity"]["id"]
    case.add_link(frame, video, link_engine.DERIVED_FROM, by="inspect")
    berth = _place(case, "Berth 12", 14.798, 42.954)
    proof = _proof(case, "Strike geolocated", [frame, video], berth,
                   when="2026-03-11T14:05:00+02:00", when_zone="Europe/Kyiv")

    [item] = _read(client, cid)["items"]
    # the video stands at the point too, and is the proof's source, not a second block
    assert item["id"] == proof and item["type"] == "proof"
    assert [source["id"] for source in item["sources"]] == [video]
    assert item["points"][0]["place"] == {"id": berth, "label": "Berth 12", "coords": False}
    assert item["shown"] == {"kind": "taken", "raw": "2026-03-11T14:05:00+02:00",
                             "tz": "Europe/Kyiv", "day": "2026-03-11", "last": "2026-03-11"}


def test_a_proof_with_no_point_or_no_day_still_counts(client):
    cid, case = _case(client)
    photo = _file(case, "Rooftop", {"upload_date": "20260309"}, taken_at="2026-03-08T07:30:00")
    proof = _proof(case, "Unplaced", [photo], None)

    [item] = _read(client, cid)["items"]
    assert item["id"] == proof and item["points"] == []
    # with no day of its own, the proof is dated by its file: the camera before the post
    assert item["shown"]["kind"] == "captured" and item["day"] == "2026-03-08"


def test_a_proof_with_no_day_reads_a_camera_day_before_a_post_day(client):
    cid, case = _case(client)
    first = _file(case, "A posted clip", {"upload_date": "20260310"})
    second = _file(case, "B camera photo", {}, taken_at="2026-03-09T18:00:00")
    proof = _proof(case, "Two files", [first, second], None)

    [item] = _read(client, cid)["items"]
    assert item["id"] == proof
    assert [source["id"] for source in item["sources"]] == [first, second]
    assert item["shown"]["kind"] == "captured" and item["day"] == "2026-03-09"


def test_a_suggested_proof_does_not_count_nor_hide_its_file(client):
    cid, case = _case(client)
    photo = _file(case, "Quay", {"upload_date": "20260312"})
    proposed = case.add_entity("proof", "Proposed", {"kind": "image"}, by="import", status="suggested")
    case.add_link(proposed["id"], photo, link_engine.DERIVED_FROM, by="import")
    assert _read(client, cid)["total"] == 0

    case.add_link(photo, _place(case, "Quay", 14.798, 42.954), link_engine.DEPICTS, by="user")
    assert _ids(_read(client, cid)) == [photo]


def test_the_period_is_days_on_the_case_clock(client):
    cid, case = _case(client)
    place = _place(case, "Square", 50.45, 30.52)
    late = _proof(case, "Late at night", [], place, when="2026-03-12T23:30:00Z")
    posted = _file(case, "Posted", {"upload_date": "20260312"})
    case.add_link(posted, place, link_engine.DEPICTS, by="user")

    # half past eleven in UTC is half past one on the 13th in Kyiv
    kyiv = _read(client, cid, **{"from": "2026-03-13", "to": "2026-03-13", "zone": "Europe/Kyiv"})
    assert _ids(kyiv) == [late]
    utc = _read(client, cid, **{"from": "2026-03-12", "to": "2026-03-12", "zone": "UTC"})
    assert sorted(_ids(utc)) == sorted([late, posted])
    # a day stated without a time is that day on any clock
    kyiv12 = _read(client, cid, **{"from": "2026-03-12", "to": "2026-03-12", "zone": "Europe/Kyiv"})
    assert _ids(kyiv12) == [posted]
    # both ends are included, either may be left open
    assert _read(client, cid, **{"to": "2026-03-12", "zone": "Europe/Kyiv"})["total"] == 1
    assert _read(client, cid, **{"from": "2026-03-13", "zone": "Europe/Kyiv"})["total"] == 1
    whole = _read(client, cid, zone="Europe/Kyiv")
    assert (whole["first"], whole["last"]) == ("2026-03-12", "2026-03-13")
    assert [item["id"] for item in whole["items"]] == [posted, late]


def test_a_month_or_a_range_counts_in_a_period_it_touches(client):
    cid, case = _case(client)
    place = _place(case, "Square", 50.45, 30.52)
    march = _proof(case, "Some day in March", [], place, when="2026-03")
    span = _proof(case, "Between two days", [], place, when="2026-03-20/2026-03-22")
    found = _read(client, cid, **{"from": "2026-03-21", "to": "2026-03-21"})
    assert sorted(_ids(found)) == sorted([march, span])
    assert _ids(_read(client, cid, **{"from": "2026-04-01", "to": "2026-04-30"})) == []


def test_dated_by_what_it_shows_or_when_it_was_geolocated(client, monkeypatch):
    cid, case = _case(client)
    place = _place(case, "Quay", 14.798, 42.954)
    old = _file(case, "Old footage", {"upload_date": "20240115"})
    with monkeypatch.context() as patch:
        patch.setattr(sqlite_backend, "_now", lambda: "2026-03-14T22:30:00Z")
        case.add_link(old, place, link_engine.LOCATED_AT, by="user")

    shown = _read(client, cid, **{"from": "2024-01-15", "to": "2024-01-15"})
    assert _ids(shown) == [old]
    assert _read(client, cid, **{"from": "2026-03-14", "to": "2026-03-14"})["total"] == 0

    by = {"by": "geolocated", "zone": "Europe/Kyiv"}
    # the place was stated at half past ten in UTC, past midnight in Kyiv
    assert _ids(_read(client, cid, **by, **{"from": "2026-03-15", "to": "2026-03-15"})) == [old]
    [item] = _read(client, cid, **by)["items"]
    assert item["geolocated"]["day"] == "2026-03-15" and item["day"] == "2026-03-15"
    assert item["shown"]["day"] == "2024-01-15"


def test_what_a_reading_cannot_date_is_counted_apart(client):
    cid, case = _case(client)
    place = _place(case, "Quay", 14.798, 42.954)
    undated = _file(case, "No date at all", {})
    case.add_link(undated, place, link_engine.DEPICTS, by="user")
    _proof(case, "Dated", [], place, when="2026-03-01")

    found = _read(client, cid)
    assert found["total"] == 1 and found["undated"] == 1
    # the day it was geolocated is always known
    assert _read(client, cid, by="geolocated")["undated"] == 0


def test_a_note_holds_two_hundred_and_says_how_many_there_were(client):
    cid, case = _case(client)
    place = _place(case, "Quay", 14.798, 42.954)
    for day in (1, 2, 3):
        _proof(case, f"Day {day}", [], place, when=f"2026-03-0{day}")
    cut = notefromcase.period(case, limit=2)
    assert [item["label"] for item in cut["items"]] == ["Day 1", "Day 2"]
    assert cut["total"] == 3 and cut["limit"] == 2
    assert notefromcase.MAX_ITEMS == 200
    assert notefromcase.period(case, limit=5000)["limit"] == 200


@pytest.mark.parametrize("query", [
    {"from": "12/03/2026"},
    {"from": "2026-03-14", "to": "2026-03-01"},
    {"by": "filed"},
    {"zone": "Mars/Olympus"},
])
def test_the_route_refuses_what_it_cannot_read(client, query):
    cid, _ = _case(client)
    assert client.get(f"/api/cases/{cid}/notes/from-case", params=query).status_code == 422


PLACE_EDGES = json.loads(
    (Path(__file__).parent / "fixtures" / "place_edges.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("link,place,confirmed,why", PLACE_EDGES)
def test_an_edge_to_a_place_is_confirmed_as_the_note_bar_reads_it(link, place, confirmed, why):
    """The rule is one: `placeOf` in the browser reads the same fixture."""
    edge = {"provenance": {"status": link}} if link else {}
    point = {"provenance": {"status": place}} if place else {}
    assert (satellite.road_status(edge, point) == "confirmed") is confirmed, why
