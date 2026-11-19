"""A table's settings line (`engine/notes_tables.py`): read one way by every document.

The line under a table's last row (``{search=always fold=20 stripes colour="Grade"}``)
is read here as the editor reads it (`frontend/src/lib/notes/editor/tableLook.js`, held
to one reading by `table-looks.json`), taken out of the table's rows, and honoured by
the HTML report and its web folder, the PDF where paper can give it, and WordPress
where its table block holds it. A table without one reads as it always did.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from azimut.engine import layerediting, notecharts, notefill, notes_html, notes_pdf, notes_tables, notes_wordpress
from azimut.engine import notes_markdown as md
from azimut.engine import notetext
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from test_notes_pdf import pdf_text
from test_notes_pdf_golden import drawing
from test_notes_wordpress import SAVED, _blocks

LOOKS = Path(__file__).resolve().parents[1] / "frontend/src/lib/notes/editor/fixtures/table-looks.json"
GRADES = ["confirmed", "almost sure", "strong doubt", "set aside"]


def register(count: int, line: str = "") -> str:
    """A register of ``count`` vehicles graded in turn, with its settings line when given."""
    rows = "\n".join(f"| {number} | Model {number % 3} | {GRADES[number % 4]} |" for number in range(1, count + 1))
    under = f"\n{line}" if line else ""
    return f"# Register\n\nOne row per vehicle.\n\n| # | Model | Grade |\n| --- | --- | --- |\n{rows}{under}\n\nAfter the table.\n"


def tables(text: str) -> list[tuple[notes_tables.TableLook, list[list[str]]]]:
    """Each table's settings and body rows, as the renderers are handed them."""
    tokens = md.parse(text)
    found = []
    for index, token in enumerate(tokens):
        if token.type != "table_open":
            continue
        rows: list[list[str]] = []
        body = False
        for inner in tokens[index + 1:md.past(tokens, index)]:
            if inner.type == "tbody_open":
                body = True
            elif inner.type == "tr_open" and body:
                rows.append([])
            elif inner.type == "inline" and body:
                rows[-1].append(inner.content)
        found.append((notes_tables.look_of(token), rows))
    return found


def html(text: str, case: Case | None = None, look: NoteLook | None = None, **options) -> notes_html.RenderedHtml:
    return notes_html.render(case, title="Register", text=text, look=look, identity=notefill.Identity(), **options)


def pdf(text: str, case: Case | None = None, look: NoteLook | None = None) -> notes_pdf.Rendered:
    return notes_pdf.render(case, title="Register", text=text, look=look, identity=notefill.Identity())


def rg(rgb: tuple[int, int, int]) -> bytes:
    """A fill colour as fpdf2 writes it in a page's drawing."""
    return (" ".join(f"{value / 255:.4f}".rstrip("0").rstrip(".") for value in rgb) + " rg").encode()


# -- the line ---------------------------------------------------------------------------------


@pytest.mark.parametrize("case", json.loads(LOOKS.read_text(encoding="utf-8")), ids=lambda case: case["line"])
def test_the_line_reads_and_writes_as_the_editor_reads_and_writes_it(case):
    look = notes_tables.read_line(case["line"])
    assert (None if look is None else notes_tables.write_line(look)) == case["written"]


def test_a_table_with_nothing_set_writes_no_line():
    assert notes_tables.write_line(notes_tables.DEFAULT) == ""
    assert notes_tables.write_line(notes_tables.TableLook(caption=' "quoted" {braces} | pipe ')) == '{caption="quoted braces pipe"}'


def test_the_line_is_taken_out_of_the_rows_and_handed_on_with_its_table():
    text = register(3, '{search=always fold=20 stripes colour="Grade" first-column=sticky}')
    [(look, rows)] = tables(text)
    assert rows == [["1", "Model 1", "almost sure"], ["2", "Model 2", "strong doubt"], ["3", "Model 0", "set aside"]]
    assert look == notes_tables.TableLook(search="always", fold=20, stripes=True, colour="Grade", sticky_column=True)
    # a header and its line only: the table keeps no empty body
    tokens = md.parse("| a | b |\n| --- | --- |\n{stripes}\n")
    assert [token.type for token in tokens if token.type.startswith("tbody")] == []
    assert notes_tables.look_of(tokens[0]).stripes is True


def test_braces_that_are_no_settings_or_not_under_the_last_row_stay_a_row():
    [(look, rows)] = tables("| Only |\n| --- |\n| a |\n{x}\n")
    assert look == notes_tables.DEFAULT and rows == [["a"], ["{x}"]]
    [(look, rows)] = tables("| a | b |\n| --- | --- |\n| 1 | 2 |\n{stripes}\n| 3 | 4 |\n")
    assert look == notes_tables.DEFAULT and rows == [["1", "2"], ["{stripes}", ""], ["3", "4"]]
    # in a quote the line is the quote's, as the grid leaves a quoted table alone
    [(look, rows)] = tables("> | a |\n> | --- |\n> | 1 |\n> {stripes}\n")
    assert look == notes_tables.DEFAULT and rows == [["1"], ["{stripes}"]]


def test_a_table_without_a_line_is_handed_on_as_before():
    text = register(4)
    assert [token.type for token in md.parse(text)] == [token.type for token in md.parser().parse(md.case_references(text))]
    assert all(look is notes_tables.DEFAULT for look, _ in tables(text))


def test_the_line_says_nothing_to_a_search_or_an_excerpt():
    text = register(2, "{stripes caption=\"The register\"}")
    said = [line for _, line in notetext.plain(text)]
    assert not any("stripes" in line or "{" in line for line in said)
    assert "After the table." in said


def test_a_chart_copying_a_tables_rows_takes_none_of_its_settings_line():
    [(anchor, heading, table)] = notecharts.note_tables(register(3, "{stripes}"))
    assert (anchor, heading) == ("register", "Register") and len(table.rows) == 3


# -- the HTML report ------------------------------------------------------------------------------


def _table_tag(page: str) -> str:
    return re.search(r"<table class=\"az-table[^>]*>", page).group(0)


def test_the_html_page_says_each_choice_on_its_table():
    line = ('{search=never sort=off fold=20 header=scrolls first-column=sticky stripes density=compact '
            'caption="The register" source="Our review, 17 Nov 2026"}')
    page = html(register(30, line)).html.decode()
    assert _table_tag(page) == ('<table class="az-table az-stripes az-compact az-first" data-rows="30" '
                                'data-search="never" data-sort="off" data-fold="20" data-header="scrolls">')
    caption = re.search(r'<div class="az-table-block">\n<div class="az-table-wrap">.*?</div>\n(<p class="az-table-cap".*?</p>)\n</div>',
                        page, re.S)
    assert caption.group(1) == ('<p class="az-table-cap" dir="auto"><span class="az-caption">The register</span>'
                                '<span class="az-credit"><span class="az-credit-kind">Source:</span> Our review, 17 Nov 2026</span></p>')
    assert "{search" not in page and "<td>{" not in page
    # the rules for them come with the page, and only with a page holding such a table
    sheet = (notes_html.ASSETS / "reader.table.css").read_text(encoding="utf-8")
    assert sheet.strip() in page
    plain = html(register(30)).html.decode()
    assert sheet.strip() not in plain and _table_tag(plain) == '<table class="az-table" data-rows="30">'
    assert ".az-table-more" not in (notes_html.ASSETS / "reader.css").read_text(encoding="utf-8")


def test_search_always_is_said_even_on_a_short_table():
    assert 'data-search="always"' in _table_tag(html(register(3, "{search=always}")).html.decode())


def test_rows_coloured_by_a_grade_wear_the_charts_colours_and_the_case_names_win(tmp_workspace):
    page = html(register(4, '{colour="grade"}')).html.decode()
    assert 'class="az-table az-coloured"' in page
    rows = re.findall(r'<tr style="--az-c:(#[0-9a-f]{6})"><td dir="auto">(\d)</td><td dir="auto">[^<]*</td>'
                      r'<td class="az-key" dir="auto">([^<]*)</td></tr>', page)
    assert rows == [("#3987e5", "1", "almost sure"), ("#86b6ef", "2", "strong doubt"), ("#a9a79f", "3", "set aside"),
                    ("#184f95", "4", "confirmed")]
    case = Case.create("Tables")
    layerediting.set_names(case, [{"name": "Confirmed", "colour": "#123456"}])
    named = html(register(4, '{colour="Grade"}'), case=case).html.decode()
    assert '<tr style="--az-c:#123456"><td dir="auto">4</td>' in named
    assert '<tr style="--az-c:#3987e5"><td dir="auto">1</td>' in named


def test_a_row_with_nothing_to_colour_by_stays_as_it_is():
    text = "| # | Grade |\n| --- | --- |\n| 1 | confirmed |\n| 2 |  |\n{colour=Grade}\n"
    page = html(text).html.decode()
    assert '<tr style="--az-c:#184f95"><td dir="auto">1</td><td class="az-key" dir="auto">confirmed</td></tr>' in page
    assert '<tr><td dir="auto">2</td><td dir="auto"></td></tr>' in page


def test_a_column_the_table_lacks_is_said_by_the_check_and_colours_nothing():
    text = register(3, '{colour="Price"}')
    said = notes_tables.missing_colour("Price")
    rendered = html(text)
    assert said in rendered.warnings and 'style="--az-c' not in rendered.html.decode()
    assert rendered.warning_lines[rendered.warnings.index(said)] == 4
    assert said in pdf(text).warnings


def test_the_web_folder_carries_the_tables_rules_in_its_style_sheet():
    folder = notes_html.Folder(csp="default-src 'self'")
    html(register(30, "{fold=20}"), folder=folder)
    sheets = [data.decode() for name, data in folder.files.items() if name.endswith(".css")]
    assert any(".az-table-more" in sheet for sheet in sheets)


# -- the PDF -------------------------------------------------------------------------------------


@pytest.mark.parametrize("style", ["plain", "report"])
def test_settings_of_the_web_page_alone_leave_the_pdf_as_it_was(style):
    look = NoteLook(style=style)
    before = drawing(pdf(register(40), look=look).pdf)
    after = pdf(register(40, "{search=always sort=off fold=20 first-column=sticky}"), look=look).pdf
    assert drawing(after) == before


def test_the_pdf_stripes_colours_and_captions_a_table():
    from azimut.engine.notes_style import PLAIN, WHITE, hex_rgb, mix

    plain = pdf(register(6)).pdf
    assert rg(PLAIN.tint) not in drawing(plain)
    striped = pdf(register(6, "{stripes}")).pdf
    assert rg(PLAIN.tint) in drawing(striped)
    coloured = pdf(register(6, '{colour="Grade" caption="The register" source="Our review"}')).pdf
    page = drawing(coloured)
    for grade in ("#184f95", "#3987e5", "#86b6ef", "#a9a79f"):
        assert rg(mix(hex_rgb(grade), WHITE, notes_tables.ROW_TINT)) in page
        assert rg(mix(hex_rgb(grade), WHITE, notes_tables.KEY_TINT)) in page
    words = pdf_text(coloured)
    assert "The register" in words and "Source: Our review" in words
    assert words.index("Model 0") < words.index("The register") < words.index("After the table.")


def test_stripes_off_takes_a_styled_pdfs_own_stripes_away():
    look = NoteLook(style="report")
    tint = notes_pdf.notes_style.theme_for(look).tint
    assert rg(tint) in drawing(pdf(register(6), look=look).pdf)
    assert rg(tint) not in drawing(pdf(register(6, "{stripes=off}"), look=look).pdf)


def test_a_header_that_scrolls_is_printed_once_and_compact_rows_take_fewer_pages():
    long = pdf(register(90)).pdf
    once = pdf(register(90, "{header=scrolls}")).pdf
    assert pdf_text(long).count("Grade") > 1 and pdf_text(once).count("Grade") == 1
    pages = lambda data: drawing(data).split(b"\n", 1)[0]  # noqa: E731
    assert pages(pdf(register(90, "{density=compact}")).pdf) < pages(long)


# -- WordPress -----------------------------------------------------------------------------------


def test_wordpress_takes_the_stripes_colours_and_caption_its_table_block_holds():
    text = register(2, '{search=always stripes colour="Grade" caption="The register" source="Our review"}')
    markup = notes_wordpress.build(None, title="Register", text=text, identity=notefill.Identity()).content
    [table] = [(attrs, own) for name, attrs, own in _blocks(markup) if name == "table"]
    attrs, own = table
    assert attrs == {"hasFixedLayout": False, "className": "is-style-stripes"}
    assert SAVED["table"].fullmatch(own)
    assert own.startswith('<figure class="wp-block-table is-style-stripes"><table>')
    tint = notes_tables.tint("#3987e5", notes_tables.KEY_TINT)
    assert f'<td><mark style="background-color:{tint}" class="has-inline-color">almost sure</mark></td>' in own
    assert own.endswith('<figcaption class="wp-element-caption">The register<br>Source: Our review</figcaption></figure>')
    plain = notes_wordpress.build(None, title="Register", text=register(2), identity=notefill.Identity()).content
    assert [attrs for name, attrs, _ in _blocks(plain) if name == "table"] == [{"hasFixedLayout": False}]
    assert "<mark" not in plain and "figcaption" not in plain
