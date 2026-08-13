"""The gallery a hand-made entity carries.

Ordered photos, at most one primary. An image is either a reference to something
already in Media or a private file uploaded here — never both, which is the check
`engine/entity_images.py` enforces and these routes surface.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ...engine import entity_images as entity_image_engine
from ...workspace import CaseError
from ..limits import MAX_IMAGE_BYTES
from .common import get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])


class EntityImagesIn(BaseModel):
    media_ids: list[str] = Field(min_length=1, max_length=100)

def _entity_image_error(exc: CaseError) -> HTTPException:
    status = 404 if "not found" in str(exc) else 400
    return HTTPException(status_code=status, detail=str(exc))

@router.get("/{case_id}/entities/{entity_id}/images")
def entity_images(case_id: str, entity_id: str) -> dict[str, Any]:
    """Presentation photos attached to one hand-made entity."""
    try:
        images = entity_image_engine.list_images(get_case(case_id), entity_id)
    except CaseError as exc:
        raise _entity_image_error(exc) from exc
    return {"images": images}

@router.post("/{case_id}/entities/{entity_id}/images")
def attach_entity_images(
    case_id: str, entity_id: str, body: EntityImagesIn
) -> dict[str, Any]:
    """Attach existing case images without creating semantic graph links."""
    try:
        return entity_image_engine.attach(get_case(case_id), entity_id, body.media_ids)
    except CaseError as exc:
        raise _entity_image_error(exc) from exc

@router.post("/{case_id}/entities/{entity_id}/images/upload")
async def upload_entity_image(
    case_id: str,
    entity_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Store one private presentation photo outside the Media Library.

    Bounded at the edge like the two other surfaces that swallow an image, and
    against the same limit: a portrait is a portrait wherever it came from. The
    pixel clamp further in answers a decompression bomb, not a file that is simply
    enormous, and refusing early is what keeps a mistaken drag from filling the
    disk with a temporary nobody asked for.
    """
    raw = await file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"photo must be under {MAX_IMAGE_BYTES // 1024 // 1024} MB",
        )
    try:
        return entity_image_engine.import_photo(
            get_case(case_id), entity_id, BytesIO(raw), file.filename
        )
    except CaseError as exc:
        raise _entity_image_error(exc) from exc

@router.put("/{case_id}/entities/{entity_id}/images/{image_id}/primary")
def set_primary_entity_image(
    case_id: str, entity_id: str, image_id: str
) -> dict[str, Any]:
    try:
        images = entity_image_engine.set_primary(get_case(case_id), entity_id, image_id)
    except CaseError as exc:
        raise _entity_image_error(exc) from exc
    return {"images": images}

@router.delete("/{case_id}/entities/{entity_id}/images/{image_id}")
def detach_entity_image(case_id: str, entity_id: str, image_id: str) -> dict[str, Any]:
    """Detach a Media reference or delete a private presentation photo."""
    try:
        images = entity_image_engine.detach(get_case(case_id), entity_id, image_id)
    except CaseError as exc:
        raise _entity_image_error(exc) from exc
    return {"images": images}
