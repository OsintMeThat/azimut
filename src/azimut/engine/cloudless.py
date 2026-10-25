"""EOX's Sentinel-2 cloudless: one cloud-free picture of the whole world a year.

Each year's picture is assembled from many Sentinel-2 passes of that year (and of
the one before, for the first two), pixel by pixel, so it carries no single date.
That is the opposite of what a capture filed as evidence must be, so the basemap is
shown and never captured (`Provider.capturable` off), and wherever it is printed it
is said to be a year's mosaic, never a day. A plate uses it as a ground for a wide
map, where a seamless, cloudless picture of a country is what the reader needs.

Key-less WMTS at `tiles.maps.eox.at`, asked only when the analyst picks this ground.
Its pixels are 10 m, native to level 14; the map magnifies past it.

Licences, as EOX states them (https://cloudless.eox.at/license-non-commercial):
2016 is CC BY 4.0, free for any use with its credit; 2018 on is CC BY-NC-SA 4.0,
free for non-commercial use with its credit and, online, its link.
"""

from __future__ import annotations

BASE_ID = "s2cloudless"
VARIANT_SEP = "~"
#: The years EOX publishes under a stated licence, oldest first. 2017 has no licence of its own.
YEARS: tuple[int, ...] = (2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025)
NEWEST = YEARS[-1]
#: Native pixels stop at level 14 (10 m); the view may go deeper by magnifying them.
MAX_NATIVE_ZOOM = 14
MAX_ZOOM = 17
#: The years free for any use; the others are for non-commercial use only.
FREE_FOR_ANY_USE = frozenset({2016})


def layer(year: int) -> str:
    """EOX's Web Mercator layer for a year: the 2016 one has no year in its name."""
    return "s2cloudless_3857" if year == 2016 else f"s2cloudless-{year}_3857"


def tile_url(year: int) -> str:
    return f"https://tiles.maps.eox.at/wmts/1.0.0/{layer(year)}/default/GoogleMapsCompatible/{{z}}/{{y}}/{{x}}.jpg"


def data_years(year: int) -> str:
    """The years of Sentinel data a year's picture is made of, as EOX credits them."""
    if year == 2016:
        return "2016 & 2017"
    if year == 2018:
        return "2017 & 2018"
    return str(year)


def licence(year: int) -> str:
    return "CC BY 4.0" if year in FREE_FOR_ANY_USE else "CC BY-NC-SA 4.0, non-commercial use"


def attribution(year: int) -> str:
    """The credit EOX asks for, word for word, then the licence it is given under."""
    return (
        f"EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH "
        f"(Contains modified Copernicus Sentinel data {data_years(year)}) · {licence(year)}"
    )


def parse_variant(spec: str) -> int:
    try:
        year = int(spec)
    except ValueError as exc:
        raise ValueError(f"'{spec}' is not a Sentinel-2 cloudless year") from exc
    if year not in YEARS:
        raise ValueError(f"EOX publishes no Sentinel-2 cloudless picture for {year} under a stated licence")
    return year


def variant_id(year: int) -> str:
    return f"{BASE_ID}{VARIANT_SEP}{int(year)}"
