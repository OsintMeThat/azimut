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

**The page's own title.** A web page's list names each page by the title it published
and its day (`notesources.card_entry`), never by the words a note linked it with. Once a
page has its copy, the run reads that copy back from the archive, the raw page as it was
saved (`id_`), and keeps the title and the day the page states of itself. The page's own
site is never asked: the archive already holds the address, so nothing new leaves.
A post or a profile on a walled site (`notesources.WALLED`) is cited by its account and
day instead, and a file downloaded from a page keeps what the download recorded. A link
archived already whose page has no title yet is a link to work on too.

**Network.** Only that press reaches it: `archive.org` and `web.archive.org`, with
Azimut's user agent, nothing else sent. Reading the plan, the record, a note or the
check never does, nor does starting the app (SPEC §9).

**What is written.** On the item: `archive_url`, `archived_at` (the day the copy was
made), and on a bookmark this run files, `fetched_at`, the moment Azimut archived it,
which is the day a reader is told the page was accessed (`accessed`). On a bookmark, the
page's `page_title` and `published_at` when the copy states them; one this run filed is
named after its page's title too.
"""

from __future__ import annotations

import functools
import html
import json
import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Callable, Iterator
from urllib.parse import urljoin, urlsplit, urlunsplit

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

#: The day a bookmark's copy was read for its page's title, found or not: read once.
TITLE_TRIED = "page_title_tried"
#: Who files the bookmarks, as provenance says.
FILED_BY = notesources.LINKS_FILED_BY
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
    holds and that copy's day ("" for none), whether the case holds an item for it, and
    whether its page still wants its own title read (`wants_title`)."""

    url: str
    text: str
    archive: str = ""
    archived: str = ""
    held: bool = False
    untitled: bool = False

    @property
    def todo(self) -> bool:
        """Whether a run has work on it: a copy to make, or a title to read."""
        return not self.archive or self.untitled


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
        links.append(Link(address, said, source.archive, source.archived, bool(source.entity_id),
                          untitled=wants_title(case, address, source)))
    return links


def wants_title(case: "Case", address: str, source: notesources.Source) -> bool:
    """Whether a link's page should have its own title read from its copy: a bookmark of a
    page, not a post on a walled site, a document or a file a download recorded, with no
    title yet and none looked for in its copy before."""
    if source.title or source.type != "bookmark" or notesources.walled(address) or notesources.is_report(address):
        return False
    record = case.get_entity(source.entity_id) if source.entity_id else None
    return not ((record or {}).get("attrs") or {}).get(TITLE_TRIED)


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
    titles = [link for link in links if link.archive and link.untitled]
    return {
        "links": [
            {"url": link.url, "text": link.text, "state": "archived" if link.archive else "todo",
             "copy": link.archive, "made": link.archived, "held": link.held,
             **({"untitled": True} if link.untitled else {})}
            for link in links[:MAX_LINKS]
        ],
        "total": len(links),
        "todo": len(todo),
        "titles": len(titles),
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
        todo = [link for link in links_of(case, note_id, internal=internal) if link.todo][:MAX_LINKS]
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
        # given a copy before, by hand or another run: its page's title may still be wanted
        made = str(((holder or {}).get("attrs") or {}).get(notesources.ARCHIVED_AT) or notesources.archive_day(held_copy))
        _name_page(case, archive, holder, url, held_copy)
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
        kept = _keep(case, holder, url, text, copy, record.get("folder") or folder_name("Note"), accessed=accessed(state))
    except CaseError:
        return {"state": FAILED, "reason": "The item of this link was deleted while it was archived."}
    _name_page(case, archive, kept, url, copy.address)
    return {"state": state, "copy": copy.address, "made": copy.stamp, "reason": said, "gone": gone or None}


def _name_page(case: "Case", archive: "Wayback", holder: dict[str, Any] | None, url: str, copy: str) -> None:
    """Keep the title and the day a bookmark's page states of itself, read back from its
    copy; a bookmark a note's links filed is named after that title. A copy that says
    nothing readable, or a page that is not one, leaves the bookmark as it was."""
    if holder is None or holder.get("type") != "bookmark":
        return
    attrs = holder.get("attrs") or {}
    if attrs.get(notesources.PAGE_TITLE) or notesources.walled(url) or notesources.is_report(url):
        return
    try:
        facts = archive.page(copy, url)
    except (Offline, Busy, Stopped):
        # the copy is made and kept: the link is settled, and the run hears this again at its next step
        return
    if facts is None:
        return  # no answer: the next press asks again
    patch: dict[str, Any] = {"attrs": {TITLE_TRIED: _now().date().isoformat()}}
    if facts.title:
        patch["attrs"][notesources.PAGE_TITLE] = facts.title
        if facts.day and not attrs.get(notesources.PUBLISHED_AT):
            # a day the analyst typed on the bookmark stands
            patch["attrs"][notesources.PUBLISHED_AT] = facts.day
        if (holder.get("provenance") or {}).get("by") == FILED_BY:
            patch["label"] = facts.title
    try:
        case.update_entity(str(holder["id"]), patch)
    except CaseError:
        pass


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
          *, accessed: bool) -> dict[str, Any]:
    """Keep the copy on the item the link finds, or on a bookmark filed for it; that item."""
    kept = {notesources.ARCHIVE: copy.address, notesources.ARCHIVED_AT: copy.stamp}
    if holder is not None:
        return case.update_entity(str(holder["id"]), {"attrs": kept})
    attrs: dict[str, Any] = {"url": url, "site": urlsplit(url).hostname or "", "folder": folder, **kept}
    if accessed:
        attrs["fetched_at"] = _now().isoformat(timespec="seconds")
    return case.add_entity("bookmark", urltitles.title_of(url, text), attrs, by=FILED_BY)


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

    def page(self, copy: str, page: str) -> "PageFacts | None":
        """What a copy's page states of itself (`page_facts`), read from the archive as it
        was saved, following the archive's own redirects to the nearest copy. A copy that
        says nothing readable answers an empty title; None when the archive did not answer."""
        address = _raw(copy)
        landed = page
        for _hop in range(MAX_HOPS):
            if not address:
                return None
            response: httpx.Response | None = None
            for response in self._ask("read", LOOK_GAP, functools.partial(self.http.get, address, timeout=LOOK_TIMEOUT)):
                break
            if response is None:
                return None
            if response.status_code in (301, 302, 303, 307, 308):
                address = urljoin(address, response.headers.get("location", ""))
                if notesources.host(address) != COPY_HOST:
                    return None
                landed = _kept_page(address) or landed
                continue
            kind = response.headers.get("content-type", "").lower()
            if response.status_code >= 500:
                return None
            if response.status_code != 200 or (kind and "html" not in kind):
                return PageFacts("")
            said = page_facts(response.content[:MAX_BODY].decode(response.encoding or "utf-8", "replace"), page)
            if said is not None and urltitles.url_key(landed) != urltitles.url_key(page):
                # kept as a redirect to another address: its title is this page's only when that
                # address spells it out (a short link to its article), never a home page or another story
                if not (_slug_words(landed) and _fits_address(said.title, landed)):
                    return PageFacts("")
            return said or PageFacts("")
        return None

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


@dataclass(frozen=True)
class PageFacts:
    """What a page states of itself: its title, and the day it was published ("" when it does not say)."""

    title: str
    day: str = ""


#: How many of the archive's redirects a reading of a copy follows.
MAX_HOPS = 4
_META = re.compile(r"<meta\b[^>]*>", re.I)
_META_ATTR = re.compile(r"""([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_TITLE_TAG = re.compile(r"<title\b[^>]*>(.*?)</title>", re.I | re.S)
_LD_PUBLISHED = re.compile(r'"datePublished"\s*:\s*"([^"]{10,40})"')
_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})")
#: The meta tags a page states its title and its day in, in the order they are believed.
TITLE_KEYS = ("og:title", "twitter:title")
DAY_KEYS = ("article:published_time", "og:published_time", "datepublished", "publishdate", "pubdate",
            "publication_date", "date", "dc.date.issued", "dc.date", "dcterms.date", "parsely-pub-date",
            "sailthru.date", "article.published")
#: What a copy says when it is not the page: a wall, an error, a challenge.
NOT_A_TITLE = re.compile(r"^(just a moment|attention required|access denied|forbidden|403\b|404\b|page not found|"
                         r"not found|error\b|javascript is not available|are you a robot|security check|"
                         r"one more step|log ?in\b|sign ?in\b|wayback machine)", re.I)


def page_facts(page_html: str, url: str) -> PageFacts | None:
    """The title and the day a page's HTML states of itself, or None when it names none a
    reader could use. Meta tags first (`og:title`, `article:published_time`), then its
    `<title>` without the site's name after it; dates as their day."""
    metas: dict[str, str] = {}
    for tag in _META.findall(page_html):
        found = {key.lower(): next(value for value in values if value is not None)
                 for key, *values in _META_ATTR.findall(tag)}
        name = (found.get("property") or found.get("name") or found.get("itemprop") or "").lower()
        if name and "content" in found:
            metas.setdefault(name, found["content"])
    title = next((_clean(metas[key]) for key in TITLE_KEYS if _clean(metas.get(key, ""))), "")
    if not title:
        tag = _TITLE_TAG.search(page_html)
        title = _without_site(_clean(tag.group(1)) if tag else "", metas.get("og:site_name", ""), url)
    site = notesources.outlet(url)
    if not title or NOT_A_TITLE.match(title) or title.lower() in (site.lower(), notesources.host(url)):
        return None
    if not _fits_address(title, url):
        return None
    said = [metas.get(key, "") for key in DAY_KEYS] + _LD_PUBLISHED.findall(page_html)
    day = next((found.group(1) for found in (_DAY.match(value.strip()) for value in said if value) if found
                and _plausible(found.group(1))), "")
    return PageFacts(title[:notesources.MAX_LABEL], day)


#: Words an address's slug shares with any title, which say nothing about which page it is.
_SLUG_SKIP = frozenset({"the", "and", "for", "from", "with", "says", "said", "news", "after", "over", "into", "near"})


def _slug_words(url: str) -> set[str]:
    """The words an address spells (`/houthis-take-mocha`), when it spells at least three."""
    try:
        path = urlsplit(url).path
    except ValueError:
        return set()
    slug = max((part for part in path.split("/") if part.count("-") >= 2), key=len, default="")
    wanted = {word for word in re.split(r"[^a-z0-9]+", slug.lower()) if len(word) >= 4 and word not in _SLUG_SKIP}
    return wanted if len(wanted) >= 3 else set()


def _fits_address(title: str, url: str) -> bool:
    """Whether a title can be the page's whose address spells its words: an address with no
    such words fits any title; one with them must share some with it (one of a short slug's,
    two of a longer one's). A copy of another story, saved where this address redirected, fails."""
    wanted = _slug_words(url)
    if not wanted:
        return True
    said = {word for word in re.split(r"[^a-z0-9]+", title.lower().replace("’", "'")) if len(word) >= 4}
    return len(wanted & said) >= (1 if len(wanted) <= 4 else 2)


def _kept_page(copy: str) -> str:
    """The page an archive address keeps, or ""."""
    try:
        parts = urlsplit(copy)
    except ValueError:
        return ""
    match = _STAMP.match(parts.path + (f"?{parts.query}" if parts.query else ""))
    return notesources.web(match.group(2)) if match else ""


def _clean(text: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]*>", " ", text or "")).split())


def _without_site(title: str, site_name: str, url: str) -> str:
    """`Yemen's forces retreat` from `Yemen's forces retreat | Al-Monitor`: the site's name dropped."""
    names = {name.lower() for name in (site_name.strip(), notesources.outlet(url), notesources.host(url)) if name}
    for mark in (" | ", " - ", " – ", " — ", " :: "):
        head, _, tail = title.rpartition(mark)
        if head and tail.strip().lower() in names:
            return head.strip()
    return title


def _plausible(day: str) -> bool:
    try:
        when = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return datetime(1990, 1, 1, tzinfo=timezone.utc) <= when <= _now() + timedelta(days=2)


def _raw(copy: str) -> str:
    """The address the archive serves a copy's page from as it was saved (`id_`), or ""."""
    try:
        parts = urlsplit(copy)
    except ValueError:
        return ""
    match = _STAMP.match(parts.path + (f"?{parts.query}" if parts.query else ""))
    if not match or (parts.hostname or "") not in (COPY_HOST, "wayback.archive.org"):
        return ""
    return f"https://{COPY_HOST}/web/{match.group(1)}id_/{match.group(2)}"


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


__all__ = ["ArchiveError", "Copy", "Link", "PageFacts", "Wayback", "page_facts", "change", "folder_name", "links_of", "plan", "read", "start",
           "stop", "view"]
