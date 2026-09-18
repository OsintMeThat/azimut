"""REST API for the layers an analyst adds to a case's map.

Two ways in — a file opened from the computer, and a URL subscribed to — and one
kind of thing out. Everything a layer is parsed from is read in Python
(`engine/maplayers.py`): the browser gets JSON, never XML, never a zip, and never
the remote host's address.

**The network boundary is the part to keep honest.** Nothing here polls. A fetch
happens when a subscription is created, when Refresh is pressed, and when a case
is opened holding an enabled layer that asked to refresh on open — and that last
one is a route the frontend calls deliberately, not something a mount does.
Listing layers, drawing them and toggling a category all read the snapshot
already on disk, offline included.

The source's own icons ride on those same three acts and nowhere else. They are
composed once, at the moment the analyst ticks the box, and served from the case
folder from then on: the browser asks localhost for a PNG this app made, never
Google for the one it pointed at.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .. import layout
from ..engine import artifacts as artifact_engine
from ..engine import maplayers as layer_engine
from ..engine import reveal as reveal_engine
from ..workspace import CaseError
from .cases import delete_by_path, get_case

router = APIRouter(prefix="/api/cases", tags=["map-layers"])

#: A source file is read into memory to be parsed, so the upload is bounded by
#: the same number the parser refuses at. One more than the limit is enough to
#: know the limit was passed.
MAX_UPLOAD = layer_engine.MAX_SOURCE_BYTES


class SubscribeIn(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    title: str | None = Field(default=None, max_length=200)
    #: Whether opening the case re-reads the feed. Off leaves a layer that only
    #: moves when Refresh is pressed.
    on_open: bool = True
    #: Whether to compose the map's own pictograms. On by default here and off on
    #: the upload: following a pasted address already reaches the network, and
    #: opening a file off this machine does not.
    icons: bool = True


class UpdateIn(BaseModel):
    enabled: bool | None = None
    #: Category names the legend has switched off, which is the whole of the
    #: filter: a hidden category is not drawn and not counted as visible.
    hidden: list[str] | None = Field(default=None, max_length=2000)
    on_open: bool | None = None
    title: str | None = Field(default=None, max_length=200)


def _refused(exc: layer_engine.LayerError) -> HTTPException:
    """A source that will not draw, said in one sentence the panel can show."""
    status = 502 if isinstance(exc, layer_engine.LayerFetchError) else 422
    return HTTPException(status_code=status, detail=str(exc))


@router.get("/{case_id}/map-layers")
def list_layers(case_id: str) -> list[dict[str, Any]]:
    """Every layer this case holds. Reads disk only — never the network."""
    return layer_engine.listing(get_case(case_id))


@router.post("/{case_id}/map-layers/upload")
async def upload_layer(
    case_id: str,
    file: UploadFile,
    title: str = Form(default="", max_length=200),
    icons: bool = Form(default=False),
) -> dict[str, Any]:
    """A GeoJSON, KML, KMZ or GPX file opened as a layer of this case.

    `icons` is the only thing on this route that can reach out, and only for a
    file whose pictograms live at web addresses rather than inside it. Off unless
    the analyst ticked it.
    """
    case = get_case(case_id)
    data = await file.read(MAX_UPLOAD + 1)
    try:
        return layer_engine.add_file(
            case,
            data,
            filename=file.filename or "layer",
            title=title or None,
            icons=icons,
        )
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{case_id}/map-layers")
def subscribe_layer(case_id: str, body: SubscribeIn) -> dict[str, Any]:
    """Follow a public map: a My Maps share link, or any KML/GeoJSON URL.

    The first of this feature's three network calls, and the one the analyst
    started by pasting an address.
    """
    case = get_case(case_id)
    try:
        return layer_engine.subscribe(
            case, body.url, title=body.title, on_open=body.on_open, icons=body.icons
        )
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{case_id}/map-layers/{name}/refresh")
def refresh_layer(case_id: str, name: str) -> dict[str, Any]:
    """Read the feed again. The snapshot is replaced only if the bytes moved."""
    case = get_case(case_id)
    try:
        return layer_engine.refresh(case, _stem(name))
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.get("/{case_id}/map-layers/{name}")
def read_layer(case_id: str, name: str) -> dict[str, Any]:
    try:
        return layer_engine.read(get_case(case_id), _stem(name))
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{case_id}/map-layers/{name}/data")
def layer_data(case_id: str, name: str) -> FileResponse:
    """The parsed GeoJSON the map draws, rebuilt from the snapshot if need be."""
    case = get_case(case_id)
    try:
        path = layer_engine.drawing(case, _stem(name))
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, media_type="application/geo+json")


@router.get("/{case_id}/map-layers/{name}/icons/{key}")
def layer_icon(case_id: str, name: str, key: str) -> Response:
    """One of the source's own pictograms, as the PNG this app composed for it.

    Reads a zip in the case folder and nothing else — the address the source gave
    was followed once, when the layer was added, and never from here. Cached hard
    because the key is a content hash: a different icon is a different URL.
    """
    case = get_case(case_id)
    try:
        png = layer_engine.icon(case, _stem(name), key)
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.patch("/{case_id}/map-layers/{name}")
def update_layer(case_id: str, name: str, body: UpdateIn) -> dict[str, Any]:
    """The switch, the legend and the refresh policy. Touches no network."""
    case = get_case(case_id)
    try:
        return layer_engine.update(
            case,
            _stem(name),
            enabled=body.enabled,
            hidden=body.hidden,
            on_open=body.on_open,
            title=body.title,
        )
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{case_id}/map-layers/{name}/reveal")
def reveal_layer(case_id: str, name: str) -> dict[str, str]:
    """Show the saved copy in the file manager.

    What a hidden folder owes the analyst: the bytes are theirs, and the row is
    the only place that says where they are.
    """
    case = get_case(case_id)
    stem = _stem(name)
    try:
        layer_engine.read(case, stem)
        target = case.resolve_inside(layout.layer_snapshot_rel(stem))
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    try:
        reveal_engine.reveal(target)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"path": str(target)}


@router.delete("/{case_id}/map-layers/{name}")
def delete_layer(case_id: str, name: str) -> dict[str, Any]:
    """Through the chokepoint, so the layer goes to the Trash like everything else."""
    case = get_case(case_id)
    rel = layout.layer_spec_rel(_stem(name))
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:  # never filed as an entity: drop the files anyway
        artifact_engine.delete(case, {"type": layer_engine.ENTITY_TYPE, "attrs": {"spec": rel}})
    return result


def _stem(name: str) -> str:
    """The name a save made, asked for the way the save named it.

    Mirrors `api/inspect.delete_session`: the client sends the visible name and
    the file is found by running it through the same rule that wrote it, rather
    than by trusting the string as a path.
    """
    return layout.slugify(name, "Layer")
