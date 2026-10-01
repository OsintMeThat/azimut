"""Analyzers of your own rules: the model, the band product, the evaluation,
the sweep that runs it and the preview that tunes it.

Scenes are built band by band in reflectance and written in the 16-bit layout
the band evalscript returns (engine/sentinel.py), padded as the engine reads
them, so what passes here is what a real frame would give.
"""

import base64
import io

import cv2
import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

from azimut import config
from azimut.engine import analysis_examples, analysis_geometry, analyzers, detect_rules, sentinel, tilecache, workqueue
from azimut.engine.analysis_models import (
    BUILTINS,
    MAX_BANDS,
    MAX_CHECKS,
    MAX_MARKS,
    Check,
    Parameters,
    Recipe,
    Rule,
    RunInput,
    frames_for,
    is_radar,
    is_single,
    recipe_products,
    stored,
)
from azimut.workspace import Case
from analyzerfixture import BARE, CLOUD, DARK, EDGE, SENTINEL_TILE, UNSURE, VEGETATION, WATER, at, put_picture, zone
from test_radar_detect import LAYER, TIME, level

DAY_A, DAY_B = "2026-05-04", "2026-05-11"
LAT = 20.0


@pytest.fixture(autouse=True)
def forget_decoded():
    """Each test starts with no frame decoded: the cache it seeds is its own."""
    detect_rules._DECODED.clear()
    yield
    detect_rules._DECODED.clear()

# Green cover in every Sentinel-2 band, as a crop field reads in May.
GREEN = {"B01": 0.04, "B02": 0.04, "B03": 0.07, "B04": 0.04, "B05": 0.10, "B06": 0.28,
         "B07": 0.33, "B08": 0.38, "B8A": 0.39, "B09": 0.12, "B11": 0.20, "B12": 0.10}
# The same ground cleared to bare soil.
SOIL = {"B02": 0.12, "B03": 0.15, "B04": 0.19, "B08": 0.24, "B8A": 0.25, "B11": 0.32, "B12": 0.26}


def scene(sky=VEGETATION, **bands):
    values = {**GREEN, **bands}
    frame = {band: np.full((EDGE, EDGE), value, np.float32) for band, value in values.items()}
    frame["SCL"] = np.full((EDGE, EDGE), sky, np.uint16)
    return frame


def paint(frame, px, py, width, height, sky=None, **bands):
    for band, value in bands.items():
        frame[band][at(px, py, width, height)] = value
    if sky is not None:
        frame["SCL"][at(px, py, width, height)] = sky
    return frame


def product(frame, name):
    """A frame as `_bands_evalscript` writes it."""
    out = np.zeros((EDGE, EDGE, 4), np.uint16)
    for channel, band in enumerate(sentinel.product_bands(name)):
        out[..., channel] = np.clip(np.round(frame[band] * sentinel.BANDS_SCALE), 1 if channel == 0 else 0, 65535)
    out[..., 3] = frame["SCL"] + np.where(frame["B08"] < sentinel.DARK_REFLECTANCE, DARK, 0)
    return out


def png16(pixels):
    ok, encoded = cv2.imencode(".png", np.ascontiguousarray(pixels[..., [2, 1, 0, 3]]))
    assert ok
    return encoded.tobytes()


def recipe(*rules, **fields):
    parameters = {"min_area": 0, "max_area": 0, "cleanup": 0, "smoothing": 0, "merge_metres": 0,
                  **fields.pop("parameters", {})}
    fields.setdefault("name", "Mine")
    return Recipe(method="rules", rules=[Rule(**rule) for rule in rules],
                  parameters=Parameters(**parameters), **fields)


def evaluate(built, before, after, mask=None):
    products = {name: (product(before, name), product(after, name)) for name in recipe_products(built)}
    return detect_rules.evaluate(products, np.ones((512, 512), np.uint8) if mask is None else mask,
                                 built, (DAY_A, DAY_B), LAT)


def labels(binary):
    return cv2.connectedComponents(binary.astype(np.uint8), connectivity=8)[0] - 1


LOSS = {"measure": "index", "index": "ndvi", "on": "change", "op": "le", "value": -0.2}
GREEN_BEFORE = {"measure": "index", "index": "ndvi", "on": "a", "op": "ge", "value": 0.5}


# -- the model -------------------------------------------------------------------------


@pytest.mark.parametrize("rule, reason", [
    ({"measure": "class", "classes": ["water"], "on": "b", "op": "ge"}, "is or is not"),
    ({"measure": "class", "classes": ["water"], "on": "change", "op": "is"}, "one date"),
    ({"measure": "class", "classes": [], "on": "b", "op": "is"}, "at least one"),
    ({"measure": "index", "on": "b", "op": "is"}, "ground classes"),
    ({"measure": "index", "on": "b", "op": "moved", "value": 0.1}, "compares two dates"),
    ({"measure": "colour", "on": "b", "op": "ge"}, "compares two dates"),
    ({"measure": "index", "on": "b", "op": "between", "value": 0.3, "upper": 0.2}, "upper bound"),
    ({"measure": "nd", "bands": ["B08", "B08"], "on": "b"}, "two different bands"),
    ({"measure": "band", "band": "B10", "on": "b"}, None),
    ({"measure": "index", "on": "b", "around": 301}, None),
])
def test_a_rule_that_says_nothing_coherent_is_refused(rule, reason):
    with pytest.raises(ValidationError, match=reason):
        Rule(**rule)


def test_only_an_analyzer_of_your_own_carries_rules_and_it_needs_one():
    with pytest.raises(ValidationError, match="only an analyzer of your own"):
        Recipe(name="x", method="surface", rules=[Rule(**LOSS)])
    with pytest.raises(ValidationError, match="at least one rule"):
        Recipe(name="x", method="rules")
    with pytest.raises(ValidationError):
        Recipe(name="x", method="rules", rules=[Rule(**LOSS)] * 7)
    radar = {"measure": "radar", "on": "change", "op": "le", "value": -3}
    with pytest.raises(ValidationError, match="two satellites"):
        Recipe(name="x", method="rules", rules=[Rule(**LOSS), Rule(**radar)])
    with pytest.raises(ValidationError, match="ground classes come from Sentinel-2"):
        Recipe(name="x", method="rules", rules=[Rule(**radar), Rule(measure="class", classes=["water"], op="is")])
    many = [Rule(measure="nd", bands=pair, on="b") for pair in
            (("B01", "B02"), ("B03", "B04"), ("B05", "B06"), ("B07", "B08"))]
    assert len({band for rule in many for band in rule.bands_read()}) > MAX_BANDS
    with pytest.raises(ValidationError, match="at most"):
        Recipe(name="x", method="rules", rules=many)
    # built-ins keep saying what they always said
    assert all(not r.rules and r.match == "all" and r.parameters.shape == "any" for r in BUILTINS)


def test_an_analyzer_declares_what_it_reads_and_its_rules_have_to_agree():
    change = recipe(LOSS, GREEN_BEFORE)
    assert (change.sensor, change.dates) == ("sentinel2", "two")
    spot = recipe({"measure": "band", "band": "B12", "on": "b", "op": "ge", "value": 0.3})
    assert (spot.sensor, spot.dates) == ("sentinel2", "one")
    radar = recipe({"measure": "radar", "on": "change", "op": "moved", "value": 3})
    assert (radar.sensor, radar.dates) == ("sentinel1", "two")
    # said out loud, it is kept as said: a rule may not contradict it
    assert recipe(LOSS, sensor="sentinel2", dates="two").dates == "two"
    with pytest.raises(ValidationError, match="Sentinel-2 one optical rules"):
        recipe(LOSS, sensor="sentinel1")
    with pytest.raises(ValidationError, match="radar analyzer reads radar rules"):
        recipe({"measure": "radar", "on": "change", "op": "moved", "value": 3}, sensor="sentinel2")
    with pytest.raises(ValidationError, match="one date reads the pass itself"):
        recipe(LOSS, dates="one")
    with pytest.raises(ValidationError, match="two dates needs a rule"):
        recipe({"measure": "band", "band": "B12", "on": "b", "op": "ge", "value": 0.3}, dates="two")
    # only the rules declare it: a calibrated method says what it reads in `METHODS`
    assert "sensor" not in BUILTINS[0].model_dump() and "dates" not in BUILTINS[0].model_dump()
    with pytest.raises(ValidationError, match="only an analyzer of your own"):
        Recipe(name="x", method="surface", sensor="sentinel2")
    assert change.model_dump()["sensor"] == "sentinel2" and change.model_dump()["dates"] == "two"


def test_an_analyzer_saved_before_it_declared_what_it_reads_gets_it_from_its_rules_once():
    raw = recipe(LOSS, GREEN_BEFORE).model_dump()
    del raw["sensor"], raw["dates"]
    raw["checks"] = [{"id": "old", "name": "Old", "b": {"date": DAY_B}, "marks": [],
                      "bounds": {"west": 0, "south": 0, "east": 1, "north": 1}}]
    loaded = stored(Recipe, raw)
    assert (loaded.sensor, loaded.dates) == ("sentinel2", "two")
    assert [check.id for check in loaded.checks] == ["old"]          # its frame is gone, the check is not
    # and it is asked the same thing whether it comes from a file or from a request
    assert loaded.model_dump() == Recipe.model_validate({**raw, "checks": []}).model_copy(
        update={"checks": loaded.checks}).model_dump()


def test_a_run_saved_with_an_older_analyzer_still_reads():
    """Runs and routines keep the analyzer they ran with: one saved before an analyzer declared what
    it reads, or before a check lost its frame, is history and must still open."""
    older = recipe(LOSS, GREEN_BEFORE).model_dump()
    del older["sensor"], older["dates"]
    older["checks"] = [{"id": "old", "name": "Old", "b": {"date": DAY_B}, "marks": [],
                        "bounds": {"west": 0, "south": 0, "east": 1, "north": 1}}]
    body = {**sweep_body(recipe(LOSS, GREEN_BEFORE)), "recipe": older}
    run = stored(RunInput, body)
    assert (run.recipe.sensor, run.recipe.dates) == ("sentinel2", "two")
    assert [check.id for check in run.recipe.checks] == ["old"]
    assert is_single(older) is False and is_radar(older) is False          # the dictionaries it is saved as
    # a request that still names the dropped field is a caller's mistake, and is refused
    with pytest.raises(ValidationError):
        RunInput.model_validate(body)


def test_what_a_recipe_reads_follows_from_its_rules():
    change = recipe(LOSS, GREEN_BEFORE)
    assert not is_single(change) and not is_radar(change)
    assert recipe_products(change) == ["bands-B04-B08"]
    assert frames_for(change) == 4           # picture and one product, on each date
    present = recipe({"measure": "band", "band": "B12", "on": "b", "op": "ge", "value": 0.3},
                     {"measure": "index", "index": "bsi", "on": "b", "op": "ge", "value": 0})
    assert is_single(present)
    assert recipe_products(present) == ["bands-B02-B04-B08", "bands-B11-B12"]
    assert frames_for(present) == 3          # one date: its picture and two products
    classes = recipe({"measure": "class", "classes": ["water"], "on": "b", "op": "is"})
    assert recipe_products(classes) == ["bands-B08"]
    radar = recipe({"measure": "radar", "polarisation": "ratio", "on": "change", "op": "moved", "value": 3})
    assert is_radar(radar) and recipe_products(radar) == ["sar"]
    # stored runs are dictionaries: the same answers, from the saved shape
    assert is_single(present.model_dump()) and is_radar(radar.model_dump())


# -- the band product -------------------------------------------------------------------


def test_a_band_product_names_known_bands_in_the_collections_order_and_nothing_else():
    assert sentinel.band_product(["B11", "B04"]) == "bands-B04-B11"
    assert sentinel.product_bands("bands-B04-B11") == ("B04", "B11")
    for bad in ("bands-B11-B04", "bands-B10", "bands-B04-B04", "bands-B02-B03-B04-B08",
                "bands-B04;alert(1)", "bands-", "bands-b04"):
        assert sentinel.product_bands(bad) == ()
        assert not sentinel.is_product(bad)
    with pytest.raises(ValueError):
        sentinel.band_product(["B04", "B02", "B03", "B08"])
    script = base64.b64decode(sentinel._evalscript("bands-B02-B04-B08")).decode("ascii")
    assert 'sampleType: "UINT16"' in script
    assert '"B02", "B04", "B08", "SCL", "dataMask"' in script
    assert f"* {sentinel.BANDS_SCALE}" in script
    with pytest.raises(ValueError, match="unknown band product"):
        sentinel.band_frame("inst", (0, 0, 10, 10), 8, 8, DAY_B, "bands-B10")


def test_a_sixteen_bit_frame_decodes_without_losing_its_precision():
    frame = scene()
    frame["B04"][:] = 0.0123
    raw = png16(product(frame, "bands-B04-B08"))
    with Image.open(io.BytesIO(raw)) as image:
        assert image.format == "PNG"          # what band_frame checks on arrival
    pixels = analyzers.decode_product(raw, EDGE, "bands-B04-B08")
    assert pixels.dtype == np.uint16
    assert pixels[0, 0, 0] == 123 and pixels[0, 0, 1] == 3800
    with pytest.raises(ValueError):
        analyzers.decode_product(raw, EDGE - 1, "bands-B04-B08")


# -- the evaluation ---------------------------------------------------------------------


def test_a_loss_on_ground_that_was_green_is_found_and_ranked_by_its_first_test():
    before = scene()
    after = paint(scene(), 100, 100, 40, 30, sky=BARE, **SOIL)
    paint(before, 300, 300, 30, 30, B04=0.12, B08=0.20)    # already bare in May
    paint(after, 300, 300, 30, 30, B04=0.20, B08=0.20)     # and barer since
    evaluation = evaluate(recipe(LOSS, GREEN_BEFORE), before, after)
    binary = evaluation.reading.binary
    assert labels(binary) == 1
    assert binary[110, 110] and not binary[310, 310]
    # the second rule is what spared the patch that was never green
    assert evaluation.passes[0][310, 310] and not evaluation.passes[1][310, 310]
    stat = evaluation.reading.stat
    # NDVI 0.81 → 0.12 is 0.69 past a 0.2 line: nearly five units, Strong
    assert stat[110, 110] > 3
    assert evaluation.reading.measures["before"][0][110, 110] == pytest.approx(0.81, abs=0.01)
    assert evaluation.reading.measures["signed"][0][110, 110] == pytest.approx(-0.69, abs=0.01)


def test_any_keeps_what_one_rule_alone_would_keep():
    before, after = scene(), scene()
    paint(after, 50, 50, 20, 20, B04=0.20, B08=0.24)                     # lost its green
    paint(after, 300, 300, 20, 20, B11=0.45, B12=0.40)                   # got hot and bright
    hot = {"measure": "band", "band": "B12", "on": "b", "op": "ge", "value": 0.3}
    assert labels(evaluate(recipe(LOSS, hot), before, after).reading.binary) == 0
    assert labels(evaluate(recipe(LOSS, hot, match="any"), before, after).reading.binary) == 2


def test_a_ground_class_rule_reads_the_scene_classification_of_its_date():
    before, after = scene(), scene()
    paint(after, 60, 60, 30, 30, sky=WATER, B08=0.02, B04=0.03)
    flooded = recipe({"measure": "class", "classes": ["water"], "on": "b", "op": "is"},
                     {"measure": "class", "classes": ["water"], "on": "a", "op": "not"})
    binary = evaluate(flooded, before, after).reading.binary
    assert labels(binary) == 1 and binary[70, 70]


def test_brighter_than_its_surroundings_holds_on_dark_and_bright_ground_alike():
    after = scene()
    after["B08"][:] = np.linspace(0.05, 0.45, EDGE, dtype=np.float32)   # dark sea to bright sand
    for px in (60, 440):
        region = after["B08"][at(px, 200, 4, 4)]
        region += 0.10                                                  # a small thing on each
    standing = recipe({"measure": "band", "band": "B08", "on": "b", "op": "ge", "value": 0.08, "around": 150})
    assert is_single(standing)
    binary = evaluate(standing, after, after).reading.binary
    assert binary[201, 61] and binary[201, 441]
    assert labels(binary) == 2      # the gradient itself stands out nowhere
    absolute = recipe({"measure": "band", "band": "B08", "on": "b", "op": "ge", "value": 0.3})
    found = evaluate(absolute, after, after).reading.binary
    assert not found[201, 61] and found[300, 400]      # one line cannot hold both


def test_a_colour_change_is_distance_in_the_visible_bands_and_ignores_light():
    before = scene()
    after = scene(B02=0.06, B03=0.09, B04=0.06)            # the whole scene 2% lighter
    paint(after, 200, 200, 20, 20, B02=0.20, B03=0.21, B04=0.22)   # a new roof
    moved = recipe({"measure": "colour", "on": "change", "op": "ge", "value": 0.05})
    binary = evaluate(moved, before, after).reading.binary
    assert labels(binary) == 1 and binary[210, 210]


def test_between_keeps_a_band_of_values():
    after = scene()
    paint(after, 20, 20, 10, 10, B04=0.10, B08=0.20)     # NDVI 0.33
    paint(after, 200, 20, 10, 10, B04=0.30, B08=0.31)    # NDVI 0.02
    middle = recipe({"measure": "index", "index": "ndvi", "on": "b", "op": "between", "value": 0.2, "upper": 0.5})
    binary = evaluate(middle, after, after).reading.binary
    assert binary[25, 25] and not binary[25, 205] and not binary[300, 300]


def test_a_change_under_cloud_on_either_date_is_not_measured():
    before = paint(scene(), 100, 100, 200, 200, sky=CLOUD)
    after = paint(scene(), 150, 150, 40, 40, sky=BARE, **SOIL)
    evaluation = evaluate(recipe(LOSS), before, after)
    assert not evaluation.reading.binary.any()
    assert not evaluation.measured[160, 160]
    open_sky = recipe(LOSS, parameters={"ignore_clouds": False, "ignore_shadows": False})
    assert evaluate(open_sky, before, after).reading.binary[160, 160]


def test_smoothing_never_spreads_a_reading_into_ground_the_sensor_did_not_see():
    before, after = scene(), scene()
    paint(after, 100, 100, 30, 30, B04=0.20, B08=0.24)
    smoothed = recipe(LOSS, parameters={"smoothing": 3})
    mask = np.ones((512, 512), np.uint8)
    mask[:, 120:] = 0                                   # the area stops across the patch
    evaluation = evaluate(smoothed, before, after, mask)
    assert evaluation.reading.binary[110, 110]
    assert not evaluation.reading.binary[:, 120:].any()


def test_radar_rules_average_speckle_as_power_and_read_both_passes():
    rng = np.random.default_rng(4)
    shape = (EDGE, EDGE)

    def pass_(vv, vh):
        frame = np.zeros((EDGE, EDGE, 4), np.uint8)
        frame[..., 0] = level(vv + rng.normal(0, 1.5, shape))
        frame[..., 1] = level(vh + rng.normal(0, 1.5, shape))
        frame[..., 3] = 255
        return frame

    vv_before, vv_after = np.full(shape, -2.0), np.full(shape, -2.0)
    vv_after[at(200, 200, 60, 60)] = -12.0                              # walls gone quiet
    razed = recipe({"measure": "radar", "polarisation": "vv", "on": "change", "op": "le", "value": -6},
                   {"measure": "radar", "polarisation": "vv", "on": "a", "op": "ge", "value": -4})
    products = {"sar": (pass_(vv_before, np.full(shape, -9.0)), pass_(vv_after, np.full(shape, -9.0)))}
    evaluation = detect_rules.evaluate(products, np.ones((512, 512), np.uint8), razed, (DAY_A, DAY_B), LAT)
    binary = evaluation.reading.binary
    assert binary[230, 230]
    assert labels(binary) == 1
    assert evaluation.reading.measures["signed"][0][230, 230] < -8


def test_the_shape_filter_tells_a_track_from_a_roof():
    square = {"type": "Polygon", "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]}
    track = {"type": "Polygon", "coordinates": [[[0, 0], [0.01, 0.0099], [0.0101, 0.01], [0.0001, 0.0001], [0, 0]]]}
    assert analysis_geometry.elongation(square) == pytest.approx(1, abs=0.05)
    assert analysis_geometry.elongation(track) > 10
    row = {"area": 10_000}
    compact = Parameters(shape="compact")
    elongated = Parameters(shape="elongated")
    assert analyzers.keeps({**row, "geometry": square}, compact)
    assert not analyzers.keeps({**row, "geometry": track}, compact)
    assert analyzers.keeps({**row, "geometry": track}, elongated)
    assert not analyzers.keeps({**row, "geometry": square}, elongated)
    assert analyzers.keeps({**row, "geometry": track}, Parameters())


# -- sweeps --------------------------------------------------------------------------------


@pytest.fixture
def offline(client, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    ident = client.post("/api/cases", json={"name": "Rules of my own"}).json()["id"]

    def forbidden(*args, **kwargs):
        raise AssertionError("unexpected network")

    monkeypatch.setattr(analyzers.httpx, "stream", forbidden)
    monkeypatch.setattr(analyzers.sentinel, "band_frame", forbidden)
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", forbidden)
    return Case.open(ident)


def sweep_body(built, maxcc=30):
    source = lambda day: {"provider": "sentinel2", "date": day, "layer": "TRUE_COLOR", "maxcc": maxcc}  # noqa: E731
    return {"title": "My sweep", "recipe": built.model_dump(), "zones": [zone()],
            "a": source(DAY_A), "b": source(DAY_B), "offline": True}


def seed_frames(body, before, after, tile=SENTINEL_TILE, pictures=True):
    parsed = RunInput.model_validate(body)
    z, x, y = tile
    for letter, frame in (("a", before), ("b", after)):
        source = parsed.a if letter == "a" else parsed.b
        if pictures:
            put_picture(body[letter], tile)
        for name in recipe_products(parsed.recipe):
            tilecache.put(analyzers.product_cache_id(source, name), z, x, y, png16(product(frame, name)),
                          "image/png")


def cleared():
    before = scene()
    after = paint(scene(), 150, 150, 40, 30, sky=BARE, **SOIL)
    return before, after


def test_a_sweep_of_your_own_rules_finds_keeps_its_frames_and_says_what_it_read(client, offline):
    case = offline
    body = sweep_body(recipe(LOSS, GREEN_BEFORE))
    seed_frames(body, *cleared())
    started = client.post(f"/api/cases/{case.id}/analysis/runs", json=body)
    assert started.status_code == 200, started.text
    workqueue.drain(case)
    saved = client.get(f"/api/cases/{case.id}/analysis/runs/{started.json()['id']}").json()
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1
    row = saved["results"][0]
    assert row["strength"] == "strong"
    assert row["measure"]["before"] == pytest.approx(0.81, abs=0.01)
    assert row["measure"]["after"] == pytest.approx(0.12, abs=0.01)
    # the 16-bit product is kept as it came, next to the pictures reviewed
    products = [frame for frame in saved["frames"].values() if frame["index"]]
    assert [frame["index"] for frame in products] == ["bands-B04-B08"] * 2
    kept = case.resolve_inside(products[0]["path"]).read_bytes()
    assert cv2.imdecode(np.frombuffer(kept, np.uint8), cv2.IMREAD_UNCHANGED).dtype == np.uint16
    preview = client.get(f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{row['id']}/preview")
    assert preview.content.startswith(b"\x89PNG")
    listed = client.get(f"/api/cases/{case.id}/analysis/runs").json()[0]
    assert listed["method"] == "rules" and listed["single"] is False


def test_rules_on_one_date_run_without_a_reference(client, offline):
    case = offline
    after = paint(scene(), 200, 200, 10, 10, B11=0.45, B12=0.42)
    body = sweep_body(recipe({"measure": "band", "band": "B12", "on": "b", "op": "ge", "value": 0.3}))
    body["a"]["date"] = ""
    seed_frames(body, after, after)
    started = client.post(f"/api/cases/{case.id}/analysis/runs", json=body)
    assert started.status_code == 200, started.text
    workqueue.drain(case)
    saved = client.get(f"/api/cases/{case.id}/analysis/runs/{started.json()['id']}").json()
    assert saved["status"] == "ready" and saved["count"] == 1
    assert {frame["source"]["date"] for frame in saved["frames"].values()} == {DAY_B}


def test_the_shape_filter_applies_to_a_sweep(client, offline):
    case = offline
    before = scene()
    after = scene()
    paint(after, 50, 50, 30, 30, B04=0.20, B08=0.24)              # a cleared plot
    paint(after, 200, 300, 200, 4, B04=0.20, B08=0.24)            # a new track
    for shape, expected in (("compact", (65, 65)), ("elongated", (302, 300))):
        body = sweep_body(recipe(LOSS, parameters={"shape": shape}))
        body["title"] = shape
        seed_frames(body, before, after)
        started = client.post(f"/api/cases/{case.id}/analysis/runs", json=body)
        workqueue.drain(case)
        saved = client.get(f"/api/cases/{case.id}/analysis/runs/{started.json()['id']}").json()
        assert saved["count"] == 1, (shape, saved)
        west, south, east, north = saved["results"][0]["bbox"]
        z, x, y = SENTINEL_TILE
        cx, cy = analyzers.mercator((west + east) / 2, (south + north) / 2)
        pixel = ((cx * 2**z - x) * 512, (cy * 2**z - y) * 512)
        assert pixel == pytest.approx(expected, abs=3), shape


# -- built-ins as rules ----------------------------------------------------------------------


def test_an_index_built_in_opens_as_the_rules_it_applies():
    burn = next(r for r in BUILTINS if r.id == "burn-scars")
    converted = Recipe.model_validate(detect_rules.index_as_rules(burn))
    assert converted.method == "rules" and converted.id == "custom"
    first, *rest = converted.rules
    assert (first.measure, first.index, first.on, first.op, first.value) == ("index", "nbr", "change", "le", -0.27)
    assert [(t.on, t.op) for t in rest] == [("a", "ge"), ("b", "le"), ("b", "le")]
    assert rest[-1].measure == "band" and rest[-1].band == "B08"    # a burn ends dark
    water = Recipe.model_validate(detect_rules.index_as_rules(next(r for r in BUILTINS if r.id == "new-water")))
    assert water.rules[0].op == "ge" and water.rules[0].value == 0.25
    assert detect_rules.index_as_rules(next(r for r in BUILTINS if r.id == "boats")) is None


def test_the_catalogue_offers_the_rules_vocabulary_and_the_convertible_built_ins(client):
    catalogue = client.get("/api/compare/analyzers").json()
    assert catalogue["rules"]["bands"] == list(sentinel.L2A_BANDS)
    assert "water" in catalogue["rules"]["classes"]
    assert catalogue["rules"]["max_check_tiles"] == detect_rules.MAX_CHECK_TILES
    assert set(catalogue["as_rules"]) == {"burn-scars", "vegetation-loss", "new-water"}
    assert any(method["id"] == "rules" and method["rules"] for method in catalogue["methods"])


def test_an_analyzer_of_your_own_is_saved_for_every_case_and_carried_by_the_backup(client):
    built = recipe(LOSS, GREEN_BEFORE, name="Cleared forest")
    saved = client.post("/api/compare/analyzers", json=built.model_dump()).json()
    assert saved["id"].startswith("custom-")
    listed = client.get("/api/compare/analyzers").json()["custom"]
    assert listed[0]["rules"][0]["value"] == -0.2
    exported = client.get("/api/settings/export").json()
    assert "Cleared forest" in str(exported)


# -- checks --------------------------------------------------------------------------------


def pixel_point(px, py, tile=SENTINEL_TILE):
    z, x, y = tile
    return list(analyzers.geographic((x + (px + .5) / 512) / 2**z, (y + (py + .5) / 512) / 2**z))


PLOT = pixel_point(165, 165)          # inside the plot `cleared` clears
STANDING = pixel_point(400, 400)      # green on both dates


def check_body(marks, **extra):
    return {"id": "plot", "name": "The cleared plot", "a": {"date": DAY_A}, "b": {"date": DAY_B},
            "marks": marks, **extra}


def test_a_check_is_its_passes_and_its_marks():
    found = {"point": PLOT, "expect": "found"}
    check = Check.model_validate(check_body([found]))
    assert check.marks[0].expect == "found" and check.result is None
    with pytest.raises(ValidationError, match="dated pass B"):
        Check.model_validate(check_body([], b={"date": ""}))
    with pytest.raises(ValidationError, match="match its marks"):
        Check.model_validate(check_body([found], result={"signature": "abc", "count": 1, "covered": [True, False]}))
    with pytest.raises(ValidationError):
        Check.model_validate(check_body([{"point": [200, 0], "expect": "found"}]))
    with pytest.raises(ValidationError):
        Check.model_validate(check_body([found] * (MAX_MARKS + 1)))
    # a check has no frame of its own: a request naming one is refused, a saved one is read without it
    framed = check_body([found], bounds={"west": 0, "south": 0, "east": 1, "north": 1})
    with pytest.raises(ValidationError):
        Check.model_validate(framed)
    assert not hasattr(stored(Check, framed), "bounds")
    # checks belong to rules of your own, one id each
    with pytest.raises(ValidationError, match="rules, checks"):
        Recipe(name="x", method="surface", checks=[check])
    with pytest.raises(ValidationError, match="unique"):
        recipe(LOSS, checks=[check, check])
    with pytest.raises(ValidationError):
        recipe(LOSS, checks=[check.model_copy(update={"id": f"c{i}"}) for i in range(MAX_CHECKS + 1)])


def test_a_check_reads_the_tiles_under_its_marks_and_beside_a_mark_near_an_edge():
    z, x, y = SENTINEL_TILE
    far = pixel_point(100, 100, (z, x + 2, y))
    marked = Check.model_validate(check_body([{"point": PLOT, "expect": "found"}, {"point": STANDING, "expect": "empty"},
                                              {"point": far, "expect": "empty"}]))
    assert detect_rules.check_tiles(marked) == [(x, y), (x + 2, y)]

    def reads(px, py):
        return detect_rules.check_tiles(Check.model_validate(check_body([{"point": pixel_point(px, py), "expect": "found"}])))

    # the examples keep their marks 64 pixels inside a tile, which reads that tile alone
    assert reads(64, 64) == reads(448, 448) == [(x, y)]
    # nearer an edge the tile across it is read as well, and in a corner the three around it
    assert reads(20, 256) == [(x, y), (x - 1, y)]
    assert reads(256, 500) == [(x, y), (x, y + 1)]
    assert reads(10, 10) == [(x, y), (x - 1, y), (x, y - 1), (x - 1, y - 1)]
    with pytest.raises(ValueError, match="drop a pin"):
        detect_rules.check_tiles(Check.model_validate(check_body([])))


def test_a_check_may_not_reach_more_tiles_than_a_handful():
    z, x, y = SENTINEL_TILE
    wide = [{"point": pixel_point(256, 256, (z, x + 2 * i, y)), "expect": "found"} for i in range(detect_rules.MAX_CHECK_TILES + 1)]
    with pytest.raises(ValueError, match="at most 12"):
        detect_rules.check_tiles(Check.model_validate(check_body(wide)))


def test_a_check_asks_what_testing_it_costs_before_anything_is_fetched(client, offline):
    built = recipe(LOSS, GREEN_BEFORE)
    marks = [{"point": PLOT, "expect": "found"}, {"point": STANDING, "expect": "empty"}]
    body = {"recipe": built.model_dump(), "check": check_body(marks)}
    # one tile, and one product on each date
    assert client.post("/api/compare/analyzers/check/plan", json=body).json() == {"tiles": 1, "missing": 2}
    seed_frames(sweep_body(built, maxcc=100), *cleared(), pictures=False)
    assert client.post("/api/compare/analyzers/check/plan", json=body).json() == {"tiles": 1, "missing": 0}
    # a pin near an edge reads the tile across it too, so it costs twice
    near = check_body([{"point": pixel_point(500, 256), "expect": "found"}])
    assert client.post("/api/compare/analyzers/check/plan", json={**body, "check": near}).json() == {"tiles": 2, "missing": 2}
    # no pin, nothing to read; too many tiles, too much to read
    empty = client.post("/api/compare/analyzers/check/plan", json={**body, "check": check_body([])})
    assert empty.status_code == 422 and "drop a pin" in empty.text
    z, x, y = SENTINEL_TILE
    wide = [{"point": pixel_point(256, 256, (z, x + 2 * i, y)), "expect": "found"} for i in range(13)]
    refused = client.post("/api/compare/analyzers/check/plan", json={**body, "check": check_body(wide)})
    assert refused.status_code == 422 and "at most 12" in refused.text
    builtin = next(r for r in BUILTINS if r.id == "large-change").model_dump()
    assert client.post("/api/compare/analyzers/check/plan", json={**body, "recipe": builtin}).status_code == 422


def test_a_check_reads_the_cache_then_what_it_lacks_and_says_what_came_out_on_each_mark(client, offline, monkeypatch):
    built = recipe(LOSS, GREEN_BEFORE)
    marks = [{"point": PLOT, "expect": "found"}, {"point": STANDING, "expect": "empty"}]
    body = {"recipe": built.model_dump(), "check": check_body(marks)}
    unread = client.post("/api/compare/analyzers/check", json=body)
    assert unread.status_code == 200, unread.text
    assert unread.json() == {"ready": False, "missing": 2}

    before, after = cleared()
    config.update_settings(lambda settings: settings.setdefault("api_keys", {}).update(sentinelhub="inst"))
    asked = []

    def band_frame(instance, box, width, height, day, name, maxcc, *, layer, time=""):
        asked.append((day, name))
        return png16(product(before if day == DAY_A else after, name))

    monkeypatch.setattr(detect_rules.sentinel, "band_frame", band_frame)
    usage = config.month_usage("sentinelhub")
    read = client.post("/api/compare/analyzers/check", json={**body, "read": True}).json()
    assert sorted(asked) == [(DAY_A, "bands-B04-B08"), (DAY_B, "bands-B04-B08")]
    assert config.month_usage("sentinelhub") == usage + 2
    assert read == {"ready": True, "missing": 0, "count": 1, "covered": [True, False]}
    # a stricter line loses the plot, read again from the cache alone
    stricter = {**body, "recipe": recipe({**LOSS, "value": -0.8}, GREEN_BEFORE).model_dump()}
    assert client.post("/api/compare/analyzers/check", json=stricter).json()["covered"] == [False, False]
    # a line so loose it takes the standing forest flags the empty mark
    loose = {**body, "recipe": recipe({**LOSS, "value": 0.5}).model_dump()}
    assert client.post("/api/compare/analyzers/check", json=loose).json()["covered"] == [True, True]
    assert len(asked) == 2
    # a built-in has no checks to try
    builtin = next(r for r in BUILTINS if r.id == "large-change").model_dump()
    assert client.post("/api/compare/analyzers/check", json={**body, "recipe": builtin}).status_code == 422


def test_a_test_hands_back_what_the_map_draws(client, offline):
    built = recipe(LOSS, GREEN_BEFORE, parameters={"merge_metres": 30})
    marks = [{"point": PLOT, "expect": "found"}, {"point": STANDING, "expect": "empty"}]
    seed_frames(sweep_body(built, maxcc=100), *cleared(), pictures=False)
    body = {"recipe": built.model_dump(), "check": check_body(marks)}
    plain = client.post("/api/compare/analyzers/check", json=body).json()
    assert set(plain) == {"ready", "missing", "count", "covered"}          # the list of checks asks for no more
    answer = client.post("/api/compare/analyzers/check", json={**body, "detail": True}).json()
    assert answer["ready"] and answer["count"] == 1 and answer["covered"] == [True, False]
    z, x, y = SENTINEL_TILE
    [tile] = answer["tiles"]
    assert (tile["x"], tile["y"]) == (x, y) and answer["size"] == 512
    assert tile["box"] == detect_rules.tile_box(x, y)
    mask = np.array(Image.open(io.BytesIO(base64.b64decode(tile["mask"]))))
    assert mask.shape == (512, 512)
    assert mask[160, 160] == 0b11000011          # measured, kept, both rules
    assert mask[10, 10] == 0b01000010            # measured, green before, nothing lost
    # both rules passed on the cleared plot; the second on all the green around it
    first, second = answer["rules"]
    assert first["share"] == pytest.approx(1200 / 512**2, rel=0.01)
    assert second["share"] == pytest.approx(1.0, abs=0.01) and second["kept"] == pytest.approx(first["share"], rel=0.01)
    candidate = answer["candidates"][0]
    assert candidate["strength"] == "strong" and "parts" not in candidate
    # what every rule read under each pin, for the line to be set against
    plot, standing = answer["readings"]
    assert plot["kept"] and plot["rules"][0]["passes"] and plot["rules"][0]["before"] == pytest.approx(0.81, abs=0.01)
    assert plot["rules"][0]["value"] == pytest.approx(-0.69, abs=0.01)
    assert not standing["kept"] and not standing["rules"][0]["passes"] and standing["rules"][1]["passes"]
    assert standing["rules"][0]["value"] == pytest.approx(0, abs=0.01)


def test_a_test_says_what_the_pins_would_come_to_without_each_rule(client, offline):
    built = recipe(LOSS, GREEN_BEFORE)
    marks = [{"point": PLOT, "expect": "found"}, {"point": STANDING, "expect": "empty"}]
    seed_frames(sweep_body(built, maxcc=100), *cleared(), pictures=False)
    body = {"recipe": built.model_dump(), "check": check_body(marks)}
    answer = client.post("/api/compare/analyzers/check", json={**body, "detail": True}).json()
    assert answer["covered"] == [True, False]
    # without the loss every green field is flagged, the trap with it; without the green ground nothing changes
    assert answer["without"] == [{"covered": [True, True]}, {"covered": [True, False]}]
    # the list of checks asks for no more than it needs, and one rule has nothing to be left out of
    assert "without" not in client.post("/api/compare/analyzers/check", json=body).json()
    alone = {"recipe": recipe(LOSS).model_dump(), "check": check_body(marks), "detail": True}
    assert "without" not in client.post("/api/compare/analyzers/check", json=alone).json()


def test_a_rule_that_loses_a_pin_shows_in_what_the_pins_would_come_to_without_it(client, offline):
    strict = recipe({**LOSS, "value": -0.9}, GREEN_BEFORE)
    marks = [{"point": PLOT, "expect": "found"}, {"point": STANDING, "expect": "empty"}]
    seed_frames(sweep_body(strict, maxcc=100), *cleared(), pictures=False)
    body = {"recipe": strict.model_dump(), "check": check_body(marks), "detail": True}
    answer = client.post("/api/compare/analyzers/check", json=body).json()
    # the line is past the plot's loss, so the found pin is lost; it is the strict line that loses it
    assert answer["covered"] == [False, False]
    assert answer["without"][0]["covered"] == [True, True]
    assert answer["without"][1]["covered"] == [False, False]


def test_a_rule_left_out_that_would_flag_more_fragments_than_a_run_keeps_flags_everything(client, offline, monkeypatch):
    before, after = scene(), scene()
    paint(after, 150, 150, 40, 30, sky=BARE, **SOIL)                        # the plot, as bare as soil
    for i in range(100):                                                     # a hundred patches that lost less
        paint(after, 20 + (i % 10) * 45, 300 + (i // 10) * 12, 3, 3, sky=BARE, B04=0.12, B08=0.30)
    built = recipe(LOSS, {"measure": "index", "index": "ndvi", "on": "b", "op": "le", "value": 0.12})
    seed_frames(sweep_body(built, maxcc=100), before, after, pictures=False)
    monkeypatch.setattr(analyzers, "MAX_RESULTS", 20)
    marks = [{"point": PLOT, "expect": "found"}, {"point": STANDING, "expect": "empty"}]
    answer = client.post("/api/compare/analyzers/check",
                         json={"recipe": built.model_dump(), "check": check_body(marks), "detail": True}).json()
    assert answer["covered"] == [True, False]
    assert answer["without"][1]["covered"] == [True, True]          # a run would refuse that many pieces
    assert answer["without"][0]["covered"] == [True, False]


def test_what_a_measured_tile_makes_of_some_rules_is_what_a_recipe_of_those_rules_makes_of_it():
    before, after = cleared()
    both = recipe(LOSS, GREEN_BEFORE)
    products = {name: (product(before, name), product(after, name)) for name in recipe_products(both)}
    mask = np.ones((512, 512), np.uint8)
    tile = detect_rules.measure(products, mask, both, (DAY_A, DAY_B), LAT)
    loss_only = evaluate(recipe(LOSS), before, after).reading
    assert (detect_rules.judge(tile, [0]).binary == loss_only.binary).all()
    assert (detect_rules.judge(tile).binary == evaluate(both, before, after).reading.binary).all()
    # under "any" taking one away can only take pixels away
    either = recipe(LOSS, GREEN_BEFORE, match="any")
    tile = detect_rules.measure({name: (product(before, name), product(after, name)) for name in recipe_products(either)},
                                mask, either, (DAY_A, DAY_B), LAT)
    assert detect_rules.judge(tile, [0]).binary.sum() < detect_rules.judge(tile).binary.sum()


def test_a_test_finds_what_a_sweep_of_the_same_tiles_finds(client, offline):
    """The builder's promise: what it shows is what a run returns."""
    case = offline
    built = recipe(LOSS, GREEN_BEFORE, parameters={"merge_metres": 30, "cleanup": 1, "min_area": 3000})
    before, after = cleared()
    paint(after, 400, 60, 6, 6, B04=0.20, B08=0.24)                   # too small to keep
    body = sweep_body(built)
    body["zones"] = [zone(0, 0, 1, 1)]
    seed_frames(body, before, after)
    seed_frames(sweep_body(built, maxcc=100), before, after, pictures=False)
    started = client.post(f"/api/cases/{case.id}/analysis/runs", json=body)
    workqueue.drain(case)
    run = client.get(f"/api/cases/{case.id}/analysis/runs/{started.json()['id']}").json()
    marks = [{"point": PLOT, "expect": "found"}]
    shown = client.post("/api/compare/analyzers/check",
                        json={"recipe": built.model_dump(), "check": check_body(marks), "detail": True}).json()
    assert run["count"] == shown["count"] == 1
    assert run["results"][0]["bbox"] == pytest.approx(shown["candidates"][0]["bbox"])
    assert run["results"][0]["margin"] == shown["candidates"][0]["margin"]


def test_a_candidate_cut_by_a_tile_seam_is_judged_whole_when_the_mark_reads_both_sides(client, offline, monkeypatch):
    z, x, y = SENTINEL_TILE
    east = (z, x + 1, y)
    # a plot that runs across the seam, each half too small to keep and the whole not
    built = recipe(LOSS, GREEN_BEFORE, parameters={"min_area": 120_000})
    left_before, left_after = scene(), paint(scene(), 470, 226, 42, 60, sky=BARE, **SOIL)
    right_before, right_after = scene(), paint(scene(), 0, 226, 30, 60, sky=BARE, **SOIL)
    body = sweep_body(recipe(LOSS, GREEN_BEFORE), maxcc=100)
    seed_frames(body, left_before, left_after, pictures=False)
    seed_frames(body, right_before, right_after, tile=east, pictures=False)
    near = check_body([{"point": pixel_point(490, 256), "expect": "found"}])
    request = {"recipe": built.model_dump(), "check": near, "detail": True}
    whole = client.post("/api/compare/analyzers/check", json=request).json()
    assert [(tile["x"], tile["y"]) for tile in whole["tiles"]] == [(x, y), (x + 1, y)]
    assert whole["count"] == 1 and whole["covered"] == [True]
    assert whole["candidates"][0]["area"] > 120_000
    # read on its own tile, as a mark nearer the middle is, only its half is left, and too small
    monkeypatch.setattr(detect_rules, "EDGE_PX", 0)
    half = client.post("/api/compare/analyzers/check", json=request).json()
    assert [(tile["x"], tile["y"]) for tile in half["tiles"]] == [(x, y)]
    assert half["count"] == 0 and half["covered"] == [False]


def test_a_point_of_a_tested_check_says_what_every_rule_read_there(client, offline):
    built = recipe(LOSS, GREEN_BEFORE)
    body = {"recipe": built.model_dump(), "check": check_body([{"point": PLOT, "expect": "found"}]), "point": PLOT}
    assert client.post("/api/compare/analyzers/probe", json=body).json() == {"ready": False}
    seed_frames(sweep_body(built, maxcc=100), *cleared(), pictures=False)
    probed = client.post("/api/compare/analyzers/probe", json=body).json()
    assert probed["ready"] and probed["measured"] and probed["kept"]
    loss, green = probed["rules"]
    assert loss["passes"] and loss["before"] == pytest.approx(0.81, abs=0.01)
    assert loss["value"] == pytest.approx(-0.69, abs=0.01)
    assert green["passes"] and green["before"] is None and green["value"] == pytest.approx(0.81, abs=0.01)
    # anywhere outside the tiles the check was read on, nothing is held
    elsewhere = pixel_point(256, 256, (SENTINEL_TILE[0], SENTINEL_TILE[1] + 3, SENTINEL_TILE[2]))
    assert client.post("/api/compare/analyzers/probe", json={**body, "point": elsewhere}).json() == {"ready": False}


def test_a_check_needs_its_passes_and_the_track_they_share(client, offline):
    built = recipe(LOSS)
    body = {"recipe": built.model_dump(), "check": check_body([{"point": PLOT, "expect": "found"}], a={"date": ""})}
    unpaired = client.post("/api/compare/analyzers/check", json=body)
    assert unpaired.status_code == 422 and "before date" in unpaired.text
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})
    radar = recipe({"measure": "radar", "on": "change", "op": "moved", "value": 3})
    source = lambda day, time: {"provider": "sentinel1", "date": day, "time": time}  # noqa: E731
    marks = [{"point": PLOT, "expect": "found"}]
    crossed = check_body(marks, a=source(DAY_A, TIME), b=source(DAY_B, "17:40:00"))
    refused = client.post("/api/compare/analyzers/check/plan", json={"recipe": radar.model_dump(), "check": crossed})
    assert refused.status_code == 422 and "track" in refused.text
    same = check_body(marks, a=source(DAY_A, TIME), b=source(DAY_B, TIME))
    assert client.post("/api/compare/analyzers/check/plan",
                       json={"recipe": radar.model_dump(), "check": same}).json() == {"tiles": 1, "missing": 2}


def test_a_check_saved_on_other_passes_asks_to_be_saved_again(client, offline):
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})
    radar = recipe({"measure": "radar", "on": "change", "op": "moved", "value": 3})
    answer = client.post("/api/compare/analyzers/check",
                         json={"recipe": radar.model_dump(), "check": check_body([{"point": PLOT, "expect": "found"}])})
    assert answer.status_code == 422 and "saved on Sentinel-2 passes" in answer.text


def test_a_mark_is_on_a_footprint_that_covers_it_or_passes_within_reach():
    z, x, y = SENTINEL_TILE
    square = np.zeros((20, 20), bool)
    square[5:15, 5:15] = True
    footprint = analysis_geometry.footprint(square, x, y, z, 512, (100, 100))
    assert analysis_geometry.near(footprint, pixel_point(110, 110), 15)
    assert analysis_geometry.near(footprint, pixel_point(115, 110), 15)       # a pixel off its edge
    assert not analysis_geometry.near(footprint, pixel_point(118, 110), 15)
    holed = square.copy()
    holed[8:12, 8:12] = False
    ring = analysis_geometry.footprint(holed, x, y, z, 512, (100, 100))
    assert not analysis_geometry.near(ring, pixel_point(110, 110), 0)       # the hole is not the footprint


def test_the_examples_are_whole_analyzers_whose_marks_sit_well_inside_their_tiles(client):
    examples = client.get("/api/compare/analyzers").json()["examples"]
    assert [example["id"] for example in examples] == ["burn", "clearing", "drained", "solar", "ships"]
    z = analyzers.GRID[0]
    for example in examples:
        built = Recipe.model_validate(example["recipe"])
        assert built.method == "rules" and built.checks, example["id"]
        assert example["place"] and example["when"]
        expects = {mark.expect for check in built.checks for mark in check.marks}
        assert expects == {"found", "empty"}, example["id"]          # something to find, and a trap
        single = is_single(built)
        tiles = set()
        for check in built.checks:
            assert bool(check.a.date) is not single, (example["id"], check.id)
            if not single:
                assert check.a.date < check.b.date
            assert check.marks, (example["id"], check.id)
            for mark in check.marks:
                gx, gy = analyzers.mercator(*mark.point)
                px, py = (gx * 2**z % 1) * 512, (gy * 2**z % 1) * 512
                assert 64 <= px <= 448 and 64 <= py <= 448, (example["id"], check.id)
            tiles.update(detect_rules.check_tiles(check))
            # well inside, so no mark reads the tile across an edge as well
            assert set(detect_rules.check_tiles(check)) == {detect_rules.pixel_of(mark.point)[:2] for mark in check.marks}
        # running all of an example's checks stays a handful of requests
        assert len(tiles) * len(recipe_products(built)) * (1 if single else 2) <= 16, example["id"]


def test_the_burn_example_keeps_the_surf_out_by_its_near_infrared_not_its_class():
    """Copernicus classed the surf off Lahaina on 8 August 2023 as unclassified,
    not water, so a rule on pass A's scene class let the reef through. The
    values here are the ones read at the reef's mark: water ends near-black in
    near infrared on B, and char does not."""
    burn = next(example for example in analysis_examples.EXAMPLES if example.id == "burn").recipe
    before, after = scene(), scene()
    paint(after, 100, 100, 30, 30, B08=0.12, B12=0.25)                   # the town, charred
    paint(before, 300, 300, 30, 30, sky=UNSURE, B08=0.057, B12=0.057)    # the reef under surf
    paint(after, 300, 300, 30, 30, sky=WATER, B08=0.0016, B12=0.0147)    # and calm since
    binary = evaluate(burn, before, after).reading.binary
    assert binary[115, 115] and not binary[315, 315]


def test_an_example_copied_into_the_library_keeps_its_checks_and_the_backup_carries_them(client):
    example = client.get("/api/compare/analyzers").json()["examples"][0]
    saved = client.post("/api/compare/analyzers", json={**example["recipe"], "id": "custom"}).json()
    assert saved["id"].startswith("custom-") and len(saved["checks"]) == len(example["recipe"]["checks"])
    listed = client.get("/api/compare/analyzers").json()["custom"]
    assert listed[0]["checks"][0]["name"] == example["recipe"]["checks"][0]["name"]
    exported = client.get("/api/settings/export").json()
    assert example["recipe"]["checks"][0]["name"] in str(exported)
