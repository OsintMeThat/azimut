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
from azimut.engine import analysis_geometry, analyzers, detect_rules, sentinel, tilecache, workqueue
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
)
from azimut.workspace import Case
from analyzerfixture import BARE, CLOUD, DARK, EDGE, SENTINEL_TILE, VEGETATION, WATER, at, put_picture, zone
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


# -- the preview ---------------------------------------------------------------------------


def tile_bounds(tile=SENTINEL_TILE, inset=0.2):
    z, x, y = tile
    west, north = analyzers.geographic((x + inset) / 2**z, (y + inset) / 2**z)
    east, south = analyzers.geographic((x + 1 - inset) / 2**z, (y + 1 - inset) / 2**z)
    return {"west": west, "south": south, "east": east, "north": north}


def preview_body(built, **extra):
    return {"recipe": built.model_dump(), "a": {"date": DAY_A}, "b": {"date": DAY_B},
            "bounds": tile_bounds(), **extra}


def test_a_preview_reads_only_the_cache_and_says_what_reading_the_rest_would_cost(client, offline):
    built = recipe(LOSS, GREEN_BEFORE)
    answer = client.post("/api/compare/analyzers/preview", json=preview_body(built))
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["ready"] is False
    assert body["missing"] == 2          # one product on each date, over one tile
    assert body["tiles"] == [list(SENTINEL_TILE[1:])] and body["clipped"] is False


def test_reading_fetches_what_is_missing_meters_it_and_then_previews(client, offline, monkeypatch):
    built = recipe(LOSS, GREEN_BEFORE, parameters={"merge_metres": 30})
    before, after = cleared()
    config.update_settings(lambda settings: settings.setdefault("api_keys", {}).update(sentinelhub="inst"))
    asked = []

    def band_frame(instance, box, width, height, day, name, maxcc, *, layer, time=""):
        asked.append((day, name, maxcc, layer))
        assert (width, height) == (EDGE, EDGE)
        return png16(product(before if day == DAY_A else after, name))

    monkeypatch.setattr(detect_rules.sentinel, "band_frame", band_frame)
    usage = config.month_usage("sentinelhub")
    answer = client.post("/api/compare/analyzers/preview", json=preview_body(built, read=True)).json()
    assert sorted(asked) == [(DAY_A, "bands-B04-B08", 100, "TRUE_COLOR"), (DAY_B, "bands-B04-B08", 100, "TRUE_COLOR")]
    assert config.month_usage("sentinelhub") == usage + 2
    assert answer["ready"] is True and answer["missing"] == 0
    assert answer["count"] == 1
    candidate = answer["candidates"][0]
    assert candidate["strength"] == "strong" and "parts" not in candidate
    # both rules passed on the cleared plot; the second on all the green around it
    first, second = answer["rules"]
    assert first["share"] == pytest.approx(1200 / 512**2, rel=0.01)
    assert second["share"] == pytest.approx(1.0, abs=0.01)
    assert second["kept"] == pytest.approx(first["share"], rel=0.01)
    mask = np.array(Image.open(io.BytesIO(base64.b64decode(answer["mask"]))))
    assert mask.shape == (512, 512)
    assert mask[160, 160] == 0b11000011          # measured, kept, both rules
    assert mask[10, 10] == 0b01000010            # measured, green before, nothing lost
    # moving a slider re-reads the cache and fetches nothing more
    stricter = recipe({**LOSS, "value": -0.8}, GREEN_BEFORE)
    again = client.post("/api/compare/analyzers/preview", json=preview_body(stricter)).json()
    assert again["ready"] and again["count"] == 0 and len(asked) == 2

    point = analyzers.geographic((SENTINEL_TILE[1] + 160.5 / 512) / 2**13, (SENTINEL_TILE[2] + 160.5 / 512) / 2**13)
    probed = client.post("/api/compare/analyzers/probe", json={**preview_body(built), "point": list(point)}).json()
    assert probed["ready"] and probed["measured"] and probed["kept"]
    loss, green = probed["rules"]
    assert loss["passes"] and loss["before"] == pytest.approx(0.81, abs=0.01)
    assert loss["value"] == pytest.approx(-0.69, abs=0.01)
    assert green["passes"] and green["before"] is None and green["value"] == pytest.approx(0.81, abs=0.01)


def test_a_preview_finds_what_a_sweep_of_the_same_tiles_finds(client, offline):
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
    shown = client.post("/api/compare/analyzers/preview", json=preview_body(built)).json()
    assert run["count"] == shown["count"] == 1
    assert run["results"][0]["bbox"] == pytest.approx(shown["candidates"][0]["bbox"])
    assert run["results"][0]["margin"] == shown["candidates"][0]["margin"]


def test_a_wide_view_previews_the_three_tiles_around_its_middle():
    z = analyzers.GRID[0]
    x, y = SENTINEL_TILE[1:]
    west, north = analyzers.geographic((x - 3) / 2**z, (y - 3) / 2**z)
    east, south = analyzers.geographic((x + 4) / 2**z, (y + 4) / 2**z)
    tiles, clipped = detect_rules.preview_tiles((west, south, east, north))
    assert clipped and len(tiles) == 9
    assert (x, y) in tiles
    with pytest.raises(ValueError, match="antimeridian"):
        detect_rules.preview_tiles((179, 0, -179, 1))


def test_a_preview_needs_its_passes_and_refuses_a_built_in(client, offline):
    built = recipe(LOSS)
    missing_a = client.post("/api/compare/analyzers/preview", json={**preview_body(built), "a": {"date": ""}})
    assert missing_a.status_code == 422 and "reference" in missing_a.text
    builtin = next(r for r in BUILTINS if r.id == "large-change").model_dump()
    refused = client.post("/api/compare/analyzers/preview", json={**preview_body(built), "recipe": builtin})
    assert refused.status_code == 422


def test_a_radar_preview_reads_the_users_layer_and_holds_one_track(client, offline):
    client.put("/api/settings/prefs", json={"sentinel1_layer": LAYER})
    radar = recipe({"measure": "radar", "on": "change", "op": "moved", "value": 3})
    body = {**preview_body(radar), "a": {"date": DAY_A, "time": TIME}, "b": {"date": DAY_B, "time": "17:40:00"}}
    crossed = client.post("/api/compare/analyzers/preview", json=body)
    assert crossed.status_code == 422 and "track" in crossed.text
    same = client.post("/api/compare/analyzers/preview",
                       json={**body, "b": {"date": DAY_B, "time": TIME}}).json()
    assert same["missing"] == 2 and same["ready"] is False


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


def test_a_view_half_read_is_judged_where_it_is_held(client, offline):
    """Panning off the frames already read keeps the detections on them live."""
    built = recipe(LOSS, GREEN_BEFORE)
    before, after = cleared()
    seed_frames(sweep_body(built, maxcc=100), before, after, pictures=False)
    z, x, y = SENTINEL_TILE
    west, north = analyzers.geographic((x + 0.5) / 2**z, (y + 0.2) / 2**z)
    east, south = analyzers.geographic((x + 1.5) / 2**z, (y + 0.8) / 2**z)
    body = {**preview_body(built), "bounds": {"west": west, "south": south, "east": east, "north": north}}
    answer = client.post("/api/compare/analyzers/preview", json=body).json()
    assert answer["tiles"] == [[x, y], [x + 1, y]]
    assert answer["ready"] is True and answer["missing"] == 2 and answer["count"] == 1
    mask = np.array(Image.open(io.BytesIO(base64.b64decode(answer["mask"]))))
    assert mask.shape == (512, 1024)
    assert mask[160, 160] & (1 << detect_rules.KEPT_BIT)
    assert not mask[:, 512:].any()        # the unread tile is left blank, not guessed


# -- checks --------------------------------------------------------------------------------


def pixel_point(px, py, tile=SENTINEL_TILE):
    z, x, y = tile
    return list(analyzers.geographic((x + (px + .5) / 512) / 2**z, (y + (py + .5) / 512) / 2**z))


PLOT = pixel_point(165, 165)          # inside the plot `cleared` clears
STANDING = pixel_point(400, 400)      # green on both dates


def check_body(marks, **extra):
    return {"id": "plot", "name": "The cleared plot", "a": {"date": DAY_A}, "b": {"date": DAY_B},
            "bounds": tile_bounds(), "marks": marks, **extra}


def test_a_check_is_a_place_its_passes_and_its_marks():
    found = {"point": PLOT, "expect": "found"}
    check = Check.model_validate(check_body([found]))
    assert check.marks[0].expect == "found" and check.result is None
    with pytest.raises(ValidationError, match="dated pass B"):
        Check.model_validate(check_body([], b={"date": ""}))
    with pytest.raises(ValidationError, match="antimeridian"):
        Check.model_validate(check_body([], bounds={"west": 179, "south": 0, "east": -179, "north": 1}))
    with pytest.raises(ValidationError, match="match its marks"):
        Check.model_validate(check_body([found], result={"signature": "abc", "count": 1, "covered": [True, False]}))
    with pytest.raises(ValidationError):
        Check.model_validate(check_body([{"point": [200, 0], "expect": "found"}]))
    with pytest.raises(ValidationError):
        Check.model_validate(check_body([found] * (MAX_MARKS + 1)))
    # checks belong to rules of your own, one id each
    with pytest.raises(ValidationError, match="rules and checks"):
        Recipe(name="x", method="surface", checks=[check])
    with pytest.raises(ValidationError, match="unique"):
        recipe(LOSS, checks=[check, check])
    with pytest.raises(ValidationError):
        recipe(LOSS, checks=[check.model_copy(update={"id": f"c{i}"}) for i in range(MAX_CHECKS + 1)])


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
    # a built-in has no checks to rerun
    builtin = next(r for r in BUILTINS if r.id == "large-change").model_dump()
    assert client.post("/api/compare/analyzers/check", json={**body, "recipe": builtin}).status_code == 422


def test_a_check_reads_the_tiles_under_its_marks_or_else_its_view():
    z, x, y = SENTINEL_TILE
    far = pixel_point(100, 100, (z, x + 2, y))
    marked = Check.model_validate(check_body([{"point": PLOT, "expect": "found"}, {"point": STANDING, "expect": "empty"},
                                              {"point": far, "expect": "empty"}]))
    assert detect_rules.check_tiles(marked) == [(x, y), (x + 2, y)]
    assert detect_rules.check_tiles(Check.model_validate(check_body([]))) == [(x, y)]


def test_a_check_without_marks_counts_what_its_view_gave(client, offline):
    built = recipe(LOSS, GREEN_BEFORE)
    seed_frames(sweep_body(built, maxcc=100), *cleared(), pictures=False)
    answer = client.post("/api/compare/analyzers/check",
                         json={"recipe": built.model_dump(), "check": check_body([])}).json()
    assert answer == {"ready": True, "missing": 0, "count": 1, "covered": []}


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
            for mark in check.marks:
                west, south, east, north = (check.bounds.west, check.bounds.south, check.bounds.east, check.bounds.north)
                assert west < mark.point[0] < east and south < mark.point[1] < north, (example["id"], check.id)
                gx, gy = analyzers.mercator(*mark.point)
                px, py = (gx * 2**z % 1) * 512, (gy * 2**z % 1) * 512
                assert 64 <= px <= 448 and 64 <= py <= 448, (example["id"], check.id)
            tiles.update(detect_rules.check_tiles(check))
        # running all of an example's checks stays a handful of requests
        assert len(tiles) * len(recipe_products(built)) * (1 if single else 2) <= 16, example["id"]


def test_an_example_copied_into_the_library_keeps_its_checks_and_the_backup_carries_them(client):
    example = client.get("/api/compare/analyzers").json()["examples"][0]
    saved = client.post("/api/compare/analyzers", json={**example["recipe"], "id": "custom"}).json()
    assert saved["id"].startswith("custom-") and len(saved["checks"]) == len(example["recipe"]["checks"])
    listed = client.get("/api/compare/analyzers").json()["custom"]
    assert listed[0]["checks"][0]["name"] == example["recipe"]["checks"][0]["name"]
    exported = client.get("/api/settings/export").json()
    assert example["recipe"]["checks"][0]["name"] in str(exported)
