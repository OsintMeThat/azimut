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

**What a delete plans** is the same, over the tree as it will be without the folder
(`remover`): the folder's paths are read out of it first, so the lists, the feed and the
sitemap do not keep it.

**What a read tells** (`survey`, Settings › Website › Articles) is the same reading and no
writing: the cards as items, newest first, the categories in use and the marked pages that list
each, whose home the site has, and the pages a site is expected to have.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from . import githubpages, site, sitehome
from .githubpages import RootPlan
from .site import Card, Site

#: How much of what was read is kept, so the next publish does not read it again.
MAX_KEPT_BYTES = 8 * 1024 * 1024
#: The most the list file of the site may weigh to be read.
MAX_LIST_BYTES = 4 * 1024 * 1024
TOO_MANY_PAGES = (f"The site holds more than {site.MAX_PAGES} pages with no card: Azimut filled the lists "
                  f"of the first {site.MAX_PAGES} and left the others as they were.")
#: What a read of the site says when it holds more than it looks through.
TREE_TOO_LONG_READ = "The site holds too many files for Azimut to read: nothing is shown."
TOO_MANY_CARDS_READ = f"The site holds more than {site.MAX_CARDS} cards: Azimut shows the first {site.MAX_CARDS}."
TOO_MANY_PAGES_READ = (f"The site holds more than {site.MAX_PAGES} pages with no card: Azimut looked through "
                       f"the first {site.MAX_PAGES} for lists.")
#: The folders a site keeps its legal notice and its privacy page in, by the names sites give them.
LEGAL_FOLDERS = ("legal-notice", "legal", "imprint", "impressum", "mentions-legales")
PRIVACY_FOLDERS = ("privacy", "privacy-policy", "privacy-notice", "confidentialite")

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


def remover(gh: githubpages.GitHub, owner: str, repo: str, home_site: Site) -> githubpages.Planner:
    """The plan of a delete: the site as it will be without ``folder``, whose paths are read out of
    the tree before anything is planned, so that no list, feed or sitemap keeps it."""

    def plan(level: str, folder: str, card: Card | None) -> RootPlan:
        tree = githubpages.read_tree(gh, owner, repo, level)
        left = {path: sha for path, sha in tree.entries.items() if path != folder and not path.startswith(f"{folder}/")}
        return make_plan(gh, owner, repo, home_site, githubpages.TreeRead(left, tree.complete), folder, None)

    return plan


def _card_folders(entries: dict[str, str], leave: str = "") -> list[str]:
    """The folders of the tree that hold a card, but for ``leave`` and the folders no card lives in."""
    found = sorted(path[:-len(f"/{site.CARD}")] for path in entries if path.endswith(f"/{site.CARD}"))
    return [one for one in found if one.split("/")[0] not in site.SKIP and one != leave]


def _read_cards(files: _Files, folders: list[str]) -> list[dict[str, Any]]:
    cards = []
    for one in folders:
        data = files.read(f"{one}/{site.CARD}", site.MAX_CARD_BYTES)
        line = site.read_card(one, data) if data is not None else None
        if line is not None:
            cards.append(line)
    return cards


def _pages_below(entries: dict[str, str]) -> list[str]:
    """The pages one level down that hold no card: where a marked list may be."""
    pages_below = sorted(path for path in entries if path.endswith("/index.html") and path.count("/") == 1)
    return [path for path in pages_below
            if path.split("/")[0] not in site.SKIP and f"{path.split('/')[0]}/{site.CARD}" not in entries]


def make_plan(gh: githubpages.GitHub, owner: str, repo: str, home: Site, tree: githubpages.TreeRead,
              folder: str, card: Card | None) -> RootPlan:
    plan = RootPlan()
    if not tree.complete:
        plan.warnings.append(site.TREE_TOO_LONG)
        return plan
    files = _Files(gh, owner, repo, tree.entries)
    entries = tree.entries
    folders = _card_folders(entries, folder)
    if len(folders) + (1 if card is not None else 0) > site.MAX_CARDS:
        plan.warnings.append(site.TOO_MANY_CARDS)
        return plan
    cards = _read_cards(files, folders)
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
    pages_below = _pages_below(entries)
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


# -- reading the site, writing nothing -------------------------------------------------------------


@dataclass
class Survey:
    """What the site holds, as Settings › Website shows it: ``home`` is `azimut`, `yours` or `none`;
    ``marked`` the pages whose lists Azimut fills ("" the root page); ``found`` the categories to keep
    for the publish dialog (the cards' and the marked pages'), None when the site was not read."""

    home: str = "none"
    items: list[dict[str, Any]] = field(default_factory=list)
    categories: list[dict[str, Any]] = field(default_factory=list)
    marked: list[str] = field(default_factory=list)
    legal: str = ""
    privacy: str = ""
    warnings: list[str] = field(default_factory=list)
    found: list[str] | None = None
    #: What the site's files weigh in bytes, None when the tree was too long to read whole.
    bytes: int | None = None


def _on_site(address: str, home: Site) -> str:
    """An address a card names, whole: one on the site (`/…`) as the site serves it."""
    return home.address.rstrip("/") + address if address.startswith("/") else address


def _item(card: dict[str, Any], home: Site, weight: int) -> dict[str, Any]:
    return {"folder": card["folder"], "address": _on_site(card["address"], home), "title": card["title"],
            "summary": card["summary"], "date": card["date"], "date_label": card["date_label"],
            "category": card["category"], "role": card["role"], "layout": card["layout"],
            "image": _on_site(card["image"], home) if card["image"] else "", "bytes": weight}


def _weights(sizes: dict[str, int], folders: list[str]) -> dict[str, int]:
    """What each card's folder weighs: the sizes of every file under it, in one pass over the files."""
    known = set(folders)
    weight = dict.fromkeys(folders, 0)
    for path, size in sizes.items():
        parts = path.split("/")
        for depth in range(1, len(parts)):
            above = "/".join(parts[:depth])
            if above in known:
                weight[above] += size
    return weight


def _page_named(entries: dict[str, str], items: list[dict[str, Any]], names: tuple[str, ...], title: str) -> str:
    """The folder a page the site is expected to have lives in, "folder/": one named as sites name
    it, else a card with its title, else none."""
    for name in names:
        if f"{name}/{site.HOME}" in entries:
            return f"{name}/"
    for item in items:
        if item["title"].casefold() == title.casefold():
            return f"{item['folder']}/"
    return ""


def survey(gh: githubpages.GitHub, owner: str, repo: str, home: Site, tree: githubpages.TreeRead) -> Survey:
    """The site's tree as a survey: every card (at most `site.MAX_CARDS`) as an item, newest first,
    the categories of the listed ones, the root page's kind, the pages with Azimut's markers and the
    legal and privacy pages, read by blob id through the same bounded memory as a publish's plan."""
    out = Survey()
    if not tree.complete:
        out.warnings.append(TREE_TOO_LONG_READ)
        return out
    files = _Files(gh, owner, repo, tree.entries)
    entries = tree.entries
    folders = _card_folders(entries)
    if len(folders) > site.MAX_CARDS:
        out.warnings.append(TOO_MANY_CARDS_READ)
        folders = folders[:site.MAX_CARDS]
    cards = _read_cards(files, folders)
    cards.sort(key=lambda card: (card["date"], card["title"]), reverse=True)
    weight = _weights(tree.sizes, [card["folder"] for card in cards])
    out.bytes = sum(tree.sizes.values())
    out.items = [_item(card, home, weight[card["folder"]]) for card in cards]
    counts: dict[str, int] = {}
    for card in cards:
        if card["role"] == site.ARTICLE and card["category"]:
            counts[card["category"]] = counts.get(card["category"], 0) + 1
    # the root page: Azimut's home, the analyst's own, or none; and every page whose lists Azimut fills
    root = files.text(site.HOME, site.MAX_PAGE_BYTES) if site.HOME in entries else None
    out.home = "none" if site.HOME not in entries else "azimut" if root is not None and site.owns_home(root) else "yours"
    listed: dict[str, list[str]] = {}

    def mark(path: str, text: str) -> None:
        out.marked.append(path)
        for name in dict.fromkeys(site.sections_of(text)):
            listed.setdefault(name, []).append(path)

    if root is not None and site.MARKER.search(root):
        mark("", root)
    pages_below = _pages_below(entries)
    if len(pages_below) > site.MAX_PAGES:
        out.warnings.append(TOO_MANY_PAGES_READ)
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
        mark(f"{path.split('/')[0]}/", text)
    out.categories = [{"name": name, "count": count, "pages": listed.get(name, [])}
                      for name, count in sorted(counts.items(), key=lambda one: (-one[1], one[0].casefold()))]
    out.legal = _page_named(entries, out.items, LEGAL_FOLDERS, site.LEGAL_TITLE)
    out.privacy = _page_named(entries, out.items, PRIVACY_FOLDERS, site.PRIVACY_TITLE)
    out.found = sorted({*site.categories_of(cards), *listed})
    return out
