"""A note someone else wrote (`NoteLook.author`) is signed with their name and picture wherever it is
exported or read (`notefill.signing`): the PDF, the Notebook's Page preview, an HTML file, a map page
and a WordPress draft. The receiving desk's own name, role, organisation, logo, handle and handwritten
signature never stand by it, however its Settings fill them."""

from __future__ import annotations

import io
import re

import pytest
from PIL import Image
from pypdf import PdfReader

from azimut import config
from azimut.engine import notefill, noteeditions, notes_html, notes_pdf, notes_web, notes_wordpress, notelook
from azimut.workspace import Case

from test_notes_pdf import exports_of

GUEST = "Guest Analyst"
RECEIVER = "Receiving Desk"
HANDLE = "@receivingdesk"
ROLE = "Desk editor"
DESK = "Receiving Media"


def _ok(response, what: str):
    assert response.status_code == 200, f"{what}: {response.text}"
    return response.json()


@pytest.fixture()
def desk(client):
    """A case whose Settings name the receiving desk, its handle and its logo, and in it the
    guest's picture."""
    config.update_settings(lambda settings: settings.update(report_name=RECEIVER, signature_handle=HANDLE,
                                                            report_role=ROLE, report_organisation=DESK))
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
    # the mark the reader lays in the map's corner shows the guest's face beside their name, as the analyst's logo
    corner = re.search(r'<(?:a|span) class="az-mappage-mark".*?</(?:a|span)>', previewed.text, re.S)
    assert corner is not None and 'class="az-face"' in corner.group(0) and GUEST in corner.group(0)
    # published as a web folder, the face is a file of it
    folder = notes_web.build(Case.open(cid), note)
    face = next(name for name in folder.files if name.startswith(notes_html.AUTHOR_FACE))
    _signed_by_the_guest(folder.files[notes_web.INDEX].decode("utf-8"), face=face)


def test_the_pdf_signs_with_the_guests_name_and_face(client, desk):
    case = Case.open(desk["cid"])
    config.report_signature_path().write_bytes(config.signature_path().read_bytes())
    look = notelook.NoteLook.model_validate({"style": "report", "author": GUEST, "author_image": desk["face"],
                                             "cover": {"on": True, "marks": ["logo", "signature"]},
                                             "header": {"right": "azimut:my-logo"}})
    printed = notes_pdf.render(case, title="Pier", text="Smoke over the pier, by {name}.\n", look=look)
    words = " ".join(" ".join((page.extract_text() or "").split())
                     for page in PdfReader(io.BytesIO(printed.pdf)).pages)
    assert f"By {GUEST}" in words and f"by {GUEST}." in words
    for receiver in (RECEIVER, ROLE, DESK, HANDLE):
        assert receiver not in words
    # the guest's face stands where the logo would: the receiver's logo and signature nowhere
    shown = _pdf_pictures(printed.pdf)
    face = notefill.case_picture(case, desk["face"])
    assert face is not None
    with Image.open(face) as picture:
        guest_size = picture.size
    assert guest_size in shown
    assert (120, 120) not in shown  # the receiver's logo and its handwritten signature, both that square
    # the text its editions compare names the guest too
    said = noteeditions.printed_now(case, title="Pier", text="By {name}.\n", look=look, note_id="", resolve=None)
    assert f"By {GUEST}." in said and RECEIVER not in said


def _pdf_pictures(data: bytes) -> list[tuple[int, int]]:
    """The size of every picture a PDF holds."""
    reader = PdfReader(io.BytesIO(data))
    return [(int(image.image.width), int(image.image.height)) for page in reader.pages for image in page.images]
