"""A document signed by the analyst: the style's cover carrying the Azimut logo, their logo
and their signature (`NoteCover.marks`), and `signed` putting their name under the title or
their signature after the last section, in the PDF, the HTML page and the WordPress draft.
Who signs is Settings › Publishing's (`notefill.Identity`); a look that never set either key
is stored and printed as before."""

from __future__ import annotations

import io

import pytest
from PIL import Image
from pypdf import PdfReader

from azimut.engine import notefill, notes_html, notes_pdf, notes_wordpress
from azimut.engine.notelook import NoteLook

TEXT = "# Field notes\n\nThe convoy stopped at the bridge.\n\n## What it shows\n\nThree trucks, one burned.\n"


def _png(path, size=(400, 120), colour=(20, 20, 20)):
    Image.new("RGB", size, colour).save(path, "PNG")
    return path


@pytest.fixture()
def signer(tmp_path):
    return notefill.Identity("Alex Doe", "Analyst", "Open Desk", logo=_png(tmp_path / "logo.png", (300, 300)),
                             signature=_png(tmp_path / "signature.png"))


def _look(**values) -> NoteLook:
    return NoteLook.model_validate({"style": "report", **values})


def _pages(pdf: bytes) -> list[str]:
    return [" ".join((page.extract_text() or "").split()) for page in PdfReader(io.BytesIO(pdf)).pages]


def _images(pdf: bytes, page: int) -> int:
    return len(PdfReader(io.BytesIO(pdf)).pages[page].images)


def test_a_look_that_never_signs_is_kept_as_an_older_azimut_wrote_it():
    look = NoteLook.model_validate({"style": "report", "cover": {"on": True}})
    kept = look.model_dump()
    assert "signed" not in kept and "marks" not in kept["cover"]
    # the marks keep their own order whatever order they were picked in
    marked = NoteLook.model_validate({"cover": {"on": True, "marks": ["signature", "azimut"]}, "signed": "end"})
    assert marked.cover.marks == ["azimut", "signature"] and marked.model_dump()["signed"] == "end"
    with pytest.raises(ValueError):
        NoteLook.model_validate({"signed": "everywhere"})


def test_the_style_s_cover_carries_the_logos_and_the_signature_it_asks_for(signer):
    bare = notes_pdf.render(None, title="Bridge", text=TEXT, look=_look(cover={"on": True}), identity=signer)
    marked = notes_pdf.render(None, title="Bridge", text=TEXT, identity=signer,
                              look=_look(cover={"on": True, "marks": ["azimut", "logo", "signature"]}))
    assert "Alex Doe" not in _pages(bare.pdf)[0]
    cover = _pages(marked.pdf)[0]
    assert "Alex Doe" in cover and "Analyst · Open Desk" in cover
    # the Azimut mark is drawn as a vector; the analyst's logo and signature are two pictures more
    assert _images(marked.pdf, 0) == _images(bare.pdf, 0) + 2


def test_signed_under_the_title_bylines_the_page_or_the_cover(signer):
    page = notes_pdf.render(None, title="Bridge", text=TEXT, look=_look(signed="title"), identity=signer)
    assert "By Alex Doe, Analyst · Open Desk" in _pages(page.pdf)[0]
    covered = notes_pdf.render(None, title="Bridge", text=TEXT, look=_look(signed="title", cover={"on": True}),
                               identity=signer)
    printed = _pages(covered.pdf)
    assert "By Alex Doe" in printed[0] and not any("By Alex Doe" in one for one in printed[1:])


def test_signed_at_the_end_signs_after_the_last_section_before_the_sources(signer):
    text = TEXT + "\nSeen in [the post](https://example.org/post).\n"
    rendered = notes_pdf.render(None, title="Bridge", text=text, look=_look(signed="end"), identity=signer)
    words = " ".join(_pages(rendered.pdf))
    assert words.index("one burned") < words.index("Alex Doe") < words.rindex("example.org")
    assert any(_images(rendered.pdf, number) for number in range(len(_pages(rendered.pdf))))


def test_nobody_to_sign_with_prints_nothing_and_breaks_nothing():
    nobody = notefill.Identity()
    rendered = notes_pdf.render(None, title="Bridge", text=TEXT, identity=nobody,
                                look=_look(signed="end", cover={"on": True, "marks": ["logo", "signature"]}))
    assert "By " not in " ".join(_pages(rendered.pdf))
    page = notes_html.render(None, title="Bridge", text=TEXT, identity=nobody, look=_look(signed="end")).html.decode()
    assert "az-signed" not in page.split("</style>")[-1]


def test_the_html_page_bylines_marks_its_cover_and_signs_at_the_end(signer):
    look = _look(signed="title", cover={"on": True, "marks": ["azimut", "logo", "signature"]})
    page = notes_html.render(None, title="Bridge", text=TEXT, look=look, identity=signer).html.decode()
    body = page.split("</style>")[-1]
    assert '<p class="az-byline" dir="auto">By Alex Doe, Analyst · Open Desk</p>' in body
    assert '<p class="az-cover-marks">' in body and 'class="az-logo"' in body and 'class="az-my-logo"' in body
    assert 'class="az-signed az-cover-signed"' in body and '<span class="az-signer">Alex Doe</span>' in body
    ended = notes_html.render(None, title="Bridge", text=TEXT, look=_look(signed="end"), identity=signer).html.decode()
    tail = ended.split("</style>")[-1]
    assert tail.index("one burned") < tail.index('class="az-signed az-signed-end"')
    assert 'class="az-my-signature"' in tail and '<span class="az-credentials">Analyst · Open Desk</span>' in tail


def test_the_wordpress_draft_bylines_and_signs_the_post(signer):
    draft = notes_wordpress.build(None, title="Bridge", text=TEXT, look=_look(signed="title"), identity=signer)
    assert "<em>By Alex Doe, Analyst · Open Desk</em>" in draft.content
    ended = notes_wordpress.build(None, title="Bridge", text=TEXT, look=_look(signed="end"), identity=signer)
    assert ended.content.index("one burned") < ended.content.index("<strong>Alex Doe</strong><br>Analyst · Open Desk")
    assert any(upload.alt == "Signature" for upload in ended.uploads)


SITE = "https://desk.example.org/"


def _uris(pdf: bytes) -> list[str]:
    """Every link a PDF's pages hold."""
    found = []
    for page in PdfReader(io.BytesIO(pdf)).pages:
        for annotation in page.get("/Annots") or []:
            action = annotation.get_object().get("/A") or {}
            if "/URI" in action:
                found.append(str(action["/URI"]))
    return found


def test_the_name_and_the_logo_link_to_the_website_wherever_a_document_shows_them(tmp_path):
    """With a Website in Settings › Publishing the name under the title, on the cover and after
    the last section, and the analyst's own logo, open it; never the Azimut mark."""
    signer = notefill.Identity("Alex Doe", "Analyst", "Open Desk", logo=_png(tmp_path / "logo.png", (300, 300)),
                               signature=_png(tmp_path / "signature.png"), site=SITE)
    link = f'<a class="az-site-link" href="{SITE}" target="_blank" rel="noopener noreferrer">'
    look = _look(signed="title", cover={"on": True, "marks": ["azimut", "logo", "signature"]})
    body = notes_html.render(None, title="Bridge", text=TEXT, look=look, identity=signer).html.decode().split("</style>")[-1]
    assert f'<p class="az-byline" dir="auto">By {link}Alex Doe</a>, Analyst · Open Desk</p>' in body
    assert f'<span class="az-signer">{link}Alex Doe</a></span>' in body
    marks = body[body.index('<p class="az-cover-marks">'):]
    marks = marks[:marks.index("</p>")]
    assert marks.count(link) == 1 and marks.index(link) < marks.index('class="az-my-logo"')
    assert marks.index('class="az-logo"') < marks.index(link)
    ended = notes_html.render(None, title="Bridge", text=TEXT, look=_look(signed="end"), identity=signer).html.decode()
    assert f'<span class="az-signer">{link}Alex Doe</a></span>' in ended.split("</style>")[-1]
    # the PDF: the byline, the cover's name and logo
    printed = notes_pdf.render(None, title="Bridge", text=TEXT, look=look, identity=signer)
    assert _uris(printed.pdf).count(SITE) >= 3
    paged = notes_pdf.render(None, title="Bridge", text=TEXT, look=_look(signed="title"), identity=signer)
    assert SITE in _uris(paged.pdf)
    # the WordPress draft
    draft = notes_wordpress.build(None, title="Bridge", text=TEXT, look=_look(signed="title"), identity=signer)
    assert f'<em>By <a href="{SITE}">Alex Doe</a>, Analyst · Open Desk</em>' in draft.content
    ended = notes_wordpress.build(None, title="Bridge", text=TEXT, look=_look(signed="end"), identity=signer)
    assert f'<strong><a href="{SITE}">Alex Doe</a></strong>' in ended.content


def test_with_no_website_the_name_and_the_logo_stay_unlinked(signer):
    look = _look(signed="title", cover={"on": True, "marks": ["logo", "signature"]})
    body = notes_html.render(None, title="Bridge", text=TEXT, look=look, identity=signer).html.decode().split("</style>")[-1]
    assert "az-site-link" not in body
    assert SITE not in _uris(notes_pdf.render(None, title="Bridge", text=TEXT, look=look, identity=signer).pdf)
