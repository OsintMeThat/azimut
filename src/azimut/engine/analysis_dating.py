"""When a kept Detect candidate was seen, stated where the case reads time.

A pin is a `place`, and a place is permanent: the date belongs to the observation,
not to the ground or to the edge between the picture and the ground (ONTOLOGY §3,
no verb carries a date). Keeping a candidate therefore writes time in the two places
the case already reads it:

- **The evidence picture carries the dates of its passes**, as media facts beside a
  capture's imagery date. One pass is `imagery_date`; a pair is `imagery_a` and
  `imagery_b`, two instants rather than a range, because the picture shows two
  moments and argues nothing about what lies between them.
- **A Claim states what the sweep found**, `at` the pin and citing the picture. A
  thing present on one pass was `observed` then. A change was read between two
  passes, so it `occurred` somewhere in that interval, and only there.

The Claim carries no confidence: keeping is the review, and a grade nobody gave
would read as one somebody did. One pin owns one statement, found again by the
`detection` key, and it follows the proof composer's rule for letting go: undoing the
pin withdraws it only while nothing but this module has written to it.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from . import media as media_engine
from .analysis_models import is_single
from .temporal import TemporalError, parse_temporal

if TYPE_CHECKING:
    from ..workspace import Case


#: The attribute that ties a statement to the candidate that stated it.
STATED_BY = "detection"

#: What the statement holds while nothing but a pin has touched it. Reasoning, a
#: quote or a confidence make it the analyst's, and undoing the pin leaves it.
OURS = {"when", "time_role", STATED_BY}

_DAY = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
_TIME = re.compile(r"([01]\d|2[0-3]):[0-5]\d:[0-5]\d\Z")


def moment(source: dict[str, Any] | None) -> str:
    """One pass as a temporal value: its day, or its UTC instant when a radar pass
    names its time. Empty for a source that states neither."""
    source = source or {}
    day = str(source.get("date") or "")
    if not _DAY.fullmatch(day):
        return ""
    time = str(source.get("time") or "")
    return f"{day}T{time}Z" if _TIME.fullmatch(time) else day


def span(a: str, b: str) -> str:
    """Two passes as the interval a change happened in, earliest first.

    Two instants form an exact interval. Anything else is read as the days they
    fall on, since the announced profile does not mix a day with a time.
    """
    if not a or not b:
        return a or b
    if "T" not in a or "T" not in b:
        a, b = a[:10], b[:10]
    if a == b:
        return a
    first, last = sorted((a, b))
    value = f"{first}/{last}"
    try:
        parse_temporal(value)
    except TemporalError:
        return last
    return value


def candidate_sources(run: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """The two passes one candidate was read on.

    A run over several areas reads each on its own dates, which the candidate
    carries. One saved before that is read off its area's outcome, then the run.
    """
    if isinstance(result.get("sources"), dict):
        return result["sources"]
    outcome = next((pair for pair in run.get("area_runs") or []
                    if pair.get("area_id") == result.get("area_id")), None)
    held = outcome or run.get("input") or {}
    return {"a": held.get("a") or {}, "b": held.get("b") or {}}


def pictured(sources: dict[str, Any], *, one_pass: bool) -> dict[str, str]:
    """The dates an evidence picture carries in its sidecar."""
    b = moment(sources.get("b"))
    if one_pass:
        return {"imagery_date": b} if b else {}
    a = moment(sources.get("a"))
    return {key: value for key, value in (("imagery_a", a), ("imagery_b", b)) if value}


def reading(sources: dict[str, Any], *, single: bool) -> tuple[str, str] | None:
    """`(when, time_role)` for a kept candidate, or None when no pass is dated."""
    b = moment(sources.get("b"))
    if not b:
        return None
    if single:
        return b, "observed"
    a = moment(sources.get("a"))
    return (span(a, b), "occurred") if a else (b, "observed")


def _label(title: str, single: bool) -> str:
    return f"Seen: {title}" if single else f"Changed: {title}"


def key(run_id: str, candidate_id: str) -> str:
    return f"{run_id}/{candidate_id}"


def standing(case: Case, run_id: str, candidate_id: str) -> dict[str, Any] | None:
    found = case.find_entity(attr=STATED_BY, value=key(run_id, candidate_id))
    return found if found and found.get("type") == "claim" else None


def state(
    case: Case,
    *,
    place: dict[str, Any],
    evidence: dict[str, Any] | None,
    run_id: str,
    candidate_id: str,
    sources: dict[str, Any],
    single: bool,
    title: str,
) -> dict[str, Any] | None:
    """File or restate the Claim a kept candidate makes. None when undated."""
    read = reading(sources, single=single)
    if read is None:
        return None
    when, role = read
    current = standing(case, run_id, candidate_id)
    # A statement reworded by hand is the analyst's sentence; restating the date is
    # no reason to put ours back over it.
    label = current["label"] if current else _label(title, single)
    saved = case.save_temporal_claim(
        entity_id=current["id"] if current else None,
        label=label,
        attrs={
            **{k: v for k, v in ((current or {}).get("attrs") or {}).items() if k not in OURS},
            "when": when,
            "time_role": role,
            STATED_BY: key(run_id, candidate_id),
        },
        connectors={"about": [], "at": [place["id"]],
                    "cites": [evidence["id"]] if evidence else []},
        by="compare",
    )
    return saved["entity"]


def withdrawable(case: Case, run_id: str, candidate_id: str) -> str | None:
    """The statement undoing a pin takes with it, if it is still only the pin's."""
    current = standing(case, run_id, candidate_id)
    if current is None or not set(current.get("attrs") or {}) <= OURS:
        return None
    return str(current["id"])


def backfill(case: Case) -> int:
    """Date every pin kept before pins were dated. Returns how many were stated.

    Everything needed is on the pin: its provenance holds the run's input and the
    candidate as it was kept. The picture is dated only where its shape is sure. A
    one-pass detector drew one pass; a change may have been kept as a pair or as its
    second pass alone, and that choice was not recorded, so the Claim alone says it.
    A pin already stated is skipped, so a pass interrupted halfway can run again.
    """
    stated = 0
    for place in case.list_entities():
        if place.get("type") != "place":
            continue
        attrs = place.get("attrs") or {}
        provenance = attrs.get("analysis_provenance")
        if not isinstance(provenance, dict):
            continue
        run_id = str(provenance.get("analysis_run") or attrs.get("analysis_run") or "")
        candidate = provenance.get("candidate") or {}
        candidate_id = str(provenance.get("candidate_id") or attrs.get("candidate_id") or "")
        if not run_id or not candidate_id or standing(case, run_id, candidate_id):
            continue
        run = {"input": provenance.get("input") or {}}
        recipe = run["input"].get("recipe")
        if not isinstance(recipe, dict):
            continue
        try:
            single = is_single(recipe)
        except ValueError:
            continue
        sources = candidate_sources(run, candidate)
        evidence_path = str(attrs.get("evidence") or "")
        evidence = case.find_entity(attr="path", value=evidence_path) if evidence_path else None
        if evidence and single:
            item = media_engine.read_item(case, evidence_path)
            if item and not (item.get("source") or {}).get("imagery_date"):
                media_engine.merge_item(case, evidence_path, {
                    "source": {**(item.get("source") or {}), **pictured(sources, one_pass=True)}})
        if state(case, place=place, evidence=evidence, run_id=run_id, candidate_id=candidate_id,
                 sources=sources, single=single, title=str(place.get("label") or "")):
            stated += 1
    return stated
