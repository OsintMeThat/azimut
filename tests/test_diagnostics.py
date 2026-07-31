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


@pytest.fixture(autouse=True)
def fresh_environment(monkeypatch):
    """The environment block is built once per process. Tests that change what the
    machine reports need that cache cleared, the same way `ring` gives each test a
    fresh log buffer."""
    monkeypatch.setattr(diagnostics, "_environment", None)


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
    monkeypatch.setattr(
        diagnostics.config,
        "workspace_root",
        lambda: tmp_path / "gwen" / "Azimut",
    )

    scrubbed = diagnostics.scrub(f"failed to open {tmp_path}/gwen/Azimut/kyiv — gwen")
    assert "gwen" not in scrubbed
    # the path stays useful, but the case segment is a name the analyst chose and
    # this text is on its way to a public tracker
    assert "<workspace>/<case>" in scrubbed
    assert "kyiv" not in scrubbed
    assert "<user>" in scrubbed


def test_scrub_collapses_a_home_path_spelled_with_either_separator(monkeypatch, tmp_path):
    """A Windows log line carries both separators at once, and the home prefix is
    what holds the account name.

    The app names a file by a relative path that always uses `/`
    (`media/photo.jpg`) and joins it to a root that on Windows uses `\\`, so the
    boundary between them flips. Matching only the native spelling let the real
    account name through into a public issue.
    """
    monkeypatch.setattr(diagnostics.Path, "home", staticmethod(lambda: tmp_path / "gwen"))
    monkeypatch.setattr(diagnostics, "_account_name", lambda: "gwen")
    native = str(tmp_path / "gwen")

    for spelling in (native, native.replace("\\", "/"), native.replace("/", "\\")):
        scrubbed = diagnostics.scrub(f"failed to open {spelling}/media/photo.jpg")
        assert "gwen" not in scrubbed
        assert scrubbed.endswith("photo.jpg")


def test_scrub_keeps_a_very_short_account_name(monkeypatch):
    """A one- or two-letter name would match ordinary words all over the report."""
    monkeypatch.setattr(diagnostics, "_account_name", lambda: "an")

    assert diagnostics.scrub("an unexpected answer") == "an unexpected answer"


def test_scrub_replaces_this_machines_name(monkeypatch):
    """The workspace lock names the host holding a folder, and that warning goes
    into the log tail a bug report publishes. On a work laptop it is an asset tag
    and an internal domain."""
    monkeypatch.setattr(diagnostics.socket, "gethostname", lambda: "lt-4471.corp.example")

    scrubbed = diagnostics.scrub(
        "another Azimut has this workspace open on lt-4471.corp.example:8477"
    )

    assert scrubbed == "another Azimut has this workspace open on <machine>:8477"


def test_scrub_replaces_the_short_form_of_the_machine_name_too(monkeypatch):
    """The lock records `gethostname()`, but a log line elsewhere may carry only
    the leading label — replacing the long form first must not leave it behind."""
    monkeypatch.setattr(diagnostics.socket, "gethostname", lambda: "lt-4471.corp.example")

    assert diagnostics.scrub("connecting to lt-4471") == "connecting to <machine>"
    assert "corp.example" not in diagnostics.scrub("host lt-4471.corp.example")


def test_scrub_keeps_a_very_short_machine_name(monkeypatch):
    monkeypatch.setattr(diagnostics.socket, "gethostname", lambda: "pc")

    assert diagnostics.scrub("a pc somewhere") == "a pc somewhere"


def test_scrub_survives_a_nameless_machine(monkeypatch):
    monkeypatch.setattr(
        diagnostics.socket, "gethostname", lambda: (_ for _ in ()).throw(OSError)
    )

    assert diagnostics.scrub("plain text") == "plain text"


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


# -- the link fits without eating the report ------------------------------


@pytest.mark.parametrize(
    "label, summary",
    [
        ("latin", "a" * diagnostics.MAX_SUMMARY_CHARS),
        ("accented latin", "é" * diagnostics.MAX_SUMMARY_CHARS),
        ("cyrillic", "ж" * 600),
        ("japanese", "事" * 400),
        ("emoji", "🛰" * 200),
    ],
)
def test_the_link_keeps_what_the_user_wrote(ring, label, summary, tmp_workspace):
    """The summary is capped in characters, but the link is measured in encoded
    characters — nine of them per letter in some scripts. A summary well inside the
    cap can therefore be several times the link's whole budget, and shedding
    blindly from the end would deliver a heading, a marker blaming the log, and
    none of the report."""
    built = diagnostics.payload(summary)
    body = body_of(built["url"])

    assert len(built["url"]) <= diagnostics.URL_LIMIT
    assert summary[0] in body, f"{label}: the user's own words were dropped"
    # and Copy always carries the whole thing, whatever the link had to drop
    assert summary in built["report"]


def test_context_is_shed_before_content(ring, tmp_workspace):
    """A summary that fits leaves room for some context; one that does not takes
    the whole budget. Either way the order is the same: log first, environment
    next, the user's words last and only if nothing else is left."""
    log = logging.getLogger("azimut.test")
    for n in range(diagnostics.LOG_LINES):
        log.warning("a warning long enough to matter, number %s, %s", n, "x" * 300)

    modest = body_of(diagnostics.payload("It crashed on export.")["url"])
    assert "It crashed on export." in modest
    assert "### Environment" in modest
    assert diagnostics.TRIM_MARKER in modest  # the log tail is what went

    huge = body_of(diagnostics.payload("é" * diagnostics.MAX_SUMMARY_CHARS)["url"])
    assert "### Recent warnings" not in huge
    assert "### Environment" not in huge
    # the marker names the right casualty rather than blaming the log
    assert diagnostics.SUMMARY_TRIM_MARKER in huge
    assert diagnostics.TRIM_MARKER not in huge


def test_a_report_that_fits_is_left_whole(ring, tmp_workspace):
    body = body_of(diagnostics.payload("Short and to the point.")["url"])

    assert diagnostics.TRIM_MARKER not in body
    assert diagnostics.SUMMARY_TRIM_MARKER not in body
    assert "### Recent warnings" in body


# -- the scrub covers what this app's logs actually carry ------------------


def test_a_case_name_never_reaches_the_tracker(ring, tmp_workspace):
    """A case directory is a slug of the name the analyst typed, and in this tool
    that name is routinely a subject's. The path around it is useful; the segment
    is not ours to publish."""
    from azimut import config

    log = logging.getLogger("azimut.test")
    log.warning("could not open %s", config.cases_dir() / "operation-blue-heron" / "case.db")
    log.warning("scratch vanished: %s", config.scratch_dir() / "scratch_9f2c" / "media" / "a.jpg")

    captured = "\n".join(diagnostics.log_lines())

    assert "operation-blue-heron" not in captured
    assert "scratch_9f2c" not in captured
    assert "<workspace>/<case>/case.db" in captured.replace("\\", "/")
    assert ".azimut/scratch/<case>/media/a.jpg" in captured.replace("\\", "/")


def test_a_credential_in_a_logged_url_is_redacted(ring, tmp_workspace):
    """A keyed imagery or geocoding provider is reached over HTTP, so a warning
    about one names the URL — key included."""
    log = logging.getLogger("azimut.test")
    log.warning("provider refused: https://api.example.com/v1?key=SECRET-ABC123&z=4")
    log.warning("upload rejected: token=eyJhbGciOiJIUzI1NiJ9.payload.sig")

    captured = "\n".join(diagnostics.log_lines())

    assert "SECRET-ABC123" not in captured
    assert "eyJhbGciOiJIUzI1NiJ9" not in captured
    assert "key=<redacted>&z=4" in captured
    assert "token=<redacted>" in captured


def test_the_scrub_leaves_ordinary_prose_alone(tmp_workspace):
    """A blunt scrub that ate the word "cases" or every "key" would make the log
    tail useless, which is the one thing the report is for."""
    prose = "Two of the open cases and both API keys behave the same way"

    assert diagnostics.scrub(prose) == prose


def test_a_workspace_outside_the_home_directory_is_still_hidden(monkeypatch, tmp_path):
    """A portable install can live anywhere — on a second disk, on a stick — and
    then no amount of home-collapsing hides where it is."""
    from azimut import config

    elsewhere = tmp_path / "volume" / "azimut-portable"
    monkeypatch.setattr(config, "workspace_root", lambda: elsewhere)
    # Home has to be pinned somewhere that is not an ancestor of the stick, or the
    # premise is gone: on Windows the temp directory lives *inside* the user
    # profile, so the real home would collapse the prefix first and there would be
    # nothing left for <workspace> to match.
    monkeypatch.setattr(diagnostics.Path, "home", staticmethod(lambda: tmp_path / "home"))

    scrubbed = diagnostics.scrub(f"failed to read {elsewhere / 'settings.json'}")

    assert str(elsewhere) not in scrubbed
    assert "<workspace>" in scrubbed


# -- the environment block is read once -----------------------------------


def test_the_environment_is_built_once_per_process(monkeypatch, tmp_workspace):
    """Reading the ffmpeg line runs `ffmpeg -version`, and About rebuilds the
    report as the user types. A subprocess per keystroke burst flashes a console
    window on Windows at someone in the middle of writing a bug report."""
    monkeypatch.setattr(diagnostics, "_environment", None)
    calls = []

    def counted() -> dict[str, object]:
        calls.append(1)
        return {"available": True, "path": "/x/ffmpeg", "source": "path", "version": "7.1"}

    monkeypatch.setattr(diagnostics.ffmpeg, "info", counted)

    for _ in range(5):
        diagnostics.payload("still typing…")

    assert len(calls) == 1
    assert diagnostics.environment()["ffmpeg"] == "7.1 (system PATH)"


def test_the_cached_environment_cannot_be_mutated_by_a_caller(monkeypatch, tmp_workspace):
    monkeypatch.setattr(diagnostics, "_environment", None)
    first = diagnostics.environment()
    first["OS"] = "tampered"

    assert diagnostics.environment()["OS"] != "tampered"
