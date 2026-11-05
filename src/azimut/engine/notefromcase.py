"""The case's geolocations over a period, for the note *From the case* writes.

The Notebook home's *From the case* tile asks for a period and writes one note with a
block, or a table row, per geolocation in it. This module answers which ones, and the
two days each can be read by. It only reads: nothing is written and nothing is fetched.

**What counts is decided elsewhere, and read from there.**

- **Every Geo Proof.** A proof is a geolocation by design: composing it is the
  assertion (`satellite._state_point`).
- **Every picture or video the case collected that the Media position draws at a
  confirmed point** (`satellite.media_index`, `satellite.is_confirmed`). A point only a
  tool proposed does not count, and neither does a file with no point.
- **A file a proof answers for is shown by that proof**, however many steps down the
  proof was made from it, as the *Files to geolocate* sheet reads it
  (`sheetfromcase._file_graph`). The proof is the picture and the file its source, so
  one geolocation is one block, not two.

**Two days each.** *What it shows* is the content's own day as the Timeline reads it
(`engine/timeline.py`): the day a proof says its material was taken, else a file's
camera clock, else the day it was posted, else the imagery's day. *When it was
geolocated* is the day its place was stated in the case: the first confirmed edge to a
place it stands on, or the day a proof with no such edge was filed. A suggestion
confirmed later keeps the day it was proposed, since an edge records when it was filed.

**The period is days on one clock**, the case's. A time is put on that clock. A day is
the day it says, in whatever zone it was stated, since moving it across midnight would
date it to a day nobody wrote. A value spanning days (a month, a range) counts when one
of its days is in the period, as the Timeline's window reads an overlap.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import TYPE_CHECKING, Any

from . import links, satellite, sheetfromcase, timeline
from .localtime import known_zone, zone_info
from .temporal import TemporalEndpoint, TemporalError, parse_temporal

if TYPE_CHECKING:
    from ..workspace import Case

#: The most geolocations one note holds. Past this a note is a dump, and the line that
#: names the cut sends the analyst back to narrow the period.
MAX_ITEMS = 200

#: The two readings a period can be taken in.
SHOWN = "shown"
GEOLOCATED = "geolocated"
READINGS = (SHOWN, GEOLOCATED)

#: The Timeline's rows a file's content is dated by, in this order: the camera's clock,
#: the day it was posted, the imagery's day.
CONTENT_KINDS = ("captured", "published", "imagery")


@dataclass(frozen=True)
class Reading:
    """One date of a geolocation: what it is, as written, and the days it covers on the
    case's clock. ``instant`` is its UTC start when it has one, to order a day's items."""

    kind: str
    raw: str
    tz: str | None
    first: date
    last: date
    instant: str

    def record(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "raw": self.raw,
            "tz": self.tz,
            "day": self.first.isoformat(),
            "last": self.last.isoformat(),
        }


def _instant(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def _endpoint_days(end: TemporalEndpoint, clock: tzinfo) -> tuple[date, date] | None:
    """The days one end of a value covers: a day as it is written, a time on ``clock``,
    and a time with no clock of its own on the day its wall clock reads."""
    if end.zone == "date-only" and end.earliest and end.latest:
        stated: tzinfo = zone_info(end.tz) if end.tz else UTC
        first = _instant(end.earliest).astimezone(stated).date()
        last = (_instant(end.latest) - timedelta(microseconds=1)).astimezone(stated).date()
        return first, last
    if end.earliest:
        day = _instant(end.earliest).astimezone(clock).date()
        return day, day
    try:
        day = date.fromisoformat(end.raw[:10])
    except ValueError:
        return None
    return day, day


def reading(kind: str, raw: Any, tz: Any, clock: tzinfo) -> Reading | None:
    """A stored date read onto the case's clock, or None when it cannot be placed."""
    if not isinstance(raw, str) or not raw:
        return None
    zone = tz if isinstance(tz, str) and tz and known_zone(tz) else None
    try:
        value = parse_temporal(raw, tz=zone)
    except TemporalError:
        return None
    start = _endpoint_days(value.start, clock)
    end = _endpoint_days(value.end, clock) if value.end is not None else start
    if start is None or end is None:
        return None
    return Reading(kind, raw, zone, start[0], end[1], value.earliest or "")


def _content(rows: Iterable[timeline.ProjectionRow], clock: tzinfo) -> Reading | None:
    """The first of these Timeline rows that dates what a file shows, kind by kind, so a
    camera day on any file beats a post day on the first one."""
    rank = {kind: at for at, kind in enumerate(CONTENT_KINDS)}
    for row in sorted((row for row in rows if row.kind in rank), key=lambda row: rank[row.kind]):
        found = reading(row.kind, row.raw, row.tz, clock)
        if found is not None:
            return found
    return None


def _counted(entity: dict[str, Any]) -> bool:
    """A proof counts unless a tool only proposed it."""
    return entity.get("type") == "proof" and (
        (entity.get("provenance") or {}).get("status") != "suggested"
    )


@dataclass
class _Unit:
    """One geolocation while it is read: the entity, its own edges, the confirmed
    points it stands on, the collected files it shows and everything it was made of."""

    entity: dict[str, Any]
    incident: list[dict[str, Any]]
    spots: list[dict[str, Any]]
    sources: list[dict[str, Any]]
    ancestors: list[str]


def _places(case: Case, units: list[_Unit]) -> dict[str, dict[str, Any]]:
    """The places these units' own edges reach, in one read."""
    wanted = {
        link["to"]
        for unit in units
        for link in unit.incident
        if link["from"] == unit.entity["id"] and link["type"] in satellite.PLACE_VERBS
    }
    return {
        entity["id"]: entity
        for entity in case.entities_by_ids(sorted(wanted))
        if entity.get("type") == "place"
    }


def _stated(
    unit: _Unit, places: dict[str, dict[str, Any]]
) -> tuple[dict[tuple[float, float], dict[str, Any]], str]:
    """The confirmed places this unit's own edges stand it on, by the metre they mark,
    and when the first of those edges was filed."""
    at: dict[tuple[float, float], dict[str, Any]] = {}
    first = ""
    for link in unit.incident:
        if link["from"] != unit.entity["id"] or link["type"] not in satellite.PLACE_VERBS:
            continue
        place = places.get(link["to"])
        if place is None or satellite.road_status(link, place) != "confirmed":
            continue
        attrs = place.get("attrs") or {}
        key = satellite._at(attrs.get("lat"), attrs.get("lon"))
        if key is None:
            continue
        at.setdefault(key, place)
        filed = str((link.get("provenance") or {}).get("at") or "")
        if filed and (not first or filed < first):
            first = filed
    return at, first


def _point(spot: dict[str, Any], at: dict[tuple[float, float], dict[str, Any]]) -> dict[str, Any]:
    lat, lon = float(spot["lat"]), float(spot["lon"])
    key = satellite._at(lat, lon)
    place = at.get(key) if key is not None else None
    named = None
    if place is not None:
        label = str(place.get("label") or "").strip()
        named = {
            "id": place["id"],
            "label": label,
            # a place named by its own coordinates says nothing the coordinates do not
            "coords": label == satellite.coords_label(lat, lon),
        }
    return {"lat": lat, "lon": lon, "place": named}


def geolocations(case: Case, zone: str = "UTC") -> list[dict[str, Any]]:
    """Every geolocation of the case with both its readings, in no particular order."""
    clock = zone_info(zone)
    collected = {entity["id"]: entity for entity in sheetfromcase.imported_files(case)}
    answered, _, known = sheetfromcase._file_graph(case)
    items = {
        str(item["entity_id"]): item
        for item in case.list_media_items()
        if item.get("entity_id")
    }

    # what each proof was made from, every step up, by inverting the sheet's reading
    made_of: dict[str, list[str]] = {}
    for file_id, proofs in answered.items():
        for proof_id in proofs:
            made_of.setdefault(proof_id, []).append(file_id)

    def label_of(entity: dict[str, Any]) -> str:
        return str(entity.get("label") or "").strip()

    units: list[_Unit] = []
    for proof in known.values():
        if not _counted(proof):
            continue
        incident = case.links_of(proof["id"])
        ancestors = made_of.get(proof["id"], [])
        sources = sorted(
            (collected[one] for one in ancestors if one in collected),
            key=lambda entity: (label_of(entity).casefold(), entity["id"]),
        )
        units.append(_Unit(
            entity=proof,
            incident=incident,
            spots=satellite.confirmed_spots(case, proof["id"], incident=incident),
            sources=sources,
            ancestors=ancestors,
        ))

    # a file one of those proofs answers for is shown by it
    shown_by_proof = {
        file_id
        for file_id, proofs in answered.items()
        if any(_counted(known.get(proof_id) or {}) for proof_id in proofs)
    }
    placed: dict[str, list[dict[str, Any]]] = {}
    for row in satellite.media_index(case):
        if row["status"] == "confirmed" and row["id"] not in shown_by_proof:
            placed.setdefault(row["id"], []).append(row)
    for entity in case.entities_by_ids(sorted(placed)):
        units.append(_Unit(
            entity=entity,
            incident=case.links_of(entity["id"]),
            spots=placed[entity["id"]],
            sources=[entity],
            ancestors=[],
        ))

    places = _places(case, units)
    out: list[dict[str, Any]] = []
    for unit in units:
        entity = unit.entity
        at, first_edge = _stated(unit, places)
        is_proof = entity["type"] == "proof"
        attrs = entity.get("attrs") or {}

        shown: Reading | None
        if is_proof:
            taken = next(
                (row for row in timeline.project_entity(entity) if row.kind == "taken"), None
            )
            shown = reading("taken", taken.raw, taken.tz, clock) if taken is not None else None
            if shown is None:
                # the proof states no day: what its material shows, the files first
                behind = [source["id"] for source in unit.sources] + [
                    one for one in unit.ancestors if one not in collected
                ]
                rows = [
                    row
                    for one in behind
                    if one in items
                    for row in timeline.project_media(items[one], one)
                ]
                shown = _content(rows, clock)
        else:
            item = items.get(entity["id"])
            shown = _content(timeline.project_media(item, entity["id"]), clock) if item else None

        filed = first_edge or (
            str((entity.get("provenance") or {}).get("at") or "") if is_proof else ""
        )
        geolocated = reading(GEOLOCATED, filed, None, clock) if filed else None

        out.append({
            "id": entity["id"],
            "type": entity["type"],
            "label": label_of(entity) or ("Proof" if is_proof else "File"),
            "media_kind": links.media_kind(entity),
            # a proof saved without its PNG has no picture to show, only its name
            "picture": bool(attrs.get("path")),
            "sources": [
                {"id": source["id"], "label": label_of(source), "media_kind": links.media_kind(source)}
                for source in unit.sources
            ],
            "points": [_point(spot, at) for spot in unit.spots],
            SHOWN: shown,
            GEOLOCATED: geolocated,
        })
    return out


def period(
    case: Case,
    *,
    start: date | None = None,
    end: date | None = None,
    by: str = SHOWN,
    zone: str = "UTC",
    limit: int = MAX_ITEMS,
) -> dict[str, Any]:
    """The geolocations whose day, read ``by`` one of :data:`READINGS` on ``zone``'s
    clock, falls between ``start`` and ``end`` (both included, either open), by date.

    ``total`` is how many the period holds and ``items`` the first ``limit`` of them.
    ``undated`` counts the geolocations this reading cannot date, which no period
    holds. ``first`` and ``last`` are the days the dated ones span, period or not, so a
    dialog can open on the whole of them.
    """
    if by not in READINGS:
        raise ValueError(f"by must be one of {list(READINGS)}")
    if zone != "UTC" and not known_zone(zone):
        raise ValueError("the zone is not one this installation knows")
    if start is not None and end is not None and end < start:
        raise ValueError("the period ends before it starts")
    found = geolocations(case, zone)
    dated = [entry for entry in found if entry[by] is not None]
    inside = [
        entry
        for entry in dated
        if (start is None or entry[by].last >= start) and (end is None or entry[by].first <= end)
    ]
    inside.sort(key=lambda entry: (
        entry[by].first, entry[by].instant, entry["label"].casefold(), entry["id"],
    ))
    taken = max(0, min(int(limit), MAX_ITEMS))
    return {
        "items": [
            {
                **entry,
                "day": entry[by].first.isoformat(),
                SHOWN: entry[SHOWN].record() if entry[SHOWN] else None,
                GEOLOCATED: entry[GEOLOCATED].record() if entry[GEOLOCATED] else None,
            }
            for entry in inside[:taken]
        ],
        "total": len(inside),
        "undated": len(found) - len(dated),
        "first": min((entry[by].first.isoformat() for entry in dated), default=None),
        "last": max((entry[by].last.isoformat() for entry in dated), default=None),
        "limit": taken,
    }
