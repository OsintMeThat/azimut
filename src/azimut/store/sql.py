"""Statement-shaping helpers shared by every query in the store.

Nothing here knows what a case is: these turn a Python value into the SQL text
and bound parameters a statement needs. They live apart from the queries so a
wildcard escape or an id-set ceiling is fixed once, for every caller.
"""

from __future__ import annotations

import sqlite3
from typing import Iterator


def _like_contains(term: str) -> str:
    """Wrap a search term for a case-insensitive ``LIKE ? ESCAPE '\\'`` substring
    match, escaping the LIKE wildcards so a literal ``%`` or ``_`` matches
    itself."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _like_prefix(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%"


#: How many ids one ``IN (…)`` clause carries. SQLite's compiled variable ceiling
#: is 999 on the oldest builds still in the wild, and the widest query here binds
#: an id set twice plus its type filter, so the chunk stays well under a third of
#: it rather than assuming the modern 32 766.
_ID_CHUNK = 250


def _chunks(items: list[str]) -> Iterator[list[str]]:
    """Split an id set into runs one SQL statement can bind."""
    for start in range(0, len(items), _ID_CHUNK):
        yield items[start : start + _ID_CHUNK]


def _marks(values: list[str]) -> str:
    return ", ".join("?" * len(values))


#: The temp table an id set is asked through when ``IN (…)`` cannot hold it.
_SCOPE = "scope"


def _scope_table(conn: sqlite3.Connection, ids: list[str]) -> None:
    """Put an id set in a temp table, so a query over it binds no ids at all.

    The variable ceiling is what forces `_chunks`, and a chunk is a fine answer for a
    question each chunk can settle alone. It is the wrong answer for one that needs
    two ids at once: the closed edge set asked every pair of chunks, so a drawing of
    650 nodes cost nine statements and one of 5 000 would cost four hundred — the cost
    the node ceiling was hiding rather than removing.

    Handed to SQLite as a table instead, the same question is one statement at any
    size, and the join uses the primary key. Temp tables belong to the connection, and
    `_connect` opens a fresh one per operation, so this cannot leak into another read;
    it is still emptied on the way in, because a helper that is only correct when
    nobody calls it twice is a trap for the next caller.
    """
    conn.execute(
        f"CREATE TEMP TABLE IF NOT EXISTS {_SCOPE}(id TEXT PRIMARY KEY) WITHOUT ROWID"
    )
    conn.execute(f"DELETE FROM {_SCOPE}")
    conn.executemany(
        f"INSERT OR IGNORE INTO {_SCOPE}(id) VALUES (?)", [(one,) for one in ids]
    )
