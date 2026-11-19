"""What a chart's form is filled with from the case (*Fill from the case*). It only reads.

A chart made from scratch is filled in a form made for its kind (`editor/chartForm.js`).
Where the case already holds what the form asks, *Fill from the case* proposes it, listed
before anything is written; nothing here invents a number or writes a line.

- **Events**, for a timeline: the Timeline's dated statements (its Claims) and the days the
  case's Geo Proofs say their material was taken, within a period on the case's clock. A
  Claim the proof composer made to date a proof (`attrs.proof`, or about a proof listed on
  the same day) is that proof's row, never a second one. A proof says its sentence, else its
  name; a Claim its statement. A value spanning days is a period. A refuted Claim is listed
  and said so, for the analyst to leave out.
- **Counts**, for bars, a donut, key figures and every kind of categories: the rows of a
  note's table or a sheet (`notecharts.origin_rows`) counted by the values of one column,
  split by a second, or the amounts of a column of numbers summed. A total row is never
  counted, and a row with no value in the column counted, or no number in the one summed,
  is left out and said. A sum is a floor when a cell it adds is one (``≥ 41``, ``41+``,
  *at least*), or when its column says so.
- **Values over days**, for a line: the same counting with the column of days along,
  each day read as the chart reads it (`notes_chart_kinds.read_day`) so ``5 Oct 2026`` and
  ``2026-10-05`` are one day, in the days' order.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Any

from . import notecharts, notefromcase
from . import notes_chart_kinds as kinds
from . import notes_charts as nc
from .localtime import zone_info
from .temporal import TemporalError, parse_temporal

if TYPE_CHECKING:
    from ..workspace import Case

#: The most events one Fill lists: past it the period is narrowed.
MAX_EVENTS = 300
#: The most values one count lists, a chart drawing fewer than that.
MAX_VALUES = 60
#: The words a timeline row says, at most: a cell of the table.
MAX_WORDS = 240
#: The precisions a timeline writes a day at; anything finer is a day.
PRECISIONS = ("day", "month", "year")
#: Who files the Claim that dates a proof's material (`ProofComposer`).
PROOF_COMPOSER = "proof-composer"


# -- events ---------------------------------------------------------------------------------------------


def _precision(raw: str) -> str:
    try:
        found = parse_temporal(raw).precision
    except TemporalError:
        return "day"
    return found if found in PRECISIONS else "day"


def _approximate(raw: str) -> bool:
    try:
        value = parse_temporal(raw)
    except TemporalError:
        return False
    return value.approximate or value.uncertain


def _words(text: object) -> str:
    said = " ".join(str(text or "").split())
    return said if len(said) <= MAX_WORDS else said[: MAX_WORDS - 1].rstrip() + "…"


@dataclass(frozen=True)
class _Event:
    id: str
    type: str
    first: date
    last: date
    precision: str
    approximate: bool
    what: str
    refuted: bool
    instant: str

    def record(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "day": self.first.isoformat(),
            "last": self.last.isoformat() if self.last > self.first else "",
            "precision": self.precision,
            "approximate": self.approximate,
            "what": self.what,
            "refuted": self.refuted,
        }


def _all_events(case: Case, zone: str) -> tuple[list[_Event], int]:
    """Every dated event of the case on ``zone``'s clock, and how many could not be dated."""
    clock = zone_info(zone)
    entities = case.list_entities()
    proofs = {entity["id"]: entity for entity in entities if entity.get("type") == "proof"}
    claims = [entity for entity in entities if entity.get("type") == "claim"]
    # the proofs a Claim is about or cites, and the one whose record it was made for
    named: dict[str, set[str]] = {}
    for link in case.list_links():
        if link.get("type") in ("about", "cites") and link.get("to") in proofs:
            named.setdefault(str(link.get("from")), set()).add(str(link["to"]))
    by_spec = {str((proof.get("attrs") or {}).get("spec") or ""): ident for ident, proof in proofs.items()}

    events: list[_Event] = []
    undated = 0
    proof_days: dict[str, date] = {}
    for ident, proof in proofs.items():
        attrs = proof.get("attrs") or {}
        raw = attrs.get("when")
        found = notefromcase.reading("taken", raw, attrs.get("when_zone"), clock) if raw else None
        if found is None:
            undated += 1
            continue
        proof_days[ident] = found.first
        words = _words(attrs.get("notes")) or _words(proof.get("label")) or "Proof"
        events.append(_Event(ident, "proof", found.first, found.last, _precision(str(raw)), _approximate(str(raw)),
                             words, False, found.instant))
    for claim in claims:
        attrs = claim.get("attrs") or {}
        raw = attrs.get("when")
        found = notefromcase.reading("claim", raw, attrs.get("when_zone"), clock) if raw else None
        if found is None:
            undated += 1
            continue
        # the proof composer's own Claim dating a proof is that proof's row
        if attrs.get("proof") or (claim.get("provenance") or {}).get("by") == PROOF_COMPOSER:
            targets = named.get(claim["id"], set()) | {by_spec.get(str(attrs.get("proof") or ""), "")}
            if any(proof_days.get(target) == found.first for target in targets):
                continue
        words = _words(attrs.get("statement")) or _words(claim.get("label")) or "Claim"
        events.append(_Event(claim["id"], "claim", found.first, found.last, _precision(str(raw)),
                             _approximate(str(raw)), words, attrs.get("confidence") == "refuted", found.instant))
    return events, undated


def case_events(case: Case, *, start: date | None = None, end: date | None = None, zone: str = "UTC",
                limit: int = MAX_EVENTS) -> dict[str, Any]:
    """The case's dated events overlapping ``start``..``end`` (both included, either open),
    by day: ``items`` the first ``limit``, ``total`` how many the period holds, ``undated``
    the events no day could be read for, ``first`` and ``last`` the days every dated one
    spans, so the form's period opens on all of them."""
    if start is not None and end is not None and end < start:
        raise ValueError("the period ends before it starts")
    events, undated = _all_events(case, zone)
    inside = [event for event in events
              if (start is None or event.last >= start) and (end is None or event.first <= end)]
    inside.sort(key=lambda event: (event.first, event.instant, event.what.casefold(), event.id))
    taken = max(0, min(int(limit), MAX_EVENTS))
    return {
        "items": [event.record() for event in inside[:taken]],
        "total": len(inside),
        "undated": undated,
        "first": min((event.first.isoformat() for event in events), default=None),
        "last": max((event.last.isoformat() for event in events), default=None),
    }


# -- counts ---------------------------------------------------------------------------------------------


def _column(headers: list[str], name: str) -> int | None:
    wanted = " ".join(str(name or "").split()).casefold()
    if not wanted:
        return None
    return next((index for index, header in enumerate(headers) if " ".join(header.split()).casefold() == wanted), None)


def counts(headers: list[str], rows: list[list[str]], *, by: str, split: str = "", amount: str = "",
           days: bool = False) -> dict[str, Any]:
    """The rows of a table counted by the values of ``by`` (and of ``split``), or ``amount``'s
    numbers summed: ``rows`` as ``{value, split, count}`` in the order the values first
    appear (by day with ``days``), ``floor`` whether a sum adds a floor, and what was left
    out (``blank``, ``unread``, ``totals``). Raises ``KeyError`` for a column not there."""
    by_at = _column(headers, by)
    if by_at is None:
        raise KeyError(by)
    split_at = _column(headers, split) if split else None
    if split and split_at is None:
        raise KeyError(split)
    amount_at = _column(headers, amount) if amount else None
    if amount and amount_at is None:
        raise KeyError(amount)
    floor = bool(amount_at is not None and nc.FLOOR_WORDS.search(headers[amount_at]))
    totals_by: dict[tuple[str, str], float] = {}
    names: dict[str, str] = {}
    parts: dict[str, str] = {}
    when: dict[str, date] = {}
    blank = unread = totals = 0
    year = kinds.column_year(rows, [by_at]) if days else None
    for row in rows:
        if row and nc.TOTAL_ROW.match(nc.plain_cell(row[0])):
            totals += 1
            continue
        value = nc.plain_cell(row[by_at]) if by_at < len(row) else ""
        if not value:
            blank += 1
            continue
        day = kinds.read_day(value, year) if days else None
        if days:
            if day is None:
                unread += 1
                continue
            value = kinds.day_text(day, year=True)
        if amount_at is not None:
            number = nc.read_number(row[amount_at]) if amount_at < len(row) else "empty"
            if not isinstance(number, nc.Number):
                unread += 1
                continue
            add = number.value
            floor = floor or number.floor
        else:
            add = 1.0
        part = nc.plain_cell(row[split_at]) if split_at is not None and split_at < len(row) else ""
        names.setdefault(value.casefold(), value)
        parts.setdefault(part.casefold(), part)
        if day is not None:
            when.setdefault(value.casefold(), day.day)
        key = (value.casefold(), part.casefold())
        totals_by[key] = totals_by.get(key, 0.0) + add
    values = list(names)
    if days:
        values.sort(key=lambda key: when[key])
    out = [{"value": names[value], "split": parts[part], "count": nc.number_text(total)}
           for value in values for (name, part), total in totals_by.items() if name == value]
    most = MAX_VALUES * (4 if split_at is not None else 1)
    return {"rows": out[:most], "values": len(values), "floor": floor,
            "blank": blank, "unread": unread, "totals": totals}


def origin_counts(case: Case, origin: str, *, by: str, split: str = "", amount: str = "",
                  days: bool = False) -> dict[str, Any] | None:
    """`counts` of the table or the sheet ``origin`` names (``note:<id>#<heading>``,
    ``sheet:<id>``), with its name; None when it is no longer in the case."""
    found = notecharts.origin_rows(case, origin)
    if found is None:
        return None
    name, headers, rows = found
    return {"name": name, **counts(headers, rows, by=by, split=split, amount=amount, days=days)}
