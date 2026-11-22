"""Columns in a note (`:::: columns`): how the block is read, and how the PDF, the HTML
page, the WordPress draft and the readers of a note's text treat it."""

import re
from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream

from azimut.engine import notediff, notefill, notepieces, notes_html, notes_markdown, notes_pdf, notes_wordpress, notetext
from azimut.engine.notelook import NoteLook

# -- helpers -----------------------------------------------------------------


class FakeCase:
    """Just enough case for the renderers: entities to resolve, files to read."""

    def __init__(self, tmp_path, entities=None):
        self.id = "demo"
        self.path = tmp_path
        self._entities = entities or {}

    def get_entity(self, entity_id):
        return self._entities.get(entity_id)

    def resolve_inside(self, relative):
        return self.path / relative


@pytest.fixture
def case(tmp_path):
    Image.new("RGB", (900, 600), "#4a5a6a").save(tmp_path / "wide.png")
    Image.new("RGB", (400, 500), "#6a4a5a").save(tmp_path / "tall.png")
    Image.new("RGB", (200, 1400), "#33445a").save(tmp_path / "strip.png")
    return FakeCase(tmp_path)


PICTURES = """:::: columns
::: column
![Wide](/files/demo/wide.png){caption="A wide one"}
:::
::: column
![Tall](/files/demo/tall.png){caption="A tall one"}
:::
::::
"""

MIXED = """:::: columns
::: column width=66%
Words beside the picture, with [a source](https://example.org/page).

- first point
- second point
:::
::: column
![Tall](/files/demo/tall.png){caption="Beside the words"}
:::
::::
"""


def blocks_of(text):
    return [block for block in notes_markdown.alignment_blocks(text) if block.tokens]


def kinds(tokens):
    return [token.type for token in tokens]


def placed_images(data):
    """Each picture drawn, as (page, left, bottom, width, height) in mm, read off the
    page's own drawing operators, transforms and all."""
    reader = PdfReader(BytesIO(data))
    found = []
    for number, page in enumerate(reader.pages):
        stack = [(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)]
        for operands, operator in ContentStream(page.get_contents(), reader).operations:
            if operator == b"q":
                stack.append(stack[-1])
            elif operator == b"Q":
                stack.pop()
            elif operator == b"cm":
                a, b, c, d, e, f = (float(value) for value in operands)
                A, B, C, D, E, F = stack[-1]
                stack[-1] = (a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E,
                             e * B + f * D + F)
            elif operator == b"Do":
                m = stack[-1]
                found.append((number, *(round(value / 72 * 25.4, 1) for value in (m[4], m[5], m[0], m[3]))))
    return found


def pdf_pages(data):
    return [page.extract_text() for page in PdfReader(BytesIO(data)).pages]


def render_pdf(case, text, **options):
    return notes_pdf.render(case, title="Columns", text=text, identity=notefill.Identity(), **options)


# -- reading the block -----------------------------------------------------------


def test_the_columns_come_between_markers_with_their_shares():
    [block] = blocks_of(MIXED)
    assert block.kind == notes_markdown.COLUMNS
    tokens = block.tokens
    assert tokens[0].type == notes_markdown.COLUMNS_OPEN
    assert tokens[0].meta == {"widths": [0.66, 0.34], "pictures": False, "count": 2}
    assert tokens[-1].type == notes_markdown.COLUMNS_CLOSE
    assert kinds(tokens).count(notes_markdown.COLUMN_OPEN) == 2
    spans, end = notes_markdown.column_spans(tokens, 0)
    assert end == len(tokens)
    assert [round(share, 2) for _, _, share in spans] == [0.66, 0.34]
    first = tokens[spans[0][0]:spans[0][1]]
    assert first[1].content.startswith("Words beside") and "bullet_list_open" in kinds(first)


def test_each_line_inside_a_column_keeps_its_line_in_the_note():
    text = "Intro.\n\n" + MIXED
    lines = text.split("\n")
    [_, block] = blocks_of(text)
    for token in block.tokens:
        if token.type == "inline" and token.map:
            assert token.content.split("\n")[0] in lines[block.line + token.map[0]]


@pytest.mark.parametrize(("written", "shares"), [
    ([None, None], [0.5, 0.5]),
    ([66, None], [0.66, 0.34]),
    ([None, 66], [0.34, 0.66]),
    ([60, 60], [0.5, 0.5]),
    ([95, None], [0.9, 0.1]),
    ([None, None, 50], [0.25, 0.25, 0.5]),
    ([85, None, None], [1 / 3, 1 / 3, 1 / 3]),
    ([5, None], [0.1, 0.9]),
])
def test_written_widths_are_kept_in_bounds(written, shares):
    assert notes_markdown.column_widths(written) == pytest.approx(shares)


def test_a_width_is_read_with_or_without_its_percent_sign():
    text = ":::: columns\n::: column width=25\nA\n:::\n::: column\nB\n:::\n::::\n"
    assert blocks_of(text)[0].tokens[0].meta["widths"] == pytest.approx([0.25, 0.75])


def test_three_columns_and_a_row_of_pictures():
    three = ":::: columns\n" + "".join(f"::: column\nWords {n}.\n:::\n" for n in range(3)) + "::::\n"
    assert blocks_of(three)[0].tokens[0].meta["count"] == 3
    [block] = blocks_of(PICTURES)
    assert block.tokens[0].meta["pictures"] is True
    # a picture with a line of words under it is a column of words and a picture
    words = PICTURES.replace('{caption="A tall one"}', '{caption="A tall one"}\nSaid under it.')
    assert blocks_of(words)[0].tokens[0].meta["pictures"] is False


def test_an_empty_column_is_not_printed_and_one_column_left_is_ordinary_content():
    text = ":::: columns\n::: column\nOnly words.\n:::\n::: column\n\n<!-- nothing -->\n:::\n::::\n"
    [block] = blocks_of(text)
    assert block.kind == ""
    assert notes_markdown.COLUMNS_OPEN not in kinds(block.tokens)
    assert [token.content for token in block.tokens if token.type == "inline"] == ["Only words."]


def test_words_written_outside_the_columns_print_under_the_row():
    text = ":::: columns\n::: column\nA\n:::\nStray words.\n::: column\nB\n:::\n::::\n"
    [block] = blocks_of(text)
    close = kinds(block.tokens).index(notes_markdown.COLUMNS_CLOSE)
    after = [token.content for token in block.tokens[close:] if token.type == "inline"]
    assert after == ["Stray words."]


def test_a_block_left_open_reads_as_plain_text():
    text = ":::: columns\n::: column\nWords\n:::\n"
    [block] = blocks_of(text)
    assert block.kind == ""
    assert notes_markdown.COLUMNS_OPEN not in kinds(block.tokens)


def test_a_column_holding_a_table_or_a_block_prints_the_row_one_column_under_the_other():
    text = ("Intro.\n\n:::: columns\n::: column\n| a | b |\n|---|---|\n| 1 | 2 |\n:::\n"
            "::: column\n::: center\nCentred\n:::\n:::\n::::\n")
    found = blocks_of(text)
    every = [token for block in found for token in block.tokens]
    assert notes_markdown.COLUMNS_OPEN not in kinds(every)
    assert "table_open" in kinds(every)
    centred = next(block for block in found if block.align == "center")
    assert text.split("\n")[centred.line + centred.tokens[0].map[0]] == "Centred"
    table = next(block for block in found if "table_open" in kinds(block.tokens))
    assert text.split("\n")[table.line + table.tokens[0].map[0]] == "| a | b |"


def test_the_markers_print_nothing_and_a_heading_over_a_row_is_not_empty():
    [block] = blocks_of(MIXED)
    for index, token in enumerate(block.tokens):
        if token.type in notes_markdown.COLUMN_MARKS:
            assert not notes_markdown.prints(block.tokens, index)
    text = "## Method\n\n" + MIXED
    pieces = notes_markdown.expand("T", text, resolve=None)
    blocks = {id(piece): notes_markdown.alignment_blocks(piece.text) for piece in pieces if piece.kind == "text"}
    assert notes_markdown.empty_sections(pieces, blocks, journal=False) == []


def test_an_internal_passage_inside_a_column_is_left_out_of_the_public_edition():
    text = MIXED.replace("- second point\n", "- second point\n\n> [!internal] The team's own lead.\n")
    stripped, found = notes_markdown.strip_internal(text)
    assert found == 1 and "team's own" not in stripped
    assert ":::: columns" in stripped and "first point" in stripped


# -- the PDF -------------------------------------------------------------------------


@pytest.mark.parametrize("style", ["plain", "report"])
def test_a_row_of_pictures_stands_side_by_side_at_one_height(case, style):
    rendered = render_pdf(case, "Intro.\n\n" + PICTURES, look=NoteLook(style=style))
    [wide, tall] = placed_images(rendered.pdf)
    assert wide[0] == tall[0] == 0
    # one height, nothing cropped: each picture keeps its own shape
    assert wide[4] == pytest.approx(tall[4], abs=0.2)
    assert wide[3] / wide[4] == pytest.approx(900 / 600, rel=0.02)
    assert tall[3] / tall[4] == pytest.approx(400 / 500, rel=0.02)
    assert wide[2] == pytest.approx(tall[2], abs=0.2)
    # side by side, the gap between them, the row filling the frame
    assert tall[1] == pytest.approx(wide[1] + wide[3] + notes_pdf.COLUMN_GAP, abs=0.3)
    text = "\n".join(pdf_pages(rendered.pdf))
    assert "A wide one" in text and "A tall one" in text and ":::" not in text


def test_a_row_of_words_and_a_picture_takes_its_written_shares(case):
    rendered = render_pdf(case, MIXED)
    [picture] = placed_images(rendered.pdf)
    pdf = notes_pdf.NotePage(title="T")
    frame = pdf.epw - notes_pdf.COLUMN_GAP
    assert picture[3] == pytest.approx(frame * 0.34, abs=0.3)
    assert picture[1] == pytest.approx(pdf.l_margin + frame * 0.66 + notes_pdf.COLUMN_GAP, abs=0.3)
    [page] = pdf_pages(rendered.pdf)
    assert "Words beside the picture" in page and "second point" in page and "Beside the words" in page
    assert ":::" not in page and "width=" not in page


def test_a_row_is_never_split_over_two_pages(case):
    filler = "\n\n".join(f"Paragraph {n} with a few words to take some room on the page." for n in range(21))
    rendered = render_pdf(case, f"{filler}\n\n{MIXED}\nAfter the row.\n", look=NoteLook(style="report"))
    pages = pdf_pages(rendered.pdf)
    holding = [number for number, page in enumerate(pages) if "Words beside the picture" in page]
    assert len(holding) == 1
    [row_page] = holding
    assert "second point" in pages[row_page] and "Beside the words" in pages[row_page]
    assert [picture[0] for picture in placed_images(rendered.pdf)] == [row_page]
    assert "Paragraph 20" in pages[row_page - 1]
    # the row moved whole: its link and the page's fonts went with it
    annots = PdfReader(BytesIO(rendered.pdf)).pages[row_page].get("/Annots") or []
    assert any("example.org" in str(annot.get_object().get("/A", {}).get("/URI", "")) or
               annot.get_object().get("/Dest") is not None for annot in annots)
    assert "After the row." in "".join(pages[row_page:])


def test_a_heading_stays_with_the_row_under_it(case):
    filler = "\n\n".join(f"Paragraph {n} with a few words to take some room on the page." for n in range(21))
    rendered = render_pdf(case, f"{filler}\n\n## Kept with its row\n\n{MIXED}", look=NoteLook(style="report"))
    pages = pdf_pages(rendered.pdf)
    heading = next(number for number, page in enumerate(pages) if "Kept with its row" in page)
    assert "Words beside the picture" in pages[heading]


def test_a_row_of_words_taller_than_a_page_prints_one_column_under_the_other(case):
    long = "\n\n".join(f"Line {n} of a very long column, words and words and words and more words." for n in range(60))
    text = f":::: columns\n::: column\n{long}\n:::\n::: column\n![Tall](/files/demo/tall.png)\n:::\n::::\n"
    rendered = render_pdf(case, text)
    joined = "\n".join(pdf_pages(rendered.pdf))
    assert all(f"Line {n} " in joined for n in range(60))
    assert ":::" not in joined
    # the picture comes after the words, at the frame's left edge
    [picture] = placed_images(rendered.pdf)
    assert picture[0] == len(pdf_pages(rendered.pdf)) - 1
    assert picture[1] == pytest.approx(notes_pdf.NotePage(title="T").l_margin, abs=0.3)


def test_a_row_of_pictures_taller_than_a_page_shrinks_as_one(case):
    text = (":::: columns\n::: column\n![A](/files/demo/strip.png){caption=\"One\"}\n:::\n"
            "::: column\n![B](/files/demo/strip.png){caption=\"Two\"}\n:::\n::::\n")
    rendered = render_pdf(case, text)
    [one, two] = placed_images(rendered.pdf)
    assert one[0] == two[0]
    assert one[4] == pytest.approx(two[4], abs=0.2)
    assert one[3] / one[4] == pytest.approx(200 / 1400, rel=0.02)
    page = notes_pdf.NotePage(title="T")
    assert one[4] < page.h - page.t_margin - page.b_margin
    assert "One" in pdf_pages(rendered.pdf)[one[0]] and "Two" in pdf_pages(rendered.pdf)[one[0]]


def test_the_public_pdf_leaves_an_internal_passage_in_a_column_out(case):
    text = MIXED.replace("- second point\n", "- second point\n\n> [!internal] The team's own lead.\n")
    joined = "\n".join(pdf_pages(render_pdf(case, text, public=True).pdf))
    assert "first point" in joined and "team's own" not in joined
    assert "team's own" in "\n".join(pdf_pages(render_pdf(case, text).pdf))


def test_a_heading_in_a_column_is_neither_numbered_nor_bookmarked(case):
    text = "# Part\n\n" + MIXED.replace("Words beside", "## Inside\n\nWords beside")
    rendered = render_pdf(case, text, look=NoteLook(style="report", numbered=True))
    reader = PdfReader(BytesIO(rendered.pdf))
    titles = [item.title for item in reader.outline if not isinstance(item, list)]
    assert "Inside" not in " ".join(titles)
    joined = "\n".join(pdf_pages(rendered.pdf))
    assert "Inside" in joined and "1.1" not in joined


# -- the HTML page ---------------------------------------------------------------------


def html_of(case, text, **options):
    rendered = notes_html.render(case, title="Columns", text=text, identity=notefill.Identity(), **options)
    page = rendered.html.decode() if isinstance(rendered.html, bytes) else rendered.html
    return page


def test_the_html_page_lays_a_row_of_pictures_by_their_shapes(case):
    page = html_of(case, PICTURES)
    body = page[page.index("<main"):]
    assert '<div class="az-columns az-columns-pictures">' in body
    grows = [float(value) for value in re.findall(r'class="az-column" style="flex:([0-9.]+) 1 0"', body)]
    assert grows == pytest.approx([900 / 600, 400 / 500], rel=0.01)
    assert ".az-columns-pictures" in page and "@media (max-width: 37.5rem)" in page
    assert ":::" not in re.sub(r"<[^>]+>", "", body)


def test_the_html_page_gives_a_row_of_words_its_shares_and_stacks_it_on_a_phone(case):
    page = html_of(case, MIXED.replace("Words beside", "## Inside\n\nWords beside"))
    body = page[page.index("<main"):]
    assert '<div class="az-columns">' in body
    grows = [float(value) for value in re.findall(r'class="az-column" style="flex:([0-9.]+) 1 0"', body)]
    assert grows == pytest.approx([66, 34])
    # a heading inside a column is no section of the page: no anchor, not in the contents
    assert re.search(r'<h2 class="az-column-heading" dir="auto">Inside</h2>', body)
    assert 'id="inside"' not in page
    css = (notes_html.ASSETS / "reader.columns.css").read_text(encoding="utf-8")
    assert ".az-columns:not(.az-columns-pictures) { flex-direction: column" in css


def test_a_page_without_columns_carries_none_of_their_rules(case):
    assert "az-columns" not in html_of(case, "Just words.\n")


def test_the_web_folder_carries_the_columns_rules(case):
    folder = notes_html.Folder(csp="default-src 'self'")
    notes_html.render(case, title="Columns", text=PICTURES, identity=notefill.Identity(), folder=folder)
    sheets = [data.decode("utf-8") for path, data in folder.files.items() if path.endswith(".css")]
    assert any(".az-columns-pictures" in sheet for sheet in sheets)


# -- the WordPress draft -------------------------------------------------------------


def test_wordpress_gets_its_own_columns_block(case):
    draft = notes_wordpress.build(case, title="Columns", text=PICTURES + "\n" + MIXED, identity=notefill.Identity())
    content = draft.content
    rows = re.findall(r"<!-- wp:columns( \{[^}]*\})? -->\n<div class=\"([^\"]+)\">", content)
    assert rows == [(' {"isStackedOnMobile":false}', "wp-block-columns is-not-stacked-on-mobile"),
                    ("", "wp-block-columns")]
    widths = re.findall(r'<!-- wp:column \{"width":"([0-9.]+)%"\} -->\n<div class="wp-block-column" '
                        r'style="flex-basis:([0-9.]+)%">', content)
    assert [float(written) for written, _ in widths] == pytest.approx([100 * 1.5 / 2.3, 100 * 0.8 / 2.3, 66, 34],
                                                                      abs=0.01)
    assert all(written == based for written, based in widths)
    assert ":::" not in content


# -- what reads a note as text ---------------------------------------------------------------


def test_the_fence_lines_are_never_words():
    unfenced = "\n".join(line for line in MIXED.split("\n") if not line.startswith(":::"))
    assert notetext.word_count(MIXED) == notetext.word_count(unfenced) > 0
    assert ":::" not in notetext.excerpt(MIXED) and "width" not in notetext.excerpt(MIXED)


def test_what_changed_reads_a_picture_in_a_column_as_a_picture():
    found = notediff.blocks(MIXED.replace("::: column\n![Tall]", "::: column width=34%\n![Tall]"))
    assert [block.kind for block in found] == ["text", "text", "text", "picture"]


def test_post_pieces_hold_the_words_of_every_column_and_no_fence():
    handed = notepieces.hand(None, title="Columns", text=MIXED)
    said = "\n".join(piece.get("text", "") for piece in handed.pieces)
    assert "Words beside the picture" in said and "second point" in said
    assert ":::" not in said and "width=" not in said
