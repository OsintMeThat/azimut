"""GeoConfirmed as an added layer.

Three things this has to get right, and they are what the tests are grouped by:

- **the export reads as GeoConfirmed means it**: factions from the icon colours,
  a date on every event, the undated reference sites apart, the discs centred;
- **the query is what the analyst asked**: a window of days that slides, a range
  that stays put, an area that becomes one polygon, and refusals in a sentence;
- **the network boundary holds**: GeoConfirmed is asked on adding, on Refresh and
  for the conflict list, and never on a listing or a redraw.

Every GeoConfirmed answer here is built in the test. Nothing reaches the network.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import date

import pytest
from PIL import Image

from azimut import layout
from azimut.engine import geoconfirmed, maplayers
from azimut.workspace import Case

# ---------------------------------------------------------------------------
# An export, small enough to read
# ---------------------------------------------------------------------------

RED = "images/api/icons/E00000/False/template/192.png"
BLUE = "images/api/icons/0051CA/False/template/10.png"
GREY = "images/api/icons/777777/False/template/10.png"


def _style(href: str) -> str:
    """One icon's style pair, written the way GeoConfirmed's export writes it."""
    ident = href.removeprefix("images/")
    return (
        f'<Style id="{ident}-normal"><IconStyle><scale>1.1</scale>'
        f"<Icon><href>{href}</href></Icon>"
        '<hotSpot x="16" xunits="pixels" y="16" yunits="insetPixels"/></IconStyle></Style>'
        f'<StyleMap id="{ident}"><Pair><key>normal</key><styleUrl>#{ident}-normal</styleUrl>'
        "</Pair></StyleMap>"
    )


def _placemark(name: str, description: str, href: str, lon: float, lat: float) -> str:
    ident = href.removeprefix("images/")
    named = f"<name><![CDATA[{name}]]></name>" if name else "<name />"
    return (
        f"<Placemark>{named}<description><![CDATA[{description}]]></description>"
        f"<styleUrl>#{ident}</styleUrl>"
        f"<Point><coordinates>{lon},{lat},0</coordinates></Point></Placemark>"
    )


EXPORT_KML = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
    "<name>@GeoConfirmed - War Ukraine</name>"
    + _style(RED)
    + _style(BLUE)
    + _style(GREY)
    + "<Folder><name>A. Legend - Last Map Update 18 2227 SEP 2026</name>"
    + _placemark("", "Airbase\n\nSource(s):\nhttps://example.test/base", RED, 37.1, 47.1)
    + "</Folder><Folder><name>B. Last 7 days</name>"
    + _placemark(
        "13 SEP 2026",
        "Strike on a depot in Shebekino\n\nSource(s):\nhttps://x.com/a/status/1"
        "\n\nGeolocation(s):\nhttps://x.com/b/status/2",
        BLUE,
        36.87,
        50.37,
    )
    + _placemark("12 SEP 2026", "Destroyed vehicle\n\nSource(s):\nhttps://t.me/c/3", RED, 37.5, 48.0)
    + _placemark("11 SEP 2026", "Unclaimed mark", GREY, 36.0, 49.0)
    + "</Folder></Document></kml>"
).encode()


def _disc(colour: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", (56, 56), (*colour, 255)).save(buffer, "PNG")
    return buffer.getvalue()


def export_kmz(kml: bytes = EXPORT_KML) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", kml)
        archive.writestr(RED, _disc((224, 0, 0)))
        archive.writestr(BLUE, _disc((0, 81, 202)))
        archive.writestr(GREY, _disc((119, 119, 119)))
    return buffer.getvalue()


FACTIONS = [
    {"name": "Ukraine", "backgroundColor": "#0051CA"},
    {"name": "Russia", "backgroundColor": "#E00000"},
    {"name": "Wagner", "backgroundColor": "#E00000"},
]

CONFLICT = {"name": "Ukraine", "shortName": "Ukraine", "url": "ukraine", "factions": FACTIONS}

CONFLICTS = [
    {"order": 2, "name": "Iran", "shortName": "Iran", "isPrivate": False,
     "startDate": "2025-01-11T00:00:00", "endDate": None},
    {"order": 1, "name": "Ukraine", "shortName": "Ukraine", "isPrivate": False,
     "startDate": "2013-01-01T00:00:00", "endDate": None},
    {"order": 3, "name": "Staff only", "shortName": "Hidden", "isPrivate": True},
    {"order": 4, "name": "Odd", "shortName": "../../etc", "isPrivate": False},
]


def source(**extra) -> dict:
    return {
        "kind": maplayers.GEOCONFIRMED,
        "factions": [
            {"name": f["name"], "colour": f["backgroundColor"].lower()} for f in FACTIONS
        ],
        **extra,
    }


def read(kmz: bytes | None = None) -> dict:
    return maplayers.parse(
        kmz or export_kmz(), filename="export.kmz", reading=geoconfirmed.reading(source())
    )


def by_name(parsed: dict) -> dict[str, dict]:
    return {f["properties"]["name"]: f["properties"] for f in parsed["geojson"]["features"]}


# ---------------------------------------------------------------------------
# Reading the export
# ---------------------------------------------------------------------------


def test_the_legend_is_the_factions_rather_than_the_age_folders():
    """"Last 7 days" is true on the day of the export and false the next morning."""
    names = {entry["name"] for entry in read()["summary"]["categories"]}

    assert "B. Last 7 days" not in names
    assert {"Ukraine", "Russia / Wagner", geoconfirmed.UNDATED} <= names


def test_factions_sharing_a_colour_are_one_row_named_after_both():
    """Their marks cannot be told apart, so a legend row that split them would be
    filtering on something the map does not show."""
    event = by_name(read())["12 SEP 2026 · Destroyed vehicle"]

    assert event["category"] == "Russia / Wagner"
    assert event["colour"] == "#e00000"


def test_a_colour_no_faction_claims_says_so_rather_than_guessing():
    assert by_name(read())["11 SEP 2026 · Unclaimed mark"]["category"] == geoconfirmed.UNLISTED


def test_a_placemark_without_a_date_is_an_undated_site():
    site = by_name(read())["Airbase"]

    assert site["category"] == geoconfirmed.UNDATED
    assert "date" not in site


def test_an_event_carries_its_day_for_the_time_filter():
    assert by_name(read())["13 SEP 2026 · Strike on a depot in Shebekino"]["date"] == "2026-09-13"


def test_an_event_is_named_by_its_date_and_what_happened():
    """The date alone says nothing to someone searching for a town, and the first
    line is not repeated in the body underneath it."""
    event = by_name(read())["13 SEP 2026 · Strike on a depot in Shebekino"]

    assert event["description"].startswith("Source(s):")
    assert "https://x.com/a/status/1" in event["description"]
    assert "https://x.com/b/status/2" in event["description"]


def test_a_long_first_line_is_cut_in_the_heading_and_kept_whole_in_the_body():
    long = "A column of armour " * 20
    kml = EXPORT_KML.replace(b"Destroyed vehicle", long.encode())
    event = next(
        p for p in (f["properties"] for f in read(export_kmz(kml))["geojson"]["features"])
        if p["name"].startswith("12 SEP 2026")
    )

    assert event["name"].endswith("…")
    assert len(event["name"]) < len(long)
    assert event["description"].startswith(long.strip())


def test_the_discs_are_centred_on_their_point_rather_than_on_the_declared_hotspot():
    """16,16 pixels is the middle of a 32-pixel icon; on a 56-pixel disc it would
    put every event a third of an icon away from where it happened."""
    parsed = read()

    assert parsed["icons"]
    assert all(descriptor["hotspot"] is None for descriptor in parsed["icons"].values())
    for feature in parsed["geojson"]["features"]:
        assert feature["properties"]["icon"] in parsed["icons"]


def test_the_icons_come_out_of_the_export_without_a_request(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("an icon was fetched")

    monkeypatch.setattr(maplayers, "_fetch_icon", refuse)
    kmz = export_kmz()
    parsed = read(kmz)

    images = maplayers.icon_images(parsed["icons"], source=kmz)
    assert set(images) == set(parsed["icons"])
    for png in images.values():
        with Image.open(io.BytesIO(png)) as image:
            assert image.width == image.height, "a centred disc needs no padding"


def test_a_date_is_read_in_english_whatever_the_locale():
    assert geoconfirmed._day("13 SEP 2026") == date(2026, 9, 13)
    assert geoconfirmed._day("13 Sep 2026") == date(2026, 9, 13)
    assert geoconfirmed._day("31 FEB 2026") is None
    assert geoconfirmed._day("Airbase") is None


# ---------------------------------------------------------------------------
# The query
# ---------------------------------------------------------------------------


def test_a_number_of_days_slides_with_the_day_of_each_read():
    spec = geoconfirmed.window(days=30)

    assert geoconfirmed.bounds(spec, date(2026, 9, 18)) == ("2026-08-19T00:00:00", None)
    assert geoconfirmed.bounds(spec, date(2026, 10, 18)) == ("2026-09-18T00:00:00", None)


def test_a_range_stays_put_and_takes_its_last_day_whole():
    spec = geoconfirmed.window(start="2024-05-01", end="2024-05-10")

    assert geoconfirmed.bounds(spec, date(2026, 9, 18)) == (
        "2024-05-01T00:00:00",
        "2024-05-10T23:59:59",
    )


def test_a_range_without_an_end_runs_to_the_day_of_each_read():
    spec = geoconfirmed.window(start="2026-08-01")

    assert geoconfirmed.bounds(spec) == ("2026-08-01T00:00:00", None)


def test_the_whole_history_asks_for_no_dates_at_all():
    spec = geoconfirmed.window(everything=True)

    assert geoconfirmed.bounds(spec, date(2026, 9, 18)) == (None, None)
    body = geoconfirmed.request(spec, None)
    assert (body["start"], body["end"]) == (None, None)


@pytest.mark.parametrize(
    "spec, label",
    [
        ({"everything": True}, "all history"),
        ({"days": 30}, "last 30 days"),
        ({"days": 1}, "last day"),
        ({"start": "2026-08-01", "end": ""}, "since 1 Aug 2026"),
        ({"start": "2026-08-01", "end": "2026-09-18"}, "1 Aug – 18 Sep 2026"),
        ({"start": "2025-12-30", "end": "2026-01-02"}, "30 Dec 2025 – 2 Jan 2026"),
        ({"start": "2026-08-01", "end": "2026-08-01"}, "1 Aug 2026"),
    ],
)
def test_the_window_is_named_the_way_a_row_can_hold_it(spec, label):
    assert geoconfirmed.window_label(spec) == label


@pytest.mark.parametrize(
    "kwargs, reason",
    [
        ({"days": 30, "start": "2026-08-01"}, "not both"),
        ({"everything": True, "days": 30}, "not both"),
        ({"everything": True, "start": "2026-08-01"}, "not both"),
        ({"days": 0}, "days"),
        ({"days": geoconfirmed.MAX_DAYS + 1}, "days"),
        ({}, "first day"),
        ({"start": "yesterday"}, "not a date"),
        ({"start": "2026-09-10", "end": "2026-09-01"}, "before the first"),
    ],
)
def test_a_window_that_makes_no_sense_is_refused_with_a_reason(kwargs, reason):
    with pytest.raises(maplayers.LayerError, match=reason):
        geoconfirmed.window(**kwargs)


def test_an_area_becomes_one_closed_polygon_in_the_export_request():
    box = geoconfirmed.area([30, 44, 40, 52])
    body = geoconfirmed.request({"days": 7}, box, date(2026, 9, 18))

    assert body["start"] == "2026-09-11T00:00:00"
    assert body["end"] is None
    ring = body["polygons"][0][0]
    assert ring[0] == ring[-1]
    assert {tuple(point) for point in ring} == {(30, 44), (40, 44), (40, 52), (30, 52)}


def test_no_area_asks_for_the_whole_conflict():
    assert geoconfirmed.request({"days": 7}, None)["polygons"] is None


@pytest.mark.parametrize(
    "box",
    [[1, 2, 3], [40, 44, 30, 52], [30, 52, 40, 44], [170, 0, -170, 10], [0, 0, float("inf"), 1]],
)
def test_an_area_that_is_not_a_box_is_refused(box):
    with pytest.raises(maplayers.LayerError):
        geoconfirmed.area(box)


@pytest.mark.parametrize("short", ["", "../Conflict", "Ukraine?x=1", "a" * 65])
def test_a_conflict_name_is_checked_before_it_is_put_in_an_address(short):
    with pytest.raises(maplayers.LayerError):
        geoconfirmed.conflict(short)


# ---------------------------------------------------------------------------
# GeoConfirmed, stubbed
# ---------------------------------------------------------------------------


@pytest.fixture
def served(monkeypatch):
    """Every request GeoConfirmed would get, and the answer it gives."""
    calls: list[dict] = []
    state = {"export": export_kmz(), "conflict": CONFLICT}

    def download(address, *, body=None, limit=maplayers.MAX_FETCH_BYTES, user_agent=""):
        calls.append({"address": address, "body": body, "user_agent": user_agent})
        if address.endswith("/api/Conflict"):
            return json.dumps(CONFLICTS).encode(), "Conflict"
        if "/api/Conflict/" in address:
            answer = state["conflict"]
            return (json.dumps(answer).encode() if answer else b""), "Ukraine"
        if "/api/Map/export/" in address:
            return state["export"], "@Geoconfirmed - Ukraine - 18 2227 SEP 2026.kmz"
        raise AssertionError(f"unexpected request {address}")

    monkeypatch.setattr(maplayers, "download", download)
    return {"calls": calls, "state": state}


@pytest.fixture
def case_id(client) -> str:
    return client.post("/api/cases", json={"name": "Front"}).json()["id"]


def add(client, case_id, **body):
    return client.post(
        f"/api/cases/{case_id}/map-layers/geoconfirmed",
        json={"conflict": "Ukraine", "days": 30, **body},
    )


def test_the_conflict_list_is_public_ordered_and_checked(client, served):
    listed = client.get("/api/geoconfirmed/conflicts").json()

    assert [entry["conflict"] for entry in listed] == ["Ukraine", "Iran"]
    assert listed[0]["start"] == "2013-01-01"
    assert served["calls"][0]["user_agent"].startswith("Azimut/")


def test_adding_a_conflict_files_a_followed_layer_in_its_own_icons(client, case_id, served):
    response = add(client, case_id, area=[30, 44, 40, 52])
    assert response.status_code == 200, response.text
    row = response.json()

    assert row["title"] == "GeoConfirmed · Ukraine · last 30 days"
    assert row["source"]["kind"] == "geoconfirmed"
    assert row["source"]["url"] == "https://geoconfirmed.org/map/ukraine"
    assert row["source"]["area"] == [30, 44, 40, 52]
    assert row["features"] == 4
    assert row["icons"] == 3
    assert row["refresh"] == {"on_open": True}
    assert row["stale"] is False

    export = next(call for call in served["calls"] if "/Map/export/" in call["address"])
    assert export["address"].endswith("/api/Map/export/Ukraine")
    assert export["body"]["polygons"] is not None


def test_the_whole_history_is_read_on_refresh_rather_than_on_every_case_open(
    client, case_id, served
):
    """Tens of thousands of events for a long war, re-read on every case open for
    a map that moves by a few dozen a day, is a cost nobody asked for."""
    response = add(client, case_id, days=None, everything=True)
    assert response.status_code == 200, response.text
    row = response.json()

    assert row["title"] == "GeoConfirmed · Ukraine · all history"
    assert row["refresh"] == {"on_open": False}
    export = next(call for call in served["calls"] if "/Map/export/" in call["address"])
    assert (export["body"]["start"], export["body"]["end"]) == (None, None)


def test_a_window_is_re_read_when_the_case_opens_unless_told_otherwise(
    client, case_id, served
):
    assert add(client, case_id).json()["refresh"] == {"on_open": True}
    assert add(client, case_id, on_open=False).json()["refresh"] == {"on_open": False}
    assert add(client, case_id, days=None, everything=True, on_open=True).json()["refresh"] == {
        "on_open": True
    }


def test_the_undated_sites_start_switched_off(client, case_id, served):
    """The analyst asked for dates, and these have none. They stay one click away."""
    row = add(client, case_id).json()

    assert row["hidden"] == [geoconfirmed.UNDATED]
    counts = {entry["name"]: entry["count"] for entry in row["categories"]}
    assert counts[geoconfirmed.UNDATED] == 1


def test_a_conflict_geoconfirmed_does_not_know_is_refused_with_its_name(
    client, case_id, served
):
    served["state"]["conflict"] = None
    response = add(client, case_id, conflict="Atlantis")

    assert response.status_code == 422
    assert "Atlantis" in response.json()["detail"]


def test_a_bad_window_is_refused_before_geoconfirmed_is_asked(client, case_id, served):
    response = add(client, case_id, days=None, start="2026-09-10", end="2026-09-01")

    assert response.status_code == 422
    assert served["calls"] == []


def test_listing_and_drawing_read_the_snapshot_rather_than_geoconfirmed(
    client, case_id, served
):
    row = add(client, case_id).json()
    asked = len(served["calls"])

    client.get(f"/api/cases/{case_id}/map-layers")
    client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data")
    client.patch(f"/api/cases/{case_id}/map-layers/{row['name']}", json={"hidden": ["Ukraine"]})

    assert len(served["calls"]) == asked


def test_the_drawn_copy_is_rebuilt_in_geoconfirmed_terms(client, case_id, served):
    """The cache never travels, so a restored case redraws from the snapshot: it
    has to come back with the factions, not the age folders."""
    row = add(client, case_id).json()
    Case.open(case_id).resolve_inside(layout.layer_cache_rel(row["name"])).unlink()

    data = client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data").json()
    categories = {feature["properties"]["category"] for feature in data["features"]}

    assert "B. Last 7 days" not in categories
    assert "Ukraine" in categories


def test_a_refresh_asks_the_same_question_again(client, case_id, served):
    row = add(client, case_id, area=[30, 44, 40, 52]).json()
    first = [call for call in served["calls"] if "/Map/export/" in call["address"]]
    served["calls"].clear()

    response = client.post(f"/api/cases/{case_id}/map-layers/{row['name']}/refresh")
    assert response.status_code == 200, response.text
    again = [call for call in served["calls"] if "/Map/export/" in call["address"]]

    assert again[0]["body"] == first[0]["body"]
    assert response.json()["hidden"] == [geoconfirmed.UNDATED]


def test_a_refresh_picks_up_a_faction_geoconfirmed_added_since(client, case_id, served):
    row = add(client, case_id).json()
    assert geoconfirmed.UNLISTED in {entry["name"] for entry in row["categories"]}

    served["state"]["conflict"] = {
        **CONFLICT,
        "factions": [*FACTIONS, {"name": "Volunteers", "backgroundColor": "#777777"}],
    }
    moved = client.post(f"/api/cases/{case_id}/map-layers/{row['name']}/refresh").json()
    names = {entry["name"] for entry in moved["categories"]}

    assert "Volunteers" in names
    assert geoconfirmed.UNLISTED not in names


def test_a_failed_refresh_leaves_the_last_export_on_the_map(
    client, case_id, served, monkeypatch
):
    row = add(client, case_id).json()

    def fail(*args, **kwargs):
        raise maplayers.LayerFetchError("could not reach that source: offline")

    monkeypatch.setattr(maplayers, "download", fail)
    response = client.post(f"/api/cases/{case_id}/map-layers/{row['name']}/refresh")

    assert response.status_code == 502
    kept = client.get(f"/api/cases/{case_id}/map-layers/{row['name']}").json()
    assert kept["sha256"] == row["sha256"]


def test_the_layer_is_one_map_layer_entity_citing_the_map_page(client, case_id, served):
    row = add(client, case_id).json()
    entity = Case.open(case_id).find_entity(attr="spec", value=row["spec"])

    assert entity["type"] == maplayers.ENTITY_TYPE
    assert entity["attrs"]["source_url"] == "https://geoconfirmed.org/map/ukraine"
