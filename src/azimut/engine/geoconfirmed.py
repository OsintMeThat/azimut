"""GeoConfirmed's map as an added layer, asked for by conflict, dates and area.

GeoConfirmed publishes the events its volunteers geolocated, each with the
posts it was sourced from and the geolocation that placed it, behind a
documented read-only API that needs no key (https://geoconfirmed.org/scalar/v1).
Three of its calls are used, all behind an act of the analyst's: the conflict
list when the GeoConfirmed dialog opens, and a conflict's factions plus its
filtered export when a layer is added or refreshed.

**The export is the KMZ, not the JSON the site's own map loads.** It is the
documented bulk export, filtered on GeoConfirmed's side by date and by polygon;
it carries every pictogram inside itself, so one request dresses the whole layer
in GeoConfirmed's own icons; and each placemark's description already holds the
event, its sources and its geolocation, which is what the card shows. It is also
a KMZ, so it goes through `engine/maplayers.py` like any other, and a bundle
carries it as the bytes GeoConfirmed sent.

What the KMZ does not state outright, and where `reading` finds it:

- **The faction** is in the icon's path, `api/icons/<colour>/<invert>/…`, and
  the conflict's factions name each colour. Factions sharing one are one legend
  row named after all of them, since their marks cannot be told apart either.
- **The date** is the placemark's name, `13 SEP 2026`. A placemark without one
  is a reference site (a base, a plant) the export includes whatever the dates
  asked for, so those are grouped as `UNDATED` and start switched off.
- **The folders** file events by age relative to the day of the export ("Last 7
  days"), which is wrong the next morning. They are replaced by the factions.
- **The hotspot** is declared as 16,16 pixels on 56-pixel discs, which is the
  middle of a 32-pixel icon. Honoured, it would put every event a third of an
  icon away from its point, so the disc is centred on it instead.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from math import isfinite
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from .. import __version__
from . import maplayers

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..workspace import Case

SITE = "https://geoconfirmed.org"
API = f"{SITE}/api"

#: GeoConfirmed asks integrations to say who they are and how to reach them, so
#: this is not the tile proxy's generic one.
USER_AGENT = f"Azimut/{__version__} (+https://github.com/OsintMeThat/azimut)"

#: What the conflict list and a conflict's factions may weigh. Both are a few
#: kilobytes; the bound is for a server that sends something else.
MAX_JSON_BYTES = 2 * 1024 * 1024

#: The longest window a layer may ask for by days. Ten years reaches back past
#: the start of every conflict GeoConfirmed maps, bar the two World Wars.
MAX_DAYS = 3650

#: The group a placemark with no date lands in.
UNDATED = "Undated sites"
#: …and the one a mark whose colour no faction claims lands in.
UNLISTED = "Faction not listed"

#: How much of an event's first line heads its card, after the date.
HEADING = 140

#: A conflict's short name, which is what the export is addressed by.
_CONFLICT = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_COLOUR = re.compile(r"^#?([0-9a-fA-F]{6})$")
_ICON_COLOUR = re.compile(r"api/icons/([0-9a-fA-F]{6})/", re.IGNORECASE)
_DAY = re.compile(r"^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$")
#: English whatever the machine's locale, which `strptime`'s `%b` is not.
_MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_MONTHS = {month.upper(): index for index, month in enumerate(_MONTH_NAMES, start=1)}


# ---------------------------------------------------------------------------
# What GeoConfirmed offers
# ---------------------------------------------------------------------------


def conflicts() -> list[dict[str, Any]]:
    """The public conflicts, in GeoConfirmed's own order."""
    listed = _json(f"{API}/Conflict")
    if not isinstance(listed, list):
        raise maplayers.LayerFetchError("GeoConfirmed sent a conflict list this app cannot read")
    out = []
    for entry in sorted(
        (entry for entry in listed if isinstance(entry, dict)), key=_order
    ):
        short = str(entry.get("shortName") or "")
        if entry.get("isPrivate") or not _CONFLICT.match(short):
            continue
        out.append(
            {
                "conflict": short,
                "name": _words(entry.get("name")) or short,
                "start": str(entry.get("startDate") or "")[:10],
                "end": str(entry.get("endDate") or "")[:10],
            }
        )
    return out


def _order(entry: dict[str, Any]) -> int:
    order = entry.get("order")
    return order if isinstance(order, int) else 0


def conflict(short: str) -> dict[str, Any]:
    """One conflict's name, map page and factions, the colours its marks wear."""
    short = _checked(short)
    detail = _json(f"{API}/Conflict/{quote(short)}")
    if detail is None:  # what GeoConfirmed answers for a name it does not know
        raise maplayers.LayerError(f"GeoConfirmed maps no conflict called {short}")
    if not isinstance(detail, dict):
        raise maplayers.LayerFetchError("GeoConfirmed sent a conflict this app cannot read")
    slug = str(detail.get("url") or "")
    factions = []
    for faction in detail.get("factions") or []:
        if not isinstance(faction, dict):
            continue
        colour = _colour(faction.get("backgroundColor"))
        name = _words(faction.get("name"))
        if colour and name:
            factions.append({"name": name, "colour": colour})
    return {
        "conflict": short,
        "name": _words(detail.get("name")) or short,
        "url": f"{SITE}/map/{quote(slug)}" if re.fullmatch(r"[A-Za-z0-9_-]+", slug) else SITE,
        "factions": factions,
    }


def _json(address: str) -> Any:
    """A JSON answer, or None for an empty one."""
    data, _ = maplayers.download(address, limit=MAX_JSON_BYTES, user_agent=USER_AGENT)
    if not data.strip():
        return None
    try:
        return json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise maplayers.LayerFetchError("GeoConfirmed sent something that is not JSON") from exc


def _checked(short: str) -> str:
    short = str(short or "").strip()
    if not _CONFLICT.match(short):
        raise maplayers.LayerError("that is not one of GeoConfirmed's conflicts")
    return short


def _words(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[: maplayers.MAX_NAME]


def _colour(value: Any) -> str:
    match = _COLOUR.match(str(value or "").strip())
    return f"#{match.group(1).lower()}" if match else ""


# ---------------------------------------------------------------------------
# The window and the area
# ---------------------------------------------------------------------------


def window(
    *,
    days: int | None = None,
    start: str | None = None,
    end: str | None = None,
    everything: bool = False,
) -> dict[str, Any]:
    """The dates a layer asks for: the last `days`, from `start` to `end`, or all.

    A number of days is counted back from the day of each read, so a layer asked
    for "the last 30 days" is still that a month later. A range stays put.
    """
    if everything:
        if days is not None or start or end:
            raise maplayers.LayerError("ask for the whole history or for dates, not both")
        return {"everything": True}
    if days is not None:
        if start or end:
            raise maplayers.LayerError("ask for a number of days or for dates, not both")
        if not 1 <= int(days) <= MAX_DAYS:
            raise maplayers.LayerError(f"a window runs from 1 to {MAX_DAYS:,} days")
        return {"days": int(days)}
    first = _iso_day(start, "the first day")
    if first is None:
        raise maplayers.LayerError("pick a number of days, a first day or the whole history")
    last = _iso_day(end, "the last day")
    if last is not None and last < first:
        raise maplayers.LayerError("the last day comes before the first")
    return {"start": first.isoformat(), "end": last.isoformat() if last else ""}


def _iso_day(value: str | None, what: str) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise maplayers.LayerError(f"{what} is not a date") from exc


def bounds(
    spec: dict[str, Any], today: date | None = None
) -> tuple[str | None, str | None]:
    """The window as the export's `start` and `end`, whole days either side."""
    today = today or datetime.now(timezone.utc).date()
    if spec.get("everything"):
        return None, None
    if spec.get("days"):
        return f"{(today - timedelta(days=int(spec['days']))).isoformat()}T00:00:00", None
    end = spec.get("end") or ""
    return f"{spec['start']}T00:00:00", f"{end}T23:59:59" if end else None


def window_label(spec: dict[str, Any]) -> str:
    """`last 30 days`, `since 1 Aug 2026`, `1 Aug – 18 Sep 2026`, `all history`."""
    if spec.get("everything"):
        return "all history"
    if spec.get("days"):
        count = int(spec["days"])
        return "last day" if count == 1 else f"last {count} days"
    first = date.fromisoformat(spec["start"])
    if not spec.get("end"):
        return f"since {_day_label(first)}"
    last = date.fromisoformat(spec["end"])
    if first == last:
        return _day_label(first)
    if first.year == last.year:
        return f"{first.day} {_MONTH_NAMES[first.month - 1]} – {_day_label(last)}"
    return f"{_day_label(first)} – {_day_label(last)}"


def _day_label(day: date) -> str:
    return f"{day.day} {_MONTH_NAMES[day.month - 1]} {day.year}"


def area(box: list[float] | tuple[float, ...] | None) -> list[float] | None:
    """`[west, south, east, north]`, checked, or None for the whole conflict."""
    if box is None:
        return None
    if len(box) != 4 or not all(isinstance(v, (int, float)) and isfinite(v) for v in box):
        raise maplayers.LayerError("an area is four numbers: west, south, east, north")
    west, south, east, north = (float(v) for v in box)
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise maplayers.LayerError(
            "that area is not a box on the map — it may cross the antimeridian"
        )
    return [round(west, 6), round(south, 6), round(east, 6), round(north, 6)]


def request(
    spec: dict[str, Any], box: list[float] | None, today: date | None = None
) -> dict[str, Any]:
    """The export's JSON body: the window, and the area as one GeoJSON polygon."""
    start, end = bounds(spec, today)
    polygons = None
    if box:
        west, south, east, north = box
        ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
        polygons = [[ring]]
    return {"start": start, "end": end, "polygons": polygons}


# ---------------------------------------------------------------------------
# Adding and re-reading
# ---------------------------------------------------------------------------


def subscribe(
    case: "Case",
    short: str,
    *,
    days: int | None = None,
    start: str | None = None,
    end: str | None = None,
    everything: bool = False,
    box: list[float] | None = None,
    on_open: bool | None = None,
) -> dict[str, Any]:
    """One conflict, over a window and optionally an area, as a layer of this case.

    `on_open` left unset re-reads a window the first time it is switched on in a
    session, but not the whole history: for Ukraine that is 6 MB and some six
    seconds each time, for a map that changes by a few dozen events a day.
    Refresh still reads it on demand.
    """
    spec = window(days=days, start=start, end=end, everything=everything)
    source: dict[str, Any] = {
        "kind": maplayers.GEOCONFIRMED,
        "conflict": _checked(short),
        "window": spec,
        "area": area(box),
    }
    if on_open is None:
        on_open = not spec.get("everything")
    data, source = read_again(source)
    title = f"GeoConfirmed · {source['label']} · {window_label(source['window'])}"
    parsed = maplayers.parse(
        data, filename=source["name"], title=title, reading=reading(source)
    )
    return maplayers.add_source(
        case,
        data,
        parsed,
        source=source,
        title=title,
        # GeoConfirmed's own pictograms, which cost nothing: they are inside the
        # export, so no request is made for any of them.
        icons=True,
        on_open=on_open,
        # The analyst asked for dates, and these have none.
        hidden=(UNDATED,),
    )


def read_again(source: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    """The export for a layer's query, and its source updated to match.

    The factions are read each time as well: a conflict gains one now and then,
    and a colour nobody claims would otherwise land in `UNLISTED` for good.
    """
    detail = conflict(str(source.get("conflict") or ""))
    body = request(source.get("window") or {}, source.get("area"))
    data, filename = maplayers.download(
        f"{API}/Map/export/{quote(detail['conflict'])}", body=body, user_agent=USER_AGENT
    )
    return data, {
        **source,
        "label": detail["name"],
        "url": detail["url"],
        "factions": detail["factions"],
        "name": filename or f"{detail['conflict']}.kmz",
        "format": "kmz",
    }


# ---------------------------------------------------------------------------
# Reading the export
# ---------------------------------------------------------------------------


def reading(source: dict[str, Any]) -> "maplayers.Reading":
    """GeoConfirmed's reading of its own KMZ, for `maplayers.parse`."""
    names = _faction_names(source.get("factions") or [])

    def read(
        features: list[dict[str, Any]], icons: dict[str, dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        centred = {}
        for key, descriptor in icons.items():
            moved = {**descriptor, "hotspot": None}
            centred[key] = (maplayers.icon_key(moved), moved)
        for feature in features:
            properties = feature["properties"]
            href = str((icons.get(properties["icon"]) or {}).get("href") or "")
            match = _ICON_COLOUR.search(href)
            colour = f"#{match.group(1).lower()}" if match else ""
            day = _day(properties["name"])
            dated = day is not None
            properties["category"] = (
                names.get(colour, UNLISTED) if dated else UNDATED
            )
            if day is not None:
                properties["date"] = day.isoformat()
            properties["colour"] = colour
            properties["name"], properties["description"] = _heading(
                properties["name"] if dated else "", properties["description"]
            )
            if properties["icon"] in centred:
                properties["icon"] = centred[properties["icon"]][0]
        return dict(centred.values())

    return read


def _faction_names(factions: list[dict[str, Any]]) -> dict[str, str]:
    """colour → the factions wearing it, in GeoConfirmed's order."""
    wearing: dict[str, list[str]] = {}
    for faction in factions:
        colour = _colour(faction.get("colour"))
        name = _words(faction.get("name"))
        if colour and name and name not in wearing.get(colour, []):
            wearing.setdefault(colour, []).append(name)
    return {colour: " / ".join(names) for colour, names in wearing.items()}


def _day(name: str) -> date | None:
    match = _DAY.match(str(name or "").strip())
    if not match:
        return None
    month = _MONTHS.get(match.group(2).upper())
    if month is None:
        return None
    try:
        return date(int(match.group(3)), month, int(match.group(1)))
    except ValueError:
        return None


def _heading(day: str, description: str) -> tuple[str, str]:
    """What the card and the search call an event, and what is left to read.

    The date alone says nothing to someone searching for a town, so the event's
    first line joins it; when it fits whole it is taken out of the body rather
    than said twice.
    """
    lines = str(description or "").split("\n")
    first = lines[0].strip()
    if first.endswith(":"):  # a section heading such as "Source(s):", not the event
        first = ""
    if not first:
        return day, description
    if len(first) <= HEADING:
        heading = f"{day} · {first}" if day else first
        return heading[: maplayers.MAX_NAME], "\n".join(lines[1:]).strip()
    cut = first[:HEADING].rsplit(" ", 1)[0].rstrip(" ,;:.")
    heading = f"{day} · {cut}…" if day else f"{cut}…"
    return heading, description
