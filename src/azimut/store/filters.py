"""The predicates a case is narrowed by, as SQL.

One `WHERE` for the board's page and the graph's ranking, so a filter can never
mean two things depending on which view asked (`_entity_filters`), plus the
per-field tests it is built from. `_has_json1` is the runtime probe that decides
which spelling of an attribute question this SQLite can answer — see the
`sqlite_backend` module docstring on why the extension set is per-binary.
"""

from __future__ import annotations

import json
import re
import sqlite3
from functools import lru_cache
from typing import Any

from ..engine import timeline as timeline_engine
from ..workspace import CaseError
from .sql import _like_contains, _like_prefix, _marks


#: How many distinct values a field may hold before a select stops being a way to
#: choose one. Fifty platforms or conditions is a menu; five thousand file paths is a
#: list nobody scrolls, and offering it would be the typed query this app refuses.
MAX_ATTR_VALUES = 50

#: How long a value may be and still be worth offering. A quoted paragraph and a
#: traced footprint are stored values, not choices.
MAX_ATTR_TEXT = 120

#: What an attribute key may be made of. The key reaches SQL inside a JSON path — a
#: string the database parses rather than a bound parameter — so the character set is
#: closed rather than escaped, and anything else is refused rather than quoted.
_ATTR_KEY = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")


@lru_cache(maxsize=1)
def _has_json1() -> bool:
    """Whether this SQLite can read inside a JSON column, probed once.

    The extension set is per-binary and not per-Python (see the module docstring):
    `sqlite3` links whatever SQLite the build environment provided, so JSON1 can be
    present on a dev machine and missing from a shipped binary. Present, an attribute
    filter is an expression the database evaluates against the top-level field;
    absent, it is the same question spelled as `LIKE` over the exact text
    `json.dumps` wrote — which matches the field at any depth, so a nested object
    holding the same key *and* the same value matches too. `tests/test_repository.py`
    asserts the probe answers true, so CI proves on all three platforms that the
    exact path is the one that ships.
    """
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("SELECT json_extract('{\"a\": 1}', '$.\"a\"')").fetchone()
    except sqlite3.Error:
        return False
    finally:
        conn.close()
    return True


def _attr_match(key: str, value: str) -> tuple[str, list[Any]]:
    """One ``attrs`` field holding one value, as this SQLite can ask it.

    The value is compared **as text**, because text is what a select can offer: the
    values come back from the facet read as strings, so `kind` is `video` where
    `radius_m` is `100`, and both sides of the control agree on the spelling.
    """
    if not _ATTR_KEY.match(key):
        raise CaseError(f"'{key}' is not a field name")
    if _has_json1():
        return f"CAST(json_extract(attrs_json, '$.\"{key}\"') AS TEXT) = ?", [value]
    # The stored text, as `json.dumps` writes it: `{"kind": "video", "path": "…"}`.
    # A value runs up to the next comma or to the closing brace, and the terminator is
    # part of the pattern — without it, `"radius_m": 1` also matched 100.
    quoted = json.dumps(value, ensure_ascii=False)
    patterns = [
        _like_contains(f'"{key}": {written}{end}')
        for written in (quoted, value)
        for end in (",", "}")
    ]
    joined = " OR ".join("attrs_json LIKE ? ESCAPE '\\'" for _ in patterns)
    return f"({joined})", patterns


def _holds_number(key: str) -> str:
    """One ``attrs`` field holding a *number*, as this SQLite can ask it.

    Not ``_attr_match``, which compares against a chosen value: here nothing is being
    matched, the question is whether a number was written at all. It is what tells a
    statement that counts something from one that says *seen, not counted*, and both
    spellings have to answer it the same way (module docstring).
    """
    if not _ATTR_KEY.match(key):
        raise CaseError(f"'{key}' is not a field name")
    if _has_json1():
        return f"json_type(attrs_json, '$.\"{key}\"') IN ('integer', 'real')"
    # `json.dumps` writes `{"count": 2}`. GLOB rather than LIKE because a digit has to
    # be part of the pattern: `LIKE '%"count": %'` also matches a null and a string.
    return f"attrs_json GLOB '*\"{key}\": [0-9]*'"


def _facet_value(value: Any) -> str | None:
    """One stored value as a menu can offer it, or None when it cannot.

    The spelling has to match what the filter compares against, since one is the menu
    and the other is the question it asks: a number reads as its own digits either
    side. Booleans are refused because the two sides would not agree — SQLite casts
    `true` to `1` where Python writes `True` — and no field in the vocabulary holds
    one.
    """
    if isinstance(value, bool) or value is None or isinstance(value, (dict, list)):
        return None
    if isinstance(value, (int, float)):
        return str(value)
    if not isinstance(value, str) or not value or len(value) > MAX_ATTR_TEXT:
        return None
    return value


def _linked_to(type_: str, alias: str) -> tuple[str, list[Any]]:
    """Whether one hop from this entity reaches an entity of that type.

    *Which videos have coordinates* is this test and nothing else, and until now it
    could not be asked anywhere in the app: a case could show every video and every
    place, and never the one set that is both. Undirected, because "linked to a place"
    is a question about the pair rather than about which end states the verb.
    """
    return (
        " EXISTS (SELECT 1 FROM links l JOIN entities far"
        f" ON far.id = (CASE WHEN l.from_id = {alias}.id THEN l.to_id ELSE l.from_id END)"
        f" WHERE (l.from_id = {alias}.id OR l.to_id = {alias}.id) AND far.type = ?)",
        [type_],
    )


def _linked_at_all(alias: str) -> str:
    """Whether anything at all links this entity to the rest of the case.

    The complement of ``_linked_to`` with the type dropped, and the one question the
    catalog could not ask: *what have I filed and never connected to anything.* The
    graph counts that set — it is a case's unexploited material — but counting is not
    reaching it, and until this existed the only way to a list was to read the drawing
    for dots with no line on them.
    """
    return (
        f" EXISTS (SELECT 1 FROM links l WHERE l.from_id = {alias}.id"
        f" OR l.to_id = {alias}.id)"
    )

#: The character that sorts after every other, appended to an inclusive upper bound.
#: ``prov_at`` holds a full ISO instant and a date range is asked in days, so
#: ``until='2026-08-10'`` has to reach the whole of that day rather than stopping at
#: its first microsecond. Lexicographic order is what ISO-8601 guarantees, so a
#: sentinel above every timestamp starting with that date is the exact bound.
_AFTER_ALL = "￿"

def _entity_filters(
    *,
    types: list[str] | None = None,
    exclude_types: list[str] | None = None,
    status: str | None = None,
    query: str | None = None,
    folder: str | None = None,
    unfiled: bool = False,
    recursive: bool = False,
    attr: str | None = None,
    attr_value: str | None = None,
    linked: str | None = None,
    unlinked: bool = False,
    since: str | None = None,
    until: str | None = None,
    filed_by: list[str] | None = None,
    temporal_since: str | None = None,
    temporal_until: str | None = None,
    temporal_categories: list[str] | None = None,
    alias: str = "entities",
) -> tuple[str, list[Any]]:
    """The shared ``WHERE`` over entities: type set, review status, folder, search.

    One predicate for the board's page and the graph's ranking, so a filter can
    never mean two things depending on which view asked.

    ``types`` and ``exclude_types`` are two different questions and compose rather
    than replace each other: the first is the narrowing a caller asked for, the second
    is the set a graph lens does not draw at all (``engine/graph.py``). Stated as an
    exclusion because a free-typed entity — one the vocabulary has never heard of —
    has no role either, and an allowlist resolved from the registry would drop it.

    ``attr``/``attr_value`` narrow on one stored field, and ``linked`` on having a
    neighbour of a type. Together with the type set they are the sentence *media,
    kind video, linked to a place* — every term chosen from what the case holds, none
    of it typed as syntax (SPEC anti-goals). ``alias`` names the entity table in the
    statement being built, because the one-hop test has to correlate to the outer row
    and the two callers spell that table differently.

    ``unlinked`` is that sentence's other half — *connected to nothing* — and
    ``since``/``until``/``filed_by`` are the three terms about how a row got here
    rather than about what it says: when it was filed, and by which tool or by hand.
    Every one of them reads a column the entity already carries, so none of them costs
    a scan the other terms were not already paying for.
    """
    where: list[str] = []
    params: list[Any] = []
    if types:
        where.append(f"type IN ({_marks(types)})")
        params.extend(types)
    if exclude_types:
        where.append(f"type NOT IN ({_marks(exclude_types)})")
        params.extend(exclude_types)
    if status is not None:
        where.append("prov_status = ?")
        params.append(status)
    if unfiled:
        where.append("folder IS NULL")
    elif folder is not None:
        if recursive:
            where.append("(folder = ? OR folder LIKE ? ESCAPE '\\')")
            params.extend((folder, _like_prefix(folder + "/")))
        else:
            where.append("folder = ?")
            params.append(folder)
    for term in (query or "").casefold().split():
        where.append("search_text LIKE ? ESCAPE '\\'")
        params.append(_like_contains(term))
    # A field with no value chosen is not a term: it is the analyst having picked which
    # field they are about to ask about, and answering it as "holds nothing" would empty
    # the table between two clicks of one act.
    if attr and attr_value is not None:
        clause, bound = _attr_match(attr, attr_value)
        where.append(clause)
        params.extend(bound)
    if linked:
        clause, bound = _linked_to(linked, alias)
        where.append(clause)
        params.extend(bound)
    if unlinked:
        where.append(f" NOT{_linked_at_all(alias)}")
    if since:
        where.append("prov_at >= ?")
        params.append(since)
    if until:
        where.append("prov_at <= ?")
        params.append(until + _AFTER_ALL)
    if filed_by:
        where.append(f"prov_by IN ({_marks(filed_by)})")
        params.extend(filed_by)
    if temporal_since is not None or temporal_until is not None:
        if temporal_since is None or temporal_until is None:
            raise CaseError("a temporal filter needs both boundaries")
        categories = list(dict.fromkeys(
            temporal_categories or list(timeline_engine.DEFAULT_CATEGORIES)
        ))
        invalid = sorted(set(categories) - set(timeline_engine.ALL_CATEGORIES))
        if invalid:
            raise CaseError(f"unknown timeline category '{invalid[0]}'")
        if not categories:
            raise CaseError("a temporal filter needs a category")
        where.append(
            "EXISTS (SELECT 1 FROM temporal_items temporal_match"
            " WHERE temporal_match.earliest IS NOT NULL"
            " AND temporal_match.latest > ? AND temporal_match.earliest < ?"
            f" AND temporal_match.category IN ({_marks(categories)})"
            f" AND (temporal_match.owner_id = {alias}.id OR EXISTS ("
            "SELECT 1 FROM links temporal_scope"
            " WHERE temporal_scope.from_id = temporal_match.owner_id"
            f" AND temporal_scope.to_id = {alias}.id"
            " AND temporal_scope.type IN ('about', 'at', 'cites'))))"
        )
        params.extend((temporal_since, temporal_until, *categories))
    return ((" WHERE " + " AND ".join(where)) if where else "", params)


def _link_scope(
    types: list[str] | None = None,
    *,
    ends_out: list[str] | None = None,
    ends_in: list[str] | None = None,
) -> tuple[str, list[Any]]:
    """One lens's edges: its verbs, and which types may stand at an end.

    Every half comes from the same reading (``engine/graph.py``). ``ends_out`` is what
    keeps a **degree** honest now that a lens narrows nodes as well as verbs: counted
    over every edge, a media whose only connections are to notes would read as
    connected in a reading that draws neither the notes nor the edges to them, and the
    control offering to open it could only ever appear to do nothing.

    ``ends_in`` is the opposite question, and the one the collapse asks: *which edges
    reach a type this reading leaves out.* One end at least is of those types, so paired
    with an id set that holds none of them it names the bridge and the node it bridges
    to in one row.

    Any half may be empty, which means no narrowing on that axis.
    """
    where: list[str] = []
    params: list[Any] = []
    wanted = list(dict.fromkeys(types or []))
    if wanted:
        where.append(f"type IN ({_marks(wanted)})")
        params.extend(wanted)
    hidden = list(dict.fromkeys(ends_out or []))
    if hidden:
        marks = _marks(hidden)
        where.append(
            f"from_id NOT IN (SELECT id FROM entities WHERE type IN ({marks}))"
            f" AND to_id NOT IN (SELECT id FROM entities WHERE type IN ({marks}))"
        )
        params.extend(hidden * 2)
    reached = list(dict.fromkeys(ends_in or []))
    if reached:
        marks = _marks(reached)
        where.append(
            f"(from_id IN (SELECT id FROM entities WHERE type IN ({marks}))"
            f" OR to_id IN (SELECT id FROM entities WHERE type IN ({marks})))"
        )
        params.extend(reached * 2)
    return ((" WHERE " + " AND ".join(where)) if where else "", params)
