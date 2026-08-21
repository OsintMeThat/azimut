"""Turning a stored record into its indexed columns, and back.

An entity and a media item each reach SQLite as a JSON blob plus the handful of
denormalised columns the catalog filters and sorts on. These compute those
columns, so the write path and the migrations that backfill them cannot come to
disagree about what a column holds.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..engine import entities as entity_engine
from ..engine import links as link_engine
from ..engine import mapsites


def _folder_of(attrs: dict[str, Any] | None) -> str | None:
    """The indexed folder value for an entity: its ``attrs.folder`` path, or None
    when unfiled — an absent or empty folder both read as unfiled."""
    folder = (attrs or {}).get("folder")
    return folder or None


def _entity_search_text(type_: str, label: str, attrs: dict[str, Any] | None) -> str:
    """What a case search matches an entity against.

    The label, the type, the folder and the notes, plus the type's own declared text
    fields (``entities.search_values``): a vehicle is looked for by its plate and a
    claim by the words it quotes, and neither was findable while the index stopped
    at the notes. Recomputed on every write, and rebuilt for existing rows by the
    schema-10 migration.
    """
    attrs = attrs or {}
    fixed = (label, type_, attrs.get("folder"), attrs.get("notes"))
    declared = entity_engine.search_values(type_, attrs)
    return "\n".join(str(value) for value in (*fixed, *declared) if value).casefold()


def _replace_exact(value: Any, old: str, new: str) -> Any:
    """Recursively replace strings equal to ``old``; never edit prose."""
    if isinstance(value, str):
        return new if value == old else value
    if isinstance(value, list):
        return [_replace_exact(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: _replace_exact(item, old, new) for key, item in value.items()}
    return value

_MEDIA_CATEGORIES = (
    "image",
    "video",
    "collage",
    "satellite",
    "upload",
    "download",
    "other",
)
_SATELLITE_SQL = (
    "(COALESCE(source_type, '') = 'satellite' OR "
    "(COALESCE(source_type, '') = 'screenshot' AND imagery_mode = 'satellite'))"
)
_MEDIA_CATEGORY_SQL = {
    "image": f"(kind = 'image' AND NOT {_SATELLITE_SQL})",
    "video": "kind = 'video'",
    "collage": "source_op = 'collage'",
    "satellite": _SATELLITE_SQL,
    # A paste and a drop are one facet: both are material the analyst brought in
    # by hand, which is the question this filter asks. They stay two source types
    # because the gesture is part of the record — a screenshot is not a file that
    # was chosen off a disk, whatever origin was stated for either.
    "upload": "source_type IN ('upload', 'clipboard')",
    "download": "source_type = 'download'",
    "other": "kind NOT IN ('image', 'video')",
}

#: Rows the case **made** rather than collected, as one predicate. The set is the
#: relation layer's (`engine/links.py` MADE_HERE), so the list and the graph cannot
#: come to disagree about what a case collected.
_MADE_HERE_SQL = (
    "COALESCE(source_type, '') IN ("
    + ", ".join(f"'{route}'" for route in link_engine.MADE_HERE)
    + ")"
)


def _has_gps(item: dict[str, Any]) -> bool:
    """Whether an indexed media item carries a usable position.

    Enrichment writes ``gps`` as ``{lat, lon}`` when a file's own metadata states
    one (engine/enrich.py). Anything else — absent, half-filled, non-numeric —
    counts as no position, so the filter can never offer a row it cannot place.
    """
    gps = item.get("gps")
    if not isinstance(gps, dict):
        return False
    try:
        float(gps["lat"]), float(gps["lon"])
    except (KeyError, TypeError, ValueError):
        return False
    return True


#: Sidecar fields the browse index deliberately does not mirror. Enrichment's
#: full metadata dumps (engine/enrich.py) are hundreds of rows per file, and this
#: index is read 200 items at a time by the grid and whole by the pickers — one
#: fat field would multiply every one of those responses by ten. They stay in the
#: sidecar, which is the file-level record, and reach the UI one file at a time
#: through ``GET .../media/item``. Parsed facts (``gps``, ``taken_at``,
#: ``dhash``) are small and stay indexed.
_UNINDEXED_MEDIA_FIELDS = ("exif", "video_metadata")


def _normalise_media_item(item: dict[str, Any]) -> tuple[dict[str, Any], tuple[Any, ...]]:
    """Return a JSON-safe browse item plus its indexed column values."""
    clean = json.loads(json.dumps(item, ensure_ascii=False))
    for field_name in _UNINDEXED_MEDIA_FIELDS:
        clean.pop(field_name, None)
    source = clean.get("source")
    if not isinstance(source, dict):
        source = {}
        clean["source"] = source
    if (
        source.get("type") == "screenshot"
        and "imagery_mode" not in source
        and isinstance(source.get("source_url"), str)
    ):
        parsed = mapsites.parse_map_url(source["source_url"])
        if parsed and parsed.get("imagery_mode"):
            source = {**source, "imagery_mode": parsed["imagery_mode"]}
            clean["source"] = source

    path = str(clean.get("path") or "")
    filename = str(clean.get("filename") or Path(path).name)
    kind = str(clean.get("kind") or "file")
    folder = str(clean.get("folder") or "") or None
    title = str(clean.get("title") or "")
    notes = str(clean.get("notes") or "")
    name_sort = (title or filename).casefold()
    try:
        size = max(0, int(clean.get("size") or 0))
    except (TypeError, ValueError):
        size = 0
    added_at = str(clean.get("added_at") or "")
    search_text = "\n".join(
        str(value)
        for value in (
            filename,
            title,
            notes,
            folder,
            source.get("title"),
            source.get("uploader"),
            source.get("webpage_url") or source.get("url"),
        )
        if value
    ).casefold()
    return clean, (
        path,
        json.dumps(clean, ensure_ascii=False),
        filename,
        kind,
        folder,
        name_sort,
        size,
        added_at,
        search_text,
        source.get("type"),
        source.get("op"),
        source.get("imagery_mode"),
        int(_has_gps(clean)),
    )
