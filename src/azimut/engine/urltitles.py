"""What a web address is called, and whether the case already holds it, read off the
address alone.

A source cited in a note needs a name that says what it is (*Post by @port_watch on
X*), not a bare address, and a link pasted twice must cite the one item the case
already filed for it. Both are answered here from the address and the case, never by
fetching the page: a title read off the network would send the case's sources to
whoever runs the site, and a link pasted offline would get no name at all.

A note's written links are looked up the same way, many at once: `AddressIndex` reads
every item that holds an address in one pass and answers each link from that map, so
a long article costs one reading of the case rather than one per link.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit

from .proposals import URL_ATTRS

if TYPE_CHECKING:
    from ..workspace import Case

#: Prefixes a host is written with that name the same site.
_HOST_PREFIXES = ("www.", "mobile.", "m.")

#: Hosts that are another name for the same site: X's own old name and the mirrors a
#: post is shared through so it embeds in a chat.
_SAME_SITE = {
    "twitter.com": "x.com", "vxtwitter.com": "x.com", "fxtwitter.com": "x.com", "fixupx.com": "x.com",
    "fixvx.com": "x.com", "telegram.me": "t.me", "youtu.be": "youtube.com", "youtube-nocookie.com": "youtube.com",
}

#: Query words that say how a link was shared or counted rather than what it points at.
_TRACKING = frozenset({
    "fbclid", "gclid", "dclid", "msclkid", "twclid", "yclid", "igshid", "igsh", "si", "mibextid",
    "ref_src", "ref_url", "mc_cid", "mc_eid", "_ga", "_gl", "ocid", "smid", "cmpid",
})
#: Prefixes of such words: campaign tags (`utm_source`) and the BBC's (`at_medium`).
_TRACKING_PREFIXES = ("utm_", "at_")
#: The YouTube paths that name one video by its id, as a watch link does.
_VIDEO_PATHS = ("shorts", "live", "embed", "v")

#: What a case keeps an address in, by type: a file's source, a bookmark's target and
#: the page a capture was taken of. The first ones found are the ones a note cites.
ADDRESS_ATTRS: dict[str, str] = {**URL_ATTRS, "capture": "source_url"}
_ORDER = ("media", "bookmark", "capture")
#: What a pasted link offers to cite: the items that hold the page itself.
FILED = _ORDER
#: A proof imported from somebody's post keeps that post's address (`proofimport.PUBLISHED_URL`):
#: the page it was taken from, so a link to that page finds it, after what holds the page itself.
IMPORTED_FROM = "published_url"
#: Where the analyst published a proof of their own (`notesources.POSTED`): the case's own work.
POSTED_AT = "posted_url"
#: Every type that holds an address, in the order a link to it is answered.
INDEXED = (*_ORDER, "proof")

#: The most items one lookup answers: a link filed more than this often is a case to tidy.
MAX_FOUND = 5

_PAGE = 500
_MAX_TITLE = 120


def _host(parts: Any) -> str:
    host = (parts.hostname or "").lower()
    for prefix in _HOST_PREFIXES:
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    return _SAME_SITE.get(host, host)


def _web(url: Any) -> Any:
    if not isinstance(url, str) or not url.strip():
        return None
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return parts


def _tracking(key: str) -> bool:
    word = key.lower()
    return word in _TRACKING or word.startswith(_TRACKING_PREFIXES)


def url_key(url: Any) -> str:
    """What two addresses share when they are the same page, or "" when ``url`` is
    not a web address.

    The scheme, a ``www.``, a trailing slash, a fragment and the words a share button
    adds are dropped, a path is read with its escapes undone (`%D8%A7` is `ا`), and a
    site's other names are folded into one. A post on X is known by its number, which
    stays when the account is renamed; a Telegram channel and an X handle are read
    without case, as those sites read them. A fragment that routes a page of its own
    (`#/article/12`, `#!/12`) is kept, since there it is the page.
    """
    parts = _web(url)
    if parts is None:
        return ""
    raw_host = (parts.hostname or "").lower()
    host = _host(parts)
    segs = [unquote(seg) for seg in parts.path.split("/") if seg]
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=False) if not _tracking(key)]
    if host == "x.com":
        if "status" in segs:
            at = segs.index("status")
            if at + 1 < len(segs) and segs[at + 1].isdigit():
                return f"x.com/status/{segs[at + 1]}"
        return "x.com/" + "/".join(seg.lower() for seg in segs)
    if host == "t.me":
        if segs and segs[0] == "s":
            segs = segs[1:]
        return "t.me/" + "/".join(segs[:3] if segs[:1] == ["c"] else segs[:2]).lower()
    if host == "youtube.com":
        if raw_host.endswith("youtu.be") and segs:
            return f"youtube.com/watch?v={segs[0]}"
        if segs[:1] == ["watch"]:
            video = dict(query).get("v", "")
            return f"youtube.com/watch?v={video}" if video else "youtube.com/watch"
        if segs[:1] and segs[0] in _VIDEO_PATHS and len(segs) > 1:
            return f"youtube.com/watch?v={segs[1]}"
    path = "/".join(segs)
    tail = f"?{urlencode(sorted(query))}" if query else ""
    route = parts.fragment if parts.fragment.startswith(("/", "!/")) else ""
    said = f"{host}/{path}{tail}" if path or tail else host
    return f"{said}#{route}" if route else said


def _cut(words: str) -> str:
    words = " ".join(words.split())
    return words if len(words) <= _MAX_TITLE else f"{words[:_MAX_TITLE - 1].rstrip()}…"


def title_of(url: Any, page_title: Any = "") -> str:
    """A name for the page at ``url``, read off its address: *Post by @h on X*,
    *Telegram, channel #42*, else the title the page gave itself when the browser
    passed it on (``page_title``), else its host and path. "" when it is not a web
    address."""
    parts = _web(url)
    if parts is None:
        return ""
    raw_host = (parts.hostname or "").lower()
    host = _host(parts)
    segs = [seg for seg in parts.path.split("/") if seg]
    query = dict(parse_qsl(parts.query))
    said = ""
    if host == "x.com":
        if len(segs) >= 3 and segs[1] == "status" and segs[0] not in ("i",):
            said = f"Post by @{segs[0]} on X"
        elif "status" in segs:
            said = "Post on X"
        elif len(segs) == 1:
            said = f"@{segs[0]} on X"
    elif host == "t.me":
        if segs and segs[0] == "s":
            segs = segs[1:]
        if len(segs) >= 3 and segs[0] == "c" and segs[2].isdigit():
            said = f"Telegram, private channel #{segs[2]}"
        elif len(segs) >= 2 and segs[1].isdigit():
            said = f"Telegram, {segs[0]} #{segs[1]}"
        elif len(segs) == 1:
            said = f"Telegram, {segs[0]}"
    elif host == "youtube.com":
        if raw_host.endswith("youtu.be") and segs:
            said = f"YouTube video {segs[0]}"
        elif segs[:1] == ["watch"] and query.get("v"):
            said = f"YouTube video {query['v']}"
        elif segs[:1] == ["shorts"] and len(segs) > 1:
            said = f"YouTube Short {segs[1]}"
        elif segs and segs[0].startswith("@"):
            said = f"{segs[0]} on YouTube"
    elif host == "bsky.app":
        if len(segs) >= 4 and segs[0] == "profile" and segs[2] == "post":
            said = f"Post by @{segs[1]} on Bluesky"
        elif len(segs) >= 2 and segs[0] == "profile":
            said = f"@{segs[1]} on Bluesky"
    elif host == "instagram.com":
        if len(segs) >= 2 and segs[0] in ("p", "reel", "tv"):
            said = f"Instagram {'reel' if segs[0] == 'reel' else 'post'} {segs[1]}"
        elif len(segs) >= 3 and segs[1] in ("p", "reel"):
            said = f"Instagram {'reel' if segs[1] == 'reel' else 'post'} by @{segs[0]}"
        elif len(segs) == 1:
            said = f"@{segs[0]} on Instagram"
    elif host == "tiktok.com":
        if len(segs) >= 3 and segs[0].startswith("@") and segs[1] == "video":
            said = f"TikTok video by {segs[0]}"
        elif segs and segs[0].startswith("@"):
            said = f"{segs[0]} on TikTok"
    elif host == "facebook.com":
        if len(segs) >= 3 and segs[1] in ("posts", "videos"):
            said = f"Facebook {'video' if segs[1] == 'videos' else 'post'} by {segs[0]}"
        elif segs[:1] == ["watch"] or segs[:1] == ["reel"]:
            said = "Facebook video"
        elif segs[:1] in (["share"], ["permalink.php"], ["story.php"]):
            said = "Facebook post"
        elif len(segs) == 1:
            said = f"{segs[0]} on Facebook"
    elif host == "reddit.com" or host.endswith(".reddit.com"):
        if len(segs) >= 4 and segs[0] == "r" and segs[2] == "comments":
            said = f"Reddit post in r/{segs[1]}"
        elif len(segs) >= 2 and segs[0] == "r":
            said = f"r/{segs[1]} on Reddit"
    if said:
        return _cut(said)
    if isinstance(page_title, str) and page_title.strip():
        return _cut(page_title)
    path = parts.path if parts.path not in ("", "/") else ""
    return _cut(f"{host}{path.rstrip('/')}")


class AddressIndex:
    """Every item of a case that holds an address, by the page it is, read in one pass.

    A file of the case keeps the post it came from (`source_url`), a bookmark its page,
    a capture the map view it was taken of, and a proof imported from somebody's post
    that post (`published_url`). A page held by several is answered in that order, the
    first filed first. A proof's `posted_url`, where the analyst published it, is kept
    apart: a link to it is the case's own work rather than a source.

    ``case`` may be None, or something that cannot page its entities (a template, a
    test's stand-in): the index is then empty and answers nothing.
    """

    def __init__(self, case: "Case | None") -> None:
        found: dict[str, list[tuple[int, str, dict[str, Any]]]] = {}
        self.own: set[str] = set()
        self.read = 0
        page_entities = getattr(case, "page_entities", None)
        cursor: str | None = None
        while page_entities is not None:
            page = page_entities(limit=_PAGE, cursor=cursor, types=list(INDEXED))
            self.read += 1
            for entity in page["items"]:
                kind = str(entity.get("type") or "")
                attrs = entity.get("attrs") or {}
                attr = ADDRESS_ATTRS.get(kind) or (IMPORTED_FROM if kind == "proof" else "")
                key = url_key(attrs.get(attr)) if attr else ""
                if key:
                    at = str((entity.get("provenance") or {}).get("at") or "")
                    found.setdefault(key, []).append((INDEXED.index(kind), at, entity))
                posted = url_key(attrs.get(POSTED_AT)) if kind == "proof" else ""
                if posted:
                    self.own.add(posted)
            cursor = page.get("next_cursor")
            if not cursor:
                break
        self._by_key = {
            key: [entity for _, _, entity in sorted(held, key=lambda one: (one[0], one[1]))]
            for key, held in found.items()
        }

    def __len__(self) -> int:
        return len(self._by_key)

    def find(self, url: Any, *, types: tuple[str, ...] = INDEXED) -> list[dict[str, Any]]:
        """The items filed for the page at ``url``, in the order a link is answered."""
        key = url_key(url)
        held = self._by_key.get(key, []) if key else []
        return [entity for entity in held if entity.get("type") in types][:MAX_FOUND]

    def first(self, url: Any) -> dict[str, Any] | None:
        """The item a written link to ``url`` cites, or None when the case holds none."""
        found = self.find(url)
        return found[0] if found else None

    def own_work(self, url: Any) -> bool:
        """Whether ``url`` is where the analyst published a proof of their own."""
        key = url_key(url)
        return bool(key) and key in self.own


def find_by_url(case: "Case", url: Any) -> list[dict[str, Any]]:
    """The items of the case filed for the page at ``url``: downloaded files first,
    then bookmarks, then captures of it, the first filed first. Read from the case
    only."""
    if not url_key(url):
        return []
    return AddressIndex(case).find(url, types=FILED)
