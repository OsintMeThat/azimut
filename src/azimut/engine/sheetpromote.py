"""Turn rows of a sheet into what the case believes.

A sheet says what is being *checked*; the graph says what the case *believes*. Promotion
is the one road between the two, and it runs one way: nothing here reads the graph back
into a cell.

**It is planned before it is done.** `plan` reads the table and answers, row by row, what
would happen — a new entity, an existing one attached, one already promoted updated, a row
left alone, or a cell that cannot be read at all. `promote_rows` executes exactly that
plan. The analyst sees the answer before the case changes, which is the whole reason a
promotion is safe to press: forty rows becoming forty entities is not a thing to find out
about afterwards.

Four rules make it safe to press twice, which matters because an analyst promotes ten
rows, adds four more and promotes the lot again:

**The sidecar remembers.** A promoted row's cell already points at the entity it made
(`meta["links"][row][column]`), so the second promotion *updates* that entity instead of
minting a twin. Only when the entity is still of the promoted type: a cell pointing at a
place is not a person waiting to be overwritten.

**A name is not an identity.** Two people can share a name, so a row whose label matches
an entity already in the case is **not** joined to it behind the analyst's back — the plan
says the case already holds that name, and attaching is a decision they make. The one
exception is the ``identifier`` family, where the value *is* the identity (ONTOLOGY §2):
one address is one email, and `entities.identity_key` is what compares them.

**A field is checked before it is stored.** A column mapped onto a declared field goes
through the same readings the API applies to a typed form, so a number column holding
`about 12` is reported rather than stored as text in a field nothing can sum.

**Only the columns asked for travel.** The label, whichever columns the analyst mapped
onto declared fields, and — for a place — the point. A promotion that swept every column
into the graph would put a worklist's private notes into the case's own record of a
subject.

What the sheet gets back is a `mentions` edge per promoted row, which is what makes the
row visible from the subject's side, and the provenance says the sheet it came from.

**Four roads, because a binder holds four shapes and only the first is one row per
thing.** `promote_rows` is that first one. `promote_rows(group=True)` is the second: two
lines of one cross-border event are one entity with two places, which row-by-row gets
wrong by construction. `promote_column` is the third and works on **words** rather than
rows — a column of four hundred rows holds forty pieces of equipment. `promote_row_links`
is the fourth: a column naming other rows of the same sheet becomes the `part-of` edges
an order of battle is actually made of, instead of the text validation the binders had,
which had already decayed to `#REF!`.

The fifth shape, a column of times becoming a dated statement, is `engine/sheetclaims.py`:
a Claim is not an entity a row *is*, it is something the case *says* about one, and it
carries its own connectors, confidence and reasoning.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from ..workspace import CaseError
from . import entities as entity_engine
from . import links as link_engine
from . import sheetroles
from .sheets import SheetError, key_index, sync_mentions
from .temporal import TemporalError, parse_temporal

if TYPE_CHECKING:
    from ..workspace import Case

#: How many rows one press may promote. A worklist is promoted in passes — ticking a
#: screenful, checking what landed, ticking the next — and a press that wrote two
#: thousand entities is a press nobody can review.
MAX_PROMOTED = 500

#: How many different words one column may be promoted at once. The same bound read the
#: same way: a press that wrote five hundred entities is a press nobody can review.
MAX_COLUMN_WORDS = MAX_PROMOTED

#: What the provenance of a promoted entity says wrote it.
BY = "sheet"

#: What one row's promotion does. Five answers rather than a count, because "forty rows
#: promoted" hides the difference between forty new subjects and thirty-nine the case
#: already had, and it hides a row that did nothing at all.
MAKE = "make"
JOIN = "join"
UPDATE = "update"
SKIP = "skip"
ERROR = "error"
ACTIONS = (MAKE, JOIN, UPDATE, SKIP, ERROR)

#: How many same-name entities a row offers to attach to. A list past this is not a
#: choice, it is a search — and the analyst has one of those in the entity picker.
MAX_CANDIDATES = 5

#: The type a point column promotes into, and the one type here that is not created by
#: hand anywhere else in the app: a place is normally born from the map, with a point.
#: A sheet column of coordinates is the other honest way to have one, so promotion
#: declares it rather than reading `manual` and finding it absent.
PLACE_TYPE = "place"

#: What a promotion refuses to mint. A Claim is a statement *about* the rest of the
#: graph — it carries what it is about, when it applies and what it rests on — and a
#: sheet row promoted on its own would be a statement about nothing, with no date and no
#: source. Timeline is where a Claim is made; the sheet points at one.
NOT_PROMOTED = frozenset({"claim"})

#: Where a bookmark keeps the page it stands for. Written by the extension's own filing
#: (`api/ingest.py`), and matched here so a URL already saved is pointed at rather than
#: saved twice.
URL_ATTR = "url"

_URL = re.compile(r"\bhttps?://[^\s<>\"'()\[\]]+")
_NUMBER = re.compile(r"^[+-]?\d+(?:\.\d+)?$")
#: What a European export puts inside a number: a space, a non-breaking space or an
#: apostrophe grouping the thousands, and a comma where the decimal point goes. Taken
#: out before the value is read, so `1 234,5` is a number and `about 12` is still not.
_NUMBER_NOISE = str.maketrans({" ": "", "\u00a0": "", "\u202f": "", "'": "", ",": "."})


def promotable_types() -> list[str]:
    """The types a sheet row may become.

    Everything an analyst creates by hand, less the ones a bare row cannot honestly
    make, plus `place` — which is not created by hand anywhere else because it is
    normally born from the map, and which a column of coordinates is the other honest
    way to have.
    """
    types = [
        declared.type
        for declared in entity_engine.ENTITY_TYPES
        if declared.manual and declared.type not in NOT_PROMOTED
    ]
    if PLACE_TYPE not in types:
        types.append(PLACE_TYPE)
    return types


def _declared(entity_type: str) -> dict[str, entity_engine.Attr]:
    """The fields an analyst may fill on this type, by key.

    Promotion is held to these on purpose: an undeclared key would pass through and be
    stored, so a column called `Notes 3` would become a field of the case's vocabulary
    that nothing else in the app knows how to show or edit.
    """
    for declared in entity_engine.ENTITY_TYPES:
        if declared.type == entity_type:
            return {attr.key: attr for attr in declared.attrs}
    return {}


# -- reading one cell into one declared field ---------------------------------


def read_attr(attr: entity_engine.Attr, text: str) -> tuple[Any, str | None]:
    """One cell as the value a declared field takes, or the reason it cannot be.

    A cell is text — every cell is, the file keeps the words — and a declared field is
    typed. Promotion is where the two meet, and it is the only write in the app that
    reached the store without passing a form. So the conversion is stated here and the
    result still goes through `entities.check_attrs`: this decides what `12,5` means,
    that decides whether the field accepts it.

    An empty cell is *unknown*, which every field may be, so it yields no value and no
    complaint.
    """
    body = str(text or "").strip()
    if not body:
        return None, None
    if attr.kind in ("text", "longtext"):
        return body, None
    if attr.kind == "number":
        digits = body.translate(_NUMBER_NOISE)
        if not _NUMBER.match(digits):
            return None, f"{attr.label}: '{body}' is not a number"
        value = float(digits)
        return (int(value) if value.is_integer() else value), None
    if attr.kind == "url":
        if not body.lower().startswith(("http://", "https://")):
            return None, f"{attr.label}: '{body}' is not an http or https link"
        return body, None
    if attr.kind == "choice":
        folded = body.casefold()
        for stored, reading in attr.options:
            if folded in (stored.casefold(), reading.casefold()):
                return stored, None
        allowed = ", ".join(reading for _, reading in attr.options)
        return None, f"{attr.label}: '{body}' is not one of {allowed}"
    if attr.kind == "temporal":
        try:
            parse_temporal(body)
        except TemporalError as exc:
            return None, f"{attr.label}: '{body}' {exc}"
        return body, None
    # A footprint is a drawn shape, not a cell. Said rather than silently dropped: the
    # analyst mapped a column onto it and is owed the reason nothing landed.
    return None, f"{attr.label} cannot be filled from a column"


# -- what a column of coordinates may do, per type ----------------------------


#: Verbs that put something at a place, in the order a promotion tries them. A
#: structure is *sited at* its ground; a recording was *made* there. Read out of the
#: registry rather than assumed, so a type that gains a place verb later gains this too.
PLACE_VERBS = ("sited-at", "located-at", "depicts")


def place_verb(entity_type: str) -> str | None:
    """How this type is joined to a place, or None when the vocabulary joins it to none.

    A ``place`` is its own answer — the coordinates are the entity — and that is the case
    the promotion has always handled. For everything else the point in the cell is a
    *second* entity: a structure's site is a place the structure stands on, and writing a
    latitude onto the structure itself would put a field on it that nothing in the app
    declares, shows or edits.
    """
    if entity_type == PLACE_TYPE:
        return None
    for verb in PLACE_VERBS:
        spec = link_engine.relation_type(verb)
        if spec and entity_type in spec.from_types and PLACE_TYPE in spec.to_types:
            return verb
    return None


# -- planning ------------------------------------------------------------------


def plan(
    case: "Case",
    *,
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    keys: list[str],
    entity_type: str,
    label_column: str,
    attr_columns: dict[str, str] | None = None,
    point_column: str | None = None,
    link_column: str | None = None,
    attach: dict[str, str] | None = None,
    skip: list[str] | None = None,
    group: bool = False,
    group_label: str | None = None,
) -> dict[str, Any]:
    """What promoting these rows would do, row by row, without doing any of it.

    Read by the preview the analyst confirms and by the promotion itself, so what is
    shown and what is written are the same answer rather than two that agree until one
    of them is edited.

    ``group`` turns the ticked rows into **one** entity instead of one each, which is the
    only place the row-is-an-entity assumption breaks and it breaks on a common shape: the
    binders' geolocation index puts a cross-border event on two lines, one point per
    country, same title, same source. Promoted row by row that is two events, and the
    second one is the copy that never gets corrected.
    """
    if entity_type not in promotable_types():
        raise SheetError(f"'{entity_type}' is not a type a row can become")
    if label_column not in columns:
        raise SheetError(f"this sheet has no column '{label_column}'")
    if len(keys) > MAX_PROMOTED:
        raise SheetError(f"at most {MAX_PROMOTED} rows can be promoted at once")
    if entity_type == PLACE_TYPE and not point_column:
        raise SheetError("a place needs the column holding its coordinates")
    if point_column and entity_type != PLACE_TYPE and not place_verb(entity_type):
        raise SheetError(f"the vocabulary has no way to put a {entity_type} at a place")
    for named in (point_column, link_column):
        if named and named not in columns:
            raise SheetError(f"this sheet has no column '{named}'")

    declared = _declared(entity_type)
    shape = _Shape(
        columns=columns,
        entity_type=entity_type,
        label_column=label_column,
        declared=declared,
        mapping={
            column: attr
            for column, attr in (attr_columns or {}).items()
            if column in columns and attr in declared
        },
        key_at=key_index(columns),
        label_at=columns.index(label_column),
        point_at=columns.index(point_column) if point_column else -1,
        link_at=columns.index(link_column) if link_column else -1,
        verb=place_verb(entity_type) if point_column else None,
    )
    held = _Held(
        links=(meta.get("links") or {}) if isinstance(meta, dict) else {},
        **_labels_held(case, entity_type),
    )
    wanted = set(keys)
    taken = [row for row in rows if _key_of(row, shape.key_at) in wanted]
    left_out = set(skip or [])
    chosen = attach or {}

    planned = (
        _plan_group(case, taken, shape, held, left_out, chosen, group_label)
        if group
        else _plan_rows(case, taken, shape, held, left_out, chosen)
    )
    return {
        "rows": planned,
        "counts": counts_of(planned),
        "type": entity_type,
        "group": bool(group),
        "verb": shape.verb or "",
    }


@dataclass(frozen=True)
class _Shape:
    """Where each answer sits in the table, resolved once for the whole plan."""

    columns: list[str]
    entity_type: str
    label_column: str
    declared: dict[str, entity_engine.Attr]
    #: Column name to the declared field it fills.
    mapping: dict[str, str]
    key_at: int
    label_at: int
    point_at: int
    link_at: int
    #: How a point column joins this type to a place, or None when the point *is* the
    #: entity (a `place`) or when no column of coordinates was given.
    verb: str | None


@dataclass(frozen=True)
class _Held:
    """What the case and the sidecar already say, read once rather than once a row."""

    #: The sidecar's cell-to-entity table.
    links: dict[str, Any]
    #: Every label the case holds of this type, folded, so five hundred rows ask the
    #: graph one question rather than five hundred.
    holders: dict[str, list[dict[str, str]]]
    #: And the same entities by identity key, for the family where the value *is* the
    #: identity.
    by_identity: dict[str, str]


def _labels_held(case: "Case", entity_type: str) -> dict[str, Any]:
    holders: dict[str, list[dict[str, str]]] = {}
    by_identity: dict[str, str] = {}
    for entity in case.list_entities():
        if entity.get("type") != entity_type:
            continue
        label = str(entity.get("label") or "").strip()
        holders.setdefault(label.casefold(), []).append({"id": entity["id"], "label": label})
        identity = entity_engine.identity_key(entity_type, label)
        if identity:
            by_identity.setdefault(identity, entity["id"])
    return {"holders": holders, "by_identity": by_identity}


def _key_of(row: list[str], at: int) -> str:
    return row[at] if at < len(row) else ""


def _blank_decision(key: str, label: str) -> dict[str, Any]:
    return {
        "key": key,
        "keys": [key],
        "label": label,
        "action": SKIP,
        "reason": "",
        "entity": None,
        "entity_label": "",
        "attrs": {},
        "points": [],
        "problems": [],
        "notes": [],
        "candidates": [],
        "repeat": False,
    }


def _read_row(
    row: list[str], shape: _Shape, problems: list[str], notes: list[str]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """One row as the fields it fills and the point it writes, if any.

    The point is two different things depending on the type, which is why it comes back
    separately: on a ``place`` it *is* the entity and goes into its own attrs; anywhere
    else it is a second entity the first one is joined to, because a latitude written onto
    a structure would be a field the app neither shows nor edits.

    ``problems`` stop the row; ``notes`` are said and the row goes on. A place with no
    readable point is nothing, so that is a problem — but a structure whose coordinates
    cell still reads `To be found` is a structure, and half the cells in a live binder
    read like that.
    """
    attrs: dict[str, Any] = {}
    for column, key in shape.mapping.items():
        value, problem = read_attr(shape.declared[key], row[shape.columns.index(column)])
        if problem:
            problems.append(problem)
        elif value is not None:
            attrs[key] = value
    if shape.point_at == -1:
        return attrs, []
    said: list[str] = []
    point = _read_point(row, shape.point_at, shape.columns[shape.point_at], said)
    if shape.entity_type == PLACE_TYPE:
        problems.extend(said)
        for key, value in point.items():
            # A column mapped onto the radius by hand beats the one read off the cell's
            # own decimals: the analyst knows how the point was established.
            attrs.setdefault(key, value)
        return attrs, []
    notes.extend(said)
    return attrs, [point] if point else []


def _settle(
    case: "Case",
    decision: dict[str, Any],
    shape: _Shape,
    held: _Held,
    chosen: dict[str, str],
    pointed: str | None,
) -> None:
    """Which of the five things this decision is: update, attach, join, make or fail.

    Shared by the row-by-row plan and the group plan, because the question is the same
    one — does the case already hold this, and did it get it from here — and two copies
    of it would answer differently the first time either was touched.
    """
    label = decision["label"]
    # What the row already points at, and only when it is still what was promoted: a cell
    # pointing at a place is not a person waiting to be overwritten.
    already = case.get_entity(pointed) if pointed else None
    if already is not None and already.get("type") == shape.entity_type:
        decision.update(
            action=UPDATE, entity=already["id"], entity_label=str(already.get("label") or "")
        )
        return
    if already is not None:
        decision["reason"] = (
            f"this cell already points at a {already.get('type')}, '{already.get('label')}'"
        )
        return

    picked = chosen.get(decision["key"])
    if picked:
        target = case.get_entity(picked)
        if target is None or target.get("type") != shape.entity_type:
            decision["action"] = ERROR
            decision["problems"] = ["the entity chosen for this row is gone"]
            decision["reason"] = decision["problems"][0]
            return
        decision.update(
            action=JOIN,
            entity=target["id"],
            entity_label=str(target.get("label") or ""),
            reason="attached by hand",
        )
        return

    # The one family where the value *is* the identity: two `email` entities holding one
    # address are a bug, not two objects (ONTOLOGY §2).
    key = entity_engine.identity_key(shape.entity_type, label)
    if key and key in held.by_identity:
        target_id = held.by_identity[key]
        decision.update(
            action=JOIN,
            entity=target_id,
            entity_label=str((case.get_entity(target_id) or {}).get("label") or ""),
            reason="the case already holds this one",
        )
        return

    decision["action"] = MAKE
    decision["candidates"] = held.holders.get(label.casefold(), [])[:MAX_CANDIDATES]


def _plan_rows(
    case: "Case",
    rows: list[list[str]],
    shape: _Shape,
    held: _Held,
    left_out: set[str],
    chosen: dict[str, str],
) -> list[dict[str, Any]]:
    """One entity per row, which is the ordinary promotion."""
    planned: list[dict[str, Any]] = []
    seen_labels: set[str] = set()
    for row in rows:
        identity = _key_of(row, shape.key_at)
        label = str(row[shape.label_at] if shape.label_at < len(row) else "").strip()
        decision = _blank_decision(identity, label)
        planned.append(decision)

        if identity in left_out:
            decision["reason"] = "left out"
            continue
        if not label:
            decision["reason"] = f"nothing in '{shape.label_column}' to name it"
            continue

        problems: list[str] = []
        notes: list[str] = []
        attrs, points = _read_row(row, shape, problems, notes)
        if problems:
            decision.update(action=ERROR, problems=problems, reason=problems[0])
            continue
        decision["attrs"] = attrs
        decision["points"] = points
        decision["notes"] = notes
        try:
            entity_engine.check_attrs(shape.entity_type, attrs)
        except CaseError as exc:
            decision.update(action=ERROR, problems=[str(exc)], reason=str(exc))
            continue

        if label.casefold() in seen_labels:
            decision["repeat"] = True
        seen_labels.add(label.casefold())

        _settle(
            case, decision, shape, held, chosen,
            held.links.get(identity, {}).get(shape.label_column),
        )
        if decision["action"] == MAKE and shape.link_at != -1:
            decision["sources"] = urls_in(str(row[shape.link_at]))
    return planned


def _plan_group(
    case: "Case",
    rows: list[list[str]],
    shape: _Shape,
    held: _Held,
    left_out: set[str],
    chosen: dict[str, str],
    group_label: str | None,
) -> list[dict[str, Any]]:
    """One entity out of all the rows, which is the case row-by-row gets wrong.

    Where two lines describe one thing — the binders' cross-border event, one line per
    country — promoting each of them makes a twin nobody asked for and nobody maintains.
    So the rows are read as one: the first answer wins per field, every point becomes its
    own place, and **every** row's cell ends up pointing at the one entity, which is what
    keeps a second press an update and lets the grid say the row is already in the case.

    A field two rows disagree about keeps the first and says so. That is not a tie-break
    dodged: rows grouped on purpose differ in the detail — that is why there are two of
    them — and refusing the group over it would refuse the shape it exists for.
    """
    taking = [row for row in rows if _key_of(row, shape.key_at) not in left_out]
    if not taking:
        first = _key_of(rows[0], shape.key_at) if rows else ""
        decision = _blank_decision(first, "")
        decision.update(keys=[_key_of(row, shape.key_at) for row in rows], reason="left out")
        return [decision]

    keys = [_key_of(row, shape.key_at) for row in taking]
    said = [str(row[shape.label_at] if shape.label_at < len(row) else "").strip() for row in taking]
    label = str(group_label or "").strip() or next((word for word in said if word), "")
    decision = _blank_decision(keys[0], label)
    decision["keys"] = keys
    decision["rows"] = len(keys)
    if not label:
        decision["reason"] = f"nothing in '{shape.label_column}' to name it"
        return [decision]

    attrs: dict[str, Any] = {}
    points: list[dict[str, Any]] = []
    problems: list[str] = []
    notes: list[str] = []
    conflicts: list[str] = []
    sources: list[str] = []
    for row in taking:
        row_attrs, row_points = _read_row(row, shape, problems, notes)
        for key, value in row_attrs.items():
            if key in attrs and attrs[key] != value:
                if key not in conflicts:
                    conflicts.append(shape.declared[key].label)
                continue
            attrs.setdefault(key, value)
        for point in row_points:
            if not any(_same_point(point, seen) for seen in points):
                points.append(point)
        if shape.link_at != -1:
            sources.extend(urls_in(str(row[shape.link_at])))
    if problems:
        decision.update(action=ERROR, problems=problems, reason=problems[0])
        return [decision]
    decision["attrs"] = attrs
    decision["points"] = points
    decision["notes"] = list(dict.fromkeys(notes))
    decision["conflicts"] = conflicts
    if conflicts:
        decision["reason"] = f"kept the first {', '.join(conflicts).lower()}"
    try:
        entity_engine.check_attrs(shape.entity_type, attrs)
    except CaseError as exc:
        decision.update(action=ERROR, problems=[str(exc)], reason=str(exc))
        return [decision]

    # Whichever of the grouped rows was promoted before answers for all of them: the
    # group is one entity, so one of its rows already pointing at it is the group
    # already being in the case.
    pointed = next(
        (
            held.links.get(key, {}).get(shape.label_column)
            for key in keys
            if held.links.get(key, {}).get(shape.label_column)
        ),
        None,
    )
    _settle(case, decision, shape, held, chosen, pointed)
    if decision["action"] == MAKE:
        decision["sources"] = list(dict.fromkeys(sources))
    return [decision]


def _same_point(one: dict[str, Any], other: dict[str, Any]) -> bool:
    """Whether two cells wrote the same ground, to the five decimals a cell is stored to."""
    return (round(one["lat"], 5), round(one["lon"], 5)) == (
        round(other["lat"], 5),
        round(other["lon"], 5),
    )


def _read_point(
    row: list[str], at: int, column: str, problems: list[str]
) -> dict[str, Any]:
    """A place's point, read out of one cell, with the precision it was written to.

    The radius is not decoration. A cell holding `48.85, 2.35` is a claim about a
    kilometre of ground, and a place stored without saying so reads on the map as a
    pinpoint somebody established. Darwin Core's rule, which the type already declares:
    the smallest circle containing the whole location.
    """
    point = sheetroles.parse_latlon(row[at] if at < len(row) else "")
    if point is None:
        problems.append(f"no point could be read in '{column}'")
        return {}
    if point["out_of_bounds"]:
        problems.append(f"'{row[at]}' is off the globe")
        return {}
    radius = sheetroles.precision_metres(point["decimals"])
    return {
        "lat": point["lat"],
        "lon": point["lon"],
        "radius_m": max(1, min(entity_engine.MAX_RADIUS_M, radius)),
    }


def counts_of(planned: list[dict[str, Any]]) -> dict[str, int]:
    """How many decisions of each kind a plan holds. Public because every road through
    this app's promotion answers in the same five words, and a second tally would be a
    second reading of the same list."""
    return {action: sum(1 for row in planned if row["action"] == action) for action in ACTIONS}


# -- doing it ------------------------------------------------------------------


def promote_rows(
    case: "Case",
    sheet_id: str,
    *,
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    keys: list[str],
    entity_type: str,
    label_column: str,
    attr_columns: dict[str, str] | None = None,
    point_column: str | None = None,
    link_column: str | None = None,
    attach: dict[str, str] | None = None,
    skip: list[str] | None = None,
    group: bool = False,
    group_label: str | None = None,
) -> dict[str, Any]:
    """Execute the plan these arguments describe, and give back what it did.

    Returns the plan itself alongside the counts and the sidecar links earned, so the
    grid can say what happened per row rather than only how many rows there were.

    Nothing is handed back for a compensating undo. The whole press runs inside the
    caller's `case.batch()`, so a refusal anywhere leaves the case exactly as it was —
    which is the transaction's promise and not a list of ids to walk backwards.
    """
    reading = plan(
        case,
        columns=columns,
        rows=rows,
        meta=meta,
        keys=keys,
        entity_type=entity_type,
        label_column=label_column,
        attr_columns=attr_columns,
        point_column=point_column,
        link_column=link_column,
        attach=attach,
        skip=skip,
        group=group,
        group_label=group_label,
    )
    links = {identity: dict(cells) for identity, cells in (meta.get("links") or {}).items()}
    # What each cell said at the moment the case took it. Kept so the row can say later
    # that it has moved on: a link alone cannot, since it is still the same link after
    # the label is rewritten.
    said = {identity: dict(cells) for identity, cells in (meta.get("promoted") or {}).items()}
    sources: dict[str, str] = {}
    verb = reading["verb"] or None
    # Every place the case already holds, read **once** for the whole press. `_place` used
    # to build this itself, which put a full walk of the graph inside the row loop and
    # inside the write lock: five hundred rows over twenty thousand entities materialised
    # ten million rows while every other writer waited on `busy_timeout`. Threaded through
    # instead, so the places this press mints are deduplicated against each other too.
    at_point = _places_held(case) if verb else {}

    for decision in reading["rows"]:
        action = decision["action"]
        attrs = decision["attrs"]
        target: str | None = decision["entity"]
        if action == MAKE:
            entity = case.add_entity(entity_type, decision["label"], attrs, by=BY)
            target = entity["id"]
        elif action == UPDATE and target:
            patch: dict[str, Any] = {"label": decision["label"]}
            if attrs:
                patch["attrs"] = attrs
            case.update_entity(target, patch)
        elif action == JOIN and target:
            if attrs:
                case.update_entity(target, {"attrs": attrs})
        else:
            continue
        if target:
            # Every key, which is one for an ordinary row and all of them for a group:
            # the group is one entity, so each of its rows points at it and each of them
            # can say it is already in the case.
            for key in decision.get("keys") or [decision["key"]]:
                links.setdefault(key, {})[label_column] = target
                said.setdefault(key, {})[label_column] = decision["label"]
            if verb:
                _place(case, decision, target, verb, at_point)
            for url in decision.get("sources", ()):
                cite_source(case, url, target, sources)

    # The whole sidecar, not the links alone: a sheet also mentions the words a column
    # promotion pointed at the case and the pieces its rows carry, and restating from
    # half of it would take those edges down on every promotion.
    sync_mentions(case, sheet_id, {**meta, "links": links})
    return {
        "links": links,
        "promoted": said,
        "plan": reading["rows"],
        **reading["counts"],
    }


def _places_held(case: "Case") -> dict[tuple[float, float], str]:
    """Every place the case holds, by its rounded point.

    Read once per press and never per row, the same rule `_labels_held` states: this is a
    walk of the whole catalog, and it runs inside the transaction that holds SQLite's write
    lock.
    """
    return {
        (round(float(entity["attrs"]["lat"]), 5), round(float(entity["attrs"]["lon"]), 5)): str(
            entity["id"]
        )
        for entity in case.list_entities()
        if entity.get("type") == PLACE_TYPE
        and isinstance((entity.get("attrs") or {}).get("lat"), (int, float))
        and isinstance((entity.get("attrs") or {}).get("lon"), (int, float))
    }


def _place(
    case: "Case",
    decision: dict[str, Any],
    subject: str,
    verb: str,
    at_point: dict[tuple[float, float], str],
) -> None:
    """File the points a row wrote as places, and join the row's entity to them.

    The other half of "one event, two lines": a cross-border strike is two rows because
    it happened at two points, and the entity is one. Each distinct point becomes a place
    and each place gets an edge, so the map draws both and the Graph shows one subject.

    A point the case already holds is **joined rather than filed again**, matched on the
    coordinates themselves rather than on a name: a place is the only entity in this app
    whose identity is a number, and two pins a metre apart with different labels are the
    duplicate nobody notices until the map is unreadable.

    A relation the vocabulary refuses is skipped rather than raised, like a citation: the
    place is still worth having, and taking the promotion down over an edge would lose
    the rows that had nothing wrong with them.

    The places a row ended up at are recorded back onto its decision. A place is the one
    thing a promotion files that the sidecar cannot name — a cell holds the coordinates,
    not the entity — so without this the only record of which place a row made would be
    the edge itself, and a caller drawing a *second* edge to that place (a column of media
    joined to the row's point) would have nothing to aim at.

    *at_point* is the caller's index of the places the case holds, read once for the press
    and added to here: a walk of the graph per row is what this used to cost.
    """
    filed: list[str] = decision.setdefault("places", [])
    for point in decision.get("points") or ():
        key = (round(point["lat"], 5), round(point["lon"], 5))
        target = at_point.get(key)
        if target is None:
            made = case.add_entity(PLACE_TYPE, decision["label"], dict(point), by=BY)
            target = str(made["id"])
            at_point[key] = target
        if target not in filed:
            filed.append(target)
        try:
            link_engine.add_relation(case, subject, target, verb, by=BY)
        except CaseError:
            continue


def urls_in(text: str) -> list[str]:
    """Every http address a cell holds, in the order it holds them.

    One reader for a column of sources, because two of them would disagree about where a
    link ends the first time one sat inside a parenthesis.
    """
    return _URL.findall(str(text))


def cite_source(
    case: "Case",
    url: str,
    subject: str,
    seen: dict[str, str],
) -> None:
    """File a link column's URL as a bookmark that mentions the row's entity.

    A page in a worklist is a source, and a source the case can point at is worth more
    than a string in a cell: it carries its own reliability and it is reachable from
    the subject's side. Filed once per URL per promotion and matched against what the
    case already holds, so a page cited by forty rows is one bookmark with forty edges.

    A relation the vocabulary refuses is skipped rather than raised: the bookmark is
    still worth having, and taking the promotion down over an edge would lose the rows
    that had nothing wrong with them.
    """
    target = seen.get(url)
    if target is None:
        found = case.find_entity(attr=URL_ATTR, value=url)
        if found is not None and found.get("type") == "bookmark":
            target = found["id"]
        else:
            host = urlsplit(url).hostname or url
            entity = case.add_entity(
                "bookmark", host, {URL_ATTR: url, "site": host, "folder": ""}, by=BY
            )
            target = entity["id"]
        seen[url] = target
    try:
        link_engine.add_relation(case, target, subject, link_engine.MENTIONS, by=BY)
    except CaseError:
        return


# -- a whole column, and the words in it the case has no answer for -----------
#
# Creating and attaching are one question here, asked once per word: the case is asked
# what it holds spelled exactly that way, one answer attaches, none creates, and two are
# offered and never merged. They used to be two screens and two roads, which meant a pass
# whose halves each knew half of the plan.
#
# The grain is the **word**, not the row, and that is the whole reason it works: a column
# of four hundred rows holds forty pieces of equipment, so the case is asked forty
# questions and forty entities come out, not four hundred. Which is also why what it
# writes back is a vocabulary (`meta["values"]`) and not a link per cell: a cell reading
# `Buk-M2E, ZU23-2, S-125` points at three things, and one cell cannot hold three links.


def column_words(
    columns: list[str], rows: list[list[str]], column: str, role: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """The distinct words of one column, most-said first, with the rows saying each.

    Split on the column's own separator, so a cell listing three pieces of equipment is
    three words. Ordered by how many rows say them, because that is the order in which
    somebody reads a plan they are about to press.
    """
    at = columns.index(column)
    key_at = key_index(columns)
    held: dict[str, dict[str, Any]] = {}
    for row in rows:
        identity = _key_of(row, key_at)
        for word in sheetroles.split_values(row[at] if at < len(row) else "", role):
            entry = held.setdefault(word, {"value": word, "keys": []})
            if identity not in entry["keys"]:
                entry["keys"].append(identity)
    return sorted(held.values(), key=lambda entry: (-len(entry["keys"]), entry["value"]))


def plan_column(
    case: "Case",
    *,
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    column: str,
    entity_type: str,
    attach: dict[str, str] | None = None,
    skip: list[str] | None = None,
) -> dict[str, Any]:
    """What promoting this column's words would do, word by word, without doing it.

    Same five answers as a row promotion and the same rule underneath: **a name is not an
    identity**. A word the case holds once is joined; a word it holds twice is offered and
    left alone, because choosing between two units with one name is the analyst's
    judgement and a route that picked would be the merge this app refuses everywhere.
    """
    if entity_type not in promotable_types():
        raise SheetError(f"'{entity_type}' is not a type a column can become")
    if entity_type == PLACE_TYPE:
        raise SheetError("a place needs coordinates, so it is promoted from rows and not words")
    if column not in columns:
        raise SheetError(f"this sheet has no column '{column}'")

    role = ((meta.get("roles") or {}) if isinstance(meta, dict) else {}).get(column)
    words = column_words(columns, rows, column, role)
    if len(words) > MAX_COLUMN_WORDS:
        raise SheetError(
            f"'{column}' holds {len(words)} different words; at most {MAX_COLUMN_WORDS} "
            "can be promoted at once"
        )
    held = _Held(links={}, **_labels_held(case, entity_type))
    meant = ((meta.get("values") or {}) if isinstance(meta, dict) else {}).get(column) or {}
    left_out = set(skip or [])
    chosen = attach or {}

    planned: list[dict[str, Any]] = []
    for entry in words:
        word = entry["value"]
        decision: dict[str, Any] = {
            "key": word,
            "value": word,
            "label": word,
            "keys": entry["keys"],
            "rows": len(entry["keys"]),
            "action": SKIP,
            "reason": "",
            "entity": None,
            "entity_label": "",
            "candidates": [],
        }
        planned.append(decision)
        if word in left_out:
            decision["reason"] = "left out"
            continue

        # What this word already means in this column, and only while the case still
        # holds it as the type being promoted.
        was = str(meant.get(word) or "")
        already = case.get_entity(was) if was else None
        if already is not None and already.get("type") == entity_type:
            decision.update(
                action=UPDATE,
                entity=already["id"],
                entity_label=str(already.get("label") or ""),
                reason="already promoted from this column",
            )
            continue

        picked = chosen.get(word)
        if picked:
            target = case.get_entity(picked)
            if target is None or target.get("type") != entity_type:
                decision.update(
                    action=ERROR, reason="the entity chosen for this word is gone"
                )
                continue
            decision.update(
                action=JOIN,
                entity=target["id"],
                entity_label=str(target.get("label") or ""),
                reason="attached by hand",
            )
            continue

        holders = held.holders.get(word.casefold(), [])
        if len(holders) == 1:
            decision.update(
                action=JOIN,
                entity=holders[0]["id"],
                entity_label=holders[0]["label"],
                reason="the case already holds this one",
            )
            continue
        if holders:
            decision["candidates"] = holders[:MAX_CANDIDATES]
            decision["reason"] = f"the case holds {len(holders)} of this name"
            continue

        try:
            entity_engine.check_attrs(entity_type, {})
        except CaseError as exc:  # pragma: no cover - no declared field is required
            decision.update(action=ERROR, reason=str(exc))
            continue
        decision["action"] = MAKE

    return {
        "rows": planned,
        "counts": counts_of(planned),
        "type": entity_type,
        "column": column,
        "multi": bool((role or {}).get("multi")) if isinstance(role, dict) else False,
    }


def promote_column(
    case: "Case",
    sheet_id: str,
    *,
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    column: str,
    entity_type: str,
    attach: dict[str, str] | None = None,
    skip: list[str] | None = None,
) -> dict[str, Any]:
    """Execute that plan: make what is missing, join what is not, and record the meaning.

    Two things are written back, and they answer two different questions.
    ``meta["values"][column]`` says **what a word means** — that is what makes a second
    press an update, what keeps the sheet's `mentions` edges alive, and the only thing
    that can be said at all about a cell holding three values.
    ``meta["links"]`` says **what a row points at**, and it is written only for a column
    with no separator: it is the one the computed natures read, and a row pointing at the
    third of its three pieces of equipment would be an answer nobody could interpret.
    A link the analyst made by hand is never overwritten.
    """
    reading = plan_column(
        case,
        columns=columns,
        rows=rows,
        meta=meta,
        column=column,
        entity_type=entity_type,
        attach=attach,
        skip=skip,
    )
    values = {name: dict(words) for name, words in (meta.get("values") or {}).items()}
    links = {identity: dict(cells) for identity, cells in (meta.get("links") or {}).items()}
    said = {identity: dict(cells) for identity, cells in (meta.get("promoted") or {}).items()}
    meant = values.setdefault(column, {})

    for decision in reading["rows"]:
        target: str | None = decision["entity"]
        if decision["action"] == MAKE:
            entity = case.add_entity(entity_type, decision["value"], {}, by=BY)
            target = entity["id"]
        elif decision["action"] not in (JOIN, UPDATE):
            continue
        if not target:
            continue
        meant[decision["value"]] = target
        if reading["multi"]:
            continue
        for key in decision["keys"]:
            if links.get(key, {}).get(column):
                continue
            links.setdefault(key, {})[column] = target
            said.setdefault(key, {})[column] = decision["value"]

    sync_mentions(case, sheet_id, {**meta, "links": links, "values": values})
    return {
        "values": values,
        "links": links,
        "promoted": said,
        "plan": reading["rows"],
        **reading["counts"],
    }


# -- one row's column pointing at another row, as real edges ------------------


#: The verbs a `row` column may become. Both run from the row to what it names, which is
#: the direction the binders' own column read: a company's line names its brigade. Kept
#: to two rather than opened to the whole vocabulary, because those two are what an order
#: of battle is made of and a select of eighteen verbs is a select nobody reads.
ROW_LINK_VERBS = ("part-of", "member-of")

def _pair_allows(from_type: str, to_type: str, verb: str) -> None:
    """The type-only half of `check_relation_target`, for a pair neither end of which has
    been filed yet. Media kinds cannot be read off a type, so the press still validates
    every resolved pair before it writes one."""
    if verb not in {spec.type for spec in link_engine.pair_verbs(from_type, to_type)}:
        raise CaseError(f"a {from_type} cannot be the subject of '{verb}' to a {to_type}")


def plan_row_links(
    case: "Case",
    *,
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    column: str,
    verb: str,
    coming: dict[str, dict[str, dict[str, str]]] | None = None,
) -> dict[str, Any]:
    """What turning this column of row names into edges would do, row by row.

    The binders wrote an order of battle as text — a brigade listing its companies, each
    company naming its brigade back — with a spreadsheet validation holding the names
    together. That validation cannot survive a row moving and theirs had **already**
    decayed to `#REF!`. Here it is neither text nor a validation: both rows are entities
    the case holds, and what joins them is an edge the Graph already draws.

    Which means both ends have to have been promoted first, and a row whose end has not
    been is said rather than guessed at: there is no honest way to invent the entity a
    name refers to at the moment an edge is being drawn to it.

    First, not before: `coming` is one press telling this plan which rows the mode ahead
    of it will have promoted (`engine/sheetpass.py`). An order of battle lands in a single
    press, so a plan reading only the sidecar on disk would report every edge missing an
    end and then watch the press draw them all. Neither end has an id yet in that case, so
    the pair is checked on its types, which is all `pair_verbs` ever needed.
    """
    if verb not in ROW_LINK_VERBS:
        raise SheetError(f"a row column cannot become '{verb}'")
    if column not in columns:
        raise SheetError(f"this sheet has no column '{column}'")
    role = ((meta.get("roles") or {}) if isinstance(meta, dict) else {}).get(column) or {}
    if role.get("kind") != "row":
        raise SheetError(f"'{column}' is not a column of row names")

    named = role.get("of")
    if not isinstance(named, str) or named not in columns:
        named = next((name for name in columns if name != columns[key_index(columns)]), "")
    links = (meta.get("links") or {}) if isinstance(meta, dict) else {}
    promised = (coming or {}).get(named, {}) if isinstance(named, str) else {}
    targets = sheetroles.row_targets(columns, rows, column, role)
    labels = {
        _key_of(row, key_index(columns)): str(
            row[columns.index(named)] if named in columns else ""
        ).strip()
        for row in rows
    }

    def _end(key: str) -> tuple[dict[str, Any] | None, str]:
        """What this row designates: in the case already, or by the time the press is
        through. The second answer says which of the two it was missing."""
        found = str(links.get(key, {}).get(named) or "")
        if found:
            held = case.get_entity(found)
            return held, ("" if held is not None else "gone")
        return promised.get(key), ("" if key in promised else "missing")

    planned: list[dict[str, Any]] = []
    for identity, found in targets.items():
        for word in found["missing"]:
            planned.append({
                "key": identity,
                "label": labels.get(identity, identity),
                "target": "",
                "target_label": word,
                "action": ERROR,
                "reason": f"no single row is called '{word}'",
            })
        source, why_source = _end(identity)
        for other in found["keys"]:
            decision = {
                "key": identity,
                "label": labels.get(identity, identity),
                "target": other,
                "target_label": labels.get(other, other),
                "action": SKIP,
                "reason": "",
            }
            planned.append(decision)
            target, why_target = _end(other)
            if "missing" in (why_source, why_target):
                which = (
                    decision["label"] if why_source == "missing" else decision["target_label"]
                )
                decision["reason"] = f"'{which}' is not in the case yet"
                continue
            if source is None or target is None:
                decision["reason"] = "one of these two is gone from the case"
                continue
            try:
                end = str(target.get("id") or "")
                if end and source.get("id"):
                    link_engine.check_relation_target(case, source, end, verb)
                else:
                    _pair_allows(str(source.get("type")), str(target.get("type")), verb)
            except CaseError as exc:
                decision.update(action=ERROR, reason=str(exc))
                continue
            decision["action"] = MAKE
    return {"rows": planned, "counts": counts_of(planned), "verb": verb, "column": column}


def promote_row_links(
    case: "Case",
    *,
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    column: str,
    verb: str,
) -> dict[str, Any]:
    """Draw the edges that plan describes.

    Nothing is written to the sidecar: the edge lives in the graph, which is where a
    relation belongs, and the cell keeps the words it always held. Re-pressing restates
    the same edges, which `add_relation` already makes idempotent.
    """
    reading = plan_row_links(
        case, columns=columns, rows=rows, meta=meta, column=column, verb=verb
    )
    links = (meta.get("links") or {}) if isinstance(meta, dict) else {}
    named = ((meta.get("roles") or {}).get(column) or {}).get("of")
    if not isinstance(named, str) or named not in columns:
        named = next((name for name in columns if name != columns[key_index(columns)]), "")
    drawn = 0
    for decision in reading["rows"]:
        if decision["action"] != MAKE:
            continue
        source = links.get(decision["key"], {}).get(named)
        target = links.get(decision["target"], {}).get(named)
        try:
            link_engine.add_relation(case, source, target, verb, by=BY)
        except CaseError as exc:
            decision.update(action=ERROR, reason=str(exc))
            continue
        drawn += 1
    return {"drawn": drawn, "plan": reading["rows"], **counts_of(reading["rows"])}
