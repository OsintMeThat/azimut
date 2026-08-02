"""What to tell a bug report — build number, machine, and the last warnings.

A local app has no crash reporter behind it, so the useful facts about a broken
run only exist on the user's own machine. This module collects them into one
short Markdown block and turns it into a pre-filled GitHub issue URL, which the
System shows in full before the user decides to open it. Nothing is sent from
here: the report is text and a link, and the browser does the sending on a
click.

Three rules shape what goes in.

**The user's own words first.** A report is often a request, or a bug that logged
nothing at all, so the summary the analyst types is the body's first section and
the issue title. The environment and the log tail follow it as context; neither
is the point.

**Warnings only, only the last few, and never on disk.** A ring buffer keeps the
tail of the ``WARNING``-and-above log in memory (:class:`RingHandler`, installed
at server start) — bounded lines, each capped in length, so a long-running app
holds a few kilobytes and no log file ever grows in the workspace.

**Nothing personal.** A log line or a path can hold the account name, a case name
or a provider key, and an issue is public, so every string goes through
:func:`scrub`: the home directory and the workspace root collapse to placeholders,
and so do the account name, the case folder and any credential-shaped query
parameter. A case folder is a slug of the name the analyst typed, which in this
tool is routinely a subject's — that one is not a nicety. The workspace path is
also absent from the report outright: About shows it locally, a report does not
need it.
"""

from __future__ import annotations

import getpass
import logging
import os
import platform
import re
import socket
import sys
from collections import deque
from pathlib import Path
from urllib.parse import quote

from .. import __version__, config
from . import ffmpeg

#: Where a report lands. The repo's issue form, filled through query parameters.
ISSUE_NEW_URL = "https://github.com/OsintMeThat/azimut/issues/new"

#: How much log tail the report carries, and from which level up. The buffer is
#: the app's only log store — nothing is written to disk — so these two bounds
#: plus MAX_LINE_CHARS are the whole memory cost: ~12 kB at worst, for the life
#: of the process.
LOG_LINES = 30
LOG_LEVEL = logging.WARNING
#: One line's ceiling. A traceback or an embedded payload would otherwise make a
#: single record dwarf the other twenty-nine.
MAX_LINE_CHARS = 400
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
LOG_DATEFMT = "%Y-%m-%d %H:%M:%S"

#: Long URLs are silently dropped or truncated by servers and browsers well
#: before any hard limit, so the link stays under a conservative ceiling and
#: sheds context to fit. The Copy button always carries the whole report.
URL_LIMIT = 6000
TRIM_MARKER = "_(log trimmed to fit the link; use Copy for the full report)_"
#: Said when the summary itself is what overflowed. Distinct from the marker
#: above because it must not blame the log for a paragraph the user can see was
#: cut — a report that quietly drops what someone typed is worse than a long link.
SUMMARY_TRIM_MARKER = "_(summary trimmed to fit the link; use Copy for the full report)_"

#: What a report is: something broke, or something is missing. The kind picks the
#: title prefix, the heading the summary sits under, and the tracker label.
#: Both labels are GitHub's own defaults, so they exist on the repo — a label the
#: repo doesn't have would make GitHub refuse the whole pre-filled form.
KINDS = {
    "bug": ("Bug", "What happened", "bug"),
    "idea": ("Idea", "What you'd like", "enhancement"),
}
DEFAULT_KIND = "bug"
#: A summary is a few sentences; past that it's a paste, and the link stops fitting.
MAX_SUMMARY_CHARS = 2000

_PLACEHOLDER = "<user>"
_CASE_PLACEHOLDER = "<case>"
_WORKSPACE_PLACEHOLDER = "<workspace>"
_MACHINE_PLACEHOLDER = "<machine>"
_REDACTED = "<redacted>"

#: Query parameters whose value is a credential. A keyed imagery or geocoding
#: provider is reached over HTTP, so a warning about one carries the key in the
#: URL it names — and this text is on its way to a public tracker.
_CREDENTIAL_PARAM = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|key|secret|password|passwd)"
    r"=[^&\s\"'<>]+"
)


# ---- the log tail -------------------------------------------------------------


def _cap(line: str) -> str:
    """One log line, shortened to :data:`MAX_LINE_CHARS` and kept single-line."""
    flat = line.replace("\n", " ⏎ ")
    return flat if len(flat) <= MAX_LINE_CHARS else flat[: MAX_LINE_CHARS - 1] + "…"


class RingHandler(logging.Handler):
    """Keep the last *capacity* formatted records at ``WARNING`` and above."""

    def __init__(self, capacity: int = LOG_LINES) -> None:
        super().__init__(level=LOG_LEVEL)
        self.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=LOG_DATEFMT))
        self._records: deque[str] = deque(maxlen=capacity)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self._records.append(_cap(self.format(record)))
        except Exception:  # a handler that raises would break the logging call
            pass

    def lines(self) -> list[str]:
        return list(self._records)

    def clear(self) -> None:
        self._records.clear()


_handler: RingHandler | None = None


def install() -> RingHandler:
    """Start capturing warnings on the root logger. Safe to call twice.

    On the root logger rather than ``azimut``'s own so uvicorn's errors are
    captured too — those are often the whole story when a request fails.
    """
    global _handler
    if _handler is None:
        _handler = RingHandler()
        logging.getLogger().addHandler(_handler)
    return _handler


def log_lines() -> list[str]:
    """The captured tail, scrubbed. Empty when nothing has warned yet."""
    if _handler is None:
        return []
    return [scrub(line) for line in _handler.lines()]


# ---- scrubbing ----------------------------------------------------------------


def _account_name() -> str:
    """The OS account name, or ``""`` when the environment doesn't say.

    ``getpass.getuser()`` raises rather than returning a default when no
    ``USER``/``LOGNAME`` is set and the uid has no passwd entry — a container,
    typically.
    """
    try:
        return getpass.getuser()
    except Exception:
        return ""


def _path_pattern(path: str) -> re.Pattern[str]:
    """*path* as a pattern matching it however a log line happened to spell it.

    Either separator at every boundary, because one line legitimately carries
    both: this app names a file by a relative path that always uses ``/``
    (``media/photo.jpg``) and joins it to a workspace root that on Windows uses
    ``\\``. Case-insensitive on Windows for the same reason — that filesystem is,
    so two spellings name one directory and matching only one of them is a
    coin toss.

    Not cosmetic. The home prefix is what carries the account name, so a spelling
    this misses is a real name on its way to a public tracker.
    """
    parts = [re.escape(part) for part in re.split(r"[/\\]+", path)]
    flags = re.IGNORECASE if os.name == "nt" else 0
    return re.compile(r"[/\\]+".join(parts), flags)


def scrub(text: str) -> str:
    """Take this machine and this investigation out of a string bound for a public
    issue.

    Each pass exists because the report is published:

    - the workspace root collapses to ``<workspace>``, which catches a portable
      install living outside the home directory entirely
    - the remaining home directory collapses to ``~``
    - the account name becomes ``<user>``
    - this machine's name becomes ``<machine>``. The workspace lock names the
      host holding a folder, which on a corporate laptop is an asset tag and a
      company domain.
    - a case folder becomes ``<case>``. A case directory is a slug of the name the
      analyst gave it (``workspace._slugify``), and in this tool that name is
      routinely a subject's — so the segment goes even though the path around it
      is useful.
    - a credential-shaped query parameter becomes ``<redacted>``

    None of this makes an arbitrary string safe to publish; it removes what this
    app's own log lines are known to carry.
    """
    try:
        root = str(config.workspace_root())
    except Exception:
        root = ""
    if root and root not in ("~", "/"):
        text = _path_pattern(root).sub(_WORKSPACE_PLACEHOLDER, text)
        # Permanent cases now sit directly below the workspace root. The one
        # reserved first segment is `.azimut`; every other directory there is
        # an analyst-named case and must not reach a public issue report.
        workspace = re.escape(_WORKSPACE_PLACEHOLDER)
        text = re.sub(
            rf"({workspace})([/\\])(?!\.azimut(?:[/\\]|$))[^/\\\s\"'<>]+",
            rf"\1\2{_CASE_PLACEHOLDER}",
            text,
        )
    try:
        home = str(Path.home())
    except Exception:  # no home to hide
        home = ""
    if home:
        text = _path_pattern(home).sub("~", text)
    name = _account_name()
    # Two characters or fewer would match far too much ordinary prose.
    if len(name) > 2:
        text = text.replace(name, _PLACEHOLDER)
    text = _hide_machine_name(text)
    for directory in _case_parents():
        segment = re.escape(directory.name)
        text = re.sub(
            rf"(?<![\w-])({segment})([/\\])[^/\\\s\"'<>]+",
            rf"\1\2{_CASE_PLACEHOLDER}",
            text,
        )
    return _CREDENTIAL_PARAM.sub(rf"\1={_REDACTED}", text)


def _hide_machine_name(text: str) -> str:
    """Replace this host's name, and the bare form of it.

    The workspace lock reports which machine holds a folder, so a "close the
    other Azimut" warning carries the hostname into the log tail a bug report
    publishes. On a work laptop that is an asset tag and an internal domain.
    """
    try:
        host = socket.gethostname()
    except Exception:  # pragma: no cover - no name to hide
        return text
    # Longest first, so `laptop.corp.example` never leaves `.corp.example`
    # behind after `laptop` was replaced inside it.
    for candidate in sorted({host, host.split(".", 1)[0]}, key=len, reverse=True):
        if len(candidate) > 2:
            text = text.replace(candidate, _MACHINE_PLACEHOLDER)
    return text


def _case_parents() -> tuple[Path, ...]:
    """The workspace directories a case folder sits in. Read from config rather
    than spelled out, so moving either one keeps the scrub honest."""
    try:
        return (config.scratch_dir(),)
    except Exception:
        return ()


# ---- the report ---------------------------------------------------------------


def install_kind() -> str:
    """How this copy was installed, as far as it can tell about itself."""
    return "standalone binary" if getattr(sys, "frozen", False) else "Python package"


_environment: dict[str, str] | None = None


def environment() -> dict[str, str]:
    """The build and machine facts a maintainer needs to reproduce a bug.

    Built once per process. Not an optimisation for its own sake: reading the
    ffmpeg line runs ``ffmpeg -version``, and ``ffmpeg.info`` says in as many words
    that its caller is a dedicated endpoint rather than a hot poll. This one is
    hot — About rebuilds the report as the user types — and on Windows a
    subprocess per keystroke burst flashes a console window at someone in the
    middle of writing a bug report. None of these facts change within a run.
    """
    global _environment
    if _environment is not None:
        return dict(_environment)
    info = ffmpeg.info()
    if info.get("available"):
        version = str(info.get("version") or "installed")
        source = "bundled" if info.get("source") == "bundled" else "system PATH"
        ffmpeg_line = f"{version} ({source})"
    else:
        ffmpeg_line = "not found"
    _environment = {
        "Azimut": f"{__version__} ({install_kind()})",
        "OS": f"{platform.system()} {platform.release()} ({platform.machine()})",
        "Python": platform.python_version(),
        "ffmpeg": ffmpeg_line,
    }
    return dict(_environment)


def _clean_summary(summary: str) -> str:
    """The typed summary, bounded and scrubbed. May be empty."""
    return scrub(summary.strip()[:MAX_SUMMARY_CHARS]).strip()


def title(summary: str = "", *, kind: str = DEFAULT_KIND) -> str:
    """The issue title: the kind, then the summary's first line as the subject."""
    prefix = KINDS.get(kind, KINDS[DEFAULT_KIND])[0]
    first = _clean_summary(summary).split("\n", 1)[0][:120].rstrip(" .")
    return f"{prefix}: {first}" if first else f"{prefix}: "


def report(summary: str = "", *, kind: str = DEFAULT_KIND) -> str:
    """The issue body: what the user wrote, then the environment and log tail."""
    heading = KINDS.get(kind, KINDS[DEFAULT_KIND])[1]
    written = _clean_summary(summary)
    lines = [f"### {heading}", ""]
    lines.append(written if written else "<!-- Describe it here. -->")
    lines += ["", "### Environment", ""]
    lines += [f"- **{key}**: {value}" for key, value in environment().items()]
    captured = log_lines()
    lines += ["", "### Recent warnings", ""]
    if captured:
        lines += ["```", *captured, "```"]
    else:
        lines.append("_None recorded this run._")
    return "\n".join(lines) + "\n"


def _own_section(lines: list[str]) -> int:
    """How many leading lines are the user's own section: everything before the
    next heading. The floor the link may not shed past."""
    for index, line in enumerate(lines[1:], start=1):
        if line.startswith("### "):
            return index
    return len(lines)


def _fit(text: str, budget: int) -> str:
    """*text*, shortened until its percent-encoded form fits *budget* characters.

    Counted encoded, not in characters, because that is the only measure the link
    cares about: one letter costs one character in ASCII, six in accented Latin and
    nine in an emoji, so a cap in letters says nothing about whether the URL fits.
    """
    if len(quote(text)) <= budget:
        return text
    low, high = 0, len(text)
    while low < high:  # longest prefix whose encoding fits
        middle = (low + high + 1) // 2
        if len(quote(text[:middle])) <= budget:
            low = middle
        else:
            high = middle - 1
    return text[:low].rstrip()


def issue_url(body: str, *, subject: str = "", label: str = "") -> str:
    """A pre-filled issue link that fits, shedding context before content.

    Two things can overflow. The log tail is the usual one, and it sits last in the
    body precisely so this reaches it first. The other is the summary itself: it is
    capped at ``MAX_SUMMARY_CHARS`` *characters*, and a paragraph in Cyrillic or
    Japanese costs nine characters a letter once percent-encoded, so a summary well
    inside the cap can be several times the whole link's budget. Shedding blindly
    from the end would then eat the report and leave a marker blaming the log — the
    user clicks through and finds their own words gone. So the user's section is a
    floor: everything after it goes first, and only if that is still too long is the
    summary itself shortened, with a marker that says which one was cut.
    """
    tag = f"&labels={quote(label)}" if label else ""

    def link(text: str) -> str:
        return f"{ISSUE_NEW_URL}?title={quote(subject)}{tag}&body={quote(text)}"

    lines = body.rstrip("\n").split("\n")
    floor = _own_section(lines)
    trimmed = False
    while True:
        url = link("\n".join([*lines, TRIM_MARKER] if trimmed else lines))
        if len(url) <= URL_LIMIT:
            return url
        if len(lines) <= floor:
            break
        lines.pop()
        trimmed = True

    marker = f"\n\n{SUMMARY_TRIM_MARKER}"
    budget = URL_LIMIT - len(link(marker))
    return link(_fit("\n".join(lines), max(budget, 0)) + marker)


def payload(summary: str = "", *, kind: str = DEFAULT_KIND) -> dict[str, str]:
    """What Settings → System renders: the full report, and the link to file it."""
    if kind not in KINDS:
        kind = DEFAULT_KIND
    body = report(summary, kind=kind)
    subject = title(summary, kind=kind)
    label = KINDS[kind][2]
    return {
        "kind": kind,
        "title": subject,
        "report": body,
        "url": issue_url(body, subject=subject, label=label),
    }
