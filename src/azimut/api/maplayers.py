"""REST API for the layers an analyst adds to a case's map.

Files, followed URLs, GeoConfirmed queries and personal working copies share
one layer lifecycle. Everything a layer is parsed from is read in Python
(`engine/maplayers.py`): the browser gets JSON, never XML, never a zip, and never
the remote host's address.

**The network boundary is the part to keep honest.** Nothing here polls. A fetch
happens when a subscription is created, when Refresh is pressed, and when the
analyst switches a layer on for the first time in a session and it asked to be
re-read then — and that last one is the Refresh route, called by the frontend on
that switch, never by a mount. Listing layers, drawing them and toggling a
category all read the snapshot already on disk, offline included.

**Whether a layer is on is not stored here.** Every layer starts off when the app
or the page is opened again: one heavy enough to take the tab down would
otherwise take it down again on every reload.

The source's own icons ride on those same three acts and nowhere else. They are
composed once, at the moment the analyst ticks the box, and served from the case
folder from then on: the browser asks localhost for a PNG this app made, never
Google for the one it pointed at.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, field_validator

from .. import layout
from ..engine import artifacts as artifact_engine
from ..engine import geoconfirmed
from ..engine import layerediting
from ..engine import layerexports
from ..engine import mapviews
from ..engine import maplayers as layer_engine
from ..workspace import CaseError
from .cases import delete_by_path, get_case
from . import events

router = APIRouter(prefix="/api/cases", tags=["map-layers"])
#: What GeoConfirmed offers, which belongs to no case.
geoconfirmed_router = APIRouter(prefix="/api/geoconfirmed", tags=["map-layers"])

#: A source file is read into memory to be parsed, so the upload is bounded by
#: the same number the parser refuses at. One more than the limit is enough to
#: know the limit was passed.
MAX_UPLOAD = layer_engine.MAX_SOURCE_BYTES


class SubscribeIn(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    title: str | None = Field(default=None, max_length=200)
    #: Whether the first switch-on of a session re-reads the feed. Off leaves a
    #: layer that only moves when Refresh is pressed.
    on_open: bool = True
    #: Whether to compose the map's own pictograms. On by default here and off on
    #: the upload: following a pasted address already reaches the network, and
    #: opening a file off this machine does not.
    icons: bool = True


class GeoConfirmedIn(BaseModel):
    #: The conflict's short name, as the conflict list gives it.
    conflict: str = Field(min_length=1, max_length=64)
    #: The last this many days, counted from each read…
    days: int | None = Field(default=None, ge=1, le=geoconfirmed.MAX_DAYS)
    #: …or a first day and an optional last one, `YYYY-MM-DD`…
    start: str | None = Field(default=None, max_length=10)
    end: str | None = Field(default=None, max_length=10)
    #: …or the conflict's whole history.
    everything: bool = False
    #: `[west, south, east, north]`, or nothing for the whole conflict.
    area: list[float] | None = Field(default=None, min_length=4, max_length=4)
    #: Unset re-reads a window on its first switch-on of a session and the whole
    #: history only on Refresh (`engine/geoconfirmed.subscribe`).
    on_open: bool | None = None


class PeriodIn(BaseModel):
    """The row's time filter: a first and a last day, either "" for no bound."""

    start: str = Field(default="", max_length=10)
    end: str = Field(default="", max_length=10)

    @field_validator("start", "end")
    @classmethod
    def _a_day(cls, value: str) -> str:
        if value and not layer_engine.iso_day(value):
            raise ValueError("a day is YYYY-MM-DD")
        return value


class UpdateIn(BaseModel):
    #: Category names the legend has switched off, which is the whole of the
    #: filter: a hidden category is not drawn and not counted as visible.
    hidden: list[str] | None = Field(default=None, max_length=2000)
    #: The time filter; both days "" clears it.
    period: PeriodIn | None = None
    on_open: bool | None = None
    title: str | None = Field(default=None, max_length=200)


class EditableIn(BaseModel):
    title: str = Field(default="My layer", min_length=1, max_length=200)
    description: str = Field(default="", max_length=layer_engine.MAX_DESCRIPTION)


class LayerDetailsIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=layer_engine.MAX_DESCRIPTION)


class FeatureOrderIn(BaseModel):
    keys: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(min_length=1, max_length=100000)
    group: str = Field(min_length=1, max_length=64)
    before: str | None = Field(default=None, min_length=1, max_length=64)


class MarkerIn(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
    name: str = Field(default="", max_length=layer_engine.MAX_NAME)
    colour: str = Field(default="#0072b2", pattern=r"^#[0-9a-fA-F]{6}$")
    symbol: str = "pin"
    description: str = Field(default="", max_length=layer_engine.MAX_DESCRIPTION)
    group: str | None = Field(default=None, max_length=64)

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, value: str) -> str:
        if value not in layerediting.SYMBOLS:
            raise ValueError("choose an icon from the layer palette")
        return value


class MarkerUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=layer_engine.MAX_NAME)
    colour: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    symbol: str | None = None
    description: str | None = Field(default=None, max_length=layer_engine.MAX_DESCRIPTION)
    group: str | None = Field(default=None, max_length=64)
    geometry: dict[str, Any] | None = None

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, value: str | None) -> str | None:
        return MarkerIn._symbol(value) if value is not None else None


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class GroupUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    mode: Literal["uniform", "individual"] | None = None
    colour: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    symbol: str | None = None
    size: float | None = Field(default=None, ge=0.5, le=3, allow_inf_nan=False)
    stroke: float | None = Field(default=None, ge=0.5, le=12, allow_inf_nan=False)

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, value: str | None) -> str | None:
        return MarkerUpdateIn._symbol(value)


class PlacesIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=2000)
    group: str | None = Field(default=None, max_length=64)


class SelectionIn(BaseModel):
    keys: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(min_length=1, max_length=100000)
    changes: MarkerUpdateIn | None = None
    offset: list[Annotated[float, Field(ge=-360, le=360, allow_inf_nan=False)]] | None = Field(default=None, min_length=2, max_length=2)
    remove: bool = False


class GroupOrderIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=2000)


class EditEndIn(BaseModel):
    token: str = Field(min_length=32, max_length=32)
    revision: str = Field(min_length=64, max_length=64)
    discard: bool = False


class ShapeIn(BaseModel):
    geometry: dict[str, Any]
    name: str = Field(default="", max_length=layer_engine.MAX_NAME)
    colour: str = Field(default="#0072b2", pattern=r"^#[0-9a-fA-F]{6}$")
    description: str = Field(default="", max_length=layer_engine.MAX_DESCRIPTION)
    group: str | None = Field(default=None, max_length=64)


def _refused(exc: layer_engine.LayerError) -> HTTPException:
    """A source that will not draw, said in one sentence the panel can show."""
    status = 502 if isinstance(exc, layer_engine.LayerFetchError) else 422
    return HTTPException(status_code=status, detail=str(exc))


class MapCameraIn(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
    zoom: float = Field(ge=0, le=26, allow_inf_nan=False)
    bearing: float = Field(default=0, ge=0, le=360, allow_inf_nan=False)
    pitch: float = Field(default=0, ge=0, le=85, allow_inf_nan=False)


class ViewLayerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200, pattern=r"^[^/\\\\]+$")
    hidden: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=2000)


class LegendEntryIn(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    colour: str = Field(default="#0072b2", pattern=r"^#[0-9a-fA-F]{6}$")


class MapViewIn(BaseModel):
    id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    title: str = Field(min_length=1, max_length=200)
    provider: str = Field(min_length=1, max_length=100)
    camera: MapCameraIn
    overlays: list[Annotated[str, Field(max_length=100)]] = Field(default_factory=list, max_length=100)
    layers: list[ViewLayerIn] = Field(default_factory=list, max_length=2000)
    legend: list[LegendEntryIn] = Field(default_factory=list, max_length=2000)
    note: str = Field(default="", max_length=2000)
    show_legend: bool = True


class LayerExportIn(BaseModel):
    icons: dict[Annotated[str, Field(max_length=100, pattern=r"^[a-z0-9-]+$")], Annotated[str, Field(max_length=200000)]] = Field(default_factory=dict, max_length=1000)

    @field_validator("icons")
    @classmethod
    def _size(cls, value: dict[str, str]) -> dict[str, str]:
        if sum(map(len, value.values())) > 16 * 1024 * 1024:
            raise ValueError("export icons exceed 16 MB")
        return value


@router.post("/{case_id}/map-layers/{name}/export/{fmt}")
def download_layer(case_id: str, name: str, fmt: Literal["geojson", "kml", "kmz"], body: LayerExportIn) -> Response:
    try:
        content, mime, title = layerexports.export(get_case(case_id), _stem(name), fmt, body.icons)
        return Response(content=content, media_type=mime,
                        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(title + '.' + fmt, safe='')}",
                                 "Cache-Control": "no-store"})
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.get("/{case_id}/map-views")
def list_map_views(case_id: str) -> list[dict[str, Any]]:
    return mapviews.listing(get_case(case_id))


@router.post("/{case_id}/map-views")
def save_map_view(case_id: str, body: MapViewIn) -> dict[str, Any]:
    try:
        case = get_case(case_id)
        saved = mapviews.save(case, body.model_dump())
        events.publish({"type": "saved", "case_id": case.id})
        return saved
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.get("/{case_id}/map-views/{name}")
def get_map_view(case_id: str, name: str) -> dict[str, Any]:
    try:
        return mapviews.read(get_case(case_id), name)
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{case_id}/map-views/{name}")
def remove_map_view(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        mapviews.read(case, name)
        return delete_by_path(case, layout.map_view_rel(name))
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{case_id}/map-layers")
def list_layers(case_id: str) -> list[dict[str, Any]]:
    """Every layer this case holds. Reads disk only — never the network."""
    return layer_engine.listing(get_case(case_id))


@router.post("/{case_id}/map-layers/editable")
def create_editable_layer(case_id: str, body: EditableIn) -> dict[str, Any]:
    return layerediting.create(get_case(case_id), body.title, body.description)


@router.post("/{case_id}/map-layers/editable/upload")
async def import_editable_layer(
    case_id: str, file: UploadFile, title: str = Form(default="", max_length=200),
    description: str = Form(default="", max_length=layer_engine.MAX_DESCRIPTION),
) -> dict[str, Any]:
    data = await file.read(MAX_UPLOAD + 1)
    try:
        return layerediting.from_file(get_case(case_id), data, file.filename or "layer", title, description)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/editable-copy")
def copy_editable_layer(case_id: str, name: str, body: EditableIn) -> dict[str, Any]:
    try:
        return layerediting.copy_layer(get_case(case_id), _stem(name), body.title, body.description)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.get("/{case_id}/map-layers/{name}/edit")
def editable_layer(case_id: str, name: str) -> dict[str, Any]:
    try:
        return layerediting.read(get_case(case_id), _stem(name))
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/edit")
def begin_layer_edit(case_id: str, name: str) -> dict[str, Any]:
    try:
        return layerediting.begin_edit(get_case(case_id), _stem(name))
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/edit/finish")
def finish_layer_edit(case_id: str, name: str, body: EditEndIn) -> dict[str, Any]:
    try:
        return layerediting.end_edit(get_case(case_id), _stem(name), body.token,
                                     body.revision, discard=body.discard)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/groups/order")
def reorder_layer_groups(case_id: str, name: str, body: GroupOrderIn) -> dict[str, Any]:
    try:
        return layerediting.reorder_groups(get_case(case_id), _stem(name), body.ids)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.patch("/{case_id}/map-layers/{name}/edit")
def edit_layer_details(case_id: str, name: str, body: LayerDetailsIn) -> dict[str, Any]:
    try:
        return layerediting.update_details(get_case(case_id), _stem(name), body.model_dump(exclude_none=True))
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/features/order")
def reorder_layer_features(case_id: str, name: str, body: FeatureOrderIn) -> dict[str, Any]:
    try:
        return layerediting.reorder_features(get_case(case_id), _stem(name), body.keys, body.group, body.before)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/selection")
def edit_layer_selection(case_id: str, name: str, body: SelectionIn) -> dict[str, Any]:
    try:
        changes = body.changes.model_dump(exclude_none=True) if body.changes else {}
        return layerediting.edit_selection(get_case(case_id), _stem(name), body.keys,
                                           changes=changes, offset=body.offset, remove=body.remove)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/selection/{batch}/restore")
def restore_layer_selection(case_id: str, name: str, batch: str) -> dict[str, Any]:
    try:
        return layerediting.restore_selection(get_case(case_id), _stem(name), batch)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/shapes")
def add_layer_shape(case_id: str, name: str, body: ShapeIn) -> dict[str, Any]:
    try:
        return layerediting.add_shape(get_case(case_id), _stem(name), **body.model_dump())
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.get("/{case_id}/map-layers/places/{place_id}/usage")
def layer_place_usage(case_id: str, place_id: str) -> dict[str, Any]:
    try:
        return layerediting.place_usage(get_case(case_id), place_id)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/groups")
def add_layer_group(case_id: str, name: str, body: GroupIn) -> dict[str, Any]:
    try:
        return layerediting.add_group(get_case(case_id), _stem(name), body.name)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.patch("/{case_id}/map-layers/{name}/groups/{key}")
def edit_layer_group(case_id: str, name: str, key: str, body: GroupUpdateIn) -> dict[str, Any]:
    try:
        return layerediting.update_group(get_case(case_id), _stem(name), key,
                                         body.model_dump(exclude_none=True))
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.delete("/{case_id}/map-layers/{name}/groups/{key}")
def remove_layer_group(case_id: str, name: str, key: str) -> dict[str, Any]:
    try:
        return layerediting.remove_group(get_case(case_id), _stem(name), key)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/places")
def add_layer_places(case_id: str, name: str, body: PlacesIn) -> dict[str, Any]:
    try:
        return layerediting.add_places(get_case(case_id), _stem(name), body.ids, body.group)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/markers")
def add_layer_marker(case_id: str, name: str, body: MarkerIn) -> dict[str, Any]:
    try:
        return layerediting.add_marker(get_case(case_id), _stem(name), **body.model_dump())
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.patch("/{case_id}/map-layers/{name}/markers/{key}")
def edit_layer_marker(case_id: str, name: str, key: str, body: MarkerUpdateIn) -> dict[str, Any]:
    try:
        return layerediting.update_marker(get_case(case_id), _stem(name), key,
                                          body.model_dump(exclude_none=True))
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/markers/{key}/place")
def save_marker_place(case_id: str, name: str, key: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        result = layerediting.promote(case, _stem(name), key)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc
    events.publish({"type": "saved", "case_id": case.id})
    return result


@router.delete("/{case_id}/map-layers/{name}/markers/{key}")
def remove_layer_marker(case_id: str, name: str, key: str) -> dict[str, Any]:
    try:
        return layerediting.remove_marker(get_case(case_id), _stem(name), key)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


@router.post("/{case_id}/map-layers/{name}/markers/{key}/restore")
def restore_layer_marker(case_id: str, name: str, key: str) -> dict[str, Any]:
    try:
        return layerediting.restore_marker(get_case(case_id), _stem(name), key)
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


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


@router.post("/{case_id}/map-layers/geoconfirmed")
def geoconfirmed_layer(case_id: str, body: GeoConfirmedIn) -> dict[str, Any]:
    """One GeoConfirmed conflict over a window of days and, if asked, one area.

    Two requests to GeoConfirmed, the conflict's factions and its export, and
    nothing for the icons: they arrive inside the export.
    """
    case = get_case(case_id)
    try:
        return geoconfirmed.subscribe(
            case,
            body.conflict,
            days=body.days,
            start=body.start,
            end=body.end,
            everything=body.everything,
            box=body.area,
            on_open=body.on_open,
        )
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@geoconfirmed_router.get("/conflicts")
def geoconfirmed_conflicts() -> list[dict[str, Any]]:
    """The conflicts GeoConfirmed maps, read when its dialog opens and not before."""
    try:
        return geoconfirmed.conflicts()
    except layer_engine.LayerError as exc:
        raise _refused(exc) from exc


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
    """The parsed drawing, rebuilt from the source snapshot or working spec.

    Never reused unasked: a refresh changes what this one address holds, and a
    browser left to guess a lifetime from Last-Modified goes on drawing the
    features it read before.
    """
    case = get_case(case_id)
    try:
        path = layer_engine.drawing(case, _stem(name))
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path, media_type="application/geo+json", headers={"Cache-Control": "no-cache"}
    )


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


class OrderIn(BaseModel):
    #: Every layer's name, top of the map first.
    names: list[Annotated[str, Field(max_length=200)]] = Field(max_length=2000)


@router.put("/{case_id}/map-layers/order")
def order_layers(case_id: str, body: OrderIn) -> list[dict[str, Any]]:
    """The rows as they were dragged, which is also how the map stacks them.
    Answers with the whole list in its new order. Touches no network."""
    return layer_engine.reorder(get_case(case_id), [_stem(name) for name in body.names])


@router.patch("/{case_id}/map-layers/{name}")
def update_layer(case_id: str, name: str, body: UpdateIn) -> dict[str, Any]:
    """The legend, the time filter, the refresh policy and the title. Touches no
    network."""
    case = get_case(case_id)
    try:
        return layer_engine.update(
            case,
            _stem(name),
            hidden=body.hidden,
            period=(body.period.start, body.period.end) if body.period else None,
            on_open=body.on_open,
            title=body.title,
        )
    except layer_engine.LayerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
