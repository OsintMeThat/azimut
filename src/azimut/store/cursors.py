"""Keyset cursors, and the orderings they resume.

Every bounded read in the store pages on a key plus a tiebreaker rather than an
offset, so a row deleted between two pages cannot make the next one skip. These
encode and parse the resume points; the queries that use them live with their
domains.
"""

from __future__ import annotations

import json
from base64 import urlsafe_b64decode, urlsafe_b64encode
from typing import Any

from ..workspace import CaseError, _parse_cursor


#: How a catalog page may be ordered, beyond the insertion order it defaults to.
#:
#: Each entry is ``(sort expression, the column its key is read from, descending)``,
#: and a leading ``-`` spells the descending reading of the same key. Insertion order
#: is deliberately absent: it is the rowid keyset the cursor has always been, and it
#: stays the default because a page that never reorders is what makes a background
#: import safe to scroll past.
#:
#: **Each ordering pages on its own key plus the rowid.** An offset would skip a row
#: whenever one was deleted between two pages, and a key on its own ties — a hundred
#: entities filed in the same second, or two people with one name — so the rowid
#: breaks it. That is what makes "newest first" an answer about the case rather than
#: about the hundred rows a table happened to have loaded.
_PAGE_ORDERS: dict[str, tuple[str, str, bool]] = {
    "label": ("label COLLATE NOCASE", "label", False),
    "-label": ("label COLLATE NOCASE", "label", True),
    "created": ("prov_at", "prov_at", False),
    "-created": ("prov_at", "prov_at", True),
}


def _page_cursor(cursor: str) -> tuple[int, str]:
    """An ordered page's cursor: the rowid it stopped on, and that row's sort key.

    Spelled ``<rowid>:<key>`` because the rowid is an integer and cannot hold the
    separator, so the key takes the whole of the rest verbatim — a label with a colon
    in it round-trips unharmed. Insertion order keeps the bare rowid it has always
    used: it needs no second key, and every client that already round-trips one of
    those is unaffected.
    """
    seat, separator, key = cursor.partition(":")
    if not separator:
        raise CaseError(f"invalid cursor '{cursor}'")
    return _parse_cursor(seat), key

def _timeline_cursor(group: int, stamp: str, item_id: str) -> str:
    body = json.dumps([group, stamp, item_id], separators=(",", ":")).encode()
    return urlsafe_b64encode(body).decode().rstrip("=")


def _timeline_phase_cursor(stride: int, phase: int) -> str:
    body = json.dumps(["phase", stride, phase], separators=(",", ":")).encode()
    return urlsafe_b64encode(body).decode().rstrip("=")


def _decode_cursor(cursor: str) -> Any:
    padded = cursor + "=" * (-len(cursor) % 4)
    return json.loads(urlsafe_b64decode(padded.encode()).decode())


def _parse_timeline_cursor(cursor: str | None) -> tuple[int, str, str] | None:
    if cursor is None:
        return None
    try:
        value = _decode_cursor(cursor)
        if (
            not isinstance(value, list)
            or len(value) != 3
            or value[0] not in (0, 1)
            or not isinstance(value[1], str)
            or not isinstance(value[2], str)
        ):
            raise ValueError
        return int(value[0]), value[1], value[2]
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        raise CaseError(f"invalid timeline cursor '{cursor}'") from None


def _parse_timeline_phase(cursor: str | None) -> tuple[int, int] | None:
    """Where a spread read resumes: which of ``stride`` interleaved slices is next."""
    if cursor is None:
        return None
    try:
        value = _decode_cursor(cursor)
        if (
            not isinstance(value, list)
            or len(value) != 3
            or value[0] != "phase"
            or any(not isinstance(part, int) or isinstance(part, bool) for part in value[1:])
            or not 1 <= value[1] <= 100_000
            or not 0 <= value[2] < value[1]
        ):
            raise ValueError
        return int(value[1]), int(value[2])
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        raise CaseError(f"invalid timeline cursor '{cursor}'") from None
