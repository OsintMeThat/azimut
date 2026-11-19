"""An infographic in a note (`engine/notes_infographic.py`): the `:::: infographic` wrapper,
its two columns of half and wide panels, one legend for a shared colour column, one colour a
value and one source line across the page, the honesty rules over every panel, and what the
PDF, the HTML report, its web folder, WordPress, To Post and the route make of it."""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from PIL import Image
from pypdf import PdfReader

from azimut.engine import notefill, notepieces, notes_charts, notes_html, notes_infographic, notes_maps, notes_pdf, notes_web
from azimut.engine import notes_infographic as ig
from azimut.engine import notes_markdown as md
from azimut.engine import notes_wordpress as wp
from azimut.workspace import Case

from test_notes_report import make_case, make_note
from test_notes_wordpress import SAVED, _blocks, _placed

FIXTURES = Path(__file__).parent / "fixtures" / "notes_charts"
ARMOURED = (FIXTURES / "armoured.md").read_text(encoding="utf-8").strip()
GROUPS = (FIXTURES / "groups.md").read_text(encoding="utf-8").strip()

FIGURES = """::: chart
kind: key figures
source: our vehicle register
| Figure | Words |
| --- | --- |
| 51 of 54 | vehicles we could place lie in about 15 km² |
| 11 in 360 m | at the container roadblock |
:::"""
MADE_IN = """::: chart
kind: donut
title: Where the 35 identified vehicles were made
highlight: UAE
source: our vehicle register
| Made in | Vehicles |
| --- | ---: |
| UAE | 22 |
| USA | 9 |
| Jordan | 2 |
:::"""
WORDS = "### Where they lie\nSix groups, none wider than 1.3 km."
#: The reference's first rows: a band, key figures across, two charts that colour by grade, a donut.
GRAPHIC = f""":::: infographic
kicker: Bab al-Mandab, Yemen · October to November 2026
title: At least 60 vehicles lost on one road
standfirst: Every figure is a minimum: it covers only what the two videos show.

{FIGURES}

{ARMOURED}

{MADE_IN}

{WORDS}

{GROUPS}
::::"""
NOTE = f"# Losses\n\nWhat the videos show.\n\n{GRAPHIC}\n\nAfter the page.\n"


def _page(body: str = GRAPHIC, **options) -> ig.Page:
    return ig.read(None, ig.block_of(body), **options)


def _texts(drawing: notes_charts.Layout) -> list[str]:
    """Every word a drawing sets, its groups opened."""
    out: list[str] = []

    def walk(mark: notes_charts.Mark) -> None:
        if isinstance(mark, notes_charts.Group):
            for inner in mark.marks:
                walk(inner)
        elif isinstance(mark, notes_charts.Text):
            out.append(mark.text)

    for mark in drawing.marks:
        walk(mark)
    return out


def _case(client, name="Infographics") -> tuple[str, Case]:
    cid = make_case(client, name)
    return cid, Case.open(cid)


# -- the grammar ------------------------------------------------------------------------------------


def test_the_wrapper_reads_its_band_and_its_panels_in_order():
    graphic = ig.parse_block(ig.block_of(GRAPHIC))
    assert graphic.kicker == "Bab al-Mandab, Yemen · October to November 2026"
    assert graphic.title == "At least 60 vehicles lost on one road"
    assert graphic.standfirst.startswith("Every figure is a minimum")
    assert [panel.kind for panel in graphic.panels] == ["chart", "chart", "chart", "words", "chart"]
    # words, key figures and a timeline span the page unless written; the rest take a column
    assert [panel.width for panel in graphic.panels] == ["wide", "half", "half", "wide", "half"]
    assert graphic.panels[3].body == WORDS
    assert graphic.unread == []


def test_widths_are_written_in_reading_order_and_a_wrong_word_is_said():
    body = ":::: infographic\nwidths: half, wide, sideways\n\n" + "\n\n".join([FIGURES, ARMOURED, MADE_IN]) + "\n::::"
    graphic = ig.parse_block(ig.block_of(body))
    assert [panel.width for panel in graphic.panels] == ["half", "wide", "half"]
    assert graphic.unread == [(0, "widths: half, wide, sideways", '"sideways" is no width: write half or wide')]
    too_many = ig.parse_block("widths: half, half, half\n" + FIGURES)
    assert "widths names 3 panels and the infographic holds 1" in too_many.unread[0][2]


def test_a_look_is_one_of_the_three_presets():
    assert ig.parse_block("look: book\n" + FIGURES).look == "book"
    assert ig.parse_block("look: neon\n" + FIGURES).unread[0][2] == '"neon" is no look: write report, book or dark'


def test_guidance_alone_is_no_panel_and_an_empty_wrapper_says_so():
    graphic = ig.parse_block("<!--? Add its panels from the builder -->")
    assert graphic.panels == []
    page = _page(":::: infographic\n<!--? Add its panels -->\n::::")
    assert (ig.NO_PANEL, notes_charts.OTHER_KIND, None) in page.warnings


def test_the_outer_fence_is_read_before_the_blocks_inside_it():
    blocks = md.alignment_blocks(NOTE)
    kinds = [block.kind for block in blocks]
    assert kinds.count(md.INFOGRAPHIC) == 1 and md.CHART not in kinds and md.MAP not in kinds
    wrapper = next(block for block in blocks if block.kind == md.INFOGRAPHIC)
    assert wrapper.tokens[0].type == md.INFOGRAPHIC_TOKEN
    assert NOTE.split("\n")[wrapper.line] == "kicker: Bab al-Mandab, Yemen · October to November 2026"
    # a chart after the wrapper is a chart of its own again
    after = md.alignment_blocks(NOTE + "\n" + MADE_IN + "\n")
    assert [block.kind for block in after if block.kind] == [md.INFOGRAPHIC, md.CHART]


def test_a_wrapper_in_a_code_fence_is_an_example():
    text = f"```\n{GRAPHIC}\n```\n"
    assert not [block for block in md.alignment_blocks(text) if block.kind]
    assert ig.blocks_in(text) == []


def test_a_panel_reads_the_same_inside_and_out():
    page = _page()
    inside = page.panels[1].chart
    alone = notes_charts.layout(notes_charts.parse_block(ig.block_of(ARMOURED).split("\n", 1)[1].rsplit("\n", 1)[0]),
                                width=inside.width)
    assert [(bar.name, bar.total) for bar in inside.bars] == [(bar.name, bar.total) for bar in alone.bars]
    assert inside.title == alone.title


# -- the layout -----------------------------------------------------------------------------------------


def test_half_panels_fill_the_shorter_column_and_a_wide_one_starts_below_both():
    page = _page()
    assert [len(band.panels) for band in page.bands] == [1, 2, 1, 1]
    figures, (armoured, made), words, groups = (page.bands[0].panels[0], page.bands[1].panels,
                                                page.bands[2].panels[0], page.bands[3].panels[0])
    content = ig.PAGE_WIDTH - 2 * ig.MARGIN
    column = (content - ig.GUTTER) / 2
    assert (figures.column, figures.x, figures.w) == (-1, ig.MARGIN, content)
    assert (armoured.column, made.column) == (0, 1)
    assert armoured.w == made.w == column and made.x == ig.MARGIN + column + ig.GUTTER
    # a band is as tall as its taller column
    assert page.bands[1].height == pytest.approx(max(armoured.h, made.h))
    assert words.column == -1 and groups.column == 0


def test_three_half_panels_put_the_third_under_the_shorter_one():
    tall, short = ARMOURED, MADE_IN
    body = ":::: infographic\n" + "\n\n".join([tall, short, short.replace("UAE highlighted", "")]) + "\n::::"
    page = _page(body)
    first, second, third = page.bands[0].panels
    assert first.h > second.h
    assert (first.column, second.column, third.column) == (0, 1, 1)
    assert third.y == pytest.approx(second.h + ig.GAP)


def test_the_boxes_say_where_each_panel_stands_on_the_drawing():
    page = _page()
    drawing = ig.compose(page)
    boxes = ig.boxes(page)
    assert [box["index"] for box in boxes] == [0, 1, 2, 3, 4]
    assert all(0 <= box["x"] and box["x"] + box["w"] <= drawing.width + 0.5 for box in boxes)
    assert all(box["y"] + box["h"] <= drawing.height for box in boxes)
    assert boxes[1]["y"] == boxes[2]["y"] and boxes[3]["y"] > boxes[1]["y"] + boxes[1]["h"]


# -- one legend, one colour a value, one source line ------------------------------------------------------


def test_charts_that_colour_by_the_same_column_share_one_legend_on_top():
    page = _page()
    assert page.shared == "Grade"
    # every value of the column, a zero one included
    assert [swatch.value for swatch in page.legend] == ["Confirmed", "Almost sure", "Strong doubt", "Set aside"]
    shared = [drawn for drawn in page.panels if drawn.shares]
    assert [drawn.index for drawn in shared] == [1, 4]
    # the shared charts draw no legend of their own, and still say theirs
    alone = notes_charts.layout(notes_charts.parse_block(page.panels[1].panel.body), width=page.panels[1].chart.width)
    assert page.panels[1].chart.height < alone.height and page.panels[1].chart.legend
    texts = _texts(ig.compose(page))
    assert texts.count("Set aside") == 1


def test_one_legend_each_panel_when_the_wrapper_says_so():
    page = _page(GRAPHIC.replace("standfirst:", "legend: each panel\nstandfirst:"))
    assert page.shared == "" and page.legend == [] and not any(drawn.shares for drawn in page.panels)


def test_a_highlight_keeps_its_own_colours_and_a_value_is_one_colour_on_the_page():
    first = "::: chart\nkind: bars\ntitle: At least 4\ncolour by: Side\nsource: x\n| Unit | Side | N |\n| --- | --- | ---: |\n" \
            "| a | North | 1 |\n| b | South | 3 |\n:::"
    second = "::: chart\nkind: bars\ntitle: At least 4\ncolour by: Side\nsource: x\n| Unit | Side | N |\n| --- | --- | ---: |\n" \
             "| c | South | 1 |\n| d | North | 3 |\n:::"
    page = _page(f":::: infographic\n{first}\n\n{second}\n::::")
    one, two = (drawn.chart for drawn in page.panels)
    paint = {swatch.value: swatch.paint.colour for swatch in one.legend}
    assert paint == {swatch.value: swatch.paint.colour for swatch in two.legend}
    assert len(set(paint.values())) == 2


def test_one_source_line_gathered_from_the_panels():
    page = _page()
    assert page.credits == ["our vehicle register"]
    texts = _texts(ig.compose(page))
    assert "Source." in texts and texts.count("Source: our vehicle register") == 0
    unsourced = _page(":::: infographic\n" + FIGURES.replace("source: our vehicle register\n", "") + "\n::::")
    assert (ig.NO_SOURCE, notes_charts.UNSOURCED, None) in unsourced.warnings


# -- honesty across the page ----------------------------------------------------------------------------


def test_a_title_stating_a_number_says_at_least_when_a_panel_counts_a_floor():
    body = GRAPHIC.replace("title: At least 60 vehicles lost on one road", "title: 60 vehicles lost on one road") \
        .replace("standfirst: Every figure is a minimum: it covers only what the two videos show.\n", "")
    page = _page(body)
    said = [warning for warning in page.warnings if warning[0].startswith('The infographic "60 vehicles')]
    assert said == [('The infographic "60 vehicles lost on one road" counts at least: say so in its title.',
                     notes_charts.OTHER_KIND, 1)]


def test_a_band_that_says_its_figures_are_floors_says_it_for_every_panel():
    untitled = ARMOURED.replace("title: At least 41 armoured vehicles, by model and grade\n", "title: What was lost\n")
    said = _page(GRAPHIC.replace(ARMOURED, untitled))
    assert not [warning for warning in said.warnings if "counts at least" in warning[0]]
    unsaid = _page(GRAPHIC.replace(ARMOURED, untitled).replace("title: At least 60 vehicles lost on one road\n", "")
                   .replace("standfirst: Every figure is a minimum: it covers only what the two videos show.\n", ""))
    floor = [warning for warning in unsaid.warnings if '"What was lost" counts at least' in warning[0]]
    # at the panel's own title line, counted from the wrapper's first line
    lines = ig.block_of(GRAPHIC.replace(ARMOURED, untitled)).split("\n")
    assert floor and lines[floor[0][2] + 2] == "title: What was lost"


def test_a_chart_warning_points_at_its_line_in_the_note(tmp_workspace):
    text = NOTE.replace("order: Confirmed, Almost sure, Strong doubt, Set aside\n", "order: Confirmed, Almost sure, Strong doubt, Set aside\nshape: round\n")
    rendered = notes_html.render(None, title="Losses", text=text, identity=notefill.Identity())
    said = dict(zip(rendered.warnings, rendered.warning_lines))
    unread = next(message for message in said if "shape" in message)
    assert text.split("\n")[said[unread]] == "shape: round"


# -- the pictures ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(("destination", "ratio"), [("x", 16 / 9), ("portrait", 4 / 5), ("square", 1.0)])
def test_one_picture_at_each_of_x_shapes_nothing_cut(destination, ratio):
    page = _page()
    with Image.open(io.BytesIO(ig.picture(page, destination))) as picture:
        assert picture.width / picture.height == pytest.approx(ratio, abs=0.002)
        assert ig.MIN_PICTURE <= picture.width <= ig.MAX_PICTURE


def test_a_tall_page_is_set_in_strips_for_a_wide_picture():
    page = _page()
    assert ig.fitted(page, 16 / 9).facts["strips"] > 1
    assert ig.compose(page).facts["strips"] == 1


def test_a_strip_never_ends_on_a_heading_and_the_tallest_is_as_short_as_it_gets():
    page = _page()
    for count in (2, 3):
        strips = ig._strips(page.bands, count)
        assert [band for strip in strips for band in strip] == page.bands
        for strip in strips[:-1]:
            assert not all(drawn.panel.kind == ig.WORDS for drawn in strip[-1].panels)
    two = ig._strips(page.bands, 2)
    tallest = max(sum(band.height for band in strip) + ig.GAP * (len(strip) - 1) for strip in two)
    assert tallest < sum(band.height for band in page.bands)


def test_the_pdf_page_picture_is_the_page_at_twice_its_pixels():
    page = _page()
    with Image.open(io.BytesIO(ig.picture(page, "page"))) as picture:
        assert picture.width == ig.PAGE_WIDTH * 2
        assert picture.height == round(ig.compose(page).height * 2)


def test_the_svg_holds_every_panel_and_its_words():
    markup = ig.svg(_page(), ident="infographic-test")
    assert markup.startswith('<svg xmlns="http://www.w3.org/2000/svg" id="infographic-test"')
    for words in ("At least 60 vehicles lost on one road", "51 of 54", "Streit Cougar", "Where they lie", "Source."):
        assert words in markup


def test_a_page_too_tall_for_a_sheet_breaks_between_bands_only():
    page = _page()
    parts = ig.chunks(page, 900.0)
    assert len(parts) > 1
    total = sum(len(band.panels) for band in page.bands)
    texts = [_texts(part) for part in parts]
    assert "At least 60 vehicles lost on one road" in texts[0] and "Source." in texts[-1]
    assert total == 5 and sum(text.count("Where they lie") for text in texts) == 1


# -- the documents ----------------------------------------------------------------------------------------


def _pdf_words(pdf: bytes) -> list[str]:
    return [" ".join((page.extract_text() or "").split()) for page in PdfReader(io.BytesIO(pdf)).pages]


def test_the_pdf_prints_it_on_a_page_of_its_own(tmp_workspace):
    rendered = notes_pdf.render(None, title="Losses", text=NOTE, identity=notefill.Identity())
    pages = _pdf_words(rendered.pdf)
    reader = PdfReader(io.BytesIO(rendered.pdf))
    with_pictures = [number for number, page in enumerate(reader.pages) if page.images]
    assert with_pictures and with_pictures[0] > 0
    assert "What the videos show" in pages[0] and "After the page" not in pages[with_pictures[-1]]
    assert "After the page" in pages[with_pictures[-1] + 1]
    assert b"/Alt" in rendered.pdf


def test_an_infographic_last_in_a_note_prints_no_blank_page_after_it(tmp_workspace):
    rendered = notes_pdf.render(None, title="Losses", text=f"# Losses\n\n{GRAPHIC}\n", identity=notefill.Identity())
    reader = PdfReader(io.BytesIO(rendered.pdf))
    assert reader.pages[-1].images


def test_a_numbered_look_numbers_no_panel_of_it(tmp_workspace):
    from azimut.engine.notelook import NoteLook

    text = f"{NOTE}\n{MADE_IN}\n"
    rendered = notes_pdf.render(None, title="Losses", text=text, look=NoteLook(style="report", numbered=True),
                                identity=notefill.Identity())
    words = " ".join(_pdf_words(rendered.pdf))
    assert "Figure 1. Where the 35 identified vehicles were made" in words and "Figure 2" not in words


def test_the_html_lays_the_panels_in_two_columns_and_wide_rows(tmp_workspace):
    rendered = notes_html.render(None, title="Losses", text=NOTE, identity=notefill.Identity())
    page = rendered.html.decode("utf-8")
    figure = re.search(r'<figure class="az-infographic".*?</figure>\n(?=<p)', page, re.S).group(0)
    # a lone half panel keeps its column, the other one left empty
    assert figure.count('class="az-ig-row az-ig-pair"') == 2 and figure.count('<div class="az-ig-row">') == 2
    assert '<p class="az-ig-title" role="heading" aria-level="2">At least 60 vehicles lost on one road</p>' in figure
    # each chart its own SVG, a wide one drawn again for a phone, its numbers under it
    assert figure.count('<svg xmlns="http://www.w3.org/2000/svg" id="infographic-1-1-wide"') == 1
    assert 'id="infographic-1-1-phone"' in figure and 'az-chart-both' in figure
    assert figure.count("<summary>The numbers</summary>") == 4
    # the shared legend once, the words' heading kept out of the contents
    assert 'class="az-ig-legend"' in figure and '<p class="az-ig-head" role="heading" aria-level="3"' in figure
    assert "<h3" not in figure
    assert '<p class="az-ig-sources"><strong>Source.</strong> Our vehicle register.</p>' in figure
    assert re.findall(r'style="--az-ig-o:(\d+)"', figure) == ["0", "1", "2", "3", "4"]


def test_the_style_sheet_turns_the_columns_into_one_on_a_phone():
    sheet = (notes_html.ASSETS / "reader.infographic.css").read_text(encoding="utf-8")
    assert ".az-ig-col { display: contents; }" in sheet and "order: var(--az-ig-o)" in sheet


def test_a_page_carries_the_figure_styles_only_when_it_holds_a_figure(tmp_workspace):
    from azimut.engine import notefill

    plain = notes_html.render(None, title="T", text="# T\n\nWords only.\n", identity=notefill.Identity()).html.decode()
    assert ".az-chart-frame" not in plain and ".az-ig-col" not in plain
    charted = notes_html.render(None, title="T", text=f"# T\n\n{MADE_IN}\n", identity=notefill.Identity()).html.decode()
    assert ".az-chart-frame" in charted and ".az-ig-col" not in charted


def test_a_map_panel_is_the_pages_own_map(tmp_workspace):
    body = GRAPHIC.replace(WORDS, "::: map\ntitle: Where they lie\nproofs: all\n:::")
    rendered = notes_html.render(None, title="Losses", text=f"# Losses\n\n{body}\n", identity=notefill.Identity())
    page = rendered.html.decode("utf-8")
    assert 'data-panel="map"' in page and 'class="az-map-data"' in page


def test_a_web_folder_carries_the_whole_page_as_one_picture(client):
    _, case = _case(client)
    folder = notes_html.Folder(csp=notes_web.folder_csp())
    rendered = notes_html.render(case, title="Losses", text=NOTE, public=True, folder=folder)
    page = rendered.html.decode("utf-8")
    picture = re.search(r'<p class="az-ig-whole"><a href="(assets/[^"]+\.png)" download>', page)
    assert picture and picture.group(1) in folder.files
    with Image.open(io.BytesIO(folder.files[picture.group(1)])) as drawn:
        assert drawn.width == ig.PAGE_WIDTH * 2
    assert not re.search(r"data:(image|video|audio|font)/", page)


def test_wordpress_takes_one_picture_and_the_numbers_of_each_chart(tmp_workspace):
    draft = wp.build(None, title="Losses", text=NOTE, identity=notefill.Identity())
    markup = draft.markup(_placed(draft))
    upload = draft.uploads[0]
    assert len(draft.uploads) == 1 and upload.mime == "image/png"
    assert upload.alt.startswith("At least 60 vehicles lost on one road. Every figure is a minimum")
    names = [name for name, _, _ in _blocks(markup)]
    assert names.count("image") == 1 and names.count("table") == 4 and "details" in names
    numbers = markup[markup.index("<summary>The numbers</summary>"):]
    assert "<strong>At least 41 armoured vehicles, by model and grade</strong>" in numbers
    for name, _, own in _blocks(markup):
        assert SAVED[name].fullmatch(re.sub(r"\n\n", "", own)), name


def test_to_post_hands_the_page_as_one_picture_for_x_filed_once(client):
    cid, case = _case(client)
    note = make_note(client, cid, title="Losses", content=NOTE)
    first = client.post(f"/api/cases/{cid}/notes/{note['id']}/pieces", json={"text": NOTE}).json()
    media = [piece for piece in first["pieces"] if piece["kind"] == "media"]
    assert len(media) == 1 and media[0]["alt"].startswith("At least 60 vehicles lost on one road.")
    with Image.open(case.resolve_inside(media[0]["path"])) as picture:
        assert picture.width / picture.height == pytest.approx(16 / 9, abs=0.002)
    again = client.post(f"/api/cases/{cid}/notes/{note['id']}/pieces", json={"text": NOTE}).json()
    assert [piece for piece in again["pieces"] if piece["kind"] == "media"] == media
    texts = [piece["text"] for piece in first["pieces"] if piece["kind"] == "text"]
    assert texts[-1] == "After the page."
    assert notepieces.hand(None, title="Losses", text=NOTE).left["other"] == 1


def test_a_map_inside_the_wrapper_is_still_found_by_what_reads_a_notes_maps():
    body = GRAPHIC.replace(WORDS, "::: map\nlayer: Front\nground: e_1234567890\n:::")
    found = notes_maps.blocks_in(body)
    assert [(block.layers, block.ground) for block in found] == [(["Front"], "e_1234567890")]


# -- the route -----------------------------------------------------------------------------------------


def test_the_route_answers_the_builders_page(client):
    cid, _ = _case(client)
    answer = client.post(f"/api/cases/{cid}/notes/infographic", json={"text": GRAPHIC})
    assert answer.status_code == 200
    body = answer.json()
    assert body["svg"].startswith("<svg") and body["title"] == "At least 60 vehicles lost on one road"
    assert [panel["kind"] for panel in body["panels"]] == ["chart", "chart", "chart", "words", "chart"]
    assert body["panels"][0]["chart"] == "key figures" and body["panels"][1]["width"] == "half"
    assert body["legend"]["column"] == "Grade"
    assert [one["value"] for one in body["legend"]["values"]][:2] == ["Confirmed", "Almost sure"]
    assert body["legend"]["values"][2]["hatch"] is True and body["credit"] == "our vehicle register"


@pytest.mark.parametrize(("size", "ratio"), [("x", 16 / 9), ("square", 1.0), ("portrait", 0.8)])
def test_the_route_paints_a_picture_for_each_shape(client, size, ratio):
    cid, _ = _case(client)
    answer = client.post(f"/api/cases/{cid}/notes/infographic", json={"text": GRAPHIC, "format": "png", "size": size})
    assert answer.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(answer.content)) as picture:
        assert picture.width / picture.height == pytest.approx(ratio, abs=0.002)


def test_the_route_answers_an_svg_file_under_a_closed_policy(client):
    cid, _ = _case(client)
    answer = client.post(f"/api/cases/{cid}/notes/infographic", json={"text": GRAPHIC, "format": "svg"})
    assert answer.headers["content-type"].startswith("image/svg+xml")
    assert answer.headers["content-security-policy"].startswith("default-src 'none'")
    assert 'id="infographic-at-least-60-vehicles-lost-on-one-road"' in answer.text


def test_the_route_refuses_a_page_with_no_panel_and_writes_nothing(client):
    cid, case = _case(client)
    before = sorted(path.name for path in (case.path / "azimut").rglob("*") if path.is_file())
    assert client.post(f"/api/cases/{cid}/notes/infographic", json={"text": ":::: infographic\n::::"}).status_code == 422
    client.post(f"/api/cases/{cid}/notes/infographic", json={"text": GRAPHIC, "format": "png", "size": "x"})
    assert sorted(path.name for path in (case.path / "azimut").rglob("*") if path.is_file()) == before


def test_a_lone_period_on_a_timeline_is_drawn_as_a_band():
    block = notes_charts.parse_block("kind: timeline\nsource: x\n| Day | What | Until |\n| --- | --- | --- |\n"
                                     "| 5 Oct 2026 | Offensive opens | |\n| 11 Oct 2026 | Stalled | 2 Nov 2026 |\n"
                                     "| 15 Nov 2026 | Withdrawal | |")
    lines = notes_charts.layout(block).lines
    assert "11 Oct 2026 to 2 Nov 2026: Stalled" in lines


def test_the_engine_module_is_named_in_the_token_table():
    assert md.TOKEN_BLOCKS[md.INFOGRAPHIC] == notes_infographic.TOKEN == md.INFOGRAPHIC_TOKEN


def test_the_heading_over_an_infographic_opens_its_page_with_it(tmp_workspace):
    """An infographic opens a page of its own: the heading right above it opens that
    page, rather than staying behind alone, and nothing prints a blank page."""
    for paragraphs in (1, 8, 20):
        body = "\n\n".join(f"Paragraph {n} of the body, long enough to take a line." for n in range(paragraphs))
        rendered = notes_pdf.render(None, title="Losses", text=f"{body}\n\n## Field notes\n\n{GRAPHIC}\n\nAfter.\n",
                                    identity=notefill.Identity())
        reader = PdfReader(io.BytesIO(rendered.pdf))
        words = ["".join((page.extract_text() or "").split()).casefold() for page in reader.pages]
        [heading] = [number for number, page in enumerate(words) if "fieldnotes" in page]
        with_pictures = [number for number, page in enumerate(reader.pages) if page.images]
        assert with_pictures[0] == heading, paragraphs
        assert all(words[n] or reader.pages[n].images for n in range(len(words))), paragraphs
