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

**What a change of categories plans** (`recategorizer`, Settings › Website › Categories and an
article's line) is the same, over the cards as the commit will make them: each card concerned with
its `category` rewritten, and a rename kept in `articles.json` as `"renamed"` (`site.RENAMED`). It
writes nothing for a site it cannot read whole, and never a page outside its markers.

**What a read tells** (`survey`, Settings › Website › Articles) is the same reading and no
writing: the cards as items, newest first, the categories in use and the marked pages that list
each (a category only a marked page names counts no article), whose home the site has, whose bar
and footer its articles carry, and the pages a site is expected to have.

**The bar** of an article page is the site's own when its root holds `azimut-bar.html`
(`site.own_bar`), and Azimut's otherwise; **the footer** is the site's own when it holds
`azimut-footer.html` (`site.own_footer`), and none otherwise. Each is read by blob id like the rest,
and a file absent costs no read. A publish gives its page that bar and footer (`RootPlan.bar`,
`RootPlan.footer`). Update the site (`updater`) gives them to every article page Azimut published
whose bar or footer differs, between the page's markers and nothing else (a footer's markers put in
after Azimut's footer the first time), in the same commit as the lists and within its bounds
(`githubpages.MAX_FILES`, `MAX_TOTAL_BYTES`). To know what the pages carry without reading them all,
`articles.json` keeps it: `bar` (`azimut`, or the id of the site's own) and `footer` (the id of the
site's own, the key left out for none, as a record from before footers reads). Update the site writes
them once every page carries that bar and footer, a publish keeps them while what it gives is that and
drops both otherwise, a delete keeps them. With them matching, Update the site reads no page; without,
it reads each article page once (remembered by blob id, at most `MAX_BAR_PAGE_BYTES` each) and writes
it again.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

from . import githubpages, site, siteatlas, sitehome
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
#: The bar Azimut's own pages carry, as `articles.json` keeps it (`BAR_KEY`) and a read says it.
AZIMUT_BAR = "azimut"
BAR_KEY = "bar"
#: The footer the article pages carry, as `articles.json` keeps it: the id of the site's own, no key for none.
FOOTER_KEY = "footer"
#: What every article page carries, as `articles.json` keeps it: its bar's kind (`bar_kind`), then its
#: footer's (`footer_kind`).
Carried = tuple[str, str]
#: The most an article page may weigh for Update the site to change its bar or footer.
MAX_BAR_PAGE_BYTES = 8 * 1024 * 1024
PAGES_LEFT = "Azimut changed as many articles as one commit holds: press Update the site again for the others."

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
    """The site's files as the branch holds them: by path, read by blob id when asked. ``given`` are
    files as the commit being planned will make them, read in place of the branch's."""

    def __init__(self, gh: githubpages.GitHub, owner: str, repo: str, entries: dict[str, str],
                 given: Mapping[str, bytes] | None = None) -> None:
        self.gh, self.owner, self.repo = gh, owner, repo
        self.entries = entries
        self.given = dict(given or {})

    def read(self, path: str, cap: int) -> bytes | None:
        if path in self.given:
            return self.given[path] if len(self.given[path]) <= cap else None
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


def pages_too_large(count: int) -> str:
    """What Update the site says of the article pages it could not read to change their bar or footer."""
    pages = "1 article page is" if count == 1 else f"{count} article pages are"
    return f"{pages} too large for Azimut to change: publish {'it' if count == 1 else 'them'} again."


#: What each page read carries (`carried_by`), by its blob id.
_carried: OrderedDict[str, Carried] = OrderedDict()


def _carried_known(sha: str) -> Carried | None:
    with _lock:
        return _carried.get(sha)


def _carried_kept(sha: str, carried: Carried) -> None:
    with _lock:
        _carried[sha] = carried
        _carried.move_to_end(sha)
        while len(_carried) > 4000:
            _carried.popitem(last=False)


def bar_kind(inner: bytes | None) -> str:
    """Which bar a page's markers hold (`site.bar_in`): "" for a page with none, `AZIMUT_BAR`, or the id
    of the bar it carries."""
    if inner is None:
        return ""
    return AZIMUT_BAR if site.is_azimut_bar(inner) else hashlib.sha1(inner, usedforsecurity=False).hexdigest()


def footer_kind(inner: bytes | None) -> str:
    """Which footer a page's markers hold (`site.footer_in`): "" for none, else the id of the one it carries."""
    return hashlib.sha1(inner, usedforsecurity=False).hexdigest() if inner else ""


def carried_by(page: bytes) -> Carried:
    """The bar and the footer an article page carries, by kind."""
    return bar_kind(site.bar_in(page)), footer_kind(site.footer_in(page))


def _no_marker(sha: str) -> None:
    with _lock:
        _plain[sha] = None
        while len(_plain) > 2000:
            _plain.popitem(last=False)


def planner(gh: githubpages.GitHub, owner: str, repo: str, home_site: Site) -> githubpages.Planner:
    """The plan of a publish for this repository: given the site's root tree, the folder being
    published and its card (neither for an update of the site alone)."""

    def plan(level: str, folder: str, card: Card | None) -> RootPlan:
        tree = githubpages.read_tree(gh, owner, repo, level)
        made = make_plan(gh, owner, repo, home_site, tree, folder, card)
        _publish_parts(gh, owner, repo, tree, made)
        return made

    return plan


def updater(gh: githubpages.GitHub, owner: str, repo: str, home_site: Site) -> githubpages.Planner:
    """The plan of Update the site: the publish's plan with no note, and every article page Azimut
    published given the bar and the footer the site asks for now (`own_parts`)."""

    def plan(level: str, folder: str, card: Card | None) -> RootPlan:
        tree = githubpages.read_tree(gh, owner, repo, level)
        made = make_plan(gh, owner, repo, home_site, tree, folder, card)
        if tree.complete and made.categories is not None:
            own_parts(gh, owner, repo, home_site, tree, made)
        return made

    return plan


def remover(gh: githubpages.GitHub, owner: str, repo: str, home_site: Site) -> githubpages.Planner:
    """The plan of a delete: the site as it will be without ``folder``, whose paths are read out of
    the tree before anything is planned, so that no list, feed or sitemap keeps it."""

    def plan(level: str, folder: str, card: Card | None) -> RootPlan:
        tree = githubpages.read_tree(gh, owner, repo, level)
        left = {path: sha for path, sha in tree.entries.items() if path != folder and not path.startswith(f"{folder}/")}
        made = make_plan(gh, owner, repo, home_site, githubpages.TreeRead(left, tree.complete), folder, None)
        if tree.complete and made.categories is not None:
            # a folder gone takes no bar or footer with it: the other pages carry what they did
            files = _Files(gh, owner, repo, left)
            _record(made, files, left, _recorded(files, left))
        return made

    return plan


# -- the categories, changed from Settings › Website -------------------------------------------------

CATEGORY_TOO_LONG = "The site holds too many files for Azimut to read: nothing was changed."
CATEGORY_TOO_MANY = f"The site holds more than {site.MAX_CARDS} cards: nothing was changed."
CATEGORY_GONE = "No article on the site carries that category any more: read the site again."
CATEGORY_MOVED = "The branch changed on GitHub while Azimut was changing the categories: press again."


class Refused(githubpages.GitHubError):
    """A change of categories the site cannot take as it is, with nothing written."""


class CategoryGone(githubpages.NotFound):
    """The category to rename or delete is on no card of the site (any more)."""


@dataclass(frozen=True)
class CategoryChange:
    """What Settings › Website changes of the site's categories: ``name`` renamed ``to`` (`rename`, into
    a category the site has already when it is one's name), ``name`` taken off every card that carries it
    (`delete`), or the card of ``folder`` given ``to`` (`move`, "" for no category)."""

    kind: Literal["rename", "delete", "move"]
    name: str = ""
    to: str = ""
    folder: str = ""


def recategorizer(gh: githubpages.GitHub, owner: str, repo: str, home: Site,
                  change: CategoryChange) -> githubpages.Planner:
    """The plan of a change of categories (`githubpages.update_site`): each card concerned with its
    `category` rewritten and every other key as it was (`site.recategorized`), and the root files made
    from the cards as they will be, the lists, the feed and the sitemap, with a rename kept in
    `articles.json` (`site.RENAMED`) and its record of the bar and footer as it was. A card of `azimut-article/1`
    is changed wherever it lives. Nothing is written for a site Azimut cannot read whole (`Refused`), and
    a category no card carries is `CategoryGone`, a folder holding no card `githubpages.FolderGone`."""

    def plan(level: str, folder: str, card: Card | None) -> RootPlan:
        tree = githubpages.read_tree(gh, owner, repo, level)
        if not tree.complete:
            raise Refused(CATEGORY_TOO_LONG, 422)
        files = _Files(gh, owner, repo, tree.entries)
        folders = _card_folders(tree.entries)
        if len(folders) > site.MAX_CARDS:
            raise Refused(CATEGORY_TOO_MANY, 422)
        given: dict[str, bytes] = {}
        found = False
        for one in ([change.folder] if change.kind == "move" and change.folder in folders else
                    [] if change.kind == "move" else folders):
            path = f"{one}/{site.CARD}"
            data = files.read(path, site.MAX_CARD_BYTES)
            line = site.read_card(one, data) if data is not None else None
            if line is None or (change.kind != "move" and line["category"] != change.name):
                continue
            found = True
            if line["category"] != change.to:
                rewritten = site.recategorized(data, change.to) if data is not None else None
                if rewritten is not None:
                    given[path] = rewritten
        if not found:
            raise (githubpages.FolderGone(githubpages.GONE, 404) if change.kind == "move"
                   else CategoryGone(CATEGORY_GONE, 404))
        made = make_plan(gh, owner, repo, home, tree, "", None, given=given,
                         rename=(change.name, change.to) if change.kind == "rename" else None)
        made.files.update(given)
        # the article pages carry the bar and footer they did: the record of them stays as it was
        _record(made, files, tree.entries, _recorded(files, tree.entries))
        return made

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
              folder: str, card: Card | None, *, given: Mapping[str, bytes] | None = None,
              rename: tuple[str, str] | None = None) -> RootPlan:
    """The root files for the site as ``tree`` holds it, with ``card`` as the card of ``folder`` and the
    files ``given`` as the commit will make them; ``rename`` is a category renamed, which the record in
    `articles.json` keeps (`site.renamed_after`)."""
    plan = RootPlan()
    if not tree.complete:
        plan.warnings.append(site.TREE_TOO_LONG)
        return plan
    files = _Files(gh, owner, repo, tree.entries, given)
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
        for path, data in sitehome.kit(home, atlas=bool(siteatlas.placed(lines))).items():
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

    # the list, the feed and the sitemap, each only where Azimut made it or there is none; the list keeps
    # the record of the categories renamed, but for an old name a category of the site carries again
    existing = files.text(site.ARTICLES, MAX_LIST_BYTES) if site.ARTICLES in entries else None
    if site.ARTICLES not in entries or (existing is not None and site.owns_articles(existing)):
        record = site.renamed_of(_payload(existing))
        if rename is not None:
            record = site.renamed_after(record, *rename)
        put(site.ARTICLES, site.articles_json(lines, maps, pages, home,
                                              site.renamed_kept(record, site.categories_of(cards))))
    existing = files.text(site.FEED, MAX_LIST_BYTES) if site.FEED in entries else None
    if site.FEED not in entries or (existing is not None and site.owns_feed(existing)):
        put(site.FEED, site.feed(lines, home))
    existing = files.text(site.SITEMAP, MAX_LIST_BYTES) if site.SITEMAP in entries else None
    if site.SITEMAP not in entries or (existing is not None and site.owns_sitemap(existing)):
        hidden = {str(card["address"]) for card in cards if card["role"] == site.UNLISTED}
        put(site.SITEMAP, site.sitemap(lines, maps, _sitemap_pages(existing, home, entries, lines, maps, marked,
                                                                    pages, hidden), home))
    plan.categories = sorted({*site.categories_of(cards), *sections})
    return plan


def _payload(text: str | None) -> Any:
    """A list file read as JSON, None for none or one that does not read."""
    try:
        return json.loads(text) if text is not None else None
    except ValueError:
        return None


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


# -- the bar and the footer of the article pages ----------------------------------------------------------


def _site_part(files: _Files, tree: githubpages.TreeRead, warnings: list[str], part: site.OwnPart) -> str:
    """A part of the site's own (`site.OwnPart`) as an article page carries it, "" for none. With no file
    nothing is read; one past its bound is not read either."""
    if part.file not in tree.entries:
        return ""
    size = tree.sizes.get(part.file)
    data = files.read(part.file, site.MAX_OWN_BAR_BYTES) if size is None or size <= site.MAX_OWN_BAR_BYTES else None
    if data is None:
        warnings.append(part.too_large)
        return ""
    inner, said = site.own_part(part, data)
    if said:
        warnings.append(said)
    return inner


def _site_parts(files: _Files, tree: githubpages.TreeRead, warnings: list[str]) -> tuple[str, str, Carried]:
    """The site's own bar and footer as an article page carries them ("" for none: Azimut's bar, no
    footer), and what a page carrying them is by kind (`carried_by`)."""
    bar = _site_part(files, tree, warnings, site.BAR_PART)
    footer = _site_part(files, tree, warnings, site.FOOTER_PART)
    kinds = (bar_kind(bar.encode("utf-8")) if bar else AZIMUT_BAR, footer_kind(footer.encode("utf-8")))
    return bar, footer, kinds


def _recorded(files: _Files, entries: dict[str, str]) -> Carried | None:
    """The bar and footer `articles.json` says every article page carries, None when it says none or is
    not Azimut's. A record with a bar and no footer, as one from before footers, says none."""
    text = files.text(site.ARTICLES, MAX_LIST_BYTES) if site.ARTICLES in entries else None
    try:
        payload = json.loads(text) if text is not None else None
    except ValueError:
        return None
    if not isinstance(payload, dict) or payload.get("format") != site.SITE_FORMAT:
        return None
    bar, footer = payload.get(BAR_KEY), payload.get(FOOTER_KEY, "")
    return (bar, footer) if isinstance(bar, str) and bar and isinstance(footer, str) else None


def _record(plan: RootPlan, files: _Files, entries: dict[str, str], state: Carried | None) -> None:
    """`articles.json` as the plan leaves it, with ``state`` as the bar and footer every article page
    carries (None for none known), where Azimut owns that file; written only where it then differs."""
    data = plan.files.get(site.ARTICLES)
    if data is None:
        text = files.text(site.ARTICLES, MAX_LIST_BYTES) if site.ARTICLES in entries else None
        if text is None or not site.owns_articles(text):
            return
        data = text.encode("utf-8")
    try:
        payload = json.loads(data)
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    payload.pop(BAR_KEY, None)
    payload.pop(FOOTER_KEY, None)
    if state is not None:
        payload[BAR_KEY] = state[0]
        if state[1]:
            payload[FOOTER_KEY] = state[1]
    out = (json.dumps(payload, indent=1, ensure_ascii=False) + "\n").encode("utf-8")
    sha = githubpages.blob_sha(out)
    if sha == entries.get(site.ARTICLES):
        plan.files.pop(site.ARTICLES, None)
    else:
        plan.files[site.ARTICLES] = out
        _remember(sha, out)


def _publish_parts(gh: githubpages.GitHub, owner: str, repo: str, tree: githubpages.TreeRead, plan: RootPlan) -> None:
    """What a publish adds to its plan for the bar and the footer: the site's own for its page
    (`RootPlan.bar`, `RootPlan.footer`), and `articles.json`'s record kept while they are what every
    page carries, dropped otherwise."""
    if not tree.complete:
        return
    files = _Files(gh, owner, repo, tree.entries)
    bar, footer, kinds = _site_parts(files, tree, plan.warnings)
    plan.bar = bar or None
    plan.footer = footer or None
    if plan.categories is not None:
        recorded = _recorded(files, tree.entries)
        _record(plan, files, tree.entries, recorded if recorded == kinds else None)


def _logo_of(folder: str, held: set[str], entries: dict[str, str], home: Site) -> str:
    """The logo Azimut's bar shows in an article's folder: the site's own as the folder holds it, else
    the one the folder was published with, else none (and none for a site with no logo)."""
    if home.logo is None:
        return ""
    logos = sorted(path for path in held if site.LOGO_FILE.match(path))
    same = githubpages.blob_sha(home.logo)
    return next((path for path in logos if entries.get(f"{folder}/{path}") == same), logos[0] if logos else "")


def own_parts(gh: githubpages.GitHub, owner: str, repo: str, home: Site, tree: githubpages.TreeRead,
              plan: RootPlan) -> None:
    """Give every article page Azimut published the bar and the footer the site asks for now, in ``plan``:
    the site's own bar (`azimut-bar.html`) or Azimut's, and the site's own footer (`azimut-footer.html`)
    or none. Only a folder Azimut published (`githubpages.deletable`) whose card is no map's, only a page
    with the bar's markers, only the part that differs, and only between its markers (a footer's put in
    after Azimut's footer the first time); within one commit's bounds. A page carrying Azimut's bar
    keeps it as it is."""
    files = _Files(gh, owner, repo, tree.entries)
    entries = tree.entries
    bar, footer, wanted = _site_parts(files, tree, plan.warnings)
    recorded = _recorded(files, entries)
    if recorded == wanted:
        _record(plan, files, entries, wanted)
        return
    held = _held(entries)
    frame = site.frame_of(home)
    # room is kept for `articles.json`, which says at the end what the pages carry
    spare = site.ARTICLES not in plan.files
    count = len(plan.files) + spare
    weight = sum(len(data) for data in plan.files.values()) + (MAX_LIST_BYTES if spare else 0)
    large = 0
    for folder in _card_folders(entries):
        data = files.read(f"{folder}/{site.CARD}", site.MAX_CARD_BYTES)
        card = site.read_card(folder, data) if data is not None else None
        if card is None or card["layout"] == "map" or not githubpages.deletable(folder, held.get(folder, set()), True):
            continue
        path = f"{folder}/{site.HOME}"
        known = _carried_known(entries[path])
        page = None
        if known is None:
            page = files.read(path, MAX_BAR_PAGE_BYTES)
            if page is None:
                large += 1
                continue
            known = carried_by(page)
            _carried_kept(entries[path], known)
        if known[0] == "" or known == wanted:
            continue
        page = page if page is not None else files.read(path, MAX_BAR_PAGE_BYTES)
        if page is None:
            large += 1
            continue
        changed: bytes | None = page
        if known[0] != wanted[0]:
            changed = site.with_bar(page, bar or site.bar(frame, _logo_of(folder, held.get(folder, set()), entries, home)))
        if changed is not None and known[1] != wanted[1]:
            # a page with no footer of Azimut's to follow keeps its bar changed and goes without
            changed = site.with_footer(changed, footer) or changed
        if changed is None or changed == page:
            continue
        if count + 1 > githubpages.MAX_FILES or weight + len(changed) > githubpages.MAX_TOTAL_BYTES:
            plan.warnings.append(PAGES_LEFT)
            _record(plan, files, entries, None)
            return
        plan.files[path] = changed
        count, weight = count + 1, weight + len(changed)
        sha = githubpages.blob_sha(changed)
        _carried_kept(sha, carried_by(changed))
        _remember(sha, changed)
    if large:
        # a page left as it was: nothing says they all carry the same, so the next press looks again
        plan.warnings.append(pages_too_large(large))
    _record(plan, files, entries, None if large else wanted)


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
    #: Whose bar the article pages carry: `yours` when the site's `azimut-bar.html` reads as one, else `azimut`.
    bar: str = AZIMUT_BAR
    #: Whose footer they carry: `yours` when the site's `azimut-footer.html` reads as one, else `none`.
    footer: str = "none"
    #: What the site's files weigh in bytes, None when the tree was too long to read whole.
    bytes: int | None = None


def _on_site(address: str, home: Site) -> str:
    """An address a card names, whole: one on the site (`/…`) as the site serves it."""
    return home.address.rstrip("/") + address if address.startswith("/") else address


def _item(card: dict[str, Any], home: Site, weight: int, held: set[str]) -> dict[str, Any]:
    # a card the list reads is a card of azimut-article/1, so the delete's guard (`githubpages.deletable`)
    # is asked of the folder's name and files, which this tree holds already
    return {"folder": card["folder"], "address": _on_site(card["address"], home), "title": card["title"],
            "summary": card["summary"], "date": card["date"], "date_label": card["date_label"],
            "category": card["category"], "role": card["role"], "layout": card["layout"],
            "image": _on_site(card["image"], home) if card["image"] else "", "bytes": weight,
            "author": card["author"], "deletable": githubpages.deletable(card["folder"], held, True),
            **({"place": card["place"]} if "place" in card else {}),
            **({"author_image": _on_site(card["author_image"], home)} if "author_image" in card else {})}


def _held(entries: dict[str, str]) -> dict[str, set[str]]:
    """The files of each folder at the site's root, by their paths from that folder."""
    held: dict[str, set[str]] = {}
    for path in entries:
        top, _, rest = path.partition("/")
        if rest:
            held.setdefault(top, set()).add(rest)
    return held


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
    held = _held(entries)
    out.items = [_item(card, home, weight[card["folder"]], held.get(card["folder"], set())) for card in cards]
    counts: dict[str, int] = {}
    for card in cards:
        if card["role"] == site.ARTICLE and card["category"]:
            counts[card["category"]] = counts.get(card["category"], 0) + 1
    # the root page: Azimut's home, the analyst's own, or none; and every page whose lists Azimut fills
    root = files.text(site.HOME, site.MAX_PAGE_BYTES) if site.HOME in entries else None
    out.home = "none" if site.HOME not in entries else "azimut" if root is not None and site.owns_home(root) else "yours"
    bar, footer, _ = _site_parts(files, tree, out.warnings)
    out.bar = "yours" if bar else AZIMUT_BAR
    out.footer = "yours" if footer else "none"
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
    # a category a marked page names that no listed card carries yet is one too, with no article
    for name in listed:
        counts.setdefault(name, 0)
    out.categories = [{"name": name, "count": count, "pages": listed.get(name, [])}
                      for name, count in sorted(counts.items(), key=lambda one: (-one[1], one[0].casefold()))]
    out.legal = _page_named(entries, out.items, LEGAL_FOLDERS, site.LEGAL_TITLE)
    out.privacy = _page_named(entries, out.items, PRIVACY_FOLDERS, site.PRIVACY_TITLE)
    out.found = sorted({*site.categories_of(cards), *listed})
    return out
