"""The example case: one press makes it from the bundle the app ships, offline, and it reads.

What it must hold to be worth opening: notes that print as a PDF and an HTML page with
nothing to warn about, each saying first that the story is invented, and pictures each
credited to the real photograph it is. `scripts/example_case.py` builds the bundle;
these read the bundle as shipped.
"""

from __future__ import annotations

import json
import re
import socket
import zipfile
from pathlib import Path

import pytest

from azimut.engine import examplecase
from jobwait import WAIT

FICTIONAL = "> [!note] Fictional example."
#: Where the notes the bundle holds are written, before `scripts/example_case.py` builds it.
SOURCES = Path(__file__).resolve().parents[1] / "scripts" / "example_notes"
#: The ceiling the shipped bundle answers to: a few MB, the price of real photographs.
MOST_BYTES = 5_000_000


@pytest.fixture()
def no_network(monkeypatch):
    """Every connection out refused and counted: the case is made from the disk alone."""
    tried: list[object] = []

    def refuse(*args, **kwargs):
        tried.append(args)
        raise OSError("the example case reached for the network")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    return tried


def _made(client) -> dict:
    """Press it, and wait for the case to land as the browser does."""
    started = client.post("/api/cases/example", json={})
    assert started.status_code == 200, started.text
    answer = started.json()
    if answer["job_id"]:
        import time

        deadline = time.monotonic() + WAIT
        while True:
            job = client.get(f"/api/cases/{answer['case_id']}/bundle/jobs/{answer['job_id']}").json()
            if job["state"] in ("ready", "failed", "cancelled"):
                break
            assert time.monotonic() < deadline, job
            time.sleep(0.2)
        assert job["state"] == "ready", job
    return answer


def _notes(client, case_id: str) -> list[dict]:
    return [item for item in client.get(f"/api/cases/{case_id}/notes/index").json()["items"] if item["id"] != "case"]


def test_the_bundle_ships_small_with_its_credits():
    assert examplecase.BUNDLE.is_file()
    assert examplecase.BUNDLE.stat().st_size < MOST_BYTES
    credits = (examplecase.FOLDER / "CREDITS.md").read_text(encoding="utf-8")
    assert "fictional" in credits and "Public domain" in credits
    with zipfile.ZipFile(examplecase.BUNDLE) as bundle:
        pictures = [name for name in bundle.namelist() if name.endswith((".jpg", ".png")) and "/media/" in name]
    assert len(pictures) >= 20


def test_one_press_makes_it_offline_and_a_second_opens_it(client, no_network):
    answer = _made(client)
    assert answer["name"] == examplecase.NAME == "Example case (fictional)"
    assert no_network == []
    opened = client.get(f"/api/cases/{answer['case_id']}")
    assert opened.status_code == 200 and opened.json()["name"] == examplecase.NAME
    # pressed again, the same case opens and nothing is imported twice
    again = client.post("/api/cases/example", json={}).json()
    assert again == {"case_id": answer["case_id"], "name": examplecase.NAME, "job_id": None, "state": "ready"}
    assert [one["name"] for one in client.get("/api/cases").json()].count(examplecase.NAME) == 1


def test_every_note_says_it_is_fictional_and_prints_with_nothing_to_warn_about(client):
    case_id = _made(client)["case_id"]
    notes = _notes(client, case_id)
    assert len(notes) == 4
    for note in notes:
        text = client.get(f"/api/cases/{case_id}/notes/{note['id']}").json()["text"]
        # first, or second only under a brief's verdict, so a reader meets it before anything else
        assert FICTIONAL in "\n".join(text.split("\n")[:3]), note["title"]
        assert "{{" not in text, note["title"]
        for format_ in ("pdf", "html"):
            checked = client.post(f"/api/cases/{case_id}/notes/pdf/check", json={
                "notes": [note["id"]], "edition": "public", "format": format_, "ready": True})
            assert checked.status_code == 200, checked.text
            said = [warning for one in checked.json()["notes"] for warning in one["warnings"]]
            assert said == [], (note["title"], format_, said)
    case_notes = client.get(f"/api/cases/{case_id}/notes").json()["text"]
    assert "invented" in case_notes


def test_the_notes_show_what_a_report_can_hold(client):
    case_id = _made(client)["case_id"]
    texts = {note["title"]: client.get(f"/api/cases/{case_id}/notes/{note['id']}").json()["text"]
             for note in _notes(client, case_id)}
    every = "\n".join(texts.values())
    for block in ("::: map", ":::: infographic", "kind: pictures", "kind: timeline", "kind: key figures",
                  "kind: stacked bars", "```mermaid", "> [!limits]", "{search=always"):
        assert block in every, block
    # the keys the timeline and the wall answer to, written where they show
    assert "colour by: Kind" in every and "labels: short" in every
    assert "story: one group per step" in every
    # a story for the web, a report, a web article, a brief
    looks = [client.get(f"/api/cases/{case_id}/notes/{note['id']}/look").json()["look"] for note in _notes(client, case_id)]
    assert {look["style"] for look in looks} == {"article", "report", "brief"}
    assert any(look.get("web") == "story" for look in looks)


def test_every_picture_is_credited_to_the_photograph_it_is(client):
    case_id = _made(client)["case_id"]
    media = client.get(f"/api/cases/{case_id}/media").json()
    photos = [item for item in media if item["path"].endswith(".jpg")]
    assert len(photos) >= 20
    for item in photos:
        attrs = client.get(f"/api/cases/{case_id}/media/item", params={"path": item["path"]}).json()
        said = repr(attrs)
        assert "commons.wikimedia.org" in said, item["path"]
        assert "Public domain" in said or "public domain" in said, item["path"]


def test_its_html_page_reads_whole(client):
    case_id = _made(client)["case_id"]
    story = next(note for note in _notes(client, case_id) if note["title"].startswith("The night the sea"))
    page = client.post(f"/api/cases/{case_id}/notes/html/preview", json={
        "note": story["id"], "title": story["title"],
        "text": client.get(f"/api/cases/{case_id}/notes/{story['id']}").json()["text"]})
    assert page.status_code == 200, page.text[:300]
    html = page.text
    assert "Fictional example." in html
    # the wall and the map are there, and nothing is fetched by the page
    assert "az-wall" in html or "az-pictures" in html
    assert not re.search(r"<img[^>]+src=\"https?://", html)


def test_the_bundle_holds_the_notes_as_written_in_scripts(client):
    """A note changed in `scripts/example_notes/` and not built again would ship stale."""
    case_id = _made(client)["case_id"]
    held = {note["title"]: (note["id"], client.get(f"/api/cases/{case_id}/notes/{note['id']}").json()["text"])
            for note in _notes(client, case_id)}
    sources = sorted(SOURCES.glob("*.md"))
    assert len(sources) == len(held)
    for source in sources:
        text = source.read_text(encoding="utf-8")
        head, body = text.split("\n---\n", 1)
        fields = dict(line.split(": ", 1) for line in head.removeprefix("---\n").splitlines())
        assert fields["title"] in held, source.name
        note_id, written = held[fields["title"]]
        # what the build fills in (`{{name}}`) may be anything; every other character is as written
        pattern = "".join(re.escape(part) if index % 2 == 0 else r"[\s\S]*?"
                          for index, part in enumerate(re.split(r"\{\{[a-z0-9:-]+\}\}", body)))
        assert re.fullmatch(pattern, written), f"{source.name}: build the example case again"
        look = client.get(f"/api/cases/{case_id}/notes/{note_id}/look").json()["look"]
        for key, value in json.loads(fields["look"]).items():
            if isinstance(value, dict):
                assert {inner: look[key][inner] for inner in value} == value, (source.name, key)
            else:
                assert look[key] == value, (source.name, key)


def test_every_photograph_says_where_it_is_really_from_where_it_shows(client):
    """A story about an invented place, told in real photographs: each says it is an
    illustration, and of what, in its own caption, credit line or label, never only in
    its Details."""
    case_id = _made(client)["case_id"]
    texts = [client.get(f"/api/cases/{case_id}/notes/{note['id']}").json()["text"] for note in _notes(client, case_id)]
    every = "\n".join(texts)
    captions = re.findall(r"\[\[media:e_[0-9a-f]+\|[^\]]*\]\]\{[^}]*caption=\"([^\"]*)\"", every)
    assert len(captions) >= 9
    for caption in captions:
        assert "Illustration:" in caption and "public domain" in caption and "invented" in caption, caption
    shown = re.findall(r"\[\[media:e_[0-9a-f]+\|[^\]]*\]\](?!\{)", "\n".join(
        line for line in every.splitlines() if not line.startswith("|")))
    assert shown == [], shown
    walls = re.findall(r"^kind: pictures\n(?:[a-z ]+: .*\n)*?source: (.*)$", every, re.M)
    assert walls and all(line.startswith("Illustrations:") and "invented" in line for line in walls)
    # the ground under every map and the pair's two sides say what they are, where they show
    media = client.get(f"/api/cases/{case_id}/media").json()
    sidecars = [client.get(f"/api/cases/{case_id}/media/item", params={"path": item["path"]}).json() for item in media]
    ground = next(item for item in sidecars if (item.get("source") or {}).get("type") == "satellite")
    assert ground["source"]["attribution"].startswith("Imagery used as an illustration: NOAA aerial photograph")
    assert "imagery_date" not in ground["source"]
    pairs = [item for item in sidecars if (item.get("source") or {}).get("type") == "compare"]
    assert len(pairs) == 3
    for item in pairs:
        assert all("(illustration)" in said for said in item["source"]["providers"].values()), item["path"]
        # the real days the photographs were taken, never a day of the story
        assert all(item["source"].get(key, "2017")[:4] in ("2017", "2018") for key in ("imagery_a", "imagery_b"))
    # no landmark stands in for an invented one
    assert "lighthouse" not in every.lower()
