"""What a video thread files for its posts (`engine/postclips.py`).

Cut for the post: a passage of a proof's ★ video, cut into a case file of its own. The
cut runs as a job (`jobs.start`), polled at ``GET /api/jobs/{id}`` for its percent like
Inspect's scan. A passage the case already holds a clip of answers that clip at once,
and a cut already running for it answers the same job, so a second press never makes a
second copy.

The contact sheet: the picture of a video's places the browser draws for the thread,
filed in Media.
"""

from __future__ import annotations

import threading
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import jobs
from ..engine import postclips as clip_engine
from ..engine import scenes as scene_engine
from ..workspace import CaseError
from . import events
from .cases import get_case

router = APIRouter(prefix="/api", tags=["proofs"])

#: The job cutting each passage, while it runs: (case, proof, start, end) -> job id.
_running: dict[tuple[str, str, float, float], str] = {}
_running_lock = threading.Lock()


class ClipIn(BaseModel):
    """The passage to cut, in seconds in the video. Read by `postclips.plan`, which
    refuses what is not a time rather than letting Pydantic turn ``true`` into 1."""

    start: Any
    end: Any


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, scene_engine.UnknownProof):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, clip_engine.BadClip):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/cases/{case_id}/proofs/{name}/clip")
def read_clip(case_id: str, name: str) -> dict[str, Any]:
    """The clip a proof's scene holds for its post, ``{path, start, end, size, title}``
    while its file is in the case, else null, beside the proof's ★ video."""
    case = get_case(case_id)
    try:
        return clip_engine.read(case, name)
    except (scene_engine.UnknownProof, CaseError) as exc:
        raise _refused(exc) from exc


@router.post("/cases/{case_id}/proofs/{name}/clip")
def cut_clip(case_id: str, name: str, body: ClipIn) -> dict[str, Any]:
    """Cut a passage of the proof's ★ video for its post. Answers ``{clip}`` when the
    case already holds that clip, else ``{job_id}``, whose result is ``{clip}``."""
    case = get_case(case_id)
    try:
        cut = clip_engine.plan(case, name, body.start, body.end)
        found = clip_engine.held(case, name, cut.video, cut.start, cut.end)
    except (scene_engine.UnknownProof, clip_engine.BadClip, CaseError) as exc:
        raise _refused(exc) from exc
    if found:
        return {"clip": found}
    key = (case.id, name, round(cut.start, 3), round(cut.end, 3))

    def work(set_progress: Any) -> dict[str, Any]:
        try:
            answer = clip_engine.run(case, cut, set_progress)
        finally:
            with _running_lock:
                _running.pop(key, None)
        events.publish({"type": "scenes", "case_id": case.id, "video": cut.video})
        return answer

    with _running_lock:
        running = _running.get(key)
        if running and (jobs.get(running) or {}).get("status") == "running":
            return {"job_id": running}
        job_id = jobs.start("post-clip", work)
        _running[key] = job_id
    return {"job_id": job_id}


@router.post("/cases/{case_id}/scenes/sheet")
async def file_sheet(
    case_id: str,
    video: str = Form(min_length=1, max_length=512),
    image: UploadFile = File(),
) -> dict[str, Any]:
    """File the contact sheet of a video's thread in Media. Answers ``{path}``."""
    case = get_case(case_id)
    data = await image.read(clip_engine.SHEET_MAX_BYTES + 1)
    if len(data) > clip_engine.SHEET_MAX_BYTES:
        raise HTTPException(status_code=413, detail="a contact sheet is under 2 MB")
    try:
        return clip_engine.file_sheet(case, video, data)
    except (clip_engine.BadClip, CaseError) as exc:
        raise _refused(exc) from exc
