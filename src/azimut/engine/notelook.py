"""How a note prints: its look.

A note is Markdown, and the Markdown says what the note holds. How it comes out
as a PDF (a plain document, a report with a cover and a table of contents, a
one-page brief, a dated log) is a separate choice, kept beside the note rather
than in its text, so changing the look never rewrites a word the analyst typed.

A filed note keeps its look in its entity's attrs (``look``); the case notes,
which have no entity, keep theirs in the case settings (``notes.case_look``).
Both are absent until somebody picks a look, and absent reads as the default,
which is ``plain``: the document every note printed as before looks existed.

Nothing here bumps the case schema. An older Azimut opening a case that holds
looks sees one more attr and one more setting it never reads, and prints every
note plain. The face, the text size and the sources list came later (`font`,
`size`, `sources`) and are written only once they are set, so a look that never
used them reads the same to a reader that predates them.
"""

from __future__ import annotations

import json
from datetime import date
from typing import TYPE_CHECKING, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    StrictBool,
    ValidationError,
    field_validator,
    model_serializer,
)

if TYPE_CHECKING:
    from ..workspace import Case

#: The case notes' id in every notes route: a note without an entity behind it.
CASE_NOTE = "case"
#: Where the case notes keep their look, since no entity holds them.
CASE_LOOK = "notes.case_look"
#: The attr a filed note keeps its look under.
ATTR = "look"

Style = Literal["plain", "report", "brief", "journal"]
Page = Literal["a4", "letter"]
Tlp = Literal["", "clear", "green", "amber", "amber-strict", "red"]
#: The faces a note's text is set in (`engine/pdffonts.py`, `FONTS`); "" keeps the style's own.
Font = Literal["", "serif", "sans", "book", "modern"]
#: The text a step smaller or larger than the style's; "" keeps the style's own.
Size = Literal["", "small", "large"]
#: The numbered list of sources at the end: "" keeps the style's own, else on or off.
Sources = Literal["", "on", "off"]
#: Keys a look writes only once they leave their default, so a look that never used
#: them is stored, served and bundled exactly as an older Azimut wrote it.
LATE_KEYS = ("font", "size", "sources")
#: The styles that print no sources list unless the look asks for one: plain is the
#: document notes always printed as. Read by the frontend's mirror of this rule.
SOURCES_OFF_STYLES: tuple[str, ...] = ("plain",)

#: FIRST TLP 2.0: the label as written, and its colour. Every label is set on
#: black, in capitals, with no spaces, right-justified in the header and footer of
#: every page (https://www.first.org/tlp/).
TLP_LABELS: dict[str, tuple[str, tuple[int, int, int]]] = {
    "clear": ("TLP:CLEAR", (255, 255, 255)),
    "green": ("TLP:GREEN", (51, 255, 0)),
    "amber": ("TLP:AMBER", (255, 192, 0)),
    "amber-strict": ("TLP:AMBER+STRICT", (255, 192, 0)),
    "red": ("TLP:RED", (255, 43, 43)),
}


class NoteCover(BaseModel):
    """The cover page: on or off, and what it says beside the title."""

    model_config = ConfigDict(extra="forbid")

    on: StrictBool = False
    subtitle: str = Field(default="", max_length=200)
    #: A case media entity id, or "" for a cover without a picture.
    image: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    #: ``YYYY-MM-DD``, or "" to print the day the PDF is made.
    date: str = Field(default="", pattern=r"^(\d{4}-\d{2}-\d{2})?$")

    @field_validator("subtitle")
    @classmethod
    def one_line(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("date")
    @classmethod
    def real_day(cls, value: str) -> str:
        if value:
            try:
                date.fromisoformat(value)
            except ValueError as exc:
                raise ValueError("the cover date is a day, YYYY-MM-DD") from exc
        return value


class NoteLook(BaseModel):
    """Every key optional, every missing one at its default; unknown keys refused."""

    model_config = ConfigDict(extra="forbid")

    style: Style = "plain"
    page: Page = "a4"
    #: "" keeps the style's own colour.
    accent: str = Field(default="", pattern=r"^(#[0-9a-fA-F]{6})?$")
    tlp: Tlp = ""
    cover: NoteCover = Field(default_factory=NoteCover)
    toc: StrictBool = False
    numbered: StrictBool = False
    font: Font = ""
    size: Size = ""
    sources: Sources = ""

    @model_serializer(mode="wrap")
    def _late_keys_only_when_set(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # An older reader refuses a key it does not know in a template's look; one
        # that was never changed is not worth hiding the template from it for.
        data = dict(handler(self))
        for key in LATE_KEYS:
            if data.get(key) == "":
                data.pop(key, None)
        return data

    @field_validator("accent")
    @classmethod
    def lower_case(cls, value: str) -> str:
        return value.lower()

    @property
    def is_default(self) -> bool:
        return self == DEFAULT

    @property
    def sources_on(self) -> bool:
        """Whether the note ends with its sources list: as the look says, else as
        its style does."""
        if self.sources:
            return self.sources == "on"
        return self.style not in SOURCES_OFF_STYLES

    def accent_rgb(self) -> tuple[int, int, int] | None:
        if not self.accent:
            return None
        return (int(self.accent[1:3], 16), int(self.accent[3:5], 16), int(self.accent[5:7], 16))


DEFAULT = NoteLook()


class TemplateLook(NoteLook):
    """A template's look: content-free, so no cover picture and no fixed day."""

    @field_validator("cover")
    @classmethod
    def content_free(cls, cover: NoteCover) -> NoteCover:
        if cover.image:
            raise ValueError("a template's cover cannot hold a picture from a case")
        if cover.date:
            raise ValueError("a template's cover cannot hold a date")
        return cover


def parse(value: Any) -> NoteLook | None:
    """A stored look as a model, or None when it is absent or unreadable.

    Lenient where the routes are strict: a look written by a later Azimut may
    carry a key this one does not know, or a value it does not (a face added
    since), and the note should still print with everything it does know rather
    than fall back to plain. Such a key or value is dropped, back to its default,
    and the rest is kept; a look with nothing readable left reads as none at all.
    """
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    if not isinstance(value, dict):
        return None
    try:
        return NoteLook.model_validate(value)
    except ValidationError:
        pass
    known = {key: value[key] for key in NoteLook.model_fields if key in value}
    cover = known.get("cover")
    if isinstance(cover, dict):
        known["cover"] = {key: cover[key] for key in NoteCover.model_fields if key in cover}
    # One unreadable value at a time goes back to its default; a field nested in
    # the cover goes alone, and the rest of the cover stays.
    for _ in range(len(NoteLook.model_fields) + len(NoteCover.model_fields) + 1):
        try:
            return NoteLook.model_validate(known)
        except ValidationError as exc:
            dropped = False
            for error in exc.errors():
                where = error.get("loc") or ()
                inner = known.get("cover")
                if len(where) >= 2 and where[0] == "cover" and isinstance(inner, dict) and where[1] in inner:
                    inner.pop(where[1])
                    dropped = True
                elif where and where[0] in known:
                    known.pop(str(where[0]))
                    dropped = True
            if not dropped or not known:
                return None
    return None


def stored(case: "Case", note_id: str, *, entity: dict[str, Any] | None = None) -> NoteLook | None:
    """The look a note keeps, or None when it keeps the default.

    ``entity`` saves a lookup when the caller already holds the note's row.
    """
    if note_id == CASE_NOTE:
        look = parse(case.get_setting(CASE_LOOK))
    else:
        row = entity if entity is not None else case.get_entity(note_id)
        look = parse(((row or {}).get("attrs") or {}).get(ATTR))
    return None if look is None or look.is_default else look


def effective(case: "Case", note_id: str) -> NoteLook:
    return stored(case, note_id) or DEFAULT


def save(case: "Case", note_id: str, look: NoteLook) -> None:
    """Keep a note's look, writing nothing but the attr or the setting.

    The default is stored as nothing, so a note set back to plain is exactly a
    note that never had a look.
    """
    value = None if look.is_default else look.model_dump(mode="json")
    if note_id == CASE_NOTE:
        case.set_setting(CASE_LOOK, None if value is None else json.dumps(value, sort_keys=True))
    else:
        case.update_entity(note_id, {"attrs": {ATTR: value}})


def cover_image_ids(look: NoteLook | None) -> list[str]:
    """The media a look shows on its cover, which the note derives from as it does
    from a picture in its text."""
    return [look.cover.image] if look is not None and look.cover.image else []
