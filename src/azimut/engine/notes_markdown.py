"""How a note's Markdown is read, the same way for every document made from it.

A note becomes a PDF (`engine/notes_pdf.py`), an HTML report (`engine/notes_html.py`)
and the pieces of a Post thread (`engine/notepieces.py`). The three must never read
one note two ways, so what they share lives here and nowhere else:

- the parser (`markdown-it-py`, CommonMark with the two GFM rules the preview
  enables) and the rewrites of Azimut's own syntax it needs first, mirroring
  `lib/markdown.js` (`[[entity:…]]`, `[[media:…]]`, `![…](…){width=…}`);
- the chapters: `expand` cuts a note at its include lines and splices each
  chapter's note in, guidance emptied and placeholders filled;
- the two editions: `strip_internal` blanks every `> [!internal]` passage as
  either reader of the note sees one, which is what the public edition is made from;
- the aligned blocks (`::: center`), the own cover's corners (`::: top-right`),
  the two blocks that tell a story in pictures (`::: steps`, `::: story`), in which
  every picture opens a step and the words after it are that step's, and the blocks
  each renderer draws whole (`TOKEN_BLOCKS`): a map (`::: map`, read by
  `engine/notes_maps.py`), a chart (`::: chart`, read by `engine/notes_charts.py`) and a
  post (`::: post`, read by `engine/socialposts.py`), each handed on as one token holding
  its lines (`az_map`, `az_chart`, `az_post`);
- the columns (`:::: columns`), pictures or words side by side: each column's own
  tokens between markers a renderer lays side by side and any other reader steps
  over, reading the columns one under the other (`columns_blocks`);
- the callouts a quote opens with (`> [!confirmed]`) and the tasks a list holds;
- the own cover (the lines above `<!-- cover -->`, `cover_piece`);
- what a picture's braces say (`image_options`), and a table's settings line
  (`engine/notes_tables.py`), taken out of its rows as it is parsed;
- the citation pass (`Cited`): every source a document cites, numbered before the
  first is drawn, and the warnings the check before export reads off it.

Nothing here lays a page out. Each renderer walks the tokens this module hands it.
"""

from __future__ import annotations

import hashlib
import ipaddress
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, Iterator, NamedTuple
from urllib.parse import parse_qs, quote, unquote, urlsplit

from markdown_it import MarkdownIt
from markdown_it.helpers import parseLinkLabel
from markdown_it.rules_inline import StateInline
from markdown_it.token import Token

from . import notefill, notes_tables, notesources, urltitles
from .notelook import CASE_NOTE, NoteLook, Profile
from .notesources import Annex, Source
from .notetext import CALLOUT, ENTITY_REF, FENCE, INCLUDE, MEDIA_REF, PAGE_BREAK, without_hints

if TYPE_CHECKING:
    from ..workspace import Case

#: The alignments a `::: name` block can set, and the corners of the own cover.
ALIGNMENT_NAMES = ("left", "center", "right")
CORNER_NAMES = ("top-left", "top-right", "bottom-left", "bottom-right")
#: The blocks whose pictures are steps: a stepper, and a story told as the page
#: scrolls. A PDF prints both as they are written, each picture then its words.
STEPS = "steps"
STORY = "story"
FIGURE_BLOCKS = (STEPS, STORY)
#: A map of the case's layers, plates or proofs (`engine/notes_maps.py`): one token,
#: `MAP_TOKEN`, holding the block's lines, which each renderer draws its own way.
MAP = "map"
MAP_TOKEN = "az_map"
#: A chart drawn from the table it holds (`engine/notes_charts.py`), handed on the same way.
CHART = "chart"
CHART_TOKEN = "az_chart"
#: An infographic (`engine/notes_infographic.py`): a page of those blocks and words, in
#: a fence of four colons so the blocks inside keep their own. Read before them, whole.
INFOGRAPHIC = "infographic"
INFOGRAPHIC_TOKEN = "az_infographic"
#: A post from X or Bluesky the case keeps (`engine/socialposts.py`), drawn as a card.
POST = "post"
POST_TOKEN = "az_post"
#: The blocks a renderer draws whole, by name, and the one token each becomes
#: (`block_token`): every renderer has an `_on_<token>` for each.
TOKEN_BLOCKS: dict[str, str] = {MAP: MAP_TOKEN, CHART: CHART_TOKEN, INFOGRAPHIC: INFOGRAPHIC_TOKEN, POST: POST_TOKEN}
#: A footnote, written `^[words]` (Pandoc's inline form): a comment the reader opens from a
#: small letter, the letters a, b… in reading order (`footnote_letter`), the words listed
#: under Notes before the sources. One token inside a line, its words parsed as its children,
#: so a walk that does not know it leaves them out of the running text (a summary, a
#: heading's words, a word count), and one looking for links reads them (`with_footnotes`).
FOOTNOTE_TOKEN = "az_footnote"
#: Set in the parser's env while a footnote's words are read: a footnote holds no footnote.
_IN_FOOTNOTE = "az_in_footnote"
#: Pictures or words side by side: a fence of four colons holding `::: column` blocks,
#: `::: column width=66%` for one given its share of the row. Its columns' tokens come
#: between four markers holding no words: `COLUMNS_OPEN` (its `meta` says each printed
#: column's share, ``widths``, and whether the row is only pictures, ``pictures``),
#: then `COLUMN_OPEN` and `COLUMN_CLOSE` around each column, then `COLUMNS_CLOSE`. A
#: renderer that lays them side by side has an `_on_az_columns_open`; any other reader
#: steps over the markers and reads the columns one under the other.
COLUMNS = "columns"
COLUMNS_OPEN = "az_columns_open"
COLUMNS_CLOSE = "az_columns_close"
COLUMN_OPEN = "az_column_open"
COLUMN_CLOSE = "az_column_close"
COLUMN_MARKS = (COLUMNS_OPEN, COLUMN_OPEN, COLUMN_CLOSE, COLUMNS_CLOSE)
#: A column's opening line, its share of the row in percent when it is given one.
COLUMN_LINE = re.compile(r"^:::[ \t]*column\b([^\n]*)$")
COLUMN_WIDTH = re.compile(r"\bwidth\s*=\s*(\d{1,3}(?:\.\d+)?)\s*%?")
#: The narrowest and widest share a written width keeps, in percent.
MIN_COLUMN, MAX_COLUMN = 10.0, 90.0
#: What a column holds for the row to stand side by side: words, lists, quotes and
#: callouts, headings and pictures. Anything else (a table, code, a rule, a block of its
#: own) prints the row's columns one under the other.
COLUMN_TOKENS = frozenset((
    "paragraph_open", "paragraph_close", "inline", "heading_open", "heading_close",
    "bullet_list_open", "bullet_list_close", "ordered_list_open", "ordered_list_close",
    "list_item_open", "list_item_close", "blockquote_open", "blockquote_close",
))


#: How deep chapters nest: a report's chapter may hold chapters of its own, and
#: those print their includes as an aside.
MAX_INCLUDE_DEPTH = 2
#: How many chapters one document may pull in, all levels counted.
MAX_CHAPTERS = 100


#: An HTML comment: hidden by every Markdown reader, and so by the PDF too.
COMMENT = re.compile(r"\A(?:\s*<!--.*?-->)+\s*\Z", re.S)

MERMAID_INFO = re.compile(r"^\s*mermaid\b")
IMAGE_ATTRS = re.compile(r"!\[([^\]]*)\]\((\S+?)(?:\s+[\"']([^\"']*)[\"'])?\)\s*\{([^}\n]+)\}")
ALIGNMENT_BLOCK = re.compile(
    rf"^:::[ \t]*({'|'.join((*ALIGNMENT_NAMES, *CORNER_NAMES, *FIGURE_BLOCKS, MAP, CHART, POST))})[ \t]*\n(.*?)^:::[ \t]*$",
    re.S | re.M,
)
#: A block of blocks, four colons deep, closed by four colons alone.
WRAPPER_BLOCK = re.compile(r"^::::[ \t]*(infographic|columns)[ \t]*\n(.*?)^::::[ \t]*$", re.S | re.M)
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


WIDTH_PERCENT = re.compile(r"^(?:[1-9]\d?(?:\.\d+)?|100(?:\.0+)?)%$")
WIDTH_PIXELS = re.compile(r"^(?:[2-9]\d|[1-9]\d{2}|1[0-5]\d{2}|1600)px$")


#: The callouts a quote can open with, as `> [!confirmed]`, their label and colour.
CALLOUTS: dict[str, tuple[str, tuple[int, int, int]]] = {
    "confirmed": ("Confirmed", (46, 125, 50)),
    "unverified": ("Unverified", (189, 122, 37)),
    "lead": ("Lead", (30, 100, 170)),
    "note": ("Note", (119, 119, 119)),
    "warning": ("Warning", (178, 52, 40)),
    "internal": ("Internal", (111, 87, 160)),
    #: What the evidence cannot say: the HTML report lists it in its contents.
    "limits": ("Limits", (84, 96, 112)),
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


CASE_CHAPTER = "A note included here prints as a chapter."


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
#: Outside links with no archived copy, and links to pages the case holds nothing of, so
#: no day says when they were read. Each is one line however many links it counts, the
#: links themselves listed beside it (`Cited.listed`).
UNARCHIVED = "unarchived"
UNSEEN = "unseen"
#: A count written as exact, with no "at least" or range before it (`exact_counts`): one
#: line however many, each count listed beside it with its line.
COUNT = "count"
WARNING_KINDS = (MISSING, UNSOURCED, OPEN_TASK, LOCAL_LINK, EMPTY_SECTION, OTHER, LEFT_OUT, SETTING, UNARCHIVED, UNSEEN,
                 COUNT)
#: How many links a reader cannot open are named one by one before the rest are counted.
MAX_LOCAL_LINKS = 10
#: How many links one grouped line lists; its count stays exact past it.
MAX_LISTED_LINKS = 500
#: What the aside says where an included note is gone: the warning is read off it.
CHAPTER_GONE = "The note included here is no longer in the case."
#: The callout that says what the evidence cannot, which the Limits annex gathers, and a
#: heading that opens a Limits section of the note's own.
LIMITS = "limits"
LIMITS_HEADING = re.compile(r"^(?:\d+(?:\.\d+)*\.?\s+)?(?:limits|limitations)\b", re.I)
#: A heading line that opens the note's own list of sources: Sources or References, at any
#: level, numbered or not, bold or not. `lib/notes/look.js` (`ownSources`) reads it the same.
OWN_SOURCES = re.compile(
    r"^ {0,3}#{1,6}[ \t]+(?:\d+(?:\.\d+)*\.?[ \t]+)?[*_]*(sources|references)[*_]*[ \t]*:?[ \t]*(?:#+[ \t]*)?$", re.I)
#: A heading line that opens the note's own account of its method, or its own list of
#: geolocations, at any level, numbered or not, bold or not, words after it allowed: Method,
#: Methodology, How this was made, Methods and limits; Geolocations, Our geolocations, Annex:
#: our geolocations. The generated annex of that name is then not printed unless the look
#: asks for it (`method_list`, `geolocations_list`). `lib/notes/look.js` (`ownSection`)
#: reads them the same, against `tests/fixtures/own-sections.json`.
OWN_SECTIONS = {
    "method": re.compile(
        r"^ {0,3}#{1,6}[ \t]+(?:\d+(?:\.\d+)*\.?[ \t]+)?[*_]*(?:our[ \t]+)?"
        r"(?:methods?|methodology|how[ \t]+this[ \t]+was[ \t]+made)(?![A-Za-z0-9])", re.I),
    "geolocations": re.compile(
        r"^ {0,3}#{1,6}[ \t]+(?:\d+(?:\.\d+)*\.?[ \t]+)?[*_]*(?:(?:annex|appendix)(?:[ \t]+[A-Za-z0-9]{1,3})?[ \t]*:[ \t]*)?"
        r"(?:our[ \t]+)?geolocations(?![A-Za-z0-9])", re.I),
}
#: The words of a picture that tell a reader who cannot see it nothing: a bare label
#: (`Figure 3`, `Picture`) or a file's name. Its caption then stands for them, if it has one.
BARE_ALT = re.compile(
    r"^(?:(?:figure|fig\.?|picture|pic|image|img|photo|screenshot|capture|untitled)[ \t]*[A-Za-z]?[0-9]*[a-z]?\.?"
    r"|[^/\\]+\.(?:png|jpe?g|webp|gif|tiff?|bmp|heic|avif))$", re.I)
#: A caption that names whose a picture is: `Footage: …`, `Imagery: …`, `via @…`, `©`.
CREDIT_WORDS = re.compile(
    r"\b(?:source|sources|credit|credits|footage|imagery|photo|photograph|map|courtesy)[ \t]*:|©|\bvia[ \t]+@?\w", re.I)
#: A line that opens or closes fenced code, where a heading is only words.
FENCE_LINE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
#: A heading line and its rank, where a section ends.
ATX_LINE = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]|$)")
#: The annexes that read every source cited.
ANNEXES_READ = ("geolocations", "credits", "method")


#: An address written as it is in prose (`https://…`), which the preview links as
#: GitHub's Markdown does. Its closing punctuation is not part of it (`bare_urls`).
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


def read_note(case: "Case", note_id: str) -> tuple[str, str] | None:
    """A note's title and Markdown as saved, the case notes included; None when there
    is no such note."""
    from ..workspace import CaseError

    if note_id == CASE_NOTE:
        return "Case notes", case.read_notes()
    entity = case.get_entity(note_id)
    if entity is None or entity.get("type") != "note":
        return None
    try:
        return str(entity.get("label") or "Note"), case.read_note(note_id)
    except CaseError:
        return None


def case_resolver(case: "Case") -> Resolve:
    """How a chapter finds the note it prints in ``case``: as saved, the case notes included."""
    return lambda note_id: read_note(case, note_id)


class ImageOptions(NamedTuple):
    """What a picture's braces say: its source with the braces taken out, its
    width and alignment as written, and its caption. ``aligned`` is whether an
    alignment was written at all: one that was not follows the block it is in."""

    source: str
    width: str
    align: str
    caption: str
    aligned: bool = False


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
        for token in parser().parse(case_references(piece.text))
        if token.type == "fence" and MERMAID_INFO.match(token.info or "")
    ]


def cover_piece(
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
    spans = _quote_spans(parse(text), 0, lines)
    for block in alignment_blocks(text):
        spans.extend(_quote_spans(block.tokens, block.line, lines))
    return spans


def _quote_spans(tokens: list[Token], offset: int, lines: list[str]) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for index, token in enumerate(tokens):
        if token.type != "blockquote_open" or not token.map:
            continue
        first, end = offset + token.map[0], offset + token.map[1]
        editor = 0 <= first < len(lines) and EDITOR_INTERNAL.match(lines[first]) is not None
        if editor or callout_kind(tokens, index) == INTERNAL:
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


def holds_internal(tokens: list[Token]) -> bool:
    return any(
        token.type == "blockquote_open" and callout_kind(tokens, index) == INTERNAL
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


def case_references(text: str) -> str:
    """Turn Azimut's own syntax into links the Markdown parser understands."""
    source = IMAGE_ATTRS.sub(_sized_image, str(text))
    source = ENTITY_REF.sub(lambda m: f"[{m.group(2)}](azimut://entity/{m.group(1)})", source)
    return MEDIA_REF.sub(_media_image, source)


def image_options(href: str) -> ImageOptions:
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
    chosen = align in ALIGNMENT_NAMES and "align" in values
    return ImageOptions(source, width, align if align in ALIGNMENT_NAMES else "left", caption, chosen)


def parser() -> MarkdownIt:
    """CommonMark plus the two GFM rules the preview enables (marked's `gfm`), and
    Pandoc's inline footnote (`^[words]`, `_footnote`)."""
    md = MarkdownIt("commonmark").enable(["table", "strikethrough"])
    md.inline.ruler.after("image", FOOTNOTE_TOKEN, _footnote)
    return md


# -- footnotes -------------------------------------------------------------------


def _footnote(state: StateInline, silent: bool) -> bool:
    """`^[words]`, Pandoc's inline footnote, as one `FOOTNOTE_TOKEN` holding its words
    parsed as a line is. Its brackets balance as a link's do, code and escapes skipped,
    so `\\^[` and a `^[` never closed stay text; a link's words and a footnote's own
    hold none, and an empty one is none."""
    start = state.pos
    if (start + 1 >= state.posMax or state.src[start] != "^" or state.src[start + 1] != "["
            or state.linkLevel > 0 or state.env.get(_IN_FOOTNOTE)):
        return False
    end = parseLinkLabel(state, start + 1)
    if end < 0:
        return False
    words = state.src[start + 2 : end]
    if not words.strip():
        return False
    if not silent:
        token = state.push(FOOTNOTE_TOKEN, "", 0)
        token.content = words
        state.env[_IN_FOOTNOTE] = True
        try:
            children: list[Token] = []
            state.md.inline.parse(words, state.md, state.env, children)
        finally:
            del state.env[_IN_FOOTNOTE]
        token.children = _joined(children)
    state.pos = end + 1
    return True


def _joined(children: list[Token]) -> list[Token]:
    """A footnote's words as the parser leaves a line's: an escaped character read as
    text and joined to the text around it (the core's `text_join`, which only walks lines)."""
    out: list[Token] = []
    for child in children:
        if child.type == "text_special":
            child.type = "text"
        if child.type == "text" and out and out[-1].type == "text":
            out[-1].content += child.content
        else:
            out.append(child)
    return out


def footnote_words(token: Token) -> Token:
    """A footnote's words as a line of their own, which a renderer draws as it draws any line."""
    inline = Token("inline", "", 0)
    inline.content = token.content
    inline.children = list(token.children or [])
    return inline


def with_footnotes(children: list[Token] | None) -> Iterator[Token]:
    """A line's tokens with each footnote's words read in its place: what a pass looking
    for links reads, so a link in a footnote is found and cited like any other."""
    for child in children or []:
        if child.type == FOOTNOTE_TOKEN:
            yield from child.children or []
        else:
            yield child


def holds_footnotes(tokens: list[Token]) -> bool:
    """Whether a stretch of parsed note marks a footnote anywhere."""
    return any(child.type == FOOTNOTE_TOKEN for token in tokens if token.type == "inline"
               for child in token.children or [])


def footnote_letter(index: int) -> str:
    """The letter of the footnote ``index`` (from 0) in reading order: a to z, then aa, ab…,
    as a list lettered `lower-alpha` counts."""
    letters = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        letters = chr(ord("a") + rest) + letters
    return letters


def parse(source: str) -> list[Token]:
    """The note's tokens, each table's settings line taken out of its rows and handed on
    with its ``table_open`` (`notes_tables.attach`)."""
    if not source.strip():
        return []
    return notes_tables.attach(parser().parse(case_references(source)), source)


def alignment_blocks(text: str) -> list["Block"]:
    """Parse a stretch of note, honouring the `::: center` blocks around parts of it.

    Each block is parsed on its own so its alignment can be pushed into everything
    it produced, which is how the preview reads it too. A `::: steps` or `::: story`
    block stands left, each of its pictures in a paragraph of its own
    (`split_figures`), so every reader finds its steps the same way. A block written
    inside a code fence is an example of the syntax, shown as the fence's text.
    """
    blocks: list[Block] = []
    position = 0
    fenced = fenced_spans(text)
    wrapped = [match for match in WRAPPER_BLOCK.finditer(text)
               if not any(start <= match.start() < end for start, end in fenced)]
    search = 0
    while True:
        match = ALIGNMENT_BLOCK.search(text, search)
        # a wrapper is read before the blocks inside it, whole: one token, as a map is
        wrapper = next((one for one in wrapped if one.start() >= search), None)
        if wrapper is not None and (match is None or wrapper.start() <= match.start()):
            match = wrapper
        if match is None:
            break
        if match.re is ALIGNMENT_BLOCK and (any(start <= match.start() < end for start, end in fenced)
                                           or any(one.start() <= match.start() < one.end() for one in wrapped)):
            search = text.find("\n", match.start()) + 1 or len(text)
            continue
        search = match.end()
        blocks.append(Block("left", parse(text[position : match.start()]), text.count("\n", 0, position)))
        name = match.group(1)
        line = text.count("\n", 0, match.start(2))
        if name == COLUMNS:
            blocks.extend(columns_blocks(match.group(2), line))
            position = match.end()
            continue
        if name in TOKEN_BLOCKS:
            blocks.append(Block("left", [block_token(name, match.group(2))], line, kind=name))
            position = match.end()
            continue
        if name in FIGURE_BLOCKS:
            blocks.append(Block("left", split_figures(parse(match.group(2))), line, kind=name))
            position = match.end()
            continue
        corner = name if name in CORNER_NAMES else ""
        # a corner stands at its side of the page: `top-right` is set to the right
        align = name.rsplit("-", 1)[-1] if corner else name
        blocks.append(Block(align, parse(match.group(2)), line, corner=corner))
        position = match.end()
    blocks.append(Block("left", parse(text[position:]), text.count("\n", 0, position)))
    return blocks


@dataclass
class Column:
    """One `::: column` of a `:::: columns` block: its lines, where they start in the
    block, and the share of the row it was given (None to share what is left)."""

    lines: list[str]
    first: int
    width: float | None = None


def read_columns(body: str) -> tuple[list[Column], list[tuple[int, list[str]]]]:
    """A `:::: columns` block's columns, in order, and the lines written in it outside
    any column, by where each stretch starts. A column left open runs to the block's end."""
    columns: list[Column] = []
    stray: list[tuple[int, list[str]]] = []
    current: Column | None = None
    for number, line in enumerate(body.split("\n")):
        opened = COLUMN_LINE.match(line)
        if opened:
            width = COLUMN_WIDTH.search(opened.group(1))
            current = Column([], number + 1, float(width.group(1)) if width else None)
            columns.append(current)
        elif current is not None and re.match(r"^:::[ \t]*$", line):
            current = None
        elif current is not None:
            current.lines.append(line)
        elif line.strip() and not re.match(r"^:{3,}[ \t]*$", line):
            if stray and stray[-1][0] + len(stray[-1][1]) == number:
                stray[-1][1].append(line)
            else:
                stray.append((number, [line]))
    return columns, stray


def column_widths(written: list[float | None]) -> list[float]:
    """Each column's share of the row, as fractions adding to one. A written width is
    kept between `MIN_COLUMN` and `MAX_COLUMN` percent and the columns without one share
    what is left; widths that leave the others too little are not followed, every
    column then taking an even share."""
    count = len(written)
    if not count:
        return []
    given = [min(MAX_COLUMN, max(MIN_COLUMN, width)) if width is not None else None for width in written]
    free = sum(1 for width in given if width is None)
    total = sum(width for width in given if width is not None)
    if free == count or (free and 100 - total < MIN_COLUMN * free) or (not free and total <= 0):
        return [1 / count] * count
    rest = (100 - total) / free if free else 0.0
    shares = [width if width is not None else rest for width in given]
    whole = sum(shares)
    return [share / whole for share in shares]


def _marker(kind: str, line: int, meta: dict[str, Any] | None = None) -> Token:
    token = Token(kind, "", 0)
    token.block = True
    token.map = [line, line + 1]
    token.meta = meta or {}
    return token


def _shifted(tokens: list[Token], offset: int) -> list[Token]:
    """``tokens`` with their lines counted from ``offset`` lines further down."""
    for token in tokens:
        if token.map:
            token.map = [token.map[0] + offset, token.map[1] + offset]
    return tokens


def _lays_side_by_side(tokens: list[Token]) -> bool:
    """Whether a column holds only what a column can: words, lists, quotes, headings and
    pictures, a comment (which prints nothing) aside."""
    for token in tokens:
        if token.type in COLUMN_TOKENS:
            continue
        if token.type == "html_block" and COMMENT.match(token.content) and not PAGE_BREAK.match(token.content.strip()):
            continue
        return False
    return True


def _picture_only(tokens: list[Token]) -> bool:
    """Whether a column is one picture and nothing else."""
    if len(tokens) != 3 or tokens[0].type != "paragraph_open":
        return False
    children = [child for child in tokens[1].children or [] if child.type != "softbreak"]
    return len(children) == 1 and children[0].type == "image"


def columns_blocks(body: str, line: int) -> list[Block]:
    """A `:::: columns` block whose lines start at ``line``, as the blocks every reader
    walks. Its columns' tokens come between the markers (`COLUMN_MARKS`), each picture in
    a paragraph of its own (`split_figures`). An empty column is not printed; one column
    left is ordinary content. A column holding anything a column cannot (a table, code, a
    block of its own, a page break) has the row printed as written, one column under the
    other. Lines written outside the columns print under the row."""
    columns, stray = read_columns(body)
    if any(re.match(r"^:::", row) or PAGE_BREAK.match(row) for column in columns for row in column.lines):
        return _stacked(body, line)
    parsed: list[tuple[Column, list[Token]]] = []
    for column in columns:
        tokens = _shifted(split_figures(parse("\n".join(column.lines))), column.first)
        if not tokens or not any(token.type != "html_block" for token in tokens):
            continue
        if not _lays_side_by_side(tokens):
            return _stacked(body, line)
        parsed.append((column, tokens))
    after: list[Token] = []
    for start, rows in stray:
        after.extend(_shifted(parse("\n".join(rows)), start))
    if len(parsed) < 2:
        return [Block("left", [token for _, tokens in parsed for token in tokens] + after, line)]
    pictures = all(_picture_only(tokens) for _, tokens in parsed)
    widths = column_widths([column.width for column, _ in parsed])
    out = [_marker(COLUMNS_OPEN, 0, {"widths": widths, "pictures": pictures, "count": len(parsed)})]
    for position, (column, tokens) in enumerate(parsed):
        out.append(_marker(COLUMN_OPEN, max(0, column.first - 1), {"width": widths[position], "index": position}))
        out.extend(tokens)
        out.append(_marker(COLUMN_CLOSE, column.first + len(column.lines)))
    out.append(_marker(COLUMNS_CLOSE, body.count("\n") + 1))
    return [Block("left", out + after, line, kind=COLUMNS)]


def _stacked(body: str, line: int) -> list[Block]:
    """A columns block printed as written, one column under the other: its fence lines
    emptied, line numbers kept, every block inside read as it would be anywhere."""
    rows = body.split("\n")
    # a column's fences are emptied, a block written inside one keeps its own
    opened: list[bool] = []
    for number, row in enumerate(rows):
        if COLUMN_LINE.match(row):
            opened.append(True)
            rows[number] = ""
        elif re.match(r"^:::[ \t]*\S", row):
            opened.append(False)
        elif re.match(r"^:{3,}[ \t]*$", row) and (not opened or opened.pop()):
            rows[number] = ""
    blocks = alignment_blocks("\n".join(rows))
    for block in blocks:
        block.line += line
    return blocks


def column_spans(tokens: list[Token], index: int) -> tuple[list[tuple[int, int, float]], int]:
    """The columns of the row whose `COLUMNS_OPEN` is at ``index``: each column's first
    and end token and its share, and the index past the row's `COLUMNS_CLOSE`."""
    spans: list[tuple[int, int, float]] = []
    position = index + 1
    while position < len(tokens) and tokens[position].type != COLUMNS_CLOSE:
        if tokens[position].type == COLUMN_OPEN:
            end = position + 1
            while end < len(tokens) and tokens[end].type not in (COLUMN_CLOSE, COLUMNS_CLOSE):
                end += 1
            spans.append((position + 1, end, float(tokens[position].meta.get("width") or 0.0)))
            position = end
        position += 1
    return spans, min(len(tokens), position + 1)


def fenced_spans(text: str) -> list[tuple[int, int]]:
    """Where the code fences of a stretch of note run, as character offsets."""
    if "```" not in text and "~~~" not in text:
        return []
    spans: list[tuple[int, int]] = []
    opened: int | None = None
    offset = 0
    for line in text.split("\n"):
        if FENCE.match(line):
            if opened is None:
                opened = offset
            else:
                spans.append((opened, offset + len(line)))
                opened = None
        offset += len(line) + 1
    if opened is not None:
        spans.append((opened, len(text)))
    return spans


def block_token(name: str, body: str) -> Token:
    """A block of `TOKEN_BLOCKS` as the one token every renderer walks to: `::: map`
    to `_on_az_map`, `::: chart` to `_on_az_chart`, `:::: infographic` to
    `_on_az_infographic`."""
    token = Token(TOKEN_BLOCKS[name], "", 0)
    token.content = body
    token.block = True
    token.map = [0, max(1, body.count("\n"))]
    return token


def file_prefixes(case: "Case | None") -> tuple[str, ...]:
    """How the Notebook writes a case file's address: as a browser does
    (`lib/fileUrl.js`), so a case called "Port strike" is `/files/Port%20strike/…`."""
    if case is None:
        return ()
    return tuple(dict.fromkeys((f"/files/{_quote(case.id)}/", f"/files/{case.id}/")))


def bare_urls(text: str) -> list[tuple[int, int, str]]:
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


def is_local(href: str, prefixes: tuple[str, ...]) -> bool:
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


def token_attr(token: Token, name: str) -> str:
    """One token attribute as text; the parser types them loosely."""
    value = token.attrGet(name)
    return "" if value is None else str(value)


@dataclass
class Block:
    """One parsed stretch of a piece, with its alignment and first line."""

    #: `left`, `center` or `right` (`ALIGNMENT_NAMES`): a corner's side of the page.
    align: str
    tokens: list[Token]
    line: int
    start: int = 0
    #: The corner of the own cover it is pinned to (`CORNER_NAMES`), or "".
    corner: str = ""
    #: `steps` or `story` for a block of pictures told as steps (`FIGURE_BLOCKS`), `map`,
    #: `chart`, `infographic` or `post` for a block drawn whole (`TOKEN_BLOCKS`), or "".
    kind: str = ""


#: A paragraph's marks that hold nothing a reader sees on their own.
BREAKS = ("softbreak", "hardbreak")


def split_figures(tokens: list[Token]) -> list[Token]:
    """``tokens`` with every picture in a paragraph of its own, and the words around it
    in paragraphs of theirs, in the order written.

    In a block of steps each picture opens a step, and the analyst writes a step as a
    picture line with its words on the next line: one paragraph to the parser. Cut
    apart, a PDF draws the picture as a figure, then its words, and the HTML report
    finds the step's picture and its words without reading inside a paragraph.
    """
    out: list[Token] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        inline = tokens[index + 1] if index + 1 < len(tokens) else None
        if (
            token.type == "paragraph_open"
            and inline is not None
            and inline.type == "inline"
            and index + 2 < len(tokens)
            and any(child.type == "image" for child in inline.children or [])
        ):
            out.extend(_split_paragraph(token, inline, tokens[index + 2]))
            index += 3
            continue
        out.append(token)
        index += 1
    return out


def _split_paragraph(opening: Token, inline: Token, closing: Token) -> list[Token]:
    pieces: list[list[Token]] = [[]]
    for child in inline.children or []:
        if child.type == "image":
            pieces.extend([[child], []])
        else:
            pieces[-1].append(child)
    out: list[Token] = []
    for piece in pieces:
        while piece and (piece[0].type in BREAKS or (piece[0].type == "text" and not piece[0].content.strip())):
            piece.pop(0)
        while piece and (piece[-1].type in BREAKS or (piece[-1].type == "text" and not piece[-1].content.strip())):
            piece.pop()
        if not piece:
            continue
        words = "".join(child.content for child in piece if child.type in ("text", "code_inline"))
        out.extend((opening.copy(), inline.copy(children=piece, content=words), closing.copy()))
    return out


#: `zoom=0.2,0.3,0.4,0.4` in a picture's braces: the part of it a story's step looks
#: at, as fractions of its width and height (left, top, width, height).
ZOOM_ATTR = re.compile(r"\bzoom\s*=\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)")
#: `graphic` in a picture's braces: a picture a reader is warned about before seeing it.
GRAPHIC_ATTR = re.compile(r"(?<![\w=\"-])graphic(?![\w=\"-])")


def image_attributes(href: str) -> str:
    """What a picture's braces held, the caption taken out (`image_options`)."""
    attributes = parse_qs(urlsplit(href).query, keep_blank_values=True).get(ATTR_PARAM, [""])[0]
    return CAPTION_ATTR.sub(" ", attributes)


def image_zoom(href: str) -> tuple[float, float, float, float] | None:
    """The zoom a picture's braces set, each value between 0 and 1 and the rectangle
    inside the picture; None when none is written or it reads as no rectangle."""
    match = ZOOM_ATTR.search(image_attributes(href))
    if match is None:
        return None
    try:
        left, top, width, height = (float(value) for value in match.groups())
    except ValueError:
        return None
    if not (0 <= left < 1 and 0 <= top < 1 and 0 < width <= 1 and 0 < height <= 1):
        return None
    if left + width > 1.0001 or top + height > 1.0001:
        return None
    return left, top, width, height


def image_graphic(href: str) -> bool:
    """Whether a picture's braces mark it `graphic`."""
    return GRAPHIC_ATTR.search(image_attributes(href)) is not None


class Cited:
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

    While the sources are listed, the outside links are checked too, each page once:
    those with no archived copy, and those the case holds nothing of, so no day says
    when they were read. Each is one line with a count, the links themselves in
    ``listed`` under the line's kind, each with its words, its address and its line;
    a profile that checks `each` link (a report's) says each one on a line of its own.

    What the style carries (`notelook.Profile`) is read once here, from the look and
    this machine's Settings unless ``profile`` is given. Which list of sources it ends on
    is read here too (``listing``): the generated one numbers the citations into it; the
    note's own section prints as written, every link still checked, nothing numbered. The annexes read this pass
    too: every source cited, numbered or not (``everything``), and the note's Limits
    boxes in order (``limits``).
    Links to the case's own work are left out: an archived copy itself, the viewers a
    reader checks imagery in and the imagery services (`notesources.is_own_tool`), a
    map view the case captured, and where the analyst published a proof.
    """

    def __init__(
        self,
        case: "Case | None",
        *,
        look: NoteLook,
        styled: bool = False,
        identity: notefill.Identity | None = None,
        profile: Profile | None = None,
    ) -> None:
        self.case = case
        self.look = look
        #: What the document carries after its text, and how strictly its links are checked.
        self.profile = profile if profile is not None else look.profile()
        #: Who signs, and where their pictures are: read once for the whole document.
        self.identity = identity if identity is not None else notefill.Identity()
        self.reader = notesources.Reader(case)
        #: Whether the document has sources at all: its links checked, its pictures' sources asked for.
        self.on = self.profile.sources
        #: Which list of sources it ends on, once its text is read: "generated", "own" or
        #: "both" (`notelook.SourcesList`), "" with no sources at all.
        self.listing = ""
        #: The word the note's own sources section is headed with, "sources" or "references".
        self.own_heading = ""
        #: For the method and geolocations annexes: whether the generated one prints in place
        #: of the note's own section, beside it, or not at all (`annex_listing`).
        self.annex_lists: dict[str, str] = {}
        self.styled = styled
        self.annex: Annex | None = None
        #: Every source the document cites, for the annexes, whether the list is printed or not.
        self.everything: Annex | None = None
        #: The note's Limits boxes in order, each its words and its line, and whether the
        #: note has a Limits section of its own, which the Limits annex then leaves alone.
        self.limits: list[tuple[str, int | None]] = []
        self.limits_section = False
        #: (message, line, kind), in the order they were found.
        self.warnings: list[tuple[str, int | None, str]] = []
        self._prefixes = file_prefixes(case)
        self._cited: list[Source] = []
        self._warned: set[str] = set()
        self._local: dict[str, int | None] = {}
        self._tasks: list[int] = []
        self._images: dict[str, Source | None] = {}
        #: Each outside page linked to, once, as (address, words, line, source), by its page.
        self._outside: dict[str, tuple[str, str, int | None, Source]] = {}
        #: The links behind each grouped line, by the line's kind.
        self.listed: dict[str, list[dict[str, Any]]] = {}
        #: The words of the posts the document draws (`::: post`), which its fonts must carry.
        self.post_words: list[str] = []
        #: What the Ready to publish? panel reads beyond the warnings (`engine/noteready.py`):
        #: each picture with whether a reader is told what it shows and whose it is
        #: (``pictures``), each record cited (``records``), each outside page linked
        #: (``outside``), and what a renderer adds while it draws (``fixes``, by warning).
        self.ready: dict[str, Any] = {}

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
            return None if is_local(href, ()) else self.reader.link(href, words)
        relative = self._case_file(href)
        return self.reader.file(relative) if relative and self._exists(relative) else None

    def image_source(self, src: str) -> Source | None:
        """The item of the case a picture shows, or None when it shows none (or one
        no longer there, which the walk says where the picture was)."""
        if src in self._images:
            return self._images[src]
        found: Source | None = None
        written = image_options(src).source
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

    def collect(self, pieces: list[Piece], blocks: dict[int, list["Block"]]) -> None:
        """Read every citation in document order, chapters included, then number them."""
        # the note's own words, as the Look reads them: a chapter's section is its own note's
        own_text = "\n".join(piece.text for piece in pieces if piece.kind == "text" and not piece.depth)
        self.own_heading = own_sources(own_text)
        if self.on:
            self.listing = self.look.sources_list or ("own" if self.own_heading else "generated")
        self.annex_lists = {which: annex_listing(self.look, which, own_section(own_text, which)) for which in OWN_SECTIONS}
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
                start = skip_repeated_title(tokens, piece.opens) if position == 0 and piece.opens is not None else 0
                base = piece.line + (0 if piece.fixed else block.line)
                line = base
                for index in range(start, len(tokens)):
                    token = tokens[index]
                    if token.map and not piece.fixed:
                        line = base + token.map[0]
                    if token.type == "list_item_open" and self.styled and task_state(tokens, index) is False:
                        self._tasks.append(line)
                    elif token.type == "blockquote_open" and callout_kind(tokens, index) == LIMITS:
                        self.limits.append((limits_words(tokens, index), line))
                    elif (token.type == "heading_open" and index + 1 < len(tokens)
                          and LIMITS_HEADING.match(tokens[index + 1].content.strip())):
                        self.limits_section = True
                    elif token.type == "inline":
                        self._inline(token, line, piece.fixed)
                    elif token.type == POST_TOKEN:
                        self._posts(token, line)
        self._finish()

    def _posts(self, token: Token, line: int) -> None:
        """A `::: post` block's posts, each a source the document cites; one the case no
        longer keeps, or a link not read yet, said where the block is."""
        from . import socialposts

        if self.case is None:
            return
        self.post_words.extend(socialposts.words(socialposts.card(self.case, token.content)))
        for entry in socialposts.parse_block(token.content).entries:
            source = self.reader.entity(entry.value) if entry.kind == "post" else None
            if source is not None and source.type == socialposts.TYPE:
                self._cited.append(source)
            elif entry.kind == "link":
                self._once(f"post-link:{entry.value}", f'The post "{cut_text(entry.value, 80)}" is not kept in the '
                           "case yet: Try again on it in the note.", line, MISSING)
            else:
                self._once(f"record:{entry.value}", "A post this note shows is no longer in the case.", line, MISSING)

    def _inline(self, token: Token, line: int, fixed: bool) -> None:
        at = line
        href: str | None = None
        words: list[str] = []
        opened = at
        # a footnote's links are read where its letter stands, so they are cited in reading order
        for child in with_footnotes(token.children):
            kind = child.type
            if kind in ("softbreak", "hardbreak"):
                at += 0 if fixed else 1
                words.append(" ")
            elif kind == "link_open":
                href, words, opened = token_attr(child, "href"), [], at
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
                name = cut_text(" ".join(words.split()) or entity.group(1), 80)
                self._once(f"record:{entity.group(1)}", f'The record "{name}" is no longer in the case.',
                           line, MISSING)
            else:
                self.ready.setdefault("records", []).append(
                    {"id": entity.group(1), "text": cut_text(" ".join(words.split()), 120), "line": line})
                if source.citable:
                    self._cited.append(source)
            return
        if is_local(href, self._prefixes):
            self._local.setdefault(href, line)
            return
        source = self.link_source(href, words)
        if source is not None:
            self._cited.append(source)
            if notesources.web(href):
                self._outside_link(href, words, line, source)

    def _outside_link(self, address: str, words: str, line: int | None, source: Source) -> None:
        key = urltitles.url_key(address)
        if key and key not in self._outside:
            self._outside[key] = (address, " ".join(words.split()), line, source)

    def _image(self, token: Token, line: int) -> None:
        src = token_attr(token, "src")
        name = notefill.picture_name(image_options(src).source)
        if name is not None:
            if self.identity.picture(name) is None:
                self._once(f"picture:{name}", notefill.NOT_SET[name], line, SETTING)
            return
        source = self.image_source(src)
        if source is None:
            return
        self._cited.append(source)
        if self.case is not None and source.noun != "Video":
            options = image_options(src)
            words = " ".join((token.content or "").split())
            self.ready.setdefault("pictures", []).append({
                "text": cut_text(words or options.caption or source.label or "Untitled", 80),
                "line": line,
                "alt": bool(options.caption.strip()) or bool(words and not BARE_ALT.match(words)),
                "credit": source.sourced or bool(CREDIT_WORDS.search(options.caption)),
            })
        if self.on and self.case is not None and not source.sourced:
            name = cut_text(" ".join((token.content or source.label).split()) or "Untitled", 80)
            noun = "Video" if source.noun == "Video" else "Picture"
            self._once(f"unsourced:{source.key}", f'{noun} "{name}" has no source.', line, UNSOURCED)

    def _prose(self, text: str, line: int) -> None:
        for _, _, address in bare_urls(text):
            if is_local(address, ()):
                self._local.setdefault(address, line)
            else:
                source = self.reader.link(address)
                self._cited.append(source)
                self._outside_link(address, "", line, source)
        for match in FILE_URL.finditer(text):
            self._local.setdefault(match.group(0), line)

    def _finish(self) -> None:
        if self.case is not None:
            if self._tasks:
                count = len(self._tasks)
                self._warn(f"{count} task{'s are' if count > 1 else ' is'} still open.", self._tasks[0], OPEN_TASK)
            for href, line in list(self._local.items())[:MAX_LOCAL_LINKS]:
                self._warn(f'The link "{cut_text(href, 80)}" will not open for a reader.', line, LOCAL_LINK)
            rest = len(self._local) - MAX_LOCAL_LINKS
            if rest > 0:
                self._warn(f"{rest} more link{'s' if rest > 1 else ''} will not open for a reader.", None, LOCAL_LINK)
            if self.on:
                self._check_links()
            self.ready["outside"] = [{"url": address, "text": words, "line": line}
                                     for address, words, line, _ in self.outside()]
        # a written link counts with every set of words the note linked it with
        self._cited = [self.reader.latest(source) for source in self._cited]
        if self.on or any(self.profile.annex(key) for key in ANNEXES_READ):
            self.everything = Annex(self._cited)
        if self.listing in ("generated", "both"):
            self.annex = self.everything
            assert self.annex is not None
            if self.annex.left_out:
                self._warn(f"The sources list stops at {self.annex.limit}; "
                           f"{self.annex.left_out} more are not listed.", None, OTHER)

    def generates(self, which: str) -> bool:
        """Whether the generated annex ``which`` (``method`` or ``geolocations``) prints,
        the note's own section of that name left as the only one unless the look asks."""
        return self.annex_lists.get(which, "generated") in ("generated", "both")

    @property
    def list_title(self) -> str:
        """What the generated list is headed: Sources, or References under the note's own Sources."""
        return "References" if self.listing == "both" and self.own_heading == "sources" else "Sources"

    def _own_work(self, address: str, source: Source) -> bool:
        """Whether a link points at the case's own work rather than at a source."""
        return (
            notesources.is_archive(address)
            or notesources.is_own_tool(address)
            or source.kind == notesources.IMAGERY  # a map view the case captured
            or self.reader.index.own_work(address)  # where the analyst published a proof
        )

    def outside(self) -> list[tuple[str, str, int | None, Source]]:
        """The outside pages the document links to, each once and in order, as (address,
        words, line, source): the links the check counts, the case's own work left out.
        Archive every link (`engine/linkarchive.py`) reads the same list."""
        return [one for one in self._outside.values() if not self._own_work(one[0], one[3])]

    def _check_links(self) -> None:
        """One line for the outside links with no archived copy, one for those the case
        holds nothing of; each names its link when it is alone and lists them otherwise."""
        unarchived: list[dict[str, Any]] = []
        unseen: list[dict[str, Any]] = []
        for address, words, line, source in self.outside():
            item = {"text": cut_text(words or urltitles.title_of(address), 120), "url": address, "line": line}
            if not source.archive:
                unarchived.append(item)
            if not source.collected:
                unseen.append(item)
        # every one, however the check words them, for the Ready panel's Bookmark them
        self.ready["unarchived"] = unarchived[:MAX_LISTED_LINKS]
        self.ready["unseen"] = unseen[:MAX_LISTED_LINKS]
        if self.profile.link_check == "each":
            # a report checks each link: one line per link, each going to its own line
            for found, kind in ((unarchived, UNARCHIVED), (unseen, UNSEEN)):
                for item in found[:MAX_LISTED_LINKS]:
                    said = ("has no archived copy." if kind == UNARCHIVED
                            else "is not in the case, so no day says when it was read.")
                    at = item["line"]
                    self._warn(f"\u201c{item['text']}\u201d {said}", at if isinstance(at, int) else None, kind)
            return
        if len(unarchived) == 1:
            self._warn(f"\u201c{unarchived[0]['text']}\u201d has no archived copy.", unarchived[0]["line"], UNARCHIVED)
        elif unarchived:
            self._warn(f"{len(unarchived)} outside links have no archived copy.", unarchived[0]["line"], UNARCHIVED)
            self.listed[UNARCHIVED] = unarchived[:MAX_LISTED_LINKS]
        if len(unseen) == 1:
            self._warn(f"\u201c{unseen[0]['text']}\u201d is not in the case, so no day says when it was read.",
                       unseen[0]["line"], UNSEEN)
        elif unseen:
            self._warn(f"{len(unseen)} links are not in the case, so no day says when they were read.",
                       unseen[0]["line"], UNSEEN)
            self.listed[UNSEEN] = unseen[:MAX_LISTED_LINKS]

    def _warn(self, message: str, line: int | None, kind: str) -> None:
        self.warnings.append((message, line, kind))

    def warn(self, message: str, line: int | None, kind: str) -> None:
        """Say one more thing the check before export should, from outside the pass."""
        self._warn(message, line, kind)

    def fix(self, message: str, line: int | None, settings: tuple[tuple[str, str], ...]) -> None:
        """Keep the settings that fix a warning a renderer said (a chart's title that should
        say "at least"), by its words and line, for the Ready panel (`fix_key`)."""
        if settings:
            self.ready.setdefault("fixes", {})[fix_key(message, line)] = [[key, value] for key, value in settings]

    def once(self, key: str, message: str, line: int | None, kind: str) -> None:
        """`warn`, unless something said it under ``key`` already."""
        self._once(key, message, line, kind)

    def _once(self, key: str, message: str, line: int | None, kind: str) -> None:
        if key not in self._warned:
            self._warned.add(key)
            self._warn(message, line, kind)

    def words(self) -> list[str]:
        """What the sources list prints, and the posts the document draws, for the fonts to cover."""
        if self.annex is None:
            return list(self.post_words)
        said: list[str] = list(self.post_words)
        style = self.profile.sources_style
        for entry in self.annex.entries:
            source = entry.source
            said.extend((source.label, *notesources.details(source), source.address, source.archive))
            said.extend(f"{site}: {address}" for site, address in source.verify)
            if style != "short":
                said.append(notesources.entry_text(notesources.entry(source, style, entry.origins)))
        return said


def fix_key(message: str, line: int | None) -> str:
    """How a warning's fix is found again once the warnings are said: its line and words."""
    return f"{line}\x1f{message}"


def own_sources(text: str) -> str:
    """The word a note's own sources section is headed with, "sources" or "references", or ""
    when it has none: a heading line of its own text, code left out (`OWN_SOURCES`)."""
    fence = ""
    for line in text.splitlines():
        fence, code = _fence_step(line, fence)
        if code:
            continue
        found = OWN_SOURCES.match(line)
        if found:
            return found.group(1).lower()
    return ""


def _fence_step(line: str, fence: str) -> tuple[str, bool]:
    """The fence open after `line` and whether the line is code (or a fence), from the one open before it."""
    marks = FENCE_LINE.match(line)
    if fence:
        closes = marks is not None and marks.group(1)[0] == fence[0] and len(marks.group(1)) >= len(fence)
        return ("" if closes else fence), True
    return (marks.group(1), True) if marks else ("", False)


def own_section(text: str, which: str) -> bool:
    """Whether a note holds its own section of `OWN_SECTIONS` (``method`` or
    ``geolocations``): a heading line of its own text, code left out."""
    pattern = OWN_SECTIONS[which]
    fence = ""
    for line in text.splitlines():
        fence, code = _fence_step(line, fence)
        if not code and pattern.match(line):
            return True
    return False


def without_own_sources(text: str) -> str:
    """The note with its own sources section emptied: its heading and everything under it
    up to the next heading of its rank or above, the lines kept so every line number holds."""
    return _without_section(text, OWN_SOURCES)


def without_own_section(text: str, which: str) -> str:
    """The note with its own section of `OWN_SECTIONS` emptied, as `without_own_sources`."""
    return _without_section(text, OWN_SECTIONS[which])


def _without_section(text: str, opens: re.Pattern[str]) -> str:
    lines = text.split("\n")
    fence = ""
    start: int | None = None
    rank = 0
    end = len(lines)
    for index, line in enumerate(lines):
        fence, code = _fence_step(line, fence)
        if code:
            continue
        heading = ATX_LINE.match(line)
        if start is None:
            if heading and opens.match(line):
                start, rank = index, len(heading.group(1))
            continue
        if heading and len(heading.group(1)) <= rank:
            end = index
            break
    if start is None:
        return text
    return "\n".join([*lines[:start], *([""] * (end - start)), *lines[end:]])


def annex_listing(look: NoteLook, which: str, own: bool) -> str:
    """Whether the generated annex ``which`` (``method`` or ``geolocations``) is printed in
    place of the note's own section, beside it, or not at all: the look's choice, else the
    note's own section when it has one (``own``), else the generated annex."""
    chosen: str = getattr(look, f"{which}_list")
    return chosen or ("own" if own else "generated")


def sections_cut(text: str, look: NoteLook, profile: Profile) -> str:
    """The note as its look prints it: with a generated list or annex chosen in place of the
    note's own section (`sources_list`, `method_list` or `geolocations_list` "generated"),
    that section is left out. Only while the style prints the list or the annex."""
    if look.sources_list == "generated" and profile.sources:
        text = without_own_sources(text)
    for which in OWN_SECTIONS:
        if getattr(look, f"{which}_list") == "generated" and profile.annex(which):
            text = without_own_section(text, which)
    return text


#: What a count is a count of: the nouns a register or a strike report counts. A
#: number followed straight by one is read as a count; any other number is not.
COUNT_NOUNS = frozenset("""
vehicle vehicles tank tanks truck trucks pickup pickups person people civilian civilians fighter fighters
soldier soldiers dead killed wounded casualty casualties strike strikes building buildings home homes
boat boats drone drones aircraft
""".split())
#: A number followed by a word, the shape of a count.
BARE_COUNT = re.compile(r"(?<![\w.,:/#+~≥≤>–—-])(\d{1,6})(?![\w.,:/%°×+–—-])[ \t]+([A-Za-z]+)\b")
#: What before a count makes it a minimum, a maximum or a range: a hedge, or a first
#: number and `to`, `-` or `or` (`40 to 60 vehicles`).
HEDGES = re.compile(
    r"(?:\bat\s+least|\bat\s+most|\babout|\baround|\bapproximately|\bapprox\.?|\broughly|\bsome|\bup\s+to|"
    r"\bmore\s+than|\bless\s+than|\bfewer\s+than|\bover|\bunder|\bnearly|\balmost|\bestimated|\bbetween|"
    r"\bminimum\s+of|\bmaximum\s+of|\bc\.|\bca\.|~|≥|≤|>|<|\d\s*(?:to|or|-|–|—)\s*)\s*$",
    re.I,
)
#: How many counts the check's one warning quotes.
MAX_COUNTS = 5


def exact_counts(inline: Token) -> list[str]:
    """The counts a paragraph gives as exact, for the check: a number straight before a
    noun of `COUNT_NOUNS`, with no hedge or range before it, each as written (`12 trucks`).
    Its code spans are no prose. The PDF and the HTML page read a paragraph alike; neither
    reads a heading, a table, a caption or a quote."""
    text = _count_text(inline.children)
    found: list[str] = []
    for match in BARE_COUNT.finditer(text):
        if match.group(2).lower() not in COUNT_NOUNS or int(match.group(1)) < 2:
            continue
        if HEDGES.search(text[max(0, match.start() - 24):match.start()]):
            continue
        found.append(f"{match.group(1)} {match.group(2)}")
    return found


def _count_text(children: list[Token] | None) -> str:
    """A line's prose for `exact_counts`: code as a stop, and each footnote's words read where
    its letter stands, set apart so no hedge reaches across into or out of them."""
    said: list[str] = []
    for child in children or []:
        if child.type == FOOTNOTE_TOKEN:
            said.append(f"\x00{_count_text(child.children)}\x00")
        elif child.type == "code_inline":
            said.append("\x00")
        elif child.type in ("softbreak", "hardbreak"):
            said.append(" ")
        elif child.type == "text":
            said.append(child.content)
    return "".join(said)


def counts_said(phrases: list[str]) -> str:
    """The check's one warning for the counts a note gives as exact, a few quoted."""
    said = list(dict.fromkeys(phrases))
    quoted = ", ".join(f'"{phrase}"' for phrase in said[:MAX_COUNTS])
    quoted += ", …" if len(said) > MAX_COUNTS else "."
    # counted as they are quoted: one phrase written twice is one count
    if len(said) == 1:
        return f'1 count reads as exact: {quoted} Say "at least" or give a range.'
    return f'{len(said)} counts read as exact: {quoted} Say "at least" or give a range.'


def counts_listed(counts: list[tuple[str, int | None]]) -> list[dict[str, Any]]:
    """The counts behind the check's one line, each its words and the first line it is
    written on, counted as the line counts them (one phrase written twice is one count):
    what the Ready panel's Say "at least" reads."""
    first: dict[str, int | None] = {}
    for phrase, line in counts:
        first.setdefault(phrase, line)
    return [{"text": phrase, "url": "", "line": line} for phrase, line in first.items()][:MAX_LISTED_LINKS]


def heading_level(tag: str, shift: int) -> int:
    """A heading's level once its chapter has moved it, kept between 1 and 6."""
    return max(1, min(6, int(tag[1]) + shift))


TASK_MARK = re.compile(r"^\[([ xX])\]\s+")


def task_state(tokens: list[Token], index: int) -> bool | None:
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


def take_task(tokens: list[Token], index: int) -> bool | None:
    """A list item that opens with `[ ]` or `[x]`: whether it is done, the marker
    taken out of its text. None for an ordinary item."""
    state = task_state(tokens, index)
    if state is None:
        return None
    inline = tokens[index + 2]
    match = TASK_MARK.match(inline.content)
    assert match is not None
    children = inline.children or []
    inline.content = inline.content[match.end():]
    children[0].content = children[0].content[match.end():]
    return state


def callout_kind(tokens: list[Token], index: int) -> str:
    """The kind a quote opens with, `confirmed` for `> [!confirmed]`, read without
    touching the tokens."""
    if index + 2 >= len(tokens) or tokens[index + 1].type != "paragraph_open":
        return ""
    match = CALLOUT.match(f">{tokens[index + 2].content}")
    kind = match.group(2).lower() if match else ""
    return kind if kind in CALLOUTS else ""


def limits_words(tokens: list[Token], index: int) -> str:
    """The words of the Limits box opening at ``index``, its marker left out, on one line."""
    end = past(tokens, index)
    said: list[str] = []
    for token in tokens[index + 1:end]:
        if token.type != "inline":
            continue
        for child in token.children or []:
            if child.type in ("text", "code_inline"):
                said.append(child.content)
            elif child.type in ("softbreak", "hardbreak"):
                said.append(" ")
        said.append(" ")
    text = " ".join("".join(said).split())
    match = CALLOUT.match(f">{text}")
    return text[len(match.group(0)) - 1:].strip() if match else text


def past(tokens: list[Token], index: int) -> int:
    """The index after the block that opens at ``index``."""
    opening = tokens[index]
    closing = opening.type.replace("_open", "_close")
    for position in range(index + 1, len(tokens)):
        if tokens[position].type == closing and tokens[position].level == opening.level:
            return position + 1
    return len(tokens)


def take_callout(tokens: list[Token], index: int) -> tuple[str, tuple[int, int, int]] | None:
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


def skip_repeated_title(tokens: list[Token], title: str) -> int:
    """Where to start reading, past a heading that only repeats the title.

    Plenty of notes open by restating their own name as an `# H1`. On screen
    that is the only title there is; here the page already carries it.
    """
    if len(tokens) < 3 or tokens[0].type != "heading_open" or tokens[0].tag != "h1":
        return 0
    heading = (tokens[1].content or "").strip().casefold()
    return 3 if heading == title.strip().casefold() else 0


def inline_text(token: Token) -> str:
    """An inline token's words, read without drawing (or counting) its pictures."""
    return "".join(
        child.content
        for child in token.children or []
        if child.type in ("text", "code_inline") or (child.type == "html_inline" and not child.content.startswith("<!--"))
    )


#: A Log entry's heading, as the Notebook's `/` menu writes it (`lib/notes/syntax.js`,
#: `logStamp`): `2026-11-04 14:32 (UTC+1)`, then whatever the analyst adds.
LOG_STAMP = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?)?"
    r"(?:\s*\(([^)]{1,24})\))?\s*(?:[-–—:]\s*)?(.*)$",
    re.S,
)


def prints(tokens: list[Token], index: int) -> bool:
    """Whether the block opening at ``index`` puts anything on the page: a rule, a
    page break or a comment does not, and neither does a paragraph of guidance."""
    token = tokens[index]
    if token.type == "paragraph_open":
        inline = tokens[index + 1] if index + 1 < len(tokens) else None
        if inline is None:
            return False
        return bool(inline_text(inline).strip()) or any(
            child.type in ("image", FOOTNOTE_TOKEN) for child in inline.children or []
        )
    if token.type == "html_block":
        text = token.content.strip()
        return bool(text) and not PAGE_BREAK.match(text) and not COMMENT.match(text)
    return token.type not in ("hr", "heading_open", *COLUMN_MARKS)


def empty_sections(pieces: list[Piece], blocks: dict[int, list[Block]], *, journal: bool) -> list[tuple[str, int]]:
    """Each heading with nothing under it before the next heading of its rank, with
    its line: a report sent with "Method" and no method is the slip to catch.

    A heading that only holds deeper headings is not named, since those are, and a
    journal's dated entry is an entry rather than a heading waiting for words.
    Guidance and comments print nothing, so a section holding only those is empty
    too. ``blocks`` are each piece's (`alignment_blocks`), read from their ``start``.
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
                    name = " ".join(inline_text(block.tokens[index + 1]).split())
                    if journal and token.tag == "h3" and LOG_STAMP.match(name):
                        content()
                        continue
                    line = piece.line if piece.fixed else base + (token.map[0] if token.map else 0)
                    heading(heading_level(token.tag, piece.shift), name, line)
                elif prints(block.tokens, index):
                    content()
    heading(0, "", 0)
    return empty


def cut_text(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"
