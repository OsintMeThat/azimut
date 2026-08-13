"""Build the derived temporal rows served by Time and Timeline.

Claims, media sidecars and entity provenance remain authoritative.  The rows
produced here are a search projection: they may be deleted and rebuilt without
losing an analyst statement or changing file metadata.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import re
from typing import Any

from .temporal import TemporalError, parse_temporal


STATEMENT = "statement"
MEDIA = "media"
CASE_ACTIVITY = "case_activity"
DEFAULT_CATEGORIES = (STATEMENT, MEDIA)
ALL_CATEGORIES = (STATEMENT, MEDIA, CASE_ACTIVITY)


@dataclass(frozen=True)
class ProjectionRow:
    """One homogeneous line, before it is written to the SQLite projection."""

    id: str
    owner_id: str
    authority: str
    category: str
    kind: str
    raw: str | None
    earliest: str | None
    latest: str | None
    precision: str | None
    shape: str | None
    time_role: str | None
    uncertain: bool
    approximate: bool
    zone: str | None
    sortable: bool
    status: str | None
    confidence: str | None
    parse_error: str | None

    def record(self) -> dict[str, Any]:
        return asdict(self)


def _project_value(
    *,
    id: str,
    owner_id: str,
    authority: str,
    category: str,
    kind: str,
    raw: object,
    time_role: str | None = None,
    status: str | None = None,
    confidence: str | None = None,
) -> ProjectionRow:
    text = raw if isinstance(raw, str) and raw else None
    if text is None:
        return ProjectionRow(
            id, owner_id, authority, category, kind, None, None, None, None,
            None, time_role, False, False, None, False, status, confidence, None,
        )
    try:
        value = parse_temporal(text)
    except TemporalError as exc:
        # Old cases may contain a field that predates the declared Claim contract.
        # Keep it visible as unplaced and explain why it cannot be placed; a derived
        # index must never make opening the case depend on repairing user data.
        return ProjectionRow(
            id, owner_id, authority, category, kind, text, None, None, None,
            None, time_role, False, False, None, False, status, confidence, str(exc),
        )
    return ProjectionRow(
        id=id,
        owner_id=owner_id,
        authority=authority,
        category=category,
        kind=kind,
        raw=value.raw,
        earliest=value.earliest,
        latest=value.latest,
        precision=value.precision,
        shape=value.shape,
        time_role=time_role,
        uncertain=value.uncertain,
        approximate=value.approximate,
        zone=value.zone,
        sortable=value.sortable,
        status=status,
        confidence=confidence,
        parse_error=None,
    )


def project_entity(entity: dict[str, Any]) -> list[ProjectionRow]:
    """Project one graph entity without reading any other case state."""
    entity_id = str(entity["id"])
    type_ = str(entity.get("type") or "")
    raw_attrs = entity.get("attrs")
    attrs: dict[str, Any] = raw_attrs if isinstance(raw_attrs, dict) else {}
    raw_provenance = entity.get("provenance")
    provenance: dict[str, Any] = (
        raw_provenance if isinstance(raw_provenance, dict) else {}
    )

    if type_ == "claim":
        role = attrs.get("time_role")
        confidence = attrs.get("confidence")
        return [
            _project_value(
                id=f"temporal:claim:{entity_id}",
                owner_id=entity_id,
                authority="entity",
                category=STATEMENT,
                kind="claim",
                raw=attrs.get("when"),
                time_role=role if isinstance(role, str) else None,
                status=(
                    provenance.get("status")
                    if isinstance(provenance.get("status"), str)
                    else None
                ),
                confidence=confidence if isinstance(confidence, str) else None,
            )
        ]

    # Media activity is projected from its sidecar below. This avoids showing
    # the graph filing timestamp beside the more specific "Added to case" value.
    if type_ in {"media", "capture"}:
        return []
    return [
        _project_value(
            id=f"temporal:activity:{entity_id}:filed",
            owner_id=entity_id,
            authority="entity",
            category=CASE_ACTIVITY,
            kind="filed",
            raw=provenance.get("at"),
        )
    ]


_COMPACT_DATE = re.compile(r"(?P<year>\d{4})(?P<month>\d{2})(?P<day>\d{2})\Z")


def _media_date(raw: object) -> object:
    """Turn yt-dlp's compact publication date into the announced date profile."""
    if not isinstance(raw, str):
        return raw
    match = _COMPACT_DATE.fullmatch(raw)
    if match is None:
        return raw
    return f"{match.group('year')}-{match.group('month')}-{match.group('day')}"


def project_media(item: dict[str, Any], entity_id: str | None) -> list[ProjectionRow]:
    """Project intrinsic and collection dates from one indexed media sidecar."""
    if not entity_id:
        return []
    raw_source = item.get("source")
    source: dict[str, Any] = raw_source if isinstance(raw_source, dict) else {}
    rows: list[ProjectionRow] = []

    def add(category: str, kind: str, raw: object) -> None:
        if raw in (None, ""):
            return
        rows.append(
            _project_value(
                id=f"temporal:media:{entity_id}:{kind}",
                owner_id=entity_id,
                authority="media",
                category=category,
                kind=kind,
                raw=raw,
            )
        )

    # A file-carried capture time wins over a browser context timestamp. They
    # describe the same reading, and showing both would look like two events.
    add(MEDIA, "captured", item.get("taken_at") or source.get("captured_at"))
    add(MEDIA, "published", _media_date(source.get("upload_date")))
    add(MEDIA, "imagery", source.get("imagery_date"))
    add(CASE_ACTIVITY, "collected", source.get("fetched_at"))
    add(CASE_ACTIVITY, "added", item.get("added_at"))
    return rows
