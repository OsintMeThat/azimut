"""Civil local time at a coordinate: which zone, and where its days begin.

Kept apart from ``engine.sky`` on purpose. A day is a civil notion, not a
geometric one, so the geometry works on plain UTC instants and this module is
the only place that knows about zones. It also keeps the astronomy testable
without a timezone database.

``tzfpy`` resolves the zone from its own bundled boundaries and ``zoneinfo``
reads the offsets, so nothing here touches the network either.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import tzfpy


def zone_for(lat: float, lon: float) -> str:
    """IANA zone name at a point. Falls back to UTC where there is no answer.

    Open sea returns a nautical zone (``Etc/GMT+2`` and friends) rather than
    nothing, so the fallback is for the poles and for a zone name the installed
    database has never heard of.
    """
    try:
        name = tzfpy.get_tz(lon, lat)
    except (ValueError, OverflowError):
        name = None
    if not name:
        return "UTC"
    if not known_zone(name):
        return "UTC"
    return name


# What ``ZoneInfo`` raises for a name it will not load. ``ValueError`` covers the
# ones it rejects outright (absolute paths, ``..`` segments), and ``OSError`` the
# ones it takes as far as the filesystem, where an over-long name is ENAMETOOLONG
# rather than a miss — so a caller handing us an arbitrary string gets UTC, not a
# traceback.
_UNLOADABLE = (ZoneInfoNotFoundError, ValueError, OSError)


def known_zone(name: str) -> bool:
    """Whether this installation can load ``name`` as a zone."""
    try:
        ZoneInfo(name)
    except _UNLOADABLE:
        return False
    return True


def zone_info(name: str) -> ZoneInfo:
    """The zone, or UTC if this installation's database lacks it."""
    try:
        return ZoneInfo(name)
    except _UNLOADABLE:
        return ZoneInfo("UTC")


def day_bounds(day: date, zone: str) -> tuple[datetime, datetime]:
    """The UTC instants bounding one local civil day.

    Uses the following local midnight rather than 24 hours, so the interval keeps
    covering exactly one day across a daylight-saving change, when the local day
    is 23 or 25 hours long.
    """
    tz = zone_info(zone)
    start = datetime.combine(day, time(0, 0), tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def local_noon(day: date, zone: str) -> datetime:
    """Midday local, as a UTC instant: the default moment for a date with no time."""
    tz = zone_info(zone)
    return datetime.combine(day, time(12, 0), tzinfo=tz).astimezone(UTC)


def at_local(day: date, clock: time, zone: str) -> datetime:
    """A local wall-clock reading on a local date, as a UTC instant."""
    tz = zone_info(zone)
    return datetime.combine(day, clock, tzinfo=tz).astimezone(UTC)


def both(moment: datetime | None, zone: str) -> dict[str, Any] | None:
    """One instant written twice: civil local and UTC, as the panel shows it.

    ``abbreviation`` is what the zone calls itself at that moment (CEST, not
    CET), because that is the label a reader checks the local column against.
    """
    if moment is None:
        return None
    tz = zone_info(zone)
    local = moment.astimezone(tz)
    offset = local.utcoffset() or timedelta(0)
    minutes = int(offset.total_seconds() // 60)
    sign = "-" if minutes < 0 else "+"
    return {
        "utc": moment.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "local": local.isoformat(),
        "abbreviation": local.tzname() or "UTC",
        "offset_minutes": minutes,
        "offset": f"{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}",
    }
