"""Turn a raw calibration run into the fixture both test suites read.

    python scripts/build_map_fixture.py

`frontend/calibration/record.mjs` drives the map sites in a real browser and
writes down the URLs they wrote about themselves: `tests/fixtures/map-sites.raw.json`,
observation and nothing else. This reads that and produces
`tests/fixtures/map-sites.json`, which carries two derived things the suites
need:

* **the view each URL means**, from ``parse_map_url`` — the app's own parser,
  which is the only thing in this project allowed to read a map URL. A recording
  whose views were produced any other way would be testing a second parser
  against the first;
* **where each site drew its camera**, solved from the two zooms in the
  recording, the same way ``extension/mapmath.js`` solves it live.

That second one is a second copy of a formula, and it is on purpose. The JS is
what ships and what the drawing is done with; this is forty lines of Python that
has to agree with it, and `frontend/src/lib/extensionMapFrame.test.js` re-solves
every recording with the real thing and fails if the two ever differ by more
than a pixel. Two independent implementations agreeing on thirteen recordings is
a stronger statement about the arithmetic than either one alone.

Prose, per-recording notes and the `rounding` block are carried over from the
existing fixture: those are what a person knew, and a rebuild must not quietly
delete them.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from azimut.engine.mapsites import _mercator_y, parse_map_url  # noqa: E402

RAW = ROOT / "tests" / "fixtures" / "map-sites.raw.json"
OUT = ROOT / "tests" / "fixtures" / "map-sites.json"

#: Sites the recorder drives and the fixture leaves out, with the reason. Driving
#: them is still worth it: a link the app hands out that stopped opening a map is
#: caught by the run, whatever happens to the recording afterwards.
EXPECTED_OUT = {
    "google-earth": "a free camera states no scale, so there is nothing here to check it against",
}

#: How much the zoom has to have moved between two URLs before the solve below
#: is worth doing. `extension/mapmath.js` states the same floor, and for the same
#: reason: the answer comes out amplified by 1/(1−2^Δz).
MIN_ZOOM_STEP = 0.5

#: How much chrome counts as chrome. The camera offset is measured to about a
#: tenth of a pixel, so a site that draws dead centre lands a hair either side of
#: zero, and calling that a two-pixel header would restate the window's height
#: for nothing. `extension/mapoverlay.js` uses the same floor.
MIN_CHROME_PX = 4

#: WGS84's first eccentricity — the difference between the two Mercators, and
#: the whole of Yandex's disagreement with everyone else.
_E = 0.081819190842621
_MAX_LAT = 85.05112877980659


def _ellipsoidal_y(lat: float) -> float:
    """Northing on the 256-pixel world at zoom 0, elliptical Mercator (Yandex)."""
    phi = math.radians(max(-_MAX_LAT, min(_MAX_LAT, lat)))
    es = _E * math.sin(phi)
    t = math.tan(math.pi / 4 + phi / 2) * ((1 - es) / (1 + es)) ** (_E / 2)
    return (1 - math.log(t) / math.pi) / 2 * 256


def _project(lat: float, lon: float, projection: str | None) -> tuple[float, float]:
    y = _ellipsoidal_y(lat) if projection == "ellipsoidal" else _mercator_y(lat)
    return ((lon + 180) / 360 * 256, y)


def _wrap_near(lon: float, near: float) -> float:
    while lon - near > 180:
        lon -= 360
    while near - lon > 180:
        lon += 360
    return lon


def solve_centre(before: dict, after: dict, at: dict) -> dict[str, float] | None:
    """The pixel the site draws its camera at, from one zoom about a held point.

    With ``s = 2^zoom`` and world coordinates taken at zoom 0, the pixel `p` the
    zoom held still is the same before and after::

        p = C + s0·(w(P) − w(c0)) = C + s1·(w(P) − w(c1))

    which fixes both the point and the camera pixel `C`. Each axis is solved on
    its own, so a site that is off-centre one way only says so.
    """
    for view in (before, after):
        if view.get("zoom") is None or view.get("lat") is None:
            return None
        if view.get("bearing"):
            return None
    if before.get("projection") != after.get("projection"):
        return None
    if abs(after["zoom"] - before["zoom"]) < MIN_ZOOM_STEP:
        return None
    s0 = 2 ** before["zoom"]
    s1 = 2 ** after["zoom"]
    c0 = _project(before["lat"], before["lon"], before.get("projection"))
    c1 = _project(
        after["lat"], _wrap_near(after["lon"], before["lon"]), after.get("projection")
    )
    out = {}
    for axis, pixel in ((0, at["x"]), (1, at["y"])):
        point = (s0 * c0[axis] - s1 * c1[axis]) / (s0 - s1)
        out["xy"[axis]] = pixel - s0 * (point - c0[axis])
    return out if all(math.isfinite(v) for v in out.values()) else None


def _view_of(parsed: dict[str, Any]) -> dict[str, Any]:
    return {
        "lat": parsed["lat"],
        "lon": parsed["lon"],
        "zoom": parsed["zoom"],
        "bearing": parsed["bearing"] or 0,
        "projection": parsed["projection"],
    }


def build(entry: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    """One raw recording, parsed and solved. Returns the recording and what
    went wrong with it."""
    window = entry["window"]
    trouble: list[str] = []

    # The two views that state a size rather than a level — Apple's span,
    # Google satellite's metres — are only a scale next to the height the map
    # was drawn in, and that height is the window's minus whatever chrome sits
    # above or below it. Which is what the solve below measures. So it is run
    # twice: once against the window, then again against the map it found.
    height = int(window["h"])
    recording: dict[str, Any] | None = None
    used = height
    for _ in range(2):
        used = height
        views = []
        for step in entry["steps"]:
            parsed = parse_map_url(step["url"], height_px=height)
            if parsed is None:
                return None, [f"{step['url']} is not a map URL any more"]
            views.append((step["url"], parsed))
        solved = []
        for zoom in entry["zooms"]:
            placed = solve_centre(
                _view_of(views[zoom["from"]][1]), _view_of(views[zoom["to"]][1]), zoom["at"]
            )
            if placed is not None:
                solved.append(placed)
        if not solved:
            return None, ["no zoom in this recording moved a level the URL stated"]
        centre = {
            "x": round(sum(c["x"] for c in solved) / len(solved), 2),
            "y": round(sum(c["y"] for c in solved) / len(solved), 2),
        }
        spread = max(
            (math.dist((a["x"], a["y"]), (b["x"], b["y"])) for a in solved for b in solved),
            default=0.0,
        )
        chrome = 2 * abs(centre["y"] - window["h"] / 2)
        # a pixel count, in whole pixels, which is how the site drew it
        height = round(window["h"] - chrome) if chrome >= MIN_CHROME_PX else int(window["h"])
        recording = {
            "label": entry["label"],
            "site": entry["site"],
            "browser": entry.get("browser", "chromium"),
            "page_zoom": entry.get("pageZoom", 1),
            "window": window,
            "map_height": height,
            "centre": centre,
            "spread": round(spread, 2),
            "canvas": entry.get("canvas"),
            "pan": entry["pan"],
            "zooms": entry["zooms"],
            "steps": [
                {
                    "url": url,
                    "view": _view_of(parsed),
                    "scale_source": parsed["scale_source"],
                    "site": parsed["site"],
                }
                for url, parsed in views
            ],
        }

    assert recording is not None
    if recording["map_height"] != used:
        # The height the views were parsed at is not the height they imply, so
        # the scale and the offset are still chasing each other. One more pass
        # would settle it on any layout this has met; a recording that needs
        # more than that is one to look at rather than to ship.
        trouble.append(
            f"the map's height did not settle: parsed at {used}, solved {recording['map_height']}"
        )
    if recording["spread"] > 2:
        trouble.append(
            f"its two zooms solved centres {recording['spread']:.1f} px apart"
        )
    if any(step["view"]["lat"] is None for step in recording["steps"]):
        trouble.append("a URL came back with no position in it")
    sites = {step["site"] for step in recording["steps"]}
    if sites != {entry["site"]}:
        trouble.append(f"landed on {sorted(sites)} instead of {entry['site']}")
    if recording["canvas"]:
        box = recording["canvas"]
        inside = (
            box["x"] <= centre["x"] <= box["x"] + box["w"]
            and box["y"] <= centre["y"] <= box["y"] + box["h"]
        )
        if not inside:
            trouble.append("the camera solved outside the map's own canvas")
    return recording, trouble


def build_rounding(block: dict[str, Any], old: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """The one site that rounds the zoom it writes, notch by notch.

    Six notches from a whole level, all about one pixel. The whole levels are
    the ones the address bar states exactly, so they are what the camera is
    solved from; the notches in between are what the extension has to work out
    for itself, and what the fixture exists to ask it about.
    """
    trouble: list[str] = []
    window = block["window"]
    parsed = [parse_map_url(step["url"]) for step in block["steps"]]
    if any(view is None for view in parsed):
        return {}, ["a URL in the rounding run is not a map URL any more"]
    views = [view for view in parsed if view is not None]
    per_level = max(1, round(1 / block.get("step", 1 / 3)))
    solved = []
    for first in (0, per_level):
        last = first + per_level
        if last >= len(views):
            continue
        placed = solve_centre(_view_of(views[first]), _view_of(views[last]), block["at"])
        if placed is not None:
            solved.append(placed)
    if not solved:
        trouble.append("no pair of whole levels in the rounding run could place the camera")
    centre = {
        "x": round(sum(c["x"] for c in solved) / len(solved), 2) if solved else window["w"] / 2,
        "y": round(sum(c["y"] for c in solved) / len(solved), 2) if solved else window["h"] / 2,
    }
    stated = [view["zoom"] for view in views]
    if stated != sorted(stated) or stated[-1] - stated[0] < 1.5:
        trouble.append(f"the notches did not climb two levels: {stated}")
    return {
        "what": old.get("what", ""),
        "how": old.get("how", ""),
        "site": block["site"],
        "browser": block.get("browser", "chromium"),
        "window": window,
        "at": block["at"],
        "centre": centre,
        "step": block.get("step", 1 / 3),
        "steps": [
            {"url": step["url"], "view": _view_of(view)}
            for step, view in zip(block["steps"], views)
        ],
    }, trouble


def main() -> int:
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    notes = {r["label"]: r.get("note") for r in old.get("recordings", []) if r.get("note")}

    recordings: list[dict[str, Any]] = []
    dropped: list[str] = []
    aside: list[str] = []
    for entry in raw["recorded"]:
        if entry["site"] in EXPECTED_OUT:
            aside.append(f"{entry['label']}: {EXPECTED_OUT[entry['site']]}")
            continue
        recording, trouble = build(entry)
        if recording is None:
            dropped.append(f"{entry['label']} ({entry['browser']}): {'; '.join(trouble)}")
            continue
        if notes.get(entry["label"]):
            recording["note"] = notes[entry["label"]]
        recordings.append(recording)
        offset = (
            recording["centre"]["x"] - entry["window"]["w"] / 2,
            recording["centre"]["y"] - entry["window"]["h"] / 2,
        )
        flag = f"   ⚠ {'; '.join(trouble)}" if trouble else ""
        print(
            f"{entry['label']:<40} {entry['browser']:<9} "
            f"{entry['window']['w']}×{entry['window']['h']}@{entry.get('pageZoom', 1)}  "
            f"camera {offset[0]:+7.1f}, {offset[1]:+6.1f} px from the middle  "
            f"spread {recording['spread']:.2f}{flag}"
        )

    out = {
        "what": raw.get("what", old.get("what", "")),
        "why": old.get(
            "why",
            "The map tools draw on someone else's map from what its URL says. This is the "
            "record of what those URLs actually mean.",
        ),
        "centre": old.get(
            "centre",
            "Where each site drew the coordinate its address bar named, in window pixels, "
            "solved from its own two zooms.",
        ),
        "how": "Rebuilt by scripts/build_map_fixture.py from tests/fixtures/map-sites.raw.json.",
        "recordings": recordings,
    }
    if "rounding" in raw:
        block, trouble = build_rounding(raw["rounding"], old.get("rounding", {}))
        if block:
            out["rounding"] = block
            print(
                f"\n{block['site']} rounding run: camera "
                f"{block['centre']['x'] - block['window']['w'] / 2:+.1f}, "
                f"{block['centre']['y'] - block['window']['h'] / 2:+.1f} px from the middle"
            )
        if trouble:
            dropped.append(f"the rounding run: {'; '.join(trouble)}")
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")

    print(f"\n{len(recordings)} recordings → {OUT.relative_to(ROOT)}")
    if aside:
        print("driven, and not kept:")
        for line in aside:
            print(f"  {line}")
    if dropped:
        print("left out, and why:")
        for line in dropped:
            print(f"  {line}")
    return 1 if dropped else 0


if __name__ == "__main__":
    raise SystemExit(main())
