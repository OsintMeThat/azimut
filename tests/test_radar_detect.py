"""Detect's radar methods: Sentinel-1 products, passes, tracks and detectors.

Products are built in the byte layout the radar evalscript returns
(engine/sentinel.py): decibels in fifths from -35 dB, VV first, VH second.
"""

import base64
import io
from copy import deepcopy

import numpy as np
import pytest
from PIL import Image

from azimut import config
from azimut.engine import analyzers, sentinel, tilecache, workqueue
from azimut.engine.analysis_models import BUILTINS, RunInput, Source
from azimut.workspace import Case
from analyzerfixture import EDGE, PAD, SENTINEL_TILE, zone

LAYER = "SAR_IW"
DAY_A, DAY_B = "2026-05-02", "2026-05-14"
TIME = "05:42:10"


def level(db):
    return np.clip(np.round((np.asarray(db, float) - sentinel.SAR_DB_FLOOR) / sentinel.SAR_DB_STEP),
                   1, 255).astype(np.uint8)


def speckled(mean_db, seed, size=EDGE, looks=4.4):
    """Sea or ground as the radar reads it: gamma-distributed power."""
    rng = np.random.default_rng(seed)
    power = rng.gamma(looks, 1 / looks, (size, size)) * 10 ** (mean_db / 10)
    return 10 * np.log10(power)


def water(value, size=EDGE):
    frame = np.zeros((size, size, 4), np.uint8)
    frame[..., 0] = value
    frame[..., 3] = 255
    return frame


def recipe(rid, **parameters):
    found = next(r for r in BUILTINS if r.id == rid).model_copy(deep=True)
    return found.model_copy(update={"parameters": found.parameters.model_copy(update=parameters)})


def body(rid, **parameters):
    return RunInput.model_validate({
        "title": rid, "zones": [zone()], "recipe": recipe(rid, **parameters).model_dump(),
        "a": {"provider": "sentinel1", "date": DAY_A, "layer": LAYER, "maxcc": 100, "time": TIME},
        "b": {"provider": "sentinel1", "date": DAY_B, "layer": LAYER, "maxcc": 100, "time": TIME},
        "offline": True,
    })


def reading(rid, before, after, mask=None, water_frame=None, **parameters):
    picture = np.full((512, 512, 4), 255, np.uint8)
    mask = np.ones((512, 512), np.uint8) if mask is None else mask
    return analyzers.detect((picture, picture), (before, after), mask, body(rid, **parameters),
                            1.0, water_frame)


def found(result):
    import cv2
    count, _ = cv2.connectedComponents(result.binary, connectivity=8)
    return count - 1


# -- products, windows and passes -------------------------------------------------------


def test_radar_products_carry_decibels_in_fifths_and_are_never_zero_where_seen():
    script = base64.b64decode(sentinel._evalscript("sar")).decode("ascii")
    assert 'bands: ["VV", "VH", "dataMask"]' in script
    assert "return [level(p.VV), level(p.VH), 0, 255]" in script
    assert "Math.max(1," in script
    picture = base64.b64decode(sentinel._evalscript("sar-picture")).decode("ascii")
    assert "stretch(db(p.VV) - db(p.VH)" in picture
    # the byte goes back to decibels exactly on the grid it was rounded to
    assert sentinel.sar_decibels(level(-22.0).astype(float)) == pytest.approx(-22.0)
    assert sentinel.sar_decibels(level(3.4).astype(float)) == pytest.approx(3.4)


def test_a_pass_window_holds_one_pass_and_crosses_midnight():
    assert sentinel.pass_window("2026-05-14") == "2026-05-14/2026-05-14"
    assert sentinel.pass_window("2026-05-14", "05:42:10") == \
        "2026-05-14T05:22:10Z/2026-05-14T06:02:10Z"
    assert sentinel.pass_window("2026-05-14", "23:50:00") == \
        "2026-05-14T23:30:00Z/2026-05-15T00:10:00Z"
    for bad in ("5:42", "25:00:00", "05:42:10Z"):
        with pytest.raises(ValueError):
            sentinel.pass_window("2026-05-14", bad)


def test_band_frame_reads_the_pass_and_the_water_reads_the_clearest_year(monkeypatch):
    sent = []

    class Answer:
        status_code = 200
        text = ""

        def __init__(self, size):
            out = io.BytesIO()
            Image.new("RGBA", size).save(out, "PNG")
            self.content = out.getvalue()

        def raise_for_status(self):
            return None

    def get(url, params, **kwargs):
        sent.append(params)
        return Answer((int(params["WIDTH"]), int(params["HEIGHT"])))

    box = (0.0, 0.0, 1000.0, 1000.0)
    sentinel.band_frame("inst", box, 8, 8, "2026-05-14", "sar", 100, layer=LAYER, time=TIME, get=get)
    sentinel.band_frame("inst", box, 8, 8, "2026-05-01", "water", 100, get=get)
    radar_request, water_request = sent
    assert radar_request["LAYERS"] == LAYER
    assert radar_request["TIME"] == "2026-05-14T05:22:10Z/2026-05-14T06:02:10Z"
    assert water_request["LAYERS"] == "TRUE_COLOR"
    assert water_request["TIME"] == "2025-05-01/2026-05-01"
    assert water_request["PRIORITY"] == "leastCC"
    script = base64.b64decode(water_request["EVALSCRIPT"]).decode("ascii")
    assert "p.SCL === 6" in script


def _feature(day, time, *, ident=None, ring=None):
    ring = ring or [[3.0, 51.0], [5.0, 51.0], [5.0, 53.0], [3.0, 53.0], [3.0, 51.0]]
    props = {"date": day}
    if time:
        props["time"] = time
    if ident:
        props["id"] = ident
    return {"properties": props, "geometry": {"type": "Polygon", "coordinates": [ring]}}


def test_radar_passes_are_one_entry_per_pass_with_time_and_direction():
    """Sentinel-1 can see a place twice on one day, from opposite directions;
    those are two images, not one day. Slices of one pass are one."""
    asked = {}

    class Answer:
        status_code = 200
        text = ""

        def raise_for_status(self):
            return None

        def json(self):
            return {"features": [
                _feature("2026-05-14", "05:42:10"),
                _feature("2026-05-14", "05:42:35"),   # the next slice of the same pass
                _feature("2026-05-14", "17:33:02"),   # the evening pass, ascending
                # no time field: read from the product name instead
                _feature("2026-05-02", "", ident="S1A_IW_GRDH_1SDV_20260502T054212_20260502T054237_064000_07AB12_1F2E"),
            ]}

    def get(url, params, **kwargs):
        asked.update(params)
        return Answer()

    found = sentinel.dates("inst", 52.0, 4.0, "2026-05-01", "2026-05-31", collection="sentinel1", get=get)
    assert asked["TYPENAMES"] == sentinel.S1_TYPENAME
    assert [(row["date"], row["time"], row["orbit"], row["granules"]) for row in found] == [
        ("2026-05-14", "17:33:02", "ascending", 1),
        ("2026-05-14", "05:42:10", "descending", 2),
        ("2026-05-02", "05:42:12", "descending", 1),
    ]
    assert all(row["cloud"] is None for row in found)


def test_a_radar_lookup_on_an_instance_without_sentinel1_says_so():
    class Answer:
        status_code = 400
        text = "<ServiceExceptionReport>TYPENAME=DSS3 not found!</ServiceExceptionReport>"

    with pytest.raises(ValueError, match="no Sentinel-1 layer"):
        sentinel.dates("inst", 52.0, 4.0, "2026-05-01", "2026-05-31", collection="sentinel1",
                       get=lambda *a, **k: Answer())


def test_a_track_repeats_to_the_minute_and_its_neighbour_is_eight_minutes_off():
    # Over Dover in 2025: relative orbits 132 and 59 pass at 17:49 and 17:41.
    assert sentinel.same_track("17:49:10", "17:48:40")
    assert not sentinel.same_track("17:49:10", "17:41:05")
    assert sentinel.same_track("23:59:30", "00:01:10")      # across midnight
    assert not sentinel.same_track("", "17:49:10")
    # Singapore: 11:25 UTC is dusk there, 22:48 UTC is dawn
    assert sentinel.orbit_direction("11:25:46", 104.0) == "ascending"
    assert sentinel.orbit_direction("22:48:24", 104.0) == "descending"
    assert sentinel.orbit_direction("", 104.0) == ""


def test_the_sentinel1_probe_tells_a_radar_layer_from_an_optical_one():
    class Refused:
        status_code = 400
        text = ("<ServiceExceptionReport><ServiceException>Failed to evaluate script! "
                "Band VV not found</ServiceException></ServiceExceptionReport>")

    answer = sentinel.probe_sar_layer("inst", "TRUE_COLOR", get=lambda *a, **k: Refused())
    assert answer == {"ok": False, "layer": "TRUE_COLOR",
                      "detail": "Failed to evaluate script! Band VV not found"}

    class Rendered:
        status_code = 200
        text = ""

        def __init__(self):
            out = io.BytesIO()
            Image.new("L", (8, 8), 255).save(out, "PNG")
            self.content = out.getvalue()

        def raise_for_status(self):
            return None

    assert sentinel.probe_sar_layer("inst", LAYER, get=lambda *a, **k: Rendered())["ok"]
    with pytest.raises(ValueError):
        sentinel.probe_sar_layer("inst", "../etc", get=lambda *a, **k: Rendered())


# -- detectors ---------------------------------------------------------------------------


def _sea_with(targets, seed=1, sea_vv=-22.0, sea_vh=-28.0):
    vv, vh = speckled(sea_vv, seed), speckled(sea_vh, seed + 1)
    for (x, y, w, h), (target_vv, target_vh) in targets:
        vv[y:y + h, x:x + w] = target_vv
        vh[y:y + h, x:x + w] = target_vh
    product = np.zeros((EDGE, EDGE, 4), np.uint8)
    product[..., 0], product[..., 1], product[..., 3] = level(vv), level(vh), 255
    return product


def test_radar_finds_a_hull_and_not_a_ghost_or_a_sea_spike():
    """A hull answers in both polarisations. A ghost of it, or a spike of sea,
    answers in VV alone: in the Singapore anchorage every hull cleared VH by
    8 dB and those ghosts by 4 to 7."""
    hull = ((300, 300, 8, 3), (5.0, -8.0))
    ghost = ((150, 150, 3, 6), (-8.0, -27.0))
    result = reading("radar-vessels", *(2 * [_sea_with([hull, ghost])]))
    assert found(result) == 1
    ys, xs = np.nonzero(result.binary)
    assert 300 - PAD <= xs.min() and xs.max() < 308 - PAD + 2


def test_a_weak_return_beside_a_much_stronger_one_is_its_ghost():
    strong = ((300, 300, 8, 3), (12.0, 0.0))
    beside = ((300, 330, 3, 3), (0.0, -12.0))      # 200 m off, 12 dB weaker
    far = ((100, 100, 3, 3), (0.0, -12.0))
    result = reading("radar-vessels", *(2 * [_sea_with([strong, beside, far])]))
    assert found(result) == 2


def test_the_sentinel2_water_keeps_dark_desert_from_being_sea():
    """Dry sand is as radar-dark as calm sea in both polarisations. At Port
    Sudan the radar alone put candidates on the town and the desert; Sentinel-2's
    classification says where the water is."""
    desert = _sea_with([((300, 300, 4, 4), (6.0, -6.0))], sea_vv=-19.0, sea_vh=-24.0)
    assert found(reading("radar-vessels", desert, desert)) == 1
    land = water(sentinel.WATER_LAND)
    assert found(reading("radar-vessels", desert, desert, water_frame=land)) == 0
    sea = water(sentinel.WATER_WATER)
    assert found(reading("radar-vessels", desert, desert, water_frame=sea)) == 1


def test_a_storm_sea_is_still_sea():
    """In the October 2023 North Sea storm the sea rose to -11 dB in VV, above
    farmland; cross-pol stayed near -24 dB, which is what still calls it sea."""
    storm = _sea_with([((300, 300, 8, 3), (8.0, -4.0))], sea_vv=-11.0, sea_vh=-24.0)
    assert found(reading("radar-vessels", storm, storm)) == 1


def test_a_sea_quieter_than_the_radar_is_measured_against_its_noise():
    """Off Fujairah on a calm morning, cross-pol read at the product's -35 dB
    floor. Measured against that floor, the faint copy a tanker leaves along the
    track cleared the line as a vessel; measured against the sensor's own noise,
    it does not, and the hull still does."""
    hull = ((300, 300, 8, 3), (10.0, -5.0))
    copy = ((150, 150, 3, 8), (-8.0, -24.0))
    calm = _sea_with([hull, copy], sea_vv=-27.0, sea_vh=-40.0)
    assert (calm[..., 1] == 1).mean() > 0.9      # cross-pol sits on the byte floor
    result = reading("radar-vessels", calm, calm)
    assert found(result) == 1
    ys, xs = np.nonzero(result.binary)
    assert 300 - PAD <= xs.min() and xs.max() < 308 - PAD + 2


def test_radar_change_gates_bright_loss_bright_gain_and_new_water():
    ground = speckled(-10.0, 5), speckled(-16.0, 6)
    town = (slice(200, 240), slice(200, 240))
    field = (slice(350, 400), slice(350, 400))

    def scene(town_db=None, field_db=None):
        vv, vh = ground[0].copy(), ground[1].copy()
        if town_db is not None:
            vv[town] += town_db[0] + 10
            vh[town] += town_db[1] + 16
        if field_db is not None:
            vv[field] += field_db[0] + 10
            vh[field] += field_db[1] + 16
        product = np.zeros((EDGE, EDGE, 4), np.uint8)
        product[..., 0], product[..., 1], product[..., 3] = level(vv), level(vh), 255
        return product

    standing = scene(town_db=(0.0, -8.0))
    razed = scene(town_db=(-10.0, -16.0))
    flooded = scene(town_db=(0.0, -8.0), field_db=(-23.0, -27.0))
    assert found(reading("radar-razed", standing, standing)) == 0
    assert found(reading("radar-razed", standing, razed)) == 1
    assert found(reading("radar-new-objects", razed, standing)) == 1
    assert found(reading("radar-new-objects", standing, razed)) == 0
    assert found(reading("radar-flood", standing, flooded)) == 1
    assert found(reading("radar-flood", standing, razed)) == 0
    result = reading("radar-razed", standing, razed)
    assert result.measures["before"][0].max() > analyzers.BRIGHT_DB


def test_the_radar_change_window_is_ground_not_pixels():
    """A step of smoothing is 45 m of ground, odd in pixels and never under three."""
    assert analyzers.sar_window(2, 7.2) == 13
    assert analyzers.sar_window(2, 9.55) == 9
    assert analyzers.sar_window(3, 7.2) == 19
    assert analyzers.sar_window(1, 9.55) == 5
    assert analyzers.sar_window(0, 40.0) == 3


def test_the_catalogue_says_radar_change_smooths_on_the_ground(client):
    methods = {m["id"]: m for m in client.get("/api/compare/analyzers").json()["methods"]}
    assert methods["sar-change"]["smoothing_m"] == analyzers.SAR_WINDOW_M
    assert methods["surface"]["smoothing_m"] is None


def test_ground_that_did_not_change_stays_quiet_between_two_passes():
    """A radar sample is about 20 m, twice the grid's pixel, so speckle comes in
    pairs of pixels. Averaged over five of them, two passes of fields or a town
    that did not change gave a dozen candidates, as Istanbul, Emilia and Gaza
    before October 2023 did; averaged over 90 m of ground, none."""
    def correlated(mean_db, seed, step=2):
        small = speckled(mean_db, seed, size=EDGE // step + 1)
        return np.kron(small, np.ones((step, step)))[:EDGE, :EDGE]

    def scene(seed, vv_db, vh_db):
        product = np.zeros((EDGE, EDGE, 4), np.uint8)
        product[..., 0], product[..., 1] = level(correlated(vv_db, seed)), level(correlated(vh_db, seed + 100))
        product[..., 3] = 255
        return product

    for vv, vh in ((-10.0, -16.0), (-2.0, -9.0)):
        before, after = scene(1, vv, vh), scene(2, vv, vh)
        for rid in ("radar-change", "radar-razed", "radar-new-objects", "radar-flood"):
            assert found(reading(rid, before, after)) == 0, rid


def test_every_radar_built_in_names_its_method_and_the_old_ones_stay():
    ids = [r.id for r in BUILTINS]
    assert ids[:8] == ["boats", "anomaly", "structures", "impacts", "large-change",
                       "burn-scars", "vegetation-loss", "new-water"]
    assert {r.id: r.method for r in BUILTINS if r.method.startswith("sar")} == {
        "radar-vessels": "sar-vessels", "radar-change": "sar-change", "radar-razed": "sar-change",
        "radar-new-objects": "sar-change", "radar-flood": "sar-change"}


# -- runs ------------------------------------------------------------------------------


@pytest.fixture
def radar_case(client, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    ident = client.post("/api/cases", json={"name": "Radar tests"}).json()["id"]
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})

    def forbidden(*args, **kwargs):
        raise AssertionError("unexpected network")

    monkeypatch.setattr(analyzers.httpx, "stream", forbidden)
    monkeypatch.setattr(analyzers.sentinel, "band_frame", forbidden)
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", forbidden)
    return Case.open(ident)


def _png(pixels):
    out = io.BytesIO()
    Image.fromarray(pixels).save(out, "PNG")
    return out.getvalue()


def _seed(source, product, water_frame=None, tile=SENTINEL_TILE):
    z, x, y = tile
    parsed = Source.model_validate(source)
    picture = np.full((512, 512, 4), 90, np.uint8)
    picture[..., 3] = 255
    tilecache.put(analyzers.picture_cache_id(parsed), z, x, y, _png(picture), "image/png")
    tilecache.put(analyzers.product_cache_id(parsed, "sar"), z, x, y, _png(product), "image/png")
    if water_frame is not None:
        tilecache.put(analyzers.product_cache_id(analyzers.water_source(parsed), "water"),
                      z, x, y, _png(water_frame), "image/png")


def _run(client, case, payload):
    answer = client.post(f"/api/cases/{case.id}/analysis/runs", json=payload)
    assert answer.status_code == 200, answer.text
    workqueue.drain(case)
    return client.get(f"/api/cases/{case.id}/analysis/runs/{answer.json()['id']}").json()


def test_an_offline_radar_sweep_reads_the_pass_it_names_and_keeps_its_water(client, radar_case):
    case = radar_case
    payload = body("radar-vessels").model_dump()
    # the panel builds optical sources; the engine makes them radar ones
    for letter in "ab":
        payload[letter] = {**payload[letter], "provider": "sentinel2", "layer": "TRUE_COLOR", "maxcc": 30}
    sea = _sea_with([((300, 300, 8, 3), (5.0, -8.0))])
    _seed({"provider": "sentinel1", "date": DAY_B, "layer": LAYER, "maxcc": 100, "time": TIME},
          sea, water(sentinel.WATER_WATER))
    saved = _run(client, case, payload)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1
    row = saved["results"][0]
    assert row["sources"]["b"] == {"provider": "sentinel1", "date": DAY_B, "layer": LAYER,
                                   "maxcc": 100, "time": TIME}
    assert "dB" not in row["measure"] and row["measure"]["value"] > 9
    # the water it was judged against is kept beside the picture and the product
    assert sorted(frame["index"] or "picture" for frame in saved["frames"].values()) == [
        "picture", "sar", "water"]
    preview = client.get(f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{row['id']}/preview")
    assert preview.content.startswith(b"\x89PNG")


def test_a_radar_run_without_its_layer_says_where_to_set_it(client, radar_case):
    client.put("/api/settings/prefs", json={"sentinel1_layer": ""})
    saved = _run(client, radar_case, body("radar-vessels").model_dump())
    assert saved["status"] == "failed"
    assert "Sentinel-1 layer in Settings" in saved["message"]


def test_a_typed_day_is_pinned_to_the_pass_on_the_other_sides_track(client, radar_case, monkeypatch):
    asked = []

    def acquisitions(instance, rings, start, end, collection="sentinel2"):
        asked.append((start, end, collection))
        return {"dates": [
            {"date": DAY_B, "time": "17:33:02", "cloud": None, "coverage": 1.0},
            {"date": DAY_B, "time": "05:42:40", "cloud": None, "coverage": 0.6},
            {"date": DAY_A, "time": "05:42:10", "cloud": None, "coverage": 1.0},
        ]}

    monkeypatch.setattr(analyzers.sentinel, "acquisitions", acquisitions)
    client.put("/api/settings/keys", json={"sentinelhub": "test-instance"})
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})
    typed = body("radar-change").model_copy(update={"offline": False})
    typed = typed.model_copy(update={"b": typed.b.model_copy(update={"time": ""})})
    settled = analyzers.resolve_dates(radar_case, typed)
    # the morning pass, though the evening one covers more: it is A's track
    assert settled.b.time == "05:42:40"
    assert asked == [(DAY_B, DAY_B, "sentinel1")]
    with pytest.raises(ValueError, match="different tracks"):
        analyzers.resolve_dates(radar_case, typed.model_copy(
            update={"b": typed.b.model_copy(update={"time": "17:33:02"})}))


def test_an_automatic_radar_pass_stays_on_the_reference_track(client, radar_case, monkeypatch):
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", lambda *a, **k: {"dates": [
        {"date": "2026-06-01", "time": "17:41:00", "cloud": None, "coverage": 1.0},
        {"date": "2026-05-30", "time": "05:42:30", "cloud": None, "coverage": 1.0},
    ]})
    client.put("/api/settings/keys", json={"sentinelhub": "test-instance"})
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})
    routine = body("radar-razed").model_copy(update={"offline": False, "date_rule": "latest_reference"})
    routine = routine.model_copy(update={"b": routine.b.model_copy(update={"date": "", "time": ""})})
    settled = analyzers.resolve_dates(radar_case, routine)
    assert (settled.b.date, settled.b.time) == ("2026-05-30", "05:42:30")
    assert settled.a.time == TIME


def test_optical_sources_dump_as_they_always_did():
    """Frame keys and the repeat notice compare dumps: an optical source must
    not grow a field because radar sources carry a time."""
    optical = Source(date=DAY_B)
    assert "time" not in optical.model_dump()
    assert Source(provider="sentinel1", date=DAY_B, layer=LAYER, time=TIME).model_dump()["time"] == TIME
    old = deepcopy(optical.model_dump())
    assert analyzers._key(Source.model_validate(old), 13, 1, 2, None) == \
        analyzers._key(optical, 13, 1, 2, None)


# -- finding the layer ----------------------------------------------------------------------


def test_finding_the_radar_layer_skips_template_layers_and_keeps_the_first_that_answers(client, monkeypatch):
    from azimut.api import satellite

    client.put("/api/settings/keys", json={"sentinelhub": "test-instance"})
    probed = []
    monkeypatch.setattr(satellite.sentinel, "serves_sentinel1", lambda instance: True)
    monkeypatch.setattr(satellite.sentinel, "capabilities_layers", lambda instance: [
        {"id": "TRUE_COLOR"}, {"id": "SWIR"}, {"id": "MY_NOTES"}, {"id": LAYER}, {"id": "LATER"}])

    def probe(instance, layer):
        probed.append(layer)
        return {"ok": layer == LAYER, "layer": layer, "detail": "reads Sentinel-1 VV and VH"}

    monkeypatch.setattr(satellite.sentinel, "probe_sar_layer", probe)
    before = config.month_usage("sentinelhub")
    answer = client.post("/api/satellite/sentinel1/layer", json={}).json()
    assert answer["ok"] and answer["layer"] == LAYER
    assert probed == ["MY_NOTES", LAYER]
    assert config.month_usage("sentinelhub") == before + 2
    assert client.get("/api/settings").json()["sentinel1_layer"] == LAYER
    # a new instance is another configuration: its radar layer is found again
    client.put("/api/settings/keys", json={"sentinelhub": "other-instance"})
    assert client.get("/api/settings").json()["sentinel1_layer"] == ""


def test_an_instance_without_sentinel1_is_told_before_any_probe(client, monkeypatch):
    from azimut.api import satellite

    client.put("/api/settings/keys", json={"sentinelhub": "test-instance"})
    monkeypatch.setattr(satellite.sentinel, "serves_sentinel1", lambda instance: False)
    monkeypatch.setattr(satellite.sentinel, "probe_sar_layer",
                        lambda *a: pytest.fail("no probe for an instance without Sentinel-1"))
    answer = client.post("/api/satellite/sentinel1/layer", json={}).json()
    assert answer == {"ok": False, "layer": "", "serves": False, "tried": [],
                      "detail": "this instance has no Sentinel-1 layer yet"}
    assert client.post("/api/satellite/sentinel1/layer", json={"layer": "../x"}).status_code == 422


# -- the radar basemap ----------------------------------------------------------------------


def _radar_settings(monkeypatch, tmp_path, layer=LAYER):
    from azimut.engine import tiles

    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "api_keys": {"sentinelhub": "inst-uuid"},
                          "sentinel1_layer": layer})
    return tiles


def test_the_radar_basemap_is_offered_once_its_layer_is_known(monkeypatch, tmp_path):
    tiles = _radar_settings(monkeypatch, tmp_path, layer="")
    assert "sentinel1" not in {p.id for p in tiles.all_providers()}
    tiles = _radar_settings(monkeypatch, tmp_path)
    radar_map = next(p for p in tiles.all_providers() if p.id == "sentinel1")
    assert f"LAYER={LAYER}" in radar_map.url and "inst-uuid" in radar_map.url
    assert "EVALSCRIPT=" in radar_map.url and "TIME=" not in radar_map.url
    # the same quota and the same native ceiling as the optical basemap
    assert (radar_map.meter, radar_map.tile_size, radar_map.max_native_zoom) == ("sentinelhub", 512, 14)


def test_a_radar_variant_draws_one_pass_and_names_it(monkeypatch, tmp_path):
    tiles = _radar_settings(monkeypatch, tmp_path)
    one = tiles.get_provider("sentinel1~2026-05-14~054210")
    assert one.id == "sentinel1~2026-05-14~054210"
    assert "TIME=2026-05-14T05:22:10Z/2026-05-14T06:02:10Z" in one.url
    assert "05:42 UTC" in one.label
    day = tiles.get_provider("sentinel1~2026-05-14")
    assert "TIME=2026-05-14/2026-05-14" in day.url
    for bad in ("sentinel1~2026-05-14~5421", "sentinel1~2026-13-01", "sentinel1~2026-05-14~054210~x",
                "sentinel1~../etc"):
        with pytest.raises(KeyError):
            tiles.get_provider(bad)
    assert sentinel.radar_variant_id("2026-05-14", "05:42:10") == "sentinel1~2026-05-14~054210"
    assert sentinel.radar_variant_id() == "sentinel1"


def test_radar_difference_needs_two_passes_of_one_track(client):
    from azimut.api.compare import change_refusal

    def side(day, time):
        return {"present": True, "provider": "sentinel1", "overlays": [], "radar": {"date": day, "time": time},
                "sentinel": {"layer": "TRUE_COLOR", "date": "", "maxcc": 100}, "wayback_release": None}

    assert change_refusal(side("2026-05-02", "05:42:10"), side("2026-05-14", "05:42:40")) is None
    assert "one track" in change_refusal(side("2026-05-02", "05:42:10"), side("2026-05-14", "17:33:02"))
    assert "two different" in change_refusal(side("2026-05-14", "05:42:10"), side("2026-05-14", "05:42:10"))
    assert "dated" in change_refusal(side("", ""), side("2026-05-14", "05:42:10"))


def test_a_radar_comparison_saves_its_passes(client):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})
    cid = client.post("/api/cases", json={"name": "Radar compare"}).json()["id"]
    side = {"present": True, "provider": "sentinel1", "overlays": [],
            "sentinel": {"layer": "TRUE_COLOR", "date": "", "maxcc": 100}, "wayback_release": None}
    spec = {"version": 2, "camera": {"lat": 51.9, "lon": 4.0, "zoom": 13}, "mode": "side",
            "a": {**side, "radar": {"date": DAY_A, "time": TIME}},
            "b": {**side, "radar": {"date": DAY_B, "time": TIME}}}
    saved = client.post(f"/api/cases/{cid}/compare/sessions", json={"title": "Radar pair", "spec": spec})
    assert saved.status_code == 200, saved.text
    reopened = client.get(f"/api/cases/{cid}/compare/sessions/{saved.json()['name']}").json()
    assert (reopened.get("spec") or reopened)["b"]["radar"] == {"date": DAY_B, "time": TIME}


def test_the_radar_layer_travels_with_the_backup(client):
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})
    bundle = client.get("/api/settings/export").json()
    assert bundle["settings"]["sentinel1_layer"] == LAYER
    client.put("/api/settings/prefs", json={"sentinel1_layer": ""})
    assert client.post("/api/settings/import", json=bundle).status_code == 200
    assert client.get("/api/settings").json()["sentinel1_layer"] == LAYER
    bad = {**bundle, "settings": {**bundle["settings"], "sentinel1_layer": "../x"}}
    assert client.post("/api/settings/import", json=bad).status_code == 422


def test_a_radar_routine_stays_on_the_track_it_has_run_on(client, radar_case, monkeypatch):
    """A place is seen from several tracks. A routine that compares each pass
    with the one before must keep to its own, or every run would jump tracks
    and read the change in angle as change on the ground."""
    case = radar_case
    client.put("/api/settings/keys", json={"sentinelhub": "test-instance"})
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})
    monkeypatch.setattr(analyzers, "previous_pass", lambda case, body: Source(
        provider="sentinel1", date=DAY_B, layer=LAYER, maxcc=100, time="05:42:10"))
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", lambda *a, **k: {"dates": [
        {"date": "2026-05-28", "time": "17:33:02", "cloud": None, "coverage": 1.0},
        {"date": "2026-05-26", "time": "05:42:30", "cloud": None, "coverage": 1.0},
    ]})
    routine = body("radar-razed").model_copy(update={
        "offline": False, "date_rule": "latest_previous", "followup_id": "abcdef123456"})
    routine = routine.model_copy(update={"b": routine.b.model_copy(update={"date": "", "time": ""})})
    settled = analyzers.resolve_dates(case, routine)
    assert (settled.b.date, settled.b.time) == ("2026-05-26", "05:42:30")
    assert settled.a.date == DAY_B


def test_an_optical_run_drops_a_pass_time_left_by_a_radar_analyzer(radar_case):
    leftover = body("radar-change").model_dump()
    leftover["recipe"] = next(r for r in BUILTINS if r.id == "large-change").model_dump()
    leftover["a"] = {**leftover["a"], "provider": "sentinel2", "layer": "TRUE_COLOR"}
    settled = analyzers.resolve_dates(radar_case, RunInput.model_validate(leftover))
    assert settled.a.time == "" and settled.b.provider == "sentinel2"
    assert settled.b.layer == "TRUE_COLOR"


def test_every_built_in_sits_in_one_group_with_a_stated_reliability(client):
    from azimut.engine.analysis_models import GROUPS, RELIABILITY

    grouped = [ident for _, _, members in GROUPS for ident in members]
    assert sorted(grouped) == sorted(r.id for r in BUILTINS)
    assert set(RELIABILITY) == {r.id for r in BUILTINS}
    # a hull answers the radar through cloud and glint alike
    assert (RELIABILITY["radar-vessels"], RELIABILITY["boats"]) == ("reliable", "approximate")
    catalogue = client.get("/api/compare/analyzers").json()
    assert catalogue["copernicus_key"] is False and catalogue["radar_layer"] == ""
    assert catalogue["groups"][0] == {"id": "vessels", "label": "Vessels", "recipes": ["radar-vessels", "boats"]}
    client.put("/api/settings/keys", json={"sentinelhub": "inst"})
    assert client.get("/api/compare/analyzers").json()["copernicus_key"] is True
