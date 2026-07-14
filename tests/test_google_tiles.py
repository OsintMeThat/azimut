"""Google Map Tiles session adapter: mint, cache, refresh, viewport copyright.

All HTTP is mocked — no real network, no real key ever touches these tests.
"""

import pytest

from azimut.engine import google_tiles


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def clean_session_cache():
    google_tiles._sessions.clear()
    yield
    google_tiles._sessions.clear()


def test_session_token_minted_once_and_cached():
    calls = []

    def post(url, **kwargs):
        calls.append(kwargs)
        return FakeResponse({"session": "tok-1", "expiry": "9999999999"})

    assert google_tiles.session_token("KEY", post=post) == "tok-1"
    assert google_tiles.session_token("KEY", post=post) == "tok-1"
    assert len(calls) == 1  # second call served from cache
    assert calls[0]["params"] == {"key": "KEY"}
    assert calls[0]["json"]["mapType"] == "satellite"


def test_session_token_refreshed_on_expiry():
    tokens = iter(["tok-1", "tok-2"])
    minted = []

    def post(url, **kwargs):
        token = next(tokens)
        minted.append(token)
        return FakeResponse({"session": token, "expiry": "1000"})

    now = [500.0]
    clock = lambda: now[0]  # noqa: E731
    assert google_tiles.session_token("KEY", post=post, now=clock) == "tok-1"
    now[0] = 2000.0  # past expiry — must re-mint
    assert google_tiles.session_token("KEY", post=post, now=clock) == "tok-2"
    assert minted == ["tok-1", "tok-2"]


def test_session_token_refreshed_within_slack_window():
    def post(url, **kwargs):
        return FakeResponse({"session": "tok", "expiry": "1000"})

    google_tiles.session_token("KEY", post=post, now=lambda: 0.0)
    # 30s before expiry (inside the 60s slack): treated as stale
    def post2(url, **kwargs):
        return FakeResponse({"session": "tok-fresh", "expiry": "99999"})

    assert google_tiles.session_token("KEY", post=post2, now=lambda: 970.0) == "tok-fresh"


def test_invalidate_forces_a_fresh_mint():
    tokens = iter(["tok-1", "tok-2"])

    def post(url, **kwargs):
        return FakeResponse({"session": next(tokens), "expiry": "9999999999"})

    assert google_tiles.session_token("KEY", post=post) == "tok-1"
    google_tiles.invalidate("KEY")
    assert google_tiles.session_token("KEY", post=post) == "tok-2"


def test_sessions_cached_per_key():
    def post(url, **kwargs):
        key = kwargs["params"]["key"]
        return FakeResponse({"session": f"tok-{key}", "expiry": "9999999999"})

    assert google_tiles.session_token("A", post=post) == "tok-A"
    assert google_tiles.session_token("B", post=post) == "tok-B"


def test_missing_session_in_response_raises():
    def post(url, **kwargs):
        return FakeResponse({"expiry": "9999999999"})

    with pytest.raises(google_tiles.GoogleSessionError):
        google_tiles.session_token("KEY", post=post)


def test_key_from_url():
    url = "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}&key=AIza.test"
    assert google_tiles.key_from_url(url) == "AIza.test"
    with pytest.raises(google_tiles.GoogleSessionError):
        google_tiles.key_from_url("https://example.com/{z}/{x}/{y}")


def test_resolve_template_substitutes_session():
    def post(url, **kwargs):
        return FakeResponse({"session": "tok-xyz", "expiry": "9999999999"})

    template = "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}&key=K1"
    resolved = google_tiles.resolve_template(template, post=post)
    assert "{session}" not in resolved
    assert "session=tok-xyz" in resolved
    assert "key=K1" in resolved
    assert "{z}" in resolved  # still an XYZ template for the tile loop


def test_viewport_copyright_parsed():
    def post(url, **kwargs):
        return FakeResponse({"session": "tok", "expiry": "9999999999"})

    seen = {}

    def get(url, **kwargs):
        seen.update(kwargs["params"])
        return FakeResponse({"copyright": "Map data ©2026 Google, Maxar Technologies"})

    text = google_tiles.viewport_copyright(
        "KEY", 15, 48.9, 48.8, 2.4, 2.2, get=get, post=post
    )
    assert text == "Map data ©2026 Google, Maxar Technologies"
    assert seen["session"] == "tok"
    assert seen["zoom"] == 15
    assert seen["north"] == 48.9


def test_viewport_copyright_never_raises():
    def post(url, **kwargs):
        raise RuntimeError("network down")

    assert google_tiles.viewport_copyright("KEY", 15, 1, 0, 1, 0, post=post) is None
