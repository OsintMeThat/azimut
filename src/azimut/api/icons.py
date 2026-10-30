"""REST API for the analyst's icon library (Settings → Icons).

App-wide, like templates and the signature: the library spans every case. A
layer keeps its own copy of each icon its markers wear, through the layer
routes (`layerediting.adopt_icon`), so nothing here is ever read by a case.
Touches no network.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..engine import iconlibrary

router = APIRouter(prefix="/api", tags=["icons"])

#: How many files one import request carries. The browser sends a large pack in
#: several requests, so one never holds more than this many files in memory.
MAX_FILES_PER_REQUEST = 50


@router.get("/icons")
def list_icons() -> dict[str, Any]:
    return iconlibrary.listing()


@router.get("/icons/{key}.png")
def icon_png(key: str) -> Response:
    """One icon's picture. Cached hard: the key is the picture's own hash."""
    try:
        data = iconlibrary.png(key)
    except iconlibrary.IconError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=data, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.post("/icons")
async def import_icons(
    files: list[UploadFile],
    groups: list[str] = Form(default=[]),
) -> dict[str, Any]:
    """Image files filed in the library, each in the group at its place in `groups`.

    SVG files arrive already drawn as PNGs: the browser renders them, and this
    route refuses anything Pillow cannot decode as a picture.
    """
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(status_code=413, detail=f"send at most {MAX_FILES_PER_REQUEST} icons at once")
    read: list[tuple[str, bytes, str]] = []
    for index, upload in enumerate(files):
        data = await upload.read(iconlibrary.MAX_FILE_BYTES + 1)
        group = groups[index][: iconlibrary.MAX_GROUP * 4] if index < len(groups) else ""
        read.append(((upload.filename or "icon")[:300], data, group))
    return iconlibrary.add_files(read)


class IconUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=iconlibrary.MAX_NAME * 2)
    group: str | None = Field(default=None, max_length=iconlibrary.MAX_GROUP * 2)
    mode: Literal["disc", "image"] | None = None


@router.patch("/icons/{key}")
def update_icon(key: str, body: IconUpdateIn) -> dict[str, Any]:
    try:
        return iconlibrary.update(key, body.model_dump(exclude_none=True))
    except iconlibrary.IconError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class IconRemoveIn(BaseModel):
    keys: list[Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]] = Field(min_length=1, max_length=iconlibrary.MAX_ICONS)


@router.post("/icons/remove")
def remove_icons(body: IconRemoveIn) -> dict[str, Any]:
    """Icons out of the library. Maps that wear them keep their own copies."""
    return iconlibrary.remove(body.keys)
