"""A note rendered to one HTML file, read offline in any browser.

The PDF (`engine/notes_pdf.py`) is the document a note prints as; this is the page
it is published as. Both read the note the same way (`engine/notes_markdown.py`):
the same chapters, the same two editions, the same citations numbered the same,
the same credit under every picture. What a page can do and paper cannot is added
on top: a picture opens large, a comparison is a slider, a clip plays from the
timecode the text names, a table sorts, a citation shows its source on hover.
That behaviour and the look are `notes_html_assets/reader.js` and `reader.css`,
inlined into the file; this module writes the markup they read (the `az-` classes).

**One file, nothing fetched.** Every picture, clip, font and diagram is inside the
file as a `data:` address, and the page's own policy (`CSP`) lets it load nothing
else, so opening it reaches no server and tells nobody it was read. The only web
addresses it holds are its links, each opened in a new tab with no referrer.

**What a public file never holds.** It is laid out from the public edition, every
internal passage blanked before anything is read (`notes_markdown.strip_internal`),
and refused if one were still there. Guidance lines and HTML comments are dropped,
raw HTML is shown as text, a case reference is its words with no record id, and a
link to this machine, a private network or a case path keeps its words and loses
its address. Pictures are encoded again without their EXIF, GPS or text chunks, and
a clip is copied without its container's metadata (`ffmpeg -map_metadata -1`).

**Its weight.** About 25 MB at most (`MAX_BYTES`). A picture is at most 2400 pixels
on its long side, a JPEG unless it shows through somewhere. A clip goes in only when
it is one cut for a post (`engine/postclips.py`) or a short case video, and only while
the file stays under the target; any other becomes its still and a Watch link. The
check before export says the weight and every clip turned into a link.

**Points of view.** A proof's point where the footage was filmed (`pov`) is kept in
the public edition. The check lists each one, and the export can round them to about
150 m (`POV_METRES`) for that file only; the note is never rewritten.

**Counts.** A count with no "at least" or range before it is said by the check as a
warning (`COUNT`), never changed. A confidence the analyst typed is printed as typed.

**Maps.** A `::: map` block is a figure the reader can move about (`engine/notes_maps.py`
reads what it shows): the ground filed when it was put in, the layers' features drawn
over it as SVG in their own colours and pictograms, a card a press away for each, and a
slider through its days. Its data rides along unread (`script.az-map-data`, JSON), and
the figure shows the map as on its last day with no script and in print.

**Charts.** A `::: chart` block is a figure drawn as SVG in the page (`engine/notecharts.py`):
real words in the page's faces, a title on every bar for the pointer and a description for
screen readers, its numbers folded under it as a table. It is drawn again for a phone, and
in a story for its dark stage; the style sheet shows the one that fits, and print the first.

**Infographics.** A `:::: infographic` block is a page of panels (`engine/notes_infographic.py`):
its title band, one legend for a colour column its charts share, its panels in two columns
as the picture lays them (each chart its own SVG, the map the page's own, the words as
text), then its one source line. On a phone the columns become one, in the text's order.
A web folder also carries the whole page as one picture, a press away.

**Three layouts.** The look's `web` lays the page out as an article, or as a story whose
pictures hold still while the words after each go by (`_scenes`, the `::: story` markup
reused), or as a map page (a web map): the note's first map on the whole page under its
title, a subtitle and the analyst's name, with a panel beside it for its layers, a search
through its features and the note's other words (`_map_page`, `reader.mappage.js` and
`reader.mappage.css`, which only a map page carries). The text is the same in each, only
grouped; the reader script and style sheet do the rest, and the page still reads top to
bottom without them. A map page's web folder may count its readers on the analyst's own
GoatCounter site (`counter`, `reader.count.js`), the one host it then reaches beside its map's.

**As a folder.** Given a `Folder`, the same page is laid out for the web
(`engine/notes_web.py`): each picture, clip, font and the reader's own two files go
under `assets/`, named by their content, and the page names them in place of `data:`
addresses, under the folder's own policy. Nothing else changes: the same reading, the
same safety, the same budget, counted over the whole folder. A folder given `LiveMaps`
also carries MapLibre and the reader's live part (`reader.live.js`, `reader.live.css`),
which turn its maps into live ones once the page is read online, under the wider policy
that page alone is given.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import math
import re
import subprocess
import tempfile
import threading
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable, Mapping
from urllib.parse import unquote, unquote_to_bytes, urlsplit
from xml.etree import ElementTree

import defusedxml.ElementTree as SafeTree
from markdown_it.token import Token
from PIL import Image as PILImage
from PIL import ImageOps, ImageSequence, UnidentifiedImageError

from . import ffmpeg as ffmpeg_engine
from . import (
    mapsites,
    noteannexes,
    notecharts,
    notefill,
    notes_chart_wall,
    notes_charts,
    notes_infographic,
    notes_maps,
    notes_style,
    notes_tables,
    notesources,
    pdffonts,
)
from . import site as site_engine
from . import thumbnails
from . import notes_markdown as md
from .media import media_kind
from .notelook import DEFAULT as DEFAULT_LOOK
from .notelook import TLP_LABELS, NoteLook
from .notes_pdf import MAX_EMPTY_SECTIONS, MAX_IMAGE_PIXELS, MAX_IMAGES, _orientation, _shows_through, _strip_jpeg
from .notesources import Entry, Source

if TYPE_CHECKING:
    from ..workspace import Case

#: Where the reader's stylesheet and script live, inlined into every file.
ASSETS = Path(__file__).resolve().parent / "notes_html_assets"
ASSET_NAMES = ("reader.css", "reader.js")
#: What a page holding a map adds to them: its style, and its script, spliced into the
#: reader's where it says so, so a page with no map keeps the reader it always had; and
#: the style of a map shown otherwise than by default, only where one is.
MAP_ASSET_NAMES = ("reader.map.css", "reader.map.js", "markers.json", "reader.mapset.css")
MAP_SLOT = "  /* az:map */\n"
#: What a page holding a chart, or an infographic of charts, adds to the reader's style
#: sheet: kept apart for the same reason, so a page with none stays as light as before.
FIGURE_ASSET_NAMES = ("reader.chart.css", "reader.infographic.css")
#: What a page holding a table with a settings line adds to the style sheet (its stripes,
#: colours, density, caption and folding), kept apart for the same reason.
TABLE_ASSET_NAMES = ("reader.table.css",)
#: What a page drawing a post from X or Bluesky (`::: post`) adds, for the same reason.
POST_ASSET_NAMES = ("reader.post.css",)
#: What a map page adds: its layout, its panel's script spliced after the map's, and, in a web
#: folder whose look names a GoatCounter site, the counter beside the page.
MAPPAGE_ASSET_NAMES = ("reader.mappage.css", "reader.mappage.js", "reader.count.js")
#: The host a map page's counter reaches, under the analyst's own site code: GoatCounter, which
#: counts with no cookie (https://www.goatcounter.com). Only a web folder calls it, once online.
COUNTER_HOST = site_engine.GOATCOUNTER_HOST
#: The first map of a page as `_map_figure` writes it, whole: its data closes it.
MAP_FIGURE = re.compile(r'<figure class="az-figure az-map[^"]*" data-kind="map".*?</script>\n</figure>\n', re.S)
#: What a map page says when its note holds no map, and reads as an article.
NO_MAP_PAGE = "This map page holds no map, so it reads as an article. Put a map in it with / › Interactive map."
#: What the page may load: nothing but what it holds.
CSP = (
    "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; "
    "script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
)
#: The weight a file aims to stay under; clips are left out first to keep it there.
MAX_BYTES = 25 * 1024 * 1024
#: A picture wall's frame: the widest its slot is drawn on a page, in CSS pixels (its
#: picture holds twice that), and the long side of the picture its lightbox opens, in a
#: folder and in one file.
WALL_SLOT = 120
WALL_LARGE_SIDE = 640
WALL_INLINE_SIDE = 480
#: The longest side of a picture in the file, and in the Page pane's lighter copy.
PICTURE_SIDE = 2400
PREVIEW_SIDE = 1200
POSTER_SIDE = 1280
INLINE_SIDE = 480
JPEG_QUALITY = 84
#: A case video short enough to go in whole, as bytes on disk; a clip cut for a post
#: goes in whatever its size, while the file has room for it.
SHORT_VIDEO_BYTES = 8 * 1024 * 1024
#: A GIF that moves goes in moving up to this size, and as its first frame past it.
MAX_GIF_BYTES = 8 * 1024 * 1024
#: The containers a browser plays from a `data:` address, by suffix.
CLIP_TYPES = {".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm"}
#: How long copying a clip without its metadata may take.
CLIP_TIMEOUT = 120.0
#: How far a point of view is moved when the export rounds it, in metres.
POV_METRES = 150
#: A diagram's SVG, as the browser drew it, and how many a file holds.
MAX_SVG_BYTES = 2_000_000
#: The check's kind for a count said with no "at least" or range (`notes_markdown.exact_counts`).
COUNT = md.COUNT
WARNING_KINDS = md.WARNING_KINDS
#: What a graphic picture's veil says, once, at the top of the report.
GRAPHIC_WARNING = "This report holds graphic pictures. Each stays blurred until you press it."
#: The one-time line for a picture whose site does not allow it in published work,
#: the one said when such a capture is filed (`engine/mapsites.py`).
STREET_VIEW_NOTICE = mapsites.STREET_VIEW_NOTICE
YANDEX_NOTICE = mapsites.SITE_NOTICES["yandex-maps"]
#: What each TLP 2.0 label means, in FIRST's own short words (https://www.first.org/tlp/).
TLP_MEANINGS = {
    "clear": "Disclosure is not limited.",
    "green": "Limited disclosure, restricted to the community.",
    "amber": "Limited disclosure, restricted to participants' organisations and their clients.",
    "amber-strict": "Limited disclosure, restricted to participants' organisations.",
    "red": "For the eyes and ears of individual recipients only, no further disclosure.",
}
#: The word over a cover's title, by the look's style; a plain page has none.
KICKERS = {"report": "Report", "brief": "Brief", "journal": "Log", "article": "Article"}
#: What prints where a picture or a video cannot.
MEDIA_UNAVAILABLE = "Media unavailable"
CASE_PICTURE = "Picture from the case"
#: Sites a "Posted on" link names, by host.
PLATFORMS = {
    "x.com": "X", "twitter.com": "X", "bsky.app": "Bluesky", "t.me": "Telegram", "youtube.com": "YouTube",
    "youtu.be": "YouTube", "facebook.com": "Facebook", "instagram.com": "Instagram", "tiktok.com": "TikTok",
    "threads.net": "Threads", "linkedin.com": "LinkedIn", "reddit.com": "Reddit", "mastodon.social": "Mastodon",
}

#: `[2:10]` or `[2:10–2:38]`, the way a post prints a moment of its video (`lib/videoThread.js`).
TIMECODE = re.compile(
    r"\[((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d)?)(?:\s*[–-]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d)?))?\]"
)
#: An Open Location Code, `8C2XQ7R4+9G` or its short form `Q7R4+9G`.
PLUS_CODE = re.compile(r"(?<![\w+])(?:[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})(?![\w+])")
#: A table row whose first cell is a short code (`V12`, `A3`, `T-04`) can be linked to.
ROW_CODE = re.compile(r"^[A-Z]{1,3}-?\d{1,4}[a-z]?$")
#: An anchor a note may link to inside the page.
ANCHOR = re.compile(r"^[\w:.-]{1,80}$")
#: The story layout's scenes: the figures that can hold its stage, and the parts of the
#: text that can be read beside one.
SCENE_FIGURES = frozenset({"picture", "pair", "proof", "clip", "map", "chart"})
SCENE_WORDS = re.compile(r"<(?:p|ul|ol|blockquote|h4|h5|h6)[ >]|<aside class=\"az-(?:callout|internal)\"")
#: Ids the page keeps for itself.
RESERVED_IDS = frozenset({"sources", "corrections", "contents", "top", "main", "cover", "footer"})
RESERVED_ID = re.compile(r"^(?:src|clip|fig|step|limits|map)-\d+$")
#: The side of a picture a map's card shows.
CARD_SIDE = 640

#: How long a page's description runs, for a link's card.
DESCRIPTION_CHARS = 200
#: How many credits of one kind a figure names before it counts the rest.
MAX_CREDITS = 4


class NotesHtmlError(Exception):
    """The note could not be turned into a page."""


#: Where a folder keeps what its page shows, beside the page.
FOLDER_ASSETS = "assets"
#: The suffix of each kind of file a folder holds, by its type.
FILE_SUFFIXES = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/svg+xml": ".svg"}
#: A picture's `data:` address in a map's markup, which a folder lifts out into a file.
DATA_ATTRIBUTE = re.compile(r'(href|src)="data:(image/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)"')
#: A `data:` address in the reader's stylesheet, which a folder lifts out into a file.
CSS_DATA = re.compile(r"url\(\"data:([\w/+.-]+)(;base64)?,([^\"]*)\"\)")


@dataclass
class Folder:
    """A page laid out as a folder of files rather than one file (`engine/notes_web.py`).

    ``files`` fills as the page is laid out, each under `assets/` and named by its
    content, so a picture shown twice is one file. ``csp`` is the folder's policy;
    ``head`` gives the lines its head adds (the link card's tags) from the page's
    description.
    """

    csp: str
    head: Callable[[str], str] | None = None
    #: What makes its maps live online, or None to keep them as the HTML report draws them.
    live: "LiveMaps | None" = None
    #: How a page published to a site is framed: the way back to the site and the counts its
    #: pages make (`engine/site.py`); None for a folder that is not on a site.
    frame: "site_engine.Frame | None" = None
    #: The author's picture, a file at the folder's root (`notes_web.author_face`): a guest's stands
    #: round where the analyst's logo would by their name (`_Page._author_face`); "" for none.
    author_face: str = ""
    files: dict[str, bytes] = field(default_factory=dict)
    _named: dict[str, str] = field(default_factory=dict, repr=False)

    @property
    def weight(self) -> int:
        return sum(len(data) for data in self.files.values())

    def put(self, data: bytes, name: str, suffix: str) -> str:
        """The address of ``data`` in the folder, `assets/<sha8>-<name><suffix>`."""
        digest = hashlib.sha256(data).hexdigest()
        known = self._named.get(digest)
        if known is not None:
            return known
        stem = _file_stem(name)
        path = f"{FOLDER_ASSETS}/{digest[:8]}-{stem}{suffix}"
        if path in self.files:
            path = f"{FOLDER_ASSETS}/{digest[:16]}-{stem}{suffix}"
        self.files[path] = data
        self._named[digest] = path
        return path


@dataclass(frozen=True)
class LiveMaps:
    """What a folder's maps need to go live once it is online (`engine/notes_web.py`):
    MapLibre's own files, each kept under its name in `assets/maplibre-<version>/` since
    they name one another, the base map's style, and the policy that lets the page reach
    the base map's host, used in place of the folder's own when the page holds a map."""

    csp: str
    style: str
    version: str
    files: dict[str, bytes]
    #: The base map's dark style, from the same host, for a map whose base is dark.
    dark: str = ""
    #: MapLibre's licence, which the folder carries beside the page.
    licence: bytes = b""
    #: The reader's own part for it, and its style, beside the reader's.
    module: str = "reader.live.js"
    sheet: str = "reader.live.css"
    #: The policy of a page whose maps also stream their imagery from these hosts
    #: (`notes_web.live_csp`, which lets in only the imagery's own); None keeps `csp`.
    streaming: Callable[[Iterable[str]], str] | None = None


@dataclass(frozen=True)
class Hero:
    """The picture a page opens on, as the story layout picks it (`hero()` in
    reader.js): the cover's, else the first that came from somewhere (it has a credit),
    else the first. ``credit`` is what the imagery, map or terrain in it owes, in words."""

    path: Path
    credit: str
    alt: str


@dataclass
class RenderedHtml:
    """One finished page, and what the analyst should know about it."""

    html: bytes
    warnings: list[str] = field(default_factory=list)
    warning_lines: list[int | None] = field(default_factory=list)
    warning_kinds: list[str] = field(default_factory=list)
    #: The links behind a grouped warning, by its kind (`notes_markdown.Cited.listed`).
    listed: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    #: The internal passages in the note and its chapters.
    internal: int = 0
    #: The SHA-256 of the source this edition printed (`notes_markdown.printed_source`).
    text_sha256: str = ""
    #: That source, which a public edition keeps for What changed (`engine/noteeditions.py`).
    printed: str = ""
    #: The file's weight in bytes, as written or, for the check, as it would be.
    weight: int = 0
    #: The clips that went as their still and a Watch link, with the line naming each.
    links: list[tuple[str, int | None]] = field(default_factory=list)
    #: The points of view the page shows, with the line of the proof showing each.
    pov: list[tuple[str, int | None]] = field(default_factory=list)
    #: The Mermaid fences drawn as source because no SVG came with them, as (key, source).
    diagrams: list[tuple[str, str]] = field(default_factory=list)
    #: What the page is about in a sentence or two: the cover's subtitle, else its first paragraph.
    description: str = ""
    #: The picture it opens on, or None for a page with no picture to open on.
    hero: Hero | None = None
    #: The day it is dated.
    day: date | None = None
    #: How many maps it holds, and whether they go live once the folder is online.
    maps: int = 0
    live: bool = False
    #: What the Ready to publish? panel reads beyond the warnings (`notes_markdown.Cited.ready`).
    ready: dict[str, Any] = field(default_factory=dict)
    #: How it was laid out: `article`, `story`, or `map` when it is a map page; a note asked to be
    #: a map page that holds no map reads as an article.
    layout: str = "article"
    #: The picture the site's list shows for it when its look names none: the cover's, else a map
    #: page's ground, else the first picture the page shows.
    picture: Path | None = None


def render(
    case: "Case | None",
    *,
    title: str,
    text: str,
    look: NoteLook | None = None,
    note_id: str = "",
    resolve: md.Resolve | None = None,
    created: datetime | None = None,
    public: bool = False,
    identity: notefill.Identity | None = None,
    diagrams: dict[str, str] | None = None,
    light: bool = False,
    check: bool = False,
    round_pov: bool = False,
    changes: str = "",
    earlier: Iterable[dict[str, Any]] = (),
    folder: Folder | None = None,
) -> RenderedHtml:
    """Lay one note out as an HTML page.

    ``public`` lays out the public edition. ``diagrams`` holds each Mermaid fence's
    SVG as the browser drew it, keyed by `notes_markdown.diagram_key`. ``light`` is
    the Page pane's copy: lighter pictures, clips as their still, nothing run.
    ``check`` lays the page out as the export would, pictures included, to say its
    weight and which clips would become links, and writes no clip. ``round_pov``
    rounds every point of view to about `POV_METRES`. ``changes`` is the line the
    analyst wrote about what this edition changed, and ``earlier`` the note's earlier
    editions as its record keeps them; the public ones are listed at the end.
    ``folder`` lays it out for the web, its files in the folder rather than the page.
    """
    look = look or DEFAULT_LOOK
    day = date.fromisoformat(look.cover.date) if look.cover.date else (created or datetime.now()).date()
    identity = identity if identity is not None else notefill.Identity.from_settings()
    values = identity.values(day)
    empty: dict[str, int] = {}
    passages = [0]
    profile = look.profile()
    text = md.sections_cut(text, look, profile)
    cut = notefill.split_cover(text) if look.cover.own else None
    pieces = md.expand(title, cut.body if cut is not None else text, resolve=resolve, note_id=note_id,
                       public=public, counter=passages, values=values, empty=empty)
    cover: md.Piece | None = None
    if cut is not None:
        cover = md.cover_piece(title, cut.text, public=public, counter=passages, values=values, empty=empty)
        if not notefill.prints_anything(cover.text):
            cover = None
    blocks = {id(piece): md.alignment_blocks(piece.text) for piece in pieces if piece.kind == "text"}
    shown = [cover, *pieces] if cover is not None else pieces
    if cover is not None:
        blocks[id(cover)] = md.alignment_blocks(cover.text)
    if public and any(md.holds_internal(block.tokens) for parsed in blocks.values() for block in parsed):
        raise NotesHtmlError("an internal passage could not be left out, so the public edition was not made")
    theme = notes_style.theme_for(look)
    cited = md.Cited(case, look=look, styled=not theme.plain, identity=identity, profile=profile)
    cited.collect(shown, blocks)
    if look.cover.own and cover is None:
        cited.warn(notefill.EMPTY_COVER, cut.line if cut is not None else None, md.OTHER)
    if "name" in empty:
        cited.warn(notefill.NO_NAME, empty["name"], md.SETTING)
    # a note with no internal passage has one edition, shareable as it stands: it says public
    page = _Page(case, look=look, theme=theme, cited=cited, diagrams=diagrams or {}, light=light, check=check,
                 public=public or not passages[0], round_pov=round_pov, day=day, folder=folder)
    source = md.printed_source(shown)
    printed = hashlib.sha256(source.encode("utf-8")).hexdigest()
    document = page.build(title, pieces, blocks, cover=cover, printed=printed, changes=changes, earlier=earlier)
    return RenderedHtml(
        html=document,
        warnings=[message for message, _, _ in page.warnings],
        warning_lines=[line for _, line, _ in page.warnings],
        warning_kinds=[kind for _, _, kind in page.warnings],
        listed=cited.listed,
        internal=passages[0],
        text_sha256=printed,
        printed=source,
        weight=page.weight,
        links=page.links,
        pov=page.pov,
        diagrams=list(page.missing.items()),
        description=page.description,
        hero=page.hero,
        day=day,
        maps=page.maps,
        live=page.live,
        ready=cited.ready,
        layout=page.layout,
        picture=page.picture,
    )


# -- the page ------------------------------------------------------------------


@dataclass
class _Clip:
    """A video the page shows, decided once the rest of the page is laid out."""

    number: int
    path: Path | None
    mime: str
    size: int
    #: Whether it may go in whole: a clip cut for a post, or a short case video.
    candidate: bool
    poster: str
    poster_size: tuple[int, int]
    url: str
    label: str
    line: int | None
    in_steps: bool
    figure_attrs: str
    after: str
    embedded: bool = False
    data: str = ""
    #: What it adds to the file, in bytes.
    weight: int = 0

    @property
    def id(self) -> str:
        return f"clip-{self.number}"


@dataclass
class _Time:
    """A timecode in the text, bound to a clip once the page knows its clips."""

    start: float
    end: float | None
    words: str
    #: How many clips came before it in the page.
    after_clips: int


@dataclass
class _Heading:
    level: int
    id: str
    text: str
    number: str


class _Page:
    """Walks the parsed note and writes it as HTML."""

    def __init__(
        self,
        case: "Case | None",
        *,
        look: NoteLook,
        theme: notes_style.Theme,
        cited: md.Cited,
        diagrams: dict[str, str],
        light: bool,
        check: bool,
        public: bool,
        round_pov: bool,
        day: date,
        folder: Folder | None = None,
    ) -> None:
        self.case = case
        self.look = look
        self.theme = theme
        self.cited = cited
        self.diagrams = diagrams
        self.light = light
        self.check = check
        self.public = public
        self.round_pov = round_pov
        self.day = day
        self.out: list[str] = []
        self.warnings: list[tuple[str, int | None, str]] = []
        self.links: list[tuple[str, int | None]] = []
        self.pov: list[tuple[str, int | None]] = []
        self.missing: dict[str, str] = {}
        self.weight = 0
        self.images = 0
        self.figures = 0
        self.graphic = False
        self.clips: list[_Clip] = []
        self.times: list[_Time] = []
        self.headings: list[_Heading] = []
        self.ids: set[str] = set()
        self._prefixes = md.file_prefixes(case)
        self._line = 0
        self._block_line = 0
        self._fixed = False
        self._shift = 0
        self._base = 1
        self._counters = [0, 0, 0]
        self._on_cover = False
        self._in_steps = False
        self._remote = 0
        self._remote_line: int | None = None
        self._counts: list[tuple[str, int | None]] = []
        #: How deep inside quotes and callouts the walk is: their words are not counted.
        self._quoted = 0
        self._notices: set[str] = set()
        self._svgs = 0
        self.folder = folder
        self.description = ""
        #: The pictures a page could open on: the cover's, then the body's in order,
        #: each with whether it has a credit (`Hero`).
        self._cover_hero: Hero | None = None
        self._heroes: list[tuple[Hero, bool]] = []
        self.maps = 0
        #: Whether a map of the page is shown otherwise than by default, which brings its sheet,
        #: and whether one is drawn on a dark base, which a live map draws in its dark style.
        self.mapset = False
        self.dark_maps = False
        #: The hosts its maps stream their imagery from once live (`notes_maps.live_imagery`).
        self.streamed: set[str] = set()
        #: Whether its maps go live online: a folder's, holding one, given what it takes.
        self.live = False
        #: Whether it is laid out as a map page (`_map_page`), its first map on the whole page.
        self.map_page = False
        #: The first map's ground, which stands in for a map page's picture.
        self.ground: Path | None = None
        #: Each map's steps, `(label, day)`, by its figure's id: the cards a story gives it.
        self._map_steps: dict[str, list[tuple[str, str, str, str]]] = {}
        #: The figure each proof shown in the page stands in, by its record, which a map's card links to.
        self._proof_anchors: dict[str, str] = {}
        self.charts = 0
        self.infographics = 0
        #: The posts it draws (`::: post`), whose cards the page then styles (`reader.post.css`).
        self.posts = 0
        #: Tables with a settings line, whose rules the page then carries (`reader.table.css`).
        self.table_looks = 0
        #: The words the page's charts draw, which its faces must carry.
        self._chart_words: list[str] = []
        #: The credits of the maps it drew, and the id of each Limits box in order: what
        #: the annexes name and link back to (`engine/noteannexes.py`).
        self._map_credits: list[str] = []
        self._limit_ids: list[str] = []
        #: The note's words, which a chart reads for whether the note calls its figures minimums.
        self._note_text = ""

    # -- the whole document -------------------------------------------------------

    def build(
        self,
        title: str,
        pieces: list[md.Piece],
        blocks: dict[int, list[md.Block]],
        *,
        cover: md.Piece | None,
        printed: str,
        changes: str,
        earlier: Iterable[dict[str, Any]],
    ) -> bytes:
        self._prescan(pieces, blocks)
        self._note_text = "\n".join(piece.text for piece in pieces if piece.kind == "text")
        found: list[tuple[str, int | None, str]] = []
        if self.case is not None:
            empty = md.empty_sections(pieces, blocks, journal=self.look.style == "journal")
            found.extend((f'Section "{md.cut_text(name, 80)}" is empty.', line, md.EMPTY_SECTION)
                         for name, line in empty[:MAX_EMPTY_SECTIONS])
            rest = len(empty) - MAX_EMPTY_SECTIONS
            if rest > 0:
                found.append((f"{rest} more section{'s are' if rest > 1 else ' is'} empty.", None,
                              md.EMPTY_SECTION))
        head = self._cover(title, cover, blocks)
        drawn = False
        for piece in pieces:
            if piece.kind == "chapter":
                self._chapter(piece)
                drawn = True
                continue
            if piece.kind == "aside":
                self._line = piece.line
                self.out.append(_aside(piece.text))
                drawn = True
                continue
            self._shift = piece.shift
            self._fixed = piece.fixed
            for block in blocks[id(piece)]:
                self._block_line = piece.line + (0 if piece.fixed else block.line)
                before = len(self.out)
                self._block(block)
                drawn = drawn or len(self.out) > before
        if not drawn:
            self.out.append(_aside("This note is empty."))
        if self.look.web == "story":
            self.out = self._scenes(self.out)
        # what the citation pass found comes first, as in the PDF; a link to a part of
        # this page opens on a page, where it would not in a PDF
        self.warnings[:0] = found + [
            (message, line, kind) for message, line, kind in self.cited.warnings
            if not (kind == md.LOCAL_LINK and _anchor_named(message) in self.ids)
        ]
        if self._remote:
            self._warn(f"{self._remote} remote image{'s' if self._remote > 1 else ''} left out: "
                       "the export never fetches from the network.", self._remote_line, md.OTHER)
        if self._counts:
            self._warn(md.counts_said([phrase for phrase, _ in self._counts]), self._counts[0][1], COUNT)
            self.cited.listed[COUNT] = md.counts_listed(self._counts)
        body = self._scrub("".join(self.out))
        self.description = self._describe(body)
        if self.look.signed == "end":
            # a guest's picture stands left of their name, as on the cover's author card
            body += self._signature("az-signed-end", self._author_face())
        sources = self._sources()
        earlier = list(earlier)
        profile = self.cited.profile
        annexes, listed = self._annexes(changes, earlier)
        # the Editions annex is the corrections and the editions before them: it takes their place
        corrections = "" if profile.editions else self._corrections(changes, earlier)
        footer = self._footer(printed)
        warning = f'<p class="az-graphic-warning" role="note">{_text(GRAPHIC_WARNING)}</p>\n' if self.graphic else ""
        if self.look.web == "map":
            laid = self._map_page(title, body, f"{sources}{annexes}{corrections}{footer}")
            if laid is not None:
                return self._assemble(title, warning + laid)
            self._warn(NO_MAP_PAGE, None, md.OTHER)
        contents = self._contents(bool(sources), bool(corrections), listed)
        # the contents, the text and its end matter share one box, which the contents
        # rail stays inside: it never runs into the footer
        page = (f'{warning}{head}<div class="az-page">\n{contents}<main class="az-body" id="main">\n{body}</main>\n'
                f"{sources}{annexes}{corrections}</div>\n{footer}")
        return self._assemble(title, page)

    def _map_page(self, title: str, body: str, end: str) -> str | None:
        """A map page: its title, a subtitle (the look's own, else the note's first paragraph) and
        the analyst's name over its first map, which the reader lays on the whole window, and the
        note's other words, its sources and its footer in a section the reader puts in the panel
        beside it. Read without script or printed, the same parts follow one another. None when the
        note holds no map."""
        found = MAP_FIGURE.search(body)
        if found is None:
            return None
        self.map_page = True
        figure = found.group(0)
        rest = body[:found.start()] + body[found.end():]
        subtitle = _text(" ".join(self.look.cover.subtitle.split()))
        if not subtitle:
            first = re.search(r'<p dir="auto">(.*?)</p>\n?', rest, re.S)
            if first is not None:
                subtitle = first.group(1)
                rest = rest[:first.start()] + rest[first.end():]
        identity = self.cited.identity
        who = identity.organisation or identity.name
        logo = self._built_in(notefill.MY_LOGO, inline=True)
        by = ""
        face = self._author_face() if who else ""
        if identity.site:
            words = who or urlsplit(identity.site).hostname or identity.site
            by = (f'<a class="az-mappage-site" href="{_attr(identity.site)}" target="_blank" '
                  f'rel="noopener noreferrer">{logo}{face}{_text(words)}</a>')
        elif who or logo:
            by = f'<span class="az-mappage-site">{logo}{face}{_text(who)}</span>'
        if identity.handle:
            account = identity.handle_url()
            by += (f'<a class="az-mappage-handle" href="{_attr(account)}" target="_blank" rel="noopener noreferrer">'
                   f'{_text(identity.handle)}</a>' if account else
                   f'<span class="az-mappage-handle">{_text(identity.handle)}</span>')
        # the same signature on the map itself, which the reader's script lays in its corner: a
        # phone's header has no room for it, and a screenshot of the map keeps it
        shown = identity.handle or who
        target = identity.handle_url() if identity.handle else identity.site
        inner = f'{logo}<span>{_text(shown)}</span>' if shown else logo
        mark = ""
        if inner:
            mark = (f'<a class="az-mappage-mark" href="{_attr(target)}" target="_blank" rel="noopener noreferrer">{inner}</a>'
                    if target else f'<span class="az-mappage-mark">{inner}</span>')
        views = ""
        counter = self._counter()
        if counter:
            views = f'<span class="az-mappage-views" data-counter="{_attr(counter)}" hidden></span>'
        said = f'<p class="az-mappage-sub" dir="auto">{subtitle}</p>\n' if subtitle else ""
        signed = f'<p class="az-mappage-by">{by}{views}</p>\n' if by or views else ""
        # a site's way home rides in the map's own header, never above a page that fills the screen
        way = self._way_home(site_engine.crumb)
        head = (f'<header class="az-mappage-head" id="top">\n<div class="az-mappage-titles">{way}'
                f'<h1 class="az-title" dir="auto">{_text(title)}</h1>\n{said}</div>\n{signed}</header>\n')
        words = f'<div class="az-body az-mappage-text">\n{rest}</div>\n' if rest.strip() else ""
        about = f'<section class="az-mappage-about" id="about" aria-label="About this map">\n{words}{end}</section>\n'
        return (f'<div class="az-mappage">\n{head}<main class="az-mappage-main" id="main">\n{figure}{mark}</main>\n'
                f"{about}</div>\n")

    def _assemble(self, title: str, page: str) -> bytes:
        """The page with its clips and timecodes settled, wrapped in its document."""
        mapped = bool(self.maps)
        live = self.folder.live if self.folder is not None and mapped else None
        self.live = live is not None
        charted = bool(self.charts or self.infographics)
        paged = mapped and self.map_page
        reader_css = (_asset("reader.css") + (_asset("reader.map.css") if mapped else "")
                      + (_asset("reader.mappage.css") if paged else "")
                      + (_asset("reader.mapset.css") if mapped and self.mapset else "")
                      + (_asset("reader.chart.css") if charted else "")
                      + (_asset("reader.infographic.css") if self.infographics else "")
                      + (_asset("reader.table.css") if self.table_looks else "")
                      + (_asset("reader.post.css") if self.posts else "")
                      + (_asset(live.sheet) if live is not None else ""))
        reader = _asset("reader.js")
        map_js = _asset("reader.map.js") + (_asset("reader.mappage.js") if paged else "")
        reader_js = reader.replace(MAP_SLOT, map_js, 1) if mapped else reader
        # what the reader writes itself is drawn in the page's face, a map's words with it
        own = (map_js + _asset("reader.map.css")) if mapped else ""
        if live is not None:
            own += _asset(live.module)
        on_site = self.folder.frame if self.folder is not None else None
        framed = f"{on_site.title} All articles" if on_site is not None else ""
        fonts = _font_faces(self.look, self.theme, _visible_text(page) + title + own + framed
                            + "".join(self._chart_words), self.folder)
        accent = f' style="--az-accent:{self.look.accent}"' if self.look.accent else ""
        tlp = f' data-tlp="{self.look.tlp}"' if self.look.tlp else ""
        web = f' data-web="{self.look.web}"' if self.look.web else ""
        edition = md.PUBLIC if self.public else md.INTERNAL
        above = tail = ""
        if self.folder is None:
            policy, said = CSP, ""
            css = reader_css.replace("</", "<\\/")
            styles = f'<style id="az-reader">{css}</style>\n'
            code = reader_js.replace("</", "<\\/")
            script = f"<script>{code}</script>\n"
        else:
            # the reader's two files beside the page, which its policy lets in from the folder only
            policy = self.folder.csp if live is None else live.csp
            if live is not None and live.streaming is not None and self.streamed:
                policy = live.streaming(sorted(self.streamed))
            said = self.folder.head(self.description) if self.folder.head is not None else ""
            sheet = self.folder.put(self._folder_css(reader_css), "reader", ".css")
            styles = f'<link rel="stylesheet" id="az-reader" href="{sheet}">\n'
            code_file = self.folder.put(reader_js.encode("utf-8"), "reader", ".js")
            script = f'<script src="{code_file}"></script>\n'
            if live is not None:
                said += self._live_config(live)
            code = self._counter()
            beacon = on_site.beacon if on_site is not None else ""
            # the analyst's own counts: each one's host let in and nothing else
            policy = widen_policy(policy, site_engine.stats_sources(code, beacon))
            if code:
                counter = self.folder.put(_asset("reader.count.js").encode("utf-8"), "reader-count", ".js")
                script += f'<script src="{counter}"></script>\n'
                if on_site is not None:
                    said += f'<meta name="az-counter" content="{_attr(code)}">\n'
            if beacon:
                tail = site_engine.cloudflare_tag(beacon) + "\n"
            if not paged:
                # between markers, so Update the site can give it the site's own bar (`engine/site.py`)
                above = self._way_home(site_engine.marked_bar)
        top = (
            f'<!doctype html>\n<html lang="en" dir="auto" data-look="{self.look.style}" data-font="{self.look.font}"'
            f'{tlp}{web} data-edition="{edition}"{accent}>\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="referrer" content="no-referrer">\n'
            f'<meta http-equiv="Content-Security-Policy" content="{policy}">\n'
            '<meta name="generator" content="Azimut">\n'
            f"<title>{_text(title)}</title>\n{said}"
            f'{_wrapped("az-fonts", fonts, "style")}'
            f"{styles}</head>\n<body>{above}\n"
        )
        bottom = f"{script}{tail}</body>\n</html>\n"
        frame = len((top + bottom).encode("utf-8"))
        settled = self._settle_clips(page, frame)
        document = top + settled + bottom
        data = document.encode("utf-8")
        held = self.folder.weight if self.folder is not None else 0
        self.weight = len(data) + held + (sum(clip.weight for clip in self.clips if clip.embedded) if self.check else 0)
        if self.weight > MAX_BYTES:
            self._warn(f"The page weighs {_megabytes(self.weight)}, past the {_megabytes(MAX_BYTES)} it aims for.",
                       None, md.OTHER)
        return data

    def _counter(self) -> str:
        """The GoatCounter site that counts this page once it is online: a map page's own, else
        the site's; "" when it is no web folder or nobody counts it."""
        if self.folder is None:
            return ""
        frame = self.folder.frame
        return (self.look.counter if self.map_page else "") or (frame.counter if frame is not None else "")

    def _way_home(self, draw: Callable[[site_engine.Frame, str], str]) -> str:
        """The site's way back, drawn as ``draw`` says (the bar, or a map page's crumb), with its
        logo as a file of the folder; "" for a page that is on no site."""
        if self.folder is None or self.folder.frame is None:
            return ""
        frame = self.folder.frame
        logo = self.folder.put(frame.logo, "site-logo", ".png") if frame.logo else ""
        return draw(frame, logo)

    def _live_config(self, live: LiveMaps) -> str:
        """MapLibre's files and the reader's live part put in the folder, and where they
        are, for the reader to load once the page is read online (`maps` in reader.map.js);
        unread data like a map's own."""
        assert self.folder is not None
        base = f"{FOLDER_ASSETS}/maplibre-{live.version}"
        for name, data in live.files.items():
            self.folder.files[f"{base}/{name}"] = data
        module = self.folder.put(_asset(live.module).encode("utf-8"), "reader-live", ".js")
        said = {"module": module, "maplibre": f"{base}/maplibre-gl.js", "css": f"{base}/maplibre-gl.css",
                "style": live.style}
        if self.dark_maps and live.dark:
            said["dark"] = live.dark
        written = json.dumps(said, separators=(",", ":")).replace("<", "\\u003c")
        return f'<script type="application/json" id="az-gl">{written}</script>\n'

    def _settle_clips(self, page: str, frame: int) -> str:
        """Each clip in or as its link, in page order, while the file stays under
        `MAX_BYTES`; then each timecode bound to the clip it is about."""
        # a folder counts every file it holds; a clip there is its own bytes, not their base64
        used = len(page.encode("utf-8")) + frame + (self.folder.weight if self.folder is not None else 0)
        for clip in self.clips:
            if not clip.candidate or self.light or clip.path is None:
                continue
            cost = (clip.size if self.folder is not None else 4 * ((clip.size + 2) // 3)) + 200
            if used + cost > MAX_BYTES:
                continue
            if self.check:
                clip.embedded, clip.weight = True, cost  # its weight, with nothing read
                used += cost
                continue
            data = _clip_bytes(clip.path)
            if data is None:
                self._warn(f'The clip "{clip.label}" could not be copied without its metadata, so it is a link.',
                           clip.line, md.OTHER)
                continue
            if self.folder is not None:
                if used + len(data) > MAX_BYTES:
                    continue
                suffix = clip.path.suffix.lower() if clip.path.suffix.lower() in CLIP_TYPES else ".mp4"
                named = "clip" if clip.label == clip.path.stem else clip.label
                clip.embedded, clip.data, clip.weight = True, self.folder.put(data, named, suffix), len(data)
                used += len(data)
                continue
            encoded = f"data:{clip.mime};base64,{base64.b64encode(data).decode('ascii')}"
            if used + len(encoded) > MAX_BYTES:
                continue
            clip.embedded, clip.data, clip.weight = True, encoded, len(encoded)
            used += len(encoded)
        for clip in self.clips:
            if not clip.embedded and not self.light:
                self.links.append((clip.label, clip.line))

        def place(match: re.Match[str]) -> str:
            kind, number = match.group(1), int(match.group(2))
            if kind == "C":
                return self._clip_html(self.clips[number])
            return self._time_html(self.times[number])

        return re.sub("\x00([CT])(\\d+)\x00", place, page)

    def _warn(self, message: str, line: int | None, kind: str = md.OTHER) -> None:
        self.warnings.append((message, line, kind))

    def _scrub(self, page: str) -> str:
        """The page without this machine's home folder or the case's own folder, should
        the note have written either out: a reader is told neither."""
        places: list[tuple[str, str]] = []
        if self.case is not None:
            places.extend((prefix, "") for prefix in self._prefixes)
            places.append((str(self.case.path), "[case]"))
        home = str(Path.home())
        if len(home) > 3:
            places.append((home, "~"))
        for place, word in places:
            for written in {place, _text(place), _attr(place), place.replace("\\", "/")}:
                page = page.replace(written, word)
        return page

    def _notice(self, message: str, line: int | None) -> None:
        """A word the check says once, however many pictures it is about."""
        if message not in self._notices:
            self._notices.add(message)
            self._warn(message, line, md.OTHER)

    # -- reading ahead ------------------------------------------------------------

    def _prescan(self, pieces: list[md.Piece], blocks: dict[int, list[md.Block]]) -> None:
        """Which level the headings start at, and how far each chapter moves its own,
        the way the PDF reads them."""
        tops: dict[int, int] = {}
        for piece in pieces:
            if piece.kind != "text":
                continue
            for position, block in enumerate(blocks[id(piece)]):
                if position == 0 and piece.opens is not None:
                    block.start = md.skip_repeated_title(block.tokens, piece.opens)
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
            elif piece.kind == "text":
                for block in blocks[id(piece)]:
                    levels.extend(md.heading_level(token.tag, piece.shift)
                                  for token in block.tokens[block.start:] if token.type == "heading_open")
        self._base = min(levels) if levels else 1
        if self.case is not None:
            self._anchor_proofs(pieces, blocks)

    def _anchor_proofs(self, pieces: list[md.Piece], blocks: dict[int, list[md.Block]]) -> None:
        """Each proof the page shows as a figure, named `fig-1`, `fig-2`… in page order, so
        a map's card can link to it. Only when the page holds a map."""
        if not any(block.kind in (md.MAP, md.INFOGRAPHIC) for piece in pieces if piece.kind == "text"
                   for block in blocks[id(piece)]):
            return
        for piece in pieces:
            if piece.kind != "text":
                continue
            for block in blocks[id(piece)]:
                for token in block.tokens:
                    if token.type != "inline":
                        continue
                    children = [child for child in token.children or [] if child.type != "softbreak"]
                    if len(children) != 1 or children[0].type != "image":
                        continue
                    source = self.cited.image_source(md.token_attr(children[0], "src"))
                    if source is not None and source.noun == "Proof" and source.entity_id \
                            and source.entity_id not in self._proof_anchors:
                        self._proof_anchors[source.entity_id] = f"fig-{len(self._proof_anchors) + 1}"

    # -- the cover ----------------------------------------------------------------

    def _cover(self, title: str, cover: md.Piece | None, blocks: dict[int, list[md.Block]]) -> str:
        look = self.look
        tlp = self._tlp()
        if cover is not None:
            parts = [f'<header class="az-cover" data-cover="own">\n{tlp}']
            self._on_cover = True
            try:
                for block in blocks[id(cover)]:
                    self._block_line = cover.line + block.line
                    inner = self._drawn(block.tokens, block.start, len(block.tokens))
                    if block.corner:
                        parts.append(f'<div class="az-corner" data-corner="{block.corner}">{inner}</div>\n')
                    elif inner.strip():
                        parts.append(_aligned(block.align, inner))
            finally:
                self._on_cover = False
            parts.append("</header>\n")
            return "".join(parts)
        kind = "style" if look.cover.on else "none"
        # the style's name over the title, only where the look asked for a cover: the
        # app never signs a page it was not asked to
        said = KICKERS.get(look.style, "") if look.cover.on else ""
        kicker = f'<p class="az-kicker">{_text(said)}</p>\n' if said else ""
        lines = [f'<header class="az-cover" data-cover="{kind}">\n', tlp, kicker,
                 f'<h1 class="az-title" dir="auto">{_text(title)}</h1>\n']
        if look.cover.subtitle:
            lines.append(f'<p class="az-standfirst" dir="auto">{_text(look.cover.subtitle)}</p>\n')
        identity = self.cited.identity
        # the analyst's logo stands by their name, as in the PDF: beside the signature under
        # the date, else beside the byline, else alone under the date. A guest's own picture
        # stands where it would (`_author_face`), and never alone: the analyst's logo never
        # stands by another's name
        marks = look.cover.marks if look.cover.on else []
        if identity.guest:
            logo = self._author_face()
        else:
            logo = self._to_site(self._built_in(notefill.MY_LOGO, inline=True)) if "logo" in marks else ""
        byline = identity.byline() if look.signed == "title" else ""
        if byline:
            rest = byline[len(f"By {identity.name}"):]
            beside = "" if "signature" in marks and identity.name else logo
            logo = "" if beside else logo
            shown = f'<span class="az-author-logo">{beside}</span>' if beside else ""
            lines.append(f'<p class="az-byline" dir="auto">{shown}By {self._to_site(_text(identity.name))}{_text(rest)}</p>\n')
        if identity.guest and "signature" not in marks:
            logo = ""
        lines.append(f'<p class="az-dateline"><time class="az-date" datetime="{self.day.isoformat()}">'
                     f"{_text(notes_style.long_date(self.day))}</time></p>\n")
        if look.cover.on:
            lines.append(self._cover_marks(logo))
        if look.cover.on and look.cover.image:
            lines.append(self._cover_picture(look.cover.image))
        lines.append("</header>\n")
        return "".join(lines)

    def _cover_marks(self, logo: str) -> str:
        """Under the date, what the style's cover asks for (`NoteCover.marks`): the analyst's
        ``logo`` left of their name and credentials under the signature, or alone with no
        name to stand by; then the Azimut mark."""
        marks = self.look.cover.marks
        named = "signature" in marks and bool(self.cited.identity.name)
        said = f'<p class="az-author-logo">{logo}</p>\n' if logo and not named else ""
        if "signature" in marks:
            said += self._signature("az-cover-signed", logo if named else "")
        mark = self._built_in(notefill.LOGO, inline=True) if "azimut" in marks else ""
        return said + (f'<p class="az-cover-marks">{mark}</p>\n' if mark else "")

    def _signature(self, kind: str, logo: str = "") -> str:
        """The handwritten signature, the name and the credentials, or "" with none of them;
        ``logo`` left of the name and credentials, on the cover, makes it an author card."""
        identity = self.cited.identity
        picture = self._built_in(notefill.MY_SIGNATURE, inline=True)
        credentials = identity.credentials()
        if not picture and not identity.name:
            return ""
        name = f'<span class="az-signer">{self._to_site(_text(identity.name))}</span>' if identity.name else ""
        role = f'<span class="az-credentials">{_text(credentials)}</span>' if credentials and identity.name else ""
        if logo and name:
            return (f'<div class="az-signed {kind} az-author"><span class="az-author-logo">{logo}</span>{picture}'
                    f'<span class="az-author-text">{name}{role}</span></div>\n')
        return f'<div class="az-signed {kind}">{picture}{name}{role}</div>\n'

    def _author_face(self) -> str:
        """A guest author's picture, round, where the analyst's logo would stand by their name, on a
        web page that has one; "" for the analyst's own note. Its words are the name beside it."""
        face = self.folder.author_face if self.folder is not None and self.cited.identity.guest else ""
        return f'<img class="az-face" src="{_attr(face)}" alt="" width="40" height="40">' if face else ""

    def _to_site(self, inner: str) -> str:
        """The analyst's name or logo linked to their Website (Settings › Publishing), as it is
        while none is set."""
        site = self.cited.identity.site
        if not site or not inner:
            return inner
        return f'<a class="az-site-link" href="{_attr(site)}" target="_blank" rel="noopener noreferrer">{inner}</a>'

    def _tlp(self) -> str:
        label = TLP_LABELS.get(self.look.tlp)
        if label is None:
            return ""
        meaning = TLP_MEANINGS.get(self.look.tlp, "")
        note = f' <span class="az-tlp-note">{_text(meaning)}</span>' if meaning else ""
        return f'<p class="az-tlp" data-tlp="{self.look.tlp}"><span>{_text(label[0])}</span>{note}</p>\n'

    def _cover_picture(self, entity_id: str) -> str:
        if self.case is None:
            return f'<figure class="az-figure az-cover-figure" data-kind="placeholder">{_aside(CASE_PICTURE)}</figure>\n'
        record = self.case.get_entity(entity_id)
        attrs = (record or {}).get("attrs") or {}
        if not record or not attrs.get("path"):
            self._warn("The cover picture is no longer in the case; the cover was drawn without it.", None, md.MISSING)
            return ""
        if attrs.get("kind") == "video":
            self._warn("A video cannot be a cover picture; the cover was drawn without it.", None)
            return ""
        path = self._case_path(str(attrs["path"]))
        alt = str(record.get("label") or "Cover picture")
        encoded = self._picture(path, name=alt) if path is not None else None
        if encoded is None or path is None:
            self._warn("The cover picture could not be read; the cover was drawn without it.", None)
            return ""
        source = self.cited.reader.entity(entity_id)
        uri, size = encoded
        credit = self._credit(source, self.cited.number(source))
        self._cover_hero = Hero(path, _credit_words(source), alt)
        caption = f"<figcaption>{credit}</figcaption>" if credit else ""
        return (f'<figure class="az-figure az-cover-figure" data-kind="picture">'
                f"{_zoom_button(_img(uri, size, alt), alt)}{caption}</figure>\n")

    # -- chapters and headings ------------------------------------------------------

    def _chapter(self, piece: md.Piece) -> None:
        self._line = piece.line
        self.out.append(self._heading_html(" ".join(piece.text.split()), piece.depth, chapter=True))

    def _heading_html(self, words: str, level: int, *, inner: str = "", chapter: bool = False) -> str:
        """A heading at ``level`` after its chapter's shift: `h2` for the page's top
        level, an id from its words, a number when the look numbers sections."""
        rank = level - self._base
        tag = min(6, rank + 2)
        number = ""
        if self.look.numbered and 0 <= rank < len(self._counters):
            self._counters[rank] += 1
            for deeper in range(rank + 1, len(self._counters)):
                self._counters[deeper] = 0
            number = ".".join(str(count) for count in self._counters[: rank + 1] if count)
        anchor = self._new_id(_slug(words))
        if tag <= 3:
            self.headings.append(_Heading(tag, anchor, words, number))
        shown = inner or _text(words)
        numbered = f'<span class="az-num">{number}</span> ' if number else ""
        kind = ' class="az-chapter"' if chapter else ""
        return f'<h{tag} id="{anchor}"{kind} dir="auto">{numbered}{shown}</h{tag}>\n'

    def _new_id(self, wanted: str) -> str:
        base = wanted or "section"
        if base in RESERVED_IDS or RESERVED_ID.match(base):
            base = f"{base}-section"
        candidate, counter = base, 2
        while candidate in self.ids:
            candidate, counter = f"{base}-{counter}", counter + 1
        self.ids.add(candidate)
        return candidate

    def _contents(self, sources: bool, corrections: bool, annexes: list[tuple[str, str]] | None = None) -> str:
        entries = list(self.headings)
        annexes = annexes or []
        if not entries and not sources and not annexes:
            return ""
        items: list[str] = []
        open_sub = False
        for entry in entries:
            number = f'<span class="az-num">{entry.number}</span> ' if entry.number else ""
            link = f'<a href="#{entry.id}">{number}{_text(entry.text)}</a>'
            if entry.level == 3 and items:
                if not open_sub:
                    items[-1] = items[-1].removesuffix("</li>") + "<ol>"
                    open_sub = True
                items.append(f"<li>{link}</li>")
                continue
            if open_sub:
                items.append("</ol></li>")
                open_sub = False
            items.append(f"<li>{link}</li>")
        if open_sub:
            items.append("</ol></li>")
        if sources:
            items.append(f'<li class="az-contents-sources"><a href="#sources">{_text(self.cited.list_title)}</a></li>')
        items.extend(f'<li class="az-contents-annex"><a href="#{ident}">{_text(name)}</a></li>' for ident, name in annexes)
        if corrections:
            items.append('<li class="az-contents-corrections"><a href="#corrections">Corrections</a></li>')
        return (f'<nav class="az-contents" aria-label="Contents">\n<ol>{"".join(items)}</ol>\n</nav>\n')

    # -- blocks -------------------------------------------------------------------

    def _block(self, block: md.Block) -> None:
        if block.kind == md.STEPS:
            self.out.append(self._steps(block))
            return
        if block.kind == md.STORY:
            self.out.append(self._story(block))
            return
        if block.align in ("center", "right"):
            inner = self._drawn(block.tokens, block.start, len(block.tokens))
            if inner:
                self.out.append(_aligned(block.align, inner))
            return
        # one part per element, which the story layout groups into scenes
        self.out.extend(part for part in self._parts_of(block.tokens, block.start, len(block.tokens)) if part)

    def _drawn(self, tokens: list[Token], start: int, end: int) -> str:
        """What tokens ``start`` to ``end`` draw, as text, rather than into the page."""
        return "".join(self._parts_of(tokens, start, end))

    def _parts_of(self, tokens: list[Token], start: int, end: int) -> list[str]:
        """What tokens ``start`` to ``end`` draw, one string per element."""
        kept, self.out = self.out, []
        try:
            self._walk(tokens, start, end)
            return self.out
        finally:
            self.out = kept

    def _walk(self, tokens: list[Token], index: int, end: int) -> None:
        while index < end:
            token = tokens[index]
            where = token.map
            if where and not self._fixed:
                self._line = self._block_line + where[0]
            elif self._fixed:
                self._line = self._block_line
            handler = getattr(self, f"_on_{token.type}", None)
            index = handler(tokens, index) if handler is not None else index + 1

    def _on_heading_open(self, tokens: list[Token], index: int) -> int:
        token = tokens[index]
        inline = tokens[index + 1]
        inner = self._inline(inline)
        if self._on_cover:
            level = int(token.tag[1])
            self.out.append(f'<h{level} class="az-cover-heading" dir="auto">{inner}</h{level}>\n')
            return index + 3
        words = " ".join(md.inline_text(inline).split())
        self.out.append(self._heading_html(words, md.heading_level(token.tag, self._shift), inner=inner))
        return index + 3

    def _on_paragraph_open(self, tokens: list[Token], index: int) -> int:
        inline = tokens[index + 1]
        figure = self._standalone(inline)
        if figure is not None:
            self.out.append(figure)
            return index + 3
        if not self._quoted and not self._on_cover:
            self._count(inline)
        words = self._inline(inline)
        if words.strip():
            self.out.append(words if tokens[index].hidden else f'<p dir="auto">{words}</p>\n')
        return index + 3

    def _on_hr(self, tokens: list[Token], index: int) -> int:
        self.out.append("<hr>\n")
        return index + 1

    def _on_fence(self, tokens: list[Token], index: int) -> int:
        token = tokens[index]
        if md.MERMAID_INFO.match(token.info or ""):
            self.out.append(self._diagram(token.content))
        else:
            self.out.append(_code(token.content))
        return index + 1

    def _on_code_block(self, tokens: list[Token], index: int) -> int:
        self.out.append(_code(tokens[index].content))
        return index + 1

    def _on_az_map(self, tokens: list[Token], index: int) -> int:
        self.out.append(self._map(tokens[index].content))
        return index + 1

    def _on_az_chart(self, tokens: list[Token], index: int) -> int:
        self.out.extend(self._chart(tokens[index].content))
        return index + 1

    def _on_az_infographic(self, tokens: list[Token], index: int) -> int:
        self.out.append(self._infographic(tokens[index].content))
        return index + 1

    def _on_az_post(self, tokens: list[Token], index: int) -> int:
        self.out.append(self._post(tokens[index].content))
        return index + 1

    def _post(self, body: str) -> str:
        """A post from X or Bluesky the case keeps, drawn as a card in the page's look
        (`engine/notes_posts.py`), its pictures inside the page, linked to its source."""
        from . import notes_posts, socialposts

        drawn = socialposts.card(self.case, body)
        if not drawn.posts:
            return _aside(socialposts.MISSING_SAID) if drawn.missing else ""
        self.posts += 1
        numbers = [self.cited.number(self.cited.reader.entity(post.id)) for post in drawn.posts]
        cite = "".join(_cite(number) for number in dict.fromkeys(numbers) if number)
        return notes_posts.html_card(drawn, lambda path, side, name: self._picture(path, side, name), cite=cite)

    def _on_html_block(self, tokens: list[Token], index: int) -> int:
        # shown as what it is, never run, and never with a comment in it
        text = _without_comments(tokens[index].content).strip()
        if text:
            self.out.append(_aside(text))
        return index + 1

    def _on_blockquote_open(self, tokens: list[Token], index: int) -> int:
        kind = md.callout_kind(tokens, index)
        callout = md.take_callout(tokens, index)
        end = md.past(tokens, index)
        self._quoted += 1
        try:
            inner = self._drawn(tokens, index + 1, end - 1)
        finally:
            self._quoted -= 1
        if callout is None:
            self.out.append(f"<blockquote>\n{inner}</blockquote>\n")
            return end
        label = f'<p class="az-callout-label">{_text(callout[0])}</p>\n'
        if kind == md.INTERNAL:
            self.out.append(f'<aside class="az-internal" data-kind="internal">\n{label}{inner}</aside>\n')
            return end
        anchor = ""
        if kind == "limits":
            # listed in the contents, under the section it closes
            ident = self._new_id("limits")
            self._limit_ids.append(ident)
            self.headings.append(_Heading(3 if self.headings else 2, ident, callout[0], ""))
            anchor = f' id="{ident}"'
        self.out.append(f'<aside class="az-callout" data-kind="{kind}"{anchor}>\n{label}{inner}</aside>\n')
        return end

    def _on_bullet_list_open(self, tokens: list[Token], index: int) -> int:
        return self._list(tokens, index, "ul")

    def _on_ordered_list_open(self, tokens: list[Token], index: int) -> int:
        return self._list(tokens, index, "ol")

    def _list(self, tokens: list[Token], index: int, tag: str) -> int:
        end = md.past(tokens, index)
        start = _start(tokens[index]) if tag == "ol" else 1
        opening = f'<{tag} start="{start}">' if start != 1 else f"<{tag}>"
        items: list[str] = []
        position = index + 1
        while position < end - 1:
            if tokens[position].type != "list_item_open":
                position += 1
                continue
            stop = md.past(tokens, position)
            where = tokens[position].map
            if where and not self._fixed:
                self._line = self._block_line + where[0]
            task = md.take_task(tokens, position)
            inner = self._drawn(tokens, position + 1, stop - 1)
            if task is None:
                items.append(f'<li dir="auto">{inner}</li>\n')
            else:
                state = "done" if task else "open"
                box = (f'<input type="checkbox" disabled{" checked" if task else ""} '
                       f'aria-label="{"Done" if task else "Open"}"> ')
                items.append(f'<li class="az-task" data-task="{state}" dir="auto">{box}{inner}</li>\n')
            position = stop
        self.out.append(f"{opening}\n{''.join(items)}</{tag}>\n")
        return end

    def _on_table_open(self, tokens: list[Token], index: int) -> int:
        """A table, with what its settings line asks of it (`engine/notes_tables.py`):
        classes for its stripes, density and a first column kept in sight, data the
        reader's script reads for its search bar, sorting and folding, each row's colour
        by a column, and its caption and source under it."""
        end = md.past(tokens, index)
        look = notes_tables.look_of(tokens[index])
        head: list[str] = []
        headers: list[str] = []
        rows: list[tuple[str, list[str], list[str]]] = []
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
                        style = md.token_attr(cell, "style")
                        aligned = re.search(r"text-align:\s*(left|center|right)", style)
                        where = f' data-align="{aligned.group(1)}"' if aligned else ""
                        scope = ' scope="col"' if in_head else ""
                        texts.append(" ".join(md.inline_text(tokens[position + 1]).split()))
                        cells.append(f'<{tag}{scope}{where} dir="auto">{self._inline(tokens[position + 1])}</{tag}>')
                        position += 3
                        continue
                    position += 1
                if in_head:
                    headers = texts
                    head.append(f"<tr>{''.join(cells)}</tr>\n")
                else:
                    first = texts[0] if texts else ""
                    row_id = ""
                    if ROW_CODE.match(first) and first not in self.ids:
                        self.ids.add(first)
                        row_id = f' id="{first}"'
                    rows.append((row_id, cells, texts))
            position += 1
        if not (head or rows):
            return end
        key: int | None = None
        colours: list[str] = []
        if look.colour:
            key, colours = notes_tables.row_colours(headers, [texts for _, _, texts in rows], look.colour,
                                                    case=self.case, look=self.look)
            if key is None:
                self._warn(notes_tables.missing_colour(look.colour), self._line, md.OTHER)
        body: list[str] = []
        for number, (row_id, cells, _) in enumerate(rows):
            colour = colours[number] if colours else ""
            if colour and key is not None and key < len(cells):
                cells = [*cells[:key], cells[key].replace("<td", '<td class="az-key"', 1), *cells[key + 1:]]
            painted = f' style="--az-c:{colour}"' if colour else ""
            body.append(f"<tr{row_id}{painted}>{''.join(cells)}</tr>\n")
        if look != notes_tables.DEFAULT:
            self.table_looks += 1
        thead = f"<thead>\n{''.join(head)}</thead>\n" if head else ""
        tbody = "".join(body)
        table = (f'<div class="az-table-wrap">\n<table class="{_table_classes(look, bool(colours))}" '
                 f'data-rows="{len(rows)}"{_table_data(look)}>\n{thead}<tbody>\n{tbody}</tbody>\n</table>\n</div>\n')
        caption = _table_caption(look)
        self.out.append(f'<div class="az-table-block">\n{table}{caption}</div>\n' if caption else table)
        return end

    # -- steps and story --------------------------------------------------------------

    def _parts(self, block: md.Block) -> tuple[str, list[tuple[Token, str]]]:
        """A block of steps cut into what comes before its first picture, then each
        picture with the words after it."""
        tokens = block.tokens
        lead: list[str] = []
        steps: list[tuple[Token, list[str]]] = []
        index = block.start
        while index < len(tokens):
            token = tokens[index]
            end = md.past(tokens, index) if token.nesting == 1 else index + 1
            where = token.map
            if where and not self._fixed:
                self._line = self._block_line + where[0]
            picture = _lone_picture(tokens, index)
            if picture is not None:
                steps.append((picture, []))
            else:
                drawn = self._drawn(tokens, index, end)
                (steps[-1][1] if steps else lead).append(drawn)
            index = end
        return "".join(lead), [(picture, "".join(words)) for picture, words in steps]

    def _steps(self, block: md.Block) -> str:
        """`::: steps`: one step per picture, its words under it, and the bar that
        moves between them. Without the script the steps stand one under another."""
        self._in_steps = True
        try:
            lead, parts = self._parts(block)
            steps: list[str] = []
            dots: list[str] = []
            for number, (picture, words) in enumerate(parts, 1):
                label = _step_label(picture, number)
                figure = self._figure(picture)
                steps.append(f'<div class="az-step" data-step="{number}" style="--az-n:{number}" '
                             f'data-label="{_attr(label)}">\n{figure}'
                             f'{_wrapped("az-step-words", words)}</div>\n')
                dots.append(f'<li><button type="button" data-step="{number}" '
                            f'aria-label="Step {number}: {_attr(label)}">{_text(label)}</button></li>')
        finally:
            self._in_steps = False
        bar = (f'<nav class="az-steps-bar" aria-label="Steps" hidden>\n'
               f'<button type="button" class="az-steps-prev" aria-label="Previous step">‹</button>\n'
               f'<ol class="az-steps-dots">{"".join(dots)}</ol>\n'
               f'<button type="button" class="az-steps-next" aria-label="Next step">›</button>\n</nav>\n')
        head = f'<div class="az-steps-lead">{lead}</div>\n' if lead else ""
        return (f'<section class="az-steps" data-steps="{len(steps)}" aria-label="Steps">\n'
                f"{head}{''.join(steps)}{bar if steps else ''}</section>\n")

    def _story(self, block: md.Block) -> str:
        """`::: story`: the pictures on one side, the words of each step on the other;
        each picture and its words share a step number (and `--az-n`, for a layout
        that reads them in order without the script)."""
        lead, parts = self._parts(block)
        figures: list[str] = []
        words: list[str] = []
        for number, (picture, said) in enumerate(parts, 1):
            zoom = md.image_zoom(md.token_attr(picture, "src"))
            extra = f' data-step="{number}" style="--az-n:{number}"'
            if zoom is not None:
                extra += f' data-zoom="{",".join(_short(value) for value in zoom)}"'
            figures.append(self._figure(picture, extra=extra))
            words.append(f'<div class="az-story-step" data-step="{number}" style="--az-n:{number}">'
                         f"{said}</div>\n")
        head = f'<div class="az-story-lead">{lead}</div>\n' if lead else ""
        return (f'<section class="az-story" data-steps="{len(parts)}">\n{head}'
                f'<div class="az-story-figures">\n{"".join(figures)}</div>\n'
                f'<div class="az-story-steps">\n{"".join(words)}</div>\n</section>\n')

    def _scenes(self, parts: list[str]) -> list[str]:
        """The story layout: each picture and the words after it, up to the next picture,
        heading, table, diagram or picture wall, made a scene, and the scenes that follow
        one another one story (`_story`'s markup), its pictures held still while their words scroll.
        Words with no picture before them, and everything else, stay as the article has
        them; a picture with no words after it stays a figure unless its neighbours have
        some."""
        out: list[str] = []
        run: list[tuple[str, list[str]]] = []

        def close() -> None:
            if any(words for _, words in run):
                out.append(self._scene_story(run))
            else:
                out.extend(figure for figure, _ in run)
            run.clear()

        for part in parts:
            kind = self._scene_kind(part)
            if kind == "picture":
                run.append((part, []))
            elif kind == "words" and run:
                run[-1][1].append(part)
            else:
                close()
                out.append(part)
        close()
        return out

    def _scene_kind(self, part: str) -> str:
        """What a part of the body is to a scene: a picture that can hold a stage,
        words that can go beside it, or anything else, which ends it."""
        clip = re.fullmatch("\x00C(\\d+)\x00\\n?", part)
        opening = self.clips[int(clip.group(1))].figure_attrs if clip else ""
        if not clip:
            if not part.startswith("<figure "):
                return "words" if SCENE_WORDS.match(part) and not part.startswith('<p class="az-mark"') else "other"
            opening = part[: part.find(">")]
        kind = re.search(r'data-kind="(\w+)"', opening)
        width = re.search(r'data-width="([^"]*)"', opening)
        aligned = re.search(r'data-align="(left|right)"', opening)
        if kind is None or kind.group(1) not in SCENE_FIGURES or aligned or (width and width.group(1) != "100%"):
            return "other"
        # a picture wall never fits a stage whole: it breaks out between the scenes, as a table does
        return "other" if 'data-chart="pictures"' in opening else "picture"

    def _scene_story(self, run: list[tuple[str, list[str]]]) -> str:
        figures: list[str] = []
        steps: list[str] = []
        for number, (figure, words) in enumerate(run, 1):
            clip = re.fullmatch("\x00C(\\d+)\x00\\n?", figure)
            if clip:
                held = self.clips[int(clip.group(1))]
                held.figure_attrs = _stepped(held.figure_attrs, number)
            else:
                end = figure.find(">")
                figure = f"<figure {_stepped(figure[len('<figure '):end], number)}{figure[end:]}"
            figures.append(figure)
            # a map's own steps are cards of its scene, each moving the map where it looks
            mapped = re.match(r'<figure [^>]*\bid="(map-\d+)"', figure)
            cards = self._map_steps.get(mapped.group(1), []) if mapped else []
            quiet = "" if words or cards else ' data-quiet="true"'
            if words or not cards:
                steps.append(f'<div class="az-story-step" data-step="{number}" style="--az-n:{number}"{quiet}>'
                             f'{"".join(words)}</div>\n')
            for position, (label, day, text, name) in enumerate(cards):
                when = (f'<p class="az-map-step-day"><time datetime="{day}">'
                        f'{_text(notes_style.long_date(date.fromisoformat(day)))}</time></p>') if day else ""
                said = f'<p class="az-map-step-label" dir="auto">{_text(label or text or name)}</p>'
                # the step's own words under its name, as its row in the card says them
                more = f'<p class="az-map-step-words" dir="auto">{_text(text)}</p>' if label and text else ""
                whose = f'<p class="az-map-step-name" dir="auto">{_text(name)}</p>' if name and (label or text) else ""
                steps.append(f'<div class="az-story-step az-map-card-step" data-step="{number}" '
                             f'data-map-step="{position}" style="--az-n:{number}">{when}{said}{more}{whose}</div>\n')
        return (f'<section class="az-story az-scenes" data-steps="{len(run)}">\n'
                f'<div class="az-story-figures">\n{"".join(figures)}</div>\n'
                f'<div class="az-story-steps">\n{"".join(steps)}</div>\n</section>\n')

    # -- inline -------------------------------------------------------------------

    def _inline(self, token: Token) -> str:
        """One inline token stream as HTML: marks, links, citations, and in prose the
        addresses, coordinates and timecodes it holds."""
        if token.type != "inline":
            return ""
        parts: list[str] = []
        links: list[tuple[str, int]] = []
        for child in token.children or []:
            kind = child.type
            if kind in ("strong_open", "strong_close", "em_open", "em_close", "s_open", "s_close"):
                tag = {"strong": "strong", "em": "em", "s": "s"}[kind.rsplit("_", 1)[0]]
                parts.append(f"<{tag}>" if kind.endswith("_open") else f"</{tag}>")
            elif kind == "link_open":
                opening, closing, number = self._link(child)
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
                parts.append("\n")
            elif kind == "hardbreak":
                parts.append("<br>\n")
            elif kind == "html_inline":
                shown = _without_comments(child.content)
                if shown:
                    parts.append(_text(shown))
            elif kind == "text":
                parts.append(_text(child.content) if links else self._prose(child.content))
        parts.extend(closing for closing, _ in reversed(links))
        return "".join(parts)

    def _link(self, token: Token) -> tuple[str, str, int]:
        """How a written link opens and closes, and the source it cites."""
        href = md.token_attr(token, "href").strip()
        number = self.cited.number(self.cited.link_source(href)) if self.cited.annex is not None else 0
        entity = md.ENTITY_HREF.match(href)
        if entity:
            if self.case is None:
                return '<span class="az-ref">', "</span>", 0
            source = self.cited.reader.entity(entity.group(1))
            if source is None:
                return '<span class="az-ref az-gone">', "</span>", 0
            if source.link:
                # a proof the analyst published opens its post, and says so on hover
                said = f' title="Open the post on {_attr(_platform(source.posted))}"' if source.posted else ""
                return f'<a class="az-ref" {_outward(source.link)}{said}>', "</a>", number
            return '<span class="az-ref">', "</span>", number
        if href.startswith("#"):
            if ANCHOR.match(href[1:]):
                return f'<a href="#{_attr(href[1:])}">', "</a>", 0
            return "<span>", "</span>", 0
        if notesources.web(href) and not md.is_local(href, ()):
            return f"<a {_outward(href)}>", "</a>", number
        scheme = urlsplit(href).scheme.lower() if ":" in href else ""
        if scheme in ("mailto", "tel"):
            return f'<a href="{_attr(href)}">', "</a>", 0
        if number:
            # a file of the case: its entry in the sources list
            return f'<a class="az-ref" href="#src-{number}">', "</a>", 0
        return '<span class="az-unlinked">', "</span>", 0

    def _prose(self, text: str) -> str:
        """Prose with each bare address linked and cited, each coordinate pair linked
        to the map, each plus code isolated and each timecode bound to its clip."""
        found: list[tuple[int, int, str, Any]] = []
        for start, end, address in md.bare_urls(text):
            found.append((start, end, "url", address))
        for match in md.COORDINATES.finditer(text):
            if abs(float(match.group(1))) <= 90 and abs(float(match.group(2))) <= 180:
                found.append((match.start(), match.end(), "coords", match))
        for match in PLUS_CODE.finditer(text):
            found.append((match.start(), match.end(), "plus", match))
        for match in TIMECODE.finditer(text):
            found.append((match.start(), match.end(), "time", match))
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
                    out.append(f"<a {_outward(value)}>{_text(written)}</a>{_cite(number) if number else ''}")
            elif kind == "coords":
                lat, lon = value.group(1), value.group(2)
                out.append(f'<a class="az-coords" {_outward(md.MAP_LINK.format(lat=lat, lon=lon))}>'
                           f"<bdi>{_text(written)}</bdi></a>")
            elif kind == "plus":
                out.append(f"<bdi>{_text(written)}</bdi>")
            elif kind == "file":
                # a file on this machine: no reader has it, and its path is the analyst's
                out.append('<span class="az-unlinked">[a local file]</span>')
            else:
                out.append(self._timecode(value))
            at = end
        out.append(_text(text[at:]))
        return "".join(out)

    def _timecode(self, match: re.Match[str]) -> str:
        start = _seconds(match.group(1))
        end = _seconds(match.group(2)) if match.group(2) else None
        if start is None:
            return _text(match.group(0))
        self.times.append(_Time(start, end, match.group(0), len(self.clips)))
        return f"\x00T{len(self.times) - 1}\x00"

    def _time_html(self, time: _Time) -> str:
        """A timecode as a link that plays its clip from there, or that opens the video
        where it is posted; as written when the page shows no video."""
        clip = None
        if self.clips:
            clip = self.clips[time.after_clips - 1] if time.after_clips else self.clips[0]
        if clip is None:
            return _text(time.words)
        if clip.embedded:
            end = f' data-end="{_short(time.end)}"' if time.end is not None else ""
            return (f'<a class="az-time" href="#{clip.id}" data-clip="{clip.id}" data-t="{_short(time.start)}"'
                    f"{end}>{_text(time.words)}</a>")
        if clip.url:
            return f'<a class="az-watch" {_outward(_at_moment(clip.url, time.start))}>Watch {_text(time.words)}</a>'
        return _text(time.words)

    def _count(self, inline: Token) -> None:
        """Note each count of a paragraph read as exact, for the check (`notes_markdown.exact_counts`)."""
        self._counts.extend((phrase, self._line) for phrase in md.exact_counts(inline))

    # -- pictures -----------------------------------------------------------------------

    def _standalone(self, inline: Token) -> str | None:
        """A paragraph that is nothing but one picture, as a figure."""
        children = [child for child in inline.children or [] if child.type != "softbreak"]
        if len(children) != 1 or children[0].type != "image":
            return None
        return self._figure(children[0])

    def _inline_picture(self, token: Token) -> str:
        """A picture inside a line of words: small, opening large like any other."""
        src = md.token_attr(token, "src")
        options = md.image_options(src)
        words = " ".join((token.content or "").split()) or "Picture"
        name = notefill.picture_name(options.source)
        if name is not None:
            return self._built_in(name, inline=True)
        found = self._find(options.source)
        if isinstance(found, str):
            return f'<span class="az-missing">[{_text(words)}]</span>'
        path, _, record = found
        source = self.cited.image_source(src)
        number = self.cited.number(source)
        attrs = (record or {}).get("attrs") or {}
        if attrs.get("kind") == "video" or media_kind(path.name) == "video":
            url = source.traced_address if source is not None else ""
            named = f"<a {_outward(url)}>[{_text(words)}]</a>" if url else f"[{_text(words)}]"
            return f'<span class="az-inline-video">{named}</span>{_cite(number) if number else ""}'
        encoded = self._picture(path, INLINE_SIDE, words)
        if encoded is None:
            return f'<span class="az-missing">[{_text(words)}]</span>'
        uri, size = encoded
        return f'{_zoom_button(_img(uri, size, words, "az-inline"), words)}{_cite(number) if number else ""}'

    def _find(self, written: str) -> "tuple[Path, str, dict[str, Any] | None] | str":
        """The case file a picture shows and its record, or the words said instead."""
        parts = urlsplit(written)
        if parts.scheme in ("http", "https"):
            self._remote += 1
            if self._remote_line is None:
                self._remote_line = self._line
            return "External image not included."
        if self.case is None:
            if (parts.scheme == "azimut" and parts.netloc == "media") or written.startswith("/files/"):
                return CASE_PICTURE
            return "Image not included."
        record: dict[str, Any] | None = None
        if parts.scheme == "azimut" and parts.netloc == "media":
            record = self.case.get_entity(unquote(parts.path.lstrip("/")))
            relative = str(((record or {}).get("attrs") or {}).get("path") or "")
            if not record or not relative:
                return MEDIA_UNAVAILABLE
        elif (prefix := next((one for one in self._prefixes if written.startswith(one)), "")):
            relative = unquote(written[len(prefix):])
        else:
            return "Image not included."
        if self.images >= MAX_IMAGES:
            return "Image not included: this note holds too many."
        path = self._case_path(relative)
        if path is None or not path.is_file():
            return MEDIA_UNAVAILABLE
        if record is None:
            found = self.cited.reader.file(relative)
            record = self.case.get_entity(found.entity_id) if found is not None and found.entity_id else None
        self.images += 1
        return path, relative, record

    def _case_path(self, relative: str) -> Path | None:
        if self.case is None:
            return None
        try:
            return self.case.resolve_inside(relative)
        except Exception:
            return None

    def _picture(self, path: Path, side: int = PICTURE_SIDE, name: str = "picture") -> tuple[str, tuple[int, int]] | None:
        """A picture of the case as a `data:` address and its size, without its metadata;
        in a folder, the address of its file there, named after ``name``."""
        made = PICTURES.get(path, PREVIEW_SIDE if self.light else side)
        if made is None:
            return None
        data, mime, size = made
        if self.folder is not None:
            return self.folder.put(data, name, FILE_SUFFIXES.get(mime, ".jpg")), size
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}", size

    def _folder_css(self, sheet: str) -> bytes:
        """The reader's stylesheet as a folder holds it: each picture it names as a
        `data:` address lifted out into a file beside it."""
        assert self.folder is not None
        folder = self.folder

        def lift(match: re.Match[str]) -> str:
            mime, packed, value = match.group(1), match.group(2), match.group(3)
            try:
                data = base64.b64decode(value, validate=True) if packed else unquote_to_bytes(value)
            except ValueError:
                return match.group(0)
            # the stylesheet sits in the same folder as the file it names
            return f'url("{folder.put(data, "icon", FILE_SUFFIXES.get(mime, ".bin")).rsplit("/", 1)[-1]}")'

        return CSS_DATA.sub(lift, sheet).encode("utf-8")

    def _figure(self, token: Token, *, extra: str = "") -> str:
        """A picture standing alone, as the figure its kind asks for."""
        src = md.token_attr(token, "src")
        options = md.image_options(src)
        title = options.caption or md.token_attr(token, "title")
        words = " ".join((token.content or "").split())
        name = notefill.picture_name(options.source)
        if name is not None:
            return self._built_in(name)
        found = self._find(options.source)
        if isinstance(found, str):
            if found == MEDIA_UNAVAILABLE:
                said = md.cut_text(words or "Untitled", 80)
                self._warn(f'Picture "{said}" is no longer in the case.', self._line, md.MISSING)
            if found == CASE_PICTURE:
                caption = self._caption(title, words)
                return (f'<figure class="az-figure" data-kind="placeholder"{extra}>{_aside(CASE_PICTURE)}'
                        f'{f"<figcaption>{caption}</figcaption>" if caption else ""}</figure>\n')
            return _aside(found)
        path, relative, record = found
        source = self.cited.image_source(src)
        number = self.cited.number(source)
        attrs = (record or {}).get("attrs") or {}
        graphic = md.image_graphic(src)
        self._street_view(source)
        layout = ""
        if options.width:
            layout += f' data-width="{options.width}" style="--az-width:{options.width}"'
        if options.aligned:
            layout += f' data-align="{options.align}"'
        if graphic:
            self.graphic = True
            layout += ' data-graphic="true"'
        classes = "az-figure az-graphic" if graphic else "az-figure"
        alt = words or title or "Picture"
        if attrs.get("kind") == "video" or media_kind(path.name) == "video":
            return self._clip(path, relative, record, source, title, words, number,
                              _one_style(f'class="{classes}"{layout}{extra}'))
        caption = self._caption(title, words)
        credit = self._credit(source, number)
        posted = _posted(source.posted) if source is not None and source.posted else ""
        chain = self._chain(source)
        kind = "proof" if (record or {}).get("type") == "proof" else "picture"
        sides = self._sides(relative, source) if kind == "picture" else None
        if sides is not None:
            kind = "pair"
        dates = self._dates(source) if kind == "proof" else ""
        figcaption = "".join(part for part in (caption, credit, posted, dates) if part)
        figcaption = f"<figcaption>{figcaption}</figcaption>\n" if figcaption else ""
        if sides is not None:
            shown = sides
        else:
            encoded = self._picture(path, name=alt)
            if encoded is None:
                said = md.cut_text(words or "Untitled", 80)
                self._warn(f'Picture "{said}" could not be read.', self._line, md.MISSING)
                return _aside(MEDIA_UNAVAILABLE)
            uri, size = encoded
            shown = _zoom_button(_img(uri, size, alt), alt)
            layout += _shape(size)
            if not graphic:
                self._may_open_on(Hero(path, _credit_words(source), alt), bool(credit))
        proof = self._proof(record, source) if kind == "proof" else ""
        anchor = self._proof_anchors.get(source.entity_id) if kind == "proof" and source is not None else None
        if anchor and anchor not in self.ids:
            self.ids.add(anchor)
            layout = f' id="{anchor}"{layout}'
        opening = _one_style(f'class="{classes}" data-kind="{kind}"{layout}{extra}')
        return f"<figure {opening}>\n{shown}\n{proof}{figcaption}{chain}</figure>\n"

    def _built_in(self, name: str, *, inline: bool = False) -> str:
        """The app's logo or the analyst's own logo or signature: no frame, no number."""
        path = self.cited.identity.picture(name)
        if path is None:
            return ""
        if path.suffix.lower() == ".svg":
            try:
                data = path.read_bytes()
            except OSError:
                return ""
            uri = (self.folder.put(data, name, ".svg") if self.folder is not None
                   else f"data:image/svg+xml;base64,{base64.b64encode(data).decode('ascii')}")
            size = notefill.AZIMUT_LOGO_SIZE
        else:
            encoded = self._picture(path, POSTER_SIDE, name)
            if encoded is None:
                return ""
            uri, size = encoded
        alt = {"logo": "Azimut", "my-logo": "Logo", "my-signature": "Signature"}.get(name, "")
        picture = _img(uri, size, alt, f"az-{name}")
        return picture if inline else f'<p class="az-mark">{picture}</p>\n'

    def _caption(self, title: str, words: str) -> str:
        label = ""
        said = title
        if self.look.numbered:
            self.figures += 1
            label = f"Figure {self.figures}"
            said = title or words
        if not label and not said:
            return ""
        lead = (f'<span class="az-fig-num">{label}.</span> ' if said else f'<span class="az-fig-num">{label}</span>') \
            if label else ""
        return f'<span class="az-caption" dir="auto">{lead}{_text(said)}</span>\n'

    def _credit(self, source: Source | None, number: int) -> str:
        """The one credit line of a figure: whose imagery and of which day, where it was
        posted, what a map or a terrain owes, each named once whatever its case, read
        from the picture or, for one made in the case, from everything it was made
        from. Past `MAX_CREDITS` of a kind the rest are counted; How this was checked
        names them all."""
        cite = f" {_cite(number)}" if number else ""
        groups = _credit_groups(source)
        if not groups:
            return f'<span class="az-credit">{cite.strip()}</span>\n' if number else ""
        said: list[str] = []
        for kind, items in groups.items():
            shown = [f"<a {_outward(link)}>{_text(words)}</a>" if link else _text(words)
                     for words, link in items[:MAX_CREDITS]]
            more = len(items) - MAX_CREDITS
            tail = f" and {more} more" if more > 0 else ""
            said.append(f'<span class="az-credit-kind">{_text(kind)}:</span> {" · ".join(shown)}{tail}')
        return f'<span class="az-credit">{"; ".join(said)}{cite}</span>\n'

    def _may_open_on(self, hero: Hero, credited: bool) -> None:
        """A picture the page could open on: the first of a cover of its own is the cover's."""
        if self._on_cover:
            if self._cover_hero is None:
                self._cover_hero = hero
            return
        self._heroes.append((hero, credited))

    @property
    def layout(self) -> str:
        return "map" if self.map_page else ("story" if self.look.web == "story" else "article")

    @property
    def picture(self) -> Path | None:
        """The picture a list of articles shows for the page: the cover's, else a map page's
        ground, else the first picture, else the ground of a map the note holds."""
        if self._cover_hero is not None:
            return self._cover_hero.path
        if self.map_page and self.ground is not None:
            return self.ground
        if self._heroes:
            return self._heroes[0][0].path
        return self.ground

    @property
    def hero(self) -> Hero | None:
        if self._cover_hero is not None:
            return self._cover_hero
        credited = next((hero for hero, said in self._heroes if said), None)
        return credited or (self._heroes[0][0] if self._heroes else None)

    def _describe(self, body: str) -> str:
        """What the page is about, for a link's card: the cover's subtitle, else the
        first paragraph of its text, citations left out."""
        said = " ".join(self.look.cover.subtitle.split())
        if not said:
            found = re.search(r'<p dir="auto">(.*?)</p>', body, re.S)
            if found is None:
                return ""
            inner = re.sub("\x00T(\\d+)\x00", lambda match: _text(self.times[int(match.group(1))].words),
                           found.group(1))
            inner = re.sub(r'<a class="az-cite"[^>]*>.*?</a>', "", inner)
            said = " ".join(html.unescape(re.sub("<[^>]*>|\x00C\\d+\x00", "", inner)).split())
        return _clipped(said, DESCRIPTION_CHARS)

    def _street_view(self, source: Source | None) -> None:
        """Say once that a site's rules keep its picture out of published work."""
        for one in source.lineage() if source is not None else ():
            words = f"{one.attribution} {one.label}".lower()
            host = one.host
            if "street view" in words or ("google." in host and ",3a," in one.address):
                self._notice(STREET_VIEW_NOTICE, self._line)
            elif host.startswith("yandex.") or ".yandex." in host:
                self._notice(YANDEX_NOTICE, self._line)

    def _chain(self, source: Source | None) -> str:
        """"How this was checked": the picture's sources back to its originals, each
        with what the case recorded of it."""
        if source is None:
            return ""
        items: list[str] = []
        for one in source.lineage():
            said: list[str] = []
            if one.address:
                said.append(f'<a class="az-original" {_outward(one.address)}>{_text(_short_address(one.address))}</a>')
            if one.archive and one.archive != one.address:
                said.append(f'<a class="az-archive" {_outward(one.archive)}>Archived copy</a>')
            if one.published:
                said.append(f'<span class="az-posted-day">Posted {_day(one.published)}</span>')
            if one.collected:
                said.append(f'<span class="az-collected">{_text(one.arrival.capitalize())} {_day(one.collected)}</span>')
            if one.at:
                said.append(f'<span class="az-frame">Frame at {_text(one.at)}</span>')
            imagery = one.imagery() if one.readings else ""
            if imagery:
                said.append(f'<span class="az-imagery">{_text(imagery)}</span>')
            if one.seen:
                said.append(f'<span class="az-seen">{_text(one.seen)}</span>')
            said.extend(f'<a class="az-verify" {_outward(address)}>Check on {_text(site)}</a>'
                        for site, address in one.verify)
            if one.sha256:
                said.append(f'<span class="az-hash">SHA-256 of the original <code>{one.sha256}</code></span>')
            if not said:
                continue
            what = f'<span class="az-chain-what">{_text(one.noun or "Item")}</span> '
            label = f'<span class="az-chain-label" dir="auto">{_text(one.label)}</span> ' if one.label else ""
            items.append(f"<li>{what}{label}{' '.join(said)}</li>")
        if not items:
            return ""
        return ('<details class="az-checked"><summary>How this was checked</summary>\n'
                f'<ol class="az-chain">{"".join(items)}</ol>\n</details>\n')

    def _dates(self, source: Source | None) -> str:
        """`Imagery: Apple, about 3 June 2025 · Footage: 24 October 2025`, the days a
        comparison or a proof rests on, read from what it was made from."""
        if source is None:
            return ""
        imagery: list[str] = []
        footage = ""
        for one in source.lineage():
            for reading in one.readings:
                day = notesources.spoken_day(reading.day)
                said = ", ".join(part for part in (reading.provider, day) if part)
                # a provider with no day is the credit's to name, not a date
                if day and said.casefold() not in (known.casefold() for known in imagery):
                    imagery.append(said)
            if not footage and one.published and one.kind != notesources.IMAGERY:
                footage = notesources.spoken_day(one.published)
        parts: list[str] = []
        if imagery:
            parts.append(f'<span class="az-date-imagery">Imagery: {_text(" and ".join(imagery))}</span>')
        if footage:
            parts.append(f'<span class="az-date-footage">Footage: {_text(footage)}</span>')
        return f'<span class="az-dates">{" · ".join(parts)}</span>\n' if parts else ""

    def _sidecar(self, relative: str) -> dict[str, Any]:
        """What the producer of a case file recorded of it (its media sidecar's source)."""
        if self.case is None or not relative:
            return {}
        try:
            found = self.case.media_items_by_paths([relative])
        except Exception:
            return {}
        item = found[0] if found and isinstance(found[0], dict) else {}
        sidecar = item.get("source")
        return sidecar if isinstance(sidecar, dict) else {}

    def _sides(self, relative: str, source: Source | None) -> str | None:
        """A comparison kept with its two sides, as the slider's two pictures; None for
        any other picture, or a comparison kept before its sides were."""
        sidecar = self._sidecar(relative)
        if sidecar.get("type") != "compare":
            return None
        sides = sidecar.get("sides")
        if not isinstance(sides, dict):
            return None
        files = [self._case_path(str(sides.get(side) or "")) if sides.get(side) else None for side in ("a", "b")]
        if any(file is None or not file.is_file() for file in files):
            return None
        encoded = [self._picture(file, name=role) for file, role in zip(files, ("before", "after")) if file is not None]
        if len(encoded) != 2 or any(one is None for one in encoded):
            return None
        days = [_side_day(sidecar, side) for side in ("a", "b")]
        # whose imagery each side is, as the sources read it: one reading per dated side
        readings = list(source.readings) if source is not None else []
        names = [reading.provider for reading in readings] if len(readings) == 2 else ["", ""]
        halves: list[str] = []
        labels: list[str] = []
        for side, role, one, day, name in zip(("a", "b"), ("before", "after"), encoded, days, names):
            assert one is not None
            uri, size = one
            said = ", ".join(part for part in (name, day) if part) or role.capitalize()
            halves.append(_img(uri, size, f"{role.capitalize()}: {said}", f"az-{role}"))
            when = f'<span class="az-side-date">{_text(day)}</span>' if day else ""
            credit = f'<span class="az-side-credit">{_text(name)}</span>' if name else ""
            labels.append(f'<span class="az-side-label" data-side="{side}">{when}{credit}</span>')
        slider = ('<input class="az-slider" type="range" min="0" max="100" value="50" step="1" '
                  'aria-label="Before and after">')
        return f'<div class="az-compare">{halves[0]}{halves[1]}{slider}{labels[0]}{labels[1]}</div>'

    def _proof(self, record: dict[str, Any] | None, source: Source | None) -> str:
        """A proof's sentence and the points it concludes on, each linked to the map."""
        spec = _proof_spec(self.case, record)
        sentence = str(spec.get("description") or "").strip()
        from . import satellite as satellite_engine

        try:
            points = [point for point in satellite_engine.spec_points(spec) if not point.get("proposed")]
        except Exception:  # a spec the app cannot read says nothing more
            points = []
        out = f'<p class="az-proof-sentence" dir="auto">{_text(sentence)}</p>\n' if sentence else ""
        items: list[str] = []
        for point in points:
            lat, lon = float(point["lat"]), float(point["lon"])
            pov = bool(point.get("pov"))
            rounded = pov and self.round_pov
            if rounded:
                lat, lon = _rounded(lat, lon)
            shown = f"{lat:.4f}, {lon:.4f}" if rounded else f"{lat:.6f}, {lon:.6f}"
            classes = "az-point az-pov" if pov else "az-point"
            label = str(point.get("label") or "").strip()
            words = f' <span class="az-point-label" dir="auto">{_text(label)}</span>' if label else ""
            note = ""
            if pov:
                note = ' <span class="az-pov-note">Where it was filmed' + (
                    f", rounded to about {POV_METRES} m" if rounded else "") + "</span>"
                named = (record or {}).get("label") or "Proof"
                self.pov.append((f"{named}: {shown}", self._line))
            href = md.MAP_LINK.format(lat=f"{lat:.6f}", lon=f"{lon:.6f}")
            items.append(f'<li><a class="{classes}" {_outward(href)}><bdi>{shown}</bdi></a>{words}{note}</li>')
        if items:
            out += f'<ul class="az-points">{"".join(items)}</ul>\n'
        return out

    def _clip(self, path: Path, relative: str, record: dict[str, Any] | None, source: Source | None, title: str,
              words: str, number: int, attrs: str) -> str:
        """A video, settled once the page knows its weight (`_settle_clips`)."""
        sidecar = self._sidecar(relative)
        cut = sidecar.get("type") == "inspect" and sidecar.get("op") == "clip"
        mime = CLIP_TYPES.get(path.suffix.lower(), "")
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        sha = str(((record or {}).get("attrs") or {}).get("sha256") or (source.sha256 if source is not None else ""))
        poster, poster_size = "", (0, 0)
        still = thumbnails.thumb_relpath(sha, "video") if sha else None
        still_path = self._case_path(still) if still else None
        if still_path is not None and still_path.is_file():
            encoded = self._picture(still_path, POSTER_SIDE, f"{words or title or 'clip'} poster")
            if encoded is not None:
                poster, poster_size = encoded
        url = source.traced_address if source is not None else ""
        caption = self._caption(title or f"Video: {words or 'untitled'}", words)
        credit = self._credit(source, number)
        chain = self._chain(source)
        figcaption = f"<figcaption>{caption}{credit}</figcaption>\n" if caption or credit else ""
        label = words or title or path.stem
        clip = _Clip(len(self.clips) + 1, path, mime, size, bool(mime) and (cut or size <= SHORT_VIDEO_BYTES),
                     poster, poster_size, url, label, self._line, self._in_steps,
                     f'{attrs} data-kind="clip"', f"{figcaption}{chain}")
        self.clips.append(clip)
        return f"\x00C{len(self.clips) - 1}\x00"

    def _clip_html(self, clip: _Clip) -> str:
        poster = f' poster="{clip.poster}"' if clip.poster else ""
        if clip.embedded:
            muted = " muted" if clip.in_steps else ""
            sized = (f' width="{clip.poster_size[0]}" height="{clip.poster_size[1]}"'
                     if clip.poster_size[0] else "")
            video = (f'<video class="az-clip" id="{clip.id}" src="{clip.data}" controls preload="metadata" '
                     f"playsinline{muted}{poster}{sized}></video>")
            return f"<figure {clip.figure_attrs}>\n{video}\n{clip.after}</figure>\n"
        still = _img(clip.poster, clip.poster_size, clip.label, "az-poster") if clip.poster else ""
        if self.light and clip.candidate:
            # the Page pane shows where the clip goes without carrying it
            video = (f'<video class="az-clip" id="{clip.id}" preload="none" controls playsinline{poster}'
                     ' data-preview="true"></video>')
            return f"<figure {clip.figure_attrs}>\n{video}\n{clip.after}</figure>\n"
        if clip.url:
            watch = (f'<a class="az-watch" {_outward(clip.url)}>{still}'
                     f'<span class="az-watch-words">Watch on {_text(_platform(clip.url))}</span></a>')
        elif still:
            watch = f'{still}<p class="az-aside">Video not included.</p>'
        else:
            watch = _aside("Video not included.")
        return f'<figure {clip.figure_attrs} data-linked="true">\n{watch}\n{clip.after}</figure>\n'

    def _diagram(self, source: str) -> str:
        key = md.diagram_key(source)
        svg = self.diagrams.get(key)
        cleaned = _clean_svg(svg, f"az-diagram-{self._svgs + 1}") if svg else None
        if cleaned is None:
            # said in a line, its source a press away: never an empty frame
            self.missing.setdefault(key, source)
            return ('<figure class="az-figure" data-kind="diagram" data-missing="true">\n'
                    '<p class="az-diagram-missing">Diagram not drawn in this file.</p>\n'
                    f"<details><summary>Its source</summary>\n{_code(source)}</details>\n</figure>\n")
        self._svgs += 1
        caption = self._caption("", "")
        paper, words = _diagram_paper(cleaned)
        figcaption = f"<figcaption{words}>{caption}</figcaption>" if caption else ""
        return (f'<figure class="az-figure" data-kind="diagram"{paper}>\n<div class="az-diagram" role="img" '
                f'aria-label="Diagram">{cleaned}</div>\n{figcaption}</figure>\n')

    # -- maps -------------------------------------------------------------------------

    def _map(self, body: str) -> str:
        """A `::: map` block as a figure: the ground with the features drawn over it,
        its legend and credits, and its data for the reader's script."""
        block = notes_maps.parse_block(body)
        self.maps += 1
        ident = f"map-{self.maps}"
        self.ids.add(ident)
        derived = notes_maps.derive(
            self.case, block, encode=self._map_picture, anchors=self._proof_anchors, round_pov=self.round_pov,
            ground_side=PREVIEW_SIDE if self.light else PICTURE_SIDE,
            card_side=min(CARD_SIDE, INLINE_SIDE) if self.light else CARD_SIDE,
        )
        for message, kind, offset in derived.warnings:
            line = self._line if self._fixed or offset is None else self._line + offset
            self._warn(message, line, kind if kind in WARNING_KINDS else md.OTHER)
        if self.public and block.imagery == "esri" and block.shown_base() == notes_maps.BASES[0]:
            # said once a map, never in the way: a page put online carries Esri's pictures
            offset = block.where.get("imagery")
            line = self._line if self._fixed or offset is None else self._line + offset
            self._warn(f'The map "{md.cut_text(block.title or "Map", 60)}": {notes_maps.ESRI_TERMS}', line, md.OTHER)
        self.pov.extend((said, self._line) for said in derived.pov)
        self.ground = self.ground or derived.ground
        self._map_steps[ident] = [(str(step.get("label") or ""), str(step.get("day") or ""), str(step.get("text") or ""),
                                   str(step.get("name") or "")) for step in derived.data.get("steps") or []]
        self._map_credits.extend(str(one) for one in derived.data.get("credits") or [] if one)
        figure = _map_figure(derived, ident, self._caption(block.title, "Map"), keyed=self.look.web == "map")
        self.mapset = self.mapset or _map_set(derived)
        self.dark_maps = self.dark_maps or derived.data.get("base") == "dark"
        streamed = urlsplit(str((derived.data.get("imagery") or {}).get("tiles") or ""))
        if streamed.scheme == "https" and streamed.netloc:
            self.streamed.add(f"https://{streamed.netloc}")
        return figure if self.folder is None else self._lift_data(figure, ident)

    # -- charts -----------------------------------------------------------------------

    def _chart(self, body: str) -> list[str]:
        """A `::: chart` block as a figure (`engine/notecharts.py`): the chart as SVG in the
        page, a title and a description for screen readers and a title on every bar, drawn
        again for a phone and, in a story, for its dark stage; captioned as every figure
        is, its numbers folded under it, or its own table after it when it says to show it.
        The SVG is the engine's own, never cleaned as a pasted diagram is: the pictures it
        holds (an analyst's icon, a flag) stay in it, as files of a web folder."""
        chart = notecharts.read(self.case, body, look=self.look, note_text=self._note_text)
        line = self._line
        for (message, kind, offset), fix in zip(chart.warnings, chart.fixes):
            at = line if self._fixed or offset is None else line + offset
            self._warn(message, at, kind if kind in WARNING_KINDS else md.OTHER)
            # the settings that fix it, which the Ready panel offers as the chart's own bar does
            self.cited.fix(message, at, fix)
        if not chart.drawable:
            return [_aside(notecharts.NO_TABLE)]
        self.charts += 1
        ident = f"chart-{self.charts}"
        self.ids.add(ident)
        if chart.layout.kind == notes_charts.PICTURE_WALL.name:
            return self._wall(chart, ident, line)
        faces = self._chart_faces(chart.layout.theme)
        drawings = [("wide", False, chart.layout), ("phone", False, chart.drawn(notecharts.PHONE_WIDTH))]
        if self.look.web == "story":
            drawings += [("wide", True, chart.drawn(dark=True)),
                         ("phone", True, chart.drawn(notecharts.PHONE_WIDTH, dark=True))]
        drawn: list[str] = []
        for width, dark, layout in drawings:
            markup = _flush_chart(notes_charts.svg(layout, ident=f"{ident}-{width}{'-dark' if dark else ''}",
                                                   transparent=True, faces=faces), layout)
            self._chart_words.append(html.unescape(re.sub(r"<[^>]*>", " ", markup)))
            drawn.append(markup.replace('class="az-chart ', f'class="az-chart az-chart-{width}'
                                                           f'{" az-chart-on-dark" if dark else ""} ', 1))
        table = chart.block.table
        shown = chart.block.shows_table() and table is not None
        numbers = "" if shown else (
            f'<details class="az-chart-numbers"><summary>{notecharts.THE_NUMBERS}</summary>\n'
            f"{notes_charts.data_table_html(chart.layout, caption=False)}</details>\n")
        caption = self._caption(chart.title, "Chart")
        figure = (f'<figure class="az-figure az-chart-figure" data-kind="chart" id="{ident}">\n'
                  f'<div class="az-chart-frame">{"".join(drawn)}</div>\n'
                  f"<figcaption>{caption}{numbers}</figcaption>\n</figure>\n")
        # the engine drew it, so it is not cleaned as a diagram is; its own pictures (an
        # icon, a flag) are files beside the page in a folder, as a map's are
        parts = [figure if self.folder is None else self._lift_data(figure, ident)]
        if shown and table is not None:
            block_line = self._block_line
            self._block_line = line + table.line
            try:
                tokens = md.parse(table.text())
                parts.extend(part for part in self._parts_of(tokens, 0, len(tokens)) if part)
            finally:
                self._block_line = block_line
        return parts

    def _wall(self, chart: notecharts.Chart, ident: str, line: int) -> list[str]:
        """A picture wall as a real grid (`engine/notes_chart_wall.py`): its legend, then each
        group's name, count and flag over its frames, which flow and wrap with the page's
        width. Each frame is its picture at the size of its slot, a press opening it larger
        in the page's lightbox with its label and its credit; its bar and its words under it.
        The numbers fold under it, as a chart's do. In a story it carries the stage's dark
        paints beside its own, for the band it breaks out in (`_scene_kind`), and with
        ``story: one group per step`` it is a story of its own (`_wall_story`)."""
        drawing = chart.layout
        groups = notes_chart_wall.wall_facts(drawing.facts)
        ratio = float(drawing.facts.get("ratio") or 1.5)
        slot = (math.ceil(WALL_SLOT * notes_charts.SVG_PIXELS), math.ceil(WALL_SLOT * notes_charts.SVG_PIXELS / ratio))
        bars = bool(drawing.facts.get("bars"))
        night = _WallNight(chart.drawn(dark=True)) if self.look.web == "story" else _WallNight(None)
        legend = ""
        if drawing.legend:
            keys = "".join(f'<span class="az-wall-key"><i class="az-wall-bar"{_bar_style(swatch.paint, night.key(at))}>'
                           f"</i>{_text(swatch.value)} <b>{_text(notes_charts.number_text(swatch.total))}</b></span>"
                           for at, swatch in enumerate(drawing.legend))
            legend = f'<p class="az-wall-legend">{keys}</p>\n'
        foot = "".join(f'<p class="az-wall-note">{_text(note)}</p>' for note in drawing.notes)
        if drawing.credit:
            foot += f'<p class="az-wall-credit">{_text(drawing.credit)}</p>'
        foot = f'<div class="az-wall-foot">{foot}</div>\n' if foot else ""
        table = chart.block.table
        shown = chart.block.shows_table() and table is not None
        numbers = "" if shown else (
            f'<details class="az-chart-numbers"><summary>{notecharts.THE_NUMBERS}</summary>\n'
            f"{notes_charts.data_table_html(drawing, caption=False)}</details>\n")
        caption = self._caption(chart.title, "Chart")
        if night.layout is not None and notes_chart_wall.story_steps(chart.block.extra.get("story", "")) \
                and sum(1 for group in groups if group.name) > 1:
            made = self._wall_story(chart, ident, groups, ratio, night, legend, caption, foot + numbers)
        else:
            parts: list[str] = []
            separated = False
            for number, group in enumerate(groups):
                if group.last and not separated and number:
                    parts.append('<div class="az-wall-rule" role="separator"></div>')
                    separated = True
                head = self._wall_head(group, f"{ident}-flag-{number}", drawing.theme, night) if group.name else ""
                items = "".join(self._wall_item(item, group, slot, bars, night.paint(number, at))
                                for at, item in enumerate(group.items))
                label = f"{group.name}: {len(group.items)}" if group.name else f"{len(group.items)} pictures"
                parts.append(f'<section class="az-wall-group" aria-label="{_attr(label)}">{head}'
                             f'<div class="az-wall-items">{items}</div></section>')
            wall = (f'<div class="az-wall" style="--az-ratio:{ratio:.4f}" role="group" '
                    f'aria-label="{_attr(chart.title or "Picture wall")}">\n'
                    f"{legend}<div class=\"az-wall-flow\">{''.join(parts)}</div>\n{foot}</div>\n")
            made = (f'<figure class="az-figure az-chart-figure az-wall-figure" data-kind="chart" data-chart="pictures" '
                    f'id="{ident}">\n{wall}<figcaption>{caption}{numbers}</figcaption>\n</figure>\n')
        out = [made if self.folder is None else self._lift_data(made, ident)]
        if shown and table is not None:
            block_line = self._block_line
            self._block_line = line + table.line
            try:
                tokens = md.parse(table.text())
                out.extend(part for part in self._parts_of(tokens, 0, len(tokens)) if part)
            finally:
                self._block_line = block_line
        return out

    def _wall_story(self, chart: notecharts.Chart, ident: str, groups: list[notes_chart_wall.Group], ratio: float,
                    night: "_WallNight", legend: str, caption: str, foot: str) -> str:
        """A wall a story steps through, one group a step (``story: one group per step``),
        in `_story`'s markup so the reader moves it as any story. Each step is a group, or a
        part of a long one (`notes_chart_wall.stage_steps`): its frames large on the dark
        stage, laid as `stage_grid` says and sized to the real stage by the style sheet, its
        name, count and flag over them; its card beside them says its count and its grades.
        Its title and legend lead it; its credit and its numbers close it."""
        drawing = chart.layout
        bars = bool(drawing.facts.get("bars"))
        order = [swatch.value for swatch in drawing.legend]
        figures: list[str] = []
        cards: list[str] = []
        for number, step in enumerate(notes_chart_wall.stage_steps(groups), 1):
            group = groups[step.group]
            shown = group.items[step.start:step.end]
            across, rows, cell = notes_chart_wall.stage_grid(len(shown), ratio)
            slot = (math.ceil(cell * notes_charts.SVG_PIXELS), math.ceil(cell * notes_charts.SVG_PIXELS / ratio))
            items = "".join(self._wall_item(item, group, slot, bars, night.paint(step.group, step.start + at))
                            for at, item in enumerate(shown))
            head = self._wall_head(group, f"{ident}-flag-{number}", drawing.theme, night)
            label = f"{group.name}: {len(group.items)}"
            figures.append(f'<figure class="az-figure az-wall-stage" data-kind="chart" data-step="{number}" '
                           f'style="--az-n:{number};--az-cols:{across};--az-rows:{rows}">'
                           f'<div class="az-wall" style="--az-ratio:{ratio:.4f}"><div class="az-wall-flow">'
                           f'<section class="az-wall-group" aria-label="{_attr(label)}">{head}'
                           f'<div class="az-wall-items">{items}</div></section></div></div></figure>\n')
            flag = notes_chart_wall.flag_svg(group.flag, drawing.theme, f"{ident}-card-{number}", group.name) \
                if group.flag else ""
            count = f'<span class="az-wall-count{" az-wall-lit" if group.lit else ""}">{len(group.items)}</span>'
            part = (f'<p class="az-wall-part">Pictures {step.start + 1}–{step.end} of {len(group.items)}</p>'
                    if step.end - step.start < len(group.items) else "")
            grades = "".join(f'<li class="az-wall-key"><i class="az-wall-bar"{_bar_style(paint)}></i>{_text(value)} '
                             f"<b>{_text(notes_charts.number_text(many))}</b></li>"
                             for value, many, paint in notes_chart_wall.tally(group.items, order))
            cards.append(f'<div class="az-story-step az-wall-card" data-step="{number}" style="--az-n:{number}">'
                         f'<p class="az-wall-head">{flag}<span class="az-wall-name" dir="auto">{_text(group.name)}</span>'
                         f"{count}</p>{part}" + (f'<ul class="az-wall-grades">{grades}</ul>' if grades else "")
                         + "</div>\n")
        title = f'<p class="az-wall-title">{caption.strip()}</p>' if caption else ""
        return (f'<section class="az-story az-wall-story" id="{ident}" data-chart="pictures" data-steps="{len(cards)}" '
                f'aria-label="{_attr(chart.title or "Picture wall")}" style="--az-ratio:{ratio:.4f}">\n'
                f'<div class="az-story-lead">{title}{legend}</div>\n'
                f'<div class="az-story-figures">\n{"".join(figures)}</div>\n'
                f'<div class="az-story-steps">\n{"".join(cards)}</div>\n'
                + (f'<div class="az-wall-end">{foot}</div>\n' if foot else "") + "</section>\n")

    def _wall_head(self, group: notes_chart_wall.Group, ident: str, theme: notes_charts.ChartTheme,
                   night: "_WallNight") -> str:
        """A group's name, its count and its flag, the flag drawn again for a dark stage in a story."""
        flag = ""
        if group.flag:
            flag = notes_chart_wall.flag_svg(group.flag, theme, ident, group.name)
            if night.layout is not None:
                flag += notes_chart_wall.flag_svg(group.flag, night.layout.theme, f"{ident}-dark", group.name).replace(
                    'class="az-wall-flag ', 'class="az-wall-flag az-wall-flag-dark ', 1)
        count = f'<span class="az-wall-count{" az-wall-lit" if group.lit else ""}">{len(group.items)}</span>'
        return f'<p class="az-wall-head">{flag}<span class="az-wall-name" dir="auto">{_text(group.name)}</span>{count}</p>'

    def _wall_item(self, item: notes_chart_wall.Item, group: notes_chart_wall.Group, slot: tuple[int, int],
                   bars: bool, dark: notes_charts.Paint | None = None) -> str:
        """One frame of a wall: its picture in its slot, opening larger, its bar and its words."""
        said = ", ".join(part for part in (item.said, group.name, item.value) if part) or "Picture"
        frame = item.frame
        picture = ""
        if frame is not None:
            data = frame.at(*slot)
            if data:
                source = self._wall_file(data, "image/jpeg", item.label or frame.label or "picture")
                large = self._wall_large(frame)
                size = (slot[0] // notes_charts.SVG_PIXELS, slot[1] // notes_charts.SVG_PIXELS)
                image = (f'<img src="{source}" alt="{_attr(said)}" width="{size[0]}" height="{size[1]}" '
                         f'loading="lazy" decoding="async">')
                opens = f' data-large="{_attr(large)}"' if large else ""
                picture = (f'<button class="az-zoom az-wall-zoom" type="button" aria-label="Open larger: {_attr(said)}"'
                           f"{opens}>{image}</button>")
        if not picture:
            picture = f'<span class="az-wall-empty" role="img" aria-label="{_attr(said)}">{notes_chart_wall.NO_PICTURE}</span>'
        # a row with no value keeps its bar's place, empty, so the words under the frames line up
        painted = _bar_style(item.paint, dark) or ' style="--bar:transparent"'
        bar = f'<i class="az-wall-bar"{painted}></i>' if bars else ""
        words = ""
        if item.label or item.words:
            label = f"<b>{_text(item.label)}</b>" if item.label else ""
            words = f'<figcaption class="az-wall-label">{label}{" " if label and item.words else ""}{_text(item.words)}</figcaption>'
        credit = ""
        if frame is not None and picture.startswith("<button"):
            owed = self._credit(self.cited.reader.entity(frame.key), 0)
            credit = owed.replace('<span class="az-credit">', '<span class="az-credit" hidden>', 1) if owed else ""
        lit = " az-wall-lit" if item.lit else ""
        return (f'<figure class="az-wall-item{lit}">{picture}{bar}{words}'
                f'<span class="az-caption" hidden>{_text(" · ".join(part for part in (item.said, group.name, item.value) if part))}</span>'
                f"{credit}</figure>")

    def _wall_file(self, data: bytes, mime: str, name: str) -> str:
        if self.folder is not None:
            return self.folder.put(data, name, FILE_SUFFIXES.get(mime, ".jpg"))
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"

    def _wall_large(self, frame: notes_charts.Frame) -> str:
        """A frame's picture as the lightbox opens it: larger, its own file's, at most
        `WALL_LARGE_SIDE` on its long side in a folder and `WALL_INLINE_SIDE` in one file;
        none in the Page pane's lighter copy."""
        path = frame.original()
        if path is None or self.light:
            return ""
        made = PICTURES.get(path, WALL_LARGE_SIDE if self.folder is not None else WALL_INLINE_SIDE)
        if made is None:
            return ""
        data, mime, _ = made
        return self._wall_file(data, mime, frame.label or "picture")

    # -- infographics -------------------------------------------------------------------

    def _infographic(self, body: str) -> str:
        """A `:::: infographic` block as a figure: its title band, its shared legend, its
        panels in the two columns the picture lays them in, and its one source line. Each
        chart is its own SVG, drawn again for a phone; the map is the page's own map, live
        in a web folder that makes maps live; the words are text. A folder also carries
        the whole page as one picture."""
        line = self._line
        page = notes_infographic.read(self.case, body, look=self.look, note_text=self._note_text, maps=False,
                                      width=notes_infographic.HTML_WIDTH)
        for message, kind, offset in page.warnings:
            self._warn(message, line if self._fixed or offset is None else line + offset,
                       kind if kind in WARNING_KINDS else md.OTHER)
        if not page.panels:
            return _aside(notes_infographic.NO_PANEL)
        self.infographics += 1
        ident = f"infographic-{self.infographics}"
        self.ids.add(ident)
        graphic = page.graphic
        band = "".join([
            f'<p class="az-ig-kicker">{_text(graphic.kicker)}</p>' if graphic.kicker else "",
            f'<p class="az-ig-title" role="heading" aria-level="2">{_text(graphic.title)}</p>' if graphic.title else "",
            f'<p class="az-ig-standfirst">{_text(graphic.standfirst)}</p>' if graphic.standfirst else "",
        ])
        legend = ""
        if page.legend:
            drawing = notes_infographic.legend_drawing(page, page.width - 2 * notes_infographic.MARGIN)
            markup = notes_charts.svg(drawing, ident=f"{ident}-legend", transparent=True,
                                      faces=self._chart_faces(page.theme))
            legend = f'<div class="az-ig-legend">{markup}</div>'
        head = f'<header class="az-ig-band">{band}{legend}</header>\n' if band or legend else ""
        rows: list[str] = []
        for number, row in enumerate(page.bands):
            if len(row.panels) == 1 and row.panels[0].column < 0:
                rows.append(f'<div class="az-ig-row">{self._ig_panel(page, row.panels[0], ident, line)}</div>\n')
                continue
            columns = ["", ""]
            for drawn in sorted(row.panels, key=lambda one: (one.column, one.y)):
                columns[max(0, drawn.column)] += self._ig_panel(page, drawn, ident, line)
            rows.append(f'<div class="az-ig-row az-ig-pair"><div class="az-ig-col">{columns[0]}</div>'
                        f'<div class="az-ig-col">{columns[1]}</div></div>\n')
        sources = ""
        if page.credits:
            head_word = "Sources." if len(page.credits) > 1 else "Source."
            sources = (f'<p class="az-ig-sources"><strong>{head_word}</strong> '
                       f"{_text(notes_infographic.sentence(page.credit))}</p>\n")
        whole = ""
        if self.folder is not None:
            drawn_page = notes_infographic.read(self.case, body, look=self.look, note_text=self._note_text, origins=False,
                                                still=True)
            picture = notes_infographic.picture(drawn_page, "page")
            address = self.folder.put(picture, graphic.title or "infographic", ".png")
            whole = (f'<p class="az-ig-whole"><a href="{_attr(address)}" download>'
                     f"The infographic as one picture</a></p>\n")
        look = page.theme.name
        figure = (f'<figure class="az-infographic" data-kind="infographic" data-ig-look="{look}" id="{ident}" '
                  f'aria-label="{_attr(page.title or "Infographic")}">\n{head}<div class="az-ig-rows">\n'
                  f'{"".join(rows)}</div>\n{sources}{whole}</figure>\n')
        return figure if self.folder is None else self._lift_data(figure, ident)

    def _ig_panel(self, page: notes_infographic.Page, drawn: notes_infographic.Drawn, ident: str, line: int) -> str:
        """One panel of an infographic: a chart's SVG, wide and for a phone, its numbers
        folded under it; the map; or the words."""
        order = f' style="--az-ig-o:{drawn.index}"'
        panel = drawn.panel
        if panel.kind == notes_infographic.CHART and drawn.chart is not None:
            faces = self._chart_faces(page.theme)
            name = f"{ident}-{drawn.index + 1}"
            drawings = [("wide", drawn.chart)]
            phone = notes_infographic.relaid(page, drawn, notecharts.PHONE_WIDTH)
            if phone is not None and drawn.w > notecharts.PHONE_WIDTH * 1.2:
                drawings.append(("phone", phone))
            marked: list[str] = []
            for width, layout in drawings:
                markup = _flush_chart(notes_charts.svg(layout, ident=f"{name}-{width}", transparent=True, faces=faces),
                                      layout)
                self._chart_words.append(html.unescape(re.sub(r"<[^>]*>", " ", markup)))
                marked.append(markup.replace('class="az-chart ', f'class="az-chart az-chart-{width} ', 1))
            if len(marked) == 1:
                # drawn at a column's width, it is the phone's drawing too
                marked[0] = marked[0].replace("az-chart-wide ", "az-chart-both ", 1)
            numbers = (f'<details class="az-chart-numbers"><summary>{notecharts.THE_NUMBERS}</summary>\n'
                       f"{notes_charts.data_table_html(drawn.chart, caption=False)}</details>\n")
            return (f'<div class="az-ig-panel" data-panel="chart"{order}><div class="az-chart-frame">{"".join(marked)}'
                    f"</div>{numbers}</div>")
        if panel.kind == notes_infographic.MAP:
            kept, self._line = self._line, line + panel.line + 1
            try:
                inner = self._map(panel.body)
            finally:
                self._line = kept
            return f'<div class="az-ig-panel" data-panel="map"{order}>{inner}</div>'
        if panel.kind == notes_infographic.WORDS:
            kept_line, self._block_line = self._block_line, line + panel.line
            try:
                words = self._ig_words(panel.body)
            finally:
                self._block_line = kept_line
            return f'<div class="az-ig-panel az-ig-words" data-panel="words"{order}>{words}</div>'
        return f'<div class="az-ig-panel"{order}>{_aside("Chart not drawn: it holds no table.")}</div>'

    def _ig_words(self, text: str) -> str:
        """A words panel: its headings as the panel's own (never in the contents), its
        paragraphs and lists as the page draws them."""
        tokens = md.parse(text)
        out: list[str] = []
        index = 0
        while index < len(tokens):
            if tokens[index].type == "heading_open":
                level = 3 if tokens[index].tag in ("h1", "h2", "h3") else 4
                out.append(f'<p class="az-ig-head" role="heading" aria-level="{level}" dir="auto">'
                           f"{self._inline(tokens[index + 1])}</p>\n")
                index += 3
                continue
            end = index
            while end < len(tokens) and not (tokens[end].type == "heading_open" and tokens[end].level == 0):
                end += 1
            out.extend(part for part in self._parts_of(tokens, index, end) if part)
            index = end
        return "".join(out)

    def _chart_faces(self, theme: notes_charts.ChartTheme) -> dict[str, str]:
        """The page's own faces a chart's words are set in, where they are the ones it was
        measured in; none for a look that sets the reader's own fonts."""
        if self.look.style == "plain" and not self.look.font:
            return {}
        page = {self.theme.body_family: "az-body", self.theme.heading_family: "az-head"}
        return {role: page[face.family] for role, face in (("head", theme.head), ("body", theme.body))
                if face.family in page}

    def _map_picture(self, path: Path, side: int) -> tuple[str, tuple[int, int]] | None:
        made = PICTURES.get(path, min(side, PREVIEW_SIDE) if self.light else side)
        if made is None:
            return None
        data, mime, size = made
        if self.folder is not None:
            return self.folder.put(data, path.stem, FILE_SUFFIXES.get(mime, ".jpg")), size
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}", size

    def _lift_data(self, html: str, name: str) -> str:
        """A map's or a chart's own pictures (its marks' pictograms, an icon) as files beside
        the page, which a folder's policy lets in from the folder only."""
        assert self.folder is not None
        folder = self.folder

        def lift(match: re.Match[str]) -> str:
            try:
                data = base64.b64decode(match.group(3), validate=True)
            except ValueError:
                return match.group(0)
            return f'{match.group(1)}="{folder.put(data, name, FILE_SUFFIXES.get(match.group(2), ".bin"))}"'

        return DATA_ATTRIBUTE.sub(lift, html)

    # -- the end of the page ------------------------------------------------------------

    def _sources(self) -> str:
        annex = self.cited.annex
        if annex is None or not annex.entries:
            return ""
        style = self.cited.profile.sources_style
        entries = "".join(self._source_entry(entry) if style == "short" else self._styled_entry(entry, style)
                          for entry in annex.entries)
        return (f'<section class="az-sources" id="sources" aria-labelledby="sources-title">\n'
                f'<h2 id="sources-title">{_text(self.cited.list_title)}</h2>\n<ol>\n{entries}</ol>\n</section>\n')

    def _styled_entry(self, entry: Entry, style: str) -> str:
        """One source as ``style`` writes it (`notesources.entry`), a capture's check pages
        and a file's fingerprint under it as in the short form."""
        source = entry.source
        said: list[str] = []
        for part in notesources.entry(source, style, entry.origins):
            if part.kind == "cite":
                said.append(_cite(part.number))
            elif part.kind == "address":
                said.append(f'<a class="az-source-address" {_outward(part.link)}>{_text(part.text)}</a>')
            elif part.kind == "outlet":
                said.append(f"<cite>{_text(part.text)}</cite>")
            elif part.kind == "link" and part.text == "Archived copy":
                said.append(f'<a class="az-archive" {_outward(part.link)}>{_text(part.text)}</a>')
            elif part.link and part.kind in ("title", "link"):
                said.append(f'<a class="az-source-title" {_outward(part.link)}>{_quoted(part.text)}</a>')
            elif part.kind == "title":
                said.append(f'<span class="az-source-title">{_quoted(part.text)}</span>')
            else:
                said.append(_text(part.text))
        links = [f'<a class="az-verify" {_outward(address)}>Check on {_text(site)}</a>' for site, address in source.verify]
        if style == "web" and source.posted and source.posted not in (source.address, source.archive):
            links.append(_posted(source.posted))
        if source.sha256:
            links.append(f'<span class="az-hash">SHA-256 <code>{source.sha256}</code></span>')
        more = f'<span class="az-source-links">{" ".join(links)}</span>' if links else ""
        return (f'<li id="src-{entry.number}" class="az-ref" data-style="{style}" data-kind="{_attr(source.kind or "item")}">'
                f'{"".join(said)}{more}</li>\n')

    # -- the annexes ----------------------------------------------------------------

    def _annexes(self, changes: str, earlier: list[dict[str, Any]]) -> tuple[str, list[tuple[str, str]]]:
        """What the style adds after the sources (`engine/noteannexes.py`), each a section
        of its own, and the contents' line for each as (id, title). The Editions annex
        keeps the corrections' place and id, so a link to them still lands."""
        profile = self.cited.profile
        if not any(profile.annex(key) for key in noteannexes.ANNEXES):
            return "", []
        faces = () if self.look.style == "plain" and not self.look.font else noteannexes.face_names(
            self.theme.body_family, self.theme.heading_family)
        annexes = noteannexes.build(self.case, self.cited, profile, day=self.day, public=self.public, faces=faces,
                                    earlier=earlier, changes=changes, made_as="web" if self.folder is not None else "html",
                                    round_pov=self.round_pov)
        if profile.credits:
            for credit in self._map_credits:
                kind, _, words = credit.partition(": ")
                noteannexes.add_map_credit(annexes, words or kind)
        out: list[str] = []
        listed: list[tuple[str, str]] = []
        for key in annexes.present():
            name = noteannexes.HEADINGS[key]
            ident = "corrections" if key == "editions" else self._new_id(f"az-{key}")
            inner = getattr(self, f"_annex_{key}")(annexes)
            classes = "az-annex az-corrections" if key == "editions" else "az-annex"
            out.append(f'<section class="{classes}" id="{ident}" data-annex="{key}" aria-labelledby="{ident}-title">\n'
                       f'<h2 id="{ident}-title">{_text(name)}</h2>\n{inner}</section>\n')
            listed.append((ident, name))
        return "".join(out), listed

    def _annex_geolocations(self, annexes: noteannexes.Annexes) -> str:
        """A row per proof: its number opens its entry in the sources, its name the post
        the analyst published of it."""
        rows: list[str] = []
        for place in annexes.geolocations:
            number = f"{_cite(place.number)} " if place.number else ""
            proof = (f'<a {_outward(place.posted)} title="Open the post on {_attr(_platform(place.posted))}">'
                     f"{_text(place.proof)}</a>" if place.posted else _text(place.proof))
            coords = f'<a class="az-coords" {_outward(place.link)}><bdi>{place.coords}</bdi></a>' if place.coords else ""
            rows.append(f'<tr><td dir="auto">{number}{proof}</td><td dir="auto">{_text(place.where)}</td>'
                        f"<td>{_text(place.day)}</td><td>{coords}</td></tr>")
        return ('<div class="az-table-wrap"><table class="az-annex-table">\n<thead><tr><th scope="col">Proof</th>'
                '<th scope="col">Place</th><th scope="col">Day</th><th scope="col">Coordinates</th></tr></thead>\n'
                f'<tbody>{"".join(rows)}</tbody>\n</table></div>\n')

    def _annex_credits(self, annexes: noteannexes.Annexes) -> str:
        said = "".join(f'<dt>{_text(kind)}</dt><dd dir="auto">{_text(words)}</dd>' for kind, words in annexes.credits)
        return f'<dl class="az-credits">{said}</dl>\n'

    def _annex_method(self, annexes: noteannexes.Annexes) -> str:
        return f'<ul class="az-facts">{"".join(f"<li>{_text(fact)}</li>" for fact in annexes.method)}</ul>\n'

    def _annex_limits(self, annexes: noteannexes.Annexes) -> str:
        items: list[str] = []
        for limit in annexes.limits:
            back = ""
            if limit.index < len(self._limit_ids):
                back = f' <a class="az-back-to" href="#{self._limit_ids[limit.index]}">In the text</a>'
            items.append(f'<li dir="auto">{_text(limit.text)}{back}</li>')
        return f'<ol class="az-limits">{"".join(items)}</ol>\n'

    def _annex_editions(self, annexes: noteannexes.Annexes) -> str:
        rows: list[str] = []
        for one in annexes.editions:
            lead = "This edition" if one.current else _text(one.day)
            when = f'<time datetime="{_attr(one.stamp)}">{lead}</time>'
            fingerprint = (f' <span class="az-hash">SHA-256 <code>{_attr(one.sha256)}</code></span>'
                           if one.sha256 else "")
            mark = ' class="az-this-edition"' if one.current else ""
            rows.append(f"<li{mark}>{when} <span>{_text(one.said)}</span>{fingerprint}</li>")
        return f'<ol>{"".join(rows)}</ol>\n'

    def _source_entry(self, entry: Entry) -> str:
        source = entry.source
        label = f'<span class="az-source-label" dir="auto">{_text(source.label or source.host or "Untitled")}</span>'
        said = notesources.details(source)
        details = f' <span class="az-source-details">{_text(" · ".join(said))}</span>' if said else ""
        origins = ""
        if entry.origins:
            linked = ", ".join(_cite(number) for number in entry.origins)
            origins = f' <span class="az-source-from">from {linked}</span>'
        links: list[str] = []
        if source.address:
            links.append(f'<a class="az-source-address" {_outward(source.address)}>{_text(source.address)}</a>')
        if source.archive and source.archive != source.address:
            links.append(f'<a class="az-archive" {_outward(source.archive)}>Archived copy</a>')
        if source.posted and source.posted not in (source.address, source.archive):
            links.append(_posted(source.posted))
        links.extend(f'<a class="az-verify" {_outward(address)}>Check on {_text(site)}</a>'
                     for site, address in source.verify)
        if source.sha256:
            links.append(f'<span class="az-hash">SHA-256 <code>{source.sha256}</code></span>')
        more = f'<span class="az-source-links">{" ".join(links)}</span>' if links else ""
        return f'<li id="src-{entry.number}" data-kind="{_attr(source.kind or "item")}">{label}{details}{origins}{more}</li>\n'

    def _corrections(self, changes: str, earlier: Iterable[dict[str, Any]]) -> str:
        """What this edition changed, and the public editions before it that said what
        they changed. An edition with no such line is the same text made again: it stays
        in the note's record of editions and is never shown to a reader as a correction."""
        said = " ".join(changes.split())[:300]
        before = [record for record in earlier if record.get("edition") == md.PUBLIC
                  and isinstance(record.get("changes"), str) and record["changes"].strip()]
        if not said and not before:
            return ""
        rows: list[str] = []
        if said:
            rows.append(f'<li class="az-this-edition"><time datetime="{self.day.isoformat()}">'
                        f"{_text(notes_style.long_date(self.day))}</time> <span>{_text(said)}</span></li>")
        for record in before:
            stamp = str(record.get("at") or "")
            try:
                when = notes_style.long_date(date.fromisoformat(stamp[:10]))
            except ValueError:
                continue
            fingerprint = str(record.get("sha256") or record.get("pdf_sha256") or "")
            what = {"html": "HTML", "web": "Web page", "github": "Web page"}.get(str(record.get("format")), "PDF")
            words = f" <span>{_text(' '.join(str(record['changes']).split())[:300])}</span>"
            rows.append(f'<li><time datetime="{stamp[:10]}">{_text(when)}</time> {what}{words} '
                        f'<span class="az-hash">SHA-256 <code>{_attr(fingerprint)}</code></span></li>')
        return (f'<section class="az-corrections" id="corrections" aria-labelledby="corrections-title">\n'
                f'<h2 id="corrections-title">Corrections</h2>\n<ol>{"".join(rows)}</ol>\n</section>\n')

    def _footer(self, printed: str) -> str:
        """The page's own footer: its edition, its day, its fingerprint and Made with Azimut. On a
        site's article page, the site's own footer follows it (`site.with_footer`)."""
        edition = "Public edition" if self.public else "Internal edition"
        made = ""
        if self.cited.identity.credit:
            made = (f'\n<p class="az-made"><a href="{notefill.AZIMUT_SITE}" target="_blank" rel="noopener noreferrer">'
                    f"{_text(notefill.MADE_WITH)}</a></p>")
        return (f'<footer class="az-footer">\n<p><span class="az-edition">{edition}</span> · '
                f'<time datetime="{self.day.isoformat()}">{_text(notes_style.long_date(self.day))}</time> · '
                f'<span class="az-fingerprint">Source SHA-256 <code>{printed}</code></span></p>{made}\n</footer>\n')


# -- a chart's drawing ----------------------------------------------------------------


def _flush_chart(markup: str, chart: notes_charts.Layout) -> str:
    """A chart's SVG without the paper's margin around it, so its words stand on the
    text's own edges; what reaches into the margin still shows (`overflow: visible`)."""
    pad = chart.theme.pad
    width, height = chart.width, chart.height
    n = notes_charts._n
    drawn = f'viewBox="0 0 {n(width)} {n(height)}" width="{n(width)}" height="{n(height)}"'
    flush = (f'viewBox="{n(pad)} {n(pad)} {n(width - 2 * pad)} {n(height - 2 * pad)}" '
             f'width="{n(width - 2 * pad)}" height="{n(height - 2 * pad)}"')
    return markup.replace(drawn, flush, 1)


# -- a map's figure ------------------------------------------------------------------


def _map_set(derived: notes_maps.Derived) -> bool:
    """Whether a map is shown otherwise than by default: its size, its legend, its base, a
    north arrow, its scale, or a frame other than its ground's."""
    data = derived.data
    ground = data.get("ground") or {}
    framed = bool(ground) and list(ground.get("bounds") or []) != list(data.get("bounds") or [])
    return bool(derived.display) or framed or any(key in data for key in ("base", "north", "scale"))


def _placed(project: notes_maps._Projector, bounds: list[float], width: float, height: float) -> str:
    """Where a picture covering ``bounds`` stands on a map's stage, in its own shares."""
    west, south, east, north = bounds
    left, top = project(west, north)
    right, bottom = project(east, south)
    return (f"left:{left / width * 100:.4f}%;top:{top / height * 100:.4f}%;"
            f"width:{(right - left) / width * 100:.4f}%;height:{(bottom - top) / height * 100:.4f}%")


def widen_policy(policy: str, extra: Mapping[str, Iterable[str]]) -> str:
    """A page's policy with more sources for some directives, a directive it lacks added with
    them alone (so `default-src 'none'` still holds for the rest)."""
    directives: dict[str, list[str]] = {}
    for part in policy.split(";"):
        words = part.split()
        if words:
            directives.setdefault(words[0], []).extend(words[1:])
    for name, sources in extra.items():
        kept = directives.setdefault(name, [])
        if kept == ["'none'"]:
            kept.clear()
        kept.extend(source for source in sources if source not in kept)
    return "; ".join(f"{name} {' '.join(sources)}" for name, sources in directives.items())


def _map_figure(derived: notes_maps.Derived, ident: str, caption: str, *, keyed: bool = False) -> str:
    """The figure a map stands in. Its stage holds the ground and the drawing, which read
    whole with no script and in print; its data rides along unread for the reader's
    script (the ground's address named by the picture's id, so the file holds it once).
    How it is shown (`size`, `legend`, `base`, `north`) sets its classes and adds what it
    draws, and a map that sets nothing is written as it always was."""
    data = derived.data
    ground = data.get("ground")
    width, height = notes_maps.frame_of(data["bounds"])
    ratio = f"--r:{width / height:.4f}"
    picture = ""
    project = notes_maps._Projector(data["bounds"])
    if ground and ground.get("src"):
        size = ground.get("size") or [0, 0]
        # a map framed on another part of the world than its ground lays the ground where it stands
        place = ("" if list(ground.get("bounds") or []) == list(data["bounds"])
                 else f' style="{_placed(project, ground["bounds"], width, height)}"')
        picture = (f'<img class="az-map-ground" id="{ident}-ground" src="{ground["src"]}" alt=""{place} '
                   f'width="{size[0]}" height="{size[1]}" decoding="async">')
    # the sharper pictures of the parts its steps look closer at, each laid where it stands
    for number, detail in enumerate(data.get("details") or []):
        place = _placed(project, detail["bounds"], width, height)
        size = detail.get("size") or [0, 0]
        picture += (f'<img class="az-map-detail" id="{ident}-detail-{number}" src="{detail["src"]}" alt="" '
                    f'width="{size[0]}" height="{size[1]}" style="{place}" decoding="async">')
    if picture:
        picture = f'<div class="az-map-world">{picture}</div>'
    drawing = notes_maps.svg(derived, ident=ident)
    title = data.get("title") or "Map"
    count = len(data.get("features") or [])
    base = f' data-base="{_attr(str(data["base"]))}"' if data.get("base") else ""
    north = ('<span class="az-map-north" role="img" aria-label="North is up"><svg viewBox="0 0 24 30" '
             'aria-hidden="true"><path d="M12 2 18 19 12 15.5 6 19Z"/><text x="12" y="29">N</text></svg></span>'
             if data.get("north") else "")
    stage = (f'<div class="az-map-frame"><div class="az-map-stage" role="group" aria-roledescription="map"{base} '
             f'aria-label="{_attr(f"Map: {title}. {count} feature" + ("s" if count != 1 else ""))}">'
             f'{picture}{drawing}{north}</div></div>\n')
    carried = json.loads(json.dumps(data))
    if carried.get("ground"):
        carried["ground"]["src"] = f"#{ident}-ground"
    for number, detail in enumerate(carried.get("details") or []):
        detail["src"] = f"#{ident}-detail-{number}"
    script = json.dumps(carried, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    days = data.get("days") or []
    shown = ""
    if len(days) > 1 and data.get("day"):
        spoken = notes_style.long_date(date.fromisoformat(data["day"]))
        shown = (f'<p class="az-map-day">As on <time datetime="{data["day"]}">{_text(spoken)}</time>, '
                 f'one of {len(days)} days</p>\n')
    shown_legend = derived.display.get("legend", "shown")
    legend = "" if shown_legend == "hidden" else _map_legend(derived.legend, ident, keyed=keyed)
    if legend and shown_legend == "folded":
        legend = f'<details class="az-map-key"><summary>Legend</summary>\n{legend}</details>\n'
    credits = _map_credits(data.get("credits") or [])
    words = "".join(part for part in (caption, credits) if part)
    figcaption = f"<figcaption>{words}</figcaption>\n" if words else ""
    steps = len(data.get("steps") or [])
    size = derived.display.get("size", "wide")
    sized = f" az-size-{size}" if size != "wide" else ""
    return (f'<figure class="az-figure az-map{sized}" data-kind="map" id="{ident}" data-steps="{steps}" '
            f'data-days="{len(days)}" style="{ratio}">\n{stage}{shown}{legend}{figcaption}'
            f'<script type="application/json" class="az-map-data">{script}</script>\n</figure>\n')


def _map_legend(rows: list[dict[str, Any]], ident: str, *, keyed: bool = False) -> str:
    """What each colour and pictogram stands for, a layer's groups under its name. ``keyed``, on a
    map page, each row says the group and kind of feature it stands for, which its switcher reads."""
    if not rows:
        return ""
    layers = list(dict.fromkeys(str(row.get("layer") or "") for row in rows))
    items: list[str] = []
    for layer in layers:
        if len(layers) > 1:
            items.append(f'<li class="az-key-layer" dir="auto">{_text(layer)}</li>')
        for row in rows:
            if str(row.get("layer") or "") != layer:
                continue
            style = row.get("style") or {}
            colour = _attr(str(style.get("color") or "#0072b2"))
            if row.get("kind") == "point":
                key = ("proof-pov" if style.get("pov") else "proof") if style.get("proof") else str(style.get("icon") or "")
                swatch = (f'<svg class="az-key-mark" viewBox="0 0 64 64" aria-hidden="true">'
                          f'<use href="#{ident}-mk-{_attr(key)}"/></svg>')
            elif row.get("kind") == "line":
                dash = ' stroke-dasharray="5 4"' if style.get("dash") == "dashed" else (
                    ' stroke-dasharray="1 3"' if style.get("dash") == "dotted" else "")
                swatch = (f'<svg class="az-key-mark" viewBox="0 0 28 14" aria-hidden="true"><path d="M2 7H26" '
                          f'stroke="rgba(0,0,0,.28)" stroke-width="5" stroke-linecap="round"/><path d="M2 7H26" '
                          f'stroke="{colour}" stroke-width="3" stroke-linecap="round"{dash}/></svg>')
            else:
                swatch = (f'<svg class="az-key-mark" viewBox="0 0 28 18" aria-hidden="true"><rect x="2" y="2" '
                          f'width="24" height="14" rx="2" fill="{colour}" fill-opacity=".28" stroke="{colour}" '
                          f'stroke-width="2"/></svg>')
            count = int(row.get("count") or 0)
            key = (f' data-kind="{_attr(str(row.get("kind") or ""))}" '
                   f'data-key="{_attr(str(row.get("group", row.get("label")) or ""))}"' if keyed else "")
            items.append(f'<li data-layer="{_attr(layer)}" data-group="{_attr(str(row.get("label") or ""))}"{key}>'
                         f'{swatch}<span class="az-key-name" dir="auto">{_text(str(row.get("label") or layer))}</span>'
                         f'<span class="az-key-count">{count}</span></li>')
    return f'<ul class="az-map-legend" aria-label="Legend">{"".join(items)}</ul>\n'


def _map_credits(credits: list[str]) -> str:
    said: list[str] = []
    for credit in credits:
        kind, colon, words = credit.partition(": ")
        if colon and kind and len(kind) <= 12:
            said.append(f'<span class="az-credit-kind">{_text(kind)}:</span> {_text(words)}')
        else:
            said.append(_text(credit))
    return f'<span class="az-credit">{"; ".join(said)}</span>\n' if said else ""


# -- pictures, encoded once ------------------------------------------------------------


class _Pictures:
    """Pictures as the page holds them, kept between documents.

    The check before an export encodes every picture at its export size to say what
    the file weighs; the export that follows finds them here rather than encode them
    again. Light on the machine: a few hundred entries and 128 MB at most, keyed by
    the file's path, size and modification time.
    """

    MAX_ENTRIES = 400
    MAX_BYTES = 128 * 1024 * 1024

    def __init__(self) -> None:
        self._kept: OrderedDict[tuple[str, int, int, int], tuple[bytes, str, tuple[int, int]] | None] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    def get(self, path: Path, side: int) -> tuple[bytes, str, tuple[int, int]] | None:
        try:
            stat = path.stat()
        except OSError:
            return None
        key = (str(path), stat.st_mtime_ns, stat.st_size, side)
        with self._lock:
            if key in self._kept:
                self._kept.move_to_end(key)
                return self._kept[key]
        made = _encode_picture(path, side)
        with self._lock:
            if key not in self._kept:
                self._kept[key] = made
                self._bytes += len(made[0]) if made else 0
            while len(self._kept) > self.MAX_ENTRIES or self._bytes > self.MAX_BYTES:
                dropped = self._kept.popitem(last=False)[1]
                self._bytes -= len(dropped[0]) if dropped else 0
        return made


def _encode_picture(path: Path, side: int) -> tuple[bytes, str, tuple[int, int]] | None:
    """A picture at most ``side`` pixels on its long side, upright, without its EXIF,
    GPS, XMP or text: a JPEG, or a PNG when it shows through somewhere. A JPEG already
    small and upright keeps its pixels as they are, its metadata segments taken out."""
    try:
        with PILImage.open(path) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                return None
            if image.format == "GIF" and getattr(image, "n_frames", 1) > 1:
                moving = _animated_gif(image, path, side)
                if moving is not None:
                    return moving
            if image.format == "JPEG" and max(image.size) <= side and _orientation(image) in (0, 1):
                stripped = _strip_jpeg(path.read_bytes())
                if stripped is not None:
                    return stripped, "image/jpeg", image.size
            if image.format == "JPEG":
                image.draft(image.mode, (side, side))
            profile = image.info.get("icc_profile")
            upright = ImageOps.exif_transpose(image)
            clear = _shows_through(upright)
            upright = upright.convert("RGBA" if clear else ("L" if upright.mode in ("L", "LA", "1") else "RGB"))
            upright.thumbnail((side, side), PILImage.Resampling.LANCZOS, reducing_gap=3.0)
            upright.info = {}
            buffer = BytesIO()
            extra = {"icc_profile": profile} if profile else {}
            if clear:
                upright.save(buffer, "PNG", optimize=True, **extra)
                return buffer.getvalue(), "image/png", upright.size
            upright.save(buffer, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True, **extra)
            return buffer.getvalue(), "image/jpeg", upright.size
    except (OSError, ValueError, UnidentifiedImageError, PILImage.DecompressionBombError):
        return None


def _animated_gif(image: PILImage.Image, path: Path, side: int) -> tuple[bytes, str, tuple[int, int]] | None:
    """A GIF that moves (a comparison's blink or slide) kept moving, its comment left
    behind; None when it is too large to carry, which leaves its first frame."""
    try:
        if path.stat().st_size > MAX_GIF_BYTES or max(image.size) > side:
            return None
    except OSError:
        return None
    frames: list[PILImage.Image] = []
    durations: list[int] = []
    for frame in ImageSequence.Iterator(image):
        durations.append(int(frame.info.get("duration") or 100))
        copy = frame.copy()
        copy.info = {}
        frames.append(copy)
    buffer = BytesIO()
    frames[0].save(buffer, "GIF", save_all=True, append_images=frames[1:], duration=durations,
                   loop=int(image.info.get("loop") or 0), disposal=2)
    return buffer.getvalue(), "image/gif", image.size


PICTURES = _Pictures()


def _clip_bytes(path: Path) -> bytes | None:
    """A clip copied without its container's metadata (title, GPS, the phone that
    filmed it), streams untouched; None without ffmpeg or when the copy fails."""
    exe = ffmpeg_engine.ffmpeg_path()
    if exe is None:
        return None
    with tempfile.TemporaryDirectory(prefix="azimut-clip-") as folder:
        target = Path(folder) / f"clip{path.suffix.lower()}"
        command = [exe, "-nostdin", "-v", "error", "-i", str(path), "-map", "0", "-map_metadata", "-1",
                   "-map_chapters", "-1", "-c", "copy", "-fflags", "+bitexact", "-y", str(target)]
        if path.suffix.lower() in (".mp4", ".m4v"):
            command[-2:-2] = ["-movflags", "+faststart"]
        try:
            subprocess.run(command, check=True, capture_output=True, timeout=CLIP_TIMEOUT)
            return target.read_bytes()
        except (OSError, subprocess.SubprocessError):
            return None


# -- fonts ----------------------------------------------------------------------------

#: The faces each family the look can set its text in is drawn from, by weight and style.
FAMILY_FILES: dict[str, dict[tuple[int, str], str]] = {
    pdffonts.SERIF: {(400, "normal"): "NotoSerif-Regular.ttf", (700, "normal"): "NotoSerif-Bold.ttf",
                     (400, "italic"): "NotoSerif-Italic.ttf", (700, "italic"): "NotoSerif-BoldItalic.ttf"},
    pdffonts.SANS: {(400, "normal"): "NotoSans-Regular.ttf", (700, "normal"): "NotoSans-Bold.ttf",
                    (400, "italic"): "NotoSans-Italic.ttf", (700, "italic"): "NotoSans-BoldItalic.ttf"},
    pdffonts.BOOK: {(400, "normal"): "Literata-Regular.ttf", (700, "normal"): "Literata-Bold.ttf",
                    (400, "italic"): "Literata-Italic.ttf", (700, "italic"): "Literata-BoldItalic.ttf"},
    pdffonts.MODERN: {(400, "normal"): "IBMPlexSans-Regular.ttf", (700, "normal"): "IBMPlexSans-Bold.ttf",
                      (400, "italic"): "IBMPlexSans-Italic.ttf", (700, "italic"): "IBMPlexSans-BoldItalic.ttf"},
}
#: What the reader's own controls, labels and punctuation draw, kept in every subset:
#: printable ASCII, Latin-1 and the marks the stylesheet and the script write.
ALWAYS_DRAWN = (
    "".join(chr(code) for code in range(0x20, 0x7F))
    + "".join(chr(code) for code in range(0xA0, 0x100))
    + "‘’“”–—…·•→←↑↓↕‹›×▶↗↩✓°±≈"
)
_FONTS: OrderedDict[tuple[str, str], bytes] = OrderedDict()
_FONTS_LOCK = threading.Lock()
MAX_KEPT_FONTS = 24


def _font_faces(look: NoteLook, theme: notes_style.Theme, text: str, folder: Folder | None = None) -> str:
    """The `@font-face` rules for the look's typeface, each face cut to the characters
    the page draws and packed as WOFF. None for a plain look with no face chosen, which
    reads in the reader's own fonts. In a ``folder`` each face is a file of its own."""
    if look.style == "plain" and not look.font:
        return ""
    codes = _subset_codes(text)
    rules: list[str] = []
    for name, family, faces in (("az-body", theme.body_family, ((400, "normal"), (700, "normal"),
                                                                 (400, "italic"), (700, "italic"))),
                                ("az-head", theme.heading_family, ((400, "normal"), (700, "normal")))):
        files = FAMILY_FILES.get(family)
        if not files:
            continue
        for weight, style in faces:
            woff = _subset(files[(weight, style)], codes)
            if woff is None:
                continue
            if folder is not None:
                address = folder.put(woff, f"{name}-{weight}-{style}", ".woff")
            else:
                address = f"data:font/woff;base64,{base64.b64encode(woff).decode('ascii')}"
            rules.append(f'@font-face{{font-family:"{name}";src:url({address}) format("woff");font-weight:{weight};'
                         f"font-style:{style};font-display:swap}}")
    return "\n".join(rules)


def _subset_codes(text: str) -> list[int]:
    """The characters a page's faces must carry: what the page says, every letter of it
    in both cases (the stylesheet sets labels in capitals, `ß` and all), what the
    reader's stylesheet and script write themselves, read off the two files, and
    `ALWAYS_DRAWN`."""
    drawn = set(text) | set(ALWAYS_DRAWN) | set(_asset("reader.css")) | set(_asset("reader.js"))
    drawn |= {variant for char in list(drawn) for case in (char.upper(), char.lower()) for variant in case}
    return sorted({ord(char) for char in drawn if unicodedata.category(char) not in ("Cc", "Cs", "Co", "Cn")})


def _subset(filename: str, codes: list[int]) -> bytes | None:
    from fontTools import subset
    from fontTools.ttLib import TTFont

    digest = hashlib.sha256(",".join(map(str, codes)).encode("ascii")).hexdigest()
    key = (filename, digest)
    with _FONTS_LOCK:
        if key in _FONTS:
            _FONTS.move_to_end(key)
            return _FONTS[key]
    options = subset.Options()
    options.flavor = "woff"
    options.layout_features = ["*"]
    options.hinting = False
    options.desubroutinize = True
    options.notdef_outline = True
    try:
        font = TTFont(str(pdffonts.FONT_DIR / filename))
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=codes)
        subsetter.subset(font)
        font.flavor = "woff"
        buffer = BytesIO()
        font.save(buffer)
    except Exception:  # a face that cannot be cut leaves the reader's own font
        return None
    data = buffer.getvalue()
    with _FONTS_LOCK:
        _FONTS[key] = data
        while len(_FONTS) > MAX_KEPT_FONTS:
            _FONTS.popitem(last=False)
    return data


# -- diagrams -----------------------------------------------------------------------

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
#: The SVG a diagram may hold: shapes, text, markers, gradients and its own style.
SVG_TAGS = frozenset("""
svg g path rect circle ellipse line polyline polygon text tspan textPath defs marker style title desc clipPath
linearGradient radialGradient stop pattern mask symbol use filter feGaussianBlur feOffset feBlend feFlood
feComposite feMerge feMergeNode feColorMatrix feDropShadow switch
""".split())
URL_IN = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I)


def _clean_svg(svg: str, prefix: str) -> str | None:
    """A diagram's SVG with nothing in it that runs or reaches out: no script, no
    `foreignObject`, no event handler, no link but to itself, no `url(…)` but to its
    own parts; its ids renamed under ``prefix`` so two diagrams on a page never meet.
    None when it is not an SVG this can read."""
    if not svg or len(svg.encode("utf-8")) > MAX_SVG_BYTES or "<!DOCTYPE" in svg.upper() or "<!ENTITY" in svg.upper():
        return None
    try:
        root = SafeTree.fromstring(svg, forbid_dtd=True)
    except Exception:
        return None
    if _local_name(root.tag) != "svg":
        return None
    old = root.get("id") or ""
    for parent in list(root.iter()):
        for child in list(parent):
            if not isinstance(child.tag, str) or _local_name(child.tag) not in SVG_TAGS:
                parent.remove(child)
    for element in root.iter():
        for name in list(element.attrib):
            local = _local_name(name).lower()
            value = element.attrib[name]
            if local.startswith("on") or local in ("src", "action", "formaction"):
                del element.attrib[name]
            elif local == "href" and not value.strip().startswith("#"):
                del element.attrib[name]
            elif "url(" in value.lower() and any(not target.strip().startswith("#")
                                                for _, target in URL_IN.findall(value)):
                del element.attrib[name]
            elif "javascript:" in value.lower() or "expression(" in value.lower():
                del element.attrib[name]
        if _local_name(element.tag) == "style":
            css = element.text or ""
            if "@import" in css.lower() or any(not target.strip().startswith("#") for _, target in URL_IN.findall(css)):
                element.text = ""
    ElementTree.register_namespace("", SVG_NS)
    ElementTree.register_namespace("xlink", XLINK_NS)
    text = ElementTree.tostring(root, encoding="unicode")
    # an SVG inside a page needs no namespace said, and the page holds no address but its links
    text = re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', "", text)
    if old:
        text = text.replace(old, prefix)
    else:
        text = text.replace("<svg ", f'<svg id="{prefix}" ', 1)
    return text


#: The page a diagram's own config names, as the browser said it on the picture it drew.
DIAGRAM_PAPER = re.compile(r'^<svg\b[^>]*?\sdata-background="(#[0-9a-fA-F]{6})"')


def _diagram_paper(svg: str) -> tuple[str, str]:
    """What lays a diagram's figure on its own page (a Dark diagram's): the figure's style,
    and its caption's, light on a dark page. Nothing for one drawn on white."""
    found = DIAGRAM_PAPER.match(svg)
    if not found:
        return "", ""
    colour = found.group(1).lower()
    red, green, blue = (int(colour[at:at + 2], 16) for at in (1, 3, 5))
    if 0.2126 * red + 0.7152 * green + 0.0722 * blue >= 128:
        return f' style="background:{colour}"', ""
    return f' style="background:{colour};border-color:{colour}"', ' style="color:#c9ced5"'


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


# -- small readings ---------------------------------------------------------------------


def _asset(name: str) -> str:
    try:
        return (ASSETS / name).read_text(encoding="utf-8")
    except OSError:
        return ""


def _text(value: str) -> str:
    return html.escape(value, quote=False)


def _attr(value: str) -> str:
    return html.escape(value, quote=True)


def _outward(url: str) -> str:
    """A link out of the page: a new tab, with nothing of this page sent along."""
    return f'href="{_attr(url)}" target="_blank" rel="noopener noreferrer"'


def _quoted(text: str) -> str:
    """A title in its quotes, the words isolated so a right-to-left title leaves the quotes where they are."""
    if len(text) > 1 and text[0] == "\u201c" and text[-1] == "\u201d":
        return f"\u201c<bdi>{_text(text[1:-1])}</bdi>\u201d"
    return f"<bdi>{_text(text)}</bdi>"


def _cite(number: int) -> str:
    return f'<a class="az-cite" href="#src-{number}" data-src="{number}">[{number}]</a>'


def _table_classes(look: notes_tables.TableLook, coloured: bool) -> str:
    """A table's classes: its stripes, density, a first column kept in sight and its colours."""
    names = ["az-table"]
    names += ["az-stripes"] if look.stripes else []
    names += ["az-compact"] if look.compact else []
    names += ["az-first"] if look.sticky_column else []
    names += ["az-coloured"] if coloured else []
    return " ".join(names)


def _table_data(look: notes_tables.TableLook) -> str:
    """What the reader's script reads off a table: its search bar, sorting, folding and header."""
    data = f' data-search="{look.search}"' if look.search != notes_tables.DEFAULT.search else ""
    data += ' data-sort="off"' if not look.sort else ""
    data += f' data-fold="{look.fold}"' if look.fold else ""
    data += ' data-header="scrolls"' if not look.sticky_header else ""
    return data


def _table_caption(look: notes_tables.TableLook) -> str:
    """The caption and source a settings line writes under its table, or ''."""
    parts = f'<span class="az-caption">{_text(look.caption)}</span>' if look.caption else ""
    if look.source:
        parts += f'<span class="az-credit"><span class="az-credit-kind">Source:</span> {_text(look.source)}</span>'
    return f'<p class="az-table-cap" dir="auto">{parts}</p>\n' if parts else ""


def _aside(message: str) -> str:
    return f'<p class="az-aside" dir="auto">{_text(message)}</p>\n'


def _code(source: str) -> str:
    return f'<pre class="az-code"><code>{_text(source)}</code></pre>\n'


def _wrapped(classes: str, inner: str, tag: str = "div") -> str:
    """``inner`` in a ``tag`` of its own, or nothing when there is nothing in it."""
    if not inner:
        return ""
    named = f'id="{classes}"' if tag == "style" else f'class="{classes}"'
    return f"<{tag} {named}>{inner}</{tag}>\n"


def _start(token: Token) -> int:
    try:
        return int(token.attrGet("start") or 1)
    except (TypeError, ValueError):
        return 1


def _stepped(attrs: str, number: int) -> str:
    """A figure's attributes with its step in a story: its number, and `--az-n` for
    the order the page reads it in when the story's two columns fold into one."""
    return _one_style(f'{attrs} data-step="{number}" style="--az-n:{number}"')


def _one_style(attrs: str) -> str:
    """Attributes written with every `style` merged into one, which a browser would
    otherwise read only the first of."""
    styles = re.findall(r' style="([^"]*)"', f" {attrs}")
    if len(styles) < 2:
        return attrs
    rest = re.sub(r' style="[^"]*"', "", f" {attrs}").lstrip()
    return f'{rest} style="{";".join(style.strip(";") for style in styles)}"'


def _shape(size: tuple[int, int]) -> str:
    """A picture's shape, width over height, which holds a tall one to the window."""
    return f' style="--r:{size[0] / size[1]:.4f}"' if size[0] and size[1] else ""


def _aligned(align: str, inner: str) -> str:
    if align in ("center", "right"):
        return f'<div class="az-align" data-align="{align}">\n{inner}</div>\n'
    return inner


def _img(uri: str, size: tuple[int, int], alt: str, classes: str = "") -> str:
    kind = f' class="{classes}"' if classes else ""
    sized = f' width="{size[0]}" height="{size[1]}"' if size[0] and size[1] else ""
    return f'<img{kind} src="{uri}" alt="{_attr(alt)}"{sized} decoding="async">'


def _bar_style(paint: notes_charts.Paint | None, dark: notes_charts.Paint | None = None) -> str:
    """A wall's bar in a value's paint, as the chart paints it: filled, hatched or outlined;
    given the paint it takes on a story's dark stage, that one too (``--bar-d``)."""
    if paint is None:
        return ""
    style = f"--bar:{paint.colour}"
    if dark is not None and dark.colour != paint.colour:
        style += f";--bar-d:{dark.colour}"
    if paint.hatch:
        style += f";--hatch:{paint.hatch}"
        if dark is not None and dark.hatch and dark.hatch != paint.hatch:
            style += f";--hatch-d:{dark.hatch}"
        return f' style="{style}" data-hatch'
    return f' style="{style}" data-outline' if paint.outline else f' style="{style}"'


@dataclass
class _WallNight:
    """A wall drawn again in the dark look, for the paints its bars and flags take on a
    story's dark stage; None out of a story."""

    layout: notes_charts.Layout | None

    def paint(self, group: int, item: int) -> notes_charts.Paint | None:
        groups = notes_chart_wall.wall_facts(self.layout.facts) if self.layout is not None else []
        if group < len(groups) and item < len(groups[group].items):
            return groups[group].items[item].paint
        return None

    def key(self, at: int) -> notes_charts.Paint | None:
        legend = self.layout.legend if self.layout is not None else []
        return legend[at].paint if at < len(legend) else None


def _zoom_button(picture: str, alt: str) -> str:
    return f'<button class="az-zoom" type="button" aria-label="Open larger: {_attr(alt)}">{picture}</button>'


def _without_comments(text: str) -> str:
    """Raw HTML with every comment taken out, an unclosed one to the end."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    cut = text.find("<!--")
    return text if cut < 0 else text[:cut]


def _visible_text(page: str) -> str:
    """The words a page draws, for its fonts: its markup and its pictures left out."""
    page = re.sub(r"<(svg|script|style)\b.*?</\1>", " ", page, flags=re.S | re.I)
    page = re.sub(r"<[^>]*>", " ", page)
    return html.unescape(page)


def _slug(words: str) -> str:
    folded = unicodedata.normalize("NFKC", words).casefold()
    slug = re.sub(r"[^\w]+", "-", folded).strip("-_")[:60].strip("-_")
    if slug and slug[0].isdigit():
        slug = f"s-{slug}"
    return slug


def _short(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _seconds(written: str | None) -> float | None:
    if not written:
        return None
    try:
        parts = [float(part) for part in written.split(":")]
    except ValueError:
        return None
    total = 0.0
    for part in parts:
        total = total * 60 + part
    return total


def _at_moment(url: str, seconds: float) -> str:
    """The video's page at a moment, where the site reads one (YouTube); else the page."""
    host = notesources.host(url)
    if host in ("youtube.com", "m.youtube.com", "youtu.be"):
        joiner = "&" if "?" in url else "?"
        return f"{url.split('#', 1)[0]}{joiner}t={int(seconds)}s"
    return url


def _platform(url: str) -> str:
    host = notesources.host(url)
    return PLATFORMS.get(host, host or "the web")


def _posted(url: str) -> str:
    return f'<a class="az-posted" {_outward(url)}>Posted on {_text(_platform(url))} ↗</a>'


def _short_address(url: str) -> str:
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    shown = f"{notesources.host(url)}{parts.path.rstrip('/')}"
    return shown if len(shown) <= 80 else f"{shown[:79]}…"


def _day(value: str) -> str:
    return f'<time datetime="{_attr(value[:10])}">{_text(notesources.spoken_day(value))}</time>'


def _megabytes(size: int) -> str:
    return f"{size / (1024 * 1024):.1f} MB"


def _rounded(lat: float, lon: float, metres: float = POV_METRES) -> tuple[float, float]:
    """A point moved to a grid about ``metres`` wide, so it names the place, not the spot."""
    step_lat = metres / 111_320
    step_lon = metres / (111_320 * max(0.01, math.cos(math.radians(lat))))
    return round(lat / step_lat) * step_lat, round(lon / step_lon) * step_lon


def _proof_spec(case: "Case | None", record: dict[str, Any] | None) -> dict[str, Any]:
    import json

    rel = ((record or {}).get("attrs") or {}).get("spec")
    if case is None or not isinstance(rel, str) or not rel:
        return {}
    try:
        path = case.resolve_inside(rel)
        if path.stat().st_size > 4 * 1024 * 1024:
            return {}
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _side_day(sidecar: dict[str, Any], side: str) -> str:
    day = sidecar.get(f"imagery_{side}")
    if not isinstance(day, str) or not day:
        return ""
    exact = sidecar.get(f"imagery_{side}_exact") is not False
    return notesources.spoken_day(day if exact else f"{day}~")


def _credit_leaves(source: Source | None, depth: int = 0) -> Iterable[tuple[str, Source]]:
    """What a picture's credit is read from, as `notesources.Source.credit` reads it, but
    every origin rather than the first: imagery that says whose it is, a page it was
    posted on, or what a map or a terrain owes."""
    if source is None or depth > notesources.MAX_HOPS:
        return
    if source.kind == notesources.IMAGERY and (source.readings or source.attribution):
        yield "Imagery", source
    elif source.address:
        yield "Source", source
    elif source.origins:
        for origin in source.origins:
            yield from _credit_leaves(origin, depth + 1)
    elif source.attribution:
        yield ("Map" if source.noun == notesources.PLATE_NOUN else "Terrain"), source


def _credit_groups(source: Source | None) -> dict[str, list[tuple[str, str]]]:
    """A figure's credit by kind (Imagery, Source, Map, Terrain): each name once, with
    the address it links to, whatever its case (`_Page._credit`)."""
    groups: dict[str, list[tuple[str, str]]] = {}
    seen: set[str] = set()

    def add(kind: str, words: str, link: str = "", *also: str) -> None:
        words = " ".join(words.split())
        key = words.casefold()
        if not key or key in seen:
            return
        seen.update({key, *(" ".join(one.split()).casefold() for one in also)})
        groups.setdefault(kind, []).append((words, link))

    for kind, leaf in _credit_leaves(source):
        if kind == "Imagery":
            for reading in leaf.readings:
                day = notesources.spoken_day(reading.day)
                add(kind, ", ".join(part for part in (reading.provider, day) if part), leaf.address,
                    reading.provider)
            for part in leaf.attribution.split(" · "):
                add(kind, part)
        elif kind == "Source":
            add(kind, notesources.host(leaf.address), leaf.address)
        else:
            for part in leaf.attribution.split(" · "):
                add(kind, part)
    return groups


def _credit_words(source: Source | None) -> str:
    """What a picture's imagery, map or terrain owes, in words and no markup:
    `Imagery: Esri World Imagery, about 3 June 2025`. A page it was posted on is no
    provider and is left out."""
    said: list[str] = []
    for kind, items in _credit_groups(source).items():
        if kind == "Source":
            continue
        names = [words for words, _ in items[:MAX_CREDITS]]
        more = len(items) - MAX_CREDITS
        said.append(f"{kind}: {' · '.join(names)}{f' and {more} more' if more > 0 else ''}")
    return "; ".join(said)


def _clipped(text: str, limit: int) -> str:
    """``text`` cut at a word to at most ``limit`` characters, an ellipsis said."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:–—-") or text[: limit - 1]
    return f"{cut}…"


def _file_stem(words: str) -> str:
    """A file's name in a folder from what the page says of it: plain lower-case
    letters, digits and hyphens, never anything of the case's own paths."""
    folded = unicodedata.normalize("NFKD", words).encode("ascii", "ignore").decode("ascii").lower()
    stem = re.sub(r"[^a-z0-9]+", "-", folded).strip("-")[:40].strip("-")
    return stem or "file"


def _anchor_named(message: str) -> str:
    """The part of the page a link warning names (`The link "#V12" …`), or ""."""
    found = re.match(r'^The link "#([^"]+)"', message)
    return found.group(1) if found else ""


def _lone_picture(tokens: list[Token], index: int) -> Token | None:
    """The picture a paragraph at ``index`` is made of alone, or None."""
    if tokens[index].type != "paragraph_open" or index + 1 >= len(tokens):
        return None
    children = [child for child in tokens[index + 1].children or [] if child.type != "softbreak"]
    return children[0] if len(children) == 1 and children[0].type == "image" else None


def _step_label(picture: Token, number: int) -> str:
    """What a step's dot says: its caption up to the first comma, or its number."""
    options = md.image_options(md.token_attr(picture, "src"))
    caption = options.caption or md.token_attr(picture, "title") or " ".join((picture.content or "").split())
    label = caption.split(", ", 1)[0].strip()
    return md.cut_text(label, 28) if label else str(number)


__all__ = ["CSP", "MAX_BYTES", "NotesHtmlError", "PICTURES", "RenderedHtml", "WARNING_KINDS", "render"]
