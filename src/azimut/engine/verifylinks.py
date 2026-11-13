"""Public pages a reader opens to check a picture of the ground for themselves.

A note printed for someone else lists, under each capture in its sources, where the
same imagery can be seen without Azimut: Esri's Wayback app at the capture's point
showing its release, or the Copernicus Browser at the point on the day of its pass.
A link is written only from what the capture recorded (its point, and its release or
its day); a capture missing one gets no link rather than a guess. An estimated day
is not a day, and a World Imagery capture never recorded which release it showed.

`frontend/src/lib/maplinks.js` (`verifyLinks`) writes the same links in a capture's
Details, and `tests/fixtures/verify-links.json` holds both to one set of answers.
"""

from __future__ import annotations

import math
import re
from typing import Any

WAYBACK = "Esri Wayback"
COPERNICUS = "Copernicus Browser"
#: Esri's own app, as its share links write it: `mapCenter` is longitude first.
WAYBACK_APP = "https://livingatlas.arcgis.com/wayback/"
COPERNICUS_APP = "https://browser.dataspace.copernicus.eu/"
#: The deepest level the Copernicus Browser honours from a link (`docs/MAP_SITES.md`).
COPERNICUS_MAX_ZOOM = 18
#: The level a link opens at when the picture recorded none.
DEFAULT_ZOOM = 17
#: The Copernicus Browser's collection for each Sentinel basemap the app captures from.
DATASETS = {"sentinel2": "S2_L2A_CDAS", "sentinel1": "S1_CDAS_IW_VVVH"}

#: A Wayback release rides on the provider id (`engine/wayback.py`).
_RELEASE = re.compile(r"^esri-wayback~([1-9]\d{0,8})$")
#: A day as the case reads it, or the moment of a radar pass on it; never one ending `~`.
_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)?$")


def coord(value: float) -> str:
    """A coordinate as a link writes it: five places, about a metre, no trailing zero."""
    text = f"{value:.5f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def level(zoom: Any, ceiling: int | None = None) -> int:
    """The map level a link opens at: the picture's own, rounded half up, else the default."""
    try:
        value = float(zoom)
    except (TypeError, ValueError):
        value = math.nan
    whole = math.floor(value + 0.5) if math.isfinite(value) else DEFAULT_ZOOM
    whole = max(0, whole)
    return min(whole, ceiling) if ceiling is not None else whole


def wayback_link(lat: float, lon: float, zoom: Any, release: int) -> str:
    """Esri's Wayback app over the point, showing one release."""
    return f"{WAYBACK_APP}#mapCenter={coord(lon)}%2C{coord(lat)}%2C{level(zoom)}&mode=explore&active={release}"


def copernicus_link(lat: float, lon: float, zoom: Any, day: str, dataset: str) -> str:
    """The Copernicus Browser over the point, on one day of one collection."""
    return (
        f"{COPERNICUS_APP}?zoom={level(zoom, COPERNICUS_MAX_ZOOM)}&lat={coord(lat)}&lng={coord(lon)}"
        f"&datasetId={dataset}&fromTime={day}T00%3A00%3A00.000Z&toTime={day}T23%3A59%3A59.999Z"
    )


def _point(lat: Any, lon: Any) -> tuple[float, float] | None:
    try:
        y, x = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(y) and math.isfinite(x)) or abs(y) > 90 or abs(x) > 180:
        return None
    return y, x


def verify_links(provider: Any, lat: Any, lon: Any, zoom: Any = None, day: Any = "") -> list[tuple[str, str]]:
    """Where a picture from ``provider`` at the point can be checked, as `(site, url)`.

    ``day`` is its imagery day as the case reads it (`2024-03-12`, `2024-03-12~` for an
    estimate, `2024-03-12T10:22:00Z` for a radar pass). Nothing for a point, a release or
    a day the picture did not record.
    """
    point = _point(lat, lon)
    if point is None:
        return []
    ident = str(provider or "").strip()
    release = _RELEASE.match(ident)
    if release:
        return [(WAYBACK, wayback_link(*point, zoom, int(release.group(1))))]
    dataset = DATASETS.get(ident.split("~", 1)[0])
    found = _DAY.match(str(day or "").strip())
    if dataset and found:
        return [(COPERNICUS, copernicus_link(*point, zoom, found.group(1), dataset))]
    return []
