"""Turn an Earth calibration run into the fixture the parser is tested against.

    python scripts/build_earth_fixture.py /tmp/azimut-earth-calibration [more runs…]

`frontend/calibration/earth.mjs` opens Google Earth at a camera it placed on
the ground, then at the same camera a known step east, a known step north and
at half the distance, and keeps a screenshot of each. This registers those
screenshots against each other and writes `tests/fixtures/earth-scale.json`:

* **how far the picture moved** for each step, in CSS pixels, found by phase
  correlation on the middle of the window (Earth's toolbar, status bar and
  buttons are round the edges and do not move with the map);
* **where Earth draws its camera**, from the half-distance shot. Halving the
  distance draws the ground twice as big about the camera's own pixel, so the
  base shot shrunk by two about the middle of the window only lines up with it
  if that pixel is the middle, and is shifted by half the difference if not.

What it writes is measurement only. Whether the app's parse of each URL
predicts it is `tests/test_mapsites.py`'s question, which is the point: the
formula in `engine/mapsites.py` is checked against pictures, not against a
second copy of itself.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures" / "earth-scale.json"

#: A correlation peak below this is two pictures that do not share enough to say
#: how far apart they are: imagery still arriving, or a label over everything.
MIN_PEAK = 0.2


def _grey(path: Path, shrink_about_middle: float | None = None) -> np.ndarray:
    image = Image.open(path).convert("L")
    if shrink_about_middle:
        w, h = image.size
        k = shrink_about_middle
        # output(x) = input(middle + (x − middle)·k): content shrinks by k about the middle
        image = image.transform(
            image.size,
            Image.Transform.AFFINE,
            (k, 0, w / 2 * (1 - k), 0, k, h / 2 * (1 - k)),
            resample=Image.Resampling.BICUBIC,
        )
    return np.asarray(image, dtype=float)


def _middle(a: np.ndarray) -> np.ndarray:
    h, w = a.shape
    return a[int(h * 0.2) : int(h * 0.8), int(w * 0.2) : int(w * 0.8)]


def _peak_offset(column: np.ndarray, at: int) -> float:
    """Sub-pixel position of a correlation peak, from the parabola through it."""
    n = len(column)
    left, mid, right = column[(at - 1) % n], column[at], column[(at + 1) % n]
    bend = left - 2 * mid + right
    return at + ((left - right) / (2 * bend) if bend else 0.0)


def moved(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    """How far the picture moved from `a` to `b`, in pixels, and how sure."""
    a, b = _middle(a), _middle(b)
    a, b = a - a.mean(), b - b.mean()
    window = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    cross = np.fft.fft2(b * window) * np.conj(np.fft.fft2(a * window))
    cross /= np.abs(cross) + 1e-9
    surface = np.real(np.fft.ifft2(cross))
    iy, ix = np.unravel_index(int(np.argmax(surface)), surface.shape)
    dy = _peak_offset(surface[:, ix], int(iy))
    dx = _peak_offset(surface[iy, :], int(ix))
    if dy > surface.shape[0] / 2:
        dy -= surface.shape[0]
    if dx > surface.shape[1] / 2:
        dx -= surface.shape[1]
    return float(dx), float(dy), float(surface.max())


def build(run: Path, case: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    trouble: list[str] = []
    shot = lambda name, shrink=None: _grey(run / case["shots"][name]["image"], shrink)  # noqa: E731
    base = shot("base")
    east = moved(base, shot("east"))
    north = moved(base, shot("north"))
    # the half-distance shot shrunk back by two: lined up with the base shot
    # when Earth's camera is the middle of the window
    half = moved(base, shot("half", 2.0))
    for name, (_dx, _dy, peak) in (("east", east), ("north", north), ("half", half)):
        if peak < MIN_PEAK:
            trouble.append(f"the {name} shot registered weakly (peak {peak:.2f})")
    return {
        "id": case["id"],
        "window": case["window"],
        "base": case["shots"]["base"]["url"],
        "east": {"d_lon": case["dLon"], "moved_px": round(east[0], 3), "across_px": round(east[1], 3)},
        "north": {"d_lat": case["dLat"], "moved_px": round(north[1], 3), "across_px": round(north[0], 3)},
        # camera pixel minus the middle of the window
        "camera_offset_px": {"x": round(-2 * half[0], 2), "y": round(-2 * half[1], 2)},
    }, trouble


def main(runs: list[str]) -> int:
    if not runs:
        print(__doc__)
        return 2
    cases: dict[str, dict[str, Any]] = {}
    dropped: list[str] = []
    for folder in map(Path, runs):
        raw = json.loads((folder / "earth-shots.json").read_text(encoding="utf-8"))
        for case in raw["measured"]:
            entry, trouble = build(folder, case)
            if trouble:
                dropped.append(f"{case['id']}: {'; '.join(trouble)}")
                continue
            cases[entry["id"]] = entry
            print(
                f"{entry['id']:<14} east {entry['east']['moved_px']:+9.3f} px  "
                f"north {entry['north']['moved_px']:+9.3f} px  "
                f"camera {entry['camera_offset_px']['x']:+.2f}, {entry['camera_offset_px']['y']:+.2f} px"
            )
    OUT.write_text(
        json.dumps(
            {
                "what": "Google Earth screenshots of one camera, a known step east, a known step north "
                "and at half the distance, registered against each other.",
                "how": "frontend/calibration/earth.mjs takes the shots (npm run calibrate:earth); "
                "scripts/build_earth_fixture.py registers them.",
                "why": "Earth states its scale as a camera distance and a field of view. "
                "tests/test_mapsites.py checks the parse of each base URL predicts how far the "
                "picture moved, and that the camera is drawn at the middle of the window.",
                "cases": sorted(cases.values(), key=lambda c: c["id"]),
            },
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\n{len(cases)} cases → {OUT.relative_to(ROOT)}")
    for line in dropped:
        print(f"  left out, {line}")
    return 1 if dropped else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
