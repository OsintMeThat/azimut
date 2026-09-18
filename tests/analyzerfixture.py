"""Synthetic Copernicus inputs for analyzer and full-case integration gates.

Pictures and band products go where an offline run finds them: the tile cache,
under the keys the engine itself computes. Products are built in the byte
layout the evalscripts return (engine/sentinel.py), padded the way the engine
asks for them, so a test that passes here reads what a real sweep reads.
"""

import io

import numpy as np
from PIL import Image

from azimut.engine import analyzers, sentinel, tilecache
from azimut.engine.analysis_models import BUILTINS, RunInput, Source, product_for

# One native Sentinel tile: level 13 of the 512px grid, 6.5 m a pixel at this latitude.
SENTINEL_TILE = (13, 4230, 2930)
DAY_A = "2026-05-04"
DAY_B = "2026-05-11"
PAD = analyzers.PAD
EDGE = 512 + 2 * PAD
# Scene classes and the dark flag, as the fourth channel carries them.
VEGETATION, BARE, WATER, UNSURE, CLOUD, SHADOW = 4, 5, 6, 7, 9, 3
DARK = sentinel.DARK_FLAG


def zone(x0=.1, y0=.1, x1=.9, y1=.9, tile=SENTINEL_TILE, ident="patch"):
    z, x, y = tile
    west, north = analyzers.geographic((x + x0) / 2**z, (y + y0) / 2**z)
    east, south = analyzers.geographic((x + x1) / 2**z, (y + y1) / 2**z)
    return {"id": ident, "name": "Patch", "kind": "rect", "points": [[west, south], [east, north]]}


def sentinel_input(recipe_id, **parameters):
    """A one-tile Copernicus run for a built-in analyzer.

    Keeps the preset's own thresholds unless a test says otherwise: they are
    part of what is being tested, and a detector tuned down to catch everything
    would prove nothing about the one it ships with.
    """
    recipe = next(r for r in BUILTINS if r.id == recipe_id).model_dump()
    recipe["parameters"].update(parameters)
    return {"title": f"{recipe_id} sweep", "recipe": recipe, "zones": [zone()],
            "a": {"provider": "sentinel2", "date": DAY_A, "layer": "TRUE_COLOR", "maxcc": 30},
            "b": {"provider": "sentinel2", "date": DAY_B, "layer": "TRUE_COLOR", "maxcc": 30},
            "offline": True}


def _png(pixels):
    out = io.BytesIO()
    Image.fromarray(pixels).save(out, "PNG")
    return out.getvalue()


def put_picture(source, tile=SENTINEL_TILE, shade=40):
    parsed = Source.model_validate(source)
    z, x, y = tile
    tilecache.put(sentinel.variant_id("sentinel2", parsed.layer, parsed.date, parsed.date,
                                      parsed.maxcc),
                  z, x, y, _png(np.full((512, 512, 3), shade, np.uint8)), "image/png")


def put_product(body, letter, bands, tile=SENTINEL_TILE):
    parsed = RunInput.model_validate(body)
    source = parsed.a if letter == "a" else parsed.b
    product = product_for(parsed.recipe.method, parsed.recipe.parameters.index)
    z, x, y = tile
    tilecache.put(analyzers.product_cache_id(source, product), z, x, y, _png(bands), "image/png")


def seed(body, before=None, after=None, tile=SENTINEL_TILE):
    """Pictures for both dates, and whichever products the test built."""
    for letter, bands in (("a", before), ("b", after)):
        put_picture(body[letter], tile)
        if bands is not None:
            put_product(body, letter, bands, tile)


def at(px, py, width, height):
    """A core rectangle as a slice of a padded product."""
    return slice(PAD + py, PAD + py + height), slice(PAD + px, PAD + px + width)


def surface(red=0.10, nir=0.30, swir=0.20, sky=VEGETATION):
    """Red, near and short-wave infrared over the whole padded frame."""
    bands = np.zeros((EDGE, EDGE, 4), np.uint8)
    bands[:, :] = code(red, nir, swir, sky)
    return bands


def code(red, nir, swir, sky=VEGETATION):
    """One pixel as the surface evalscript writes it, saturation included."""
    def byte(value, gain, floor=0):
        return max(floor, min(255, round(value * 255 * gain)))

    return [byte(red, sentinel.BAND_GAIN, 1), byte(nir, sentinel.BAND_GAIN),
            byte(swir, sentinel.SWIR_GAIN), sky + (DARK if nir < 0.15 else 0)]


def index_frame(value, sky=VEGETATION):
    bands = np.zeros((EDGE, EDGE, 4), np.uint8)
    bands[:, :] = [index_byte(value), 0, 0, sky]
    return bands


def index_byte(value):
    return max(1, round((value + 1) * 127.5))


def sample_input():
    """Any surface change, sized so a single bright patch is one candidate."""
    return sentinel_input("large-change", min_area=0, max_area=0, cleanup=0, smoothing=0,
                          merge_metres=0)


def seed_images(body, tile=SENTINEL_TILE, changed=True):
    before = surface()
    after = surface()
    if changed:
        after[at(100, 90, 50, 30)] = code(0.30, 0.35, 0.40)   # new bare ground
    seed(body, before, after, tile)


def sea(rng_seed=3):
    """Open water under a little glint: a ramp of infrared, a whisper of noise."""
    rng = np.random.default_rng(rng_seed)
    ramp = np.linspace(0.02, 0.10, EDGE, dtype=np.float32)
    nir = np.broadcast_to(ramp, (EDGE, EDGE)) + rng.normal(0, 0.002, (EDGE, EDGE))
    bands = np.zeros((EDGE, EDGE, 4), np.uint8)
    bands[:, :, 0] = np.clip(np.round(nir * 255 * sentinel.BAND_GAIN), 1, 255)
    bands[:, :, 1] = np.clip(np.round((0.01 + rng.normal(0, 0.002, (EDGE, EDGE)))
                                      * 255 * sentinel.BAND_GAIN), 0, 255)
    bands[:, :, 2] = 178   # NDWI ≈ +0.4
    bands[:, :, 3] = WATER + DARK
    return bands


def glinted_sea(rng_seed=3):
    """Sea under sun glint, as the Bab-el-Mandeb read on 2026-09-16.

    Glint adds the same reflectance to every band, so near and short-wave
    infrared sit near 0.08 and NDWI collapses onto zero. The classification
    still calls all of it water.
    """
    rng = np.random.default_rng(rng_seed)
    bands = np.zeros((EDGE, EDGE, 4), np.uint8)
    bands[:, :, 0] = np.clip(np.round((0.075 + rng.normal(0, 0.004, (EDGE, EDGE)))
                                      * 255 * sentinel.BAND_GAIN), 1, 255)
    bands[:, :, 1] = np.clip(np.round((0.086 + rng.normal(0, 0.004, (EDGE, EDGE)))
                                      * 255 * sentinel.BAND_GAIN), 0, 255)
    bands[:, :, 2] = rng.integers(118, 134, (EDGE, EDGE), dtype=np.uint8)   # NDWI ≈ 0
    bands[:, :, 3] = WATER
    return bands


def hull(bands, px, py, width, height, swir=True):
    """A target on the sea. Without short-wave infrared it is a breaking wave."""
    region = bands[at(px, py, width, height)]
    region[:, :, 0] = np.clip(region[:, :, 0].astype(int) + 100, 0, 255)
    if swir:
        region[:, :, 1] = np.clip(region[:, :, 1].astype(int) + 90, 0, 255)
    region[:, :, 2] = 64   # a hull is not water
    region[:, :, 3] = BARE


def fire_frame():
    """B12, its ratios to B11 and B8A, and the sky, over quiet ground."""
    bands = np.zeros((EDGE, EDGE, 4), np.uint8)
    bands[:, :] = [round(0.10 * 255 * sentinel.BAND_GAIN), 70, 51, BARE]   # ratios 1.1 and 0.8
    return bands


def flame(bands, px, py, width, height, b12=0.5, ratio=2.5):
    bands[at(px, py, width, height)] = [min(255, round(b12 * 255 * sentinel.BAND_GAIN)),
                                        round(ratio * sentinel.RATIO_GAIN),
                                        round(ratio * sentinel.RATIO_GAIN), BARE]
