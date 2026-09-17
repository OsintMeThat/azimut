"""Synthetic imagery inputs for analyzer and full-case integration gates."""

import io

import numpy as np
from PIL import Image

from azimut import layout
from azimut.engine import analyzers, sentinel, tilecache
from azimut.engine.analysis_models import BUILTINS, PRODUCT_METHODS, RunInput


def sample_input():
    # One complete interior patch, in exactly one native Wayback tile.
    z, x, y = 19, 265056, 182248
    west, north = analyzers.geographic((x + .1) / 2**z, (y + .1) / 2**z)
    east, south = analyzers.geographic((x + .9) / 2**z, (y + .9) / 2**z)
    recipe = BUILTINS[0].model_dump()
    recipe["parameters"].update(min_area=0, cleanup=0, smoothing=0)
    return {"title": "Harbour check", "recipe": recipe,
            "zones": [{"id": "harbour", "name": "Harbour", "kind": "rect",
                       "points": [[west, south], [east, north]]}],
            "a": {"provider": "esri-wayback", "release": 1},
            "b": {"provider": "esri-wayback", "release": 2}, "offline": True}


def seed_images(body):
    for x, y in analyzers.plan(RunInput.model_validate(body)):
        for release in (1, 2):
            pixels = np.full((256, 256, 3), 40, np.uint8)
            if release == 2:
                pixels[90:120, 100:150] = 230
            out = io.BytesIO()
            Image.fromarray(pixels).save(out, "PNG")
            tilecache.put(f"esri-wayback~{release}", 19, x, y, out.getvalue(), "image/png")


# One native Sentinel tile: level 13 of the 512px grid, which is 9.55 m a pixel.
SENTINEL_TILE = (13, 4230, 2930)
SENTINEL_DAY = "2026-05-11"


def sentinel_input(recipe_id, **parameters):
    """A one-tile Copernicus run for a detector that reads bands, not pictures.

    Keeps the preset's own thresholds unless a test says otherwise: they are
    part of what is being tested, and a detector tuned down to catch everything
    would prove nothing about the one it ships with.
    """
    z, x, y = SENTINEL_TILE
    west, north = analyzers.geographic((x + .1) / 2**z, (y + .1) / 2**z)
    east, south = analyzers.geographic((x + .9) / 2**z, (y + .9) / 2**z)
    recipe = next(r for r in BUILTINS if r.id == recipe_id).model_dump()
    recipe["parameters"].update(parameters)
    source = {"provider": "sentinel2", "date": SENTINEL_DAY,
              "layer": "TRUE_COLOR", "maxcc": 30}
    return {"title": f"{recipe_id} sweep", "recipe": recipe,
            "zones": [{"id": "patch", "name": "Patch", "kind": "rect",
                       "points": [[west, south], [east, north]]}],
            "a": dict(source), "b": dict(source), "offline": True}


def seed_sentinel(case, body, bands):
    """Put one picture and one band product where an offline run will find them.

    The product lands under a preserved run's assets, which is the path a
    reopened case takes, and its filename comes from the engine's own key
    function — a copy of that naming here would be a second source of truth
    that silently stops matching.
    """
    z, x, y = SENTINEL_TILE
    parsed = RunInput.model_validate(body)
    picture = io.BytesIO()
    Image.fromarray(np.full((512, 512, 3), 30, np.uint8)).save(picture, "PNG")
    tilecache.put(
        sentinel.variant_id("sentinel2", parsed.b.layer, parsed.b.date,
                            parsed.b.date, parsed.b.maxcc),
        z, x, y, picture.getvalue(), "image/png",
    )
    product = PRODUCT_METHODS[parsed.recipe.method]
    folder = case.subdir(layout.ANALYSIS_DIR) / "runs-seed.assets"
    folder.mkdir(parents=True, exist_ok=True)
    frame = io.BytesIO()
    Image.fromarray(bands, "RGBA").save(frame, "PNG")
    (folder / f"{analyzers._key(parsed.b, z, x, y, product)}.png").write_bytes(frame.getvalue())


def vessel_bands(targets):
    """Near-infrared over a sea that brightens across the tile, plus targets.

    The ramp is the point: a sunlit swell can be brighter than a hull half a
    kilometre away, so an absolute threshold has to be retuned per scene and a
    local one does not. Channels are what the vessel evalscript returns —
    infrared, scene class, NDWI, data mask.
    """
    ramp = np.linspace(10, 130, 512, dtype=np.float32)
    bands = np.zeros((512, 512, 4), np.uint8)
    bands[:, :, 0] = np.broadcast_to(ramp, (512, 512)).astype(np.uint8)
    bands[:, :, 1] = 6        # Sentinel-2 scene class 6 is water
    bands[:, :, 2] = 178      # NDWI ≈ +0.4
    bands[:, :, 3] = 255
    for px, py, width, height in targets:
        bands[py:py + height, px:px + width, 0] = np.clip(
            bands[py:py + height, px:px + width, 0].astype(np.int16) + 100, 0, 255).astype(np.uint8)
        bands[py:py + height, px:px + width, 2] = 64   # a hull is not water
    return bands


def fire_bands(fire, cloud):
    """Short-wave infrared and the two band ratios the fire test reads.

    The cloud patch is the trap: bright in B12 like a fire, but bright in its
    neighbours too, so its ratios sit at one and the test must pass it over.
    """
    bands = np.zeros((512, 512, 4), np.uint8)
    bands[:, :, 0] = 102      # B12 ≈ 0.10 reflectance, under the fire floor
    bands[:, :, 1] = 70       # B12/B11 ≈ 1.1
    bands[:, :, 2] = 51       # B12/B08 ≈ 0.8
    bands[:, :, 3] = 255
    px, py, width, height = cloud
    bands[py:py + height, px:px + width] = [255, 64, 64, 255]   # bright, ratios at one
    px, py, width, height = fire
    bands[py:py + height, px:px + width] = [255, 160, 192, 255]  # bright, ratios well over
    return bands
