"""Whether the addresses in a sheet's column still answer.

A worklist is mostly links: the post a claim rests on, the channel it came from, the
archive copy somebody made. They rot, and a column of four hundred sources says nothing
about which of them are already gone — which is exactly the thing worth knowing before a
finding is published on one.

So this checks them, and it is deliberately **the only part of a sheet that reaches the
network**. It runs on a press, never on a read or a save: the rule the whole app is under
is that nothing leaves the machine unless the analyst's own action needs it to.

Five answers, and the shape of them is the point — a checker that reported a bare
true/false would put "this page is gone" and "this machine is offline" in one bucket:

``ok``
    It answered.
``gone``
    It answered that it is not there (404, 410). The finding.
``refused``
    It answered something else — a 403 behind a login, a 500, a rate limit. Not proof of
    anything about the page, so it is not called dead.
``unreachable``
    Nothing answered. Says as much about the connection as about the address.
``skipped``
    Never tried, because the batch ran out of its time budget. Kept apart from the other
    four: "we did not ask" is not a fact about the page.

Bounded on purpose: a cap on the batch, a short timeout, a budget over the whole sweep,
and one request at a time so a sweep over a hundred sources cannot read as an attack on a
small host.
"""

from __future__ import annotations

import ipaddress
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

from .tiles import USER_AGENT

#: How many addresses one request may carry. The grid chunks a long column into several,
#: which is also what lets it draw progress and be stopped half way.
MAX_LINKS = 25
#: How long one address gets. Short: a sweep of twenty five that each waited thirty
#: seconds is a screen that appears to have hung.
TIMEOUT = 6.0
#: How long the whole batch gets. The per-address timeout alone did not bound the sweep:
#: twenty five addresses each taking a HEAD and then a GET at six seconds is five minutes
#: of one held request and one occupied thread, which is the same hung screen the timeout
#: was chosen to avoid. Past it the rest come back `skipped`, which says they were not
#: asked rather than that they did not answer.
BUDGET = 30.0
#: How many redirects one address may take. Bounded rather than left to httpx so the
#: destination of each hop can be looked at before it is followed.
MAX_HOPS = 5
#: Statuses that mean the page itself is not there. Everything else that answers is
#: reported as it came.
GONE = (404, 410)


def _is_local(host: str | None) -> bool:
    """Whether this host is the machine itself or its own network.

    The addresses come from the sheet, and a sheet arrives by import, by paste or as a
    workbook somebody sent: a column of links from a third party could otherwise make this
    app knock on its own ports and report which of them answered. Checked on the first hop
    and on every redirect, since a remote host may answer with `Location: 127.0.0.1:<port>`
    and the loopback guard in `server.py` asks only that the Host be a loopback name.

    Literal addresses and the loopback names. A hostname that *resolves* to a private
    address is not caught, which is written down in SPEC's security posture: what leaks is
    "this port answered", never a body — `check` reads the status and nothing else.
    """
    name = (host or "").strip().strip("[]").casefold()
    if not name:
        return True
    if name == "localhost" or name.endswith((".localhost", ".local", ".internal")):
        return True
    try:
        address = ipaddress.ip_address(name)
    except ValueError:
        return False
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


class _Refused(Exception):
    """A hop this will not follow, carrying the verdict to answer instead."""

    def __init__(self, verdict: dict[str, Any]) -> None:
        super().__init__(verdict.get("reason", ""))
        self.verdict = verdict


def _now() -> float:
    """The clock the budget is measured on. Its own function so a test can move it without
    patching `time.monotonic` for httpx and everything else running on this thread."""
    return time.monotonic()


def _client() -> httpx.Client:
    """One client for a whole batch. Redirects are followed by hand (`_answered`), which is
    the only way to look at where a hop goes before going there."""
    return httpx.Client(
        timeout=TIMEOUT,
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT},
    )


def _answered(client: httpx.Client, request: httpx.Request) -> httpx.Response:
    """Follow this request's redirects by hand.

    By hand because `follow_redirects=True` never shows where a hop goes, and where it goes
    is the question: see `_is_local`.
    """
    response = client.send(request)
    for _ in range(MAX_HOPS):
        hop = response.next_request
        if hop is None:
            return response
        if _is_local(hop.url.host):
            raise _Refused(
                {
                    "state": "refused",
                    "code": response.status_code,
                    "reason": "redirected to a local address",
                }
            )
        response = client.send(hop)
    raise _Refused(
        {"state": "refused", "code": response.status_code, "reason": "too many redirects"}
    )


def check(url: str, client: httpx.Client | None = None) -> dict[str, Any]:
    """One address, as one verdict. Never raises: a checker that threw would take the
    other twenty four answers of the batch down with it.

    *client* is the batch's own, so a column of forty links to one host reuses one
    connection instead of opening forty.
    """
    split = urlsplit(url)
    if split.scheme not in ("http", "https") or not split.hostname:
        return {"state": "refused", "code": None, "reason": "not an http address"}
    if _is_local(split.hostname):
        return {"state": "refused", "code": None, "reason": "a local address"}
    own = client is None
    client = client or _client()
    try:
        # HEAD first, because the body is not the question and a source can be a
        # forty-megabyte video. Plenty of hosts refuse HEAD, so a refusal that looks
        # like "we do not do that verb" is retried as a GET whose body is never read.
        answer = _answered(client, client.build_request("HEAD", url))
        if answer.status_code in (405, 400, 403, 501):
            answer = _answered(
                client, client.build_request("GET", url, headers={"Range": "bytes=0-0"})
            )
    except _Refused as refusal:
        return refusal.verdict
    except httpx.HTTPError as exc:
        return {"state": "unreachable", "code": None, "reason": type(exc).__name__}
    finally:
        if own:
            client.close()
    code = answer.status_code
    if code in GONE:
        return {"state": "gone", "code": code, "reason": ""}
    if code >= 400:
        return {"state": "refused", "code": code, "reason": ""}
    return {"state": "ok", "code": code, "reason": ""}


def check_all(urls: list[str]) -> dict[str, dict[str, Any]]:
    """A batch, deduplicated, in the order it arrived and capped at `MAX_LINKS`.

    Deduplicated because a column of four hundred rows sourced to one channel holds one
    address four hundred times, and asking that host four hundred times would be the
    rudest possible way to learn one fact.

    Sequential, on one client, under one budget. The order stays as it arrived so the
    addresses that ran out of time are the ones at the end of the column rather than a
    handful scattered through it.
    """
    seen: list[str] = []
    for url in urls:
        text = str(url or "").strip()
        if text and text not in seen:
            seen.append(text)
        if len(seen) >= MAX_LINKS:
            break
    answers: dict[str, dict[str, Any]] = {}
    started = _now()
    with _client() as client:
        for url in seen:
            if _now() - started >= BUDGET:
                answers[url] = {
                    "state": "skipped",
                    "code": None,
                    "reason": "the batch ran out of time",
                }
                continue
            answers[url] = check(url, client)
    return answers
