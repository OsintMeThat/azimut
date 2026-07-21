"""Write a legacy json-storage case on disk, for the migration tests.

`Case.create` only makes SQLite cases now — the live in-file JSON graph backend
was removed once every case runs on `case.db`. The JSON→SQLite importer and the
on-open migration stay, so a legacy json case still has to be openable; it just
never originates from the app any more, only from an older release's files. This
helper writes that file (schema ``JSON_SCHEMA`` by default) so `Case.open` can
migrate it, and the converter tests can read it.
"""

from __future__ import annotations

import json
from typing import Any

from azimut import config
from azimut.workspace import CASE_SUBDIRS, JSON_SCHEMA, Case, _now, _slugify


def write_legacy_json_case(
    name: str,
    *,
    schema: int = JSON_SCHEMA,
    entities: list[dict[str, Any]] | None = None,
    links: list[dict[str, Any]] | None = None,
    folders: list[str] | None = None,
    scratch: bool = False,
) -> Case:
    """Create a case directory holding an old ``storage: "json"`` ``case.json``
    (graph inline) and return an un-migrated `Case` handle over it. Opening it
    with `Case.open` converts it to sqlite."""
    parent = config.scratch_dir() if scratch else config.cases_dir()
    parent.mkdir(parents=True, exist_ok=True)
    path = parent / _slugify(name)
    path.mkdir()
    for sub in CASE_SUBDIRS:
        (path / sub).mkdir()
    (path / "notes.md").write_text(f"# {name}\n\n", encoding="utf-8")
    data = {
        "azimut": {"schema": schema, "storage": "json"},
        "name": name,
        "created_at": _now(),
        "updated_at": _now(),
        "folders": folders or [],
        "entities": entities or [],
        "links": links or [],
    }
    (path / "case.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return Case(path)
