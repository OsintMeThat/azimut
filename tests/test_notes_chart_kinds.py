"""The chart kinds past bars and columns (`engine/notes_chart_kinds.py`): each kind's picker
rule, its layout's maths, its honesty, its accessibility, and both painters.

The rows are the reference register (`fixtures/notes_charts/groups.md`: sixty vehicles, one
row each, by model, maker's country, class, grade and group) and the reference infographic's
own panels: the makers' donut, the grade bar, the budget waffle, the four key figures and the
timeline.
"""

from __future__ import annotations

import io
import math
from pathlib import Path
from xml.etree import ElementTree

import pytest
from PIL import Image, ImageChops, ImageDraw

from azimut.engine import iconlibrary, notes_chart_kinds as kinds, notes_charts as nc, notes_html

FIXTURES = Path(__file__).parent / "fixtures" / "notes_charts"
SVG = "{http://www.w3.org/2000/svg}"
NEW_KINDS = ("pie", "donut", "segments", "pictograms", "silhouette rows", "waffle", "key figures", "timeline",
             "line", "circles")


def _register() -> str:
    """The register's table: sixty rows, by model, maker, class, grade and group."""
    lines = (FIXTURES / "groups.md").read_text(encoding="utf-8").rstrip("\n").split("\n")
    return "\n".join(line for line in lines if line.startswith("|"))


def _block(text: str) -> nc.ChartBlock:
    return nc.parse_block(text)


def _layout(text: str, **options) -> nc.Layout:
    return nc.layout(_block(text), **options)


def _flat(chart: nc.Layout, *, groups: bool = False) -> list:
    out: list = []

    def walk(mark):
        if isinstance(mark, nc.Group):
            if groups:
                out.append(mark)
            for inner in mark.marks:
                walk(inner)
        else:
            out.append(mark)

    for mark in chart.marks:
        walk(mark)
    return out


def _words(chart: nc.Layout) -> list[str]:
    return [mark.text for mark in _flat(chart) if isinstance(mark, nc.Text)]


def _messages(chart_or_reading) -> list[str]:
    return [check.message for check in chart_or_reading.checks]


def _image(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image.convert("RGB")


MADE_IN = """source: our vehicle register
| Made in | Vehicles |
| --- | ---: |
| UAE | 22 |
| USA | 9 |
| Jordan | 2 |
| Saudi Arabia | 1 |
| Türkiye | 1 |"""

FIGURES = """source: our vehicle register
| Figure | Words |
| --- | --- |
| 51 of 54 | vehicles we could place lie in about 15 km² |
| 11 in 360 m | at the container roadblock; 12 within 750 m on the beach |
| ~15 km | of road gained south of Dhubab airport in October, handed back on 15 Nov |
| at least $9.1M | to replace what the videos show, up to about $20M |"""

WHEN = """title: When
source: our assessment
| Day | What | Until |
| --- | --- | --- |
| 5 Oct 2026 | Offensive opens toward Bab al-Mandab | |
| 11 Oct 2026 | Stalled on the north edge | 2 Nov 2026 |
| 14 Oct 2026 | First footage of some of these wrecks | |
| 2 Nov 2026 | Houthi gains to the north-east, Kahbub to al-Madaribah | 13 Nov 2026 |
| 15 Nov 2026 | Withdrawal; the ground is handed back | |
| 16 Nov 2026 | The two Houthi videos are posted | |"""

BUDGET = """kind: waffle
title: In proportion
squares: 10000
of: Saudi Arabia's 2026 military budget
source: Saudi Ministry of Finance
| Part | Cost |
| --- | ---: |
| Lost, at least | $8.4M |
| Lost, possibly more | $11.6M |
| Saudi Arabia's 2026 military budget | $64bn |"""

LINE = """kind: line
title: At least 25 confirmed, by day
colour by: Grade
source: our vehicle register
| Day | Grade | At least |
| --- | --- | ---: |
| 16 Nov 2026 | Confirmed | 4 |
| 17 Nov 2026 | Confirmed | 15 |
| 18 Nov 2026 | Confirmed | 25 |
| 16 Nov 2026 | Almost sure | 2 |
| 17 Nov 2026 | Almost sure | 9 |
| 18 Nov 2026 | Almost sure | 10 |"""

CIRCLES = """kind: circles
title: The money and the budget
highlight: Lost
source: Saudi Ministry of Finance
| What | Cost |
| --- | ---: |
| Saudi military budget | $64bn |
| Lost | $20M |"""


def _png_icon(colour=(20, 20, 20, 255), size=(120, 60)) -> bytes:
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle((10, 10, size[0] - 10, size[1] - 10), fill=colour)
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


# -- every kind, registered once, in the picker's order -------------------------------------------


def test_the_kinds_are_registered_in_the_pickers_order_with_their_keys():
    names = [kind.name for kind in nc.kinds()]
    assert names[:4] == ["bars", "columns", "stacked bars", "stacked columns"]
    assert names[4:14] == list(NEW_KINDS)
    assert nc.KINDS["donut"].keys == ("centre", "center")
    assert nc.KINDS["waffle"].keys == ("of", "squares")
    assert nc.KINDS["silhouette rows"].keys == ("icon", "flag", "per glyph")
    assert all(nc.KINDS[name].parts for name in ("pie", "donut", "segments", "pictograms", "waffle", "circles"))
    assert not any(nc.KINDS[name].counts for name in ("key figures", "timeline", "line"))
    for word, name in (("doughnut", "donut"), ("segmented bar", "segments"), ("unit chart", "pictograms"),
                       ("silhouettes", "silhouette rows"), ("stat tiles", "key figures"), ("chronology", "timeline"),
                       ("line chart", "line"), ("circle comparison", "circles")):
        assert nc.kind_named(word).name == name


@pytest.mark.parametrize("kind", NEW_KINDS)
@pytest.mark.parametrize("body", [
    "", "|", "| a |", "| a | b |\n| - | - |\n| 1 |", "count: rows\n| a |\n| --- |", "| a |\n| --- |\n| |",
    "| a | b |\n| --- | --- |\n| x | -1 |", "\x00\n| \x00 |", "| a | b |\n| --- | --- |\n| x | 0 |\n| y | 0 |",
    "| Day | What |\n| --- | --- |\n| 5 Oct | a |\n| 5 Oct | b |", "| Figure | Words |\n| --- | --- |\n| 1 | " + "x" * 290 + " |",
], ids=lambda value: f"chars{len(value)}")
def test_no_table_breaks_a_kind_or_the_painters(kind, body):
    for style in ("report", "dark"):
        chart = nc.layout(_block(f"kind: {kind}\n{body}"), theme=nc.theme_for(style), width=320)
        ElementTree.fromstring(nc.svg(chart))
        assert nc.render_png(chart, 320)[:8] == b"\x89PNG\r\n\x1a\n"


REGISTER = "source: our vehicle register\n" + _register()


@pytest.mark.parametrize("kind, body", [
    ("pie", MADE_IN), ("donut", MADE_IN), ("segments", "count: rows\ncolour by: Grade\n" + REGISTER),
    ("pictograms", "count: rows\ncolour by: Grade\nicon: armoured vehicle\n" + REGISTER),
    ("silhouette rows", "count: rows\nby: Model\ncolour by: Grade\nicon: armoured vehicle\n" + REGISTER),
    ("waffle", "count: rows\nby: Grade\n" + REGISTER), ("key figures", FIGURES), ("timeline", WHEN),
    ("line", LINE), ("circles", CIRCLES),
], ids=lambda value: value if value in NEW_KINDS else "")
def test_every_kind_fits_its_reference_table_draws_in_three_looks_and_says_itself(kind, body):
    block = _block(f"kind: {kind}\n{body}" if not body.startswith("kind:") else body)
    assert kind in nc.fitting(block.table)
    for style in nc.STYLES:
        chart = nc.layout(block, theme=nc.theme_for(style), note_text="Every figure is a minimum.")
        assert chart.kind == kind and chart.marks[0].fill == nc.theme_for(style).paper
        root = ElementTree.fromstring(nc.svg(chart, ident="k"))
        assert root.get("role") == "img" and root.get("aria-labelledby") == "k-title k-desc"
        assert root[0].text and root[1].text
        assert chart.lines and chart.table_head and chart.table_rows
        assert ElementTree.fromstring(nc.data_table_html(chart)).get("class") == "az-chart-data"
        assert chart.credit.startswith("Source")
        assert any(word.startswith("Source") for word in _words(chart))
        assert notes_html._clean_svg(nc.svg(chart, ident="k"), "k") is not None


@pytest.mark.parametrize("kind, body", [
    ("pie", MADE_IN), ("segments", "count: rows\ncolour by: Grade\n" + REGISTER),
    ("pictograms", "count: rows\ncolour by: Grade\nicon: pickup\n" + REGISTER),
    ("silhouette rows", "count: rows\nby: Model\ncolour by: Grade\n" + REGISTER), ("waffle", BUDGET),
    ("key figures", FIGURES), ("timeline", WHEN), ("line", LINE), ("circles", CIRCLES),
], ids=lambda value: value if value in NEW_KINDS else "")
@pytest.mark.parametrize("where, size", [("x", (1600, 900)), ("portrait", (1080, 1350)), ("square", (1080, 1080))])
def test_every_kind_fills_a_destination_at_its_exact_size(kind, body, where, size):
    block = _block(body if body.startswith("kind:") else f"kind: {kind}\n{body}")
    assert _image(nc.render(block, where)).size == size


@pytest.mark.parametrize("kind, body", [
    ("donut", MADE_IN), ("silhouette rows", "count: rows\nby: Model\ncolour by: Grade\nicon: armoured vehicle\n"
                                            + REGISTER),
    ("waffle", BUDGET), ("timeline", WHEN), ("line", LINE), ("circles", CIRCLES), ("key figures", FIGURES),
], ids=lambda value: value if value in NEW_KINDS else "")
def test_the_same_chart_is_the_same_bytes(kind, body):
    text = body if body.startswith("kind:") else f"kind: {kind}\n{body}"
    assert nc.svg(_layout(text)) == nc.svg(_layout(text))
    assert nc.render_png(_layout(text), 640) == nc.render_png(_layout(text), 640)


def test_a_new_kinds_setting_is_written_back_in_the_notebooks_order():
    body = ("kind: segments\nbars: up\ntitle: Grades\n| Grade | Count |\n| --- | --- |\n| Confirmed | 2 |\n"
            "| Almost sure | 1 |")
    assert nc.block_text(_block(body)).split("\n")[1:4] == ["kind: segments", "title: Grades", "bars: up"]
    waffle = _block(BUDGET)
    assert waffle.extra == {"squares": "10000", "of": "Saudi Arabia's 2026 military budget"}
    assert nc.block_text(_block("\n".join(nc.block_text(waffle).split("\n")[1:-1]))) == nc.block_text(waffle)
    assert any('a pie chart does not read "squares"' in message
               for message in _messages(nc.read(_block("kind: pie\nsquares: 100\n" + MADE_IN))))


def test_a_kind_of_parts_reads_its_by_column_as_its_colour_and_says_it_once():
    reading = nc.read(_block("kind: pie\n" + MADE_IN))
    assert reading.colour == reading.by == 0
    assert reading.values == ["UAE", "USA", "Jordan", "Saudi Arabia", "Türkiye"]
    assert reading.paints["UAE"].origin == "order"
    chart = nc.layout(reading.block)
    assert "coloured by" not in chart.desc
    assert chart.table_head == ["Made in", "Vehicles"] and chart.table_rows[0] == ["UAE", "22"]


# -- pie and donut -----------------------------------------------------------------------------------


def test_a_pies_angles_sum_to_a_turn_largest_first():
    chart = _layout("kind: pie\n" + MADE_IN)
    assert sum(chart.facts["angles"]) == pytest.approx(360)
    assert [name for name, _ in chart.facts["parts"]] == ["UAE", "USA", "Jordan", "Saudi Arabia", "Türkiye"]
    assert chart.facts["angles"][0] == pytest.approx(22 / 35 * 360)
    assert chart.facts["hole"] == 0
    assert "UAE: 22, 63%" in chart.lines


def test_grades_keep_their_order_in_a_pie_and_every_grade_stays_in_its_legend():
    chart = _layout("kind: pie\ncount: rows\nby: Grade\norder: Confirmed, Almost sure, Strong doubt, Set aside, "
                    "Too far to type\nsource: register\n" + _register())
    assert [name for name, _ in chart.facts["parts"]] == ["Confirmed", "Almost sure", "Strong doubt", "Set aside"]
    assert [(swatch.value, swatch.total) for swatch in chart.legend][-1] == ("Too far to type", 0)
    assert "Too far to type" in _words(chart)


def test_past_six_parts_the_smallest_fold_into_others_and_the_figure_names_them():
    rows = "\n".join(f"| Maker {index} | {20 - index} |" for index in range(8))
    chart = _layout(f"kind: pie\nsource: x\n| Maker | Vehicles |\n| --- | --- |\n{rows}")
    names = [name for name, _ in chart.facts["parts"]]
    assert len(names) == 6 and names[-1] == "Others"
    assert dict(chart.facts["parts"])["Others"] == 13 + 14 + 15
    assert chart.facts["folded"] == ["Maker 5", "Maker 6", "Maker 7"]
    assert "Others: Maker 5 15, Maker 6 14 and Maker 7 13." in chart.notes
    assert sum(chart.facts["angles"]) == pytest.approx(360)
    assert any('has 8 parts: past 5, the smallest are drawn as one, "Others"' in message for message in
               _messages(chart))


def test_a_pie_past_eight_values_says_one_folding_not_two():
    rows = "\n".join(f"| Maker {index} | {30 - index} |" for index in range(12))
    chart = _layout(f"kind: donut\nsource: x\n| Maker | Vehicles |\n| --- | --- |\n{rows}")
    said = _messages(chart)
    assert not any('drawn as "Other".' in message for message in said)
    assert any("has 12 parts" in message for message in said)
    assert any(note.startswith("Others: Maker 5, Maker 6, Maker 7 and 4 more") for note in chart.notes)


def test_a_highlight_lights_one_part_and_greys_the_rest_in_steps():
    theme = nc.theme_for("report")
    chart = _layout("kind: donut\nhighlight: UAE\n" + MADE_IN, theme=theme)
    colours = [swatch.paint.colour for swatch in chart.legend]
    assert colours[0] == theme.accent
    assert len(set(colours[1:])) == 4  # neighbours stay apart


@pytest.mark.parametrize("centre, said", [
    ("", ["22", "of 35", "UAE"]), ("centre: total", ["35", "vehicles"]), ("centre: USA", ["9", "of 35", "USA"]),
])
def test_a_donuts_middle_says_the_highlighted_part_a_named_one_or_the_total(centre, said):
    chart = _layout(f"kind: donut\nhighlight: UAE\n{centre}\n" + MADE_IN)
    words = _words(chart)
    start = words.index(said[0])
    assert words[start:start + len(said)] == said


def test_a_donuts_middle_can_be_empty_and_a_part_it_cannot_find_is_said():
    empty = _layout("kind: donut\ncentre: none\n" + MADE_IN)
    assert "35" not in _words(empty) and "of 35" not in _words(empty)
    lost = nc.read(_block("kind: donut\ncentre: Mars\n" + MADE_IN))
    check = next(check for check in lost.checks if "Mars" in check.message)
    assert "puts \"Mars\" in its middle, which no part holds" in check.message and check.line == 1
    floor = _layout("kind: donut\ntitle: At least 35\n" + MADE_IN.replace("| Vehicles |", "| At least |"))
    assert _words(floor)[_words(floor).index("35") - 1] == "at least"


def test_a_wedge_keeps_a_gap_of_paper_and_a_whole_turn_is_a_ring():
    assert kinds.wedge_path(50, 50, 40, 0, 0, 360).count("A") == 2
    assert kinds.wedge_path(50, 50, 40, 24, 0, 360).count("A") == 4
    path = kinds.wedge_path(50, 50, 40, 0, 0, 90)
    start = [float(value) for value in path[1:path.index("A")].split()]
    assert start[0] > 50  # the cut edge sits a pixel off twelve o'clock
    assert kinds._ratio_text(20e6, 64e9) == "0.03%" and kinds._ratio_text(1, 1e9) == "under 0.01%"


# -- segments -------------------------------------------------------------------------------------------


def test_segments_are_one_bar_of_the_shares_with_paper_between_them():
    chart = _layout("kind: segments\ncount: rows\ncolour by: Grade\nsource: register\n" + _register())
    spans = chart.facts["spans"]
    assert [name for name, _, _ in spans] == ["Confirmed", "Almost sure", "Strong doubt", "Set aside"]
    widths = [width for _, _, width in spans]
    gaps = len(spans) - 1
    assert sum(widths) + 2 * gaps == pytest.approx(chart.facts["length"])
    assert widths[0] / widths[1] == pytest.approx(25 / 10)
    assert chart.facts["outside"] == []
    assert {"25", "10", "13", "12"} <= set(_words(chart))


def test_a_segment_too_narrow_for_its_number_prints_it_under_on_a_leader_never_on_another():
    body = ("kind: segments\nsource: x\n| Grade | Count |\n| --- | --- |\n| Confirmed | 200 |\n| Almost sure | 1 |\n"
            "| Strong doubt | 1 |\n| Set aside | 1 |")
    chart = _layout(body)
    assert chart.facts["outside"] == ["Almost sure", "Strong doubt", "Set aside"]
    texts = [mark for mark in _flat(chart) if isinstance(mark, nc.Text) and mark.text == "1"]
    assert len(texts) == 3
    spans = sorted((mark.x, mark.x + nc.text_width("1", mark.size, chart.theme.head, bold=True)) for mark in texts)
    assert all(right <= next_left for (_, right), (next_left, _) in zip(spans, spans[1:]))
    assert sum(1 for mark in _flat(chart) if isinstance(mark, nc.Line)) >= 3


def test_a_part_at_zero_draws_nothing_and_keeps_its_name_and_zero_in_the_legend():
    chart = _layout("kind: segments\norder: Confirmed, Set aside\nsource: x\n| Grade | Count |\n| --- | --- |\n"
                    "| Confirmed | 3 |")
    assert [name for name, _, _ in chart.facts["spans"]] == ["Confirmed"]
    assert ("Set aside", 0) in [(swatch.value, swatch.total) for swatch in chart.legend]
    assert "0" in _words(chart) and "Set aside" in _words(chart)


def test_standing_segments_name_each_part_beside_it():
    chart = _layout("kind: segments\nbars: up\ncount: rows\ncolour by: Grade\nsource: register\n" + _register())
    words = _words(chart)
    for name, count in (("Confirmed", "25"), ("Almost sure", "10"), ("Strong doubt", "13"), ("Set aside", "12")):
        assert words[words.index(name) + 1] == count
    tops = [mark.y for mark in _flat(chart) if isinstance(mark, nc.Text) and mark.text in ("Confirmed", "Almost sure")]
    assert tops[1] - tops[0] >= chart.theme.label_size


# -- pictograms and silhouette rows ---------------------------------------------------------------------


@pytest.mark.parametrize("word, key", [
    ("armoured vehicle", "badge-armoured-vehicle"), ("Armored Vehicle", "badge-armoured-vehicle"),
    ("badge-pickup", "badge-pickup"), ("pickup", "badge-pickup"), ("dot", "dot"), ("circle", "dot"),
    ("own:0123456789ABCDEF", "own:0123456789abcdef"), ("own:xyz", ""), ("Mars", ""), ("", ""),
])
def test_a_glyph_is_named_by_a_badge_a_plain_shape_or_an_own_icon(word, key):
    assert kinds.glyph_key(word) == key


def test_pictograms_draw_one_glyph_per_unit_in_rows_of_ten_part_after_part():
    chart = _layout("kind: pictograms\ncount: rows\ncolour by: Grade\nicon: armoured vehicle\nsource: register\n"
                    + _register())
    assert chart.facts["unit"] == 1 and chart.facts["glyphs"] == 60 and chart.facts["across"] == 10
    assert chart.facts["per_part"] == {"Confirmed": 25, "Almost sure": 10, "Strong doubt": 13, "Set aside": 12}
    shapes = [group for group in _flat(chart, groups=True) if isinstance(group, nc.Group) and group.title.startswith(
        "Confirmed:") and not any(isinstance(mark, nc.Text) for mark in group.marks)]
    assert len(shapes) == 25
    fills = {mark.fill for group in shapes for mark in group.marks if isinstance(mark, nc.Shape) and mark.fill != "none"}
    assert "#184f95" in fills
    assert not chart.notes  # one glyph, one vehicle: nothing to say


def test_a_glyph_column_gives_each_row_its_own_glyph():
    lines = []
    for line in _register().split("\n"):
        if line.startswith("| #"):
            line += " Icon |"
        elif line.startswith("| ---"):
            line += " --- |"
        else:
            line += " pickup |" if "Unarmoured" in line else " armoured vehicle |"
        lines.append(line)
    chart = _layout("kind: pictograms\ncount: rows\ncolour by: Grade\nicon: Icon\nsource: x\n" + "\n".join(lines))
    paths = {mark.d for mark in _flat(chart) if isinstance(mark, nc.Shape)}
    pickup = kinds.glyph("badge-pickup").layers[0][1]
    armoured = kinds.glyph("badge-armoured-vehicle").layers[0][1]
    assert pickup in paths and armoured in paths
    assert not any("cannot draw" in message for message in _messages(chart))


def test_past_the_cap_one_glyph_stands_for_a_round_number_and_says_so():
    chart = _layout("kind: pictograms\ntitle: At least 1,235 vehicles, by side\nicon: armoured vehicle\nsource: x\n"
                    "| Side | At least |\n| --- | --- |\n"
                    "| Side A | 830 |\n| Side B | 405 |")
    assert chart.facts["unit"] == 20
    assert chart.facts["glyphs"] == math.ceil(1235 / 20)
    assert chart.facts["per_part"]["Side A"] == pytest.approx(830 / 20)
    assert "= 20 vehicles" in _words(chart)
    assert "A cut glyph stands for fewer than 20 vehicles." in chart.notes
    written = _layout("kind: pictograms\nper glyph: 50\nsource: x\n| Side | Count |\n| --- | --- |\n| A | 100 |")
    assert written.facts["unit"] == 50 and written.facts["glyphs"] == 2
    assert kinds.glyph_unit(60, "") == 1 and kinds.glyph_unit(121, "") == 2 and kinds.glyph_unit(10**9, "") > 0


def test_a_cut_glyph_is_drawn_in_part_not_rounded():
    path = kinds.clipped_path("M0 0H10V10H0Z", 0, 2.5, closed=True)
    points = [tuple(float(value) for value in pair.split()) for pair in path[1:-1].split("L")]
    assert max(x for x, _ in points) == pytest.approx(2.5) and min(x for x, _ in points) == pytest.approx(0)
    assert kinds.clipped_path("M0 5H10", 2, 4, closed=False) == "M2 5L4 5"
    assert kinds.clipped_path("M0 0H10V10H0Z", 20, 30, closed=True) == ""
    drawing = kinds.glyph("badge-armoured-vehicle")
    whole = kinds.glyph_marks(drawing, nc.Paint("#184f95"), nc.theme_for("report"), 0, 0, 20)
    half = kinds.glyph_marks(drawing, nc.Paint("#184f95"), nc.theme_for("report"), 0, 0, 20, (0.0, 0.5))
    assert half and len(half) <= len(whole)


def test_an_outlined_grade_draws_its_glyph_in_outline():
    marks = kinds.glyph_marks(kinds.glyph("badge-pickup"), nc.Paint("#86b6ef", outline=True),
                              nc.theme_for("report"), 0, 0, 20)
    assert all(mark.fill == "#ffffff" and mark.stroke == "#86b6ef" for mark in marks)


def test_an_unknown_icon_is_said_and_drawn_as_dots():
    reading = nc.read(_block("kind: pictograms\nicon: unicorn\nsource: x\n| Side | Count |\n| --- | --- |\n| A | 3 |"))
    assert any('cannot draw "unicorn": name a badge of the map or an icon of your library; it shows dots.' in message
               for message in _messages(reading))
    bad = nc.read(_block("kind: pictograms\nper glyph: many\nsource: x\n| Side | Count |\n| --- | --- |\n| A | 3 |"))
    assert any('cannot read "per glyph: many"' in message for message in _messages(bad))


def test_silhouette_rows_give_each_category_its_row_its_count_and_its_glyphs():
    chart = _layout("kind: silhouette rows\ncount: rows\nby: Model\ncolour by: Grade\nonly: Class is Armoured\n"
                    "last: Model open\nicon: armoured vehicle\nsource: register\n" + _register())
    words = _words(chart)
    assert words.index("Streit Cougar") < words.index("8")
    assert chart.facts["glyphs"][0] == 8 and sum(chart.facts["glyphs"]) == 41
    assert "Only rows where Class is Armoured: 41 of 60." in chart.notes
    assert any(isinstance(mark, nc.Line) for mark in chart.marks)  # the rule before "Model open"
    assert ("Set aside", 0) in [(swatch.value, swatch.total) for swatch in chart.legend]
    harrow = [group.title for group in _flat(chart, groups=True)
              if isinstance(group, nc.Group) and group.title.startswith("Harrow Tygor E1,")]
    assert harrow.count("Harrow Tygor E1, Almost sure: 7") == 7 and harrow.count("Harrow Tygor E1, Confirmed: 1") == 1


def test_a_long_row_of_silhouettes_wraps_onto_more_lines_within_the_frame():
    chart = _layout("kind: silhouette rows\nsource: x\n| Maker | Vehicles |\n| --- | --- |\n| UAE | 60 |\n| USA | 9 |",
                    width=400)
    across = chart.facts["across"]
    assert across < 60
    glyph_xs = [mark.x for mark in _flat(chart) if isinstance(mark, nc.Shape)]
    assert max(glyph_xs) < 400


def test_a_highlighted_row_takes_the_accent_and_the_others_grey():
    theme = nc.theme_for("book")
    chart = _layout("kind: silhouette rows\nhighlight: UAE\nsource: x\n| Maker | Count |\n| --- | --- |\n| UAE | 3 |\n"
                    "| USA | 2 |", theme=theme)
    fills = {group.title.split(":")[0]: {mark.fill for mark in group.marks if isinstance(mark, nc.Shape)}
             for group in _flat(chart, groups=True) if isinstance(group, nc.Group) and group.title}
    assert fills["UAE"] == {theme.accent} and fills["USA"] == {theme.others}


def test_own_icons_draw_as_pictures_a_silhouette_in_its_parts_colour_a_flag_as_it_is(tmp_workspace):
    added = iconlibrary.add_pngs([
        {"png": _png_icon(), "name": "MRAP", "mode": "disc"},
        {"png": _png_icon((0, 115, 47, 255), (90, 60)), "name": "Flag", "mode": "image"},
    ])["added"]
    vehicle, flag = (icon["key"] for icon in added)
    body = (f"kind: silhouette rows\nicon: own:{vehicle}\nflag: Flag\ncolours: UAE #eb6834\nsource: x\n"
            f"| Maker | Flag | Count |\n| --- | --- | --- |\n| UAE | own:{flag} | 2 |")
    chart = _layout(body)
    pictures = [mark for mark in _flat(chart) if isinstance(mark, nc.Picture)]
    assert len(pictures) == 3  # the flag, then a glyph per vehicle
    tinted = _image(pictures[1].data)
    assert (0xEB, 0x68, 0x34) in {colour for _, colour in tinted.getcolors(100_000)}
    assert pictures[0].w / pictures[0].h == pytest.approx(70 / 40, abs=0.05)  # trimmed to its ink
    svg = nc.svg(chart)
    assert svg.count('<image href="data:image/png;base64,') == 3
    picture = _image(nc.render_png(chart, 640))
    assert (0, 115, 47) in {colour for _, colour in picture.getcolors(1_000_000)}
    assert not any("cannot draw" in message for message in _messages(chart))
    iconlibrary.remove([vehicle])
    gone = _layout(body)
    assert any(f'cannot draw "own:{vehicle}"' in message for message in _messages(gone))
    assert sum(isinstance(mark, nc.Picture) for mark in _flat(gone)) == 1  # the flag; the vehicles are dots
    assert kinds.glyph(f"own:{vehicle}").key == "dot"


# -- waffle ------------------------------------------------------------------------------------------


def test_a_waffle_of_a_whole_fills_a_hundred_squares_part_after_part():
    chart = _layout("kind: waffle\ntitle: At least 60 vehicles, by grade\ncount: rows\nby: Grade\nsource: register\n"
                    + _register())
    assert chart.facts["squares"] == 100 and chart.facts["whole"] == 60
    assert chart.facts["filled"] == pytest.approx({"Confirmed": 25 / 0.6, "Almost sure": 10 / 0.6,
                                                   "Strong doubt": 13 / 0.6, "Set aside": 12 / 0.6})
    assert sum(chart.facts["filled"].values()) == pytest.approx(100)
    squares = [group for group in _flat(chart, groups=True) if isinstance(group, nc.Group) and group.title]
    shared = [group for group in squares if sum(isinstance(mark, nc.Rect) for mark in group.marks) > 2]
    assert shared  # a square two parts share is filled by both, each its part of the width
    assert "1 square = 1/100 of the 60 vehicles" in " ".join(_words(chart))


def test_a_waffle_of_a_far_larger_whole_draws_ten_thousand_squares_and_its_corner_enlarged():
    chart = _layout(BUDGET)
    assert chart.facts["squares"] == 10_000 and chart.facts["whole"] == 64e9
    assert chart.facts["each"] == pytest.approx(6.4e6)
    assert chart.facts["filled"] == pytest.approx({"Lost, at least": 8.4e6 / 6.4e6,
                                                   "Lost, possibly more": 11.6e6 / 6.4e6})
    assert "Saudi Arabia's 2026 military budget" not in [swatch.value for swatch in chart.legend]
    words = " ".join(_words(chart))
    assert "The top-left corner, enlarged" in words
    assert "1 square = 1/10,000 of Saudi Arabia's 2026 military budget, ≈ $6.4M" in words
    assert "$8.4M" in words and "$64bn" in words
    accent = nc.theme_for("report").accent
    assert chart.legend[0].paint.colour == accent and chart.legend[1].paint.colour != accent


@pytest.mark.parametrize("settings, said", [
    ("of: Mars", 'cannot read its whole, "Mars": name a row or write a number.'),
    ("of: 10", "has parts that come to more than its whole"),
    ("squares: 500", 'draws 100 or 10,000 squares, not "500".'),
])
def test_a_waffles_whole_and_grid_are_checked(settings, said):
    reading = nc.read(_block(f"kind: waffle\n{settings}\nsource: x\n| Part | Count |\n| --- | --- |\n| A | 30 |\n"
                             "| B | 20 |"))
    assert any(said in message for message in _messages(reading)), _messages(reading)
    nc.layout(reading.block)


def test_a_waffle_whole_written_as_a_number_scales_its_squares():
    chart = _layout("kind: waffle\nof: 200\nsource: x\n| Part | Count |\n| --- | --- |\n| A | 30 |\n| B | 20 |")
    assert chart.facts["each"] == 2 and chart.facts["filled"] == {"A": 15, "B": 10}


# -- key figures ---------------------------------------------------------------------------------------------


def test_key_figures_are_tiles_four_across_at_least_over_a_floor():
    chart = _layout("kind: key figures\n" + FIGURES)
    assert chart.facts["across"] == 4
    assert [(figure, floor) for figure, _, floor in chart.facts["tiles"]] == [
        ("51 of 54", False), ("11 in 360 m", False), ("~15 km", False), ("$9.1M", True)]
    words = _words(chart)
    assert words.count("AT LEAST") == 1 and words[words.index("AT LEAST") + 1] == "$9.1M"
    assert chart.title == "" and chart.desc == "Key figures: 4."
    assert chart.table_rows[3] == ["at least $9.1M", "to replace what the videos show, up to about $20M"]
    said = " ".join(words)
    for _, words_line, _ in chart.facts["tiles"]:
        assert all(word in said for word in words_line.split())  # wrapped, never cut
    assert not any("counts at least" in message for message in _messages(nc.read(_block("kind: key figures\n" + FIGURES),
                                                                                  note_text="Every figure is a minimum.")))


def test_key_figures_narrow_to_fewer_tiles_and_a_wide_figure_is_set_smaller_not_cut():
    narrow = _layout("kind: key figures\n" + FIGURES, width=320)
    assert narrow.facts["across"] == 2
    wide = _layout("kind: key figures\nsource: x\n| Figure | Words |\n| --- | --- |\n"
                   "| 1,234,567,890 vehicles | many |\n| 2 | two |", width=320)
    figure = next(mark for mark in _flat(wide) if isinstance(mark, nc.Text) and mark.text.startswith("1,234"))
    tile = (320 - 32 - 20) / 2
    assert nc.text_width(figure.text, figure.size, wide.theme.head, bold=True) <= tile + 0.5
    assert figure.size < 28 and "…" not in " ".join(_words(wide))


def test_key_figures_fit_rows_of_figure_and_words_only():
    assert nc.KINDS["key figures"].fits(_block(FIGURES).table)
    assert not nc.KINDS["key figures"].fits(_block(WHEN).table)
    assert not nc.KINDS["key figures"].fits(_block(MADE_IN).table)


# -- timeline ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize("cell, day, precision, said", [
    ("2026-10-05", (2026, 10, 5), "day", True), ("5 Oct 2026", (2026, 10, 5), "day", True),
    ("Oct 5, 2026", (2026, 10, 5), "day", True), ("5th October 2026", (2026, 10, 5), "day", True),
    ("5 Oct", (2000, 10, 5), "day", False), ("Oct 2026", (2026, 10, 1), "month", True),
    ("2026-10", (2026, 10, 1), "month", True), ("2026", (2026, 1, 1), "year", True),
])
def test_a_day_reads_as_a_cell_writes_it(cell, day, precision, said):
    found = kinds.read_day(cell)
    assert (found.day.year, found.day.month, found.day.day) == day
    assert found.precision == precision and found.year is said


def test_a_day_without_its_year_takes_the_columns_and_bad_days_are_none():
    assert kinds.read_day("5 Oct", 2026).day.year == 2026
    assert kinds.read_day("31 Feb 2026") is None and kinds.read_day("soon") is None
    assert kinds.day_text(kinds.read_day("5 Oct 2026")) == "5 Oct"
    assert kinds.day_text(kinds.read_day("5 Oct 2026"), year=True) == "5 Oct 2026"
    assert kinds.day_text(kinds.read_day("Oct 2026")) == "Oct 2026"


def test_the_reference_timeline_ticks_on_the_first_and_fifteenth():
    from datetime import date

    _, _, ticks = kinds.time_domain(date(2026, 10, 5), date(2026, 11, 16), 600, years=True)
    assert [label for _, label in ticks] == ["1 Oct", "15 Oct", "1 Nov", "15 Nov"]
    long = kinds.time_ticks(date(2025, 11, 1), date(2026, 6, 1), 600)
    assert [label for _, label in long][:3] == ["Nov 2025", "Dec", "Jan 2026"]


def test_a_timeline_draws_points_and_periods_and_no_label_meets_another():
    chart = _layout("kind: timeline\n" + WHEN)
    assert chart.facts["tracks"] == 2 and chart.facts["inside"] == ["Stalled on the north edge"]
    _assert_lanes_clear(chart)
    words = " ".join(_words(chart))
    assert "Stalled on the north edge, 11 Oct – 2 Nov" in words and "2 Nov – 13 Nov" in words
    assert chart.title == "When" and chart.desc.startswith("Timeline: 6 rows, from 5 Oct 2026 to 16 Nov 2026")
    assert chart.table_head == ["Day", "What", "Until"]
    assert chart.table_rows[1] == ["11 Oct 2026", "Stalled on the north edge", "2 Nov 2026"]


def _assert_lanes_clear(chart: nc.Layout) -> None:
    labels = chart.facts["labels"]
    for index, (lane, (a, b)) in enumerate(labels):
        for other_lane, (c, d) in labels[index + 1:]:
            if lane == other_lane:
                assert b <= c or d <= a


def test_crowded_days_climb_into_lanes_and_no_stem_crosses_a_label():
    rows = "\n".join(f"| {day} Oct 2026 | Something long happened on this day, number {day} |"
                     for day in (1, 2, 2, 3, 4, 20, 21, 30, 31))
    chart = _layout(f"kind: timeline\nsource: x\n| Day | What |\n| --- | --- |\n{rows}")
    assert chart.facts["lanes"] >= 3
    _assert_lanes_clear(chart)
    # the solver alone, on labels that overhang each other's days
    labels = [kinds._Label(x, ["w"], "d", 120.0, 20.0) for x in (10, 40, 70, 100)]
    labels.append(kinds._Label(390, ["w"], "d", 120.0, 20.0, anchor="end"))
    labels.append(kinds._Label(400, ["w"], "d", 120.0, 20.0, anchor="end"))
    kinds.lanes(labels)
    for label in labels:
        for other in labels:
            if other is not label and other.lane < label.lane:
                assert not other.text[0] - 1 <= label.x <= other.text[1] + 1  # my stem passes no lower words


def test_many_events_or_a_narrow_frame_list_the_timeline_down_the_page():
    chart = _layout("kind: timeline\n" + WHEN, width=360)
    assert chart.facts.get("down") is True
    rows = chart.facts["rows"]
    assert all(top + height <= next_top for (top, height), (next_top, _) in zip(rows, rows[1:]))


def test_a_timeline_with_no_day_says_so_and_rows_it_cannot_read_are_noted():
    none = nc.read(_block("kind: timeline\nsource: x\n| When | What |\n| --- | --- |\n| soon | a |"))
    assert any("has no column of days" in message for message in _messages(none))
    some = _layout("kind: timeline\nsource: x\n| Day | What |\n| --- | --- |\n| 5 Oct 2026 | a |\n| 6 Oct 2026 | b |"
                   "\n| later | c |")
    assert "1 row with no day it can read is not drawn." in some.notes
    assert not nc.KINDS["timeline"].fits(_block(MADE_IN).table)


# -- line ---------------------------------------------------------------------------------------------------


def test_a_line_per_colour_value_with_ringed_end_dots_and_its_ends_named():
    chart = _layout(LINE)
    assert chart.facts["direct"] and chart.facts["floor"]
    assert chart.facts["series"]["Confirmed"][-1][1] == 25
    assert chart.scale.ticks[0] == 0
    ends = [mark for mark in _flat(chart) if isinstance(mark, nc.Circle) and mark.r == 4.5]
    assert len(ends) == 2 and all(mark.stroke == chart.theme.paper and mark.stroke_width == 2 for mark in ends)
    lines = [mark for mark in _flat(chart) if isinstance(mark, nc.Line) and mark.width == 2.0]
    assert len(lines) == 2
    words = _words(chart)
    assert words[words.index("Confirmed") + 1] == "25"
    assert chart.table_head == ["Day", "Confirmed", "Almost sure"]
    assert chart.legend and words.count("Confirmed") == 1  # named at its end, no legend besides


def test_past_four_lines_a_legend_says_them_and_years_print_plain():
    rows = "\n".join(f"| {year} | S{series} | {year - 2000 + series} |" for year in (2020, 2021, 2022)
                     for series in range(5))
    chart = _layout(f"kind: line\ncolour by: Series\nsource: x\n| Year | Series | Count |\n| --- | --- | --- |\n{rows}")
    assert not chart.facts["direct"]
    assert "2020" in _words(chart) and "2,020" not in _words(chart)
    assert len(chart.legend) == 5


def test_a_line_counting_floors_wants_at_least_in_its_title():
    reading = nc.read(_block(LINE.replace("title: At least 25 confirmed, by day", "title: Confirmed by day")))
    assert any('"Confirmed by day" counts at least: say so in its title.' == message for message in
               _messages(reading))
    assert nc.KINDS["line"].fits(_block(LINE).table)
    assert not nc.KINDS["line"].fits(_block(MADE_IN).table)
    words = nc.read(_block("kind: line\nsource: x\n| Day | Note |\n| --- | --- |\n| 5 Oct 2026 | a |"))
    assert any("needs a column of days or numbers along" in message for message in _messages(words))


# -- circles ---------------------------------------------------------------------------------------------------


def test_circles_are_areas_to_scale_and_a_tiny_one_is_ringed_and_named_beside_it():
    chart = _layout(CIRCLES)
    big, small = chart.facts["areas"]
    assert small / big == pytest.approx(20e6 / 64e9)
    assert "Areas to scale." in chart.notes
    rings = [mark for mark in _flat(chart) if isinstance(mark, nc.Circle) and mark.fill == "none"]
    assert len(rings) == 1
    words = _words(chart)
    assert words.index("$64bn") < words.index("$20M")
    assert "0.03% of Saudi military budget" in words
    assert chart.legend[1].paint.colour == chart.theme.accent


def test_a_circle_comparison_draws_three_and_says_what_it_left_out():
    chart = _layout("kind: circles\nsource: x\n| Video | Count |\n| --- | --- |\n| A | 46 |\n| B | 33 |\n| C | 19 |\n"
                    "| D | 5 |")
    assert len(chart.facts["radii"]) == 3
    assert "1 more row not drawn: a comparison shows 3 circles." in chart.notes
    assert any("compares 4 rows: it draws the 3 largest." in message for message in _messages(chart))
    assert nc.KINDS["circles"].fits(_block(CIRCLES).table)
    assert not nc.KINDS["circles"].fits(_block(MADE_IN).table)


# -- the picker ------------------------------------------------------------------------------------------------


def test_the_picker_offers_the_kinds_a_tables_shape_suits():
    assert nc.fitting(_block(MADE_IN).table) == [
        "bars", "columns", "pie", "donut", "segments", "pictograms", "silhouette rows", "waffle"]
    assert nc.fitting(_block(FIGURES).table) == ["bars", "columns", "key figures"]
    assert "timeline" in nc.fitting(_block(WHEN).table) and "key figures" not in nc.fitting(_block(WHEN).table)
    two = _block("| Video | Seen |\n| --- | --- |\n| One | 33 |\n| Two | 46 |").table
    assert "pie" not in nc.fitting(two) and "circles" in nc.fitting(two)
    money = _block("| Part | Cost |\n| --- | --- |\n| A | 2.5 |\n| B | 1.5 |").table
    assert "pictograms" not in nc.fitting(money) and "waffle" in nc.fitting(money)


# -- the Picture mark in both painters ------------------------------------------------------------------------


def _picture_chart(picture: nc.Picture) -> nc.Layout:
    theme = nc.theme_for("report")
    return nc.Layout(200, 100, theme, [nc.Rect(0, 0, 200, 100, theme.paper), picture], "Pictures", "A picture.",
                     [], [], None, [], [], "", "test", [], [], [])


def test_a_picture_is_fitted_or_covers_its_box_in_both_painters():
    wide = _png_icon((200, 30, 30, 255), (200, 100))
    fitted = _picture_chart(nc.Picture(50, 0, 100, 100, wide))
    text = nc.svg(fitted)
    assert 'preserveAspectRatio="xMidYMid meet"' in text and 'href="data:image/png;base64,' in text
    image = _image(nc.render_png(fitted, 200))
    assert image.getpixel((100, 50)) == (200, 30, 30)
    assert image.getpixel((100, 10)) == (255, 255, 255)  # fitted: the box's top stays paper
    covered = _picture_chart(nc.Picture(50, 0, 100, 100, wide, cover=True))
    assert 'preserveAspectRatio="xMidYMid slice"' in nc.svg(covered)
    red, green, blue = _image(nc.render_png(covered, 200)).getpixel((100, 12))
    assert abs(red - 200) < 4 and abs(green - 30) < 4 and abs(blue - 30) < 4


def test_a_jpeg_is_drawn_and_what_is_no_picture_is_left_out(monkeypatch):
    out = io.BytesIO()
    Image.new("RGB", (40, 40), (10, 120, 200)).save(out, "JPEG")
    jpeg = _picture_chart(nc.Picture(0, 0, 100, 100, out.getvalue()))
    assert 'href="data:image/jpeg;base64,' in nc.svg(jpeg)
    red, green, blue = _image(nc.render_png(jpeg, 200)).getpixel((50, 50))
    assert abs(red - 10) < 8 and abs(green - 120) < 8 and abs(blue - 200) < 8
    junk = _picture_chart(nc.Picture(0, 0, 100, 100, b"<svg onload=alert(1)>"))
    assert "<image" not in nc.svg(junk)
    assert _image(nc.render_png(junk, 200)).getpixel((50, 50)) == (255, 255, 255)
    monkeypatch.setattr(nc, "MAX_PICTURE_PIXELS", 100)
    huge = _picture_chart(nc.Picture(0, 0, 100, 100, _png_icon()))
    assert _image(nc.render_png(huge, 200)).getpixel((50, 50)) == (255, 255, 255)


# -- a picture of fixed size is filled ---------------------------------------------------------------------


FRAMED = {
    "bars": "kind: bars\ntitle: At least 60 vehicles, by model\ncount: rows\nby: Model\nsource: register\n",
    "stacked columns": "kind: stacked columns\ntitle: At least 51\ncount: rows\nby: Group\ncolour by: Grade\nsource: x\n",
    "pie": "kind: pie\ntitle: Where they were made\n" + MADE_IN,
    "donut": "kind: donut\ntitle: Where they were made\n" + MADE_IN,
    "segments": "kind: segments\ntitle: How sure we are\ncount: rows\ncolour by: Grade\nsource: register\n",
    "pictograms": "kind: pictograms\ntitle: What was lost\ncount: rows\ncolour by: Grade\nicon: armoured vehicle\n"
                  "source: register\n",
    "a few pictograms": "kind: pictograms\ntitle: Twelve\nicon: armoured vehicle\nsource: x\n| Grade | Count |\n"
                        "| --- | --- |\n| Confirmed | 8 |\n| Almost sure | 4 |",
    "silhouette rows": "kind: silhouette rows\ntitle: By model\ncount: rows\nby: Model\ncolour by: Grade\n"
                       "icon: armoured vehicle\nsource: register\n",
    "a few silhouette rows": "kind: silhouette rows\ntitle: By maker\nicon: armoured vehicle\n" + MADE_IN,
    "waffle": "kind: waffle\ntitle: At least 60 vehicles, by grade\ncount: rows\nby: Grade\nsource: register\n",
    "key figures": "kind: key figures\n" + FIGURES,
    "timeline": "kind: timeline\n" + WHEN,
    "line": LINE,
    "circles": CIRCLES,
}


def _framed(name: str) -> str:
    body = FRAMED[name]
    return body + _register() if body.endswith("\n") else body


def _inked_tiles(data: bytes, across: int = 12) -> float:
    """The share of a picture's tiles, under its title band and over its foot, that hold ink."""
    image = _image(data)
    paper = Image.new("RGB", image.size, image.getpixel((2, 2)))
    ink = ImageChops.difference(image, paper).convert("L").point(lambda value: 255 if value > 24 else 0)
    width, height = image.size
    tiles = [(column, row) for column in range(across) for row in range(3, across - 1)]
    inked = sum(1 for column, row in tiles if ink.crop((column * width // across, row * height // across,
                                                        (column + 1) * width // across,
                                                        (row + 1) * height // across)).getbbox())
    return inked / len(tiles)


@pytest.mark.parametrize("size", ["x", "portrait", "square"])
@pytest.mark.parametrize("name", list(FRAMED))
def test_every_kind_uses_a_picture_of_fixed_size_and_leaves_no_half_empty(name, size):
    data = nc.render(_block(_framed(name)), size, title=True)
    assert _inked_tiles(data) >= 0.45


def test_pictograms_in_a_frame_are_as_large_as_it_lets_them_be_rows_of_ten_kept_when_cheap():
    assert kinds.glyph_grid(60, 1.6, 520, 220)[0] == 10
    across, height = kinds.glyph_grid(12, 1.6, 440, 560)
    assert across in (3, 4) and height > 2 * 24
    # every glyph inside the frame: never cut
    for glyphs, width, frame in ((12, 440, 560), (60, 520, 220), (120, 440, 440), (7, 520, 150)):
        across, height = kinds.glyph_grid(glyphs, 1.6, width, frame)
        assert kinds._grid_width(across, height, 1.6) <= width + 1e-6
        assert (math.ceil(glyphs / across) - 1) * height * kinds.GLYPH_LINE + height <= frame + 1e-6


def test_dots_at_x_fill_the_width_rather_than_leave_its_right_half_empty():
    body = "kind: pictograms\ntitle: What was lost\ncount: rows\ncolour by: Grade\nsource: register\n" + _register()
    image = _image(nc.render(_block(body), "x", title=True))
    paper = Image.new("RGB", image.size, image.getpixel((2, 2)))
    ink = ImageChops.difference(image, paper).convert("L").point(lambda value: 255 if value > 24 else 0)
    width, height = image.size
    left, _, right, _ = ink.crop((0, int(height * 0.3), width, int(height * 0.85))).getbbox()
    assert right / width > 0.85 and left / width < 0.15


def test_silhouette_rows_take_two_columns_in_a_wide_frame_they_overflow():
    body = _framed("silhouette rows")
    page = nc.layout(_block(body), width=640)
    assert page.facts["columns"] == 1
    wide = nc.layout(_block(body), width=560, height=315)
    assert wide.facts["columns"] == 2 and sum(wide.facts["glyphs"]) == 60
    names = {mark.text: mark.x for mark in _flat(wide) if isinstance(mark, nc.Text)}
    assert names["BMC Kirpi II"] > names["Streit Cougar"] + 200
