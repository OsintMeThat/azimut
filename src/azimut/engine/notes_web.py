"""A note as a folder ready to put on the web, with the picture card a link shows.

An HTML file cannot be attached to a post on X; a page with an address can, and X
draws it as a card with a picture. This is that page: the public edition laid out by
the same renderer as the HTML report (`engine/notes_html.py`, given a `Folder`), its
pictures, clips and fonts as files under `assets/` named by their content rather
than `data:` addresses, so the page is light and each file is fetched once.

```
<exports>/web/<folder>/
  index.html          the report, Article or Story as the note's Look lays it out
  assets/<sha8>-<name>.<ext>
  share.jpg           the 1200 by 630 link card
  .nojekyll           GitHub Pages serves the files as they are
  HOW-TO-PUBLISH.md   how to put the folder on GitHub Pages, free, step by step
```

**Its head** says what a link card reads: the title, a description (the cover's
subtitle or the first paragraph), Open Graph and Twitter tags pointing at
`share.jpg`, and, once the analyst gives the address the folder will live at
(`address`), the canonical address, with every card address absolute as X needs.
A page published to a site as Unlisted also asks search engines not to index it
(`<meta name="robots" content="noindex">`), so a link shared to try it stays out of them;
an article or a page never does.
The folder is named after that address's last part, so a later export replaces the
same page; with none it is `<note>-<day>`.

**Its policy** (`folder_csp`) lets the page load only its own files: nothing from
any other host, no inline script. The safety of the HTML report holds as it is: the
public edition only, every internal passage refused, metadata stripped, the same
25 MB budget counted over the whole folder.

**Its maps go live online.** A page holding a map carries MapLibre GL JS as files
(`assets/maplibre-<version>/`, its licence as `LICENSE-maplibre.txt`), copied from the
build the frontend leaves in `static/vendor/maplibre/` (`live_maps`), and the reader
turns each map into a live one over OpenFreeMap's free vector map once the page is read
over the web, the offline drawing staying until it is ready and for good when it cannot
be. That page alone widens its policy (`LIVE_SOURCES`), to OpenFreeMap's one host, which
the reader's browser reaches; Azimut never does. The analyst can keep the maps offline
(``live=False``), and a copy of Azimut built without those files keeps them offline
and says so once.

**The card** (`share_card`) is the note's cover picture, else the picture the story
layout opens on, under a dark gradient with the title in the report's own face, its
day, and the provider's credit for imagery or a map; with no picture, the title on
the report's paper under its accent rule. A map page's card is the page itself as it shows
once its map is up (`map_cover`): its band with the title, its line and the analyst, the
map's ground cut to fill the rest with no band round it and its marks drawn over it, and its
legend in a column at the right, drawn here from what the page holds.

**How to publish** is said once, here (`PAGES_*`), and written into the folder as
`HOW-TO-PUBLISH.md`; the app shows the same words (`frontend/src/lib/githubPagesSetup.js`,
which a test holds to these). The website's own words (`site.SITE_*`) close it, and Settings ›
Website says them too.

**A folder published to a site** (`placement`, `engine/site.py`) also carries its card,
`article.json`, and `cover.jpg`, the picture of its line in the site's list: the look's list
picture, else its cover picture or its first picture, else the link card itself, which a map
page's always is. A page of the site starts with a bar back to it, and counts its readers when the site asks.
Each link to a web map of the case that the site holds opens the map's page there (`maps`), at the
site's address, which the site's lists read to fold the map under the article (`site.links_of`).

Nothing is fetched and nothing is published from here: the folder is written to
disk (`write`, swapped in by renames so it is whole or not there, on every OS).
"""

from __future__ import annotations

import bisect
import hashlib
import html
import re
import shutil
import tempfile
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any, Iterable, Mapping
from urllib.parse import unquote, urlsplit, urlunsplit

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFilter, ImageFont, ImageOps, UnidentifiedImageError

from . import dirswap, notelinks, notelook, notes_maps, notes_style, pdffonts, siteatlas
from . import notes_html as html_engine
from . import site as site_engine
from . import notes_markdown as md
from .notelook import DEFAULT as DEFAULT_LOOK
from .notelook import NoteLook
from .notes_pdf import MAX_IMAGE_PIXELS

if TYPE_CHECKING:
    from ..workspace import Case

#: The folder the web folders go in, inside the notes' export folder.
WEB_DIR = "web"
INDEX = "index.html"
SHARE = "share.jpg"
#: What a folder published to a site adds: its card (`engine/site.py`) and the picture its line
#: in the site's list shows.
CARD = site_engine.CARD
COVER = "cover.jpg"
NOJEKYLL = ".nojekyll"
HOW_TO = "HOW-TO-PUBLISH.md"
#: The size X and every other site draws a large link card at.
SHARE_SIZE = (1200, 630)
SHARE_QUALITY = 88
#: The list picture, as a card names it: the same size, a little lighter.
COVER_QUALITY = 84
#: What the check says when the author's picture (`notes_html.author_face`) is gone.
AUTHOR_IMAGE_GONE = ("The author's picture is no longer in the case or could not be read; the page goes "
                     "without it.")
#: The longest address a folder may be given.
MAX_ADDRESS = 300
#: How many files GitHub takes in one upload from its page.
MAX_UPLOAD_FILES = 100
#: The check's kind and words for a folder given no address.
ADDRESS = "address"
#: The kind of the warning that a folder is too many files for GitHub's upload page,
#: which a folder published from Azimut has no use for.
UPLOAD = "upload"
NO_ADDRESS = "No address given: X shows the link without its picture card."

#: How to put the folder on GitHub Pages. The app says the same words
#: (`frontend/src/lib/githubPagesSetup.js`), held to these by a test.
PAGES_INTRO = (
    "GitHub Pages puts this folder on the web for free, at an address you can share on X. "
    "It all happens on github.com in your browser, with no command line."
)
PAGES_PUBLIC = (
    "A Pages site is public: anyone with the address can read it, and search engines can find it. "
    "The folder holds the public edition only."
)
PAGES_STEPS = (
    "Sign up for a free account at github.com, unless you have one. Your username goes in every address.",
    "Press + at the top right, then New repository. Name it articles, keep it Public, switch on Add README, "
    "and press Create repository. You make it once: every article goes in it as a folder.",
    "Pick a short name for this article, such as port-strike. Its address will be "
    "https://your-name.github.io/articles/port-strike/, with your username in lower case.",
    "In Azimut, type that address under Address it will live at, and export the web folder. "
    "The folder takes the short name, and X gets its picture card.",
    "In the repository, press Add file › Upload files. Drag the folder itself onto the page, "
    "not the files inside it, then press Commit changes.",
    "The first time only: open Settings › Pages. Under Build and deployment, choose Deploy from a branch, "
    "then main and / (root), and press Save.",
    "Wait about a minute, then open the address. Share it on X like any link.",
)
PAGES_UPDATE = (
    "Export the note again from Azimut and upload its folder the same way: "
    "the new files replace the old ones at the same address."
)
PAGES_CARD = (
    "The address typed in Azimut is what gives X its picture card, share.jpg in the folder. "
    "Without it, X shows the link alone."
)

#: The card's type: its day and its credit, and the size under which a title takes three lines.
DATE_SIZE = 22
CREDIT_SIZE = 22
TWO_LINES = 60
#: The page's story dark, which the card's lower band is solid in, from this share of
#: its height down (higher when the title needs it), under a short soft ramp.
STORY_DARK = (15, 16, 18)
BAND_FROM = 0.62
BAND_RAMP = 56
#: The paper a typographic card is set on, by the look's style, as the reader's stylesheet has it.
PAPERS = {"journal": (251, 250, 246)}
WHITE = (255, 255, 255)
INK = (26, 28, 32)
MUTED = (98, 103, 111)
#: A folder name taken from an address: one plain path part.
FOLDER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")

#: Where the frontend build leaves MapLibre's own build for a live map
#: (`frontend/src/lib/notes/maplibreVendor.js`), shipped with the rest of `static/`.
LIVE_VENDOR = Path(__file__).resolve().parents[1] / "static" / "vendor" / "maplibre"
#: Its files a folder carries under `assets/maplibre-<version>/`, by the names they call one another.
LIVE_FILES = ("maplibre-gl.js", "maplibre-gl-shared.js", "maplibre-gl-worker.js", "maplibre-gl.css")
LIVE_LICENSE = "LICENSE-maplibre.txt"
LIVE_VERSION = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z.]{1,20})?$")
#: The base map a live map draws on: OpenFreeMap's free vector style, which needs no key.
#: Its style, tiles, glyphs and sprites all come from this one host, as the style at
#: `LIVE_STYLE` names them (read 2026-11-18).
LIVE_HOST = "https://tiles.openfreemap.org"
LIVE_STYLE = f"{LIVE_HOST}/styles/liberty"
#: Its dark style, for a map whose base is dark (`base: dark`): the same host, sources,
#: glyphs and sprites (read 2026-11-19).
LIVE_DARK = f"{LIVE_HOST}/styles/dark"
#: What a page with a live map adds to the folder's policy: the base map's host, fetched
#: (style, tiles, glyphs, sprites) and drawn, and the page's own files fetched, as the map
#: reads the filed ground. Its worker is a file of the folder, which `script-src 'self'` allows.
LIVE_SOURCES: dict[str, tuple[str, ...]] = {"connect-src": ("'self'", LIVE_HOST), "img-src": (LIVE_HOST,)}
#: The satellite imagery a live map may stream when its block names one (`imagery:`,
#: `notes_maps.live_imagery`): EOX's Sentinel-2 cloudless and Esri World Imagery, their tiles
#: fetched and drawn. A page's policy lets in only the hosts its own maps stream from.
IMAGERY_HOSTS = ("https://tiles.maps.eox.at", "https://services.arcgisonline.com")
#: The check's words when the maps cannot go live.
LIVE_MISSING = "Its maps stay offline: this copy of Azimut was built without the live map's files."


class NotesWebError(Exception):
    """The note could not be made a web folder, said for the analyst."""


@dataclass
class WebBuild:
    """One web folder, as files to write or commit: relative POSIX path to bytes.

    ``name`` is the folder's own name; ``sha256`` is its page's, which the note's
    record of editions keeps. The rest is what the HTML check says of a page.
    """

    files: dict[str, bytes]
    name: str
    title: str
    address: str = ""
    index: str = INDEX
    warnings: list[str] = field(default_factory=list)
    warning_lines: list[int | None] = field(default_factory=list)
    warning_kinds: list[str] = field(default_factory=list)
    listed: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    sha256: str = ""
    text_sha256: str = ""
    #: The source the page printed, which its edition keeps (`engine/noteeditions.py`).
    printed: str = ""
    weight: int = 0
    internal: int = 0
    links: list[tuple[str, int | None]] = field(default_factory=list)
    pov: list[tuple[str, int | None]] = field(default_factory=list)
    #: How many maps its page holds, and whether they go live once it is online.
    maps: int = 0
    live: bool = False
    #: What the Ready to publish? panel reads beyond the warnings, as its page's.
    ready: dict[str, Any] = field(default_factory=dict)
    #: The card a folder published to a site carries, and None for any other folder.
    card: site_engine.Card | None = None

    def warn(self, message: str, line: int | None, kind: str) -> None:
        self.warnings.append(message)
        self.warning_lines.append(line)
        self.warning_kinds.append(kind)


def folder_csp(extra: Mapping[str, Iterable[str]] | None = None) -> str:
    """The policy a web folder's page is read under: its own files and nothing else.

    Styles stay allowed inline, as in the HTML report (the page sets a picture's
    shape in its `style`); scripts come from the folder only. ``extra`` adds sources
    to a directive, or a directive of its own, for a page that needs more (a live
    map's tile hosts): `{"img-src": ["https://tiles.example.org"]}`.
    """
    directives: dict[str, list[str]] = {
        "default-src": ["'none'"],
        "img-src": ["'self'"],
        "media-src": ["'self'"],
        "font-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
    }
    for name, sources in (extra or {}).items():
        kept = directives.setdefault(name, [])
        kept.extend(source for source in sources if source not in kept)
    return "; ".join(f"{name} {' '.join(sources)}" for name, sources in directives.items())


def live_csp(streamed: Iterable[str] = ()) -> str:
    """The policy of a page with a live map (`LIVE_SOURCES`), and of the imagery hosts its maps
    stream from those of `IMAGERY_HOSTS` named in ``streamed``; any other is never let in."""
    hosts = [host for host in IMAGERY_HOSTS if host in set(streamed)]
    return folder_csp({name: (*sources, *hosts) for name, sources in LIVE_SOURCES.items()})


def address(value: str | None) -> str:
    """The address a folder will live at, checked, with its closing slash; "" for none.

    An `https` address of a named site, with no name or password in it, no `?` or `#`,
    at most `MAX_ADDRESS` characters. It is printed into the page's head, so nothing
    but a plain address gets through.
    """
    text = (value or "").strip()
    if not text:
        return ""
    if len(text) > MAX_ADDRESS:
        raise NotesWebError(f"The address is longer than {MAX_ADDRESS} characters.")
    if any(char.isspace() or ord(char) < 32 or char in "\"'<>\\`^{|}" for char in text):
        raise NotesWebError("The address holds a character an address cannot.")
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError as exc:
        raise NotesWebError("That is not an address.") from exc
    if parts.scheme.lower() != "https":
        raise NotesWebError("The address must start with https://.")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise NotesWebError("The address must not hold a name or a password.")
    host = (parts.hostname or "").rstrip(".")
    if "." not in host or host.startswith(".") or ".." in host:
        raise NotesWebError("The address needs a site name, such as your-name.github.io.")
    if parts.query or parts.fragment or "?" in text or "#" in text:
        raise NotesWebError("The address must not hold ? or #.")
    netloc = host.lower() + (f":{port}" if port is not None else "")
    path = parts.path or "/"
    return urlunsplit(("https", netloc, path if path.endswith("/") else f"{path}/", "", ""))


def folder_name(title: str, day: date, where: str = "", *, note_id: str = "") -> str:
    """The folder's name: the last part of the address it will live at, so a later
    export replaces the same page; else `<note>-<day>`, a homonym's ``note_id`` marked."""
    if where:
        last = unquote(urlsplit(where).path.rstrip("/").rsplit("/", 1)[-1])
        if FOLDER_NAME.match(last) and last not in (".", ".."):
            return last
    folded = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", folded).strip("-")[:60].strip("-") or "note"
    marker = f"-{_short_hash(note_id)}" if note_id else ""
    return f"{slug}{marker}-{day.isoformat()}"


def build(
    case: "Case",
    note_id: str,
    *,
    edition: str = md.PUBLIC,
    base_url: str | None = None,
    diagrams: dict[str, str] | None = None,
    round_pov: bool = False,
    changes: str = "",
    earlier: Iterable[dict[str, Any]] = (),
    homonym: bool = False,
    check: bool = False,
    now: datetime | None = None,
    live: bool = True,
    placement: site_engine.Placement | None = None,
    maps: notelinks.SiteMaps | None = None,
) -> WebBuild:
    """The web folder of one note, in memory: its files, its name, what to know of it.

    Always the public edition. ``base_url`` is the address it will live at (checked
    by `address`). ``diagrams``, ``round_pov``, ``changes`` and ``earlier`` are the
    HTML report's own. ``homonym`` marks the name of a note sharing its title with
    another. ``check`` lays it out as the export would to say its weight and what it
    warns about, the missing address included, and makes no card and writes no clip.
    ``live`` lets its maps go live online; False keeps them as the HTML report draws them.
    ``placement`` makes it a page of the analyst's site: it gets the way back to the site, the
    site's counts, a card and the picture of its line in the site's list (`engine/site.py`).
    ``maps`` says where the web maps it links to stand on that site, so each link opens its page there.
    """
    if edition != md.PUBLIC:
        raise NotesWebError("A web folder holds the public edition only.")
    where = address(base_url)
    found = md.read_note(case, note_id)
    if found is None:
        raise NotesWebError(f"note '{note_id}' not found")
    title, text = found
    look = notelook.stored(case, note_id) or DEFAULT_LOOK
    when = now or datetime.now().astimezone()
    day = date.fromisoformat(look.cover.date) if look.cover.date else when.date()
    vendor = live_maps() if live else None
    said: list[str] = []
    face = html_engine.author_face(case, look.author_image) if look.author_image else None
    if look.author_image and face is None:
        said.append(AUTHOR_IMAGE_GONE)
    # online at its address only: kept out of search engines too
    hidden = placement is not None and placement.role_of(look) == site_engine.UNLISTED
    folder = html_engine.Folder(csp=folder_csp(), head=lambda description: _head(title, description, where, hidden=hidden),
                                live=vendor, frame=site_engine.frame_of(placement.site) if placement else None,
                                author_face=face[0] if face is not None else "", maps=maps)
    # a note someone else wrote is signed with their name (`notefill.signing`, inside the render)
    rendered = html_engine.render(
        case, title=title, text=text, look=look, note_id=note_id, resolve=md.case_resolver(case), created=when,
        public=True, diagrams=diagrams, round_pov=round_pov, changes=changes, earlier=earlier,
        check=check, folder=folder,
    )
    files: dict[str, bytes] = {INDEX: rendered.html, **folder.files}
    if face is not None:
        files[face[0]] = face[1]
    if not check and rendered.map_page is not None:
        files[SHARE] = map_cover(rendered.map_page, title=title, description=rendered.description, look=look,
                                 face=face[1] if face is not None and rendered.map_page.face else None)
    elif not check:
        files[SHARE] = share_card(title=title, day=rendered.day or day, look=look, hero=rendered.hero,
                                  description=rendered.description)
    files[NOJEKYLL] = b""
    if rendered.live and vendor is not None:
        files[LIVE_LICENSE] = vendor.licence
    name = folder_name(title, day, where, note_id=note_id if homonym else "")
    files[HOW_TO] = how_to(name, where).encode("utf-8")
    card: site_engine.Card | None = None
    if placement is not None and not check:
        card = _site_card(placement, case, look, rendered, files, said, title=title, day=rendered.day or day,
                          name=name, face=face[0] if face is not None else "")
        files[CARD] = card.as_json()
    made = WebBuild(
        files=files, name=name, title=title, address=where, maps=rendered.maps, live=rendered.live,
        warnings=list(rendered.warnings), warning_lines=list(rendered.warning_lines),
        warning_kinds=list(rendered.warning_kinds), listed=rendered.listed, sha256=hashlib.sha256(rendered.html).hexdigest(),
        text_sha256=rendered.text_sha256, printed=rendered.printed, internal=rendered.internal, links=rendered.links, pov=rendered.pov,
        ready=rendered.ready, card=card,
        weight=rendered.weight + sum(len(data) for path, data in files.items() if path not in folder.files
                                     and path != INDEX),
    )
    for line in said:
        made.warn(line, None, md.OTHER)
    if len(files) > MAX_UPLOAD_FILES:
        made.warn(f"The folder holds {len(files)} files; GitHub's upload page takes {MAX_UPLOAD_FILES} at a time, "
                  "so upload it in two goes.", None, UPLOAD)
    if check and not where:
        made.warn(NO_ADDRESS, None, ADDRESS)
    if live and rendered.maps and vendor is None:
        made.warn(LIVE_MISSING, None, md.OTHER)
    return made


def _site_card(placement: site_engine.Placement, case: "Case", look: NoteLook, rendered: html_engine.RenderedHtml,
               files: dict[str, bytes], said: list[str], *, title: str, day: date, name: str,
               face: str = "") -> site_engine.Card:
    """The card a folder published to a site carries, and `cover.jpg` beside it: the picture of
    its line in the site's list, made from the look's list picture, else an article's own (its
    cover, its first picture), else the link card, which a map page's is (`map_cover`). Its
    author is the look's, else the site's (`Site.author`); ``face`` is the author's picture in the
    folder, "" for none."""
    site = placement.site
    page = rendered.html.decode("utf-8")
    category = placement.category if placement.category is not None else look.category
    role = placement.role_of(look)
    picture = None
    if look.list_image:
        picture = html_engine.case_picture(case, look.list_image)
        if picture is None:
            said.append("The list picture is no longer in the case or could not be read; the cover picture "
                        "stands in the site's list.")
    cover = _list_cover(picture or (rendered.picture if rendered.map_page is None else None))
    if cover is None and SHARE in files:
        cover = files[SHARE]
    if cover is not None:
        files[COVER] = cover
    return site_engine.Card(
        title=title, summary=rendered.description, date=day.isoformat(),
        category=site_engine.one_line(category, notelook.CATEGORY_MAX),
        author=look.author or site.author, author_image=face,
        role=role if role in (site_engine.PAGE, site_engine.UNLISTED) else site_engine.ARTICLE,
        layout=rendered.layout, image=COVER if cover is not None else "",
        links=site_engine.links_of(page, site, name), place=placement.card_place(look.place))


def _list_cover(path: Path | None) -> bytes | None:
    """The 1200 by 630 JPEG of a line in the site's list, cut from a picture to fill it: upright,
    progressive, with no metadata. None when there is no picture or it cannot be read."""
    picture = _cover(path) if path is not None else None
    if picture is None:
        return None
    buffer = BytesIO()
    picture.convert("RGB").save(buffer, "JPEG", quality=COVER_QUALITY, optimize=True, progressive=True)
    return buffer.getvalue()


def live_maps() -> html_engine.LiveMaps | None:
    """What a folder's maps need to go live, read from the build the frontend leaves
    (`LIVE_VENDOR`); None when it is not there whole, as in a tree never built."""
    try:
        version = (LIVE_VENDOR / "VERSION").read_text(encoding="utf-8").strip()
        files = {name: (LIVE_VENDOR / name).read_bytes() for name in LIVE_FILES}
        licence = (LIVE_VENDOR / "LICENSE.txt").read_bytes()
    except (OSError, UnicodeDecodeError):
        return None
    if not LIVE_VERSION.match(version) or not all(files.values()) or not licence:
        return None
    return html_engine.LiveMaps(csp=live_csp(), style=LIVE_STYLE, dark=LIVE_DARK, version=version, files=files,
                                licence=licence, streaming=live_csp)


def write(made: WebBuild, dest_dir: Path) -> Path:
    """Write the folder to ``dest_dir``, whole or not at all.

    The files go into a folder beside it first, which is then swapped in by renames
    (`engine/dirswap.py`): an earlier folder by that name is moved aside before the
    new one takes its place, and deleted last, which Windows allows where it would
    refuse to delete or replace a folder in place.
    """
    parent = dest_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=parent, prefix=f".staging-{dest_dir.name}-"))
    try:
        # a folder to publish reads as any other, not as the private one a temporary folder is made
        staging.chmod(0o755)
        for relative, data in made.files.items():
            target = _inside(staging, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        dirswap.swap_in(staging, dest_dir)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return dest_dir


def how_to(name: str, where: str) -> str:
    """`HOW-TO-PUBLISH.md`: the steps, and what this folder is for."""
    steps = "\n".join(f"{number}. {_md_line(step)}" for number, step in enumerate(PAGES_STEPS, 1))
    if where:
        this = f"This folder, `{name}`, is made for {_md_line(where)}."
    else:
        this = f"This folder, `{name}`, was exported with no address, so X shows its link without the picture card."
    own = "\n".join(f"- **{lead}**: {_md_line(what)}" for lead, what in site_engine.SITE_OWN)
    return (
        f"# Publish this folder on GitHub Pages\n\n{_md_line(PAGES_INTRO)}\n\n> {_md_line(PAGES_PUBLIC)}\n\n"
        f"{this}\n\n## Step by step\n\n{steps}\n\n## To update it\n\n{_md_line(PAGES_UPDATE)}\n\n"
        f"## The picture card on X\n\n{_md_line(PAGES_CARD)}\n\n"
        f"## {site_engine.SITE_TITLE}\n\n{site_engine.SITE_INTRO}\n{site_engine.SITE_STAYS_YOURS}\n\n"
        f"### {site_engine.SITE_OWN_TITLE}\n\n{own}\n"
    )


# -- the link card -------------------------------------------------------------------


def share_card(*, title: str, day: date, look: NoteLook | None, hero: html_engine.Hero | None,
               description: str = "") -> bytes:
    """The 1200 by 630 picture a link to the page shows, as a JPEG with no metadata."""
    look = look or DEFAULT_LOOK
    theme = notes_style.theme_for(look)
    picture = _cover(hero.path) if hero is not None else None
    card = (_picture_card(picture, title, day, theme, hero.credit if hero is not None else "")
            if picture is not None else _paper_card(title, day, look, theme, description))
    buffer = BytesIO()
    card.convert("RGB").save(buffer, "JPEG", quality=SHARE_QUALITY, optimize=True, progressive=True, subsampling=0)
    return buffer.getvalue()


def _cover(path: Path) -> Image.Image | None:
    """The picture cropped to fill the card, upright, None when it cannot be read."""
    try:
        with Image.open(path) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                return None
            image.draft("RGB", (SHARE_SIZE[0] * 2, SHARE_SIZE[1] * 2))
            upright = ImageOps.exif_transpose(image).convert("RGB")
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        return None
    return ImageOps.fit(upright, SHARE_SIZE, Image.Resampling.LANCZOS, centering=(0.5, 0.45))


def _picture_card(picture: Image.Image, title: str, day: date, theme: notes_style.Theme, credit: str) -> Image.Image:
    """The page's own story cover in small: the picture whole at its top, the title
    centred low, its first lines on a veil that darkens only where they stand, its last
    line, the accent rule and the day on a solid band in the story's dark, so nothing the
    picture says shows under them; the provider's credit in the band's right corner."""
    width, height = SHARE_SIZE
    # X lays the site's name over the card's lower left corner: the words keep above it
    bottom = height - 84
    face, lines = _fit(title, theme.heading_family, width - 2 * 130, sizes=range(76, 43, -2))
    leading = round(face.size * 1.08)
    top = bottom - DATE_SIZE - 58 - leading * len(lines)
    card = picture.convert("RGBA")
    card.alpha_composite(_tinted(STORY_DARK, _veil(top)))
    band = band_top(top, len(lines), leading)
    ramp = Image.new("L", (1, BAND_RAMP))
    ramp.putdata([round(255 * _ease((row + 1) / BAND_RAMP)) for row in range(BAND_RAMP)])
    card.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (width, BAND_RAMP), STORY_DARK).split(),
                                              ramp.resize((width, BAND_RAMP)))), (0, band - BAND_RAMP))
    ImageDraw.Draw(card).rectangle((0, band, width, height), fill=(*STORY_DARK, 255))
    # a soft shadow under the words keeps them on any picture
    shadow = Image.new("L", SHARE_SIZE, 0)
    shade = ImageDraw.Draw(shadow)
    for index, line in enumerate(lines):
        shade.text((width / 2, top + index * leading), line, font=face, fill=150, anchor="ma")
    card.alpha_composite(_tinted((0, 0, 0), shadow.filter(ImageFilter.GaussianBlur(16))))
    draw = ImageDraw.Draw(card)
    for index, line in enumerate(lines):
        draw.text((width / 2, top + index * leading), line, font=face, fill=(255, 255, 255, 255), anchor="ma")
    rule = bottom - DATE_SIZE - 26
    draw.rectangle((width / 2 - 30, rule, width / 2 + 30, rule + 4), fill=(*_on_dark(theme.accent), 255))
    stamp = notes_style.long_date(day).upper()
    _spaced(draw, (width / 2, bottom - DATE_SIZE), stamp, _face(theme.heading_family, 700, DATE_SIZE, stamp), 2.4,
            (255, 255, 255, 222), centred=True)
    if credit:
        quiet = _face(theme.heading_family, 400, CREDIT_SIZE, credit)
        draw.text((width - 32, height - 26), _ellipsis(credit, quiet, width * 0.72), font=quiet,
                  fill=(255, 255, 255, 214), anchor="rd")
    return card


def band_top(top: int, lines: int, leading: int) -> int:
    """Where the card's solid band starts: `BAND_FROM` of its height, or higher, just
    above the title's last line, when the title stands that high."""
    return min(round(SHARE_SIZE[1] * BAND_FROM), top + (lines - 1) * leading - 6)


def _veil(start: int) -> Image.Image:
    """The darkening behind the words, as an alpha mask: nothing above ``start`` less a
    margin, then a ramp to most of the way dark under the title and darker still at the
    foot. Worked out on a quarter of the pixels, it is smooth."""
    width, height = SHARE_SIZE[0] // 4, SHARE_SIZE[1] // 4
    begin = start / SHARE_SIZE[1] - 0.22
    rows = [_ease((y / height - begin) / 0.32) * 0.64 + _ease((y / height - begin - 0.22) / max(0.1, 0.7 - begin)) * 0.36
            for y in range(height)]
    # a little more in the middle, where the words stand
    columns = [_ease(1 - abs(x / width - 0.5) / 0.5) * 0.12 for x in range(width)]
    mask = Image.new("L", (width, height))
    mask.putdata([round(255 * min(0.975, row + column * min(1.0, row * 3))) for row in rows for column in columns])
    return mask.resize(SHARE_SIZE, Image.Resampling.BILINEAR)


def _tinted(colour: tuple[int, int, int], alpha: Image.Image) -> Image.Image:
    return Image.merge("RGBA", (*Image.new("RGB", SHARE_SIZE, colour).split(), alpha))


def _on_dark(colour: tuple[int, int, int]) -> tuple[int, int, int]:
    """An accent light enough to read on the veil: the same hue lifted toward white."""
    for step in range(11):
        lifted = notes_style.mix(colour, WHITE, step * 0.07)
        if _luminance(lifted) >= 0.28:
            return lifted
    return notes_style.mix(colour, WHITE, 0.7)


def _luminance(colour: tuple[int, int, int]) -> float:
    def channel(value: int) -> float:
        value_ = value / 255
        return value_ / 12.92 if value_ <= 0.04045 else ((value_ + 0.055) / 1.055) ** 2.4

    red, green, blue = (channel(value) for value in colour)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _paper_card(title: str, day: date, look: NoteLook, theme: notes_style.Theme, description: str) -> Image.Image:
    """The page's own cover in small, set on the report's paper: the title centred,
    what it is about under it, the accent rule and the day, the style's accent along
    the top as its cover has it."""
    width, height = SHARE_SIZE
    paper = PAPERS.get(look.style, WHITE)
    card = Image.new("RGBA", SHARE_SIZE, (*paper, 255))
    draw = ImageDraw.Draw(card)
    draw.rectangle((0, 0, width, 9), fill=(*theme.accent, 255))
    face, lines = _fit(title, theme.heading_family, width - 2 * 120, sizes=range(80, 47, -2))
    leading = round(face.size * 1.08)
    body = _face(theme.body_family, 400, 29, description or title)
    said = _balanced(description, body, width - 2 * 170, 2) if description and len(lines) <= 2 else []
    if len(said) > 2:
        said = said[:2]
        said[-1] = _ellipsis(f"{said[-1]}…", body, width - 2 * 170)
    # the whole block stands in the middle, a little above it, clear of X's corner
    block = leading * len(lines) + (34 + 42 * len(said) if said else 0) + 40 + DATE_SIZE
    top = max(70, (height - block) // 2 - 22)
    for index, line in enumerate(lines):
        draw.text((width / 2, top + index * leading), line, font=face, fill=(*INK, 255), anchor="ma")
    below = top + leading * len(lines) + 34
    for index, line in enumerate(said):
        draw.text((width / 2, below + index * 42), line, font=body, fill=(*MUTED, 255), anchor="ma")
    rule = below + (42 * len(said) if said else -34) + 26
    draw.rectangle((width / 2 - 30, rule, width / 2 + 30, rule + 4), fill=(*theme.accent, 255))
    stamp = notes_style.long_date(day).upper()
    _spaced(draw, (width / 2, rule + 22), stamp, _face(theme.heading_family, 700, DATE_SIZE, stamp), 2.4,
            (*MUTED, 255), centred=True)
    return card


def _ease(value: float) -> float:
    clamped = min(1.0, max(0.0, value))
    return clamped * clamped * (3 - 2 * clamped)


def _face(family: str, weight: int, size: int, text: str) -> ImageFont.FreeTypeFont:
    """The report's own face at ``size``, or the face of the script ``text`` is
    written in when that face lacks it (Arabic, Thai, …)."""
    files = html_engine.FAMILY_FILES.get(family) or html_engine.FAMILY_FILES[pdffonts.SANS]
    filename = files.get((weight, "normal")) or files[(400, "normal")]
    scripts = pdffonts.scripts_in(text)
    if scripts:
        filename = scripts[0].file
    try:
        return ImageFont.truetype(str(pdffonts.FONT_DIR / filename), size, layout_engine=ImageFont.Layout.RAQM)
    except (OSError, ImportError, KeyError):
        return ImageFont.truetype(str(pdffonts.FONT_DIR / filename), size)


def _fit(text: str, family: str, room: float, *, sizes: Iterable[int]) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """The title's size and lines: the largest of ``sizes`` that sets it in two lines
    while it stays large (`TWO_LINES`), else in three; the lines balanced, never one
    word left alone; at the smallest size, the third line cut with an ellipsis."""
    words = " ".join(text.split()) or "Untitled"
    tried = [(face, _wrap(words, face, room)) for face in (_face(family, 700, size, words) for size in sizes)]
    chosen = next(((face, lines) for face, lines in tried if len(lines) <= 2 and face.size >= TWO_LINES), None)
    chosen = chosen or next(((face, lines) for face, lines in tried if len(lines) <= 3), None)
    if chosen is None:
        face, lines = tried[-1]
        kept = lines[:3]
        kept[-1] = _ellipsis(f"{kept[-1]}…", face, room)
        return face, kept
    face, lines = chosen
    return face, _balanced(words, face, room, len(lines))


def _balanced(text: str, face: ImageFont.FreeTypeFont, room: float, count: int) -> list[str]:
    """``text`` in ``count`` lines as even as they can be: the narrowest measure that
    still holds it in that many."""
    narrow = max(face.getlength(word) for word in text.split())
    wide = room
    while wide - narrow > 4:
        middle = (narrow + wide) / 2
        if len(_wrap(text, face, middle)) <= count:
            wide = middle
        else:
            narrow = middle
    return _wrap(text, face, wide)


def _wrap(text: str, face: ImageFont.FreeTypeFont, room: float) -> list[str]:
    lines: list[str] = []
    line = ""
    for word in text.split():
        tried = f"{line} {word}" if line else word
        if face.getlength(tried) <= room or not line:
            line = tried
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def _ellipsis(text: str, face: ImageFont.FreeTypeFont, room: float) -> str:
    if face.getlength(text) <= room:
        return text
    cut = text.rstrip("…")
    while cut and face.getlength(f"{cut}…") > room:
        cut = cut[:-1]
    return f"{cut.rstrip(' ,;:·')}…"


def _spaced(draw: ImageDraw.ImageDraw, at: tuple[float, float], text: str, face: ImageFont.FreeTypeFont,
            tracking: float, fill: tuple[int, ...], *, centred: bool = False) -> None:
    """Small capitals set apart, as the report sets its dateline; ``centred`` on ``at``."""
    x, y = at
    if centred:
        x -= (sum(face.getlength(char) for char in text) + tracking * (len(text) - 1)) / 2
    for char in text:
        draw.text((x, y), char, font=face, fill=fill)
        x += face.getlength(char) + tracking


# -- a map page's cover --------------------------------------------------------------

#: A map page's cover, on the page's own dark (`reader.mappage.css`): the rules between its parts,
#: and its words in white at .84, .72 and .6 on that dark.
MAP_RULE = (58, 59, 61)
MAP_WORDS = (216, 216, 217)
MAP_QUIET = (188, 188, 189)
MAP_MUTED = (159, 160, 160)
#: The legend's column, as wide as the page's panel, and the room round what is set in it and the band.
MAP_PANEL = 336
MAP_PAD = 24
#: How large the cover draws the map's marks: one of the page's pixels to this many of its own.
MAP_MARKS = 1.0
#: How near the map's edge the cover keeps a mark it can keep, in the page's pixels.
MAP_MARGIN = 30.0
#: The credit's corner on the map, as the live map's sets it on imagery.
CREDIT_INK = (16, 18, 22, 168)
#: What a map with no ground stands on: the sea, the site atlas's land and its coast, light as a map's
#: plain background (`notes_maps.PLAIN_GROUND`), or dark on a dark base.
LAND_LIGHT = ((205, 214, 222), ImageColor.getrgb(notes_maps.PLAIN_GROUND)[:3], (176, 187, 197))
LAND_DARK = ((17, 19, 22), (42, 46, 52), (66, 72, 80))
#: The narrowest map whose land is drawn, in atlas units across: Natural Earth's outline at 1:110 million
#: places a coast to about a unit, too coarse to say where it runs on a closer map, which stays plain.
LAND_SPAN = 30.0


def map_cover(page: html_engine.MapPage, *, title: str, description: str, look: NoteLook | None = None,
              face: bytes | None = None) -> bytes:
    """A map page's picture, its link card and the picture of its line in a site's list: 1200 by 630,
    a JPEG with no metadata. The page as it shows once its map is up, in its own dark and faces: the
    band with its title, its line under it and the analyst, the map filling the rest with no band
    round it (`cover_frame`), its marks drawn as the page draws them, and its legend in a column at
    the right as the page's switcher lists it (`map_legend`). ``face`` is the author's picture the
    page shows by the name. Drawn from what the page holds, it fetches nothing."""
    theme = notes_style.theme_for(look or DEFAULT_LOOK)
    width, height = SHARE_SIZE
    card = Image.new("RGB", SHARE_SIZE, STORY_DARK)
    top = _map_band(card, page, title, description, theme.heading_family, face)
    rows = map_legend(page.map)
    side = MAP_PANEL if rows else 0
    drawn = _map_drawn(page.map, (width - side, height - top))
    card.paste(drawn, (0, top))
    _map_credit(card, page.map.data, (0, top, width - side, height), theme.heading_family)
    draw = ImageDraw.Draw(card)
    draw.rectangle((0, top - 1, width, top - 1), fill=MAP_RULE)
    if rows:
        draw.rectangle((width - side, top, width - side, height), fill=MAP_RULE)
        _map_key(card, rows, page.map.icons, (width - side + 1, top, width, height), theme.heading_family)
    buffer = BytesIO()
    card.save(buffer, "JPEG", quality=SHARE_QUALITY, optimize=True, progressive=True, subsampling=0)
    return buffer.getvalue()


def map_legend(derived: notes_maps.Derived) -> list[tuple[str, list[dict[str, Any]]]]:
    """A map's legend as a map page's switcher lists it: each layer, named when the map shows more
    than one ("" otherwise), with its rows in order; nothing when the map hides its legend."""
    if derived.display.get("legend") == "hidden":
        return []
    layers = list(dict.fromkeys(str(row.get("layer") or "") for row in derived.legend))
    return [(layer if len(layers) > 1 else "", [row for row in derived.legend if str(row.get("layer") or "") == layer])
            for layer in layers]


def cover_frame(data: Mapping[str, Any], width: float, height: float) -> list[float]:
    """The part of the world a map page's cover shows of its map, ``[w, s, e, n]``, in a picture of
    ``width`` by ``height``: where the page opens (`opens`, else its frame) held whole, as its live map
    shows it, as far as its ground reaches round it; past that, cut to the picture's shape inside the
    ground so that no band shows, and slid to keep in sight as many of its marks as it can, nearest
    to where the page looks. A map with no ground shows where the page opens, whole."""
    opened = data.get("opens") or data.get("bounds") or [-10.0, -10.0, 10.0, 10.0]
    x0, y0 = notes_maps.mercator(opened[0], opened[3])
    x1, y1 = notes_maps.mercator(opened[2], opened[1])
    wide, high = max(x1 - x0, 1e-12), max(y1 - y0, 1e-12)
    if wide / high > width / height:
        high = wide * height / width
    else:
        wide = high * width / height
    middle_x, middle_y = (x0 + x1) / 2, (y0 + y1) / 2
    placed = (data.get("ground") or {}).get("bounds")
    if placed and len(placed) == 4:
        gx0, gy0 = notes_maps.mercator(placed[0], placed[3])
        gx1, gy1 = notes_maps.mercator(placed[2], placed[1])
        shrink = min(1.0, (gx1 - gx0) / wide, (gy1 - gy0) / high)
        wide, high = wide * shrink, high * shrink
        margin = MAP_MARGIN * MAP_MARKS * wide / width
        marks = [notes_maps.mercator(lon, lat) for lon, lat in _marks_of(data)]
        middle_x = _slid([x for x, _ in marks], middle_x, wide, (gx0, gx1), margin)
        across = [y for x, y in marks if abs(x - middle_x) <= wide / 2 - margin]
        middle_y = _slid(across, middle_y, high, (gy0, gy1), margin)
    west, north = notes_maps.unmercator(middle_x - wide / 2, middle_y - high / 2)
    east, south = notes_maps.unmercator(middle_x + wide / 2, middle_y + high / 2)
    return [west, south, east, north]


def _marks_of(data: Mapping[str, Any]) -> Iterable[tuple[float, float]]:
    """Where each feature the map shows on its day stands, as the cover keeps them in sight: a point
    where it is, a line or an area at its name's place, else its middle."""
    day = str(data.get("day") or "")
    for feature in data.get("features") or []:
        if day and not notes_maps.shows_on(feature, day):
            continue
        spot = feature.get("coords") if feature.get("kind") == "point" else (
            feature.get("at") or notes_maps.label_anchor(feature))
        if spot:
            yield float(spot[0]), float(spot[1])


def _slid(values: list[float], middle: float, span: float, limits: tuple[float, float], margin: float) -> float:
    """Where a window ``span`` long on one axis stands, by its middle, inside ``limits``: the place
    holding the most of ``values`` at least ``margin`` from its ends, the nearest to ``middle`` of those."""
    lowest, highest = limits[0] + span / 2, limits[1] - span / 2
    if highest < lowest:
        return (limits[0] + limits[1]) / 2

    def inside(at: float) -> float:
        return min(max(at, lowest), highest)

    held = sorted(value for value in values if limits[0] <= value <= limits[1])
    room = max(0.0, span / 2 - margin)

    def holds(at: float) -> int:
        return bisect.bisect_right(held, at + room) - bisect.bisect_left(held, at - room)

    best = inside(middle)
    most = holds(best)
    for value in held:
        for at in (inside(value + room), inside(value - room)):
            count = holds(at)
            if count > most or (count == most and abs(at - middle) < abs(best - middle)):
                best, most = at, count
    return best


def _map_drawn(derived: notes_maps.Derived, size: tuple[int, int]) -> Image.Image:
    """The map in its part of the cover: its ground cut to fill it, or the land of a map with none,
    and its marks by the map's own painter, sized as the page draws them, a crowd its count."""
    width, height = size
    data = derived.data
    framed = {**data, "bounds": cover_frame(data, width, height)}
    plain = None if data.get("ground") else _land(framed["bounds"], (width * 2, height * 2), dark=data.get("base") == "dark")
    drawn = notes_maps.picture(framed, width, ground=derived.ground, icons=derived.icons, read_width=width / MAP_MARKS,
                               as_page=True, plain=plain)
    return drawn if drawn.size == size else drawn.resize(size, Image.Resampling.LANCZOS)


def _land(bounds: list[float], size: tuple[int, int], *, dark: bool) -> Image.Image:
    """What a map with no ground stands on, ``size`` pixels over ``bounds``: the site atlas's land on
    its sea when the map is wide enough for the outline to hold (`LAND_SPAN`), else the land's plain tone."""
    sea, ground, coast = LAND_DARK if dark else LAND_LIGHT
    west, south, east, north = bounds
    edges = [siteatlas.project(west + (east - west) * step / 8, lat) for step in range(9) for lat in (south, north)]
    edges += [siteatlas.project(lon, south + (north - south) * step / 8) for step in range(9) for lon in (west, east)]
    left, right = min(x for x, _ in edges), max(x for x, _ in edges)
    top, bottom = min(y for _, y in edges), max(y for _, y in edges)
    if right - left < LAND_SPAN:
        return Image.new("RGB", size, ground)
    picture = Image.new("RGB", size, sea)
    draw = ImageDraw.Draw(picture)
    x0, y0 = notes_maps.mercator(west, north)
    x1, y1 = notes_maps.mercator(east, south)
    scale_x, scale_y = size[0] / max(x1 - x0, 1e-12), size[1] / max(y1 - y0, 1e-12)
    shapes: list[list[tuple[float, float]]] = []
    for (ring_left, ring_top, ring_right, ring_bottom), corners in siteatlas.rings():
        if ring_right < left or ring_left > right or ring_bottom < top or ring_top > bottom:
            continue
        points = []
        for x, y in corners:
            mx, my = notes_maps.mercator(*siteatlas.unproject(x, y))
            points.append(((mx - x0) * scale_x, (my - y0) * scale_y))
        shapes.append(points)
        draw.polygon(points, fill=ground)
    for points in shapes:
        draw.line([*points, points[0]], fill=coast, width=2, joint="curve")
    return picture


def _map_band(card: Image.Image, page: html_engine.MapPage, title: str, description: str, family: str,
              face: bytes | None) -> int:
    """The page's band across the top: its title and the line under it at the left, the analyst at the
    right (their logo, picture and name on a line, their handle under it), both in its middle; where it
    ends."""
    width = SHARE_SIZE[0]
    draw = ImageDraw.Draw(card)
    who_face = _face(family, 700, 19, page.who)
    handle_face = _face(family, 400, 16, page.handle)
    pictures = [one for one in (_logo(page.logo, 38), _round_face(face, 38) if page.face else None) if one is not None]
    name_width = who_face.getlength(page.who) if page.who else 0.0
    line = sum(one.width + 10 for one in pictures) + name_width - (10 if pictures and not page.who else 0)
    signed = max(line, handle_face.getlength(page.handle) if page.handle else 0.0)
    signed_high = (38 if line else 0) + (24 if page.handle else 0)
    room = width - 2 * MAP_PAD - (signed + 36 if signed else 0)
    words = " ".join(title.split()) or "Untitled"
    heading, lines = _title_lines(words, family, room)
    leading = round(heading.size * 1.16)
    said = _face(family, 400, 18, description) if description else None
    under = _ellipsis(" ".join(description.split()), said, room) if said is not None else ""
    titles_high = leading * len(lines) + (30 if under else 0)
    inner = max(titles_high, signed_high)
    height = 18 + inner + 16
    top = 18 + (inner - titles_high) / 2
    for index, text in enumerate(lines):
        draw.text((MAP_PAD, top + index * leading), text, font=heading, fill=WHITE, anchor="la")
    if said is not None and under:
        draw.text((MAP_PAD, top + leading * len(lines) + 6), under, font=said, fill=MAP_WORDS, anchor="la")
    if signed:
        right = width - MAP_PAD
        y = 18 + (inner - signed_high) / 2
        if line:
            x = right - line
            for one in pictures:
                card.paste(one, (round(x), round(y + (38 - one.height) / 2)), one)
                x += one.width + 10
            if page.who:
                draw.text((right, y + 19), page.who, font=who_face, fill=WHITE, anchor="rm")
        if page.handle:
            draw.text((right, y + signed_high), page.handle, font=handle_face, fill=MAP_QUIET, anchor="rd")
    return round(height) + 1


def _title_lines(title: str, family: str, room: float) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """The title as the band sets it: one line as large as it reads, else two balanced lines, the
    second cut with an ellipsis at the smallest size."""
    for size in (32, 30):
        face = _face(family, 700, size, title)
        if face.getlength(title) <= room:
            return face, [title]
    for size in range(30, 23, -2):
        face = _face(family, 700, size, title)
        if len(_wrap(title, face, room)) <= 2:
            return face, _balanced(title, face, room, 2)
    lines = _wrap(title, face, room)
    return face, [lines[0], _ellipsis(f"{' '.join(lines[1:])}…", face, room)]


def _logo(path: Path | None, high: int) -> Image.Image | None:
    """The analyst's logo ``high`` pixels tall, as the page's header shows it; None when it cannot be read."""
    if path is None:
        return None
    try:
        with Image.open(path) as opened:
            if opened.width * opened.height > MAX_IMAGE_PIXELS:
                return None
            picture = ImageOps.exif_transpose(opened).convert("RGBA")
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        return None
    wide = max(1, min(high * 4, round(picture.width * high / max(1, picture.height))))
    return picture.resize((wide, high), Image.Resampling.LANCZOS)


def _round_face(data: bytes | None, side: int) -> Image.Image | None:
    """The author's picture in a circle ``side`` pixels across."""
    if not data:
        return None
    try:
        with Image.open(BytesIO(data)) as opened:
            square = ImageOps.fit(opened.convert("RGBA"), (side * 4, side * 4), Image.Resampling.LANCZOS)
    except (OSError, ValueError, UnidentifiedImageError):
        return None
    mask = Image.new("L", square.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, square.width - 1, square.height - 1), fill=255)
    square.putalpha(ImageChops.multiply(square.getchannel("A"), mask))
    return square.resize((side, side), Image.Resampling.LANCZOS)


def _map_credit(card: Image.Image, data: Mapping[str, Any], box: tuple[int, int, int, int], family: str) -> None:
    """What the map's ground owes, in its lower right corner, as the live map says it over imagery."""
    words = "; ".join(str(one) for one in data.get("credits") or [] if one)
    if not words:
        return
    left, top, right, bottom = box
    face = _face(family, 400, 13, words)
    words = _ellipsis(words, face, (right - left) * 0.8)
    wide = face.getlength(words) + 16
    corner = Image.new("RGBA", (round(wide), 22), (0, 0, 0, 0))
    shape = ImageDraw.Draw(corner)
    shape.rounded_rectangle((0, 0, corner.width + 6, corner.height + 6), radius=5, fill=CREDIT_INK)
    shape.text((8, 11), words, font=face, fill=(255, 255, 255, 220), anchor="lm")
    card.paste(corner, (right - corner.width, bottom - corner.height), corner)


def _map_key(card: Image.Image, rows: list[tuple[str, list[dict[str, Any]]]], icons: Mapping[str, Mapping[str, Any]],
             box: tuple[int, int, int, int], family: str) -> None:
    """The legend's column, as the page's panel lists it: Layers, then each layer's name over its rows,
    a row its symbol, its words on two lines at most and its count. Set smaller when that holds every
    row (`KEY_SCALES`), and what still does not fit is counted last."""
    left, top, right, bottom = box
    x0, x1 = left + MAP_PAD - 2, right - MAP_PAD
    floor = bottom - MAP_PAD
    y = top + MAP_PAD - 2.0
    for scale in KEY_SCALES:
        laid = _key_laid(rows, family, x1 - x0, scale)
        if y + sum(high for _, high, _ in laid) <= floor:
            break
    draw = ImageDraw.Draw(card)
    left_over = sum(len(items) for _, items in rows)
    after = round(24 * scale)
    for index, (kind, high, said) in enumerate(laid):
        # a layer's name only with its first row under it, and room kept to count what is left
        needs = high + (laid[index + 1][1] if kind == "layer" and index + 1 < len(laid) else 0)
        if kind != "label" and y + needs > floor - (after if left_over > 1 else 0):
            draw.text((x0, y + 6 * scale), f"and {left_over} more", font=_face(family, 400, round(15 * scale), "more"),
                      fill=MAP_MUTED, anchor="la")
            return
        if kind == "row":
            row, lines, words_face, count_face = said
            swatch = _key_swatch(row, icons, scale)
            middle = y + (high - KEY_GAP * scale) / 2
            card.paste(swatch, (round(x0 + 17 * scale - swatch.width / 2), round(middle - swatch.height / 2)), swatch)
            leading = KEY_LEADING * scale
            for number, text in enumerate(lines):
                draw.text((x0 + 44 * scale, middle + (number - (len(lines) - 1) / 2) * leading), text, font=words_face,
                          fill=MAP_WORDS, anchor="lm")
            draw.text((x1, middle), str(int(row.get("count") or 0)), font=count_face, fill=MAP_MUTED, anchor="rm")
            left_over -= 1
        else:
            face, text = said
            _small_caps(draw, (x0, y + (KEY_LAYER_GAP * scale if kind == "layer" and index > 1 else 0)), text, face, x1 - x0)
        y += high


#: The legend's sizes, tried in turn until every row fits: its words', a row's lines apart, the room
#: under a row, under the column's label and over a layer's name, at the largest.
KEY_SCALES = (1.0, 0.9, 0.8)
KEY_WORDS = 16
KEY_LEADING = 20.0
KEY_ROW = 28.0
KEY_GAP = 8.0
KEY_LABEL = 13
KEY_LAYER_GAP = 8.0


def _key_laid(rows: list[tuple[str, list[dict[str, Any]]]], family: str, wide: float,
              scale: float) -> list[tuple[str, float, Any]]:
    """The legend's column at ``scale``, as ``(kind, height, what)`` from the top: its label, each layer's
    name, each row with its lines and faces."""
    label = round(KEY_LABEL * scale)
    laid: list[tuple[str, float, Any]] = [("label", 30 * scale, (_face(family, 700, label, "LAYERS"), "Layers"))]
    count_face = _face(family, 400, round((KEY_WORDS - 1) * scale), "0123456789")
    for index, (layer, items) in enumerate(rows):
        if layer:
            laid.append(("layer", (25 + (KEY_LAYER_GAP if index else 0)) * scale,
                         (_face(family, 700, label, layer.upper()), layer)))
        for row in items:
            name = str(row.get("label") or layer or "")
            words_face = _face(family, 400, round(KEY_WORDS * scale), name)
            room = wide - 44 * scale - count_face.getlength(str(int(row.get("count") or 0))) - 12 * scale
            lines = _wrap(name, words_face, room) or [""]
            if len(lines) > 2:
                lines = [lines[0], _ellipsis(f"{' '.join(lines[1:])}…", words_face, room)]
            high = max(KEY_ROW, KEY_LEADING * len(lines)) * scale + KEY_GAP * scale
            laid.append(("row", high, (row, lines, words_face, count_face)))
    return laid


def _small_caps(draw: ImageDraw.ImageDraw, at: tuple[float, float], text: str, face: ImageFont.FreeTypeFont,
                room: float) -> None:
    """A label as the page's panel sets one, in spaced capitals; a script with no capitals as it is."""
    words = _ellipsis(" ".join(text.split()).upper(), face, room - 0.1 * face.size * len(text))
    if words.isascii():
        _spaced(draw, at, words, face, 0.1 * face.size, MAP_MUTED)
    else:
        draw.text(at, words, font=face, fill=MAP_MUTED)


def _key_swatch(row: Mapping[str, Any], icons: Mapping[str, Mapping[str, Any]], scale: float) -> Image.Image:
    """A legend row's symbol: a point's marker, a stretch of a line, a patch of an area, as the page draws
    them, at ``scale``."""
    style = row.get("style") or {}
    if row.get("kind") == "point":
        return notes_maps.marker(notes_maps.marker_key(style), style, icons, round(26 * scale))
    colour = _colour(style.get("color"))
    zoom = 4
    swatch = Image.new("RGBA", (32 * zoom, 20 * zoom), (0, 0, 0, 0))
    draw = ImageDraw.Draw(swatch)
    if row.get("kind") == "line":
        middle = 10 * zoom
        draw.line((3 * zoom, middle, 29 * zoom, middle), fill=(0, 0, 0, 72), width=6 * zoom)
        dash = {"dashed": (6, 4), "dotted": (1.2, 3.4)}.get(str(style.get("dash") or ""))
        x = 3.0
        while x < 29:
            end = min(29.0, x + dash[0]) if dash else 29.0
            draw.line((x * zoom, middle, end * zoom, middle), fill=(*colour, 255), width=round(3.4 * zoom))
            x = end + (dash[1] if dash else 0)
    else:
        draw.rounded_rectangle((3 * zoom, 3 * zoom, 29 * zoom, 17 * zoom), radius=2 * zoom, fill=(*colour, 72),
                               outline=(*colour, 255), width=round(2.2 * zoom))
    return swatch.resize((round(32 * scale), round(20 * scale)), Image.Resampling.LANCZOS)


def _colour(value: Any) -> tuple[int, int, int]:
    try:
        red, green, blue = ImageColor.getrgb(str(value or "#0072b2"))[:3]
    except ValueError:
        return (0, 114, 178)
    return red, green, blue


# -- the head and small helpers ------------------------------------------------------


def _head(title: str, description: str, where: str, *, hidden: bool = False) -> str:
    """What the page's head says of it to a site that draws its link; ``hidden``, an Unlisted page of
    the site, also asks search engines to leave it out."""
    image = f"{where}{SHARE}" if where else SHARE
    lines = ['<meta name="robots" content="noindex">'] if hidden else []
    if description:
        lines.append(f'<meta name="description" content="{_attr(description)}">')
    if where:
        lines.append(f'<link rel="canonical" href="{_attr(where)}">')
    lines += [
        '<meta property="og:type" content="article">',
        f'<meta property="og:title" content="{_attr(title)}">',
    ]
    if description:
        lines.append(f'<meta property="og:description" content="{_attr(description)}">')
    if where:
        lines.append(f'<meta property="og:url" content="{_attr(where)}">')
    lines += [
        f'<meta property="og:image" content="{_attr(image)}">',
        f'<meta property="og:image:width" content="{SHARE_SIZE[0]}">',
        f'<meta property="og:image:height" content="{SHARE_SIZE[1]}">',
        f'<meta property="og:image:alt" content="{_attr(title)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{_attr(title)}">',
    ]
    if description:
        lines.append(f'<meta name="twitter:description" content="{_attr(description)}">')
    lines += [
        f'<meta name="twitter:image" content="{_attr(image)}">',
        f'<meta name="twitter:image:alt" content="{_attr(title)}">',
    ]
    return "".join(f"{line}\n" for line in lines)


def _attr(value: str) -> str:
    return html.escape(value, quote=True)


def _md_line(text: str) -> str:
    """A line of the how-to as Markdown: each address in code, so no page reads it as markup."""
    return re.sub(r"https://\S+?/(?=[\s,.]|$)", lambda match: f"`{match.group(0)}`", text)


def _short_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]


def _inside(root: Path, relative: str) -> Path:
    """Where a file of the folder goes under ``root``: a plain relative path, never out of it."""
    pure = PurePosixPath(relative)
    if (not relative or pure.is_absolute() or "\\" in relative or ":" in relative
            or any(part in ("", ".", "..") for part in pure.parts) or relative != pure.as_posix()):
        raise NotesWebError(f"a file of the folder has a name it cannot have: {relative!r}")
    return root.joinpath(*pure.parts)


__all__ = [
    "ADDRESS", "COVER", "HOW_TO", "IMAGERY_HOSTS", "INDEX", "LIVE_DARK", "LIVE_HOST", "LIVE_LICENSE", "LIVE_MISSING",
    "LIVE_SOURCES", "LIVE_STYLE", "LIVE_VENDOR", "MAX_ADDRESS", "NOJEKYLL", "NO_ADDRESS", "NotesWebError", "PAGES_CARD", "PAGES_INTRO",
    "PAGES_PUBLIC", "PAGES_STEPS", "PAGES_UPDATE", "SHARE", "SHARE_SIZE", "UPLOAD", "WEB_DIR", "WebBuild", "address",
    "build", "cover_frame", "folder_csp", "folder_name", "how_to", "live_maps", "map_cover", "map_legend", "share_card",
    "write",
]
