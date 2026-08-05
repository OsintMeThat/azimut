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

Two things a server cannot do on its own:

- **Diagrams.** Drawing Mermaid needs a browser, so the caller renders each
  fence and posts it as a PNG, keyed by the hash of its source. A fence with no
  PNG falls back to its own source in a code box rather than vanishing.
- **Remote images.** They stay out, as they did in the print export: opening a
  note must not make the machine fetch anything (spec — local-first).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable
from urllib.parse import parse_qs, unquote, urlsplit

from fpdf import FPDF
from fpdf.enums import Align, XPos, YPos
from markdown_it import MarkdownIt
from markdown_it.token import Token
from PIL import Image as PILImage
from PIL import UnidentifiedImageError

from . import pdffonts

if TYPE_CHECKING:
    from ..workspace import Case

# -- the document's look -----------------------------------------------------
#
# Carried over from the print stylesheet this replaces, so an export made before
# and after the change is recognisably the same document: serif body, sans
# headings, and the app's amber as the one accent.

ACCENT = (189, 122, 37)
ACCENT_DARK = (109, 69, 21)
INK = (32, 33, 36)
MUTED = (119, 119, 119)
RULE = (216, 209, 200)
CODE_BG = (248, 246, 243)
TABLE_HEAD_BG = (241, 236, 229)
NOTE_BG = (250, 248, 245)

MARGIN_TOP = 18.0
MARGIN_SIDE = 16.0
MARGIN_BOTTOM = 20.0
#: A4 in millimetres, which is fpdf2's unit here.
PAGE_WIDTH = 210.0
PAGE_HEIGHT = 297.0
FRAME_WIDTH = PAGE_WIDTH - 2 * MARGIN_SIDE

BODY_SIZE = 10.0
LEADING = 5.4
GAP = 3.4

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

MERMAID_INFO = re.compile(r"^\s*mermaid\b")
ENTITY_REF = re.compile(r"\[\[entity:([A-Za-z0-9_-]+)\|([^\]]+)\]\]")
MEDIA_REF = re.compile(r"\[\[media:([A-Za-z0-9_-]+)\|([^\]]+)\]\](?:\{([^}\n]+)\})?")
IMAGE_ATTRS = re.compile(r"!\[([^\]]*)\]\((\S+?)(?:\s+[\"']([^\"']*)[\"'])?\)\s*\{([^}\n]+)\}")
ALIGNMENT_BLOCK = re.compile(r"^:::[ \t]*(left|center|right)[ \t]*\n(.*?)^:::[ \t]*$", re.S | re.M)
ATTR_PARAM = "__azimut_attrs"
ATTR_VALUES = re.compile(r"\b(width|align)\s*=\s*([\w.%+-]+)")
WIDTH_PERCENT = re.compile(r"^(?:[1-9]\d?(?:\.\d+)?|100(?:\.0+)?)%$")
WIDTH_PIXELS = re.compile(r"^(?:[2-9]\d|[1-9]\d{2}|1[0-5]\d{2}|1600)px$")

ALIGNMENTS = {"left": Align.L, "center": Align.C, "right": Align.R}


def embedded_entity_ids(text: str) -> list[str]:
    """The case artifacts a note shows, in the order they appear, deduplicated.

    ``[[media:…]]`` only, never ``[[entity:…]]``: the first is the note *showing* a
    file, which is a derivation, where the second is a pointer at a record, which is
    a mention (ONTOLOGY §3). Reuses the renderer's own pattern, so what the chain
    records and what the page draws can never become two readings of one note.
    """
    return list(dict.fromkeys(match.group(1) for match in MEDIA_REF.finditer(text or "")))

#: Heading sizes, h1 to h6, and the space above each.
HEADINGS = {
    "h1": (16.0, 7.0),
    "h2": (13.5, 6.0),
    "h3": (11.5, 5.0),
    "h4": (10.5, 4.5),
    "h5": (10.0, 4.0),
    "h6": (9.5, 4.0),
}


class NotesPdfError(Exception):
    """The note could not be turned into a document."""


@dataclass
class Rendered:
    """One finished PDF, and what the analyst should know about it."""

    pdf: bytes
    #: One line per thing the page could not show — a remote image left out, a
    #: script no font covers. Shown by the caller; never a reason to fail.
    warnings: list[str] = field(default_factory=list)


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


def mermaid_sources(text: str) -> list[str]:
    """Every Mermaid fence in a note, in document order.

    The caller draws these; it is here rather than in the frontend so one parser
    decides what counts as a diagram.
    """
    return [
        token.content
        for token in _parser().parse(_case_references(text))
        if token.type == "fence" and MERMAID_INFO.match(token.info or "")
    ]


def render(
    case: "Case",
    *,
    title: str,
    text: str,
    diagrams: dict[str, bytes] | None = None,
) -> Rendered:
    """Lay one note out as a PDF."""
    document = _Note(title=title)
    pdffonts.install(document, f"{title}\n{text}")
    builder = _Builder(document, case, diagrams or {})
    try:
        builder.build(title, text)
        output = bytes(document.output())
    except pdffonts.FontError:
        raise
    except Exception as exc:  # fpdf2 raises bare errors for layout dead ends
        raise NotesPdfError(f"the note could not be laid out: {exc}") from exc
    return Rendered(pdf=output, warnings=builder.warnings)


# -- source rewrites, mirroring lib/markdown.js ------------------------------


def _attributed_url(href: str, attributes: str) -> str:
    separator = "&" if "?" in href else "?"
    return f"{href}{separator}{ATTR_PARAM}={_quote(attributes)}"


def _quote(value: str) -> str:
    """Percent-encode the way the preview's `encodeURIComponent` does."""
    return "".join(
        char if char.isalnum() or char in "-_.~" else f"%{ord(char):02X}" for char in value
    )


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


def _image_options(href: str) -> tuple[str, str, str]:
    """Split an annotated image URL back into source, width and alignment."""
    parts = urlsplit(href)
    query = parse_qs(parts.query, keep_blank_values=True)
    attributes = unquote(query.pop(ATTR_PARAM, [""])[0])
    rebuilt = "&".join(f"{key}={value}" for key, values in query.items() for value in values)
    source = parts._replace(query=rebuilt).geturl()
    values = dict(ATTR_VALUES.findall(attributes))
    width = values.get("width", "")
    if not (WIDTH_PERCENT.match(width) or WIDTH_PIXELS.match(width)):
        width = ""
    align = values.get("align", "left")
    return source, width, align if align in ALIGNMENTS else "left"


def _parser() -> MarkdownIt:
    """CommonMark plus the two GFM rules the preview enables (marked's `gfm`)."""
    return MarkdownIt("commonmark").enable(["table", "strikethrough"])


def _attr(token: Token, name: str) -> str:
    """One token attribute as text; the parser types them loosely."""
    value = token.attrGet(name)
    return "" if value is None else str(value)


# -- page furniture ----------------------------------------------------------


class _Note(FPDF):
    """A4 with a running footer: the note's name on the left, the page number
    on the right, over a hairline."""

    def __init__(self, *, title: str) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.note_title = title
        self.set_margins(MARGIN_SIDE, MARGIN_TOP, MARGIN_SIDE)
        self.set_auto_page_break(True, margin=MARGIN_BOTTOM)
        self.set_title(title)
        self.set_creator("Azimut")
        self.set_subject("Case notes")
        # The analyst's own name is not ours to write into a file they share.
        self.set_author("Azimut")

    def footer(self) -> None:
        self.set_y(-MARGIN_BOTTOM + 6)
        self.set_draw_color(*RULE)
        self.set_line_width(0.15)
        self.line(MARGIN_SIDE, self.get_y(), PAGE_WIDTH - MARGIN_SIDE, self.get_y())
        self.ln(1.5)
        self.set_font(pdffonts.SANS, size=7.5)
        self.set_text_color(*MUTED)
        width = FRAME_WIDTH / 2
        self.cell(width, 4, self.note_title, align=Align.L)
        self.cell(width, 4, str(self.page_no()), align=Align.R)


# -- Markdown to a page ------------------------------------------------------


class _Builder:
    """Walks the parsed note and draws it.

    Kept as an object because the walk collects what the caller needs — the
    warnings, and the running count of images a note is allowed to embed.
    """

    def __init__(self, pdf: _Note, case: "Case", diagrams: dict[str, bytes]) -> None:
        self.pdf = pdf
        self.case = case
        self.diagrams = diagrams
        self.warnings: list[str] = []
        self.images = 0
        #: How deep inside nested lists the walk currently is.
        self._depth = 0
        self._remote = 0
        self._file_prefix = f"/files/{case.id}/"

    # -- entry point --------------------------------------------------------

    def build(self, title: str, text: str) -> None:
        self.pdf.add_page()
        self._title_block(title)
        blocks = self._alignment_blocks(text)
        drawn = False
        for position, (alignment, tokens, index) in enumerate(blocks):
            if position == 0:
                index = _skip_repeated_title(tokens, title)
            drawn = self._walk(tokens, index, alignment, stop=None)[0] or drawn
        if not drawn:
            self._aside("This note is empty.")
        self._collect_warnings(f"{title}\n{text}")

    def _title_block(self, title: str) -> None:
        pdf = self.pdf
        pdf.set_font(pdffonts.SANS, "B", 7.5)
        pdf.set_text_color(*ACCENT_DARK)
        pdf.cell(0, 4, "AZIMUT NOTES", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(1.5)
        pdf.set_font(pdffonts.SANS, "B", 22)
        pdf.set_text_color(24, 24, 24)
        pdf.multi_cell(FRAME_WIDTH, 9, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(2)
        pdf.set_draw_color(*ACCENT)
        pdf.set_line_width(0.45)
        pdf.line(MARGIN_SIDE, pdf.get_y(), PAGE_WIDTH - MARGIN_SIDE, pdf.get_y())
        pdf.ln(6)

    def _collect_warnings(self, text: str) -> None:
        if self._remote:
            self.warnings.append(
                f"{self._remote} remote image{'s' if self._remote > 1 else ''} left out: "
                "the export never fetches from the network."
            )
        missing = pdffonts.uncovered(self.pdf, text)
        if missing:
            scripts = sorted({pdffonts.script_of(char) for char in missing})
            self.warnings.append(
                f"No font on this machine covers {', '.join(scripts)}; "
                "those characters were left out."
            )

    def _alignment_blocks(self, text: str) -> list[tuple[Align, list[Token], int]]:
        """Parse the note, honouring the `::: center` blocks around parts of it.

        Each block is parsed on its own so its alignment can be pushed into
        everything it produced, which is how the preview reads it too.
        """
        blocks: list[tuple[Align, list[Token], int]] = []
        position = 0
        for match in ALIGNMENT_BLOCK.finditer(text):
            blocks.append((Align.L, self._parse(text[position : match.start()]), 0))
            blocks.append((ALIGNMENTS[match.group(1)], self._parse(match.group(2)), 0))
            position = match.end()
        blocks.append((Align.L, self._parse(text[position:]), 0))
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
            handler = getattr(self, f"_on_{token.type}", None)
            if handler is None:
                index += 1
                continue
            index = handler(tokens, index, align)
            drew = True
        return drew, index

    # -- blocks -------------------------------------------------------------

    def _on_heading_open(self, tokens: list[Token], index: int, align: Align) -> int:
        size, space = HEADINGS.get(tokens[index].tag, HEADINGS["h6"])
        runs = self._inline(tokens[index + 1])
        pdf = self.pdf
        if pdf.get_y() > MARGIN_TOP + 2:
            pdf.ln(space)
        # A heading alone at the foot of a page belongs with what follows it, so
        # what follows is measured rather than assumed: two lines of text is one
        # thing to reserve, a full-width capture is another.
        if pdf.will_page_break(size * 0.7 + self._next_height(tokens, index + 3)):
            pdf.add_page()
        self._runs(
            runs,
            align=align,
            size=size,
            leading=size * 0.46,
            family=pdffonts.SANS,
            bold=True,
            color=MUTED if tokens[index].tag == "h6" else INK,
            bottom=1.8,
        )
        return index + 3

    def _next_height(self, tokens: list[Token], index: int) -> float:
        """How tall the block after a heading is, for pictures; two lines else.

        Only pictures are measured, because they are the blocks tall enough to
        leave a heading behind on its own.
        """
        if index >= len(tokens):
            return LEADING * 2
        token = tokens[index]
        picture: tuple[int, int] | None = None
        width_attr = ""
        if token.type == "fence" and MERMAID_INFO.match(token.info or ""):
            png = self.diagrams.get(diagram_key(token.content))
            picture = _measure(BytesIO(png)) if png else None
        elif token.type == "paragraph_open" and index + 1 < len(tokens):
            children = [
                child
                for child in (tokens[index + 1].children or [])
                if child.type != "softbreak"
            ]
            if len(children) == 1 and children[0].type == "image":
                resolved = self._peek_image(children[0])
                if resolved is not None:
                    picture = resolved
                    _, width_attr, _ = _image_options(_attr(children[0], "src"))
        if picture is None:
            return LEADING * 2
        return _fit(picture, width_attr, FRAME_WIDTH)[1]

    def _peek_image(self, token: Token) -> tuple[int, int] | None:
        """An image's pixel size without counting it against the note's budget."""
        images, remote = self.images, self._remote
        try:
            resolved = self._resolve_image(token)
        finally:
            self.images, self._remote = images, remote
        return None if isinstance(resolved, str) else resolved[1]

    def _on_paragraph_open(self, tokens: list[Token], index: int, align: Align) -> int:
        inline = tokens[index + 1]
        if self._standalone_image(inline, align):
            return index + 3
        runs = self._inline(inline)
        if runs:
            self._runs(runs, align=align, bottom=1.2 if self._depth else GAP)
        return index + 3

    def _on_hr(self, tokens: list[Token], index: int, align: Align) -> int:
        pdf = self.pdf
        pdf.ln(1.5)
        pdf.set_draw_color(*RULE)
        pdf.set_line_width(0.2)
        pdf.line(MARGIN_SIDE, pdf.get_y(), PAGE_WIDTH - MARGIN_SIDE, pdf.get_y())
        pdf.ln(GAP + 1.5)
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
        pdf = self.pdf
        top = pdf.get_y()
        page = pdf.page
        with self._indent(5.0):
            _, index = self._walk(tokens, index + 1, align, stop="blockquote_close")
        # Only bar the part on this page: a quote that split has a second half
        # whose top is nowhere near where it started.
        if pdf.page == page:
            pdf.set_draw_color(*ACCENT)
            pdf.set_line_width(0.7)
            pdf.line(MARGIN_SIDE + 0.4, top, MARGIN_SIDE + 0.4, pdf.get_y() - GAP)
        return index

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
            pdf = self.pdf
            pdf.set_font(pdffonts.SERIF, size=BODY_SIZE)
            pdf.set_text_color(*ACCENT_DARK)
            pdf.set_x(pdf.l_margin + (1.5 if self._depth == 1 else 0.0))
            pdf.cell(BULLET_WIDTH, LEADING, f"{number}." if ordered else "\u2022")
            with self._indent(BULLET_WIDTH + 1.5):
                _, index = self._walk(tokens, index + 1, align, stop="list_item_close")
            number += 1
        self._depth -= 1
        if not self._depth:
            self.pdf.ln(GAP - 1.6)
        return index + 1

    def _on_table_open(self, tokens: list[Token], index: int, align: Align) -> int:
        rows: list[list[str]] = []
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
                cells: list[str] = []
                index += 1
                while index < len(tokens) and tokens[index].type != "tr_close":
                    if tokens[index].type in ("th_open", "td_open"):
                        cells.append(_plain(self._inline(tokens[index + 1])))
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
        if text:
            self._aside(text)
        return index + 1

    # -- inline -------------------------------------------------------------

    def _inline(self, token: Token) -> list[Run]:
        """One inline token stream flattened into styled runs."""
        if token.type != "inline":
            return []
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
            elif kind in ("text", "html_inline", "code_inline", "softbreak", "hardbreak"):
                text = {"softbreak": " ", "hardbreak": "\n"}.get(kind, child.content)
                if not text:
                    continue
                colour = INK
                if entity == 1:
                    colour = ACCENT_DARK
                elif entity == 2 or (link and not entity):
                    colour = MUTED if entity else ACCENT_DARK
                runs.append(
                    Run(
                        text=text,
                        bold=bool(bold) or entity == 1,
                        italic=bool(italic) or entity == 2,
                        mono=kind == "code_inline",
                        color=colour,
                        link="" if entity else link,
                    )
                )
        return [run for run in runs if run.text]

    def _link_style(self, token: Token) -> tuple[str, int]:
        """How a link is drawn, which depends on where it points.

        A PDF is read away from the app, so a reference to another entity cannot
        link anywhere. It stays visible as a reference, and turns quiet and
        italic once the entity it named has been deleted from the case.
        """
        href = _attr(token, "href")
        entity = re.match(r"^azimut://entity/([A-Za-z0-9_-]+)$", href)
        if entity:
            return "", 1 if self.case.get_entity(entity.group(1)) is not None else 2
        return href, 0

    def _inline_image(self, token: Token) -> Run:
        """An image inside a run of text: named, not drawn.

        fpdf2 places a picture at a point on the page, not in the middle of a
        wrapping line, and a note that inlines a capture means it to be seen —
        so it is drawn as its own block instead (`_standalone_image`).
        """
        resolved = self._resolve_image(token)
        label = resolved if isinstance(resolved, str) else (token.content or "Image")
        return Run(text=f"[{label}]", italic=True, color=MUTED)

    # -- drawing ------------------------------------------------------------

    def _indent(self, amount: float) -> "_Indent":
        return _Indent(self.pdf, amount)

    def _runs(
        self,
        runs: Iterable[Run],
        *,
        align: Align = Align.L,
        size: float = BODY_SIZE,
        leading: float = LEADING,
        family: str = pdffonts.SERIF,
        bold: bool = False,
        color: tuple[int, int, int] = INK,
        bottom: float = GAP,
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
        right = PAGE_WIDTH - pdf.r_margin - 2 * pdf.c_margin
        for run in runs:
            emphasis = ("B" if run.bold or bold else "") + ("I" if run.italic else "")
            run_family = pdffonts.MONO if run.mono else family
            if run.mono:
                emphasis = ""  # the mono face ships in one weight
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

    def _aside(self, message: str) -> None:
        """A quiet, boxed line: what the page could not show, said in place."""
        pdf = self.pdf
        pdf.set_font(pdffonts.SERIF, "I", 9)
        pdf.set_text_color(*MUTED)
        pdf.set_fill_color(*NOTE_BG)
        pdf.set_draw_color(*RULE)
        pdf.set_line_width(0.5)
        top = pdf.get_y()
        pdf.set_x(MARGIN_SIDE + 2.5)
        pdf.multi_cell(
            FRAME_WIDTH - 2.5, 5.2, message, fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT
        )
        pdf.line(MARGIN_SIDE + 0.6, top, MARGIN_SIDE + 0.6, pdf.get_y())
        pdf.ln(GAP)

    def _code_box(self, code: str) -> None:
        """Preformatted text in a tinted box, indentation and all."""
        pdf = self.pdf
        size = 8.5
        leading = 4.3
        pdf.set_font(pdffonts.MONO, size=size)
        lines = [
            part
            for line in code.rstrip("\n").split("\n")
            for part in _hard_wrap(line, pdf, FRAME_WIDTH - 8)
        ]
        pdf.set_text_color(*INK)
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
            pdf.set_fill_color(*CODE_BG)
            pdf.rect(left, pdf.get_y(), width, leading, style="F")
            pdf.set_x(left + 3)
            # `cell` rather than a text region: it keeps the leading spaces,
            # which in code are the meaning rather than decoration.
            pdf.cell(width - 6, leading, line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self._close_code_box(left, width, chunk_top, pdf.get_y() + 1.6)
        pdf.ln(1.6 + GAP)

    def _close_code_box(self, left: float, width: float, top: float, bottom: float) -> None:
        pdf = self.pdf
        pdf.set_fill_color(*CODE_BG)
        pdf.rect(left, bottom - 1.6, width, 1.6, style="F")
        pdf.set_draw_color(*RULE)
        pdf.set_line_width(0.2)
        pdf.rect(left, top, width, bottom - top, style="D")

    def _table(self, rows: list[list[str]], header_rows: int) -> None:
        pdf = self.pdf
        columns = min(max(len(row) for row in rows), MAX_TABLE_COLUMNS)
        squared = [(row + [""] * columns)[:columns] for row in rows]
        pdf.set_font(pdffonts.SERIF, size=9)
        pdf.set_text_color(*INK)
        pdf.set_draw_color(*RULE)
        pdf.set_line_width(0.2)
        from fpdf.fonts import FontFace

        with pdf.table(
            col_widths=_column_widths(squared, columns),
            line_height=5.0,
            text_align=Align.L,
            padding=(1.6, 2.2),
            headings_style=FontFace(
                family=pdffonts.SANS, emphasis="B", size_pt=9, fill_color=TABLE_HEAD_BG
            ),
            first_row_as_headings=bool(header_rows),
            repeat_headings=1,
        ) as table:
            for line in squared:
                row = table.row()
                for cell in line:
                    row.cell(cell)
        pdf.ln(GAP)

    def _standalone_image(self, inline: Token, align: Align) -> bool:
        """A paragraph that is nothing but one image becomes a block image."""
        children = [child for child in (inline.children or []) if child.type != "softbreak"]
        if len(children) != 1 or children[0].type != "image":
            return False
        token = children[0]
        resolved = self._resolve_image(token)
        if isinstance(resolved, str):
            self._aside(resolved)
            return True
        path, natural = resolved
        _, width_attr, image_align = _image_options(_attr(token, "src"))
        self._place(path, natural, width_attr, ALIGNMENTS[image_align], _attr(token, "title"))
        return True

    def _place(
        self,
        source: Path | BytesIO,
        natural: tuple[int, int],
        width_attr: str,
        align: Align,
        caption: str,
    ) -> None:
        pdf = self.pdf
        width, height = _fit(natural, width_attr, FRAME_WIDTH)
        if pdf.will_page_break(height + (5 if caption else 0)):
            pdf.add_page()
        pdf.image(source, w=width, h=height, x=align)
        if caption:
            pdf.ln(1)
            pdf.set_font(pdffonts.SANS, size=8)
            pdf.set_text_color(*MUTED)
            pdf.multi_cell(
                pdf.epw, 4, caption, align=align, new_x=XPos.LMARGIN, new_y=YPos.NEXT
            )
        pdf.ln(GAP)

    def _diagram(self, source: str) -> None:
        """The PNG the browser drew for this fence, or the fence's own source."""
        png = self.diagrams.get(diagram_key(source))
        natural = _measure(BytesIO(png)) if png else None
        if png is None or natural is None:
            self._aside("Diagram not drawn.")
            self._code_box(source)
            return
        self._place(BytesIO(png), natural, "", Align.C, "")

    def _resolve_image(self, token: Token) -> tuple[Path, tuple[int, int]] | str:
        """The file behind an image, or the line to print instead of it."""
        source, _, _ = _image_options(_attr(token, "src"))
        parts = urlsplit(source)
        if parts.scheme in ("http", "https"):
            self._remote += 1
            return "External image not included in PDF."
        if parts.scheme == "azimut" and parts.netloc == "media":
            entity = self.case.get_entity(unquote(parts.path.lstrip("/")))
            attrs = (entity or {}).get("attrs") or {}
            if not entity or not attrs.get("path"):
                return "Media unavailable"
            if attrs.get("kind") == "video":
                return "Video not included in PDF."
            relative = str(attrs["path"])
        elif source.startswith(self._file_prefix):
            relative = unquote(source[len(self._file_prefix) :])
        else:
            return "Image not included in PDF."
        if self.images >= MAX_IMAGES:
            return "Image not included in PDF: this note holds too many."
        try:
            path = self.case.resolve_inside(relative)
        except Exception:
            return "Media unavailable"
        natural = _measure(path)
        if natural is None:
            return "Media unavailable"
        self.images += 1
        return path, natural


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
    try:
        with PILImage.open(source) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                return None
            return image.width, image.height
    except (OSError, UnidentifiedImageError, PILImage.DecompressionBombError):
        return None
    finally:
        if isinstance(source, BytesIO):
            source.seek(0)


def _fit(natural: tuple[int, int], width_attr: str, available: float) -> tuple[float, float]:
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
    room = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - 12
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
    "Rendered",
    "diagram_key",
    "mermaid_sources",
    "render",
]
