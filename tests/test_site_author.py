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
from pypdf import PdfReader

from azimut.engine import githubpages, notefill, notelook, notes_html, notes_pdf, notes_web, site, sitesync
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
    assert (f'<span class="az-author-logo"><img class="az-face" src="author.jpg" alt="" width="40" height="40"></span>'
            f'By {GUEST}</p>') in page
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
    assert picture.format == "JPEG" and picture.size == (notes_html.AUTHOR_FACE_SIDE, notes_html.AUTHOR_FACE_SIDE)
    assert not picture.getexif() and "comment" not in picture.info and "exif" not in picture.info
    assert b"SecretCam" not in data and b"Secret Person" not in data and b"secret comment" not in data


def test_a_picture_with_transparency_stays_a_png():
    cid = Case.create("Clear").id
    case = Case.open(cid)
    face = _image(case, "Clear", Image.new("RGBA", (200, 200), (10, 20, 30, 0)), {"type": "clipboard"})
    name, data = notes_html.author_face(case, face["id"]) or ("", b"")
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


# -- the author card: a guest's picture where the analyst's logo would stand, never the analyst's logo -----------

TEXT = "## What was seen\n\nSmoke over the pier.\n"
ALL_MARKS = {"on": True, "marks": ["azimut", "logo", "signature"]}


@pytest.fixture()
def analyst(tmp_path) -> notefill.Identity:
    def png(name: str, size: tuple[int, int]) -> Any:
        Image.new("RGB", size, (20, 20, 20)).save(tmp_path / name, "PNG")
        return tmp_path / name

    return notefill.Identity("Alex Doe", "Analyst", "Open Desk", logo=png("logo.png", (300, 300)),
                             signature=png("signature.png", (400, 120)))


def _web(identity: notefill.Identity, face: str = "", **look: Any) -> str:
    """A web page's body as the folder lays it out, the author's picture at ``face`` in it."""
    folder = notes_html.Folder(csp="", author_face=face)
    page = notes_html.render(None, title="Bridge", text=TEXT, identity=identity, folder=folder,
                             look=notelook.NoteLook.model_validate({"style": "article", **look})).html.decode()
    return page.split("</style>")[-1]


def test_a_guests_picture_stands_in_the_card_where_the_analysts_logo_would(analyst):
    guest = analyst.written_by(GUEST)
    body = _web(guest, "author.jpg", cover=ALL_MARKS)
    card = body[body.index('<div class="az-signed az-cover-signed az-author">'):]
    card = card[:card.index("</div>")]
    assert card.index('<span class="az-author-logo"><img class="az-face" src="author.jpg"') \
        < card.index(f'<span class="az-author-text"><span class="az-signer">{GUEST}</span>')
    # never the analyst's logo, signature, name or credentials by another's name; the Azimut mark stays
    assert "az-my-logo" not in body and "az-my-signature" not in body and "Alex Doe" not in body
    assert "Open Desk" not in body and 'class="az-logo"' in body
    # beside the byline, and in the card at the end, the same picture
    bylined = _web(guest, "author.jpg", signed="title", cover={"on": True, "marks": ["logo"]})
    assert '<p class="az-byline" dir="auto"><span class="az-author-logo"><img class="az-face" src="author.jpg"' in bylined
    assert "az-my-logo" not in bylined and '<p class="az-author-logo">' not in bylined
    ended = _web(guest, "author.jpg", signed="end")
    assert '<div class="az-signed az-signed-end az-author"><span class="az-author-logo"><img class="az-face"' in ended


def test_a_guest_with_no_picture_is_named_alone_and_a_picture_never_stands_alone(analyst):
    guest = analyst.written_by(GUEST)
    body = _web(guest, cover=ALL_MARKS)
    assert f'<div class="az-signed az-cover-signed"><span class="az-signer">{GUEST}</span></div>' in body
    assert "az-author-logo" not in body and "az-my-logo" not in body and "az-face" not in body
    bylined = _web(guest, signed="title", cover={"on": True, "marks": ["logo"]})
    assert f'<p class="az-byline" dir="auto">By {GUEST}</p>' in bylined and "az-my-logo" not in bylined
    # with no name beside it under the date, the picture does not stand there by itself
    unsigned = _web(guest, "author.jpg", cover={"on": True, "marks": ["logo"]})
    assert "az-face" not in unsigned and "az-my-logo" not in unsigned


def test_with_no_guest_the_card_is_the_analysts_whatever_picture_the_folder_holds(analyst):
    body = _web(analyst, "author.jpg", cover=ALL_MARKS)
    assert '<div class="az-signed az-cover-signed az-author"><span class="az-author-logo"><img class="az-my-logo"' in body
    assert '<span class="az-signer">Alex Doe</span>' in body and "az-face" not in body


def test_the_html_report_and_the_pdf_sign_the_guest(analyst):
    look = notelook.NoteLook.model_validate({"style": "report", "author": GUEST, "signed": "title", "cover": ALL_MARKS})
    report = notes_html.render(None, title="Bridge", text=TEXT, identity=analyst, look=look).html.decode()
    body = report.split("</style>")[-1]
    # every export is signed by the look's author (`notefill.signing`), never the analyst
    assert f"By {GUEST}" in body and "Alex Doe" not in report and "Open Desk" not in report
    assert "az-my-logo" not in body
    printed = notes_pdf.render(None, title="Bridge", text=TEXT, identity=analyst, look=look).pdf
    words = " ".join(" ".join((page.extract_text() or "").split()) for page in PdfReader(io.BytesIO(printed)).pages)
    assert f"By {GUEST}" in words and "Alex Doe" not in words and "Open Desk" not in words and "Analyst" not in words
