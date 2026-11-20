"""A picture wall (`engine/notes_chart_wall.py`): one real picture of the case a row, lined up
by group, in the editor's SVG, the HTML page's grid, the PDF and a picture standing alone.

What must hold: the kind is read by its words; its pictures are the case's own files, read
at the size each painter draws them, cropped to one shape; groups flow side by side and a
long one wraps; a fixed frame and a page's room take the largest frames that fit; the bar
under each picture wears its value's paint; a floor's title says *at least*; every picture
is a use of its media; the credit line is the media's; the HTML page is a real grid whose
pictures open larger, light enough for sixty.
"""

from __future__ import annotations

import base64
import io
import re
from pathlib import Path
from xml.etree import ElementTree

import pytest
from PIL import Image

from azimut.engine import notecharts, notes_chart_picker, notes_chart_wall as wall, notes_charts as nc
from azimut.engine import notes_html, notes_infographic, notes_pdf, uses
from azimut.workspace import Case

from notecase import make_case, make_note

SVG = "{http://www.w3.org/2000/svg}"
COLOURS = [(200, 30, 30), (30, 160, 60), (40, 60, 200), (230, 200, 40), (120, 40, 160), (20, 160, 170)]


def _picture(path: Path, colour: tuple[int, int, int], size: tuple[int, int] = (300, 200)) -> Path:
    Image.new("RGB", size, colour).save(path, "JPEG", quality=95)
    return path


@pytest.fixture()
def frames(tmp_path):
    """Six pictures of one colour each, found by id as a case finds its media."""
    found = {f"e_{index:010d}": nc.Frame(f"e_{index:010d}", f"#{index}", (_picture(tmp_path / f"{index}.jpg", colour),),
                                         credit="x.com" if index % 2 else "t.me")
             for index, colour in enumerate(COLOURS, start=1)}
    return found.get


def _wall(rows: list[tuple[str, ...]], settings: str = "", head: str = "| Picture | # | State | Model | Grade |") -> nc.ChartBlock:
    lines = ["kind: pictures", *[line for line in settings.split("\n") if line], head,
             "| " + " | ".join("---" for _ in head.strip("|").split("|")) + " |",
             *["| " + " | ".join(row) + " |" for row in rows]]
    return nc.parse_block("\n".join(lines))


SIX = [("[[media:e_0000000001|#1]]", "#1", "burned", "Streit Cougar", "Confirmed"),
       ("e_0000000002", "#2", "destroyed", "Streit Cougar", "Almost sure"),
       ("[[media:e_0000000003|#3]]", "#3", "abandoned", "Streit Cougar", "Strong doubt"),
       ("[[entity:e_0000000004|#4]]", "#4", "burned", "BATT UMG", "Confirmed"),
       ("e_0000000005", "#5", "damaged", "BATT UMG", "Set aside"),
       ("e_0000000006", "#6", "burned", "Al-Wahsh", "Almost sure")]
GROUPED = "by: Model\ncolour by: Grade"


def _pictures(marks) -> list[nc.Picture]:
    found: list[nc.Picture] = []
    for mark in marks:
        if isinstance(mark, nc.Group):
            found.extend(_pictures(mark.marks))
        elif isinstance(mark, nc.Picture):
            found.append(mark)
    return found


def _texts(marks) -> list[nc.Text]:
    found: list[nc.Text] = []
    for mark in marks:
        if isinstance(mark, nc.Group):
            found.extend(_texts(mark.marks))
        elif isinstance(mark, nc.Text):
            found.append(mark)
    return found


def _rects(marks) -> list[nc.Rect]:
    found: list[nc.Rect] = []
    for mark in marks:
        if isinstance(mark, nc.Group):
            found.extend(_rects(mark.marks))
        elif isinstance(mark, nc.Rect):
            found.append(mark)
    return found


# -- the kind and its table -------------------------------------------------------------------


def test_the_wall_is_a_kind_written_by_its_words_and_reads_its_own_settings():
    for word in ("pictures", "picture wall", "gallery", "Picture Wall", "photo wall"):
        assert nc.kind_named(word).name == "pictures"
    kind = nc.KINDS["pictures"]
    assert kind.label == "Picture wall" and kind.per_row and kind.sort == "as written"
    assert kind.keys == ("picture", "label", "words", "shape", "flag", "flags")
    block = _wall(SIX, f"{GROUPED}\nshape: 4:3\nwords: State")
    assert block.extra == {"shape": "4:3", "words": "State"}
    assert "shape: 4:3" in nc.block_text(block) and not block.unread


def test_a_cell_names_a_picture_by_its_chip_or_its_id():
    assert wall.picture_ref("[[media:e_13b435e301|Vehicles one by one.jpg]]") == "e_13b435e301"
    assert wall.picture_ref("[[entity:e_13b435e301|Proof 17]]") == "e_13b435e301"
    assert wall.picture_ref(" e_13b435e301 ") == "e_13b435e301"
    assert wall.picture_ref("#7") == wall.picture_ref("a burned truck") == wall.picture_ref("") == ""


def test_the_shape_is_three_by_two_unless_it_says_otherwise():
    assert wall.shape_of("") == (3, 2)
    assert wall.shape_of("4:3") == wall.shape_of("4/3") == (4, 3)
    assert wall.shape_of("square") == (1, 1) and wall.shape_of("16:9") == (16, 9)
    assert wall.shape_of("tall") is None and wall.shape_of("1:9") is None


def test_its_columns_are_the_pictures_the_label_and_the_words_left(frames):
    reading = nc.read(_wall(SIX, GROUPED), pictures=frames)
    found = wall.columns(reading)
    assert (found.picture, found.label, found.words) == (0, 1, 2)
    assert reading.count is None and reading.by == 3 and reading.colour == 4
    unwritten = nc.read(_wall(SIX, "words: none"), pictures=frames)
    assert wall.columns(unwritten).words is None and unwritten.by is None


# -- the layout ---------------------------------------------------------------------------------


def test_each_row_is_a_frame_of_its_own_picture_cropped_to_one_shape(frames):
    chart = nc.layout(_wall(SIX, GROUPED), pictures=frames, width=640)
    pictures = _pictures(chart.marks)
    assert [picture.source.key for picture in pictures] == [f"e_{index:010d}" for index in range(1, 7)]
    assert all(picture.cover and not picture.data for picture in pictures)
    assert {round(picture.w / picture.h, 3) for picture in pictures} == {1.5}
    assert len({round(picture.w, 3) for picture in pictures}) == 1
    # free, about seven frames fill a page's line
    assert chart.facts["across"] == 7 and chart.facts["cell"] == pytest.approx((608 - 6 * wall.GAP_X) / 7)
    square = nc.layout(_wall(SIX, f"{GROUPED}\nshape: 1:1"), pictures=frames)
    assert {round(picture.w / picture.h, 3) for picture in _pictures(square.marks)} == {1.0}


def test_groups_say_their_name_and_count_and_sit_side_by_side_until_the_line_is_full(frames):
    chart = nc.layout(_wall(SIX, GROUPED), pictures=frames, width=640)
    words = [text.text for text in _texts(chart.marks)]
    for name, count in (("Streit Cougar", "3"), ("BATT UMG", "2"), ("Al-Wahsh", "1")):
        at = words.index(name)
        assert words[at + 1] == count
    spots = {(group, item): (x, y) for group, item, x, y in chart.facts["spots"]}
    # three, two and one frames fit one line of seven: one band, the second group to the right
    assert spots[(0, 0)][1] == spots[(1, 0)][1] == spots[(2, 0)][1]
    assert spots[(1, 0)][0] > spots[(0, 2)][0]
    assert chart.facts["groups"] == [("Streit Cougar", 3), ("BATT UMG", 2), ("Al-Wahsh", 1)]
    assert chart.lines == ["Streit Cougar: 3 (#1, #2, #3)", "BATT UMG: 2 (#4, #5)", "Al-Wahsh: 1 (#6)"]


def test_a_group_longer_than_a_line_wraps_and_the_next_starts_below(frames):
    rows = [(f"e_{1 + index % 6:010d}", f"#{index + 1}", "burned", "Harrow Tygor E1", "Confirmed") for index in range(10)]
    rows.append(("e_0000000002", "#11", "burned", "BATT UMG", "Confirmed"))
    chart = nc.layout(_wall(rows, GROUPED), pictures=frames, width=640)
    spots = {(group, item): (x, y) for group, item, x, y in chart.facts["spots"]}
    assert spots[(0, 7)][0] == spots[(0, 0)][0] and spots[(0, 7)][1] > spots[(0, 0)][1]
    assert spots[(1, 0)][0] == spots[(0, 0)][0] and spots[(1, 0)][1] > spots[(0, 7)][1]


def test_groups_kept_last_come_after_a_rule(frames):
    chart = nc.layout(_wall(SIX, f"{GROUPED}\nlast: Streit Cougar"), pictures=frames)
    assert chart.facts["groups"][-1] == ("Streit Cougar", 3)
    assert any(isinstance(mark, nc.Line) for mark in chart.marks)


def test_a_fixed_frame_takes_the_largest_pictures_that_fit_and_a_page_lays_the_wall_smaller(frames):
    rows = [(f"e_{1 + index % 6:010d}", f"#{index + 1}", "burned", f"Model {index // 5}", "Confirmed")
            for index in range(60)]
    block = _wall(rows, GROUPED)
    free = nc.layout(block, pictures=frames, width=640)
    room = free.height * 0.6
    fitted = nc.layout(block, pictures=frames, width=640, room=room)
    assert fitted.height <= room + 0.5 < free.height
    assert fitted.facts["cell"] < free.facts["cell"]
    # a frame of fixed size: everything fits, and the pictures grow as far as they can
    few = nc.layout(_wall(SIX[:2], GROUPED), pictures=frames, width=560, height=315)
    assert few.height == 315 and few.facts["cell"] > free.facts["cell"]
    for where, size in (("x", (1600, 900)), ("portrait", (1080, 1350)), ("square", (1080, 1080))):
        assert Image.open(io.BytesIO(nc.render(block, where, pictures=frames))).size == size


# -- the bar, the highlight and the honesty ---------------------------------------------------------


def test_the_bar_under_each_picture_wears_its_values_paint_and_the_legend_counts_them(frames):
    chart = nc.layout(_wall(SIX, GROUPED), pictures=frames)
    pictures = _pictures(chart.marks)
    bars = [rect for rect in _rects(chart.marks) if rect.h == wall.BAR]
    assert len(bars) == 6 and all(bar.y > picture.y + picture.h for bar, picture in zip(bars, pictures))
    grade = {grade.name: grade for grade in nc.GRADES}
    assert bars[0].fill == grade["Confirmed"].light and bars[2].hatch  # strong doubt is hatched
    assert bars[4].fill == grade["Set aside"].light
    assert {swatch.value: swatch.total for swatch in chart.legend} == {
        "Confirmed": 2, "Almost sure": 2, "Strong doubt": 1, "Set aside": 1}
    plain = nc.layout(_wall(SIX, "by: Model"), pictures=frames)
    assert not [rect for rect in _rects(plain.marks) if rect.h == wall.BAR] and not plain.legend


def test_a_highlight_names_a_group_a_value_or_one_frame(frames):
    theme = nc.theme_for("report")
    framed = nc.layout(_wall(SIX, f"{GROUPED}\nhighlight: #2"), pictures=frames)
    rings = [rect for rect in _rects(framed.marks) if rect.stroke == theme.accent]
    picture = _pictures(framed.marks)[1]
    assert len(rings) == 1 and rings[0].x < picture.x and rings[0].w > picture.w
    assert not any("highlights" in check.message for check in framed.checks)
    group = nc.layout(_wall(SIX, f"{GROUPED}\nhighlight: BATT UMG"), pictures=frames)
    counts = {text.text: text.colour for text in _texts(group.marks) if text.text in ("2", "3")}
    assert counts == {"2": theme.accent, "3": theme.ink}
    bars = [rect for rect in _rects(group.marks) if rect.h == wall.BAR]
    assert bars[0].fill == theme.others and bars[3].fill != theme.others
    missing = nc.read(_wall(SIX, f"{GROUPED}\nhighlight: #99"), pictures=frames)
    assert any('highlights "#99", which no row holds' in check.message for check in missing.checks)


def test_only_and_order_work_as_on_every_chart(frames):
    chart = nc.layout(_wall(SIX, f"{GROUPED}\nonly: Grade is not Set aside\norder: Almost sure, Confirmed"),
                      pictures=frames)
    assert [picture.source.key for picture in _pictures(chart.marks)] == [
        f"e_{index:010d}" for index in (1, 2, 3, 4, 6)]
    assert [swatch.value for swatch in chart.legend][:2] == ["Almost sure", "Confirmed"]
    assert any(note.startswith("Only rows where Grade is not Set aside: 5 of 6") for note in chart.notes)


def test_a_floor_asks_its_title_to_say_at_least(frames):
    note = "Every count is a minimum."
    reading = nc.read(_wall(SIX, GROUPED), pictures=frames, note_text=note)
    check = next(check for check in reading.checks if "at least" in check.message)
    assert check.fix == (("title", "At least 6 pictures, by model and grade"),)
    titled = nc.read(_wall(SIX, f"{GROUPED}\ntitle: At least 6 vehicles, one by one"), pictures=frames, note_text=note)
    assert not any("at least" in check.message for check in titled.checks)


def test_the_title_the_data_proposes_names_what_the_pictures_are(frames):
    reading = nc.read(_wall(SIX, f"{GROUPED}\ntitle: At least 6 vehicles, one by one"), pictures=frames)
    assert notes_chart_picker.title_for(reading) == "6 vehicles, by model and grade"
    assert notes_chart_picker.title_for(nc.read(_wall(SIX, GROUPED), pictures=frames)) == "6 pictures, by model and grade"


def test_the_check_names_empty_frames_pictures_gone_and_a_shape_it_cannot_read(frames):
    rows = [*SIX[:2], ("", "#7", "burned", "Streit Cougar", "Confirmed"), ("e_0000000099", "#8", "burned", "Al-Wahsh", "Confirmed")]
    reading = nc.read(_wall(rows, f"{GROUPED}\nshape: tall"), pictures=frames)
    said = " | ".join(f"{check.kind}: {check.message}" for check in reading.checks)
    assert "draws 1 frame empty, with no picture: #7." in said
    assert "missing: A chart shows 1 picture no longer in the case: #8." in said
    assert 'cannot read "shape: tall"' in said
    chart = nc.layout(_wall(rows, GROUPED), pictures=frames)
    assert [text.text for text in _texts(chart.marks)].count(wall.NO_PICTURE) == 2
    none = nc.read(_wall([("#1", "burned")], head="| # | State |"))
    assert any("holds no column of pictures" in check.message for check in none.checks)
    asked = nc.read(_wall(SIX, "picture: Photo"))
    assert any('reads its pictures in "Photo"' in check.message for check in asked.checks)


def test_the_credit_line_says_where_the_pictures_come_from(frames):
    chart = nc.layout(_wall(SIX, f"{GROUPED}\nsource: Yemeni Military Media"), pictures=frames)
    assert chart.credit == "Source: Yemeni Military Media. Pictures: x.com, t.me"
    alone = nc.layout(_wall(SIX, GROUPED), pictures=frames)
    assert alone.credit == "Pictures: x.com, t.me"
    assert not any(check.kind == nc.UNSOURCED for check in nc.read(_wall(SIX, GROUPED), pictures=frames).checks)
    assert any(check.kind == nc.UNSOURCED for check in nc.read(_wall(SIX, GROUPED)).checks)


def test_a_flag_stands_before_a_groups_name(frames):
    chart = nc.layout(_wall(SIX, f"{GROUPED}\nflags: BATT UMG = star"), pictures=frames)
    flagged = [mark for mark in chart.marks if isinstance(mark, nc.Group) and mark.title == "BATT UMG: 2"][0]
    assert any(isinstance(mark, nc.Shape) for mark in flagged.marks)
    svg = wall.flag_svg("star", nc.theme_for("report"), "f1", "BATT UMG")
    root = ElementTree.fromstring(svg)
    assert "az-wall-flag" in root.get("class") and root.find(f"{SVG}title").text == "Flag of BATT UMG"


def test_a_table_describes_every_frame_for_a_screen_reader(frames):
    chart = nc.layout(_wall(SIX, GROUPED), pictures=frames)
    assert chart.table_head == ["#", "State", "Model", "Grade"]
    assert chart.table_rows[0] == ["#1", "burned", "Streit Cougar", "Confirmed"]
    assert chart.desc.startswith("Picture wall: 6 pictures, by model")


# -- the painters ---------------------------------------------------------------------------------


def test_a_frame_is_read_at_the_size_asked_cropped_about_its_middle(tmp_path):
    original = _picture(tmp_path / "wide.jpg", (200, 30, 30), (900, 300))
    thumb = _picture(tmp_path / "thumb.jpg", (30, 160, 60), (300, 100))
    frame = nc.Frame("e_x", files=(thumb, original))
    small = Image.open(io.BytesIO(frame.at(120, 80)))
    assert small.size == (120, 80) and small.getpixel((60, 40))[1] > 120  # the thumbnail covers it
    large = Image.open(io.BytesIO(frame.at(600, 400)))
    assert large.size == (600, 400) and large.getpixel((300, 200))[0] > 150  # the picture itself
    assert frame.original() == original
    gone = nc.Frame("e_y", files=(tmp_path / "nothing.jpg",))
    assert gone.at(100, 60) == b"" and gone.original() is None


def test_the_png_paints_each_picture_in_its_box_and_the_svg_holds_it_at_twice_its_size(frames):
    chart = nc.layout(_wall(SIX, GROUPED), pictures=frames, width=640)
    png = Image.open(io.BytesIO(nc.render_png(chart, 1280))).convert("RGB")
    scale = 1280 / chart.width
    for picture, colour in zip(_pictures(chart.marks), COLOURS):
        middle = png.getpixel((round((picture.x + picture.w / 2) * scale), round((picture.y + picture.h / 2) * scale)))
        assert all(abs(a - b) < 30 for a, b in zip(middle, colour))
    root = ElementTree.fromstring(nc.svg(chart, ident="w"))
    images = root.findall(f".//{SVG}image")
    assert len(images) == 6
    data = base64.b64decode(images[0].get("href").split(",", 1)[1])
    assert Image.open(io.BytesIO(data)).size == (round(chart.facts["cell"] * 2 + 0.499), round(chart.facts["cell"] / 1.5 * 2 + 0.499))
    assert images[0].get("preserveAspectRatio") == "xMidYMid slice"


def test_an_infographic_panel_takes_a_wall_like_any_chart(client, tmp_path):
    cid = make_case(client, "Wall panel")
    case = Case.open(cid)
    ids = _upload(client, cid, 2)
    body = ("kind: pictures\nby: Model\n| Picture | # | Model |\n| --- | --- | --- |\n"
            f"| {ids[0]} | #1 | Streit Cougar |\n| {ids[1]} | #2 | Streit Cougar |")
    page = notes_infographic.read(case, f"title: Losses\n::: chart\n{body}\n:::")
    drawn = page.panels[0]
    assert drawn.chart is not None and [picture.source.key for picture in _pictures(drawn.marks)] == ids
    assert notes_infographic.picture(page, "square")[:8] == b"\x89PNG\r\n\x1a\n"


# -- in a case: its pictures, the documents and the uses ----------------------------------------------


def _upload(client, cid: str, count: int, start: int = 0) -> list[str]:
    ids = []
    for index in range(start, start + count):
        buffer = io.BytesIO()
        Image.new("RGB", (480 + index, 320), COLOURS[index % len(COLOURS)]).save(buffer, "JPEG", quality=90)
        res = client.post(f"/api/cases/{cid}/media/upload",
                          files={"file": (f"vehicle-{index + 1:02d}.jpg", buffer.getvalue(), "image/jpeg")})
        assert res.status_code == 200, res.text
        path = res.json()["item"]["path"]
        ids.append(client.get(f"/api/cases/{cid}/entities/lookup", params={"attr": "path", "value": path})
                   .json()["entity"]["id"])
    return ids


def _note_wall(ids: list[str], *, chip: bool = True) -> str:
    rows = "\n".join(f"| {f'[[media:{ident}|#{index + 1}]]' if chip else ident} | #{index + 1} | burned | "
                     f"{'Streit Cougar' if index < len(ids) // 2 else 'Oshkosh M-ATV'} | "
                     f"{'Confirmed' if index % 2 else 'Almost sure'} |" for index, ident in enumerate(ids))
    return ("Every count here is a minimum.\n\n::: chart\nkind: pictures\ntitle: At least {n} vehicles, one by one\n"
            "by: Model\ncolour by: Grade\nsource: The two videos\n| Picture | # | State | Model | Grade |\n"
            "| --- | --- | --- | --- | --- |\n").replace("{n}", str(len(ids))) + rows + "\n:::\n"


def test_in_a_case_each_picture_is_read_from_its_own_files_and_credited_by_its_media(client):
    cid = make_case(client, "Wall")
    case = Case.open(cid)
    ids = _upload(client, cid, 4)
    lookup = notecharts.case_pictures(case)
    frame = lookup(ids[0])
    assert frame is not None and frame.key == ids[0] and frame.files[-1].name.startswith("vehicle-01")
    assert lookup("e_0000000000") is None and lookup("../../etc") is None
    chart = notecharts.read(case, _note_wall(ids).split("::: chart\n", 1)[1].split("\n:::")[0])
    assert [picture.source.key for picture in _pictures(chart.layout.marks)] == ids
    assert not [message for message, kind, _ in chart.warnings if kind == "missing"]
    assert Image.open(io.BytesIO(chart.picture("portrait"))).size == (1080, 1350)
    answer = client.post(f"/api/cases/{cid}/notes/figure", json={"text": _note_wall(ids).split("\n\n", 1)[1]})
    assert answer.status_code == 200 and answer.text.count("<image ") == 4
    assert '"per_row":true' in answer.headers["x-chart-kind"] and '"flags"' in answer.headers["x-chart-kind"]
    post = notecharts.file_for_post(case, chart)
    assert post is not None and post["file"].endswith(".png")


def test_the_html_page_shows_a_real_grid_whose_pictures_open_larger(client):
    cid = make_case(client, "Wall page")
    case = Case.open(cid)
    ids = _upload(client, cid, 6)
    text = _note_wall(ids)
    page = notes_html.render(case, title="Losses", text=text).html.decode("utf-8")
    figure = re.search(r'<figure class="az-figure az-chart-figure az-wall-figure".*?</figcaption>\n</figure>', page, re.S)
    assert figure is not None
    wall_html = figure.group(0)
    assert 'data-chart="pictures"' in wall_html and "<svg class=\"az-chart" not in wall_html
    assert wall_html.count('class="az-zoom az-wall-zoom"') == 6 and wall_html.count("data-large=\"data:image/") == 6
    assert wall_html.count('<section class="az-wall-group"') == 2
    assert '<span class="az-wall-name" dir="auto">Streit Cougar</span><span class="az-wall-count">3</span>' in wall_html
    assert "<b>#1</b> burned" in wall_html and 'class="az-caption" hidden>#1 burned · Streit Cougar · Almost sure' in wall_html
    assert 'style="--bar:' in wall_html and "az-wall-legend" in wall_html
    assert "<details class=\"az-chart-numbers\">" in wall_html
    # a frame's picture is sized for its slot, and its larger copy for the lightbox only
    slots = re.findall(r'<img src="data:image/jpeg;base64,([^"]+)"', wall_html)
    assert len(slots) == 6
    shown = Image.open(io.BytesIO(base64.b64decode(slots[0])))
    assert shown.size == (notes_html.WALL_SLOT * 2, round(notes_html.WALL_SLOT * 2 / 1.5))
    larges = re.findall(r'data-large="data:image/jpeg;base64,([^"]+)"', wall_html)
    assert max(Image.open(io.BytesIO(base64.b64decode(larges[0]))).size) <= notes_html.WALL_INLINE_SIDE
    # the lightbox opens the larger copy and shows the frame's own words
    script = (Path(notes_html.ASSETS) / "reader.js").read_text(encoding="utf-8")
    assert "source.dataset.large ||" in script
    css = (Path(notes_html.ASSETS) / "reader.chart.css").read_text(encoding="utf-8")
    assert ".az-wall-flow" in css and "container-type: inline-size" in css


def test_sixty_pictures_keep_the_html_page_light(client):
    cid = make_case(client, "Sixty")
    case = Case.open(cid)
    ids = _upload(client, cid, 6)
    rows = [ids[index % 6] for index in range(60)]
    page = notes_html.render(case, title="Losses", text=_note_wall(rows)).html.decode("utf-8")
    figure = re.search(r'<figure class="az-figure az-chart-figure az-wall-figure".*?</figure>\n', page, re.S).group(0)
    # each frame's two pictures stay under 40 KB together, so sixty weigh a few MB at most
    assert len(figure) < 60 * 40_000


def test_the_pdf_prints_the_wall_at_300_dpi_on_one_page(client):
    cid = make_case(client, "Wall pdf")
    case = Case.open(cid)
    ids = _upload(client, cid, 6)
    rows = [ids[index % 6] for index in range(60)]
    text = _note_wall(rows, chip=False)
    rendered = notes_pdf.render(case, title="Losses", text=text)
    assert f"/Width {notes_pdf.CHART_PIXELS}".encode() in rendered.pdf
    chart = notecharts.read(case, text.split("::: chart\n", 1)[1].split("\n:::")[0])
    room = notes_pdf.PLAIN.room * chart.layout.width / notes_pdf.PLAIN.frame
    assert chart.layout.height > room
    picture = Image.open(io.BytesIO(chart.png(notes_pdf.CHART_PIXELS, dpi=notes_pdf.CHART_DPI, room=room)))
    assert picture.info["dpi"][0] == pytest.approx(300, abs=1)
    assert picture.size[1] / picture.size[0] <= room / chart.layout.width + 0.01
    # the note's line and the wall stand on the one page, never cut or shrunk to a sliver
    assert len(re.findall(rb"/Type\s*/Page\b(?!s)", rendered.pdf)) == 1


def test_each_picture_is_a_use_of_its_media_as_a_chip_or_an_id(client):
    cid = make_case(client, "Wall uses")
    ids = _upload(client, cid, 3)
    spare = _upload(client, cid, 1, start=3)[0]
    text = _note_wall(ids[:2]) + f"\n::: chart\nkind: gallery\n| Picture |\n| --- |\n| {ids[2]} |\n:::\n"
    note = make_note(client, cid, title="Losses", content=text)
    case = Case.open(cid)
    refs = uses.used_refs(case)
    assert set(ids) <= refs and spare not in refs
    impact = client.post(f"/api/cases/{cid}/delete-impact", json={"ids": [ids[2]]}).json()
    assert {row["label"]: row["how"] for row in impact["touched"]}["Losses"] == [uses.WALL_HOW]
    assert note["id"]


def test_the_picker_proposes_a_wall_for_a_table_of_pictures():
    table = nc.parse_block("| Photo | # | Model | Grade | State |\n| --- | --- | --- | --- | --- |\n" + "\n".join(
        f"| [[media:e_{index:010d}|v{index}.jpg]] | #{index} | {'Cougar' if index < 3 else 'M-ATV'} | "
        f"{'Confirmed' if index % 2 else 'Almost sure'} | burned |" for index in range(1, 6)))
    assert "pictures" in nc.fitting(table.table)
    proposal = next(one for one in notes_chart_picker.proposals(table) if one.kind == "pictures")
    assert proposal.settings == {"kind": "pictures", "count": "", "picture": "Photo", "label": "#", "by": "Model",
                                 "colour by": "Grade", "words": "State"}
    applied = notes_chart_picker.applied(table, proposal.settings)
    assert applied.extra["picture"] == "Photo" and applied.by == "Model"
    words = nc.parse_block("| Model | Count |\n| --- | --- |\n| Cougar | 3 |")
    assert "pictures" not in nc.fitting(words.table)
