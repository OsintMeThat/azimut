"""An article's own author, and their picture: kept in the note's look, signed on its web page, named
on its card, in the site's lists and in the read of the site (`engine/notes_web.py`, `engine/site.py`).

A note written by someone else (a guest's investigation imported from their bundle) is published under
their name; a note with no author of its own is the analyst's, as Settings › Publishing names them.
"""

from __future__ import annotations

import io
import json
from typing import Any

import pytest
from PIL import Image
from pydantic import ValidationError

from azimut.engine import githubpages, notelook, notes_web, site, sitesync
from azimut.workspace import Case

from ambushfixture import _image
from githubfake import FakeGitHub
from notecase import make_case, make_note
from test_site_publish import DAY, _card, _connect

READ = "/api/publishing/github/site/read"
GUEST = "Jane Guest"


@pytest.fixture()
def fake(monkeypatch):
    stand_in = FakeGitHub()
    real = githubpages.client
    monkeypatch.setattr(githubpages, "client", lambda transport=None: real(stand_in.transport()))
    monkeypatch.setattr(githubpages.time, "sleep", lambda seconds: None)
    monkeypatch.setattr("azimut.api.notes._now", lambda: DAY.astimezone())
    return stand_in


@pytest.fixture(autouse=True)
def an_empty_memory():
    sitesync._kept.clear()
    sitesync._plain.clear()
    sitesync._weight = 0


def _guest_note(client, *, picture: Image.Image | None = None, exif: bool = False) -> dict[str, Any]:
    """A note with a picture of its author in the case: a JPEG carrying a place, a camera, an author and a
    comment when ``exif`` asks, so what the folder publishes can be checked for them."""
    cid = make_case(client, "Guest case")
    case = Case.open(cid)
    face = _image(case, "Face", picture or Image.new("RGB", (400, 300), (200, 40, 40)), {"type": "clipboard"})
    if exif:
        tagged = Image.new("RGB", (400, 300), (200, 40, 40))
        tags = tagged.getexif()
        tags[0x010F] = "SecretCam"  # Make
        tags[0x013B] = "Secret Person"  # Artist
        tags[0x8825] = {1: "N", 2: (12.0, 43.0, 30.0)}  # GPS
        target = case.resolve_inside("media/face.jpg")
        tagged.save(target, "JPEG", exif=tags, comment=b"secret comment")
        case.update_entity(face["id"], {"attrs": {"path": "media/face.jpg"}})
    note = make_note(client, cid, title="Guest story", content="## What was seen\n\nSmoke over the pier.\n")
    url = f"/api/cases/{cid}/notes/{note['id']}"
    return {"cid": cid, "note": note["id"], "url": url, "face": face["id"], "case": case}


def _look(client, note: dict[str, Any]) -> dict[str, Any]:
    return client.get(f"{note['url']}/look").json()["look"]


def _publish(client, note: dict[str, Any], **more: Any) -> dict[str, Any]:
    answer = client.post(f"{note['url']}/github", json={"short_name": "guest-story", **more})
    assert answer.status_code == 200, answer.text
    return answer.json()


def _set(client, note: dict[str, Any], **keys: Any) -> None:
    saved = client.put(f"{note['url']}/look", json={**_look(client, note), **keys})
    assert saved.status_code == 200, saved.text


# -- the round trip --------------------------------------------------------------------------------------------


def test_a_guest_author_and_picture_go_from_the_look_to_the_page_the_card_the_list_and_the_read(client, fake):
    fake.make_repo()
    _connect(client)
    client.put("/api/settings/prefs", json={"report_name": "A. Analyst", "report_role": "Editor",
                                            "report_organisation": "Desk", "site_title": "The Desk"})
    note = _guest_note(client, exif=True)
    _set(client, note, author=f"  {GUEST}\n ", author_image=note["face"])
    assert (_look(client, note)["author"], _look(client, note)["author_image"]) == (GUEST, note["face"])
    _publish(client, note)
    files = fake.files()

    card = _card(files, "guest-story")
    assert card["author"] == GUEST and card["author_image"] == "author.jpg"
    [line] = json.loads(files["articles.json"])["articles"]
    assert line["author"] == GUEST and line["author_image"] == "/guest-story/author.jpg"
    # the page is signed by the guest alone: never the analyst's name, role or organisation
    page = files["guest-story/index.html"].decode()
    assert f'<img class="az-face" src="author.jpg" alt="" width="40" height="40">By {GUEST}</p>' in page
    assert "A. Analyst" not in page and "Editor" not in page and "Desk ·" not in page
    # the list names the guest, the picture before the name
    home = files["index.html"].decode()
    assert f'src="/articles/guest-story/author.jpg" alt="" width="20" height="20" loading="lazy" decoding="async">{GUEST}' in home
    # the read of the site carries both, the picture whole as the site serves it
    [item] = client.post(READ).json()["items"]
    assert item["author"] == GUEST and item["author_image"] == "https://octo.github.io/articles/guest-story/author.jpg"

    # a republish that says nothing of the author keeps it
    _publish(client, note)
    assert _card(fake.files(), "guest-story")["author"] == GUEST


def test_the_author_picture_is_a_small_square_made_again_with_nothing_but_its_pixels(client, fake):
    fake.make_repo()
    _connect(client)
    note = _guest_note(client, exif=True)
    _set(client, note, author=GUEST, author_image=note["face"])
    _publish(client, note)
    data = fake.files()["guest-story/author.jpg"]
    picture = Image.open(io.BytesIO(data))
    assert picture.format == "JPEG" and picture.size == (notes_web.AUTHOR_FACE_SIDE, notes_web.AUTHOR_FACE_SIDE)
    assert not picture.getexif() and "comment" not in picture.info and "exif" not in picture.info
    assert b"SecretCam" not in data and b"Secret Person" not in data and b"secret comment" not in data


def test_a_picture_with_transparency_stays_a_png():
    cid = Case.create("Clear").id
    case = Case.open(cid)
    face = _image(case, "Clear", Image.new("RGBA", (200, 200), (10, 20, 30, 0)), {"type": "clipboard"})
    name, data = notes_web.author_face(case, face["id"]) or ("", b"")
    assert name == "author.png" and Image.open(io.BytesIO(data)).mode == "RGBA"
    assert Image.open(io.BytesIO(data)).size == (96, 96)


# -- the default, emptying, refusals ------------------------------------------------------------------------------


def test_a_note_with_no_author_of_its_own_is_the_sites_and_carries_no_picture(client, fake):
    fake.make_repo()
    _connect(client)
    client.put("/api/settings/prefs", json={"report_name": "A. Analyst"})
    note = _guest_note(client)
    _publish(client, note)
    files = fake.files()
    card = _card(files, "guest-story")
    assert card["author"] == "A. Analyst" and "author_image" not in card
    assert "author_image" not in files["articles.json"].decode()
    assert "guest-story/author.jpg" not in files and "az-face" not in files["guest-story/index.html"].decode()
    assert "author_image" not in client.post(READ).json()["items"][0]


def test_emptying_the_author_goes_back_to_the_default_and_takes_the_picture_off(client, fake):
    fake.make_repo()
    _connect(client)
    client.put("/api/settings/prefs", json={"report_name": "A. Analyst"})
    note = _guest_note(client)
    _set(client, note, author=GUEST, author_image=note["face"])
    _publish(client, note)
    assert "guest-story/author.jpg" in fake.files()
    _set(client, note, author="", author_image="")
    assert not {"author", "author_image"} & set(_look(client, note))
    _publish(client, note)
    files = fake.files()
    assert _card(files, "guest-story")["author"] == "A. Analyst"
    assert "guest-story/author.jpg" not in files and GUEST not in files["guest-story/index.html"].decode()


def test_an_author_past_one_line_of_120_or_a_picture_that_is_none_of_the_case_is_refused(client):
    note = _guest_note(client)
    route = f"{note['url']}/look"
    assert client.put(route, json={"author": "x" * 121}).status_code == 422
    assert client.put(route, json={"author_image": "nope"}).status_code == 422
    assert client.put(route, json={"author_image": "../../etc"}).status_code == 422
    assert client.put(route, json={"author": "x" * 120}).status_code == 200
    assert notelook.NoteLook.model_validate({"author": "Jane \n  Guest"}).author == "Jane Guest"


def test_a_template_carries_no_author_and_no_picture():
    for keys in ({"author": GUEST}, {"author_image": "abc"}):
        with pytest.raises(ValidationError):
            notelook.TemplateLook.model_validate(keys)
    plain = notelook.NoteLook().model_dump(mode="json")
    assert not {"author", "author_image"} & set(plain)


def test_an_author_picture_gone_from_the_case_is_said_and_the_page_goes_without_it(client, fake):
    fake.make_repo()
    _connect(client)
    note = _guest_note(client)
    _set(client, note, author=GUEST, author_image=note["face"])
    note["case"].update_entity(note["face"], {"attrs": {"path": "media/missing.png"}})
    said = _publish(client, note)
    assert any(warning.endswith(notes_web.AUTHOR_IMAGE_GONE) for warning in said["warnings"])
    files = fake.files()
    assert "guest-story/author.jpg" not in files and "author_image" not in _card(files, "guest-story")
    assert f"By {GUEST}" in files["guest-story/index.html"].decode()


def test_the_author_picture_is_a_picture_the_note_shows(client):
    note = _guest_note(client)
    _set(client, note, author_image=note["face"])
    links = Case.open(note["cid"]).links_of(note["note"])
    assert {link["to"] for link in links if link["type"] == "derived-from"} == {note["face"]}


# -- the lists ---------------------------------------------------------------------------------------------------


def _line(author: str, face: str = "") -> dict[str, Any]:
    card = site.Card(title=f"By {author}", summary="", date="2026-11-21", author=author, author_image=face)
    return site.line_of(card, "story")


def test_a_guest_shows_in_the_lists_with_their_picture_and_the_sites_own_name_stays_hidden():
    guest, own = _line(GUEST, "author.png"), _line("The Desk", "author.png")
    listed = site.render([guest, own], "The Desk", prefix="/articles")
    assert '· <img class="az-face" src="/articles/story/author.png"' in listed and f">{GUEST}</p>" in listed
    assert listed.count("az-face") == 1 and "· The Desk" not in listed
    maps = site.render_maps([{**guest, "article": None}], "The Desk")
    assert f">{GUEST}</p>" in maps and "az-face" in maps


def test_a_card_naming_anything_but_its_own_picture_file_loses_the_picture_and_keeps_its_line():
    for face in ("../other/author.jpg", "https://example.org/a.jpg", "author.gif", "/author.jpg"):
        line = site.read_card("story", json.dumps({
            "format": "azimut-article/1", "title": "T", "date": "2026-01-01", "author": GUEST,
            "author_image": face}).encode())
        assert line is not None and "author_image" not in line and line["author"] == GUEST
