"""What a publish writes at the site's root: the list, the feed, the sitemap, the marked pages, the home.

`engine/site.py` makes each of them from the site's cards; this reads the repository for the
cards and the pages to fill, and decides what to write under the rule that Azimut only ever
writes a file it made (see there). The answer is a `githubpages.RootPlan`, which the one publish
commit then holds beside the article's folder.

**What is read**, from the tree of the site's root as the branch holds it: every `**/article.json`
(at most `site.MAX_CARDS`, each at most `site.MAX_CARD_BYTES`), the three files Azimut would write
and the root page (to know whose they are), and each page one level down that holds no card (at
most `site.MAX_PAGES`, each at most `site.MAX_PAGE_BYTES`). A blob's id names its content for good,
so what was read is kept in memory, bounded, and a publish after the first reads next to nothing.
A tree GitHub cut short, or a site past the bounds, leaves its list as it was with a word to say so:
the publish itself never fails for it.

**What is written** is only what differs from what the repository holds already.
"""

from __future__ import annotations

import threading
from collections import OrderedDict

from . import githubpages, site, sitehome
from .githubpages import RootPlan
from .site import Card, Site

#: How much of what was read is kept, so the next publish does not read it again.
MAX_KEPT_BYTES = 8 * 1024 * 1024
#: The most the list file of the site may weigh to be read.
MAX_LIST_BYTES = 4 * 1024 * 1024
TOO_MANY_PAGES = (f"The site holds more than {site.MAX_PAGES} pages with no card: Azimut filled the lists "
                  f"of the first {site.MAX_PAGES} and left the others as they were.")

_kept: OrderedDict[str, bytes] = OrderedDict()
_plain: OrderedDict[str, None] = OrderedDict()
_weight = 0
_lock = threading.Lock()


def _remember(sha: str, data: bytes) -> None:
    global _weight
    if len(data) > site.MAX_PAGE_BYTES:
        return
    with _lock:
        if sha in _kept:
            _kept.move_to_end(sha)
            return
        _kept[sha] = data
        _weight += len(data)
        while _weight > MAX_KEPT_BYTES and _kept:
            _weight -= len(_kept.popitem(last=False)[1])


def _recall(sha: str) -> bytes | None:
    with _lock:
        data = _kept.get(sha)
        if data is not None:
            _kept.move_to_end(sha)
        return data


class _Files:
    """The site's files as the branch holds them: by path, read by blob id when asked."""

    def __init__(self, gh: githubpages.GitHub, owner: str, repo: str, entries: dict[str, str]) -> None:
        self.gh, self.owner, self.repo = gh, owner, repo
        self.entries = entries

    def read(self, path: str, cap: int) -> bytes | None:
        sha = self.entries.get(path)
        if sha is None:
            return None
        data = _recall(sha)
        if data is None:
            data = githubpages.read_blob(self.gh, self.owner, self.repo, sha, cap)
            if data is not None:
                _remember(sha, data)
        return data if data is not None and len(data) <= cap else None

    def text(self, path: str, cap: int) -> str | None:
        data = self.read(path, cap)
        try:
            return data.decode("utf-8") if data is not None else None
        except UnicodeDecodeError:
            return None

    def plain(self, path: str) -> bool:
        """Whether this very page was read before and held no marker."""
        sha = self.entries.get(path)
        with _lock:
            return sha in _plain


def _no_marker(sha: str) -> None:
    with _lock:
        _plain[sha] = None
        while len(_plain) > 2000:
            _plain.popitem(last=False)


def planner(gh: githubpages.GitHub, owner: str, repo: str, home_site: Site) -> githubpages.Planner:
    """The plan of a publish for this repository: given the site's root tree, the folder being
    published and its card (neither for an update of the site alone)."""

    def plan(level: str, folder: str, card: Card | None) -> RootPlan:
        return make_plan(gh, owner, repo, home_site, githubpages.read_tree(gh, owner, repo, level), folder, card)

    return plan


def make_plan(gh: githubpages.GitHub, owner: str, repo: str, home: Site, tree: githubpages.TreeRead,
              folder: str, card: Card | None) -> RootPlan:
    plan = RootPlan()
    if not tree.complete:
        plan.warnings.append(site.TREE_TOO_LONG)
        return plan
    files = _Files(gh, owner, repo, tree.entries)
    entries = tree.entries
    found = sorted(path[:-len(f"/{site.CARD}")] for path in entries if path.endswith(f"/{site.CARD}"))
    folders = [one for one in found if one.split("/")[0] not in site.SKIP and one != folder]
    if len(folders) + (1 if card is not None else 0) > site.MAX_CARDS:
        plan.warnings.append(site.TOO_MANY_CARDS)
        return plan
    cards = []
    for one in folders:
        data = files.read(f"{one}/{site.CARD}", site.MAX_CARD_BYTES)
        line = site.read_card(one, data) if data is not None else None
        if line is not None:
            cards.append(line)
    if card is not None and folder:
        cards.append(site.line_of(card, folder))
    lines, maps, pages = site.listing(cards), site.map_view(cards), site.pages_of(cards)
    prefix = home.prefix
    sections: list[str] = []
    marked: list[str] = []

    def put(path: str, text: str) -> None:
        data = text.encode("utf-8")
        sha = githubpages.blob_sha(data)
        if sha != entries.get(path):
            plan.files[path] = data
            _remember(sha, data)

    # the root page: the analyst's, whose markers are filled, or Azimut's own home
    root = site.HOME
    current = files.text(root, site.MAX_PAGE_BYTES) if root in entries else None
    if root not in entries or (current is not None and site.owns_home(current)):
        page = site.fill(sitehome.home(home, lines, maps, pages), lines, maps, home.title, prefix)
        put(root, page)
        for path, data in sitehome.kit(home).items():
            if githubpages.blob_sha(data) != entries.get(path):
                plan.files[path] = data
    elif current is not None:
        sections += site.sections_of(current)
        put(root, site.fill(current, lines, maps, home.title, prefix))

    # every page one level down that holds no card: its markers filled where it has any
    pages_below = sorted(path for path in entries if path.endswith("/index.html") and path.count("/") == 1)
    pages_below = [path for path in pages_below
                   if path.split("/")[0] not in site.SKIP and f"{path.split('/')[0]}/{site.CARD}" not in entries]
    if len(pages_below) > site.MAX_PAGES:
        plan.warnings.append(TOO_MANY_PAGES)
        pages_below = pages_below[:site.MAX_PAGES]
    for path in pages_below:
        if files.plain(path):
            continue
        text = files.text(path, site.MAX_PAGE_BYTES)
        if text is None:
            continue
        if site.MARKER.search(text) is None:
            _no_marker(entries[path])
            continue
        marked.append(f"/{path.split('/')[0]}/")
        sections += site.sections_of(text)
        put(path, site.fill(text, lines, maps, home.title, prefix))

    # the list, the feed and the sitemap, each only where Azimut made it or there is none
    for path, owns, make in ((site.ARTICLES, site.owns_articles, lambda: site.articles_json(lines, maps, pages, home)),
                             (site.FEED, site.owns_feed, lambda: site.feed(lines, home))):
        existing = files.text(path, MAX_LIST_BYTES) if path in entries else None
        if path not in entries or (existing is not None and owns(existing)):
            put(path, make())
    existing = files.text(site.SITEMAP, MAX_LIST_BYTES) if site.SITEMAP in entries else None
    if site.SITEMAP not in entries or (existing is not None and site.owns_sitemap(existing)):
        hidden = {str(card["address"]) for card in cards if card["role"] == site.UNLISTED}
        put(site.SITEMAP, site.sitemap(lines, maps, _sitemap_pages(existing, home, entries, lines, maps, marked,
                                                                    pages, hidden), home))
    plan.categories = sorted({*site.categories_of(cards), *sections})
    return plan


def _sitemap_pages(existing: str | None, home: Site, entries: dict[str, str], lines: list[dict[str, object]],
                   maps: list[dict[str, object]], marked: list[str], pages: list[dict[str, str]],
                   hidden: frozenset[str] | set[str] = frozenset()) -> list[str]:
    """The paths the sitemap lists before the articles and the maps: the home, then what the
    sitemap listed already that still answers (the analyst's own pages, which no card names, and
    never an unlisted page of ``hidden``, which an earlier sitemap may have listed as an article),
    then the marked pages and the pages of the site."""
    articles = {str(line["address"]) for line in [*lines, *maps]} | hidden
    kept = []
    for path in site.sitemap_paths(existing, home) if existing else []:
        relative = path.strip("/")
        answers = path == "/" or f"{relative}/index.html" in entries or relative in entries
        if path not in articles and answers:
            kept.append(path)
    return list(dict.fromkeys(["/", *kept, *marked, *(page["address"] for page in pages)]))
