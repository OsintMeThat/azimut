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
import os
import tempfile
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .. import layout
from ..workspace import CaseError, ensure_dir
from . import sheetroles

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
#: One column's note — the line of instruction the binders drew with annotated
#: screenshots. A line, not a paragraph: it is read in a tooltip.
MAX_NOTE = 240
#: The word the grid was searching when it was last left. A term, not a document.
MAX_QUERY = 200
#: How many chosen values one column's filter may carry. The menu offers a page of
#: forty; a filter built by clicking chips can hold more, and nothing needs a thousand.
MAX_FILTER_VALUES = 200
#: What a row colour is said to mean in this sheet. A word or two — it is drawn in a
#: legend strip, not read as prose.
MAX_LEGEND = 40
#: The two lines of instruction above the grid. The binders carried a whole "How to
#: use" tab of annotated screenshots; most of what it said belongs on the columns it
#: was about (``notes``), and what is left is what the sheet as a whole is for.
MAX_DESCRIPTION = 400
#: How many case files one row may hang off itself. A row is a line of work, and a
#: dozen pieces attached to one is a folder, which the Media Library already is.
MAX_ATTACHMENTS = 12
#: How many of a column's words may be pointed at the case. The promotion's own bound:
#: past it the column is prose, and prose is searched rather than promoted.
MAX_COLUMN_VALUES = 500
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


class SheetUnwritable(ValueError):
    """The table is fine and the file would not take it.

    The case this exists for is Windows: the analyst has the CSV open in Excel, which
    holds the handle, and the rename that lands the new copy is refused by the operating
    system. That is not a bad request and not a stale grid — it is a file that is busy,
    and the only useful answer names it so the analyst closes the spreadsheet.

    A 409 like ``SheetConflict``, because both mean "not now" rather than "not ever",
    and neither is a reason for the grid to throw away what it is holding.
    """


def key_index(columns: list[str]) -> int:
    """Where the row's handle sits in a heading row.

    Matched without regard to case, because a file that already had a key column keeps
    **its own spelling** (`normalize`) and an exported table routinely writes `ID`. Asked
    for by every reader that has to look a row up, and it is one function rather than an
    `.index()` at each of them: the literal lookup raised on precisely the files this
    module promises to adopt rather than rewrite.
    """
    return next((at for at, name in enumerate(columns) if name.casefold() == ID_COLUMN), 0)


def new_row_id() -> str:
    """A fresh row key. Public because a table built elsewhere in the app — a worklist
    made out of the catalog — has to mint the keys its own sidecar will hang on."""
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
            identity = new_row_id()
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


#: How a sheet's CSV is written. The BOM is for Excel and only for Excel: without it
#: Excel opens a UTF-8 CSV in the legacy codepage of the machine, so a Ukrainian
#: place name or a French street arrives as mojibake — on Windows, which is one of the
#: three binaries we ship. Every reader here already opens files as ``utf-8-sig``, so
#: the mark is stripped back off on the way in, and LibreOffice never needed it either
#: way. The sidecar is plain ``utf-8``: a BOM in JSON breaks strict parsers.
CSV_ENCODING = "utf-8-sig"


def write_atomic(path: Path, text: str, *, encoding: str) -> None:
    """Replace *path* with *text*, or leave it exactly as it was.

    ``write_text`` truncates the file and then writes it, so a process killed in
    between — or a disk that fills, or a laptop that sleeps badly — leaves the analyst
    with half a table or none. The sheet is *the* artifact of this tool, which makes it
    the one file in the app least able to afford that.

    So: a temporary file beside it, flushed to the platter, then one rename. The same
    shape `config.write_pointer` uses, for the same reason. `os.replace` is atomic on
    POSIX and on Windows, and the temporary lands in the same directory so the rename
    never crosses a filesystem.

    `OSError` is raised as `SheetUnwritable`: a read-only folder and a spreadsheet
    holding the file open are the two ways this fails in practice, and both deserve a
    sentence rather than a 500.
    """
    # Encoded here rather than by the file handle so that `replace_atomic` owns the
    # rename for both callers: the bytes are identical either way, since the text is
    # written with no newline translation.
    replace_atomic(path, text.encode(encoding))


def replace_atomic(path: Path, data: bytes) -> None:
    """The rename `write_atomic` is made of, over bytes rather than text.

    Its own function because a rollback has to put back the exact bytes a file held,
    and re-encoding text it had already decoded would add or drop a byte order mark.
    """
    try:
        ensure_dir(path.parent)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    except OSError as exc:
        # Making the folder counts: it is where a read-only case, or a name already taken
        # by a directory, fails — and an `OSError` escaping here is the 500 this exists
        # to prevent.
        raise SheetUnwritable(f"could not write beside “{path.name}”: {exc}") from exc
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except OSError as exc:
        raise SheetUnwritable(f"could not write “{path.name}”: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


def _bytes_at(path: Path) -> bytes | None:
    """What a file holds right now, or None when it holds nothing readable.

    Half of a rollback: a write that touches two files has to be able to put the first
    one back when the second is refused.
    """
    try:
        return path.read_bytes()
    except OSError:
        return None


def _put_back(path: Path, data: bytes | None) -> None:
    """Restore a file to the bytes it held, or remove it if it held none.

    Best effort: it runs while another failure is on its way up, and raising over the
    restore would replace a sentence the analyst can act on with one they cannot.
    """
    try:
        if data is None:
            path.unlink(missing_ok=True)
        else:
            replace_atomic(path, data)
    except (OSError, SheetUnwritable):
        return


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


#: The sidecar shape written today. Version 2 is where **roles** arrive: a column's
#: kind, its vocabulary, its separator. Everything before it was presentation — widths,
#: colours, a sort — and that was the first thing the sidecar knew that changes what a
#: cell *means* to the app. Version 3 adds ``promoted``: what a cell said at the moment
#: the case took it, which is what lets a row say it has moved on since. Version 4 adds
#: **the question** — the search term and the filters — plus the colour legend, the
#: pinned row, the row height and a second sort key: everything the analyst had set up
#: and lost on the next restart. Version 5 is the bridge to the case finished:
#: ``anchors`` (the named moments an offset column counts from), ``attachments`` (case
#: files a row hangs off itself, referenced and never copied), ``values`` (what a
#: column's *words* mean in the case, which is the grain a whole column is promoted at)
#: and ``description`` (the two lines the binders' "How to use" tab was actually for).
#: Version 6 adds ``built``: the entity a row was **made from**, which is not the same
#: thing as the entity its cells point at. A link is dropped the moment the case stops
#: holding what it names — that is `drop_dead_links`, and it is right to do it — so a
#: sheet built out of the case had no way to say "this row had a proof and no longer
#: does". ``built`` is the half that survives the sweep, and it is what the ``in_case``
#: nature reads.
#: Additive throughout, and `clean_meta` still reads a 1.
META_VERSION = 6


def empty_meta() -> dict[str, Any]:
    return {
        "version": META_VERSION,
        "widths": {},
        "hidden": [],
        "sort": None,
        "colours": {},
        "links": {},
        "frozen": None,
        "roles": {},
        "notes": {},
        "progress": None,
        "promoted": {},
        "query": "",
        "filters": {},
        "legend": {},
        "pinned": None,
        "tall": False,
        "anchors": {},
        "attachments": {},
        "values": {},
        "description": "",
        "built": {},
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
    identities = {row[key_index(columns)] for row in rows} if rows else set()

    widths = meta.get("widths")
    if isinstance(widths, dict):
        for name, width in widths.items():
            if name in known and isinstance(width, (int, float)):
                clean["widths"][name] = max(60, min(720, int(width)))

    hidden = meta.get("hidden")
    if isinstance(hidden, list):
        # The id column is never hidden: it is the row's handle, and a grid that
        # hides it hides why a colour survived a re-sort.
        clean["hidden"] = [name for name in hidden if name in known and name != ID_COLUMN]

    # One key, and optionally a second one under it: a worklist is read as "by status,
    # then by date", and a single key made the analyst re-sort by hand every time the
    # first one tied. The second is dropped when it names the first column — one column
    # cannot break its own tie.
    sort = meta.get("sort")
    if isinstance(sort, dict) and sort.get("column") in known:
        clean["sort"] = {"column": str(sort["column"]), "desc": bool(sort.get("desc"))}
        then = sort.get("then")
        if (
            isinstance(then, dict)
            and then.get("column") in known
            and str(then["column"]) != str(sort["column"])
        ):
            clean["sort"]["then"] = {
                "column": str(then["column"]),
                "desc": bool(then.get("desc")),
            }

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

    # -- version 2: what the app knows about a column ------------------------
    clean["roles"] = sheetroles.clean_roles(meta.get("roles"), columns)

    notes = meta.get("notes")
    if isinstance(notes, dict):
        for name, note in notes.items():
            text = _clean_cell(note).replace("\n", " ").strip()[:MAX_NOTE]
            if name in known and text:
                clean["notes"][name] = text

    # Which column says how far along the work is. One per sheet: "where is this
    # chantier" is a question, not five, and two answers would need two footers.
    progress = meta.get("progress")
    if isinstance(progress, str) and progress in known:
        clean["progress"] = progress

    # -- version 3: what the cell said when the case took it -----------------
    # Kept so a promoted row can say it has been edited since. The value rather than a
    # flag, because "changed" is only worth saying when it can be compared: a flag set
    # on every save would mark every row the analyst scrolled past.
    promoted = meta.get("promoted")
    if isinstance(promoted, dict):
        for identity, cells in promoted.items():
            if identity not in identities or not isinstance(cells, dict):
                continue
            kept = {
                name: _clean_cell(said)
                for name, said in cells.items()
                if name in known and isinstance(said, str)
            }
            if kept:
                clean["promoted"][identity] = kept

    # -- version 4: the question, and the rest of the reading -----------------
    # The sidecar already carried the sort and the hidden columns, which is half a
    # reading; the half that decides what is on screen — the search and the filters —
    # lived in the tab and died with it. A sheet that reopens showing all four hundred
    # rows is a sheet whose analyst has to rebuild their question every morning.
    query = meta.get("query")
    if isinstance(query, str):
        clean["query"] = _clean_cell(query).replace("\n", " ").strip()[:MAX_QUERY]

    filters = meta.get("filters")
    if isinstance(filters, dict):
        for name, entry in filters.items():
            if name not in known or not isinstance(entry, dict):
                continue
            asked = _clean_filter(entry)
            if asked:
                clean["filters"][name] = asked

    # What a colour means in *this* sheet. Six colours with no legend is six colours
    # whose meaning lives in one analyst's head, which is the opposite of handing the
    # case over.
    legend = meta.get("legend")
    if isinstance(legend, dict):
        for colour, label in legend.items():
            if colour not in ROW_COLOURS or not isinstance(label, str):
                continue
            text = _clean_cell(label).replace("\n", " ").strip()[:MAX_LEGEND]
            if text:
                clean["legend"][colour] = text

    # One row kept under the heading while the rest scrolls: the reference candidate a
    # comparison grid is read against. Keyed like a colour, so a re-sort cannot move it.
    pinned = meta.get("pinned")
    if isinstance(pinned, str) and pinned in identities:
        clean["pinned"] = pinned

    clean["tall"] = bool(meta.get("tall"))

    # -- version 5: the moments, the pieces and what the sheet is for ---------
    # A named shot several videos are lined up on, and the time it happened once
    # somebody works that out. Kept here rather than in the offset columns because one
    # anchor serves several of them, and a time restated per column is a time that will
    # disagree with itself.
    anchors = meta.get("anchors")
    if isinstance(anchors, dict):
        for name, entry in anchors.items():
            label = _clean_cell(name).replace("\n", " ").strip()[: sheetroles.MAX_ANCHOR_NAME]
            if not label or len(clean["anchors"]) >= sheetroles.MAX_ANCHORS:
                continue
            at = entry.get("at") if isinstance(entry, dict) else None
            clean["anchors"][label] = {"at": sheetroles.clean_anchor_at(at)}

    # Case files a row hangs off itself: the screenshot of the message giving the hour,
    # the emailed reply. **Referenced**, never copied — the entity is already the case's,
    # so nothing new is filed, no artifact is owned twice and the bundle does not drift.
    attachments = meta.get("attachments")
    if isinstance(attachments, dict):
        for identity, held in attachments.items():
            if identity not in identities or not isinstance(held, list):
                continue
            pieces: list[str] = []
            for entity_id in held:
                if isinstance(entity_id, str) and entity_id and entity_id not in pieces:
                    pieces.append(entity_id)
            if pieces:
                clean["attachments"][identity] = pieces[:MAX_ATTACHMENTS]

    # What a column's **words** mean in the case, which is not what `links` says. A link
    # is one cell pointing at one entity, and it cannot answer a cell holding three pieces
    # of equipment; a vocabulary pointed at the case can, and it is also the grain a whole
    # column is promoted at — forty names out of four hundred rows.
    values = meta.get("values")
    if isinstance(values, dict):
        for name, words in values.items():
            if name not in known or not isinstance(words, dict):
                continue
            meant = {
                _clean_cell(word).strip(): str(entity_id)
                for word, entity_id in list(words.items())[:MAX_COLUMN_VALUES]
                if _clean_cell(word).strip() and isinstance(entity_id, str) and entity_id
            }
            if meant:
                clean["values"][name] = meant

    description = meta.get("description")
    if isinstance(description, str):
        clean["description"] = _clean_cell(description).strip()[:MAX_DESCRIPTION]

    # -- version 6: the entity the row was made from --------------------------
    # Deliberately **not** run through the dead-link sweep below. An id here is a record
    # of where the row came from, not a claim that the case still holds it, so an entity
    # that has since been deleted must leave this exactly as it is — that is the one
    # question `in_case` exists to answer.
    built = meta.get("built")
    if isinstance(built, dict):
        for identity, entity_id in built.items():
            if identity in identities and isinstance(entity_id, str) and entity_id:
                clean["built"][identity] = entity_id
    return clean


#: What a column's filter may be asked, beyond which values it holds. Mirrors
#: `lib/sheet.FILL_ASKS`.
FILL_ASKS = ("blank", "filled", "unreadable")


def _clean_filter(entry: dict[str, Any]) -> dict[str, Any] | None:
    """One column's filter, or None when nothing is actually asked of it.

    The clauses are stored as the browser holds them, with one difference that matters:
    the chosen values are a **list** here and a Set there. JSON has no set, and a
    sidecar that carried one would be a file no other reader could parse.
    """
    values: list[str] = []
    raw = entry.get("values")
    if isinstance(raw, list):
        for value in raw:
            if isinstance(value, str) and value not in values:
                values.append(_clean_cell(value))
            if len(values) >= MAX_FILTER_VALUES:
                break
    fill = entry.get("fill")
    asked = {
        "values": values,
        "fill": fill if fill in FILL_ASKS else None,
        "contains": _clean_cell(entry.get("contains") or "").strip()[:MAX_QUERY],
        "without": _clean_cell(entry.get("without") or "").strip()[:MAX_QUERY],
        "from": _clean_cell(entry.get("from") or "").strip()[:MAX_QUERY],
        "to": _clean_cell(entry.get("to") or "").strip()[:MAX_QUERY],
    }
    if not any(asked.values()):
        return None
    return asked


def linked_entity_ids(meta: dict[str, Any]) -> list[str]:
    """Every entity a sheet points at, deduplicated, in reading order.

    Cells first, then what the rows have hung on themselves. Both become the same
    `mentions` edge, because both are the same statement: this sheet refers to that. A
    piece attached to a row and reachable only from the sheet would be a file the case
    holds and the subject's own panel could not see.
    """
    found: list[str] = []
    for cells in (meta.get("links") or {}).values():
        found.extend(str(value) for value in cells.values() if value)
    for words in (meta.get("values") or {}).values():
        found.extend(str(value) for value in words.values() if value)
    for held in (meta.get("attachments") or {}).values():
        found.extend(str(value) for value in held if value)
    return list(dict.fromkeys(found))


def sync_mentions(case: "Case", sheet_id: str, meta: dict[str, Any]) -> None:
    """Restate the entities this sheet points at, as ``mentions`` edges.

    Beside the sidecar it reads, because the edges are a *function* of it: whatever
    wrote the sidecar — a save, a promotion, a row moved to another sheet — the sheet
    should mention exactly what its rows now point at, and a link the analyst cleared
    should lose its edge.

    **A function of the sidecar, and only of the sidecar** (``own_only``). ``mentions``
    is also a relation an analyst may state by hand, and a sheet is one of the documents
    it can be stated from — so the graph holds two kinds, and reconciling over both let
    the sidecar-only route delete a claim nobody made in a cell. That route is the one
    behind a funnel being ticked, which is to say a click that touches no cell was
    permanently dropping somebody's own statement.

    A target the vocabulary refuses is skipped rather than raised: the cell keeps its
    link and the grid keeps working, exactly as a note's body does with a token pointing
    somewhere odd. The sidecar is the record either way — the edges are what make the
    sheet visible from the other end.
    """
    from . import links as link_engine

    source = case.get_entity(sheet_id)
    if source is None:
        return
    wanted: list[str] = []
    for entity_id in linked_entity_ids(meta):
        try:
            link_engine.check_relation_target(case, source, entity_id, link_engine.MENTIONS)
        except CaseError:
            continue
        wanted.append(entity_id)
    case.sync_links(sheet_id, link_engine.MENTIONS, wanted, by="sheet", own_only=True)


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

    **The file first, the row second.** A read-only folder, a full disk and a name
    taken by a directory are the three cases `SheetUnwritable` exists for, and filing
    the entity before the write left every one of them with a sheet the list showed
    and nothing could open. The label is slugified here rather than read back off the
    entity because the store keeps a label verbatim, so the path is known before the
    row exists.

    **The label is the file's own stem, suffix and all.** `target` steps a taken name to
    `-2` rather than refusing it, and the label used to keep the name that was asked for —
    so building the same shape twice left two sheets reading `My geolocations` in the list,
    backed by two different files, with nothing on screen to tell them apart. Taking the
    stem back is what makes the rule this module states hold at birth: the name *is* the
    filename.
    """
    names, table = normalize(
        columns if columns is not None else ["Subject", "Status", "Notes"],
        rows if rows is not None else [],
    )
    rel = target(case, layout.slugify(title, "Sheet"))
    write_atomic(case.resolve_inside(rel), to_csv(names, table), encoding=CSV_ENCODING)
    return case.add_entity("sheet", Path(rel).stem, {"path": rel}, by="sheet")


def discard(case: "Case", entity: dict[str, Any]) -> None:
    """Undo a `create` a later step made pointless: the row and the files it owns.

    Not the trash, because nothing here was ever the analyst's: a workbook whose fourth
    tab cannot be written should leave neither three sheets nor three bin entries to
    clean up. Best effort throughout — it runs while another failure is being raised,
    and hiding that one behind a second would be the worse answer.
    """
    rel = (entity.get("attrs") or {}).get("path")
    if isinstance(rel, str) and rel:
        for candidate in (rel, layout.sheet_meta_rel(Path(rel).stem)):
            try:
                case.resolve_inside(candidate).unlink(missing_ok=True)
            except (CaseError, OSError):
                continue
    try:
        case.remove_entity(str(entity["id"]))
    except CaseError:
        return


def read(case: "Case", entity_id: str) -> dict[str, Any]:
    """One sheet: its table, its sidecar, its stamp, and whether ids were minted.

    ``assigned`` is how the grid knows the file on disk does not carry the keys it
    is showing yet. Reading never writes — a case opened to be looked at stays
    byte-identical — so the first save is what settles it. A ``computed`` column is
    restated into the table handed over for the same reason and with the same rule: the
    grid shows what the case answers *now*, and the next save is what puts it on disk.

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
    clean = clean_meta(stored, columns, rows)
    # A link the case cannot answer for is not shown as one. In memory only: reading
    # never writes, so the file settles on the next save.
    clean = drop_dead_links(case, clean)
    # Roles whose column is no longer in the file. Reported rather than dropped in
    # silence: someone renaming a column in a spreadsheet takes the role with it, and a
    # lens configured in ten minutes is not a colour. Same idea as `assigned`.
    declared = (stored or {}).get("roles") if isinstance(stored, dict) else None
    dropped = (
        sorted(set(declared or {}) - set(clean["roles"])) if isinstance(declared, dict) else []
    )
    # What the case currently answers, restated into the table that is handed over — in
    # memory, so the read still leaves the file byte-identical. Without it an `On map`
    # column said whatever the last save said, and a place added from the map an hour ago
    # left the sheet reading NO until somebody happened to type in it.
    sheetroles.apply_computed(
        case, columns, rows, clean["roles"], clean["links"], clean["built"]
    )
    return {
        "id": entity_id,
        "title": entity.get("label") or "Sheet",
        "path": (entity.get("attrs") or {}).get("path"),
        "columns": columns,
        "rows": rows,
        "meta": clean,
        "stamp": token,
        "dropped_roles": dropped,
        "pieces": _pieces(case, clean),
        "assigned": ID_COLUMN
        not in [_clean_cell(name).strip().casefold() for name in _heading(raw)],
    }


def _pieces(case: "Case", meta: dict[str, Any]) -> dict[str, dict[str, str]]:
    """What each case file a row carries is called, so the panel can name it.

    The sidecar stores ids and only ids — a label copied beside one goes stale the moment
    the entity is renamed, which is the whole reason a link is an id. But a panel listing
    `e_58fea8e8f0` is a panel nobody can read, and there is no route that reads one entity,
    so the read that already answers the sidecar answers the names too.

    Attachments alone, and one walk of the graph rather than a lookup each: a sheet may
    point at hundreds of entities from its cells, and none of those needs a name here —
    a linked cell shows the words the file holds.
    """
    wanted = {
        str(entity_id) for held in (meta.get("attachments") or {}).values() for entity_id in held
    }
    if not wanted:
        return {}
    return {
        str(entity["id"]): {
            "label": str(entity.get("label") or ""),
            "type": str(entity.get("type") or ""),
        }
        for entity in case.list_entities()
        if str(entity["id"]) in wanted
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


def ensure_current(case: "Case", entity_id: str, expected: str | None) -> None:
    """Raise `SheetConflict` unless the file is still the one the caller read.

    The same check `write` makes, asked **before** anything else happens. Promotion is
    why it exists: it changes the graph and then saves the sheet, so finding out at the
    write that the file had moved on left entities behind for a save that never landed.
    A refusal has to come before the first entity, not after the last one.
    """
    entity = _sheet_entity(case, entity_id)
    path, _ = _paths(case, entity)
    if expected is not None and stamp(path) != expected:
        raise SheetConflict("this file changed on disk since it was opened")


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
    # A grid that has been open since before a delete still holds the link it made then,
    # and a save is exactly where that dead id would land back on disk.
    clean = drop_dead_links(case, clean)
    # The two columns the app fills rather than the analyst, in that order: a row that
    # has just been stamped is a row that exists, and `computed` restates the graph for
    # every row including it. Both write **into the table**, before it is serialised,
    # because both are columns a collaborator opening the CSV is meant to read.
    sheetroles.apply_stamped(names, table, clean["roles"])
    sheetroles.apply_computed(
        case, names, table, clean["roles"], clean["links"], clean["built"]
    )
    write_atomic(path, to_csv(names, table), encoding=CSV_ENCODING)
    write_atomic(meta_path, json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"columns": names, "rows": table, "meta": clean, "stamp": stamp(path)}


def write_meta(case: "Case", entity_id: str, meta: Any) -> dict[str, Any]:
    """Write the sidecar alone, leaving the CSV byte-identical.

    The route behind the grid's own view: a filter ticked, a column hidden, a colour
    painted, the row kept in view. All of those are the sidecar and none of them is the
    table — and a save that rewrote the CSV for them would move its modification time,
    which is what the stamp is made of. Two costs followed from that: the analyst's own
    next save answered a conflict nobody caused, and a spreadsheet open on the same file
    was told it had been overwritten because somebody clicked a funnel.

    So no stamp is presented and none is checked: nothing here can lose a cell. The
    columns and rows are read from disk only to know what the sidecar may still refer
    to, which is what `clean_meta` needs.
    """
    entity = _sheet_entity(case, entity_id)
    path, meta_path = _paths(case, entity)
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError:
        raw = ""
    columns, rows = parse_csv(raw)
    clean = clean_meta(meta, columns, rows)
    clean = drop_dead_links(case, clean)
    write_atomic(meta_path, json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"meta": clean}


#: How many sheets one page of the delete's sweep reads. A case has a handful, not a
#: catalog of them, so this is a bound rather than a paging strategy.
SHEET_PAGE = 200


def forget_entities(case: "Case", gone: set[str]) -> list[str]:
    """Drop every pointer the case's sheets keep at entities that have just gone.

    A sheet points at the case through **ids in a sidecar** — a cell's link, a column's
    vocabulary, the files a row carries — and none of those is an edge the graph takes
    with it. Deleting the entity left the cell still marked as linked, the row still
    carrying a file the case no longer holds, and a later save writing the dead id back.

    Called by the one delete every surface goes through, so a sheet cannot outlive what
    it points at whichever screen the click came from. The CSV is never touched: a link
    is the sidecar's, and rewriting the table here would move the stamp under an analyst
    who is typing in it.

    Returns the sheets it rewrote.
    """
    if not gone:
        return []
    rewritten: list[str] = []
    cursor: str | None = None
    while True:
        # The sheets alone, off the catalog rather than a walk of the graph: this runs
        # inside every delete, and a case holding a hundred thousand rows must not read
        # them to clear a link.
        page = case.page_entities(limit=SHEET_PAGE, cursor=cursor, types=["sheet"])
        for entity in page.get("items", []):
            try:
                _, meta_path = _paths(case, entity)
                stored = json.loads(meta_path.read_text(encoding="utf-8"))
            except (CaseError, OSError, ValueError):
                continue  # a sheet with no readable sidecar has nothing to forget
            if not isinstance(stored, dict):
                continue
            pruned = _without_entities(stored, gone)
            if pruned is None:
                continue
            try:
                write_meta(case, entity["id"], pruned)
            except (CaseError, OSError, SheetUnwritable):
                # One sheet whose file refuses is not a reason to fail the delete and
                # roll the whole thing back: that sheet keeps its dead link, every other
                # one is cleared, and nothing in the case is left half-deleted.
                # `SheetUnwritable` is named because it is a `ValueError` and not an
                # `OSError`, so it used to escape the sentence above and take the delete
                # down with it.
                continue
            rewritten.append(str(entity["id"]))
        cursor = page.get("next_cursor")
        if not cursor:
            return rewritten


def drop_dead_links(case: "Case", meta: dict[str, Any]) -> dict[str, Any]:
    """The sidecar with every pointer at something the case no longer holds removed.

    `forget_entities` clears the sheets as a delete happens, which is the eager half of
    this. The rule itself is here, and it runs on every read and every save, because a
    link can go dead without a delete ever passing through this app: a sidecar carried in
    from another case, a case restored beside sheets written against older ids, a file
    edited by hand. A cell claiming a link to nothing is worse than a plain cell — it
    reads as work already done, and it opens a panel about an entity nobody can see.

    One bounded lookup for the whole sidecar rather than a query per cell. Unchanged
    sidecars are handed straight back, so a read stays free of copying.
    """
    wanted = linked_entity_ids(meta)
    if not wanted:
        return meta
    held = {str(entity["id"]) for entity in case.entities_by_ids(wanted)}
    gone = {entity_id for entity_id in wanted if entity_id not in held}
    return _without_entities(meta, gone) or meta


def _without_entities(meta: dict[str, Any], gone: set[str]) -> dict[str, Any] | None:
    """The sidecar with every pointer at *gone* removed, or None when it held none.

    Answering None rather than a copy is what keeps a delete from rewriting every
    sidecar in the case: only a sheet that actually pointed at the deleted material is
    written, so nothing else has its file touched.
    """
    hit = False
    out = dict(meta)

    links = meta.get("links")
    if isinstance(links, dict):
        kept_rows: dict[str, Any] = {}
        for identity, cells in links.items():
            if not isinstance(cells, dict):
                continue
            kept = {name: value for name, value in cells.items() if value not in gone}
            if len(kept) != len(cells):
                hit = True
            if kept:
                kept_rows[identity] = kept
        if hit:
            out["links"] = kept_rows

    values = meta.get("values")
    if isinstance(values, dict):
        kept_columns: dict[str, Any] = {}
        touched = False
        for name, words in values.items():
            if not isinstance(words, dict):
                continue
            kept = {word: value for word, value in words.items() if value not in gone}
            if len(kept) != len(words):
                touched = True
            if kept:
                kept_columns[name] = kept
        if touched:
            hit = True
            out["values"] = kept_columns

    attachments = meta.get("attachments")
    if isinstance(attachments, dict):
        kept_held: dict[str, Any] = {}
        touched = False
        for identity, held in attachments.items():
            if not isinstance(held, list):
                continue
            left = [value for value in held if value not in gone]
            if len(left) != len(held):
                touched = True
            if left:
                kept_held[identity] = left
        if touched:
            hit = True
            out["attachments"] = kept_held

    return out if hit else None


def duplicate(
    case: "Case", entity_id: str, title: str | None = None, *, with_rows: bool = True
) -> dict[str, Any]:
    """A second sheet holding the same table and the same sidecar.

    The app's answer to "another reading of these rows" has always been *another sheet* —
    that is why there are no named views — and until this existed there was no way to make
    one without exporting the CSV and importing it back, which lost every colour, role and
    link on the way. The copy carries the sidecar whole: it is a fork of the work, not a
    blank grid with the same headings.

    The rows keep their keys. Two sheets naming the same row is not a clash — the key is
    the row's handle inside its own file — and it is what lets a promoted row in the copy
    still say which entity it came from.

    ``with_rows=False`` forks the **shape** instead: the same headings and everything the
    app knows about them — the roles, the vocabularies, the notes, the progress column,
    the anchors — with no rows under it. That is the other table the binders had, and it
    is not a copy: an inbox, a worklist and a reference table are three sheets at one
    schema, and a row moves up a floor as it is worked out. Everything the sidecar keyed
    on a row goes with the rows, which `clean_meta` does on its own once there are none.
    """
    source = _sheet_entity(case, entity_id)
    path, meta_path = _paths(case, source)
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError:
        raw = ""
    columns, rows = parse_csv(raw)
    if not with_rows:
        rows = []
    try:
        stored = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        stored = None
    fallback = "copy" if with_rows else "empty"
    name = (title or "").strip() or f"{source.get('label') or 'Sheet'} {fallback}"
    entity = create(case, name, columns, rows)
    saved = write(case, entity["id"], columns, rows, stored)
    return {**entity, "meta": saved["meta"]}


#: What the sidecar keeps per row, and therefore what travels when a row moves to
#: another sheet. Colours and links are keyed by the row key; `promoted`, `attachments`
#: and `built` are too. Everything else in the sidecar belongs to the column or to the
#: sheet, and staying behind is what it means for it to belong there.
ROW_KEYED = ("colours", "links", "promoted", "attachments", "built")


def column_pairs(
    names: list[str], to_columns: list[str], mapping: Any = None
) -> list[tuple[str, str]]:
    """Which column of this sheet lands in which column of that one.

    By name when nothing is said, which is what a move between two tabs of the same
    binder wants: the schema is shared, so the names already line up. *mapping* is what
    a dialog that has read both shapes hands over instead — `Adresse` into `Address` is
    one column spelled twice, and the name match alone called it a loss. A source column
    left out of it, or pointed at nothing, is dropped.

    The destination's shape stays its own: a target it does not have is refused rather
    than added, and two columns cannot be poured into one.
    """
    if mapping is None:
        return [
            (name, name) for name in names if name in to_columns and name.casefold() != ID_COLUMN
        ]
    if not isinstance(mapping, dict):
        raise SheetError("the column mapping must say which column lands in which")
    known = set(names)
    theirs = set(to_columns)
    pairs: list[tuple[str, str]] = []
    taken: set[str] = set()
    for source, target in mapping.items():
        if not isinstance(source, str) or not isinstance(target, str) or not target:
            continue
        # The key column is matched without regard to case for the same reason it is
        # everywhere else: a file that arrived spelling it `ID` keeps its own spelling.
        if source not in known or source.casefold() == ID_COLUMN:
            raise SheetError(f"this sheet has no column called “{source}”")
        if target not in theirs or target.casefold() == ID_COLUMN:
            raise SheetError(f"that sheet has no column called “{target}”")
        if target in taken:
            raise SheetError(f"two columns cannot both land in “{target}”")
        taken.add(target)
        pairs.append((source, target))
    # In the order the source draws them, so what the answer names reads like the sheet.
    order = {name: index for index, name in enumerate(names)}
    return sorted(pairs, key=lambda pair: order[pair[0]])


def move_rows(
    case: "Case",
    from_id: str,
    to_id: str,
    keys: list[str],
    columns: list[Any],
    rows: list[Any],
    meta: Any,
    mapping: Any = None,
    expected: str | None = None,
) -> dict[str, Any]:
    """Take rows out of one sheet and put them in another, columns matched by name.

    The gesture the binders' three tabs were built out of: an inbox, a worklist and a
    reference table at one schema, and a row that has been worked out **moves up a
    floor**. Copying it by hand loses the colour, the entity the cell points at and the
    record that it was already promoted, which is exactly the state worth keeping.

    Columns are matched **by name** unless *mapping* says otherwise, and a column with
    nothing in front of it is dropped rather than added: the destination's shape is its
    own, and a move that grew it by three columns would be an import wearing a different
    word. What was dropped is answered, because a silent loss reads as a clean move.

    The source's table travels in the request the way a promotion's does — the analyst
    moves what is on screen, and the version on disk may be a minute behind — so the
    source's stamp is presented and the write is refused if the file moved on. The
    destination is read from disk immediately before it is written, which is the whole
    window in which nothing can have touched it.

    A key already taken in the destination is minted fresh, and everything the sidecar
    hung on the old one moves with it: two sheets can hold the same key without it being
    a clash, but one sheet holding it twice would be.
    """
    if from_id == to_id:
        raise SheetError("a row cannot be moved into the sheet it is already in")
    _sheet_entity(case, from_id)
    target = _sheet_entity(case, to_id)
    ensure_current(case, from_id, expected)

    names, table = normalize(columns, rows)
    clean = clean_meta(meta, names, table)
    key_at = key_index(names)
    wanted = [key for key in dict.fromkeys(keys) if key]
    taking = {row[key_at] for row in table if row[key_at] in set(wanted)}
    if not taking:
        raise SheetError("none of these rows are in this sheet")

    to_path, to_meta_path = _paths(case, target)
    try:
        raw = to_path.read_text(encoding="utf-8-sig")
    except OSError:
        raw = ""
    to_columns, to_rows = parse_csv(raw)
    try:
        to_stored = json.loads(to_meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        to_stored = {}
    if not isinstance(to_stored, dict):
        to_stored = {}

    pairs = column_pairs(names, to_columns, mapping)
    landing_of = dict(pairs)
    dropped = [name for name in names if name not in landing_of and name != ID_COLUMN]
    to_key_at = key_index(to_columns)
    held = {row[to_key_at] for row in to_rows}

    carried: dict[str, dict[str, Any]] = {key: dict(to_stored.get(key) or {}) for key in ROW_KEYED}
    #: The key each row is filed under over there, which is the only handle an undo has:
    #: a key already taken in the destination is minted fresh, so the row the analyst
    #: sent is not always the row they could ask for back by name.
    landed: list[str] = []
    for row in table:
        identity = row[key_at]
        if identity not in taking:
            continue
        fresh = identity if identity not in held else new_row_id()
        held.add(fresh)
        landing = [""] * len(to_columns)
        landing[to_key_at] = fresh
        for mine, theirs in pairs:
            landing[to_columns.index(theirs)] = row[names.index(mine)]
        to_rows.append(landing)
        landed.append(fresh)
        for key in ROW_KEYED:
            was = (clean.get(key) or {}).get(identity)
            if was is None:
                continue
            # A link or a promoted reading is keyed by column as well as by row, so a
            # column the destination does not have loses it here rather than carrying a
            # pointer into a column nobody can see.
            if key in ("links", "promoted"):
                was = {landing_of[name]: value for name, value in was.items() if name in landing_of}
                if not was:
                    continue
            carried[key][fresh] = was

    # What the destination held, kept as bytes so a refused source write can put it back
    # exactly. The order stands — the destination first — but the moment between the two
    # writes must not become a permanent state: a row in both sheets is the duplicate an
    # analyst cannot see, since it is in another sheet under another key. `undo_move`
    # reasons about the same window and reaches the same conclusion.
    to_was = (_bytes_at(to_path), _bytes_at(to_meta_path))
    saved_to = write(case, to_id, to_columns, to_rows, {**to_stored, **carried})
    sync_mentions(case, to_id, saved_to["meta"])

    stayed = [row for row in table if row[key_at] not in taking]
    left = {
        **clean,
        **{
            key: {
                identity: value
                for identity, value in (clean.get(key) or {}).items()
                if identity not in taking
            }
            for key in ROW_KEYED
        },
    }
    try:
        saved_from = write(case, from_id, names, stayed, left, expected=expected)
    except Exception:
        # The source refused — a spreadsheet holding it open, or a file that moved on
        # under the grid. The destination goes back to the bytes it had, so the answer
        # the route gives ("nothing moved") is the truth on disk as well.
        _put_back(to_path, to_was[0])
        _put_back(to_meta_path, to_was[1])
        sync_mentions(case, to_id, to_stored)
        raise
    # Both ends restate, and the source's is the one easy to forget: a row that left
    # takes its links with it, so a sheet that kept the edge would still be listed on
    # the subject's own panel as mentioning it.
    sync_mentions(case, from_id, saved_from["meta"])
    return {
        "moved": len(landed),
        "landed": landed,
        "dropped": dropped,
        "to": {"id": to_id, "title": target.get("label") or "Sheet", "rows": len(to_rows)},
        **saved_from,
    }


def undo_move(
    case: "Case",
    from_id: str,
    to_id: str,
    keys: list[str],
    columns: list[Any],
    rows: list[Any],
    meta: Any,
    expected: str | None = None,
) -> dict[str, Any]:
    """Put a move back: the source as it was, and the rows it sent taken out again.

    A move writes two files and there is nothing in the grid's own undo stack that can
    reach either, which is what made a mis-aimed one final. It is not replayed backwards
    — a move drops the columns the destination does not have, so a reverse move would
    hand back rows with holes in them. The **table as it stood before** is what is
    restored, which is the copy the grid still has on screen, and it carries the colours,
    the links and the promotion records the rows left with.

    *keys* are the keys the rows landed under over there, from the move's own answer.
    Only those are taken out, so a row somebody added to the destination in between
    stays. The source's stamp is presented as usual: if the analyst has typed into it
    since, the undo is refused rather than overwriting what they typed.
    """
    if from_id == to_id:
        raise SheetError("a move cannot be undone into the sheet it came from")
    _sheet_entity(case, from_id)
    target = _sheet_entity(case, to_id)
    ensure_current(case, from_id, expected)

    to_path, to_meta_path = _paths(case, target)
    try:
        raw = to_path.read_text(encoding="utf-8-sig")
    except OSError:
        raw = ""
    to_columns, to_rows = parse_csv(raw)
    try:
        to_stored = json.loads(to_meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        to_stored = {}
    if not isinstance(to_stored, dict):
        to_stored = {}

    taking = {key for key in keys if key}
    to_key_at = key_index(to_columns)
    kept = [row for row in to_rows if row[to_key_at] not in taking]
    # The destination first: for the moment between the two writes a row is in neither
    # sheet rather than in both, and a duplicate is the one of the two an analyst cannot
    # see. Its sidecar needs no filtering, since a save drops what its table no longer
    # holds.
    saved_to = write(case, to_id, to_columns, kept, to_stored)
    sync_mentions(case, to_id, saved_to["meta"])
    saved_from = write(case, from_id, columns, rows, meta, expected=expected)
    sync_mentions(case, from_id, saved_from["meta"])
    return {
        "undone": len(to_rows) - len(kept),
        "from": {"id": to_id, "title": target.get("label") or "Sheet", "rows": len(kept)},
        **saved_from,
    }


def export_csv(case: "Case", entity_id: str, columns: list[Any], rows: list[Any]) -> dict[str, str]:
    """The table the grid is showing, serialised for the analyst to hand over.

    The columns and rows are the caller's rather than the file's, and that is the whole
    point of the route: the case folder already holds the sheet, so a byte copy of it
    would be a button that produces a file the analyst already has. What they do not
    have is *this reading* — the twelve rows left to check, the four columns kept, in
    the order they were sorted into.

    Serialised here because there is one CSV writer in the app and it is this one. A
    second one in the browser would be a second answer to how a quoted newline is
    written, on the one artifact that has to open in any spreadsheet.
    """
    entity = _sheet_entity(case, entity_id)
    names, table = normalize(columns, rows)
    stem = layout.slugify(str(entity.get("label") or "Sheet"), "Sheet")
    return {"filename": f"{stem}.csv", "csv": to_csv(names, table)}


def summary(case: "Case", entity: dict[str, Any]) -> dict[str, Any]:
    """A row for the sheet list: what it is called and how big it is.

    Counted through the CSV reader rather than by counting lines, because a note
    column holds sentences and a quoted newline is one row, not two.
    """
    rel = (entity.get("attrs") or {}).get("path")
    rows = 0
    headings: list[str] = []
    if isinstance(rel, str) and rel:
        try:
            raw = case.resolve_inside(rel).read_text(encoding="utf-8-sig")
        except (OSError, CaseError):
            raw = ""
        if raw.strip():
            reader = csv.reader(io.StringIO(raw.lstrip("﻿")), delimiter=sniff_delimiter(raw))
            try:
                headings = [str(name) for name in next(reader, [])]
                rows = sum(1 for _ in reader)
            except csv.Error:
                headings, rows = [], 0
    return {
        "id": entity.get("id"),
        "title": entity.get("label") or "Sheet",
        "path": rel,
        "rows": rows,
        "columns": len(headings),
        # The names as well as the count, because the one screen that has to know them —
        # the move's column mapping — would otherwise read every other sheet in the case
        # whole just to learn its headings.
        "headings": headings,
        "created_at": (entity.get("prov") or {}).get("at"),
    }
