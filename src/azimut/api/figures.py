"""REST API for figures: the same ground on one day, through several layers.

The figure an analyst publishes is rarely one picture — it is true colour for
what a reader recognises, a short-wave composite for the heat, a single band,
an index — each captioned, with one line underneath saying where and when.
Built by hand that is four captures, four files, four drags onto a canvas and a
footer typed from memory.

Here it is one press, and nothing new underneath: each panel goes through the
ordinary provider variant (so a layer written in Azimut resolves and caches
exactly as it does on the map) and is filed as a real capture with its own
provenance, and the layout is a Geo Proof. The composer lays panels out,
captions them, draws the footer and takes annotations, so the figure opens as a
composition the analyst can put arrows on rather than a picture they can only
accept or redo.

Its own module because it is the one route that writes captures *and* a proof:
``api/proofs`` reads from ``api/satellite``, so the dependency only goes one way.
``engine/figures.py`` holds the layout and the wording.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .. import config
from ..engine import figures, geo
from ..engine import media as media_engine
from ..engine import satellite as satellite_engine
from ..engine import sentinel, tiles
from . import proofs
from .cases import get_case
from .satellite import locate_on_save, saved_changed, units_preference

router = APIRouter(prefix="/api", tags=["figures"])


class FigurePanel(BaseModel):
    """One rendering of the figure's ground: a Copernicus layer and its caption."""

    model_config = ConfigDict(extra="forbid")

    #: A layer the configuration serves, or one written here.
    layer: str = Field(pattern=r"^[A-Z0-9_]{1,40}$")
    #: What the panel is called in the figure — the analyst's words, not the
    #: layer id: "SWIR hotspot (B12-B11-B04)" is the caption, SWIR is the layer.
    caption: str = Field(default="", max_length=120)


class FigureIn(BaseModel):
    """One place, one day, several renderings."""

    title: str = Field(min_length=1, max_length=200)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    zoom: int = Field(ge=1, le=22)
    width: int = Field(default=900, ge=256, le=tiles.SIZE_MAX)
    height: int = Field(default=700, ge=256, le=tiles.SIZE_MAX)
    bearing: float = Field(default=0.0, ge=0, le=360)
    #: The acquisition every panel is rendered from. One day, because a figure
    #: whose panels are different dates compares two things at once.
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    maxcc: int = Field(default=sentinel.DEFAULT_MAXCC, ge=0, le=100)
    panels: list[FigurePanel] = Field(min_length=1, max_length=figures.MAX_PANELS)
    #: Panels per row. Not `columns`: that name means a table the browser
    #: assembled, which the hardening gate holds to a body limit.
    per_row: int = Field(default=figures.DEFAULT_PER_ROW, ge=1, le=figures.MAX_PER_ROW)
    #: Burn a scale bar and a north arrow into each panel, as a capture can.
    scale_north: bool = False


@router.post("/cases/{case_id}/satellite/figure")
def build_figure(case_id: str, body: FigureIn) -> dict[str, Any]:
    """Build a figure, and return the proof it opens as.

    One day for every panel, by design: a figure is about *one* acquisition seen
    several ways. Panels of different dates would compare two things at once,
    which is what Compare is for.
    """
    case = get_case(case_id)
    if config.usage_blocked("sentinelhub"):
        raise HTTPException(
            status_code=429,
            detail=f"Sentinel Hub is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used; enable the override in Settings to keep going",
        )
    # One name means one panel: the same layer twice is the same picture twice.
    if len({panel.layer for panel in body.panels}) != len(body.panels):
        raise HTTPException(status_code=422, detail="a figure holds each layer once")

    coords_dd = satellite_engine.coords_label(body.lat, body.lon, "dd")
    rendered: list[dict[str, Any]] = []
    for at, panel in enumerate(body.panels):
        variant = sentinel.variant_id("sentinel2", panel.layer, body.day, body.day, body.maxcc)
        try:
            provider = tiles.get_provider(variant)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        try:
            image, provenance = tiles.fetch_crop(
                body.lat, body.lon, body.zoom, body.width, body.height,
                provider, bearing=body.bearing, marker_style="none",
                scale_north=body.scale_north, units=units_preference(),
            )
        except tiles.TileFetchError as exc:
            raise HTTPException(status_code=422, detail=f"{panel.layer}: {exc}") from exc
        except Exception as exc:  # network / provider failure
            raise HTTPException(
                status_code=502, detail=f"{panel.layer}: {tiles.upstream_failure(exc)}"
            ) from exc

        provenance["plus_code"] = geo.plus_code(body.lat, body.lon)
        provenance["dms"] = geo.to_dms(body.lat, body.lon)
        # The pass the window named, which is this panel's own acquisition.
        provenance["imagery_date"] = body.day
        provenance["figure"] = body.title
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        filed = media_engine.import_image(
            case,
            image,
            f"figure_{stamp}_{at + 1}_{panel.layer}.png",
            {"type": "satellite", **provenance},
            by="satellite",
            entity_type="capture",
            extra_attrs={
                "coords": coords_dd, "lat": body.lat, "lon": body.lon,
                "plus_code": provenance["plus_code"], "zoom": provenance["zoom"],
                "bearing": body.bearing, "provider": provenance["provider"],
            },
            title=f"{body.title} · {panel.caption or panel.layer}",
            dedupe=False,  # a capture is 1:1 with its entity — never collapsed
        )
        locate_on_save(case, filed["entity"]["id"], body.lat, body.lon)
        rendered.append(
            {
                "src": filed["entity"]["attrs"]["path"],
                "label": panel.caption or panel.layer,
                "natural": (image.width, image.height),
                "lat": body.lat,
                "lon": body.lon,
            }
        )

    spec = figures.spec(
        rendered,
        per_row=body.per_row,
        footer=figures.footer_line(body.day, coords_dd),
    )
    # No export: the layout is the composer's canvas, and a second renderer here
    # would drift from it at the first change. The first save there writes one.
    saved = proofs.save_proof(case_id, proofs.ProofIn(title=body.title, spec=spec))
    saved_changed(case)
    return {
        "proof": {"name": saved["name"]},
        "panels": [{"src": entry["src"], "caption": entry["label"]} for entry in rendered],
    }
