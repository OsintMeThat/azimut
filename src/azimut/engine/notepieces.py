"""A note handed to Post: its public edition, read as the pieces of a thread.

The Notebook's **To Post** sends a note, or the stretch selected in it, to Post as
the start of a Free post thread. The Notebook never builds the thread: Post turns
the pieces into posts and cuts long text with its own counter (`tools/post/start.js`,
`startPieces`). This module only says what the note holds, in order:

- ``{"kind": "text", "text": …}`` for a paragraph, a list (its ``- `` lines kept), a
  quote or a callout (its label first, ``Confirmed: …``), with ``"heading": True``
  for a heading or a chapter's title;
- ``{"kind": "media", "path": …, "type": "image" | "video" | "gif", "id": …}`` for a
  picture or a video of the case, by its case-relative path, with ``"alt"`` for a chart;
- ``{"kind": "proof", "name": …, "id": …}`` for a Geo Proof's picture, by the proof's
  name;
- ``{"kind": "source", "url": …, "label": …}`` for a paragraph that is only a link.

A case reference reads as its label, and a written link as its words then its address
(a link a reader cannot open keeps its words only).

**Public edition only.** Every internal passage is blanked first, with the rule the
PDF and the HTML report follow (`notes_markdown.strip_internal`) over the whole note,
and only then is a selection cut out of it: a selection that starts inside a passage
carries none of it. What is left is read by the same parser with the same rewrites of
the note's syntax, chapters included and placeholders filled as the page prints them,
and it is checked again as the public PDF is: with a passage still there, nothing is
handed over.

**Charts.** A ``::: chart`` block goes as its picture for X, its title drawn on it and
said as its alt text. The picture is filed in the case's media (`notecharts.file_for_post`),
since a post carries files of the case; the same picture is filed once.

**Infographics.** A ``:::: infographic`` block goes as one picture of its whole page for X
(16:9), filed the same way, its title band, panels and sources said as its alt text.

**What stays out.** The cover above a ``<!-- cover -->`` line, the ``::: corner``
blocks, page breaks and comments print nothing in a post and go silently. Tables,
diagrams, code blocks and pictures that cannot go (gone from the case, on the web, an
audio file, the analyst's logo) are counted under ``left`` beside the internal
passages, for the Notebook to say once.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import unquote, urlsplit

from markdown_it.common.normalize_url import normalizeLinkText
from markdown_it.token import Token

from ..workspace import Case, CaseError
from . import notecharts, notefill, notes_infographic, notes_markdown, notesources
from .media import media_kind
from .notelook import NoteLook
from .notetext import without_hints

#: How many pieces one note hands over, as many as Post takes. The rest are counted.
MAX_PIECES = 200
#: What ``left`` counts, in the order the Notebook says them.
LEFT = ("internal", "tables", "diagrams", "other")
#: The fence of an aligned block that a selection's cut left without its pair.
ALIGN_FENCE = re.compile(r"^:::[ \t]*[\w-]*[ \t]*$")
#: Where a line of the note went on, kept apart from a break the analyst forced until
#: the fences are read, then said as the space Markdown makes of it.
SOFT = "\x00"
#: The room a picture or a mark left between two words.
SPACES = re.compile(r"(?<=\S)[ \t]{2,}")
#: What a link may hold to be a paragraph's only content: words, marks and line ends.
LINK_WORDS = frozenset({"text", "code_inline", "softbreak", "hardbreak", "em_open", "em_close",
                        "strong_open", "strong_close", "s_open", "s_close"})
#: What a file of the case goes to Post as, beside a GIF, which is said by its name.
POSTED_KINDS = ("image", "video")


class NotePiecesError(ValueError):
    """The note could not be read without an internal passage in what it hands over."""


@dataclass
class Handed:
    """What a note hands Post: its pieces, in order, and what stayed out, by kind."""

    pieces: list[dict[str, Any]] = field(default_factory=list)
    left: dict[str, int] = field(default_factory=lambda: dict.fromkeys(LEFT, 0))


def hand(
    case: Case | None,
    *,
    title: str,
    text: str,
    selection: tuple[int, int] | None = None,
    note_id: str = "",
    resolve: notes_markdown.Resolve | None = None,
    values: dict[str, str] | None = None,
    look: NoteLook | None = None,
) -> Handed:
    """The public edition of ``text`` as pieces for Post.

    ``selection`` is a stretch of ``text`` as the editor counts it, UTF-16 code units
    from the start, ``(start, end)``; None hands the whole note. ``resolve`` finds the
    notes a chapter line includes, and ``values`` fills the placeholders, as the PDF
    has them (`notes_pdf.render`). ``look`` is the note's, which its charts are drawn in.
    """
    prepared = without_hints(text)
    cover = notefill.split_cover(prepared)
    if cover is not None:
        prepared = cover.body
    stripped, passages = notes_markdown.strip_internal(prepared)
    handed = Handed()
    if selection is None:
        handed.left["internal"] = passages
    else:
        start, end = (_place(text, min(offset, len(text) * 2)) for offset in selection)
        handed.left["internal"] = _passages_met(prepared, stripped, start, end)
        stripped = _between(stripped, start, end)
    found = [0]
    expanded = notes_markdown.expand(title, stripped, resolve=resolve, note_id=note_id, public=True,
                                counter=found, values=values)
    handed.left["internal"] += found[0]
    reading = _Reading(case, handed, look=look, note_id=note_id,
                       note_text="\n".join(piece.text for piece in expanded if piece.kind == "text"))
    for piece in expanded:
        reading.piece(piece)
    return handed


# -- the selection -------------------------------------------------------------------


def _place(text: str, units: int) -> tuple[int, int]:
    """Where an offset the browser counts in UTF-16 code units falls: (line, column),
    the column in characters as Python counts them, so a picture written as an emoji
    before the selection does not shift it."""
    if text.isascii():
        index = min(units, len(text))
    else:
        index = len(text.encode("utf-16-le", "surrogatepass")[: units * 2].decode("utf-16-le", "ignore"))
    line = text.count("\n", 0, index)
    return line, index - (text.rfind("\n", 0, index) + 1)


def _between(text: str, start: tuple[int, int], end: tuple[int, int]) -> str:
    """The stretch from ``start`` to ``end`` of a note whose lines are kept in place:
    a line left out before is empty here, any other is as it was written."""
    lines = text.split("\n")
    (first, column), (last, stop) = start, end
    if (last, stop) < (first, column):
        return ""
    if first == last:
        return lines[first][column:stop]
    return "\n".join([lines[first][column:], *lines[first + 1 : last], lines[last][:stop]])


def _passages_met(before: str, after: str, start: tuple[int, int], end: tuple[int, int]) -> int:
    """How many passages the stripping blanked that a selection meets, the one it
    starts inside included. A passage is a run of lines it blanked: a blank line ends
    a quote, so two passages never touch."""
    was, now = before.split("\n"), after.split("\n")
    first, last = start[0], end[0] - (1 if end[1] == 0 and end[0] > start[0] else 0)
    met = 0
    run: int | None = None
    for number, (old, new) in enumerate([*zip(was, now), ("", "")]):
        blanked = old != new
        if blanked and run is None:
            run = number
        elif not blanked and run is not None:
            if run <= last and number > first:
                met += 1
            run = None
    return met


# -- the reading -----------------------------------------------------------------------


class _Reading:
    """One note read into pieces, each picture looked up once."""

    def __init__(self, case: Case | None, handed: Handed, *, look: NoteLook | None = None, note_id: str = "",
                 note_text: str = "") -> None:
        self.case = case
        self.handed = handed
        self.look = look
        self.note_id = note_id
        #: The note's words, which a chart reads for whether the note calls its figures minimums.
        self.note_text = note_text
        self.left = handed.left
        self.reader = notesources.Reader(case)
        self.prefixes = notes_markdown.file_prefixes(case)
        #: The pictures a block shows, handed over after its words.
        self.shown: list[dict[str, Any]] = []
        self.pictures: dict[str, dict[str, Any] | None] = {}

    def piece(self, piece: notes_markdown.Piece) -> None:
        if piece.kind == "chapter":
            self._say(piece.text, heading=True)
            return
        if piece.kind != "text":
            # a chapter that could not be included: what the PDF says in its place
            self.left["other"] += 1
            return
        for block in notes_markdown.alignment_blocks(piece.text):
            if notes_markdown.holds_internal(block.tokens):
                # cannot happen, since the text was stripped as this parser reads it;
                # if it ever did, nothing is better than a post with the passage in it
                raise NotePiecesError("an internal passage could not be left out, so nothing went to Post")
            if not block.corner:
                self._blocks(block.tokens)

    # -- what is handed over -----------------------------------------------------

    def _add(self, piece: dict[str, Any]) -> None:
        if len(self.handed.pieces) >= MAX_PIECES:
            self.left["other"] += 1
        else:
            self.handed.pieces.append(piece)

    def _say(self, text: str, *, heading: bool = False) -> None:
        """Words as a text piece, then the pictures they showed."""
        said = _tidy(text)
        if said:
            self._add({"kind": "text", "text": said, **({"heading": True} if heading else {})})
        shown, self.shown = self.shown, []
        for picture in shown:
            self._add(picture)

    # -- blocks ------------------------------------------------------------------------

    def _blocks(self, tokens: list[Token]) -> None:
        index = 0
        while index < len(tokens):
            token = tokens[index]
            end = notes_markdown.past(tokens, index) if token.nesting == 1 else index + 1
            if token.type == "heading_open":
                self._say(self._inline(tokens[index + 1]), heading=True)
            elif token.type == "paragraph_open":
                self._paragraph(tokens[index + 1])
            elif token.type in ("bullet_list_open", "ordered_list_open"):
                self._say("\n".join(self._list(tokens, index, end, 0)))
            elif token.type == "blockquote_open":
                self._say("\n".join(self._quote(tokens, index, end)))
            elif token.type == notes_markdown.CHART_TOKEN:
                self._chart(token)
            elif token.type == notes_markdown.INFOGRAPHIC_TOKEN:
                self._infographic(token)
            else:
                self._leave(token)
            index = end

    def _chart(self, token: Token) -> None:
        """A chart as its picture for X, filed in the case, its title as its alt text; its
        table, when the block shows one, stays out like any table."""
        chart = notecharts.read(self.case, token.content, look=self.look, note_text=self.note_text, origins=False)
        try:
            filed = notecharts.file_for_post(self.case, chart, note_id=self.note_id) if self.case is not None else None
        except (CaseError, OSError, ValueError):  # a case that cannot take the file: the chart stays out, counted
            filed = None
        if filed is None:
            self.left["other"] += 1
            return
        self._say("")
        self._add({"kind": "media", "path": filed["path"], "type": "image", "id": filed["id"], "alt": chart.title})
        if chart.block.shows_table():
            self.left["tables"] += 1

    def _infographic(self, token: Token) -> None:
        """An infographic as one picture of its page at X's 16:9, filed in the case, its
        title band, panels and sources as its alt text."""
        page = notes_infographic.read(self.case, token.content, look=self.look, note_text=self.note_text, origins=False)
        try:
            filed = notes_infographic.file_for_post(self.case, page, note_id=self.note_id) \
                if self.case is not None else None
        except (CaseError, OSError, ValueError):  # a case that cannot take the file: it stays out, counted
            filed = None
        if filed is None:
            self.left["other"] += 1
            return
        self._say("")
        self._add({"kind": "media", "path": filed["path"], "type": "image", "id": filed["id"], "alt": page.alt})

    def _paragraph(self, inline: Token) -> None:
        """A paragraph that is only a link is a source; any other is words."""
        source = self._only_link(inline)
        if source is not None:
            self._add(source)
            return
        said = _tidy(self._inline(inline))
        bare = notesources.web(said) if said and not any(char.isspace() for char in said) else ""
        if bare and not notes_markdown.is_local(bare, self.prefixes):
            self._say("")
            self._add({"kind": "source", "url": bare})
            return
        self._say(said)

    def _only_link(self, inline: Token) -> dict[str, Any] | None:
        children = inline.children or []
        written = [
            index for index, child in enumerate(children)
            if child.type not in ("softbreak", "hardbreak") and not (child.type == "text" and not child.content.strip())
        ]
        if len(written) < 2:
            return None
        first, last = written[0], written[-1]
        if children[first].type != "link_open" or children[last].type != "link_close":
            return None
        inside = children[first + 1 : last]
        if any(child.type not in LINK_WORDS for child in inside):
            return None
        href = notes_markdown.token_attr(children[first], "href")
        if not notesources.web(href) or notes_markdown.is_local(href, self.prefixes):
            return None
        address = _address(href)
        words = " ".join("".join(" " if child.type in ("softbreak", "hardbreak") else child.content
                                 for child in inside).split())
        return {"kind": "source", "url": address, **({"label": words} if words and words != address else {})}

    def _list(self, tokens: list[Token], index: int, end: int, depth: int) -> list[str]:
        """A list as its lines: `- ` for each bullet, its number for an ordered item,
        two spaces deeper for each list inside."""
        ordered = tokens[index].type == "ordered_list_open"
        number = _start(tokens[index]) if ordered else 0
        lines: list[str] = []
        position = index + 1
        while position < end - 1:
            token = tokens[position]
            stop = notes_markdown.past(tokens, position) if token.nesting == 1 else position + 1
            if token.type == "list_item_open":
                marker = f"{number}{token.markup or '.'}" if ordered else "-"
                head, nested = self._item(tokens, position + 1, stop - 1, depth)
                lines.append(f"{'  ' * depth}{marker} {head}".rstrip())
                lines.extend(nested)
                number += 1
            position = stop
        return lines

    def _item(self, tokens: list[Token], start: int, end: int, depth: int) -> tuple[str, list[str]]:
        """A list item's words on its line, and the lists inside it after."""
        words: list[str] = []
        nested: list[str] = []
        position = start
        while position < end:
            token = tokens[position]
            stop = notes_markdown.past(tokens, position) if token.nesting == 1 else position + 1
            if token.type in ("paragraph_open", "heading_open"):
                words.append(_tidy(self._inline(tokens[position + 1])))
            elif token.type in ("bullet_list_open", "ordered_list_open"):
                nested.extend(self._list(tokens, position, stop, depth + 1))
            elif token.type == "blockquote_open":
                words.extend(self._quote(tokens, position, stop))
            else:
                self._leave(token)
            position = stop
        return " ".join(word.replace("\n", " ") for word in words if word), nested

    def _quote(self, tokens: list[Token], index: int, end: int) -> list[str]:
        """A quote's lines, a callout's label first: `Unverified: …` keeps what the
        box said about the words."""
        callout = notes_markdown.take_callout(tokens, index)
        lines: list[str] = []
        position = index + 1
        while position < end - 1:
            token = tokens[position]
            stop = notes_markdown.past(tokens, position) if token.nesting == 1 else position + 1
            if token.type in ("paragraph_open", "heading_open"):
                lines.append(_tidy(self._inline(tokens[position + 1])))
            elif token.type in ("bullet_list_open", "ordered_list_open"):
                lines.extend(self._list(tokens, position, stop, 0))
            elif token.type == "blockquote_open":
                lines.extend(self._quote(tokens, position, stop))
            else:
                self._leave(token)
            position = stop
        lines = [line for line in lines if line]
        if callout is not None:
            label = callout[0]
            lines = [f"{label}: {lines[0]}", *lines[1:]] if lines else [label]
        return lines

    def _leave(self, token: Token) -> None:
        """A block a post cannot hold: counted, unless it prints nothing anywhere."""
        if token.type == "table_open":
            self.left["tables"] += 1
        elif token.type == "fence":
            self.left["diagrams" if notes_markdown.MERMAID_INFO.match(token.info or "") else "other"] += 1
        elif token.type == "code_block":
            self.left["other"] += 1
        elif token.type == "html_block" and not notes_markdown.COMMENT.match(token.content.strip()):
            self.left["other"] += 1

    # -- inline --------------------------------------------------------------------------

    def _inline(self, token: Token) -> str:
        """A line's words as a reader says them: marks gone, a reference by its label,
        a link by its words and its address. Its pictures wait in ``shown``."""
        said: list[str] = []
        href: str | None = None
        words: list[str] = []
        for child in token.children or []:
            kind = child.type
            into = words if href is not None else said
            if kind == "link_open":
                href, words = notes_markdown.token_attr(child, "href"), []
            elif kind == "link_close":
                if href is not None:
                    said.append(self._link(href, "".join(words)))
                href = None
            elif kind == "image":
                self._picture(notes_markdown.token_attr(child, "src"))
            elif kind == "softbreak":
                into.append(SOFT)
            elif kind == "hardbreak":
                into.append("\n")
            elif kind in ("text", "code_inline"):
                into.append(child.content)
        return "".join(said)

    def _link(self, href: str, words: str) -> str:
        words = words.replace(SOFT, " ").strip()
        if notes_markdown.ENTITY_HREF.match(href):
            return words
        if not notesources.web(href) or notes_markdown.is_local(href, self.prefixes):
            return words
        address = _address(href)
        return address if not words or words == address else f"{words} {address}"

    # -- pictures ------------------------------------------------------------------------

    def _picture(self, src: str) -> None:
        written = notes_markdown.image_options(src).source
        if written not in self.pictures:
            self.pictures[written] = None if notefill.picture_name(written) is not None else self._case_picture(written)
        found = self.pictures[written]
        if found is None:
            self.left["other"] += 1
        else:
            self.shown.append(found)

    def _case_picture(self, written: str) -> dict[str, Any] | None:
        """A picture of the case as Post takes it: a proof's by the proof's name, any
        other by its path and what it is. None for one Post cannot have: no longer in
        the case, not a file of it, on the web, or a sound."""
        if self.case is None:
            return None
        parts = urlsplit(written)
        if parts.scheme == "azimut" and parts.netloc == "media":
            source = self.reader.entity(unquote(parts.path.lstrip("/")))
        else:
            prefix = next((one for one in self.prefixes if written.startswith(one)), "")
            source = self.reader.file(unquote(written[len(prefix):])) if prefix else None
        if source is None or not source.path:
            return None
        try:
            if not self.case.resolve_inside(source.path).is_file():
                return None
        except (CaseError, OSError, ValueError):
            return None
        record = self.case.get_entity(source.entity_id) if source.entity_id else None
        record = record or self.case.find_entity(attr="path", value=source.path) or {}
        attrs = record.get("attrs") or {}
        named = {"id": str(record["id"])} if record.get("id") else {}
        if record.get("type") == "proof":
            spec = str(attrs.get("spec") or "")
            return {"kind": "proof", "name": PurePosixPath(spec or source.path).stem, **named}
        if PurePosixPath(source.path).suffix.lower() == ".gif":
            kind = "gif"
        else:
            kind = media_kind(source.path)
            kind = kind if kind in POSTED_KINDS else str(attrs.get("kind") or "")
        if kind not in (*POSTED_KINDS, "gif"):
            return None
        return {"kind": "media", "path": source.path, "type": kind, **named}


def _address(href: str) -> str:
    """A link's address as it was written: the parser percent-encodes one in Arabic or
    Chinese. One that would read back with a space or a line break in it stays encoded,
    so a post never splits an address."""
    written = normalizeLinkText(href)
    return written if written.isprintable() and " " not in written else href


def _start(token: Token) -> int:
    try:
        return int(token.attrGet("start") or 1)
    except (TypeError, ValueError):
        return 1


def _tidy(text: str) -> str:
    """Words as a post holds them: one space between two words, none ending a line,
    and no fence of an aligned block that a selection cut from its pair."""
    lines: list[str] = []
    for line in text.split("\n"):
        kept = [part for part in line.split(SOFT) if not ALIGN_FENCE.match(part.strip())]
        if kept:
            lines.append(SPACES.sub(" ", " ".join(kept)).rstrip())
    return "\n".join(lines).strip()
