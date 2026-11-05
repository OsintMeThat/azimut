"""Where a note's pages turn: a page break the analyst asks for, the pictures the
Page pane sizes in place, and a video printed as its still.

The break is `<!-- pagebreak -->` on a line of its own: an HTML comment, so every
renderer but the PDF shows nothing. The pictures are reported beside the preview
(`X-Note-Pictures`) with the room a picture pushed to the next page left behind,
and the width that keeps it there.
"""

from __future__ import annotations

import json
from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader

from azimut.engine import notes_pdf, notetext, thumbnails
from azimut.engine.notelook import NoteLook

from test_notes_pdf import FakeCase, png, pdf_text
from test_notes_report import make_case, upload_picture

FILLER = "\n\n".join(f"Paragraph {n} says what was seen on the roof." for n in range(1, 31))


def pages(data: bytes) -> list[str]:
    return [page.extract_text() for page in PdfReader(BytesIO(data)).pages]


def link_targets(data: bytes) -> list[str]:
    found = []
    for page in PdfReader(BytesIO(data)).pages:
        for annotation in page.get("/Annots") or []:
            action = annotation.get_object().get("/A") or {}
            if action.get("/URI"):
                found.append(str(action["/URI"]))
    return found


def report(**values) -> NoteLook:
    return NoteLook.model_validate({"style": "report", **values})


# -- page breaks -------------------------------------------------------------


@pytest.mark.parametrize("written", ["<!-- pagebreak -->", "<!--pagebreak-->", "<!-- Page Break -->"])
@pytest.mark.parametrize("style", ["plain", "report", "brief", "journal"])
def test_a_page_break_starts_a_new_page_in_every_style(tmp_path, written, style):
    text = f"Before the break.\n\n{written}\n\nAfter the break.\n"
    out = notes_pdf.render(None, title="Breaks", text=text, look=NoteLook.model_validate({"style": style}))
    printed = pages(out.pdf)
    assert len(printed) == 2
    assert "Before the break." in printed[0] and "After the break." not in printed[0]
    assert "After the break." in printed[1]
    assert "pagebreak" not in "".join(printed).replace(" ", "").lower()


def test_a_break_on_a_page_still_blank_adds_no_empty_page(tmp_path):
    text = "One.\n\n<!-- pagebreak -->\n\n<!-- pagebreak -->\n\nTwo.\n"
    assert len(pages(notes_pdf.render(None, title="T", text=text).pdf)) == 2


def test_the_page_after_a_break_starts_at_the_break_s_line(tmp_path):
    text = "One.\n\n<!-- pagebreak -->\n\nTwo.\n"
    assert notes_pdf.render(None, title="T", text=text).pages == [0, 2]


def test_a_break_written_as_code_is_an_example_not_a_break(tmp_path):
    text = "```\n<!-- pagebreak -->\n```\n"
    out = notes_pdf.render(None, title="T", text=text)
    assert len(pages(out.pdf)) == 1
    assert "pagebreak" in pdf_text(out.pdf)


def test_a_break_is_not_words_an_excerpt_or_a_search_hit():
    text = "<!-- pagebreak -->\n\nRoof seen.\n"
    assert notetext.word_count(text) == 2
    assert notetext.excerpt(text) == "Roof seen."
    assert notetext.find(text, "pagebreak") is None


# -- pictures the Page pane sizes --------------------------------------------


def tall_case(tmp_path):
    png(tmp_path, "media/tall.png", size=(800, 1000))
    return FakeCase(
        tmp_path,
        {"m1": {"id": "m1", "label": "Tower", "type": "media", "attrs": {"path": "media/tall.png", "kind": "image"}}},
    )


@pytest.mark.parametrize("style", ["plain", "report"])
def test_a_picture_pushed_to_the_next_page_says_the_width_that_keeps_it(tmp_path, style):
    case = tall_case(tmp_path)
    lead = "\n\n".join(f"Line {n} of the account." for n in range(1, 13))
    text = f"{lead}\n\n[[media:m1|Tower]]{{width=100%}}\n\nAfter.\n"
    look = NoteLook.model_validate({"style": style})
    out = notes_pdf.render(case, title="Pushed", text=text, look=look)
    [picture] = out.pictures
    assert picture.ref == "media:m1"
    assert picture.line == text.splitlines().index("[[media:m1|Tower]]{width=100%}")
    assert picture.width == "100%"
    assert picture.page == 1
    assert picture.gap is not None and picture.gap[0] == 0
    assert notes_pdf.MIN_FIT_PERCENT <= picture.fit < 100
    # the width it offers does keep the picture on the page it left
    kept = text.replace("{width=100%}", f"{{width={picture.fit}%}}")
    again = notes_pdf.render(case, title="Pushed", text=kept, look=look)
    [placed] = again.pictures
    assert placed.page == 0 and placed.gap is None
    assert len(pages(again.pdf)) < len(pages(out.pdf)) or placed.page < picture.page


def test_a_picture_that_fits_reports_where_it_stands_and_no_gap(tmp_path):
    case = tall_case(tmp_path)
    out = notes_pdf.render(case, title="T", text="[[media:m1|Tower]]{width=40% align=center}\n")
    [picture] = out.pictures
    assert picture.page == 0 and picture.gap is None and picture.fit == 0
    assert picture.align == "center"
    left, top, width, height = picture.box
    assert 0 < left < 1 and 0 < top < 1 and 0 < width <= 1 and 0 < height <= 1
    assert left == pytest.approx((1 - width) / 2, abs=0.002)


def test_a_file_picture_is_found_by_its_address(tmp_path):
    png(tmp_path, "notes/shot.png", size=(400, 300))
    out = notes_pdf.render(FakeCase(tmp_path), title="T", text="![Shot](/files/demo/notes/shot.png)\n")
    assert [picture.ref for picture in out.pictures] == ["/files/demo/notes/shot.png"]


def test_a_chapter_s_pictures_are_not_offered_for_sizing(tmp_path):
    case = tall_case(tmp_path)
    chapters = {"c1": ("Chapter", "[[media:m1|Tower]]{width=30%}\n")}
    out = notes_pdf.render(
        case, title="Report", text="[[include:c1]]\n", resolve=chapters.get, look=report()
    )
    assert out.pictures == []


def test_a_template_s_picture_stand_in_is_offered_for_sizing(tmp_path):
    out = notes_pdf.render(None, title="T", text="[[media:any|Capture]]{width=50%}\n")
    [picture] = out.pictures
    assert picture.ref == "media:any" and picture.width == "50%"


# -- videos ------------------------------------------------------------------


def video_case(tmp_path, *, still=True, url="https://example.org/watch?v=1"):
    sha = "ab" * 32
    if still:
        path = tmp_path / thumbnails.thumb_relpath(sha, "video")
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (512, 288), "#334455").save(path, "JPEG")
    attrs = {"path": "media/clip.mp4", "kind": "video", "sha256": sha}
    if url:
        attrs["source_url"] = url
    return FakeCase(tmp_path, {"v1": {"id": "v1", "label": "Clip", "type": "media", "attrs": attrs}})


def test_a_video_prints_its_still_and_where_to_watch_it(tmp_path):
    out = notes_pdf.render(video_case(tmp_path), title="T", text="[[media:v1|Clip]]\n")
    text = pdf_text(out.pdf)
    assert "Video not included" not in text
    assert "Video: Clip" in text and "Watch: example.org" in text
    assert "https://example.org/watch?v=1" in link_targets(out.pdf)
    assert [picture.ref for picture in out.pictures] == ["media:v1"]


def test_a_video_without_a_still_still_says_where_to_watch_it(tmp_path):
    out = notes_pdf.render(video_case(tmp_path, still=False), title="T", text="[[media:v1|Clip]]\n")
    text = pdf_text(out.pdf)
    assert "Video not included in PDF. Watch it at https://example.org/watch?v=1" in text
    assert "https://example.org/watch?v=1" in link_targets(out.pdf)


def test_a_video_s_still_without_a_web_source_prints_no_link(tmp_path):
    out = notes_pdf.render(video_case(tmp_path, url="file:///home/me/clip.mp4"), title="T", text="[[media:v1|Clip]]\n")
    assert "Watch" not in pdf_text(out.pdf)
    assert link_targets(out.pdf) == []


def test_a_numbered_video_counts_as_a_figure(tmp_path):
    out = notes_pdf.render(
        video_case(tmp_path), title="T", text="[[media:v1|Clip]]\n", look=report(numbered=True)
    )
    assert "Figure 1. Video: Clip" in pdf_text(out.pdf)


# -- the preview route --------------------------------------------------------


def test_the_preview_says_where_each_picture_landed(client):
    cid = make_case(client)
    media = upload_picture(client, cid, size=(800, 1000))
    lead = "\n\n".join(f"Line {n}." for n in range(1, 14))
    text = f"{lead}\n\n[[media:{media}|Tower]]{{width=100%}}\n"
    response = client.post(f"/api/cases/{cid}/notes/preview", json={"note": "case", "text": text})
    assert response.status_code == 200, response.text
    [picture] = json.loads(response.headers["X-Note-Pictures"])
    assert picture["ref"] == f"media:{media}"
    assert picture["line"] == len(text.splitlines()) - 1
    assert set(picture) >= {"page", "box", "width", "align"}
    assert len(picture["box"]) == 4


def test_the_template_preview_says_where_its_stand_ins_landed(client):
    response = client.post(
        "/api/templates/note/preview", json={"text": "[[media:any|Capture]]{width=50%}\n"}
    )
    assert response.status_code == 200, response.text
    assert [item["ref"] for item in json.loads(response.headers["X-Note-Pictures"])] == ["media:any"]


# -- what never prints, and pictures that shrink rather than jump ---------------


def test_an_html_comment_never_reaches_the_pdf(tmp_path):
    text = (
        "Seen from the north.\n\n<!-- ask the source before sending -->\n\n"
        "A roof <!-- not this one --> by the mosque.\n\n<div>Raw tag</div>\n"
    )
    printed = pdf_text(notes_pdf.render(None, title="T", text=text).pdf)
    assert "ask the source" not in printed and "not this one" not in printed
    assert "A roof" in printed and "by the mosque." in printed
    # a tag that is not a comment is still shown as what it is
    assert "<div>Raw tag</div>" in printed


def test_a_comment_is_not_read_out_in_an_excerpt():
    assert notetext.excerpt("<!-- private -->\n\nRoof seen.\n") == "Roof seen."


def test_a_diagram_prints_at_its_size_on_screen(tmp_path, monkeypatch):
    text = "```mermaid\ngraph TD; A-->B;\n```\n"
    key = notes_pdf.diagram_key(notes_pdf.mermaid_sources(text)[0])
    image = BytesIO()
    Image.new("RGB", (600, 200), "white").save(image, format="PNG")
    widths = []
    placed = notes_pdf._Builder._picture

    def watch(self, source, **options):
        widths.append(options["w"])
        return placed(self, source, **options)

    monkeypatch.setattr(notes_pdf._Builder, "_picture", watch)
    notes_pdf.render(None, title="T", text=text, diagrams={key: image.getvalue()},
                     look=NoteLook.model_validate({"style": "report"}))
    # the browser draws it at twice its size: 600 px is 300 px on screen
    assert widths == [pytest.approx(300 * notes_pdf.PX_TO_MM)]


def test_a_picture_with_no_width_shrinks_a_little_rather_than_leave_a_page_blank(tmp_path):
    # wide, so the half-page bound on a picture with no width does not decide it first
    png(tmp_path, "media/tall.png", size=(1600, 1000))
    case = FakeCase(
        tmp_path,
        {"m1": {"id": "m1", "label": "Tower", "type": "media", "attrs": {"path": "media/tall.png", "kind": "image"}}},
    )
    for lines in range(1, 20):
        lead = "\n\n".join(f"Line {n}." for n in range(1, lines + 1))
        free = notes_pdf.render(case, title="T", text=f"{lead}\n\n[[media:m1|Tower]]\n")
        sized = notes_pdf.render(case, title="T", text=f"{lead}\n\n[[media:m1|Tower]]{{width=100%}}\n")
        [kept] = free.pictures
        [moved] = sized.pictures
        if moved.page == 1 and kept.page == 0:
            # the same picture: written at full width it moves, left free it stays, smaller
            assert kept.box[3] < moved.box[3]
            assert kept.box[3] >= moved.box[3] * (1 - notes_pdf.MAX_SHRINK) - 0.001
            return
    pytest.fail("no amount of text before the picture made it shrink rather than move")


def phone_case(tmp_path):
    png(tmp_path, "media/phone.png", size=(1080, 2340))
    return FakeCase(
        tmp_path,
        {"m1": {"id": "m1", "label": "Post", "type": "media", "attrs": {"path": "media/phone.png", "kind": "image"}}},
    )


@pytest.mark.parametrize("style", ["plain", "report"])
def test_a_picture_with_no_width_stays_within_half_the_page(tmp_path, style):
    """A phone screenshot left unsized prints half a page tall, not a page; written at
    full width it still takes the whole page, the analyst's choice."""
    case = phone_case(tmp_path)
    look = NoteLook.model_validate({"style": style})
    [free] = notes_pdf.render(case, title="T", text="[[media:m1|Post]]\n", look=look).pictures
    [full] = notes_pdf.render(case, title="T", text="[[media:m1|Post]]{width=100%}\n", look=look).pictures
    assert free.box[3] == pytest.approx(full.box[3] * notes_pdf.UNSIZED_SHARE, rel=0.01)
    assert free.page == 0


def test_a_tall_diagram_keeps_the_whole_page(tmp_path, monkeypatch):
    text = "```mermaid\ngraph TD; A-->B; B-->C; C-->D;\n```\n"
    key = notes_pdf.diagram_key(notes_pdf.mermaid_sources(text)[0])
    image = BytesIO()
    Image.new("RGB", (400, 2400), "white").save(image, format="PNG")
    heights = []
    placed = notes_pdf._Builder._picture

    def watch(self, source, **options):
        heights.append(options["h"])
        return placed(self, source, **options)

    monkeypatch.setattr(notes_pdf._Builder, "_picture", watch)
    notes_pdf.render(None, title="T", text=text, diagrams={key: image.getvalue()})
    [height] = heights
    assert height > notes_pdf.PLAIN.room * notes_pdf.UNSIZED_SHARE * 1.5


def test_a_width_the_analyst_wrote_is_never_shrunk(tmp_path):
    png(tmp_path, "media/tall.png", size=(800, 1000))
    case = FakeCase(
        tmp_path,
        {"m1": {"id": "m1", "label": "Tower", "type": "media", "attrs": {"path": "media/tall.png", "kind": "image"}}},
    )
    heights = set()
    for lines in range(1, 20):
        lead = "\n\n".join(f"Line {n}." for n in range(1, lines + 1))
        [picture] = notes_pdf.render(case, title="T", text=f"{lead}\n\n[[media:m1|Tower]]{{width=80%}}\n").pictures
        heights.add(round(picture.box[3], 4))
    assert len(heights) == 1


def test_a_break_right_under_a_paragraph_still_breaks(tmp_path):
    out = notes_pdf.render(None, title="T", text="Line 30\n<!-- pagebreak -->\nAfter\n")
    printed = pages(out.pdf)
    assert len(printed) == 2 and "After" in printed[1]
