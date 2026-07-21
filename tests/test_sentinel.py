"""Sentinel Hub layers, mosaicking windows and date discovery (engine/sentinel.py)."""

from __future__ import annotations

import json
import io

import httpx
import pytest
from PIL import Image

from azimut.engine import sentinel


def _response(url, payload=None, text=None, status=200):
    return httpx.Response(
        status,
        content=(text if text is not None else json.dumps(payload)).encode(),
        request=httpx.Request("GET", url),
    )


# -- the WMTS template ---------------------------------------------------------


def test_wmts_url_omits_time_by_default():
    url = sentinel.wmts_url()
    assert "LAYER=TRUE_COLOR" in url
    # no TIME = the layer's own default window (most recent), which is the
    # honest answer to "just show me it"
    assert "TIME=" not in url
    assert "{key}" in url and "{z}" in url and "{x}" in url and "{y}" in url


def test_wmts_url_carries_the_layer_and_the_window():
    url = sentinel.wmts_url("SWIR", "2026-05-01", "2026-05-31")
    assert "LAYER=SWIR" in url
    assert "TIME=2026-05-01/2026-05-31" in url


def test_wmts_url_ignores_a_half_open_window():
    # a window needs both ends; one date alone would silently mean something
    # other than what the caller thinks
    assert "TIME=" not in sentinel.wmts_url("SWIR", "2026-05-01", None)


# -- variant ids ---------------------------------------------------------------


def test_variant_id_of_the_plain_basemap_is_just_the_base_id():
    # the default layer with no window must not get a second name: it would
    # cache twice and read as two providers in provenance
    assert sentinel.variant_id("sentinel2") == "sentinel2"
    assert sentinel.variant_id("sentinel2", "TRUE_COLOR") == "sentinel2"


def test_variant_id_round_trips_through_parse_variant():
    packed = sentinel.variant_id("sentinel2", "SWIR", "2026-05-01", "2026-05-31")
    assert packed == "sentinel2~SWIR~2026-05-01~2026-05-31"
    base, _, spec = packed.partition("~")
    assert base == "sentinel2"
    assert sentinel.parse_variant(spec) == ("SWIR", "2026-05-01", "2026-05-31")


def test_variant_id_keeps_a_windowed_default_layer():
    packed = sentinel.variant_id("sentinel2", "TRUE_COLOR", "2026-05-01", "2026-05-01")
    assert packed == "sentinel2~TRUE_COLOR~2026-05-01~2026-05-01"


def test_parse_variant_takes_a_bare_layer():
    assert sentinel.parse_variant("FALSE_COLOR") == ("FALSE_COLOR", None, None)


def test_parse_variant_accepts_a_layer_the_catalogue_never_heard_of():
    # an instance serves whatever its configuration says; the catalogue is a
    # default, not a gate (a wrong one comes back as Sentinel Hub's own 400)
    assert sentinel.parse_variant("MY_CUSTOM_SCRIPT") == ("MY_CUSTOM_SCRIPT", None, None)


@pytest.mark.parametrize(
    "spec",
    [
        "../../etc/passwd",  # the id is a URL path segment *and* a cache directory
        "TRUE COLOR",
        "true_color",  # layer names are upper-case; lower would 400 upstream
        "SWIR~2026-05-01",  # half a window
        "SWIR~2026-05-01~2026-05-31~extra",
        "SWIR~2026-13-01~2026-05-31",  # impossible month
        "SWIR~05/01/2026~2026-05-31",  # not ISO
        "SWIR~2026-05-31~2026-05-01",  # ends before it starts
        "",
    ],
)
def test_parse_variant_refuses_anything_ill_shaped(spec):
    with pytest.raises(ValueError):
        sentinel.parse_variant(spec)


def test_variant_label_reads_like_a_human_wrote_it():
    assert sentinel.variant_label("SWIR", None, None).endswith("most recent")
    assert "2026-05-01 → 2026-05-31" in sentinel.variant_label("SWIR", "2026-05-01", "2026-05-31")
    # a single-day window is a day, not a range from a day to itself
    assert sentinel.variant_label("SWIR", "2026-05-01", "2026-05-01").endswith("2026-05-01")


# -- date discovery ------------------------------------------------------------


def test_dates_collapses_granules_per_day_newest_first():
    captured = {}

    def get(url, params=None, **kwargs):
        captured["url"] = url
        captured["params"] = params
        return _response(
            url,
            {
                "features": [
                    {"properties": {"date": "2026-05-01", "cloudCoverPercentage": 80.0}},
                    # same day, second granule covering the point — the clearer
                    # one is the one worth reporting
                    {"properties": {"date": "2026-05-01", "cloudCoverPercentage": 12.5}},
                    {"properties": {"date": "2026-05-11", "cloudCoverPercentage": 3.0}},
                    {"properties": {"date": "not-a-date"}},  # never trust the wire
                ]
            },
        )

    found = sentinel.dates("inst-uuid", 48.8584, 2.2945, "2026-05-01", "2026-05-31", get=get)
    assert found == [
        {"date": "2026-05-11", "cloud": 3.0, "granules": 1},
        {"date": "2026-05-01", "cloud": 12.5, "granules": 2},
    ]
    assert "/ogc/wfs/inst-uuid" in captured["url"]
    assert captured["params"]["TYPENAMES"] == "DSS2"  # L2A — what the basemap renders
    assert captured["params"]["TIME"] == "2026-05-01/2026-05-31"


def _square(lat, lon, half=0.5):
    """A granule footprint around a point, GeoJSON order (lon, lat)."""
    return {
        "type": "Polygon",
        "coordinates": [[
            [lon - half, lat - half], [lon + half, lat - half],
            [lon + half, lat + half], [lon - half, lat + half],
            [lon - half, lat - half],
        ]],
    }


def test_dates_drops_a_granule_whose_imagery_misses_the_point():
    """A granule's *box* can reach the point while its swath doesn't — that day
    renders black. WFS answers on the box, so the footprint has to be checked or
    the date list promises imagery that isn't there."""

    def get(url, params=None, **kwargs):
        return _response(url, {"features": [
            # covers the point
            {"properties": {"date": "2026-05-11", "cloudCoverPercentage": 2},
             "geometry": _square(48.85, 2.29)},
            # box intersects the search area, footprint is a province away
            {"properties": {"date": "2026-05-04", "cloudCoverPercentage": 1},
             "geometry": _square(45.0, 6.0)},
        ]})

    found = sentinel.dates("inst-uuid", 48.8584, 2.2945, "2026-05-01", "2026-05-31", get=get)
    assert [entry["date"] for entry in found] == ["2026-05-11"]


def test_dates_keeps_a_granule_whatever_axis_order_the_service_used():
    """GeoJSON says lon/lat; an OGC service asked for EPSG:4326 may answer
    lat/lon. Read backwards, every footprint on Earth would be rejected."""
    swapped = {
        "type": "Polygon",
        "coordinates": [[[48.35, 1.79], [49.35, 1.79], [49.35, 2.79], [48.35, 2.79], [48.35, 1.79]]],
    }

    def get(url, params=None, **kwargs):
        return _response(url, {"features": [
            {"properties": {"date": "2026-05-11"}, "geometry": swapped}
        ]})

    found = sentinel.dates("inst-uuid", 48.8584, 2.2945, "2026-05-01", "2026-05-31", get=get)
    assert [entry["date"] for entry in found] == ["2026-05-11"]


def test_dates_keeps_a_pass_whose_geometry_it_cannot_read():
    """Never drop a real pass over a guess: no geometry means no evidence."""

    def get(url, params=None, **kwargs):
        return _response(url, {"features": [
            {"properties": {"date": "2026-05-11"}},
            {"properties": {"date": "2026-05-08"}, "geometry": {"type": "Point", "coordinates": [2, 48]}},
        ]})

    found = sentinel.dates("inst-uuid", 48.8584, 2.2945, "2026-05-01", "2026-05-31", get=get)
    assert [entry["date"] for entry in found] == ["2026-05-11", "2026-05-08"]


def test_dates_sends_a_latitude_first_bbox():
    captured = {}

    def get(url, params=None, **kwargs):
        captured.update(params)
        return _response(url, {"features": []})

    sentinel.dates("inst-uuid", 48.0, 2.0, "2026-05-01", "2026-05-31", get=get)
    # EPSG:4326 declares latitude first; lon/lat order would put the box in the
    # Indian Ocean and quietly report "no imagery"
    assert captured["SRSNAME"] == "EPSG:4326"
    lat_min, lon_min, lat_max, lon_max = (float(v) for v in captured["BBOX"].split(","))
    assert lat_min < 48.0 < lat_max
    assert lon_min < 2.0 < lon_max


def test_dates_reports_a_day_the_service_gave_no_cloud_figure_for():
    def get(url, params=None, **kwargs):
        return _response(url, {"features": [{"properties": {"date": "2026-05-01"}}]})

    found = sentinel.dates("inst-uuid", 48.0, 2.0, "2026-05-01", "2026-05-31", get=get)
    assert found == [{"date": "2026-05-01", "cloud": None, "granules": 1}]


def test_dates_raises_rather_than_report_an_empty_sky():
    def get(url, params=None, **kwargs):
        return _response(url, {}, status=500)

    # "the lookup failed" and "there are no passes here" are different facts and
    # must never render as the same empty list
    with pytest.raises(httpx.HTTPStatusError):
        sentinel.dates("inst-uuid", 48.0, 2.0, "2026-05-01", "2026-05-31", get=get)


# -- rendered coverage --------------------------------------------------------


def _mask_response(url, values):
    image = Image.new("L", (8, 8))
    image.putdata(values)
    payload = io.BytesIO()
    image.save(payload, format="PNG")
    return httpx.Response(
        200, content=payload.getvalue(), request=httpx.Request("GET", url)
    )


def test_coverage_uses_the_selected_layer_and_day():
    captured = {}

    def get(url, params=None, **kwargs):
        captured["url"] = url
        captured["params"] = params
        return _mask_response(url, [0] * 63 + [255])

    result = sentinel.coverage(
        "inst-uuid", 48.8584, 2.2945, "SWIR", "2026-05-11", get=get
    )

    assert result == {
        "available": True,
        "coverage": 0.016,
        "date": "2026-05-11",
        "layer": "SWIR",
    }
    assert captured["url"].endswith("/ogc/wms/inst-uuid")
    assert captured["params"]["LAYERS"] == "SWIR"
    assert captured["params"]["TIME"] == "2026-05-11/2026-05-11"
    assert captured["params"]["FORMAT"] == "image/png"
    assert captured["params"]["EVALSCRIPT"]


def test_coverage_reports_no_source_pixels():
    result = sentinel.coverage(
        "inst-uuid", 48.8584, 2.2945, "TRUE_COLOR", "2026-05-11",
        get=lambda url, **kwargs: _mask_response(url, [0] * 64),
    )
    assert result["available"] is False
    assert result["coverage"] == 0.0


@pytest.mark.parametrize(
    ("layer", "day"),
    [("../SWIR", "2026-05-11"), ("SWIR", "2026-02-30")],
)
def test_coverage_rejects_malformed_layer_or_day(layer, day):
    with pytest.raises(ValueError):
        sentinel.coverage("inst-uuid", 48.0, 2.0, layer, day)


def test_coverage_rejects_a_non_image_response():
    def get(url, **kwargs):
        return _response(url, text="<ExceptionReport />")

    with pytest.raises(sentinel.CoverageError, match="no readable image"):
        sentinel.coverage(
            "inst-uuid", 48.0, 2.0, "TRUE_COLOR", "2026-05-11", get=get
        )


# -- layer discovery -----------------------------------------------------------

_CAPABILITIES = """<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0"
              xmlns:ows="http://www.opengis.net/ows/1.1">
  <Contents>
    <Layer><ows:Identifier>TRUE_COLOR</ows:Identifier><ows:Title>True color</ows:Title></Layer>
    <Layer><ows:Identifier>MY_SHIPS</ows:Identifier><ows:Title>Vessel script</ows:Title></Layer>
    <Layer><ows:Identifier>bad id</ows:Identifier><ows:Title>unusable</ows:Title></Layer>
  </Contents>
</Capabilities>
"""


def test_capabilities_layers_asks_the_instance_and_keeps_our_hints():
    def get(url, params=None, **kwargs):
        assert params["REQUEST"] == "GetCapabilities"
        return _response(url, text=_CAPABILITIES)

    found = sentinel.capabilities_layers("inst-uuid", get=get)
    assert [entry["id"] for entry in found] == ["TRUE_COLOR", "MY_SHIPS"]
    # a layer we know keeps the reason to pick it; one we don't still gets offered
    assert found[0]["hint"]
    assert found[1] == {"id": "MY_SHIPS", "label": "Vessel script", "hint": ""}


def test_capabilities_layers_drops_names_that_could_not_be_asked_for():
    def get(url, params=None, **kwargs):
        return _response(url, text=_CAPABILITIES)

    # "bad id" can't survive a variant id (URL path segment + cache directory),
    # so offering it would only produce a broken selection
    assert all(" " not in entry["id"] for entry in sentinel.capabilities_layers("i", get=get))
