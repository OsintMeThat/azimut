"""The site's reader numbers, read from Cloudflare Web Analytics on a press (`engine/sitestats.py`,
`/api/publishing/cloudflare…`, Settings › Website › Readers).

Cloudflare is stood in for behind `httpx.MockTransport`: no test reaches it and none needs an
account. The answers are shaped as Cloudflare's GraphQL Analytics API documents them (a `data`
tree under `viewer.accounts`, an `errors` list whose `message` may come with a 200) and the
errors are the messages its docs list.
"""

from __future__ import annotations

import json
import logging
import re
import stat
import sys
from datetime import datetime, timezone
from typing import Any, Callable

import httpx
import pytest

from azimut import config
from azimut.engine import publishsecrets, sitestats

ACCOUNT = "0123456789abcdef0123456789abcdef"
TAG = "fedcba9876543210fedcba9876543210"
TOKEN = "Cf_" + "k" * 37
SITE_TOKEN = "5ca1ab1e5ca1ab1e5ca1ab1e5ca1ab1e"
NOW = datetime(2026, 11, 21, 12, 0, 0, tzinfo=timezone.utc)


def group(count: int, visits: int, **dimensions: str) -> dict[str, Any]:
    found: dict[str, Any] = {"count": count, "sum": {"visits": visits}}
    if dimensions:
        found["dimensions"] = dimensions
    return found


def answer_of(**more: Any) -> dict[str, Any]:
    """What Cloudflare answers for a small site at octo.github.io/articles/."""
    account = {
        "pagesWeek": [group(40, 30, requestPath="/articles/bab/"), group(5, 1, requestPath="/articles/bab/index.html"),
                      group(8, 8, requestPath="/articles/")],
        "pagesMonth": [group(120, 90, requestPath="/articles/bab/"), group(30, 20, requestPath="/articles/guide"),
                       group(10, 2, requestPath="/articles/bab/index.html"), group(12, 12, requestPath="/articles/"),
                       group(3, 3, requestPath="/other-project/"), group(1, 1, requestPath="no path")],
        "totalWeek": [{**group(53, 39), "avg": {"sampleInterval": 1}}],
        "totalMonth": [{**group(176, 128), "avg": {"sampleInterval": 10}}],
        "referrers": [group(100, 0, refererHost="octo.github.io"), group(40, 40, refererHost=""),
                      group(30, 30, refererHost="News.YCombinator.com")],
        "countries": [group(80, 60, countryName="FR"), group(50, 40, countryName="US")],
    }
    account.update(more)
    return {"data": {"viewer": {"accounts": [account]}}, "errors": None}


def site(tag: str, token: str, host: str = "octo.github.io") -> dict[str, Any]:
    """A Web Analytics site as the site_info list gives it (Cloudflare's API reference)."""
    return {"auto_install": False, "created": "2026-11-01T10:00:00Z", "site_tag": tag, "site_token": token,
            "snippet": f"<script data-cf-beacon='{{\"token\": \"{token}\"}}'></script>",
            "rules": [{"host": host, "id": "r1", "inclusive": True, "is_paused": False, "paths": ["*"]}]}


class FakeCloudflare:
    """api.cloudflare.com: the GraphQL endpoint answering what the test says, and the account's list
    of Web Analytics sites, page by page. Every request is kept."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.answer: httpx.Response | Callable[[httpx.Request], httpx.Response] = httpx.Response(200, json=answer_of())
        #: the account's sites, one list per page of the site_info list
        self.sites: list[list[dict[str, Any]]] = [[site("0" * 32, "other-site-token-1"), site(TAG, SITE_TOKEN)]]
        self.list_answer: httpx.Response | None = None

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == f"/client/v4/accounts/{ACCOUNT}/rum/site_info/list":
            if self.list_answer is not None:
                return self.list_answer
            page = int(request.url.params.get("page", "1"))
            found = self.sites[page - 1] if page <= len(self.sites) else []
            return httpx.Response(200, json={"success": True, "errors": [], "messages": [], "result": found, "result_info": {
                "count": len(found), "page": page, "per_page": 10, "total_count": sum(map(len, self.sites)),
                "total_pages": len(self.sites)}})
        assert request.url.path == "/client/v4/graphql", request.url
        return self.answer(request) if callable(self.answer) else self.answer

    def asked(self) -> list[str]:
        """What was asked, in order: `list 1` for a page of the sites, `graphql` for the numbers."""
        return [f"list {request.url.params.get('page')}" if request.url.path.endswith("/list") else "graphql"
                for request in self.requests]

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


@pytest.fixture()
def fake(monkeypatch):
    stand_in = FakeCloudflare()
    real = sitestats.client
    monkeypatch.setattr(sitestats, "client", lambda transport=None: real(stand_in.transport()))
    return stand_in


def _read(fake: FakeCloudflare, **options: Any) -> dict[str, Any]:
    with sitestats.client() as http:
        return sitestats.read_numbers(http, TOKEN, ACCOUNT, TAG, now=NOW, **options)


def _set_up(client, *, github: bool = True, by_hand: bool = True) -> None:
    """Cloudflare counting the site, the account ID and the API token set, and the site tag typed by
    hand (`by_hand`) or left for the press to find from the site token."""
    prefs = {"site_stats": "cloudflare", "site_stats_account": ACCOUNT.upper(), "site_stats_token": SITE_TOKEN}
    if by_hand:
        prefs["site_stats_tag"] = f" {TAG} "
    saved = client.put("/api/settings/prefs", json=prefs)
    assert saved.status_code == 200, saved.text
    assert client.put("/api/publishing/cloudflare", json={"token": TOKEN}).status_code == 200
    if github:
        assert client.put("/api/publishing/github", json={"account": "octo"}).status_code == 200


# -- the question ------------------------------------------------------------------------------------


def test_one_query_goes_to_cloudflare_with_the_token_in_its_header_and_the_ids_as_variables(fake):
    _read(fake, prefix="/articles", host="octo.github.io")
    assert len(fake.requests) == 1
    request = fake.requests[0]
    assert (request.method, str(request.url)) == ("POST", "https://api.cloudflare.com/client/v4/graphql")
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert request.headers["content-type"] == "application/json"
    assert request.headers["user-agent"].startswith("Azimut/")
    body = json.loads(request.content)
    assert set(body) == {"query", "variables"}
    assert body["variables"] == {"account": ACCOUNT, "site": TAG}
    query = body["query"]
    # the token travels in the header only, and the ids only as variables
    assert TOKEN not in query and TOKEN not in str(request.url) and ACCOUNT not in query and TAG not in query
    assert "accounts(filter: {accountTag: $account})" in query
    assert query.count("rumPageloadEventsAdaptiveGroups(") == 6
    for alias in ("pagesWeek", "pagesMonth", "totalWeek", "totalMonth", "referrers", "countries"):
        assert f"{alias}: rumPageloadEventsAdaptiveGroups(" in query, alias
    # the two windows end at the press, 7 and 30 days back, each filtered by the site tag
    assert query.count('datetime_geq: "2026-11-14T12:00:00Z", datetime_leq: "2026-11-21T12:00:00Z"') == 2
    assert query.count('datetime_geq: "2026-10-22T12:00:00Z", datetime_leq: "2026-11-21T12:00:00Z"') == 4
    assert query.count("siteTag: $site") == 6
    for wanted in ("dimensions { requestPath }", "dimensions { refererHost }", "dimensions { countryName }",
                   "sum { visits }", "avg { sampleInterval }", "orderBy: [count_DESC]", f"limit: {sitestats.MAX_PAGES}"):
        assert wanted in query, wanted


def test_nothing_is_asked_without_the_three_settings(fake):
    with sitestats.client() as http:
        for token, account, tag in (("", ACCOUNT, TAG), (TOKEN, "", TAG), (TOKEN, ACCOUNT, "")):
            with pytest.raises(sitestats.StatsError, match="Fill in"):
                sitestats.read_numbers(http, token, account, tag, now=NOW)
    assert fake.requests == []


# -- the answer ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("path,prefix,read", [
    ("/articles/bab/", "/articles", ("/articles/bab/", "bab/")),
    ("/articles/bab", "/articles", ("/articles/bab/", "bab/")),
    ("/articles/bab/index.html", "/articles", ("/articles/bab/", "bab/")),
    ("//articles//bab//", "/articles", ("/articles/bab/", "bab/")),
    ("/articles/", "/articles", ("/articles/", "")),
    ("/articles", "/articles", ("/articles/", "")),
    ("/articles/index.html", "/articles", ("/articles/", "")),
    ("/articles/2026/01/05/patches/", "/articles", ("/articles/2026/01/05/patches/", "2026/01/05/patches/")),
    ("/articles/bab/map.html", "/articles", ("/articles/bab/map.html", "bab/map.html")),
    ("/articles/bab/?ref=x", "/articles", ("/articles/bab/", "bab/")),
    ("/other/", "/articles", ("/other/", None)),
    ("/", "/articles", ("/", None)),
    ("/bab/", "", ("/bab/", "bab/")),
    ("/", "", ("/", "")),
    ("/index.html", "", ("/", "")),
])
def test_a_path_is_read_down_to_the_page_of_the_site_it_is(path, prefix, read):
    assert sitestats.page_of(path, prefix) == read


@pytest.mark.parametrize("path", ["", "no-slash", "/a/../b", "/a/./b", "/a\x00b", "/" + "x" * 600, None, 42])
def test_what_is_no_path_is_left_out(path):
    assert sitestats.page_of(path, "") is None


@pytest.mark.parametrize("address,prefix", [
    ("https://octo.github.io/articles/", "/articles"),
    ("https://news.example.org/", ""),
    ("https://news.example.org", ""),
    ("https://octo.github.io/a/b/", "/a/b"),
    ("", ""),
])
def test_the_site_folder_is_read_from_its_address(address, prefix):
    assert sitestats.site_prefix(address) == prefix


def test_the_numbers_are_merged_by_page_ranked_by_their_30_days_and_said_whole(fake):
    numbers = _read(fake, prefix="/articles", host="octo.github.io")
    assert numbers["pages"] == [
        {"path": "/articles/bab/", "page": "bab/", "week": {"views": 45, "visits": 31}, "month": {"views": 130, "visits": 92}},
        {"path": "/articles/guide/", "page": "guide/", "week": {"views": 0, "visits": 0}, "month": {"views": 30, "visits": 20}},
        {"path": "/articles/", "page": "", "week": {"views": 8, "visits": 8}, "month": {"views": 12, "visits": 12}},
        {"path": "/other-project/", "page": None, "week": {"views": 0, "visits": 0}, "month": {"views": 3, "visits": 3}},
    ]
    assert numbers["total"] == {"week": {"views": 53, "visits": 39}, "month": {"views": 176, "visits": 128}}
    # the site's own host is readers moving within it; a visit that came with no referrer stays
    assert numbers["referrers"] == [{"host": "", "views": 40, "visits": 40},
                                    {"host": "news.ycombinator.com", "views": 30, "visits": 30}]
    assert numbers["countries"] == [{"country": "FR", "views": 80, "visits": 60}, {"country": "US", "views": 50, "visits": 40}]
    # a 30-day count Cloudflare sampled says so
    assert numbers["sampled"] is True
    assert numbers["read_at"] == "2026-11-21T12:00:00Z" and numbers["days"] == [7, 30]


def test_an_answer_is_read_within_bounds_and_what_is_no_count_counts_nothing(fake):
    many = [group(1, 1, requestPath=f"/p{index}/") for index in range(sitestats.MAX_PAGES + 50)]
    odd = [group(-4, 2, requestPath="/neg/"), {"count": "12", "sum": None, "dimensions": {"requestPath": "/text/"}},
           {"count": True, "dimensions": {"requestPath": "/bool/"}}, "not a group", {"count": 5}]
    fake.answer = httpx.Response(200, json=answer_of(
        pagesWeek=many, pagesMonth=many, totalWeek=[], totalMonth="nothing",
        referrers=[group(1, 1, refererHost=f"r{index}.example") for index in range(30)],
        countries=[group(1, 1, countryName="X" * 100)] * 30))
    numbers = _read(fake)
    assert len(numbers["pages"]) == sitestats.MAX_PAGES
    assert numbers["total"] == {"week": {"views": 0, "visits": 0}, "month": {"views": 0, "visits": 0}}
    assert numbers["sampled"] is False
    assert len(numbers["referrers"]) == sitestats.MAX_RANKED
    assert len(numbers["countries"]) == sitestats.MAX_RANKED and len(numbers["countries"][0]["country"]) == 64
    fake.answer = httpx.Response(200, json=answer_of(pagesWeek=[], pagesMonth=odd))
    assert sorted(_read(fake)["pages"], key=lambda one: one["path"]) == [
        {"path": "/bool/", "page": "bool/", "week": {"views": 0, "visits": 0}, "month": {"views": 0, "visits": 0}},
        {"path": "/neg/", "page": "neg/", "week": {"views": 0, "visits": 0}, "month": {"views": 0, "visits": 2}},
        {"path": "/text/", "page": "text/", "week": {"views": 0, "visits": 0}, "month": {"views": 0, "visits": 0}},
    ]


# -- what went wrong ---------------------------------------------------------------------------------


def _errors(message: str, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json={"data": None, "errors": [
        {"message": message, "path": ["viewer", "accounts", "0"], "extensions": {"timestamp": "2026-11-21T12:00:00Z"}}]})


@pytest.mark.parametrize("answer,said", [
    (httpx.Response(401, json={"errors": [{"message": "Unauthorized"}]}), sitestats.BAD_TOKEN),
    (httpx.Response(400, json={"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]}),
     sitestats.BAD_TOKEN),
    (_errors("not authorized for that account", 403), sitestats.NO_ACCESS),
    (_errors("not authorized for that account"), sitestats.NO_ACCESS),
    (_errors("does not have access to the path"), sitestats.NO_ACCESS),
    (httpx.Response(403, text="Forbidden"), sitestats.NO_ACCESS),
    (httpx.Response(200, json={"data": {"viewer": {"accounts": []}}, "errors": None}), sitestats.NO_ACCOUNT),
    (_errors("rate limiter budget depleted, try again after 5 minutes", 429), sitestats.RATE_LIMITED),
    (_errors("rate limiter budget depleted, try again after 5 minutes"), sitestats.RATE_LIMITED),
    (httpx.Response(429, text=""), sitestats.RATE_LIMITED),
    (_errors("too many queries in progress, please try again later", 503), sitestats.BUSY),
    (httpx.Response(503, text="unavailable"), sitestats.BUSY),
    (_errors("cannot request data older than 2678400s", 400), sitestats.TOO_FAR),
    (_errors("query time range is too large", 400), sitestats.TOO_FAR),
    (_errors('unknown field "siteTag"', 400), sitestats.CHANGED),
    (_errors("error parsing args: wrong type", 400), sitestats.CHANGED),
    (httpx.Response(500, text="boom"), "Cloudflare is having trouble (HTTP 500): try again in a moment."),
    (_errors("something <b>new</b>"), "Cloudflare would not read the numbers: something new."),
    (httpx.Response(418, text=""), "Cloudflare answered HTTP 418 when asked for the numbers."),
    (httpx.Response(200, text="<html>not json</html>"), sitestats.UNREADABLE),
    (httpx.Response(200, json={"data": None, "errors": None}), sitestats.UNREADABLE),
    (httpx.Response(301, headers={"location": "https://evil.example.org/graphql"}), sitestats.MOVED),
    (httpx.Response(200, content=b"x" * (sitestats.MAX_ANSWER + 10)), sitestats.TOO_LARGE),
])
def test_what_went_wrong_is_said_in_one_sentence(fake, answer, said):
    fake.answer = answer
    with pytest.raises(sitestats.StatsError) as caught:
        _read(fake)
    assert str(caught.value) == said
    assert TOKEN not in str(caught.value)
    # one request, never a second to an address an answer named
    assert [request.url.host for request in fake.requests] == ["api.cloudflare.com"]


@pytest.mark.parametrize("failure,said", [
    (httpx.ConnectTimeout, sitestats.TIMED_OUT),
    (httpx.ReadTimeout, sitestats.TIMED_OUT),
    (httpx.ConnectError, sitestats.OFFLINE),
    (httpx.RemoteProtocolError, "Cloudflare could not be reached."),
])
def test_an_unreachable_cloudflare_is_said(fake, failure, said):
    def broken(request: httpx.Request) -> httpx.Response:
        raise failure("down", request=request)

    fake.answer = broken
    with pytest.raises(sitestats.StatsError, match=re.escape(said)):
        _read(fake)


# -- the routes --------------------------------------------------------------------------------------


def test_read_the_numbers_asks_cloudflare_once_with_the_saved_ids_and_the_site_folder(client, fake):
    _set_up(client)
    answer = client.post("/api/publishing/cloudflare/numbers")
    assert answer.status_code == 200, answer.text
    numbers = answer.json()
    assert numbers["ok"] is True and numbers["address"] == "https://octo.github.io/articles/"
    assert [one["page"] for one in numbers["pages"]] == ["bab/", "guide/", "", None]
    assert [one["host"] for one in numbers["referrers"]] == ["", "news.ycombinator.com"]
    assert len(fake.requests) == 1
    assert json.loads(fake.requests[0].content)["variables"] == {"account": ACCOUNT, "site": TAG}
    # a site on its own domain is read from its root
    config.update_settings(lambda settings: settings.update(github_site="https://news.example.org/"))
    numbers = client.post("/api/publishing/cloudflare/numbers").json()
    assert numbers["address"] == "https://news.example.org/"
    assert [one["page"] for one in numbers["pages"]][:1] == ["articles/bab/"]


def test_read_the_numbers_before_github_is_set_reads_paths_from_the_root(client, fake):
    _set_up(client, github=False)
    numbers = client.post("/api/publishing/cloudflare/numbers").json()
    assert numbers["address"] == ""
    assert numbers["pages"][0]["page"] == "articles/bab/"
    # with no host known, the site's own referrer stays listed
    assert "octo.github.io" in [one["host"] for one in numbers["referrers"]]


def test_reading_before_the_setup_is_said_and_asks_nothing(client, fake):
    assert client.post("/api/publishing/cloudflare/numbers").json()["detail"] == sitestats.NOT_SET
    client.put("/api/settings/prefs", json={"site_stats_account": ACCOUNT, "site_stats_tag": TAG})
    refused = client.post("/api/publishing/cloudflare/numbers")
    assert refused.status_code == 409 and refused.json()["detail"] == sitestats.NOT_SET
    assert fake.requests == []


def test_what_cloudflare_refused_comes_back_as_a_502_in_its_sentence(client, fake):
    _set_up(client)
    fake.answer = httpx.Response(401, json={"errors": [{"message": "Unauthorized"}]})
    refused = client.post("/api/publishing/cloudflare/numbers")
    assert refused.status_code == 502 and refused.json()["detail"] == sitestats.BAD_TOKEN
    assert TOKEN not in refused.text


# -- the site tag, found from the site token --------------------------------------------------------------

NUMBERS = "/api/publishing/cloudflare/numbers"
EMPTY = answer_of(pagesWeek=[], pagesMonth=[], totalWeek=[], totalMonth=[], referrers=[], countries=[])


def test_the_site_tag_is_found_from_the_site_token_page_by_page_and_remembered(client, fake):
    fake.sites = [[site("0" * 32, "other-site-token-1")], [site("1" * 32, "other-site-token-2"), site(TAG, SITE_TOKEN)]]
    _set_up(client, by_hand=False)
    answer = client.post(NUMBERS).json()
    assert (answer["ok"], answer["tag"], answer["tag_found"]) == (True, TAG, True)
    assert fake.asked() == ["list 1", "list 2", "graphql"]
    listed = fake.requests[0]
    assert (listed.method, listed.url.host, listed.url.path) == (
        "GET", "api.cloudflare.com", f"/client/v4/accounts/{ACCOUNT}/rum/site_info/list")
    assert listed.headers["authorization"] == f"Bearer {TOKEN}" and TOKEN not in str(listed.url)
    assert json.loads(fake.requests[2].content)["variables"] == {"account": ACCOUNT, "site": TAG}
    settings = config.load_settings()
    assert (settings["site_stats_tag"], settings["site_stats_tag_from"]) == (TAG, SITE_TOKEN)
    shown = client.get("/api/settings").json()
    assert (shown["site_stats_tag"], shown["site_stats_tag_found"]) == (TAG, True)
    # the next press asks no list
    fake.requests.clear()
    assert client.post(NUMBERS).json()["tag"] == TAG
    assert fake.asked() == ["graphql"]


def test_another_site_token_finds_its_own_tag(client, fake):
    _set_up(client, by_hand=False)
    client.post(NUMBERS)
    other = "abcdabcdabcdabcdabcdabcdabcdabcd"
    fake.sites = [[site("2" * 32, other)]]
    client.put("/api/settings/prefs", json={"site_stats_token": other})
    fake.requests.clear()
    assert client.post(NUMBERS).json()["tag"] == "2" * 32
    assert fake.asked() == ["list 1", "graphql"]
    assert config.load_settings()["site_stats_tag_from"] == other


def test_a_found_tag_counting_nothing_is_looked_up_again_once(client, fake):
    _set_up(client, by_hand=False)
    client.post(NUMBERS)
    # the site was made again in Cloudflare: same site token, a new tag; the old one counts nothing
    fake.sites = [[site("3" * 32, SITE_TOKEN)]]
    fake.answer = lambda request: httpx.Response(
        200, json=answer_of() if json.loads(request.content)["variables"]["site"] == "3" * 32 else EMPTY)
    fake.requests.clear()
    answer = client.post(NUMBERS).json()
    assert fake.asked() == ["graphql", "list 1", "graphql"]
    assert answer["tag"] == "3" * 32 and answer["pages"]
    assert config.load_settings()["site_stats_tag"] == "3" * 32
    # nothing again under the same tag: the empty numbers stand, with no third query
    fake.answer = httpx.Response(200, json=EMPTY)
    fake.requests.clear()
    answer = client.post(NUMBERS).json()
    assert fake.asked() == ["graphql", "list 1"]
    assert answer["ok"] is True and answer["pages"] == []
    # nor does a list that cannot be read take the numbers away
    fake.list_answer = httpx.Response(403, json={"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]})
    fake.requests.clear()
    assert client.post(NUMBERS).json()["ok"] is True


@pytest.mark.parametrize("sites,refusal,said", [
    ([[site("0" * 32, "other-site-token-1")]], None, sitestats.NO_SITE),
    ([[]], None, sitestats.NO_SITE),
    (None, httpx.Response(403, json={"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]}),
     sitestats.NEEDS_SETTINGS),
])
def test_a_tag_that_cannot_be_found_asks_for_it_by_hand_and_reads_nothing(client, fake, sites, refusal, said):
    if sites is not None:
        fake.sites = sites
    fake.list_answer = refusal
    _set_up(client, by_hand=False)
    answer = client.post(NUMBERS)
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"ok": False, "needs": "tag", "detail": said}
    assert "graphql" not in fake.asked()
    assert config.load_settings()["site_stats_tag"] == ""


def test_a_tag_typed_by_hand_wins_and_is_never_looked_up(client, fake):
    _set_up(client, by_hand=False)
    client.post(NUMBERS)
    hand = "4" * 32
    client.put("/api/settings/prefs", json={"site_stats_tag": hand})
    assert config.load_settings()["site_stats_tag_from"] == ""
    assert client.get("/api/settings").json()["site_stats_tag_found"] is False
    # even counting nothing, a hand tag is never second-guessed
    fake.answer = httpx.Response(200, json=EMPTY)
    fake.requests.clear()
    answer = client.post(NUMBERS).json()
    assert (answer["tag"], answer["tag_found"]) == (hand, False)
    assert fake.asked() == ["graphql"]
    # emptied, the next press finds it from the site token again
    client.put("/api/settings/prefs", json={"site_stats_tag": ""})
    fake.requests.clear()
    assert client.post(NUMBERS).json()["tag"] == TAG
    assert fake.asked() == ["list 1", "graphql"]


def test_reading_with_neither_a_site_token_nor_a_tag_is_said_and_asks_nothing(client, fake):
    client.put("/api/settings/prefs", json={"site_stats": "cloudflare", "site_stats_account": ACCOUNT})
    client.put("/api/publishing/cloudflare", json={"token": TOKEN})
    refused = client.post(NUMBERS)
    assert refused.status_code == 409 and refused.json()["detail"] == sitestats.NOT_SET
    assert fake.requests == []


def test_the_list_is_read_within_bounds_and_says_what_went_wrong(fake):
    fake.sites = [[site(f"{index:032x}", f"other-site-token-{index}")] for index in range(sitestats.MAX_SITE_PAGES + 5)]
    with sitestats.client() as http:
        with pytest.raises(sitestats.StatsError) as caught:
            sitestats.find_site_tag(http, TOKEN, ACCOUNT, SITE_TOKEN)
        assert (str(caught.value), caught.value.needs) == (sitestats.NO_SITE, "tag")
        assert len(fake.requests) == sitestats.MAX_SITE_PAGES
        for refusal, said in (
            (httpx.Response(401, json={"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]}),
             sitestats.BAD_TOKEN),
            (httpx.Response(400, json={"success": False, "errors": [{"code": 1000, "message": "Invalid API Token"}]}),
             sitestats.BAD_TOKEN),
            (httpx.Response(429, text=""), sitestats.RATE_LIMITED),
            (httpx.Response(500, text=""), "Cloudflare is having trouble (HTTP 500): try again in a moment."),
            (httpx.Response(400, json={"success": False, "errors": [{"code": 7003, "message": "Could not route"}]}),
             "Cloudflare would not list the account's sites: Could not route."),
            (httpx.Response(200, json={"success": True, "result": "sites"}), sitestats.UNREADABLE),
            (httpx.Response(200, json={"success": True, "result": [site("not a tag", SITE_TOKEN)]}), sitestats.UNREADABLE),
            (httpx.Response(302, headers={"location": "https://evil.example.org/"}), sitestats.MOVED),
        ):
            fake.list_answer = refusal
            with pytest.raises(sitestats.StatsError) as caught:
                sitestats.find_site_tag(http, TOKEN, ACCOUNT, SITE_TOKEN)
            assert (str(caught.value), caught.value.needs) == (said, ""), refusal
    assert {request.url.host for request in fake.requests} == {"api.cloudflare.com"}


def test_the_api_token_is_kept_apart_owner_only_and_never_sent_back(client, fake, caplog):
    caplog.set_level(logging.DEBUG)
    assert client.get("/api/publishing").json()["cloudflare"] == {"token": {"set": False, "hint": ""}}
    _set_up(client)
    client.post("/api/publishing/cloudflare/numbers")
    assert client.get("/api/publishing").json()["cloudflare"] == {"token": {"set": True, "hint": f"…{TOKEN[-4:]}"}}
    for path in ("/api/publishing", "/api/settings", "/api/settings/export"):
        assert TOKEN not in client.get(path).text, path
    assert TOKEN not in caplog.text
    kept = publishsecrets.path()
    assert json.loads(kept.read_text())["cloudflare"]["token"] == TOKEN
    assert TOKEN not in config.settings_path().read_text()
    if sys.platform != "win32":
        assert stat.S_IMODE(kept.stat().st_mode) == 0o600
    # kept beside the GitHub token, neither touching the other
    assert publishsecrets.read("github") == ""
    # an empty token keeps the one kept; Forget takes the token only, the ids being no secret
    assert client.put("/api/publishing/cloudflare", json={"token": ""}).json()["token"]["set"] is True
    assert client.delete("/api/publishing/cloudflare").json() == {"token": {"set": False, "hint": ""}}
    assert publishsecrets.read("cloudflare") == ""
    settings = client.get("/api/settings").json()
    assert (settings["site_stats_account"], settings["site_stats_tag"]) == (ACCOUNT, TAG)


@pytest.mark.parametrize("token", ["short", "has space " + "x" * 30, "quote\"" + "x" * 30, "x" * 300])
def test_a_token_that_reads_as_none_is_refused_before_it_is_kept(client, token):
    refused = client.put("/api/publishing/cloudflare", json={"token": token})
    assert refused.status_code == 422
    assert publishsecrets.read("cloudflare") == ""


def test_the_ids_are_checked_where_they_are_typed(client):
    for bad in ({"site_stats_account": "not an id"}, {"site_stats_tag": "0123"}, {"site_stats_tag": "g" * 32}):
        assert client.put("/api/settings/prefs", json=bad).status_code == 422, bad
    ok = client.put("/api/settings/prefs", json={"site_stats_account": f" {ACCOUNT.upper()} ", "site_stats_tag": ""}).json()
    assert (ok["site_stats_account"], ok["site_stats_tag"]) == (ACCOUNT, "")


def test_the_backup_carries_the_ids_and_never_the_api_token(client, fake):
    _set_up(client, by_hand=False)
    client.post(NUMBERS)
    blob = client.get("/api/settings/export").json()
    assert (blob["settings"]["site_stats_account"], blob["settings"]["site_stats_tag"],
            blob["settings"]["site_stats_tag_from"]) == (ACCOUNT, TAG, SITE_TOKEN)
    assert TOKEN not in json.dumps(blob)
    client.put("/api/settings/prefs", json={"site_stats_account": "", "site_stats_tag": ""})
    client.delete("/api/publishing/cloudflare")
    assert client.post("/api/settings/import", json=blob).status_code == 200
    settings = client.get("/api/settings").json()
    assert (settings["site_stats_account"], settings["site_stats_tag"], settings["site_stats_tag_found"]) == (ACCOUNT, TAG, True)
    assert client.get("/api/publishing").json()["cloudflare"]["token"]["set"] is False
    # an id that does not read as one is none, not a refused backup
    res = client.post("/api/settings/import", json={"settings": {"site_stats_account": "nope", "site_stats_tag": "X" * 32,
                                                                 "site_stats_tag_from": "not a token!"}})
    assert res.status_code == 200, res.text
    stored = config.load_settings()
    assert (stored["site_stats_account"], stored["site_stats_tag"], stored["site_stats_tag_from"]) == ("", "", "")


# -- nothing reaches the network but the press -----------------------------------------------------------


def test_no_network_at_startup_on_a_read_or_a_save(monkeypatch, tmp_path):
    """Settings, the publishing state and saving or forgetting the token stay on this machine: Read the
    numbers is the one press that asks Cloudflare."""
    reached: list[str] = []

    def nowhere(self: Any, request: httpx.Request) -> httpx.Response:
        reached.append(str(request.url))
        raise httpx.ConnectError("no network in this test", request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", nowhere)
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    from fastapi.testclient import TestClient

    from azimut.server import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        _set_up(client)
        for path in ("/api/settings", "/api/publishing", "/api/settings/export"):
            assert client.get(path).status_code == 200, path
        client.put("/api/settings/prefs", json={"site_stats_tag": ""})
        client.delete("/api/publishing/cloudflare")
        assert reached == []
        # the press does reach out, and only to Cloudflare's API: the list of sites first while the tag
        # is to be found, then the query once one is typed by hand
        _set_up(client, by_hand=False)
        assert client.post(NUMBERS).status_code == 502
        _set_up(client)
        assert client.post(NUMBERS).status_code == 502
    assert reached == [f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/rum/site_info/list?page=1",
                       "https://api.cloudflare.com/client/v4/graphql"]


def test_the_engine_reaches_api_cloudflare_com_and_nothing_else():
    source = open(sitestats.__file__, encoding="utf-8").read()
    hosts = set(re.findall(r"https://([a-z0-9.-]+)", source))
    assert hosts <= {"api.cloudflare.com"}, hosts
