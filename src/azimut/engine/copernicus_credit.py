"""The credit Copernicus data carries, worded once for the backend.

The European Commission's legal notice on the use of Copernicus Sentinel data and
service information asks whoever shows that data to the public to say
"Copernicus Sentinel data [Year]", and "Contains modified Copernicus Sentinel data
[Year]" once it has been adapted or modified; the same pair exists for Copernicus
Service information. Every Sentinel picture the app shows is modified: a script
renders it from the bands, then it is reprojected, cropped and compressed. So the
modified form is the only one written, Detect's evidence and a figure included.

The year is the data's: one pass names its year, a window across New Year names
both (``2025-2026``). A picture whose date is unknown says no year rather than a
wrong one.

The tiles come from the Copernicus Data Space Ecosystem's own Sentinel Hub
(``sh.dataspace.copernicus.eu``), whose terms send Sentinel data back to that
notice. "Processed by Sentinel Hub" is what Sentinel Hub's commercial service asks
of its own customers, so it is not written. The legal notices are quoted in
docs/IMAGERY_PROVIDERS.md.

The heights the relief views read come from Mapterhorn, built on Copernicus GLO-30.
Its licence asks adapted data to carry its own notice (``DEM``), word for word. A
map's corner keeps the short "© Mapterhorn"; a picture filed or exported from the
heights carries the notice after it (``engine/terrain.py`` ``Source.published``).

Pictures filed before this kept "© Copernicus Sentinel data / Sentinel Hub" and its
variants, or a bare "© Mapterhorn", in their sidecars, which are never rewritten.
``normalise_attribution`` reads them in the right words wherever they are shown.

The frontend words it the same way in ``frontend/src/lib/copernicusCredit.js``.
"""

from __future__ import annotations

import re

#: The notice for Sentinel data the app has rendered, before its year.
SENTINEL = "Contains modified Copernicus Sentinel data"
#: The notice for Copernicus Service information (the land, atmosphere, marine…
#: services' products) that was adapted, before its year.
SERVICE = "Contains modified Copernicus Service information"
#: The notice the Copernicus DEM licence (COP-DEM-GLO-30-F, Article 6(b)) asks of
#: adapted GLO-30 data, word for word.
DEM = (
    "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH "
    "2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"
)
#: The relief's short credit, which a map's corner keeps (``terrain.MAPTERHORN``).
RELIEF = "© Mapterhorn"
#: What a picture drawn from that relief carries: Mapterhorn's page names its 150
#: national surveys, which a printed picture can only point to.
RELIEF_PUBLISHED = f"{RELIEF} (mapterhorn.com/attribution), {DEM}"

# A year at the start of a date as the sidecars keep it: 2026-05-12, 2026-05-12~,
# 2026-05, 2026, or a timestamp.
_YEAR = re.compile(r"\s*[~?%]?(\d{4})(?!\d)")
# Every day a provider id or a window names (sentinel2~SWIR~2026-05-01~2026-05-31).
_DAY = re.compile(r"(?<!\d)(\d{4})-\d{2}-\d{2}(?!\d)")
# The notice already written, but with no year after it.
_UNDATED = re.compile(re.escape(SENTINEL) + r"(?!\s*\d)")
# The relief's short credit with nothing of the DEM's notice after it.
_BARE_RELIEF = re.compile(
    re.escape(RELIEF) + r"(?! \(mapterhorn\.com/attribution\))(?!, produced using Copernicus WorldDEM-30)"
)
# What the app wrote before: "© Copernicus Sentinel data / Sentinel Hub",
# "Copernicus Sentinel data / Sentinel Hub", "© Copernicus Sentinel data". A notice
# in the modified form, or one carrying its year, is left as it is.
_LEGACY = re.compile(r"(?:©\s*)?(?<!modified )Copernicus Sentinel data(?:\s*/\s*Sentinel Hub)?(?!\s*\d)")


def data_years(*days: str | None) -> str:
    """The years of the data these days name: ``2026``, ``2025-2026``, or ``""``.

    Each argument is a date (its year read off its start) or a provider id, whose
    window or pass days are read wherever they stand. Anything else, as a sidecar
    may hold, names no year.
    """
    years: set[int] = set()
    for day in days:
        if not isinstance(day, str) or not day:
            continue
        named = _DAY.findall(day)
        if named:
            years.update(int(year) for year in named)
            continue
        start = _YEAR.match(day)
        if start:
            years.add(int(start[1]))
    if not years:
        return ""
    first, last = min(years), max(years)
    return str(first) if first == last else f"{first}-{last}"


def _dated(notice: str, days: tuple[str | None, ...]) -> str:
    years = data_years(*days)
    return f"{notice} {years}" if years else notice


def sentinel(*days: str | None) -> str:
    """The credit for Sentinel data of these days, its year when one is known."""
    return _dated(SENTINEL, days)


def service(*days: str | None) -> str:
    """The credit for Copernicus Service information of these days."""
    return _dated(SERVICE, days)


def normalise_attribution(text: str, *imagery_days: str | None) -> str:
    """A stored credit as it must read where it is shown, for imagery of these days
    (one for a capture, two for a pair, none known).

    The notice written without a year gets the year when the day is known, and the
    app's older wordings become the notice. The relief's short credit takes the
    DEM's notice after it. Every other credit, and the rest of a composed line, is
    left exactly as it was.
    """
    if not isinstance(text, str) or not text:
        return ""
    notice = sentinel(*imagery_days)
    text = _LEGACY.sub(notice, _UNDATED.sub(notice, text))
    return _BARE_RELIEF.sub(RELIEF_PUBLISHED, text)
