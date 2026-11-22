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
used them reads the same to a reader that predates them. So did the cover's own
page and where it stands on it (`cover.mode`, `cover.top`): a reader that drops
them prints the style's cover, and the lines meant for the own page as text. And
the analyst's own header and footer (`header`, `footer`), written only once a slot
holds something: a reader that drops them prints the style's own. And how the HTML
page is laid out (`web`): an article, a story whose pictures hold still while their
words scroll by, or a map page, the note's map on the whole page under its title. The PDF
never reads it. A map page may name the GoatCounter site that counts its readers (`counter`),
which only its web folder calls, once read online. And what the note is on the analyst's site
(`category`, `role`, `list_image`): the one category its list files it under, whether it is an
article in the list, a page off it or an unlisted page that is in no list, and the picture its line in the list shows in place of the
cover's (`engine/site.py`); the PDF and the page itself never read them. Who wrote it (`author`, `author_image`),
for a note written by someone else: the web page is signed with that name and the picture beside it, and the
site's lists name them; the PDF never reads them. So is where the note stands on a
map of the site's articles (`place`), which most notes never have and none is given by itself
(`engine/siteplace.py` only offers one). And which list of sources the document ends on
(`sources_list`): the generated one, the note's own section, or both; and the same for the
How this was made and Geolocations annexes against the note's own Method or Geolocations
section (`method_list`, `geolocations_list`).

**The style is the profile.** A style says what the document is, and so what it
carries after its text: the sources list and how it is written (`academic`, `web`,
`short`), the five annexes (`ANNEXES`), and how strict the check before export is
about outside links. Azimut's own answer for each style is `PROFILES`, the one place
it is decided; Settings › Publishing › Styles changes it once for every note
(`note_styles`, carried by the settings backup), and a look changes it for one note
(`sources_style`, `annexes`, `link_check`, late keys like the others).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, fields, replace
from datetime import date
from typing import TYPE_CHECKING, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    StrictBool,
    StrictFloat,
    ValidationError,
    field_validator,
    model_serializer,
    model_validator,
)

if TYPE_CHECKING:
    from ..workspace import Case

#: The case notes' id in every notes route: a note without an entity behind it.
CASE_NOTE = "case"
#: Where the case notes keep their look, since no entity holds them.
CASE_LOOK = "notes.case_look"
#: The attr a filed note keeps its look under.
ATTR = "look"

#: `article` is the Web article: a page read online, its sources written for the web.
Style = Literal["plain", "report", "brief", "journal", "article"]
#: Every style, in the order the Look and Settings list them.
STYLES: tuple[str, ...] = ("report", "article", "brief", "journal", "plain")
Page = Literal["a4", "letter"]
Tlp = Literal["", "clear", "green", "amber", "amber-strict", "red"]
#: The faces a note's text is set in (`engine/pdffonts.py`, `FONTS`); "" keeps the style's own.
Font = Literal["", "serif", "sans", "book", "modern"]
#: The text a step smaller or larger than the style's; "" keeps the style's own.
Size = Literal["", "small", "large"]
#: The numbered list of sources at the end: "" keeps the style's own, else on or off.
Sources = Literal["", "on", "off"]
#: How the HTML page is laid out: "" an article, "story" each picture held still
#: beside the words that follow it, "map" the note's first map on the whole page, its
#: other words beside it (a web map). The PDF prints the same either way.
Web = Literal["", "story", "map"]
#: A GoatCounter site's code, the part of its address before `.goatcounter.com`: what a
#: map page's web folder counts its readers with. "" counts nobody.
COUNTER = r"^([a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?)?$"
#: How the sources list writes each source: "" keeps the style's own. `academic` is a
#: journal's reference list (author, "title", outlet, day, address, archived copy,
#: accessed), `web` the outlet, the title and the day, `short` the form notes always had.
SourcesStyle = Literal["", "academic", "web", "short"]
SOURCES_STYLES: tuple[str, ...] = ("academic", "web", "short")
#: What a note is on the analyst's site: "" or "article", in the site's list, "page", which
#: stays off every list and is linked from the site's header, or "unlisted", online at its
#: address and in no list, feed or sitemap (`engine/site.py`). An article is stored as nothing,
#: like every default.
Role = Literal["", "article", "page", "unlisted"]
#: The longest a category's name is, in characters.
CATEGORY_MAX = 60
#: The longest an article's author is, in characters: one line.
AUTHOR_MAX = 120
#: How far north or south a note's place on the site's map may stand: web maps draw in Web
#: Mercator, which stops at about 85 degrees.
PLACE_LAT_MAX = 85
#: The longest a place's name is, in characters: the label of its pin.
PLACE_NAME_MAX = 80
#: How the check before export names the outside links with no archived copy or no seen
#: day: "" the style's own, `each` one line per link, `grouped` one line per kind.
LinkCheck = Literal["", "each", "grouped"]
LINK_CHECKS: tuple[str, ...] = ("each", "grouped")
#: Which list of sources a document with sources ends on: `generated`, the numbered list
#: Azimut writes from what the note cites; `own`, the note's own section as written, the
#: links still checked and nothing numbered; `both`. "" decides from the note: its own
#: when it has a heading named Sources or References (`notes_markdown.own_sources`), else
#: the generated one. Not a style's default, since it hangs on what the note holds. The
#: method and geolocations annexes take the same three ways (`method_list`, `geolocations_list`).
SourcesList = Literal["", "generated", "own", "both"]
SOURCES_LISTS: tuple[str, ...] = ("generated", "own", "both")
#: An annex as a look sets it: "" the style's own, else on or off.
Switch = Literal["", "on", "off"]
#: What a document may add after its sources, in the order it prints them: the proofs it
#: cites as a table, the credits it owes, the facts of how it was made, its Limits boxes
#: gathered, and its editions with what each corrected.
ANNEXES: tuple[str, ...] = ("geolocations", "credits", "method", "limits", "editions")
#: Keys a look writes only once they leave their default, so a look that never used
#: them is stored, served and bundled exactly as an older Azimut wrote it.
LATE_KEYS = ("font", "size", "sources", "web", "sources_style", "link_check", "sources_list", "method_list",
             "geolocations_list", "signed", "counter", "category", "role", "list_image", "author", "author_image")
#: The page bands under the same rule: one with nothing in it is not written.
BAND_KEYS = ("header", "footer")
#: The longest a header or footer slot is, in characters: one line of a page's edge.
BAND_SLOT_MAX = 120
#: The cover's keys under the same rule: a cover of the style's own, centred, writes neither.
COVER_LATE_KEYS = ("mode", "top", "marks")
#: What the cover is: "" the style's (title, subtitle, picture, day), or "own", the
#: lines above `<!-- cover -->` as a page of their own (`engine/notefill.py`).
CoverMode = Literal["", "own"]
#: What the style's cover carries beside its title: the app's mark, the analyst's logo
#: and their signature (the handwritten picture with their name, role and organisation),
#: each from Settings › Publishing (`notefill.Identity`).
CoverMark = Literal["azimut", "logo", "signature"]
COVER_MARKS: tuple[str, ...] = ("azimut", "logo", "signature")
#: Where the document is signed with the analyst's name: "" nowhere, "title" a byline
#: under the title, "end" their signature after the last section.
Signed = Literal["", "title", "end"]


@dataclass(frozen=True)
class Profile:
    """What a document carries after its text, and how strictly its links are checked."""

    sources: bool
    sources_style: str
    geolocations: bool
    credits: bool
    method: bool
    limits: bool
    editions: bool
    link_check: str

    def annex(self, key: str) -> bool:
        return bool(getattr(self, key))

    def as_json(self) -> dict[str, Any]:
        return {one.name: getattr(self, one.name) for one in fields(self)}


#: What each style carries when nobody changed it: the one place Azimut decides it.
#: Plain is the document notes always printed as. A report is read as a paper: its
#: sources academic, every annex, its links' warnings grouped with each link one press
#: away (a long article would otherwise list a hundred lines). The Web article owes its
#: readers the credits and its corrections. The brief and the journal stay lean.
PROFILES: dict[str, Profile] = {
    "plain": Profile(sources=False, sources_style="short", geolocations=False, credits=False, method=False,
                     limits=False, editions=False, link_check="grouped"),
    "report": Profile(sources=True, sources_style="academic", geolocations=True, credits=True, method=True,
                      limits=True, editions=True, link_check="grouped"),
    "brief": Profile(sources=True, sources_style="short", geolocations=False, credits=False, method=False,
                     limits=False, editions=False, link_check="grouped"),
    "journal": Profile(sources=True, sources_style="short", geolocations=False, credits=False, method=False,
                       limits=False, editions=False, link_check="grouped"),
    "article": Profile(sources=True, sources_style="web", geolocations=False, credits=True, method=False,
                       limits=False, editions=True, link_check="grouped"),
}
#: The settings key holding what Settings › Publishing › Styles changed: by style, only
#: what differs from `PROFILES`, so a default Azimut changes later still reaches the rest.
SETTINGS_KEY = "note_styles"
#: The styles that print no sources list unless the look asks for one, as Azimut ships them.
SOURCES_OFF_STYLES: tuple[str, ...] = tuple(style for style, kept in PROFILES.items() if not kept.sources)


class StyleChoices(BaseModel):
    """One style's defaults as Settings changed them, each absent one Azimut's."""

    model_config = ConfigDict(extra="ignore")

    sources: StrictBool | None = None
    sources_style: Literal["academic", "web", "short"] | None = None
    geolocations: StrictBool | None = None
    credits: StrictBool | None = None
    method: StrictBool | None = None
    limits: StrictBool | None = None
    editions: StrictBool | None = None
    link_check: Literal["each", "grouped"] | None = None


def styles_table(saved: Any = None) -> dict[str, Profile]:
    """Every style's defaults: Azimut's, with what Settings changed. A saved value this
    build cannot read keeps Azimut's, one key at a time."""
    table = dict(PROFILES)
    if not isinstance(saved, dict):
        return table
    for style, choices in saved.items():
        if style not in table or not isinstance(choices, dict):
            continue
        kept: dict[str, Any] = {}
        for key, value in choices.items():
            try:
                read = StyleChoices.model_validate({key: value})
            except ValidationError:
                continue
            if key in StyleChoices.model_fields and getattr(read, key) is not None:
                kept[key] = getattr(read, key)
        table[style] = replace(table[style], **kept)
    return table


def saved_styles(table: Any) -> dict[str, dict[str, Any]]:
    """What a table differs by from Azimut's own, which is all Settings keeps."""
    read = styles_table(table)
    return {
        style: changed
        for style, profile in read.items()
        if (changed := {key: value for key, value in profile.as_json().items()
                        if value != getattr(PROFILES[style], key)})
    }


def settings_table() -> dict[str, Profile]:
    """The styles' defaults on this machine, as Settings › Publishing › Styles left them."""
    from .. import config

    return styles_table(config.load_settings().get(SETTINGS_KEY))

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
    """The cover page: on or off, the style's or the note's own, and what it says
    beside the title."""

    model_config = ConfigDict(extra="forbid")

    on: StrictBool = False
    subtitle: str = Field(default="", max_length=200)
    #: A case media entity id, or "" for a cover without a picture.
    image: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    #: ``YYYY-MM-DD``, or "" to print the day the PDF is made.
    date: str = Field(default="", pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    #: "" the style's cover, "own" the note's own page; counts only while ``on``.
    mode: CoverMode = ""
    #: The own page starts at the top rather than centred down the page.
    top: StrictBool = False
    #: What the style's cover carries beside the title, in `COVER_MARKS` order.
    marks: list[CoverMark] = Field(default_factory=list, max_length=3)

    @model_serializer(mode="wrap")
    def _late_keys_only_when_set(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = dict(handler(self))
        for key in COVER_LATE_KEYS:
            if not data.get(key):
                data.pop(key, None)
        return data

    @property
    def own(self) -> bool:
        """Whether the note prints its own first page."""
        return self.on and self.mode == "own"

    @field_validator("marks")
    @classmethod
    def marks_in_order(cls, value: list[str]) -> list[str]:
        return [mark for mark in COVER_MARKS if mark in value]

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


class PageBand(BaseModel):
    """A header or footer of the analyst's own: three slots, left, centre and right,
    on every page but the cover. Each is one line of text, its placeholders filled
    at print time (`{title}`, `{date}`, `{name}`, `{role}`, `{organisation}`,
    `{page}`, `{pages}`), or one of the pictures `azimut:my-logo` and `azimut:logo`.
    A band with nothing in it leaves the style's own."""

    model_config = ConfigDict(extra="forbid")

    left: str = Field(default="", max_length=BAND_SLOT_MAX)
    center: str = Field(default="", max_length=BAND_SLOT_MAX)
    right: str = Field(default="", max_length=BAND_SLOT_MAX)

    @field_validator("left", "center", "right")
    @classmethod
    def one_line(cls, value: str) -> str:
        return " ".join(value.split())

    @property
    def empty(self) -> bool:
        return not (self.left or self.center or self.right)


class NoteAnnexes(BaseModel):
    """Which annexes this note prints, each "" for its style's own. Written only once
    one is set, and then only the ones set."""

    model_config = ConfigDict(extra="forbid")

    geolocations: Switch = ""
    credits: Switch = ""
    method: Switch = ""
    limits: Switch = ""
    editions: Switch = ""

    @model_serializer(mode="wrap")
    def _set_ones_only(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        return {key: value for key, value in dict(handler(self)).items() if value}


def place_problem(lat: float, lon: float, name: str = "") -> str:
    """What keeps a point and a name from being a place on the site's map, "" when nothing does."""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return "the coordinates must be finite numbers"
    if abs(lat) > PLACE_LAT_MAX:
        return f"the latitude must be between -{PLACE_LAT_MAX} and {PLACE_LAT_MAX}, where web maps stop"
    if abs(lon) > 180:
        return "the longitude must be between -180 and 180"
    if len(name) > PLACE_NAME_MAX:
        return f"the name is longer than {PLACE_NAME_MAX} characters"
    return ""


class NotePlace(BaseModel):
    """Where a note stands on a map of the analyst's site: a point in decimal degrees, kept to
    six places (about 11 cm), and the name its pin is labelled with, "" for none."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    lat: StrictFloat
    lon: StrictFloat
    name: str = ""

    @field_validator("lat", "lon")
    @classmethod
    def six_places(cls, value: float) -> float:
        # `+ 0.0` keeps a point a hair south of the equator from being written `-0.0`
        return round(value, 6) + 0.0 if math.isfinite(value) else value

    @field_validator("name", mode="before")
    @classmethod
    def one_line_name(cls, value: Any) -> Any:
        return " ".join(value.split()) if isinstance(value, str) else value

    @model_validator(mode="after")
    def on_the_map(self) -> "NotePlace":
        problem = place_problem(self.lat, self.lon, self.name)
        if problem:
            raise ValueError(problem)
        return self


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
    web: Web = ""
    sources_style: SourcesStyle = ""
    annexes: NoteAnnexes = Field(default_factory=NoteAnnexes)
    link_check: LinkCheck = ""
    sources_list: SourcesList = ""
    #: The same three ways for the How this was made and Geolocations annexes, against the
    #: note's own Method or Geolocations section (`notes_markdown.OWN_SECTIONS`).
    method_list: SourcesList = ""
    geolocations_list: SourcesList = ""
    signed: Signed = ""
    #: The GoatCounter site a map page's web folder counts its readers with (`COUNTER`).
    counter: str = Field(default="", pattern=COUNTER)
    #: The one category the site's list files the note under; "" for none.
    category: str = Field(default="", max_length=CATEGORY_MAX)
    #: An article, a page that stays off the site's lists, or an unlisted page.
    role: Role = ""
    #: A case media entity id: the picture the note's line in the site's list shows in place of
    #: the cover's, or "" for the cover picture.
    list_image: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    #: Who wrote the note, when it is not the analyst: its web page is signed with this name and the
    #: site's lists name it. "" is the analyst, as Settings › Publishing names them.
    author: str = Field(default="", max_length=AUTHOR_MAX)
    #: A case media entity id: the author's picture, shown small and round beside their name; "" for none.
    #: Never a logo in its place: the site's logo is already in its bar.
    author_image: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    #: Where the note stands on a map of the site's articles, None for nowhere: the analyst's
    #: alone to set, and written only once set.
    place: NotePlace | None = None
    header: PageBand = Field(default_factory=PageBand)
    footer: PageBand = Field(default_factory=PageBand)

    @model_serializer(mode="wrap")
    def _late_keys_only_when_set(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # An older reader refuses a key it does not know in a template's look; one
        # that was never changed is not worth hiding the template from it for.
        data = dict(handler(self))
        for key in LATE_KEYS:
            if data.get(key) == "":
                data.pop(key, None)
        if data.get("place") is None:
            data.pop("place", None)
        for key in BAND_KEYS:
            band = data.get(key)
            if isinstance(band, dict) and not any(band.values()):
                data.pop(key, None)
        if not data.get("annexes"):
            data.pop("annexes", None)
        return data

    @field_validator("accent")
    @classmethod
    def lower_case(cls, value: str) -> str:
        return value.lower()

    @field_validator("counter", mode="before")
    @classmethod
    def counter_code(cls, value: Any) -> Any:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("role", mode="before")
    @classmethod
    def article_is_the_default(cls, value: Any) -> Any:
        return "" if value == "article" else value

    @field_validator("category", "author", mode="before")
    @classmethod
    def one_line_words(cls, value: Any) -> Any:
        return " ".join(value.split()) if isinstance(value, str) else value

    @property
    def is_default(self) -> bool:
        return self == DEFAULT

    def profile(self, table: dict[str, Profile] | None = None) -> Profile:
        """What this note carries: its style's defaults (``table``, else this machine's
        Settings), with each switch the look sets."""
        base = (table if table is not None else settings_table()).get(self.style, PROFILES[self.style])
        changed: dict[str, Any] = {}
        if self.sources:
            changed["sources"] = self.sources == "on"
        if self.sources_style:
            changed["sources_style"] = self.sources_style
        if self.link_check:
            changed["link_check"] = self.link_check
        for key in ANNEXES:
            value = getattr(self.annexes, key)
            if value:
                changed[key] = value == "on"
        return replace(base, **changed) if changed else base

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

    @field_validator("list_image")
    @classmethod
    def no_list_picture(cls, value: str) -> str:
        if value:
            raise ValueError("a template cannot hold a picture from a case")
        return value

    @field_validator("place")
    @classmethod
    def no_place(cls, value: NotePlace | None) -> NotePlace | None:
        if value is not None:
            raise ValueError("a template cannot hold an article's place")
        return value

    @field_validator("author", "author_image")
    @classmethod
    def no_author(cls, value: str) -> str:
        if value:
            raise ValueError("a template cannot hold an article's author")
        return value


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
    annexes = known.get("annexes")
    if isinstance(annexes, dict):
        known["annexes"] = {key: annexes[key] for key in NoteAnnexes.model_fields if key in annexes}
    for key in BAND_KEYS:
        band = known.get(key)
        if isinstance(band, dict):
            known[key] = {slot: band[slot] for slot in PageBand.model_fields if slot in band}
    # One unreadable value at a time goes back to its default; a field nested in
    # the cover goes alone, and the rest of the cover stays.
    nested = ("cover", "annexes", *BAND_KEYS)
    rounds = (len(NoteLook.model_fields) + len(NoteCover.model_fields) + len(NoteAnnexes.model_fields)
              + 2 * len(PageBand.model_fields) + 1)
    for _ in range(rounds):
        try:
            return NoteLook.model_validate(known)
        except ValidationError as exc:
            dropped = False
            for error in exc.errors():
                where = error.get("loc") or ()
                inner = known.get(str(where[0])) if where else None
                if len(where) >= 2 and where[0] in nested and isinstance(inner, dict) and where[1] in inner:
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
    """The media a look shows on its cover, in the site's list and beside its author's name, which
    the note derives from as it does from a picture in its text."""
    if look is None:
        return []
    return [one for one in dict.fromkeys((look.cover.image, look.list_image, look.author_image)) if one]
