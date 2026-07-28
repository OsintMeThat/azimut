"""What to tell a bug report — build number, machine, and the last warnings.

A local app has no crash reporter behind it, so the useful facts about a broken
run only exist on the user's own machine. This module collects them into one
short Markdown block and turns it into a pre-filled GitHub issue URL, which the
About tab shows in full before the user decides to open it. Nothing is sent from
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

**Nothing personal.** A log line or a path can hold the account name and case
names, and an issue is public, so every string goes through :func:`scrub`: the
home directory collapses to ``~`` and the account name becomes a placeholder.
The workspace path is deliberately absent — About shows it locally, a report
does not need it.
"""

from __future__ import annotations

import getpass
import logging
import platform
import sys
from collections import deque
from pathlib import Path
from urllib.parse import quote

from .. import __version__
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
#: sheds log lines to fit. The Copy button always carries the whole report.
URL_LIMIT = 6000
TRIM_MARKER = "_(log trimmed to fit the link; use Copy for the full report)_"

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


def scrub(text: str) -> str:
    """Replace this machine's home path and account name with placeholders."""
    try:
        home = str(Path.home())
    except Exception:  # no home to hide
        home = ""
    if home:
        text = text.replace(home, "~")
    name = _account_name()
    # Two characters or fewer would match far too much ordinary prose.
    if len(name) > 2:
        text = text.replace(name, _PLACEHOLDER)
    return text


# ---- the report ---------------------------------------------------------------


def install_kind() -> str:
    """How this copy was installed, as far as it can tell about itself."""
    return "standalone binary" if getattr(sys, "frozen", False) else "Python package"


def environment() -> dict[str, str]:
    """The build and machine facts a maintainer needs to reproduce a bug."""
    info = ffmpeg.info()
    if info.get("available"):
        version = str(info.get("version") or "installed")
        source = "bundled" if info.get("source") == "bundled" else "system PATH"
        ffmpeg_line = f"{version} ({source})"
    else:
        ffmpeg_line = "not found"
    return {
        "Azimut": f"{__version__} ({install_kind()})",
        "OS": f"{platform.system()} {platform.release()} ({platform.machine()})",
        "Python": platform.python_version(),
        "ffmpeg": ffmpeg_line,
    }


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


def issue_url(body: str, *, subject: str = "", label: str = "") -> str:
    """A pre-filled issue link, shedding trailing lines until it fits.

    Log lines sit last in the body precisely so this sheds them first and never
    touches what the user wrote.
    """
    tag = f"&labels={quote(label)}" if label else ""
    lines = body.rstrip("\n").split("\n")
    trimmed = False
    while True:
        text = "\n".join([*lines, TRIM_MARKER] if trimmed else lines)
        url = f"{ISSUE_NEW_URL}?title={quote(subject)}{tag}&body={quote(text)}"
        if len(url) <= URL_LIMIT or not lines:
            return url
        lines.pop()
        trimmed = True


def payload(summary: str = "", *, kind: str = DEFAULT_KIND) -> dict[str, str]:
    """What the About tab renders: the full report, and the link to file it."""
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
