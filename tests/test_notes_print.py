"""What a printed note says about itself: the face and size its text is set in,
the caption and credit under each picture, the sources that stay clickable, and
the warnings the Page pane lists with the line each one is about.

Plain with no font and no size is the document notes always printed as; the
golden test (`test_notes_pdf_golden.py`) holds that. These cover what a look or a
note asks for on top of it.
"""

from __future__ import annotations

import json
from io import BytesIO

import pytest
from pydantic import ValidationError
from pypdf import PdfReader

from azimut.api import notes as notes_api
from azimut.engine import notelook, notes_pdf, notes_style, pdffonts
from azimut.engine.notelook import NoteLook, TemplateLook
from azimut.workspace import Case

from test_notes_pdf import FakeCase, png, pdf_text
from test_notes_pages import link_targets, pages
from test_notes_report import make_case, make_note

FILLER = "\n\n".join(f"Paragraph {n} says what was seen on the roof and the quay." for n in range(1, 60))


def look(**values) -> NoteLook:
    return NoteLook.model_validate(values)


def faces(data: bytes) -> set[str]:
    """The faces a document draws with, as its pages name them."""
    names = set()
    for page in PdfReader(BytesIO(data)).pages:
        for font in page["/Resources"]["/Font"].values():
            names.add(str(font.get_object()["/BaseFont"]).split("+", 1)[-1])
    return names


class IndexedCase(FakeCase):
    """A case that also answers what its media index knows about a file."""

    def __init__(self, tmp_path, entities=None, items=None):
        super().__init__(tmp_path, entities)
        self._items = items or {}

    def media_items_by_paths(self, paths):
        return [self._items[path] for path in paths if path in self._items]


# -- the look's two new keys ---------------------------------------------------


def test_a_look_takes_a_font_and_a_size():
    chosen = look(style="report", font="book", size="large")
    assert (chosen.font, chosen.size) == ("book", "large")
    assert chosen.model_dump()["font"] == "book"
    assert not look(font="sans").is_default
    assert TemplateLook.model_validate({"font": "modern", "size": "small"}).size == "small"


@pytest.mark.parametrize("bad", [{"font": "comic"}, {"size": "huge"}, {"font": 1}, {"size": None}])
def test_a_font_or_size_it_does_not_know_is_refused(bad):
    with pytest.raises(ValidationError):
        NoteLook.model_validate(bad)


def test_an_unset_font_and_size_are_never_written():
    """An older Azimut refuses a key it does not know in a template's look, so a
    look that never used them keeps the shape it always had."""
    assert "font" not in NoteLook().model_dump() and "size" not in NoteLook().model_dump()
    assert look(font="", size="").is_default
    assert "size" not in look(font="book").model_dump(mode="json")


def test_a_later_face_in_a_stored_look_drops_alone():
    """A look written by a later Azimut may name a face this one does not ship:
    that key goes back to its default and the rest of the look is kept."""
    later = {"style": "report", "font": "grotesque", "size": "huge", "toc": True,
             "cover": {"on": True, "subtitle": "Kept", "date": "not a day"}}
    parsed = notelook.parse(later)
    assert parsed is not None
    assert (parsed.style, parsed.font, parsed.size, parsed.toc) == ("report", "", "", True)
    assert (parsed.cover.on, parsed.cover.subtitle, parsed.cover.date) == (True, "Kept", "")
    assert notelook.parse({"font": "grotesque"}) is None


def test_the_route_refuses_an_unknown_font(client):
    cid = make_case(client)
    note = make_note(client, cid)
    route = f"/api/cases/{cid}/notes/{note['id']}/look"
    assert client.put(route, json={"font": "comic"}).status_code == 422
    saved = client.put(route, json={"style": "report", "font": "book", "size": "small"})
    assert saved.status_code == 200, saved.text
    kept = client.get(route).json()["look"]
    assert (kept["font"], kept["size"]) == ("book", "small")
    client.put(route, json={"style": "plain", "font": "", "size": ""})
    assert notelook.stored(Case.open(cid), note["id"]) is None


# -- faces -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("font", "expected"),
    [("book", "Literata"), ("modern", "IBMPlexSans"), ("sans", "NotoSansItalic"), ("serif", "NotoSerif")],
)
def test_each_font_sets_the_text_in_its_own_face(font, expected):
    out = notes_pdf.render(None, title="T", text="# Heading\n\nBody with an *italic* word.\n", look=look(font=font))
    assert expected in faces(out.pdf)
    assert "Body with an italic word." in pdf_text(out.pdf)


def test_a_plain_note_draws_only_the_faces_it_always_did():
    out = notes_pdf.render(None, title="T", text="# Heading\n\nBody with an *italic* word.\n")
    assert faces(out.pdf) == {"NotoSans", "NotoSansBold", "NotoSerif", "NotoSerifItalic"}


def test_a_sans_body_has_a_sans_italic_and_a_sans_heading_still_borrows():
    brief = notes_pdf.render(None, title="T", text="Words *leaning*.\n", look=look(style="brief"))
    assert "NotoSansItalic" in faces(brief.pdf) and "NotoSerifItalic" not in faces(brief.pdf)
    plain = notes_pdf.render(None, title="T", text="## A *leaning* heading\n")
    assert "NotoSerifBoldItalic" in faces(plain.pdf)


def test_a_letter_the_chosen_face_lacks_is_drawn_by_the_noto_face_of_its_kind():
    letters = "ǅ Ꞵ"  # Latin the Noto faces have and Literata and Plex do not
    for font, kind in (("book", "NotoSerif"), ("modern", "NotoSans")):
        out = notes_pdf.render(None, title="T", text=f"Rare letters {letters} here.\n", look=look(font=font))
        assert out.warnings == []
        assert kind in faces(out.pdf)


def test_the_font_choices_are_listed_in_order_and_each_face_ships_with_its_licence():
    assert [font.key for font in pdffonts.FONTS] == ["serif", "sans", "book", "modern"]
    for font in pdffonts.FONTS:
        assert (pdffonts.FONT_DIR / font.regular).is_file()
        assert {style for family, style, _ in font.faces if family == font.body} in (set(), {"I", "BI"},
                                                                                   {"", "B", "I", "BI"})
    for licence in ("Literata-OFL.txt", "IBMPlexSans-OFL.txt", "OFL.txt"):
        text = (pdffonts.FONT_DIR / licence).read_text(encoding="utf-8")
        assert "Open Font License" in text and "GPL" not in text


def test_a_size_moves_the_body_the_headings_and_the_spaces_together():
    base = notes_style.theme_for(look(style="report"))
    small = notes_style.theme_for(look(style="report", size="small"))
    large = notes_style.theme_for(look(style="report", size="large"))
    assert small.body_size < base.body_size < large.body_size
    assert small.leading < base.leading < large.leading and small.gap < base.gap < large.gap
    assert large.headings["h1"][0] == pytest.approx(base.headings["h1"][0] * 1.12, abs=0.01)
    assert large.margin_side == base.margin_side  # the page itself does not move
    first_page = [pages(notes_pdf.render(None, title="T", text=FILLER, look=look(size=size)).pdf)[0].count("Paragraph")
                  for size in ("small", "", "large")]
    assert first_page[0] > first_page[1] > first_page[2]


@pytest.mark.parametrize(("style", "font"), [
    ("plain", "book"), ("plain", "modern"), ("report", "sans"), ("report", "book"), ("brief", "serif"),
    ("brief", "book"), ("journal", "modern"), ("journal", ""), ("report", "modern"), ("brief", "sans"),
])
def test_every_font_prints_in_the_styles(style, font):
    text = "# T\n\n## Part\n\nWords, *italic*, **bold**, `code`.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> [!lead] A lead.\n"
    out = notes_pdf.render(None, title="T", text=text, look=look(style=style, font=font, size="large"))
    assert "Words, italic, bold, code." in pdf_text(out.pdf).replace("\n", " ")


def test_the_font_routes_list_the_choices_and_serve_only_their_faces(client):
    listed = client.get("/api/notes/fonts")
    assert listed.status_code == 200
    assert listed.json()["fonts"][2] == {"key": "book", "label": "Literata", "kind": "serif"}
    face = client.get("/api/notes/fonts/modern.ttf")
    assert face.status_code == 200
    assert face.headers["content-type"] == "font/ttf"
    assert face.headers["cache-control"] == "public, max-age=86400"
    assert face.content == (pdffonts.FONT_DIR / "IBMPlexSans-Regular.ttf").read_bytes()
    for name in ("comic.ttf", "book.otf", "book", "..%2FOFL.txt", "NotoSerif-Regular.ttf", "...ttf",
                 "..", "%2E%2E%2Fbook.ttf", "book.ttf%00"):
        assert client.get(f"/api/notes/fonts/{name}").status_code == 404, name


# -- captions ---------------------------------------------------------------------


def picture_case(tmp_path, **attrs):
    png(tmp_path, "media/frame.png", size=(640, 360))
    return FakeCase(tmp_path, {"m1": {"id": "m1", "type": "media", "label": "Frame",
                                      "attrs": {"path": "media/frame.png", "kind": "image", **attrs}}})


def test_a_caption_in_the_braces_prints_under_the_picture_and_beats_a_title(tmp_path):
    case = picture_case(tmp_path)
    text = ('[[media:m1|Frame]]{width=50% align=center caption="Smoke — over the port, 50% hidden"}\n\n'
            '![x](/files/demo/media/frame.png "The title"){caption="The caption"}\n')
    for style in ("plain", "report"):
        printed = pdf_text(notes_pdf.render(case, title="T", text=text, look=look(style=style)).pdf)
        assert "Smoke — over the port, 50% hidden" in printed
        assert "The caption" in printed and "The title" not in printed


def test_a_caption_that_says_width_sets_none(tmp_path):
    options = notes_pdf._image_options(notes_pdf._case_references(
        '[[media:m1|Frame]]{caption="width=50% align=right"}')[len("![Frame]("):-1])
    assert (options.width, options.align, options.caption) == ("", "left", "width=50% align=right")


def test_numbered_figures_print_their_caption_or_their_label(tmp_path):
    case = picture_case(tmp_path)
    text = '[[media:m1|Frame]]{caption="Smoke over the port"}\n\n[[media:m1|Second frame]]\n'
    for style in ("plain", "report"):
        printed = pdf_text(notes_pdf.render(case, title="T", text=text, look=look(style=style, numbered=True)).pdf)
        assert "Figure 1. Smoke over the port" in printed
        assert "Figure 2. Second frame" in printed


def test_a_picture_with_no_caption_prints_none_in_plain(tmp_path):
    printed = pdf_text(notes_pdf.render(picture_case(tmp_path), title="T", text="[[media:m1|Frame]]\n").pdf)
    assert "Frame" not in printed.replace("T\n", "")


@pytest.mark.parametrize("style", ["plain", "report", "brief", "journal"])
def test_a_long_caption_stays_on_its_picture_s_page(tmp_path, style):
    """The room under a picture is measured, so the words under it are never sent
    to the next page without it."""
    png(tmp_path, "media/tall.png", size=(900, 1000))
    case = FakeCase(tmp_path, {"m1": {"id": "m1", "type": "media", "label": "Tall",
                                      "attrs": {"path": "media/tall.png", "kind": "image"}}})
    words = "a long caption that wraps " * 11
    for lead in (12, 21, 30):
        text = "\n\n".join(f"Line {n}." for n in range(lead)) + f'\n\n[[media:m1|Tall]]{{width=60% caption="{words.strip()}"}}\n'
        out = notes_pdf.render(case, title="T", text=text, look=look(style=style))
        [picture] = out.pictures
        printed = pages(out.pdf)
        on_its_page = " ".join(printed[picture.page].split())
        assert "a long caption that wraps" in on_its_page, (lead, picture.page)
        assert all("caption that wraps" not in page for number, page in enumerate(printed) if number != picture.page)


def test_a_caption_written_with_a_dash_or_an_accent_reads_back_as_written(tmp_path):
    text = '[[media:m1|Frame]]{caption="Café — Ж ’quoted’ 100%"}\n'
    assert "Café — Ж ’quoted’ 100%" in pdf_text(notes_pdf.render(picture_case(tmp_path), title="T", text=text).pdf)


# -- credit lines -------------------------------------------------------------------


def test_a_picture_from_the_web_says_where_and_links_there(tmp_path):
    url = "https://www.example.org/2026/11/04/port-strike"
    out = notes_pdf.render(picture_case(tmp_path, source_url=url), title="T", text="[[media:m1|Frame]]\n",
                           look=look(style="report"))
    assert "Source: example.org" in pdf_text(out.pdf)
    assert url in link_targets(out.pdf)


def test_a_capture_says_its_imagery_and_its_day(tmp_path):
    png(tmp_path, "media/sat.png")
    entities = {"c1": {"id": "c1", "type": "capture", "label": "Sat",
                       "attrs": {"path": "media/sat.png", "kind": "image", "provider": "esri"}}}
    items = {"media/sat.png": {"path": "media/sat.png", "entity_id": "c1", "source": {
        "type": "satellite", "provider_label": "Esri World Imagery", "imagery_date": "2024-03-12",
        "imagery_exact": False}}}
    out = notes_pdf.render(IndexedCase(tmp_path, entities, items), title="T", text="[[media:c1|Sat]]\n")
    assert "Imagery: Esri World Imagery, about 12 March 2024" in pdf_text(out.pdf)
    # found by its address too, through the case's index
    by_path = notes_pdf.render(IndexedCase(tmp_path, entities, items), title="T",
                               text="![sat](/files/demo/media/sat.png)\n")
    assert "Imagery: Esri World Imagery" in pdf_text(by_path.pdf)


def test_a_picture_the_case_knows_nothing_about_has_no_credit(tmp_path):
    out = notes_pdf.render(picture_case(tmp_path), title="T", text="[[media:m1|Frame]]\n", look=look(style="brief"))
    assert "Source:" not in pdf_text(out.pdf) and "Imagery:" not in pdf_text(out.pdf)
    assert link_targets(out.pdf) == []


def test_a_credit_is_one_line_cut_rather_than_wrapped(tmp_path):
    host = "a-very-long-host-name-that-never-ends-" * 4 + "example.org"
    out = notes_pdf.render(picture_case(tmp_path, source_url=f"https://{host}/x"), title="T",
                           text="[[media:m1|Frame]]{width=20%}\n", look=look(style="report"))
    [credit] = [line for line in pdf_text(out.pdf).splitlines() if line.startswith("Source:")]
    assert credit.endswith("…")


# -- sources stay clickable --------------------------------------------------------


def source_case(tmp_path):
    return FakeCase(tmp_path, {
        "acct": {"id": "acct", "type": "account", "label": "@watch", "attrs": {"url": "https://x.com/watch"}},
        "bm": {"id": "bm", "type": "bookmark", "label": "Notice",
               "attrs": {"archive_url": "https://web.archive.org/web/2026/https://port.example/notice"}},
        "bad": {"id": "bad", "type": "account", "label": "@bad", "attrs": {"url": "javascript:alert(1)"}},
        "place": {"id": "place", "type": "place", "label": "Berth 12", "attrs": {}},
    })


def test_a_reference_to_a_record_with_an_address_links_to_it(tmp_path):
    text = ("[[entity:acct|@watch]] posted it, [[entity:bm|the notice]] says so, at [[entity:place|Berth 12]];"
            " [[entity:bad|@bad]] and [[entity:gone|a deleted one]].\n")
    out = notes_pdf.render(source_case(tmp_path), title="T", text=text)
    assert sorted(link_targets(out.pdf)) == ["https://web.archive.org/web/2026/https://port.example/notice",
                                             "https://x.com/watch"]
    assert "@watch posted it" in pdf_text(out.pdf)


def test_a_bookmark_links_to_its_page_before_its_archived_copy(tmp_path):
    case = FakeCase(tmp_path, {
        "bm": {"id": "bm", "type": "bookmark", "label": "Notice",
               "attrs": {"url": "https://port.example/notice", "archive_url": "https://web.archive.org/x"}},
        "m": {"id": "m", "type": "media", "label": "Clip", "attrs": {"source_url": "https://video.example/1",
                                                                       "url": "ftp://not.a.web/address"}},
    })
    out = notes_pdf.render(case, title="T", text="[[entity:bm|The notice]] and [[entity:m|the clip]].\n")
    assert link_targets(out.pdf) == ["https://port.example/notice", "https://video.example/1"]


def test_a_link_in_a_table_cell_stays_a_link(tmp_path):
    text = ("| Who | Where | Page |\n|---|---|---|\n"
            "| [[entity:acct|@watch]] | 14.7980, 42.9540 | [notice](https://port.example/n) |\n| plain | text | none |\n")
    for style in ("plain", "report"):
        out = notes_pdf.render(source_case(tmp_path), title="T", text=text, look=look(style=style))
        targets = link_targets(out.pdf)
        assert "https://x.com/watch" in targets and "https://port.example/n" in targets
        assert any("openstreetmap.org/?mlat=14.7980&mlon=42.9540" in target for target in targets)
        assert "plain" in pdf_text(out.pdf)


def test_decimal_coordinates_link_to_the_map_and_numbers_do_not(tmp_path):
    text = ("Seen at 14.7980, 42.9540 and at -33.8568,151.2153. Version 1.2.3, a score of 0.5, 0.75,"
            " out of range 95.1234, 10.1234 and `12.3456, 45.6789` in code, [33.1111, 36.2222](https://e.org)"
            " already a link, Arabic digits ١٤٫٧٩٨٠, ٤٢٫٩٥٤٠ and ၁၄.၇၉၈၀, ၄၂.၉၅၄၀ in Burmese.\n\n"
            "```\n14.7980, 42.9540 in a code block\n```\n")
    out = notes_pdf.render(None, title="T", text=text)
    assert link_targets(out.pdf) == [
        "https://www.openstreetmap.org/?mlat=14.7980&mlon=42.9540#map=17/14.7980/42.9540",
        "https://www.openstreetmap.org/?mlat=-33.8568&mlon=151.2153#map=17/-33.8568/151.2153",
        "https://e.org",
    ]
    assert "Seen at 14.7980, 42.9540 and at -33.8568,151.2153." in pdf_text(out.pdf)


# -- warnings and their lines ------------------------------------------------------


SECTIONS = """# Report

## Summary

Words.

## Method

<!--? Say how the place was found. -->

## Findings

### Pictures

### Sightings

Seen twice.

## Annex

[[include:chap]]

## Last
"""


def test_a_section_with_nothing_under_it_is_named_with_its_line(tmp_path):
    out = notes_pdf.render(FakeCase(tmp_path), title="Report", text=SECTIONS,
                           resolve=lambda note: ("Chapter", "Words in it.") if note == "chap" else None)
    found = dict(zip(out.warnings, out.warning_lines))
    assert found == {'Section "Method" is empty.': 6, 'Section "Pictures" is empty.': 12,
                     'Section "Last" is empty.': 22}
    assert len(out.warnings) == len(out.warning_lines)


def test_a_template_s_empty_sections_are_not_warnings():
    out = notes_pdf.render(None, title="Report", text=SECTIONS)
    assert not any("is empty" in warning for warning in out.warnings)


def test_a_journal_s_entries_are_not_sections_waiting_for_words(tmp_path):
    text = "## Day one\n\n### 2026-11-04 14:32 (UTC+1) Strike seen\n\n### 2026-11-04 15:00 Smoke\n"
    out = notes_pdf.render(FakeCase(tmp_path), title="Log", text=text, look=look(style="journal"))
    assert out.warnings == []


def test_many_empty_sections_are_counted_past_the_first_ten(tmp_path):
    text = "\n\n".join(f"## Part {n}" for n in range(14))
    out = notes_pdf.render(FakeCase(tmp_path), title="T", text=text)
    assert len(out.warnings) == 11
    assert out.warnings[-1] == "4 more sections are empty." and out.warning_lines[-1] is None


def test_a_missing_picture_is_a_warning_pointing_at_its_line(tmp_path):
    case = FakeCase(tmp_path, {"gone": {"id": "gone", "type": "media", "label": "Gone", "attrs": {}}})
    out = notes_pdf.render(case, title="T", text="Intro.\n\n[[media:gone|Roof at dawn]]\n\n![x](https://e.org/x.png)\n")
    assert dict(zip(out.warnings, out.warning_lines)) == {
        'Picture "Roof at dawn" could not be printed: it is missing from the case.': 2,
        "1 remote image left out: the export never fetches from the network.": 4,
    }


def test_the_preview_sends_each_warning_s_line_beside_it(client):
    cid = make_case(client)
    note = make_note(client, cid, content="Body.\n")
    text = "# Rooftop\n\n## Method\n\n## Findings\n\nSeen.\n\n![x](https://example.org/x.png)\n"
    response = client.post(f"/api/cases/{cid}/notes/preview", json={"note": note["id"], "text": text})
    assert response.status_code == 200, response.text
    warnings = json.loads(response.headers["x-note-warnings"])
    lines = json.loads(response.headers["x-note-warning-lines"])
    assert len(warnings) == len(lines)
    assert dict(zip(warnings, lines))['Section "Method" is empty.'] == 2
    assert response.headers["x-note-warning-lines"].isascii()
    template = client.post("/api/templates/note/preview", json={"text": SECTIONS})
    assert json.loads(template.headers["x-note-warnings"]) == []
    assert json.loads(template.headers["x-note-warning-lines"]) == []


def test_the_warning_lines_are_capped_with_the_warnings(monkeypatch):
    rendered = notes_pdf.Rendered(pdf=b"%PDF-", warnings=[f"w{n}" for n in range(30)],
                                  warning_lines=list(range(30)))
    monkeypatch.setattr(notes_pdf, "render", lambda *args, **kwargs: rendered)
    response = notes_api.preview_response(None, title="T", text="x", look=NoteLook(), diagrams={})
    assert len(json.loads(response.headers["x-note-warnings"])) == notes_api.MAX_HEADER_WARNINGS
    assert json.loads(response.headers["x-note-warning-lines"]) == list(range(notes_api.MAX_HEADER_WARNINGS))


# -- the page holds together ------------------------------------------------------


@pytest.mark.parametrize("style", ["plain", "report", "brief", "journal"])
def test_a_table_s_header_row_is_repeated_on_every_page_it_runs_onto(style):
    rows = "\n".join(f"| {n} | row {n} of the sightings table |" for n in range(90))
    out = notes_pdf.render(None, title="T", text=f"| Number | Sighting |\n|---|---|\n{rows}\n",
                           look=look(style=style))
    printed = pages(out.pdf)
    assert len(printed) >= 2
    assert all("Number" in page and "Sighting" in page for page in printed)


@pytest.mark.parametrize("style", ["plain", "report", "brief", "journal"])
def test_a_heading_goes_with_the_heading_and_picture_under_it(tmp_path, style):
    png(tmp_path, "media/wide.png", size=(1600, 900))
    case = FakeCase(tmp_path, {"m1": {"id": "m1", "type": "media", "label": "Wide",
                                      "attrs": {"path": "media/wide.png", "kind": "image"}}})
    for lead in (16, 20, 24, 28):
        text = "\n\n".join(f"Line {n}." for n in range(lead)) + "\n\n## Findings\n\n### Pictures\n\n[[media:m1|Wide]]{width=100%}\n"
        out = notes_pdf.render(case, title="T", text=text, look=look(style=style))
        [picture] = out.pictures
        printed = pages(out.pdf)
        heading_page = next(number for number, page in enumerate(printed) if "findings" in page.lower())
        assert heading_page == picture.page and "pictures" in printed[picture.page].lower(), lead


@pytest.mark.parametrize("values", [
    {"style": "plain", "font": "book", "size": "large"},
    {"style": "report", "font": "modern", "page": "letter"},
    {"style": "brief", "size": "small"},
    {"style": "journal", "font": "sans", "size": "large"},
])
def test_nothing_starts_past_the_side_margins(tmp_path, values):
    """Long addresses, long captions and long code lines are cut where they would
    otherwise run off the page."""
    url = "https://www.example.org/" + "a-very-long-path-segment/" * 12
    case = picture_case(tmp_path, source_url=url)
    text = (f"An address {url} in prose.\n\n"
            f'[[media:m1|Frame]]{{width=25% align=right caption="{"word " * 50}"}}\n\n'
            f"```\n{'x' * 300}\n```\n\n| A | B |\n|---|---|\n| {url} | b |\n")
    out = notes_pdf.render(case, title="T", text=text, look=look(**values))
    theme = notes_style.theme_for(look(**values))
    for page in PdfReader(BytesIO(out.pdf)).pages:
        starts: list[float] = []
        def seen(text, cm, tm, *_):
            if text.strip():
                starts.append(tm[4] * cm[0] + tm[5] * cm[2] + cm[4])

        page.extract_text(visitor_text=seen)
        width = float(page.mediabox.width)
        for x in starts:
            assert theme.margin_side * 72 / 25.4 - 3 <= x <= width - theme.margin_side * 72 / 25.4, x


def test_wrapping_cuts_a_word_wider_than_its_line():
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", size=10)
    lines = notes_pdf._wrap_words(pdf, "short " + "x" * 80 + " end", 40, 30)
    assert all(pdf.get_string_width(line) <= 40 for line in lines)
    assert "".join(lines).replace(" ", "") == "short" + "x" * 80 + "end"


def test_a_real_case_credits_an_uploaded_picture_with_the_page_it_came_from(client):
    """Through the case's own index, as the export reads it, both ways a note can
    show the picture."""
    import io
    from urllib.parse import quote

    from PIL import Image

    cid = make_case(client)
    buffer = io.BytesIO()
    Image.new("RGB", (320, 180), (40, 90, 140)).save(buffer, "PNG")
    uploaded = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("roof.png", io.BytesIO(buffer.getvalue()), "image/png")},
        data={"source_url": "https://www.example.org/posts/1"},
    )
    assert uploaded.status_code == 200, uploaded.text
    path = uploaded.json()["item"]["path"]
    entity = client.get(f"/api/cases/{cid}/entities/lookup", params={"attr": "path", "value": path}).json()["entity"]
    assert " " in cid  # written as the browser writes it, encoded
    address = f"/files/{quote(cid)}/{path}"
    text = f"[[media:{entity['id']}|Roof]]\n\n![roof]({address})\n\nBy [[entity:{entity['id']}|the uploader]].\n"
    response = client.post(f"/api/cases/{cid}/notes/preview", json={"note": "case", "text": text})
    assert response.status_code == 200, response.text
    assert pdf_text(response.content).count("Source: example.org") == 2
    assert link_targets(response.content).count("https://www.example.org/posts/1") == 3


# -- what a picture's file knows stays out of the PDF ---------------------------


def every_stream(data: bytes) -> bytes:
    """Every stream in the file, raw and decoded, so nothing compressed hides."""
    reader = PdfReader(BytesIO(data))
    found = [data]
    for number in range(1, int(reader.trailer["/Size"])):
        item = reader.get_object(number)
        if hasattr(item, "get_data"):
            found.append(item._data or b"")
            try:
                found.append(item.get_data())
            except Exception:
                pass
    return b"\n".join(found)


def camera_jpeg(path, *, orientation=1, size=(60, 30)):
    from PIL import Image

    exif = Image.Exif()
    exif[0x010E] = "SECRETPLACE written by the camera"
    exif[0x0112] = orientation
    exif[0x8825] = {1: "N", 2: (48.0, 51.0, 24.123), 3: "E", 4: (2.0, 17.0, 40.5)}
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (200, 40, 40)).save(
        path, "JPEG", exif=exif.tobytes(), comment=b"SECRETCOMMENT",
        xmp=b"<x:xmpmeta>SECRETXMP</x:xmpmeta>",
    )
    return path


@pytest.mark.parametrize("orientation", [1, 6])
def test_a_photo_s_gps_and_metadata_never_reach_the_pdf(tmp_path, orientation, monkeypatch):
    monkeypatch.setattr(notes_pdf, "DECODED", notes_pdf._DecodedImages())
    camera_jpeg(tmp_path / "media" / "photo.jpg", orientation=orientation)
    case = FakeCase(tmp_path, {"p": {"id": "p", "type": "media", "label": "Photo",
                                     "attrs": {"path": "media/photo.jpg", "kind": "image"}}})
    text = "[[media:p|Photo]]\n\n![again](/files/demo/media/photo.jpg)\n"
    look_ = look(style="report", cover={"on": True, "image": "p"})
    for _ in range(2):  # the second time from the kept decoding
        out = notes_pdf.render(case, title="T", text=text, look=look_)
        streams = every_stream(out.pdf)
        for secret in (b"Exif", b"SECRETPLACE", b"SECRETCOMMENT", b"SECRETXMP", b"http://ns.adobe.com/xap"):
            assert secret not in streams, secret
        [image] = [obj for page in PdfReader(BytesIO(out.pdf)).pages[1:2] for obj in page.images]
        assert image.data.startswith(b"\xff\xd8")


def test_a_photo_without_a_turn_keeps_its_pixels_byte_for_byte(tmp_path):
    original = camera_jpeg(tmp_path / "photo.jpg").read_bytes()
    clean = notes_pdf._clean_jpeg(original)
    scan = original.index(b"\xff\xda")
    assert clean is not None and clean.endswith(original[scan:])
    assert notes_pdf._clean_jpeg(b"\x89PNG not a jpeg") is None


def test_a_photo_turned_by_its_exif_prints_upright(tmp_path):
    camera_jpeg(tmp_path / "media" / "photo.jpg", orientation=6, size=(60, 30))
    case = FakeCase(tmp_path, {"p": {"id": "p", "type": "media", "label": "Photo",
                                     "attrs": {"path": "media/photo.jpg", "kind": "image"}}})
    out = notes_pdf.render(case, title="T", text="[[media:p|Photo]]\n")
    [picture] = out.pictures
    left, top, width, height = picture.box
    assert height * 297 > width * 210  # taller than wide on the page, as a viewer shows it
    [image] = PdfReader(BytesIO(out.pdf)).pages[0].images
    assert (image.image.width, image.image.height) == (30, 60)


def test_a_png_s_text_chunks_never_reach_the_pdf(tmp_path):
    from PIL import Image, PngImagePlugin

    meta = PngImagePlugin.PngInfo()
    meta.add_text("Comment", "SECRETPNGTEXT")
    meta.add_itxt("Description", "SECRETPNGITXT")
    path = tmp_path / "media" / "shot.png"
    path.parent.mkdir(parents=True)
    exif = Image.Exif()
    exif[0x010E] = "SECRETPNGEXIF"
    Image.new("RGB", (40, 30), (10, 120, 60)).save(path, pnginfo=meta, exif=exif.tobytes())
    out = notes_pdf.render(FakeCase(tmp_path), title="T", text="![shot](/files/demo/media/shot.png)\n")
    streams = every_stream(out.pdf)
    for secret in (b"SECRETPNGTEXT", b"SECRETPNGITXT", b"SECRETPNGEXIF", b"eXIf"):
        assert secret not in streams, secret
