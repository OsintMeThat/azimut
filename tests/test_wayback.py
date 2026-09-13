"""Esri World Imagery Wayback: the release list, the walk, the metadata and the routes.

Nothing here asks Esri anything. The three services are stubbed with the shapes
they really answer with (read off the live services, 2026-09), so what is tested
is how the app reads them.
"""

from __future__ import annotations

import httpx
import pytest

from azimut.engine import tiles, wayback

META = "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_{}/MapServer"


@pytest.fixture(autouse=True)
def fresh_session():
    wayback.reset()
    yield
    wayback.reset()


class Reply:
    def __init__(self, payload=None, content=b"", status=200):
        self.payload = payload
        self.content = content
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "refused", request=httpx.Request("GET", "https://x"), response=None
            )

    def json(self):
        return self.payload


def _config(*entries):
    """`(release, date, metadata suffix)` → the JSON document Esri publishes."""
    return {
        str(number): {
            "itemTitle": f"World Imagery (Wayback {date})",
            "itemURL": f"https://wayback.maptiles.arcgis.com/.../tile/{number}/{{level}}/{{row}}/{{col}}",
            "metadataLayerUrl": META.format(suffix),
        }
        for number, date, suffix in entries
    }


CONFIG = _config(
    (10, "2014-02-20", "2014_r01"),
    (64776, "2023-08-31", "2023_r08"),
    (25982, "2023-06-13", "2023_r06"),
    (26334, "2026-08-05", "2026_r10"),
)


def _get_config(url, **kwargs):
    assert url == wayback.CONFIG_URL
    return Reply(CONFIG)


# -- the release list --------------------------------------------------------------


def test_releases_are_sorted_by_date_because_their_numbers_are_not():
    listed = wayback.parse_config(CONFIG)
    assert [r.number for r in listed] == [26334, 64776, 25982, 10]
    assert listed[0].date == "2026-08-05"


def test_an_entry_in_any_other_shape_is_skipped():
    listed = wayback.parse_config(
        {
            **CONFIG,
            "../etc": {"itemTitle": "World Imagery (Wayback 2020-01-01)"},
            "77": {"itemTitle": "no date in here"},
            "78": "not an object",
        }
    )
    assert {r.number for r in listed} == {26334, 64776, 25982, 10}
    assert wayback.parse_config(["not", "a", "dict"]) == []


def test_a_metadata_service_on_another_host_is_never_followed():
    listed = wayback.parse_config(
        {
            "5": {
                "itemTitle": "World Imagery (Wayback 2020-01-01)",
                "metadataLayerUrl": "https://attacker.example/arcgis/rest/services/x/MapServer",
            }
        }
    )
    assert listed[0].metadata_url is None


def test_the_list_is_read_once_per_session():
    calls = []

    def counting(url, **kwargs):
        calls.append(url)
        return Reply(CONFIG)

    wayback.releases(get=counting)
    wayback.releases(get=counting)
    assert len(calls) == 1


def test_an_empty_list_is_an_error_rather_than_a_basemap_with_no_release():
    with pytest.raises(ValueError):
        wayback.releases(get=lambda url, **k: Reply({}))


def test_a_release_is_digits_and_nothing_else():
    assert wayback.parse_variant("64776") == 64776
    for bad in ("../x", "64776a", "", "1" * 10, "12~3"):
        with pytest.raises(ValueError):
            wayback.parse_variant(bad)


# -- the provider ------------------------------------------------------------------


def test_the_plain_basemap_resolves_to_the_newest_release(monkeypatch):
    monkeypatch.setattr(wayback, "_get", _get_config)
    provider = tiles.get_provider("esri-wayback")
    # the release is in the id, so the cache and a capture key on it
    assert provider.id == "esri-wayback~26334"
    assert "/tile/26334/{z}/{y}/{x}" in provider.url
    assert provider.label == "Esri Wayback · 2026-08-05"
    assert provider.cacheable and provider.capturable and not provider.needs_key


def test_a_named_release_keeps_its_number_and_its_date(monkeypatch):
    monkeypatch.setattr(wayback, "_get", _get_config)
    provider = tiles.get_provider("esri-wayback~25982")
    assert provider.id == "esri-wayback~25982"
    assert tiles.tile_url(provider.url, 15, 16594, 11271).endswith("/tile/25982/15/11271/16594")
    assert provider.label.endswith("2023-06-13")


def test_a_named_release_still_draws_when_the_list_is_unreachable(monkeypatch):
    def down(url, **kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(wayback, "_get", down)
    assert tiles.get_provider("esri-wayback~25982").label == "Esri Wayback · release 25982"
    # …but the newest cannot be named without it
    with pytest.raises(KeyError):
        tiles.get_provider("esri-wayback")


def test_a_malformed_release_is_refused_before_it_reaches_a_path(monkeypatch):
    monkeypatch.setattr(wayback, "_get", _get_config)
    with pytest.raises(KeyError):
        tiles.get_provider("esri-wayback~../../etc")


def test_listing_the_basemaps_asks_esri_nothing(client, monkeypatch):
    # local-first: the catalogue is read on mount, the release list never is
    monkeypatch.setattr(wayback, "_get", lambda *a, **k: pytest.fail("asked Esri on mount"))
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "esri-wayback" in ids


# -- the walk ----------------------------------------------------------------------


def _walk(select_by_release, sizes=None, tiles_by_release=None, seen=None, pictures=None):
    """A stub for the tilemap, the tiles and the metadata. `select_by_release[r]`
    is the release the tilemap names when asked at `r`; None means no tile
    there. `pictures[r]` is `(epoch ms, sensor)` or None for no metadata; by
    default every release was taken on a different day."""
    sizes = sizes or {}
    tiles_by_release = tiles_by_release or {}
    pictures = pictures if pictures is not None else {}

    def get(url, **kwargs):
        if url == wayback.CONFIG_URL:
            return Reply(CONFIG)
        if seen is not None:
            seen.append(url)
        if "/tilemap/" in url:
            release = int(url.split("/tilemap/")[1].split("/")[0])
            chosen = select_by_release.get(release)
            if chosen is None:
                return Reply({"data": [0], "valid": True})
            return Reply({"data": [1], "select": [chosen], "size": [sizes.get(chosen, 100)]})
        if url.split("?")[0].endswith("/query"):
            suffix = url.split("World_Imagery_Metadata_")[1].split("/")[0]
            release = next(int(k) for k, v in CONFIG.items() if v["metadataLayerUrl"].endswith(f"_{suffix}/MapServer"))
            picture = pictures.get(release, (1_000_000_000_000 + release * 86_400_000, "WV03"))
            if picture is None:
                return Reply({"features": []})
            stamp, sensor = picture
            return Reply({"features": [{"attributes": {"SRC_DATE2": stamp, "NICE_DESC": "Maxar", "SRC_DESC": sensor}}]})
        release = int(url.split("/tile/")[1].split("/")[0])
        return Reply(content=tiles_by_release.get(release, str(release).encode()))

    return get


def _releases(changes):
    return [change.release for change in changes]


def test_the_walk_names_each_release_that_changed_the_point_newest_first():
    get = _walk({26334: 64776, 25982: 10, 10: 10}, sizes={64776: 300, 10: 200})
    assert _releases(wayback.local_changes(50.45, 30.52, 15, get=get)) == [64776, 10]


def test_the_walk_stops_where_the_imagery_does():
    get = _walk({26334: 26334})  # 64776 has no tile there
    assert _releases(wayback.local_changes(50.45, 30.52, 15, get=get)) == [26334]


def test_a_release_the_list_does_not_know_ends_the_walk_rather_than_guessing():
    get = _walk({26334: 999})
    assert wayback.local_changes(50.45, 30.52, 15, get=get) == []


def test_two_neighbours_with_the_same_pixels_are_one_change_and_the_older_stays():
    same = b"identical jpeg"
    get = _walk(
        {26334: 64776, 25982: 10, 10: 10},
        sizes={64776: 14, 10: 14},
        tiles_by_release={64776: same, 10: same},
    )
    assert _releases(wayback.local_changes(50.45, 30.52, 15, get=get)) == [10]


def test_equal_sizes_with_different_pixels_are_still_two_changes():
    get = _walk(
        {26334: 64776, 25982: 10, 10: 10},
        sizes={64776: 5, 10: 5},
        tiles_by_release={64776: b"aaaaa", 10: b"bbbbb"},
    )
    assert _releases(wayback.local_changes(50.45, 30.52, 15, get=get)) == [64776, 10]


def test_a_picture_published_again_is_one_change_dated_by_its_first_release():
    # Mariupol, 2026-09: three releases re-processed one GE01 acquisition, and
    # the tilemap counts each as a change because its bytes differ
    taken = (1_696_377_600_000, "GE01")  # 2023-10-04
    get = _walk(
        {26334: 26334, 64776: 25982, 10: 10},
        sizes={26334: 300, 25982: 200, 10: 100},
        pictures={26334: taken, 25982: taken, 10: (1_648_512_000_000, "WV03")},
    )
    changes = wayback.local_changes(50.45, 30.52, 15, get=get)
    assert _releases(changes) == [25982, 10]
    assert changes[0].acquired == "2023-10-04"
    assert changes[0].source == "Maxar GE01"


def test_the_same_day_from_another_satellite_is_another_picture():
    get = _walk(
        {26334: 64776, 25982: 10, 10: 10},
        sizes={64776: 300, 10: 200},
        pictures={64776: (1_696_377_600_000, "GE01"), 10: (1_696_377_600_000, "WV02")},
    )
    assert _releases(wayback.local_changes(50.45, 30.52, 15, get=get)) == [64776, 10]


def test_a_release_without_metadata_is_never_merged_into_its_neighbour():
    get = _walk(
        {26334: 64776, 25982: 10, 10: 10},
        sizes={64776: 300, 10: 200},
        pictures={64776: None, 10: None},
    )
    changes = wayback.local_changes(50.45, 30.52, 15, get=get)
    assert _releases(changes) == [64776, 10]
    assert changes[0].acquired is None


def test_a_tile_that_cannot_be_read_keeps_its_change_rather_than_failing_the_walk():
    flaky = _walk(
        {26334: 64776, 25982: 10, 10: 10},
        sizes={64776: 5, 10: 5},
        tiles_by_release={64776: b"same!", 10: b"same!"},
    )

    def get(url, **kwargs):
        if "/tile/64776/" in url:
            raise httpx.ConnectError("tls alert")
        return flaky(url, **kwargs)

    assert _releases(wayback.local_changes(50.45, 30.52, 15, get=get)) == [64776, 10]


def test_the_same_tile_is_walked_once_per_session():
    seen = []
    get = _walk({26334: 26334}, seen=seen)
    wayback.local_changes(50.45, 30.51, 15, get=get)
    first = len(seen)
    wayback.local_changes(50.4501, 30.5101, 15, get=get)  # a nudge inside the same tile
    assert len(seen) == first


def test_the_walk_asks_at_the_view_zoom_but_never_past_the_basemap():
    seen = []
    wayback.local_changes(50.45, 30.52, 22, get=_walk({26334: 26334}, seen=seen))
    assert "/tilemap/26334/19/" in seen[0]


# -- when the pixels were taken ----------------------------------------------------


def test_the_metadata_layer_follows_the_zoom():
    assert wayback.metadata_layer(23) == 0
    assert wayback.metadata_layer(15) == 8
    # everything from zoom 10 out shares the last layer
    assert wayback.metadata_layer(4) == 13


def test_acquisition_date_is_read_from_that_release_and_that_level():
    asked = []

    def get(url, **kwargs):
        if url == wayback.CONFIG_URL:
            return Reply(CONFIG)
        asked.append((url, kwargs.get("params")))
        return Reply(
            {"features": [{"attributes": {"SRC_DATE2": 1648684800000, "NICE_DESC": "Maxar", "SRC_DESC": "WV03"}}]}
        )

    found = wayback.capture_date(50.4501, 30.5234, 15, 64776, get=get)
    assert found == {"date": "2022-03-31", "source": "Maxar WV03", "release_date": "2023-08-31"}
    url, params = asked[0]
    assert url == META.format("2023_r08") + "/8/query"
    assert '"x":30.5234' in params["geometry"] and '"y":50.4501' in params["geometry"]


def test_a_release_without_metadata_there_says_so_rather_than_inventing_a_date():
    def get(url, **kwargs):
        return Reply(CONFIG) if url == wayback.CONFIG_URL else Reply({"features": []})

    assert wayback.capture_date(0, 0, 15, 10, get=get) == {
        "date": None,
        "source": None,
        "release_date": "2014-02-20",
    }


def test_an_unreachable_metadata_service_is_an_unknown_not_an_error():
    def get(url, **kwargs):
        if url == wayback.CONFIG_URL:
            return Reply(CONFIG)
        raise httpx.ConnectError("offline")

    assert wayback.capture_date(0, 0, 15, 10, get=get) is None


# -- the routes --------------------------------------------------------------------


def test_the_release_route_lists_numbers_and_dates(client, monkeypatch):
    monkeypatch.setattr(wayback, "_get", _get_config)
    body = client.get("/api/satellite/wayback/releases").json()
    assert body["releases"][0] == {"release": 26334, "date": "2026-08-05"}


def test_the_release_route_says_when_esri_cannot_be_reached(client, monkeypatch):
    def down(url, **kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(wayback, "_get", down)
    assert client.get("/api/satellite/wayback/releases").status_code == 502


def _transport(get):
    """The same stub, as the pooled client the route opens for its walk."""

    def handler(request: httpx.Request) -> httpx.Response:
        reply = get(str(request.url))
        if reply.payload is not None:
            return httpx.Response(reply.status_code, json=reply.payload)
        return httpx.Response(reply.status_code, content=reply.content)

    return lambda: httpx.Client(transport=httpx.MockTransport(handler))


def test_the_change_route_answers_for_a_point(client, monkeypatch):
    monkeypatch.setattr(wayback, "_get", lambda *a, **k: pytest.fail("walked without pooling"))
    monkeypatch.setattr(wayback, "_open_client", _transport(_walk({26334: 64776, 25982: 25982})))
    body = client.get(
        "/api/satellite/wayback/changes", params={"lat": 50.45, "lon": 30.52, "zoom": 16}
    ).json()
    assert [change["release"] for change in body["changes"]] == [64776, 25982]
    assert body["changes"][0]["acquired"] and body["changes"][0]["source"] == "Maxar WV03"
    assert body["zoom"] == 16


def test_the_change_route_refuses_a_point_off_the_planet(client):
    assert (
        client.get(
            "/api/satellite/wayback/changes", params={"lat": 91, "lon": 0, "zoom": 16}
        ).status_code
        == 422
    )


def test_imagery_date_dates_a_wayback_release_from_its_own_metadata(client, monkeypatch):
    monkeypatch.setattr(
        wayback,
        "capture_date",
        lambda lat, lon, zoom, number: {"date": "2022-03-31", "source": "Maxar", "release_date": "x"},
    )
    body = client.get(
        "/api/satellite/imagery-date",
        params={"lat": 1, "lon": 2, "zoom": 15, "provider": "esri-wayback~64776"},
    ).json()
    assert body["supported"] is True and body["date"] == "2022-03-31"


def test_imagery_date_refuses_a_malformed_release(client):
    response = client.get(
        "/api/satellite/imagery-date",
        params={"lat": 1, "lon": 2, "zoom": 15, "provider": "esri-wayback~x/y"},
    )
    assert response.status_code == 422


def test_a_proxied_tile_is_cached_under_the_release_it_came_from(client, monkeypatch):
    from azimut.api import satellite
    from azimut.engine import tilecache

    monkeypatch.setattr(wayback, "_get", _get_config)
    asked = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        return httpx.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})

    monkeypatch.setattr(satellite, "_tile_client", httpx.Client(transport=httpx.MockTransport(handler)))
    assert client.get("/api/tiles/esri-wayback/15/16594/11271").status_code == 200
    assert asked == [
        "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/"
        "default028mm/MapServer/tile/26334/15/11271/16594"
    ]
    assert tilecache.get("esri-wayback~26334", 15, 16594, 11271) is not None
