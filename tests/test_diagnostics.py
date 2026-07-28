"""Report an issue (engine/diagnostics.py, api/settings.py).

Three things are load-bearing and asserted here: the log buffer stays bounded so
a long session can't grow it, the report never carries the home path or the
account name into a public tracker, and building the report touches no network —
the fake ``httpx.get`` explodes if anything reaches for it.
"""

from __future__ import annotations

import logging
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from azimut import __version__
from azimut.engine import diagnostics


@pytest.fixture()
def ring(monkeypatch):
    """A fresh capture buffer, wired the way the server wires it."""
    handler = diagnostics.RingHandler()
    monkeypatch.setattr(diagnostics, "_handler", handler)
    root = logging.getLogger()
    root.addHandler(handler)
    yield handler
    root.removeHandler(handler)


def body_of(url: str) -> str:
    return parse_qs(urlparse(url).query)["body"][0]


# -- the log buffer stays small -------------------------------------------


def test_buffer_keeps_only_the_last_lines(ring):
    log = logging.getLogger("azimut.test")
    for i in range(diagnostics.LOG_LINES + 25):
        log.warning("warning %d", i)

    lines = ring.lines()
    assert len(lines) == diagnostics.LOG_LINES
    assert "warning 54" in lines[-1]
    assert "warning 0" not in "\n".join(lines)


def test_buffer_caps_one_huge_line(ring):
    logging.getLogger("azimut.test").warning("x" * 10_000)

    (line,) = ring.lines()
    assert len(line) <= diagnostics.MAX_LINE_CHARS
    assert line.endswith("…")


def test_buffer_flattens_multiline_records(ring):
    logging.getLogger("azimut.test").warning("first\nsecond")

    (line,) = ring.lines()
    assert "\n" not in line
    assert "first ⏎ second" in line


def test_buffer_ignores_info_and_below(ring):
    log = logging.getLogger("azimut.test")
    log.info("routine")
    log.debug("noise")
    log.error("broken")

    assert [line.split(" ", 3)[-1] for line in ring.lines()] == ["azimut.test: broken"]


def test_install_is_idempotent(monkeypatch):
    monkeypatch.setattr(diagnostics, "_handler", None)
    root = logging.getLogger()
    before = len(root.handlers)
    try:
        first = diagnostics.install()
        assert diagnostics.install() is first
        assert len(root.handlers) == before + 1
    finally:
        root.removeHandler(diagnostics._handler)


# -- nothing personal reaches a public tracker ----------------------------


def test_scrub_replaces_home_and_account_name(monkeypatch, tmp_path):
    monkeypatch.setattr(diagnostics.Path, "home", staticmethod(lambda: tmp_path / "gwen"))
    monkeypatch.setattr(diagnostics, "_account_name", lambda: "gwen")

    scrubbed = diagnostics.scrub(f"failed to open {tmp_path}/gwen/Azimut/cases/kyiv — gwen")
    assert "gwen" not in scrubbed
    assert "~/Azimut/cases/kyiv" in scrubbed
    assert "<user>" in scrubbed


def test_scrub_keeps_a_very_short_account_name(monkeypatch):
    """A one- or two-letter name would match ordinary words all over the report."""
    monkeypatch.setattr(diagnostics, "_account_name", lambda: "an")

    assert diagnostics.scrub("an unexpected answer") == "an unexpected answer"


def test_scrub_survives_a_homeless_environment(monkeypatch):
    monkeypatch.setattr(
        diagnostics.Path, "home", staticmethod(lambda: (_ for _ in ()).throw(RuntimeError))
    )
    monkeypatch.setattr(diagnostics.getpass, "getuser", lambda: (_ for _ in ()).throw(KeyError))

    assert diagnostics.scrub("plain text") == "plain text"


def test_report_scrubs_the_captured_log(ring, monkeypatch, tmp_path):
    monkeypatch.setattr(diagnostics.Path, "home", staticmethod(lambda: tmp_path / "gwen"))
    monkeypatch.setattr(diagnostics, "_account_name", lambda: "gwen")
    logging.getLogger("azimut.test").warning("cannot read %s/gwen/Azimut/settings.json", tmp_path)

    text = diagnostics.report()
    assert "gwen" not in text
    assert "~/Azimut/settings.json" in text


def test_report_scrubs_what_the_user_typed(monkeypatch, tmp_path):
    monkeypatch.setattr(diagnostics.Path, "home", staticmethod(lambda: tmp_path / "gwen"))
    monkeypatch.setattr(diagnostics, "_account_name", lambda: "gwen")

    text = diagnostics.report(f"crashed on {tmp_path}/gwen/photo.jpg")
    assert "gwen" not in text
    assert "~/photo.jpg" in text


def test_report_never_carries_the_workspace_path(client):
    """About shows the workspace locally; a public issue has no use for it."""
    from azimut import config

    body = client.get("/api/settings/diagnostics").json()
    assert str(config.workspace_root()) not in body["report"]


# -- the report reads as a report -----------------------------------------


def test_report_leads_with_what_the_user_wrote():
    text = diagnostics.report("the map goes blank at zoom 19")
    assert text.index("the map goes blank at zoom 19") < text.index("### Environment")
    assert "### What happened" in text
    assert __version__ in text


def test_report_prompts_when_nothing_was_typed():
    assert "<!-- Describe it here. -->" in diagnostics.report("")


def test_report_says_so_when_no_warning_was_recorded(monkeypatch):
    monkeypatch.setattr(diagnostics, "_handler", None)
    assert "_None recorded this run._" in diagnostics.report()


def test_an_idea_is_not_a_bug():
    text = diagnostics.report("a KML export", kind="idea")
    assert "### What you'd like" in text
    assert diagnostics.title("a KML export", kind="idea") == "Idea: a KML export"


def test_each_kind_carries_a_label_the_repo_actually_has():
    """GitHub refuses the whole pre-filled form when a label doesn't exist, so
    these two stay GitHub's own defaults (`bug`, `enhancement`)."""
    assert {kind[2] for kind in diagnostics.KINDS.values()} == {"bug", "enhancement"}
    assert parse_qs(urlparse(diagnostics.payload("x")["url"]).query)["labels"] == ["bug"]
    assert parse_qs(urlparse(diagnostics.payload("x", kind="idea")["url"]).query)["labels"] == [
        "enhancement"
    ]


def test_issue_url_omits_the_label_when_there_is_none():
    assert "labels=" not in diagnostics.issue_url("body", subject="Bug: x")


def test_title_is_the_first_line_of_the_summary():
    assert diagnostics.title("blank map\nat zoom 19 only") == "Bug: blank map"
    assert diagnostics.title("") == "Bug: "


def test_summary_is_bounded():
    text = diagnostics.report("z" * 5000)
    assert "z" * diagnostics.MAX_SUMMARY_CHARS in text
    assert "z" * (diagnostics.MAX_SUMMARY_CHARS + 1) not in text


def test_install_kind_names_the_frozen_build(monkeypatch):
    monkeypatch.setattr(diagnostics.sys, "frozen", True, raising=False)
    assert diagnostics.install_kind() == "standalone binary"


def test_environment_reports_a_missing_ffmpeg(monkeypatch):
    monkeypatch.setattr(diagnostics.ffmpeg, "ffmpeg_path", lambda: None)
    assert diagnostics.environment()["ffmpeg"] == "not found"


# -- the link ---------------------------------------------------------------


def test_issue_url_carries_the_title_and_body():
    url = diagnostics.issue_url("### What happened\n\nblank map\n", subject="Bug: blank map")
    assert url.startswith(diagnostics.ISSUE_NEW_URL + "?")
    query = parse_qs(urlparse(url).query)
    assert query["title"] == ["Bug: blank map"]
    assert "blank map" in query["body"][0]


def test_issue_url_sheds_log_lines_to_fit_and_keeps_the_summary(ring):
    log = logging.getLogger("azimut.test")
    for i in range(diagnostics.LOG_LINES):
        log.warning("a tile request failed for a long-winded reason %d %s", i, "y" * 300)

    payload = diagnostics.payload("the map goes blank at zoom 19")
    assert len(payload["url"]) <= diagnostics.URL_LIMIT
    assert "the map goes blank at zoom 19" in body_of(payload["url"])
    assert diagnostics.TRIM_MARKER in body_of(payload["url"])
    # Copy still hands over everything the link had to drop.
    assert len(payload["report"]) > len(body_of(payload["url"]))


def test_issue_url_fits_even_an_oversized_summary_alone():
    url = diagnostics.issue_url("q" * 20_000, subject="Bug: x")
    assert len(url) > 0  # terminates rather than looping on an unshrinkable body


# -- the route --------------------------------------------------------------


def test_diagnostics_route_returns_report_and_link(client):
    body = client.get("/api/settings/diagnostics?summary=blank+map&kind=bug").json()
    assert body["kind"] == "bug"
    assert body["title"] == "Bug: blank map"
    assert "blank map" in body["report"]
    assert body["url"].startswith(diagnostics.ISSUE_NEW_URL)


def test_diagnostics_route_touches_no_network(client, monkeypatch):
    def explode(*args, **kwargs):
        raise AssertionError("a report must be built from local facts only")

    monkeypatch.setattr(httpx, "get", explode)
    monkeypatch.setattr(httpx, "post", explode)

    assert client.get("/api/settings/diagnostics").status_code == 200


def test_diagnostics_route_falls_back_on_an_unknown_kind(client):
    body = client.get("/api/settings/diagnostics?kind=rant").json()
    assert body["kind"] == diagnostics.DEFAULT_KIND


def test_diagnostics_route_shortens_rather_than_refusing_a_long_summary(client):
    body = client.get("/api/settings/diagnostics", params={"summary": "w" * 9000}).json()
    assert body["kind"] == diagnostics.DEFAULT_KIND
    assert "w" * diagnostics.MAX_SUMMARY_CHARS in body["report"]
