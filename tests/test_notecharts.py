"""A chart in the documents made from a note (`engine/notecharts.py`): the `::: chart`
token, the PDF's picture, the HTML report's SVG and its numbers, the story's dark stage,
the web folder, the WordPress draft, To Post, the check before export and the figure
route. What the engine draws is `tests/test_notes_charts.py`'s."""

from __future__ import annotations

import base64
import io
import json
import os
import re
from pathlib import Path

import pytest
from PIL import Image
from pypdf import PdfReader

from azimut.engine import notecharts, notefill, notepieces, notes_charts, notes_html, notes_pdf, notes_web
from azimut.engine import notes_markdown as md
from azimut.engine import notes_wordpress as wp
from azimut.engine import sheets as sheets_engine
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from test_notes_html import _faces
from test_notes_report import make_case, make_note
from test_notes_wordpress import SAVED, _blocks, _placed

FIXTURES = Path(__file__).parent / "fixtures"
ARMOURED = (FIXTURES / "notes_charts" / "armoured.md").read_text(encoding="utf-8")
NOTE = f"# Vehicles\n\nWhat the two videos show.\n\n{ARMOURED}\nMost are Emirati-made.\n"
TITLE = "At least 41 armoured vehicles, by model and grade"
#: A small chart, for the markup goldens: three rows, a grade each.
SMALL = """::: chart
kind: bars
title: At least 4 vehicles, by maker
count: At least
by: Maker
source: our register
| Maker | At least |
| --- | ---: |
| Streit | 3 |
| Oshkosh | 1 |
:::"""
REPORT = NoteLook(style="report", numbered=True)


def _case(client, name="Charts") -> tuple[str, Case]:
    cid = make_case(client, name)
    return cid, Case.open(cid)


def _figure(page: str, number: int = 0) -> str:
    return re.findall(r'<figure class="az-figure az-chart-figure".*?</figure>\n', page, re.S)[number]


# -- the block ----------------------------------------------------------------------------------


def test_a_chart_block_is_one_token_holding_its_lines_at_its_line():
    blocks = md.alignment_blocks(NOTE)
    charts = [block for block in blocks if block.kind == md.CHART]
    assert len(charts) == 1 and [token.type for token in charts[0].tokens] == [md.CHART_TOKEN]
    assert charts[0].tokens[0].content.strip("\n") == notecharts.block_of(ARMOURED)
    # the line of the block's first setting, which every warning of it counts from
    assert NOTE.split("\n")[charts[0].line] == "kind: stacked bars"
    assert md.TOKEN_BLOCKS == {md.MAP: md.MAP_TOKEN, md.CHART: md.CHART_TOKEN}


def test_a_block_written_inside_a_code_fence_is_an_example_shown_as_text():
    text = f"# How to\n\n```\n{SMALL}\n```\n\n::: center\nMiddle\n:::\n"
    blocks = md.alignment_blocks(text)
    assert not [block for block in blocks if block.kind]
    assert [block.align for block in blocks if block.tokens][:2] == ["left", "center"]
    fence = next(token for block in blocks for token in block.tokens if token.type == "fence")
    assert "::: chart" in fence.content
    # and a WordPress draft keeps a map written as an example
    assert wp._without_maps("```\n::: map\nlayer: x\n:::\n```\n") == ("```\n::: map\nlayer: x\n:::\n```\n", 0)


def test_the_lines_alone_or_the_whole_block_read_the_same():
    assert notecharts.block_of(SMALL) == notecharts.block_of(notecharts.block_of(SMALL))
    assert notecharts.block_of(SMALL).startswith("kind: bars")


# -- the PDF ------------------------------------------------------------------------------------


def test_the_pdf_prints_a_chart_as_a_picture_captioned_as_every_figure(tmp_workspace):
    rendered = notes_pdf.render(None, title="Vehicles", text=NOTE, look=REPORT, identity=notefill.Identity())
    assert b"/Subtype /Image" in rendered.pdf
    words = " ".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(rendered.pdf)).pages)
    assert f"Figure 1. {TITLE}" in " ".join(words.split())
    # the rows are drawn in the picture, not printed as a table
    assert "Streit Cougar" not in words
    # what a screen reader says of it
    assert b"/Alt" in rendered.pdf and not rendered.warnings


def test_a_chart_that_shows_its_table_prints_it_under_the_picture(tmp_workspace):
    text = NOTE.replace("source: our vehicle register", "show: chart and table\nsource: our vehicle register")
    rendered = notes_pdf.render(None, title="Vehicles", text=text, identity=notefill.Identity())
    words = " ".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(rendered.pdf)).pages)
    assert "Streit Cougar" in words and "Model open" in words


def test_the_page_pane_takes_a_lighter_picture_and_the_print_one_at_300_dpi(tmp_workspace):
    def widths(light: bool) -> list[int]:
        rendered = notes_pdf.render(None, title="Vehicles", text=NOTE, light=light, identity=notefill.Identity())
        reader = PdfReader(io.BytesIO(rendered.pdf))
        return [image.image.width for page in reader.pages for image in page.images]

    assert widths(False) == [notes_pdf.CHART_PIXELS]
    assert widths(True) == [notes_pdf.CHART_PIXELS_LIGHT]


def test_a_chart_with_no_table_says_so_where_it_stands(tmp_workspace):
    text = "# Vehicles\n\n::: chart\ntitle: Nothing yet\n:::\n"
    rendered = notes_pdf.render(None, title="Vehicles", text=text, identity=notefill.Identity())
    assert notecharts.NO_TABLE in (PdfReader(io.BytesIO(rendered.pdf)).pages[0].extract_text() or "")
    assert b"/Subtype /Image" not in rendered.pdf
    said = dict(zip(rendered.warnings, rendered.warning_lines))
    assert text.split("\n")[said['The chart "Nothing yet" holds no table: write its rows under its settings.']] \
        == "title: Nothing yet"


def test_a_note_without_a_chart_prints_as_it_did(tmp_workspace):
    """The goldens hold every block a plain note prints; this holds the chart's own hook:
    a note that only looks like one is the paragraph it always was."""
    text = "# Vehicles\n\n::: charts\nkind: bars\n:::\n"
    rendered = notes_pdf.render(None, title="Vehicles", text=text, identity=notefill.Identity())
    assert b"/Subtype /Image" not in rendered.pdf and b"/Alt" not in rendered.pdf
    assert "kind: bars" in (PdfReader(io.BytesIO(rendered.pdf)).pages[0].extract_text() or "")


# -- the HTML report ----------------------------------------------------------------------------


def test_the_html_chart_is_an_inline_svg_with_its_numbers_folded_under_it(tmp_workspace):
    rendered = notes_html.render(None, title="Vehicles", text=NOTE, look=REPORT, identity=notefill.Identity())
    page = rendered.html.decode("utf-8")
    figure = _figure(page)
    assert 'data-kind="chart" id="chart-1"' in figure
    # drawn for the page and for a phone, words and all, a title on each bar
    svgs = re.findall(r"<svg [^>]*>", figure)
    assert len(svgs) == 2 and all('role="img"' in svg for svg in svgs)
    assert 'class="az-chart az-chart-wide az-chart-report"' in svgs[0]
    assert 'class="az-chart az-chart-phone az-chart-report"' in svgs[1]
    assert "<title>Streit Cougar, Confirmed: 8</title>" in figure
    assert f'<title id="chart-1-wide-title">{TITLE}</title>' in figure
    # its paper's margin off, so its words stand on the text's edges
    assert 'viewBox="16 16 608 ' in svgs[0]
    # the title is the caption, as every figure's; the numbers fold under it
    assert '<figcaption><span class="az-caption" dir="auto"><span class="az-fig-num">Figure 1.</span> ' in figure
    assert f"{TITLE}</span>" in figure
    numbers = re.search(r'<details class="az-chart-numbers"><summary>The numbers</summary>.*?</details>', figure, re.S)
    assert numbers and '<table class="az-chart-data"><thead><tr><th scope="col">Model</th>' in numbers.group(0)
    assert '<th scope="row">Harrow Tygor E1</th><td>1</td><td>7</td><td>0</td><td>8</td>' in numbers.group(0)
    # nothing it draws asks for anything: no script, no address, no data: picture
    assert "<script" not in figure and "href=" not in figure and "data:" not in figure
    assert not rendered.warnings


def test_a_chart_that_shows_its_table_has_it_after_it_as_any_table(tmp_workspace):
    text = NOTE.replace("source: our vehicle register", "show: chart and table\nsource: our vehicle register")
    page = notes_html.render(None, title="Vehicles", text=text, identity=notefill.Identity()).html.decode("utf-8")
    figure = _figure(page)
    assert "az-chart-numbers" not in figure
    after = page[page.index(figure) + len(figure):]
    assert after.lstrip().startswith('<div class="az-table-wrap">') and "Streit Cougar" in after.split("</table>")[0]


def test_the_words_a_chart_draws_are_in_the_pages_own_face(tmp_workspace):
    """The page's faces are cut to what it says; a chart's words are said in its SVG."""
    text = NOTE.replace("| BMC Kirpi II |", "| BMC Kırpı II |")
    rendered = notes_html.render(None, title="Vehicles", text=text, look=NoteLook(style="report"),
                                 identity=notefill.Identity())
    page = rendered.html.decode("utf-8")
    assert 'font-family="az-head, ' in page
    assert all(ord("ı") in cmap for cmap in _faces(rendered.html)[-2:])


def test_in_a_story_a_chart_is_a_scene_drawn_again_for_its_dark_stage(tmp_workspace):
    look = NoteLook(style="report", web="story")
    page = notes_html.render(None, title="Vehicles", text=NOTE, look=look, identity=notefill.Identity()).html.decode()
    scene = re.search(r'<section class="az-story az-scenes".*?</section>', page, re.S)
    assert scene and 'data-kind="chart"' in scene.group(0)
    assert "Most are Emirati-made." in scene.group(0).split('<div class="az-story-steps">')[1]
    dark = re.findall(r'<svg [^>]*class="az-chart az-chart-(wide|phone) az-chart-on-dark az-chart-dark"', page)
    assert dark == ["wide", "phone"]
    article = notes_html.render(None, title="Vehicles", text=NOTE, identity=notefill.Identity()).html.decode()
    assert 'class="az-chart az-chart-wide az-chart-on-dark' not in article


def test_the_style_sheet_shows_one_drawing_at_a_time_and_prints_the_first():
    css = (notes_html.ASSETS / "reader.css").read_text(encoding="utf-8")
    chart = css[css.index("/* charts:"):]
    assert "svg.az-chart { display: block; width: 100%; max-width: 100%; height: auto;" in chart
    assert "svg.az-chart-phone, svg.az-chart-on-dark { display: none; }" in chart
    assert "@media print" in chart and "@media screen and (max-width: 37.99rem)" in chart
    assert '[data-web="story"] .az-live .az-story-figures svg.az-chart:not(.az-chart-on-dark) { display: none; }' in chart


def test_a_chart_in_a_web_folder_stays_in_the_page_and_holds_no_data_address(client):
    cid, case = _case(client)
    folder = notes_html.Folder(csp=notes_web.folder_csp())
    rendered = notes_html.render(case, title="Vehicles", text=NOTE, public=True, folder=folder)
    page = rendered.html.decode("utf-8")
    assert '<svg xmlns="http://www.w3.org/2000/svg" id="chart-1-wide"' in page
    assert not re.search(r"data:(image|video|audio|font)/", page)
    # the folder holds the reader and nothing the chart would have needed
    assert all(path.endswith((".css", ".js", ".woff", ".svg")) for path in folder.files)
    assert not any("chart" in path for path in folder.files)


def test_a_picture_a_chart_draws_stays_in_the_page_and_is_a_file_of_a_web_folder(client, monkeypatch):
    """A kind may draw the analyst's own icon or a flag as a picture in the chart's SVG
    (`<image href="data:image/png…">`): the engine's SVG is never cleaned as a diagram is,
    so the picture stays in a single file, and a web folder holds it as a file of its own,
    which its policy (`img-src 'self'`) lets in."""
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), (200, 30, 30)).save(buffer, "PNG")
    icon = buffer.getvalue()
    real = notes_charts.svg

    def with_icon(chart, **options):
        drawn = real(chart, **options)
        image = (f'<image href="data:image/png;base64,{base64.b64encode(icon).decode()}" x="0" y="0" width="16" '
                 'height="16" preserveAspectRatio="xMidYMid meet"/>')
        return drawn.replace("</svg>", image + "</svg>")

    monkeypatch.setattr(notes_charts, "svg", with_icon)
    cid, case = _case(client)
    single = _figure(notes_html.render(case, title="Vehicles", text=NOTE).html.decode())
    assert single.count('<image href="data:image/png;base64,') == 2
    folder = notes_html.Folder(csp=notes_web.folder_csp())
    page = notes_html.render(case, title="Vehicles", text=NOTE, public=True, folder=folder).html.decode()
    figure = _figure(page)
    assert "data:" not in figure
    lifted = re.findall(r'<image href="(assets/[^"]+\.png)"', figure)
    assert len(lifted) == 2 and len(set(lifted)) == 1 and folder.files[lifted[0]] == icon
    assert "img-src 'self'" in notes_web.folder_csp()


def test_the_chart_figure_fixture_is_what_the_engine_writes(tmp_workspace):
    """The figure the browser tests open in the Page pane's HTML view
    (`frontend/src/lib/notes/chartFigure.fixture.html`), written again with
    `UPDATE_CHART_FIXTURE=1` when the engine's drawing moves."""
    page = notes_html.render(None, title="Vehicles", text=NOTE, identity=notefill.Identity()).html.decode()
    written = _figure(page)
    fixture = Path(__file__).resolve().parents[1] / "frontend/src/lib/notes/chartFigure.fixture.html"
    if os.environ.get("UPDATE_CHART_FIXTURE"):
        fixture.write_text(written, encoding="utf-8")
    assert fixture.read_text(encoding="utf-8") == written


# -- the case's colours --------------------------------------------------------------------------


def test_a_value_the_case_names_takes_its_colour_in_every_document(client):
    cid, case = _case(client)
    answer = client.put(f"/api/cases/{cid}/layer-palette", json={"colours": [{"name": "Confirmed", "colour": "#7a1f5c"}]})
    assert answer.status_code == 200, answer.text
    page = notes_html.render(case, title="Vehicles", text=NOTE).html.decode()
    assert 'fill="#7a1f5c"' in _figure(page)
    chart = notecharts.read(case, notecharts.block_of(ARMOURED))
    assert chart.layout.legend[0].paint.colour == "#7a1f5c" and chart.layout.legend[0].paint.origin == "case"
    assert notecharts.read(None, notecharts.block_of(ARMOURED)).layout.legend[0].paint.origin == "grade"


def test_a_note_look_picks_the_charts_look_and_a_block_style_wins():
    block = notes_charts.parse_block(notecharts.block_of(SMALL))
    assert notecharts.theme_of(NoteLook(style="journal"), block).name == "report"
    assert notecharts.theme_of(NoteLook(style="report", font="book"), block).head.family == "azimut-book"
    assert notecharts.theme_of(None, block, dark=True).name == "dark"
    block.style = "book"
    assert notecharts.theme_of(NoteLook(style="report"), block).name == "book"


# -- WordPress -----------------------------------------------------------------------------------


def _draft(text: str) -> tuple[wp.Draft, str]:
    draft = wp.build(None, title="Vehicles", text=text, identity=notefill.Identity())
    return draft, draft.markup(_placed(draft))


def test_a_chart_goes_to_wordpress_as_its_picture_and_its_numbers_folded(tmp_workspace):
    draft, markup = _draft(f"# Vehicles\n\n{SMALL}\n")
    upload = draft.uploads[0]
    assert upload.mime == "image/png" and upload.name.startswith("at-least-4-vehicles-by-maker-")
    assert upload.alt == "At least 4 vehicles, by maker. Streit: 3; Oshkosh: 1."
    assert upload.caption == "At least 4 vehicles, by maker · Source: our register"
    with Image.open(io.BytesIO(upload.data)) as picture:
        assert picture.width == notecharts.DOCUMENT_WIDTH * notecharts.WEB_PIXELS
    chart = markup[markup.index("<!-- wp:image"):]
    url = "https://desk.example.org/wp-content/uploads/" + upload.name
    assert chart == (
        '<!-- wp:image {"id":100,"sizeSlug":"large","linkDestination":"none"} -->\n'
        f'<figure class="wp-block-image size-large"><img src="{url}" '
        'alt="At least 4 vehicles, by maker. Streit: 3; Oshkosh: 1." class="wp-image-100"/>'
        '<figcaption class="wp-element-caption">At least 4 vehicles, by maker</figcaption></figure>\n'
        "<!-- /wp:image -->\n\n"
        "<!-- wp:details -->\n"
        '<details class="wp-block-details"><summary>The numbers</summary><!-- wp:table {"hasFixedLayout":false} -->\n'
        '<figure class="wp-block-table"><table><thead><tr><th>Maker</th><th>Vehicles, at least</th></tr></thead>'
        '<tbody><tr><td>Streit</td><td class="has-text-align-right" data-align="right">3</td></tr>'
        '<tr><td>Oshkosh</td><td class="has-text-align-right" data-align="right">1</td></tr></tbody></table></figure>\n'
        "<!-- /wp:table --></details>\n"
        "<!-- /wp:details -->\n")
    for name, _, own in _blocks(markup):
        assert SAVED[name].fullmatch(re.sub(r"\n\n", "", own)), name


def test_a_chart_that_shows_its_table_sends_the_table_as_written(tmp_workspace):
    shown = SMALL.replace("source: our register", "show: chart and table\nsource: our register")
    draft, markup = _draft(f"# Vehicles\n\n{shown}\n")
    names = [name for name, _, _ in _blocks(markup)]
    assert names == ["image", "table"]
    assert 'data-align="right">At least</th>' in markup and "The numbers" not in markup
    assert draft.left == dict.fromkeys(wp.LEFT, 0)


def test_a_numbered_look_numbers_a_chart_with_the_other_figures(tmp_workspace):
    draft = wp.build(None, title="Vehicles", text=f"# Vehicles\n\n{SMALL}\n", look=REPORT,
                     identity=notefill.Identity())
    assert "<figcaption class=\"wp-element-caption\"><strong>Figure 1.</strong> At least 4 vehicles" in draft.content


# -- To Post -------------------------------------------------------------------------------------


def test_to_post_hands_a_chart_as_its_picture_for_x_filed_once(client):
    cid, case = _case(client)
    note = make_note(client, cid, title="Vehicles", content=NOTE)
    first = client.post(f"/api/cases/{cid}/notes/{note['id']}/pieces", json={"text": NOTE}).json()
    media = [piece for piece in first["pieces"] if piece["kind"] == "media"]
    assert media == [{"kind": "media", "path": f"media/{TITLE}.png", "type": "image", "id": media[0]["id"],
                      "alt": TITLE}]
    with Image.open(case.resolve_inside(media[0]["path"])) as picture:
        assert picture.size == (1600, 900)
    record = case.get_entity(media[0]["id"])
    assert record["attrs"]["path"] == media[0]["path"]
    # sent again, the same picture is the same file
    again = client.post(f"/api/cases/{cid}/notes/{note['id']}/pieces", json={"text": NOTE}).json()
    assert [piece for piece in again["pieces"] if piece["kind"] == "media"] == media
    assert len([path for path in (case.path / "azimut" / "media").iterdir() if path.suffix == ".png"]) == 1
    texts = [piece["text"] for piece in first["pieces"] if piece["kind"] == "text"]
    assert texts[-1] == "Most are Emirati-made." and first["left"]["tables"] == 0


def test_to_post_counts_a_shown_table_and_hands_nothing_outside_a_case():
    shown = NOTE.replace("source: our vehicle register", "show: chart and table\nsource: our vehicle register")
    handed = notepieces.hand(None, title="Vehicles", text=shown)
    assert not [piece for piece in handed.pieces if piece["kind"] == "media"]
    assert handed.left["other"] == 1


def test_to_post_counts_the_table_a_chart_shows(client):
    cid, case = _case(client)
    shown = NOTE.replace("source: our vehicle register", "show: chart and table\nsource: our vehicle register")
    handed = notepieces.hand(case, title="Vehicles", text=shown)
    assert [piece["kind"] for piece in handed.pieces].count("media") == 1
    assert handed.left["tables"] == 1


# -- the check before export --------------------------------------------------------------------


def test_the_check_says_a_floor_a_left_out_row_and_a_total_at_their_lines(client):
    cid, case = _case(client)
    text = ("# Vehicles\n\n::: chart\ntitle: Vehicles by maker\ncount: At least\nby: Maker\n"
            "| Maker | At least |\n| --- | ---: |\n| Streit | 3 |\n|  | 2 |\n| Total | 5 |\n:::\n")
    note = make_note(client, cid, title="Vehicles", content=text)
    for fmt in ("pdf", "html"):
        answer = client.post(f"/api/cases/{cid}/notes/pdf/check", json={"notes": [note["id"]], "format": fmt}).json()
        said = {warning["text"]: (warning["line"], warning["kind"]) for warning in answer["notes"][0]["warnings"]}
        lines = text.split("\n")
        floor = next(message for message in said if "at least" in message and "title" in message)
        assert lines[said[floor][0]] == "title: Vehicles by maker"
        total = 'The chart "Vehicles by maker" leaves out the row "Total", which reads as a total.'
        assert lines[said[total][0]] == "| Total | 5 |"
        blank = 'The chart "Vehicles by maker" leaves out 1 row with nothing in "Maker".'
        assert lines[said[blank][0]] == "by: Maker"


def test_the_check_says_when_the_rows_moved_on_from_where_they_were_copied(client):
    cid, case = _case(client)
    register = "# Register\n\n## Register\n\n| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n| M-ATV | Confirmed |\n"
    source = make_note(client, cid, title="Register", content=register)
    chart = (f"# Vehicles\n\n::: chart\ntitle: Vehicles by model\ncount: rows\nby: Model\nsource: our register\n"
             f"from: note:{source['id']}#register\n"
             "| Model | Grade |\n| --- | --- |\n| M-ATV | Confirmed |\n| Cougar | Confirmed |\n:::\n")
    line = chart.split("\n").index(f"from: note:{source['id']}#register")
    # the same rows in another order: nothing to say
    assert not notes_html.render(case, title="Vehicles", text=chart).warnings
    client.put(f"/api/cases/{cid}/notes/{source['id']}", json={"text": register + "| Kirpi | Almost sure |\n"})
    rendered = notes_pdf.render(case, title="Vehicles", text=chart)
    said = dict(zip(rendered.warnings, zip(rendered.warning_lines, rendered.warning_kinds)))
    moved = ('The chart "Vehicles by model": its rows differ from "Register", where they were copied from. '
             "Read them again to bring them up to date.")
    assert said[moved] == (line, "other")
    assert client.delete(f"/api/cases/{cid}/entities/{source['id']}").status_code == 200
    gone = notes_html.render(case, title="Vehicles", text=chart)
    assert dict(zip(gone.warnings, gone.warning_kinds)) == {
        'The chart "Vehicles by model": its rows were copied from something no longer in the case, so they '
        "cannot be read again.": "missing"}


def test_rows_copied_from_a_sheet_are_read_against_it(client):
    cid, case = _case(client)
    sheet = sheets_engine.create(case, "Register", ["Model", "Grade", "Seen"],
                                 [["Cougar", "Confirmed", "V1"], ["M-ATV", "Almost sure", "V2"]])
    block = notes_charts.parse_block(
        f"count: rows\nby: Model\nfrom: sheet:{sheet['id']}\n| Model | Grade |\n| --- | --- |\n"
        "| Cougar | Confirmed |\n| M-ATV | Almost sure |")
    assert notecharts.origin_warning(case, block) is None
    assert notecharts.origin_rows(case, f"sheet:{sheet['id']}")[1][-3:] == ["Model", "Grade", "Seen"]
    block.table.cells[1][1] = "Confirmed"
    assert "its rows differ" in notecharts.origin_warning(case, block)[0]
    # what names nothing this reads is not read
    block.origin = "layer:Vehicles"
    assert notecharts.origin_warning(case, block) is None


def test_a_heading_names_the_table_under_it():
    text = "# A\n\n| x |\n| --- |\n| 1 |\n\n## The register\n\n```\n| y |\n| --- |\n```\n\n| z |\n| --- |\n| 2 |\n\n## Next\n"
    assert notecharts._table_under(text, "").headers == ["x"]
    assert notecharts._table_under(text, "the-register").headers == ["z"]
    assert notecharts._table_under(text, "next") is None and notecharts._table_under(text, "nowhere") is None


# -- the figure route ----------------------------------------------------------------------------


def test_the_figure_route_answers_the_svg_with_its_title_and_what_the_check_says(client):
    cid, _ = _case(client)
    answer = client.post(f"/api/cases/{cid}/notes/figure", json={"text": ARMOURED})
    assert answer.status_code == 200, answer.text
    assert answer.headers["content-type"].startswith("image/svg+xml")
    assert answer.headers["content-security-policy"] == "default-src 'none'; style-src 'unsafe-inline'"
    assert answer.headers["x-content-type-options"] == "nosniff"
    svg = answer.text
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg" id="chart-at-least-41-armoured-vehicles-by-model-a"')
    # a picture standing alone carries its title
    assert f'font-size="17" fill="#0b0b0b" font-weight="700">{TITLE}</text>' in svg
    assert answer.headers["x-chart-title"] == f'"{TITLE}"'
    floor = ARMOURED.replace("title: At least 41", "title: 41")
    checked = client.post(f"/api/cases/{cid}/notes/figure", json={"text": floor})
    said = '"41 armoured vehicles, by model and grade" counts at least: say so in its title.'
    assert json.loads(checked.headers["x-note-warnings"]) == [said]
    assert checked.headers["x-note-warning-lines"] == "[1]"


@pytest.mark.parametrize("size, pixels", [("page", (1960, None)), ("x", (1600, 900)), ("portrait", (1080, 1350)),
                                          ("square", (1080, 1080))])
def test_the_figure_route_paints_a_picture_for_each_destination(client, size, pixels):
    cid, _ = _case(client)
    answer = client.post(f"/api/cases/{cid}/notes/figure", json={"text": ARMOURED, "format": "png", "size": size})
    assert answer.status_code == 200 and answer.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(answer.content)) as picture:
        assert picture.width == pixels[0] and (pixels[1] is None or picture.height == pixels[1])


def test_the_figure_route_reads_the_note_its_look_and_the_look_sent(client):
    cid, case = _case(client)
    note = make_note(client, cid, title="Vehicles", content=NOTE)
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report", "font": "book"})
    kept = client.post(f"/api/cases/{cid}/notes/figure", json={"text": SMALL, "note": note["id"]}).text
    assert "Literata" in kept
    sent = client.post(f"/api/cases/{cid}/notes/figure",
                       json={"text": SMALL, "note": note["id"], "look": {"style": "plain"}}).text
    assert "Literata" not in sent


@pytest.mark.parametrize("body, status", [
    ({"text": "::: chart\ntitle: Nothing\n:::"}, 422),
    ({"text": SMALL, "format": "gif"}, 422),
    ({"text": SMALL, "format": "png", "size": "poster"}, 422),
    ({"text": SMALL, "note": "../notes"}, 422),
    ({"text": SMALL, "note": "e_nowhere"}, 404),
    ({"text": SMALL, "look": {"style": "glossy"}}, 422),
    ({"text": "é" * 140_000}, 413),
    ({"text": "x" * (300 * 1024)}, 422),
])
def test_the_figure_route_refuses_at_the_edge(client, body, status):
    cid, _ = _case(client)
    assert client.post(f"/api/cases/{cid}/notes/figure", json=body).status_code == status


def test_the_figure_route_writes_nothing(client):
    cid, case = _case(client)
    before = sorted(path.relative_to(case.path) for path in case.path.rglob("*") if path.is_file())
    client.post(f"/api/cases/{cid}/notes/figure", json={"text": ARMOURED, "format": "png", "size": "x"})
    after = sorted(path.relative_to(case.path) for path in case.path.rglob("*") if path.is_file()
                   if path.suffix not in (".db-wal", ".db-shm"))
    assert [path for path in after if path not in before] == []
