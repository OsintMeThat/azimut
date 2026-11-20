"""The timeline (`engine/notes_chart_timeline.py`): its four layouts and Auto's rule, the
lanes across (both sides, each as tall as its own labels, packed, at most five), short
labels whole wherever nothing hovers, a colour column, and every output it is drawn in.

The reference is the analyst's own: the announcements of the Bab al-Mandab front, twelve
events from September to November, crowded in October and November. Drawn the old way,
its ten-event version took nine lanes and over a thousand pixels at the page's width.
"""

from __future__ import annotations

import io
import re
from datetime import date

import pytest
from PIL import Image

from azimut.engine import notecharts, notefill, notes_chart_timeline as timeline, notes_charts as nc, notes_html
from azimut.engine import notes_infographic

ANNOUNCEMENTS = """title: The announcements
source: press reports and my geolocations
| Day | What | Kind |
| --- | --- | --- |
| 10 Sep 2026 | The Houthis take Mocha | Press |
| 14 Sep 2026 | Houthi video at Ghurayrah, south of the lagoon | Geolocated |
| 5 Oct 2026 | Offensive opens, Dhubab airport taken, the strait claimed | Claim |
| 9 Oct 2026 | The strait announced cleared | Claim |
| 10 Oct 2026 | Government sources to AFP: the strait is not secured | Press |
| 12 Oct 2026 | Houthi counter-attack north of the airport | Claim |
| 19 Oct 2026 | Government footage on the north edge of the peninsula | Geolocated |
| 2 Nov 2026 | Same stretch, men walking upright, no fire | Geolocated |
| 7 Nov 2026 | Burned vehicles on the coast road in a satellite picture | Geolocated |
| 13 Nov 2026 | The Giants film inside Dhubab airport | Geolocated |
| 15 Nov 2026 | Withdrawal announced; Houthi ground tour of the wrecks (video 1) | Press |
| 16 Nov 2026 | Houthi drone footage of the wrecks reposted (video 2) | Press |"""

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


def _chart(settings: str = "", rows: str = ANNOUNCEMENTS, **options) -> nc.Layout:
    return nc.layout(nc.parse_block(f"kind: timeline\n{settings}{rows}"), **options)


def _events(count: int, *, words: str = "Something long happened on this day, as the footage shows") -> str:
    days = [date(2026, 10, 1).toordinal() + index * 2 for index in range(count)]
    lines = "\n".join(f"| {date.fromordinal(day).isoformat()} | {words} {index + 1} |" for index, day in enumerate(days))
    return f"source: x\n| Day | What |\n| --- | --- |\n{lines}"


def _flat(marks) -> list:
    out: list = []
    for mark in marks:
        if isinstance(mark, nc.Group):
            out.extend(_flat(mark.marks))
        else:
            out.append(mark)
    return out


def _texts(chart: nc.Layout) -> list[nc.Text]:
    return [mark for mark in _flat(chart.marks) if isinstance(mark, nc.Text)]


# -- the layouts and Auto's rule ---------------------------------------------------------------------


@pytest.mark.parametrize("count, width, laid", [
    (6, 640, "across"), (8, 640, "across"), (9, 640, "numbered"), (20, 640, "numbered"), (21, 640, "list"),
    (6, 360, "list"), (12, 360, "list"),
])
def test_auto_lays_few_events_across_more_numbered_and_many_or_a_phone_as_a_list(count, width, laid):
    chart = _chart(rows=_events(count, words="Event"), width=width)
    assert chart.facts["layout"] == laid and chart.facts["auto"] is True
    assert timeline.auto_layout(count, width - 32) == laid


@pytest.mark.parametrize("layout", ["across", "numbered", "list"])
def test_a_layout_written_is_the_one_drawn_wherever_it_is_drawn(layout):
    for width in (640, 360):
        chart = _chart(f"layout: {layout}\n", rows=_events(5), width=width)
        assert chart.facts["layout"] == layout and chart.facts["auto"] is False
        assert not chart.checks


def test_a_layout_or_labels_it_cannot_read_are_named_and_auto_draws():
    chart = _chart("layout: diagonal\nlabels: tiny\n")
    assert chart.facts["layout"] == "numbered"
    messages = [check.message for check in chart.checks]
    assert 'The chart "The announcements" is laid out auto, across, numbered or list, not "diagonal".' in messages
    assert 'The chart "The announcements" labels its events full or short, not "tiny".' in messages
    lines = [check.line for check in chart.checks]
    assert lines == [1, 2]


def test_the_layout_and_labels_are_block_lines_only_a_timeline_reads():
    block = nc.parse_block(f"kind: timeline\nlayout: numbered\nlabels: short\n{ANNOUNCEMENTS}")
    assert block.extra == {"layout": "numbered", "labels": "short"}
    written = nc.block_text(block)
    assert written.split("\n")[1:5] == ["kind: timeline", "title: The announcements", "layout: numbered", "labels: short"]
    bars = nc.read(nc.parse_block("kind: bars\nlayout: list\n| A | N |\n| --- | ---: |\n| a | 1 |"))
    assert 'A chart: a bars chart does not read "layout".' in [check.message for check in bars.checks]


# -- across: both sides, lanes packed, at most five ---------------------------------------------------


def _assert_nothing_meets(chart: nc.Layout) -> None:
    labels = chart.facts["labels"]
    for index, (lane, (a, b)) in enumerate(labels):
        for other_lane, (c, d) in labels[index + 1:]:
            if lane == other_lane:
                assert b + timeline.LABEL_GAP <= c or d + timeline.LABEL_GAP <= a


def test_the_crowded_announcements_across_take_both_sides_and_five_lanes_at_most():
    for settings in ("layout: across\n", "layout: across\nlabels: short\n", "layout: across\ncolour by: Kind\n"):
        chart = _chart(settings, width=640)
        assert chart.facts["layout"] == "across"
        assert chart.facts["above"] >= 1 and chart.facts["below"] >= 1
        assert chart.facts["lanes"] <= timeline.MAX_LANES
        _assert_nothing_meets(chart)
        # the old staircase took nine lanes and 1,046 pixels for ten of these events
        assert chart.height < 560


def test_labels_take_turns_above_and_below_the_line():
    chart = _chart("layout: across\n", width=640)
    axis = chart.facts["axis"]
    dates = [text for text in _texts(chart) if text.bold and re.match(r"^\d+ \w{3}$", text.text)]
    order = sorted(dates, key=lambda text: date(2026, timeline.kinds.MONTHS[text.text.split()[1].lower()],
                                                  int(text.text.split()[0])))
    sides = [text.y < axis for text in order]
    assert sides == [index % 2 == 0 for index in range(len(order))]


def test_each_lane_is_as_tall_as_its_own_labels():
    def label(x: float, height: float, lane: int) -> timeline._Label:
        made = timeline._Label(x, "d", ["w"], 80.0, height, None)  # type: ignore[arg-type]
        made.lane = lane
        return made

    tops = timeline._lane_heights([label(10, 20, 0), label(200, 50, 0), label(30, 30, 1)], 2)
    assert tops == [0.0, 50.0 + timeline.LANE_GAP, 50.0 + timeline.LANE_GAP + 30.0]


def test_a_label_may_be_wider_than_the_gap_to_the_next_day():
    chart = _chart("layout: across\n", rows=_events(6), width=640)
    days = sorted(chart.facts["days"])
    gap = min(after - before for before, after in zip(days, days[1:]))
    assert all(b - a > gap for _, (a, b) in chart.facts["labels"])
    _assert_nothing_meets(chart)


def test_the_search_packs_a_crowded_side_and_nothing_it_places_meets_anything():
    def made(x: float) -> timeline._Label:
        return timeline._Label(x, "d", ["words"], 120.0, 30.0, None)  # type: ignore[arg-type]

    labels = [made(x) for x in (40, 52, 64, 300, 310, 560, 570, 590)]
    assert not timeline.place_side(labels, 1, 0, 640, 100)
    assert timeline.place_side(labels, 3, 0, 640, 100)
    for label in labels:
        assert timeline.clear(label, [other for other in labels if other is not label])


def test_a_bent_leader_is_drawn_from_the_day_to_its_words():
    chart = _chart("layout: across\n", width=640)
    assert chart.facts["bends"] >= 1
    lines = [mark for mark in _flat(chart.marks) if isinstance(mark, nc.Line) and len(mark.points) == 4]
    assert len(lines) == chart.facts["bends"]
    for points in (line.points for line in lines):
        (x0, y0), (x1, y1), (x2, y2), (x3, _) = points
        assert y0 == chart.facts["axis"] and x0 == x1 and y1 == y2 and x2 == x3 and x2 != x0


def test_periods_lie_in_tracks_under_the_scale_and_the_points_above():
    chart = _chart(rows=WHEN, width=640)
    assert chart.facts["layout"] == "across" and chart.facts["below"] == 0
    assert chart.facts["tracks"] == 2 and chart.facts["inside"] == ["Stalled on the north edge"]
    words = " ".join(text.text for text in _texts(chart))
    assert "Stalled on the north edge, 11 Oct – 2 Nov" in words and "2 Nov – 13 Nov" in words
    assert chart.title == "When" and chart.desc.startswith("Timeline: 6 rows, from 5 Oct 2026 to 16 Nov 2026")
    assert chart.table_head == ["Day", "What", "Until"]
    assert chart.table_rows[1] == ["11 Oct 2026", "Stalled on the north edge", "2 Nov 2026"]


def test_the_ticks_stay_on_the_paper_where_a_stem_goes_down_through_them():
    _, _, ticks = timeline.time_domain(date(2026, 10, 5), date(2026, 11, 16), 600, years=True)
    assert [label for _, label in ticks] == ["1 Oct", "15 Oct", "1 Nov", "15 Nov"]
    chart = _chart("layout: across\n", width=640)
    ticks = [text for text in _texts(chart) if text.size == chart.theme.tick_size]
    assert [text.text for text in ticks] == ["1 Sep", "15 Sep", "1 Oct", "15 Oct", "1 Nov", "15 Nov"]
    # each on paper, so a stem going down passes behind it; one at the edge starts at its mark
    papers = [mark for mark in _flat(chart.marks) if isinstance(mark, nc.Rect) and mark.fill == chart.theme.paper
              and mark.h == chart.theme.tick_size * 1.3]
    assert len(papers) == len(ticks)
    assert ticks[0].anchor == "start" and ticks[1].anchor == "middle"


def test_an_across_too_crowded_for_its_lanes_is_numbered():
    chart = _chart("layout: across\n", rows=_events(40), width=480)
    assert chart.facts["layout"] == "numbered"


# -- numbered and list --------------------------------------------------------------------------------


def test_numbered_stacks_close_days_and_lists_the_words_in_two_columns_when_wide():
    chart = _chart("layout: numbered\n", width=640)
    assert chart.facts["columns"] == 2
    # 9 and 10 Oct, and 13, 15, 16 Nov, are too close to stand side by side
    assert max(chart.facts["levels"]) >= 1
    numbers = [text.text for text in _texts(chart) if text.bold and text.text.isdigit()]
    assert numbers == [str(number) for number in range(1, 13) for _ in range(2)]
    words = [text.text for text in _texts(chart)]
    assert "The Houthis take Mocha" in words and "10 Sep" in words
    narrow = _chart("layout: numbered\n", width=420)
    assert narrow.facts["columns"] == 1


def test_the_owners_twelve_crowded_events_come_out_compact():
    chart = _chart("colour by: Kind\n", width=640)
    assert chart.facts["layout"] == "numbered"
    assert chart.height < 440
    short = _chart("colour by: Kind\nlabels: short\n", width=640)
    assert short.height < 340


def test_a_list_says_the_year_on_its_first_day_and_where_it_changes():
    rows = "source: x\n| Day | What |\n| --- | --- |\n| 20 Dec 2025 | a |\n| 28 Dec 2025 | b |\n| 3 Jan 2026 | c |"
    chart = _chart("layout: list\n", rows=rows, width=360)
    days = [text.text for text in _texts(chart) if text.bold]
    assert days == ["20 Dec 2025", "28 Dec", "3 Jan 2026"]
    rows_laid = chart.facts["rows"]
    assert all(top + height <= next_top for (top, height), (next_top, _) in zip(rows_laid, rows_laid[1:]))
    periods = _chart("layout: list\n", rows=WHEN, width=360)
    assert sum(1 for mark in _flat(periods.marks) if isinstance(mark, nc.Rect) and mark.w == 7.0) == 2


# -- short labels -------------------------------------------------------------------------------------


@pytest.mark.parametrize("words, short", [
    ("The Houthis take Mocha", "The Houthis take Mocha"),
    ("Offensive opens, Dhubab airport taken, the strait claimed", "Offensive opens…"),
    ("Government sources to AFP: the strait is not secured", "Government sources to AFP…"),
    ("Houthi drone footage of the wrecks reposted (video 2)", "Houthi drone footage…"),
    ("The strait announced cleared (claim)", "The strait announced cleared…"),
])
def test_a_short_label_is_its_first_clause_or_first_words(words, short):
    assert timeline.short_words(words) == short


def test_short_labels_carry_their_whole_words_for_the_hover_and_the_svg_says_them():
    chart = _chart("layout: across\nlabels: short\ncolour by: Kind\n", width=640)
    assert chart.facts["short"] is True
    cut = [text for text in _texts(chart) if text.text.endswith("…")]
    assert cut and all(text.full for text in cut)
    assert any(text.full == "Offensive opens, Dhubab airport taken, the strait claimed" for text in cut)
    svg = nc.svg(chart)
    assert "<title>Offensive opens, Dhubab airport taken, the strait claimed</title>Offensive opens…" in svg
    # every event's whole line is its group's title too, its kind said
    assert "<title>9 Oct 2026: The strait announced cleared (Claim)</title>" in svg


@pytest.mark.parametrize("layout", ["across", "numbered", "list"])
def test_a_drawing_nothing_hovers_over_prints_the_words_whole(layout):
    still = _chart(f"layout: {layout}\nlabels: short\n", width=640, still=True)
    assert still.facts["short"] is False
    assert not any(text.text.endswith("…") for text in _texts(still))
    assert "Offensive opens, Dhubab airport taken, the strait claimed" in " ".join(text.text for text in _texts(still))


def test_the_pdf_and_every_picture_lay_short_labels_whole():
    body = f"kind: timeline\nlabels: short\nlayout: across\n{ANNOUNCEMENTS}"
    chart = notecharts.read(None, body)
    assert chart.layout.facts["short"] is True
    # the PDF's picture is the drawing laid again, whole
    assert chart.png(900) == nc.render_png(chart.drawn(still=True), 900)
    assert chart.png(900) != nc.render_png(chart.layout, 900)
    # a picture for X is laid still too
    block = nc.parse_block(body)
    whole = nc.layout(block, width=560, height=315, still=True, title=True)
    assert not any(text.text.endswith("…") for text in _texts(whole))


# -- a colour column ---------------------------------------------------------------------------------


def test_a_colour_column_paints_each_event_and_the_legend_says_each_kind_and_its_count():
    chart = _chart("colour by: Kind\nlayout: numbered\n", width=640)
    assert [(swatch.value, swatch.total) for swatch in chart.legend] == [("Press", 4), ("Geolocated", 5), ("Claim", 3)]
    paints = {swatch.value: swatch.paint.colour for swatch in chart.legend}
    badges = [mark for mark in _flat(chart.marks) if isinstance(mark, nc.Circle) and mark.r == timeline.BADGE]
    assert badges[0].fill == paints["Press"] and badges[2].fill == paints["Claim"]
    assert chart.table_head == ["Day", "What", "Kind"]
    assert chart.table_rows[3] == ["9 Oct 2026", "The strait announced cleared", "Claim"]
    assert chart.lines[3] == "9 Oct 2026: The strait announced cleared (Claim)"
    # said once when the words say it, never taken for a word that holds it
    assert chart.lines[2] == "5 Oct 2026: Offensive opens, Dhubab airport taken, the strait claimed (Claim)"
    worded = _chart("colour by: Kind\n", rows=ANNOUNCEMENTS.replace("cleared | Claim", "cleared (claim) | Claim"))
    assert worded.lines[3] == "9 Oct 2026: The strait announced cleared (claim)"
    # the kind's column is never read as the words
    assert "Claim" not in [text.text for text in _texts(chart) if text.body]


# -- every output -------------------------------------------------------------------------------------


@pytest.mark.parametrize("destination", ["x", "portrait", "square", "page"])
def test_every_picture_of_the_announcements_is_its_frames_size(destination):
    block = nc.parse_block(f"kind: timeline\ncolour by: Kind\n{ANNOUNCEMENTS}")
    where = nc.DESTINATIONS[destination]
    image = Image.open(io.BytesIO(nc.render(block, destination)))
    assert image.width == where.width and image.height == (where.height or image.height)


def test_a_frame_of_fixed_size_or_a_pages_room_takes_the_first_layout_that_fits_it():
    block = nc.parse_block(f"kind: timeline\n{_events(6)}")
    # six events: across when the frame holds them, else the first other that fits
    assert nc.layout(block, width=560, height=315, still=True).facts["layout"] == "across"
    low = nc.layout(block, width=560, height=250, still=True)
    assert low.facts["layout"] == "list" and low.height <= 250.5
    assert nc.layout(block, width=560, room=250.0, still=True).facts["layout"] == "list"
    # none fits: the shortest, which the picture then draws smaller
    assert nc.layout(block, width=560, height=150, still=True).facts["layout"] == "list"


def test_the_html_page_draws_it_wide_and_as_a_list_for_a_phone(tmp_workspace):
    text = f"# Front\n\n::: chart\nkind: timeline\nlabels: short\ncolour by: Kind\n{ANNOUNCEMENTS}\n:::\n"
    page = notes_html.render(None, title="Front", text=text, identity=notefill.Identity()).html.decode("utf-8")
    figure = re.search(r'<figure class="az-figure az-chart-figure".*?</figure>', page, re.S).group(0)
    wide, phone = re.findall(r"<svg .*?</svg>", figure, re.S)
    assert "az-chart-wide" in wide and "az-chart-phone" in phone
    # numbered on the page, a list on a phone, the whole words on hover in both
    assert wide.count(">12</text>") == 2 and ">12</text>" not in phone
    for drawing in (wide, phone):
        assert "<title>Offensive opens, Dhubab airport taken, the strait claimed</title>Offensive opens…" in drawing


def test_an_infographic_panel_lays_it_and_its_picture_prints_the_words_whole():
    body = (":::: infographic\ntitle: The front\n::: chart\nkind: timeline\nlabels: short\nlayout: across\n"
            f"{ANNOUNCEMENTS}\n:::\n::::")
    lines = notes_infographic.block_of(body)
    page = notes_infographic.read(None, lines)
    panel = page.panels[0]
    assert panel.chart is not None and panel.chart.facts["layout"] == "across" and panel.chart.facts["short"]
    still = notes_infographic.read(None, lines, still=True).panels[0]
    assert still.chart is not None and not still.chart.facts["short"]
    assert not any(text.text.endswith("…") for text in _texts(still.chart))


def test_the_page_says_the_words_cut_short_can_be_hovered():
    chart = (notes_html.ASSETS / "reader.chart.css").read_text(encoding="utf-8")
    assert "svg.az-chart text:has(> title) { cursor: help; }" in chart


def test_points_of_one_day_stand_side_by_side_each_with_its_own_dot():
    from azimut.engine import notes_chart_timeline as tl

    # two events on 5 Oct, one on 9 Oct far enough away to keep its place
    placed = tl.spread([100.0, 100.0, 160.0], tl.DOT_PITCH, 0.0, 400.0)
    assert placed[1] - placed[0] == pytest.approx(tl.DOT_PITCH)
    assert (placed[0] + placed[1]) / 2 == pytest.approx(100.0) and placed[2] == pytest.approx(160.0)
    # a run against the line's end stays inside it
    assert min(tl.spread([1.0, 1.0, 1.0], tl.DOT_PITCH, 0.0, 400.0)) >= 0.0


def test_the_across_layout_draws_a_dot_for_each_event_of_the_same_day():
    rows = ("source: x\n| Day | What |\n| --- | --- |\n| 2026-10-05 | Offensive opens |\n"
            "| 2026-10-05 | The strait claimed taken |\n| 2026-10-09 | Cleared, says Riyadh |")
    chart = _chart("layout: across\n", rows=rows, width=640)
    days = chart.facts["days"]
    assert len(days) == 3 and len({round(day, 1) for day in days}) == 3
    circles = [mark for mark in _flat(chart.marks) if isinstance(mark, nc.Circle)]
    assert len({round(circle.cx, 1) for circle in circles}) == 3
