"""Cases in the shapes older releases wrote them, for whatever has to still
read one: the migration tests, and the bundle tests that prove a bundle
exported by an earlier release still imports.

Two shapes, and they are different things. `write_legacy_json_case` writes a
case whose *graph* lives inline in `case.json` — `Case.create` only makes SQLite
cases now, so that file never originates from the app any more, only from an
older release. `rewind_case` takes a current case and reconstructs one of the
unreleased folder checkpoints; `unwrap_case` is its schema-4 shorthand.
"""

from __future__ import annotations

import json
import shutil
from typing import Any

from azimut import config, layout, workspace
from azimut.workspace import JSON_SCHEMA, Case, _now, _slugify

#: The content directories as they were before the `azimut/` wrapper.
LEGACY_SUBDIRS = ("media", "notes", "proofs", "exports", "inspect", "search")


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
    # Deliberately the flat, unwrapped shape: the tool's files sit at the case
    # root, the way every release before the `azimut/` wrapper wrote them. This
    # is a historical format, so it is spelled out here rather than asked of
    # `layout` — which now answers for the current one.
    for sub in LEGACY_SUBDIRS:
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


def read_legacy_manifest(case: Case) -> dict[str, Any]:
    """The manifest of a case that has not been opened yet.

    An unwrapped case keeps `case.json` at its own root, so `Case.read()` cannot
    find it — that is the whole reason the wrapper migration runs before
    anything reads the manifest. A test asserting on the *fixture's* content
    rather than on the migrated result reads it from here.
    """
    return json.loads((case.path / "case.json").read_text(encoding="utf-8"))


def legacy_manifest_path(case: Case):
    """Where an unopened case still keeps its manifest."""
    return case.path / "case.json"


def _rewind_notes(case: Case) -> None:
    for entity in case.list_entities():
        if entity.get("type") != "note":
            continue
        current = (entity.get("attrs") or {}).get("path")
        if not isinstance(current, str):
            continue
        legacy = f"notes/{entity['id']}.md"
        source = case.resolve_inside(current)
        destination = case.resolve_inside(legacy)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.exists() and source != destination:
            shutil.move(str(source), str(destination))
        case.update_entity(entity["id"], {"attrs": {"path": legacy}})
    notes = case.note_dir
    for directory in sorted(
        (path for path in notes.rglob("*") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    ):
        if not any(directory.iterdir()):
            directory.rmdir()


def _rewind_moved_paths(case: Case) -> None:
    rules = {
        "proof": ("spec", "proofs/.meta/", "proofs/"),
        "inspect-session": ("spec", ".inspect/", "inspect/"),
        "post": ("draft", ".drafts/", "exports/"),
    }
    for entity in case.list_entities():
        rule = rules.get(str(entity.get("type") or ""))
        if rule is None:
            continue
        attribute, current_prefix, legacy_prefix = rule
        current = (entity.get("attrs") or {}).get(attribute)
        if not isinstance(current, str) or not current.startswith(current_prefix):
            continue
        case.update_entity(
            entity["id"],
            {"attrs": {attribute: legacy_prefix + current.removeprefix(current_prefix)}},
        )


def _rewind_trash(case: Case) -> None:
    groups = [*case.list_trash(), *case.list_incomplete_trash()]
    for group in groups:
        payload = dict(group.get("payload") or {})
        files = [str(path) for path in payload.get("files") or []]
        slots = [str(path) for path in payload.get("slots") or []]
        if len(files) != len(slots):
            continue
        root = case.trash_dir / group["id"]
        for relative, slot in zip(files, slots):
            source = root / slot
            destination = root / relative
            if source.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(destination))
        payload.pop("slots", None)
        case.update_trash_group(group["id"], payload=payload)


def _rewind_hidden_layout(case: Case) -> None:
    tool = case.tool_root
    _rewind_moved_paths(case)
    shutil.move(str(layout.database(case.path)), str(tool / layout.PRE_HIDDEN_DB))
    layout.data_dir(case.path).rmdir()
    meta = tool / "media" / layout.META_DIR
    if meta.is_dir():
        for sidecar in sorted(meta.iterdir()):
            name = sidecar.name.removesuffix(".json")
            shutil.move(
                str(sidecar),
                str(tool / "media" / (name + layout.PRE_HIDDEN_SIDECAR_SUFFIX)),
            )
        meta.rmdir()
    proof_meta = tool / "proofs" / layout.META_DIR
    if proof_meta.is_dir():
        for entry in sorted(proof_meta.iterdir()):
            shutil.move(str(entry), str(tool / "proofs" / entry.name))
        proof_meta.rmdir()
    for old, new in layout.PRE_HIDDEN_DIRS.items():
        if (tool / old).is_dir():
            (tool / old).rmdir()  # the empty `exports/` the migration left
        shutil.move(str(tool / new), str(tool / old))
    case._sqlite_cache = workspace._UNSET


#: Content directories the layout gained after the `azimut/` wrapper shipped. They
#: postdate every unwrapped checkpoint, so a rewind removes them rather than putting
#: them at the case root where they never were.
POST_WRAPPER_DIRS = frozenset({"sheets"})


def rewind_case(case: Case, schema: int) -> None:
    """Reconstruct one folder checkpoint from the final schema-9 layout.

    These shapes were never released, but the consolidated normalizer accepts
    them so a case opened by a development build cannot be stranded.
    """
    if not workspace.STORAGE_SCHEMA <= schema < workspace.CASE_SCHEMA:
        raise ValueError("folder checkpoint must be between storage and current schema")

    layout.readme(case.path).unlink(missing_ok=True)
    if schema < workspace.STORAGE_SCHEMA + 4:
        _rewind_notes(case)
    if schema < workspace.STORAGE_SCHEMA + 3:
        _rewind_hidden_layout(case)
    if schema < workspace.STORAGE_SCHEMA + 1:
        _rewind_trash(case)

    manifest = case.read()
    manifest["azimut"]["schema"] = schema
    case._write_json(manifest)
    if schema < workspace.STORAGE_SCHEMA + 2:
        tool = case.tool_root
        for entry in sorted(tool.iterdir()):
            if entry.name in POST_WRAPPER_DIRS and entry.is_dir():
                # A directory the layout gained after the wrapper shipped was never
                # at a case root, so moving one there would build a shape no real
                # case has ever had — and the migration would rightly leave it
                # behind as the analyst's own folder.
                held = [path for path in entry.rglob("*") if path.is_file()]
                if held:
                    raise AssertionError(
                        f"'{entry.name}' holds {len(held)} file(s) at this checkpoint; "
                        "rewind it deliberately instead of dropping it here"
                    )
                shutil.rmtree(entry)
                continue
            shutil.move(str(entry), str(case.path / entry.name))
        tool.rmdir()
    case._sqlite_cache = workspace._UNSET


def unwrap_case(case: Case) -> None:
    """Put a case back at the checkpoint immediately before the wrapper."""
    rewind_case(case, workspace.STORAGE_SCHEMA + 1)
