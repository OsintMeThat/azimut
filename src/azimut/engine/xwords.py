"""An X post's words, from X's own embed read, when gallery-dl comes back without them.

X answers a guest in two shapes. In the newer one a post's words sit under ``details``,
which gallery-dl did not read as of 1.32.21, so a read through it came back with an
empty ``content``: a `/post` card with no text, and a download titled by its file name,
its position and its links lost, since all three are read from the words.

`fill` puts the words back from ``cdn.syndication.twimg.com``, the keyless read X serves
its embedded posts from. It runs only inside a read the analyst pressed for, only for an
X post gallery-dl gave no words for, and asks once per post: a post's files are listed,
then downloaded one gallery-dl run each, and every run carries the same post.
"""

from __future__ import annotations

import html
import math
import re
import time
from typing import Any

import httpx

from .. import USER_AGENT

ENDPOINT = "https://cdn.syndication.twimg.com/tweet-result"
TIMEOUT = 15.0
#: How many posts' words are kept, the oldest going first.
KEPT = 64
#: How long a read that failed is not tried again, in seconds, so a post's next file
#: does not wait on X a second time.
FAILED_FOR = 60.0

_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
#: What X said of each post asked, by id: when, and its words ("" for a post without
#: any), or None when X could not be asked.
_said: dict[str, tuple[float, str | None]] = {}


def client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}, transport=transport)


def _base36(value: float) -> str:
    """``value`` in base 36 as a browser writes it (`Number.prototype.toString(36)`),
    its fraction cut where the double's precision ends."""
    whole = math.floor(value)
    fraction = value - whole
    delta = max(0.5 * (math.nextafter(value, math.inf) - value), math.nextafter(0.0, 1.0))
    tail: list[int] = []
    if fraction >= delta:
        while True:
            fraction *= 36
            delta *= 36
            digit = int(fraction)
            tail.append(digit)
            fraction -= digit
            if (fraction > 0.5 or (fraction == 0.5 and digit & 1)) and fraction + delta > 1:
                while tail and tail[-1] == 35:
                    tail.pop()
                if tail:
                    tail[-1] += 1
                else:
                    whole += 1
                break
            if fraction < delta:
                break
    head = ""
    rest = int(whole)
    while True:
        rest, digit = divmod(rest, 36)
        head = _DIGITS[digit] + head
        if not rest:
            break
    return head + ("." + "".join(_DIGITS[digit] for digit in tail) if tail else "")


def token(tweet: str) -> str:
    """The token X's embed sends beside a post's id. X wants one, and did not check its
    value when this was written; this is the embed's own, should it start to."""
    return re.sub(r"0+|\.", "", _base36(int(tweet) / 1e15 * math.pi))


def words(data: dict[str, Any]) -> str:
    """A post's words as gallery-dl writes them: unescaped, each short link opened to
    the address it stands for, the links to the post's own pictures dropped."""
    text = html.unescape(str(data.get("text") or ""))
    entities = data.get("entities")
    entities = entities if isinstance(entities, dict) else {}
    for link in entities.get("urls") or []:
        if isinstance(link, dict) and link.get("url") and link.get("expanded_url"):
            text = text.replace(str(link["url"]), str(link["expanded_url"]))
    for shown in [*(entities.get("media") or []), *(data.get("mediaDetails") or [])]:
        if isinstance(shown, dict) and shown.get("url"):
            text = text.replace(str(shown["url"]), "")
    return text.strip()


def read(tweet: str) -> str | None:
    """The words X shows for the post, "" for a post without any, None when X could not
    be asked or would not say."""
    now = time.monotonic()
    held = _said.get(tweet)
    if held is not None and (held[1] is not None or now - held[0] < FAILED_FOR):
        return held[1]
    said: str | None = None
    try:
        with client() as http:
            answer = http.get(ENDPOINT, params={"id": tweet, "lang": "en", "token": token(tweet)})
        data = answer.json() if answer.status_code == 200 else None
        if isinstance(data, dict) and "text" in data:
            said = words(data)
    except (httpx.HTTPError, ValueError):
        said = None
    _said.pop(tweet, None)
    _said[tweet] = (now, said)
    while len(_said) > KEPT:
        _said.pop(next(iter(_said)))
    return said


def fill(*kwdicts: dict[str, Any] | None) -> None:
    """Put the words back, in place, in each X post gallery-dl read without them."""
    for kwdict in kwdicts:
        if not isinstance(kwdict, dict) or kwdict.get("category") != "twitter" or str(kwdict.get("content") or "").strip():
            continue
        tweet = str(kwdict.get("tweet_id") or "")
        if not tweet.isdigit():
            continue
        said = read(tweet)
        if said:
            kwdict["content"] = said
