"""The note editor's table reading is held to the renderers'.

`frontend/src/lib/notes/editor/tableText.js` reads a note's tables for the grid
editor and the charts. It must find the cells the PDF, the HTML report and
WordPress find, so the engine's reading of two corpora (edge cases, and every
table of two real notes, anonymised) is pinned in `tables.engine.json`, which
`tableText.engine.test.js` compares the module to, a table's settings line
(`engine/notes_tables.py`) with it. This test keeps that file true
to the engine: after a deliberate change, write it again with
`python tests/test_notes_table_text.py`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from azimut.engine import notes_markdown as md
from azimut.engine import notes_tables

FIXTURES = Path(__file__).resolve().parents[1] / "frontend/src/lib/notes/editor/fixtures"
CORPORA = ("edge-tables", "real-tables")
PINNED = FIXTURES / "tables.engine.json"


def engine_tables(text: str) -> list[dict[str, Any]]:
    """Each table as the renderers read it: its lines, header, sides and cells."""
    found: list[dict[str, Any]] = []
    for block in md.alignment_blocks(text):
        tokens = block.tokens
        for index, token in enumerate(tokens):
            if token.type != "table_open" or not token.map:
                continue
            start, end = token.map
            table: dict[str, Any] = {"line": block.line + start, "end": block.line + end}
            table.update(header=[], align=[], rows=[])
            look = notes_tables.look_of(token)
            if look is not notes_tables.DEFAULT:
                table["look"] = notes_tables.write_line(look)
            section = ""
            row: list[str] = []
            for inner in tokens[index + 1 :]:
                if inner.type == "table_close":
                    break
                if inner.type in ("thead_open", "tbody_open"):
                    section = inner.type
                elif inner.type == "tr_open":
                    row = []
                elif inner.type == "th_open":
                    style = str((inner.attrs or {}).get("style", ""))
                    table["align"].append(style.removeprefix("text-align:") or None)
                elif inner.type == "inline":
                    row.append(inner.content)
                elif inner.type == "tr_close":
                    if section == "thead_open":
                        table["header"] = row
                    else:
                        table["rows"].append(row)
            found.append(table)
    return found


def reading() -> dict[str, list[dict[str, Any]]]:
    return {name: engine_tables((FIXTURES / f"{name}.md").read_text("utf-8")) for name in CORPORA}


def test_the_pinned_reading_is_the_engines() -> None:
    assert json.loads(PINNED.read_text(encoding="utf-8")) == reading()


def test_the_corpora_hold_what_they_are_for() -> None:
    read = reading()
    edge = read["edge-tables"]
    # a chip's pipe is no cell break, an escaped one neither, a code span's is
    chips = edge[0]
    assert len(chips["header"]) == 3 and all(len(row) == 3 for row in chips["rows"])
    assert chips["rows"][0][0] == "[YEMEN Proof 50](azimut://entity/e_a1)"
    escaped = edge[1]
    assert escaped["align"] == ["left", "center", "right"]
    assert escaped["rows"][0][1] == "a | b"
    assert escaped["rows"][1] == ["code splits", "`a", "b`"]
    # a row short of cells is padded, one with too many is cut, prose under it is a row
    ragged = edge[2]
    assert ragged["rows"][0] == ["a", "", ""]
    assert ragged["rows"][2] == ["a", "b", "c"]
    assert ragged["rows"][-1] == ["A line of prose written right under the table.", "", ""]
    assert len(read["real-tables"]) == 10
    # a settings line under the last row is the table's settings, never a row; braces are a row otherwise
    settings, braces, between = edge[-3:]
    assert settings["rows"] == [["Cougar", "confirmed"]] and settings["look"] == '{stripes colour="Grade" caption="Losses"}'
    assert braces["rows"][-1] == ["{x}"] and "look" not in braces
    assert between["rows"][1] == ["{stripes}", ""] and "look" not in between


if __name__ == "__main__":
    PINNED.write_text(json.dumps(reading(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    sys.stdout.write(f"wrote {PINNED}\n")
