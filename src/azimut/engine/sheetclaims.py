"""Turn a sheet's columns of times into dated statements the case holds.

The binders do not hold dates. They hold a **reasoning about** a date, spread across
three or four columns: the hour that was established, the hour that was estimated, how it
was worked out ("the author gave me this time", "a private video shows 1:57", "between
2:00 and 2:10", "probably after 2 a.m."), and the UTC publication time of the first
source. Copied into a `when` field that would be one number and three lost columns.

Azimut already has the shape those columns are: a **Claim** — a statement that points at
what it is about, carries when it applies, how sure the analyst is and the reasoning a
reader would need to check it (ONTOLOGY §2). So the road runs there and nowhere else, and
nothing here writes a timestamp back into a cell.

Two ways in, one shape out:

**A column of times.** The established hour if there is one, the estimated hour if there
is not, an interval when the note says "between 2:00 and 2:10". An estimate is recorded
one rung lower in confidence than an established reading and the reasoning says which it
was, because a case where the two are the same value is a case that has lost the
distinction its own analyst drew.

**An offset from an anchor.** Ten videos carry `-00:01:50` against one shot that is
visible and audible in all of them. Their relative order is usable straight away; the
moment somebody dates that shot, every one of them has an absolute time to the second.
That time is an **inference**, so it is a Claim with `probable` confidence and reasoning
naming the anchor — never a timestamp copied into a `when` cell, which would present a
deduction as an observation.

Both are planned before they are done, both are idempotent through the sidecar the way a
row promotion is, and both stay inside `engine/temporal`'s profile: a reduced date for a
cell that named a day, a timestamp for one that named an hour, an interval for a range.
A local hour stays local unless the analyst says otherwise, because the column is called
`Local time` and stamping it `Z` would move the evidence by however far away it happened.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from ..workspace import CaseError
from . import entities as entity_engine
from . import links as link_engine
from . import sheetroles
from .sheetpromote import BY, ERROR, MAKE, SKIP, UPDATE, cite_source, counts_of, urls_in
from .sheets import SheetError, key_index, sync_mentions
from .temporal import TemporalError, parse_temporal

if TYPE_CHECKING:
    from ..workspace import Case

#: The type a dated reading becomes. Not promotable from a bare row — a Claim about
#: nothing is not a statement — which is precisely why it has a road of its own.
CLAIM_TYPE = "claim"

#: How many rows one press may date. The row promotion's bound, for the same reason.
MAX_CLAIMS = 500

#: How sure an established reading is taken to be unless the analyst says otherwise.
#: Not `certain`: an hour read off a binder is an hour somebody worked out, and the case
#: has a word for that.
DEFAULT_CONFIDENCE = "probable"

#: What an *estimate* is worth beside an established reading: one rung down, always. The
#: binders kept two columns because the difference matters, and a promotion that filed
#: both at one confidence would be the one that threw that away.
LOWER = {"certain": "probable", "probable": "possible", "possible": "possible"}

#: Which question the date answers. `occurred` is when the thing happened, which is what
#: a timeline binder's hours are; `observed` is when somebody saw it, which is what an
#: upload time is. Asked rather than assumed — treating the two as one moves evidence in
#: time (`entities.CLAIM_TIME_ROLES`).
TIME_ROLES = tuple(value for value, _ in entity_engine.CLAIM_TIME_ROLES)

#: Time zones a column may be declared in. Empty is **local** and is the default: a
#: local timestamp is valid in this app's temporal profile and honestly says that its
#: UTC bounds are not known yet.
ZONE = re.compile(r"^(Z|[+-]\d{2}:\d{2})$")

#: How a cell writes a range. The separator has to be surrounded by spaces or introduced
#: by a word, because `2026-01-03` is full of hyphens and splitting on a bare one would
#: read every ISO date as an interval from the year to the day.
_RANGE = re.compile(
    r"^(?:between\s+|entre\s+|from\s+|de\s+)?(.+?)\s+(?:-|–|—|to|and|à|et)\s+(.+?)$",
    re.IGNORECASE,
)


def _read_range(text: Any, role: dict[str, Any] | None) -> tuple[Any, Any] | None:
    """Two readings out of one cell, or None. `between 02:00 and 02:10` is the case."""
    found = _RANGE.match(str(text or "").strip())
    if not found:
        return None
    start = sheetroles.parse_when(found.group(1), role)
    end = sheetroles.parse_when(found.group(2), role)
    return (start, end) if start and end else None


def _value(read: dict[str, Any] | None, day: str, zone: str) -> str | None:
    return sheetroles.claim_moment(read, day=day, zone=zone)


def _interval(pair: tuple[Any, Any], day: str, zone: str) -> tuple[str | None, str]:
    """A range as the one interval spelling `engine/temporal` reads, or why it is not one.

    Both ends have to be the same shape — two dates or two timestamps — which is the
    profile's own rule and not this module's. A range from a day to an hour is refused
    rather than resolved: which of the two the analyst meant is not knowable from here.

    And an interval **of hours** needs a time zone on both bounds, because the profile
    only accepts a range it can turn into honest exclusive bounds and a local timestamp
    has none until a zone is known. That is not a failure to report as a parse error: it
    is one question to ask, so it is asked in those words.
    """
    start, end = (_value(pair[0], day, zone), _value(pair[1], day, zone))
    if not start or not end:
        return None, ""
    if ("T" in start) != ("T" in end):
        return None, "this range runs from a day to an hour"
    if "T" in start and not zone:
        return None, "a range of hours needs the time zone this column is written in"
    return f"{start}/{end}", ""


class _Reading:
    """One row's moment: what it is, how sure it is, and how it was arrived at."""

    def __init__(self, when: str, confidence: str, reasoning: str, said: str) -> None:
        self.when = when
        self.confidence = confidence
        self.reasoning = reasoning
        self.said = said


def _from_columns(
    row: list[str],
    columns: list[str],
    roles: dict[str, Any],
    *,
    when_column: str,
    estimate_column: str,
    method_column: str,
    day: str,
    zone: str,
    confidence: str,
) -> tuple[_Reading | None, str]:
    """The moment a row's time columns describe, or the reason there is none.

    Read in the order the analyst wrote them: what was established beats what was
    estimated, and a range beats a point because a range is the more careful of the two
    statements the same cell could be making.
    """
    method = str(row[columns.index(method_column)] if method_column in columns else "").strip()
    tries: list[tuple[str, str, str]] = []
    if when_column:
        tries.append((when_column, confidence, "established"))
    if estimate_column:
        tries.append((estimate_column, LOWER.get(confidence, confidence), "estimated"))
    for column, sure, how in tries:
        cell = str(row[columns.index(column)]).strip()
        if not cell:
            continue
        role = roles.get(column) or {}
        # The cell first, then the note beside it — but only for an estimate, because
        # "between 2:00 and 2:10" written next to an *established* hour is the reasoning
        # that produced that hour, not a wider claim replacing it.
        span = _read_range(cell, role)
        if span is None and how == "estimated":
            span = _read_range(method, roles.get(method_column) or {})
        why = ""
        if span:
            when, why = _interval(span, day, zone)
        else:
            when = _value(sheetroles.parse_when(cell, role), day, zone)
        if not when:
            return None, why or f"'{cell}' in '{column}' is not a time this can date"
        reasoning = f"{how} in '{column}': {cell}"
        if method:
            reasoning = f"{reasoning}. {method}"
        return _Reading(when, sure, reasoning, cell), ""
    return None, "no time in these columns"


def _from_anchor(
    row: list[str],
    columns: list[str],
    *,
    offset_column: str,
    anchor: str,
    anchor_at: str,
) -> tuple[_Reading | None, str]:
    """The moment an offset lands on, once the anchor it counts from has been dated."""
    cell = str(row[columns.index(offset_column)]).strip()
    if not cell:
        return None, f"nothing in '{offset_column}'"
    seconds = sheetroles.parse_offset(cell)
    if seconds is None:
        return None, f"'{cell}' is not an offset"
    when = sheetroles.offset_moment(anchor_at, seconds)
    if not when:
        return None, f"'{anchor}' has no time yet"
    return (
        _Reading(
            when,
            "probable",
            f"{sheetroles.format_offset(seconds)} from '{anchor}', which is dated {anchor_at}",
            cell,
        ),
        "",
    )


def _about_takes(entity_type: str) -> bool:
    spec = link_engine.relation_type(link_engine.ABOUT)
    return bool(spec and entity_type in spec.to_types)


def plan(
    case: "Case",
    *,
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    keys: list[str],
    subject_column: str,
    when_column: str = "",
    estimate_column: str = "",
    method_column: str = "",
    place_column: str = "",
    link_column: str = "",
    offset_column: str = "",
    day: str = "",
    zone: str = "",
    confidence: str = DEFAULT_CONFIDENCE,
    time_role: str = TIME_ROLES[0],
    skip: list[str] | None = None,
    coming: dict[str, dict[str, dict[str, str]]] | None = None,
) -> dict[str, Any]:
    """What dating these rows would do, row by row, without doing any of it.

    The subject is read from the sidecar rather than from the cell's words, and that is
    deliberate: a Claim is a statement *about something the case holds*, so a row whose
    subject has not been promoted has nothing to make a statement about. Said plainly —
    "not in the case yet" — because the fix is one press away and guessing which entity a
    name means is exactly what this app refuses.

    `coming` is how one press says the fix is not away at all: `engine/sheetpass.py` runs
    the modes in dependency order and threads the sidecar between them, so a subject
    declared in the same declaration will be there by the time these statements are
    written. It carries what an entity is asked for here — the type and the label — for
    rows the case does not hold yet.
    """
    if len(keys) > MAX_CLAIMS:
        raise SheetError(f"at most {MAX_CLAIMS} rows can be dated at once")
    if bool(when_column or estimate_column) == bool(offset_column):
        raise SheetError("date these rows either from a column of times or from an anchor")
    if confidence not in dict(entity_engine.CLAIM_CONFIDENCE):
        raise SheetError(f"'{confidence}' is not a confidence")
    if time_role not in TIME_ROLES:
        raise SheetError(f"'{time_role}' is not what a date can answer")
    if zone and not ZONE.match(zone):
        raise SheetError(f"'{zone}' is not a time zone")
    # Read rather than taken as given, so a caller answering `03/01/2026` supplies a day
    # and not a string that would be pasted into a timestamp and refused as one. Day-first
    # like every other date this app reads, which is what the binders write; an ISO day is
    # unambiguous either way, and that is what the picker sends.
    read_day = sheetroles.parse_when(day) if day else None
    if day and read_day is None:
        raise SheetError(f"'{day}' is not a date")
    day = read_day["date"] if read_day else ""
    named = [subject_column, when_column, estimate_column, method_column, place_column,
             link_column, offset_column]
    for column in named:
        if column and column not in columns:
            raise SheetError(f"this sheet has no column '{column}'")
    if subject_column not in columns:
        raise SheetError("a statement needs the column naming what it is about")

    roles = (meta.get("roles") or {}) if isinstance(meta, dict) else {}
    links = (meta.get("links") or {}) if isinstance(meta, dict) else {}
    attachments = (meta.get("attachments") or {}) if isinstance(meta, dict) else {}
    anchors = (meta.get("anchors") or {}) if isinstance(meta, dict) else {}
    anchor = str((roles.get(offset_column) or {}).get("anchor") or "") if offset_column else ""
    anchor_at = str((anchors.get(anchor) or {}).get("at") or "") if anchor else ""
    if offset_column and (roles.get(offset_column) or {}).get("kind") != "offset":
        raise SheetError(f"'{offset_column}' is not a column of offsets")

    # Where the claim's own reference is kept, so a second press updates rather than
    # files a second statement of the same thing. The column the date came out of, which
    # is the one the analyst would look at to ask whether it has been dated.
    dated_by = offset_column or when_column or estimate_column
    key_at = key_index(columns)
    wanted = set(keys)
    left_out = set(skip or [])

    planned: list[dict[str, Any]] = []
    for row in rows:
        identity = row[key_at] if key_at < len(row) else ""
        if identity not in wanted:
            continue
        subject = str(links.get(identity, {}).get(subject_column) or "")
        said = str(row[columns.index(subject_column)]).strip()
        decision: dict[str, Any] = {
            "key": identity,
            "label": "",
            "subject": subject,
            "subject_label": said,
            "action": SKIP,
            "reason": "",
            "entity": None,
            "entity_label": "",
            "when": "",
            "confidence": "",
            "method": "",
            "place": "",
            "sources": [],
        }
        planned.append(decision)
        if identity in left_out:
            decision["reason"] = "left out"
            continue

        held = case.get_entity(subject) if subject else None
        if held is None:
            held = (coming or {}).get(subject_column, {}).get(identity)
            subject = str((held or {}).get("id") or "")
            decision["subject"] = subject
        if held is None:
            decision["reason"] = f"'{said or identity}' is not in the case yet"
            continue
        if not _about_takes(str(held.get("type"))):
            decision["reason"] = f"a statement cannot be about a {held.get('type')}"
            continue
        decision["subject_label"] = str(held.get("label") or said)

        if offset_column:
            reading, why = _from_anchor(
                row, columns, offset_column=offset_column, anchor=anchor, anchor_at=anchor_at
            )
        else:
            reading, why = _from_columns(
                row, columns, roles,
                when_column=when_column,
                estimate_column=estimate_column,
                method_column=method_column,
                day=day,
                zone=zone,
                confidence=confidence,
            )
        if reading is None:
            decision["reason"] = why
            continue
        try:
            parse_temporal(reading.when)
        except TemporalError as exc:
            decision.update(action=ERROR, reason=f"{reading.when} {exc}")
            continue

        decision.update(
            label=f"{decision['subject_label']} at {reading.said}",
            when=reading.when,
            confidence=reading.confidence,
            method=reading.reasoning,
        )
        if place_column:
            placed = str(links.get(identity, {}).get(place_column) or "")
            at = case.get_entity(placed) if placed else None
            if at is not None and at.get("type") == "place":
                decision["place"] = at["id"]
        decision["sources"] = _sources(case, row, columns, link_column, attachments.get(identity))

        pointed = str(links.get(identity, {}).get(dated_by) or "")
        already = case.get_entity(pointed) if pointed else None
        if already is not None and already.get("type") == CLAIM_TYPE:
            decision.update(
                action=UPDATE, entity=already["id"], entity_label=str(already.get("label") or "")
            )
            continue
        if already is not None:
            decision["reason"] = f"'{dated_by}' already points at a {already.get('type')}"
            continue
        decision["action"] = MAKE

    return {
        "rows": planned,
        "counts": counts_of(planned),
        "column": dated_by,
        "anchor": {"name": anchor, "at": anchor_at} if offset_column else None,
    }


def _sources(
    case: "Case",
    row: list[str],
    columns: list[str],
    link_column: str,
    attached: list[str] | None,
) -> list[str]:
    """What the statement will rest on: the row's source links and the pieces it carries.

    Both, because the binders kept them apart for a reason that is theirs and not the
    case's: a URL is where the claim was published, an attached screenshot is the proof
    of the hour somebody pasted into a tab of its own. A statement rests on both.
    """
    found: list[str] = []
    if link_column:
        found.extend(urls_in(str(row[columns.index(link_column)])))
    for entity_id in attached or ():
        if case.get_entity(entity_id) is not None:
            found.append(entity_id)
    return found


def promote(
    case: "Case",
    sheet_id: str,
    **asked: Any,
) -> dict[str, Any]:
    """File the statements that plan describes, with their connectors.

    ``about`` is restated rather than added, and so are ``at`` and ``cites``: a second
    press after the analyst repointed a row must leave the Claim pointing where the sheet
    now says, not at both. `sync_links` is what makes that one operation.

    Nothing travels back for a compensating undo: the caller runs the whole press inside
    one `case.batch()`, and a refusal there leaves the case as it was.
    """
    meta = asked["meta"]
    reading = plan(case, **asked)
    links = {identity: dict(cells) for identity, cells in (meta.get("links") or {}).items()}
    said = {identity: dict(cells) for identity, cells in (meta.get("promoted") or {}).items()}
    column = reading["column"]
    time_role = asked.get("time_role", TIME_ROLES[0])
    seen: dict[str, str] = {}

    for decision in reading["rows"]:
        if decision["action"] not in (MAKE, UPDATE):
            continue
        attrs = {
            "when": decision["when"],
            "time_role": time_role,
            "confidence": decision["confidence"],
            "method": decision["method"],
        }
        target = decision["entity"]
        if decision["action"] == MAKE:
            entity = case.add_entity(CLAIM_TYPE, decision["label"], attrs, by=BY)
            target = entity["id"]
        else:
            case.update_entity(target, {"label": decision["label"], "attrs": attrs})

        cites: list[str] = []
        for source in decision["sources"]:
            if source.startswith(("http://", "https://")):
                cite_source(case, source, target, seen)
                cites.append(seen[source])
            else:
                cites.append(source)
        _connect(case, target, link_engine.ABOUT, [decision["subject"]])
        _connect(case, target, link_engine.AT, [decision["place"]] if decision["place"] else [])
        _connect(case, target, link_engine.CITES, cites)
        links.setdefault(decision["key"], {})[column] = target
        said.setdefault(decision["key"], {})[column] = decision["when"]

    sync_mentions(case, sheet_id, {**meta, "links": links})
    return {
        "links": links,
        "promoted": said,
        "plan": reading["rows"],
        **reading["counts"],
    }


def _connect(case: "Case", claim: str, verb: str, targets: list[str]) -> None:
    """State exactly these connectors of one kind, dropping the ones that no longer hold.

    **The ones this press wrote** (``own_only``). What the row says is the sheet's to
    restate — repointing a row moves the connector rather than leaving the statement
    pointing both ways — but `about`, `at` and `cites` are also what the Claim's own panel
    offers, and a source added there is a second claim about the same statement. Read over
    both, a second press deleted it: no Trash holds a removed edge, and re-filing one is a
    new id, a new date and a new author.

    A target the vocabulary refuses is left out rather than raised, the way a citation is:
    the statement is still worth having, and taking a whole press down over one edge would
    lose the rows that had nothing wrong with them.
    """
    source = case.get_entity(claim)
    if source is None:
        return
    wanted: list[str] = []
    for target in targets:
        try:
            link_engine.check_relation_target(case, source, target, verb)
        except CaseError:
            continue
        wanted.append(target)
    case.sync_links(claim, verb, wanted, by=BY, own_only=True)
