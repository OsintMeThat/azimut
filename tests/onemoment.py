"""A file's scenes to prove, each holding one moment, written the way Inspect and the
server write them: the steps behind `fixtures/inspect-work-one-moment.json`.

A scene may now hold several moments (``more``). One that holds one must still be
written byte for byte as before, so every work already in a case reads and saves as it
did. The fixture was written by these steps on the code from before ``more`` existed;
`test_scene_moments.py` runs them again on today's and compares the files.
"""

from __future__ import annotations

import re
from types import ModuleType
from typing import Any

#: What Inspect sends: an instant, a passage, the whole video and a scene holding a
#: word, out of clip order, with the server's own fields a stale tab may still carry.
FIRST_SAVE: dict[str, Any] = {
    "frames": [],
    "marks": [{"id": "m1", "time": 2.5, "label": "flash"}],
    "scenes": [
        {"id": "s3", "start": 30, "end": 41.5, "label": "  Bridge  "},
        {"id": "s1", "start": 4.25, "label": "Mast?"},
        {"id": "s0", "start": None, "end": None, "label": ""},
        {"id": "s2", "start": 12, "end": None, "label": "Road bridge?", "captures": [], "abandoned": None},
    ],
}

#: Inspect saving again over what the server wrote meanwhile.
SECOND_SAVE: dict[str, Any] = {
    "frames": [],
    "marks": [{"id": "m1", "time": 2.5, "label": "flash"}],
    "scenes": [
        {"id": "s0", "start": None, "end": None, "label": "somewhere on the road"},
        {"id": "s1", "start": 4.25, "end": 6, "label": "Mast?"},
        {"id": "s2", "start": 12, "end": None, "label": "Road bridge?"},
        {"id": "s3", "start": 31, "end": 40, "label": "Bridge"},
    ],
}


def write(engine: ModuleType, case: Any, subject: str) -> str:
    """Run the steps with ``engine`` (an `inspectwork` module) and answer where the work is."""
    engine.save_work(case, subject, FIRST_SAVE)
    engine.update_scene(case, subject, "s1", lambda scene: scene.update(captures=["Captures/a.png"]))
    engine.update_scene(
        case, subject, "s2", lambda scene: scene.update(abandoned={"reason": "no landmark", "at": "2026-11-08T09:00:00+00:00"}),
    )
    engine.retime_scene(case, subject, "s3", 31, 40)
    engine.save_work(case, subject, SECOND_SAVE)
    return engine.work_rel(case, subject)


def scrub(text: str) -> str:
    """The file with the moment it was written at taken out."""
    return re.sub(r'"(created_at|updated_at)": "[^"]*"', r'"\1": "…"', text)
