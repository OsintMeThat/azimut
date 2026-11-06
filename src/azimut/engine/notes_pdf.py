"""A note rendered to PDF, server-side.

The notebook used to export by opening a print window and handing the browser a
stylesheet. That put the result in Chrome's hands: a popup blocker could stop
it, the print dialog added its own margins and page furniture, images sometimes
printed half-loaded, and nothing could produce more than the one note on screen.

So the PDF is built here instead, from the Markdown source rather than from the
preview's DOM. `markdown-it-py` parses the same dialect the preview does — the
source goes through the same rewrites `lib/markdown.js` applies (`[[entity:…]]`,
`[[media:…]]`, `![…](…){width=…}`, `::: center` blocks) so a note reads the same
in both places — and fpdf2 lays the page out.

**Why fpdf2 and not reportlab**, since reportlab is the better layout engine and
was tried first: a note here is as likely to be Burmese, Arabic or Chinese as
English, and reportlab cannot draw two of those correctly at once. With its
shaping off, Burmese and the Indic scripts lose their stacked clusters; with it
on, they come back but Arabic reverses, because reordering a right-to-left run
needs `rlbidi`, which reportlab publishes no build of. fpdf2 shapes through
HarfBuzz and gets both right in one document, including an Arabic phrase inside
an English sentence. Correct text beats prettier boxes.

**Looks.** A note prints in one of four styles (`engine/notes_style.py`), with
a cover, a table of contents, numbered sections and figures and a TLP label as
options (`engine/notelook.py`). A note with no look prints as `plain`, which is
the document this module always made, line for line.

**A first page of one's own.** A look whose cover is the note's own (`cover.mode`
"own") prints the lines above the note's first `<!-- cover -->` alone as page 1,
with no running header, footer or page number but its TLP label, centred down the
page unless the look starts it at the top; the note starts on page 2. Whatever the
look, each `{title}`, `{date}`, `{name}`, `{role}` and `{organisation}` is filled
as the note prints, and `azimut:logo`, `azimut:my-logo` and `azimut:my-signature`
draw the app's logo and the analyst's own two pictures (`engine/notefill.py`).

**Chapters.** A line `[[include:<note id>]]` prints that note in its place: its
title becomes a chapter heading and its own headings move one level down. Two
levels deep at most; a loop or a note that is gone prints a short aside rather
than failing the document. Guidance lines (`<!--? … -->`) never print.

Two things a server cannot do on its own:

- **Diagrams.** Drawing Mermaid needs a browser, so the caller renders each
  fence and posts it as a PNG, keyed by the hash of its source. A fence with no
  PNG falls back to its own source in a code box rather than vanishing.
- **Remote images.** They stay out, as they did in the print export: opening a
  note must not make the machine fetch anything (spec — local-first).

**Sources stay sources.** A PDF is read away from the case, so what the case knows
about where something came from is printed rather than kept behind the app: a
reference to a record with a web address links to it, a picture says under its
caption where it came from, and decimal coordinates link to the map. All of it is
read through `engine/notesources.py`, the one place that says where an item comes
from. A look with its sources list on (`sources`, on by default in every style but
plain) ends with a numbered **Sources** section, each source once, and the body
carries a small `[n]` linked to its entry after every citation.

**The check before export.** Every warning has a kind (`WARNING_KINDS`), so the
Page pane and the export's check can say what is wrong and where: a picture or a
record no longer in the case, a picture without a source, a task left open, a link
a reader cannot open, a section left empty.

**Two editions.** A quote opening `> [!internal]` is a passage for the team only.
The internal edition prints it as a marked box. The public edition is laid out from
the note with every such passage blanked out first (`strip_internal`), chapters
included, so nothing that exists only because of one can reach the page: not its
words, not a heading of it in the contents, not a source only it cites, not a `[n]`.
A passage counts as internal when either reader of the note says so, the editor
(the quote's first line) or this parser (its first paragraph); the public edition
drops what either sees, and refuses to print if one were still there.
"""

from __future__ import annotations

import hashlib
import ipaddress
import math
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from functools import partial
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable, NamedTuple
from urllib.parse import parse_qs, quote, unquote, urlsplit

from fpdf import FPDF
from fpdf.enums import Align, XPos, YPos
from fpdf.image_parsing import preload_image
from markdown_it import MarkdownIt
from markdown_it.token import Token
from PIL import Image as PILImage
from PIL import ImageOps, UnidentifiedImageError

from . import notefill, notes_style, notesources, pdffonts, thumbnails
from .notelook import DEFAULT as DEFAULT_LOOK
from .notelook import NoteLook
from .notes_style import PLAIN, WHITE, NotePage, Theme, mix
from .notesources import Annex, Entry, Source
from .notetext import (
    CALLOUT,
    ENTITY_REF,
    FENCE,
    INCLUDE,
    MEDIA_REF,
    PAGE_BREAK,
    without_hints,
)

if TYPE_CHECKING:
    from ..workspace import Case

# -- the document's look -----------------------------------------------------
#
# Every number and colour lives in the style's theme (`notes_style`). The plain
# theme keeps the print stylesheet's: serif body, sans headings, the app's amber.
# These two remain here as the walk's own reference points: a run whose colour
# is still `INK` takes its paragraph's colour, and a deleted reference reads in
# `MUTED`.

INK = PLAIN.ink
MUTED = PLAIN.muted

#: A pixel is not a millimetre. Inline sizes are authored against the screen,
#: where the notebook's own CSS reads them as CSS pixels at 96 dpi.
PX_TO_MM = 25.4 / 96.0

#: Bounds on what one note may cost. A note is a text file, but it can point at
#: a hundred full-resolution captures, and a PDF holds every one of them.
MAX_IMAGES = 200
MAX_IMAGE_PIXELS = 50_000_000
MAX_TABLE_COLUMNS = 12
#: Room a list bullet takes before its item's text starts.
BULLET_WIDTH = 5.5
#: How deep chapters nest: a report's chapter may hold chapters of its own, and
#: those print their includes as an aside.
MAX_INCLUDE_DEPTH = 2
#: How many chapters one document may pull in, all levels counted.
MAX_CHAPTERS = 100
#: Numbered sections go three levels deep (1, 1.1, 1.1.1); deeper ones are not.
NUMBERED_LEVELS = 3
#: The pictures one preview says where they stand, for the Page pane to size them.
MAX_PAGE_PICTURES = 300
#: Narrower than this, a picture kept on the page it left is too small to read,
#: so the gap it leaves offers nothing.
MIN_FIT_PERCENT = 15
#: A picture with no width written shrinks by up to this much to stay on the page
#: it starts on, rather than leave the rest of that page blank. A width the
#: analyst wrote is never changed.
MAX_SHRINK = 0.25
#: A picture with no width written stays within this share of the page down, so a
#: phone screenshot is not a page tall. A diagram keeps the whole page, and a width
#: the analyst wrote is theirs.
UNSIZED_SHARE = 0.5
#: The browser draws a diagram at twice its size on screen, for a sharp print.
DIAGRAM_PIXEL_SCALE = 2
#: An HTML comment: hidden by every Markdown reader, and so by the PDF too.
COMMENT = re.compile(r"\A(?:\s*<!--.*?-->)+\s*\Z", re.S)

MERMAID_INFO = re.compile(r"^\s*mermaid\b")
IMAGE_ATTRS = re.compile(r"!\[([^\]]*)\]\((\S+?)(?:\s+[\"']([^\"']*)[\"'])?\)\s*\{([^}\n]+)\}")
ALIGNMENT_BLOCK = re.compile(
    r"^:::[ \t]*(left|center|right|top-left|top-right|bottom-left|bottom-right)[ \t]*\n(.*?)^:::[ \t]*$", re.S | re.M
)
ATTR_PARAM = "__azimut_attrs"
ATTR_VALUES = re.compile(r"\b(width|align)\s*=\s*([\w.%+-]+)")
#: `caption="Smoke over the port"` in a picture's braces. Taken out before the
#: width and alignment are read, so a caption that says `width=50%` sets none.
CAPTION_ATTR = re.compile(r'\bcaption\s*=\s*"([^"}\n]*)"')
MAX_CAPTION = 300
#: Decimal coordinates in prose, `33.5138, 36.2765`, as the Notebook finds them
#: (`findCoordinates` in `lib/notes/syntax.js`): three decimals at least, so a
#: version number or a score is not taken for a place.
COORDINATES = re.compile(r"(?<![\w.])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?!\w|\.\d)", re.ASCII)
#: Where a coordinate pair links to: the point on OpenStreetMap, which needs no account.
MAP_LINK = "https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=17/{lat}/{lon}"
#: How many empty sections a document names one by one before it counts the rest.
MAX_EMPTY_SECTIONS = 10
WIDTH_PERCENT = re.compile(r"^(?:[1-9]\d?(?:\.\d+)?|100(?:\.0+)?)%$")
WIDTH_PIXELS = re.compile(r"^(?:[2-9]\d|[1-9]\d{2}|1[0-5]\d{2}|1600)px$")
#: A Log entry's heading, as the Notebook's `/` menu writes it (`lib/notes/syntax.js`,
#: `logStamp`): `2026-11-04 14:32 (UTC+1)`, then whatever the analyst adds.
LOG_STAMP = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?)?"
    r"(?:\s*\(([^)]{1,24})\))?\s*(?:[-–—:]\s*)?(.*)$",
    re.S,
)

ALIGNMENTS = {"left": Align.L, "center": Align.C, "right": Align.R}
#: The corners a block of the note's own cover is pinned to, outside the flow the
#: page centres; anywhere else such a block prints aligned to its side.
CORNERS = {"top-left": Align.L, "top-right": Align.R, "bottom-left": Align.L, "bottom-right": Align.R}
#: How much of the page's width a corner takes at most.
CORNER_SHARE = 0.5
#: An aligned paragraph's words, each with the spaces after it, and its hard breaks.
ALIGNED_WORD = re.compile(r"\n|[^\S\n]*\S+[^\S\n]*|[^\S\n]+")

#: The callouts a quote can open with, as `> [!confirmed]`, their label and colour.
CALLOUTS: dict[str, tuple[str, tuple[int, int, int]]] = {
    "confirmed": ("Confirmed", (46, 125, 50)),
    "unverified": ("Unverified", (189, 122, 37)),
    "lead": ("Lead", (30, 100, 170)),
    "note": ("Note", (119, 119, 119)),
    "warning": ("Warning", (178, 52, 40)),
    "internal": ("Internal", (111, 87, 160)),
}

#: The callout that keeps a passage out of the public edition, and the two editions.
INTERNAL = "internal"
PUBLIC = "public"
EDITIONS = (INTERNAL, PUBLIC)
#: A quote whose first line opens `[!internal]`, as the Notebook's editor reads it
#: (`CALLOUT_LINE` in `lib/notes/callouts.js`): ASCII letters, any case.
EDITOR_INTERNAL = re.compile(r"^\s*>\s*\[!internal\]", re.I | re.A)
#: Whether a stretch of text could hold an internal passage at all. Wider than
#: either reader, so a passage it misses is one neither reader would see.
MAYBE_INTERNAL = re.compile(r"\[!internal\]", re.I)

#: What a document without a case shows where a case would show its own: a
#: template's preview never reads a case file.
CASE_PICTURE = "Picture from the case"
CASE_CHAPTER = "A note included here prints as a chapter."
#: What prints where a picture of the case is gone or unreadable.
MEDIA_UNAVAILABLE = "Media unavailable"
#: What one of the three pictures every note can show resolves to while it is not
#: set: nothing on the page (`engine/notefill.py`); the check says so instead.
PICTURE_NOT_SET = "\x00not set"

#: The own cover page's headings, set as a cover sets a title rather than as the
#: body's sections: (points, leading in millimetres). Deeper ones keep the style's.
COVER_HEADINGS = {"h1": (28.0, 11.5), "h2": (18.0, 8.0), "h3": (13.5, 6.4)}

#: A styled caption's face size and leading, in points and millimetres, before the
#: look's text size; and the narrowest it is set, so a small picture's caption
#: is not a column of single words.
CAPTION_SIZE = 7.8
CAPTION_LEADING = 3.8
CAPTION_MIN_WIDTH = 90.0
#: The credit line under it, a step quieter.
CREDIT_SIZE = 7.2
CREDIT_LEADING = 3.6

#: The list of sources at the end, its entries' type sizes and leadings (points and
#: millimetres, before the look's text size), and the room its numbers hang in.
SOURCES_HEADING = "Sources"
ENTRY_SIZE = 8.2
ENTRY_LEADING = 4.1
ENTRY_SMALL = 7.4
ENTRY_SMALL_LEADING = 3.6
ENTRY_GAP = 2.2
#: What a long address may be broken after, so a wrapped one still reads as one.
ADDRESS_BREAKS = "/?&=#-_.~:+,;"

#: What a warning is about, for the Page pane and the check before export: a
#: picture, video, chapter or record no longer in the case; a picture with no
#: source while the sources are listed; tasks left open in a styled document; a
#: link a reader cannot open; a section left empty; anything else. The check before
#: export adds one that is no fault: the internal passages a public edition leaves out.
MISSING = "missing"
UNSOURCED = "unsourced"
OPEN_TASK = "open-task"
LOCAL_LINK = "local-link"
EMPTY_SECTION = "empty-section"
OTHER = "other"
LEFT_OUT = "internal"
#: Something Settings › Publishing holds and nobody set: the logo, the signature, the name.
SETTING = "setting"
WARNING_KINDS = (MISSING, UNSOURCED, OPEN_TASK, LOCAL_LINK, EMPTY_SECTION, OTHER, LEFT_OUT, SETTING)
#: How many links a reader cannot open are named one by one before the rest are counted.
MAX_LOCAL_LINKS = 10
#: What the aside says where an included note is gone: the warning is read off it.
CHAPTER_GONE = "The note included here is no longer in the case."

#: An address written as it is in prose (`https://…`), which the preview links as
#: GitHub's Markdown does. Its closing punctuation is not part of it (`_bare_urls`).
BARE_URL = re.compile(r"https?://[^\s<>\"'`]+", re.I)
#: A `file:` address, written bare or as a link's target, which the parser leaves as text.
FILE_URL = re.compile(r"(?<![\w/])file:[^\s<>\"'`)\]]+", re.I)
#: A reference to a record, as the case syntax becomes a link.
ENTITY_HREF = re.compile(r"^azimut://entity/([A-Za-z0-9_-]+)$")
#: Hosts a reader somewhere else cannot reach.
LOCAL_NAMES = ("localhost", "localhost.localdomain")
LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")

#: Finds the note a chapter prints: its title and Markdown, or None when it is gone.
Resolve = Callable[[str], "tuple[str, str] | None"]


def embedded_entity_ids(text: str) -> list[str]:
    """The case artifacts a note shows, in the order they appear, deduplicated.

    ``[[media:…]]`` only, never ``[[entity:…]]``: the first is the note *showing* a
    file, which is a derivation, where the second is a pointer at a record, which is
    a mention (ONTOLOGY §3). Reuses the renderer's own pattern, so what the chain
    records and what the page draws can never become two readings of one note.
    """
    return list(dict.fromkeys(match.group(1) for match in MEDIA_REF.finditer(text or "")))


class NotesPdfError(Exception):
    """The note could not be turned into a document."""


@dataclass
class Rendered:
    """One finished PDF, and what the analyst should know about it."""

    pdf: bytes
    #: One line per thing the page could not show — a remote image left out, a
    #: script no font covers. Shown by the caller; never a reason to fail.
    warnings: list[str] = field(default_factory=list)
    #: For each warning, the line of the note it is about (0-based), or None.
    warning_lines: list[int | None] = field(default_factory=list)
    #: For each warning, what it is about: one of `WARNING_KINDS`.
    warning_kinds: list[str] = field(default_factory=list)
    #: For each page, the line of the note it starts at (best effort). A page
    #: inside a chapter starts at the chapter's include line.
    pages: list[int] = field(default_factory=list)
    #: The Mermaid fences drawn as source because no picture came with them, as
    #: (key, source), for the caller to draw and send back.
    diagrams: list[tuple[str, str]] = field(default_factory=list)
    #: Where each picture of the note itself landed, for the Page pane.
    pictures: list["PagePicture"] = field(default_factory=list)
    #: The internal passages in the note and its chapters: printed in the internal
    #: edition, left out of the public one.
    internal: int = 0
    #: The SHA-256 of the source this edition printed (`printed_source`).
    text_sha256: str = ""


@dataclass
class PagePicture:
    """A picture on a page, so the Page pane can size it where it stands.

    Positions are fractions of the page, so the pane needs no unit. A picture
    too tall for the room left goes to the next page and leaves a gap: ``gap``
    is then the page it left (0-based) with that stretch's top, bottom, left and
    right, and ``fit`` the width, in percent, that would have kept it there.
    """

    #: The note's line holding it (0-based), and what it shows: `media:<id>` or
    #: the address written in `![…](…)`.
    line: int
    ref: str
    page: int
    box: tuple[float, float, float, float]
    width: str = ""
    align: str = "left"
    gap: tuple[int, float, float, float, float] | None = None
    fit: int = 0

    def as_json(self) -> dict[str, Any]:
        def short(value: float) -> float:
            return round(value, 4)

        out: dict[str, Any] = {
            "line": self.line,
            "ref": self.ref,
            "page": self.page,
            "box": [short(value) for value in self.box],
            "width": self.width,
            "align": self.align,
        }
        if self.gap is not None:
            out["gap"] = [self.gap[0], *(short(value) for value in self.gap[1:])]
            out["fit"] = self.fit
        return out


#: The credit line under a picture, as the one reading of sources words it.
_Credit = notesources.Credit


def _posted_credit(url: str) -> _Credit | None:
    """The line under a picture its analyst published: `Posted: x.com/handle/status/1…`,
    linked to the post. None when it was not posted."""
    if not url:
        return None
    try:
        path = urlsplit(url).path.rstrip("/")
    except ValueError:
        path = ""
    return _Credit("Posted", f"{notesources.host(url)}{path}", url)


@dataclass
class _Picture:
    """A picture of the case, its size in pixels, and where it came from."""

    path: Path
    natural: tuple[int, int]
    credit: _Credit | None = None
    source: Source | None = None
    #: One of the three pictures every note can show: no frame, no figure number.
    built_in: bool = False


@dataclass
class _Poster:
    """A video in a note: the still its thumbnail holds, when there is one, and
    the address it can be watched at, when it or what it was made from is on the
    web."""

    path: Path | None
    natural: tuple[int, int]
    url: str
    source: Source | None = None

    @property
    def credit(self) -> _Credit | None:
        return _Credit("Watch", _host(self.url), self.url) if self.url else None


class ImageOptions(NamedTuple):
    """What a picture's braces say: its source with the braces taken out, its
    width and alignment as written, and its caption. ``aligned`` is whether an
    alignment was written at all: one that was not follows the block it is in."""

    source: str
    width: str
    align: str
    caption: str
    aligned: bool = False


@dataclass
class Run:
    """A stretch of text drawn in one face, colour and link.

    ``entry`` links it to that entry of the sources list instead of the web, and
    ``raised`` sets it small and high: the `[3]` after a citation.
    """

    text: str
    bold: bool = False
    italic: bool = False
    mono: bool = False
    color: tuple[int, int, int] = INK
    link: str = ""
    entry: int = 0
    raised: bool = False


def diagram_key(source: str) -> str:
    """Identify a Mermaid fence by its source, not by its position.

    The browser draws the diagrams and posts them back, so both sides have to
    agree on which PNG belongs to which fence. A hash survives a fence being
    moved while the export was in flight, and makes two identical diagrams in
    one note share a single upload.
    """
    return hashlib.sha256(source.strip().encode("utf-8")).hexdigest()[:16]


def mermaid_sources(
    text: str, *, resolve: Resolve | None = None, note_id: str = "", public: bool = False
) -> list[str]:
    """Every Mermaid fence in a note and the chapters it prints, in document order.

    The caller draws these; it is here rather than in the frontend so one parser
    decides what counts as a diagram. The public edition asks for none of an
    internal passage's.
    """
    return [
        token.content
        for piece in expand("", text, resolve=resolve, note_id=note_id, public=public)
        if piece.kind == "text"
        for token in _parser().parse(_case_references(piece.text))
        if token.type == "fence" and MERMAID_INFO.match(token.info or "")
    ]


def render(
    case: "Case | None",
    *,
    title: str,
    text: str,
    diagrams: dict[str, bytes] | None = None,
    look: NoteLook | None = None,
    note_id: str = "",
    resolve: Resolve | None = None,
    created: datetime | None = None,
    public: bool = False,
    identity: notefill.Identity | None = None,
    light: bool = False,
) -> Rendered:
    """Lay one note out as a PDF.

    ``case`` is None for a template's preview: references to a case then draw as
    neutral placeholders and no case file is read, and an empty section is not
    worth a warning, since a template is headings waiting for words. ``resolve``
    finds the notes a chapter line includes; without it they print as a
    placeholder too.
    ``created`` pins the document's creation date, which is otherwise now.
    ``public`` lays out the public edition: every internal passage left out.
    ``identity`` is who signs (the placeholders and the analyst's two pictures),
    read from Settings when not given.
    ``light`` sets its pictures at the page pane's size (`PREVIEWS`): the same
    pages, fewer pixels, for the pane and the check before an export, never for a
    PDF that is written.
    """
    look = look or DEFAULT_LOOK
    theme = notes_style.theme_for(look)
    day = date.fromisoformat(look.cover.date) if look.cover.date else (created or datetime.now()).date()
    identity = identity if identity is not None else notefill.Identity.from_settings()
    values = identity.values(day)
    #: Each placeholder left empty, with the first line it stands on.
    empty: dict[str, int] = {}
    passages = [0]
    cut = notefill.split_cover(text) if look.cover.own else None
    pieces = expand(title, cut.body if cut is not None else text, resolve=resolve, note_id=note_id,
                    public=public, counter=passages, values=values, empty=empty)
    cover: Piece | None = None
    if cut is not None:
        cover = _cover_piece(title, cut.text, public=public, counter=passages, values=values, empty=empty)
        if not notefill.prints_anything(cover.text):
            cover = None
    blocks = {id(piece): _alignment_blocks(piece.text) for piece in pieces if piece.kind == "text"}
    shown = [cover, *pieces] if cover is not None else pieces
    if cover is not None:
        blocks[id(cover)] = _alignment_blocks(cover.text)
    if public and any(_holds_internal(block.tokens) for parsed in blocks.values() for block in parsed):
        # cannot happen, since the text was stripped as this parser reads it; if it
        # ever did, no page is better than a page with the passage on it
        raise NotesPdfError("an internal passage could not be left out, so the public edition was not made")
    # what the document cites is read before a page is laid out: the sources list
    # numbers every citation before the first is drawn, and its words need their fonts
    cited = _Cited(case, look=look, styled=not theme.plain, identity=identity)
    cited.collect(shown, blocks)
    if look.cover.own and cover is None:
        cited.warn(notefill.EMPTY_COVER, cut.line if cut is not None else None, OTHER)
    if "name" in empty:
        cited.warn(notefill.NO_NAME, empty["name"], SETTING)
    document = NotePage(title=title, theme=theme, look=look, day=day)
    if created is not None:
        document.set_creation_date(created)
    document.band_words = {**values, "title": title}
    document.band_picture = _band_picture(identity)
    bands = [slot for band in (look.header, look.footer) for slot in (band.left, band.center, band.right) if slot]
    _warn_bands(cited, bands, identity, named="name" in empty)
    words = "\n".join([title, look.cover.subtitle, *(piece.text for piece in shown), *cited.words(),
                       *(document.band_text(slot) for slot in bands)])
    faces = pdffonts.install(document, words, body=theme.body_family, font=look.font)
    builder = _Builder(document, case, diagrams or {}, look=look, faces=faces, cited=cited, light=light)
    try:
        builder.build(title, pieces, blocks, cover=(cover, cut.line) if cover is not None and cut is not None else None)
        output = bytes(document.output())
    except pdffonts.FontError:
        raise
    except Exception as exc:  # fpdf2 raises bare errors for layout dead ends
        raise NotesPdfError(f"the note could not be laid out: {exc}") from exc
    builder.collect_warnings(words)
    return Rendered(
        pdf=output,
        warnings=builder.warnings,
        warning_lines=builder.warning_lines,
        warning_kinds=builder.warning_kinds,
        pages=builder.pages,
        diagrams=list(builder.missing.items()),
        pictures=builder.pictures,
        internal=passages[0],
        text_sha256=hashlib.sha256(printed_source(shown).encode("utf-8")).hexdigest(),
    )


def _band_picture(identity: notefill.Identity) -> Callable[[str], tuple[Path, tuple[int, int]] | None]:
    """How a header or footer slot finds the picture it names: the Azimut mark, or
    the analyst's logo from Settings, with its size; None while it is not set."""

    def find(name: str) -> tuple[Path, tuple[int, int]] | None:
        path = identity.picture(name)
        if path is None:
            return None
        natural = notefill.AZIMUT_LOGO_SIZE if name == notefill.LOGO else _measure(path)
        return (path, natural) if natural is not None else None

    return find


def _warn_bands(cited: "_Cited", slots: list[str], identity: notefill.Identity, *, named: bool) -> None:
    """What the check says of a header or footer: a logo or a name it shows that
    Settings does not hold, once however many places show it. ``named`` is whether
    the text said the name is missing already."""
    if f"azimut:{notefill.MY_LOGO}" in slots and identity.picture(notefill.MY_LOGO) is None:
        cited.once(f"picture:{notefill.MY_LOGO}", notefill.NOT_SET[notefill.MY_LOGO], None, SETTING)
    if not named and not identity.name and any("{name}" in slot for slot in slots):
        cited.warn(notefill.NO_NAME, None, SETTING)


def _cover_piece(
    title: str, text: str, *, public: bool, counter: list[int], values: dict[str, str], empty: dict[str, int]
) -> Piece:
    """The lines above a note's cover line as the page prints them: guidance out,
    internal passages counted (and out of the public edition), placeholders filled."""
    text = notefill.cover_text(without_hints(text))
    stripped, passages = strip_internal(text)
    counter[0] += passages
    if public:
        text = stripped

    def heard(key: str, line: int) -> None:
        empty.setdefault(key, line)

    return Piece("text", notefill.fill(text, {**values, "title": title}, heard), 0, 0)


# -- chapters ----------------------------------------------------------------


@dataclass
class Piece:
    """One stretch of the document: text, a chapter's title, or an aside."""

    kind: str
    text: str
    #: 0 for the note itself, 1 inside a chapter, 2 inside a chapter's chapter.
    depth: int = 0
    #: The note's line this stretch starts at. Inside a chapter, the include line.
    line: int = 0
    #: Every token maps to ``line`` (the text is another note's).
    fixed: bool = False
    #: The note this text opens, whose title a first `# Heading` may repeat.
    opens: str | None = None
    #: Which printing of a note this text belongs to: the note itself is 0, each
    #: chapter the next number, so a chapter's headings are measured together.
    source: int = 0
    #: How far its headings move to sit under their chapter's title (set when drawn).
    shift: int = 0


def expand(
    title: str,
    text: str,
    *,
    resolve: Resolve | None,
    note_id: str = "",
    public: bool = False,
    counter: list[int] | None = None,
    values: dict[str, str] | None = None,
    empty: dict[str, int] | None = None,
) -> list[Piece]:
    """The note cut at its include lines, each chapter's note spliced in.

    Guidance lines are emptied first (lines kept, so line numbers still hold), and
    for the public edition every internal passage too, in the note and in each
    chapter, before the include lines are read: a chapter written inside one is
    left out with it. ``counter[0]`` is raised by the internal passages found.
    With ``values``, each note's placeholders are filled (`notefill.fill`), its
    `{title}` its own, and ``empty`` learns each one left empty and its first line.
    """
    pieces: list[Piece] = []
    budget = [MAX_CHAPTERS]
    _expand_into(pieces, title, without_hints(text), resolve=resolve,
                 chain=(note_id,) if note_id else (), depth=0, at=None, budget=budget, source=0,
                 public=public, counter=counter if counter is not None else [0], values=values, empty=empty)
    return pieces


def printed_source(pieces: list[Piece]) -> str:
    """What a document printed, as text: each stretch of note, chapter title and
    aside in document order, one after the other. Guidance is blank in it, and in
    the public edition so is every internal passage, so each edition has its own."""
    return "\n".join(piece.text for piece in pieces)


def _expand_into(
    pieces: list[Piece],
    title: str,
    text: str,
    *,
    resolve: Resolve | None,
    chain: tuple[str, ...],
    depth: int,
    at: int | None,
    budget: list[int],
    source: int,
    public: bool = False,
    counter: list[int] | None = None,
    values: dict[str, str] | None = None,
    empty: dict[str, int] | None = None,
) -> None:
    counter = counter if counter is not None else [0]
    stripped, passages = strip_internal(text)
    counter[0] += passages
    if public:
        text = stripped
    if values is not None:
        said = empty if empty is not None else {}

        def heard(key: str, line: int) -> None:
            # a chapter's lines are another note's: it is said at its include line
            said.setdefault(key, line if at is None else at)

        text = notefill.fill(text, {**values, "title": title}, heard)
    lines = text.split("\n")
    start = 0
    fenced = False
    opens: str | None = title

    def flush(end: int) -> None:
        nonlocal opens
        segment = "\n".join(lines[start:end])
        if public:
            # cut from its chapters, a stretch can parse apart from the whole note
            segment, more = strip_internal(segment)
            counter[0] += more
        if segment.strip() or opens is not None:
            pieces.append(Piece("text", segment, depth, start if at is None else at,
                                at is not None, opens, source))
        opens = None

    for number, line in enumerate(lines):
        if FENCE.match(line):
            fenced = not fenced
            continue
        match = None if fenced else INCLUDE.match(line)
        if match is None:
            continue
        flush(number)
        start = number + 1
        where = number if at is None else at
        target = match.group(1)
        found: tuple[str, str] | None = None
        if resolve is None:
            pieces.append(Piece("aside", CASE_CHAPTER, depth, where, True))
            continue
        if target in chain:
            pieces.append(Piece("aside", "This note is already printed above, so it is not included again here.",
                                depth, where, True))
            continue
        if depth >= MAX_INCLUDE_DEPTH:
            pieces.append(Piece("aside", "Chapters go two levels deep; the note included here was left out.",
                                depth, where, True))
            continue
        if budget[0] <= 0:
            pieces.append(Piece("aside", f"A document includes at most {MAX_CHAPTERS} notes; this one was left out.",
                                depth, where, True))
            continue
        found = resolve(target)
        if found is None:
            pieces.append(Piece("aside", CHAPTER_GONE, depth, where, True))
            continue
        chapter_title, chapter_text = found
        budget[0] -= 1
        number = MAX_CHAPTERS - budget[0]
        pieces.append(Piece("chapter", chapter_title, depth + 1, where, True, None, number))
        _expand_into(pieces, chapter_title, without_hints(chapter_text), resolve=resolve,
                     chain=(*chain, target), depth=depth + 1, at=where, budget=budget, source=number,
                     public=public, counter=counter, values=values, empty=empty)
    flush(len(lines))


# -- the internal passages -----------------------------------------------------


def strip_internal(text: str) -> tuple[str, int]:
    """``text`` with every internal passage blanked, lines kept, and how many there were.

    A passage is the quote's whole extent as Markdown reads it, lazy lines and all.
    Blanking can only take text away, but it can split a list or quote around a
    passage, and what is left is read again until no passage remains, so the text
    returned holds none for either reader.
    """
    if not MAYBE_INTERNAL.search(text):
        return text, 0
    lines = text.split("\n")
    found = 0
    while True:
        spans = _merged(_internal_spans("\n".join(lines)))
        if not spans:
            return "\n".join(lines), found
        found += len(spans)
        before = list(lines)
        for first, end in spans:
            lines[first:end] = [""] * (end - first)
        if lines == before:
            # nothing left to blank; `render` refuses a public page that still holds one
            return "\n".join(lines), found


def internal_passages(text: str) -> int:
    """How many internal passages a stretch of note holds, as `strip_internal` counts them."""
    return strip_internal(text)[1]


def _internal_spans(text: str) -> list[tuple[int, int]]:
    """The lines (first, end) of each internal quote, as the whole note parses and as
    the renderer parses it around its `::: center` blocks."""
    lines = text.split("\n")
    spans = _quote_spans(_parse(text), 0, lines)
    for block in _alignment_blocks(text):
        spans.extend(_quote_spans(block.tokens, block.line, lines))
    return spans


def _quote_spans(tokens: list[Token], offset: int, lines: list[str]) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for index, token in enumerate(tokens):
        if token.type != "blockquote_open" or not token.map:
            continue
        first, end = offset + token.map[0], offset + token.map[1]
        editor = 0 <= first < len(lines) and EDITOR_INTERNAL.match(lines[first]) is not None
        if editor or _callout_kind(tokens, index) == INTERNAL:
            spans.append((first, max(end, first + 1)))
    return spans


def _merged(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Overlapping or nested spans as one: a passage inside a passage is one passage."""
    merged: list[tuple[int, int]] = []
    for first, end in sorted(spans):
        if merged and first < merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((first, end))
    return merged


def _holds_internal(tokens: list[Token]) -> bool:
    return any(
        token.type == "blockquote_open" and _callout_kind(tokens, index) == INTERNAL
        for index, token in enumerate(tokens)
    )


# -- source rewrites, mirroring lib/markdown.js ------------------------------


def _attributed_url(href: str, attributes: str) -> str:
    separator = "&" if "?" in href else "?"
    return f"{href}{separator}{ATTR_PARAM}={_quote(attributes)}"


def _quote(value: str) -> str:
    """Percent-encode the way the preview's `encodeURIComponent` does: as UTF-8, so
    a caption's dash or accent reads back as itself."""
    return quote(value, safe="-_.~")


def _sized_image(match: re.Match[str]) -> str:
    """`![alt](src){width=… align=…}` with its attributes folded into the URL."""
    alt, href, title, attributes = match.groups()
    caption = ' "%s"' % title if title else ""
    return f"![{alt}]({_attributed_url(href, attributes)}{caption})"


def _media_image(match: re.Match[str]) -> str:
    """`[[media:id|label]]{…}` as the image the renderer resolves to a file."""
    entity_id, label, attributes = match.groups()
    query = f"?{ATTR_PARAM}={_quote(attributes)}" if attributes else ""
    return f"![{label}](azimut://media/{entity_id}{query})"


def _case_references(text: str) -> str:
    """Turn Azimut's own syntax into links the Markdown parser understands."""
    source = IMAGE_ATTRS.sub(_sized_image, str(text))
    source = ENTITY_REF.sub(lambda m: f"[{m.group(2)}](azimut://entity/{m.group(1)})", source)
    return MEDIA_REF.sub(_media_image, source)


def _image_options(href: str) -> ImageOptions:
    """Split an annotated image URL back into source, width, alignment and caption."""
    parts = urlsplit(href)
    query = parse_qs(parts.query, keep_blank_values=True)
    # decoded once, by the query parser: a caption's own `%` stays what it was
    attributes = query.pop(ATTR_PARAM, [""])[0]
    rebuilt = "&".join(f"{key}={value}" for key, values in query.items() for value in values)
    source = parts._replace(query=rebuilt).geturl()
    written = CAPTION_ATTR.search(attributes)
    caption = " ".join(written.group(1).split())[:MAX_CAPTION] if written else ""
    values = dict(ATTR_VALUES.findall(CAPTION_ATTR.sub(" ", attributes)))
    width = values.get("width", "")
    if not (WIDTH_PERCENT.match(width) or WIDTH_PIXELS.match(width)):
        width = ""
    align = values.get("align", "left")
    chosen = align in ALIGNMENTS and "align" in values
    return ImageOptions(source, width, align if align in ALIGNMENTS else "left", caption, chosen)


def _parser() -> MarkdownIt:
    """CommonMark plus the two GFM rules the preview enables (marked's `gfm`)."""
    return MarkdownIt("commonmark").enable(["table", "strikethrough"])


def _parse(source: str) -> list[Token]:
    return _parser().parse(_case_references(source)) if source.strip() else []


def _alignment_blocks(text: str) -> list["_Block"]:
    """Parse a stretch of note, honouring the `::: center` blocks around parts of it.

    Each block is parsed on its own so its alignment can be pushed into everything
    it produced, which is how the preview reads it too.
    """
    blocks: list[_Block] = []
    position = 0
    for match in ALIGNMENT_BLOCK.finditer(text):
        blocks.append(_Block(Align.L, _parse(text[position : match.start()]), text.count("\n", 0, position)))
        name = match.group(1)
        blocks.append(_Block(CORNERS.get(name) or ALIGNMENTS[name], _parse(match.group(2)),
                             text.count("\n", 0, match.start(2)), corner=name if name in CORNERS else ""))
        position = match.end()
    blocks.append(_Block(Align.L, _parse(text[position:]), text.count("\n", 0, position)))
    return blocks


def _file_prefixes(case: "Case | None") -> tuple[str, ...]:
    """How the Notebook writes a case file's address: as a browser does
    (`lib/fileUrl.js`), so a case called "Port strike" is `/files/Port%20strike/…`."""
    if case is None:
        return ()
    return tuple(dict.fromkeys((f"/files/{_quote(case.id)}/", f"/files/{case.id}/")))


def _bare_urls(text: str) -> list[tuple[int, int, str]]:
    """The web addresses written bare in a stretch of prose, as (start, end, address),
    each without the punctuation that closes its sentence or its bracket."""
    found: list[tuple[int, int, str]] = []
    for match in BARE_URL.finditer(text):
        address = match.group(0)
        while address:
            if address[-1] in ".,:;!?*_~'\"":
                address = address[:-1]
            elif address[-1] == ")" and address.count("(") < address.count(")"):
                address = address[:-1]
            else:
                break
        if notesources.web(address):
            found.append((match.start(), match.start() + len(address), address))
    return found


def _local(href: str, prefixes: tuple[str, ...]) -> bool:
    """Whether a written link points somewhere a reader of the PDF cannot open: this
    machine, a private network, or a path that is no case file. A case file is a
    citation of that file, and a mail or phone link opens anywhere."""
    href = href.strip()
    if not href or any(href.startswith(prefix) for prefix in prefixes):
        return False
    try:
        parts = urlsplit(href)
        name = (parts.hostname or "").lower().rstrip(".")
    except ValueError:
        return True
    scheme = parts.scheme.lower()
    if scheme in ("http", "https"):
        if not name:
            return True
        if name in LOCAL_NAMES or name.endswith(LOCAL_SUFFIXES) or "." not in name and ":" not in name:
            return True
        try:
            address = ipaddress.ip_address(name.strip("[]"))
        except ValueError:
            return False
        return not address.is_global
    if scheme == "file":
        return True
    # a relative path or an anchor in the note: nothing a reader holds
    return not scheme and not href.startswith("//")


def _attr(token: Token, name: str) -> str:
    """One token attribute as text; the parser types them loosely."""
    value = token.attrGet(name)
    return "" if value is None else str(value)


#: Kept under its old name: the tests and the plain document's history know it so.
_Note = NotePage


# -- pictures, decoded once ----------------------------------------------------


class _DecodedImages:
    """Pictures as fpdf2 embeds them, kept between documents.

    A PNG is decoded and recompressed every time a PDF holds it, and that is most
    of what a picture-heavy note costs: twenty large screenshots took five seconds
    a render, which the page pane would pay after every pause in typing. JPEGs are
    copied as they are and cost little, so the saving is the PNGs'.

    Light on the machine: a few dozen entries and 64 MB at most, keyed by the
    file's path, size and modification time so an edited picture is read again.
    A note holding more than that keeps the pictures it reached first rather than
    evicting them for the next ones, which on a note read top to bottom over and
    over would leave nothing kept at all; only pictures the current document has
    not used make room. What is kept is the stream fpdf2 would have produced, so
    a document made from it is the same to the byte.

    A JPEG is the one picture fpdf2 copies into the PDF as it is, and a camera's
    file carries where it was taken (EXIF GPS), what edited it (XMP) and who took
    it (IPTC). A note shared as a PDF must not carry those, so a JPEG goes in
    without them (`_clean_jpeg`), and what is kept here is that clean stream. The
    other formats are decoded to pixels by fpdf2, which leaves their text behind.
    """

    MAX_ENTRIES = 40
    MAX_BYTES = 64 * 1024 * 1024
    MAX_ONE = 16 * 1024 * 1024

    def __init__(self) -> None:
        #: key → (fpdf2's image info, its ICC profile, its size, the render that last used it)
        self._kept: OrderedDict[tuple[str, int, int], list[Any]] = OrderedDict()
        self._bytes = 0
        self._render = 0
        self._lock = threading.Lock()

    def begin(self) -> int:
        """A new document starts: what it uses from here on is not evicted for it."""
        with self._lock:
            self._render += 1
            return self._render

    @staticmethod
    def _key(path: Path) -> tuple[str, int, int] | None:
        try:
            stat = path.stat()
        except OSError:
            return None
        return str(path), stat.st_mtime_ns, stat.st_size

    def place(self, pdf: FPDF, path: Path, render: int, **options: Any) -> None:
        """``pdf.image(path, …)``, from the kept decoding when there is one."""
        key = self._key(path)
        name = str(path)
        cache = pdf.image_cache
        if key is not None and name not in cache.images:
            with self._lock:
                kept = self._kept.get(key)
                if kept is not None:
                    self._kept.move_to_end(key)
                    kept[3] = render
            if kept is not None:
                info, profile = kept[0], kept[1]
                fresh = type(info)(info)
                fresh["i"] = len(cache.images) + 1
                fresh["usages"] = 0
                fresh["iccp"] = None
                fresh["iccp_i"] = None
                if profile is not None:
                    fresh["iccp_i"] = cache.icc_profiles.setdefault(profile, len(cache.icc_profiles))
                cache.images[name] = fresh
        if name not in cache.images:
            clean = _clean_jpeg_file(path)
            if clean is not None:
                # fpdf2 reads it under its own name; file it under the path, so the
                # call below and every later use of this picture find it there
                raster, _, info = preload_image(cache, BytesIO(clean))
                cache.images[name] = cache.images.pop(raster)
                info["usages"] = 0
        pdf.image(path, **options)
        if key is not None:
            self._keep(key, pdf, name, render)

    def _keep(self, key: tuple[str, int, int], pdf: FPDF, name: str, render: int) -> None:
        info = pdf.image_cache.images.get(name)
        data = None if info is None else info.get("data")
        if info is None or not isinstance(data, (bytes, bytearray)):
            return
        profile = None
        if info.get("iccp_i") is not None:
            profile = next(
                (blob for blob, index in pdf.image_cache.icc_profiles.items() if index == info["iccp_i"]),
                None,
            )
        mask = info.get("smask")
        size = len(data) + (len(mask) if isinstance(mask, (bytes, bytearray)) else 0) + len(profile or b"")
        if size > self.MAX_ONE:
            return
        with self._lock:
            if key in self._kept:
                return
            for stale in [other for other in self._kept if other[0] == key[0]]:
                self._bytes -= self._kept.pop(stale)[2]
            for older in list(self._kept):
                if len(self._kept) < self.MAX_ENTRIES and self._bytes + size <= self.MAX_BYTES:
                    break
                if self._kept[older][3] != render:
                    self._bytes -= self._kept.pop(older)[2]
            if len(self._kept) >= self.MAX_ENTRIES or self._bytes + size > self.MAX_BYTES:
                return
            self._kept[key] = [type(info)(info), profile, size, render]
            self._bytes += size

    @property
    def held(self) -> tuple[int, int]:
        """How many pictures are kept, and how many bytes they hold."""
        with self._lock:
            return len(self._kept), self._bytes

    def clear(self) -> None:
        with self._lock:
            self._kept.clear()
            self._bytes = 0


DECODED = _DecodedImages()


# -- pictures, made light for the page pane ----------------------------------

#: The most pixels across a page the page pane ever draws: 900 CSS pixels at twice
#: the screen's density. A picture is given what its place on the page can show,
#: in two steps (`PREVIEW_SIDES`); the PDF written keeps every pixel.
PANE_PIXELS = 1800
PREVIEW_SIDES = (800, 1600)


class _PreviewImages:
    """Pictures at the page pane's size, kept between documents.

    The pane asks for the whole PDF after every pause in typing. A note of sixty
    phone photos made a 53 MB document, laid out in 2.6 seconds, sent whole and
    decoded again by the browser for every page drawn. At the pane's size the same
    note is a few megabytes. Only the pane's PDF and the check before an export are
    made so: the layout is the same, since a picture is placed by the size of the
    file itself, and only its pixels are fewer.

    Light on the machine: a few hundred entries and 96 MB at most, keyed by the
    file's path, size and modification time. A picture already small enough, one
    with no colours a JPEG can carry (CMYK) or one Pillow cannot read is not kept,
    and the document takes the file itself.
    """

    MAX_ENTRIES = 400
    MAX_BYTES = 96 * 1024 * 1024

    def __init__(self) -> None:
        self._kept: OrderedDict[tuple[str, int, int, int], bytes | None] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    def get(self, path: Path, side: int = PREVIEW_SIDES[-1]) -> bytes | None:
        """The picture made light, at most ``side`` pixels on its longest side, or
        None when the file itself should be used."""
        found = _DecodedImages._key(path)
        if found is None:
            return None
        key = (*found, side)
        with self._lock:
            if key in self._kept:
                self._kept.move_to_end(key)
                return self._kept[key]
        light = _light_picture(path, side)
        with self._lock:
            for stale in [other for other in self._kept if other[0] == key[0] and other != key]:
                self._bytes -= len(self._kept.pop(stale) or b"")
            if key not in self._kept:
                self._kept[key] = light
                self._bytes += len(light or b"")
            while len(self._kept) > self.MAX_ENTRIES or self._bytes > self.MAX_BYTES:
                self._bytes -= len(self._kept.popitem(last=False)[1] or b"")
        return light

    def clear(self) -> None:
        with self._lock:
            self._kept.clear()
            self._bytes = 0


def _light_picture(path: Path, side: int) -> bytes | None:
    """A picture as the page pane needs it: at most ``side`` pixels on its longest
    side, drawn upright, and a JPEG unless it shows through somewhere, since a JPEG
    goes into a PDF as it is while a PNG is decoded and packed again every time.
    None when the file itself is as light already, or cannot be made lighter."""
    try:
        with PILImage.open(path) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS or image.mode == "CMYK":
                return None
            big = max(image.size) > side
            if image.format == "JPEG":
                if not big and _orientation(image) in (0, 1):
                    return None
                # decodes at a half, a quarter or an eighth at once, never below the size wanted
                image.draft(image.mode, (side, side))
            profile = image.info.get("icc_profile")
            upright = ImageOps.exif_transpose(image)
            clear = _shows_through(upright)
            if clear and not big:
                return None
            upright = upright.convert("RGBA" if clear else ("L" if upright.mode in ("L", "LA", "1") else "RGB"))
            upright.thumbnail((side, side), PILImage.Resampling.BICUBIC, reducing_gap=2.0)
            upright.info = {}
            buffer = BytesIO()
            extra = {"icc_profile": profile} if profile else {}
            if clear:
                upright.save(buffer, "PNG", compress_level=3, **extra)
            else:
                upright.save(buffer, "JPEG", quality=85, **extra)
            return buffer.getvalue()
    except (OSError, ValueError, UnidentifiedImageError, PILImage.DecompressionBombError):
        return None


def _shows_through(image: PILImage.Image) -> bool:
    """Whether some pixel of ``image`` is not fully opaque. A screenshot often comes
    with an alpha channel it never uses."""
    if image.mode in ("RGBA", "LA", "PA"):
        lowest = image.getchannel("A").getextrema()[0]
        return isinstance(lowest, (int, float)) and lowest < 255
    return image.mode == "P" and "transparency" in image.info


PREVIEWS = _PreviewImages()


# -- Markdown to a page ------------------------------------------------------


@dataclass
class _Block:
    """One parsed stretch of a piece, with its alignment and first line."""

    align: Align
    tokens: list[Token]
    line: int
    start: int = 0
    #: The corner of the own cover it is pinned to (`CORNERS`), or "".
    corner: str = ""


@dataclass
class _Entry:
    """A journal entry being drawn: its column's indent, its rule, and how far
    down its gutter text runs on the page it began on."""

    indent: float
    box: notes_style.Box
    bottom: float
    page: int


class _Cited:
    """What a document cites, read once before it is drawn.

    The sources list numbers every citation before the first one is drawn, and its
    words need their fonts before the first page is laid out. The checks before
    export read the same pass, each with the note's line it is about: a record or an
    included note no longer in the case, a picture nothing says the source of (while
    the sources are listed), a link a reader cannot open, and the tasks a styled
    document still has open. The walk asks this pass, never a reading of its own,
    which item a citation is, so the numbers and the list cannot disagree.

    Without a case (a template's preview) nothing of a case is read and nothing is
    warned about; a web link is still a source. The three pictures every note can
    show are never sources, and one that Settings does not hold is said either way.
    """

    def __init__(
        self,
        case: "Case | None",
        *,
        look: NoteLook,
        styled: bool = False,
        identity: notefill.Identity | None = None,
    ) -> None:
        self.case = case
        self.look = look
        #: Who signs, and where their pictures are: read once for the whole document.
        self.identity = identity if identity is not None else notefill.Identity()
        self.reader = notesources.Reader(case)
        self.on = look.sources_on
        self.styled = styled
        self.annex: Annex | None = None
        #: (message, line, kind), in the order they were found.
        self.warnings: list[tuple[str, int | None, str]] = []
        self._prefixes = _file_prefixes(case)
        self._cited: list[Source] = []
        self._warned: set[str] = set()
        self._local: dict[str, int | None] = {}
        self._tasks: list[int] = []
        self._images: dict[str, Source | None] = {}

    # -- what a citation is, for the pass and the walk alike -------------------

    def number(self, source: Source | None) -> int:
        """The entry a citation of ``source`` links to, or 0 with no list or no entry."""
        return self.annex.number(source) if self.annex is not None else 0

    def link_source(self, href: str, words: str = "") -> Source | None:
        """What a written link cites: a record that says where it comes from, a web
        page a reader can open, or a file of the case; None for anything else."""
        entity = ENTITY_HREF.match(href)
        if entity:
            source = self.reader.entity(entity.group(1)) if self.case is not None else None
            return source if source is not None and source.citable else None
        if notesources.web(href):
            return None if _local(href, ()) else self.reader.link(href, words)
        relative = self._case_file(href)
        return self.reader.file(relative) if relative and self._exists(relative) else None

    def image_source(self, src: str) -> Source | None:
        """The item of the case a picture shows, or None when it shows none (or one
        no longer there, which the walk says where the picture was)."""
        if src in self._images:
            return self._images[src]
        found: Source | None = None
        written = _image_options(src).source
        parts = urlsplit(written)
        if self.case is not None and parts.scheme == "azimut" and parts.netloc == "media":
            found = self.reader.entity(unquote(parts.path.lstrip("/")))
            found = found if found is not None and found.path else None
        elif self.case is not None:
            relative = self._case_file(written)
            found = self.reader.file(relative) if relative and self._exists(relative) else None
        self._images[src] = found
        return found

    def _case_file(self, href: str) -> str:
        prefix = next((one for one in self._prefixes if href.startswith(one)), "")
        return unquote(href[len(prefix):]) if prefix else ""

    def _exists(self, relative: str) -> bool:
        if self.case is None:
            return False
        try:
            return bool(self.case.resolve_inside(relative).is_file())
        except Exception:
            return False

    # -- the pass ---------------------------------------------------------------

    def collect(self, pieces: list[Piece], blocks: dict[int, list["_Block"]]) -> None:
        """Read every citation in document order, chapters included, then number them."""
        cover = self.look.cover
        if cover.on and not cover.own and cover.image and self.case is not None:
            shown = self.reader.entity(cover.image)
            if shown is not None and shown.path and shown.noun != "Video":
                self._cited.append(shown)
        for piece in pieces:
            if piece.kind == "aside" and piece.text == CHAPTER_GONE and self.case is not None:
                self._warn("An included note is no longer in the case.", piece.line, MISSING)
            if piece.kind != "text":
                continue
            for position, block in enumerate(blocks[id(piece)]):
                tokens = block.tokens
                start = _skip_repeated_title(tokens, piece.opens) if position == 0 and piece.opens is not None else 0
                base = piece.line + (0 if piece.fixed else block.line)
                line = base
                for index in range(start, len(tokens)):
                    token = tokens[index]
                    if token.map and not piece.fixed:
                        line = base + token.map[0]
                    if token.type == "list_item_open" and self.styled and _task_state(tokens, index) is False:
                        self._tasks.append(line)
                    elif token.type == "inline":
                        self._inline(token, line, piece.fixed)
        self._finish()

    def _inline(self, token: Token, line: int, fixed: bool) -> None:
        at = line
        href: str | None = None
        words: list[str] = []
        opened = at
        for child in token.children or []:
            kind = child.type
            if kind in ("softbreak", "hardbreak"):
                at += 0 if fixed else 1
                words.append(" ")
            elif kind == "link_open":
                href, words, opened = _attr(child, "href"), [], at
            elif kind == "link_close":
                if href is not None:
                    self._link(href, "".join(words), opened)
                href = None
            elif kind == "image":
                self._image(child, at)
            elif kind in ("text", "code_inline") and href is not None:
                words.append(child.content)
            elif kind == "text":
                self._prose(child.content, at)

    def _link(self, href: str, words: str, line: int) -> None:
        entity = ENTITY_HREF.match(href)
        if entity:
            if self.case is None:
                return
            source = self.reader.entity(entity.group(1))
            if source is None:
                name = _cut_text(" ".join(words.split()) or entity.group(1), 80)
                self._once(f"record:{entity.group(1)}", f'The record "{name}" is no longer in the case.',
                           line, MISSING)
            elif source.citable:
                self._cited.append(source)
            return
        if _local(href, self._prefixes):
            self._local.setdefault(href, line)
            return
        source = self.link_source(href, words)
        if source is not None:
            self._cited.append(source)

    def _image(self, token: Token, line: int) -> None:
        src = _attr(token, "src")
        name = notefill.picture_name(_image_options(src).source)
        if name is not None:
            if self.identity.picture(name) is None:
                self._once(f"picture:{name}", notefill.NOT_SET[name], line, SETTING)
            return
        source = self.image_source(src)
        if source is None:
            return
        self._cited.append(source)
        if self.on and self.case is not None and not source.sourced:
            name = _cut_text(" ".join((token.content or source.label).split()) or "Untitled", 80)
            noun = "Video" if source.noun == "Video" else "Picture"
            self._once(f"unsourced:{source.key}", f'{noun} "{name}" has no source.', line, UNSOURCED)

    def _prose(self, text: str, line: int) -> None:
        for _, _, address in _bare_urls(text):
            if _local(address, ()):
                self._local.setdefault(address, line)
            else:
                self._cited.append(self.reader.link(address))
        for match in FILE_URL.finditer(text):
            self._local.setdefault(match.group(0), line)

    def _finish(self) -> None:
        if self.case is not None:
            if self._tasks:
                count = len(self._tasks)
                self._warn(f"{count} task{'s are' if count > 1 else ' is'} still open.", self._tasks[0], OPEN_TASK)
            for href, line in list(self._local.items())[:MAX_LOCAL_LINKS]:
                self._warn(f'The link "{_cut_text(href, 80)}" will not open for a reader.', line, LOCAL_LINK)
            rest = len(self._local) - MAX_LOCAL_LINKS
            if rest > 0:
                self._warn(f"{rest} more link{'s' if rest > 1 else ''} will not open for a reader.", None, LOCAL_LINK)
        if self.on:
            self.annex = Annex(self._cited)
            if self.annex.left_out:
                self._warn(f"The sources list stops at {self.annex.limit}; "
                           f"{self.annex.left_out} more are not listed.", None, OTHER)

    def _warn(self, message: str, line: int | None, kind: str) -> None:
        self.warnings.append((message, line, kind))

    def warn(self, message: str, line: int | None, kind: str) -> None:
        """Say one more thing the check before export should, from outside the pass."""
        self._warn(message, line, kind)

    def once(self, key: str, message: str, line: int | None, kind: str) -> None:
        """`warn`, unless something said it under ``key`` already."""
        self._once(key, message, line, kind)

    def _once(self, key: str, message: str, line: int | None, kind: str) -> None:
        if key not in self._warned:
            self._warned.add(key)
            self._warn(message, line, kind)

    def words(self) -> list[str]:
        """What the sources list prints, for the fonts to cover."""
        if self.annex is None:
            return []
        said: list[str] = []
        for entry in self.annex.entries:
            source = entry.source
            said.extend((source.label, *notesources.details(source), source.address, source.archive))
        return said


class _Builder:
    """Walks the parsed note and draws it.

    Kept as an object because the walk collects what the caller needs — the
    warnings, and the running count of images a note is allowed to embed.
    """

    def __init__(
        self,
        pdf: NotePage,
        case: "Case | None",
        diagrams: dict[str, bytes],
        *,
        look: NoteLook | None = None,
        faces: set[tuple[str, str]] | None = None,
        cited: _Cited | None = None,
        light: bool = False,
    ) -> None:
        self.pdf = pdf
        self.case = case
        #: Pictures at the page pane's size (`PREVIEWS`) rather than every pixel.
        self.light = light
        self.diagrams = diagrams
        self.look = look or DEFAULT_LOOK
        self.theme: Theme = getattr(pdf, "theme", PLAIN)
        #: What the document cites and how each item reads as a source.
        self.cited = cited if cited is not None else _Cited(case, look=self.look, styled=not self.theme.plain)
        #: The internal link to each entry of the sources list, made when first used.
        self._entry_links: dict[int, int] = {}
        #: The (family, style) pairs this document loaded, so emphasis it lacks borrows.
        self.faces = faces if faces is not None else set(pdffonts.CORE_FACES)
        self.warnings: list[str] = []
        self.warning_lines: list[int | None] = []
        self.warning_kinds: list[str] = []
        #: The line of the first remote image left out, which its warning points at.
        self._remote_line: int | None = None
        self.images = 0
        self.pictures: list[PagePicture] = []
        self._page_lines: dict[int, int] = {}
        self.missing: dict[str, str] = {}
        #: How deep inside nested lists the walk currently is.
        self._depth = 0
        self._remote = 0
        self._file_prefixes = _file_prefixes(case)
        # the paragraph defaults, which a promoted verdict enlarges for a moment
        self._size = self.theme.body_size
        self._leading = self.theme.leading
        self._family = self.theme.body_family
        # where in the note the walk is, for the page map
        self._line = 0
        self._block_line = 0
        self._fixed = False
        # headings: how far a chapter pushes them down, and their numbering
        self._shift = 0
        self._base = 1
        self._counters = [0] * NUMBERED_LEVELS
        self._figures = 0
        self._outlined = not self.theme.plain or self.look.toc
        #: The brief's verdict: the quote lifted to the top, and the tokens it is in.
        self._promoted: Token | None = None
        self._promoted_in: list[Token] = []
        self._entry: _Entry | None = None
        #: Where the journal's timeline stopped, so the next entry that day joins it.
        self._rule_end: tuple[int, float] | None = None
        self._last_day = ""
        self._log_count = 0
        self._log_days: set[date] = set()
        self._chapters = 0
        self._contents_entries = 0
        self._opening = (0, 0.0)
        #: The chapter the stretch being drawn runs into, and the page a heading
        #: leading into a chapter that opens a page of its own was set on.
        self._lead: Piece | None = None
        self._led_page: int | None = None
        #: Whether a cover carries the title (the style's, or the note's own once drawn),
        #: and whether the walk is drawing the note's own cover right now.
        self._covered = self.look.cover.on and not self.look.cover.own
        self._on_cover = False
        #: The page's frame while a corner of the cover is drawn in half of it.
        self._page_frame: float | None = None
        pdf.on_page = self._page_begins
        self._render = DECODED.begin()
        pdf.place_picture = lambda source, **options: self._picture(source, **options)

    # -- entry point --------------------------------------------------------

    def build(
        self,
        title: str,
        pieces: list[Piece],
        blocks: dict[int, list[_Block]] | None = None,
        *,
        cover: tuple[Piece, int] | None = None,
    ) -> None:
        """Draw the document. ``cover`` is the note's own first page, when its look
        asks for one and its text has one, with the line that ends it."""
        theme, look, pdf = self.theme, self.look, self.pdf
        if blocks is None:
            blocks = {id(piece): _alignment_blocks(piece.text) for piece in pieces if piece.kind == "text"}
        self._prescan(pieces, blocks)
        if self.case is not None:
            self._empty_sections(pieces, blocks)
        for message, line, kind in self.cited.warnings:
            self._warn(message, line, kind)
        if look.cover.own:
            if cover is not None:
                piece, end = cover
                self._own_cover(piece, blocks.get(id(piece)) or _alignment_blocks(piece.text), end)
        elif look.cover.on:
            unseen = self.case is None and bool(look.cover.image)
            pdf.cover(image=self._cover_image(), placeholder=CASE_PICTURE if unseen else "")
        if theme.style == "brief":
            pdf.band_page = pdf.page + 1
        pdf.add_page()
        self._title_block(title)
        if look.toc:
            self._contents()
        #: Where the body begins: a first chapter here needs no page of its own.
        self._opening = (pdf.page, pdf.get_y())
        drawn = False
        for position, piece in enumerate(pieces):
            if piece.kind == "chapter":
                self._end_entry()
                self._chapter(piece)
                drawn = True
                continue
            if piece.kind == "aside":
                self._end_entry()
                self._line = piece.line
                self._aside(piece.text)
                drawn = True
                continue
            self._shift = piece.shift
            self._fixed = piece.fixed
            following = pieces[position + 1] if position + 1 < len(pieces) else None
            parsed = blocks[id(piece)]
            # a heading closing the stretch before a chapter is kept with that chapter
            last = max((index for index, block in enumerate(parsed) if block.tokens), default=-1)
            for index, block in enumerate(parsed):
                self._block_line = piece.line + (0 if piece.fixed else block.line)
                self._lead = following if index == last and following is not None and following.kind == "chapter" else None
                drawn = self._walk(block.tokens, block.start, block.align, stop=None)[0] or drawn
            self._lead = None
            self._end_entry()
        if not drawn:
            self._aside("This note is empty.")
        self._sources()

    def _page_begins(self) -> None:
        self._page_lines[self.pdf.page] = self._line

    # -- the note's own cover ----------------------------------------------------

    def _own_cover(self, piece: Piece, parsed: list[_Block], end: int) -> None:
        """The lines above the note's cover line, alone on the first page: no running
        header, footer or page number, the TLP label still on it, and the whole
        centred down the page unless the look starts it at the top.

        A `::: top-right` block (or any corner of `CORNERS`) is pinned to that corner,
        within half the page's width, and the rest is centred in the room the corners
        leave between them. Drawn from the top, then moved down as one: the page's
        drawing is shifted in the PDF itself, with its links and pictures, so nothing
        is laid out twice. A cover too long for one page runs on, as bare, and is not
        moved.
        """
        pdf, theme = self.pdf, self.theme
        self._line = piece.line
        pdf.covering = True
        pdf.add_page()
        page = pdf.page
        flow = [block for block in parsed if not block.corner]
        corners = [block for block in parsed if block.corner]
        self._on_cover = True
        self._shift, self._fixed = 0, False
        try:
            # the corners first, each where it stands, so the flow knows the room left
            reach = {"top": 0.0, "bottom": 0.0}
            for block in corners:
                height = self._corner(piece, block, page)
                side = block.corner.split("-")[0]
                reach[side] = max(reach[side], height)
            region_top = pdf.t_margin + (reach["top"] + theme.gap if reach["top"] else 0.0)
            region_bottom = pdf.h - pdf.b_margin - (reach["bottom"] + theme.gap if reach["bottom"] else 0.0)
            pdf.set_xy(pdf.l_margin, region_top)
            contents = pdf.pages[page].contents
            assert isinstance(contents, bytearray)
            start = len(contents)
            links = len(pdf.pages[page].annots or [])
            pictures = len(self.pictures)
            for block in flow:
                self._block_line = piece.line + block.line
                self._walk(block.tokens, block.start, block.align, stop=None)
            self._end_entry()
        finally:
            self._on_cover = False
            pdf.covering = False
        self._covered = True
        # the body's first page starts at the line after the cover's
        self._line = end + 1
        if pdf.page != page:
            self._warn("Your own cover page runs over one page.", end, OTHER)
            return
        if self.look.cover.top:
            return
        used = max(0.0, pdf.get_y() - region_top - theme.gap)
        self._move_down(page, start, links, pictures, (region_bottom - region_top - used) / 2)

    def _corner(self, piece: Piece, block: _Block, page: int) -> float:
        """Draw corner block ``block`` of the own cover in its corner of page ``page``,
        and say how tall it is. A bottom corner is drawn at the top, then moved down."""
        pdf, theme = self.pdf, self.theme
        frame = pdf.w - 2 * theme.margin_side
        width = frame * CORNER_SHARE
        right = block.corner.endswith("right")
        inner = (frame - width, 0.0) if right else (0.0, frame - width)
        contents = pdf.pages[page].contents
        assert isinstance(contents, bytearray)
        start = len(contents)
        links = len(pdf.pages[page].annots or [])
        pictures = len(self.pictures)
        top = pdf.t_margin
        pdf.set_xy(pdf.l_margin, top)
        self._block_line = piece.line + block.line
        self._page_frame = self._frame()
        try:
            with self._inset(*inner):
                pdf.set_x(pdf.l_margin)
                self._walk(block.tokens, block.start, block.align, stop=None)
                self._end_entry()
        finally:
            self._page_frame = None
        if pdf.page != page:
            self._warn("A corner of your own cover page runs over its page.", piece.line + block.line, OTHER)
            return 0.0
        height = max(0.0, pdf.get_y() - top - theme.gap)
        if block.corner.startswith("bottom"):
            self._move_down(page, start, links, pictures, pdf.h - pdf.b_margin - top - height)
        return height

    def _move_down(self, page: int, start: int, links: int, pictures: int, drop: float) -> None:
        """Move what page ``page`` drew since content offset ``start`` down by ``drop``
        millimetres: its drawing, and the links and pictures it placed."""
        pdf = self.pdf
        if drop < 0.1:
            return
        contents = pdf.pages[page].contents
        assert isinstance(contents, bytearray)
        offset = drop * pdf.k
        contents[start:start] = f"1 0 0 1 0 {-offset:.2f} cm\n".encode("ascii")
        contents.extend(f"1 0 0 1 0 {offset:.2f} cm\n".encode("ascii"))
        for annotation in list(pdf.pages[page].annots or [])[links:]:
            x1, y1, x2, y2 = (float(value) for value in str(annotation.rect).strip("[]").split())
            annotation.rect = f"[{x1:.2f} {y1 - offset:.2f} {x2:.2f} {y2 - offset:.2f}]"
        for picture in self.pictures[pictures:]:
            if picture.page == page - 1:
                left, top, width, height = picture.box
                picture.box = (left, top + drop / pdf.h, width, height)

    def _cover_heading(self, runs: list[Run], tag: str, align: Align) -> None:
        """A heading on the note's own cover: set large, as a cover sets a title, and
        never numbered, bookmarked or listed in the contents."""
        pdf, theme = self.pdf, self.theme
        size, leading = COVER_HEADINGS.get(tag, (theme.headings.get(tag, theme.headings["h6"])[0], 0.0))
        leading = leading or size * 0.48
        if pdf.get_y() > pdf.t_margin + 0.5:
            pdf.ln(leading * 0.4)
        self._runs(runs, align=align, size=size, leading=leading, family=theme.heading_family, bold=True,
                   color=theme.ink, bottom=leading * 0.35)

    # -- the sources list ------------------------------------------------------

    def _listed(self) -> bool:
        annex = self.cited.annex
        return annex is not None and bool(annex.entries)

    def _sources(self) -> None:
        """The numbered sources at the end: an unnumbered top heading, in the
        contents and the bookmarks when those are on, then one entry per source.
        A report starts it on a page of its own. Nothing at all when the note
        cites nothing."""
        annex = self.cited.annex
        if annex is None or not annex.entries:
            return
        self._end_entry()
        pdf = self.pdf
        self._shift = 0
        if self.theme.style == "report" and pdf.get_y() > pdf.body_top + 0.5:
            pdf.add_page()
        self._heading([Run(SOURCES_HEADING)], self._base, [], 0, Align.L, numbered=False)
        pdf.set_font(self.theme.heading_family, "B", ENTRY_SIZE * self.theme.scale)
        hang = max(7.0, pdf.get_string_width(f"[{len(annex.entries)}]") + 2.4)
        for entry in annex.entries:
            self._source_entry(entry, hang)

    def _source_entry(self, entry: Entry, hang: float) -> None:
        """One source: its number in the margin it hangs from, what it is, and under
        it each address in full, wrapped where it has to be and never cut, since a
        reader may have to type it, then the file's fingerprint."""
        pdf, theme = self.pdf, self.theme
        source = entry.source
        scale = theme.scale
        size, leading = ENTRY_SIZE * scale, ENTRY_LEADING * scale
        small, small_leading = ENTRY_SMALL * scale, ENTRY_SMALL_LEADING * scale
        head = self._entry_head(entry)
        addresses = [("", one) for one in (source.address,) if one]
        if source.archive and source.archive != source.address:
            addresses.append(("Archive: ", source.archive))
        if source.posted and source.posted not in (source.address, source.archive):
            addresses.append(("Posted: ", source.posted))
        width = pdf.epw - hang - 2 * pdf.c_margin
        # measured first, so an entry that fits on a page is never split over two
        pdf.set_font(theme.heading_family, "", size)
        height = leading * len(_wrap_words(pdf, _plain(head), width, width))
        pdf.set_font(theme.heading_family, "", small)
        for prefix, address in addresses:
            first = width - pdf.get_string_width(prefix)
            height += small_leading * len(_wrap_address(pdf, address, first, width))
        if source.sha256:
            height += small_leading
        if pdf.will_page_break(min(height, pdf.page_break_trigger - pdf.t_margin - 1)):
            pdf.add_page()
        top = pdf.get_y()
        pdf.set_link(self._entry_link(entry.number), y=top, page=pdf.page)
        pdf.set_font(theme.heading_family, "B", size)
        pdf.set_text_color(*theme.accent)
        # set where the text of the page starts, a cell's margin in from its edge
        self._text_at(pdf.l_margin + pdf.c_margin, top, f"[{entry.number}]", leading)
        pdf.set_xy(pdf.l_margin, top)
        with self._indent(hang):
            self._runs(head, size=size, leading=leading, family=theme.heading_family, bottom=0.2)
            for prefix, address in addresses:
                self._address(prefix, address, small, small_leading)
            if source.sha256:
                self._fingerprint(source.sha256, small, small_leading)
        pdf.ln(ENTRY_GAP * scale)

    def _entry_head(self, entry: Entry) -> list[Run]:
        """`Strike on the port · Video · x.com · by Port Watch · posted 12 March 2026`,
        then `from [1]` linked to the entries it was made from."""
        theme = self.theme
        source = entry.source
        said = notesources.details(source)
        runs = [Run(source.label or source.host or "Untitled", bold=True, color=theme.ink)]
        if said:
            runs.append(Run(" · " + " · ".join(said), color=theme.muted))
        if entry.origins:
            runs.append(Run(" · from ", color=theme.muted))
            for position, number in enumerate(entry.origins):
                if position:
                    runs.append(Run(", ", color=theme.muted))
                runs.append(Run(f"[{number}]", color=theme.accent, entry=number))
        return runs

    def _address(self, prefix: str, address: str, size: float, leading: float) -> None:
        """An address in full, linked on every line it wraps over."""
        pdf, theme = self.pdf, self.theme
        pdf.set_font(theme.heading_family, "", size)
        lead = pdf.get_string_width(prefix) if prefix else 0.0
        width = pdf.epw - 2 * pdf.c_margin
        for number, line in enumerate(_wrap_address(pdf, address, width - lead, width)):
            if pdf.will_page_break(leading):
                pdf.add_page()
            y = pdf.get_y()
            x = pdf.l_margin + pdf.c_margin
            if number == 0 and prefix:
                pdf.set_text_color(*theme.muted)
                self._text_at(x, y, prefix, leading)
                x += lead
            pdf.set_text_color(*theme.accent_dark)
            self._text_at(x, y, line, leading, link=address)
            pdf.set_xy(pdf.l_margin, y + leading)

    def _fingerprint(self, sha256: str, size: float, leading: float) -> None:
        """`SHA-256` and the file's whole fingerprint, in the mono face."""
        pdf, theme = self.pdf, self.theme
        if pdf.will_page_break(leading):
            pdf.add_page()
        y = pdf.get_y()
        pdf.set_font(theme.heading_family, "", size)
        pdf.set_text_color(*theme.muted)
        label = "SHA-256 "
        self._text_at(pdf.l_margin + pdf.c_margin, y, label, leading)
        x = pdf.l_margin + pdf.c_margin + pdf.get_string_width(label)
        pdf.set_font(pdffonts.MONO, "", size * 0.92)
        width = pdf.l_margin + pdf.epw - pdf.c_margin - x
        for line in _wrap_address(pdf, sha256, width, width):
            if pdf.will_page_break(leading):
                pdf.add_page()
                y = pdf.get_y()
            self._text_at(x, y, line, leading)
            y += leading
        pdf.set_xy(pdf.l_margin, y)

    @property
    def pages(self) -> list[int]:
        """The line each page starts at, page by page."""
        count = self.pdf.pages_count
        return [self._page_lines.get(number, 0) for number in range(1, count + 1)]

    def _contents(self) -> None:
        """Reserve the contents where the walk stands, sized from the prescan, and
        let fpdf2 draw them once every section's page is known."""
        pdf = self.pdf
        first = pdf.page
        room = pdf.h - pdf.b_margin - 6
        per_entry = 8.8
        here = max(0, int((room - pdf.get_y() - 22) / per_entry))
        per_page = max(1, int((room - pdf.t_margin - 22) / per_entry))
        pages = 1 + max(0, -(-(self._contents_entries - here) // per_page))
        pdf.insert_toc_placeholder(
            lambda document, outline: pdf.contents_page(outline, first_page=first, pages=pages),
            pages=pages,
        )

    def _prescan(self, pieces: list[Piece], blocks: dict[int, list[_Block]]) -> None:
        """Read the whole document once before drawing: which heading level the
        numbering starts at, how many lines the contents need, and the verdict a
        brief lifts to the top."""
        # A chapter's headings move under its title: the note's own top level lands
        # one below the chapter, whichever level the note started its headings at.
        tops: dict[int, int] = {}
        for piece in pieces:
            if piece.kind != "text":
                continue
            for position, block in enumerate(blocks[id(piece)]):
                if position == 0 and piece.opens is not None:
                    block.start = _skip_repeated_title(block.tokens, piece.opens)
                for token in block.tokens[block.start:]:
                    if token.type == "heading_open":
                        tops[piece.source] = min(tops.get(piece.source, 6), int(token.tag[1]))
        for piece in pieces:
            if piece.kind == "text" and piece.depth:
                piece.shift = piece.depth + 1 - tops.get(piece.source, piece.depth + 1)
        levels: list[int] = []
        for piece in pieces:
            if piece.kind == "chapter":
                levels.append(piece.depth)
                continue
            if piece.kind != "text":
                continue
            for block in blocks[id(piece)]:
                for index in range(block.start, len(block.tokens)):
                    token = block.tokens[index]
                    if token.type == "heading_open":
                        levels.append(_level(token.tag, piece.shift))
                        if self.theme.style == "journal" and token.tag == "h3":
                            self._count_entry(block.tokens[index + 1].content.strip())
                    elif (
                        token.type == "blockquote_open"
                        and self.theme.style == "brief"
                        and self._promoted is None
                        and piece.depth == 0
                        and _callout_kind(block.tokens, index) in notes_style.VERDICTS
                    ):
                        self._promoted = token
                        self._promoted_in = block.tokens
        self._base = min(levels) if levels else 1
        self._contents_entries = sum(1 for level in levels if level - self._base <= 1)
        if self._listed():
            self._contents_entries += 1  # the sources list's own heading

    def _count_entry(self, heading: str) -> None:
        stamp = LOG_STAMP.match(heading)
        if stamp is None:
            return
        self._log_count += 1
        try:
            self._log_days.add(date(*(int(part) for part in stamp.groups()[:3])))
        except ValueError:
            pass

    def _empty_sections(self, pieces: list[Piece], blocks: dict[int, list[_Block]]) -> None:
        """Warn about each heading with nothing under it before the next heading of
        its rank: a report sent with "Method" and no method is the slip to catch.

        A heading that only holds deeper headings is not named, since those are,
        and a journal's dated entry is an entry rather than a heading waiting for
        words. Guidance and comments print nothing, so a section holding only
        those is empty too.
        """
        # open headings, outermost first: (level, name, line, has a deeper heading)
        open_: list[list[Any]] = []
        empty: list[tuple[str, int]] = []

        def heading(level: int, name: str, line: int) -> None:
            while open_ and open_[-1][0] >= level:
                closed = open_.pop()
                if not closed[3]:
                    empty.append((closed[1], closed[2]))
            for outer in open_:
                outer[3] = True
            open_.append([level, name, line, False])

        def content() -> None:
            open_.clear()

        for piece in pieces:
            if piece.kind == "chapter":
                # the heading above an include holds that chapter
                content()
                heading(piece.depth, " ".join(piece.text.split()), piece.line)
                continue
            if piece.kind != "text":
                content()
                continue
            for block in blocks[id(piece)]:
                base = piece.line + (0 if piece.fixed else block.line)
                for index in range(block.start, len(block.tokens)):
                    token = block.tokens[index]
                    if token.level != 0 or token.type.endswith("_close") or token.type == "inline":
                        continue
                    if token.type == "heading_open":
                        name = " ".join(_inline_text(block.tokens[index + 1]).split())
                        if self.theme.style == "journal" and token.tag == "h3" and LOG_STAMP.match(name):
                            content()
                            continue
                        line = piece.line if piece.fixed else base + (token.map[0] if token.map else 0)
                        heading(_level(token.tag, piece.shift), name, line)
                    elif _prints(block.tokens, index):
                        content()
        heading(0, "", 0)
        for name, line in empty[:MAX_EMPTY_SECTIONS]:
            self._warn(f'Section "{_cut_text(name, 80)}" is empty.', line, EMPTY_SECTION)
        rest = len(empty) - MAX_EMPTY_SECTIONS
        if rest > 0:
            self._warn(f"{rest} more section{'s are' if rest > 1 else ' is'} empty.", None, EMPTY_SECTION)

    def _warn(self, message: str, line: int | None = None, kind: str = OTHER) -> None:
        """Say what the page could not show, the note's line it is about, and what
        kind of thing it is."""
        self.warnings.append(message)
        self.warning_lines.append(line)
        self.warning_kinds.append(kind)

    # -- the first page -----------------------------------------------------

    def _title_block(self, title: str) -> None:
        style = self.theme.style
        if self._covered and style != "brief":
            return  # the cover carries the title
        if style == "plain":
            self._plain_title(title)
        elif style == "report":
            self._report_title(title)
        elif style == "journal":
            self._journal_title(title)
        if self._promoted is not None:
            self._verdict()

    def _plain_title(self, title: str) -> None:
        pdf = self.pdf
        theme = self.theme
        pdf.set_font(theme.heading_family, "B", 7.5)
        pdf.set_text_color(*theme.accent_dark)
        pdf.cell(0, 4, "AZIMUT NOTES", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(1.5)
        pdf.set_font(theme.heading_family, "B", 22)
        pdf.set_text_color(24, 24, 24)
        pdf.multi_cell(theme.frame, 9, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(2)
        pdf.set_draw_color(*theme.accent)
        pdf.set_line_width(0.45)
        pdf.line(theme.margin_side, pdf.get_y(), theme.page_width - theme.margin_side, pdf.get_y())
        pdf.ln(6)

    def _report_title(self, title: str) -> None:
        pdf, theme, look = self.pdf, self.theme, self.look
        left = pdf.l_margin
        pdf.ln(4)
        pdf.set_fill_color(*theme.accent)
        pdf.rect(left, pdf.get_y(), 16.0, 1.2, style="F")
        pdf.ln(4.5)
        pdf.set_font(theme.heading_family, "B", 7.8)
        pdf.set_text_color(*theme.accent)
        pdf.set_char_spacing(1.0)
        pdf.cell(0, 4.5, notes_style.long_date(pdf.day).upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_char_spacing(0)
        pdf.ln(2)
        pdf.set_font(theme.heading_family, "B", 24)
        pdf.set_text_color(*theme.ink)
        pdf.multi_cell(pdf.epw, 10, title, align=Align.L, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if look.cover.subtitle:
            pdf.ln(1.5)
            pdf.set_font(theme.aside_family, "I", 12.5)
            pdf.set_text_color(*theme.muted)
            pdf.multi_cell(pdf.epw, 6.2, look.cover.subtitle, align=Align.L, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(5)
        pdf.set_draw_color(*theme.rule)
        pdf.set_line_width(0.3)
        pdf.line(left, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
        pdf.ln(8)

    def _journal_title(self, title: str) -> None:
        pdf, theme, look = self.pdf, self.theme, self.look
        left = pdf.l_margin
        pdf.ln(2)
        pdf.set_font(theme.heading_family, "B", 7.8)
        pdf.set_text_color(*theme.accent)
        pdf.set_char_spacing(1.0)
        span = self._log_span()
        pdf.cell(0, 4.5, span.upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_char_spacing(0)
        pdf.ln(1.5)
        pdf.set_font(theme.heading_family, "B", 21)
        pdf.set_text_color(*theme.ink)
        pdf.multi_cell(pdf.epw, 9, title, align=Align.L, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if look.cover.subtitle:
            pdf.ln(1)
            pdf.set_font(theme.aside_family, "I", 11.5)
            pdf.set_text_color(*theme.muted)
            pdf.multi_cell(pdf.epw, 5.8, look.cover.subtitle, align=Align.L, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(3.5)
        pdf.set_draw_color(*theme.accent)
        pdf.set_line_width(0.6)
        pdf.line(left, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
        pdf.ln(7)

    def _log_span(self) -> str:
        days = sorted(self._log_days)
        count = self._log_count
        if not days:
            return notes_style.long_date(self.pdf.day)
        first, last = days[0], days[-1]
        entries = f"{count} entr{'y' if count == 1 else 'ies'}"
        if first == last:
            return f"{entries} · {notes_style.long_date(first)}"
        return f"{entries} · {notes_style.long_date(first)} to {notes_style.long_date(last)}"

    def _cover_image(self) -> tuple[object, tuple[int, int]] | None:
        """The cover's picture, from the case's media, or None (said in a warning)."""
        image_id = self.look.cover.image
        if not image_id or self.case is None:
            return None
        entity = self.case.get_entity(image_id)
        attrs = (entity or {}).get("attrs") or {}
        if not entity or not attrs.get("path"):
            self._warn("The cover picture is no longer in the case; the cover was drawn without it.", None, MISSING)
            return None
        if attrs.get("kind") == "video":
            self._warn("A video cannot be a cover picture; the cover was drawn without it.")
            return None
        try:
            path = self.case.resolve_inside(str(attrs["path"]))
        except Exception:
            path = None
        natural = _measure(path) if path is not None else None
        if path is None or natural is None:
            self._warn("The cover picture could not be read; the cover was drawn without it.")
            return None
        self.images += 1
        return path, natural

    def collect_warnings(self, text: str) -> None:
        if self._remote:
            self._warn(
                f"{self._remote} remote image{'s' if self._remote > 1 else ''} left out: "
                "the export never fetches from the network.",
                self._remote_line,
            )
        missing = pdffonts.uncovered(self.pdf, text)
        if missing:
            scripts = sorted({pdffonts.script_of(char) for char in missing})
            self._warn(
                f"No font on this machine covers {', '.join(scripts)}; "
                "those characters were left out."
            )

    # -- the token walk -----------------------------------------------------

    def _walk(
        self, tokens: list[Token], index: int, align: Align, stop: str | None
    ) -> tuple[bool, int]:
        """Draw one nesting level, stopping at `stop`. Returns whether it drew."""
        drew = False
        while index < len(tokens):
            token = tokens[index]
            if token.type == stop:
                return drew, index + 1
            if token.map and not self._fixed:
                self._line = self._block_line + token.map[0]
            elif self._fixed:
                self._line = self._block_line
            if token is self._promoted:
                index = _past(tokens, index)
                continue
            handler = getattr(self, f"_on_{token.type}", None)
            if handler is None:
                index += 1
                continue
            index = handler(tokens, index, align)
            drew = True
        return drew, index

    # -- blocks -------------------------------------------------------------

    def _on_heading_open(self, tokens: list[Token], index: int, align: Align) -> int:
        tag = tokens[index].tag
        level = _level(tag, self._shift)
        runs = self._inline(tokens[index + 1])
        if self._on_cover:
            self._cover_heading(runs, tag, align)
            return index + 3
        if self.theme.style == "journal" and tag == "h3":
            stamp = LOG_STAMP.match(_plain(runs))
            if stamp is not None:
                self._log_entry(runs, stamp, level, tokens, index + 3)
                return index + 3
        if level <= 3:
            self._end_entry()
        self._heading(runs, level, tokens, index + 3, align)
        return index + 3

    def _heading(
        self,
        runs: list[Run],
        level: int,
        tokens: list[Token],
        after: int,
        align: Align,
        *,
        numbered: bool = True,
    ) -> None:
        """A heading at ``level`` (1 to 6, after a chapter's shift), numbered and
        bookmarked when the look asks, kept with what follows it.

        A heading with nothing under it before a chapter is that chapter's lead-in:
        it keeps room for the chapter's title, or, where a chapter opens a page of
        its own, opens that page itself and the chapter follows it there."""
        theme = self.theme
        tag = f"h{level}"
        size, space = theme.headings.get(tag, theme.headings["h6"])
        pdf = self.pdf
        number = self._number(level) if numbered else ""
        chapter = self._lead if self._lead is not None and _nothing_after(tokens, after) else None
        room = self._next_height(tokens, after)
        if chapter is not None and self._opens_page(chapter):
            if pdf.get_y() > pdf.t_margin + 4 and (pdf.page, pdf.get_y()) != self._opening:
                pdf.add_page()
            self._led_page = pdf.page
        elif chapter is not None:
            room = self._keeps(chapter.depth)
        if theme.plain:
            if pdf.get_y() > theme.margin_top + 2:
                pdf.ln(space)
            # A heading alone at the foot of a page belongs with what follows it, so
            # what follows is measured rather than assumed: two lines of text is one
            # thing to reserve, a full-width capture is another.
            if pdf.will_page_break(size * 0.7 + room):
                pdf.add_page()
            self._bookmark(runs, level, number)
            if number:
                runs = [Run(f"{number}  ", color=theme.accent), *runs]
            self._runs(
                runs,
                align=align,
                size=size,
                leading=size * 0.46,
                family=theme.heading_family,
                bold=True,
                color=theme.muted if tag == "h6" else theme.ink,
                bottom=1.8 * theme.scale,
            )
            return
        self._styled_heading(runs, level, number, room, align)
        if chapter is not None and self._led_page is not None:
            self._led_page = pdf.page

    def _styled_heading(
        self,
        runs: list[Run],
        level: int,
        number: str,
        room: float,
        align: Align,
    ) -> None:
        theme, pdf = self.theme, self.pdf
        # Styled by rank rather than by mark: a note whose sections are `##` under a
        # `#` title still opens each one as a top section.
        rank = max(1, min(6, level - self._base + 1))
        size, space = theme.headings.get(f"h{rank}", theme.headings["h6"])
        brief = theme.style == "brief"
        caps = brief and rank <= 2
        if caps:
            size = 9.4 * theme.scale
            space = theme.headings["h2"][1] + 0.6
        if pdf.get_y() > pdf.t_margin + 2:
            pdf.ln(space)
        if pdf.will_page_break(size * 0.7 + 4 + room):
            pdf.add_page()
        self._bookmark(runs, level, number)
        colour = theme.ink
        if caps:
            runs = [Run(run.text.upper(), bold=True, color=theme.accent_dark) for run in runs]
            pdf.set_char_spacing(0.5)
        elif rank >= 5:
            colour = theme.muted
        if number:
            runs = [Run(f"{number}  ", bold=True, color=theme.accent), *runs]
        self._runs(
            runs,
            align=align,
            size=size,
            leading=size * 0.48,
            family=theme.heading_family,
            bold=True,
            color=colour,
            bottom=0.0,
        )
        pdf.set_char_spacing(0)
        if caps or (rank == 1 and theme.style == "report"):
            y = pdf.get_y() + (0.6 if caps else 1.2)
            pdf.set_draw_color(*(theme.accent if caps else theme.rule))
            pdf.set_line_width(0.35 if caps else 0.3)
            pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
            pdf.ln(3.2 if caps else 4.2)
        else:
            pdf.ln(1.8 if rank <= 2 else 1.2)

    def _number(self, level: int) -> str:
        """`2.1` for a heading at ``level``, or "" when the look does not number,
        the heading is too deep, or it comes before its first parent (a preamble)."""
        if not self.look.numbered:
            return ""
        depth = level - self._base
        if depth < 0 or depth >= NUMBERED_LEVELS:
            return ""
        if any(count == 0 for count in self._counters[:depth]):
            for deeper in range(depth, NUMBERED_LEVELS):
                self._counters[deeper] = 0
            return ""
        self._counters[depth] += 1
        for deeper in range(depth + 1, NUMBERED_LEVELS):
            self._counters[deeper] = 0
        return ".".join(str(count) for count in self._counters[: depth + 1])

    def _bookmark(self, runs: list[Run], level: int, number: str) -> None:
        if not self._outlined:
            return
        name = " ".join(_plain(run for run in runs if not run.raised).split())
        if not name:
            return
        if number:
            name = f"{number}  {name}"
        self.pdf.start_section(name[:200], level=max(0, level - self._base), strict=False)

    def _chapter(self, piece: Piece) -> None:
        """An included note's title, opening its chapter."""
        self._line = piece.line
        pdf, theme = self.pdf, self.theme
        runs = [Run(piece.text)]
        led, self._led_page = self._led_page, None
        if self._opens_page(piece):
            # a heading leading into the chapter opened its page already
            if pdf.get_y() > pdf.t_margin + 4 and (pdf.page, pdf.get_y()) != self._opening and led != pdf.page:
                pdf.add_page()
            number = self._number(piece.depth)
            self._bookmark(runs, piece.depth, number)
            pdf.ln(6)
            pdf.set_fill_color(*theme.accent)
            pdf.rect(pdf.l_margin, pdf.get_y(), 14.0, 1.4, style="F")
            pdf.ln(4.5)
            pdf.set_font(theme.heading_family, "B", 8.2)
            pdf.set_text_color(*theme.accent)
            pdf.set_char_spacing(1.2)
            self._chapters += 1
            kicker = f"CHAPTER {number or self._chapters}"
            pdf.cell(0, 5, kicker, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_char_spacing(0)
            pdf.ln(1.5)
            pdf.set_font(theme.heading_family, "B", 22)
            pdf.set_text_color(*theme.ink)
            pdf.multi_cell(pdf.epw, 9.5, piece.text, align=Align.L, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(3)
            pdf.set_draw_color(*theme.rule)
            pdf.set_line_width(0.3)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(7)
        else:
            self._heading(runs, piece.depth, [], 0, Align.L)

    def _keeps(self, level: int) -> float:
        """What a heading at ``level`` asks of the page before it draws itself, as its
        own check reckons it: the space above it, its line, and two lines under it."""
        theme = self.theme
        if theme.plain:
            size, space = theme.headings.get(f"h{level}", theme.headings["h6"])
            return space + size * 0.7 + theme.leading * 2
        rank = max(1, min(6, level - self._base + 1))
        size, space = theme.headings.get(f"h{rank}", theme.headings["h6"])
        if theme.style == "brief" and rank <= 2:
            size, space = 9.4 * theme.scale, theme.headings["h2"][1] + 0.6
        return space + size * 0.7 + 4 + theme.leading * 2

    def _opens_page(self, piece: Piece) -> bool:
        """Whether a chapter starts on a page of its own: a report's, at the first level."""
        return self.theme.style == "report" and piece.depth == 1

    def _next_height(self, tokens: list[Token], index: int, depth: int = 0) -> float:
        """How tall the block after a heading is, at least, for the heading to be
        kept with it: a picture with its caption, a table's first two rows, a boxed
        callout's opening, or the heading under it and what that one keeps; two
        lines else."""
        theme = self.theme
        if index >= len(tokens):
            return theme.leading * 2
        token = tokens[index]
        if token.type == "heading_open" and depth < 2:
            return self._heading_room(_level(token.tag, self._shift)) + self._next_height(tokens, index + 3, depth + 1)
        picture: tuple[int, int] | None = None
        credit: _Credit | None = None
        options = ImageOptions("", "", "left", "")
        words = ""
        if token.type == "fence" and MERMAID_INFO.match(token.info or ""):
            png = self.diagrams.get(diagram_key(token.content))
            picture = _diagram_size(png) if png else None
            options = ImageOptions("", "", "center", "")
        elif token.type == "table_open":
            # the header row and the first row under it, which fpdf2 keeps together
            line, pad = (5.0, 1.6) if theme.plain else (4.6, 1.7)
            return 2 * (line * theme.scale + 2 * pad) + (0 if theme.plain else 0.8)
        elif token.type == "blockquote_open" and (not theme.plain or _callout_kind(tokens, index) == INTERNAL):
            return max(theme.leading * 2, 15.0)  # a boxed callout opens on a page with room for it
        elif token.type == "paragraph_open" and index + 1 < len(tokens):
            children = [
                child
                for child in (tokens[index + 1].children or [])
                if child.type != "softbreak"
            ]
            if len(children) == 1 and children[0].type == "image":
                peeked = self._peek_image(children[0])
                if peeked is not None:
                    picture, credit = peeked
                    options = _image_options(_attr(children[0], "src"))
                    words = options.caption or _attr(children[0], "title")
        if picture is None:
            return theme.leading * 2
        width, height = _fit(picture, options.width, self._frame(), theme.room)
        label = "Figure 00" if self.look.numbered else ""
        below = self._below((label, words), credit, ALIGNMENTS[options.align], width)
        if not theme.plain:
            below += 0.6  # the breath a styled picture takes above itself
        # what a picture free to shrink needs at least, with a little to spare
        return (height if options.width else height * (1 - MAX_SHRINK + 0.05)) + below

    def _heading_room(self, level: int) -> float:
        """How far down the page a one-line heading at ``level`` takes the walk:
        the space above it, its line, and the space or rule under it."""
        theme = self.theme
        if theme.plain:
            size, space = theme.headings.get(f"h{level}", theme.headings["h6"])
            return space + size * 0.46 + 1.8 * theme.scale
        rank = max(1, min(6, level - self._base + 1))
        size, space = theme.headings.get(f"h{rank}", theme.headings["h6"])
        if theme.style == "brief" and rank <= 2:
            return theme.headings["h2"][1] + 0.6 + 9.4 * theme.scale * 0.48 + 3.8
        after = 5.4 if rank == 1 and theme.style == "report" else 1.8 if rank <= 2 else 1.2
        return space + size * 0.48 + after

    def _peek_image(self, token: Token) -> "tuple[tuple[int, int], _Credit | None] | None":
        """An image's pixel size and credit, without counting it against the note's budget."""
        images, remote, remote_line = self.images, self._remote, self._remote_line
        try:
            resolved = self._resolve_image(token)
        finally:
            self.images, self._remote, self._remote_line = images, remote, remote_line
        if isinstance(resolved, str):
            return None
        if isinstance(resolved, _Poster):
            return (resolved.natural, resolved.credit) if resolved.path is not None else None
        return resolved.natural, resolved.credit

    def _on_paragraph_open(self, tokens: list[Token], index: int, align: Align) -> int:
        inline = tokens[index + 1]
        if self._standalone_image(inline, align):
            return index + 3
        runs = self._inline(inline)
        if runs:
            gap = self.theme.gap
            self._runs(runs, align=align, bottom=min(1.2, gap) if self._depth else gap)
        return index + 3

    def _on_hr(self, tokens: list[Token], index: int, align: Align) -> int:
        pdf = self.pdf
        theme = self.theme
        pdf.ln(1.5)
        pdf.set_draw_color(*theme.rule)
        pdf.set_line_width(0.2)
        if theme.plain:
            pdf.line(theme.margin_side, pdf.get_y(), theme.page_width - theme.margin_side, pdf.get_y())
        else:
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
        pdf.ln(theme.gap + 1.5)
        return index + 1

    def _on_fence(self, tokens: list[Token], index: int, align: Align) -> int:
        token = tokens[index]
        if MERMAID_INFO.match(token.info or ""):
            self._diagram(token.content)
        else:
            self._code_box(token.content)
        return index + 1

    def _on_code_block(self, tokens: list[Token], index: int, align: Align) -> int:
        self._code_box(tokens[index].content)
        return index + 1

    def _on_blockquote_open(self, tokens: list[Token], index: int, align: Align) -> int:
        # an internal passage is boxed in every style, so it stands out wherever it prints
        if not self.theme.plain or _callout_kind(tokens, index) == INTERNAL:
            return self._boxed_quote(tokens, index, align)
        pdf = self.pdf
        top = pdf.get_y()
        page = pdf.page
        callout = _take_callout(tokens, index)
        with self._indent(5.0):
            if callout:
                pdf.set_font(self.theme.heading_family, "B", 8.0 * self.theme.scale)
                pdf.set_text_color(*callout[1])
                pdf.cell(text=callout[0].upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.ln(0.8)
            _, index = self._walk(tokens, index + 1, align, stop="blockquote_close")
        # Only bar the part on this page: a quote that split has a second half
        # whose top is nowhere near where it started.
        if pdf.page == page:
            side = self.theme.margin_side
            pdf.set_draw_color(*(callout[1] if callout else self.theme.accent))
            pdf.set_line_width(0.7)
            pdf.line(side + 0.4, top, side + 0.4, pdf.get_y() - self.theme.gap)
        return index

    def _boxed_quote(self, tokens: list[Token], index: int, align: Align, *, big: bool = False) -> int:
        """A callout in a tinted box with a bar in its colour; a plain quote barred
        in the accent and set in italic grey. The box follows the text over a page."""
        pdf, theme = self.pdf, self.theme
        callout = _take_callout(tokens, index)
        colour = callout[1] if callout else theme.accent
        pad = 4.2 if big else 3.0
        pdf.ln(0.6 if big else 0.4)
        if pdf.will_page_break(22 if big else 14):
            pdf.add_page()
        if callout:
            box = pdf.open_box(fill=mix(colour, WHITE, 0.9), bar=colour, bar_width=2.2 if big else 1.2)
        else:
            box = pdf.open_box(bar=mix(colour, WHITE, 0.35), bar_width=0.9)
        sizes = (self._size, self._leading, self._family)
        if big:
            self._size, self._leading = 11.6 * theme.scale, 5.9 * theme.scale
            self._family = theme.heading_family
        top_page = pdf.page
        with self._inset(pad + box.bar_width + (1.0 if callout else 2.0), pad if callout else 0.0):
            pdf.ln(pad - 0.6 if callout else 0.6)
            if callout:
                pdf.set_font(theme.heading_family, "B", (13.0 if big else 7.6) * theme.scale)
                pdf.set_text_color(*mix(colour, (0, 0, 0), 0.18))
                pdf.set_char_spacing(1.4 if big else 0.9)
                pdf.cell(text=callout[0].upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_char_spacing(0)
                pdf.ln(1.6 if big else 1.0)
            _, index = self._walk(tokens, index + 1, align, stop="blockquote_close")
        self._size, self._leading, self._family = sizes
        last_gap = min(1.2, theme.gap) if self._depth else theme.gap
        bottom = pdf.get_y() - last_gap + (pad - 0.8 if callout else 0.6)
        if pdf.page != top_page and bottom < box.top:
            bottom = box.top
        pdf.close_box(box, bottom)
        pdf.set_y(bottom + (theme.gap + 1.2 if big else theme.gap))
        return index

    def _verdict(self) -> None:
        """The brief's verdict, lifted from where the note put it to the top."""
        promoted = self._promoted
        tokens = self._promoted_in
        index = next((i for i, token in enumerate(tokens) if token is promoted), None)
        if promoted is None or index is None:
            return
        # drawn here once; the walk then steps over it where the note has it
        self._promoted = None
        self._boxed_quote(tokens, index, Align.L, big=True)
        self._promoted = promoted

    def _on_bullet_list_open(self, tokens: list[Token], index: int, align: Align) -> int:
        return self._list(tokens, index, align, ordered=False)

    def _on_ordered_list_open(self, tokens: list[Token], index: int, align: Align) -> int:
        return self._list(tokens, index, align, ordered=True)

    def _list(self, tokens: list[Token], index: int, align: Align, *, ordered: bool) -> int:
        """A list, drawn as one hanging-indent paragraph per item.

        The bullet is handed to the item's first paragraph rather than drawn
        here, so a wrapped item lines up under its own text instead of under the
        bullet, and a nested list indents from where its parent left off.
        """
        closing = "ordered_list_close" if ordered else "bullet_list_close"
        number = int(tokens[index].attrGet("start") or 1) if ordered else 1
        index += 1
        self._depth += 1
        while index < len(tokens) and tokens[index].type != closing:
            if tokens[index].type != "list_item_open":
                index += 1
                continue
            where = tokens[index].map
            if where and not self._fixed:
                self._line = self._block_line + where[0]
            pdf = self.pdf
            pdf.set_font(self._family, size=self._size)
            pdf.set_text_color(*(self.theme.accent_dark if self.theme.plain else self.theme.accent))
            if not self.theme.plain and pdf.will_page_break(self._leading):
                pdf.add_page()  # the bullet goes where its text goes
            pdf.set_x(pdf.l_margin + (1.5 if self._depth == 1 else 0.0))
            task = None if self.theme.plain else _take_task(tokens, index)
            if task is not None:
                self._checkbox(task)
            else:
                pdf.cell(BULLET_WIDTH, self._leading, f"{number}." if ordered else "•")
            with self._indent(BULLET_WIDTH + 1.5):
                _, index = self._walk(tokens, index + 1, align, stop="list_item_close")
            number += 1
        self._depth -= 1
        if not self._depth:
            self.pdf.ln(self.theme.gap - 1.6)
        return index + 1

    def _checkbox(self, done: bool) -> None:
        """A task's box, drawn rather than typed: ticked in the accent when done."""
        pdf, theme = self.pdf, self.theme
        side = min(3.0, self._leading * 0.6)
        x, y = pdf.get_x() + 0.2, pdf.get_y() + (self._leading - side) / 2 + 0.15
        pdf.set_line_width(0.25)
        if done:
            pdf.set_fill_color(*theme.accent)
            pdf.set_draw_color(*theme.accent)
            pdf.rect(x, y, side, side, style="DF", round_corners=True, corner_radius=0.5)
            pdf.set_draw_color(*WHITE)
            pdf.set_line_width(0.45)
            pdf.polyline([(x + side * 0.22, y + side * 0.52), (x + side * 0.42, y + side * 0.74),
                          (x + side * 0.8, y + side * 0.28)])
        else:
            pdf.set_draw_color(*theme.muted)
            pdf.rect(x, y, side, side, style="D", round_corners=True, corner_radius=0.5)
        pdf.set_x(pdf.get_x() + BULLET_WIDTH)

    def _on_table_open(self, tokens: list[Token], index: int, align: Align) -> int:
        rows: list[list[list[Run]]] = []
        header_rows = 0
        in_head = False
        index += 1
        while index < len(tokens) and tokens[index].type != "table_close":
            token = tokens[index]
            if token.type == "thead_open":
                in_head = True
            elif token.type == "thead_close":
                in_head = False
            elif token.type == "tr_open":
                cells: list[list[Run]] = []
                index += 1
                while index < len(tokens) and tokens[index].type != "tr_close":
                    if tokens[index].type in ("th_open", "td_open"):
                        cells.append(self._inline(tokens[index + 1]))
                        index += 3
                        continue
                    index += 1
                rows.append(cells)
                if in_head:
                    header_rows += 1
            index += 1
        if rows:
            self._table(rows, header_rows)
        return index + 1

    def _on_html_block(self, tokens: list[Token], index: int, align: Align) -> int:
        # The preview sanitizes raw HTML away; here it is shown as what it is,
        # so a note holding a stray tag neither executes nor disappears.
        text = tokens[index].content.strip()
        if PAGE_BREAK.match(text):
            self._page_break()
        elif text and not COMMENT.match(text):
            self._aside(text)
        return index + 1

    def _page_break(self) -> None:
        """`<!-- pagebreak -->`: what follows starts a page, unless the page it is
        on holds nothing yet, which would only print a blank one."""
        self._end_entry()
        pdf = self.pdf
        if pdf.get_y() > pdf.body_top + 0.5:
            pdf.add_page()

    # -- the journal ----------------------------------------------------------

    def _log_entry(self, runs: list[Run], stamp: re.Match[str], level: int,
                   tokens: list[Token], after: int) -> None:
        """A Log entry: its day and time in the gutter, on the timeline rule, and
        its text in the column beside it until the next entry or section."""
        self._end_entry()
        pdf, theme = self.pdf, self.theme
        year, month, day, clock, zone, _ = stamp.groups()
        try:
            when: date | None = date(int(year), int(month), int(day))
        except ValueError:
            when = None
        key = f"{year}-{month}-{day}"
        new_day = key != self._last_day
        if pdf.get_y() > pdf.t_margin + 2:
            pdf.ln(2.0 + (3.4 if new_day and self._last_day else 0.0))
        if pdf.will_page_break((9 if new_day else 0) + 15 + self._next_height(tokens, after)):
            pdf.add_page()
        left, gutter = pdf.l_margin, theme.gutter
        axis = left + gutter - 2.6
        if new_day:
            # a new day opens with its name across the page, the timeline starting under it
            label = (
                f"{notes_style.WEEKDAYS[when.weekday()]} {notes_style.long_date(when)}" if when else key
            ).upper()
            y = pdf.get_y()
            pdf.set_font(theme.heading_family, "B", 7.4)
            pdf.set_text_color(*theme.accent)
            pdf.set_char_spacing(0.8)
            pdf.set_xy(left, y)
            pdf.cell(pdf.get_string_width(label) + 3, 4.4, label)
            pdf.set_char_spacing(0)
            pdf.set_draw_color(*theme.rule)
            pdf.set_line_width(0.2)
            pdf.line(pdf.get_x() + 1, y + 2.2, pdf.w - pdf.r_margin, y + 2.2)
            pdf.set_xy(left, y + 8.0)
            self._rule_end = None
        top = pdf.get_y()
        if not new_day and self._rule_end is not None and self._rule_end[0] == pdf.page:
            # the same day goes on: the timeline runs on from the last entry to this one
            pdf.set_fill_color(*mix(theme.accent, WHITE, 0.62))
            pdf.rect(axis, self._rule_end[1], 0.4, top + 1.2 - self._rule_end[1], style="F")
        self._last_day = key
        title = _cut_runs(runs, stamp.start(6))
        self._bookmark([Run(_plain(runs))], level, "")
        lines: list[tuple[str, str, float, tuple[int, int, int], float]] = []
        if clock:
            lines.append((clock, "B", 10.5, theme.ink, 4.6))
        if zone:
            lines.append((zone, "", 6.6, theme.muted, 3.4))
        y = top
        for text, emphasis, size, colour, height in lines:
            pdf.set_xy(left, y)
            pdf.set_font(theme.heading_family, emphasis, size)
            pdf.set_text_color(*colour)
            pdf.cell(gutter - 6, height, text, align=Align.R)
            y += height
        pdf.set_fill_color(*theme.accent)
        pdf.circle(axis + 0.2, top + 2.3, 1.15, style="F")
        indent = gutter + 2.0
        pdf.set_left_margin(left + indent)
        pdf.set_xy(left + indent, top + 4.6)
        box = pdf.open_box(bar=mix(theme.accent, WHITE, 0.62), bar_width=0.4)
        box.left = axis
        pdf.set_xy(left + indent, top)
        self._entry = _Entry(indent, box, y, pdf.page)
        if title:
            self._runs(title, size=self._size + 0.6, leading=self._leading + 0.2,
                       family=theme.heading_family, bold=True, color=theme.ink, bottom=1.2)

    def _end_entry(self) -> None:
        entry = self._entry
        if entry is None:
            return
        self._entry = None
        pdf = self.pdf
        bottom = max(pdf.get_y() - self.theme.gap + 0.6, entry.box.top + 0.5)
        if pdf.page == entry.page:
            bottom = max(bottom, entry.bottom)
        pdf.close_box(entry.box, bottom)
        self._rule_end = (pdf.page, bottom)
        if pdf.page == entry.page and pdf.get_y() < entry.bottom + 1.0:
            pdf.set_y(entry.bottom + 1.0)
        pdf.set_left_margin(pdf.l_margin - entry.indent)
        pdf.set_x(pdf.l_margin)

    # -- inline -------------------------------------------------------------

    def _inline(self, token: Token) -> list[Run]:
        """One inline token stream flattened into styled runs."""
        if token.type != "inline":
            return []
        theme = self.theme
        runs: list[Run] = []
        bold = italic = 0
        link = ""
        entity = 0
        cite = 0
        for child in token.children or []:
            kind = child.type
            if kind == "strong_open":
                bold += 1
            elif kind == "strong_close":
                bold = max(0, bold - 1)
            elif kind == "em_open":
                italic += 1
            elif kind == "em_close":
                italic = max(0, italic - 1)
            elif kind == "link_open":
                link, entity = self._link_style(child)
                if self.cited.annex is not None:
                    cite = self.cited.number(self.cited.link_source(_attr(child, "href")))
            elif kind == "link_close":
                if cite:
                    runs.append(self._citation(cite))
                link, entity, cite = "", 0, 0
            elif kind == "image":
                runs.extend(self._inline_image(child))
            elif kind == "html_inline" and child.content.startswith("<!--"):
                continue  # a comment, or a template's guidance: never printed
            elif kind in ("text", "html_inline", "code_inline", "softbreak", "hardbreak"):
                text = {"softbreak": " ", "hardbreak": "\n"}.get(kind, child.content)
                if not text:
                    continue
                colour = INK
                if entity == 1:
                    colour = theme.accent_dark
                elif entity == 2 or (link and not entity):
                    colour = theme.muted if entity else theme.accent_dark
                run = Run(
                    text=text,
                    bold=bool(bold) or entity == 1,
                    italic=bool(italic) or entity == 2,
                    mono=kind == "code_inline",
                    color=colour,
                    link="" if entity else link,
                )
                if kind == "text" and not link and not entity:
                    runs.extend(self._prose(run))
                else:
                    runs.append(run)
        return [run for run in runs if run.text]

    def _citation(self, number: int) -> Run:
        """The small `[3]` after a citation, linked to its entry in the sources list."""
        return Run(f"[{number}]", color=self.theme.accent, entry=number, raised=True)

    def _prose(self, run: Run) -> list[Run]:
        """A run of prose: each address written bare in it followed by its number
        when the sources are listed, and each coordinate pair linked to the map."""
        if self.cited.annex is None:
            return self._coordinates(run)
        pieces: list[Run] = []
        at = 0
        for start, end, address in _bare_urls(run.text):
            number = self.cited.number(self.cited.link_source(address))
            if not number:
                continue
            pieces.extend(self._coordinates(replace(run, text=run.text[at:start])))
            pieces.append(replace(run, text=run.text[start:end]))
            pieces.append(self._citation(number))
            at = end
        if not pieces:
            return self._coordinates(run)
        pieces.extend(self._coordinates(replace(run, text=run.text[at:])))
        return pieces

    def _coordinates(self, run: Run) -> list[Run]:
        """A run with each decimal coordinate pair in it linked to the map."""
        pieces: list[Run] = []
        at = 0
        for match in COORDINATES.finditer(run.text):
            lat, lon = match.group(1), match.group(2)
            if abs(float(lat)) > 90 or abs(float(lon)) > 180:
                continue
            pieces.append(Run(run.text[at : match.start()], run.bold, run.italic, run.mono, run.color))
            pieces.append(Run(match.group(0), run.bold, run.italic, run.mono, self.theme.accent_dark,
                              MAP_LINK.format(lat=lat, lon=lon)))
            at = match.end()
        if not pieces:
            return [run]
        pieces.append(Run(run.text[at:], run.bold, run.italic, run.mono, run.color))
        return pieces

    def _link_style(self, token: Token) -> tuple[str, int]:
        """How a link is drawn, which depends on where it points.

        A PDF is read away from the app, so a reference to another entity cannot
        link into it. A record with a web address of its own (a bookmark's page,
        an account's profile, the page a file came from) links there and reads as
        a link; any other stays visible as a reference, and turns quiet and italic
        once the entity it named has been deleted from the case. Without a case (a
        template's preview) every reference reads as a live one.
        """
        href = _attr(token, "href")
        entity = ENTITY_HREF.match(href)
        if entity:
            if self.case is None:
                return "", 1
            source = self.cited.reader.entity(entity.group(1))
            if source is None:
                return "", 2
            address = source.link
            return (address, 0) if address else ("", 1)
        if href.startswith("#"):
            # an anchor in the note has no place in the PDF, and fpdf2 refuses the
            # whole document over a destination nobody set: it prints as its words
            return "", 0
        return href, 0

    def _inline_image(self, token: Token) -> list[Run]:
        """An image inside a run of text: named, not drawn, and numbered when the
        sources are listed.

        fpdf2 places a picture at a point on the page, not in the middle of a
        wrapping line, and a note that inlines a capture means it to be seen —
        so it is drawn as its own block instead (`_standalone_image`).
        """
        resolved = self._resolve_image(token)
        if resolved == PICTURE_NOT_SET:
            return []
        label = resolved if isinstance(resolved, str) else (token.content or "Image")
        link = resolved.url if isinstance(resolved, _Poster) else ""
        named = Run(text=f"[{label}]", italic=True, color=self.theme.muted, link=link)
        number = 0 if isinstance(resolved, str) else self.cited.number(resolved.source)
        return [named, self._citation(number)] if number else [named]

    def _face(self, family: str, bold: bool, italic: bool) -> tuple[str, str]:
        """The face a run is set in. The mono face ships in one weight, and the sans
        has its italics only where it sets the body: elsewhere emphasis inside a sans
        line borrows the serif's italic rather than failing the whole document, which
        is what an italic word in a heading did."""
        if family == pdffonts.MONO:
            return family, ""
        style = ("B" if bold else "") + ("I" if italic else "")
        if italic and (family, style) not in self.faces:
            family = pdffonts.SERIF
        return family, style

    # -- drawing ------------------------------------------------------------

    def _frame(self) -> float:
        """The width a block may take: the plain page's fixed frame, as it always
        was, or the room left between the current margins. In a corner of the cover a
        picture's width is still a share of the page's, as the editor draws it."""
        if self._page_frame is not None:
            return self._page_frame
        return self.theme.frame if self.theme.plain else self.pdf.epw

    def _indent(self, amount: float) -> "_Indent":
        return _Indent(self.pdf, amount)

    def _inset(self, left: float, right: float) -> "_Inset":
        return _Inset(self.pdf, left, right)

    def _runs(
        self,
        runs: Iterable[Run],
        *,
        align: Align = Align.L,
        size: float | None = None,
        leading: float | None = None,
        family: str | None = None,
        bold: bool = False,
        color: tuple[int, int, int] | None = None,
        bottom: float | None = None,
    ) -> None:
        """Draw a paragraph of styled runs, wrapping and breaking pages itself.

        Run by run through `write()`, and deliberately not through fpdf2's text
        region, which lays a paragraph out word by word from left to right. That
        is correct for English and wrong for Arabic: a right-to-left run comes
        back with its words in reverse. `write()` keeps each run whole, so a
        shaped right-to-left phrase lands the way HarfBuzz ordered it.

        The cost is the line junction — a run that starts where the previous one
        ran out of room gets its first word split — so the break is made here,
        before the word rather than inside it.
        """
        size = self._size if size is None else size
        leading = self._leading if leading is None else leading
        family = self._family if family is None else family
        color = self.theme.ink if color is None else color
        bottom = self.theme.gap if bottom is None else bottom
        pdf = self.pdf
        if align is not Align.L:
            self._aligned_runs(list(runs), align, size=size, leading=leading, family=family, bold=bold, color=color)
            pdf.ln(bottom)
            return
        # `write` keeps a cell margin on each side before it breaks, so the edge
        # it measures against is inside the one the page declares.
        right = self.theme.page_width - pdf.r_margin - 2 * pdf.c_margin
        for run in runs:
            self._run_face(run, family=family, bold=bold, size=size, color=color)
            text = run.text
            body = text.lstrip(" ")
            word = body.split(" ", 1)[0] if body else ""
            if word and pdf.get_x() + pdf.get_string_width(text[: len(text) - len(body)] + word) > right:
                pdf.ln(leading)
                text = body
            pdf.write(leading, text, link=self._run_link(run))
            if run.raised:
                pdf.char_vpos = "LINE"
        pdf.ln(leading + bottom)

    def _run_face(self, run: Run, *, family: str, bold: bool, size: float, color: tuple[int, int, int]) -> None:
        """Set the face, size, colour and height a run is drawn in."""
        pdf = self.pdf
        run_family, emphasis = self._face(pdffonts.MONO if run.mono else family, run.bold or bold, run.italic)
        pdf.set_font(run_family, emphasis, size * (0.92 if run.mono else 1.0))
        pdf.set_text_color(*(run.color if run.color != INK else color))
        if run.raised:
            pdf.char_vpos = "SUP"

    def _aligned_runs(
        self,
        runs: list[Run],
        align: Align,
        *,
        size: float,
        leading: float,
        family: str,
        bold: bool,
        color: tuple[int, int, int],
    ) -> None:
        """A paragraph centred or set to the right, its styling kept.

        Placed line by line: the runs are cut into lines here, each line measured
        whole and started where its alignment puts it, then each run on it drawn at
        its own place in its own face, link and `[n]` included, as a paragraph at the
        left is. A run stays whole on its line, so a right-to-left phrase in it
        lands the way it was shaped. A hard break starts a line.
        """
        pdf = self.pdf
        room = pdf.epw - 2 * pdf.c_margin
        lines: list[list[tuple[Run, str]]] = [[]]
        used = 0.0

        def width(run: Run, text: str) -> float:
            self._run_face(run, family=family, bold=bold, size=size, color=color)
            measured = pdf.get_string_width(text)
            pdf.char_vpos = "LINE"
            return measured

        for run in runs:
            for word in ALIGNED_WORD.findall(run.text):
                if word == "\n":
                    lines.append([])
                    used = 0.0
                    continue
                if not lines[-1]:
                    word = word.lstrip()
                if not word:
                    continue
                if lines[-1] and used + width(run, word.rstrip()) > room:
                    lines.append([])
                    used = 0.0
                    word = word.lstrip()
                    if not word:
                        continue
                while len(word) > 1 and width(run, word.rstrip()) > room:
                    # a word wider than the whole line (an address) is cut where it must be
                    cut = next((n for n in range(len(word) - 1, 0, -1) if width(run, word[:n]) <= room), 1)
                    lines[-1].append((run, word[:cut]))
                    lines.append([])
                    used = 0.0
                    word = word[cut:]
                lines[-1].append((run, word))
                used += width(run, word)
        for line in lines:
            # a run's words on one line are drawn as one string
            pieces: list[tuple[Run, str]] = []
            for run, word in line:
                if pieces and pieces[-1][0] is run:
                    pieces[-1] = (run, pieces[-1][1] + word)
                else:
                    pieces.append((run, word))
            if pieces:
                pieces[-1] = (pieces[-1][0], pieces[-1][1].rstrip())
            widths = [width(run, text) for run, text in pieces]
            if pdf.will_page_break(leading):
                pdf.add_page()
            y = pdf.get_y()
            x = pdf.l_margin + pdf.c_margin + _aligned(align, 0.0, room, sum(widths))
            for (run, text), measured in zip(pieces, widths):
                if text:
                    self._run_face(run, family=family, bold=bold, size=size, color=color)
                    self._text_at(x, y, text, leading, link=self._run_link(run))
                    pdf.char_vpos = "LINE"
                x += measured
            pdf.set_xy(pdf.l_margin, y + leading)

    def _run_link(self, run: Run) -> str | int:
        """Where a run links: its address, else its entry in the sources list."""
        if run.link:
            return run.link
        return self._entry_link(run.entry) if run.entry else ""

    def _entry_link(self, number: int) -> int:
        """The internal link to an entry of the sources list, placed when it is drawn."""
        link = self._entry_links.get(number)
        if link is None:
            link = self.pdf.add_link()
            self._entry_links[number] = link
        return link

    def _aside(self, message: str, *, link: str = "") -> None:
        """A quiet, boxed line: what the page could not show, said in place."""
        pdf = self.pdf
        theme = self.theme
        pdf.set_font(theme.aside_family, "I", 9 * theme.scale)
        pdf.set_text_color(*theme.muted)
        pdf.set_fill_color(*theme.note_bg)
        pdf.set_draw_color(*theme.rule)
        pdf.set_line_width(0.5)
        top = pdf.get_y()
        if theme.plain:
            # the page's own frame, whatever the indentation, as it always was
            pdf.set_x(theme.margin_side + 2.5)
            width = theme.frame - 2.5
            bar = theme.margin_side + 0.6
        else:
            pdf.set_x(pdf.l_margin + 2.5)
            width = pdf.epw - 2.5
            bar = pdf.l_margin + 0.6
        pdf.multi_cell(
            width, 5.2 * theme.scale, message, fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT,
            link=link or None,
        )
        pdf.line(bar, top, bar, pdf.get_y())
        pdf.ln(theme.gap)

    def _code_box(self, code: str) -> None:
        """Preformatted text in a tinted box, indentation and all."""
        pdf = self.pdf
        theme = self.theme
        size = (8.5 if theme.style != "brief" else 8.0) * theme.scale
        leading = (4.3 if theme.style != "brief" else 4.0) * theme.scale
        pdf.set_font(pdffonts.MONO, size=size)
        lines = [
            part
            for line in code.rstrip("\n").split("\n")
            for part in _hard_wrap(line, pdf, self._frame() - 8)
        ]
        pdf.set_text_color(*theme.ink)
        left = pdf.l_margin
        width = pdf.epw
        # The tint is painted line by line, but the outline is drawn once per
        # page over the block: a border per line would rule the box like a ledger.
        pdf.ln(1.6)
        chunk_top = pdf.get_y() - 1.6
        for line in lines:
            if pdf.will_page_break(leading + 1.6):
                self._close_code_box(left, width, chunk_top, pdf.get_y() + 1.6)
                pdf.add_page()
                chunk_top = pdf.get_y()
                pdf.ln(1.6)
            pdf.set_fill_color(*theme.code_bg)
            pdf.rect(left, pdf.get_y(), width, leading, style="F")
            pdf.set_x(left + 3)
            # `cell` rather than a text region: it keeps the leading spaces,
            # which in code are the meaning rather than decoration.
            pdf.cell(width - 6, leading, line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self._close_code_box(left, width, chunk_top, pdf.get_y() + 1.6)
        pdf.ln(1.6 + theme.gap)

    def _close_code_box(self, left: float, width: float, top: float, bottom: float) -> None:
        pdf = self.pdf
        pdf.set_fill_color(*self.theme.code_bg)
        pdf.rect(left, bottom - 1.6, width, 1.6, style="F")
        pdf.set_draw_color(*self.theme.rule)
        pdf.set_line_width(0.2)
        pdf.rect(left, top, width, bottom - top, style="D")

    def _table(self, rows: list[list[list[Run]]], header_rows: int) -> None:
        """A table, its header row repeated on each page it runs onto.

        A cell is one text in one face, so its runs' styling goes; its link stays.
        A cell holding a link (or a reference with an address, or coordinates) links
        to it as a whole, the first one if it holds several, and reads as a link.
        """
        pdf = self.pdf
        theme = self.theme
        columns = min(max(len(row) for row in rows), MAX_TABLE_COLUMNS)
        squared = [(row + [[]] * columns)[:columns] for row in rows]
        texts = [[_plain(cell) for cell in line] for line in squared]
        from fpdf.fonts import FontFace

        def fill(table: Any) -> None:
            for number, line in enumerate(squared):
                row = table.row()
                for cell, text in zip(line, texts[number]):
                    entry = next((run.entry for run in cell if run.entry), 0)
                    link: str | int = next((run.link for run in cell if run.link), "")
                    link = link or (self._entry_link(entry) if entry else "")
                    if not link:
                        row.cell(text)
                    elif number < header_rows:
                        row.cell(text, link=link)
                    else:
                        row.cell(text, link=link, style=FontFace(color=theme.accent_dark))

        scale = theme.scale
        if theme.plain:
            pdf.set_font(theme.body_family, size=9 * scale)
            pdf.set_text_color(*INK)
            pdf.set_draw_color(*theme.rule)
            pdf.set_line_width(0.2)
            with pdf.table(
                col_widths=_column_widths(texts, columns),
                line_height=5.0 * scale,
                text_align=Align.L,
                padding=(1.6, 2.2),
                headings_style=FontFace(
                    family=theme.heading_family, emphasis="B", size_pt=9 * scale,
                    fill_color=theme.table_head_bg,
                ),
                first_row_as_headings=bool(header_rows),
                repeat_headings=1,
            ) as table:
                fill(table)
            pdf.ln(theme.gap)
            return
        size = (8.6 if theme.style == "brief" else 8.8) * scale
        pdf.ln(0.8)
        # fpdf2 paints the rows between stripes in the current fill: make that paper
        pdf.set_fill_color(*WHITE)
        pdf.set_font(theme.body_family, size=size)
        pdf.set_text_color(*theme.ink)
        pdf.set_draw_color(*theme.rule)
        pdf.set_line_width(0.2)
        with pdf.table(
            col_widths=_column_widths(texts, columns),
            line_height=4.6 * scale,
            text_align=Align.L,
            padding=(1.7, 2.4),
            borders_layout="HORIZONTAL_LINES",
            cell_fill_color=theme.tint,
            cell_fill_mode="EVEN_ROWS",
            headings_style=FontFace(
                family=theme.heading_family, emphasis="B", size_pt=size - 0.4,
                color=WHITE, fill_color=theme.table_head_bg,
            ),
            first_row_as_headings=bool(header_rows),
            repeat_headings=1,
        ) as table:
            fill(table)
        pdf.ln(theme.gap + 0.8)

    def _standalone_image(self, inline: Token, align: Align) -> bool:
        """A paragraph that is nothing but one image becomes a block image."""
        children = [child for child in (inline.children or []) if child.type != "softbreak"]
        if len(children) != 1 or children[0].type != "image":
            return False
        token = children[0]
        resolved = self._resolve_image(token)
        if resolved == PICTURE_NOT_SET:
            return True  # a picture Settings does not hold prints nothing; the check says so
        options = _image_options(_attr(token, "src"))
        figure = (_picture_ref(options.source), options.width, options.align)
        # an alignment written on the picture wins; else it stands as its block does
        place = ALIGNMENTS[options.align] if options.aligned else align
        # a caption written in the braces says more than a title, which is older
        title = options.caption or _attr(token, "title")
        if isinstance(resolved, _Picture) and resolved.built_in:
            # who made the document, not a figure of it: no number, no frame, and a
            # caption only when one is written
            self._place(resolved.path, resolved.natural, options.width, place, ("", title),
                        figure=figure, framed=False)
            return True
        number = 0 if isinstance(resolved, str) else self.cited.number(resolved.source)
        if isinstance(resolved, _Poster):
            if resolved.path is None:
                message = "Video not included in PDF."
                cited = f" [{number}]" if number else ""
                self._aside(f"{message} Watch it at {resolved.url}{cited}", link=resolved.url)
                return True
            caption = self._caption(title or f"Video: {token.content or 'untitled'}", token.content)
            self._place(resolved.path, resolved.natural, options.width, place, caption,
                        figure=figure, video=True, credit=resolved.credit, number=number)
            return True
        caption = self._caption(title, token.content)
        if resolved == CASE_PICTURE and self.case is None:
            self._placeholder(options.width, place, caption, figure=figure)
            return True
        if isinstance(resolved, str):
            if resolved == MEDIA_UNAVAILABLE:
                name = _cut_text(" ".join((token.content or "").split()) or "Untitled", 80)
                self._warn(f'Picture "{name}" is no longer in the case.', self._line, MISSING)
            self._aside(resolved)
            return True
        self._place(resolved.path, resolved.natural, options.width, place, caption,
                    figure=figure, credit=resolved.credit, number=number,
                    posted=resolved.source.posted if resolved.source is not None else "")
        return True

    def _caption(self, title: str, alt: str) -> tuple[str, str]:
        """What prints under a picture, as (label, words): its caption, as always;
        with numbered figures, `Figure 3` and the caption or, failing one, the alt
        text."""
        if not self.look.numbered:
            return "", title
        self._figures += 1
        return f"Figure {self._figures}", title or alt

    def _place(
        self,
        source: Path | BytesIO,
        natural: tuple[int, int],
        width_attr: str,
        align: Align,
        caption: tuple[str, str],
        *,
        figure: tuple[str, str, str] | None = None,
        video: bool = False,
        credit: _Credit | None = None,
        number: int = 0,
        unsized: float = UNSIZED_SHARE,
        framed: bool = True,
        posted: str = "",
    ) -> None:
        """Draw a picture as a block, its caption and credit kept on its page.

        ``figure`` (what it shows, its width and alignment as written) has the Page
        pane told where it landed; ``video`` marks a video's still. The caption is
        measured rather than guessed, so a picture never goes to the foot of a page
        that only has room for it and not for the words under it. ``number`` is its
        entry in the sources list, said after the credit. ``framed`` draws a styled
        look's hairline round it, which a logo or a signature does without.
        ``posted`` is where the analyst published it: the picture links there, and a
        line under its credit says so.
        """
        pdf = self.pdf
        theme = self.theme
        width, height = _fit(natural, width_attr, self._frame(), theme.room, unsized)
        also = _posted_credit(posted)
        if not theme.plain:
            pdf.ln(0.6)
        below = self._below(caption, credit, align, width, also)
        gap = None
        if pdf.will_page_break(height + below):
            room = pdf.page_break_trigger - pdf.get_y() - below - 0.5
            shrunk = width * room / height, room
            if (
                not width_attr
                and height * (1 - MAX_SHRINK) <= room
                and not pdf.will_page_break(shrunk[1] + self._below(caption, credit, align, shrunk[0], also))
            ):
                width, height = shrunk
            else:
                gap = self._gap(natural, below)
                pdf.add_page()
        self._picture(source, w=width, h=height, x=align, **({"link": also.link} if also else {}))
        left = self._left(align, width)
        top = pdf.get_y() - height
        if video:
            self._play_mark(left, top, width, height)
        if figure is not None:
            self._record(figure, (left, top, width, height), gap)
        if theme.plain:
            text = _caption_text(*caption)
            if text:
                pdf.ln(1)
                pdf.set_font(theme.heading_family, size=8 * theme.scale)
                pdf.set_text_color(*theme.muted)
                pdf.multi_cell(
                    pdf.epw, 4 * theme.scale, text, align=align, new_x=XPos.LMARGIN, new_y=YPos.NEXT
                )
            if credit is not None:
                self._credit_line(credit, align, pdf.l_margin, pdf.epw, number)
            if also is not None:
                self._credit_line(also, align, pdf.l_margin, pdf.epw)
            pdf.ln(theme.gap)
            return
        if framed:
            pdf.set_draw_color(*theme.rule)
            pdf.set_line_width(0.2)
            pdf.rect(left, top, width, height, style="D")
        box_left, box_width = self._caption_box(align, left, width)
        if caption[0] or caption[1]:
            self._figure_caption(caption, align, box_left, box_width)
        if credit is not None:
            self._credit_line(credit, align, box_left, box_width, number)
        if also is not None:
            self._credit_line(also, align, box_left, box_width)
        pdf.ln(theme.gap + 0.6)

    def _below(
        self, caption: tuple[str, str], credit: _Credit | None, align: Align, width: float, also: _Credit | None = None
    ) -> float:
        """How tall the caption and credit under a picture this wide will be, with
        the line saying where it was posted (``also``)."""
        pdf, theme = self.pdf, self.theme
        scale = theme.scale
        height = 0.0 if theme.plain else 1.0
        if theme.plain:
            text = _caption_text(*caption)
            if text:
                pdf.set_font(theme.heading_family, size=8 * scale)
                lines = pdf.multi_cell(pdf.epw, 4 * scale, text, align=align, dry_run=True, output="LINES")
                assert isinstance(lines, list)
                height += 1 + 4 * scale * max(1, len(lines))
        elif caption[0] or caption[1]:
            box = self._caption_box(align, self._left(align, width), width)[1]
            height += 1.6 + CAPTION_LEADING * scale * len(self._caption_lines(caption, box))
        for line in (credit, also):
            if line is not None:
                height += 0.6 + CREDIT_LEADING * scale
        return height

    def _caption_box(self, align: Align, left: float, width: float) -> tuple[float, float]:
        """The stretch a styled caption is set in: under the picture, as wide as it
        or a readable measure if it is narrow, and never past the margins."""
        pdf = self.pdf
        box = min(pdf.epw, max(width, CAPTION_MIN_WIDTH))
        if align is Align.C:
            x = left + (width - box) / 2
        elif align is Align.R:
            x = left + width - box
        else:
            x = left
        return max(pdf.l_margin, min(x, pdf.w - pdf.r_margin - box)), box

    def _caption_lines(self, caption: tuple[str, str], box: float) -> list[str]:
        """The caption's words cut into lines for its box, the first one shortened
        by the `Figure 3.` label in front of it."""
        pdf, theme = self.pdf, self.theme
        label, words = caption
        size = CAPTION_SIZE * theme.scale
        lead = 0.0
        if label:
            pdf.set_font(theme.heading_family, "B", size)
            lead = pdf.get_string_width(f"{label}. " if words else label)
        pdf.set_font(theme.heading_family, "", size)
        return _wrap_words(pdf, words, box, box - lead)

    def _figure_caption(self, caption: tuple[str, str], align: Align, box_left: float, box_width: float) -> None:
        """`Figure 3.` in the accent, the words after it in grey, under the picture."""
        pdf, theme = self.pdf, self.theme
        label, words = caption
        size = CAPTION_SIZE * theme.scale
        leading = CAPTION_LEADING * theme.scale
        lines = self._caption_lines(caption, box_width)
        lead = f"{label}. " if label and words else label
        pdf.set_font(theme.heading_family, "B", size)
        lead_width = pdf.get_string_width(lead) if lead else 0.0
        pdf.ln(1.6)
        for number, line in enumerate(lines):
            y = pdf.get_y()
            front = lead_width if number == 0 else 0.0
            pdf.set_font(theme.heading_family, "", size)
            total = front + pdf.get_string_width(line)
            x = _aligned(align, box_left, box_width, total)
            if number == 0 and lead:
                pdf.set_font(theme.heading_family, "B", size)
                pdf.set_text_color(*theme.accent)
                self._text_at(x, y, lead, leading)
                x += lead_width
                pdf.set_font(theme.heading_family, "", size)
            if line:
                pdf.set_text_color(*theme.muted)
                self._text_at(x, y, line, leading)
            pdf.set_xy(pdf.l_margin, y + leading)

    def _credit_line(
        self, credit: _Credit, align: Align, box_left: float, box_width: float, number: int = 0
    ) -> None:
        """Where a picture came from, in one small line: what kind of source in grey,
        then the place, linked when it is on the web, then its number in the sources
        list. Cut rather than wrapped."""
        pdf, theme = self.pdf, self.theme
        size = CREDIT_SIZE * theme.scale
        leading = CREDIT_LEADING * theme.scale
        pdf.ln(0.6)
        y = pdf.get_y()
        head = f"{credit.kind}: "
        tail = f" [{number}]" if number else ""
        pdf.set_font(theme.heading_family, "", size)
        head_width = pdf.get_string_width(head)
        tail_width = pdf.get_string_width(tail) if tail else 0.0
        value = notes_style.fit_line(pdf, credit.value, max(10.0, box_width - head_width - tail_width))
        total = head_width + pdf.get_string_width(value) + tail_width
        x = _aligned(align, box_left, box_width, total)
        pdf.set_text_color(*theme.muted)
        self._text_at(x, y, head, leading)
        pdf.set_text_color(*(theme.accent_dark if credit.link else theme.muted))
        self._text_at(x + head_width, y, value, leading, link=credit.link)
        if tail:
            pdf.set_text_color(*theme.accent)
            self._text_at(x + total - tail_width, y, tail, leading, link=self._entry_link(number))
        pdf.set_xy(pdf.l_margin, y + leading)

    def _text_at(self, x: float, y: float, text: str, height: float, *, link: str | int = "") -> None:
        """One run of text starting exactly at ``x``: a cell keeps a margin inside
        its left edge, so the cell is moved out by it."""
        pdf = self.pdf
        pdf.set_xy(x - pdf.c_margin, y)
        pdf.cell(pdf.get_string_width(text) + 2 * pdf.c_margin, height, text, link=link or "")

    def _left(self, align: Align, width: float) -> float:
        """Where fpdf2 puts a picture of this width aligned this way."""
        pdf = self.pdf
        if align is Align.C:
            return (pdf.w - width) / 2
        if align is Align.R:
            return pdf.w - pdf.r_margin - width
        return pdf.l_margin

    def _gap(
        self, natural: tuple[int, int], below: float
    ) -> tuple[int, float, float, int, float, float]:
        """The stretch a picture leaves empty when it goes to the next page (page,
        top, bottom, then left and right), and the width in percent of the frame
        that would have kept it there."""
        pdf = self.pdf
        top, bottom = pdf.get_y(), pdf.page_break_trigger
        wide, high = natural
        room = bottom - top - below - 0.5
        fit = 0
        if wide and high and room > 0:
            fit = min(99, math.floor(room * wide / high / self._frame() * 100))
        kept = fit if fit >= MIN_FIT_PERCENT else 0
        return pdf.page - 1, top, bottom, kept, pdf.l_margin, pdf.w - pdf.r_margin

    def _record(
        self,
        figure: tuple[str, str, str],
        placed: tuple[float, float, float, float],
        gap: tuple[int, float, float, int, float, float] | None,
    ) -> None:
        """Say where a picture of the note itself landed. One inside a chapter is
        written in another note, so its line here is not the one to edit."""
        if self._fixed or len(self.pictures) >= MAX_PAGE_PICTURES:
            return
        pdf = self.pdf
        ref, width_attr, align_name = figure
        left, top, width, height = placed
        fit = gap[3] if gap is not None else 0
        self.pictures.append(
            PagePicture(
                line=self._line,
                ref=ref,
                page=pdf.page - 1,
                box=(left / pdf.w, top / pdf.h, width / pdf.w, height / pdf.h),
                width=width_attr,
                align=align_name,
                gap=(gap[0], gap[1] / pdf.h, gap[2] / pdf.h, gap[4] / pdf.w, gap[5] / pdf.w)
                if gap is not None and fit
                else None,
                fit=fit,
            )
        )

    def _play_mark(self, left: float, top: float, width: float, height: float) -> None:
        """A play sign over a video's still, so the page says it is a video."""
        pdf = self.pdf
        radius = max(3.0, min(9.0, min(width, height) * 0.12))
        x, y = left + width / 2, top + height / 2
        with pdf.local_context(fill_opacity=0.55):
            pdf.set_fill_color(0, 0, 0)
            pdf.circle(x, y, radius, style="F")
        pdf.set_fill_color(255, 255, 255)
        side = radius * 0.9
        pdf.polygon(
            [(x - side * 0.4, y - side * 0.55), (x - side * 0.4, y + side * 0.55), (x + side * 0.6, y)],
            style="F",
        )

    def _picture(self, source: Path | BytesIO, **options: Any) -> None:
        if isinstance(source, Path):
            light = PREVIEWS.get(source, self._pane_side(options)) if self.light else None
            if light is not None:
                self.pdf.image(light, **options)
                return
            DECODED.place(self.pdf, source, self._render, **options)
        else:
            self.pdf.image(source, **options)

    def _pane_side(self, options: dict[str, Any]) -> int:
        """The fewest pixels a picture needs in the page pane, by the room it takes."""
        drawn = max(float(options.get("w") or 0), float(options.get("h") or 0))
        needed = drawn / self.pdf.w * PANE_PIXELS if drawn else PANE_PIXELS
        return next((side for side in PREVIEW_SIDES if needed <= side), PREVIEW_SIDES[-1])

    def _placeholder(
        self,
        width_attr: str,
        align: Align,
        caption: tuple[str, str],
        *,
        figure: tuple[str, str, str] | None = None,
    ) -> None:
        """Where a template's picture will go: a grey field, named."""
        pdf, theme = self.pdf, self.theme
        width = _fit((1600, 900), width_attr or "100%", self._frame(), theme.room)[0]
        height = min(width * 0.5, 62.0)
        if pdf.will_page_break(height + self._below(caption, None, align, width)):
            pdf.add_page()
        left = self._left(align, width)
        top = pdf.get_y()
        if figure is not None:
            self._record(figure, (left, top, width, height), None)
        pdf.set_fill_color(*mix(theme.rule, WHITE, 0.55))
        pdf.set_draw_color(*theme.rule)
        pdf.set_line_width(0.2)
        pdf.rect(left, top, width, height, style="DF")
        pdf.set_font(theme.heading_family, "", 8.5)
        pdf.set_text_color(*theme.muted)
        pdf.set_xy(left, top + height / 2 - 2.5)
        pdf.cell(width, 5, CASE_PICTURE, align=Align.C)
        pdf.set_xy(pdf.l_margin, top + height)
        text = _caption_text(*caption)
        if text:
            if theme.plain:
                pdf.ln(1)
                pdf.set_font(theme.heading_family, size=8 * theme.scale)
                pdf.set_text_color(*theme.muted)
                pdf.multi_cell(pdf.epw, 4 * theme.scale, text, align=align,
                               new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            else:
                self._figure_caption(caption, align, *self._caption_box(align, left, width))
        pdf.ln(theme.gap)

    def _diagram(self, source: str) -> None:
        """The PNG the browser drew for this fence, or the fence's own source."""
        key = diagram_key(source)
        png = self.diagrams.get(key)
        natural = _diagram_size(png) if png else None
        if png is None or natural is None:
            self.missing.setdefault(key, source)
            self._aside("Diagram not drawn.")
            self._code_box(source)
            return
        self._place(BytesIO(png), natural, "", Align.C, self._caption("", ""), unsized=1.0)

    def _poster(self, attrs: dict[str, Any], source: Source | None) -> "_Poster | str":
        """A video prints as its thumbnail with a play sign, and where it can be
        watched: its own page, or the one of the video it was made from. With
        neither, the line it always printed."""
        url = source.traced_address if source is not None else _web(str(attrs.get("source_url") or ""))
        still = thumbnails.thumb_relpath(str(attrs.get("sha256") or ""), "video")
        if still and self.case is not None and self.images < MAX_IMAGES:
            try:
                path = self.case.resolve_inside(still)
            except Exception:
                path = None
            natural = _measure(path) if path is not None and path.is_file() else None
            if path is not None and natural is not None:
                self.images += 1
                return _Poster(path, natural, url, source)
        if url:
            return _Poster(None, (0, 0), url, source)
        return "Video not included in PDF."

    def _resolve_image(self, token: Token) -> "_Picture | _Poster | str":
        """The file behind an image, or the line to print instead of it."""
        src = _attr(token, "src")
        source = _image_options(src).source
        built_in = notefill.picture_name(source)
        if built_in is not None:
            return self._built_in(built_in)
        parts = urlsplit(source)
        if parts.scheme in ("http", "https"):
            self._remote += 1
            if self._remote_line is None:
                self._remote_line = self._line
            return "External image not included in PDF."
        if self.case is None:
            if (parts.scheme == "azimut" and parts.netloc == "media") or source.startswith("/files/"):
                return CASE_PICTURE
            return "Image not included in PDF."
        if parts.scheme == "azimut" and parts.netloc == "media":
            record = self.case.get_entity(unquote(parts.path.lstrip("/")))
            attrs = (record or {}).get("attrs") or {}
            if not record or not attrs.get("path"):
                return MEDIA_UNAVAILABLE
            if attrs.get("kind") == "video":
                return self._poster(attrs, self.cited.image_source(src))
            relative = str(attrs["path"])
        elif (prefix := next((one for one in self._file_prefixes if source.startswith(one)), "")):
            relative = unquote(source[len(prefix) :])
        else:
            return "Image not included in PDF."
        if self.images >= MAX_IMAGES:
            return "Image not included in PDF: this note holds too many."
        try:
            path = self.case.resolve_inside(relative)
        except Exception:
            return MEDIA_UNAVAILABLE
        natural = _measure(path)
        if natural is None:
            return MEDIA_UNAVAILABLE
        self.images += 1
        # where it came from, as the one reading of sources says it (`notesources`)
        shown = self.cited.image_source(src)
        return _Picture(path, natural, shown.credit() if shown is not None else None, shown)


    def _built_in(self, name: str) -> "_Picture | str":
        """One of the three pictures every note can show, from Settings or the app:
        nothing while it is not set, or not readable."""
        path = self.cited.identity.picture(name)
        if path is None:
            return PICTURE_NOT_SET
        natural = notefill.AZIMUT_LOGO_SIZE if name == notefill.LOGO else _measure(path)
        if natural is None:
            return PICTURE_NOT_SET
        if self.images >= MAX_IMAGES:
            return "Image not included in PDF: this note holds too many."
        self.images += 1
        return _Picture(path, natural, built_in=True)


class _Indent:
    """Move the left margin in for as long as a block is being drawn."""

    def __init__(self, pdf: FPDF, amount: float) -> None:
        self.pdf = pdf
        self.amount = amount

    def __enter__(self) -> None:
        self.pdf.set_left_margin(self.pdf.l_margin + self.amount)
        self.pdf.set_x(self.pdf.l_margin)

    def __exit__(self, *_: Any) -> None:
        self.pdf.set_left_margin(self.pdf.l_margin - self.amount)
        self.pdf.set_x(self.pdf.l_margin)


class _Inset(_Indent):
    """Both margins in, for the inside of a box."""

    def __init__(self, pdf: FPDF, left: float, right: float) -> None:
        super().__init__(pdf, left)
        self.right = right

    def __enter__(self) -> None:
        self.pdf.set_right_margin(self.pdf.r_margin + self.right)
        super().__enter__()

    def __exit__(self, *rest: Any) -> None:
        self.pdf.set_right_margin(self.pdf.r_margin - self.right)
        super().__exit__(*rest)


def _level(tag: str, shift: int) -> int:
    """A heading's level once its chapter has moved it, kept between 1 and 6."""
    return max(1, min(6, int(tag[1]) + shift))


TASK_MARK = re.compile(r"^\[([ xX])\]\s+")


def _task_state(tokens: list[Token], index: int) -> bool | None:
    """Whether the list item at ``index`` is a done task, an open one (False), or
    no task at all (None), read without touching it."""
    if index + 2 >= len(tokens) or tokens[index + 1].type != "paragraph_open":
        return None
    inline = tokens[index + 2]
    match = TASK_MARK.match(inline.content)
    children = inline.children or []
    if match is None or not children or children[0].type != "text":
        return None
    if not children[0].content.startswith(match.group(0)):
        return None
    return match.group(1) != " "


def _take_task(tokens: list[Token], index: int) -> bool | None:
    """A list item that opens with `[ ]` or `[x]`: whether it is done, the marker
    taken out of its text. None for an ordinary item."""
    state = _task_state(tokens, index)
    if state is None:
        return None
    inline = tokens[index + 2]
    match = TASK_MARK.match(inline.content)
    assert match is not None
    children = inline.children or []
    inline.content = inline.content[match.end():]
    children[0].content = children[0].content[match.end():]
    return state


def _cut_runs(runs: list[Run], start: int) -> list[Run]:
    """The runs from character ``start`` of their plain text on, styles kept."""
    kept: list[Run] = []
    seen = 0
    for run in runs:
        end = seen + len(run.text)
        if end > start:
            cut = max(0, start - seen)
            kept.append(replace(run, text=run.text[cut:]))
        seen = end
    return [run for run in kept if run.text.strip()]


def _nothing_after(tokens: list[Token], index: int) -> bool:
    """Whether nothing that prints follows ``index`` in a stretch: its end, or only
    comments, which print nothing."""
    return all(
        token.type == "html_block" and COMMENT.match(token.content.strip()) is not None
        for token in tokens[index:]
    )


def _callout_kind(tokens: list[Token], index: int) -> str:
    """The kind a quote opens with, `confirmed` for `> [!confirmed]`, read without
    touching the tokens."""
    if index + 2 >= len(tokens) or tokens[index + 1].type != "paragraph_open":
        return ""
    match = CALLOUT.match(f">{tokens[index + 2].content}")
    kind = match.group(2).lower() if match else ""
    return kind if kind in CALLOUTS else ""


def _past(tokens: list[Token], index: int) -> int:
    """The index after the block that opens at ``index``."""
    opening = tokens[index]
    closing = opening.type.replace("_open", "_close")
    for position in range(index + 1, len(tokens)):
        if tokens[position].type == closing and tokens[position].level == opening.level:
            return position + 1
    return len(tokens)


def _take_callout(tokens: list[Token], index: int) -> tuple[str, tuple[int, int, int]] | None:
    """A quote opening with `[!kind]`: its label and colour, the marker taken out of its text.

    The Notebook draws the same six kinds (`lib/notes/callouts.js`). An unknown kind
    stays a plain quote with its marker written, as GitHub leaves it.
    """
    if index + 2 >= len(tokens) or tokens[index + 1].type != "paragraph_open":
        return None
    inline = tokens[index + 2]
    match = CALLOUT.match(f">{inline.content}")
    kind = CALLOUTS.get(match.group(2).lower()) if match else None
    if match is None or kind is None:
        return None
    marker = match.group(0)[1:]
    inline.content = inline.content[len(marker):]
    children = inline.children or []
    if children and children[0].type == "text" and children[0].content.startswith(marker.rstrip()):
        children[0].content = children[0].content[len(marker.rstrip()):].lstrip()
        if not children[0].content and len(children) > 1 and children[1].type == "softbreak":
            del children[:2]
    return kind


def _skip_repeated_title(tokens: list[Token], title: str) -> int:
    """Where to start reading, past a heading that only repeats the title.

    Plenty of notes open by restating their own name as an `# H1`. On screen
    that is the only title there is; here the page already carries it.
    """
    if len(tokens) < 3 or tokens[0].type != "heading_open" or tokens[0].tag != "h1":
        return 0
    heading = (tokens[1].content or "").strip().casefold()
    return 3 if heading == title.strip().casefold() else 0


def _plain(runs: Iterable[Run]) -> str:
    return "".join(run.text for run in runs)


def _caption_text(label: str, words: str) -> str:
    """A caption as one line of text: `Figure 3. Smoke over the port`."""
    return f"{label}. {words}" if label and words else label or words


def _aligned(align: Align, left: float, width: float, total: float) -> float:
    """Where a line ``total`` wide starts inside a stretch, aligned this way."""
    if align is Align.C:
        return left + max(0.0, width - total) / 2
    if align is Align.R:
        return left + max(0.0, width - total)
    return left


def _wrap_words(pdf: FPDF, text: str, width: float, first: float) -> list[str]:
    """``text`` cut into lines no wider than ``width`` in the current font, the
    first no wider than ``first``. A word wider than a whole line (an address) is
    cut where it has to be rather than run past the margin."""
    lines: list[str] = []
    line = ""
    reach = 0.0  # the line's width, its words and spaces added up
    room = first
    space = pdf.get_string_width(" ")
    for word in text.split():
        candidate = f"{line} {word}" if line else word
        # Added up, a line is within a hair of its measure, so only a line near the
        # room is measured whole: shaping every longer line again was most of the
        # cost of a long sources list.
        guess = reach + space + pdf.get_string_width(word) if line else pdf.get_string_width(word)
        near = WRAP_SLACK * room
        if guess <= room - near or (guess <= room + near and pdf.get_string_width(candidate) <= room):
            line, reach = candidate, guess
            continue
        if line:
            lines.append(line)
            room = width
        while pdf.get_string_width(word) > room:
            cut = max(1, notes_style.longest_prefix(partial(_prefix_fits, pdf, word, room), len(word)))
            lines.append(word[:cut])
            word = word[cut:]
            room = width
        line, reach = word, pdf.get_string_width(word)
    lines.append(line)
    return lines


def _prefix_fits(pdf: FPDF, word: str, room: float, length: int) -> bool:
    return bool(pdf.get_string_width(word[:length]) <= room)


#: How far off a line's added-up width may be from its measure, as a share of the
#: room: kerning across a space, never near this much.
WRAP_SLACK = 0.02


def _inline_text(token: Token) -> str:
    """An inline token's words, read without drawing (or counting) its pictures."""
    return "".join(
        child.content
        for child in token.children or []
        if child.type in ("text", "code_inline") or (child.type == "html_inline" and not child.content.startswith("<!--"))
    )


def _prints(tokens: list[Token], index: int) -> bool:
    """Whether the block opening at ``index`` puts anything on the page: a rule, a
    page break or a comment does not, and neither does a paragraph of guidance."""
    token = tokens[index]
    if token.type == "paragraph_open":
        inline = tokens[index + 1] if index + 1 < len(tokens) else None
        if inline is None:
            return False
        return bool(_inline_text(inline).strip()) or any(
            child.type == "image" for child in inline.children or []
        )
    if token.type == "html_block":
        text = token.content.strip()
        return bool(text) and not PAGE_BREAK.match(text) and not COMMENT.match(text)
    return token.type not in ("hr", "heading_open")


def _cut_text(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"


#: Where an address is checked and named: the one reading of sources does both.
_web = notesources.web
_host = notesources.host


def _wrap_address(pdf: FPDF, text: str, first: float, width: float) -> list[str]:
    """An address cut into lines no wider than ``width`` in the current font, the
    first no wider than ``first``, every character kept. Each cut falls after a
    `/`, `?`, `&` or the like when one is near the end of the line, so a wrapped
    address still reads as one."""
    lines: list[str] = []
    rest = text
    room = first
    while rest:
        if pdf.get_string_width(rest) <= room:
            lines.append(rest)
            break
        low, high = 1, len(rest)
        while low < high:  # the longest start of it that fits
            middle = (low + high + 1) // 2
            if pdf.get_string_width(rest[:middle]) <= room:
                low = middle
            else:
                high = middle - 1
        cut = max(1, low)
        soft = max((at + 1 for at in range(cut) if rest[at] in ADDRESS_BREAKS), default=0)
        if soft > cut * 0.6:
            cut = soft
        lines.append(rest[:cut])
        rest = rest[cut:]
        room = width
    return lines or [""]


def _hard_wrap(line: str, pdf: FPDF, width: float) -> list[str]:
    """Break a code line too wide for the page.

    Code is preformatted, so nothing else will break it, and a line that runs
    past the frame is a line the reader loses.
    """
    if not line:
        return [""]
    if pdf.get_string_width(line) <= width:
        return [line]
    per_char = pdf.get_string_width("0") or 1
    size = max(8, int(width / per_char))
    return [line[start : start + size] for start in range(0, len(line), size)]


def _measure(source: Path | BytesIO) -> tuple[int, int] | None:
    """A picture's size in pixels, the way it is seen: a JPEG a phone took on its
    side and marked so in its EXIF is as wide as it is drawn upright."""
    try:
        with PILImage.open(source) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                return None
            if image.format == "JPEG" and _orientation(image) in TURNED:
                return image.height, image.width
            return image.width, image.height
    except (OSError, UnidentifiedImageError, PILImage.DecompressionBombError):
        return None
    finally:
        if isinstance(source, BytesIO):
            source.seek(0)


#: EXIF orientations that swap a picture's width and height once it is upright.
TURNED = (5, 6, 7, 8)
#: The JPEG segments that say more than the picture: EXIF (with its GPS) and XMP
#: in APP1, IPTC in APP13, free text in COM. ICC colour (APP2) and the Adobe
#: segment a CMYK file needs (APP14) stay.
PRIVATE_SEGMENTS = frozenset({0xE1, 0xED, 0xFE})


def _orientation(image: PILImage.Image) -> int:
    try:
        value = image.getexif().get(0x0112, 1)
    except Exception:  # a broken EXIF block says nothing about the pixels
        return 1
    return value if isinstance(value, int) else 1


def _strip_jpeg(data: bytes) -> bytes | None:
    """The JPEG with its metadata segments taken out and its image data byte for
    byte, or None when its markers do not walk cleanly."""
    if data[:2] != b"\xff\xd8":
        return None
    out = bytearray(data[:2])
    position = 2
    while position + 4 <= len(data):
        if data[position] != 0xFF:
            return None
        marker = data[position + 1]
        if marker == 0xFF:  # a fill byte before the marker
            position += 1
            continue
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            out += data[position : position + 2]
            position += 2
            continue
        length = int.from_bytes(data[position + 2 : position + 4], "big")
        if length < 2 or position + 2 + length > len(data):
            return None
        if marker == 0xDA:  # the scan: compressed pixels from here to the end
            out += data[position:]
            return bytes(out)
        if marker not in PRIVATE_SEGMENTS:
            out += data[position : position + 2 + length]
        position += 2 + length
    return None


def _clean_jpeg(data: bytes) -> bytes | None:
    """A JPEG as it may go into a shared PDF, or None when ``data`` is no JPEG.

    Taken apart rather than decoded, so the picture is the same to the bit. One
    turned by its EXIF orientation is drawn upright first, as every viewer shows
    it, since the PDF has no other way to know; that one is encoded again. So is
    one whose segments cannot be walked: losing a little quality beats leaking
    what the file knew.
    """
    if data[:2] != b"\xff\xd8":
        return None
    try:
        with PILImage.open(BytesIO(data)) as image:
            turned = _orientation(image) not in (1, 0)
            stripped = None if turned else _strip_jpeg(data)
            if stripped is not None:
                return stripped
            profile = image.info.get("icc_profile")
            upright = ImageOps.exif_transpose(image)
            if upright.mode not in ("RGB", "L", "CMYK"):
                upright = upright.convert("RGB")
            # Pillow writes back a comment and XMP it read unless told otherwise
            upright.info = {}
            buffer = BytesIO()
            upright.save(buffer, "JPEG", quality=92, **({"icc_profile": profile} if profile else {}))
            return buffer.getvalue()
    except (OSError, UnidentifiedImageError, PILImage.DecompressionBombError):
        return _strip_jpeg(data)


def _clean_jpeg_file(path: Path) -> bytes | None:
    """`_clean_jpeg` for a file, read only when it starts like a JPEG."""
    try:
        with path.open("rb") as handle:
            if handle.read(2) != b"\xff\xd8":
                return None
            return _clean_jpeg(b"\xff\xd8" + handle.read())
    except OSError:
        return None


def _diagram_size(png: bytes) -> tuple[int, int] | None:
    """A diagram's size on screen: the browser drew it at twice that."""
    natural = _measure(BytesIO(png))
    if natural is None:
        return None
    return max(1, natural[0] // DIAGRAM_PIXEL_SCALE), max(1, natural[1] // DIAGRAM_PIXEL_SCALE)


def _picture_ref(source: str) -> str:
    """What a picture shows, as the Page pane finds its line again: `media:<id>`
    for a case media, else the address as written."""
    parts = urlsplit(source)
    if parts.scheme == "azimut" and parts.netloc == "media":
        return f"media:{unquote(parts.path.lstrip('/'))}"
    return source


def _fit(
    natural: tuple[int, int],
    width_attr: str,
    available: float,
    room: float = PLAIN.room,
    unsized: float = UNSIZED_SHARE,
) -> tuple[float, float]:
    """Size an image the way the preview does, then keep it inside the page: the whole
    page for a width written, ``unsized`` of it down for a picture with none."""
    pixels_wide, pixels_high = natural
    ratio = pixels_high / pixels_wide if pixels_wide else 1.0
    if width_attr.endswith("%"):
        width = available * float(width_attr[:-1]) / 100
    elif width_attr.endswith("px"):
        width = float(width_attr[:-2]) * PX_TO_MM
    else:
        width = pixels_wide * PX_TO_MM
    width = min(width, available)
    height = width * ratio
    # A tall image left at full width runs off the bottom of the page, and fpdf2
    # will not split a picture. Scale it down instead of losing it.
    limit = room if width_attr else room * unsized
    if height > limit:
        width *= limit / height
        height = limit
    return width, height


def _column_widths(rows: list[list[str]], columns: int) -> list[float]:
    """Share the width out by how much text each column holds, with a floor.

    An even split turns a table of one long column and three short ones into a
    column of single words; weighting by content is what makes it readable.
    """
    weights = [
        max(1.0, max(len(row[column]) for row in rows) ** 0.5) for column in range(columns)
    ]
    floor = 8.0
    room = 100.0 - floor * columns
    total = sum(weights)
    return [floor + room * weight / total for weight in weights]


__all__ = [
    "NotesPdfError",
    "Piece",
    "Rendered",
    "diagram_key",
    "expand",
    "mermaid_sources",
    "render",
]
