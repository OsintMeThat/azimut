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
caption where it came from, and decimal coordinates link to the map.
"""

from __future__ import annotations

import hashlib
import math
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date, datetime
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

from . import entities, notes_style, pdffonts, thumbnails, timeline
from .notelook import DEFAULT as DEFAULT_LOOK
from .notelook import NoteLook
from .notes_style import PLAIN, WHITE, NotePage, Theme, mix
from .proposals import URL_ATTRS
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
#: The browser draws a diagram at twice its size on screen, for a sharp print.
DIAGRAM_PIXEL_SCALE = 2
#: An HTML comment: hidden by every Markdown reader, and so by the PDF too.
COMMENT = re.compile(r"\A(?:\s*<!--.*?-->)+\s*\Z", re.S)

MERMAID_INFO = re.compile(r"^\s*mermaid\b")
IMAGE_ATTRS = re.compile(r"!\[([^\]]*)\]\((\S+?)(?:\s+[\"']([^\"']*)[\"'])?\)\s*\{([^}\n]+)\}")
ALIGNMENT_BLOCK = re.compile(r"^:::[ \t]*(left|center|right)[ \t]*\n(.*?)^:::[ \t]*$", re.S | re.M)
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

#: The callouts a quote can open with, as `> [!confirmed]`, their label and colour.
CALLOUTS: dict[str, tuple[str, tuple[int, int, int]]] = {
    "confirmed": ("Confirmed", (46, 125, 50)),
    "unverified": ("Unverified", (189, 122, 37)),
    "lead": ("Lead", (30, 100, 170)),
    "note": ("Note", (119, 119, 119)),
    "warning": ("Warning", (178, 52, 40)),
}

#: What a document without a case shows where a case would show its own: a
#: template's preview never reads a case file.
CASE_PICTURE = "Picture from the case"
CASE_CHAPTER = "A note included here prints as a chapter."
#: What prints where a picture of the case is gone or unreadable.
MEDIA_UNAVAILABLE = "Media unavailable"

#: A styled caption's face size and leading, in points and millimetres, before the
#: look's text size; and the narrowest it is set, so a small picture's caption
#: is not a column of single words.
CAPTION_SIZE = 7.8
CAPTION_LEADING = 3.8
CAPTION_MIN_WIDTH = 90.0
#: The credit line under it, a step quieter.
CREDIT_SIZE = 7.2
CREDIT_LEADING = 3.6

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
    #: For each page, the line of the note it starts at (best effort). A page
    #: inside a chapter starts at the chapter's include line.
    pages: list[int] = field(default_factory=list)
    #: The Mermaid fences drawn as source because no picture came with them, as
    #: (key, source), for the caller to draw and send back.
    diagrams: list[tuple[str, str]] = field(default_factory=list)
    #: Where each picture of the note itself landed, for the Page pane.
    pictures: list["PagePicture"] = field(default_factory=list)


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


@dataclass(frozen=True)
class _Credit:
    """The small line under a picture saying where it came from: what kind of
    source (`Source`, `Imagery`, `Watch`), the place, and the address it links to
    ("" for none)."""

    kind: str
    value: str
    link: str = ""


@dataclass
class _Picture:
    """A picture of the case, its size in pixels, and where it came from."""

    path: Path
    natural: tuple[int, int]
    credit: _Credit | None = None


@dataclass
class _Poster:
    """A video in a note: the still its thumbnail holds, when there is one, and
    the address it can be watched at, when its source is on the web."""

    path: Path | None
    natural: tuple[int, int]
    url: str

    @property
    def credit(self) -> _Credit | None:
        return _Credit("Watch", _host(self.url), self.url) if self.url else None


class ImageOptions(NamedTuple):
    """What a picture's braces say: its source with the braces taken out, its
    width and alignment as written, and its caption."""

    source: str
    width: str
    align: str
    caption: str


@dataclass
class Run:
    """A stretch of text drawn in one face, colour and link."""

    text: str
    bold: bool = False
    italic: bool = False
    mono: bool = False
    color: tuple[int, int, int] = INK
    link: str = ""


def diagram_key(source: str) -> str:
    """Identify a Mermaid fence by its source, not by its position.

    The browser draws the diagrams and posts them back, so both sides have to
    agree on which PNG belongs to which fence. A hash survives a fence being
    moved while the export was in flight, and makes two identical diagrams in
    one note share a single upload.
    """
    return hashlib.sha256(source.strip().encode("utf-8")).hexdigest()[:16]


def mermaid_sources(text: str, *, resolve: Resolve | None = None, note_id: str = "") -> list[str]:
    """Every Mermaid fence in a note and the chapters it prints, in document order.

    The caller draws these; it is here rather than in the frontend so one parser
    decides what counts as a diagram.
    """
    return [
        token.content
        for piece in expand("", text, resolve=resolve, note_id=note_id)
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
) -> Rendered:
    """Lay one note out as a PDF.

    ``case`` is None for a template's preview: references to a case then draw as
    neutral placeholders and no case file is read, and an empty section is not
    worth a warning, since a template is headings waiting for words. ``resolve``
    finds the notes a chapter line includes; without it they print as a
    placeholder too.
    ``created`` pins the document's creation date, which is otherwise now.
    """
    look = look or DEFAULT_LOOK
    theme = notes_style.theme_for(look)
    day = date.fromisoformat(look.cover.date) if look.cover.date else (created or datetime.now()).date()
    pieces = expand(title, text, resolve=resolve, note_id=note_id)
    document = NotePage(title=title, theme=theme, look=look, day=day)
    if created is not None:
        document.set_creation_date(created)
    words = "\n".join([title, look.cover.subtitle, *(piece.text for piece in pieces)])
    faces = pdffonts.install(document, words, body=theme.body_family, font=look.font)
    builder = _Builder(document, case, diagrams or {}, look=look, faces=faces)
    try:
        builder.build(title, pieces)
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
        pages=builder.pages,
        diagrams=list(builder.missing.items()),
        pictures=builder.pictures,
    )


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
) -> list[Piece]:
    """The note cut at its include lines, each chapter's note spliced in.

    Guidance lines are emptied first (lines kept, so line numbers still hold).
    """
    pieces: list[Piece] = []
    budget = [MAX_CHAPTERS]
    _expand_into(pieces, title, without_hints(text), resolve=resolve,
                 chain=(note_id,) if note_id else (), depth=0, at=None, budget=budget, source=0)
    return pieces


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
) -> None:
    lines = text.split("\n")
    start = 0
    fenced = False
    opens: str | None = title

    def flush(end: int) -> None:
        nonlocal opens
        segment = "\n".join(lines[start:end])
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
            pieces.append(Piece("aside", "The note included here is no longer in the case.", depth, where, True))
            continue
        chapter_title, chapter_text = found
        budget[0] -= 1
        number = MAX_CHAPTERS - budget[0]
        pieces.append(Piece("chapter", chapter_title, depth + 1, where, True, None, number))
        _expand_into(pieces, chapter_title, without_hints(chapter_text), resolve=resolve,
                     chain=(*chain, target), depth=depth + 1, at=where, budget=budget, source=number)
    flush(len(lines))


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
    return ImageOptions(source, width, align if align in ALIGNMENTS else "left", caption)


def _parser() -> MarkdownIt:
    """CommonMark plus the two GFM rules the preview enables (marked's `gfm`)."""
    return MarkdownIt("commonmark").enable(["table", "strikethrough"])


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


# -- Markdown to a page ------------------------------------------------------


@dataclass
class _Block:
    """One parsed stretch of a piece, with its alignment and first line."""

    align: Align
    tokens: list[Token]
    line: int
    start: int = 0


@dataclass
class _Entry:
    """A journal entry being drawn: its column's indent, its rule, and how far
    down its gutter text runs on the page it began on."""

    indent: float
    box: notes_style.Box
    bottom: float
    page: int


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
    ) -> None:
        self.pdf = pdf
        self.case = case
        self.diagrams = diagrams
        self.look = look or DEFAULT_LOOK
        self.theme: Theme = getattr(pdf, "theme", PLAIN)
        #: The (family, style) pairs this document loaded, so emphasis it lacks borrows.
        self.faces = faces if faces is not None else set(pdffonts.CORE_FACES)
        self.warnings: list[str] = []
        self.warning_lines: list[int | None] = []
        #: The line of the first remote image left out, which its warning points at.
        self._remote_line: int | None = None
        self.images = 0
        self.pictures: list[PagePicture] = []
        self._page_lines: dict[int, int] = {}
        self.missing: dict[str, str] = {}
        #: How deep inside nested lists the walk currently is.
        self._depth = 0
        self._remote = 0
        # The Notebook writes the case's name the way a browser does (`lib/fileUrl.js`),
        # so a case called "Port strike" is `/files/Port%20strike/…` in its notes.
        self._file_prefixes = (
            tuple(dict.fromkeys((f"/files/{_quote(case.id)}/", f"/files/{case.id}/"))) if case is not None else ()
        )
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
        pdf.on_page = self._page_begins
        self._render = DECODED.begin()
        pdf.place_picture = lambda source, **options: self._picture(source, **options)

    # -- entry point --------------------------------------------------------

    def build(self, title: str, pieces: list[Piece]) -> None:
        theme, look, pdf = self.theme, self.look, self.pdf
        blocks = {id(piece): self._alignment_blocks(piece.text) for piece in pieces if piece.kind == "text"}
        self._prescan(pieces, blocks)
        if self.case is not None:
            self._empty_sections(pieces, blocks)
        if look.cover.on:
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
        for piece in pieces:
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
            for block in blocks[id(piece)]:
                self._block_line = piece.line + (0 if piece.fixed else block.line)
                drawn = self._walk(block.tokens, block.start, block.align, stop=None)[0] or drawn
            self._end_entry()
        if not drawn:
            self._aside("This note is empty.")

    def _page_begins(self) -> None:
        self._page_lines[self.pdf.page] = self._line

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
            self._warn(f'Section "{_cut_text(name, 80)}" is empty.', line)
        rest = len(empty) - MAX_EMPTY_SECTIONS
        if rest > 0:
            self._warn(f"{rest} more section{'s are' if rest > 1 else ' is'} empty.")

    def _warn(self, message: str, line: int | None = None) -> None:
        """Say what the page could not show, and the note's line it is about."""
        self.warnings.append(message)
        self.warning_lines.append(line)

    # -- the first page -----------------------------------------------------

    def _title_block(self, title: str) -> None:
        style = self.theme.style
        if self.look.cover.on and style != "brief":
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
            self._warn("The cover picture is no longer in the case; the cover was drawn without it.")
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

    def _alignment_blocks(self, text: str) -> list[_Block]:
        """Parse the note, honouring the `::: center` blocks around parts of it.

        Each block is parsed on its own so its alignment can be pushed into
        everything it produced, which is how the preview reads it too.
        """
        blocks: list[_Block] = []
        position = 0
        for match in ALIGNMENT_BLOCK.finditer(text):
            blocks.append(_Block(Align.L, self._parse(text[position : match.start()]),
                                 text.count("\n", 0, position)))
            blocks.append(_Block(ALIGNMENTS[match.group(1)], self._parse(match.group(2)),
                                 text.count("\n", 0, match.start(2))))
            position = match.end()
        blocks.append(_Block(Align.L, self._parse(text[position:]), text.count("\n", 0, position)))
        return blocks

    def _parse(self, source: str) -> list[Token]:
        return _parser().parse(_case_references(source)) if source.strip() else []

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
    ) -> None:
        """A heading at ``level`` (1 to 6, after a chapter's shift), numbered and
        bookmarked when the look asks, kept with what follows it."""
        theme = self.theme
        tag = f"h{level}"
        size, space = theme.headings.get(tag, theme.headings["h6"])
        pdf = self.pdf
        number = self._number(level)
        if theme.plain:
            if pdf.get_y() > theme.margin_top + 2:
                pdf.ln(space)
            # A heading alone at the foot of a page belongs with what follows it, so
            # what follows is measured rather than assumed: two lines of text is one
            # thing to reserve, a full-width capture is another.
            if pdf.will_page_break(size * 0.7 + self._next_height(tokens, after)):
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
        self._styled_heading(runs, level, number, tokens, after, align)

    def _styled_heading(
        self,
        runs: list[Run],
        level: int,
        number: str,
        tokens: list[Token],
        after: int,
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
        if pdf.will_page_break(size * 0.7 + 4 + self._next_height(tokens, after)):
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
        name = " ".join(_plain(runs).split())
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
        if theme.style == "report" and piece.depth == 1:
            if pdf.get_y() > pdf.t_margin + 4 and (pdf.page, pdf.get_y()) != self._opening:
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
        elif token.type == "blockquote_open" and not theme.plain:
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
        if not self.theme.plain:
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
            elif kind == "link_close":
                link, entity = "", 0
            elif kind == "image":
                runs.append(self._inline_image(child))
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
                    runs.extend(self._coordinates(run))
                else:
                    runs.append(run)
        return [run for run in runs if run.text]

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
        entity = re.match(r"^azimut://entity/([A-Za-z0-9_-]+)$", href)
        if entity:
            if self.case is None:
                return "", 1
            record = self.case.get_entity(entity.group(1))
            if record is None:
                return "", 2
            address = _web_address(record)
            return (address, 0) if address else ("", 1)
        return href, 0

    def _inline_image(self, token: Token) -> Run:
        """An image inside a run of text: named, not drawn.

        fpdf2 places a picture at a point on the page, not in the middle of a
        wrapping line, and a note that inlines a capture means it to be seen —
        so it is drawn as its own block instead (`_standalone_image`).
        """
        resolved = self._resolve_image(token)
        label = resolved if isinstance(resolved, str) else (token.content or "Image")
        link = resolved.url if isinstance(resolved, _Poster) else ""
        return Run(text=f"[{label}]", italic=True, color=self.theme.muted, link=link)

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
        was, or the room left between the current margins."""
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
            # An aligned paragraph needs the whole line before it can be placed,
            # so it is drawn as one string and gives up its inline styling.
            pdf.set_font(family, "B" if bold else "", size)
            pdf.set_text_color(*color)
            pdf.multi_cell(
                pdf.epw, leading, _plain(runs), align=align, new_x=XPos.LMARGIN, new_y=YPos.NEXT
            )
            pdf.ln(bottom)
            return
        # `write` keeps a cell margin on each side before it breaks, so the edge
        # it measures against is inside the one the page declares.
        right = self.theme.page_width - pdf.r_margin - 2 * pdf.c_margin
        for run in runs:
            run_family, emphasis = self._face(
                pdffonts.MONO if run.mono else family, run.bold or bold, run.italic
            )
            pdf.set_font(run_family, emphasis, size * (0.92 if run.mono else 1.0))
            pdf.set_text_color(*(run.color if run.color != INK else color))
            text = run.text
            body = text.lstrip(" ")
            word = body.split(" ", 1)[0] if body else ""
            if word and pdf.get_x() + pdf.get_string_width(text[: len(text) - len(body)] + word) > right:
                pdf.ln(leading)
                text = body
            pdf.write(leading, text, link=run.link or "")
        pdf.ln(leading + bottom)

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
                    link = next((run.link for run in cell if run.link), "")
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
        options = _image_options(_attr(token, "src"))
        figure = (_picture_ref(options.source), options.width, options.align)
        place = ALIGNMENTS[options.align]
        # a caption written in the braces says more than a title, which is older
        title = options.caption or _attr(token, "title")
        if isinstance(resolved, _Poster):
            if resolved.path is None:
                message = "Video not included in PDF."
                self._aside(f"{message} Watch it at {resolved.url}", link=resolved.url)
                return True
            caption = self._caption(title or f"Video: {token.content or 'untitled'}", token.content)
            self._place(resolved.path, resolved.natural, options.width, place, caption,
                        figure=figure, video=True, credit=resolved.credit)
            return True
        caption = self._caption(title, token.content)
        if resolved == CASE_PICTURE and self.case is None:
            self._placeholder(options.width, place, caption, figure=figure)
            return True
        if isinstance(resolved, str):
            if resolved == MEDIA_UNAVAILABLE:
                name = _cut_text(" ".join((token.content or "").split()) or "Untitled", 80)
                self._warn(f'Picture "{name}" could not be printed: it is missing from the case.', self._line)
            self._aside(resolved)
            return True
        self._place(resolved.path, resolved.natural, options.width, place, caption,
                    figure=figure, credit=resolved.credit)
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
    ) -> None:
        """Draw a picture as a block, its caption and credit kept on its page.

        ``figure`` (what it shows, its width and alignment as written) has the Page
        pane told where it landed; ``video`` marks a video's still. The caption is
        measured rather than guessed, so a picture never goes to the foot of a page
        that only has room for it and not for the words under it.
        """
        pdf = self.pdf
        theme = self.theme
        width, height = _fit(natural, width_attr, self._frame(), theme.room)
        if not theme.plain:
            pdf.ln(0.6)
        below = self._below(caption, credit, align, width)
        gap = None
        if pdf.will_page_break(height + below):
            room = pdf.page_break_trigger - pdf.get_y() - below - 0.5
            shrunk = width * room / height, room
            if (
                not width_attr
                and height * (1 - MAX_SHRINK) <= room
                and not pdf.will_page_break(shrunk[1] + self._below(caption, credit, align, shrunk[0]))
            ):
                width, height = shrunk
            else:
                gap = self._gap(natural, below)
                pdf.add_page()
        self._picture(source, w=width, h=height, x=align)
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
                self._credit_line(credit, align, pdf.l_margin, pdf.epw)
            pdf.ln(theme.gap)
            return
        pdf.set_draw_color(*theme.rule)
        pdf.set_line_width(0.2)
        pdf.rect(left, top, width, height, style="D")
        box_left, box_width = self._caption_box(align, left, width)
        if caption[0] or caption[1]:
            self._figure_caption(caption, align, box_left, box_width)
        if credit is not None:
            self._credit_line(credit, align, box_left, box_width)
        pdf.ln(theme.gap + 0.6)

    def _below(self, caption: tuple[str, str], credit: _Credit | None, align: Align, width: float) -> float:
        """How tall the caption and credit under a picture this wide will be."""
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
        if credit is not None:
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

    def _credit_line(self, credit: _Credit, align: Align, box_left: float, box_width: float) -> None:
        """Where a picture came from, in one small line: what kind of source in grey,
        then the place, linked when it is on the web. Cut rather than wrapped."""
        pdf, theme = self.pdf, self.theme
        size = CREDIT_SIZE * theme.scale
        leading = CREDIT_LEADING * theme.scale
        pdf.ln(0.6)
        y = pdf.get_y()
        head = f"{credit.kind}: "
        pdf.set_font(theme.heading_family, "", size)
        head_width = pdf.get_string_width(head)
        value = notes_style.fit_line(pdf, credit.value, max(10.0, box_width - head_width))
        total = head_width + pdf.get_string_width(value)
        x = _aligned(align, box_left, box_width, total)
        pdf.set_text_color(*theme.muted)
        self._text_at(x, y, head, leading)
        pdf.set_text_color(*(theme.accent_dark if credit.link else theme.muted))
        self._text_at(x + head_width, y, value, leading, link=credit.link)
        pdf.set_xy(pdf.l_margin, y + leading)

    def _text_at(self, x: float, y: float, text: str, height: float, *, link: str = "") -> None:
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
            DECODED.place(self.pdf, source, self._render, **options)
        else:
            self.pdf.image(source, **options)

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
        self._place(BytesIO(png), natural, "", Align.C, self._caption("", ""))

    def _poster(self, attrs: dict[str, Any]) -> "_Poster | str":
        """A video prints as its thumbnail with a play sign, and where it can be
        watched. With neither, the line it always printed."""
        url = _web(str(attrs.get("source_url") or ""))
        still = thumbnails.thumb_relpath(str(attrs.get("sha256") or ""), "video")
        if still and self.case is not None and self.images < MAX_IMAGES:
            try:
                path = self.case.resolve_inside(still)
            except Exception:
                path = None
            natural = _measure(path) if path is not None and path.is_file() else None
            if path is not None and natural is not None:
                self.images += 1
                return _Poster(path, natural, url)
        if url:
            return _Poster(None, (0, 0), url)
        return "Video not included in PDF."

    def _resolve_image(self, token: Token) -> "_Picture | _Poster | str":
        """The file behind an image, or the line to print instead of it."""
        source = _image_options(_attr(token, "src")).source
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
        record: dict[str, Any] | None = None
        if parts.scheme == "azimut" and parts.netloc == "media":
            record = self.case.get_entity(unquote(parts.path.lstrip("/")))
            attrs = (record or {}).get("attrs") or {}
            if not record or not attrs.get("path"):
                return MEDIA_UNAVAILABLE
            if attrs.get("kind") == "video":
                return self._poster(attrs)
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
        return _Picture(path, natural, self._credit_of(record, relative))

    def _credit_of(self, record: dict[str, Any] | None, relative: str) -> _Credit | None:
        """Where a picture of the case came from, as the case recorded it: the page
        it was taken from, or the imagery it was captured from and its date. Read
        from the case's own index; nothing is fetched."""
        item: dict[str, Any] = {}
        lookup = getattr(self.case, "media_items_by_paths", None)
        if lookup is not None:
            try:
                found = lookup([relative])
            except Exception:
                found = []
            item = found[0] if found and isinstance(found[0], dict) else {}
        if record is None and item.get("entity_id") and self.case is not None:
            record = self.case.get_entity(str(item["entity_id"]))
        attrs = (record or {}).get("attrs") or {}
        recorded = item.get("source")
        source: dict[str, Any] = recorded if isinstance(recorded, dict) else {}
        address = _web(str(attrs.get("source_url") or source.get("url") or ""))
        if address:
            return _Credit("Source", _host(address), address)
        if source.get("type") != "satellite" and (record or {}).get("type") != "capture":
            return None
        provider = " ".join(str(source.get("provider_label") or attrs.get("provider") or "").split())
        when = _imagery_day(timeline.capture_imagery(source))
        shown = ", ".join(part for part in (provider, when) if part)
        # the provider's own credit line goes last, where a cut costs the least
        credit = " ".join(str(source.get("attribution") or "").split())
        if credit and credit != provider:
            shown = f"{shown} · {credit}" if shown else credit
        return _Credit("Imagery", shown) if shown else None


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


def _take_task(tokens: list[Token], index: int) -> bool | None:
    """A list item that opens with `[ ]` or `[x]`: whether it is done, the marker
    taken out of its text. None for an ordinary item."""
    if index + 2 >= len(tokens) or tokens[index + 1].type != "paragraph_open":
        return None
    inline = tokens[index + 2]
    match = re.match(r"^\[([ xX])\]\s+", inline.content)
    children = inline.children or []
    if match is None or not children or children[0].type != "text":
        return None
    if not children[0].content.startswith(match.group(0)):
        return None
    inline.content = inline.content[match.end():]
    children[0].content = children[0].content[match.end():]
    return match.group(1) != " "


def _cut_runs(runs: list[Run], start: int) -> list[Run]:
    """The runs from character ``start`` of their plain text on, styles kept."""
    kept: list[Run] = []
    seen = 0
    for run in runs:
        end = seen + len(run.text)
        if end > start:
            cut = max(0, start - seen)
            kept.append(Run(run.text[cut:], bold=run.bold, italic=run.italic, mono=run.mono,
                            color=run.color, link=run.link))
        seen = end
    return [run for run in kept if run.text.strip()]


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

    The Notebook draws the same five kinds (`lib/notes/callouts.js`). An unknown kind
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
    room = first
    for word in text.split():
        candidate = f"{line} {word}" if line else word
        if pdf.get_string_width(candidate) <= room:
            line = candidate
            continue
        if line:
            lines.append(line)
            room = width
        while pdf.get_string_width(word) > room:
            cut = max(1, next((n for n in range(len(word), 0, -1)
                               if pdf.get_string_width(word[:n]) <= room), 1))
            lines.append(word[:cut])
            word = word[cut:]
            room = width
        line = word
    lines.append(line)
    return lines


def _imagery_day(reading: str | None) -> str:
    """An imagery date as the Time panel reads it (`2024-03-12`, `2024-03-12~`
    when the provider only estimates it) said in words: `about 12 March 2024`."""
    text = " ".join((reading or "").split())[:40]
    about = text.endswith("~")
    text = text.rstrip("~")
    if not text:
        return ""
    try:
        text = notes_style.long_date(date.fromisoformat(text)) if len(text) == 10 else text
    except ValueError:
        pass
    return f"about {text}" if about else text


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


def _web(value: str) -> str:
    """``value`` when it is a web address a reader can open, else ""."""
    try:
        parts = urlsplit(value.strip())
        host = parts.hostname
    except ValueError:
        return ""
    return value.strip() if parts.scheme in ("http", "https") and host else ""


def _host(url: str) -> str:
    """`example.org` for an address, as a credit line names where a picture came from."""
    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _web_address(record: dict[str, Any] | None) -> str:
    """The address a record stands for on the web, or "" when it has none.

    The record's own address first, where the case keeps it for that type (a
    bookmark's page, a file's source, `proposals.URL_ATTRS`), then an account's
    profile, and an archived copy last: a reader wants the page itself and only
    falls back on the snapshot. Each one is checked here, since the addresses a
    tool writes are not declared fields and never passed `entities._check_url`.
    """
    attrs = (record or {}).get("attrs") or {}
    kind = str((record or {}).get("type") or "")
    declared = entities.entity_type(kind)
    keys = [
        *([URL_ATTRS[kind]] if kind in URL_ATTRS else []),
        "url",
        "source_url",
        *(attr.key for attr in (declared.attrs if declared else ()) if attr.kind == "url"),
    ]
    for key in keys:
        address = _web(str(attrs.get(key) or ""))
        if address:
            return address
    return ""


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
) -> tuple[float, float]:
    """Size an image the way the preview does, then keep it inside the page."""
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
    if height > room:
        width *= room / height
        height = room
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
