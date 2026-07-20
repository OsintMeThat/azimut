"""REST API for reusable presets: proof house styles and post-thread skeletons.

Templates are app-wide (workspace-level), like the signature and API keys — a
house style spans every case, so it never lives inside a case folder. Two
families, keyed by ``kind``: "proof" (a proof's layout/colors/signature)
and "post" (a thread skeleton: which lines, mention, media, extra tweets). The
``data`` is validated here and again in the composers so persisted templates
cannot drive the renderer with malformed or unbounded values.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    StrictBool,
    ValidationError,
    field_validator,
    model_validator,
)

from .. import config

router = APIRouter(prefix="/api", tags=["templates"])

# Guard rails for a local, single-user store: enough headroom for real use,
# low enough that a runaway client can't bloat the workspace file unbounded.
MAX_PER_KIND = 50
MAX_DATA_BYTES = 64 * 1024
MAX_POST_TWEETS = 20

Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
SpacingNumber = Annotated[FiniteFloat, Field(ge=0, le=200)]
TextSize = Annotated[FiniteFloat, Field(ge=8, le=80)]
Offset = Annotated[FiniteFloat, Field(ge=-100_000, le=100_000)]
Ratio = Annotated[FiniteFloat, Field(ge=0, le=1)]

DEFAULT_POST_BODY = (
    "#place - #pluscode\n\n#description\n\n#coordinates\n\n#mention\n\nSource: #source"
)


class CanonicalModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ProofSpace(CanonicalModel):
    pad: SpacingNumber = 20
    gap: SpacingNumber = 16
    rowGap: SpacingNumber = 18


class ProofSignature(CanonicalModel):
    anchor: Literal["tl", "tr", "bl", "br"] = "br"
    dx: Offset = 0
    dy: Offset = 0
    scale: Annotated[FiniteFloat, Field(ge=0.03, le=0.6)] = 0.08
    opacity: Ratio = 0.9
    xRatio: Ratio | None = None
    yRatio: Ratio | None = None


class ProofSignatureText(CanonicalModel):
    anchor: Literal["tl", "tr", "bl", "br"] = "br"
    dx: Offset = 0
    dy: Offset = 0
    size: Annotated[FiniteFloat, Field(ge=12, le=300)] = 28
    color: Color = "#ffffff"
    opacity: Ratio = 1
    xRatio: Ratio | None = None
    yRatio: Ratio | None = None

    @field_validator("color")
    @classmethod
    def normalize_color(cls, color: str) -> str:
        return color.lower()


class ProofTemplateData(CanonicalModel):
    bg: Color = "#0d1117"
    space: ProofSpace = Field(default_factory=ProofSpace)
    layout: Literal["grid", "free"] = "grid"
    captionSize: TextSize = 20
    legendSize: TextSize = 20
    footerSize: TextSize = 15
    footer: str = Field(default="", max_length=200)
    footerEnabled: StrictBool = True
    footerColor: Color | None = None
    footerAlign: Literal["left", "right"] = "left"
    captionsEnabled: StrictBool = True
    panelDirection: Literal["horizontal", "vertical"] = "horizontal"
    signature: ProofSignature | None = None
    signatureText: ProofSignatureText | None = None
    palette: list[Color] = Field(
        default_factory=lambda: [
            "#ff5252",
            "#40c4ff",
            "#ffd740",
            "#69f0ae",
            "#e040fb",
            "#ff9e40",
            "#ffffff",
        ],
        min_length=1,
        max_length=7,
    )

    @field_validator("bg", "footerColor")
    @classmethod
    def normalize_color(cls, color: str | None) -> str | None:
        return color.lower() if color is not None else None

    @field_validator("palette")
    @classmethod
    def normalize_palette(cls, colors: list[str]) -> list[str]:
        normalized = [color.lower() for color in colors]
        if len(set(normalized)) != len(normalized):
            raise ValueError("palette colors must be unique")
        return normalized


class PostExtraTweet(CanonicalModel):
    text: str = Field(default="", max_length=4_000)


class PostTemplateData(CanonicalModel):
    mention: str = Field(default="@GeoConfirmed", max_length=120)
    body: str = Field(default=DEFAULT_POST_BODY, min_length=1, max_length=16_000)
    mediaEnabled: StrictBool = True
    extraTweets: list[PostExtraTweet] = Field(default_factory=list, max_length=MAX_POST_TWEETS)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_toggles(cls, value: Any) -> Any:
        if not isinstance(value, dict) or value.get("body"):
            return value
        toggles = value.get("toggles")
        if not isinstance(toggles, dict):
            return value
        parts = []
        if toggles.get("showHeader"):
            parts.append("#place - #pluscode")
        if toggles.get("showDescription"):
            parts.append("#description")
        if toggles.get("showCoords"):
            parts.append("#coordinates")
        if toggles.get("showMention"):
            parts.append("#mention")
        if toggles.get("showSource"):
            parts.append("Source: #source")
        migrated = dict(value)
        migrated["body"] = "\n\n".join(parts) or DEFAULT_POST_BODY
        return migrated

    @field_validator("body")
    @classmethod
    def normalize_body(cls, body: str) -> str:
        return body if body.strip() else DEFAULT_POST_BODY


class TemplateIn(BaseModel):
    # None → create a new preset; an existing id → update it in place
    id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    data: dict[str, Any]

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _require_kind(kind: str) -> None:
    if kind not in config.TEMPLATE_KINDS:
        raise HTTPException(status_code=404, detail=f"unknown template kind '{kind}'")


def _canonical_data(kind: str, data: dict[str, Any]) -> dict[str, Any]:
    model = ProofTemplateData if kind == "proof" else PostTemplateData
    try:
        return model.model_validate(data).model_dump(mode="json")
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_input=False)) from exc


def _data_size(data: dict[str, Any]) -> int:
    try:
        return len(json.dumps(data, allow_nan=False).encode("utf-8"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="template data must be valid JSON") from exc


@router.get("/templates")
def list_templates() -> dict[str, Any]:
    templates = config.load_templates()
    for kind in config.TEMPLATE_KINDS:
        valid = []
        for item in templates[kind]:
            try:
                canonical = _canonical_data(kind, item["data"])
            except HTTPException:
                continue
            valid.append({**item, "data": canonical})
        templates[kind] = valid
    return templates


@router.post("/templates/{kind}")
def save_template(kind: str, body: TemplateIn) -> dict[str, Any]:
    _require_kind(kind)
    if _data_size(body.data) > MAX_DATA_BYTES:
        raise HTTPException(status_code=413, detail="template data too large")
    data = _canonical_data(kind, body.data)
    if _data_size(data) > MAX_DATA_BYTES:
        raise HTTPException(status_code=413, detail="template data too large")

    record: dict[str, Any] = {}

    def apply(templates: dict[str, Any]) -> None:
        nonlocal record
        items = templates.setdefault(kind, [])
        if body.id:
            for item in items:
                if item.get("id") == body.id:
                    item["name"] = body.name
                    item["data"] = data
                    item["updated_at"] = _now()
                    record = item
                    return
            raise HTTPException(status_code=404, detail="template not found")
        if len(items) >= MAX_PER_KIND:
            raise HTTPException(status_code=409, detail="too many templates")
        record = {
            "id": secrets.token_hex(8),
            "name": body.name,
            "data": data,
            "updated_at": _now(),
        }
        items.append(record)

    config.update_templates(apply)
    return record


@router.delete("/templates/{kind}/{template_id}")
def delete_template(kind: str, template_id: str) -> dict[str, Any]:
    _require_kind(kind)
    removed = False

    def apply(templates: dict[str, Any]) -> None:
        nonlocal removed
        items = templates.get(kind, [])
        kept = [item for item in items if item.get("id") != template_id]
        removed = len(kept) != len(items)
        templates[kind] = kept

    config.update_templates(apply)
    return {"deleted": removed}
