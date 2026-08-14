"""Case sheets: a table the analyst works in, stored as a real CSV.

**The file is the sheet.** Not rows in the database with CSV as an import format —
`sheets/<name>.csv` is the artifact, it opens in any spreadsheet, and a case whose
app is gone still holds a readable table. That is the whole design, and everything
below follows from it:

- What the analyst *found* is a column of the table. A status, a reason, the date a
  row was checked: hand the file to someone else and the work is still there.
- What the *grid* remembers is a sidecar (`sheets/.meta/<name>.json`). Column
  widths, hidden columns, the sort, row colours, and which entity a cell points at.
  Losing it costs presentation, never a finding.

A CSV row has no identity, which is the one hard problem here: a colour or an
entity link hung on "row 4" moves to the wrong row the moment someone sorts the
file in Excel. So a sheet carries an **id column**, in the file, in plain sight. A
file that already has one keeps it — an imported export usually does, and adding a
second key column beside it would be noise. Otherwise one is added on first open,
and the first save is what writes it down.

The other consequence of the file being the artifact is that the analyst may have
it open in a spreadsheet at the same time as the grid. So a read hands out a
**stamp** and a save may present it back: if the file moved on in between, the save
is refused rather than allowed to overwrite work it never saw.

Bounds are enforced here rather than at the route, because both the editor and the
import land on the same table and one of them would drift.
"""

from __future__ import annotations

import csv
import io
import json
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .. import layout
from ..workspace import CaseError, ensure_dir

if TYPE_CHECKING:
    from ..workspace import Case

#: The column holding each row's identity. Lowercase because a file that already
#: has one usually spells it this way, and adopting it beats adding a second.
ID_COLUMN = "id"

#: What one sheet may hold. A worklist of a few thousand rows is the workflow;
#: past this it is a dataset, and a grid in a browser is the wrong tool for it.
MAX_ROWS = 20_000
MAX_COLUMNS = 64
#: One cell. The same bound a declared long-text attr gets: a cell holds a note,
#: not a document.
MAX_CELL = 4_000
#: A column heading.
MAX_COLUMN_NAME = 120
#: An uploaded CSV, before it is parsed. Generous for 20 000 rows of text, small
#: enough that a mis-picked file is refused rather than read into memory.
MAX_IMPORT_BYTES = 16 * 1024 * 1024

#: Row colours the grid offers, by key. Stored as a key rather than a hex value so
#: the palette can follow the theme and an old sheet still paints. Drawn from the
#: annotation palette, never the amber accent: that one means selection.
ROW_COLOURS = ("red", "orange", "yellow", "green", "blue", "grey")

#: Delimiters worth guessing between. A European export is semicolon-separated far
#: too often for "comma or nothing" to be an acceptable import.
DELIMITERS = (",", ";", "\t", "|")


class SheetError(ValueError):
    """A table that cannot be stored as asked."""


class SheetConflict(ValueError):
    """The file moved on since the grid read it, so the save was not made.

    Deliberately not a ``SheetError``: nothing is wrong with the table that was
    posted, and the answer is a 409 the grid recovers from by reloading rather than
    a 422 saying the request was bad.
    """


def _new_row_id() -> str:
    return f"r{uuid.uuid4().hex[:10]}"


def stamp(path: Path) -> str:
    """What the file looked like, as one short opaque token.

    Modification time and size together: a spreadsheet that rewrites a row changes
    at least one of them, and comparing two tokens is cheaper than re-reading a
    twenty-thousand-row CSV to find out whether it is still the one that was read.
    A missing file stamps as the empty string, so a file appearing where the grid
    saw none is a mismatch rather than a silent overwrite.
    """
    try:
        info = path.stat()
    except OSError:
        return ""
    return f"{info.st_mtime_ns}-{info.st_size}"


def sniff_delimiter(sample: str) -> str:
    """The delimiter a file's first non-empty line is most likely written with.

    Counted outside quotes, so a comma inside `"Smith, J"` does not vote for the
    comma. Ties go to the earliest in `DELIMITERS`, which puts the standard first.
    """
    line = next((row for row in sample.splitlines() if row.strip()), "")
    best, best_count = DELIMITERS[0], 0
    for delimiter in DELIMITERS:
        count, quoted = 0, False
        for char in line:
            if char == '"':
                quoted = not quoted
            elif char == delimiter and not quoted:
                count += 1
        if count > best_count:
            best, best_count = delimiter, count
    return best


def _clean_cell(value: Any) -> str:
    """One cell, as text with no control characters and inside the length bound.

    Newlines survive: a note column is the reason a cell may hold sentences, and
    the CSV writer quotes them correctly. Everything else below 0x20 goes — a stray
    NUL or a vertical tab in a pasted table breaks the file for the next reader.
    """
    text = "" if value is None else str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(char for char in text if char == "\n" or char >= " ")
    if len(text) > MAX_CELL:
        raise SheetError(f"a cell holds at most {MAX_CELL} characters")
    return text


def normalize(columns: list[Any], rows: list[Any]) -> tuple[list[str], list[list[str]]]:
    """The table as it will be written: named columns, square rows, keyed rows.

    Every route goes through this — a save, an import, a fresh sheet — so the file
    on disk has one shape whatever wrote it. Blank and duplicate headings are named
    rather than refused: an analyst's export routinely has both, and refusing the
    file at the door is worse than fixing it and showing what happened.
    """
    names: list[str] = []
    seen: set[str] = set()
    for index, raw in enumerate(columns):
        name = _clean_cell(raw).replace("\n", " ").strip()[:MAX_COLUMN_NAME]
        if not name:
            name = f"Column {index + 1}"
        candidate, suffix = name, 2
        while candidate.casefold() in seen:
            candidate = f"{name} ({suffix})"
            suffix += 1
        seen.add(candidate.casefold())
        names.append(candidate)

    key = next((name for name in names if name.casefold() == ID_COLUMN), None)
    if key is None:
        names.insert(0, ID_COLUMN)
        key = ID_COLUMN
        rows = [["", *(row or [])] for row in rows]
    if len(names) > MAX_COLUMNS:
        raise SheetError(f"a sheet holds at most {MAX_COLUMNS} columns")
    if len(rows) > MAX_ROWS:
        raise SheetError(f"a sheet holds at most {MAX_ROWS} rows")

    key_at = names.index(key)
    table: list[list[str]] = []
    taken: set[str] = set()
    for row in rows:
        cells = [_clean_cell(cell) for cell in (row or [])][: len(names)]
        cells += [""] * (len(names) - len(cells))
        identity = cells[key_at].strip()
        if not identity or identity in taken:
            identity = _new_row_id()
        taken.add(identity)
        cells[key_at] = identity
        table.append(cells)
    return names, table


def parse_csv(text: str, *, delimiter: str | None = None) -> tuple[list[str], list[list[str]]]:
    """A CSV's heading row and body, normalized.

    A file with no rows at all still yields its columns, and a wholly empty file
    yields an empty sheet rather than an error: an analyst who imports the wrong
    thing should see an empty table and delete it, not read a stack trace.
    """
    body = text.lstrip("﻿")
    if not body.strip():
        return normalize([], [])
    reader = csv.reader(io.StringIO(body), delimiter=delimiter or sniff_delimiter(body))
    try:
        table = [row for row in reader]
    except csv.Error as exc:
        raise SheetError(f"this file is not readable as CSV: {exc}") from exc
    if not table:
        return normalize([], [])
    return normalize(table[0], table[1:])


def to_csv(columns: list[str], rows: list[list[str]]) -> str:
    """The table as a comma-separated file with LF endings.

    LF rather than the CRLF the CSV spec asks for: every spreadsheet reads both,
    and a case folder is copied between the three platforms we ship.
    """
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    writer.writerows(rows)
    return buffer.getvalue()


# -- the sidecar --------------------------------------------------------------


def empty_meta() -> dict[str, Any]:
    return {
        "version": 1,
        "widths": {},
        "hidden": [],
        "sort": None,
        "colours": {},
        "links": {},
        "frozen": None,
    }


def clean_meta(meta: Any, columns: list[str], rows: list[list[str]]) -> dict[str, Any]:
    """The sidecar reduced to what the table it describes can still carry.

    A width for a deleted column, a colour on a deleted row, a link in a column
    nobody kept: dropped on every save. Otherwise the sidecar only ever grows, and
    a sheet that has been reworked twice carries more dead state than table.
    """
    clean = empty_meta()
    if not isinstance(meta, dict):
        return clean
    known = {name for name in columns}
    identities = {row[columns.index(ID_COLUMN)] for row in rows} if rows else set()

    widths = meta.get("widths")
    if isinstance(widths, dict):
        for name, width in widths.items():
            if name in known and isinstance(width, (int, float)):
                clean["widths"][name] = max(60, min(720, int(width)))

    hidden = meta.get("hidden")
    if isinstance(hidden, list):
        # The id column is never hidden: it is the row's handle, and a grid that
        # hides it hides why a colour survived a re-sort.
        clean["hidden"] = [
            name for name in hidden if name in known and name != ID_COLUMN
        ]

    sort = meta.get("sort")
    if isinstance(sort, dict) and sort.get("column") in known:
        clean["sort"] = {"column": str(sort["column"]), "desc": bool(sort.get("desc"))}

    # One column may be kept beside the key while the table scrolls sideways. Never
    # the key itself: it already stays put, so recording it would record a change
    # that does nothing and then have to be undone by hand.
    frozen = meta.get("frozen")
    if isinstance(frozen, str) and frozen in known and frozen.casefold() != ID_COLUMN:
        clean["frozen"] = frozen

    colours = meta.get("colours")
    if isinstance(colours, dict):
        for identity, colour in colours.items():
            if identity in identities and colour in ROW_COLOURS:
                clean["colours"][identity] = colour

    links = meta.get("links")
    if isinstance(links, dict):
        for identity, cells in links.items():
            if identity not in identities or not isinstance(cells, dict):
                continue
            kept = {
                name: str(entity_id)
                for name, entity_id in cells.items()
                if name in known and isinstance(entity_id, str) and entity_id
            }
            if kept:
                clean["links"][identity] = kept
    return clean


def linked_entity_ids(meta: dict[str, Any]) -> list[str]:
    """Every entity a sheet's cells point at, deduplicated, in reading order."""
    found: list[str] = []
    for cells in (meta.get("links") or {}).values():
        found.extend(str(value) for value in cells.values() if value)
    return list(dict.fromkeys(found))


# -- files --------------------------------------------------------------------


def _sheet_entity(case: "Case", entity_id: str) -> dict[str, Any]:
    entity = case.get_entity(entity_id)
    if entity is None or entity.get("type") != "sheet":
        raise CaseError(f"sheet '{entity_id}' not found")
    return entity


def _paths(case: "Case", entity: dict[str, Any]) -> tuple[Path, Path]:
    rel = (entity.get("attrs") or {}).get("path")
    if not isinstance(rel, str) or not rel:
        raise CaseError(f"sheet '{entity['id']}' has no file")
    stem = Path(rel).stem
    return case.resolve_inside(rel), case.resolve_inside(layout.sheet_meta_rel(stem))


def target(case: "Case", title: str, *, taken_by: str | None = None) -> str:
    """A free case-relative path for a sheet called *title*.

    Same rule as every other named artifact: the name is the filename. A name
    already used gets a numbered suffix rather than a refusal, because the front
    already proposes free names and a save is not the moment to argue about one.
    """
    stem = layout.slugify(title, "Sheet")
    directory = case.resolve_inside(layout.sheet_rel(stem)).parent
    keep = case.resolve_inside(taken_by) if taken_by else None
    occupied = (
        {path.name.casefold() for path in directory.iterdir() if path != keep}
        if directory.is_dir()
        else set()
    )
    candidate, index = layout.sheet_rel(stem), 2
    while Path(candidate).name.casefold() in occupied:
        candidate = layout.sheet_rel(f"{stem}-{index}")
        index += 1
    return candidate


def create(
    case: "Case",
    title: str,
    columns: list[Any] | None = None,
    rows: list[Any] | None = None,
) -> dict[str, Any]:
    """File a new sheet: a graph row, a CSV on disk, and an empty sidecar.

    The table is written at creation rather than on first save, so a sheet made
    and never touched is still a real file the case owns — the same rule a note
    follows, and what keeps the trash and the bundle able to see it.
    """
    names, table = normalize(
        columns if columns is not None else ["Subject", "Status", "Notes"],
        rows if rows is not None else [],
    )
    entity = case.add_entity("sheet", layout.slugify(title, "Sheet"), {}, by="sheet")
    rel = target(case, str(entity["label"]))
    path = case.resolve_inside(rel)
    ensure_dir(path.parent)
    ensure_dir(case.resolve_inside(layout.sheet_meta_rel(Path(rel).stem)).parent)
    path.write_text(to_csv(names, table), encoding="utf-8")
    return case.update_entity(entity["id"], {"attrs": {"path": rel}})


def read(case: "Case", entity_id: str) -> dict[str, Any]:
    """One sheet: its table, its sidecar, its stamp, and whether ids were minted.

    ``assigned`` is how the grid knows the file on disk does not carry the keys it
    is showing yet. Reading never writes — a case opened to be looked at stays
    byte-identical — so the first save is what settles it.

    ``stamp`` is taken **before** the file is read, so a write landing between the
    two produces a token that no longer matches the bytes returned. Stamping after
    would hand back a token that says "this is current" for a table that is not.
    """
    entity = _sheet_entity(case, entity_id)
    path, meta_path = _paths(case, entity)
    token = stamp(path)
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError:
        raw = ""
    columns, rows = parse_csv(raw)
    try:
        stored = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        stored = None
    return {
        "id": entity_id,
        "title": entity.get("label") or "Sheet",
        "path": (entity.get("attrs") or {}).get("path"),
        "columns": columns,
        "rows": rows,
        "meta": clean_meta(stored, columns, rows),
        "stamp": token,
        "assigned": ID_COLUMN not in [
            _clean_cell(name).strip().casefold() for name in _heading(raw)
        ],
    }


def _heading(raw: str) -> list[str]:
    """The heading row exactly as the file holds it, for the id-column check."""
    body = raw.lstrip("﻿")
    if not body.strip():
        return []
    reader = csv.reader(io.StringIO(body), delimiter=sniff_delimiter(body))
    try:
        return next(reader, [])
    except csv.Error:
        return []


def write(
    case: "Case",
    entity_id: str,
    columns: list[Any],
    rows: list[Any],
    meta: Any,
    expected: str | None = None,
) -> dict[str, Any]:
    """Write a sheet's table and sidecar, and return what landed.

    Both files are written, in that order: a sidecar describing a table that was
    never saved would paint rows the analyst does not have.

    *expected* is the stamp the caller last read. When it is given and the file no
    longer matches it, nothing is written and `SheetConflict` is raised: the analyst
    has the CSV open in a spreadsheet too, and the grid's twenty-minute-old copy of
    the table must not win over what they just typed there. Omitting it writes
    unconditionally, which is what a caller holding a table it just built — an
    import, a fresh sheet — is entitled to do.
    """
    entity = _sheet_entity(case, entity_id)
    path, meta_path = _paths(case, entity)
    if expected is not None and stamp(path) != expected:
        raise SheetConflict("this file changed on disk since it was opened")
    names, table = normalize(columns, rows)
    clean = clean_meta(meta, names, table)
    ensure_dir(path.parent)
    ensure_dir(meta_path.parent)
    path.write_text(to_csv(names, table), encoding="utf-8")
    meta_path.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"columns": names, "rows": table, "meta": clean, "stamp": stamp(path)}


def summary(case: "Case", entity: dict[str, Any]) -> dict[str, Any]:
    """A row for the sheet list: what it is called and how big it is.

    Counted through the CSV reader rather than by counting lines, because a note
    column holds sentences and a quoted newline is one row, not two.
    """
    rel = (entity.get("attrs") or {}).get("path")
    rows = columns = 0
    if isinstance(rel, str) and rel:
        try:
            raw = case.resolve_inside(rel).read_text(encoding="utf-8-sig")
        except (OSError, CaseError):
            raw = ""
        if raw.strip():
            reader = csv.reader(io.StringIO(raw.lstrip("﻿")), delimiter=sniff_delimiter(raw))
            try:
                columns = len(next(reader, []))
                rows = sum(1 for _ in reader)
            except csv.Error:
                columns = rows = 0
    return {
        "id": entity.get("id"),
        "title": entity.get("label") or "Sheet",
        "path": rel,
        "rows": rows,
        "columns": columns,
        "created_at": (entity.get("prov") or {}).get("at"),
    }
