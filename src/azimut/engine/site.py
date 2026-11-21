"""The analyst's website on GitHub Pages: its cards, its list, its feed and its sitemap.

Every article Azimut publishes carries a card, `article.json`, in its folder. Each
publish reads the cards of the whole site and writes what is made from them: the list
(`articles.json`), the feed (`feed.xml`), the sitemap (`sitemap.xml`) and the lists
between `<!-- azimut:articles … -->` markers in the pages that carry them. This is the
pure half, which touches no file and no network: `engine/sitesync.py` gathers the
repository's state and `engine/githubpages.py` commits the result in the one publish
commit. The default home page is `engine/sitehome.py`.

**Who owns what.** Azimut only ever writes a file it made; everything else in the
repository is the analyst's.

- An article folder is Azimut's when it holds Azimut's marker files (`githubpages.OURS`).
- `articles.json` is Azimut's when its `format` is `azimut-site/1`.
- `feed.xml` is Azimut's when its channel holds `<generator>Azimut</generator>`.
- `sitemap.xml` is Azimut's when the comment `<!-- generator: Azimut -->` follows its
  XML declaration.
- The root `index.html` is Azimut's when it holds `<meta name="generator" content="Azimut
  <version>">`. With none, Azimut writes its default home; with one that is not its own, it
  never rewrites it and only fills its markers.
- The content between `<!-- azimut:articles … -->` and `<!-- /azimut:articles -->` is
  Azimut's, in the root `index.html` and in `<folder>/index.html` one level down for a folder
  holding no card. Everything outside the markers is never touched.
- `azimut-bar.html` at the root is the analyst's: its header, which every article page carries
  in place of Azimut's bar (`own_bar`), between `<!-- azimut:bar -->` and `<!-- /azimut:bar -->`
  right after `<body>`. What is between those markers is Azimut's, in its own article folders
  only; a map page has none. `articles.json` keeps which bar they carry as `bar`
  (`engine/sitesync.py`).

A file Azimut would write but does not own is left as it is, and the rest still happens.

**The card** (format `azimut-article/1`): title, summary, date (`YYYY-MM-DD`), category,
author, role (`article`, `page` or `unlisted`), layout (`article`, `story` or `map`), image (relative to
the folder), links (the folders of the site the page points to) and maps (written by hand
for maps kept elsewhere: Azimut writes none). The folder holding the card, relative to the
site root, is the article's address.

An article may also stand somewhere, for a map of the site's articles: `place`,
`{"lat": 12.725004, "lon": 43.5075, "name": "Bab al-Mandab, Yemen"}`, in decimal degrees to six
places, lat within ±85 and lon within ±180, its name at most 80 characters and "" for none
(`notelook.NotePlace`). The key is written only when the note has a place, so a card without one
is the card it always was; being optional, it keeps the format `azimut-article/1`. A line of
`articles.json` carries it the same way, and a place a hand edit left unreadable is dropped, the
line kept.

A map page cited by an article shows as a link under that article, never as its own line; a
map nothing cites keeps its own line so it is never lost. A page (`role: "page"`) is on no
list: it is in `articles.json` under `pages`, and the default home's header links it. An
unlisted page (`role: "unlisted"`) is online at its address and nowhere else: in no list, no feed,
no sitemap, no `articles.json`, and its category adds none; a card that names it never folds it
under itself, and Read the site (`sitesync.survey`) still shows it.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timezone
from email.utils import format_datetime
from html.parser import HTMLParser
from typing import Any, Literal, Mapping
from urllib.parse import urlsplit

from pydantic import ValidationError

from .notelook import CATEGORY_MAX, NotePlace

CARD = "article.json"
CARD_FORMAT = "azimut-article/1"
SITE_FORMAT = "azimut-site/1"
ARTICLES = "articles.json"
FEED = "feed.xml"
SITEMAP = "sitemap.xml"
HOME = "index.html"
#: The folders a site holds that no card lives in.
SKIP = frozenset({".git", "theme", "wp-content"})
MARKER = re.compile(r"<!-- azimut:articles(?P<attrs>[^>]*?)-->.*?<!-- /azimut:articles -->", re.S)
ATTR = re.compile(r'(\w+)="([^"]*)"')
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December")

#: How many cards a site is read for, and how large one may be: past either, the list is
#: left as it was rather than the publish failing.
MAX_CARDS = 500
MAX_CARD_BYTES = 64 * 1024
#: How many marked pages one publish looks through, and how large one may be.
MAX_PAGES = 60
MAX_PAGE_BYTES = 2 * 1024 * 1024
#: How many lines the feed carries.
FEED_ITEMS = 30
#: What a card's words are bounded to, so a hand-edited card cannot swell a page.
MAX_TITLE = 300
MAX_SUMMARY = 1000
MAX_LINKS = 60
MAX_MAPS = 60

ARTICLE = "article"
PAGE = "page"
UNLISTED = "unlisted"
ROLES = (ARTICLE, PAGE, UNLISTED)
LAYOUTS = ("article", "story", "map")
#: The page's own counting readers: GoatCounter's host under the analyst's site code, and the
#: two hosts Cloudflare Web Analytics needs, which a page's policy lets in and no other.
GOATCOUNTER_HOST = "https://{code}.goatcounter.com"
CLOUDFLARE_SCRIPT_HOST = "https://static.cloudflareinsights.com"
CLOUDFLARE_CONNECT_HOST = "https://cloudflareinsights.com"
STATS = ("", "goatcounter", "cloudflare")
COUNTER_CODE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$")
BEACON_TOKEN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
AZIMUT_REPO = "https://github.com/OsintMeThat/azimut"

# -- what the tool says about it (Settings › Website, HOW-TO-PUBLISH.md) ------------------------

SITE_TITLE = "Website"
SITE_INTRO = ("Publish your notes as a simple website on GitHub Pages: a home page and the list of your "
              "articles, kept up to date each time you publish.")
SITE_STAYS_YOURS = "The site stays yours to change, and Azimut only ever rewrites the files it made."
SITE_OWN_TITLE = "Make it yours"
#: Each way to make the site one's own: its lead, then what to do.
SITE_OWN: tuple[tuple[str, str], ...] = (
    ("Your own home page", "write your `index.html` and put `<!-- azimut:articles -->` "
                           "`<!-- /azimut:articles -->` where the list goes."),
    ("Your own bar", "put your header and its `<style>` in `azimut-bar.html` at the site's root: articles carry it "
                     "in place of Azimut's bar, maps keep theirs, and Update the site brings an edit to all of them. "
                     "Scripts are dropped, links start from the site's root, and each `<svg>` needs a `width` and "
                     "a `height`."),
    ("A page per category", 'the same markers with `section="Investigations"` list that category only.'),
    ("Your own domain", "buy one, then point it to GitHub Pages "
                        "([GitHub's guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site))."),
    ("Your own scripts", "`articles.json` lists every article with its title, date, category and picture."),
)
LEGAL_SENTENCE = "Depending on your country, a website may need a legal notice."
LEGAL_TITLE = "Legal notice"
PRIVACY_TITLE = "Privacy"
#: GitHub's address, as its privacy statement gives it (docs.github.com, read on 2026-11-21).
LEGAL_HOST = "GitHub, Inc., 88 Colin P. Kelly Jr. St., San Francisco, CA 94107, United States"
HAND_EDITED = "This folder was changed on GitHub since you published it: publishing replaces it."
WORKFLOW_NOTICE = "Pages here is built by a GitHub Actions workflow: its build must copy Azimut's folders through to the site."
TREE_TOO_LONG = ("The site holds too many files for Azimut to read: its home, list, feed and sitemap "
                 "were left as they were.")
TOO_MANY_CARDS = (f"The site holds more than {MAX_CARDS} cards: its home, list, feed and sitemap "
                  "were left as they were.")


def legal_notice() -> str:
    """The starter text of the Legal notice page: the host named, the publisher's own lines
    left for the analyst to fill in."""
    return (f"## Publisher\n\nName:\n\nAddress:\n\nContact:\n\n## Host\n\n"
            f"This website is hosted by GitHub Pages, a service of {LEGAL_HOST}.\n")


#: What the Privacy page says of each way the site counts its readers (`STATS`).
COUNTING_SAID = {
    "": "This site does not count its readers.",
    "goatcounter": "Visits are counted with GoatCounter, which sets no cookie and keeps no personal data: "
                   "the site sees totals only.",
    "cloudflare": "Visits are counted with Cloudflare Web Analytics, which stores nothing on your device: your "
                  "browser sends Cloudflare the page's address and how it loaded, and the site sees totals only.",
}


def privacy_notice(stats: str) -> str:
    """The starter text of the Privacy page: no cookie, what counting the site does for ``stats``
    (`STATS`: none, GoatCounter or Cloudflare Web Analytics), the host's logs, and the line for the
    analyst's contact left to fill in."""
    return ("## Cookies\n\nThis site sets no cookies and has no accounts, forms or newsletter.\n\n"
            f"## Counting readers\n\n{COUNTING_SAID.get(stats, COUNTING_SAID[''])}\n\n"
            "## Host\n\nGitHub, which hosts the site on GitHub Pages, logs visitors' IP addresses for security, "
            "as its documentation says.\n\n"
            "## Your data\n\nFor any question about your data, write to:\n\n"
            "You can also complain to your country's data protection authority.\n")


# -- the site ------------------------------------------------------------------------------------


#: What `Placement.place` holds while the dialog said nothing of the place: the look's own stands.
OWN_PLACE: Literal["own"] = "own"


@dataclass(frozen=True)
class Placement:
    """How a note is published to the site: the site, and what the publish dialog chose for
    this note. ``category`` and ``role`` left as None are the note's own, kept in its look."""

    site: "Site"
    category: str | None = None
    role: str | None = None
    #: The place the card carries (`NotePlace`), None for none, or `OWN_PLACE` for the look's own.
    place: NotePlace | None | Literal["own"] = OWN_PLACE

    def card_place(self, kept: NotePlace | None) -> NotePlace | None:
        """The place the card carries: the one the dialog chose, else ``kept``, the look's."""
        return kept if isinstance(self.place, str) else self.place


@dataclass(frozen=True)
class Site:
    """The site as Settings › Website describes it, and the address it is served at."""

    title: str
    #: Where the site is served, with its closing slash (`githubpages.site_base`).
    address: str
    tagline: str = ""
    #: Who an article is by when its card says nobody else: the report name, else the title.
    author: str = ""
    #: Whether the default home ends on "Made with Azimut" (`site_credit_azimut`).
    credit: bool = True
    stats: str = ""
    code: str = ""
    token: str = ""
    #: The logo the site carries (`config.site_logo`: its own, else the Publishing logo), or None for none.
    logo: bytes | None = field(default=None, repr=False)

    @property
    def prefix(self) -> str:
        """The address's path with no closing slash: "" on a domain's root, else `/articles`."""
        return urlsplit(self.address).path.rstrip("/")

    @property
    def counter(self) -> str:
        """The GoatCounter site code that counts the pages, or "" for none."""
        return self.code if self.stats == "goatcounter" else ""

    @property
    def beacon(self) -> str:
        """The Cloudflare Web Analytics token that counts the pages, or "" for none."""
        return self.token if self.stats == "cloudflare" else ""


def one_line(value: Any, limit: int) -> str:
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def from_settings(settings: Mapping[str, Any], *, address: str, account: str, logo: bytes | None = None) -> Site:
    """The site as the saved settings say it, each part read again as Settings checks it: a
    count whose code or token does not read as one counts nobody."""
    report = one_line(settings.get("report_name"), 80)
    title = one_line(settings.get("site_title"), 120) or report or account
    stats = settings.get("site_stats") if settings.get("site_stats") in STATS else ""
    code = str(settings.get("site_stats_code") or "").strip().lower()
    token = str(settings.get("site_stats_token") or "").strip()
    if stats == "goatcounter" and not COUNTER_CODE.match(code):
        stats = ""
    if stats == "cloudflare" and not BEACON_TOKEN.match(token):
        stats = ""
    return Site(title=title, address=address, tagline=one_line(settings.get("site_tagline"), 200),
                author=report or title, credit=settings.get("site_credit_azimut") is not False,
                stats=str(stats), code=code if COUNTER_CODE.match(code) else "",
                token=token if BEACON_TOKEN.match(token) else "", logo=logo)


#: The settings of Settings › Website that are read and written as preferences.
PREF_KEYS = ("site_title", "site_tagline", "site_credit_azimut", "site_stats", "site_stats_code", "site_stats_token")


def prefs_of(settings: Mapping[str, Any]) -> dict[str, Any]:
    """The website's settings as Settings shows them: each bounded, and a part that does not read
    as one shown empty. What is saved is not changed, so a count named but missing its code shows so."""
    stats, code, token = settings.get("site_stats"), str(settings.get("site_stats_code") or ""), \
        str(settings.get("site_stats_token") or "")
    return {
        "site_title": one_line(settings.get("site_title"), 120),
        "site_tagline": one_line(settings.get("site_tagline"), 200),
        "site_credit_azimut": settings.get("site_credit_azimut") is not False,
        "site_stats": stats if stats in STATS else "",
        "site_stats_code": code.strip().lower() if COUNTER_CODE.match(code.strip().lower()) else "",
        "site_stats_token": token.strip() if BEACON_TOKEN.match(token.strip()) else "",
    }


def categories_read(value: Any) -> list[str]:
    """The categories a site was last read to hold, as saved: lines of a few words, no two alike."""
    if not isinstance(value, list):
        return []
    return sorted({one for one in (one_line(item, CATEGORY_MAX) for item in value[:200]) if one})[:100]


def cloudflare_tag(token: str) -> str:
    """The script Cloudflare Web Analytics asks for, which counts a page's readers with no cookie."""
    return (f"<script type='module' src='{CLOUDFLARE_SCRIPT_HOST}/beacon.min.js' "
            f"data-cf-beacon='{{\"token\": \"{token}\"}}'></script>")


def stats_sources(counter: str = "", beacon: str = "") -> dict[str, tuple[str, ...]]:
    """What a counting page adds to its policy: the one host of each count it makes, and nothing else."""
    extra: dict[str, tuple[str, ...]] = {}
    if counter:
        host = GOATCOUNTER_HOST.format(code=counter)
        extra["img-src"] = (host,)
        extra["connect-src"] = (host,)
    if beacon:
        extra["script-src"] = (CLOUDFLARE_SCRIPT_HOST,)
        extra["connect-src"] = (*extra.get("connect-src", ()), CLOUDFLARE_CONNECT_HOST)
    return extra


# -- the back-to-site bar --------------------------------------------------------------------------

BAR_STYLE = """<style>
.az-site-bar{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:.6rem;padding:.45rem 1rem;
background:rgba(255,255,255,.94);backdrop-filter:blur(6px);border-bottom:1px solid #dedad3;
font:500 .9rem/1 az-head,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.az-site-bar a{color:#1f2023;text-decoration:none;display:flex;align-items:center;gap:.5rem}
.az-site-bar img{width:1.5rem;height:1.5rem;border-radius:50%}
.az-site-bar .back{margin-left:auto;color:#62676f}
.az-site-bar a:hover{color:#1f4e79}
.az-site-crumb{display:inline-flex;align-items:center;gap:.4rem;margin-bottom:.35rem;color:inherit;opacity:.75;text-decoration:none;
font:500 .8rem/1 az-head,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.az-site-crumb:hover{opacity:1}
.az-site-crumb img{width:1.1rem;height:1.1rem;border-radius:50%}
.az-site-crumb::before{content:"← "}
</style>"""


@dataclass(frozen=True)
class Frame:
    """How a page published to the site is framed (`notes_html.Folder.frame`): the way back to
    the site, and the counts every page of it makes. A web folder exported by hand has none."""

    title: str
    #: Where the site's home is from the page, which is always one folder down.
    home: str = "../"
    logo: bytes | None = field(default=None, repr=False)
    counter: str = ""
    beacon: str = ""


def frame_of(site: Site) -> Frame:
    return Frame(title=site.title, logo=site.logo, counter=site.counter, beacon=site.beacon)


def bar(frame: Frame, logo: str) -> str:
    """The bar above an article: the site's logo and title linking home, and All articles
    on the right. ``logo`` is the address of the logo's file in the page's folder, "" for none."""
    home = html.escape(frame.home)
    picture = f'<img src="{html.escape(logo)}" alt="">' if logo else ""
    return (f'{BAR_STYLE}<nav class="az-site-bar" aria-label="Site"><a href="{home}">{picture}'
            f'{html.escape(frame.title)}</a><a class="back" href="{home}">All articles</a></nav>')


def crumb(frame: Frame, logo: str) -> str:
    """The way home on a map page, which fills the screen: a small link inside the map's own
    header, never a bar above it."""
    picture = f'<img src="{html.escape(logo)}" alt="">' if logo else ""
    return (f'{BAR_STYLE}<a class="az-site-crumb" href="{html.escape(frame.home)}">{picture}'
            f'{html.escape(frame.title)}</a>')


# -- the bar between its markers, Azimut's or the site's own -----------------------------------------
#
# An article page starts with its bar between `<!-- azimut:bar -->` and `<!-- /azimut:bar -->`,
# right after `<body>`, so that Update the site can change it in every article without a
# republish. A map page has no bar, only its crumb, and so no markers.

BAR_OPEN = b"<!-- azimut:bar -->"
BAR_CLOSE = b"<!-- /azimut:bar -->"
_BODY = re.compile(rb"<body\b[^>]*>")
#: Where an article's folder keeps the site's logo its bar shows (`notes_html._way_home`).
LOGO_FILE = re.compile(r"^assets/[0-9a-f]{8,16}-site-logo\.png$")


def marked_bar(frame: Frame, logo: str) -> str:
    """Azimut's bar (`bar`) between the markers, as an article page carries it."""
    return f"{BAR_OPEN.decode()}{bar(frame, logo)}{BAR_CLOSE.decode()}"


def _bar_span(page: bytes) -> tuple[int, int] | None:
    """Where the bar is in a page: between the markers that open its body, and nowhere else."""
    body = _BODY.search(page)
    if body is None or not page.startswith(BAR_OPEN, body.end()):
        return None
    start = body.end() + len(BAR_OPEN)
    end = page.find(BAR_CLOSE, start)
    return (start, end) if end >= 0 else None


def bar_in(page: bytes) -> bytes | None:
    """What a page holds between its bar's markers, None for a page that has none."""
    span = _bar_span(page)
    return page[span[0]:span[1]] if span is not None else None


def with_bar(page: bytes, inner: str) -> bytes | None:
    """The page with ``inner`` between its bar's markers and every other byte as it was; None for
    a page that has no markers, which is never changed."""
    span = _bar_span(page)
    if span is None:
        return None
    return page[:span[0]] + inner.encode("utf-8") + page[span[1]:]


def without_bar(page: bytes) -> bytes:
    """The page with nothing between its bar's markers: what is the same whichever bar it carries."""
    span = _bar_span(page)
    return page if span is None else page[:span[0]] + page[span[1]:]


def is_azimut_bar(inner: bytes) -> bool:
    """Whether what a page holds between its markers is Azimut's own bar, whatever its title and logo."""
    return inner.startswith(BAR_STYLE.encode("utf-8") + b'<nav class="az-site-bar"')


# -- the site's own bar: azimut-bar.html ---------------------------------------------------------
#
# The file holds the site's header and its own `<style>`. An article page carries it in place of
# Azimut's bar, read and cleaned at each publish and Update the site:
#
# - it is put in a declarative shadow root (`<template shadowrootmode="open">` in `<azimut-bar>`),
#   so the reader's rules never reach it and its rules never reach the article;
# - its `@font-face` rules go to the page itself, where a font is registered, the rest stays inside;
# - what could run or reach elsewhere is dropped: `<script>`, `<iframe>`, `<object>`, `<embed>`,
#   `<template>`, `<form>`, `<base>`, `<meta>`, `<link>`, SVG animation, every `on*` attribute
#   and every address that is not http(s), mailto or tel; comments go too;
# - an address relative to the site's root (`theme/logo.png`, `./`) is made relative to the article,
#   one folder down (`../theme/logo.png`); an absolute one or one from the root (`/theme/…`) is kept;
# - an `<svg>` given no width or height is held to 1.5em, so a stylesheet missing never blows it up.
#
# Past `MAX_OWN_BAR_BYTES`, or when it does not read as HTML, the articles keep Azimut's bar and a
# word says so. The page's policy (`notes_web.folder_csp`) lets in inline styles, and pictures and
# fonts from the site itself only.

OWN_BAR = "azimut-bar.html"
MAX_OWN_BAR_BYTES = 64 * 1024
OWN_BAR_TOO_LARGE = f"{OWN_BAR} is larger than {MAX_OWN_BAR_BYTES // 1024} KB: the articles keep Azimut's bar."
OWN_BAR_UNREAD = f"{OWN_BAR} does not read as HTML: the articles keep Azimut's bar."
#: What the bar's own sheet starts with: a box of its own, nothing inherited from the article, and
#: an unsized picture held small. Its own rules come after, and win.
OWN_BAR_BASE = (":host{all:initial;display:block}:where(svg:not([width])){width:1.5em}"
                ":where(svg:not([height])){height:1.5em}:where(img){max-width:100%}")
#: The element the site's bar lives in, which no rule of the reader names.
OWN_BAR_HOST = "azimut-bar"

_VOID = frozenset({"area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param",
                   "source", "track", "wbr"})
_HTML_KEPT = frozenset({
    "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "button", "caption", "cite",
    "code", "col", "colgroup", "data", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure",
    "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "img", "input", "ins", "kbd", "label",
    "li", "main", "mark", "menu", "nav", "ol", "p", "picture", "pre", "q", "rp", "rt", "ruby", "s", "samp", "search",
    "section", "small", "source", "span", "strong", "sub", "summary", "sup", "svg", "table", "tbody", "td", "tfoot",
    "th", "thead", "time", "tr", "u", "ul", "var", "wbr"})
#: What an `<svg>` may hold, by the lower-case names the parser gives.
_SVG_KEPT = frozenset({
    "a", "circle", "clippath", "defs", "desc", "ellipse", "feblend", "fecolormatrix", "fecomposite", "fedropshadow",
    "feflood", "fegaussianblur", "femerge", "femergenode", "feoffset", "filter", "g", "image", "line",
    "lineargradient", "marker", "mask", "path", "pattern", "polygon", "polyline", "radialgradient", "rect", "stop",
    "svg", "symbol", "text", "textpath", "title", "tspan", "use"})
#: What goes with everything it holds.
_DROPPED = frozenset({
    "animate", "animatecolor", "animatemotion", "animatetransform", "applet", "audio", "base", "canvas", "datalist",
    "dialog", "discard", "embed", "fencedframe", "foreignobject", "form", "frame", "frameset", "iframe", "link",
    "math", "meta", "noembed", "noframes", "noscript", "object", "optgroup", "option", "param", "plaintext",
    "portal", "script", "select", "set", "template", "textarea", "title", "track", "video", "xmp"})
_ATTR_NAME = re.compile(r"^[a-z_:][a-z0-9_:.-]*$")
_ATTRS_DROPPED = frozenset({
    "action", "autofocus", "codebase", "data", "dynsrc", "formaction", "http-equiv", "is", "lowsrc", "manifest",
    "nonce", "ping", "shadowroot", "shadowrootclonable", "shadowrootdelegatesfocus", "shadowrootmode",
    "shadowrootserializable", "srcdoc", "xml:base"})
_URL_ATTRS = frozenset({"background", "cite", "href", "longdesc", "poster", "src", "xlink:href"})
_SCHEME = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*):")
_SCHEMES = frozenset({"http", "https", "mailto", "tel"})
_CUSTOM = re.compile(r"^[a-z][a-z0-9._]*-[a-z0-9._-]*$")
_CSS_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_CSS_URL = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)""", re.I)
_CSS_IMPORT = re.compile(r"""@import\s+(?:"([^"]*)"|'([^']*)')""", re.I)
_FONT_FACE = re.compile(r"@font-face\s*\{[^}]*\}", re.I)
#: A face of the reader's own (`az-head`, `az-body`, …), which a face of the bar's must not replace.
_READER_FACE = re.compile(r"""font-family\s*:\s*["']?az-""", re.I)


def _from_root(address: str, home: str) -> str | None:
    """An address of the bar as a page one folder down reads it: one relative to the site's root
    made relative to the page, one from the root, absolute or a fragment kept; None for a scheme
    that is not http(s), mailto or tel."""
    text = address.strip()
    scheme = _SCHEME.match(re.sub(r"[\x00-\x20\x7f]", "", text))
    if scheme is not None:
        return text if scheme.group(1).lower() in _SCHEMES else None
    if text.startswith(("/", "#", "\\")):
        return text
    return home + text


def _css_from_root(css: str, home: str) -> str:
    """A stylesheet of the bar with its relative addresses made the page's, and no `<` left in it,
    so it can never close the element it is in nor a marker."""

    def moved(found: re.Match[str], form: str) -> str:
        given = next(group for group in found.groups() if group is not None)
        where = _from_root(given, home) if given.strip() else given
        return form.format(given if where is None else where.replace('"', "%22"))

    css = _CSS_URL.sub(lambda found: moved(found, 'url("{}")'), css)
    css = _CSS_IMPORT.sub(lambda found: moved(found, '@import "{}"'), css)
    return css.replace("<", "\\3c ")


class _BarCleaner(HTMLParser):
    """The site's bar read token by token and written again from what is kept: balanced, every
    word and value escaped, so nothing it holds can close what Azimut puts it in."""

    def __init__(self, home: str) -> None:
        super().__init__(convert_charrefs=True)
        self.home = home
        self.out: list[str] = []
        self.css: list[str] = []
        #: the elements written and still open, the innermost last; those dropped whole, likewise
        self.open: list[str] = []
        self.skip: list[str] = []
        self.styling = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, closed=False)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, closed=True)

    def _start(self, tag: str, attrs: list[tuple[str, str | None]], *, closed: bool) -> None:
        in_svg = "svg" in self.open
        if self.skip:
            if tag not in _VOID:
                self.skip.append(tag)
            return
        if tag in _DROPPED and not (tag == "title" and in_svg):
            # outside an <svg>, a browser reads `<script/>` as `<script>`: what follows is inside it
            if tag not in _VOID and not (closed and in_svg):
                self.skip.append(tag)
            return
        if tag == "style":
            self.styling = not (closed and in_svg)
            return
        if not (tag in (_SVG_KEPT if in_svg else _HTML_KEPT) or _CUSTOM.match(tag)):
            return  # an element Azimut does not know: its words stay, its tag goes
        if tag in _VOID and not in_svg:
            self.out.append(f"<{tag}{self._attrs(attrs)}>")
        elif closed and in_svg:
            self.out.append(f"<{tag}{self._attrs(attrs)}/>")
        else:
            self.out.append(f"<{tag}{self._attrs(attrs)}>")
            if closed:
                self.out.append(f"</{tag}>")
            else:
                self.open.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.skip:
            if tag in self.skip:
                del self.skip[len(self.skip) - 1 - self.skip[::-1].index(tag):]
            return
        if tag == "style":
            self.styling = False
            return
        if tag in self.open:
            while self.open:
                last = self.open.pop()
                self.out.append(f"</{last}>")
                if last == tag:
                    break

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        if self.styling:
            self.css.append(data)
        else:
            self.out.append(html.escape(data, quote=False))

    def _attrs(self, attrs: list[tuple[str, str | None]]) -> str:
        kept: dict[str, str] = {}
        for name, given in attrs:
            if name in kept or not _ATTR_NAME.match(name) or name.startswith("on") or name in _ATTRS_DROPPED:
                continue
            text = given or ""
            value: str | None = text
            if name in _URL_ATTRS:
                value = _from_root(text, self.home)
            elif name in ("srcset", "imagesrcset"):
                value = self._srcset(text)
            elif name == "style":
                value = _css_from_root(_CSS_COMMENT.sub("", text), self.home)
            if value is not None:
                kept[name] = value
        return "".join(f' {name}="{html.escape(value, quote=True)}"' for name, value in kept.items())

    def _srcset(self, value: str) -> str | None:
        out = []
        for candidate in value.split(","):
            parts = candidate.split()
            if not parts:
                continue
            where = _from_root(parts[0], self.home)
            if where is None:
                return None
            out.append(" ".join([where, *parts[1:]]))
        return ", ".join(out)

    def finish(self) -> str:
        self.close()
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        return "".join(self.out)


def own_bar(data: bytes | None, home: str = "../") -> tuple[str, str]:
    """The site's own bar (``data``, its `azimut-bar.html`) as an article page carries it between its
    markers, for a page ``home`` below the site's root, and the word to say: ("", "") with no file,
    ("", why) when it is past `MAX_OWN_BAR_BYTES` or does not read, and the page keeps Azimut's bar."""
    if data is None:
        return "", ""
    if len(data) > MAX_OWN_BAR_BYTES:
        return "", OWN_BAR_TOO_LARGE
    try:
        cleaner = _BarCleaner(home)
        cleaner.feed(data.decode("utf-8").removeprefix("\ufeff"))
        markup = cleaner.finish()
    except (UnicodeDecodeError, AssertionError, ValueError):
        return "", OWN_BAR_UNREAD
    if not markup.strip():
        return "", OWN_BAR_UNREAD
    css = _css_from_root(_CSS_COMMENT.sub("", "\n".join(cleaner.css)), home)
    faces = [face for face in _FONT_FACE.findall(css) if not _READER_FACE.search(face)]
    sheet = _FONT_FACE.sub("", css).strip()
    fonts = f"<style>{''.join(faces)}</style>" if faces else ""
    return (f'{fonts}<{OWN_BAR_HOST}><template shadowrootmode="open"><style>{OWN_BAR_BASE}{sheet}</style>'
            f"{markup}</template></{OWN_BAR_HOST}>"), ""


# -- ownership --------------------------------------------------------------------------------------

_GENERATOR_HOME = re.compile(r'<meta\s+name="generator"\s+content="Azimut \d[^"]*"\s*/?>')
_GENERATOR_SITEMAP = re.compile(r"\A\s*<\?xml[^>]*\?>\s*<!-- generator: Azimut -->")


def owns_articles(text: str) -> bool:
    try:
        data = json.loads(text)
    except ValueError:
        return False
    return isinstance(data, dict) and data.get("format") == SITE_FORMAT


def owns_feed(text: str) -> bool:
    return "<generator>Azimut</generator>" in text


def owns_sitemap(text: str) -> bool:
    return _GENERATOR_SITEMAP.match(text) is not None


def owns_home(text: str) -> bool:
    """Whether the root page is the default home Azimut wrote: its generator carries a version,
    which an article page's does not, so a page of the analyst's made by Azimut is never taken."""
    return _GENERATOR_HOME.search(text) is not None


# -- the card ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Card:
    """The card Azimut writes into a published folder."""

    title: str
    summary: str
    date: str
    category: str = ""
    author: str = ""
    role: str = ARTICLE
    layout: str = "article"
    image: str = ""
    links: tuple[str, ...] = ()
    #: Where the article stands on a map of the site's articles, None for nowhere.
    place: NotePlace | None = None

    def dated(self, day: str) -> "Card":
        return replace(self, date=day)

    def as_json(self) -> bytes:
        card: dict[str, Any] = {
            "format": CARD_FORMAT, "title": self.title, "summary": self.summary, "date": self.date,
            "category": self.category, "author": self.author, "role": self.role, "layout": self.layout,
            "image": self.image, "links": list(self.links), "maps": []}
        if self.place is not None:
            card["place"] = self.place.model_dump(mode="json")
        return (json.dumps(card, indent=1, ensure_ascii=False) + "\n").encode("utf-8")


def is_card(data: bytes) -> bool:
    """Whether a file is a card Azimut wrote, by its format alone."""
    try:
        card = json.loads(data)
    except ValueError:
        return False
    return isinstance(card, dict) and card.get("format") == CARD_FORMAT


def card_date(data: bytes) -> str:
    """The date a card already in the repository carries, "" when it holds none that reads."""
    try:
        card = json.loads(data)
        day = card.get("date") if isinstance(card, dict) else None
        return date.fromisoformat(day).isoformat() if isinstance(day, str) and len(day) == 10 else ""
    except ValueError:
        return ""


def links_of(page: str, site: Site, own: str) -> tuple[str, ...]:
    """The folders of the site a page links to, read from its markup: an `<a>` to the site's own
    address (a folder under it) or to the folder above (`../folder/`), as the page that is one
    folder down writes them. The page's own folder and the way home are not among them."""
    found: dict[str, None] = {}
    for href in re.findall(r'<a\b[^>]*?\shref="([^"]*)"', page):
        href = html.unescape(href)
        if href.startswith(site.address):
            rest = href[len(site.address):]
        elif href.startswith("../"):
            rest = href[3:]
        else:
            continue
        rest = re.split(r"[?#]", rest, maxsplit=1)[0].strip("/").removesuffix("index.html").strip("/")
        if rest and rest != own and ".." not in rest.split("/") and len(rest) <= 200:
            found[rest] = None
    return tuple(found)[:MAX_LINKS]


def day_label(day: str) -> str:
    d = date.fromisoformat(day)
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("&", "")).strip("-")


def _address(value: Any) -> str:
    """An address a card may name: on the site (`/…`) or `https://`; never a scheme that runs."""
    text = value.strip() if isinstance(value, str) else ""
    if len(text) > 400 or any(char in text for char in "\"'<>\\ \r\n\t"):
        return ""
    return text if (text.startswith("/") and not text.startswith("//")) or text.startswith("https://") else ""


def read_card(folder: str, data: bytes) -> dict[str, Any] | None:
    """One card as a line of the list is made from it, or None when it is not a card Azimut
    reads: another format, no title or day, past the bounds. ``folder`` is where it was found,
    relative to the site root."""
    if len(data) > MAX_CARD_BYTES:
        return None
    try:
        card = json.loads(data)
    except ValueError:
        return None
    if not isinstance(card, dict) or card.get("format") != CARD_FORMAT:
        return None
    title = one_line(card.get("title"), MAX_TITLE)
    day = card.get("date")
    try:
        if not title or not isinstance(day, str) or len(day) != 10:
            return None
        date.fromisoformat(day)
    except ValueError:
        return None
    given = card.get("image")
    image = given.strip() if isinstance(given, str) else ""
    if image and not image.startswith(("/", "https://")):
        image = f"/{folder}/{image}"
    layout = card.get("layout")
    links: list[Any] = card["links"] if isinstance(card.get("links"), list) else []
    maps: list[Any] = card["maps"] if isinstance(card.get("maps"), list) else []
    kept_maps = []
    for one in maps[:MAX_MAPS]:
        where = _address(one.get("address")) if isinstance(one, dict) else ""
        words = one_line(one.get("title"), MAX_TITLE) if isinstance(one, dict) else ""
        if where and words:
            kept_maps.append({"title": words, "address": where})
    place = read_place(card.get("place"))
    return {
        "folder": folder,
        "address": f"/{folder}/",
        "title": title,
        "summary": one_line(card.get("summary"), MAX_SUMMARY),
        "date": day,
        "date_label": day_label(day),
        "category": one_line(card.get("category"), 80),
        "author": one_line(card.get("author"), 120),
        "layout": layout if layout in LAYOUTS else "article",
        "image": _address(image),
        "role": card["role"] if card.get("role") in ROLES else ARTICLE,
        "links": [str(one).strip("/")[:200] for one in links[:MAX_LINKS] if isinstance(one, str)],
        "maps": kept_maps,
        **({"place": place} if place is not None else {}),
    }


def read_place(value: Any) -> dict[str, Any] | None:
    """A card's place as a line carries it, or None for none and for one that does not read as a
    place (`notelook.NotePlace`): a hand edit's slip costs the article its pin, never its line."""
    if not isinstance(value, dict):
        return None
    name = value.get("name")
    try:
        return NotePlace.model_validate({"lat": value.get("lat"), "lon": value.get("lon"),
                                         "name": "" if name is None else name}).model_dump(mode="json")
    except ValidationError:
        return None


def line_of(card: Card, folder: str) -> dict[str, Any]:
    """The line a new card is, as `read_card` reads it back from the file it will be."""
    made = read_card(folder, card.as_json())
    assert made is not None
    return made


# -- the list --------------------------------------------------------------------------------------


def map_view(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every map page, newest first, each with the article that cites it (if one does)."""
    citing = {link: c for c in cards if c["role"] == ARTICLE and c["layout"] != "map" for link in c["links"]}
    out = []
    for card in cards:
        if card["layout"] != "map" or card["role"] != ARTICLE:
            continue
        entry = {k: v for k, v in card.items() if k not in ("folder", "links", "maps", "role")}
        by = citing.get(card["folder"])
        entry["article"] = {"title": by["title"], "address": by["address"]} if by else None
        out.append(entry)
    out.sort(key=lambda e: (e["date"], e["title"]), reverse=True)
    return out


def listing(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The lines of the list: maps folded under the articles citing them, pages and unlisted
    pages left out."""
    shown = [c for c in cards if c["role"] == ARTICLE]
    maps = {c["folder"]: c for c in shown if c["layout"] == "map"}
    cited: set[str] = set()
    lines = []
    for card in shown:
        if card["layout"] == "map":
            continue
        entry = {k: v for k, v in card.items() if k not in ("folder", "links", "role")}
        entry["maps"] = list(card["maps"])
        for link in card["links"]:
            if link in maps:
                cited.add(link)
                entry["maps"].append({"title": maps[link]["title"], "address": maps[link]["address"]})
        lines.append(entry)
    for folder, card in maps.items():
        if folder not in cited:
            lines.append({k: v for k, v in card.items() if k not in ("folder", "links", "role")})
    lines.sort(key=lambda e: (e["date"], e["title"]), reverse=True)
    return lines


def pages_of(cards: list[dict[str, Any]]) -> list[dict[str, str]]:
    """The pages, which no list shows: their title and address, by title."""
    found = [{"title": c["title"], "address": c["address"]} for c in cards if c["role"] == PAGE]
    return sorted(found, key=lambda p: (p["title"].casefold(), p["address"]))


def categories_of(cards: list[dict[str, Any]]) -> list[str]:
    """The categories the site's cards name: an unlisted page adds none."""
    return sorted({c["category"] for c in cards if c["category"] and c["role"] != UNLISTED})


def _at(prefix: str, address: str) -> str:
    """An address on the site as a page of it links it: under the site's own path, which a
    domain's root has none of."""
    return f"{prefix}{address}" if address.startswith("/") else address


def render_maps(maps: list[dict[str, Any]], limit: int = 0, prefix: str = "") -> str:
    chosen = maps[:limit] if limit else maps
    if not chosen:
        return '<p class="az-empty">No maps yet.</p>'
    e = html.escape
    out = ['<ol class="az-list az-maps">']
    for m in chosen:
        home = e(_at(prefix, m["address"]))
        out.append(f'<li class="az-item is-map" data-category="{slug(m["category"])}">')
        if m["image"]:
            out.append(f'<a class="az-cover" href="{home}" tabindex="-1" aria-hidden="true">'
                       f'<img src="{e(_at(prefix, m["image"]))}" alt="" loading="lazy" decoding="async"></a>')
        if m["category"]:
            out.append(f'<span class="az-category">{e(m["category"])}</span>')
        out.append(f'<h2 class="az-title"><a href="{home}">{e(m["title"])}</a></h2>')
        out.append(f'<p class="az-meta"><time datetime="{m["date"]}">{m["date_label"]}</time></p>')
        if m["summary"]:
            out.append(f'<p class="az-summary">{e(m["summary"])}</p>')
        links = [f'<a class="az-more" href="{home}">Open the map →</a>']
        if m["article"]:
            links.append(f'<a class="az-from" href="{e(_at(prefix, m["article"]["address"]))}">'
                         f'{e(m["article"]["title"])}</a>')
        out.append(f'<p class="az-links">{"".join(links)}</p>')
        out.append("</li>")
    out.append("</ol>")
    return "\n".join(out)


def render(lines: list[dict[str, Any]], site_title: str, section: str = "", limit: int = 0, prefix: str = "") -> str:
    chosen = [e for e in lines if not section or e["category"] == section]
    if limit:
        chosen = chosen[:limit]
    if not chosen:
        return '<p class="az-empty">No articles yet.</p>'
    e = html.escape
    out = ['<ol class="az-list">']
    for a in chosen:
        kind = " is-map" if a["layout"] == "map" else ""
        home = e(_at(prefix, a["address"]))
        out.append(f'<li class="az-item{kind}" data-category="{slug(a["category"])}">')
        if a["image"]:
            out.append(f'<a class="az-cover" href="{home}" tabindex="-1" aria-hidden="true">'
                       f'<img src="{e(_at(prefix, a["image"]))}" alt="" loading="lazy" decoding="async"></a>')
        if a["category"]:
            out.append(f'<span class="az-category">{e(a["category"])}</span>')
        out.append(f'<h2 class="az-title"><a href="{home}">{e(a["title"])}</a></h2>')
        by = f' · {e(a["author"])}' if a["author"] and a["author"] != site_title else ""
        out.append(f'<p class="az-meta"><time datetime="{a["date"]}">{a["date_label"]}</time>{by}</p>')
        if a["summary"]:
            out.append(f'<p class="az-summary">{e(a["summary"])}</p>')
        links = [f'<a class="az-more" href="{home}">Continue reading →</a>']
        links += [f'<a class="az-map" href="{e(_at(prefix, m["address"]))}">{e(m["title"])}</a>' for m in a["maps"]]
        out.append(f'<p class="az-links">{"".join(links)}</p>')
        out.append("</li>")
    out.append("</ol>")
    return "\n".join(out)


def sections_of(text: str) -> list[str]:
    """The categories a page's markers ask for with `section="…"`."""
    found = []
    for marker in MARKER.finditer(text):
        attrs = {k: html.unescape(v) for k, v in ATTR.findall(marker.group("attrs"))}
        if attrs.get("section"):
            found.append(attrs["section"])
    return found


def fill(text: str, lines: list[dict[str, Any]], maps: list[dict[str, Any]], site_title: str, prefix: str = "") -> str:
    """The page with every marked list filled; the page as it was when it has no marker."""

    def one(m: re.Match[str]) -> str:
        # The page holds the attributes as HTML ("Methods &amp; Tools"); the cards hold plain text.
        attrs = {k: html.unescape(v) for k, v in ATTR.findall(m.group("attrs"))}
        try:
            limit = int(attrs.get("limit", "0") or 0)
        except ValueError:
            limit = 0
        if attrs.get("layout") == "map":
            body = render_maps(maps, limit, prefix)
        else:
            body = render(lines, site_title, attrs.get("section", ""), limit, prefix)
        return f"<!-- azimut:articles{m.group('attrs')}-->\n{body}\n<!-- /azimut:articles -->"

    return MARKER.sub(one, text)


# -- the feed, the sitemap, the list as a file -------------------------------------------------


def feed(lines: list[dict[str, Any]], site: Site) -> str:
    base = site.address.rstrip("/")
    e = html.escape
    items = []
    for a in lines[:FEED_ITEMS]:
        link = a["address"] if a["address"].startswith("http") else base + a["address"]
        when = datetime.fromisoformat(a["date"]).replace(hour=12, tzinfo=timezone.utc)
        cat = f"<category>{e(a['category'])}</category>" if a["category"] else ""
        items.append(f"<item><title>{e(a['title'])}</title><link>{e(link)}</link>"
                     f'<guid isPermaLink="true">{e(link)}</guid><pubDate>{format_datetime(when)}</pubDate>'
                     f"{cat}<description>{e(a['summary'])}</description></item>")
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>'
            f"<title>{e(site.title)}</title><link>{e(site.address)}</link>"
            f"<description>{e(site.tagline or site.title)}</description><language>en</language>"
            "<generator>Azimut</generator>"
            f'<atom:link href="{e(base)}/feed.xml" rel="self" type="application/rss+xml"/>'
            + "".join(items) + "</channel></rss>\n")


def sitemap(lines: list[dict[str, Any]], maps: list[dict[str, Any]], pages: list[str], site: Site) -> str:
    """The sitemap: ``pages`` are paths on the site (the home, the marked pages, the pages),
    then the articles and the maps."""
    base = site.address.rstrip("/")
    urls = [base + p for p in pages] + [base + a["address"] for a in [*lines, *maps] if a["address"].startswith("/")]
    body = "".join(f"<url><loc>{html.escape(u)}</loc></url>" for u in dict.fromkeys(urls))
    return ('<?xml version="1.0" encoding="utf-8"?>\n<!-- generator: Azimut -->\n'
            f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>\n')


def sitemap_paths(text: str, site: Site) -> list[str]:
    """The paths on the site an earlier sitemap listed, in its order."""
    base = site.address.rstrip("/")
    found = []
    for loc in re.findall(r"<loc>(.*?)</loc>", text):
        url = html.unescape(loc)
        if url.startswith(base + "/"):
            found.append(url[len(base):])
    return found


def articles_json(lines: list[dict[str, Any]], maps: list[dict[str, Any]], pages: list[dict[str, str]],
                  site: Site) -> str:
    """The list as a file, for the analyst's own scripts: every address is on the site, from its root."""
    payload = {"format": SITE_FORMAT, "site": {"title": site.title, "address": site.address},
               "articles": lines, "maps": maps, "pages": pages}
    return json.dumps(payload, indent=1, ensure_ascii=False) + "\n"
