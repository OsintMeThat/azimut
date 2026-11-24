"""REST API for reusable presets: proof house styles, post-thread skeletons and map layouts.

Templates are app-wide (workspace-level), like the signature and API keys — a
house style spans every case, so it never lives inside a case folder. The
families, keyed by ``kind``: "proof" (a proof's layout/colors/signature), "post"
(a thread skeleton: which lines, mention, media, extra tweets), "map" (a map
plate's layout), "note" (a note to start others from) and "figure" (a note's
infographic, chart or map without its data, `engine/figuretemplates.py`). The
``data`` is validated here and again in the composers so persisted templates
cannot drive the renderer with malformed or unbounded values.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    StrictBool,
    SerializerFunctionWrapHandler,
    ValidationError,
    field_validator,
    model_serializer,
    model_validator,
)

from .. import config
from ..engine import figuretemplates, mapplates, notelook, notes_infographic
from .notes import MAX_PREVIEW_BODY_BYTES as MAX_PREVIEW_BODY_BYTES
from .notes import PreviewIn, preview_response

router = APIRouter(prefix="/api", tags=["templates"])

# Guard rails for a local, single-user store: enough headroom for real use,
# low enough that a runaway client can't bloat the workspace file unbounded.
MAX_PER_KIND = 50
MAX_DATA_BYTES = 64 * 1024
#: A map template may keep a logo or a paper picture inside it (`mapplates.Picture`).
MAX_MAP_DATA_BYTES = 720 * 1024
MAX_POST_TWEETS = 20
#: The longest figure a template is made from or applied to: the infographic's own bound.
MAX_FIGURE_BODY = notes_infographic.MAX_BODY

Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
SpacingNumber = Annotated[FiniteFloat, Field(ge=0, le=200)]
TextSize = Annotated[FiniteFloat, Field(ge=8, le=80)]
Offset = Annotated[FiniteFloat, Field(ge=-100_000, le=100_000)]
Ratio = Annotated[FiniteFloat, Field(ge=0, le=1)]

#: The classic layout (frontend `lib/post.js` DEFAULT_TWEET_BODY), for a template whose
#: body is blank: a proof of a video prints its time under its description.
DEFAULT_POST_BODY = (
    "#place - #pluscode\n\n#description\n#timecode\n\n#coordinates\n\n#mention\n\nSource: #source"
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


class ProofAzimutMark(CanonicalModel):
    """The Azimut mark in a corner of the proof: the logo and the name, or either alone."""

    anchor: Literal["tl", "tr", "bl", "br"] = "br"
    show: Literal["both", "logo", "name"] = "both"
    size: Annotated[FiniteFloat, Field(ge=12, le=300)] = 28


#: Keys a style stored before them never had. Unset, the template says nothing about
#: them, and they stay unwritten, so a style saved again reads back as it was written.
UNSTATED_WHEN_NONE = ("sceneBadge", "footerCredits", "azimutMark")


class ProofTemplateData(CanonicalModel):
    bg: Color = "#0d1117"
    space: ProofSpace = Field(default_factory=ProofSpace)
    layout: Literal["grid", "free"] = "grid"
    captionSize: TextSize = 20
    legendSize: TextSize = 20
    footerSize: TextSize = 15
    footer: str = Field(default="", max_length=200)
    footerEnabled: StrictBool = True
    # What the band prints. A style stored before these existed reads with these
    # defaults, which is what it has always looked like: the credit line prints,
    # the coordinates do not.
    footerText: StrictBool = True
    footerCoords: StrictBool = False
    footerColor: Color | None = None
    footerAlign: Literal["left", "right"] = "left"
    captionColor: Color | None = None
    captionsEnabled: StrictBool = True
    panelDirection: Literal["horizontal", "vertical"] = "horizontal"
    # The typeface every word on the proof is set in, shipped with the app so a
    # proof reads the same on every machine. A style stored before fonts existed
    # keeps the system's, which is what it has always looked like.
    font: Literal["system", "inter", "barlow", "oxanium", "plexmono"] = "system"
    fontBold: StrictBool = True
    signature: ProofSignature | None = None
    signatureText: ProofSignatureText | None = None
    # What the look says about the scene's time on a video's frames and the panels'
    # imagery credits. None leaves each proof its own answer, as `footerText` does
    # for a style from before it.
    sceneBadge: StrictBool | None = None
    footerCredits: StrictBool | None = None
    # The Azimut mark beside the signature. None draws none.
    azimutMark: ProofAzimutMark | None = None
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

    @field_validator("bg", "footerColor", "captionColor")
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

    @model_serializer(mode="wrap")
    def _unstated_stays_unwritten(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = dict(handler(self))
        for key in UNSTATED_WHEN_NONE:
            if data.get(key) is None:
                data.pop(key, None)
        return data


class PostExtraTweet(CanonicalModel):
    text: str = Field(default="", max_length=4_000)


#: What a post is made from, as New post offers it (frontend `lib/post.js` POST_KINDS).
PostKind = Literal["geolocation", "video", "plate", "compare", "free"]
#: A video thread's posts, top to bottom, as blocks (frontend `lib/threadOrder.js`): the
#: recap, the video, the first place on its own, the places (the others after a first),
#: or All in one's one post alone.
ThreadBlock = Literal["recap", "video", "first", "places", "all"]
#: The four ready orders. The first 0.3.4 builds stored one by its name, read as its list.
THREAD_ORDER_PRESETS: dict[str, list[str]] = {
    "recap": ["recap", "video", "places"],
    "video": ["video", "places"],
    "proof": ["first", "video", "places"],
    "all": ["all"],
}
#: A post template's keys that a template from before them never had. Unset, they stay
#: unwritten, so a 0.3.3 template reads and saves back byte for byte.
POST_UNSTATED_WHEN_NONE = ("kind", "reply", "order", "posts")


class PostRoleText(CanonicalModel):
    """The text of one kind of post in a video thread, beside the template's ``body``: the
    post carrying the video, and the one each place gets."""

    role: Literal["video", "place"]
    body: str = Field(default="", max_length=4_000)


class PostTemplateData(CanonicalModel):
    mention: str = Field(default="@GeoConfirmed", max_length=280)
    body: str = Field(default=DEFAULT_POST_BODY, min_length=1, max_length=16_000)
    mediaEnabled: StrictBool = True
    extraTweets: list[PostExtraTweet] = Field(default_factory=list, max_length=MAX_POST_TWEETS)
    # The kind of post it shapes. None is a Geolocation one, which is what every
    # template was before kinds, and "geolocation" is read as that same None so the
    # kind has one spelling.
    kind: PostKind | None = None
    # Whether a post of this template goes out as a reply under its source by default,
    # when the source is an X or a Bluesky post. None is no, the one spelling of it.
    reply: StrictBool | None = None
    # A video thread's posts top to bottom, and the texts of its other posts: ``body`` is
    # its recap (the recap's post, All in one's one post), these the video's and each
    # place's. None for any other kind.
    order: list[ThreadBlock] | None = Field(default=None, max_length=4)
    posts: list[PostRoleText] | None = Field(default=None, max_length=4)

    @field_validator("kind")
    @classmethod
    def geolocation_says_nothing(cls, kind: str | None) -> str | None:
        return None if kind == "geolocation" else kind

    @field_validator("reply", mode="before")
    @classmethod
    def reply_is_yes_or_unsaid(cls, reply: Any) -> Any:
        # The first 0.3.4 builds said whether a reply kept its source line, never
        # whether to reply. Neither word says to, so a template saved by them reads on.
        if reply in ("keep-source", "drop-source"):
            return None
        return reply

    @field_validator("reply")
    @classmethod
    def no_is_unsaid(cls, reply: bool | None) -> bool | None:
        return True if reply else None

    @field_validator("order", mode="before")
    @classmethod
    def order_by_name_reads_as_its_posts(cls, order: Any) -> Any:
        if isinstance(order, str) and order in THREAD_ORDER_PRESETS:
            return list(THREAD_ORDER_PRESETS[order])
        return order

    @field_validator("order")
    @classmethod
    def order_is_a_thread(cls, order: list[str] | None) -> list[str] | None:
        # the video and the places once each, the recap and the first place at most
        # once, anywhere; or All in one alone
        if order is None or order == ["all"]:
            return order
        if "all" in order or len(set(order)) != len(order) or "video" not in order or "places" not in order:
            raise ValueError(
                "a video thread holds the video and the places once each, the recap and the first place "
                "at most once, or all in one alone"
            )
        return order

    @field_validator("posts")
    @classmethod
    def one_text_a_role(cls, posts: list[PostRoleText] | None) -> list[PostRoleText] | None:
        if posts is None:
            return None
        # the first text of each role is the one a thread reads
        kept: dict[str, PostRoleText] = {}
        for one in posts:
            kept.setdefault(one.role, one)
        return list(kept.values()) or None

    @model_validator(mode="after")
    def thread_parts_are_a_video_threads(self) -> "PostTemplateData":
        # the order and the texts per post shape a video thread, and say nothing to the rest
        if self.kind != "video":
            self.order = None
            self.posts = None
        return self

    @model_serializer(mode="wrap")
    def _unstated_stays_unwritten(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = dict(handler(self))
        for key in POST_UNSTATED_WHEN_NONE:
            if data.get(key) is None:
                data.pop(key, None)
        return data

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


class NoteTemplateData(CanonicalModel):
    """A note to start others from: its Markdown, the folder new notes are filed in,
    and how they print. A template written before looks existed has none, and the
    notes made from it print plain, as they always did."""

    body: str = Field(default="", max_length=60_000)
    folder: str = Field(default="", max_length=120)
    look: notelook.TemplateLook | None = None

    @model_serializer(mode="wrap")
    def _no_look_stays_unwritten(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # a template saved without a look reads back exactly as one written before looks
        data = dict(handler(self))
        if data.get("look") is None:
            data.pop("look", None)
        return data


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
    models: dict[str, type[BaseModel]] = {"proof": ProofTemplateData, "post": PostTemplateData,
                                          "map": mapplates.TemplateData, "note": NoteTemplateData,
                                          "figure": figuretemplates.TemplateData}
    model = models[kind]
    try:
        return model.model_validate(data).model_dump(mode="json")
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_input=False, include_context=False)) from exc


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


@router.post("/templates/note/preview")
def preview_note_template(body: PreviewIn) -> Response:
    """A note template laid out as the PDF a note made from it would be, with no case.

    Its references to a case draw as neutral placeholders and its include lines as
    a line saying a chapter goes there; nothing under any case folder is read.
    """
    look = body.look if body.look is not None else notelook.NoteLook()
    return preview_response(
        None, title=body.title.strip() or "Untitled", text=body.text, look=look,
        diagrams=body.diagrams, edition=body.edition,
    )


# -- figure templates: an infographic's, a chart's or a map's layout, without its data ---------------


class FigureFromIn(BaseModel):
    #: The figure's block as the note writes it: an infographic, a chart or a map.
    text: str = Field(min_length=1, max_length=MAX_FIGURE_BODY)


class FigureApplyIn(BaseModel):
    #: The template's data (`figuretemplates.TemplateData`): a saved one's or a ready one's.
    template: figuretemplates.TemplateData
    #: The data it meets, a table's Markdown (an infographic's data, a chart's own rows); "" for none.
    table: str = Field(default="", max_length=MAX_FIGURE_BODY)
    #: Where those rows are from, as ``data:`` names it (``sheet:<id>``, ``note:<id>#<heading>``).
    origin: str = Field(default="", max_length=200)
    #: The template's columns given the data's: a column name, or "" to fill it by hand. None
    #: asks: the answer then says which columns the data does not name, and writes nothing.
    mapping: dict[str, Annotated[str, Field(max_length=120)]] | None = Field(default=None, max_length=64)
    #: The template's columns that count, given the data's rows to count instead.
    rows: list[Annotated[str, Field(max_length=120)]] = Field(default_factory=list, max_length=64)


@router.get("/templates/figure/ready")
def ready_figure_templates() -> dict[str, Any]:
    """The figure templates the app ships: neutral, generic, holding no case's data."""
    return {"ready": figuretemplates.ready()}


@router.post("/templates/figure/from")
def figure_template_from(body: FigureFromIn) -> dict[str, Any]:
    """A figure of a case as a template, not saved: its layout and columns, its data left out."""
    try:
        return figuretemplates.from_block(body.text)
    except figuretemplates.TemplateError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/templates/figure/apply")
def apply_figure_template(body: FigureApplyIn) -> dict[str, Any]:
    """A figure template applied to the data it meets, writing nothing.

    The answer lists the columns it reads (``needs``), each with the data's column of the
    same name (``match``) or one whose name holds it (``suggest``). Without ``mapping`` and
    with a needed column the data does not name, it says ``ask`` and stops there; else it
    answers the infographic's ``text`` and its ``panels``, or a chart's or a map's ``changes``.
    """
    figure, text = body.template.figure, body.template.text
    data = figuretemplates.data_of(body.table, body.origin)
    columns = list(data.table.headers) if data is not None else []
    wanted = figuretemplates.needs(figure, text)
    matched = figuretemplates.match(wanted, columns)
    said = [{**need.said(), "match": matched.get(need.column, ""),
             "suggest": "" if need.column in matched else figuretemplates.suggest(need.column, columns)} for need in wanted]
    ask = data is not None and body.mapping is None and any(need.column not in matched for need in wanted)
    answer: dict[str, Any] = {"needs": said, "columns": columns, "ask": ask}
    if ask:
        return answer
    answer.update(figuretemplates.apply(figure, text, table_text=body.table, origin=body.origin,
                                        given=body.mapping or {}, rows_for=body.rows))
    return answer


@router.post("/templates/{kind}")
def save_template(kind: str, body: TemplateIn) -> dict[str, Any]:
    _require_kind(kind)
    bound = MAX_MAP_DATA_BYTES if kind == "map" else MAX_DATA_BYTES
    if _data_size(body.data) > bound:
        raise HTTPException(status_code=413, detail="template data too large")
    data = _canonical_data(kind, body.data)
    if _data_size(data) > bound:
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
