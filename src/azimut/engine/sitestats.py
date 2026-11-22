"""How many read the analyst's site, read from Cloudflare Web Analytics on a press.

A site that counts its readers with Cloudflare Web Analytics (`engine/site.py`, `site_stats`
= `cloudflare`) can have its numbers read back in Settings › Website › Readers: the page
views and visits of each page over the last 7 and 30 days, the site's total, and the
referrers and countries its visits came from. GoatCounter has its own page for that.

**The call** is one GraphQL query to `https://api.cloudflare.com/client/v4/graphql` (after
the list of sites below, when the site tag must be found), and nowhere else, sent on the
Read the numbers press only: nothing here runs on a schedule, at
startup or on a read. It is a POST of `{"query", "variables"}` with the token in the
`Authorization: Bearer` header (never in an address, never logged, never said back),
timeouts, the answer read up to a bound and no redirect followed. From Cloudflare's
GraphQL Analytics API docs (developers.cloudflare.com, read on 2026-11-21): that endpoint
and header; the Web Analytics dataset `rumPageloadEventsAdaptiveGroups`, an account's
(`viewer.accounts(filter: {accountTag})`); filters as `field_geq` and `field_leq`; sorting as
`orderBy: [count_DESC]`; groups with `count`, `sum` and `avg`; `sampleInterval`, which says
how far a count was sampled; 300 queries per 5 minutes; errors that may come with a 200,
each a `message`. The dataset's own fields (`siteTag`, `datetime`, `requestPath`,
`refererHost`, `countryName`, `sum.visits`) are the ones Cloudflare's dashboard asks for:
Cloudflare's docs list the dataset without them.

**What it needs**, each set in Settings › Website › Readers: the account ID and an API token
with two read-only permissions, Account Analytics and Account Settings. The query filters by
the site tag of the Web Analytics site, which is not the site token every page prints: the
press finds it by listing the account's sites (`GET accounts/{account}/rum/site_info/list`,
read page by page, from Cloudflare's API reference) and taking the one whose `site_token` is
the site token Readers holds. The tag found is remembered with the site token it was found
for, so the next press asks no list; it is looked up again when the site token changes or
when Cloudflare counts nothing under it. A tag typed by hand wins and is never looked up.
The token is kept like the GitHub token (`engine/publishsecrets.py`); the account ID, the
site tag and the site token it was found for are ordinary settings (`site_stats_account`,
`site_stats_tag`, `site_stats_tag_from`), which the backup carries.

**What it gives**, bounded: the pages, each path read down to the page of the site it is
(`index.html` dropped, the site's folder taken off the front), 7 and 30 days side by side,
500 at most; the totals; the 10 referrers and countries visits came from most. Which
article a page is, with its title, is said by the browser from the read of the site it
holds (`lib/websiteHub.js`), so a page the read does not know shows its path.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

import httpx

from .. import __version__
from .site import CLOUDFLARE_ID

API = "https://api.cloudflare.com/client/v4/graphql"
#: The account's Web Analytics sites, each with its site tag and its site token.
SITES = "https://api.cloudflare.com/client/v4/accounts/{account}/rum/site_info/list"
#: How many pages of that list are read, at most.
MAX_SITE_PAGES = 20
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
#: The most the answer may weigh.
MAX_ANSWER = 2 * 1024 * 1024
#: How many pages each window asks for, and how many referrers and countries are listed.
MAX_PAGES = 500
MAX_RANKED = 10
#: The longest path kept, and the most a count may say.
MAX_PATH = 512
MAX_COUNT = 10**12
#: The two windows, in days back from the press.
WEEK = 7
MONTH = 30

#: An API token: what a Bearer header carries (RFC 6750's characters).
API_TOKEN = re.compile(r"^[A-Za-z0-9._~+/=-]{20,255}$")

NOT_SET = "Fill in the account ID, the API token and the site token first."
NO_SITE = "No Web Analytics site in this account has the site token set in Readers."
NEEDS_SETTINGS = ("The API token may not list this account's Web Analytics sites: give it Account Settings, "
                  "Read, and check the account ID.")
BAD_TOKEN = ("Cloudflare refused the API token: it may be mistyped, expired or deleted. "
             "Make a new one and paste it here.")
NO_ACCESS = ("The API token may not read this account: give it Account Analytics, Read, "
             "and check the account ID.")
NO_ACCOUNT = "Cloudflare found no account with this ID for the API token: check the account ID."
RATE_LIMITED = "Cloudflare asks Azimut to wait: try again in 5 minutes."
BUSY = "Cloudflare is busy: try again in a moment."
TOO_FAR = "Cloudflare would not read 30 days back for this site."
CHANGED = "Cloudflare did not take the question, which may mean its API changed: check for an Azimut update."
TIMED_OUT = "Cloudflare did not answer in time. Try again in a moment."
OFFLINE = "Azimut could not reach Cloudflare. Check this computer's connection."
UNREADABLE = "Cloudflare answered with something Azimut cannot read."
TOO_LARGE = "Cloudflare answered with more than Azimut reads at once."
MOVED = "Cloudflare answered from another address, which Azimut does not follow."

#: What each of Cloudflare's documented error messages means, the first that matches.
MESSAGES: tuple[tuple[str, str], ...] = (
    ("rate limiter budget depleted", RATE_LIMITED),
    ("too many queries in progress", BUSY),
    ("unable to execute query", BUSY),
    ("not authorized for that account", NO_ACCESS),
    ("does not have access", NO_ACCESS),
    ("authentication error", BAD_TOKEN),
    ("invalid api token", BAD_TOKEN),
    ("unauthorized", BAD_TOKEN),
    ("cannot request data older than", TOO_FAR),
    ("time range is too large", TOO_FAR),
    ("unknown field", CHANGED),
    ("error parsing args", CHANGED),
    ("query contains error", CHANGED),
    ("must have selections", CHANGED),
    ("must have no selections", CHANGED),
)


class StatsError(Exception):
    """Something Cloudflare, the network or a setting stopped, said in one sentence.
    ``status`` is Cloudflare's HTTP answer, 0 for none; ``needs`` is `tag` when typing the site tag
    by hand gets round it."""

    def __init__(self, message: str, status: int = 0, *, needs: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.needs = needs


def api_token(value: str) -> str:
    """The API token as typed, trimmed, once it reads as one a Bearer header carries."""
    token = value.strip()
    if not API_TOKEN.match(token):
        raise StatsError("That does not read as a Cloudflare API token: copy it whole, as Cloudflare showed it.")
    return token


def client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    """The one way out to Cloudflare: timeouts, no redirect followed, Azimut named.
    ``transport`` stands Cloudflare in for the tests."""
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False, transport=transport,
                        headers={"User-Agent": f"Azimut/{__version__}"})


# -- the question --------------------------------------------------------------------------------


def _stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def query(now: datetime) -> str:
    """The one GraphQL query: per page, totals, referrers and countries, each window a filter.

    Only the two times Azimut makes are written into it; the account ID and the site tag go
    as variables."""
    until = _stamp(now)
    week = f'siteTag: $site, datetime_geq: "{_stamp(now - timedelta(days=WEEK))}", datetime_leq: "{until}"'
    month = f'siteTag: $site, datetime_geq: "{_stamp(now - timedelta(days=MONTH))}", datetime_leq: "{until}"'
    counts = "count sum { visits }"
    return f"""query SiteNumbers($account: string!, $site: string!) {{
  viewer {{
    accounts(filter: {{accountTag: $account}}) {{
      pagesWeek: rumPageloadEventsAdaptiveGroups(limit: {MAX_PAGES}, filter: {{{week}}}, orderBy: [count_DESC]) {{
        {counts} dimensions {{ requestPath }}
      }}
      pagesMonth: rumPageloadEventsAdaptiveGroups(limit: {MAX_PAGES}, filter: {{{month}}}, orderBy: [count_DESC]) {{
        {counts} dimensions {{ requestPath }}
      }}
      totalWeek: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {{{week}}}) {{
        {counts} avg {{ sampleInterval }}
      }}
      totalMonth: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {{{month}}}) {{
        {counts} avg {{ sampleInterval }}
      }}
      referrers: rumPageloadEventsAdaptiveGroups(limit: {MAX_RANKED + 2}, filter: {{{month}}}, orderBy: [count_DESC]) {{
        {counts} dimensions {{ refererHost }}
      }}
      countries: rumPageloadEventsAdaptiveGroups(limit: {MAX_RANKED}, filter: {{{month}}}, orderBy: [count_DESC]) {{
        {counts} dimensions {{ countryName }}
      }}
    }}
  }}
}}"""


# -- the answer ----------------------------------------------------------------------------------


@dataclass
class Counts:
    views: int = 0
    visits: int = 0

    def add(self, other: Counts) -> None:
        self.views = min(self.views + other.views, MAX_COUNT)
        self.visits = min(self.visits + other.visits, MAX_COUNT)

    def said(self) -> dict[str, int]:
        return {"views": self.views, "visits": self.visits}


@dataclass
class _Page:
    path: str
    page: str | None
    week: Counts = field(default_factory=Counts)
    month: Counts = field(default_factory=Counts)


def _number(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or value < 0:
        return 0
    return int(min(value, MAX_COUNT))


def _counts(group: Mapping[str, Any]) -> Counts:
    summed = group.get("sum")
    visits = summed.get("visits") if isinstance(summed, dict) else 0
    return Counts(views=_number(group.get("count")), visits=_number(visits))


def _groups(found: Mapping[str, Any], name: str, cap: int) -> list[dict[str, Any]]:
    groups = found.get(name)
    return [group for group in groups[:cap] if isinstance(group, dict)] if isinstance(groups, list) else []


def _dimension(group: Mapping[str, Any], name: str) -> Any:
    dimensions = group.get("dimensions")
    return dimensions.get(name) if isinstance(dimensions, dict) else None


def site_prefix(address: str) -> str:
    """The folder a site is served from, as a path with no closing slash: "" on a domain's root."""
    path = re.sub(r"^https?://[^/]+", "", address.strip()).split("?")[0].split("#")[0]
    return "/" + "/".join(part for part in path.split("/") if part) if path.strip("/") else ""


def page_of(path: str, prefix: str = "") -> tuple[str, str | None] | None:
    """A request path read down to the page it is: ``(path, page)``.

    ``path`` is the path cleaned (doubled slashes joined, `index.html` dropped, a folder given its
    closing slash), so `/a/b`, `/a/b/` and `/a/b/index.html` are one page; ``page`` is that path
    within the site's folder (`bab/`, "" for the home), or None for a page outside it. None for
    what is no path."""
    if not isinstance(path, str) or not path.startswith("/") or len(path) > MAX_PATH:
        return None
    path = path.split("?")[0].split("#")[0]
    parts = [part for part in path.split("/") if part]
    if any(part in (".", "..") or any(ord(char) < 32 for char in part) for part in parts):
        return None
    if parts and parts[-1].lower() in ("index.html", "index.htm"):
        parts.pop()
        folder = True
    else:
        folder = path.endswith("/") or not parts or "." not in parts[-1]
    clean = "/" + "/".join(parts) + ("/" if folder and parts else "")
    inside = [part for part in prefix.split("/") if part]
    if parts[: len(inside)] != inside:
        return clean, None
    rest = parts[len(inside):]
    return clean, "/".join(rest) + ("/" if folder and rest else "")


def numbers_of(body: Any, prefix: str = "") -> dict[str, Any]:
    """The numbers in Cloudflare's answer, bounded: pages merged by the page they are and ranked by
    their 30 days, the totals, the referrers (the site's own host and the visits that came with none
    left apart) and the countries."""
    data = body.get("data") if isinstance(body, dict) else None
    viewer = data.get("viewer") if isinstance(data, dict) else None
    accounts = viewer.get("accounts") if isinstance(viewer, dict) else None
    if not isinstance(accounts, list):
        raise StatsError(UNREADABLE)
    if not accounts or not isinstance(accounts[0], dict):
        raise StatsError(NO_ACCOUNT)
    found: dict[str, Any] = accounts[0]

    pages: dict[str, _Page] = {}
    for window in ("pagesWeek", "pagesMonth"):
        for group in _groups(found, window, MAX_PAGES):
            read = page_of(_dimension(group, "requestPath"), prefix)
            if read is None:
                continue
            kept = pages.setdefault(read[0], _Page(path=read[0], page=read[1]))
            (kept.week if window == "pagesWeek" else kept.month).add(_counts(group))
    ranked = sorted(pages.values(), key=lambda one: (-one.month.views, -one.week.views, one.path))[:MAX_PAGES]

    totals: dict[str, dict[str, int]] = {}
    sampled = False
    for window, name in (("totalWeek", "week"), ("totalMonth", "month")):
        groups = _groups(found, window, 1)
        totals[name] = (_counts(groups[0]) if groups else Counts()).said()
        average = groups[0].get("avg") if groups else None
        interval = average.get("sampleInterval") if isinstance(average, dict) else None
        sampled = sampled or (isinstance(interval, (int, float)) and not isinstance(interval, bool) and interval > 1)

    referrers = []
    for group in _groups(found, "referrers", MAX_RANKED + 2):
        host = _dimension(group, "refererHost")
        host = host.strip().lower()[:253] if isinstance(host, str) else ""
        referrers.append({"host": host, **_counts(group).said()})
    countries = []
    for group in _groups(found, "countries", MAX_RANKED):
        code = _dimension(group, "countryName")
        countries.append({"country": code.strip()[:64] if isinstance(code, str) else "", **_counts(group).said()})

    return {
        "pages": [{"path": one.path, "page": one.page, "week": one.week.said(), "month": one.month.said()}
                  for one in ranked],
        "total": totals,
        "referrers": referrers,
        "countries": countries,
        "sampled": sampled,
    }


def own_referrers(referrers: list[dict[str, Any]], host: str) -> list[dict[str, Any]]:
    """The referrers less the site's own host, whose page views are readers moving within it."""
    host = host.lower()
    return [one for one in referrers if not host or one["host"] != host][:MAX_RANKED]


# -- the press -----------------------------------------------------------------------------------


def _message(body: Any) -> str:
    errors = body.get("errors") if isinstance(body, dict) else None
    if not isinstance(errors, list):
        return ""
    for error in errors:
        message = error.get("message") if isinstance(error, dict) else None
        if isinstance(message, str) and message.strip():
            return re.sub(r"<[^>]+>", "", " ".join(message.split()))[:160]
    return ""


def _meaning(message: str) -> str:
    lowered = message.lower()
    return next((said for words, said in MESSAGES if words in lowered), "")


def _checked(status: int, body: Any) -> Any:
    """The answer when it holds the numbers, else the sentence that says what went wrong."""
    message = _message(body)
    meaning = _meaning(message)
    if status == 401:
        raise StatsError(BAD_TOKEN, status)
    if status == 429:
        raise StatsError(RATE_LIMITED, status)
    if status == 403:
        raise StatsError(meaning if meaning == BAD_TOKEN else NO_ACCESS, status)
    if meaning:
        raise StatsError(meaning, status)
    if status == 503:
        raise StatsError(BUSY, status)
    if status >= 500:
        raise StatsError(f"Cloudflare is having trouble (HTTP {status}): try again in a moment.", status)
    if message:
        raise StatsError(f"Cloudflare would not read the numbers: {message}.", status)
    if status >= 300:
        raise StatsError(f"Cloudflare answered HTTP {status} when asked for the numbers.", status)
    return body


def _ask(http: httpx.Client, method: str, url: str, token: str, *, payload: Any = None,
         query_string: Mapping[str, str] | None = None) -> tuple[int, Any]:
    """One request to Cloudflare with the token in its header: its status and its JSON, read up to a
    bound, None for what is no JSON. A redirect is not followed."""
    try:
        request = http.build_request(method, url, json=payload, params=query_string,
                                     headers={"Authorization": f"Bearer {token}"})
        response = http.send(request, stream=True)
        try:
            kept = bytearray()
            for chunk in response.iter_bytes():
                kept += chunk
                if len(kept) > MAX_ANSWER:
                    raise StatsError(TOO_LARGE, response.status_code)
        finally:
            response.close()
    except httpx.TimeoutException as exc:
        raise StatsError(TIMED_OUT) from exc
    except httpx.ConnectError as exc:
        raise StatsError(OFFLINE) from exc
    except httpx.HTTPError as exc:
        raise StatsError("Cloudflare could not be reached.") from exc
    status = response.status_code
    if 300 <= status < 400:
        raise StatsError(MOVED, status)
    try:
        return status, json.loads(bytes(kept) or b"null")
    except ValueError:
        return status, None


def read_numbers(http: httpx.Client, token: str, account: str, site: str, *, prefix: str = "", host: str = "",
                 now: datetime | None = None) -> dict[str, Any]:
    """Ask Cloudflare for the site's numbers, in one request: see `numbers_of` for what comes back,
    with ``read_at``, the moment the windows end."""
    if not (token and account and site):
        raise StatsError(NOT_SET)
    moment = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    payload = {"query": query(moment), "variables": {"account": account, "site": site}}
    status, body = _ask(http, "POST", API, token, payload=payload)
    _checked(status, body)
    if not isinstance(body, dict):
        raise StatsError(UNREADABLE, status)
    numbers = numbers_of(body, prefix)
    numbers["referrers"] = own_referrers(numbers["referrers"], host)
    numbers["read_at"] = _stamp(moment)
    numbers["days"] = [WEEK, MONTH]
    return numbers


def counted_nothing(numbers: Mapping[str, Any]) -> bool:
    """Whether a read found no page view at all in 30 days, as a wrong site tag reads."""
    return not numbers["pages"] and not numbers["total"]["month"]["views"]


# -- the site tag, found from the site token ------------------------------------------------------


def find_site_tag(http: httpx.Client, token: str, account: str, site_token: str) -> str:
    """The site tag of the account's Web Analytics site whose site token is ``site_token``.

    Lists the account's sites page by page (`GET accounts/{account}/rum/site_info/list`, which needs
    Account Settings, Read), `MAX_SITE_PAGES` at most. A token that may not list them raises with
    ``needs`` set to `tag`, as does an account where no site has that site token: the analyst then
    types the tag by hand."""
    if not (token and account and site_token):
        raise StatsError(NOT_SET)
    url = SITES.format(account=account)
    for page in range(1, MAX_SITE_PAGES + 1):
        status, body = _ask(http, "GET", url, token, query_string={"page": str(page)})
        _listed(status, body)
        sites = body.get("result") if isinstance(body, dict) else None
        if not isinstance(sites, list):
            raise StatsError(UNREADABLE, status)
        for one in sites:
            if isinstance(one, dict) and one.get("site_token") == site_token:
                tag = one.get("site_tag")
                tag = tag.strip().lower() if isinstance(tag, str) else ""
                if not CLOUDFLARE_ID.match(tag):
                    raise StatsError(UNREADABLE, status)
                return tag
        info = body.get("result_info") if isinstance(body, dict) else None
        pages = info.get("total_pages") if isinstance(info, dict) else None
        if not sites or not isinstance(pages, int) or isinstance(pages, bool) or page >= pages:
            break
    raise StatsError(NO_SITE, needs="tag")


def _listed(status: int, body: Any) -> None:
    """Nothing when the list came, else the sentence that says why not."""
    if status == 401 or "invalid api token" in _message(body).lower():
        raise StatsError(BAD_TOKEN, status)
    if status == 403:
        raise StatsError(NEEDS_SETTINGS, status, needs="tag")
    if status == 429:
        raise StatsError(RATE_LIMITED, status)
    if status >= 500:
        raise StatsError(f"Cloudflare is having trouble (HTTP {status}): try again in a moment.", status)
    if status >= 300 or not isinstance(body, dict) or body.get("success") is False:
        message = _message(body)
        raise StatsError(f"Cloudflare would not list the account's sites{f': {message}' if message else ''}.", status)
