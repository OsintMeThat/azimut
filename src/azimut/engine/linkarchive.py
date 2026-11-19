"""Archive every outside link of a note with the Internet Archive, on the analyst's press.

An article cites pages that move and vanish. Before it goes out, one press sends each
outside link of the note to the Wayback Machine and keeps the copy's address on the
case item the link finds (`urltitles.AddressIndex`): a downloaded post, a bookmark. A
link the case holds nothing of is filed as a bookmark first, in a folder named after
the note (`folder_name`), so it becomes a source like any other. The note's text is
never changed: the written link finds its item and prints its archived copy.

**Which links.** The ones the check before export counts (`notes_markdown.Cited.outside`):
each outside page once, the case's own work left out (archived copies, imagery
viewers and services, a captured map view, where a proof was posted). Only the public
edition's by default: a link in an internal passage would tell the archive what the
team reads, so those go only when the analyst ticks them in (`internal`). A link whose
item already holds an archived copy is left alone.

**Each link.** First the archive is asked for its newest copy (`AVAILABLE`, one quick
call). A copy made in the last `REUSE_DAYS` days is reused; with *Make fresh copies*
only one made since the press is. Otherwise Save Page Now makes one (`SAVE`), which
takes 10 to 30 s. A page that no longer answers, or that the archive will not save,
gets its older copy when there is one, said as such; with none, the link fails with
the reason, and the next press tries it again.

**Manners.** One link at a time, at least `SAVE_GAP` seconds between two saves and
`LOOK_GAP` between two lookups. A 429 waits as long as the archive asks, else
longer each time (`BUSY_WAITS`); after that the run stops and says so, keeping what
it did. Offline, it stops at once with *Could not reach the Internet Archive*.

**The run.** It is a job on the case's queue (`engine/workqueue.py`), so it waits
behind nothing and lets the case's other work through between links. Its record
(`read`, the note's `link_archive` attr, a case setting for the case notes) says
where it is: each link's state and copy, and why it stopped. Stop is heard between
links and during every wait. A run that Azimut's closing cut short is never picked up
again by itself: the record says it stopped, and the next press goes on from where it
was, a copy made just before the cut being found by the lookup rather than made twice.

**Network.** Only that press reaches it: `archive.org` and `web.archive.org`, with
Azimut's user agent, nothing else sent. Reading the plan, the record, a note or the
check never does, nor does starting the app (SPEC §9).

**What is written.** On the item: `archive_url`, `archived_at` (the day the copy was
made), and on a bookmark this run files, `fetched_at`, the moment Azimut archived it,
which is the day a reader is told the page was accessed (`accessed`).
"""

from __future__ import annotations

import functools
import json
import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Callable, Iterator
from urllib.parse import urlsplit, urlunsplit

import httpx

from .. import USER_AGENT, layout
from ..workspace import CaseError
from . import notes_markdown as md
from . import notesources, urltitles, workqueue
from .notelook import CASE_NOTE, NoteLook

if TYPE_CHECKING:
    from ..workspace import Case

JOB = "link-archive"
#: Where a note keeps its run: an attr of the note, a case setting for the case notes.
RECORD = "link_archive"
CASE_RECORD = "notes.case_link_archive"
VERSION = 1

#: The Wayback Machine's newest copy of a page, and its Save Page Now.
AVAILABLE = "https://archive.org/wayback/available"
SAVE = "https://web.archive.org/save/"
COPY_HOST = "web.archive.org"
#: The two hosts the run reaches, and nothing else.
HOSTS = ("archive.org", COPY_HOST)

#: A copy younger than this is reused rather than made again.
REUSE_DAYS = 30
#: How many links one run takes.
MAX_LINKS = 500
#: Seconds between two saves and two lookups.
SAVE_GAP = 10.0
LOOK_GAP = 1.0
#: How long a 429 waits when the archive does not say, each one longer; past the last the run stops.
BUSY_WAITS = (60.0, 120.0, 240.0, 480.0, 900.0)
#: The longest wait a `Retry-After` is taken for.
MAX_WAIT = 900.0
#: How long the archive is waited on when it answers 502, 503 or 504, before the link fails.
DOWN_WAITS = (30.0, 60.0)
#: A save takes 10 to 30 s and can take minutes; a lookup is quick.
SAVE_TIMEOUT = httpx.Timeout(120.0, connect=15.0)
LOOK_TIMEOUT = httpx.Timeout(30.0, connect=15.0)
#: How much of an answer is read.
MAX_BODY = 256 * 1024
#: How long a link is guessed to take, before the run has timed one.
GUESS_PER_LINK = 20.0
#: How long a link's words and a reason are kept.
MAX_TEXT = 120
MAX_REASON = 200

#: The run's states.
QUEUED, RUNNING, STOPPING, STOPPED, DONE = "queued", "running", "stopping", "stopped", "done"
ACTIVE = (QUEUED, RUNNING, STOPPING)
#: A link's states: waiting its turn, under way, a new copy, a recent copy reused, an
#: older copy linked because no new one could be made, or no copy at all.
WAITING, SAVING, NEW, KEPT, OLDER, FAILED = "waiting", "saving", "new", "kept", "older", "failed"
SETTLED = (NEW, KEPT, OLDER)

#: Why a run stopped, as the dialog says it.
OFFLINE = "Could not reach the Internet Archive. What was done is kept."
BUSY = "The Internet Archive asked to slow down. What was done is kept; try again later."
CLOSED = "Azimut was closed before it finished. What was done is kept."
ENDED = "It stopped before it finished. What was done is kept."
HALTED = "Stopped. What was done is kept."

#: Who files the bookmarks, as provenance says.
FILED_BY = "note"
#: This process. A run asked in another one was cut short by Azimut closing.
BOOT = uuid.uuid4().hex

_STAMP = re.compile(r"^/web/(\d{14})[a-z_]*/(.+)$", re.I | re.S)
_IN_BODY = re.compile(r"/web/(\d{14})/(https?://[^\s\"'<>]+)", re.I)
_MEMENTO = re.compile(r"<([^>]+)>\s*;[^,]*rel=\"?[^\",]*\bmemento\b", re.I)

#: One write of a record at a time: the run's progress and a stop are read-modify-writes.
_turn = threading.Lock()


class ArchiveError(Exception):
    """What the press cannot do, said to the analyst."""


class Offline(Exception):
    """The Internet Archive could not be reached at all."""


class Busy(Exception):
    """The archive kept answering 429."""


class Stopped(Exception):
    """The analyst pressed Stop."""


class PageError(Exception):
    """The archive could not make a copy of this page; ``gone`` when the page itself did not answer."""

    def __init__(self, reason: str, *, gone: bool = False) -> None:
        super().__init__(reason)
        self.reason = reason
        self.gone = gone


@dataclass(frozen=True)
class Copy:
    """A copy in the Wayback Machine: its address and when it was made (UTC)."""

    address: str
    made: datetime

    @property
    def stamp(self) -> str:
        return self.made.strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class Link:
    """One outside link of a note: its address, its words, the archived copy its item
    holds and that copy's day ("" for none), and whether the case holds an item for it."""

    url: str
    text: str
    archive: str = ""
    archived: str = ""
    held: bool = False


# -- the links of a note ------------------------------------------------------------


def links_of(case: "Case", note_id: str, *, internal: bool = False) -> list[Link]:
    """The outside links of a note as the check before export counts them, in the
    public edition unless ``internal``, its chapters included. Nothing is fetched."""
    found = md.read_note(case, note_id)
    if found is None:
        raise ArchiveError("That note is no longer in the case.")
    title, text = found
    pieces = md.expand(title, text, resolve=md.case_resolver(case), note_id=note_id, public=not internal)
    blocks = {id(piece): md.alignment_blocks(piece.text) for piece in pieces if piece.kind == "text"}
    cited = md.Cited(case, look=NoteLook(sources="on"))
    cited.collect(pieces, blocks)
    links = []
    for address, words, _line, source in cited.outside():
        said = md.cut_text(words or urltitles.title_of(address), MAX_TEXT)
        links.append(Link(address, said, source.archive, source.archived, bool(source.entity_id)))
    return links


def folder_name(title: str) -> str:
    """The folder the links a note's run files go in: `Links of “<title>”`, within the
    length a folder path may take."""
    words = " ".join(str(title).replace("/", "-").split()) or "Note"
    room = layout.MAX_FOLDER_PATH - len("Links of “”")
    if len(words) > room:
        cut = words[: room - 1]
        space = cut.rfind(" ")
        words = (cut[:space] if space > room // 2 else cut).rstrip(" ,;:-") + "…"
    return f"Links of “{words}”"


def plan(case: "Case", note_id: str, *, internal: bool = False) -> dict[str, Any]:
    """What a press would do, read from the case alone: the links (each `todo` or
    `archived`), how many have a copy already, how many would be filed as bookmarks, and
    how many more the internal passages hold."""
    found = md.read_note(case, note_id)
    if found is None:
        raise ArchiveError("That note is no longer in the case.")
    links = links_of(case, note_id, internal=internal)
    more = 0 if internal else max(0, len(links_of(case, note_id, internal=True)) - len(links))
    todo = [link for link in links if not link.archive]
    return {
        "links": [
            {"url": link.url, "text": link.text, "state": "archived" if link.archive else "todo",
             "copy": link.archive, "made": link.archived, "held": link.held}
            for link in links[:MAX_LINKS]
        ],
        "total": len(links),
        "todo": len(todo),
        "archived": len(links) - len(todo),
        "filed": sum(1 for link in todo if not link.held),
        "more_internal": more,
        "folder": folder_name(found[0]),
        "max": MAX_LINKS,
    }


# -- the record --------------------------------------------------------------------


def read(case: "Case", note_id: str) -> dict[str, Any] | None:
    """A note's run as kept, or None. A record that is not one (a bundle from elsewhere) is none."""
    raw: Any
    if note_id == CASE_NOTE:
        try:
            raw = json.loads(case.get_setting(CASE_RECORD) or "null")
        except ValueError:
            raw = None
    else:
        entity = case.get_entity(note_id)
        if entity is None or entity.get("type") != "note":
            return None
        raw = (entity.get("attrs") or {}).get(RECORD)
    return _checked(raw)


def _checked(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("version") != VERSION:
        return None
    if raw.get("state") not in (*ACTIVE, STOPPED, DONE) or not isinstance(raw.get("links"), list):
        return None
    links = []
    for item in raw["links"][:MAX_LINKS]:
        if not isinstance(item, dict) or not notesources.web(item.get("url")):
            continue
        state = item.get("state") if item.get("state") in (WAITING, SAVING, *SETTLED, FAILED) else WAITING
        link = {"url": str(item["url"]), "text": str(item.get("text") or "")[:MAX_TEXT], "state": state}
        copy = notesources.web(item.get("copy"))
        if copy and notesources.is_archive(copy):
            link["copy"] = copy
            link["made"] = str(item.get("made") or "")[:20]
        if item.get("reason"):
            link["reason"] = str(item["reason"])[:MAX_REASON]
        if item.get("gone") is True:
            link["gone"] = True
        links.append(link)
    return {**raw, "links": links}


def _write(case: "Case", note_id: str, record: dict[str, Any]) -> None:
    if note_id == CASE_NOTE:
        case.set_setting(CASE_RECORD, json.dumps(record, ensure_ascii=False))
    else:
        case.update_entity(note_id, {"attrs": {RECORD: record}})


def change(case: "Case", note_id: str, mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any] | None:
    """Change a note's record in place, one change at a time; None when it has none."""
    with _turn:
        record = read(case, note_id)
        if record is None:
            return None
        mutate(record)
        record["updated_at"] = _now().strftime("%Y-%m-%dT%H:%M:%SZ")
        _write(case, note_id, record)
        return record


def _live(case: "Case", note_id: str) -> bool:
    """Whether this case's queue holds the note's run, waiting or under way."""
    return any(
        job.get("key") == note_id
        for state in ("queued", "running")
        for job in case.list_jobs(kind=JOB, state=state)
    )


def view(case: "Case", note_id: str) -> dict[str, Any] | None:
    """A note's run as the dialog shows it: its record, its counts, and the time it
    guesses is left. A record that says it runs with nothing in the queue behind it
    (a bundle carries no jobs, a crash) says it stopped."""
    record = read(case, note_id)
    if record is None:
        return None
    if record["state"] in ACTIVE and not _live(case, note_id):
        record = {**record, "state": STOPPED, "reason": record.get("reason") or ENDED}
    states = [link["state"] for link in record["links"]]
    record["counts"] = {
        "total": len(states),
        "archived": sum(1 for state in states if state in SETTLED),
        "new": states.count(NEW),
        "kept": states.count(KEPT),
        "older": states.count(OLDER),
        "failed": states.count(FAILED),
    }
    return record


# -- the press ---------------------------------------------------------------------


def start(case: "Case", note_id: str, *, internal: bool = False, fresh: bool = False) -> dict[str, Any]:
    """Queue a run over the note's links that have no archived copy. A run stopped
    before it finished, asked the same way, goes on with the same idea of fresh."""
    found = md.read_note(case, note_id)
    if found is None:
        raise ArchiveError("That note is no longer in the case.")
    with _turn:
        before = view(case, note_id)
        if before is not None and before["state"] in ACTIVE:
            raise ArchiveError("The links of this note are being archived already.")
        todo = [link for link in links_of(case, note_id, internal=internal) if not link.archive][:MAX_LINKS]
        if not todo:
            raise ArchiveError("Every link of this note has an archived copy.")
        now = _now().strftime("%Y-%m-%dT%H:%M:%SZ")
        carried = before is not None and before["state"] == STOPPED and bool(before.get("fresh")) == fresh
        record = {
            "version": VERSION,
            "state": QUEUED,
            "asked_at": now,
            "since": str(before.get("since") or now) if carried and before is not None else now,
            "fresh": fresh,
            "internal": internal,
            "folder": folder_name(found[0]),
            "reason": "",
            "left": round(len(todo) * GUESS_PER_LINK),
            "updated_at": now,
            "links": [{"url": link.url, "text": link.text, "state": WAITING} for link in todo],
        }
        _write(case, note_id, record)
        # queued under the same turn, so no reading sees the record without its job
        workqueue.enqueue(case, JOB, key=note_id, payload={"note": note_id, "boot": BOOT})
    return view(case, note_id) or record


def stop(case: "Case", note_id: str) -> dict[str, Any] | None:
    """Ask a run to stop: one waiting stops at once, one under way after the link it is on."""
    def ask(record: dict[str, Any]) -> None:
        if record["state"] == QUEUED or (record["state"] in ACTIVE and not _live(case, note_id)):
            record.update(state=STOPPED, reason=HALTED)
            _reset_saving(record)
        elif record["state"] == RUNNING:
            record["state"] = STOPPING

    record = change(case, note_id, ask)
    if record is not None and record["state"] == STOPPED:
        for job in case.list_jobs(kind=JOB, state="queued"):
            if job.get("key") == note_id:
                case.cancel_job(job["id"])
    return view(case, note_id)


def _reset_saving(record: dict[str, Any]) -> None:
    for link in record["links"]:
        if link["state"] == SAVING:
            link["state"] = WAITING


# -- the run, on the case's queue -----------------------------------------------------


def client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    """The one client the run reaches the archive with: no redirect followed (a save's
    redirect is its answer), Azimut's user agent. ``transport`` stands the archive in for the tests."""
    return httpx.Client(timeout=SAVE_TIMEOUT, follow_redirects=False, transport=transport,
                        headers={"User-Agent": USER_AGENT})


def run(case: "Case", job: dict[str, Any]) -> None:
    """The queue's handler: each waiting link of the record in turn, its outcome kept as it lands."""
    payload = job.get("payload") or {}
    note_id = str(payload.get("note") or "")
    if payload.get("boot") != BOOT:
        # asked before Azimut last started: never picked up again by itself
        change(case, note_id, lambda record: _halt(record, CLOSED) if record["state"] in ACTIVE else None)
        raise workqueue.JobCancelled(f"the run of {note_id!r} was cut short by Azimut closing")

    def begin(record: dict[str, Any]) -> None:
        if record["state"] == QUEUED:
            record["state"] = RUNNING
            _reset_saving(record)

    record = change(case, note_id, begin)
    if record is None or record["state"] != RUNNING:
        raise workqueue.JobCancelled(f"the run of {note_id!r} is gone or was stopped")
    started = _clock()
    timed = 0

    def asked_to_stop() -> bool:
        kept = read(case, note_id)
        return kept is None or kept["state"] != RUNNING

    def tick() -> None:
        if asked_to_stop():
            raise Stopped()
        workqueue.let_others_through(case, JOB)

    try:
        with client() as http:
            archive = Wayback(http, tick=tick, sleep=_sleep, clock=_clock)
            for index, link in enumerate(record["links"]):
                if link["state"] in SETTLED:
                    continue
                tick()
                left = _left(record["links"], index, _clock() - started, timed)
                change(case, note_id, functools.partial(_mark, index=index, said={"state": SAVING}, left=left))
                outcome = settle(case, archive, link["url"], link["text"], record)
                record["links"][index] = {**link, **outcome}
                change(case, note_id, functools.partial(_mark, index=index, said=outcome, left=None))
                timed += 1
    except Offline:
        _stop(case, note_id, OFFLINE)
        raise workqueue.JobCancelled(f"the run of {note_id!r} could not reach the archive")
    except Busy:
        _stop(case, note_id, BUSY)
        raise workqueue.JobCancelled(f"the run of {note_id!r} was asked to slow down")
    except Stopped:
        _stop(case, note_id, HALTED)
        raise workqueue.JobCancelled(f"the run of {note_id!r} was stopped")
    finished = change(case, note_id, lambda kept: kept.update(state=DONE, reason="", left=0))
    if finished is None:
        raise workqueue.JobCancelled(f"the note {note_id!r} was deleted while its links were archived")


def _halt(record: dict[str, Any], reason: str) -> None:
    record.update(state=STOPPED, reason=reason, left=0)
    _reset_saving(record)


def _stop(case: "Case", note_id: str, reason: str) -> None:
    change(case, note_id, lambda record: _halt(record, reason))


def _mark(record: dict[str, Any], index: int, said: dict[str, Any], left: int | None) -> None:
    if 0 <= index < len(record["links"]):
        link = {key: value for key, value in record["links"][index].items() if key in ("url", "text")}
        record["links"][index] = {**link, **{key: value for key, value in said.items() if value not in ("", None)}}
    if left is not None:
        record["left"] = left


def _left(links: list[dict[str, Any]], index: int, spent: float, timed: int) -> int:
    """Seconds left, from this run's own pace once it has one."""
    remaining = sum(1 for link in links[index:] if link["state"] not in SETTLED)
    per = spent / timed if timed else GUESS_PER_LINK
    return round(per * remaining)


def settle(case: "Case", archive: "Wayback", url: str, text: str, record: dict[str, Any]) -> dict[str, Any]:
    """One link: its newest copy reused when recent enough, else a new one, else an older
    one; the copy kept on the item the link finds, a bookmark filed when there is none."""
    holder = _holder(case, url)
    held_copy = notesources.web(((holder or {}).get("attrs") or {}).get(notesources.ARCHIVE))
    if held_copy:
        # given a copy meanwhile, by hand or another run
        made = str(((holder or {}).get("attrs") or {}).get(notesources.ARCHIVED_AT) or notesources.archive_day(held_copy))
        return {"state": KEPT, "copy": held_copy, "made": made}
    page = _page(url)
    found = archive.newest(page)
    if found is not None and found.made >= _since(record):
        state, copy, said, gone = KEPT, found, "", False
    else:
        try:
            copy, state, said, gone = archive.save(page), NEW, "", False
        except PageError as exc:
            if found is None:
                return {"state": FAILED, "reason": exc.reason, "gone": exc.gone or None}
            copy, state, said, gone = found, OLDER, exc.reason, exc.gone
    try:
        _keep(case, holder, url, text, copy, record.get("folder") or folder_name("Note"), accessed=accessed(state))
    except CaseError:
        return {"state": FAILED, "reason": "The item of this link was deleted while it was archived."}
    return {"state": state, "copy": copy.address, "made": copy.stamp, "reason": said, "gone": gone or None}


def accessed(state: str) -> bool:
    """Whether a bookmark this run files says the page was accessed when it was archived
    (owner question 4): yes when the page answered, a new copy or a recent one; not when
    only an older copy could be linked."""
    return state in (NEW, KEPT)


def _since(record: dict[str, Any]) -> datetime:
    """How recent a copy must be to be reused: under `REUSE_DAYS`, or with fresh copies
    asked for, made since the press (owner question 3)."""
    if record.get("fresh"):
        try:
            return datetime.fromisoformat(str(record.get("since") or "").replace("Z", "+00:00"))
        except ValueError:
            return _now()
    return _now() - timedelta(days=REUSE_DAYS)


def _holder(case: "Case", url: str) -> dict[str, Any] | None:
    """The item a link to ``url`` finds that an archived copy can be kept on: a file
    downloaded from it or its bookmark. A proof imported from a post is not that post."""
    record = urltitles.AddressIndex(case).first(url)
    if record is None or record.get("type") not in ("media", "bookmark"):
        return None
    return case.get_entity(str(record["id"]))


def _keep(case: "Case", holder: dict[str, Any] | None, url: str, text: str, copy: Copy, folder: str,
          *, accessed: bool) -> None:
    kept = {notesources.ARCHIVE: copy.address, notesources.ARCHIVED_AT: copy.stamp}
    if holder is not None:
        case.update_entity(str(holder["id"]), {"attrs": kept})
        return
    attrs: dict[str, Any] = {"url": url, "site": urlsplit(url).hostname or "", "folder": folder, **kept}
    if accessed:
        attrs["fetched_at"] = _now().isoformat(timespec="seconds")
    case.add_entity("bookmark", urltitles.title_of(url, text), attrs, by=FILED_BY)


def _page(url: str) -> str:
    """The address the archive is asked about: the page, its fragment left here."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _clock() -> float:
    return time.monotonic()


# -- the Internet Archive -------------------------------------------------------------


class Wayback:
    """The Wayback Machine, asked politely: one request at a time, gaps between them,
    waits on 429. ``tick`` is called about once a second while waiting; it raises
    `Stopped` when the analyst pressed Stop."""

    def __init__(
        self,
        http: httpx.Client,
        *,
        tick: Callable[[], None] = lambda: None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.http = http
        self.tick = tick
        self.sleep = sleep
        self.clock = clock
        self._last: dict[str, float] = {}

    def newest(self, page: str) -> Copy | None:
        """The newest copy the archive holds of ``page``, or None (none, or no answer)."""
        stamp = _now().strftime("%Y%m%d%H%M%S")
        for response in self._ask("look", LOOK_GAP, lambda: self.http.get(
                AVAILABLE, params={"url": page, "timestamp": stamp}, timeout=LOOK_TIMEOUT)):
            if response is None or response.status_code != 200:
                return None
            try:
                closest = json.loads(_body(response))["archived_snapshots"]["closest"]
            except (ValueError, KeyError, TypeError):
                return None
            if not isinstance(closest, dict) or closest.get("available") is False:
                return None
            if str(closest.get("status") or "200")[:1] not in ("2", "3"):
                return None
            return _copy(str(closest.get("url") or ""), str(closest.get("timestamp") or ""), page)
        return None

    def save(self, page: str) -> Copy:
        """A new copy of ``page``, made now. Raises `PageError` when none could be made."""
        down = iter(DOWN_WAITS)
        for response in self._ask("save", SAVE_GAP, lambda: self.http.get(SAVE + page, timeout=SAVE_TIMEOUT)):
            if response is None:
                raise PageError("The archive took too long with this page; try it again later.")
            status = response.status_code
            if status in (502, 503, 504):
                wait = next(down, None)
                if wait is None:
                    raise PageError("The Internet Archive did not answer; try it again later.")
                self._pause(wait)
                continue
            found = _saved(response, page)
            if found is not None:
                return found
            if status in (404, 410, 520, 523, 524) or response.headers.get("x-archive-wayback-runtime-error"):
                raise PageError("The page no longer answers.", gone=True)
            if status in (401, 403, 451):
                raise PageError("The Internet Archive does not save this page.")
            raise PageError(f"The Internet Archive answered {status} and made no copy.")
        raise PageError("The Internet Archive made no copy.")  # pragma: no cover - the loop always answers

    def _ask(self, kind: str, gap: float, send: Callable[[], httpx.Response]) -> Iterator[httpx.Response | None]:
        """Each answer to ``send``, asked again while the caller goes on; a 429 waits and
        asks again by itself. None for a request that timed out."""
        busy = iter(BUSY_WAITS)
        while True:
            last = self._last.get(kind)
            if last is not None:
                self._pause(last + gap - self.clock())
            response: httpx.Response | None
            try:
                response = send()
            except httpx.TimeoutException:
                response = None
            except httpx.TransportError as exc:
                raise Offline() from exc
            finally:
                self._last[kind] = self.clock()
            if response is None:
                yield None
                return
            if response.status_code == 429:
                wait = next(busy, None)
                if wait is None:
                    raise Busy()
                self._pause(_retry_after(response, wait))
                continue
            yield response

    def _pause(self, seconds: float) -> None:
        end = self.clock() + max(0.0, seconds)
        while True:
            self.tick()
            left = end - self.clock()
            if left <= 0:
                return
            self.sleep(min(1.0, left))


def _retry_after(response: httpx.Response, fallback: float) -> float:
    """How long the archive asked to wait, bounded; ``fallback`` when it did not say."""
    try:
        asked = float(response.headers.get("retry-after", ""))
    except ValueError:
        return fallback
    return min(MAX_WAIT, max(1.0, asked))


def _body(response: httpx.Response) -> str:
    return response.content[:MAX_BODY].decode("utf-8", "replace")


def _copy(address: str, stamp: str, page: str) -> Copy | None:
    """A copy from its address on the archive (`/web/<14 digits>/<page>`), or from its
    stamp and the page; None when neither reads."""
    try:
        parts = urlsplit(address)
    except ValueError:
        parts = urlsplit("")
    match = _STAMP.match(parts.path + (f"?{parts.query}" if parts.query else "")) if address else None
    if match and (not parts.hostname or parts.hostname in (COPY_HOST, "wayback.archive.org")):
        stamp, original = match.group(1), match.group(2)
    else:
        original = page
    try:
        made = datetime.strptime(stamp[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    if not original.startswith(("http://", "https://")):
        original = page
    return Copy(f"https://{COPY_HOST}/web/{stamp[:14]}/{original}", made)


def _saved(response: httpx.Response, page: str) -> Copy | None:
    """The copy Save Page Now says it made: in its redirect, its `Content-Location`, its
    memento link, or its page."""
    for header in ("location", "content-location"):
        found = _copy(response.headers.get(header, ""), "", page)
        if found is not None:
            return found
    for address in _MEMENTO.findall(response.headers.get("link", "")):
        found = _copy(address, "", page)
        if found is not None:
            return found
    if response.status_code == 200:
        match = _IN_BODY.search(_body(response))
        if match:
            return _copy(f"/web/{match.group(1)}/{match.group(2)}", "", page)
    return None


workqueue.register(JOB, run)


__all__ = ["ArchiveError", "Copy", "Link", "Wayback", "change", "folder_name", "links_of", "plan", "read", "start",
           "stop", "view"]
