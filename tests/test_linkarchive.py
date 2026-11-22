"""Archive every link of a note: each outside link sent to the Wayback Machine on the
analyst's press, a recent copy reused, the copy kept on the item the link finds, a
bookmark filed for a link the case lacks.

The Internet Archive is stood in for by `httpx.MockTransport` (`Archive`), and time by
a clock that only moves when the run sleeps, so a 429's wait and the gaps between two
saves are read rather than waited. Sockets are refused throughout: nothing here may
reach the real archive.
"""

from __future__ import annotations

import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from azimut.engine import bundles, linkarchive, notesources, uses, workqueue
from azimut.engine.notelook import CASE_NOTE
from azimut.workspace import Case

from notecase import make_case, make_note

JAZEERA = "https://www.aljazeera.com/news/2026/9/10/houthis-take-mocha"
BBC = "https://www.bbc.com/news/articles/c1"
REUTERS = "https://www.reuters.com/world/middle-east/front"
NOTICE = "https://port.example.org/notice"
TEAM = "https://team.example.net/thread/9"

#: The folder the note's run files its bookmarks in.
FOLDER = "Links of “The fall of the Bab…”"

TEXT = (
    "# Front\n\n"
    f"[Al Jazeera, 10 Sep]({JAZEERA}) said so, [BBC, 5 Oct]({BBC}) too.\n\n"
    f"[Reuters]({REUTERS}) and [the notice]({NOTICE}).\n\n"
    f"> [!internal]\n> [Team thread]({TEAM}) is ours.\n"
)


def stamp(when: datetime) -> str:
    return when.strftime("%Y%m%d%H%M%S")


def ago(days: float) -> str:
    return stamp(datetime.now(timezone.utc) - timedelta(days=days))


class Clock:
    """Time that moves only when the run sleeps."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


class Archive:
    """The Wayback Machine, stood in: the copies it holds of each page, and what a save
    answers (a queue of answers by page, else a new copy)."""

    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.copies: dict[str, list[str]] = {}
        self.looks: list[str] = []
        self.saves: list[tuple[str, float]] = []
        self.answers: dict[str, list] = {}
        self.agents: set[str] = set()
        #: What each page's copy holds when read back raw (`id_`), and the pages read so.
        self.pages: dict[str, str] = {}
        self.reads: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.agents.add(request.headers.get("user-agent", ""))
        url = request.url
        if url.host == "archive.org" and url.path == "/wayback/available":
            page = url.params["url"]
            self.looks.append(page)
            held = self.copies.get(page)
            snapshots = {"closest": {"available": True, "status": "200", "timestamp": held[-1],
                                     "url": f"http://web.archive.org/web/{held[-1]}/{page}"}} if held else {}
            return httpx.Response(200, json={"url": page, "archived_snapshots": snapshots})
        if url.host == "web.archive.org" and url.raw_path.startswith(b"/save/"):
            page = url.raw_path.decode()[len("/save/"):]
            self.saves.append((page, self.clock.now))
            queued = self.answers.get(page)
            if queued:
                answer = queued.pop(0)
                answer = answer(page) if callable(answer) else answer
                if answer is not None:
                    return answer
            made = stamp(datetime.now(timezone.utc))
            self.copies.setdefault(page, []).append(made)
            return httpx.Response(302, headers={"Location": f"https://web.archive.org/web/{made}/{page}"})
        if url.host == "web.archive.org" and b"id_/" in url.raw_path:
            page = url.raw_path.decode().split("id_/", 1)[1]
            self.reads.append(page)
            held = self.pages.get(page)
            if held is None:
                return httpx.Response(404)
            return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=held)
        raise AssertionError(f"the run asked something else: {url}")

    def saved(self) -> list[str]:
        return [page for page, _ in self.saves]


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*_args, **_kwargs):
        raise AssertionError("something reached the network")

    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)


@pytest.fixture()
def archive(monkeypatch):
    clock = Clock()
    stand_in = Archive(clock)
    real = linkarchive.client
    monkeypatch.setattr(linkarchive, "client", lambda: real(httpx.MockTransport(lambda request: stand_in.handle(request))))
    monkeypatch.setattr(linkarchive, "_sleep", clock.sleep)
    monkeypatch.setattr(linkarchive, "_clock", clock.clock)
    monkeypatch.setattr(workqueue, "start_workers", False)
    return stand_in


@pytest.fixture()
def front(client, archive):
    """A case whose note links to four pages, a fifth in an internal passage; the case
    holds a bookmark of one of them."""
    cid = make_case(client, "Front")
    case = Case.open(cid)
    mark = case.add_entity("bookmark", "Port notice", {"url": NOTICE, "site": "port.example.org"}, by="user")
    note = make_note(client, cid, title="The fall of the Bab al-Mandab front, Sep-Nov", content=TEXT)
    return cid, case, note["id"], mark["id"]


def press(client, cid, note_id, **body):
    answer = client.post(f"/api/cases/{cid}/notes/{note_id}/archive", json=body)
    assert answer.status_code == 200, answer.text
    return answer.json()["run"]


def run_of(client, cid, note_id):
    return client.get(f"/api/cases/{cid}/notes/{note_id}/archive/run").json()["run"]


def bookmarks(case, folder=None):
    return [entity for entity in case.list_entities() if entity["type"] == "bookmark"
            and (folder is None or (entity.get("attrs") or {}).get("folder") == folder)]


def unarchived(client, cid, note_id):
    """The check before export's count of links with no archived copy, 0 when it says none."""
    client.put(f"/api/cases/{cid}/notes/{note_id}/look", json={"style": "report"})
    answer = client.post(f"/api/cases/{cid}/notes/pdf/check", json={"notes": [note_id], "edition": "public"})
    assert answer.status_code == 200, answer.text
    for warning in answer.json()["notes"][0]["warnings"]:
        if warning["kind"] == "unarchived":
            return len(warning.get("items") or [warning])
    return 0


# -- what a press would do ------------------------------------------------------------


def test_the_plan_lists_the_public_links_and_says_what_a_press_would_do(client, front):
    cid, _, note_id, _ = front
    plan = client.get(f"/api/cases/{cid}/notes/{note_id}/archive").json()
    assert [link["url"] for link in plan["links"]] == [JAZEERA, BBC, REUTERS, NOTICE]
    assert [link["text"] for link in plan["links"]] == ["Al Jazeera, 10 Sep", "BBC, 5 Oct", "Reuters", "the notice"]
    assert plan | {"links": None, "run": None} == {
        "links": None, "run": None, "total": 4, "todo": 4, "titles": 0, "archived": 0, "filed": 3, "more_internal": 1,
        "folder": FOLDER, "max": linkarchive.MAX_LINKS,
    }
    inside = client.get(f"/api/cases/{cid}/notes/{note_id}/archive", params={"internal": True}).json()
    assert [link["url"] for link in inside["links"]][-1] == TEAM
    assert inside["todo"] == 5 and inside["more_internal"] == 0


def test_the_folder_is_named_after_the_note_within_a_folders_length():
    assert linkarchive.folder_name("Port") == "Links of “Port”"
    assert linkarchive.folder_name("The fall of the Bab al-Mandab front, Sep-Nov") == FOLDER
    long = linkarchive.folder_name("Sanaa / Hodeidah: the whole coastline, week by week")
    assert len(long) <= 40 and "/" not in long and long.endswith("…”")
    assert linkarchive.folder_name("   ") == "Links of “Note”"


def test_links_to_the_cases_own_work_are_left_out(client, archive):
    cid = make_case(client, "Own")
    note = make_note(client, cid, title="Own", content=(
        f"[copy](https://web.archive.org/web/20260101000000/{JAZEERA}) "
        "[viewer](https://livingatlas.arcgis.com/wayback/#active=1) "
        f"[page]({JAZEERA})\n"))
    plan = client.get(f"/api/cases/{cid}/notes/{note['id']}/archive").json()
    assert [link["url"] for link in plan["links"]] == [JAZEERA]


# -- the press --------------------------------------------------------------------------


def test_a_recent_copy_is_reused_and_the_rest_saved_each_kept_on_its_item(client, front, archive):
    cid, case, note_id, mark = front
    archive.copies[JAZEERA] = [ago(5)]  # recent: reused
    archive.copies[BBC] = [ago(60)]  # too old: a new copy
    assert unarchived(client, cid, note_id) == 4

    queued = press(client, cid, note_id)
    assert queued["state"] == "queued" and queued["counts"]["total"] == 4
    assert archive.looks == [] and archive.saves == []  # nothing before the queue runs it
    workqueue.drain(case)

    run = run_of(client, cid, note_id)
    assert run["state"] == "done"
    assert [link["state"] for link in run["links"]] == ["kept", "new", "new", "new"]
    assert run["counts"] == {"total": 4, "archived": 4, "new": 3, "kept": 1, "older": 0, "failed": 0}
    assert archive.looks == [JAZEERA, BBC, REUTERS, NOTICE]
    assert archive.saved() == [BBC, REUTERS, NOTICE]
    assert archive.agents == {linkarchive.USER_AGENT}
    assert run["links"][0]["copy"] == f"https://web.archive.org/web/{archive.copies[JAZEERA][0]}/{JAZEERA}"

    # the bookmark the case held keeps the copy; the three it lacked are filed in the note's folder
    held = case.get_entity(mark)["attrs"]
    assert held["archive_url"].startswith("https://web.archive.org/web/") and held["archive_url"].endswith(NOTICE)
    assert "folder" not in held and "fetched_at" not in held
    filed = {entity["attrs"]["url"]: entity for entity in bookmarks(case, FOLDER)}
    assert set(filed) == {JAZEERA, BBC, REUTERS}
    assert filed[JAZEERA]["label"] == "Al Jazeera, 10 Sep"
    assert filed[JAZEERA]["attrs"]["archived_at"] == datetime.strptime(
        archive.copies[JAZEERA][0], "%Y%m%d%H%M%S").strftime("%Y-%m-%dT%H:%M:%SZ")
    assert all(entity["attrs"]["fetched_at"] for entity in filed.values())
    assert FOLDER in case.list_folders()

    # the note prints each copy and the day it was read, and the check counts none
    reader = notesources.Reader(case)
    source = reader.link(BBC, "BBC, 5 Oct")
    assert source.archive == filed[BBC]["attrs"]["archive_url"]
    assert source.archived == source.collected == datetime.now(timezone.utc).date().isoformat()
    assert unarchived(client, cid, note_id) == 0
    # the note itself is never rewritten
    assert case.read_note(note_id) == TEXT


def test_the_saves_are_spaced_and_one_at_a_time(client, front, archive):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    workqueue.drain(case)
    times = [at for _, at in archive.saves]
    assert len(times) == 4
    assert all(later - earlier >= linkarchive.SAVE_GAP for earlier, later in zip(times, times[1:]))


def test_fresh_copies_are_made_even_where_a_recent_one_exists(client, front, archive):
    cid, case, note_id, _ = front
    archive.copies[JAZEERA] = [ago(2)]
    press(client, cid, note_id, fresh=True)
    workqueue.drain(case)
    run = run_of(client, cid, note_id)
    assert run["fresh"] is True
    assert [link["state"] for link in run["links"]] == ["new"] * 4
    assert JAZEERA in archive.saved()


def test_a_429_waits_as_long_as_asked_then_goes_on(client, front, archive):
    cid, case, note_id, _ = front
    archive.answers[JAZEERA] = [httpx.Response(429, headers={"Retry-After": "45"})]
    press(client, cid, note_id)
    workqueue.drain(case)
    assert archive.saved()[:2] == [JAZEERA, JAZEERA]
    (first, at_first), (_, at_again) = archive.saves[:2]
    assert at_again - at_first >= 45
    assert run_of(client, cid, note_id)["counts"]["archived"] == 4


def test_a_429_without_a_word_waits_longer_each_time_then_stops_the_run(client, front, archive):
    cid, case, note_id, _ = front
    archive.answers[BBC] = [httpx.Response(429)] * (len(linkarchive.BUSY_WAITS) + 1)
    press(client, cid, note_id)
    workqueue.drain(case)
    run = run_of(client, cid, note_id)
    assert run["state"] == "stopped" and run["reason"] == linkarchive.BUSY
    # what was done is kept, the rest waits for the next press
    assert [link["state"] for link in run["links"]] == ["new", "waiting", "waiting", "waiting"]
    tries = [at for page, at in archive.saves if page == BBC]
    gaps = [later - earlier for earlier, later in zip(tries, tries[1:])]
    assert gaps == sorted(gaps) and gaps[0] >= linkarchive.BUSY_WAITS[0]
    assert archive.saved().count(REUTERS) == 0


def test_a_page_that_no_longer_answers_links_its_older_copy_and_one_with_none_fails(client, front, archive):
    cid, case, note_id, _ = front
    archive.copies[BBC] = [ago(400)]
    archive.answers[BBC] = [httpx.Response(520, headers={"X-Archive-Wayback-Runtime-Error": "LiveDocumentNotAvailable"})]
    archive.answers[REUTERS] = [httpx.Response(404)]
    archive.answers[NOTICE] = [httpx.Response(403)]
    press(client, cid, note_id)
    workqueue.drain(case)
    run = run_of(client, cid, note_id)
    assert run["state"] == "done"
    jazeera, bbc, reuters, notice = run["links"]
    assert jazeera["state"] == "new"
    assert bbc["state"] == "older" and bbc["gone"] is True and bbc["copy"].endswith(BBC)
    assert reuters == {"url": REUTERS, "text": "Reuters", "state": "failed", "reason": "The page no longer answers.",
                       "gone": True}
    assert notice["state"] == "failed" and notice["reason"] == "The Internet Archive does not save this page."
    assert run["counts"] | {"total": 0} == {"total": 0, "archived": 2, "new": 1, "kept": 0, "older": 1, "failed": 2}
    # an older copy only: filed, but nobody read the page that day
    gone = next(entity for entity in bookmarks(case) if entity["attrs"]["url"] == BBC)
    assert "fetched_at" not in gone["attrs"] and gone["attrs"]["archive_url"].endswith(BBC)
    # nothing filed for a link that got no copy
    assert REUTERS not in {entity["attrs"]["url"] for entity in bookmarks(case)}
    assert unarchived(client, cid, note_id) == 2

    # the next press tries the two that failed, and only those
    archive.saves.clear()
    archive.looks.clear()
    again = press(client, cid, note_id)
    assert [link["url"] for link in again["links"]] == [REUTERS, NOTICE]
    workqueue.drain(case)
    assert archive.saved() == [REUTERS, NOTICE]
    assert run_of(client, cid, note_id)["counts"]["archived"] == 2
    assert unarchived(client, cid, note_id) == 0


def test_offline_stops_at_once_and_keeps_what_it_did(client, front, archive):
    cid, case, note_id, _ = front
    original = archive.handle

    def cut(request):
        if archive.saves:
            raise httpx.ConnectError("no route to host")
        return original(request)

    archive.handle = cut  # type: ignore[method-assign]
    press(client, cid, note_id)
    workqueue.drain(case)
    run = run_of(client, cid, note_id)
    assert run["state"] == "stopped" and run["reason"] == linkarchive.OFFLINE
    assert [link["state"] for link in run["links"]] == ["new", "waiting", "waiting", "waiting"]
    assert unarchived(client, cid, note_id) == 3


def test_stop_is_heard_after_the_link_under_way(client, front, archive):
    cid, case, note_id, _ = front

    def stop_while_saving(page):
        assert client.post(f"/api/cases/{cid}/notes/{note_id}/archive/stop").json()["run"]["state"] == "stopping"
        return None  # the save under way still lands

    archive.answers[JAZEERA] = [stop_while_saving]
    press(client, cid, note_id)
    workqueue.drain(case)
    run = run_of(client, cid, note_id)
    assert run["state"] == "stopped" and run["reason"] == linkarchive.HALTED
    assert [link["state"] for link in run["links"]] == ["new", "waiting", "waiting", "waiting"]
    assert archive.saved() == [JAZEERA]


def test_stop_before_the_queue_takes_it_reaches_nothing(client, front, archive):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    stopped = client.post(f"/api/cases/{cid}/notes/{note_id}/archive/stop").json()["run"]
    assert stopped["state"] == "stopped"
    workqueue.drain(case)
    assert archive.looks == [] and archive.saves == []
    assert all(job["state"] == "cancelled" for job in case.list_jobs(kind=linkarchive.JOB))


def test_a_second_press_while_one_runs_is_refused(client, front, archive):
    cid, _, note_id, _ = front
    press(client, cid, note_id)
    again = client.post(f"/api/cases/{cid}/notes/{note_id}/archive", json={})
    assert again.status_code == 409
    assert again.json()["detail"] == "The links of this note are being archived already."


def test_a_note_with_every_link_archived_has_nothing_to_press(client, archive):
    cid = make_case(client, "Done")
    note = make_note(client, cid, title="Done", content="No links here.\n")
    answer = client.post(f"/api/cases/{cid}/notes/{note['id']}/archive", json={})
    assert answer.status_code == 409 and answer.json()["detail"] == "Every link of this note has an archived copy."


class Crash(BaseException):
    """Azimut dying mid-save: nothing in the run catches it."""


def test_a_run_cut_by_a_restart_waits_for_a_press_and_never_saves_a_page_twice(client, front, archive, monkeypatch):
    cid, case, note_id, _ = front

    def die_after_saving(page):
        made = stamp(datetime.now(timezone.utc))
        archive.copies.setdefault(page, []).append(made)  # the archive made it; Azimut never heard
        raise Crash()

    archive.answers[BBC] = [die_after_saving]
    press(client, cid, note_id)
    with pytest.raises(Crash):
        workqueue.drain(case)
    assert run_of(client, cid, note_id)["links"][1]["state"] == "saving"

    # Azimut starts again: the run is put back on the queue and settled without a request
    monkeypatch.setattr(linkarchive, "BOOT", "another-process")
    archive.looks.clear()
    saves = len(archive.saves)
    workqueue.recover_all()
    workqueue.drain(Case.open(cid))
    assert archive.looks == [] and len(archive.saves) == saves
    stopped = run_of(client, cid, note_id)
    assert stopped["state"] == "stopped" and stopped["reason"] == linkarchive.CLOSED
    assert [link["state"] for link in stopped["links"]] == ["new", "waiting", "waiting", "waiting"]

    # the next press goes on: the copy made before the cut is found, not made again
    again = press(client, cid, note_id)
    assert [link["url"] for link in again["links"]] == [BBC, REUTERS, NOTICE]
    workqueue.drain(Case.open(cid))
    assert archive.saved().count(BBC) == 1
    assert [link["state"] for link in run_of(client, cid, note_id)["links"]] == ["kept", "new", "new"]


def test_internal_passages_stay_out_unless_ticked(client, front, archive):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    workqueue.drain(case)
    assert TEAM not in archive.saved() and TEAM not in archive.looks
    inside = press(client, cid, note_id, internal=True)
    assert [link["url"] for link in inside["links"]] == [TEAM]
    workqueue.drain(case)
    assert archive.saved()[-1] == TEAM


def test_the_case_notes_keep_their_run_in_the_case_settings(client, archive):
    cid = make_case(client, "Case notes")
    client.put(f"/api/cases/{cid}/notes", json={"text": f"[a]({JAZEERA})\n"})
    press(client, cid, CASE_NOTE)
    case = Case.open(cid)
    workqueue.drain(case)
    assert run_of(client, cid, CASE_NOTE)["state"] == "done"
    assert case.get_setting(linkarchive.CASE_RECORD)
    assert bookmarks(case, "Links of “Case notes”")


# -- the other side: nothing reaches the network without the press ----------------------


def test_reading_the_plan_the_run_the_note_and_the_check_reaches_nothing(client, front, archive):
    cid, case, note_id, _ = front
    for path in ("archive", "archive/run", ""):
        assert client.get(f"/api/cases/{cid}/notes/{note_id}/{path}".rstrip("/")).status_code == 200
    assert unarchived(client, cid, note_id) == 4
    assert client.get(f"/api/cases/{cid}/sources/lookup", params={"url": JAZEERA}).status_code == 200
    workqueue.drain(case)
    assert archive.looks == [] and archive.saves == []


def test_starting_azimut_reaches_nothing_and_says_the_run_stopped(client, front, archive, monkeypatch):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    monkeypatch.setattr(linkarchive, "BOOT", "a-later-start")
    workqueue.recover_all()
    workqueue.drain(case)
    assert archive.looks == [] and archive.saves == []
    run = run_of(client, cid, note_id)
    assert run["state"] == "stopped" and run["reason"] == linkarchive.CLOSED


# -- the client's reading of the archive's answers ------------------------------------


@pytest.mark.parametrize("response", [
    httpx.Response(302, headers={"Location": f"https://web.archive.org/web/20261118093012/{BBC}"}),
    httpx.Response(200, headers={"Content-Location": f"/web/20261118093012/{BBC}"}),
    httpx.Response(200, headers={"Link": f'<{BBC}>; rel="original", <https://web.archive.org/web/20261118093012/{BBC}>; '
                                         'rel="memento"; datetime="Wed, 18 Nov 2026 09:30:12 GMT"'}),
    httpx.Response(200, text=f'<a href="https://web.archive.org/web/20261118093012/{BBC}">saved</a>'),
])
def test_a_save_is_read_off_its_redirect_its_headers_or_its_page(response):
    copy = linkarchive._saved(response, BBC)
    assert copy is not None
    assert copy.address == f"https://web.archive.org/web/20261118093012/{BBC}"
    assert copy.stamp == "2026-11-18T09:30:12Z"


def test_an_answer_that_points_elsewhere_is_no_copy():
    assert linkarchive._saved(httpx.Response(302, headers={"Location": "https://example.org/login"}), BBC) is None
    assert linkarchive._saved(httpx.Response(200, text="busy"), BBC) is None


def test_a_lookup_that_times_out_is_no_copy_and_the_save_goes_on():
    clock = Clock()

    def handle(request):
        if request.url.host == "archive.org":
            raise httpx.ReadTimeout("slow")
        return httpx.Response(302, headers={"Location": f"https://web.archive.org/web/20261118093012/{BBC}"})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wayback = linkarchive.Wayback(http, sleep=clock.sleep, clock=clock.clock)
        assert wayback.newest(BBC) is None
        assert wayback.save(BBC).stamp == "2026-11-18T09:30:12Z"


# -- the rules every case state answers to ------------------------------------------------


def test_a_filed_bookmark_is_used_by_the_note_that_links_it(client, front, archive):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    workqueue.drain(case)
    filed = {entity["id"] for entity in bookmarks(case, FOLDER)}
    assert len(filed) == 3
    assert filed <= uses.used_refs(case)


def test_the_run_and_its_bookmarks_travel_in_a_bundle(client, front, archive):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    workqueue.drain(case)
    exported = bundles.export_case(case)
    landed = Case.open(bundles.import_into(Case.create(bundles.imported_name(case.id)), exported)["case_id"])
    copied = {entity["attrs"]["url"]: entity["attrs"] for entity in bookmarks(landed)}
    assert copied[JAZEERA]["archive_url"] and copied[JAZEERA]["folder"].startswith("Links of")
    assert linkarchive.view(landed, note_id)["state"] == "done"


def test_a_running_record_carried_without_its_job_says_it_stopped(client, front, archive):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    for job in case.list_jobs(kind=linkarchive.JOB):
        case.cancel_job(job["id"])  # a bundle carries no job
    run = run_of(client, cid, note_id)
    assert run["state"] == "stopped" and run["reason"] == linkarchive.ENDED
    # and a press starts it again
    assert press(client, cid, note_id)["state"] == "queued"


def test_the_run_goes_to_the_trash_with_its_note_and_comes_back(client, front, archive):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    workqueue.drain(case)
    group = client.delete(f"/api/cases/{cid}/entities/{note_id}").json()["trash"]
    assert client.get(f"/api/cases/{cid}/notes/{note_id}/archive/run").status_code == 404
    assert client.post(f"/api/cases/{cid}/trash/{group}/restore").status_code == 200
    assert run_of(client, cid, note_id)["state"] == "done"


def test_spec_records_the_two_hosts_and_the_accepted_risk():
    spec = (Path(__file__).resolve().parents[1] / "docs" / "SPEC.md").read_text(encoding="utf-8")
    posture = spec[spec.index("## 9."):spec.index("## 10.")]
    assert "Archive every link" in posture
    assert "archive.org/wayback/available" in posture and "web.archive.org/save" in posture
    assert "the Internet Archive learns" in posture


# -- the page's own title, read back from its copy --------------------------------------

PAGE = """<html><head><title>Houthis take Mocha port | Al Jazeera</title>
<meta property="article:published_time" content="2026-09-10T08:02:00Z"></head><body>…</body></html>"""
POST = "https://x.com/port_watch/status/2108508784049926499"


def test_each_page_is_named_by_the_title_and_day_its_copy_states(client, front, archive):
    cid, case, note_id, mark = front
    archive.pages[JAZEERA] = PAGE
    archive.pages[NOTICE] = '<meta property="og:title" content="Notice to mariners: the strait is closed">'
    press(client, cid, note_id)
    workqueue.drain(case)
    filed = {entity["attrs"]["url"]: entity for entity in bookmarks(case, FOLDER)}
    # read back raw from the archive, never from the page's own site
    assert set(archive.reads) == {JAZEERA, BBC, REUTERS, NOTICE}
    assert filed[JAZEERA]["label"] == "Houthis take Mocha port"
    assert filed[JAZEERA]["attrs"][notesources.PAGE_TITLE] == "Houthis take Mocha port"
    assert filed[JAZEERA]["attrs"][notesources.PUBLISHED_AT] == "2026-09-10"
    # a copy that says nothing keeps the link's words, and is not read again
    assert filed[BBC]["label"] == "BBC, 5 Oct" and notesources.PAGE_TITLE not in filed[BBC]["attrs"]
    # a bookmark someone filed keeps its name and gains its page's title
    held = case.get_entity(mark)
    assert held["label"] == "Port notice"
    assert held["attrs"][notesources.PAGE_TITLE] == "Notice to mariners: the strait is closed"
    source = notesources.Reader(case).link(JAZEERA, "Al Jazeera, 10 Sep")
    assert (source.title, source.published) == ("Houthis take Mocha port", "2026-09-10")
    plan = client.get(f"/api/cases/{cid}/notes/{note_id}/archive").json()
    assert plan["todo"] == 0 and plan["titles"] == 0


def test_links_archived_before_still_get_their_titles_read_once(client, front, archive):
    cid, case, note_id, _ = front
    press(client, cid, note_id)
    workqueue.drain(case)
    # the four were archived before titles were read: their bookmarks say none was looked for
    for entity in bookmarks(case):
        attrs = {key: value for key, value in entity["attrs"].items() if key != linkarchive.TITLE_TRIED}
        case.update_entity(entity["id"], {"attrs": {**attrs, linkarchive.TITLE_TRIED: None}})
    archive.reads.clear()
    archive.pages[REUTERS] = "<title>Front lines shift north - Reuters</title>"
    plan = client.get(f"/api/cases/{cid}/notes/{note_id}/archive").json()
    assert plan["todo"] == 0 and plan["titles"] == 3  # the user's bookmark took its own name as its title
    run = press(client, cid, note_id)
    assert run["counts"]["total"] == 3
    saves = len(archive.saves)
    workqueue.drain(case)
    assert len(archive.saves) == saves  # nothing saved again, only read
    filed = {entity["attrs"]["url"]: entity for entity in bookmarks(case, FOLDER)}
    assert filed[REUTERS]["label"] == "Front lines shift north"
    assert client.get(f"/api/cases/{cid}/notes/{note_id}/archive").json()["titles"] == 0
    answer = client.post(f"/api/cases/{cid}/notes/{note_id}/archive", json={})
    assert answer.status_code == 409


def test_a_post_on_a_walled_site_is_cited_by_account_and_day_not_read(client, archive):
    cid = make_case(client, "Walled")
    case = Case.open(cid)
    note = make_note(client, cid, title="Walled", content=f"[his post]({POST}) and [Al Jazeera]({JAZEERA}).\n")
    archive.pages[POST] = "<title>X</title>"
    archive.pages[JAZEERA] = PAGE
    press(client, cid, note["id"])
    workqueue.drain(case)
    assert archive.reads == [JAZEERA]
    plan = client.get(f"/api/cases/{cid}/notes/{note['id']}/archive").json()
    assert plan["titles"] == 0


@pytest.mark.parametrize("page_html, url, said", [
    (PAGE, JAZEERA, ("Houthis take Mocha port", "2026-09-10")),
    ('<meta property="og:title" content="Strait cleared, says envoy">'
     '<script type="application/ld+json">{"datePublished": "2026-10-09T12:00:00+03:00"}</script>',
     "https://english.aawsat.com/node/5327743", ("Strait cleared, says envoy", "2026-10-09")),
    ("<title>Yemen: forces retreat — Al-Monitor</title>", "https://www.al-monitor.com/a", ("Yemen: forces retreat", "")),
    ('<meta name="pubdate" content="1803-01-01"><title>Old &amp; new</title>', "https://e.org/a", ("Old & new", "")),
])
def test_a_page_states_its_title_and_day_in_its_tags(page_html, url, said):
    facts = linkarchive.page_facts(page_html, url)
    assert facts is not None and (facts.title, facts.day) == said


@pytest.mark.parametrize("page_html", ["<title>Just a moment...</title>", "<title>Access denied</title>",
                                       "<title>Al Jazeera</title>", "<p>no head</p>"])
def test_a_wall_or_a_bare_site_name_is_no_title(page_html):
    assert linkarchive.page_facts(page_html, JAZEERA) is None
