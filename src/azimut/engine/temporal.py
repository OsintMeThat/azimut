"""Parse the small, explicit temporal profile Azimut stores on Claims.

Reduced dates, date intervals and their final qualifiers follow EDTF's familiar
surface. Exact timestamps follow ISO 8601. This module deliberately implements
neither full EDTF nor timestamp intervals: every accepted value must yield honest,
exclusive search bounds, or be marked as a local value that cannot join a UTC axis.

A value may be stated in a named zone, stored beside it rather than inside it. A civil
date then spans that zone's days: the 12th of March in Kyiv starts two hours before
the 12th in UTC, and reading it as UTC's would put the event on the wrong side of a
satellite pass. A local timestamp gains its bounds the same way.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone, tzinfo
import re

from .localtime import known_zone, zone_info


class TemporalError(ValueError):
    """A temporal value is outside Azimut's announced profile."""


@dataclass(frozen=True)
class TemporalEndpoint:
    """One date or timestamp and the bounds that can honestly be derived from it."""

    raw: str
    earliest: str | None
    latest: str | None
    precision: str
    uncertain: bool
    approximate: bool
    zone: str
    sortable: bool
    #: The IANA zone the bounds were read in, when the value was stated in one and
    #: the endpoint left it room to apply: a `Z` or an offset already says where
    #: it stands.
    tz: str | None = None


@dataclass(frozen=True)
class TemporalValue:
    """One temporal expression, retaining both ends when it is an interval."""

    raw: str
    start: TemporalEndpoint
    end: TemporalEndpoint | None = None

    @property
    def shape(self) -> str:
        return "interval" if self.end is not None else "instant"

    @property
    def earliest(self) -> str | None:
        return self.start.earliest

    @property
    def latest(self) -> str | None:
        if self.end is None:
            return self.start.latest
        # A reduced end date includes the whole stated civil period. A timestamp
        # is already the exact, exclusive end of a period.
        return self.end.latest if self.end.zone == "date-only" else self.end.earliest

    @property
    def precision(self) -> str:
        if self.end is None or self.start.precision == self.end.precision:
            return self.start.precision
        return "mixed"

    @property
    def uncertain(self) -> bool:
        return self.start.uncertain or bool(self.end and self.end.uncertain)

    @property
    def approximate(self) -> bool:
        return self.start.approximate or bool(self.end and self.end.approximate)

    @property
    def zone(self) -> str:
        if self.end is None or self.start.zone == self.end.zone:
            return self.start.zone
        return "mixed"

    @property
    def sortable(self) -> bool:
        return self.start.sortable and bool(self.end is None or self.end.sortable)

    @property
    def tz(self) -> str | None:
        return self.start.tz or (self.end.tz if self.end is not None else None)


_DATE = re.compile(
    r"(?P<year>\d{4})"
    r"(?:-(?P<month>\d{2})(?:-(?P<day>\d{2}))?)?"
    r"(?P<qualifier>[~?%])?\Z"
)
_TIMESTAMP = re.compile(
    r"(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})"
    r"T(?P<hour>\d{2}):(?P<minute>\d{2}):(?P<second>\d{2})"
    r"(?:\.(?P<fraction>\d{1,6}))?"
    r"(?P<zone>Z|(?P<sign>[+-])(?P<offset_hour>\d{2}):(?P<offset_minute>\d{2}))?\Z"
)


def parse_temporal(raw: object, *, tz: str | None = None) -> TemporalValue:
    """Parse one supported temporal value without rewriting what the analyst typed.

    Bounds are half-open: ``earliest`` is inclusive and ``latest`` is exclusive.
    A reduced month therefore ends at the start of the next month, and a timestamp
    written to seconds ends one second later. Local timestamps remain valid but have
    no UTC bounds until a timezone is known.

    ``tz`` is the IANA zone the value was stated in. Dates are then bounded by that
    zone's midnights, across a daylight-saving change included, and a local
    timestamp is read on its clock. Without it a date spans UTC's days, as it always
    has, so a value stored before zones existed keeps its place.
    """
    if not isinstance(raw, str):
        raise TemporalError("a temporal value must be text")
    if not raw or raw != raw.strip():
        raise TemporalError("a temporal value cannot be empty or padded with spaces")
    if tz is not None and not valid_zone(tz):
        raise TemporalError("the timezone is not one this installation knows")

    if "/" not in raw:
        return TemporalValue(raw=raw, start=_parse_endpoint(raw, tz))

    if raw.count("/") != 1:
        raise TemporalError("an interval must contain exactly two dates")
    start_raw, end_raw = raw.split("/", 1)
    if not start_raw or not end_raw or start_raw == ".." or end_raw == "..":
        raise TemporalError("open intervals are not supported")

    dates = bool(_DATE.fullmatch(start_raw) and _DATE.fullmatch(end_raw))
    timestamps = bool(_TIMESTAMP.fullmatch(start_raw) and _TIMESTAMP.fullmatch(end_raw))
    if not dates and not timestamps:
        raise TemporalError("an interval needs two dates or two timestamps")
    start = _parse_date(start_raw, tz) if dates else _parse_timestamp(start_raw, tz)
    end = _parse_date(end_raw, tz) if dates else _parse_timestamp(end_raw, tz)
    if start.earliest is None or end.earliest is None:
        raise TemporalError("a timestamp interval needs a timezone on both bounds")
    upper = end.latest if dates else end.earliest
    if upper is None or start.earliest >= upper:
        raise TemporalError("an interval cannot end before it starts")
    return TemporalValue(raw=raw, start=start, end=end)


def valid_zone(name: object) -> bool:
    """Whether ``name`` is an IANA zone a value can be stated in here.

    Checked before it is stored, not only when it is read: a name another machine's
    database held would otherwise leave a value placed on one install and not on
    the next, with nothing on screen saying why.
    """
    return isinstance(name, str) and 0 < len(name) <= 64 and name == name.strip() and known_zone(name)


def window_bound(raw: str, *, upper: bool) -> str:
    """One end of a search window, read from a value the analyst may have typed short.

    A reduced date names a whole civil period, so a window ending `2024-03` ends at the
    start of April rather than of March. A timestamp already names an exact instant and
    is taken as written, which is what lets the axis navigate at second scales without
    a second being added to every window.

    Every boundary in the app is read here — the live question, the saved view, the
    capture it freezes — so a snapshot and the reading it was taken from cannot answer
    the same window differently.
    """
    value = parse_temporal(raw)
    bound = value.latest if upper and value.start.zone == "date-only" else value.earliest
    if bound is None:
        raise TemporalError("a window boundary needs a date or a timezone")
    return bound


def _parse_endpoint(raw: str, tz: str | None = None) -> TemporalEndpoint:
    if _DATE.fullmatch(raw):
        return _parse_date(raw, tz)
    if _TIMESTAMP.fullmatch(raw):
        return _parse_timestamp(raw, tz)
    raise TemporalError("the temporal value is outside the supported date and timestamp profile")


def _civil(year: int, month: int, day: int, where: tzinfo) -> datetime:
    """Midnight opening a civil day in a zone, as the UTC instant it is."""
    return datetime(year, month, day, tzinfo=where).astimezone(UTC)


def _parse_date(raw: str, tz: str | None = None) -> TemporalEndpoint:
    match = _DATE.fullmatch(raw)
    if match is None:
        raise TemporalError("date intervals accept dates, not timestamps or open bounds")

    year = int(match.group("year"))
    month_text = match.group("month")
    day_text = match.group("day")
    qualifier = match.group("qualifier")
    # Each end is the midnight opening a civil day, never a fixed 24 hours on from
    # the start: a day that crosses a clock change is 23 or 25 hours long.
    where: tzinfo = zone_info(tz) if tz else UTC

    try:
        if day_text is not None:
            month = int(month_text or 0)
            day = int(day_text)
            first = datetime(year, month, day)
            following = first + timedelta(days=1)
            earliest = _civil(year, month, day, where)
            latest = _civil(following.year, following.month, following.day, where)
            precision = "day"
        elif month_text is not None:
            month = int(month_text)
            earliest = _civil(year, month, 1, where)
            if month == 12:
                latest = _civil(year + 1, 1, 1, where)
            else:
                latest = _civil(year, month + 1, 1, where)
            precision = "month"
        else:
            earliest = _civil(year, 1, 1, where)
            latest = _civil(year + 1, 1, 1, where)
            precision = "year"
    except (OverflowError, ValueError) as exc:
        raise TemporalError("the date is not a valid Gregorian date with representable bounds") from exc

    return TemporalEndpoint(
        raw=raw,
        earliest=_format_utc(earliest),
        latest=_format_utc(latest),
        precision=precision,
        uncertain=qualifier in ("?", "%"),
        approximate=qualifier in ("~", "%"),
        zone="date-only",
        sortable=True,
        tz=tz,
    )


def _parse_timestamp(raw: str, tz: str | None = None) -> TemporalEndpoint:
    match = _TIMESTAMP.fullmatch(raw)
    if match is None:  # guarded by `_parse_endpoint`, useful for direct maintenance
        raise TemporalError("the timestamp is outside the supported ISO profile")

    fraction = match.group("fraction") or ""
    microsecond = int(fraction.ljust(6, "0")) if fraction else 0
    zone_text = match.group("zone")

    where: tzinfo | None = None
    zone = "local"
    if zone_text == "Z":
        where = UTC
        zone = "utc"
    elif zone_text:
        offset_hour = int(match.group("offset_hour") or 0)
        offset_minute = int(match.group("offset_minute") or 0)
        if offset_minute > 59 or offset_hour > 14 or (offset_hour == 14 and offset_minute):
            raise TemporalError("a timezone offset must be between -14:00 and +14:00")
        offset = timedelta(hours=offset_hour, minutes=offset_minute)
        if match.group("sign") == "-":
            offset = -offset
        where = timezone(offset)
        zone = "offset"
    elif tz:
        # A wall-clock reading with no offset of its own, stated in a named zone:
        # that zone's clock on that day, summer time included.
        where = zone_info(tz)
        zone = "named"

    try:
        instant = datetime(
            int(match.group("year")),
            int(match.group("month")),
            int(match.group("day")),
            int(match.group("hour")),
            int(match.group("minute")),
            int(match.group("second")),
            microsecond,
            tzinfo=where,
        )
    except ValueError as exc:
        raise TemporalError("the timestamp is not a valid Gregorian date and time") from exc

    if where is None:
        return TemporalEndpoint(
            raw=raw,
            earliest=None,
            latest=None,
            precision="subsecond" if fraction else "second",
            uncertain=False,
            approximate=False,
            zone=zone,
            sortable=False,
        )

    resolution = timedelta(
        microseconds=10 ** (6 - len(fraction)) if fraction else 1_000_000
    )
    try:
        earliest = instant.astimezone(UTC)
        latest = earliest + resolution
    except OverflowError as exc:
        raise TemporalError("the timestamp has no representable exclusive upper bound") from exc
    return TemporalEndpoint(
        raw=raw,
        earliest=_format_utc(earliest),
        latest=_format_utc(latest),
        precision="subsecond" if fraction else "second",
        uncertain=False,
        approximate=False,
        zone=zone,
        sortable=True,
        tz=tz if zone == "named" else None,
    )


def _format_utc(value: datetime) -> str:
    """Format every sortable bound to the same lexicographic width.

    SQLite compares these values as text.  Keeping ``.000000`` on whole seconds
    is therefore as important as padding a sub-second value: without it,
    ``...14.500000Z`` sorts before ``...14Z`` because ``.`` sorts before ``Z``.
    """
    value = value.astimezone(UTC)
    base = (
        f"{value.year:04d}-{value.month:02d}-{value.day:02d}"
        f"T{value.hour:02d}:{value.minute:02d}:{value.second:02d}"
    )
    return f"{base}.{value.microsecond:06d}Z"
