"""A document signed by the analyst: the style's cover carrying the Azimut logo, their logo
and their signature (`NoteCover.marks`), and `signed` putting their name under the title or
their signature after the last section, in the PDF, the HTML page and the WordPress draft.
On the cover the analyst's logo stands by their name, an author card under the date, while
the Azimut mark keeps the foot. Who signs is Settings › Publishing's (`notefill.Identity`);
a look that never set either key is stored and printed as before."""

from __future__ import annotations

import io
from pathlib import Path
from typing import NamedTuple

import pytest
from PIL import Image
from pypdf import PdfReader

from azimut.engine import notefill, notes_html, notes_pdf, notes_style, notes_wordpress, pdffonts
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


# -- where the cover puts the analyst's logo ------------------------------------------------------

MM = 72 / 25.4
DAY = "2026-03-14"
DATE = "14 March 2026"
AZIMUT = notefill.AZIMUT_LOGO.name


class Drawn(NamedTuple):
    """A picture drawn from a file: its page and its box, in mm from the page's top left."""

    page: int
    x: float
    y: float
    w: float
    h: float


@pytest.fixture()
def drawn(monkeypatch) -> dict[str, Drawn]:
    """Where each picture of the next renders lands, by its file's name, the first one kept."""
    placed: dict[str, Drawn] = {}
    original = notes_pdf._Builder._picture

    def spy(self, source, **options):
        if isinstance(source, Path):
            placed.setdefault(source.name, Drawn(self.pdf.page, options["x"], options["y"], options["w"], options["h"]))
        original(self, source, **options)

    monkeypatch.setattr(notes_pdf._Builder, "_picture", spy)
    return placed


def _lines(pdf: bytes, page: int = 0) -> dict[str, tuple[float, float]]:
    """Each run of text on a page and where its baseline starts, in mm from the top left."""
    sheet = PdfReader(io.BytesIO(pdf)).pages[page]
    height = float(sheet.mediabox.height)
    found: dict[str, tuple[float, float]] = {}

    def visit(text, cm, tm, font, size):
        said = text.strip()
        if said and said not in found:
            x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
            y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
            found[said] = (x / MM, (height - y) / MM)

    sheet.extract_text(visitor_text=visit)
    return found


def _cover(identity, **look) -> notes_pdf.Rendered:
    return notes_pdf.render(None, title="Bridge", text=TEXT, identity=identity, look=_look(**look))


def test_the_analyst_s_logo_stands_left_of_their_name_under_the_date(signer, drawn):
    rendered = _cover(signer, tlp="amber", cover={"on": True, "date": DAY, "marks": ["azimut", "logo", "signature"]})
    lines = _lines(rendered.pdf)
    logo, signature, mark = drawn["logo.png"], drawn["signature.png"], drawn[AZIMUT]
    name_x, name_y = lines["Alex Doe"]
    credentials_x, credentials_y = lines["Analyst · Open Desk"]
    assert {logo.page, signature.page, mark.page} == {1} and len(_pages(rendered.pdf)) == 2
    # left of the name and the credentials, centred on them, under the date
    assert logo.x + logo.w < name_x == credentials_x and logo.h == pytest.approx(notes_style.CARD_LOGO_HEIGHT)
    assert name_y < logo.y + logo.h / 2 < credentials_y
    assert lines[DATE][1] < signature.y < logo.y
    # the handwritten signature over the name, set where the name starts
    assert signature.y + signature.h < name_y - 3 and signature.x < name_x < signature.x + 2
    # the Azimut mark alone at the foot, over the TLP line, well clear of the card
    tlp = next(y for said, (_, y) in lines.items() if said.startswith("Limited disclosure"))
    assert logo.y + logo.h + 5 < mark.y and mark.y + mark.h < tlp - 5 and tlp > 297 - 30


@pytest.mark.parametrize("who, marks", [("nameless", ["azimut", "logo", "signature"]), ("unsigned", ["azimut", "logo"])])
def test_with_no_name_on_the_cover_the_logo_stands_alone_under_the_date(tmp_path, signer, drawn, who, marks):
    identity = notefill.Identity(logo=_png(tmp_path / "logo.png", (300, 300))) if who == "nameless" else signer
    rendered = _cover(identity, cover={"on": True, "date": DAY, "marks": marks})
    lines = _lines(rendered.pdf)
    assert "Alex Doe" not in " ".join(lines)
    logo, mark = drawn["logo.png"], drawn[AZIMUT]
    date_x, date_y = lines[DATE]
    assert logo.page == 1 and logo.x < date_x < logo.x + 2 and date_y < logo.y < date_y + 10
    assert logo.y + logo.h + 20 < mark.y and mark.y + mark.h > 297 - 30


def test_signed_under_the_title_the_logo_stands_by_the_byline(signer, drawn):
    byline = "By Alex Doe, Analyst · Open Desk"
    rendered = _cover(signer, signed="title", cover={"on": True, "date": DAY, "marks": ["azimut", "logo"]})
    lines = _lines(rendered.pdf)
    logo = drawn["logo.png"]
    by_x, by_y = lines[byline]
    assert logo.x + logo.w < by_x and logo.y < by_y < logo.y + logo.h < lines[DATE][1]
    assert drawn[AZIMUT].y > lines[DATE][1] + 30
    # with the signature asked for too, the card under the date carries the logo and the byline stands alone
    drawn.clear()
    both = _cover(signer, signed="title", cover={"on": True, "date": DAY, "marks": ["azimut", "logo", "signature"]})
    lines = _lines(both.pdf)
    assert lines[byline][0] < drawn["logo.png"].x + 2
    assert lines[byline][1] < lines[DATE][1] < drawn["logo.png"].y < lines["Alex Doe"][1]


def test_a_title_on_two_lines_brings_the_card_closer_to_the_date_rather_than_onto_the_foot(signer, drawn):
    """Drawn 12 mm under the date, a two-line title's card ran into the Azimut mark."""
    marks = ["azimut", "logo", "signature"]
    short = _cover(signer, tlp="amber", cover={"on": True, "date": DAY, "subtitle": "What the pictures show", "marks": marks})
    assert drawn["signature.png"].y > _lines(short.pdf)[DATE][1] + 7
    drawn.clear()
    rendered = notes_pdf.render(None, title="Strikes on the port of Odesa and the grain terminal in July", text=TEXT,
                                identity=signer, look=_look(tlp="amber", cover={
                                    "on": True, "date": DAY, "subtitle": "What the pictures show", "marks": marks}))
    lines = _lines(rendered.pdf)
    signature, logo, mark = drawn["signature.png"], drawn["logo.png"], drawn[AZIMUT]
    assert "the grain terminal in July" in lines
    assert lines[DATE][1] < signature.y < lines[DATE][1] + 5
    assert max(logo.y + logo.h, lines["Analyst · Open Desk"][1]) < mark.y


@pytest.mark.parametrize("logo", [True, False])
@pytest.mark.parametrize("signature", [True, False])
@pytest.mark.parametrize("who", [
    ("Alex Doe", "Analyst", "Open Desk"),
    ("Alex Doe", "", ""),
    ("Alex Doe", "Senior open-source imagery analyst", "The organisation with a name long enough to wrap"),
    ("", "Analyst", "Open Desk"),
])
def test_the_signature_block_is_exactly_as_tall_as_measured(tmp_path, logo, signature, who):
    """`signature_height` keeps a signature on one page: it is the height `signature_block`
    draws, with the cover's logo or without, however its credentials wrap."""
    identity = notefill.Identity(*who, logo=_png(tmp_path / "logo.png", (300, 300)) if logo else None,
                                 signature=_png(tmp_path / "signature.png") if signature else None)
    page = notes_style.NotePage(title="T", theme=notes_style.REPORT,
                                look=_look(cover={"on": True, "marks": ["logo", "signature"]}))
    pdffonts.install(page, " ".join(who), body=page.theme.body_family)
    page.band_picture = notes_pdf._band_picture(identity)
    page.signer = identity
    page.add_page()
    page.set_auto_page_break(False)
    card = page.card_logo()
    assert (card is not None) == logo
    for width in (60.0, page.epw):
        for beside in (card, None):
            measured = page.signature_height(width, logo=beside)
            top = page.get_y()
            assert page.signature_block(page.l_margin, width, logo=beside) == pytest.approx(measured)
            assert page.get_y() == pytest.approx(top + measured)
            assert measured > 0 or not (who[0] or signature or beside)
    # the end of a document measures over the page's frame, with no logo
    assert page.signature_height() == page.signature_height(page.epw, logo=None)


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
    assert 'class="az-signed az-cover-signed az-author"' in body and '<span class="az-signer">Alex Doe</span>' in body
    ended = notes_html.render(None, title="Bridge", text=TEXT, look=_look(signed="end"), identity=signer).html.decode()
    tail = ended.split("</style>")[-1]
    assert tail.index("one burned") < tail.index('class="az-signed az-signed-end"')
    assert 'class="az-my-signature"' in tail and '<span class="az-credentials">Analyst · Open Desk</span>' in tail
    # the end signature is no author card: the logo is the cover's
    assert "az-author" not in tail and 'class="az-my-logo"' not in tail


def _cover_html(identity, **look) -> str:
    page = notes_html.render(None, title="Bridge", text=TEXT, identity=identity, look=_look(**look)).html.decode()
    body = page.split("</style>")[-1]
    return body[body.index('<header class="az-cover"'):body.index("</header>")]


def test_the_html_cover_puts_the_logo_by_the_name_and_keeps_the_azimut_mark_last(signer):
    cover = _cover_html(signer, cover={"on": True, "marks": ["azimut", "logo", "signature"]})
    card = cover[cover.index('<div class="az-signed az-cover-signed az-author">'):]
    card = card[:card.index("</div>")]
    # the logo first, then the signature over the name and credentials, as in the PDF
    assert card.index('<span class="az-author-logo"><img class="az-my-logo"') < card.index('class="az-my-signature"') \
        < card.index('<span class="az-author-text"><span class="az-signer">Alex Doe</span>') \
        < card.index('<span class="az-credentials">Analyst · Open Desk</span>')
    assert cover.index('class="az-dateline"') < cover.index("az-author") < cover.index('<p class="az-cover-marks">')
    marks = cover[cover.index('<p class="az-cover-marks">'):]
    assert 'class="az-logo"' in marks and "az-my-logo" not in marks and cover.count('class="az-my-logo"') == 1


def test_the_html_cover_s_logo_stands_by_the_byline_or_alone_under_the_date(tmp_path, signer):
    bylined = _cover_html(signer, signed="title", cover={"on": True, "marks": ["azimut", "logo"]})
    assert '<p class="az-byline" dir="auto"><span class="az-author-logo"><img class="az-my-logo"' in bylined
    assert bylined.count('class="az-my-logo"') == 1 and "az-signed" not in bylined
    # with no name to stand by, alone under the date
    nameless = notefill.Identity(logo=_png(tmp_path / "logo.png", (300, 300)))
    alone = _cover_html(nameless, cover={"on": True, "marks": ["azimut", "logo", "signature"]})
    assert alone.index('class="az-dateline"') < alone.index('<p class="az-author-logo"><img class="az-my-logo"') \
        < alone.index('<p class="az-cover-marks">')
    assert "az-signed" not in alone and "az-byline" not in alone
    # a page with no cover shows no logo, its byline as it was
    plain = _cover_html(signer, signed="title", cover={"marks": ["logo"]})
    assert '<p class="az-byline" dir="auto">By Alex Doe, Analyst · Open Desk</p>' in plain and "az-my-logo" not in plain


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
    card = body[body.index('<div class="az-signed az-cover-signed az-author">'):]
    card = card[:card.index("</div>")]
    assert card.startswith(f'<div class="az-signed az-cover-signed az-author"><span class="az-author-logo">{link}'
                           '<img class="az-my-logo"')
    assert card.count(link) == 2
    marks = body[body.index('<p class="az-cover-marks">'):]
    marks = marks[:marks.index("</p>")]
    assert 'class="az-logo"' in marks and link not in marks
    bylined = notes_html.render(None, title="Bridge", text=TEXT, identity=signer,
                                look=_look(signed="title", cover={"on": True, "marks": ["logo"]})).html.decode()
    assert (f'<p class="az-byline" dir="auto"><span class="az-author-logo">{link}<img class="az-my-logo"'
            in bylined.split("</style>")[-1])
    ended = notes_html.render(None, title="Bridge", text=TEXT, look=_look(signed="end"), identity=signer).html.decode()
    assert f'<span class="az-signer">{link}Alex Doe</a></span>' in ended.split("</style>")[-1]
    # the PDF: the byline, the cover's name and logo
    printed = notes_pdf.render(None, title="Bridge", text=TEXT, look=look, identity=signer)
    assert _uris(printed.pdf).count(SITE) >= 3
    # the logo beside the byline opens it too
    bylined = notes_pdf.render(None, title="Bridge", text=TEXT, identity=signer,
                               look=_look(signed="title", cover={"on": True, "marks": ["azimut", "logo"]}))
    assert _uris(bylined.pdf).count(SITE) == 2
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


def test_a_document_ends_on_made_with_azimut_only_when_settings_ask(tmp_path):
    """Settings › Publishing's Credit Azimut: the page's footer, the PDF's last line and the
    WordPress draft's, each linked to the project; nothing while it is off."""
    credited = notefill.Identity("Alex Doe", credit=True)
    said = notefill.MADE_WITH
    assert said.startswith("Made with Azimut ") and said.split()[-1][0].isdigit()
    page = notes_html.render(None, title="Bridge", text=TEXT, look=_look(), identity=credited).html.decode()
    footer = page[page.index('<footer class="az-footer">'):]
    assert (f'<p class="az-made"><a href="{notefill.AZIMUT_SITE}" target="_blank" rel="noopener noreferrer">'
            f"{said}</a></p>") in footer
    printed = notes_pdf.render(None, title="Bridge", text=TEXT, look=_look(), identity=credited)
    assert said in _pages(printed.pdf)[-1] and notefill.AZIMUT_SITE in _uris(printed.pdf)
    draft = notes_wordpress.build(None, title="Bridge", text=TEXT, look=_look(), identity=credited)
    assert draft.content.rstrip().endswith(f'<em><a href="{notefill.AZIMUT_SITE}">{said}</a></em></p>\n<!-- /wp:paragraph -->')
    # off, as a new installation has it
    plain = notefill.Identity("Alex Doe")
    assert 'class="az-made"' not in notes_html.render(None, title="Bridge", text=TEXT, look=_look(), identity=plain).html.decode()
    assert said not in " ".join(_pages(notes_pdf.render(None, title="Bridge", text=TEXT, look=_look(), identity=plain).pdf))
    assert said not in notes_wordpress.build(None, title="Bridge", text=TEXT, look=_look(), identity=plain).content


def test_credit_azimut_is_a_setting_kept_with_the_others(client):
    assert client.get("/api/settings").json()["report_credit_azimut"] is False
    assert notefill.Identity.from_settings().credit is False
    assert client.put("/api/settings/prefs", json={"report_credit_azimut": True}).status_code == 200
    assert client.get("/api/settings").json()["report_credit_azimut"] is True
    assert notefill.Identity.from_settings().credit is True
