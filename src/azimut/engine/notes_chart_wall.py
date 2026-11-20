"""A picture wall: one real picture of the case a row, lined up by group.

`notes_charts` registers it at its foot as the kind ``pictures`` (``picture wall``,
``gallery``). It is the sheet of every vehicle seen, one frame each, lined up by model.

**Its table.** One row a picture:

- ``picture``: the column holding a picture of the case, a ``[[media:e_…|label]]`` chip or
  its id alone. Left out, the first column whose cells hold one.
- ``label``: the column naming each frame (``#7``). Left out, a column named ``#``,
  ``No.``, ``ID``, ``Label`` or ``Name``.
- ``words``: the words after the label (its state). Left out, the first column no other
  setting reads; ``words: none`` shows none.
- ``by``: the groups, each with its name, its count and its flag (``flags: Streit Cougar
  = own:…`` as silhouette rows read it, or ``flag:`` a column naming one a row). Left out,
  the wall is one group.
- ``colour by``: a thin bar under each picture, with the legend and the grades' ramp as
  every chart paints them.
- ``shape``: the one shape every picture is cropped to, ``3:2`` unless it says ``4:3``,
  ``1:1``, ``16:9``, ``4:5`` or ``2:3``.
- ``order``, ``only``, ``sort``, ``last`` as every chart reads them; ``highlight`` names a
  group (its count in the accent, the others' bars greyed), a value of the colour column,
  or a frame's label (that frame ringed in the accent).

**Its layout.** Every picture one size, cropped about its middle to the shape. Groups flow
as the reference sheet lays them: a group stands beside the one before when the line has
room for its frames and its name, and one longer than a line wraps onto as many as it
needs. ``last`` groups come after a rule. Free, a frame is about `TARGET` CSS pixels wide;
a frame of fixed size (a picture for X, 4:5 or 1:1) or a page's room (the PDF) takes the
largest frames that let the whole wall fit.

**Its pictures** are the case's own files (`notes_charts.Frame`), read by each painter at
its own size; the credit line names where they come from, read from the media. A cell
naming no picture of the case is drawn as an empty frame, and the check says which.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .notetext import ENTITY_REF, MEDIA_REF

if TYPE_CHECKING:
    from .notes_charts import Box, ChartBlock, ChartTheme, Check, Frame, Mark, Paint, Plot, Reading, Table

#: A frame's width when nothing fixes the wall's size, in CSS pixels: seven across a page.
TARGET = 78.0
#: The narrowest a frame is drawn to fit a fixed size, and the widest.
MIN_FRAME = 34.0
MAX_FRAME = 260.0
#: The most frames a line holds.
MAX_ACROSS = 20
#: Room between frames, between their lines, between two groups on a line, between lines of groups.
GAP_X = 6.0
GAP_Y = 9.0
GROUP_GAP = 20.0
BAND_GAP = 14.0
#: The bar under a frame: its gap to the picture and its thickness.
BAR_GAP = 3.0
BAR = 3.5
#: The shapes a wall's pictures are cropped to, by the words that write them.
SHAPES = {"3:2": (3, 2), "4:3": (4, 3), "1:1": (1, 1), "16:9": (16, 9), "4:5": (4, 5), "2:3": (2, 3)}
SHAPE_WORDS = {"square": "1:1", "landscape": "3:2", "portrait": "2:3", "wide": "16:9"}
DEFAULT_SHAPE = "3:2"
#: A cell naming a picture by its id alone.
PICTURE_ID = re.compile(r"^e_[0-9A-Za-z]{4,40}$")
#: Columns a wall reads its pictures, labels and words from, by their names.
PICTURE_HEADER = re.compile(r"\b(?:pictures?|photos?|photographs?|images?|frames?|stills?|thumbnails?|screenshots?)\b",
                            re.I)
LABEL_HEADER = re.compile(r"^(?:#|n[o°º]?\.?|nr\.?|id|ref\.?|label|name)$", re.I)
NONE_WORDS = ("none", "no", "nothing", "")
#: The settings a wall reads beyond the common ones.
KEYS = ("picture", "label", "words", "shape", "flag", "flags")
#: What an empty frame says.
NO_PICTURE = "No picture"


def picture_ref(cell: str) -> str:
    """The id of the picture a cell names: a media chip's, an entity chip's, or the id
    written alone; empty when it names none."""
    text = str(cell or "").strip()
    found = MEDIA_REF.search(text) or ENTITY_REF.search(text)
    if found:
        return found.group(1)
    return text if PICTURE_ID.match(text) else ""


def shape_of(written: str) -> tuple[int, int] | None:
    """The shape ``shape`` writes, as width and height; None when it cannot be read."""
    text = " ".join(str(written or "").casefold().split())
    if not text:
        return SHAPES[DEFAULT_SHAPE]
    text = SHAPE_WORDS.get(text, text).replace("/", ":").replace(" ", "").replace("x", ":").replace("×", ":")
    match = re.match(r"^(\d{1,2}):(\d{1,2})$", text)
    if not match or not int(match.group(1)) or not int(match.group(2)):
        return None
    width, height = int(match.group(1)), int(match.group(2))
    return (width, height) if 0.3 <= width / height <= 3.4 else None


# -- the columns ------------------------------------------------------------------------------


def picture_column(table: "Table", written: str = "") -> int | None:
    """The column of pictures: the one ``picture`` names, else the first whose filled cells
    are mostly pictures, else the first named for pictures that holds one."""
    if written:
        return table.column(written)
    best = None
    for column in range(len(table.headers)):
        cells = [row[column] for row in table.cells if column < len(row) and row[column].strip()]
        held = sum(1 for cell in cells if picture_ref(cell))
        if held and held * 2 >= len(cells):
            return column
        if held and best is None and PICTURE_HEADER.search(table.headers[column]):
            best = column
    return best


@dataclass(frozen=True)
class Columns:
    """The columns a wall reads, by index, None for one it does not have."""

    picture: int | None
    label: int | None
    words: int | None


def columns(reading: "Reading") -> Columns:
    """The picture, label and words columns of a wall's table, as the settings and the
    module docstring say."""
    table = reading.table
    extra = reading.block.extra
    if table is None:
        return Columns(None, None, None)
    picture = picture_column(table, (extra.get("picture") or "").strip())
    label_said = (extra.get("label") or "").strip()
    label = table.column(label_said) if label_said else next(
        (index for index, header in enumerate(table.headers) if index != picture and LABEL_HEADER.match(header.strip())),
        None)
    words_said = (extra.get("words") or "").strip()
    if words_said.casefold() in NONE_WORDS and words_said:
        words = None
    elif words_said:
        words = table.column(words_said)
    else:
        used = {picture, label, reading.by, reading.colour, _flag_column(reading)}
        rows = table.rows
        words = next((index for index in range(len(table.headers)) if index not in used
                      and any(index < len(row) and row[index] for row in rows)), None)
    return Columns(picture, label, words)


def _flag_column(reading: "Reading") -> int | None:
    said = (reading.block.extra.get("flag") or "").strip()
    return reading.table.column(said) if said and reading.table is not None else None


# -- the groups -------------------------------------------------------------------------------


@dataclass
class Item:
    """One frame: its row, its picture (None when the case holds none), what it is said by."""

    row: int
    ref: str
    frame: "Frame | None"
    label: str
    words: str
    value: str
    paint: "Paint | None"
    lit: bool = False

    @property
    def said(self) -> str:
        return " ".join(part for part in (self.label, self.words) if part)


@dataclass
class Group:
    """A group of frames: its name (empty for a wall of one), its flag's glyph and frames."""

    name: str
    flag: str
    items: list[Item]
    lit: bool = False
    last: bool = False


def _paint(reading: "Reading", theme: "ChartTheme", group: str, value: str) -> "Paint | None":
    """A frame's bar: its colour value's paint; past a group the block highlights, the other
    groups' bars greyed, as bars grey the bars it does not name. None with no colour column,
    or for a row that holds no value in it: its bar's place stays empty."""
    from . import notes_charts as nc

    if reading.colour is None or not value:
        return None
    lit = {one.casefold() for one in reading.block.highlight}
    values_lit = lit & {one.casefold() for one in reading.values}
    groups_lit = lit & {category.name.casefold() for category in reading.categories if category.name}
    paint = reading.paint(value)
    if groups_lit and not values_lit and group.casefold() not in groups_lit:
        return nc.Paint(theme.others, origin="highlight")
    return paint


def groups_of(reading: "Reading", theme: "ChartTheme") -> list[Group]:
    """The wall's groups in the order the chart sorts them, each frame read off its row."""
    from . import notes_chart_kinds as kinds
    from . import notes_charts as nc

    table = reading.table
    if table is None:
        return []
    found = columns(reading)
    flag_column = _flag_column(reading)
    lit = {one.casefold() for one in reading.block.highlight}
    alias = {value.casefold(): value for value in reading.values}
    out: list[Group] = []
    for category in reading.categories:
        items: list[Item] = []
        for row in sorted(category.rows):
            cell = table.cells[row][found.picture] if found.picture is not None else ""
            ref = picture_ref(cell)
            frame = reading.pictures(ref) if ref and reading.pictures is not None else None
            label = table.rows[row][found.label] if found.label is not None else ""
            words = table.rows[row][found.words] if found.words is not None else ""
            raw = table.rows[row][reading.colour] if reading.colour is not None else ""
            value = alias.get(raw.casefold(), nc.OTHER if raw else "")
            items.append(Item(row, ref, frame, label, words, value, _paint(reading, theme, category.name, value),
                              bool(label) and label.casefold() in lit))
        flag = ""
        if category.name:
            if flag_column is not None:
                flag = next((key for row in category.rows
                             if (key := kinds.glyph_key(table.rows[row][flag_column]))), "")
            flag = flag or kinds.mapped_glyph(reading, kinds.FLAGS, category.name)
        out.append(Group(category.name, flag, items, category.name.casefold() in lit if category.name else False,
                         category.last))
    return out


# -- laying it out ------------------------------------------------------------------------------


@dataclass
class _Laid:
    marks: list["Mark"]
    height: float
    across: int
    cell: float
    lines: list[str] = field(default_factory=list)
    #: Where each frame stands, ``(group, item, x, y)``, for the tests.
    spots: list[tuple[int, int, float, float]] = field(default_factory=list)


def _sizes(theme: "ChartTheme") -> dict[str, float]:
    return {"name": theme.label_size, "count": theme.value_size + 1.0,
            "head": max(theme.label_size, theme.value_size + 1.0) * 1.35 + 4.0}


def caption_size(theme: "ChartTheme", cell: float) -> float:
    """The words under a frame: smaller under a small frame, never past the look's own."""
    return max(7.5, min(theme.inside_size - 1.0, cell * 0.12))


def _head_width(group: Group, theme: "ChartTheme", sizes: dict[str, float]) -> float:
    from . import notes_charts as nc

    if not group.name:
        return 0.0
    name = group.name.upper() if theme.caps_title else group.name
    width = nc.text_width(name, sizes["name"], theme.head, bold=True) + 6
    width += nc.text_width(str(len(group.items)), sizes["count"], theme.head, bold=True)
    return width + (24.0 if group.flag else 0.0)


def _lay(reading: "Reading", theme: "ChartTheme", groups: list[Group], x0: float, y0: float, width: float,
         cell: float, ratio: float, *, measure: bool = False) -> _Laid:
    """The groups laid from ``(x0, y0)``, ``width`` wide, each frame ``cell`` wide: as many
    to a line as the width holds."""
    from . import notes_charts as nc

    sizes = _sizes(theme)
    across = max(1, int((width + GAP_X) / (cell + GAP_X) + 1e-6))
    picture_height = cell / ratio
    bars = reading.colour is not None
    captions = any(item.said for group in groups for item in group.items)
    caption = caption_size(theme, cell)
    words = not measure and _words_fit(groups, theme, cell, caption)
    item_height = picture_height + (BAR_GAP + BAR if bars else 0.0) + (3.0 + caption * 1.15 if captions else 0.0)
    headed = any(group.name for group in groups)
    head = sizes["head"] if headed else 0.0
    marks: list[Mark] = []
    lines: list[str] = []
    spots: list[tuple[int, int, float, float]] = []
    x, y, band = x0, y0, 0.0
    separated = False
    for number, group in enumerate(groups):
        count = len(group.items)
        long = count > across
        frames_width = count * cell + max(0, count - 1) * GAP_X
        group_width = width if long else min(width, max(frames_width, _head_width(group, theme, sizes)))
        if group.last and not separated and number:
            if x > x0:
                y, x, band = y + band + BAND_GAP, x0, 0.0
            if not measure:
                marks.append(nc.Line(((x0, y + 1), (x0 + width, y + 1)), theme.grid, 1.0))
            y += 10.0
            separated = True
        if x > x0 and (long or x + group_width > x0 + width + 0.5):
            y, x, band = y + band + BAND_GAP, x0, 0.0
        rows = max(1, math.ceil(count / across))
        height = head + rows * item_height + (rows - 1) * GAP_Y
        if not measure:
            if group.name:
                marks.extend(_head(group, theme, sizes, x, y))
            for index, item in enumerate(group.items):
                fx = x + (index % across) * (cell + GAP_X)
                fy = y + head + (index // across) * (item_height + GAP_Y)
                marks.append(_frame(item, group, theme, fx, fy, cell, picture_height, bars, captions, caption, words))
                spots.append((number, index, fx, fy))
        labels = [item.label for item in group.items if item.label]
        named = f"{group.name}: {count}" if group.name else f"{count} pictures"
        lines.append(f"{named} ({', '.join(labels)})" if labels else named)
        band = max(band, height)
        if long:
            y, x, band = y + band + BAND_GAP, x0, 0.0
        else:
            x += group_width + GROUP_GAP
    total = (y + band - y0) if band else max(0.0, y - BAND_GAP - y0)
    return _Laid(marks, total, across, cell, lines, spots)


def _head(group: Group, theme: "ChartTheme", sizes: dict[str, float], x: float, y: float) -> list["Mark"]:
    """A group's name and count, its flag before them."""
    from . import notes_chart_kinds as kinds
    from . import notes_charts as nc

    marks: list[Mark] = []
    base = y + sizes["head"] - 8.0
    left = x
    if group.flag:
        drawing = kinds.glyph(group.flag)
        flag_height = min(13.0, 19.0 / drawing.aspect)
        marks.extend(kinds.glyph_marks(drawing, nc.Paint(theme.ink2), theme, x, base - flag_height + 1.5, flag_height))
        left += 24.0
    name = group.name.upper() if theme.caps_title else group.name
    marks.append(nc.Text(left, base, name, sizes["name"], theme.ink, bold=True))
    left += nc.text_width(name, sizes["name"], theme.head, bold=True) + 6
    marks.append(nc.Text(left, base + 0.5, str(len(group.items)), sizes["count"],
                         theme.accent if group.lit else theme.ink, bold=True))
    return [nc.Group(tuple(marks), f"{group.name}: {len(group.items)}")]


def _words_fit(groups: list[Group], theme: "ChartTheme", cell: float, size: float) -> bool:
    """Whether the words go under the frames: when most fit whole beside their label, so a
    small frame shows its label alone rather than every state cut to a letter."""
    from . import notes_charts as nc

    said = [item for group in groups for item in group.items if item.words]
    whole = sum(1 for item in said if (nc.text_width(item.label, size, theme.head, bold=True) + 3.5 if item.label else 0.0)
                + nc.text_width(item.words, size, theme.head) <= cell)
    return bool(said) and whole * 2 >= len(said)


def _frame(item: Item, group: Group, theme: "ChartTheme", x: float, y: float, w: float, h: float, bars: bool,
           captions: bool, size: float, words_shown: bool = True) -> "Mark":
    """One frame: its picture cropped to the box (an empty one when the case holds none), its
    bar, its label and words; ringed in the accent when the block highlights it."""
    from . import notes_charts as nc

    marks: list[Mark] = []
    if item.frame is not None:
        marks.append(nc.Picture(x, y, w, h, b"", cover=True, source=item.frame))
    else:
        marks.append(nc.Rect(x, y, w, h, theme.grid))
        marks.append(nc.Text(x + w / 2, y + h / 2 + 3.5, nc._fit(NO_PICTURE, w - 6, 9.5, theme.head, False), 9.5,
                             theme.muted, anchor="middle"))
    if item.lit:
        marks.append(nc.Rect(x - 1.75, y - 1.75, w + 3.5, h + 3.5, "none", stroke=theme.accent, stroke_width=2.5))
    bottom = y + h
    if bars:
        if item.paint is not None:
            marks.append(nc.fill_rect(item.paint, x, bottom + BAR_GAP, w, BAR, 0.0, "", theme))
        bottom += BAR_GAP + BAR
    if captions and item.said:
        base = bottom + 3.0 + size * 0.95
        label = nc._fit(item.label, w, size, theme.head, True) if item.label else ""
        colour = theme.accent if item.lit else theme.ink
        if label:
            marks.append(nc.Text(x, base, label, size, colour, bold=True, full=item.label if label != item.label else ""))
        if item.words and (words_shown or not label):
            left = x + (nc.text_width(label, size, theme.head, bold=True) + 3.5 if label else 0.0)
            room = x + w - left
            words = nc._fit(item.words, room, size, theme.head, False) if room > size else ""
            if words.rstrip("…").strip():
                marks.append(nc.Text(left, base, words, size, theme.ink2, full=item.words if words != item.words else ""))
    said = [part for part in (item.said, group.name, item.value) if part]
    if item.frame is None:
        said.append(NO_PICTURE.lower())
    return nc.Group(tuple(marks), ", ".join(said) or NO_PICTURE)


#: How much smaller each frame size tried to fit a fixed size is than the one before.
FIT_STEP = 0.96


def _fits(reading: "Reading", theme: "ChartTheme", groups: list[Group], box: "Box", ratio: float,
          limit: float, largest: float) -> float:
    """The widest frame, at most ``largest``, that lets the wall stand within ``limit``: the
    narrowest tried when none does."""
    narrowest = max(MIN_FRAME, (box.width - (MAX_ACROSS - 1) * GAP_X) / MAX_ACROSS)
    cell = min(largest, box.width)
    while cell > narrowest:
        if _lay(reading, theme, groups, box.x, box.y, box.width, cell, ratio, measure=True).height <= limit + 0.5:
            return cell
        cell *= FIT_STEP
    return narrowest


def free_cell(width: float) -> float:
    """A frame's width when nothing fixes the wall's size: as many about `TARGET` wide as a
    line holds, filling it."""
    across = max(2, int((width + GAP_X) // (TARGET + GAP_X)))
    return (width - (across - 1) * GAP_X) / across


def plot_pictures(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """The wall: each group's name, count and flag, then its frames, the groups flowing as
    the module docstring says, sized to the frame."""
    from . import notes_chart_kinds as kinds
    from . import notes_charts as nc

    groups = [group for group in groups_of(reading, theme) if group.items]
    if not groups:
        return nc.Plot([], 0.0, desc="A picture wall with no picture to draw.")
    width, height = shape_of(reading.block.extra.get("shape", "")) or SHAPES[DEFAULT_SHAPE]
    ratio = width / height
    cell = free_cell(box.width)
    if box.height is not None:
        cell = _fits(reading, theme, groups, box, ratio, box.height, MAX_FRAME)
    elif box.room is not None:
        cell = _fits(reading, theme, groups, box, ratio, box.room, cell)
    laid = _lay(reading, theme, groups, box.x, box.y, box.width, cell, ratio)
    marks, used = kinds.centred(laid.marks, laid.height, box) if box.height is not None else (laid.marks, laid.height)
    count = sum(len(group.items) for group in groups)
    table = reading.table
    by = nc._lower(table.headers[reading.by]) if table is not None and reading.by is not None else ""
    colour = nc._lower(table.headers[reading.colour]) if table is not None and reading.colour is not None else ""
    floor = " at least" if reading.floor else ""
    desc = (f"Picture wall:{floor} {count} picture{'s' if count != 1 else ''}"
            + (f", by {by}" if by else "") + (f", the bar under each coloured by {colour}" if colour else "")
            + (f". {len(groups)} groups." if by else "."))
    return nc.Plot(marks, used, lines=laid.lines, desc=desc, table=_data_table(reading, groups),
                   facts={"across": laid.across, "cell": laid.cell, "ratio": ratio, "spots": laid.spots,
                          "bars": reading.colour is not None,
                          "wall": groups, "groups": [(group.name, len(group.items)) for group in groups]})


def _data_table(reading: "Reading", groups: list[Group]) -> tuple[list[str], list[list[str]]]:
    """The frames as a table a screen reader reads: label, words, group, colour value."""
    table = reading.table
    assert table is not None
    found = columns(reading)
    head = [table.headers[found.label] if found.label is not None else "Picture"]
    if found.words is not None:
        head.append(table.headers[found.words])
    if reading.by is not None:
        head.append(table.headers[reading.by])
    if reading.colour is not None:
        head.append(table.headers[reading.colour])
    rows: list[list[str]] = []
    for group in groups:
        for item in group.items:
            first = item.label or (item.frame.label if item.frame is not None else "") or NO_PICTURE
            row = [first]
            if found.words is not None:
                row.append(item.words)
            if reading.by is not None:
                row.append(group.name)
            if reading.colour is not None:
                row.append(item.value)
            rows.append(row)
    return head, rows


# -- what the picker, the check and the credit line read ---------------------------------------------


def fits_pictures(table: "Table") -> bool:
    """A table whose rows hold pictures of the case."""
    column = picture_column(table)
    return column is not None and any(picture_ref(row[column]) for row in table.cells if column < len(row))


def propose(block: "ChartBlock") -> dict[str, str]:
    """What the picker writes for a wall of this table: its pictures, its labels, a column
    of a few repeated values as its groups, a column of grades (else another) as its bar's
    colour, and the words left; never a count."""
    from . import notes_chart_kinds as kinds
    from . import notes_chart_picker as picker

    table = block.table
    out: dict[str, str] = {"count": ""}
    if table is None:
        return out
    picture = picture_column(table)
    if picture is not None:
        out["picture"] = table.headers[picture]
    label = next((index for index, header in enumerate(table.headers)
                  if index != picture and LABEL_HEADER.match(header.strip())), None)
    if label is not None:
        out["label"] = table.headers[label]
    rows, texts, _ = kinds._shape(table)
    used = {picture, label}
    colours = [column for column in picker.colour_columns(table) if column not in used]
    by = table.column(block.by) if block.by else None
    if by is None or by in used:
        repeated = [column for column in texts if column not in used and 1 < kinds._distinct(rows, column) < len(rows)
                    and not kinds._graded(rows, column)]
        by = repeated[0] if repeated else None
    out["by"] = table.headers[by] if by is not None else ""
    used.add(by)
    colour = table.column(block.colour_by) if block.colour_by else None
    if colour is None or colour in used:
        colour = next((column for column in colours if column not in used), None)
    out["colour by"] = table.headers[colour] if colour is not None else ""
    used.add(colour)
    words = next((column for column in texts if column not in used), None)
    if words is not None:
        out["words"] = table.headers[words]
    return out


def held(reading: "Reading") -> set[str]:
    """The frames' labels, which a highlight may name."""
    table = reading.table
    found = columns(reading)
    if table is None or found.label is None:
        return set()
    return {table.rows[row][found.label] for row in reading.rows if table.rows[row][found.label]}


def credits(reading: "Reading") -> list[str]:
    """``Pictures: x.com, t.me``: where the pictures shown come from, as the media say."""
    from . import notes_charts as nc

    table = reading.table
    found = columns(reading)
    if table is None or found.picture is None or reading.pictures is None:
        return []
    said: list[str] = []
    for row in reading.rows:
        ref = picture_ref(table.cells[row][found.picture])
        frame = reading.pictures(ref) if ref else None
        if frame is not None and frame.credit and frame.credit not in said:
            said.append(frame.credit)
    if not said:
        return []
    if len(said) > nc.MAX_CREDITS:
        said = [*said[:nc.MAX_CREDITS], f"and {len(said) - nc.MAX_CREDITS} more"]
    return [f"Pictures: {', '.join(said)}"]


def check_pictures(reading: "Reading") -> list["Check"]:
    """No column of pictures, one a setting names that is not there, rows with no picture or
    one the case no longer holds, a shape it cannot read; then the flags, as silhouette rows'."""
    from . import notes_chart_kinds as kinds

    out: list[Check] = []
    table = reading.table
    if table is None:
        return out
    extra = reading.block.extra
    for key in ("picture", "label", "words"):
        said = (extra.get(key) or "").strip()
        if said and not (key == "words" and said.casefold() in NONE_WORDS) and table.column(said) is None:
            out.append(kinds._check(reading, f'reads its {key}s in "{said[:40]}", a column its table does not have.'
                                    if key != "words" else
                                    f'reads its words in "{said[:40]}", a column its table does not have.',
                                    key, "missing"))
    found = columns(reading)
    if found.picture is None:
        out.append(kinds._check(reading, "holds no column of pictures: a picture of the case a row, as "
                                         "[[media:…]] or its id.", "picture" if extra.get("picture") else None,
                                "missing"))
        return out + kinds.check_glyphs(reading)
    empty: list[str] = []
    gone: list[str] = []
    for row in reading.rows:
        ref = picture_ref(table.cells[row][found.picture])
        name = (table.rows[row][found.label] if found.label is not None else "") or f"row {row + 1}"
        if not ref:
            empty.append(name)
        elif reading.pictures is not None and reading.pictures(ref) is None:
            gone.append(name)
    if empty:
        more = f", and {len(empty) - 3} more" if len(empty) > 3 else ""
        out.append(kinds._check(reading, f"draws {len(empty)} frame{'s' if len(empty) > 1 else ''} empty, with no "
                                         f"picture: {', '.join(empty[:3])}{more}.", "picture"))
    if gone:
        more = f", and {len(gone) - 3} more" if len(gone) > 3 else ""
        out.append(kinds._check(reading, f"shows {len(gone)} picture{'s' if len(gone) > 1 else ''} no longer in the "
                                         f"case: {', '.join(gone[:3])}{more}.", "picture", "missing"))
    if shape_of(extra.get("shape", "")) is None:
        out.append(kinds._check(reading, f'cannot read "shape: {extra.get("shape", "")[:20]}": write 3:2, 4:3, 1:1, '
                                         f"16:9, 4:5 or 2:3.", "shape"))
    return out + kinds.check_glyphs(reading)


def wall_facts(chart_facts: dict[str, Any]) -> list[Group]:
    """The groups a laid-out wall holds, for a page that draws it as a grid of its own."""
    groups = chart_facts.get("wall")
    return groups if isinstance(groups, list) else []


def flag_svg(key: str, theme: "ChartTheme", ident: str, name: str, height: float = 14.0) -> str:
    """A group's flag as a small SVG a page holds, drawn as the chart draws it."""
    from . import notes_chart_kinds as kinds
    from . import notes_charts as nc

    drawing = kinds.glyph(key)
    height = min(height, 21.0 / drawing.aspect)
    width = height * drawing.aspect
    marks = kinds.glyph_marks(drawing, nc.Paint(theme.ink2), theme, 0.0, 0.0, height)
    layout = nc.Layout(width, height, theme, [nc.Rect(0, 0, width, height, theme.paper), *marks], f"Flag of {name}",
                       "", [], [], None, [], [], "", "flag", [], [], [])
    return nc.svg(layout, ident=ident, transparent=True).replace('class="az-chart az-chart-', 'class="az-wall-flag az-flag-', 1)
