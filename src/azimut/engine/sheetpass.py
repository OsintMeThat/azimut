"""One pass of a sheet into the case: what each column becomes, then the edges between.

Six roads out of a sheet is what this replaces. Promoting rows, promoting a column's
words, pointing a column at what the case already holds, dating a column of hours,
turning a column of row names into edges — five presses, five plans to read, and nothing
joining what any of them produced. A line of a binder says *this person, in that unit,
seen in this video, at that point*; the case got the four nodes and lost the sentence.

So a pass is **one declaration and one press**. Each column takes a mode, the modes run
in the order their answers depend on each other, and then the edges between the columns
are drawn from the vocabulary's own reading of the pair. Nothing here is a new engine:
`sheetpromote` and `sheetclaims` already hold every write, and this module is the order
they run in plus the layer none of them could see — an edge needs *two* columns, and a
road that promotes one column at a time can never be the thing that draws it.

**The whole pass is one transaction** (`case.batch()`). That is affordable precisely
because nothing here touches the network: the road that downloads files is atomic per row
instead, for the opposite reason. It also means the sheet's own save happens *inside* the
batch, so a file that moved under the analyst rolls the graph back on its way out rather
than leaving entities to be swept up by a compensating undo.

What a pass may not do, ever: **create anything that owns a file.** A `media`, a
`capture`, a `proof`, a `post` hold bytes, and a cell holds an address. Here an address
becomes a `bookmark`, which claims to be nothing but the address. Going to fetch the file
is the other road out of a sheet (`engine/sheetproofs.py`, which drives
`engine/proofimport.py` a row at a time), and only what fetches the bytes may state what
it observed of them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from ..workspace import CaseError
from . import links as link_engine
from . import sheetclaims, sheetpromote, sheetroles
from .sheets import SheetError, key_index
from .sheetpromote import ACTIONS, JOIN, MAKE, UPDATE

if TYPE_CHECKING:
    from ..workspace import Case

#: What a column may become. `ignore` is the default and the honest one: a worklist's
#: private notes have no business in the case's record of a subject, so a column travels
#: only when it was asked for.
MODES = ("ignore", "row", "value", "point", "addresses", "statement", "row-edges")

#: The modes that make something an edge can end at, in the order the join layer offers
#: them. `addresses` is absent on purpose: a bookmark already arrives holding a `mentions`
#: edge to the row's subject, so joining it a second time would state it twice.
POINTING = ("row", "value", "point")


class _Column:
    """One column's declaration, after the door has read it."""

    __slots__ = ("name", "mode", "type", "verb", "attach", "skip")

    def __init__(
        self,
        name: str,
        mode: str,
        *,
        type_: str = "",
        verb: str = "",
        attach: dict[str, str] | None = None,
        skip: list[str] | None = None,
    ) -> None:
        self.name = name
        self.mode = mode
        self.type = type_
        self.verb = verb
        self.attach = attach or {}
        self.skip = skip or []


@dataclass(frozen=True)
class _Join:
    """One ordered pair of columns and the verb the analyst picked between them."""

    from_column: str
    to_column: str
    verb: str


@dataclass(frozen=True)
class _Pass:
    """A validated declaration: what each column becomes and what joins what."""

    columns: list[str]
    rows: list[list[str]]
    meta: dict[str, Any]
    keys: list[str]
    key_at: int
    #: The one column in `row` mode, or None when the pass promotes no subject.
    subject: _Column | None
    #: Column name to the declared field it fills, for the subject's own type.
    fields: dict[str, str]
    point: str
    addresses: str
    group: bool
    group_label: str
    values: list[_Column]
    statement: dict[str, Any] | None
    row_edges: list[_Column]
    joins: list[_Join]
    confidence: int | None
    #: Every column that ends up designating something, by name, with its mode and type.
    pointing: dict[str, _Column] = field(default_factory=dict)


def read(
    case: "Case",
    *,
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    keys: list[str],
    subject: dict[str, Any] | None = None,
    point: str = "",
    addresses: str = "",
    values: list[dict[str, Any]] | None = None,
    statement: dict[str, Any] | None = None,
    row_edges: list[dict[str, Any]] | None = None,
    joins: list[dict[str, Any]] | None = None,
    confidence: int | None = None,
) -> _Pass:
    """Read one declaration, or refuse it at the door with the reason.

    Everything a plan and a press both have to agree about is settled here, once: a
    second reading in the writing half is a second reading that will disagree with this
    one the first time either is touched.
    """
    if len(keys) > sheetpromote.MAX_PROMOTED:
        raise SheetError(
            f"at most {sheetpromote.MAX_PROMOTED} rows can be sent to the case at once"
        )
    for name in (point, addresses):
        if name and name not in columns:
            raise SheetError(f"this sheet has no column '{name}'")

    subject_column: _Column | None = None
    if subject:
        name = str(subject.get("column") or "")
        if name not in columns:
            raise SheetError(f"this sheet has no column '{name}'")
        subject_column = _Column(
            name,
            "row",
            type_=str(subject.get("type") or ""),
            attach=subject.get("attach") or {},
            skip=subject.get("skip") or [],
        )

    read_values: list[_Column] = []
    for entry in values or []:
        name = str(entry.get("column") or "")
        if name not in columns:
            raise SheetError(f"this sheet has no column '{name}'")
        if subject_column and name == subject_column.name:
            raise SheetError(f"'{name}' cannot both be the subject and a column of values")
        if any(name == other.name for other in read_values):
            raise SheetError(f"'{name}' is declared twice")
        read_values.append(
            _Column(
                name,
                "value",
                type_=str(entry.get("type") or ""),
                attach=entry.get("attach") or {},
                skip=entry.get("skip") or [],
            )
        )

    read_edges: list[_Column] = []
    for entry in row_edges or []:
        name = str(entry.get("column") or "")
        if name not in columns:
            raise SheetError(f"this sheet has no column '{name}'")
        read_edges.append(_Column(name, "row-edges", verb=str(entry.get("verb") or "")))

    # A row promoted *as* a place has its coordinates in a column, and most often that is
    # the very column it was declared on: in a geolocation index the point is the entity,
    # not a second one it is joined to. Asking for it twice is a question with one possible
    # answer, so it is only asked when the subject column holds no point of its own — where
    # the subject is a column of names, the door still says what is missing.
    if subject_column and subject_column.type == sheetpromote.PLACE_TYPE and not point:
        if _holds_points(columns, rows, keys, subject_column.name):
            point = subject_column.name

    if point and subject_column is None:
        raise SheetError("a column of coordinates needs the column naming what sits there")
    if point and subject_column and subject_column.type != sheetpromote.PLACE_TYPE:
        if not sheetpromote.place_verb(subject_column.type):
            raise SheetError(
                f"the vocabulary has no way to put a {subject_column.type} at a place"
            )
    if addresses and subject_column is None:
        raise SheetError("a column of addresses needs the column naming what they are about")
    if statement is not None and subject_column is None:
        raise SheetError("a statement needs the column naming what it is about")

    pointing: dict[str, _Column] = {}
    if subject_column:
        pointing[subject_column.name] = subject_column
    for column in read_values:
        pointing[column.name] = column
    if point and subject_column:
        # A point column designates a place either way, so the pair reads the same to the
        # registry. What differs is where the id comes from: on a `place` subject the point
        # *is* the entity and the sidecar names it, anywhere else it is a second entity the
        # row promotion filed. `_ends_*` is where that fork lives.
        pointing[point] = _Column(point, "point", type_=sheetpromote.PLACE_TYPE)

    read_joins: list[_Join] = []
    for entry in joins or []:
        start, end = str(entry.get("from") or ""), str(entry.get("to") or "")
        verb = str(entry.get("verb") or "")
        if start not in pointing or end not in pointing:
            raise SheetError("a join runs between two columns that designate something")
        if start == end:
            raise SheetError(f"'{start}' cannot be joined to itself")
        allowed = link_engine.pair_verbs(pointing[start].type, pointing[end].type)
        if verb not in {spec.type for spec in allowed}:
            readable = ", ".join(spec.type for spec in allowed) or "nothing"
            raise SheetError(
                f"the vocabulary joins a {pointing[start].type} to a "
                f"{pointing[end].type} by {readable}"
            )
        read_joins.append(_Join(start, end, verb))

    if confidence is not None and confidence not in link_engine.CONFIDENCE_STATES:
        raise SheetError(f"'{confidence}' is not a confidence")

    fields = {
        column: attr
        for column, attr in ((subject or {}).get("fields") or {}).items()
        if column in columns
    }
    return _Pass(
        columns=columns,
        rows=rows,
        meta=meta if isinstance(meta, dict) else {},
        keys=keys,
        key_at=key_index(columns),
        subject=subject_column,
        fields=fields,
        point=point,
        addresses=addresses,
        group=bool((subject or {}).get("group")),
        group_label=str((subject or {}).get("group_label") or ""),
        values=read_values,
        statement=statement,
        row_edges=read_edges,
        joins=read_joins,
        confidence=confidence,
        pointing=pointing,
    )


# -- what one press would do ---------------------------------------------------


def plan(case: "Case", **asked: Any) -> dict[str, Any]:
    """Both layers of one pass, counted, with nothing written.

    The entity layer is each mode's own plan, unchanged — the same five words every road
    in this app answers in. The edge layer is the one that could not exist before: for
    each pair the analyst joined, how many rows have **both** ends, and which rows have
    only one and why. A row whose subject is ambiguous keeps its entities and loses its
    edges, and it says so here rather than at the moment the edge is not drawn.
    """
    reading = read(case, **asked)
    layers = _entity_plans(case, reading)
    return {
        "entities": layers,
        "joins": _join_plans(reading, layers),
        "confidence": reading.confidence,
    }


def _entity_plans(case: "Case", reading: _Pass) -> list[dict[str, Any]]:
    """Each declared mode's own plan, in the order the press will run them."""
    plans: list[dict[str, Any]] = []
    if reading.subject:
        plans.append({
            "mode": "row",
            "column": reading.subject.name,
            **sheetpromote.plan(case, **_row_arguments(reading)),
        })
    for column in reading.values:
        plans.append({
            "mode": "value",
            "column": column.name,
            **sheetpromote.plan_column(
                case,
                columns=reading.columns,
                rows=reading.rows,
                meta=reading.meta,
                column=column.name,
                entity_type=column.type,
                attach=column.attach,
                skip=column.skip,
            ),
        })
    coming = _coming(reading, plans)
    if reading.statement is not None:
        plans.append({
            "mode": "statement",
            "column": str(reading.statement.get("when_column") or ""),
            **sheetclaims.plan(case, **_statement_arguments(reading), coming=coming),
        })
    for column in reading.row_edges:
        plans.append({
            "mode": "row-edges",
            "column": column.name,
            **sheetpromote.plan_row_links(
                case,
                columns=reading.columns,
                rows=reading.rows,
                meta=reading.meta,
                column=column.name,
                verb=column.verb,
                coming=coming,
            ),
        })
    return plans


def _coming(
    reading: _Pass, plans: list[dict[str, Any]]
) -> dict[str, dict[str, dict[str, str]]]:
    """Per column, per row key, what that column will designate once the press is through.

    The press threads the sidecar from one mode to the next, so a statement sees the
    subject the same press just promoted. A plan has no sidecar to thread, and without
    this it reads the one on disk: every statement of a fresh sheet comes back "not in
    the case yet", and then the press files every one of them. The two halves of one
    screen disagreeing about the same rows is the one thing a plan may not do.

    What travels is what an entity is asked for downstream — the type, the label, and the
    id where there already is one. A row about to be made has no id, and that is exactly
    the case `case.get_entity` cannot answer.
    """
    found: dict[str, dict[str, dict[str, str]]] = {}
    if reading.subject:
        promised: dict[str, dict[str, str]] = {}
        for key, decision in _decisions_by_key(_layer_rows(plans, mode="row")).items():
            if decision.get("action") in RESOLVING:
                promised[key] = {
                    "id": str(decision.get("entity") or ""),
                    "type": reading.subject.type,
                    "label": str(decision.get("label") or ""),
                }
        found[reading.subject.name] = promised
    for column in reading.values:
        layer = next(
            (
                entry
                for entry in plans
                if entry.get("mode") == "value" and entry.get("column") == column.name
            ),
            None,
        )
        # A column with a separator writes no link — a row pointing at the third of its
        # three pieces of kit is an answer nobody could read — so it promises nothing.
        if layer is None or layer.get("multi"):
            continue
        promised = {}
        for decision in layer.get("rows") or []:
            if decision.get("action") not in RESOLVING:
                continue
            for key in decision.get("keys") or []:
                promised[str(key)] = {
                    "id": str(decision.get("entity") or ""),
                    "type": column.type,
                    "label": str(decision.get("value") or ""),
                }
        found[column.name] = promised
    return found


def _row_arguments(reading: _Pass) -> dict[str, Any]:
    subject = reading.subject
    assert subject is not None  # the caller checked; kept for the type reader
    return {
        "columns": reading.columns,
        "rows": reading.rows,
        "meta": reading.meta,
        "keys": reading.keys,
        "entity_type": subject.type,
        "label_column": subject.name,
        "attr_columns": reading.fields,
        "point_column": reading.point or None,
        "link_column": reading.addresses or None,
        "attach": subject.attach,
        "skip": subject.skip,
        "group": reading.group,
        "group_label": reading.group_label or None,
    }


def _statement_arguments(reading: _Pass) -> dict[str, Any]:
    """The claims engine's own arguments, with the subject and scope this pass settled.

    Passed through rather than re-derived: a column of hours becoming a dated statement is
    entirely `engine/sheetclaims.py`, and what was missing was never the engine — it was
    a screen that said the time promotes here.
    """
    subject = reading.subject
    assert subject is not None
    asked = dict(reading.statement or {})
    asked.pop("subject_column", None)
    return {
        "columns": reading.columns,
        "rows": reading.rows,
        "meta": reading.meta,
        "keys": reading.keys,
        "subject_column": subject.name,
        **asked,
    }


# -- the layer that needed two columns -----------------------------------------


def _holds_points(
    columns: list[str], rows: list[list[str]], keys: list[str], column: str
) -> bool:
    """Whether this column reads as coordinates in any of the rows being sent."""
    at = columns.index(column)
    wanted = set(keys)
    key_at = key_index(columns)
    for row in rows:
        if _key_of(row, key_at) not in wanted:
            continue
        if at < len(row) and sheetroles.parse_latlon(row[at]):
            return True
    return False


def _key_of(row: list[str], at: int) -> str:
    """A row's identity, which is the column the sheet reserves for it."""
    return row[at] if at < len(row) else ""


def _cell(row: list[str], columns: list[str], name: str) -> str:
    at = columns.index(name)
    return str(row[at]) if at < len(row) else ""


def _words_of(reading: _Pass, row: list[str], column: str) -> list[str]:
    """A value column's words in one row, split on the column's own separator.

    Which is what makes `Buk-M2E, ZU23-2, S-125` three edges from the row's subject
    rather than one to a thing called all three: the sidecar already holds a meaning per
    word, so the fan is free.
    """
    role = (reading.meta.get("roles") or {}).get(column)
    return sheetroles.split_values(_cell(row, reading.columns, column), role)


def _decisions_by_key(plan_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """A row plan by row key. A group's one decision answers for every key it holds."""
    found: dict[str, dict[str, Any]] = {}
    for decision in plan_rows:
        for key in decision.get("keys") or [decision.get("key", "")]:
            found[str(key)] = decision
    return found


def _by_word(plan_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(decision.get("value", "")): decision for decision in plan_rows}


def _layer_rows(
    layers: list[dict[str, Any]], *, mode: str = "", column: str = ""
) -> list[dict[str, Any]]:
    """One layer's own row decisions, by the mode or the column that produced them."""
    for layer in layers:
        if (mode and layer.get("mode") == mode) or (column and layer.get("column") == column):
            found = layer.get("rows") or layer.get("plan") or []
            return found if isinstance(found, list) else []
    return []


#: The three answers that mean a column will have an entity for a row once the press is
#: through. `SKIP` and `ERROR` mean it will not, which is what leaves an edge with one end.
RESOLVING = (MAKE, JOIN, UPDATE)


def _point_is_subject(reading: _Pass) -> bool:
    """Whether the point column and the subject column name the same entity.

    They do when the rows are being promoted *as* places: the coordinates are the entity's
    own, so the sidecar already names it. Anywhere else the point is a second entity the
    row was joined to, and only the row plan knows which one."""
    return bool(reading.subject and reading.subject.type == sheetpromote.PLACE_TYPE)


def _ends_at_plan(
    reading: _Pass, layers: list[dict[str, Any]], column: str
) -> dict[str, tuple[bool, str]]:
    """Per row key, whether this column will designate something, and why not if it will
    not. Read off the plans rather than the graph: a `make` has no id yet and is still an
    end, which is the whole reason both layers can be counted before anything is written.
    """
    held = reading.pointing[column]
    answer: dict[str, tuple[bool, str]] = {}
    if held.mode in ("row", "point"):
        found = _decisions_by_key(_layer_rows(layers, mode="row"))
        for key in reading.keys:
            decision = found.get(key)
            if decision is None:
                answer[key] = (False, "this row is not in the pass")
            elif decision["action"] not in RESOLVING:
                answer[key] = (False, decision.get("reason") or "nothing to point at")
            elif held.mode == "point" and not _point_is_subject(reading):
                answer[key] = (
                    (True, "")
                    if decision.get("points")
                    else (False, f"no point could be read in '{column}'")
                )
            else:
                answer[key] = (True, "")
        return answer

    words = _by_word(_layer_rows(layers, column=column))
    wanted = set(reading.keys)
    for row in reading.rows:
        key = _key_of(row, reading.key_at)
        if key not in wanted:
            continue
        said = _words_of(reading, row, column)
        if not said:
            continue  # nothing was asked of this row, so nothing is missing from it
        resolving = [
            word for word in said if (words.get(word, {}).get("action")) in RESOLVING
        ]
        if resolving:
            answer[key] = (True, "")
        else:
            first = words.get(said[0], {})
            answer[key] = (False, first.get("reason") or f"'{said[0]}' is not in the case")
    return answer


def _join_plans(
    reading: _Pass, layers: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """How many rows each join will draw, and the rows it will not, with the reason."""
    plans: list[dict[str, Any]] = []
    for join in reading.joins:
        starts = _ends_at_plan(reading, layers, join.from_column)
        ends = _ends_at_plan(reading, layers, join.to_column)
        drawing: list[str] = []
        blocked: list[dict[str, str]] = []
        for key in reading.keys:
            start_ok, start_why = starts.get(key, (False, ""))
            end_ok, end_why = ends.get(key, (False, ""))
            if start_ok and end_ok:
                drawing.append(key)
            elif key in starts or key in ends:
                blocked.append({"key": key, "reason": start_why or end_why})
        spec = link_engine.relation_type(join.verb)
        plans.append({
            "from": join.from_column,
            "to": join.to_column,
            "verb": join.verb,
            "label": spec.label if spec else join.verb,
            "ratable": bool(spec and spec.ratable),
            "rows": len(drawing),
            "blocked": blocked,
        })
    return plans


# -- doing it, all of it or none of it -----------------------------------------


def run(case: "Case", sheet_id: str, **asked: Any) -> dict[str, Any]:
    """Write both layers of one pass, inside one transaction.

    The modes run in the order their answers depend on each other: the subject first,
    because a statement is *about* it and an edge starts at it; the columns of values
    next, because a join ends at one; then the statements and the row-to-row edges, which
    read the sidecar the first two wrote. The sidecar is threaded through rather than
    re-read, so the second mode sees what the first said in the same press.

    Nothing is undone by hand. A refusal anywhere in here — a field that will not read, a
    sheet that moved under the analyst — leaves the case exactly as it was, because the
    caller ran all of it inside `case.batch()`.
    """
    reading = read(case, **asked)
    meta = dict(reading.meta)
    done: list[dict[str, Any]] = []

    if reading.subject:
        answer = sheetpromote.promote_rows(
            case, sheet_id, **{**_row_arguments(reading), "meta": meta}
        )
        meta = _carried(meta, answer)
        done.append(_layer("row", reading.subject.name, answer))

    for column in reading.values:
        answer = sheetpromote.promote_column(
            case,
            sheet_id,
            columns=reading.columns,
            rows=reading.rows,
            meta=meta,
            column=column.name,
            entity_type=column.type,
            attach=column.attach,
            skip=column.skip,
        )
        meta = _carried(meta, answer)
        done.append(_layer("value", column.name, answer))

    if reading.statement is not None:
        answer = sheetclaims.promote(
            case, sheet_id, **{**_statement_arguments(reading), "meta": meta}
        )
        meta = _carried(meta, answer)
        done.append(_layer("statement", str((reading.statement or {}).get("when_column") or ""), answer))

    for column in reading.row_edges:
        answer = sheetpromote.promote_row_links(
            case,
            columns=reading.columns,
            rows=reading.rows,
            meta=meta,
            column=column.name,
            verb=column.verb,
        )
        done.append(_layer("row-edges", column.name, answer))

    joins = _draw(case, reading, meta, done)
    return {
        "entities": done,
        "joins": joins,
        "links": meta.get("links") or {},
        "values": meta.get("values") or {},
        "promoted": meta.get("promoted") or {},
    }


def _layer(mode: str, column: str, answer: dict[str, Any]) -> dict[str, Any]:
    """One mode's answer, with its tally under the same key the plan uses.

    The engines spread their counts flat, the plans nest them under ``counts``, and a
    reader that had to know which of the two shapes it was holding is a reader that will
    read the wrong one. So the press answers in the plan's shape as well.
    """
    return {
        "mode": mode,
        "column": column,
        **answer,
        "counts": {action: answer.get(action, 0) for action in ACTIONS},
    }


def _carried(meta: dict[str, Any], answer: dict[str, Any]) -> dict[str, Any]:
    """The sidecar as the next mode must see it. Only the three keys a mode writes, so a
    mode that never touched `values` cannot blank what another one put there."""
    carried = dict(meta)
    for key in ("links", "values", "promoted"):
        if key in answer:
            carried[key] = answer[key]
    return carried


def _ends_after_write(
    reading: _Pass, meta: dict[str, Any], done: list[dict[str, Any]], column: str
) -> dict[str, list[str]]:
    """Per row key, the entities this column now designates.

    The sidecar answers for a subject and for a column of values — that is what it is for
    — but not for a point: a place is filed by the row promotion, so the ids come back on
    the plan it returned.
    """
    held = reading.pointing[column]
    links = meta.get("links") or {}
    named = column
    if held.mode == "point":
        if _point_is_subject(reading):
            # The rows *are* places, so the point column and the subject column name one
            # entity, and the sidecar filed it under the subject's own column.
            named = reading.subject.name if reading.subject else column
        else:
            found = _decisions_by_key(_layer_rows(done, mode="row"))
            return {
                key: [str(one) for one in (found.get(key, {}).get("places") or [])]
                for key in reading.keys
                if found.get(key, {}).get("places")
            }
    if held.mode in ("row", "point"):
        return {
            key: [str(links.get(key, {}).get(named))]
            for key in reading.keys
            if links.get(key, {}).get(named)
        }
    meant = (meta.get("values") or {}).get(column) or {}
    answer: dict[str, list[str]] = {}
    wanted = set(reading.keys)
    for row in reading.rows:
        key = _key_of(row, reading.key_at)
        if key not in wanted:
            continue
        ids = [str(meant[word]) for word in _words_of(reading, row, column) if meant.get(word)]
        if ids:
            answer[key] = ids
    return answer


def _draw(
    case: "Case", reading: _Pass, meta: dict[str, Any], done: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Draw every join the declaration asked for, between the ends that resolved.

    An edge the vocabulary refuses for *these two rows* — a `located-at` onto a PDF, which
    no reading of the two types alone could rule out — is skipped with its reason rather
    than raised: taking the whole pass down over one edge would lose the rows that had
    nothing wrong with them, and the plan already said which rows had both ends.

    The confidence of the pass lands here and only on the verbs the registry declares
    `ratable`. Empty means the analyst asserted nothing beyond the edge itself, which is
    not the same as asserting `possible`.
    """
    drawn: list[dict[str, Any]] = []
    for join in reading.joins:
        starts = _ends_after_write(reading, meta, done, join.from_column)
        ends = _ends_after_write(reading, meta, done, join.to_column)
        wrote = 0
        failed: list[dict[str, str]] = []
        for key in reading.keys:
            for start in starts.get(key, []):
                for end in ends.get(key, []):
                    if start == end:
                        continue
                    try:
                        link = link_engine.add_relation(
                            case, start, end, join.verb, by=sheetpromote.BY
                        )
                    except CaseError as exc:
                        failed.append({"key": key, "reason": str(exc)})
                        continue
                    wrote += 1
                    if reading.confidence is not None:
                        spec = link_engine.relation_type(join.verb)
                        if spec and spec.ratable:
                            link_engine.set_confidence(case, link["id"], reading.confidence)
        drawn.append({
            "from": join.from_column,
            "to": join.to_column,
            "verb": join.verb,
            "drawn": wrote,
            "failed": failed,
        })
    return drawn
