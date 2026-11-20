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
