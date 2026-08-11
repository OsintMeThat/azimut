"""What the case's statements add up to (ONTOLOGY §2, "Counting a model rather than
minting objects").

A case that follows a conflict writes the same statement over and over — *two of
these destroyed here, filmed by that* — and the Board lists each one on its own row.
Twenty rows later the question stops being what each says and becomes what they come
to, which the table cannot answer: reading a total off it is the analyst adding up by
hand.

So this is the addition, over **the narrowing the analyst already set**. The same
chips, answered a second way rather than listed a second time: grouped by what each
statement is ``about``, summed over ``count``, split by ``condition``.

Four rules keep the number honest, and every one of them is a call the vocabulary
already made:

**A statement ruled out is never inside a sum.** ``refuted`` reads *checked and
eliminated*, so adding one to a total states the opposite of what the analyst
concluded. Ruled-out statements are counted apart, on the row they belong to, because
eliminating a candidate is work the case keeps rather than work it throws away.

**An absent ``count`` is not one.** It means *seen, not counted*, a different and
honest answer, so such a statement counts as a statement and stays out of the sum.
Each row says how many of its statements carried a number, or the two would be
indistinguishable in the total.

**Nothing is added across subjects.** ``count`` sits on the node and not on ``about``,
precisely because a statement may point at several subjects and one number could not
say which it meant. Per subject the sum is what the statements say; added across
subjects it would spend one statement twice. So there is no grand total here, by
construction — the reading answers *how many of this*, never *how many altogether*.

**It counts observations, not objects.** Two videos of one destroyed vehicle are two
statements, and folding them into one is the open ``same-as`` question (ONTOLOGY §4).
Every number is therefore worded as statements and what they assert.

What it deliberately does not do is group above the subject. Three statements about
three T-72 variants stay three rows, because no verb says one model is a variant of
another (``instance-of`` runs asset → class and stops there). Whether that verb is
worth adding is a question this reading is meant to answer, not to presume.
"""

from __future__ import annotations

import math
from typing import Any

from ..repository import CaseRepository
from . import entities, links

#: How many statements one reading adds up. A statement is analyst-typed, so a case
#: reaching this has thousands of them and a total over the first two thousand would
#: be a number that looks whole and is not — hence the cut is reported rather than
#: applied quietly.
MAX_STATEMENTS = 2000

#: The order conditions read in, from the registry rather than spelled again, with
#: *unstated* last: it is the absence of an answer, not one of the answers.
_CONDITION_ORDER = {value: rank for rank, (value, _) in enumerate(entities.ASSET_CONDITIONS)}
_CONFIDENCE_ORDER = {value: rank for rank, (value, _) in enumerate(entities.CLAIM_CONFIDENCE)}

#: The one level that leaves a statement out of every sum (ONTOLOGY §3).
RULED_OUT = "refuted"


def tally(
    case: CaseRepository,
    *,
    types: list[str] | None = None,
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
    limit: int = MAX_STATEMENTS,
) -> dict[str, Any]:
    """The statements in this narrowing, grouped by subject and added up.

    Returns ``{rows, read, matched, truncated, unattributed}``. ``read`` is how many
    statements the sums stand on and ``matched`` how many the narrowing holds: equal
    unless the cut fell, which ``truncated`` says outright.

    ``types`` is the analyst's own type chip and it **narrows rather than selects**:
    the reading is of statements, so it intersects with ``claim`` instead of replacing
    it. A chip that keeps only media leaves no statement, and answering that with
    every statement in the case would be answering a question nobody asked.
    """
    wanted = ["claim"] if types is None else [name for name in types if name == "claim"]
    if not wanted:
        return {"rows": [], "read": 0, "matched": 0, "truncated": False, "unattributed": 0}

    bounded = max(1, min(int(limit), MAX_STATEMENTS))
    page = case.page_entities(
        limit=bounded, types=wanted, status=_status(status), query=query,
        folder=folder, unfiled=unfiled, recursive=recursive,
        attr=attr, attr_value=attr_value, linked=linked, unlinked=unlinked,
        since=since, until=until, filed_by=filed_by,
    )
    claims: list[dict[str, Any]] = page["items"]
    matched = int(page["total"])
    if not claims:
        return {
            "rows": [], "read": 0, "matched": matched,
            "truncated": False, "unattributed": 0,
        }

    held = {claim["id"] for claim in claims}
    subjects: dict[str, list[str]] = {}
    for link in case.links_touching(list(held), types=[links.ABOUT]):
        # `about` runs claim → subject, so the near end is the statement. Read off the
        # edge rather than assumed: an older case may hold a direction the current
        # registry would refuse, and it must not become a subject of itself.
        if link["from"] in held and link["to"] not in held:
            subjects.setdefault(link["from"], []).append(link["to"])

    rows: dict[str, dict[str, Any]] = {}
    unattributed = 0
    for claim in claims:
        targets = subjects.get(claim["id"], [])
        if not targets:
            # A statement about nothing. Not an error and not dropped: it is a row of
            # the case that says what it concerns nowhere, and a reading that silently
            # ignored it would make the sums look complete.
            unattributed += 1
            continue
        for target in targets:
            _fold_in(rows.setdefault(target, _empty_row(target)), claim)

    named = {
        entity["id"]: entity for entity in case.entities_by_ids(list(rows))
    }
    return {
        "rows": _ordered(rows, named),
        "read": len(claims),
        "matched": matched,
        "truncated": matched > len(claims),
        "unattributed": unattributed,
    }


def for_subject(
    case: CaseRepository, entity_id: str, *, limit: int = MAX_STATEMENTS
) -> dict[str, Any] | None:
    """What the statements about **one** subject come to, or nothing if there are none.

    The panel already lists the statements pointing at an entity; this is the same set
    added up, and it is the reading an analyst reaches for first — *what does the case
    say about this model* is a question about one row, not about a narrowing.

    It answers over the whole case rather than over any filter, because the panel is
    not narrowed: a total that quietly obeyed a filter set on another screen would be
    a different number under the same words.

    The rules are the ones above, applied by the same code, so the two readings cannot
    drift: a ruled-out statement stays outside the sum here too.
    """
    bounded = max(1, min(int(limit), MAX_STATEMENTS))
    subject = case.get_entity(entity_id)
    if subject is None:
        return None

    stating = [
        link["from"]
        for link in case.links_touching([entity_id], types=[links.ABOUT])
        if link["to"] == entity_id and link["from"] != entity_id
    ]
    if not stating:
        return None

    kept = list(dict.fromkeys(stating))[:bounded]
    row = _empty_row(entity_id)
    for claim in case.entities_by_ids(kept):
        if claim.get("type") == "claim":
            _fold_in(row, claim)
    built = _ordered({entity_id: row}, {entity_id: subject})[0]
    return {**built, "read": len(kept), "matched": len(stating)}


def _fold_in(row: dict[str, Any], claim: dict[str, Any]) -> None:
    """One statement added to one subject's row, which is where every rule lands.

    Shared by both readings on purpose: the tally and the panel would otherwise be two
    implementations of *what may enter a sum*, and the day they disagreed the case
    would have two totals for one question.
    """
    attrs = claim.get("attrs") or {}
    confidence = _text(attrs.get("confidence"))
    condition = _text(attrs.get("condition"))
    count = _whole(attrs.get("count"))
    if confidence == RULED_OUT:
        row["refuted"] += 1
        return
    row["statements"] += 1
    row["confidence"][confidence] = row["confidence"].get(confidence, 0) + 1
    bucket = row["_conditions"].setdefault(
        condition, {"value": condition, "total": 0, "statements": 0, "counted": 0}
    )
    bucket["statements"] += 1
    if count is not None:
        row["total"] += count
        row["counted"] += 1
        bucket["total"] += count
        bucket["counted"] += 1


def _empty_row(entity_id: str) -> dict[str, Any]:
    return {
        "id": entity_id,
        "label": "",
        "type": "",
        "statements": 0,
        "counted": 0,
        "total": 0,
        "refuted": 0,
        "confidence": {},
        "_conditions": {},
    }


def _ordered(
    rows: dict[str, dict[str, Any]], named: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """The rows as they are read: the biggest number first, the label as the tie-break.

    Sorted here rather than in the browser, like every other list the server bounds:
    a cut reading sorted by the client would rank the slice rather than the answer.
    """
    built: list[dict[str, Any]] = []
    for entity_id, row in rows.items():
        entity = named.get(entity_id)
        conditions = sorted(
            row.pop("_conditions").values(),
            key=lambda bucket: (_CONDITION_ORDER.get(bucket["value"], len(_CONDITION_ORDER)),
                                bucket["value"]),
        )
        confidence = sorted(
            ({"value": value, "statements": held} for value, held in row["confidence"].items()),
            key=lambda level: (_CONFIDENCE_ORDER.get(level["value"], len(_CONFIDENCE_ORDER)),
                               level["value"]),
        )
        built.append({
            **row,
            "label": (entity or {}).get("label", ""),
            "type": (entity or {}).get("type", ""),
            "conditions": conditions,
            "confidence": confidence,
        })
    built.sort(key=lambda row: (-row["total"], -row["statements"], row["label"].casefold(), row["id"]))
    return built


def _text(value: Any) -> str:
    """A stored choice as the reading groups on it, and "" for every absence.

    One spelling for *unstated*, so a key written as null, as an empty string or not
    written at all is one bucket rather than three.
    """
    return str(value).strip() if isinstance(value, str) else ""


def _whole(value: Any) -> int | None:
    """A stored ``count`` as a number, or nothing at all.

    Anything that is not a whole number of at least one is read as *not counted*
    rather than repaired: the field is validated on the way in, so a value that got
    past that is not a number this reading may guess at.

    Infinity and NaN are refused before anything is done with them. The validator
    already rejects both (`entities._check_number`), so they only arrive from a case
    written elsewhere — an import, a hand-edited database — and there the reading has
    to answer *not counted* rather than fail on the whole case.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number != int(number):
        return None
    return int(number) if number >= 1 else None


def _status(value: str | None) -> Any:
    return value if value in ("confirmed", "suggested") else None
