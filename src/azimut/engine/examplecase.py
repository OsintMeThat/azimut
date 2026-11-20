"""The example case: a fictional investigation anyone can open to see a report filled.

An invented island, an invented storm and invented accounts, told through real
photographs of other places and storms, every one in the public domain and credited
(`assets/example/CREDITS.md`). It holds a sheet, personal layers, proofs, a Compare
pair and four notes made from the showcase templates (`lib/notes/ready.js`): a story
for the web, a losses register with its infographic and picture wall, a claim set
against the footage, and a damage assessment.

It ships as a case bundle built by `scripts/example_case.py`, and opening it imports
that bundle as Import case does: a new ordinary case, nothing fetched, no key asked.
Pressed again while the case is there, the press opens it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..workspace import Case
from . import bundles

#: What the case is called, which says what it is in every list it shows in.
NAME = "Example case (fictional)"
#: The bundle the app ships, and the folder its pictures' credits sit in.
FOLDER = Path(__file__).resolve().parents[1] / "assets" / "example"
BUNDLE = FOLDER / "example-case.azimut.zip"


def find() -> str | None:
    """The id of the example case when the workspace holds it, else None."""
    for entry in Case.list_all():
        if entry.get("name") == NAME:
            return str(entry["id"])
    return None


def open_example() -> dict[str, Any]:
    """The example case to open: the one there, or a new one whose import is queued."""
    found = find()
    if found is not None:
        return {"case_id": found, "name": NAME, "job_id": None, "state": "ready"}
    case, job = bundles.queue_import(BUNDLE, name=NAME)
    return {"case_id": case.id, "name": NAME, "job_id": job["id"], "state": job["state"]}
