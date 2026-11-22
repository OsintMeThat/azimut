"""A note someone else wrote (`NoteLook.author`) is signed with their name and picture wherever it is
read in HTML (`notefill.signing`): the Notebook's Page preview, an HTML file, a map page and a
WordPress draft. The receiving desk's own name, logo and handle never stand by it, however its
Settings fill them. The PDF keeps the analyst's own (`tests/test_site_author.py`)."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from azimut import config
from azimut.engine import notes_html, notes_web, notes_wordpress, notelook
from azimut.workspace import Case

from test_notes_pdf import exports_of

GUEST = "Guest Analyst"
RECEIVER = "Receiving Desk"
HANDLE = "@receivingdesk"


def _ok(response, what: str):
    assert response.status_code == 200, f"{what}: {response.text}"
    return response.json()


@pytest.fixture()
def desk(client):
    """A case whose Settings name the receiving desk, its handle and its logo, and in it the
    guest's picture."""
    config.update_settings(lambda settings: settings.update(report_name=RECEIVER, signature_handle=HANDLE))
    config.signature_path().parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (120, 120), (200, 40, 40)).save(config.signature_path())
    cid = _ok(client.post("/api/cases", json={"name": "Desk"}), "case")["id"]
    buffer = io.BytesIO()
    Image.new("RGB", (80, 80), (20, 120, 200)).save(buffer, "PNG")
    face = _ok(client.post(f"/api/cases/{cid}/media/upload",
                           files={"file": ("guest.png", io.BytesIO(buffer.getvalue()), "image/png")}), "face")
    return {"cid": cid, "face": face["entity"]["id"]}


def _note(client, cid: str, title: str, text: str, **look) -> str:
    note = _ok(client.post(f"/api/cases/{cid}/notes", json={"title": title, "content": ""}), title)["id"]
    _ok(client.put(f"/api/cases/{cid}/notes/{note}/look", json=look), "look")
    _ok(client.put(f"/api/cases/{cid}/notes/{note}", json={"text": text}), title)
    return note


def _signed_by_the_guest(page: str, *, face: str = "data:image/") -> None:
    body = page.split("</style>")[-1]
    assert f"By {GUEST}" in body or f">{GUEST}<" in body
    assert f'<img class="az-face" src="{face}' in body
    assert RECEIVER not in page and HANDLE not in page
    assert "az-my-logo" not in body and "az-mappage-handle" not in body


def test_the_page_preview_signs_with_the_guests_name_and_face(client, desk):
    note = _note(client, desk["cid"], "Pier", "Smoke over the pier.\n", style="article", author=GUEST,
                 author_image=desk["face"])
    answer = client.post(f"/api/cases/{desk['cid']}/notes/html/preview",
                         json={"note": note, "title": "Pier", "text": "Smoke over the pier.\n", "edition": "public"})
    assert answer.status_code == 200, answer.text
    _signed_by_the_guest(answer.text)
    # the analyst's own note keeps the analyst's name
    own = _note(client, desk["cid"], "Own", "Words.\n", style="article", signed="title")
    mine = client.post(f"/api/cases/{desk['cid']}/notes/html/preview",
                       json={"note": own, "title": "Own", "text": "Words.\n", "edition": "public"}).text
    assert f"By {RECEIVER}" in mine and '<img class="az-face"' not in mine


def test_the_html_file_signs_with_the_guests_name_and_face(client, desk):
    note = _note(client, desk["cid"], "Pier", "Smoke over the pier.\n", style="article", author=GUEST,
                 author_image=desk["face"])
    written = _ok(client.post(f"/api/cases/{desk['cid']}/notes/html", json={"notes": [note], "edition": "public"}),
                  "html")
    page = (exports_of(desk["cid"]) / written["written"][0]["file"]).read_text(encoding="utf-8")
    _signed_by_the_guest(page)


def test_a_wordpress_draft_signs_with_the_guests_name_and_face(client, desk):
    case = Case.open(desk["cid"])
    look = notelook.NoteLook.model_validate({"style": "article", "author": GUEST, "author_image": desk["face"]})
    draft = notes_wordpress.build(case, title="Pier", text="Smoke over the pier.\n", look=look)
    assert f"<em>By {GUEST}</em>" in draft.content and RECEIVER not in draft.content
    face = notes_html.author_face(case, desk["face"])
    assert face is not None
    faces = [upload for upload in draft.uploads if upload.data == face[1]]
    assert len(faces) == 1 and faces[0].alt == GUEST
    # the face stands right above the byline, and the receiver's logo nowhere
    placed = draft.content.index(f'class="wp-image-\x00{draft.uploads.index(faces[0])}:id\x00"')
    assert placed < draft.content.index(f"<em>By {GUEST}</em>")
    assert not [upload for upload in draft.uploads if upload.alt == "Logo"]


def test_a_map_page_signs_with_the_guests_name_and_face_and_no_handle(client, desk):
    cid = desk["cid"]
    layer = _ok(client.post(f"/api/cases/{cid}/map-layers/editable", json={"title": "Marks"}), "layer")["name"]
    _ok(client.post(f"/api/cases/{cid}/map-layers/{layer}/markers", json={"lat": 12.7, "lon": 43.5, "name": "Pier"}),
        "marker")
    text = f"Where the smoke rose.\n\n::: map\ntitle: The pier\nlayer: {layer}\n:::\n"
    note = _note(client, cid, "Pier map", text, style="article", web="map", author=GUEST, author_image=desk["face"])
    previewed = client.post(f"/api/cases/{cid}/notes/html/preview",
                            json={"note": note, "title": "Pier map", "text": text, "edition": "public"})
    assert previewed.status_code == 200, previewed.text
    assert 'data-web="map"' in previewed.text
    _signed_by_the_guest(previewed.text)
    # published as a web folder, the face is a file of it
    folder = notes_web.build(Case.open(cid), note)
    face = next(name for name in folder.files if name.startswith(notes_html.AUTHOR_FACE))
    _signed_by_the_guest(folder.files[notes_web.INDEX].decode("utf-8"), face=face)
