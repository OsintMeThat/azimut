"""A note sent to the analyst's own WordPress site as a draft, in one press.

The HTML report (`engine/notes_html.py`) is a page Azimut writes whole; this is the
same note handed to a WordPress site through its REST API, as a **draft** the analyst
reads in the block editor and publishes with WordPress's own Publish button. Nothing
here ever publishes or schedules a post: every post this module makes or changes is
sent with `status: draft`, and a post that left the drafts is never touched again.

**What is sent.** The public edition only, every internal passage blanked by the one
rule every reader uses (`notes_markdown.strip_internal`) and refused if one were still
there. It is read as the HTML report reads it, then written as block editor markup a
careful person would have made by hand: headings, paragraphs, lists, quotes, tables,
separators, each picture an image block with its alt text, caption and credit, a
comparison's two sides in two columns with their labels, a graphic picture folded in a
Details block, and the numbered Sources list with each entry's links and verify links,
which every citation links to. A chart (`::: chart`) is its picture, captioned as every
figure is, its numbers folded under it in a table, or its own table after it when the
block says to show it. An infographic (`:::: infographic`) is one picture of its whole
page, then each chart's numbers under "The numbers". The Story layout and the `::: steps` and `::: story`
blocks read as a plain article, each picture then its words.

**What is uploaded.** Every picture goes to the media library re-encoded as the report
encodes it (at most 2400 pixels, EXIF, GPS and text chunks left behind), named from its
words, with its alt text and caption. A clip goes up whole, without its container's
metadata, under the report's budget (`notes_html.MAX_BYTES`); one past it is its still,
linked to where it was posted. A Mermaid diagram goes as the PNG the browser drew,
and a chart as the PNG Azimut paints of it, since WordPress takes no SVG. Sending the note again updates its draft while it is
still one, and pictures already uploaded for it are reused.

**What stays out**, counted for the dialog to say once: internal passages, interactive
maps (`::: map`), clips past the budget, diagrams that were not drawn, and pictures the
note cannot show (gone from the case, or on the web).

**The connection.** The site's address is https, or http on this machine for a test
site, checked at the edge (`site_address`). The username and an application password
(WordPress 5.6 and later, made in Users › Profile) go by Basic auth on every request,
with timeouts, never logged, never followed to another address. WordPress.com takes no
application password from other apps (it needs an OAuth app), so its addresses are told
so plainly rather than half-supported.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable
from urllib.parse import unquote, urlencode, urlsplit

import httpx
from markdown_it.token import Token
from PIL import Image

from .. import __version__
from . import noteannexes, notecharts, notefill, notes_infographic, notes_tables, notesources, thumbnails
from . import notes_html as report
from . import notes_markdown as md
from .media import media_kind
from .notelook import DEFAULT as DEFAULT_LOOK
from .notelook import TLP_LABELS, NoteLook
from .notes_pdf import MAX_IMAGE_PIXELS
from .notesources import Entry, Source

if TYPE_CHECKING:
    from ..workspace import Case

#: How long a request may take: reaching the site, then each answer, and an upload.
TIMEOUT = httpx.Timeout(30.0, connect=10.0, write=120.0)
#: The longest site address and username taken.
MAX_ADDRESS = 300
MAX_USER = 60
#: What one picture or clip may weigh on its way up, and all of them together.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 80 * 1024 * 1024
#: How many files one draft uploads at most.
MAX_UPLOADS = 120
#: The longest excerpt, in characters.
MAX_EXCERPT = 300
#: A picture's alt text and its library caption, in characters.
MAX_ALT = 300
#: What a graphic picture's fold says.
GRAPHIC_SUMMARY = "Graphic picture. Press to see it."
#: The TLP labels a public article should not carry.
RESTRICTED_TLP = ("amber", "amber-strict", "red")
#: Hosts that are WordPress.com, which takes no application password from other apps.
WORDPRESS_COM = ("wordpress.com",)
#: The interactive map block (`::: map`), which a draft leaves out and counts.
MAP_BLOCK = re.compile(r"^:::[ \t]*map\b[^\n]*\n.*?^:::[ \t]*$", re.S | re.M)
#: What stays out of a draft, in the order the dialog says it.
LEFT = ("internal", "maps", "clips", "diagrams", "other")

#: What the Settings help and the errors say about where the password is made.
WHERE_PASSWORD = "make an application password in Users › Profile"
WPCOM_SAID = ("WordPress.com sites take no application password from other apps: they need an OAuth "
              "app, which Azimut does not have. A self-hosted WordPress site works.")


class WordPressError(Exception):
    """Something the site, the address or the password stopped. Its words are for the analyst."""


class NotesWordPressError(Exception):
    """The note could not be made into a draft."""


# -- the address --------------------------------------------------------------------


def site_address(value: str) -> str:
    """The site's address as Azimut sends to it, or "" for none: https, or http on
    this machine only, no username, query or fragment, a pasted `/wp-admin` or
    `/wp-json` taken off, and no slash at the end. Raises with the reason."""
    written = " ".join(str(value or "").split())
    if not written:
        return ""
    if len(written) > MAX_ADDRESS:
        raise WordPressError("That address is too long.")
    if "://" not in written:
        written = f"https://{written}"
    try:
        parts = urlsplit(written)
        host = (parts.hostname or "").lower().rstrip(".")
        parts.port  # noqa: B018 - a port that does not read is refused here
    except ValueError as exc:
        raise WordPressError("That does not read as a web address.") from exc
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not host or " " in written:
        raise WordPressError("That does not read as a web address.")
    if parts.username is not None or parts.password is not None:
        raise WordPressError("Leave the username and password out of the address.")
    if host in WORDPRESS_COM or host.endswith(tuple(f".{name}" for name in WORDPRESS_COM)):
        raise WordPressError(WPCOM_SAID)
    if scheme == "http" and not _this_machine(host):
        raise WordPressError("Azimut sends the password over https only: write the address with https://.")
    if parts.query or parts.fragment:
        raise WordPressError("Write the site's address alone, with nothing after a ? or a #.")
    path = parts.path.rstrip("/")
    for tail in ("/wp-admin", "/wp-json", "/wp-login.php"):
        if path.lower().endswith(tail):
            path = path[: -len(tail)]
    return f"{scheme}://{parts.netloc.lower()}{path}"


def _this_machine(host: str) -> bool:
    return host in ("localhost", "127.0.0.1", "::1", "[::1]")


def user_name(value: str) -> str:
    """A WordPress username as written: one line, at most `MAX_USER` characters."""
    name = str(value or "").strip()
    if len(name) > MAX_USER or any(char in name for char in "\r\n\t\0:"):
        raise WordPressError("That does not read as a WordPress username.")
    return name


def web_link(value: Any) -> str:
    """An address the site handed back, kept only when it is http or https."""
    text = str(value or "").strip()
    return text if notesources.web(text) and len(text) <= 2048 else ""


# -- the draft, as markup --------------------------------------------------------------


@dataclass
class Upload:
    """A file the draft uploads, with what the media library says of it."""

    key: str
    name: str
    mime: str
    data: bytes
    alt: str = ""
    caption: str = ""


@dataclass
class Draft:
    """A note made into a post: its markup with each upload's place marked, and the rest."""

    title: str
    content: str
    excerpt: str = ""
    uploads: list[Upload] = field(default_factory=list)
    #: The upload that is the featured image, by index, or None.
    featured: int | None = None
    left: dict[str, int] = field(default_factory=lambda: dict.fromkeys(LEFT, 0))
    warnings: list[str] = field(default_factory=list)
    #: The SHA-256 of the source the public edition printed (`notes_markdown.printed_source`).
    text_sha256: str = ""
    #: The points of view the draft shows, said for the dialog as the HTML check says them.
    pov: list[str] = field(default_factory=list)
    #: Each clip's block and the still that stands in for it, by upload.
    swaps: dict[int, tuple[str, str]] = field(default_factory=dict)

    def markup(self, placed: dict[int, dict[str, Any]]) -> str:
        """The post's content once its files are up: each clip the site took as a video,
        each it refused as its still and a link, every upload's place filled."""

        def chosen(match: re.Match[str]) -> str:
            video_block, still = self.swaps.get(int(match.group(1)), ("", ""))
            said = video_block if int(match.group(1)) in placed else still
            # a clip with no still and no words leaves no blank lines behind
            return f"{said}{match.group(2) or ''}" if said else ""

        return fill(_SWAP.sub(chosen, self.content), placed)


#: Where an upload's id, address or size goes once the site has answered: in an HTML
#: attribute, and quoted in a block's JSON comment.
_HTML_REF = re.compile("\x00(\\d+):(id|url|full|size)\x00")
_JSON_REF = re.compile(r'"\\u0000(\d+):(id|url|full|size)\\u0000"')


def _ref(index: int, part: str) -> str:
    return f"\x00{index}:{part}\x00"


#: Where a clip's block goes, chosen once the site took the clip or refused it.
_SWAP = re.compile("\x02(\\d+)\x02(\n\n)?")


def _swap(index: int) -> str:
    return f"\x02{index}\x02"


def _blocks(parts: list[str]) -> str:
    return "\n\n".join(parts)


def fill(content: str, placed: dict[int, dict[str, Any]]) -> str:
    """The draft's markup with every upload's place filled from what the site answered:
    ``placed[index]`` holds its ``id``, ``url`` (the size shown), ``full`` and ``size``."""

    def json_value(match: re.Match[str]) -> str:
        return _escape_json(json.dumps(placed[int(match.group(1))][match.group(2)], ensure_ascii=False))

    def html_value(match: re.Match[str]) -> str:
        return html.escape(str(placed[int(match.group(1))][match.group(2)]), quote=True)

    return _HTML_REF.sub(html_value, _JSON_REF.sub(json_value, content))


def build(
    case: "Case | None",
    *,
    title: str,
    text: str,
    look: NoteLook | None = None,
    note_id: str = "",
    resolve: md.Resolve | None = None,
    created: datetime | None = None,
    identity: notefill.Identity | None = None,
    diagrams: dict[str, bytes] | None = None,
    round_pov: bool = False,
    check: bool = False,
    earlier: Iterable[dict[str, Any]] = (),
) -> Draft:
    """The public edition of a note as a draft: block markup with every upload's place
    marked (`fill`), the files to upload, the excerpt and what stayed out.

    ``diagrams`` holds each Mermaid fence's PNG as the browser drew it, keyed by
    `notes_markdown.diagram_key`. ``check`` says what would be sent without reading a
    clip, for the dialog; nothing is sent from here either way.
    """
    look = look or DEFAULT_LOOK
    day = date.fromisoformat(look.cover.date) if look.cover.date else (created or datetime.now()).date()
    identity = identity if identity is not None else notefill.Identity.from_settings()
    values = identity.values(day)
    passages = [0]
    cut = notefill.split_cover(text) if look.cover.own else None
    body = cut.body if cut is not None else text
    pieces = md.expand(title, body, resolve=resolve, note_id=note_id, public=True, counter=passages, values=values)
    if cut is not None:
        # the own cover is a printed page: its passages are counted, its words are not sent
        passages[0] += md.internal_passages(cut.text)
    maps = 0
    for piece in pieces:
        if piece.kind == "text":
            piece.text, found = _without_maps(piece.text)
            maps += found
    blocks = {id(piece): md.alignment_blocks(piece.text) for piece in pieces if piece.kind == "text"}
    if any(md.holds_internal(block.tokens) for parsed in blocks.values() for block in parsed):
        raise NotesWordPressError("an internal passage could not be left out, so nothing was sent")
    cited = md.Cited(case, look=look, styled=False, identity=identity, profile=look.profile())
    cited.collect(pieces, blocks)
    # what the style adds after the sources, as the HTML page has it, but the maps a draft leaves out
    annexes = noteannexes.build(case, cited, cited.profile, day=day, public=True, earlier=earlier,
                                made_as="wordpress", round_pov=round_pov)
    writer = _Writer(case, look=look, cited=cited, diagrams=diagrams or {}, round_pov=round_pov, check=check,
                     annexes=annexes)
    content = writer.build(pieces, blocks)
    draft = Draft(title=title, content=content, uploads=writer.uploads)
    draft.left.update(internal=passages[0], maps=maps + writer.maps, clips=writer.clips_out,
                      diagrams=writer.diagrams_out, other=writer.other)
    # a link to a part of the post opens on the web, where it would not in a PDF
    draft.warnings = [message for message, _, kind in cited.warnings
                      if not (kind == md.LOCAL_LINK and report._anchor_named(message) in writer.anchors)]
    draft.warnings += writer.warnings
    if look.tlp in RESTRICTED_TLP:
        label = TLP_LABELS.get(look.tlp, (look.tlp.upper(),))[0]
        draft.warnings.insert(0, f"This note is marked {label}; a WordPress post is meant for anyone to read.")
    draft.excerpt = _excerpt(look.cover.subtitle or writer.first_words)
    draft.featured = writer.featured(look)
    draft.text_sha256 = hashlib.sha256(md.printed_source(pieces).encode("utf-8")).hexdigest()
    draft.pov = writer.pov
    draft.swaps = writer.swaps
    return draft


#: What a draft leaves out, by kind: the words for one, and for several.
LEFT_WORDS = {
    "internal": ("internal passage", "internal passages"),
    "maps": ("interactive map", "interactive maps"),
    "diagrams": ("diagram", "diagrams"),
    "other": ("picture the note cannot show", "pictures the note cannot show"),
}


def left_said(left: dict[str, int]) -> str:
    """What stayed out, as the dialog says it once, then the clips that go as their still
    and a link; "" when everything went."""
    parts = [f"{count} {LEFT_WORDS[key][count > 1]}" for key in LEFT_WORDS if (count := left.get(key, 0))]
    said: list[str] = []
    if parts:
        listed = parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} and {parts[-1]}"
        one = sum(left.get(key, 0) for key in LEFT_WORDS) == 1
        said.append(f"{listed} {'stays' if one else 'stay'} out.")
    clips = left.get("clips", 0)
    if clips:
        said.append("1 clip goes as its still and a link." if clips == 1 else
                    f"{clips} clips go as their still and a link.")
    return " ".join(said)


def _without_maps(text: str) -> tuple[str, int]:
    """``text`` with each `::: map` block blanked, lines kept, and how many there were;
    one written inside a code fence is an example, kept as the fence's text."""
    found = 0
    fenced = md.fenced_spans(text)

    def blank(match: re.Match[str]) -> str:
        nonlocal found
        if any(start <= match.start() < end for start, end in fenced):
            return match.group(0)
        found += 1
        return "\n" * match.group(0).count("\n")

    return MAP_BLOCK.sub(blank, text), found


def _excerpt(words: str) -> str:
    said = " ".join(words.split())
    if len(said) <= MAX_EXCERPT:
        return said
    cut = said[: MAX_EXCERPT - 1].rsplit(" ", 1)[0].rstrip(",;:")
    return f"{cut}…"


# -- block markup -------------------------------------------------------------------------


def _escape_json(text: str) -> str:
    """A block's attributes as WordPress writes them in its comment (`serializeAttributes`)."""
    return (text.replace("--", "\\u002d\\u002d").replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("&", "\\u0026").replace('\\"', "\\u0022"))


def block(name: str, inner: str, attrs: dict[str, Any] | None = None) -> str:
    """One block: its comment, its markup, its closing comment."""
    said = f" {_escape_json(json.dumps(attrs, ensure_ascii=False, separators=(',', ':')))}" if attrs else ""
    return f"<!-- wp:{name}{said} -->\n{inner}\n<!-- /wp:{name} -->"


def nested(blocks: Iterable[str]) -> str:
    """Inner blocks, as WordPress writes them inside their parent."""
    return "\n\n".join(blocks)


def paragraph(inner: str, anchor: str = "", *, caption: bool = False) -> str:
    """A paragraph; ``caption`` sets it as the theme sets a caption, for the words under
    pictures that stand side by side."""
    ident = f' id="{anchor}"' if anchor else ""
    if caption:
        return block("paragraph", f'<p class="wp-element-caption"{ident}>{inner}</p>', {"className": "wp-element-caption"})
    return block("paragraph", f"<p{ident}>{inner}</p>")


def heading(level: int, inner: str, anchor: str = "") -> str:
    level = max(1, min(6, level))
    ident = f' id="{anchor}"' if anchor else ""
    return block("heading", f'<h{level} class="wp-block-heading"{ident}>{inner}</h{level}>',
                 {"level": level} if level != 2 else None)


def separator() -> str:
    return block("separator", '<hr class="wp-block-separator has-alpha-channel-opacity"/>')


def code(source: str) -> str:
    return block("code", f'<pre class="wp-block-code"><code>{_text(source.rstrip(chr(10)))}</code></pre>')


def list_block(items: list[str], *, ordered: bool = False, start: int = 1) -> str:
    """A list of list-item blocks (each from `list_item`)."""
    tag = "ol" if ordered else "ul"
    attrs: dict[str, Any] = {}
    if ordered:
        attrs["ordered"] = True
        if start != 1:
            attrs["start"] = start
    opening = f'<{tag} start="{start}" class="wp-block-list">' if ordered and start != 1 else f'<{tag} class="wp-block-list">'
    return block("list", f"{opening}{nested(items)}</{tag}>", attrs or None)


def list_item(inner: str, children: str = "", anchor: str = "") -> str:
    ident = f' id="{anchor}"' if anchor else ""
    return block("list-item", f"<li{ident}>{inner}{children}</li>")


def quote(inner_blocks: list[str]) -> str:
    return block("quote", f'<blockquote class="wp-block-quote">{nested(inner_blocks)}</blockquote>')


def image(index: int, alt: str, caption: str = "", *, href: str = "", media_link: bool = True,
          align: str = "") -> str:
    """An image block for upload ``index``: its id, the size shown and its alt text,
    linked to the full picture (or to ``href``), with its caption and credit."""
    attrs: dict[str, Any] = {"id": _ref(index, "id"), "sizeSlug": _ref(index, "size")}
    if href:
        attrs["linkDestination"] = "custom"
    else:
        attrs["linkDestination"] = "media" if media_link else "none"
    if align:
        attrs["align"] = align
    picture = f'<img src="{_ref(index, "url")}" alt="{_attr(alt)}" class="wp-image-{_ref(index, "id")}"/>'
    link = href or (_ref(index, "full") if media_link else "")
    if link:
        picture = f'<a href="{_attr(link) if href else link}">{picture}</a>'
    classes = ["wp-block-image"]
    if align:
        classes.append(f"align{align}")
    classes.append(f"size-{_ref(index, 'size')}")
    figcaption = f'<figcaption class="wp-element-caption">{caption}</figcaption>' if caption else ""
    return block("image", f'<figure class="{" ".join(classes)}">{picture}{figcaption}</figure>', attrs)


def video(index: int, caption: str = "", poster: int | None = None) -> str:
    attrs = {"id": _ref(index, "id")}
    still = f' poster="{_ref(poster, "full")}"' if poster is not None else ""
    figcaption = f'<figcaption class="wp-element-caption">{caption}</figcaption>' if caption else ""
    return block("video", f'<figure class="wp-block-video"><video controls{still} src="{_ref(index, "full")}">'
                          f"</video>{figcaption}</figure>", attrs)


def columns(sides: list[list[str]]) -> str:
    inner = [block("column", f'<div class="wp-block-column">{nested(side)}</div>') for side in sides]
    return block("columns", f'<div class="wp-block-columns">{nested(inner)}</div>')


def details(summary: str, inner_blocks: list[str]) -> str:
    return block("details", f'<details class="wp-block-details"><summary>{_text(summary)}</summary>'
                            f"{nested(inner_blocks)}</details>")


def table(head: list[str], rows: list[str], *, stripes: bool = False, caption: str = "") -> str:
    """A table block; ``stripes`` takes the block's own Stripes style, ``caption`` its caption."""
    thead = f"<thead>{''.join(head)}</thead>" if head else ""
    attrs: dict[str, Any] = {"hasFixedLayout": False}
    if stripes:
        attrs["className"] = "is-style-stripes"
    figcaption = f'<figcaption class="wp-element-caption">{caption}</figcaption>' if caption else ""
    classes = "wp-block-table is-style-stripes" if stripes else "wp-block-table"
    return block("table", f'<figure class="{classes}"><table>{thead}<tbody>{"".join(rows)}</tbody></table>'
                          f"{figcaption}</figure>", attrs)


def _text(value: str) -> str:
    return html.escape(value, quote=False)


def _highlighted(cell: str, colour: str) -> str:
    """A cell's words highlighted in a light tint of ``colour``, as the editor's highlight
    writes one (a ``mark`` the block keeps), the cell itself unchanged."""
    start = cell.index(">") + 1
    finish = cell.rindex("</")
    tint = notes_tables.tint(colour, notes_tables.KEY_TINT)
    return (f'{cell[:start]}<mark style="background-color:{tint}" class="has-inline-color">'
            f"{cell[start:finish]}</mark>{cell[finish:]}") if cell[start:finish] else cell


def _attr(value: str) -> str:
    return html.escape(value, quote=True)


def _cite(number: int) -> str:
    return f'<sup><a href="#source-{number}">[{number}]</a></sup>'


def _link(href: str, inner: str) -> str:
    return f'<a href="{_attr(href)}">{inner}</a>'


# -- the walk -----------------------------------------------------------------------------


class _Writer:
    """Walks the parsed public edition and writes it as block markup."""

    def __init__(self, case: "Case | None", *, look: NoteLook, cited: md.Cited, diagrams: dict[str, bytes],
                 round_pov: bool, check: bool, annexes: noteannexes.Annexes | None = None) -> None:
        self.case = case
        self.annexes = annexes
        self.look = look
        self.cited = cited
        self.diagrams = diagrams
        self.round_pov = round_pov
        self.check = check
        self.uploads: list[Upload] = []
        self._keys: dict[str, int] = {}
        self.warnings: list[str] = []
        self.pov: list[str] = []
        self.maps = 0
        self.clips_out = 0
        self.diagrams_out = 0
        self.other = 0
        self.first_words = ""
        #: The note's words, which a chart reads for whether the note calls its figures minimums.
        self._note_text = ""
        self._prefixes = md.file_prefixes(case)
        self._ids: set[str] = {"sources"}
        self._shift = 0
        self._base = 1
        self._counters = [0, 0, 0]
        self._figures = 0
        self._label = ""
        self._clip_bytes = 0
        self._credited: int | None = None
        #: Whether a graphic picture is folded somewhere, said once at the top.
        self.graphic = False
        #: A clip's block, and what stands in for it should the site refuse the clip.
        self.swaps: dict[int, tuple[str, str]] = {}
        #: Uploads only named in a line of words so far, which a figure describes better.
        self._named_only: set[int] = set()

    @property
    def anchors(self) -> set[str]:
        """The parts of the post a link can name: its headings and its sources."""
        return self._ids | {f"source-{entry.number}" for entry in (self.cited.annex.entries if self.cited.annex else [])}

    # -- the whole --------------------------------------------------------------

    def build(self, pieces: list[md.Piece], blocks: dict[int, list[md.Block]]) -> str:
        self._prescan(pieces, blocks)
        self._note_text = "\n".join(piece.text for piece in pieces if piece.kind == "text")
        out: list[str] = []
        tlp = TLP_LABELS.get(self.look.tlp)
        if tlp is not None:
            meaning = report.TLP_MEANINGS.get(self.look.tlp, "")
            out.append(paragraph(f"<strong>{_text(tlp[0])}</strong>{f' {_text(meaning)}' if meaning else ''}"))
        for piece in pieces:
            if piece.kind == "chapter":
                out.append(self._heading(" ".join(piece.text.split()), piece.depth))
                continue
            if piece.kind == "aside":
                out.append(paragraph(f"<em>{_text(piece.text)}</em>"))
                continue
            self._shift = piece.shift
            for parsed in blocks[id(piece)]:
                if parsed.kind == "map":
                    # a map block read by a later parser: still left out, still counted
                    self.maps += 1
                    continue
                if parsed.corner:
                    continue
                out.extend(self._walk(parsed.tokens, parsed.start, len(parsed.tokens)))
        if self.graphic:
            out.insert(0, paragraph(f"<em>{_text('This article holds graphic pictures, each folded until pressed.')}</em>"))
        out.extend(self._sources())
        out.extend(self._annexes())
        return "\n\n".join(part for part in out if part) + "\n"

    def _prescan(self, pieces: list[md.Piece], blocks: dict[int, list[md.Block]]) -> None:
        """Which level the headings start at, and how far each chapter moves its own,
        as the HTML report reads them."""
        tops: dict[int, int] = {}
        for piece in pieces:
            if piece.kind != "text":
                continue
            for position, parsed in enumerate(blocks[id(piece)]):
                if position == 0 and piece.opens is not None:
                    parsed.start = md.skip_repeated_title(parsed.tokens, piece.opens)
                for token in parsed.tokens[parsed.start:]:
                    if token.type == "heading_open":
                        tops[piece.source] = min(tops.get(piece.source, 6), int(token.tag[1]))
        for piece in pieces:
            if piece.kind == "text" and piece.depth:
                piece.shift = piece.depth + 1 - tops.get(piece.source, piece.depth + 1)
        levels: list[int] = []
        for piece in pieces:
            if piece.kind == "chapter":
                levels.append(piece.depth)
            elif piece.kind == "text":
                for parsed in blocks[id(piece)]:
                    levels.extend(md.heading_level(token.tag, piece.shift)
                                  for token in parsed.tokens[parsed.start:] if token.type == "heading_open")
        self._base = min(levels) if levels else 1

    def featured(self, look: NoteLook) -> int | None:
        """The cover picture, else the first picture with a credit, as an upload."""
        cover = look.cover
        if cover.on and not cover.own and cover.image and self.case is not None:
            record = self.case.get_entity(cover.image)
            attrs = (record or {}).get("attrs") or {}
            if record and attrs.get("path") and attrs.get("kind") != "video":
                path = self._case_path(str(attrs["path"]))
                if path is not None and path.is_file():
                    alt = str(record.get("label") or "Cover picture")
                    index = self._picture(path, alt, "")
                    if index is not None:
                        return index
        return self._credited

    # -- blocks -----------------------------------------------------------------

    def _walk(self, tokens: list[Token], index: int, end: int) -> list[str]:
        out: list[str] = []
        while index < end:
            token = tokens[index]
            stop = md.past(tokens, index) if token.nesting == 1 else index + 1
            kind = token.type
            if kind == "heading_open":
                inline = tokens[index + 1]
                words = " ".join(md.inline_text(inline).split())
                out.append(self._heading(words, md.heading_level(token.tag, self._shift), self._inline(inline)))
            elif kind == "paragraph_open":
                out.extend(self._paragraph(tokens[index + 1]))
            elif kind == "hr":
                out.append(separator())
            elif kind == "fence":
                out.append(self._fence(token))
            elif kind == "code_block":
                out.append(code(token.content))
            elif kind == "html_block":
                said = report._without_comments(token.content).strip()
                if said:
                    out.append(paragraph(_text(said)))
            elif kind == "blockquote_open":
                out.extend(self._quote(tokens, index, stop))
            elif kind in ("bullet_list_open", "ordered_list_open"):
                out.append(self._list(tokens, index, stop))
            elif kind == "table_open":
                out.append(self._table(tokens, index, stop))
            elif kind == md.CHART_TOKEN:
                out.extend(self._chart(token))
            elif kind == md.INFOGRAPHIC_TOKEN:
                out.extend(self._infographic(token))
            index = stop
        return [part for part in out if part]

    def _heading(self, words: str, level: int, inner: str = "") -> str:
        rank = level - self._base
        tag = min(6, rank + 2)
        number = ""
        if self.look.numbered and 0 <= rank < len(self._counters):
            self._counters[rank] += 1
            for deeper in range(rank + 1, len(self._counters)):
                self._counters[deeper] = 0
            number = ".".join(str(count) for count in self._counters[: rank + 1] if count)
        anchor = self._new_id(report._slug(words))
        shown = inner or _text(words)
        return heading(tag, f"{number} {shown}" if number else shown, anchor)

    def _new_id(self, wanted: str) -> str:
        base = wanted or "section"
        if base in report.RESERVED_IDS or base.startswith("source-"):
            base = f"{base}-section"
        candidate, counter = base, 2
        while candidate in self._ids:
            candidate, counter = f"{base}-{counter}", counter + 1
        self._ids.add(candidate)
        return candidate

    def _paragraph(self, inline: Token) -> list[str]:
        children = [child for child in inline.children or [] if child.type != "softbreak"]
        if len(children) == 1 and children[0].type == "image":
            return self._figure(children[0])
        words = self._inline(inline)
        if self._label:
            words = f"<strong>{_text(self._label)}.</strong> {words}".rstrip()
            self._label = ""
        if not words.strip():
            return []
        if not self.first_words:
            self.first_words = " ".join(md.inline_text(inline).split())
        return [paragraph(words)]

    def _fence(self, token: Token) -> str:
        if not md.MERMAID_INFO.match(token.info or ""):
            return code(token.content)
        drawn = self.diagrams.get(md.diagram_key(token.content))
        index = self._diagram(drawn) if drawn else None
        if index is None:
            self.diagrams_out += 1
            return ""
        caption = self._caption("", "")
        return image(index, "Diagram", caption, media_link=False)

    def _chart(self, token: Token) -> list[str]:
        """A `::: chart` block as its picture, painted as the PDF's at twice the page's
        pixels, alt text, caption and credit kept with it in the media library; then its
        numbers folded under it, or its own table when it says to show it."""
        chart = notecharts.read(self.case, token.content, look=self.look, note_text=self._note_text, origins=False)
        self.warnings.extend(message for message, _, _ in chart.warnings)
        if not chart.drawable:
            return []
        data = chart.png(round(notecharts.DOCUMENT_WIDTH * notecharts.WEB_PIXELS))
        digest = hashlib.sha256(data).hexdigest()
        library = md.cut_text(" · ".join(part for part in (chart.title, chart.layout.credit) if part), MAX_ALT)
        index = self._add(f"chart:{digest}", data, "image/png", chart.alt, library, ".png", digest)
        if index is None:
            return []
        out = [image(index, md.cut_text(chart.alt, MAX_ALT), self._caption(chart.title, "Chart"), media_link=False)]
        written = chart.block.table
        if chart.block.shows_table() and written is not None:
            tokens = md.parse(written.text())
            out.extend(self._walk(tokens, 0, len(tokens)))
        else:
            head = [f"<tr>{''.join(f'<th>{_text(cell)}</th>' for cell in chart.layout.table_head)}</tr>"]
            rows = [f"<tr><td>{_text(row[0])}</td>"
                    + "".join(f'<td class="has-text-align-right" data-align="right">{_text(cell)}</td>' for cell in row[1:])
                    + "</tr>" for row in chart.layout.table_rows]
            out.append(details(notecharts.THE_NUMBERS, [table(head, rows)]))
        return out

    def _infographic(self, token: Token) -> list[str]:
        """A `:::: infographic` block as one picture of the whole page, its alt text the
        title band, every panel and the sources; then each chart's numbers under "The
        numbers", one table a chart, for a reader the picture says nothing to."""
        # where the rows came from is the PDF's and the HTML page's check, as for a chart here
        page = notes_infographic.read(self.case, token.content, look=self.look, note_text=self._note_text, origins=False)
        self.warnings.extend(message for message, _, _ in page.warnings)
        if not page.panels:
            return []
        data = notes_infographic.picture(page, "page")
        digest = hashlib.sha256(data).hexdigest()
        library = md.cut_text(" · ".join(part for part in (page.title, page.credit) if part), MAX_ALT)
        index = self._add(f"infographic:{digest}", data, "image/png", page.alt, library, ".png", digest)
        if index is None:
            return []
        out = [image(index, md.cut_text(page.alt, MAX_ALT), "", media_link=True)]
        tables: list[str] = []
        for drawn in page.panels:
            chart = drawn.chart
            if chart is None or not chart.table_head:
                continue
            head = [f"<tr>{''.join(f'<th>{_text(cell)}</th>' for cell in chart.table_head)}</tr>"]
            rows = [f"<tr><td>{_text(row[0])}</td>"
                    + "".join(f'<td class="has-text-align-right" data-align="right">{_text(cell)}</td>' for cell in row[1:])
                    + "</tr>" for row in chart.table_rows]
            if chart.title:
                tables.append(paragraph(f"<strong>{_text(chart.title)}</strong>"))
            tables.append(table(head, rows))
        if tables:
            out.append(details(notecharts.THE_NUMBERS, tables))
        return out

    def _quote(self, tokens: list[Token], index: int, end: int) -> list[str]:
        callout = md.take_callout(tokens, index)
        if callout is None:
            inner = self._walk(tokens, index + 1, end - 1)
            return [quote(inner)] if inner else []
        # a callout is the analyst's own words, set apart by its label, not a quotation
        self._label = callout[0]
        inner = self._walk(tokens, index + 1, end - 1)
        if self._label:
            inner.insert(0, paragraph(f"<strong>{_text(self._label)}.</strong>"))
            self._label = ""
        return inner

    def _list(self, tokens: list[Token], index: int, end: int) -> str:
        ordered = tokens[index].type == "ordered_list_open"
        start = report._start(tokens[index]) if ordered else 1
        items: list[str] = []
        position = index + 1
        while position < end - 1:
            if tokens[position].type != "list_item_open":
                position += 1
                continue
            stop = md.past(tokens, position)
            task = md.take_task(tokens, position)
            words: list[str] = []
            children: list[str] = []
            inner = position + 1
            while inner < stop - 1:
                token = tokens[inner]
                after = md.past(tokens, inner) if token.nesting == 1 else inner + 1
                if token.type in ("paragraph_open", "heading_open"):
                    words.append(self._inline(tokens[inner + 1]))
                elif token.type in ("bullet_list_open", "ordered_list_open"):
                    children.append(self._list(tokens, inner, after))
                elif token.type in ("fence", "code_block"):
                    words.append(f"<code>{_text(token.content.strip())}</code>")
                elif token.type == "blockquote_open":
                    words.extend(self._flat(tokens, inner, after))
                inner = after
            said = "<br>".join(word for word in words if word.strip())
            if task is not None:
                said = f"{'☑' if task else '☐'} {said}"
            items.append(list_item(said, nested(children)))
            position = stop
        return list_block(items, ordered=ordered, start=start)

    def _flat(self, tokens: list[Token], index: int, end: int) -> list[str]:
        """A quote inside a list item, as its lines."""
        return [self._inline(tokens[position + 1]) for position in range(index, end)
                if tokens[position].type == "paragraph_open"]

    def _table(self, tokens: list[Token], index: int, end: int) -> str:
        """A table block, with what its settings line asks that the block can hold: the
        block's Stripes style, each value of the colouring column highlighted in its row's
        colour (a cell takes no colour of its own), and its caption and source as the
        block's caption. The search bar, sorting and folding are the web page's."""
        look = notes_tables.look_of(tokens[index])
        head: list[str] = []
        headers: list[str] = []
        rows: list[str] = []
        cells_of: list[list[str]] = []
        texts_of: list[list[str]] = []
        in_head = False
        position = index + 1
        while position < end:
            token = tokens[position]
            if token.type == "thead_open":
                in_head = True
            elif token.type == "thead_close":
                in_head = False
            elif token.type == "tr_open":
                cells: list[str] = []
                texts: list[str] = []
                position += 1
                while position < end and tokens[position].type != "tr_close":
                    cell = tokens[position]
                    if cell.type in ("th_open", "td_open"):
                        tag = "th" if cell.type == "th_open" else "td"
                        aligned = re.search(r"text-align:\s*(left|center|right)", md.token_attr(cell, "style"))
                        where = (f' class="has-text-align-{aligned.group(1)}" data-align="{aligned.group(1)}"'
                                 if aligned else "")
                        texts.append(" ".join(md.inline_text(tokens[position + 1]).split()))
                        cells.append(f"<{tag}{where}>{self._inline(tokens[position + 1])}</{tag}>")
                        position += 3
                        continue
                    position += 1
                if in_head:
                    headers = texts
                    head.append(f"<tr>{''.join(cells)}</tr>")
                else:
                    cells_of.append(cells)
                    texts_of.append(texts)
            position += 1
        key, colours = (notes_tables.row_colours(headers, texts_of, look.colour, case=self.case, look=self.look)
                        if look.colour else (None, []))
        if look.colour and key is None:
            self.warnings.append(notes_tables.missing_colour(look.colour))
        for number, cells in enumerate(cells_of):
            colour = colours[number] if colours else ""
            if colour and key is not None and key < len(cells):
                cells = [*cells[:key], _highlighted(cells[key], colour), *cells[key + 1:]]
            rows.append(f"<tr>{''.join(cells)}</tr>")
        caption = _text(look.caption)
        if look.source:
            caption += f"{'<br>' if caption else ''}Source: {_text(look.source)}"
        return table(head, rows, stripes=bool(look.stripes), caption=caption) if head or rows else ""

    # -- inline ------------------------------------------------------------------

    def _inline(self, token: Token) -> str:
        """An inline stream as the rich text a block holds: marks, links, citations,
        and in prose the addresses and coordinates it holds."""
        if token.type != "inline":
            return ""
        parts: list[str] = []
        links: list[tuple[str, int]] = []
        for child in token.children or []:
            kind = child.type
            if kind in ("strong_open", "strong_close", "em_open", "em_close", "s_open", "s_close"):
                tag = kind.rsplit("_", 1)[0]
                parts.append(f"<{tag}>" if kind.endswith("_open") else f"</{tag}>")
            elif kind == "link_open":
                opening, closing, number = self._open_link(child)
                parts.append(opening)
                links.append((closing, number))
            elif kind == "link_close":
                closing, number = links.pop() if links else ("", 0)
                parts.append(closing + (_cite(number) if number else ""))
            elif kind == "image":
                parts.append(self._inline_picture(child))
            elif kind == "code_inline":
                parts.append(f"<code>{_text(child.content)}</code>")
            elif kind == "softbreak":
                parts.append(" ")
            elif kind == "hardbreak":
                parts.append("<br>")
            elif kind == "html_inline":
                shown = report._without_comments(child.content)
                if shown:
                    parts.append(_text(shown))
            elif kind == "text":
                parts.append(_text(child.content) if links else self._prose(child.content))
        parts.extend(closing for closing, _ in reversed(links))
        return "".join(parts).strip()

    def _open_link(self, token: Token) -> tuple[str, str, int]:
        href = md.token_attr(token, "href").strip()
        number = self.cited.number(self.cited.link_source(href)) if self.cited.annex is not None else 0
        entity = md.ENTITY_HREF.match(href)
        if entity:
            source = self.cited.reader.entity(entity.group(1)) if self.case is not None else None
            if source is not None and source.link:
                return f'<a href="{_attr(source.link)}">', "</a>", number
            return "", "", number if source is not None else 0
        if href.startswith("#"):
            # a part of this post: only the headings and sources are kept as anchors
            target = href[1:]
            if target in self._ids or target.startswith("source-"):
                return f'<a href="#{_attr(target)}">', "</a>", 0
            return "", "", 0
        if notesources.web(href) and not md.is_local(href, ()):
            return f'<a href="{_attr(href)}">', "</a>", number
        scheme = urlsplit(href).scheme.lower() if ":" in href else ""
        if scheme in ("mailto", "tel"):
            return f'<a href="{_attr(href)}">', "</a>", 0
        if number:
            return f'<a href="#source-{number}">', "</a>", 0
        return "", "", 0

    def _prose(self, text: str) -> str:
        """Prose with each bare address linked and cited and each coordinate pair
        linked to the map; a local file says only that it is one."""
        found: list[tuple[int, int, str, Any]] = []
        for start, end, address in md.bare_urls(text):
            found.append((start, end, "url", address))
        for match in md.COORDINATES.finditer(text):
            if abs(float(match.group(1))) <= 90 and abs(float(match.group(2))) <= 180:
                found.append((match.start(), match.end(), "coords", match))
        for match in md.FILE_URL.finditer(text):
            found.append((match.start(), match.end(), "file", match))
        found.sort(key=lambda item: (item[0], -item[1]))
        out: list[str] = []
        at = 0
        for start, end, kind, value in found:
            if start < at:
                continue
            out.append(_text(text[at:start]))
            written = text[start:end]
            if kind == "url":
                number = self.cited.number(self.cited.link_source(value)) if self.cited.annex is not None else 0
                if md.is_local(value, ()):
                    out.append(_text(written))
                else:
                    out.append(f"{_link(value, _text(written))}{_cite(number) if number else ''}")
            elif kind == "coords":
                out.append(_link(md.MAP_LINK.format(lat=value.group(1), lon=value.group(2)), _text(written)))
            else:
                out.append("[a local file]")
            at = end
        out.append(_text(text[at:]))
        return "".join(out)

    # -- pictures --------------------------------------------------------------

    def _find(self, written: str) -> "tuple[Path, str, dict[str, Any] | None] | None":
        """The case file a picture shows and its record, or None (counted) when it shows none."""
        parts = urlsplit(written)
        if self.case is None or parts.scheme in ("http", "https"):
            self.other += 1
            return None
        record: dict[str, Any] | None = None
        if parts.scheme == "azimut" and parts.netloc == "media":
            record = self.case.get_entity(unquote(parts.path.lstrip("/")))
            relative = str(((record or {}).get("attrs") or {}).get("path") or "")
        elif (prefix := next((one for one in self._prefixes if written.startswith(one)), "")):
            relative = unquote(written[len(prefix):])
        else:
            relative = ""
        path = self._case_path(relative) if relative else None
        if path is None or not path.is_file():
            self.other += 1
            return None
        if record is None:
            found = self.cited.reader.file(relative)
            record = self.case.get_entity(found.entity_id) if found is not None and found.entity_id else None
        return path, relative, record

    def _case_path(self, relative: str) -> Path | None:
        if self.case is None:
            return None
        try:
            return self.case.resolve_inside(relative)
        except Exception:
            return None

    def _inline_picture(self, token: Token) -> str:
        """A picture inside a line of words: its words, linked to the picture uploaded."""
        src = md.token_attr(token, "src")
        options = md.image_options(src)
        words = " ".join((token.content or "").split()) or "Picture"
        if notefill.picture_name(options.source) is not None:
            return ""
        found = self._find(options.source)
        if found is None:
            return _text(words)
        path, _, record = found
        source = self.cited.image_source(src)
        number = self.cited.number(source)
        cite = _cite(number) if number else ""
        attrs = (record or {}).get("attrs") or {}
        if attrs.get("kind") == "video" or media_kind(path.name) == "video":
            url = source.traced_address if source is not None else ""
            return f"{_link(url, _text(words)) if url else _text(words)}{cite}"
        index = self._picture(path, words, self._library_caption("", source), inline=True)
        if index is None:
            return _text(words)
        return f'<a href="{_ref(index, "full")}">{_text(words)}</a>{cite}'

    def _figure(self, token: Token) -> list[str]:
        """A picture standing alone, as the blocks its kind asks for."""
        src = md.token_attr(token, "src")
        options = md.image_options(src)
        title = options.caption or md.token_attr(token, "title")
        words = " ".join((token.content or "").split())
        name = notefill.picture_name(options.source)
        if name is not None:
            return self._built_in(name)
        found = self._find(options.source)
        if found is None:
            return []
        path, relative, record = found
        source = self.cited.image_source(src)
        number = self.cited.number(source)
        attrs = (record or {}).get("attrs") or {}
        alt = words or title or "Picture"
        align = "center" if options.aligned and options.align == "center" else ""
        if attrs.get("kind") == "video" or media_kind(path.name) == "video":
            return self._clip(path, relative, record, source, title, words, number)
        credit = self._credit(source, number)
        caption = self._caption(title, words)
        kind = "proof" if (record or {}).get("type") == "proof" else "picture"
        dates = self._dates(source, credit) if kind == "proof" else ""
        said = "<br>".join(part for part in (caption, credit, dates) if part)
        library = self._library_caption(title or words, source)
        out: list[str]
        sides = self._sides(relative, source) if kind == "picture" else None
        if sides is not None:
            out = [sides]
            if said:
                out.append(paragraph(said, caption=True))
        else:
            index = self._picture(path, alt, library)
            if index is None:
                self.other += 1
                return []
            if self._credited is None and credit:
                self._credited = index
            out = [image(index, alt, said, align=align)]
        if kind == "proof":
            out.extend(self._proof(record, source))
        if md.image_graphic(src):
            self.graphic = True
            return [details(GRAPHIC_SUMMARY, out)]
        return out

    def _built_in(self, name: str) -> list[str]:
        """The analyst's logo or signature, as a picture of its own; the app's logo
        is an SVG WordPress does not take, so it stays out."""
        path = self.cited.identity.picture(name)
        if path is None or path.suffix.lower() == ".svg":
            self.other += 1
            return []
        index = self._picture(path, "Signature" if name == notefill.MY_SIGNATURE else "Logo", "", side=report.POSTER_SIDE)
        return [image(index, "Signature" if name == notefill.MY_SIGNATURE else "Logo", media_link=False)] \
            if index is not None else []

    def _caption(self, title: str, words: str) -> str:
        label = ""
        said = title
        if self.look.numbered:
            self._figures += 1
            label = f"Figure {self._figures}"
            said = title or words
        if not label and not said:
            return ""
        if label:
            return f"<strong>{label}.</strong> {_text(said)}" if said else f"<strong>{label}</strong>"
        return _text(said)

    def _credit(self, source: Source | None, number: int) -> str:
        """The one credit line of a picture, as the HTML report says it: whose imagery
        and of which day, where it was posted, what a map owes, each named once."""
        cite = f" {_cite(number)}" if number else ""
        groups: dict[str, list[tuple[str, str]]] = {}
        seen: set[str] = set()

        def add(kind: str, words: str, link: str = "", *also: str) -> None:
            words = " ".join(words.split())
            key = words.casefold()
            if not key or key in seen:
                return
            seen.update({key, *(" ".join(one.split()).casefold() for one in also)})
            groups.setdefault(kind, []).append((words, link))

        for kind, leaf in report._credit_leaves(source):
            if kind == "Imagery":
                for reading in leaf.readings:
                    day = notesources.spoken_day(reading.day)
                    add(kind, ", ".join(part for part in (reading.provider, day) if part), leaf.address, reading.provider)
                for part in leaf.attribution.split(" · "):
                    add(kind, part)
            elif kind == "Source":
                add(kind, notesources.host(leaf.address), leaf.address)
            else:
                for part in leaf.attribution.split(" · "):
                    add(kind, part)
        if not groups:
            return cite.strip()
        said: list[str] = []
        for kind, items in groups.items():
            shown = [_link(link, _text(words)) if link else _text(words) for words, link in items[:report.MAX_CREDITS]]
            more = len(items) - report.MAX_CREDITS
            said.append(f"{_text(kind)}: {' · '.join(shown)}{f' and {more} more' if more > 0 else ''}")
        return f"{'; '.join(said)}{cite}"

    def _library_caption(self, words: str, source: Source | None) -> str:
        """What the media library keeps beside a picture: its words and its credit, as text."""
        credit = source.credit() if source is not None else None
        said = " ".join(words.split())
        if credit is not None and credit.value:
            said = f"{said} · {credit.kind}: {credit.value}" if said else f"{credit.kind}: {credit.value}"
        return md.cut_text(said, MAX_ALT)

    def _dates(self, source: Source | None, credit: str = "") -> str:
        """`Imagery: Apple, about 3 June 2025 · Footage: 24 October 2025`, as the report says
        it, less the imagery the credit line above has named already."""
        if source is None:
            return ""
        named = html.unescape(re.sub(r"<[^>]+>", "", credit)).casefold()
        imagery: list[str] = []
        footage = ""
        for one in source.lineage():
            for reading in one.readings:
                day = notesources.spoken_day(reading.day)
                said = ", ".join(part for part in (reading.provider, day) if part)
                if day and said.casefold() not in (known.casefold() for known in imagery):
                    imagery.append(said)
            if not footage and one.published and one.kind != notesources.IMAGERY:
                footage = notesources.spoken_day(one.published)
        parts: list[str] = []
        if imagery and not all(said.casefold() in named for said in imagery):
            parts.append(f"Imagery: {' and '.join(imagery)}")
        if footage:
            parts.append(f"Footage: {footage}")
        return _text(" · ".join(parts))

    def _sides(self, relative: str, source: Source | None) -> str | None:
        """A comparison kept with its two sides, as two pictures side by side, each
        labelled with its day and whose imagery it is."""
        if self.case is None:
            return None
        try:
            found = self.case.media_items_by_paths([relative])
        except Exception:
            return None
        item = found[0] if found and isinstance(found[0], dict) else {}
        sidecar = item.get("source") if isinstance(item.get("source"), dict) else {}
        if not isinstance(sidecar, dict) or sidecar.get("type") != "compare" or not isinstance(sidecar.get("sides"), dict):
            return None
        sides = sidecar["sides"]
        files = [self._case_path(str(sides.get(side) or "")) if sides.get(side) else None for side in ("a", "b")]
        if any(file is None or not file.is_file() for file in files):
            return None
        readings = list(source.readings) if source is not None else []
        names = [reading.provider for reading in readings] if len(readings) == 2 else ["", ""]
        halves: list[list[str]] = []
        for side, role, file, name in zip(("a", "b"), ("before", "after"), files, names):
            assert file is not None
            day = report._side_day(sidecar, side)
            said = ", ".join(part for part in (name, day) if part)
            label = f"{role.capitalize()}: {said}" if said else role.capitalize()
            index = self._picture(file, label, label)
            if index is None:
                return None
            if self._credited is None:
                self._credited = index
            halves.append([image(index, label, _text(label))])
        return columns(halves)

    def _proof(self, record: dict[str, Any] | None, source: Source | None) -> list[str]:
        """A proof's sentence, and the points it concludes on linked to the map."""
        spec = report._proof_spec(self.case, record)
        out: list[str] = []
        sentence = str(spec.get("description") or "").strip()
        if sentence:
            out.append(paragraph(_text(sentence)))
        from . import satellite as satellite_engine

        try:
            points = [point for point in satellite_engine.spec_points(spec) if not point.get("proposed")]
        except Exception:  # a spec the app cannot read says nothing more
            points = []
        items: list[str] = []
        for point in points:
            lat, lon = float(point["lat"]), float(point["lon"])
            pov = bool(point.get("pov"))
            rounded = pov and self.round_pov
            if rounded:
                lat, lon = report._rounded(lat, lon)
            shown = f"{lat:.4f}, {lon:.4f}" if rounded else f"{lat:.6f}, {lon:.6f}"
            label = str(point.get("label") or "").strip()
            words = f" {_text(label)}" if label else ""
            if pov:
                words += f" (where it was filmed{f', rounded to about {report.POV_METRES} m' if rounded else ''})"
                named = (record or {}).get("label") or "Proof"
                self.pov.append(f"{named}: {shown}")
            href = md.MAP_LINK.format(lat=f"{lat:.6f}", lon=f"{lon:.6f}")
            items.append(list_item(f"{_link(href, shown)}{words}"))
        if items:
            out.append(list_block(items))
        return out

    def _clip(self, path: Path, relative: str, record: dict[str, Any] | None, source: Source | None, title: str,
              words: str, number: int) -> list[str]:
        """A video: uploaded whole when it is a clip cut for a post or a short case video
        and the budget has room, else its still linked to where it was posted."""
        sidecar_cut = False
        if self.case is not None:
            try:
                found = self.case.media_items_by_paths([relative])
                item = found[0] if found and isinstance(found[0], dict) else {}
                sidecar = item.get("source") if isinstance(item.get("source"), dict) else {}
                sidecar_cut = isinstance(sidecar, dict) and sidecar.get("type") == "inspect" and sidecar.get("op") == "clip"
            except Exception:
                sidecar_cut = False
        mime = report.CLIP_TYPES.get(path.suffix.lower(), "")
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        sha = str(((record or {}).get("attrs") or {}).get("sha256") or (source.sha256 if source is not None else ""))
        still_rel = thumbnails.thumb_relpath(sha, "video") if sha else None
        still = self._case_path(still_rel) if still_rel else None
        label = words or title or path.stem
        caption = self._caption(title or f"Video: {words or 'untitled'}", words)
        credit = self._credit(source, number)
        url = source.traced_address if source is not None else ""
        candidate = bool(mime) and (sidecar_cut or size <= report.SHORT_VIDEO_BYTES) and size <= MAX_UPLOAD_BYTES
        poster = self._picture(still, label, label, side=report.POSTER_SIDE) if still is not None and still.is_file() else None
        if candidate and self._clip_bytes + size <= report.MAX_BYTES:
            index = self._clip_upload(path, mime, label, size)
            if index is not None:
                self._clip_bytes += size
                said = "<br>".join(part for part in (caption, credit) if part)
                # a site that refuses the clip (too large for it, a type it does not take)
                # still gets its still and a link, decided once WordPress has answered
                self.swaps[index] = (video(index, said, poster), _blocks(self._linked_clip(poster, label, caption,
                                                                                         credit, url)))
                return [_swap(index)]
        self.clips_out += 1
        return self._linked_clip(poster, label, caption, credit, url)

    def _linked_clip(self, poster: int | None, label: str, caption: str, credit: str, url: str) -> list[str]:
        """A clip that stays out, as its still linked to where it was posted."""
        watch = f"Watch on {_text(report._platform(url))}" if url else ""
        said = "<br>".join(part for part in (caption, credit, _link(url, watch) if url else "") if part)
        if poster is not None:
            if self._credited is None and credit:
                self._credited = poster
            return [image(poster, label, said, href=url, media_link=False)]
        return [paragraph(said)] if said else []

    def _clip_upload(self, path: Path, mime: str, label: str, size: int) -> int | None:
        key = f"clip:{path}:{size}"
        if key in self._keys:
            return self._keys[key]
        if self.check:
            data = b""
        else:
            copied = report._clip_bytes(path)
            if copied is None:
                self.warnings.append(f'The clip "{md.cut_text(label, 80)}" could not be copied without its metadata, '
                                     "so it is its still and a link.")
                return None
            data = copied
        return self._add(key, data, mime, label, label, path.suffix.lower())

    def _picture(self, path: Path, alt: str, caption: str, *, side: int = report.PICTURE_SIDE,
                 inline: bool = False) -> int | None:
        """A picture of the case as an upload, re-encoded without its metadata. A picture
        named in a line of words, then shown as a figure, is described by the figure."""
        made = report.PICTURES.get(path, side)
        if made is None:
            return None
        data, mime, _ = made
        digest = hashlib.sha256(data).hexdigest()
        key = f"picture:{digest}"
        known = self._keys.get(key)
        if known is not None and not inline and known in self._named_only:
            self._named_only.discard(known)
            upload = self.uploads[known]
            upload.alt, upload.caption = md.cut_text(" ".join(alt.split()), MAX_ALT), caption
            upload.name = f"{report._slug(alt)[:40].strip('-') or 'picture'}-{digest[:8]}{Path(upload.name).suffix}"
        suffix = {"image/png": ".png", "image/gif": ".gif"}.get(mime, ".jpg")
        index = self._add(key, data, mime, alt, caption, suffix, digest)
        if inline and known is None and index is not None:
            self._named_only.add(index)
        return index

    def _diagram(self, png: bytes) -> int | None:
        """A diagram's PNG, as the browser drew it, drawn again without its text chunks and
        kept a PNG: lines and words stay sharp."""
        try:
            with Image.open(BytesIO(png)) as drawn:
                if drawn.format != "PNG" or drawn.width * drawn.height > MAX_IMAGE_PIXELS:
                    return None
                picture = drawn.convert("RGBA" if "A" in drawn.getbands() else "RGB")
        except (OSError, ValueError, Image.DecompressionBombError):
            return None
        picture.thumbnail((report.PICTURE_SIDE, report.PICTURE_SIDE), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        picture.save(buffer, "PNG", optimize=True)
        data = buffer.getvalue()
        digest = hashlib.sha256(data).hexdigest()
        return self._add(f"picture:{digest}", data, "image/png", "Diagram", "Diagram", ".png", digest)

    def _add(self, key: str, data: bytes, mime: str, alt: str, caption: str, suffix: str, digest: str = "") -> int | None:
        if key in self._keys:
            return self._keys[key]
        if len(self.uploads) >= MAX_UPLOADS:
            self.other += 1
            return None
        digest = digest or hashlib.sha256(key.encode("utf-8")).hexdigest()
        stem = report._slug(alt)[:40].strip("-") or "picture"
        upload = Upload(key=digest[:16], name=f"{stem}-{digest[:8]}{suffix}", mime=mime, data=data,
                        alt=md.cut_text(" ".join(alt.split()), MAX_ALT), caption=caption)
        self.uploads.append(upload)
        self._keys[key] = len(self.uploads) - 1
        return len(self.uploads) - 1

    # -- the end ------------------------------------------------------------------

    def _sources(self) -> list[str]:
        annex = self.cited.annex
        if annex is None or not annex.entries:
            return []
        style = self.cited.profile.sources_style
        items = [self._source(entry) if style == "short" else self._styled_source(entry, style)
                 for entry in annex.entries]
        return [heading(2, "Sources", "sources"), list_block(items, ordered=True)]

    def _styled_source(self, entry: Entry, style: str) -> str:
        """One source as ``style`` writes it (`notesources.entry`), as the HTML page has it."""
        source = entry.source
        said: list[str] = []
        for part in notesources.entry(source, style, entry.origins):
            if part.kind == "cite":
                said.append(f'<a href="#source-{part.number}">[{part.number}]</a>')
            elif part.kind == "outlet":
                said.append(f"<em>{_text(part.text)}</em>")
            elif part.link and (part.kind in ("address", "link") or style == "web"):
                said.append(_link(part.link, _text(part.text)))
            else:
                said.append(_text(part.text))
        links = [_link(address, f"Check on {_text(site)}") for site, address in source.verify]
        if source.sha256:
            links.append(f"SHA-256 <code>{source.sha256}</code>")
        line = "".join(said)
        if links:
            line += f"<br>{' · '.join(links)}"
        return list_item(line, anchor=f"source-{entry.number}")

    def _annexes(self) -> list[str]:
        """The annexes the style carries (`engine/noteannexes.py`), as the HTML page has them."""
        annexes = self.annexes
        if annexes is None:
            return []
        out: list[str] = []
        for key in annexes.present():
            out.append(heading(2, _text(noteannexes.HEADINGS[key]), f"annex-{key}"))
            if key == "geolocations":
                head = ["<tr>" + "".join(f"<th>{name}</th>" for name in ("Proof", "Place", "Day", "Coordinates")) + "</tr>"]
                rows = []
                for place in annexes.geolocations:
                    number = f'<a href="#source-{place.number}">[{place.number}]</a> ' if place.number else ""
                    coords = _link(place.link, _text(place.coords)) if place.coords else ""
                    rows.append(f"<tr><td>{number}{_text(place.proof)}</td><td>{_text(place.where)}</td>"
                                f"<td>{_text(place.day)}</td><td>{coords}</td></tr>")
                out.append(table(head, rows))
            elif key == "credits":
                out.extend(paragraph(f"<strong>{_text(kind)}.</strong> {_text(words)}") for kind, words in annexes.credits)
            elif key == "method":
                out.append(list_block([list_item(_text(fact)) for fact in annexes.method]))
            elif key == "limits":
                out.append(list_block([list_item(_text(limit.text)) for limit in annexes.limits]))
            elif key == "editions":
                items = []
                for one in annexes.editions:
                    lead = "This edition" if one.current else one.day
                    items.append(list_item(f"<strong>{_text(lead)}</strong> {_text(one.said)}"))
                out.append(list_block(items))
        return out

    def _source(self, entry: Entry) -> str:
        source = entry.source
        said = [f"<strong>{_text(source.label or source.host or 'Untitled')}</strong>"]
        details_said = notesources.details(source)
        if details_said:
            said.append(_text(" · ".join(details_said)))
        if entry.origins:
            said.append("from " + ", ".join(f'<a href="#source-{number}">[{number}]</a>' for number in entry.origins))
        links: list[str] = []
        if source.address:
            links.append(_link(source.address, _text(source.address)))
        if source.archive and source.archive != source.address:
            links.append(_link(source.archive, "Archived copy"))
        if source.posted and source.posted not in (source.address, source.archive):
            links.append(_link(source.posted, f"Posted on {_text(report._platform(source.posted))}"))
        links.extend(_link(address, f"Check on {_text(site)}") for site, address in source.verify)
        if source.sha256:
            links.append(f"SHA-256 <code>{source.sha256}</code>")
        line = ". ".join(said)
        if links:
            line += f"<br>{' · '.join(links)}"
        return list_item(line, anchor=f"source-{entry.number}")


# -- sending ---------------------------------------------------------------------------------


def client() -> httpx.Client:
    """The one way out to a WordPress site: timeouts, no redirect followed, Azimut named."""
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False,
                        headers={"User-Agent": f"Azimut/{__version__}", "Accept": "application/json"})


@dataclass
class Connection:
    """Who the password signs in as, on which site, and what that account may do."""

    name: str
    site_name: str
    #: Where WordPress itself lives (its `wp-admin`) and where the site is read.
    admin: str
    home: str
    can_post: bool
    can_upload: bool
    #: Whether the REST API answers only as `?rest_route=` (plain permalinks).
    plain: bool = False


@dataclass
class Sent:
    """A draft made or updated: its post, its two links, the pictures it holds, and the
    clips the site refused, each its still and a link."""

    post: int
    edit: str
    preview: str
    updated: bool
    media: dict[str, int] = field(default_factory=dict)
    refused: list[str] = field(default_factory=list)


class Site:
    """One WordPress site's REST API, reached with the analyst's application password."""

    def __init__(self, address: str, user: str, password: str, http: httpx.Client) -> None:
        self.address = address
        self.auth = httpx.BasicAuth(user, password)
        self.http = http
        self.plain = False

    def url(self, route: str, query: dict[str, Any] | None = None) -> str:
        if self.plain:
            return f"{self.address}/?{urlencode({'rest_route': route, **(query or {})})}"
        return f"{self.address}/wp-json{route}{f'?{urlencode(query)}' if query else ''}"

    def call(self, method: str, route: str, *, query: dict[str, Any] | None = None, auth: bool = True,
             **kwargs: Any) -> httpx.Response:
        try:
            return self.http.request(method, self.url(route, query), auth=self.auth if auth else None, **kwargs)
        except httpx.TimeoutException as exc:
            raise WordPressError("The site did not answer in time. Try again, or check that it is up.") from exc
        except httpx.ConnectError as exc:
            if "certificate" in str(exc).lower() or "ssl" in str(exc).lower():
                raise WordPressError("The site's https certificate could not be checked.") from exc
            raise WordPressError(f"Azimut could not reach {notesources.host(self.address) or 'the site'}. "
                                 "Check the address and this computer's connection.") from exc
        except httpx.HTTPError as exc:
            raise WordPressError("The site could not be reached.") from exc

    def json(self, response: httpx.Response, doing: str) -> Any:
        """The answer's body, or the reason it is not one, said for the analyst."""
        if response.status_code in (301, 302, 303, 307, 308):
            moved = web_link(response.headers.get("location"))
            where = urlsplit(moved).netloc if moved else ""
            raise WordPressError(f"The site answered from another address{f' ({where})' if where else ''}. "
                                 "Write the address it moved to.")
        if response.status_code == 401:
            raise WordPressError(f"WordPress refused the password: {WHERE_PASSWORD}, then paste it here.")
        code = ""
        try:
            body = response.json()
        except ValueError:
            body = None
        if isinstance(body, dict):
            code = str(body.get("code") or "")
        if response.status_code == 403:
            if code in ("rest_cannot_create", "rest_cannot_edit", "rest_cannot_upload") or "upload" in doing:
                what = "upload pictures" if "upload" in doing or code == "rest_cannot_upload" else "write posts"
                raise WordPressError(f"This WordPress user may not {what}: it needs the Author role or above.")
            raise WordPressError("WordPress refused the request. A security plugin or the host may block it.")
        if response.status_code == 404:
            raise WordPressError("No WordPress answers at this address. Check it, or ask whoever runs the site "
                                 "whether its REST API is on.")
        if response.status_code == 413:
            raise WordPressError("The site refused a file this large.")
        if response.status_code >= 400:
            message = str(body.get("message") or "") if isinstance(body, dict) else ""
            message = re.sub(r"<[^>]+>", "", message)[:160]
            raise WordPressError(f"WordPress could not {doing} (HTTP {response.status_code})"
                                 f"{f': {message}' if message else ''}.")
        if body is None:
            raise WordPressError("This address answers, but not as WordPress.")
        return body


def connect(site: Site) -> Connection:
    """Ask the site who the password signs in as, and what that account may do.

    The REST index says the site's name and where WordPress lives; a site whose
    permalinks are plain answers only as `?rest_route=`, which is tried next."""
    response = site.call("GET", "/", auth=False)
    if response.status_code == 404:
        site.plain = True
        response = site.call("GET", "/", auth=False)
        if response.status_code == 404:
            site.plain = False
            raise WordPressError("No WordPress answers at this address. Check it, or ask whoever runs the site "
                                 "whether its REST API is on.")
    index = site.json(response, "read the site")
    if not isinstance(index, dict) or "namespaces" not in index:
        raise WordPressError("This address answers, but not as WordPress.")
    if "wp/v2" not in (index.get("namespaces") or []):
        raise WordPressError("This WordPress has its REST API turned off for posts.")
    authentication = index.get("authentication")
    if isinstance(authentication, dict) and "application-passwords" not in authentication:
        raise WordPressError("This site has application passwords turned off; a security plugin may do that.")
    me = site.json(site.call("GET", "/wp/v2/users/me", query={"context": "edit"}), "read the account")
    if not isinstance(me, dict):
        raise WordPressError("This address answers, but not as WordPress.")
    raw = me.get("capabilities")
    capabilities: dict[str, Any] = raw if isinstance(raw, dict) else {}
    admin = web_link(index.get("url")) or site.address
    home = web_link(index.get("home")) or site.address
    return Connection(
        name=str(me.get("name") or me.get("username") or "")[:120],
        site_name=" ".join(str(index.get("name") or "").split())[:120],
        admin=admin.rstrip("/"),
        home=home.rstrip("/"),
        can_post=bool(capabilities.get("edit_posts", True)),
        can_upload=bool(capabilities.get("upload_files", True)),
        plain=site.plain,
    )


def send(
    draft: Draft,
    site: Site,
    *,
    previous: dict[str, Any] | None = None,
) -> Sent:
    """Upload the draft's files and make, or update, its post as a draft.

    ``previous`` is what the note's record kept of the last draft sent to this site:
    its ``post`` and the ``media`` it uploaded, by key. The post is updated only while
    WordPress still says it is a draft; a post published, scheduled, pending review,
    trashed or gone is left alone and a new draft is made. Pictures already uploaded
    are reused when the library still holds them."""
    connection = connect(site)
    if not connection.can_post:
        raise WordPressError("This WordPress user may not write posts: it needs the Author role or above.")
    if draft.uploads and not connection.can_upload:
        raise WordPressError("This WordPress user may not upload pictures: it needs the Author role or above.")
    total = sum(len(upload.data) for upload in draft.uploads)
    if total > MAX_TOTAL_BYTES:
        raise WordPressError("This note's pictures and clips weigh too much to send at once.")
    known = {str(key): value for key, value in ((previous or {}).get("media") or {}).items()
             if isinstance(value, int) and not isinstance(value, bool) and value > 0}
    placed: dict[int, dict[str, Any]] = {}
    media: dict[str, int] = {}
    refused: list[str] = []
    for index, upload in enumerate(draft.uploads):
        if len(upload.data) > MAX_UPLOAD_BYTES:
            raise WordPressError(f'"{md.cut_text(upload.alt or upload.name, 60)}" weighs too much to upload.')
        try:
            found = _reuse(site, known.get(upload.key), upload) if upload.key in known else None
            placed[index] = found or _upload(site, upload)
        except WordPressError as exc:
            if index not in draft.swaps:
                raise
            # the site would not take this clip: its still and a link stand in for it
            refused.append(f'The site refused the clip "{md.cut_text(upload.alt, 60)}" ({exc}), so it is its '
                           "still and a link.")
            continue
        media[upload.key] = int(placed[index]["id"])
    content = draft.markup(placed)
    post: dict[str, Any] = {"title": draft.title, "content": content, "excerpt": draft.excerpt, "status": "draft"}
    if draft.featured is not None and draft.featured in placed:
        post["featured_media"] = placed[draft.featured]["id"]
    earlier = (previous or {}).get("post")
    updated = False
    answer: Any = None
    if isinstance(earlier, int) and not isinstance(earlier, bool) and earlier > 0 and _still_a_draft(site, earlier):
        answer = site.json(site.call("POST", f"/wp/v2/posts/{earlier}", json=post), "update the draft")
        updated = True
    else:
        answer = site.json(site.call("POST", "/wp/v2/posts", json=post), "make the draft")
    if not isinstance(answer, dict) or not isinstance(answer.get("id"), int):
        raise WordPressError("WordPress made no post.")
    if answer.get("status") not in (None, "draft"):
        # never the case: every post here is sent as a draft
        raise WordPressError("WordPress did not keep the post as a draft.")
    number = int(answer["id"])
    link = web_link(answer.get("link")) or f"{connection.home}/?p={number}"
    preview = f"{link}{'&' if '?' in link else '?'}preview=true"
    return Sent(post=number, edit=f"{connection.admin}/wp-admin/post.php?post={number}&action=edit",
                preview=preview, updated=updated, media=media, refused=refused)


def _still_a_draft(site: Site, post: int) -> bool:
    response = site.call("GET", f"/wp/v2/posts/{post}", query={"context": "edit"})
    if response.status_code in (404, 410):
        return False
    body = site.json(response, "read the earlier draft")
    return isinstance(body, dict) and body.get("status") == "draft"


def _upload(site: Site, upload: Upload) -> dict[str, Any]:
    """One file into the media library, then its alt text and caption."""
    headers = {"Content-Type": upload.mime, "Content-Disposition": f'attachment; filename="{upload.name}"'}
    made = site.json(site.call("POST", "/wp/v2/media", content=upload.data, headers=headers), "upload a picture")
    if not isinstance(made, dict) or not isinstance(made.get("id"), int):
        raise WordPressError("WordPress kept no picture.")
    described = _describe(site, made["id"], upload) or made
    return _placed(described)


def _reuse(site: Site, media: int | None, upload: Upload) -> dict[str, Any] | None:
    """A picture uploaded for an earlier draft of this note, its words set again;
    None when the library no longer holds it."""
    if media is None:
        return None
    response = site.call("POST", f"/wp/v2/media/{media}", json=_words(upload))
    if response.status_code in (404, 410):
        return None
    described = site.json(response, "update a picture")
    return _placed(described) if isinstance(described, dict) and described.get("id") == media else None


def _describe(site: Site, media: int, upload: Upload) -> dict[str, Any] | None:
    described = site.json(site.call("POST", f"/wp/v2/media/{media}", json=_words(upload)), "describe a picture")
    return described if isinstance(described, dict) else None


def _words(upload: Upload) -> dict[str, str]:
    title = upload.alt or Path(upload.name).stem
    return {"alt_text": upload.alt, "caption": upload.caption, "title": md.cut_text(title, 120)}


def _placed(media: dict[str, Any]) -> dict[str, Any]:
    """What a block needs of a file in the library: its id, the size shown, the full one."""
    full = web_link(media.get("source_url"))
    if not full or not isinstance(media.get("id"), int):
        raise WordPressError("WordPress kept no picture.")
    details_ = media.get("media_details") if isinstance(media.get("media_details"), dict) else {}
    sizes = details_.get("sizes") if isinstance(details_, dict) and isinstance(details_.get("sizes"), dict) else {}
    large = sizes.get("large") if isinstance(sizes, dict) else None
    shown = web_link(large.get("source_url")) if isinstance(large, dict) else ""
    return {"id": media["id"], "url": shown or full, "full": full, "size": "large" if shown else "full"}


__all__ = [
    "Connection", "Draft", "LEFT", "NotesWordPressError", "Sent", "Site", "Upload", "WordPressError", "build",
    "client", "connect", "fill", "left_said", "send", "site_address", "user_name", "web_link",
]
