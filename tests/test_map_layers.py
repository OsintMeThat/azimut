"""Layers the analyst adds to a case's map.

Three things this has to get right, and they are what the tests are grouped by:

- **every format lands on one shape**, so the renderer never learns what a KML
  is;
- **a hostile file is refused with a sentence**, because the input is somebody
  else's XML and somebody else's zip;
- **the network boundary holds both ways** — it fetches when the analyst asks,
  and it does not fetch on a listing, on a disabled layer, or when the snapshot
  already on disk answers.
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from PIL import Image, ImageDraw

import fullcase
from azimut import layout
from azimut.engine import artifacts, maplayers
from azimut.workspace import Case

# ---------------------------------------------------------------------------
# Sources, small enough to read
# ---------------------------------------------------------------------------

KML = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Sightings</name>'
    '<Style id="red"><IconStyle><color>ff0000ff</color></IconStyle></Style>'
    '<StyleMap id="pair"><Pair><key>normal</key><styleUrl>#red</styleUrl></Pair>'
    "<Pair><key>highlight</key><styleUrl>#other</styleUrl></Pair></StyleMap>"
    "<Folder><name>Checkpoints</name>"
    "<Placemark><name>North gate</name><description>&lt;b&gt;Seen&lt;/b&gt; twice</description>"
    '<styleUrl>#pair</styleUrl><Point><coordinates>2.3522,48.8566,12</coordinates></Point>'
    "</Placemark>"
    "<Placemark><name>Wall</name>"
    "<LineString><coordinates>2.30,48.85 2.32,48.86</coordinates></LineString></Placemark>"
    "</Folder>"
    "<Folder><name>Damage</name>"
    "<Placemark><name>Warehouse</name><Polygon><outerBoundaryIs><LinearRing>"
    "<coordinates>2.1,48.1 2.2,48.1 2.2,48.2 2.1,48.1</coordinates>"
    "</LinearRing></outerBoundaryIs></Polygon></Placemark>"
    "</Folder></Document></kml>"
).encode()

GEOJSON = json.dumps(
    {
        "type": "FeatureCollection",
        "name": "Harbour",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [2.35, 48.85]},
                "properties": {"name": "Quay 4", "description": "Loading", "marker-color": "#f00"},
            },
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[2.3, 48.8], [2.4, 48.9]]},
                "properties": {"title": "Approach"},
            },
        ],
    }
).encode()

GPX = (
    '<gpx version="1.1"><metadata><name>Patrol</name></metadata>'
    '<wpt lat="48.10" lon="2.10"><name>Start</name><desc>First light</desc></wpt>'
    '<trk><name>Run</name><trkseg><trkpt lat="48.10" lon="2.10"/>'
    '<trkpt lat="48.20" lon="2.20"/></trkseg></trk></gpx>'
).encode()


def png(size: tuple[int, int] = (32, 32), colour: tuple[int, int, int] = (255, 255, 255)) -> bytes:
    """A flat square. White by default, which is what a My Maps pictogram is:
    the shape is in the file and the colour is in the style."""
    buffer = io.BytesIO()
    Image.new("RGBA", size, (*colour, 255)).save(buffer, "PNG")
    return buffer.getvalue()


def icon_kml(
    href: str = "images/pin.png",
    hotspot: str = '<hotSpot x="16" xunits="pixels" y="32" yunits="insetPixels"/>',
    colour: str = "ff0000ff",
) -> bytes:
    """One placemark pointing at one pictogram, the way a My Maps writes it."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Dressed</name>'
        f'<Style id="pin"><IconStyle><color>{colour}</color><scale>1</scale>'
        f"<Icon><href>{href}</href></Icon>{hotspot}</IconStyle></Style>"
        "<Folder><name>Checkpoints</name>"
        '<Placemark><name>North gate</name><styleUrl>#pin</styleUrl>'
        "<Point><coordinates>2.35,48.85</coordinates></Point></Placemark>"
        '<Placemark><name>Wall</name><styleUrl>#pin</styleUrl>'
        "<LineString><coordinates>2.30,48.85 2.32,48.86</coordinates></LineString>"
        "</Placemark></Folder></Document></kml>"
    ).encode()


def kmz(kml: bytes = KML, name: str = "doc.kml", extra: dict[str, bytes] | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, kml)
        for member, data in (extra or {}).items():
            archive.writestr(member, data)
    return buffer.getvalue()


@pytest.fixture
def case_id(client) -> str:
    return client.post("/api/cases", json={"name": "Layers"}).json()["id"]


def add(
    client, case_id: str, data: bytes, filename: str, title: str = "", icons: bool = False
) -> dict:
    response = client.post(
        f"/api/cases/{case_id}/map-layers/upload",
        files={"file": (filename, io.BytesIO(data), "application/octet-stream")},
        data={"title": title, "icons": str(icons).lower()},
    )
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# One shape out of four formats
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "data, filename",
    [(KML, "s.kml"), (kmz(), "s.kmz"), (GEOJSON, "h.geojson"), (GPX, "p.gpx")],
    # Named, because a zip carries the second it was built in: ids made of the bytes
    # differ between xdist workers that collect a second apart, and the run refuses.
    ids=["kml", "kmz", "geojson", "gpx"],
)
def test_every_format_parses_to_the_same_normalised_shape(data, filename):
    """Whatever it arrived as, a feature carries the same four fields and the
    summary is the legend: one row per category, with a colour and a count."""
    parsed = maplayers.parse(data, filename=filename)
    summary = parsed["summary"]

    assert parsed["geojson"]["type"] == "FeatureCollection"
    assert summary["features"] == len(parsed["geojson"]["features"]) > 0
    assert sum(entry["count"] for entry in summary["categories"]) == summary["features"]
    assert summary["bbox"] and len(summary["bbox"]) == 4
    for feature in parsed["geojson"]["features"]:
        assert set(feature["properties"]) >= {"name", "description", "category", "colour"}
        assert feature["geometry"]["type"] in {"Point", "LineString", "Polygon"}


def test_a_kml_folder_is_a_legend_category():
    """The whole of the grouping rule: a My Maps' layers *are* its folders, so a
    folder is a legend row and hiding it hides exactly its features."""
    summary = maplayers.parse(KML, filename="s.kml")["summary"]

    assert [entry["name"] for entry in summary["categories"]] == ["Checkpoints", "Damage"]
    assert [entry["count"] for entry in summary["categories"]] == [2, 1]
    assert summary["categories"][0]["kinds"] == ["line", "point"]


def test_a_kml_colour_is_honoured_through_its_style_map():
    """`aabbggrr` with the alpha dropped, and the *normal* half of a StyleMap —
    which is the one Google writes and the one the map draws."""
    features = maplayers.parse(KML, filename="s.kml")["geojson"]["features"]

    assert features[0]["properties"]["colour"] == "#ff0000"
    assert maplayers.parse(GEOJSON, filename="h.geojson")["geojson"]["features"][0][
        "properties"
    ]["colour"] == "#ff0000"


def test_a_description_arrives_as_text_rather_than_as_markup():
    """A KML description is arbitrary HTML. The popup shows what the source says;
    it does not render somebody else's markup inside the app."""
    features = maplayers.parse(KML, filename="s.kml")["geojson"]["features"]

    assert features[0]["properties"]["description"] == "Seen twice"


def test_a_my_maps_table_keeps_one_row_per_line():
    """A My Maps writes its columns as an HTML table. Stripped of its tags that
    is one run-on sentence; kept as lines the popup can draw the labels the
    source wrote."""
    kml = _kml_with_description(
        "&lt;table&gt;&lt;tr&gt;&lt;td&gt;code&lt;/td&gt;&lt;td&gt;UA&lt;/td&gt;&lt;/tr&gt;"
        "&lt;tr&gt;&lt;td&gt;layer&lt;/td&gt;&lt;td&gt;OLD26&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;"
    )
    features = maplayers.parse(kml, filename="s.kml")["geojson"]["features"]

    assert features[0]["properties"]["description"] == "code: UA\nlayer: OLD26"


def test_a_link_keeps_the_address_it_pointed_at():
    """The popup shows text, so an address living only in an `href` would be
    lost — and the address is what the analyst opens next."""
    kml = _kml_with_description(
        "shelling &lt;a href=\"https://example.org/a/1\"&gt;source&lt;/a&gt;"
    )
    features = maplayers.parse(kml, filename="s.kml")["geojson"]["features"]

    assert features[0]["properties"]["description"] == "shelling source https://example.org/a/1"


def test_a_name_stays_one_line_whatever_markup_it_held():
    """Only a description is allowed to arrive shaped: a name is a popup heading
    and a category is a legend row."""
    kml = _kml_with_description("x", name="North&lt;br&gt;gate")
    features = maplayers.parse(kml, filename="s.kml")["geojson"]["features"]

    assert features[0]["properties"]["name"] == "North gate"


def _kml_with_description(description: str, name: str = "North gate") -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Sightings</name>'
        f"<Placemark><name>{name}</name><description>{description}</description>"
        "<Point><coordinates>2.3522,48.8566</coordinates></Point>"
        "</Placemark></Document></kml>"
    ).encode()


def test_a_geojson_is_one_category_named_after_itself():
    """A plain FeatureCollection states no grouping, and guessing one out of
    whichever property looks categorical would make the legend lie."""
    summary = maplayers.parse(GEOJSON, filename="h.geojson")["summary"]

    assert [entry["name"] for entry in summary["categories"]] == ["Harbour"]


def test_a_gpx_is_grouped_by_what_its_elements_are():
    summary = maplayers.parse(GPX, filename="p.gpx")["summary"]

    assert sorted(entry["name"] for entry in summary["categories"]) == ["Tracks", "Waypoints"]


def test_the_format_is_read_off_the_bytes_rather_than_the_extension():
    """Files arrive renamed. A KML called `.geojson` draws rather than failing
    on its first angle bracket."""
    assert maplayers.sniff(KML, "sightings.geojson") == "kml"
    assert maplayers.sniff(GEOJSON, "harbour.kml") == "geojson"
    assert maplayers.sniff(kmz(), "whatever") == "kmz"


# ---------------------------------------------------------------------------
# What will not be read
# ---------------------------------------------------------------------------


def test_an_external_entity_is_refused_rather_than_resolved():
    """The XXE: the stdlib parser would read the named file into the document."""
    hostile = (
        '<?xml version="1.0"?>'
        '<!DOCTYPE kml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>'
        "<name>&xxe;</name><Point><coordinates>1,1</coordinates></Point>"
        "</Placemark></Document></kml>"
    ).encode()

    with pytest.raises(maplayers.LayerError) as refused:
        maplayers.parse(hostile, filename="x.kml")
    assert str(refused.value)


def test_an_expansion_bomb_is_refused_before_it_expands():
    """Billion laughs: ten nested entities, each ten copies of the last."""
    entities = "".join(
        f'<!ENTITY e{index} "{"&e" + str(index - 1) + ";" * 1 if index else "lol"}">'
        for index in range(10)
    )
    hostile = (
        f'<?xml version="1.0"?><!DOCTYPE kml [{entities}]>'
        f"<kml><Document><Placemark><name>&e9;</name>"
        f"<Point><coordinates>1,1</coordinates></Point></Placemark></Document></kml>"
    ).encode()

    with pytest.raises(maplayers.LayerError):
        maplayers.parse(hostile, filename="x.kml")


def test_a_file_over_the_size_limit_is_refused_with_the_limit_in_the_message():
    oversized = b"{" + b" " * (maplayers.MAX_SOURCE_BYTES + 1)

    with pytest.raises(maplayers.LayerError, match="limit"):
        maplayers.parse(oversized, filename="big.geojson")


def test_more_features_than_the_cap_is_refused_rather_than_truncated(monkeypatch):
    """Never truncated: a layer drawing the first half of a file would be a map
    making a claim about a place it had only partly read."""
    monkeypatch.setattr(maplayers, "MAX_FEATURES", 3)
    crowd = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [index / 100, 48]},
                    "properties": {},
                }
                for index in range(10)
            ],
        }
    ).encode()

    with pytest.raises(maplayers.LayerError, match="dataset"):
        maplayers.parse(crowd, filename="crowd.geojson")


def test_a_kmz_naming_a_file_outside_itself_is_refused():
    """Zip-slip. Nothing is extracted to disk, but an archive built to escape
    something is not one to read the contents of."""
    with pytest.raises(maplayers.LayerError, match="outside itself"):
        maplayers.parse(kmz(name="../../doc.kml"), filename="evil.kmz")


def test_a_kmz_that_unpacks_far_past_its_size_is_refused(monkeypatch):
    monkeypatch.setattr(maplayers, "MAX_COMPRESSION_RATIO", 2)
    with pytest.raises(maplayers.LayerError, match="compressed"):
        maplayers.parse(kmz(extra={"pad.bin": b"\0" * 100_000}), filename="bomb.kmz")


def test_a_kmz_holding_no_kml_says_so():
    with pytest.raises(maplayers.LayerError, match="no KML"):
        maplayers.parse(kmz(name="readme.txt"), filename="x.kmz")


def test_a_file_with_nothing_to_draw_is_refused_rather_than_drawn_empty():
    empty = json.dumps({"type": "FeatureCollection", "features": []}).encode()

    with pytest.raises(maplayers.LayerError, match="no points"):
        maplayers.parse(empty, filename="empty.geojson")


def test_something_that_is_not_a_map_file_at_all_names_the_formats():
    with pytest.raises(maplayers.LayerError, match="GeoJSON, KML, KMZ or GPX"):
        maplayers.parse(b"\x89PNG\r\n\x1a\n", filename="photo.png")


@pytest.mark.parametrize("data, filename", [(b"{oops", "x.geojson"), (b"<kml><", "x.kml")])
def test_a_malformed_file_is_refused_with_a_readable_reason(data, filename):
    with pytest.raises(maplayers.LayerError) as refused:
        maplayers.parse(data, filename=filename)
    assert "not valid JSON" in str(refused.value) or "will not parse" in str(refused.value)


def test_the_upload_route_answers_a_refused_file_with_its_reason(client, case_id):
    response = client.post(
        f"/api/cases/{case_id}/map-layers/upload",
        files={"file": ("photo.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png")},
    )

    assert response.status_code == 422
    assert "GeoJSON" in response.json()["detail"]


# ---------------------------------------------------------------------------
# A layer in a case
# ---------------------------------------------------------------------------


def test_adding_a_file_files_three_files_and_one_entity(client, case_id):
    row = add(client, case_id, KML, "sightings.kml", title="Sightings")
    case = Case.open(case_id)

    assert row["features"] == 3
    assert row["source"] == {"kind": "file", "name": "sightings.kml", "format": "kml"}
    for rel in (
        layout.layer_spec_rel(row["name"]),
        layout.layer_snapshot_rel(row["name"]),
        layout.layer_cache_rel(row["name"]),
    ):
        assert case.resolve_inside(rel).is_file(), rel
    # The snapshot is the bytes as received, which is what makes it hashable
    # like a media and what the parsed copy is rebuilt from.
    assert case.resolve_inside(layout.layer_snapshot_rel(row["name"])).read_bytes() == KML
    assert row["sha256"] == maplayers.digest(KML)

    entity = client.get(
        f"/api/cases/{case_id}/entities/lookup",
        params={"attr": "spec", "value": layout.layer_spec_rel(row["name"])},
    ).json()["entity"]
    assert entity["type"] == "map-layer"
    assert entity["label"] == "Sightings"


def test_two_files_of_the_same_name_are_two_layers(client, case_id):
    first = add(client, case_id, KML, "sightings.kml", title="Sightings")
    second = add(client, case_id, GEOJSON, "sightings.geojson", title="Sightings")

    assert first["name"] != second["name"]
    assert len(client.get(f"/api/cases/{case_id}/map-layers").json()) == 2


def test_the_drawn_copy_is_rebuilt_when_the_cache_is_gone(client, case_id):
    """Which is the normal state after a restore or an import: the cache is the
    one of the three files that never travels."""
    row = add(client, case_id, KML, "sightings.kml")
    case = Case.open(case_id)
    cache = case.resolve_inside(layout.layer_cache_rel(row["name"]))
    cache.unlink()

    drawn = client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data")

    assert drawn.status_code == 200
    assert cache.is_file()
    assert len(drawn.json()["features"]) == 3


def test_the_drawn_copy_is_never_reused_by_the_browser_unasked(client, case_id):
    """A refresh changes what this one address holds. Without a rule of its own,
    Chrome guessed a lifetime from Last-Modified and went on drawing a GeoConfirmed
    layer's old features, a day of events short, under a row saying it was read
    just now."""
    row = add(client, case_id, KML, "sightings.kml")

    drawn = client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data")

    assert drawn.headers["cache-control"] == "no-cache"


def test_a_category_toggle_is_stored_and_bounded_to_the_categories_there_are(
    client, case_id
):
    row = add(client, case_id, KML, "sightings.kml")

    updated = client.patch(
        f"/api/cases/{case_id}/map-layers/{row['name']}",
        json={"hidden": ["Damage", "Invented"]},
    ).json()

    assert updated["hidden"] == ["Damage"]
    assert updated["features"] == 3, "hiding a category never changes what is loaded"


def test_the_legend_survives_a_reload_and_the_switch_is_not_stored(client, case_id):
    """Whether a layer is drawn lives in the page and starts off on every load: a
    layer that crashed the tab must not be drawn again by the reload."""
    row = add(client, case_id, KML, "sightings.kml")
    client.patch(
        f"/api/cases/{case_id}/map-layers/{row['name']}",
        json={"enabled": True, "hidden": ["Damage"]},
    )

    reopened = client.get(f"/api/cases/{case_id}/map-layers").json()[0]
    spec = json.loads(
        Case.open(case_id).resolve_inside(layout.layer_spec_rel(row["name"])).read_text()
    )

    assert reopened["hidden"] == ["Damage"]
    assert "enabled" not in reopened
    assert "enabled" not in spec


def test_a_local_file_is_never_stale(client, case_id):
    """It is exactly what the analyst opened, and it was never going to change."""
    row = add(client, case_id, KML, "sightings.kml")

    assert row["stale"] is False


def test_a_copy_an_older_parser_wrote_is_read_again(client, case_id):
    """A layer added from a file is never re-read, so without this it would draw
    the output of whichever parser was current the day it was dropped in."""
    row = add(client, case_id, KML, "sightings.kml")
    case = Case.open(case_id)
    cache = case.resolve_inside(layout.layer_cache_rel(row["name"]))
    cache.write_text(
        json.dumps({maplayers.PARSE_KEY: 0, "type": "FeatureCollection", "features": []}),
        encoding="utf-8",
    )

    drawn = client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data")

    assert len(drawn.json()["features"]) == 3
    assert json.loads(cache.read_text())[maplayers.PARSE_KEY] == maplayers.PARSE_VERSION


def test_deleting_a_layer_takes_its_snapshot_and_its_cache(client, case_id):
    row = add(client, case_id, KML, "sightings.kml")
    case = Case.open(case_id)

    response = client.delete(f"/api/cases/{case_id}/map-layers/{row['name']}")

    assert response.status_code == 200
    assert not case.resolve_inside(layout.layer_cache_rel(row["name"])).exists()
    client.delete(f"/api/cases/{case_id}/trash")
    assert not case.resolve_inside(layout.layer_snapshot_rel(row["name"])).exists()


def test_the_registry_carries_the_spec_and_the_snapshot_but_not_the_cache(client):
    """The three files' three different answers to "does this travel?", read off
    the registry the Trash and the bundle both consult."""
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    entity = case.get_entity(full.layer_id)

    assert set(artifacts.owned(case, entity)) == {
        full.layer,
        full.layer_snapshot,
        full.layer_icons,
    }
    assert artifacts.caches(case, entity) == [full.layer_cache]


def test_restoring_a_layer_brings_back_what_travels_and_rebuilds_the_rest(client):
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)

    deleted = client.delete(f"/api/cases/{full.case_id}/entities/{full.layer_id}")
    assert deleted.status_code == 200
    group = deleted.json().get("trash")
    assert group, "a layer is restorable, like everything else the case holds"
    assert not case.resolve_inside(full.layer).exists()

    restored = client.post(f"/api/cases/{full.case_id}/trash/{group}/restore")
    assert restored.status_code == 200, restored.text
    assert case.resolve_inside(full.layer).is_file()
    assert case.resolve_inside(full.layer_snapshot).is_file()
    # The icons come back rather than being rebuilt: a My Maps' came off Google's
    # servers, so a case restored offline could not make them again.
    assert case.resolve_inside(full.layer_icons).is_file()
    assert not case.resolve_inside(full.layer_cache).exists(), "a cache is not restored"

    name = full.layer.rsplit("/", 1)[-1].removesuffix(".json")
    assert client.get(f"/api/cases/{full.case_id}/map-layers/{name}/data").status_code == 200


# ---------------------------------------------------------------------------
# The network boundary, both ways
# ---------------------------------------------------------------------------


@pytest.fixture
def no_network(monkeypatch):
    """Anything reaching out during a test that uses this is the failure."""

    def refuse(*args, **kwargs):
        raise AssertionError("this route reached the network")

    monkeypatch.setattr(maplayers.httpx, "stream", refuse)


def test_adding_and_drawing_a_local_file_never_reaches_the_network(
    client, case_id, no_network
):
    row = add(client, case_id, KML, "sightings.kml")
    client.get(f"/api/cases/{case_id}/map-layers")
    client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data")
    client.patch(f"/api/cases/{case_id}/map-layers/{row['name']}", json={"hidden": ["Damage"]})


def test_listing_a_subscribed_layer_reads_the_snapshot_rather_than_the_feed(
    client, case_id, monkeypatch
):
    """The half that is easy to get wrong: a case full of subscriptions must open
    offline, drawing what it last saw."""
    calls = []
    monkeypatch.setattr(maplayers, "fetch", lambda url: (calls.append(url), (KML, "s.kml"))[1])
    row = client.post(
        f"/api/cases/{case_id}/map-layers", json={"url": "https://example.test/s.kml"}
    ).json()
    assert calls == ["https://example.test/s.kml"]

    client.get(f"/api/cases/{case_id}/map-layers")
    client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data")
    client.patch(f"/api/cases/{case_id}/map-layers/{row['name']}", json={"hidden": ["Damage"]})

    assert len(calls) == 1, "only the subscription itself fetched"


def test_refreshing_replaces_the_snapshot_only_when_the_bytes_moved(
    client, case_id, monkeypatch
):
    served = [KML]
    monkeypatch.setattr(maplayers, "fetch", lambda url: (served[0], "s.kml"))
    row = client.post(
        f"/api/cases/{case_id}/map-layers", json={"url": "https://example.test/s.kml"}
    ).json()
    first = row["fetched_at"]

    unchanged = client.post(f"/api/cases/{case_id}/map-layers/{row['name']}/refresh").json()
    assert unchanged["sha256"] == row["sha256"]
    assert unchanged["fetched_at"] == first, "unchanged bytes rewrite nothing"

    served[0] = GEOJSON
    moved = client.post(f"/api/cases/{case_id}/map-layers/{row['name']}/refresh").json()
    assert moved["sha256"] == maplayers.digest(GEOJSON)
    assert moved["features"] == 2
    assert Case.open(case_id).resolve_inside(
        layout.layer_snapshot_rel(row["name"])
    ).read_bytes() == GEOJSON


def test_a_failed_refresh_leaves_the_last_snapshot_on_the_map(client, case_id, monkeypatch):
    monkeypatch.setattr(maplayers, "fetch", lambda url: (KML, "s.kml"))
    row = client.post(
        f"/api/cases/{case_id}/map-layers", json={"url": "https://example.test/s.kml"}
    ).json()

    def fail(url):
        raise maplayers.LayerFetchError("that source answered 503")

    monkeypatch.setattr(maplayers, "fetch", fail)
    failed = client.post(f"/api/cases/{case_id}/map-layers/{row['name']}/refresh")

    assert failed.status_code == 502
    assert "503" in failed.json()["detail"]
    assert client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data").json()["features"]


def test_a_file_layer_has_nothing_to_refresh(client, case_id, no_network):
    row = add(client, case_id, KML, "sightings.kml")

    response = client.post(f"/api/cases/{case_id}/map-layers/{row['name']}/refresh")

    assert response.status_code == 422
    assert "came from a file" in response.json()["detail"]


# ---------------------------------------------------------------------------
# My Maps
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "link, mid",
    [
        ("https://www.google.com/maps/d/viewer?mid=1AbC_dEf-9&ll=48,2&z=9", "1AbC_dEf-9"),
        ("https://www.google.com/maps/d/u/0/edit?mid=XyZ&usp=sharing", "XyZ"),
        ("https://www.google.com/maps/d/kml?mid=XyZ&forcekml=1", "XyZ"),
        ("https://example.org/data.kml", ""),
    ],
)
def test_a_my_maps_share_link_gives_up_its_map_id(link, mid):
    assert maplayers.my_maps_mid(link) == mid


def test_a_my_maps_link_is_fetched_through_the_one_feed_it_has():
    """Undocumented and breakable, and the only way to read a My Maps at all —
    recorded in SPEC §9 rather than left to be discovered here."""
    feed = maplayers.feed_url("https://www.google.com/maps/d/viewer?mid=XyZ&ll=1,2")

    assert feed == "https://www.google.com/maps/d/kml?mid=XyZ"
    # anything else is fetched exactly as it was pasted
    assert maplayers.feed_url("https://example.org/d.kml") == "https://example.org/d.kml"


def test_the_archive_is_asked_for_rather_than_the_kml_beside_it():
    """`forcekml=1` answers the same placemarks and throws away what the map was
    drawn with: every style comes back pointing at one of three *blank* Google
    containers, so a map of forty hand-picked symbols draws as coloured blanks.
    The KMZ bundles the creator's real icons as members of itself."""
    assert "forcekml" not in maplayers.MY_MAPS_FEED
    assert maplayers.feed_url(
        "https://www.google.com/maps/d/kml?mid=XyZ&forcekml=1"
    ) == "https://www.google.com/maps/d/kml?mid=XyZ"


def test_a_my_maps_that_is_not_shared_says_what_to_do_about_it(client, case_id, monkeypatch):
    """404 on this feed means "not shared publicly" far more often than it means
    "no such map", and the difference is where the analyst goes looking."""

    def refuse(url):
        raise maplayers.LayerFetchError(
            maplayers._status_reason(
                _status_error(url, 404), maplayers.feed_url(url)
            )
        )

    monkeypatch.setattr(maplayers, "fetch", refuse)
    response = client.post(
        f"/api/cases/{case_id}/map-layers",
        json={"url": "https://www.google.com/maps/d/viewer?mid=XyZ"},
    )

    assert response.status_code == 502
    assert "shared publicly" in response.json()["detail"]


def test_an_address_that_is_not_http_is_refused_before_anything_is_read(
    client, case_id, no_network
):
    response = client.post(
        f"/api/cases/{case_id}/map-layers", json={"url": "file:///etc/passwd"}
    )

    assert response.status_code == 422
    assert "http" in response.json()["detail"]


# ---------------------------------------------------------------------------
# The source's own pictograms
# ---------------------------------------------------------------------------


def dressed_kmz(**kwargs) -> bytes:
    return kmz(icon_kml(**kwargs), extra={"images/pin.png": png()})


def test_a_placemarks_icon_is_described_by_parsing_and_fetched_by_nobody():
    """The split the whole feature rests on: parsing says what an icon *is*,
    turning that into pixels is a separate act that may reach out."""
    parsed = maplayers.parse(dressed_kmz(), filename="s.kmz")
    [descriptor] = parsed["icons"].values()

    assert descriptor["href"] == "images/pin.png"
    assert descriptor["colour"] == "#ff0000"
    assert descriptor["hotspot"] == [16.0, 32.0, "pixels", "insetPixels"]


def test_only_a_point_carries_an_icon():
    """A line and an area are drawn by their own stroke and fill. A pictogram
    stuck on the middle of a border would be a mark the source never made."""
    features = maplayers.parse(dressed_kmz(), filename="s.kmz")["geojson"]["features"]

    assert features[0]["geometry"]["type"] == "Point" and features[0]["properties"]["icon"]
    assert features[1]["geometry"]["type"] == "LineString"
    assert features[1]["properties"]["icon"] == ""


def test_a_kmz_composes_its_own_icons_without_reaching_the_network(
    client, case_id, no_network
):
    """The free half of this feature: the pictograms are already in the file the
    analyst dropped in, so honouring them costs one decode."""
    row = add(client, case_id, dressed_kmz(), "s.kmz", icons=True)

    assert row["icons"] == 1
    assert Case.open(case_id).resolve_inside(layout.layer_icons_rel(row["name"])).is_file()


def test_the_style_colour_is_multiplied_onto_the_icon():
    """The step this turns on. A My Maps' stock pictograms are *white* — the
    shape is in the PNG, the colour is in the style — so an untinted one is a
    white blob, and honouring the href without the colour looks like a bug."""
    parsed = maplayers.parse(dressed_kmz(), filename="s.kmz")
    [image] = maplayers.icon_images(parsed["icons"], source=dressed_kmz()).values()

    composed = Image.open(io.BytesIO(image)).convert("RGBA")
    assert composed.getpixel((composed.width // 2, composed.height // 4)) == (255, 0, 0, 255)


def test_a_hotspot_is_padded_into_the_middle_of_the_image():
    """So the map can anchor every icon the same way — centred — and a pin whose
    tip is its meaning still puts that tip on the ground.

    The source anchors this one at the bottom of a square, so the composed image
    is twice as tall as it is wide, with the picture in the upper half.
    """
    source = dressed_kmz()
    parsed = maplayers.parse(source, filename="s.kmz")
    [image] = maplayers.icon_images(parsed["icons"], source=source).values()

    composed = Image.open(io.BytesIO(image))
    assert composed.height == composed.width * 2
    assert composed.convert("RGBA").getpixel((composed.width // 2, 2))[3] == 255
    assert composed.convert("RGBA").getpixel((composed.width // 2, composed.height - 2))[3] == 0


def test_icons_are_sized_on_their_ink_rather_than_on_their_canvas():
    """The canvas is not the icon. A My Maps archive holds a square painted edge
    to edge beside a small glyph floating in a sheet of transparency, and sizing
    the *sheets* alike draws the second at a fraction of the first — which reads
    as broken icons rather than as a source honoured.
    """
    full = Image.new("RGBA", (56, 56), (255, 255, 255, 255))
    lost = Image.new("RGBA", (56, 56), (0, 0, 0, 0))
    lost.paste(Image.new("RGBA", (14, 14), (255, 255, 255, 255)), (21, 21))

    def stored(image):
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        source = kmz(icon_kml(hotspot=""), extra={"images/pin.png": buffer.getvalue()})
        parsed = maplayers.parse(source, filename="s.kmz")
        [png] = maplayers.icon_images(parsed["icons"], source=source).values()
        # The opaque core, not every pixel resampling left a trace in: a soft
        # edge is not part of what the eye measures the mark by.
        composed = Image.open(io.BytesIO(png)).convert("RGBA")
        box = composed.split()[3].point(lambda level: 255 if level > 128 else 0).getbbox()
        return max(box[2] - box[0], box[3] - box[1])

    # the same size to within a pixel or two, rather than four times apart
    assert abs(stored(full) - stored(lost)) <= 4
    assert abs(stored(lost) - maplayers.ICON_SIDE) <= 4


def test_a_solid_shape_is_not_drawn_heavier_than_the_hollow_one_beside_it():
    """The second lie the bounding box tells. A My Maps container set holds a
    square filled corner to corner next to a disc painting 79% of its own box, so
    matching the *boxes* still leaves the square carrying nearly twice the ink —
    which is what reads on the map as the squares being too big."""
    square = Image.new("RGBA", (56, 56), (255, 255, 255, 255))
    disc = Image.new("RGBA", (56, 56), (0, 0, 0, 0))
    ImageDraw.Draw(disc).ellipse((0, 0, 55, 55), fill=(255, 255, 255, 255))

    def painted(image):
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        source = kmz(icon_kml(hotspot=""), extra={"images/pin.png": buffer.getvalue()})
        parsed = maplayers.parse(source, filename="s.kmz")
        [png] = maplayers.icon_images(parsed["icons"], source=source).values()
        alpha = Image.open(io.BytesIO(png)).convert("RGBA").split()[3]
        return alpha.point(lambda level: 255 if level > 128 else 0).histogram()[255]

    # the square still paints more than the disc — a square *is* denser — but
    # nothing like the 1.8x the raw bounding box would have given it
    assert painted(square) / painted(disc) < 1.25


def test_a_glyph_lost_in_a_huge_sheet_does_not_scale_the_sheet_with_it():
    """Sizing on the ink means the transparency around it scales too, so the
    canvas needs its own ceiling or one icon becomes a texture."""
    sheet = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    sheet.paste(Image.new("RGBA", (4, 4), (255, 255, 255, 255)), (510, 510))
    buffer = io.BytesIO()
    sheet.save(buffer, "PNG")
    source = kmz(icon_kml(hotspot=""), extra={"images/pin.png": buffer.getvalue()})
    parsed = maplayers.parse(source, filename="s.kmz")

    [png] = maplayers.icon_images(parsed["icons"], source=source).values()

    assert max(Image.open(io.BytesIO(png)).size) <= maplayers.MAX_ICON_CANVAS


def test_a_centred_hotspot_is_not_padded_at_all():
    source = kmz(icon_kml(hotspot=""), extra={"images/pin.png": png()})
    parsed = maplayers.parse(source, filename="s.kmz")
    [image] = maplayers.icon_images(parsed["icons"], source=source).values()

    composed = Image.open(io.BytesIO(image))
    assert composed.width == composed.height


def test_two_styles_that_would_compose_alike_are_one_stored_icon():
    """A My Maps writes a style per placemark. Keying on what an icon *looks
    like* rather than on the style's id is what keeps that down to one image."""
    twice = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Pair</name>'
        '<Style id="a"><IconStyle><color>ff0000ff</color>'
        "<Icon><href>images/pin.png</href></Icon></IconStyle></Style>"
        '<Style id="b"><IconStyle><color>ff0000ff</color>'
        "<Icon><href>images/pin.png</href></Icon></IconStyle></Style>"
        '<Placemark><styleUrl>#a</styleUrl><Point><coordinates>2,48</coordinates></Point>'
        "</Placemark>"
        '<Placemark><styleUrl>#b</styleUrl><Point><coordinates>3,48</coordinates></Point>'
        "</Placemark></Document></kml>"
    ).encode()

    parsed = maplayers.parse(kmz(twice, extra={"images/pin.png": png()}), filename="s.kmz")

    assert len(parsed["icons"]) == 1


def test_an_icon_style_a_feature_never_uses_is_never_read(monkeypatch):
    """A KML commonly declares styles for shapes it no longer holds. Fetching one
    would be a request made on nobody's behalf."""
    orphan = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Orphan</name>'
        '<Style id="unused"><IconStyle>'
        "<Icon><href>https://example.test/never.png</href></Icon></IconStyle></Style>"
        "<Placemark><name>Plain</name><Point><coordinates>2,48</coordinates></Point>"
        "</Placemark></Document></kml>"
    ).encode()

    assert maplayers.parse(orphan, filename="s.kml")["icons"] == {}


def test_a_file_added_without_the_tick_composes_nothing(client, case_id, no_network):
    """The default for a file, and the local-first line: opening something off
    this machine does not inherently need the network, so it does not touch it."""
    row = add(client, case_id, dressed_kmz(), "s.kmz")

    assert row["icons"] == 0
    assert not Case.open(case_id).resolve_inside(layout.layer_icons_rel(row["name"])).exists()


def test_a_remote_href_is_read_once_at_import_and_never_again(client, case_id, monkeypatch):
    """What the browser must never do: the address is followed here, once, and
    what the map loads from then on is a file in the case folder."""
    calls = []

    def serve(href):
        calls.append(href)
        return png()

    monkeypatch.setattr(maplayers, "_fetch_icon", serve)
    monkeypatch.setattr(
        maplayers, "fetch", lambda url: (icon_kml(href="https://icons.test/p.png"), "s.kml")
    )
    row = client.post(
        f"/api/cases/{case_id}/map-layers", json={"url": "https://example.test/s.kml"}
    ).json()
    assert calls == ["https://icons.test/p.png"]

    client.get(f"/api/cases/{case_id}/map-layers")
    client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data")
    key = client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/data").json()[
        "features"
    ][0]["properties"]["icon"]
    served = client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/icons/{key}")

    assert row["icons"] == 1
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/png"
    assert len(calls) == 1, "only the import read the source's own address"


def test_a_subscription_without_the_tick_reads_the_feed_and_no_icon(
    client, case_id, monkeypatch
):
    def refuse(href):
        raise AssertionError("an icon was fetched without being asked for")

    monkeypatch.setattr(maplayers, "_fetch_icon", refuse)
    monkeypatch.setattr(
        maplayers, "fetch", lambda url: (icon_kml(href="https://icons.test/p.png"), "s.kml")
    )
    row = client.post(
        f"/api/cases/{case_id}/map-layers",
        json={"url": "https://example.test/s.kml", "icons": False},
    ).json()

    assert row["icons"] == 0


def test_an_icon_that_cannot_be_read_costs_its_layer_nothing(client, case_id, no_network):
    """The fallback, and the reason the panel needs no switch for it: the layer
    draws, its features draw, and they wear the app's own shape."""
    row = add(client, case_id, kmz(icon_kml(href="images/missing.png")), "s.kmz", icons=True)

    assert row["icons"] == 0
    assert row["features"] == 2


def test_something_that_is_not_an_image_is_refused_rather_than_stored(
    client, case_id, no_network
):
    """Nothing a source sent is passed on: every icon is decoded and re-encoded
    here, so a file pretending to be a PNG never reaches the browser."""
    hostile = kmz(
        icon_kml(),
        extra={"images/pin.png": b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'},
    )

    assert add(client, case_id, hostile, "s.kmz", icons=True)["icons"] == 0


def test_an_icon_naming_a_file_outside_the_archive_is_refused():
    escaping = kmz(icon_kml(href="../../../etc/passwd"), extra={"images/pin.png": png()})
    parsed = maplayers.parse(escaping, filename="s.kmz")

    assert maplayers.icon_images(parsed["icons"], source=escaping) == {}


def test_more_icons_than_the_cap_leaves_the_rest_on_the_pictogram(monkeypatch):
    """Never a refusal: the marks are the map, the icons are how it was dressed."""
    monkeypatch.setattr(maplayers, "MAX_ICONS", 1)
    many = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Many</name>'
        + "".join(
            f'<Style id="s{index}"><IconStyle><color>ff0000{index:02x}</color>'
            f"<Icon><href>images/pin.png</href></Icon></IconStyle></Style>"
            f'<Placemark><styleUrl>#s{index}</styleUrl>'
            f"<Point><coordinates>{index},48</coordinates></Point></Placemark>"
            for index in range(4)
        )
        + "</Document></kml>"
    ).encode()
    source = kmz(many, extra={"images/pin.png": png()})
    parsed = maplayers.parse(source, filename="s.kmz")

    assert len(parsed["icons"]) == 4
    assert len(maplayers.icon_images(parsed["icons"], source=source)) == 1


def _many_icons(count: int, href: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Many</name>'
        + "".join(
            f'<Style id="s{index}"><IconStyle><color>ff0000{index:02x}</color>'
            f"<Icon><href>{href}</href></Icon></IconStyle></Style>"
            f'<Placemark><styleUrl>#s{index}</styleUrl>'
            f"<Point><coordinates>{index},48</coordinates></Point></Placemark>"
            for index in range(count)
        )
        + "</Document></kml>"
    ).encode()


def test_icons_at_addresses_are_held_to_their_own_smaller_cap(monkeypatch):
    """Each one is a request to somebody else's server, which an icon inside the
    archive is not."""
    monkeypatch.setattr(maplayers, "MAX_FETCHED_ICONS", 2)
    calls = []
    monkeypatch.setattr(maplayers, "_fetch_icon", lambda href: (calls.append(href), png())[1])
    parsed = maplayers.parse(_many_icons(4, "https://icons.test/p.png"), filename="s.kml")

    assert len(maplayers.icon_images(parsed["icons"])) == 2
    assert len(calls) == 2


def test_icons_inside_the_archive_are_not_held_to_the_cap_on_fetched_ones(monkeypatch):
    monkeypatch.setattr(maplayers, "MAX_FETCHED_ICONS", 1)
    source = kmz(_many_icons(4, "images/pin.png"), extra={"images/pin.png": png()})
    parsed = maplayers.parse(source, filename="s.kmz")

    assert len(maplayers.icon_images(parsed["icons"], source=source)) == 4


def test_an_icon_is_asked_for_by_key_rather_than_by_path(client, case_id, no_network):
    """The key is a content hash, so there is nothing in the URL to traverse
    with — and anything that is not one is refused before a file is opened."""
    row = add(client, case_id, dressed_kmz(), "s.kmz", icons=True)

    for key in ("../../case.json", "nope", "ZZZZ"):
        refused = client.get(f"/api/cases/{case_id}/map-layers/{row['name']}/icons/{key}")
        assert refused.status_code == 404, key


def test_a_refresh_composes_the_icons_the_layer_was_added_with(client, case_id, monkeypatch):
    """The tick is answered once and remembered: a feed that moved comes back
    dressed the same way, without asking again."""
    served = [dressed_kmz()]
    monkeypatch.setattr(maplayers, "fetch", lambda url: (served[0], "s.kmz"))
    row = client.post(
        f"/api/cases/{case_id}/map-layers", json={"url": "https://example.test/s.kmz"}
    ).json()
    assert row["icons"] == 1

    served[0] = kmz(icon_kml(colour="ff00ff00"), extra={"images/pin.png": png()})
    moved = client.post(f"/api/cases/{case_id}/map-layers/{row['name']}/refresh").json()

    assert moved["sha256"] != row["sha256"]
    assert moved["icons"] == 1


def _status_error(url: str, code: int) -> "maplayers.httpx.HTTPStatusError":
    request = maplayers.httpx.Request("GET", maplayers.feed_url(url))
    response = maplayers.httpx.Response(code, request=request)
    return maplayers.httpx.HTTPStatusError("refused", request=request, response=response)


# ---------------------------------------------------------------------------
# Dates, which the row's time filter compares
# ---------------------------------------------------------------------------


def test_a_kml_timestamp_or_the_start_of_a_timespan_dates_its_placemark():
    dated = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Dated</name>'
        "<Placemark><name>Stamped</name><TimeStamp><when>2024-05-10T14:03:00Z</when>"
        "</TimeStamp><Point><coordinates>2,48</coordinates></Point></Placemark>"
        "<Placemark><name>Spanned</name><TimeSpan><begin>2024-05-01</begin>"
        "<end>2024-05-09</end></TimeSpan><Point><coordinates>3,48</coordinates></Point>"
        "</Placemark>"
        "<Placemark><name>Undated</name><Point><coordinates>4,48</coordinates></Point>"
        "</Placemark></Document></kml>"
    ).encode()
    properties = {
        f["properties"]["name"]: f["properties"]
        for f in maplayers.parse(dated, filename="d.kml")["geojson"]["features"]
    }

    # the day as the source wrote it, not moved into another timezone
    assert properties["Stamped"]["date"] == "2024-05-10"
    assert "date_end" not in properties["Stamped"]
    # a span keeps both ends, so a period that only reaches its end still finds it
    assert properties["Spanned"]["date"] == "2024-05-01"
    assert properties["Spanned"]["date_end"] == "2024-05-09"
    assert "date" not in properties["Undated"]


def test_a_gpx_waypoint_is_dated_by_its_time():
    gpx = (
        '<gpx version="1.1"><wpt lat="48.10" lon="2.10"><name>Start</name>'
        "<time>2023-11-02T06:40:00Z</time></wpt></gpx>"
    ).encode()

    feature = maplayers.parse(gpx, filename="p.gpx")["geojson"]["features"][0]

    assert feature["properties"]["date"] == "2023-11-02"


@pytest.mark.parametrize("value", ["", "yesterday", "2024-02-30", "10/05/2024", None])
def test_anything_that_is_not_a_day_dates_nothing(value):
    assert maplayers.iso_day(value) == ""


def test_the_time_filter_is_stored_with_the_legend_and_cleared_by_two_blanks(client, case_id):
    row = add(client, case_id, KML, "sightings.kml")
    url = f"/api/cases/{case_id}/map-layers/{row['name']}"

    kept = client.patch(url, json={"period": {"start": "2024-05-01", "end": "2024-05-31"}})
    assert kept.json()["period"] == {"start": "2024-05-01", "end": "2024-05-31"}
    assert client.get(url).json()["period"] == {"start": "2024-05-01", "end": "2024-05-31"}

    open_ended = client.patch(url, json={"period": {"start": "2024-05-01", "end": ""}})
    assert open_ended.json()["period"] == {"start": "2024-05-01", "end": ""}

    cleared = client.patch(url, json={"period": {"start": "", "end": ""}})
    assert cleared.json()["period"] is None


def test_a_period_given_backwards_is_put_the_right_way_round(client, case_id):
    row = add(client, case_id, KML, "sightings.kml")
    url = f"/api/cases/{case_id}/map-layers/{row['name']}"

    turned = client.patch(url, json={"period": {"start": "2024-05-31", "end": "2024-05-01"}})

    assert turned.json()["period"] == {"start": "2024-05-01", "end": "2024-05-31"}


def test_a_period_that_is_not_made_of_days_is_refused(client, case_id):
    row = add(client, case_id, KML, "sightings.kml")
    url = f"/api/cases/{case_id}/map-layers/{row['name']}"

    assert client.patch(url, json={"period": {"start": "May", "end": ""}}).status_code == 422
    assert client.get(url).json()["period"] is None
