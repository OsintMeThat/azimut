"""An X post's words from X's embed read (`engine/xwords.py`), for the posts gallery-dl
reads without them. Post ids are made up; X is answered behind `httpx.MockTransport`."""

from __future__ import annotations

import httpx
import pytest

from azimut.engine import xwords


@pytest.fixture()
def embed(monkeypatch):
    """X's embed read, answering what `answers` holds and keeping what it was asked."""
    state = {"answers": [], "asked": []}

    def handle(request: httpx.Request) -> httpx.Response:
        state["asked"].append(request)
        answer = state["answers"].pop(0) if state["answers"] else None
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(200, json=answer) if answer else httpx.Response(404, text="<!DOCTYPE html>")

    real = xwords.client
    monkeypatch.setattr(xwords, "client", lambda transport=None: real(httpx.MockTransport(handle)))
    monkeypatch.setattr(xwords, "_said", {})
    return state


# The values X's embed computes in a browser, `((id / 1e15) * Math.PI).toString(36)`
# without its zeros and point.
@pytest.mark.parametrize(("tweet", "said"), [
    ("1990000000000000001", "4tnrp481eua"),
    ("20", "6dq1a2xwd93"),
    ("1000000000000000", "353i5ab8p5f"),
])
def test_the_token_is_the_one_x_s_embed_sends(tweet, said):
    assert xwords.token(tweet) == said


def test_words_open_short_links_drop_the_pictures_and_unescape():
    data = {"text": "Smoke &gt; 2 km at the port: https://t.co/a\n\n(2/4) https://t.co/p",
            "entities": {"urls": [{"url": "https://t.co/a", "expanded_url": "https://example.org/report"}],
                         "media": [{"url": "https://t.co/p"}]}}
    assert xwords.words(data) == "Smoke > 2 km at the port: https://example.org/report\n\n(2/4)"


def test_only_an_x_post_without_words_is_filled():
    kept = {"category": "twitter", "tweet_id": 5, "content": "Already said"}
    other = {"category": "bluesky", "content": ""}
    xwords.fill(kept, other, None, ["not", "a", "post"])  # type: ignore[arg-type]
    assert kept["content"] == "Already said" and other["content"] == ""


def test_a_failed_read_waits_before_x_is_asked_again(embed, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(xwords.time, "monotonic", lambda: clock[0])
    embed["answers"] = [httpx.ConnectError("offline"), {"text": "Back online"}]
    post = {"category": "twitter", "tweet_id": "1990000000000000003", "content": ""}
    xwords.fill(post)
    xwords.fill(post)
    assert post["content"] == "" and len(embed["asked"]) == 1
    clock[0] += xwords.FAILED_FOR + 1
    xwords.fill(post)
    assert post["content"] == "Back online" and len(embed["asked"]) == 2
    xwords.fill({"category": "twitter", "tweet_id": "1990000000000000003", "content": ""})
    assert len(embed["asked"]) == 2, "words said once are kept"


def test_the_words_kept_are_capped(embed, monkeypatch):
    monkeypatch.setattr(xwords, "KEPT", 3)
    embed["answers"] = [{"text": f"Post {n}"} for n in range(5)]
    for n in range(5):
        xwords.fill({"category": "twitter", "tweet_id": str(n + 1), "content": ""})
    assert list(xwords._said) == ["3", "4", "5"]
