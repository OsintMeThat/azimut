"""A timeline: points and periods along the days, laid across, numbered or listed.

`notes_charts` registers it at its foot as the kind ``timeline`` (``chronology``,
``sequence``). Its table is *Day · What · Until*: a row with an *Until* day is a period,
any other a point. ``by`` names the column of words when there are several, and
``colour by`` a column whose values colour each event (a kind: claim, geolocated,
press), with the legend every chart draws, so the words need not say it.

**Its layouts** (``layout``):

- ``across``: one line of days, each point's label beside its stem, the labels taking
  turns above and below the line. A label keeps a comfortable width even when the next
  stem is close; it climbs into the lowest lane where it meets no other label and no stem,
  or reaches a free place in its lane by a bent leader. Each lane is as tall as its own
  labels, and the labels take at most `MAX_LANES` lanes, both sides together. Periods are
  bands under the scale, their words inside or beside them, and the points all above.
- ``numbered``: a numbered dot on the line for each event, stacked where days are close,
  and the words in a list under it, in two columns when the frame is wide.
- ``list``: one row an event, its day in a left gutter, a rule down the page, a dot for a
  point and a bar for a period.
- ``auto``, or no line: up to `AUTO_ACROSS` events across, up to `AUTO_NUMBERED`
  numbered, more listed, and always listed narrower than `LIST_WIDTH` (the HTML page's
  drawing for a phone). A frame of fixed size (a picture for X, 4:5, 1:1) or a page's
  room (the PDF) takes the rule's choice when it fits, else the first other that does,
  else the shortest.

**Short labels** (``labels: short``): each event's day and its first words, cut after its
first clause or `SHORT_CHARS` characters. The cut words carry their whole text, which the
page and the editor show on hover. A drawing nothing hovers over (the PDF, a picture for
X or a post, an infographic's picture: `notes_charts.Box.still`) prints the words whole:
a cut sentence on paper would drop its "(claim)".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from .notes_chart_kinds import Day
    from .notes_charts import Box, ChartTheme, Check, Mark, Paint, Plot, Reading, Table, Text

#: The layouts a timeline is drawn in, ``layout: auto`` (or none) first.
AUTO = "auto"
ACROSS = "across"
NUMBERED = "numbered"
LIST = "list"
LAYOUTS = (AUTO, ACROSS, NUMBERED, LIST)
#: Auto's rule: events laid across up to this many, numbered up to the next, listed past it.
AUTO_ACROSS = 8
AUTO_NUMBERED = 20
#: A frame narrower than this (a phone) is always listed by Auto.
LIST_WIDTH = 420.0
#: ``labels: short``, and the characters a short label's words keep at most.
FULL = "full"
SHORT = "short"
LABELS = (FULL, SHORT)
SHORT_CHARS = 30
#: The settings a timeline reads beyond the common ones.
KEYS: tuple[str, ...] = ("layout", "labels")

#: The most lanes the labels across take, both sides together, and on one side.
MAX_LANES = 5
SIDE_LANES = 3
#: Room between two labels of a lane, and between two lanes (a bent leader runs in it).
LABEL_GAP = 10.0
LANE_GAP = 12.0
#: How far apart two dots of the same day stand on the line, centre to centre: a dot and its ring.
DOT_PITCH = 13.0
#: The least room between a stem and words or another leader it passes, so two lines never seem one.
STEM_ROOM = 5.0
#: The search for a side's lanes gives up past this many steps and tries one lane more.
SEARCH_STEPS = 600
#: What a bent leader, and words running left of their day when they could run right,
#: weigh against height, in CSS pixels, when the ways to lay a side are compared.
BEND_COST = 16.0
BACK_COST = 12.0
#: The numbered layout: a dot's radius on the line, a list's in the list, and the width
#: from which the list stands in two columns.
BADGE = 9.0
LIST_BADGE = 8.0
TWO_COLUMNS = 520.0

#: Words a short label does not end on.
_TRAILING = {"a", "an", "the", "of", "to", "in", "on", "at", "and", "or", "for", "with", "by", "from", "as",
             "into", "near", "its", "his", "her", "their"}
#: Where a sentence's first clause ends.
_CLAUSE = re.compile(r"\s*(?:[,;:(\[—–]|\s-\s)")


# -- reading the rows -----------------------------------------------------------------------------------


@dataclass
class Event:
    start: "Day"
    end: "Day | None"
    what: str
    row: int
    paint: "Paint"
    #: Its value in the colour column, '' without one.
    kind: str = ""

    @property
    def period(self) -> bool:
        return self.end is not None and self.end.day > self.start.day


#: A column named for where a period ends.
END_HEADER = re.compile(r"until|end|to\b|till", re.I)


def timeline_columns(reading: "Reading") -> tuple[int | None, int | None, int | None]:
    """The columns of a timeline's rows: its first day, the day a period runs until, and its words."""
    table = reading.table
    if table is None:
        return None, None, None
    rows = table.rows
    days = kinds.day_columns(table.headers, rows)
    start = days[0] if days else None
    # a column named for an end holds periods even when one row alone has one
    ends = [index for index in range(len(table.headers)) if index != start
            and END_HEADER.search(table.headers[index])
            and any(index < len(row) and kinds.read_day(row[index]) is not None for row in rows)]
    until = next((index for index in days[1:] if index in ends), ends[0] if ends else days[1] if len(days) > 1 else None)
    what = None
    if reading.block.by:
        found = table.column(reading.block.by)
        if found is not None and found not in days:
            what = found
    if what is None:
        what = next((index for index in range(len(table.headers)) if index not in days
                     and not nc._numeric(rows, index) and not nc.ROW_NUMBER.match(table.headers[index])
                     and index != reading.colour), None)
    return start, until, what


def events_of(reading: "Reading", theme: "ChartTheme") -> tuple[list[Event], int, bool]:
    """Every row read as a point or a period, by its day; with the rows whose day could not
    be read, and whether any day said its year."""
    table = reading.table
    start, until, what = timeline_columns(reading)
    if table is None or start is None:
        return [], 0, False
    rows = table.rows
    year = kinds.column_year(rows, [column for column in (start, until) if column is not None])
    events: list[Event] = []
    unread = 0
    had_year = False
    band = nc._mix(theme.others, theme.paper, 0.18 if theme.dark else 0.5)
    coloured = reading.colour is not None and reading.colour not in (start, until, what)
    for index in reading.rows:
        first = kinds.read_day(rows[index][start], year)
        if first is None:
            unread += 1
            continue
        had_year = had_year or first.year
        end = kinds.read_day(rows[index][until], first.day.year) if until is not None and rows[index][until] else None
        if end is not None and end.day < first.day:
            end = None
        words = rows[index][what] if what is not None else ""
        value = rows[index][reading.colour] if coloured and reading.colour is not None else ""
        if coloured:
            paint = reading.paint(value)
        else:
            paint = nc.Paint(band if end is not None and end.day > first.day else theme.ink)
        events.append(Event(first, end, words, index, paint, value))
    events.sort(key=lambda event: (event.start.day, event.row))
    return events, unread, had_year


def layout_of(reading: "Reading") -> str:
    """The layout the block asks for: one of `LAYOUTS`, Auto when it names none it reads."""
    written = (reading.block.extra.get("layout") or "").strip().casefold()
    return written if written in LAYOUTS else AUTO


def short_of(reading: "Reading") -> bool:
    return (reading.block.extra.get("labels") or "").strip().casefold() == SHORT


def short_words(text: str, most: int = SHORT_CHARS) -> str:
    """A label's first words: its first clause, else as many words as `SHORT_CHARS` holds,
    never ending on a small word, an ellipsis saying the rest is cut."""
    text = " ".join(text.split())
    if len(text) <= most:
        return text
    clause = _CLAUSE.split(text, 1)[0].strip()
    if clause and clause != text and len(clause) <= most and len(clause.split()) >= 2:
        return clause + "…"
    kept: list[str] = []
    for word in text.split():
        if kept and len(" ".join([*kept, word])) > most:
            break
        kept.append(word)
    while len(kept) > 1 and kept[-1].casefold().strip(",;:.") in _TRAILING:
        kept.pop()
    shown = " ".join(kept).rstrip(",;:.—–-")
    return shown if shown == text else shown + "…"


@dataclass(frozen=True)
class _Words:
    """How an event is said: ``years`` when its days print their year (the events run over
    more than one), ``short`` when its words are cut, ``said`` whether the table wrote years."""

    years: bool
    short: bool
    said: bool = False

    def when(self, event: Event, *, year: bool) -> str:
        said = kinds.day_text(event.start, year=year)
        if event.period and event.end is not None:
            said = f"{said} – {kinds.day_text(event.end, year=year)}"
        return said

    def words(self, event: Event) -> str:
        return short_words(event.what) if self.short else event.what


def event_said(event: Event, years: bool) -> str:
    """The event in one line, for its hover and the alt text: its days, its words, its kind."""
    when = kinds.day_text(event.start, year=years)
    if event.period and event.end is not None:
        when = f"{when} to {kinds.day_text(event.end, year=years)}"
    said = f"{when}: {event.what}" if event.what else when
    # the kind is said unless the words say it already, as a word of their own
    if event.kind and not re.search(rf"(?<!\w){re.escape(event.kind)}(?!\w)", event.what, re.I):
        said = f"{said} ({event.kind})"
    return said


# -- the plot -------------------------------------------------------------------------------------------


def plot_timeline(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """The events in the layout the block asks for, or the one Auto picks for the frame."""
    events, unread, years = events_of(reading, theme)
    notes = [f"{unread} row{'s' if unread > 1 else ''} with no day it can read {'are' if unread > 1 else 'is'} "
             f"not drawn."] if unread else []
    start, until, what = timeline_columns(reading)
    table = reading.table
    kind_column = reading.colour if reading.colour is not None and reading.colour not in (start, until, what) else None
    head = [table.headers[column] for column in (start, what, until, kind_column)
            if column is not None and table is not None]
    table_rows = [[kinds.day_text(event.start, year=years), event.what]
                  + ([kinds.day_text(event.end, year=years) if event.end else ""] if until is not None else [])
                  + ([event.kind] if kind_column is not None else []) for event in events]
    if not events:
        return nc.Plot([], 0.0, notes=notes, desc="A timeline with no day to draw.", table=(head, table_rows))
    asked = layout_of(reading)
    # the year is said on the days when the events run over more than one
    span = {event.start.day.year for event in events} | {event.end.day.year for event in events if event.end}
    words = _Words(years and len(span) > 1, short_of(reading) and not box.still, years)
    plot, chosen = _laid(events, theme, box, words, asked)
    plot.marks, plot.height = kinds.centred(plot.marks, plot.height, box)
    cut = words.short and any(words.words(event) != event.what for event in events)
    plot.facts.update({"layout": chosen, "auto": asked == AUTO, "short": cut})
    plot.notes = [*notes, *plot.notes]
    plot.lines = [event_said(event, years) for event in events]
    last = max((event.end or event.start for event in events), key=lambda day: day.day)
    plot.desc = (f"Timeline: {len(events)} rows, from {kinds.day_text(events[0].start, year=years)} to "
                 f"{kinds.day_text(last, year=years)}.")
    plot.table = (head, table_rows)
    return plot


def auto_layout(count: int, width: float) -> str:
    """Auto's choice for ``count`` events in a frame ``width`` wide."""
    if width < LIST_WIDTH:
        return LIST
    if count <= AUTO_ACROSS:
        return ACROSS
    return NUMBERED if count <= AUTO_NUMBERED else LIST


def _laid(events: list[Event], theme: "ChartTheme", box: "Box", words: _Words, asked: str) -> tuple["Plot", str]:
    lay: dict[str, Callable[..., Plot | None]] = {ACROSS: _across, NUMBERED: _numbered, LIST: _listed}
    if asked != AUTO:
        plot = lay[asked](events, theme, box, words)
        # an across too crowded for its lanes is numbered, its words never meeting
        return (plot, asked) if plot is not None else (_numbered(events, theme, box, words), NUMBERED)
    first = auto_layout(len(events), box.width)
    limit = box.height if box.height is not None else box.room
    best: tuple[Plot, str] | None = None
    for name in [first] + ([one for one in (ACROSS, NUMBERED, LIST) if one != first] if limit is not None else []):
        plot = lay[name](events, theme, box, words)
        if plot is None:
            continue
        if limit is None or plot.height <= limit + 0.5:
            return plot, name
        if best is None or plot.height < best[0].height:
            best = (plot, name)
    if best is None:
        return _numbered(events, theme, box, words), NUMBERED
    return best


# -- across ---------------------------------------------------------------------------------------------


@dataclass
class _Label:
    """A point's label across: its day's place on the line, its words, the side it takes."""

    x: float
    when: str
    lines: list[str]
    width: float
    height: float
    event: Event
    full: str = ""
    #: The event in one line, for its hover.
    said: str = ""
    #: The lane it sits in, 0 next to the line; its pole, where its stem rises beside its
    #: words (its day's place, else the end of a bent leader); its words right of the pole
    #: (``start``) or left of it (``end``).
    lane: int = 0
    pole: float = 0.0
    anchor: str = "start"

    @property
    def box(self) -> tuple[float, float]:
        """What it covers across: its pole and its words."""
        if self.anchor == "start":
            return self.pole - 1, self.pole + 5 + self.width
        return self.pole - 5 - self.width, self.pole + 1

    @property
    def bend(self) -> tuple[float, float] | None:
        """Where its leader runs sideways, in the gap under its lane; None for a straight stem."""
        if abs(self.pole - self.x) < 0.5:
            return None
        return min(self.x, self.pole), max(self.x, self.pole)


def clear(one: _Label, placed: list[_Label]) -> bool:
    """Whether a label's words, its stem and its bend meet nothing already placed: no words
    of its lane, no stem of a higher lane under its words, no lower words across its stem,
    and no bend crossing a stem."""
    a, b = one.box
    bend = one.bend
    for other in placed:
        c, d = other.box
        if other.lane == one.lane and a - LABEL_GAP < d and c < b + LABEL_GAP:
            return False
        if other.lane < one.lane and c - STEM_ROOM <= one.x <= d + STEM_ROOM:
            return False
        if other.lane > one.lane and a - STEM_ROOM <= other.x <= b + STEM_ROOM:
            return False
        # a bend runs in the gap under its lane: every stem reaching that lane or past it crosses it
        if bend and other.lane >= one.lane and bend[0] - STEM_ROOM <= other.x <= bend[1] + STEM_ROOM:
            return False
        other_bend = other.bend
        if other_bend and one.lane >= other.lane and other_bend[0] - STEM_ROOM <= one.x <= other_bend[1] + STEM_ROOM:
            return False
        if bend and other_bend and other.lane == one.lane and bend[0] - STEM_ROOM < other_bend[1] \
                and other_bend[0] < bend[1] + STEM_ROOM:
            return False
    return True


def _choices(label: _Label, placed: list[_Label], lanes: int, left: float, right: float,
             reach: float) -> list[tuple[int, float, str]]:
    """Where a label may go, best first: straight, then bent the least, in the lowest lane."""
    x, width = label.x, label.width
    found: list[tuple[float, int, float, str]] = []
    for lane in range(lanes):
        poles: set[tuple[float, str]] = {(x, "start"), (x, "end")}
        for other in placed:
            c, d = other.box
            if other.lane == lane:
                poles.add((d + LABEL_GAP + 2, "start"))
                poles.add((c - LABEL_GAP - 2, "end"))
            if other.lane > lane:
                poles.add((other.x + STEM_ROOM + 2, "start"))
                poles.add((other.x - STEM_ROOM - 2, "end"))
        poles.add((right - 5 - width, "start"))
        poles.add((left + 5 + width, "end"))
        for pole, anchor in poles:
            if abs(pole - x) > reach:
                continue
            a, b = (pole, pole + 5 + width) if anchor == "start" else (pole - 5 - width, pole)
            if a < left - 0.5 or b > right + 0.5:
                continue
            shift = abs(pole - x)
            # words run right of their day, unless the edge is near
            backward = 0.0 if anchor == "start" or x + 5 + width > right else 25.0
            found.append(((1000.0 if shift >= 0.5 else 0.0) + lane * 10 + shift + backward, lane, pole, anchor))
    found.sort()
    return [(lane, pole, anchor) for _, lane, pole, anchor in found]


def place_side(labels: list[_Label], lanes: int, left: float, right: float, reach: float) -> bool:
    """Every label of one side in at most ``lanes`` lanes, none meeting another (`clear`):
    a search from the right edge, which gives up past `SEARCH_STEPS`. Sets each label's
    lane, pole and anchor, and says whether it found them."""
    order = sorted(labels, key=lambda one: -one.x)
    placed: list[_Label] = []
    steps = 0

    def walk(index: int) -> bool:
        nonlocal steps
        if index == len(order):
            return True
        steps += 1
        if steps > SEARCH_STEPS:
            return False
        label = order[index]
        for lane, pole, anchor in _choices(label, placed, lanes, left, right, reach):
            label.lane, label.pole, label.anchor = lane, pole, anchor
            if clear(label, placed):
                placed.append(label)
                if walk(index + 1):
                    return True
                placed.pop()
        return False

    return walk(0)


def _label_of(event: Event, x: float, width: float, theme: "ChartTheme", words: _Words) -> _Label:
    size, date_size = theme.label_size, theme.label_size - 1
    when = words.when(event, year=words.years)
    said = words.words(event)
    if said and words.short:
        # short words stand on one line: that is what they are cut for
        width = max(width, nc.text_width(said, size, theme.head) + 1)
    found = kinds.lines_of(said, width, size, theme.head) if said else []
    widest = max([nc.text_width(when, date_size, theme.head, bold=True),
                  *(nc.text_width(line, size, theme.head) for line in found)])
    return _Label(x, when, found, widest, date_size * 1.3 + len(found) * size * 1.25, event,
                  full=event.what if said != event.what else "", said=event_said(event, words.said))


def _across(events: list[Event], theme: "ChartTheme", box: "Box", words: _Words) -> "Plot | None":
    """Points on the line of days, their labels taking turns above and below it in the
    fewest lanes; periods in tracks under the scale, the points then all above. None when
    the labels cannot be laid in `MAX_LANES` lanes or fewer."""
    first = min(event.start.day for event in events)
    last = max((event.end or event.start).day for event in events)
    left, right = box.x + 4, box.x + box.width - 4
    d0, d1, ticks = time_domain(first, last, right - left, years=words.said)
    total = max(1, (d1 - d0).days + 1)

    def at(day: date, middle: bool = True) -> float:
        return left + ((day - d0).days + (0.5 if middle else 0.0)) / total * (right - left)

    points = [event for event in events if not event.period]
    periods = [event for event in events if event.period]
    # points of one day, or nearly, stand side by side on the line, each with its own stem
    xs = {id(event): x for event, x in zip(points, spread([at(event.start.day) for event in points], DOT_PITCH,
                                                          left, right))}
    sides: list[list[Event]] = [points, []] if periods else [points[0::2], points[1::2]]
    inner = right - left
    reach = max(50.0, min(110.0, inner * 0.16))
    widest = max(130.0, min(230.0, inner * 0.3))
    most = MAX_LANES if periods else SIDE_LANES
    # every way to lay each side, at three widths of label: the lightest that keeps to the lanes
    best: tuple[float, list[list[_Label]], list[_Way]] | None = None
    for width in (widest, widest * 0.78, max(96.0, widest * 0.6)):
        laid = [[_label_of(event, xs[id(event)], width, theme, words) for event in side] for side in sides]
        ways = [_ways(labels, most, left, right, reach) for labels in laid]
        for above_way in ways[0]:
            for below_way in ways[1]:
                if above_way.lanes + below_way.lanes > MAX_LANES:
                    continue
                score = above_way.score + below_way.score
                if best is None or score < best[0] - 0.5:
                    best = (score, laid, [above_way, below_way])
    if best is None:
        return None
    _, (above, below), chosen = best
    for labels, way in zip((above, below), chosen):
        for label, (lane, pole, anchor) in zip(labels, way.places):
            label.lane, label.pole, label.anchor = lane, pole, anchor
    lanes_above, lanes_below = chosen[0].lanes, chosen[1].lanes
    tops_above = _lane_heights(above, lanes_above)
    axis = box.y + (tops_above[-1] + 18 if lanes_above else 8)
    marks: list[Mark] = [nc.Line(((left, axis), (right, axis)), theme.axis, 1.0)]
    tick_bottom = axis + 9 + theme.tick_size
    # a tick's day stands on paper, so a stem going down passes behind it
    tick_words: list[Mark] = []
    for day, text in ticks:
        x = at(day, False)
        marks.append(nc.Line(((x, axis), (x, axis + 5)), theme.axis, 1.0))
        day_said = _tick(x, tick_bottom, text, theme, box)
        if below:
            a, b = _extent(day_said, theme)
            tick_words.append(nc.Rect(a - 3, tick_bottom - theme.tick_size, b - a + 6, theme.tick_size * 1.3, theme.paper))
        tick_words.append(day_said)
    groups: list[Mark] = []
    lane_bottom = [axis - 18 - tops_above[lane] for lane in range(lanes_above)]
    for label in above:
        height = tops_above[label.lane + 1] - tops_above[label.lane] - (LANE_GAP if label.lane + 1 < lanes_above else 0)
        top = lane_bottom[label.lane] - height
        bend_y = lane_bottom[label.lane] + (9 if label.lane == 0 else LANE_GAP / 2)
        groups.append(_label_marks(label, theme, axis, top, top + 2, bend_y))
    end = tick_bottom + 4
    if below:
        tops_below = _lane_heights(below, lanes_below)
        start = tick_bottom + 16
        for label in below:
            top = start + tops_below[label.lane]
            bend_y = top - (8 if label.lane == 0 else LANE_GAP / 2)
            groups.append(_label_marks(label, theme, axis, top, top + label.height - 2, bend_y))
        end = start + tops_below[-1]
    track_marks, after, tracks, inside = _period_tracks(periods, theme, at, left, right, end + 8, words)
    if tracks:
        end = after - 8
    height = end - box.y
    dots = [nc.Circle(label.x, axis, 5.0, label.event.paint.colour, stroke=theme.paper, stroke_width=2.0)
            for label in [*above, *below]]
    return nc.Plot([*marks, *track_marks, *groups, *tick_words, *dots], height,
                   facts={"lanes": lanes_above + lanes_below, "above": lanes_above, "below": lanes_below,
                          "labels": [(label.lane if label in above else -1 - label.lane, label.box)
                                     for label in [*above, *below]],
                          "days": [label.x for label in [*above, *below]],
                          "bends": sum(1 for label in [*above, *below] if label.bend),
                          "tracks": tracks, "inside": inside, "axis": axis})


def spread(xs: list[float], pitch: float, left: float, right: float) -> list[float]:
    """Each x where its dot is drawn: dots closer than ``pitch`` to the first of their run
    are set side by side, the run centred on where its days fall, inside the line."""
    order = sorted(range(len(xs)), key=lambda index: xs[index])
    placed = list(xs)
    run: list[int] = []

    def lay(members: list[int]) -> None:
        middle = sum(xs[index] for index in members) / len(members)
        width = (len(members) - 1) * pitch
        start = min(max(middle - width / 2, left), right - width)
        for step, index in enumerate(members):
            placed[index] = start + step * pitch

    for index in order:
        if run and xs[index] - xs[run[0]] >= pitch:
            lay(run)
            run = []
        run.append(index)
    if run:
        lay(run)
    return placed


def _tick(x: float, y: float, text: str, theme: "ChartTheme", box: "Box") -> "Text":
    """A tick's day under its mark, held inside the frame: one at an edge starts or ends at its mark."""
    half = nc.text_width(text, theme.tick_size, theme.head) / 2
    anchor = "start" if x - half < box.x else "end" if x + half > box.x + box.width else "middle"
    return nc.Text(x, y, text, theme.tick_size, theme.muted, anchor=anchor)


def _extent(text: "Text", theme: "ChartTheme") -> tuple[float, float]:
    width = nc.text_width(text.text, text.size, theme.head)
    start = text.x if text.anchor == "start" else text.x - width if text.anchor == "end" else text.x - width / 2
    return start, start + width


@dataclass(frozen=True)
class _Way:
    """One way to lay a side: the lanes it takes, its weight (`_ways`), each label's place."""

    lanes: int
    score: float
    places: tuple[tuple[int, float, str], ...]


def _ways(labels: list[_Label], most: int, left: float, right: float, reach: float) -> list[_Way]:
    """Each way the search finds to lay one side in one lane, two, … up to ``most``, weighed
    by its height, its bends and its words turned back from the right."""
    if not labels:
        return [_Way(0, 0.0, ())]
    out: list[_Way] = []
    for lanes in range(1, most + 1):
        if not place_side(labels, lanes, left, right, reach):
            continue
        used = max(label.lane for label in labels) + 1
        if any(way.lanes == used for way in out):
            continue
        bends = sum(1 for label in labels if label.bend)
        backs = sum(1 for label in labels if label.anchor == "end" and label.x + 5 + label.width <= right)
        out.append(_Way(used, _lane_heights(labels, used)[-1] + BEND_COST * bends + BACK_COST * backs,
                        tuple((label.lane, label.pole, label.anchor) for label in labels)))
    return out


def _lane_heights(labels: list[_Label], lanes: int) -> list[float]:
    """Where each lane starts from the line outward, each as tall as its own labels, and the
    whole: ``[0, lane 1's start, …, all]``."""
    out = [0.0]
    for lane in range(lanes):
        tall = max((label.height for label in labels if label.lane == lane), default=0.0)
        out.append(out[-1] + tall + (LANE_GAP if lane + 1 < lanes else 0.0))
    return out


def _label_marks(label: _Label, theme: "ChartTheme", axis: float, top: float, reach_to: float,
                 bend_y: float) -> "Mark":
    """A label's stem (bent where its words stand aside), its day and its words."""
    size, date_size = theme.label_size, theme.label_size - 1
    points: tuple[tuple[float, float], ...]
    if label.bend:
        points = ((label.x, axis), (label.x, bend_y), (label.pole, bend_y), (label.pole, reach_to))
    else:
        points = ((label.x, axis), (label.x, reach_to))
    group: list[Mark] = [nc.Line(points, theme.ink2, 0.9)]
    tx = label.pole + 5 if label.anchor == "start" else label.pole - 5
    line_y = top + date_size
    group.append(nc.Text(tx, line_y, label.when, date_size, theme.ink, bold=True, anchor=label.anchor))
    for line in label.lines:
        line_y += size * 1.25
        group.append(nc.Text(tx, line_y, line, size, theme.ink2, anchor=label.anchor, full=label.full))
    return nc.Group(tuple(group), label.said)


def _period_tracks(periods: list[Event], theme: "ChartTheme", at: Callable[..., float], left: float, right: float,
                   y: float, words: _Words) -> tuple[list["Mark"], float, int, list[str]]:
    """The periods as bands in tracks from ``y`` down, each band's words inside it when they
    fit, else right of it, else left; the marks, where they end, the tracks and the words inside."""
    size = theme.label_size
    band_height = 22.0
    items: list[tuple[Event, float, float, list[str], str, float, float]] = []
    for event in periods:
        assert event.end is not None
        x0, x1 = at(event.start.day, False), at(event.end.day + timedelta(days=1), False)
        when = words.when(event, year=words.years)
        said = words.words(event)
        text = f"{said}, {when}" if said else when
        if nc.text_width(text, size - 0.5, theme.head) + 16 <= x1 - x0:
            items.append((event, x0, x1, [text], "inside", x0, x1))
            continue
        room_right, room_left = right - x1 - 8, x0 - left - 8
        side = "right" if room_right >= min(160.0, room_left) else "left"
        room = max(room_right if side == "right" else room_left, 80.0)
        found = [when, *kinds.lines_of(said, room, size, theme.head)] if said else [when]
        width = max(nc.text_width(line, size, theme.head, bold=number == 0) for number, line in enumerate(found))
        a, b = (x0, x1 + 8 + width) if side == "right" else (x0 - 8 - width, x1)
        items.append((event, x0, x1, found, side, a, b))
    tracks: list[list[tuple[float, float]]] = []
    placed: list[tuple[int, tuple[Event, float, float, list[str], str, float, float]]] = []
    for item in sorted(items, key=lambda one: one[1]):
        a, b = item[5], item[6]
        track = next((index for index, spans in enumerate(tracks)
                      if all(b + 10 <= c or d + 10 <= a for c, d in spans)), len(tracks))
        if track == len(tracks):
            tracks.append([])
        tracks[track].append((a, b))
        placed.append((track, item))
    heights = [band_height] * len(tracks)
    for track, (_, _, _, found, side, _, _) in placed:
        if side != "inside":
            heights[track] = max(heights[track], band_height + (len(found) - 1) * size * 1.25)
    tops = []
    for height in heights:
        tops.append(y)
        y += height + 8
    marks: list[Mark] = []
    for track, (event, x0, x1, found, side, _, _) in placed:
        top = tops[track]
        pieces: list[Mark] = [nc.fill_rect(event.paint, x0, top, max(x1 - x0, 2.0), band_height,
                                           4.0 if theme.radius else 0.0, "all", theme)]
        middle = top + band_height / 2 + (size - 0.5) * 0.36
        full = event.what if words.words(event) != event.what else ""
        if side == "inside":
            pieces.append(nc.Text((x0 + x1) / 2, middle, found[0], size - 0.5, nc.ink_on(event.paint, theme),
                                  anchor="middle", full=full))
        else:
            tx, anchor = (x1 + 8, "start") if side == "right" else (x0 - 8, "end")
            for number, line in enumerate(found):
                pieces.append(nc.Text(tx, middle + number * size * 1.25, line, size if number else size - 0.5,
                                      theme.ink if not number else theme.ink2, bold=not number, anchor=anchor,
                                      full=full if number else ""))
        marks.append(nc.Group(tuple(pieces), event_said(event, words.said)))
    return marks, y, len(tracks), [item[0].what for _, item in placed if item[4] == "inside"]


def time_domain(first: date, last: date, width: float, *, years: bool) -> tuple[date, date, list[tuple[date, str]]]:
    """The days a time axis runs over and its ticks: the data padded a little, then
    widened to a tick on either side when one lies close."""
    span = max(1, (last - first).days)
    pad = max(1, round(span * 0.04))
    d0, d1 = first - timedelta(days=pad), last + timedelta(days=pad)
    ticks = kinds.time_ticks(d0, d1, width, years=years)
    if len(ticks) >= 2:
        step = (ticks[1][0] - ticks[0][0]).days
        before = [tick for tick in kinds.time_ticks(d0 - timedelta(days=step), d1, width, years=years)
                  if tick[0] < ticks[0][0]]
        if before and (ticks[0][0] - before[-1][0]).days and (d0 - before[-1][0]).days <= span * 0.12:
            d0 = before[-1][0]
            ticks = kinds.time_ticks(d0, d1, width, years=years)
    return d0, d1, ticks


# -- numbered -------------------------------------------------------------------------------------------


def _badge(x: float, y: float, radius: float, number: int, paint: "Paint", theme: "ChartTheme") -> list["Mark"]:
    size = radius * (1.1 if number < 10 else 0.98 if number < 100 else 0.82)
    return [nc.Circle(x, y, radius, paint.colour, stroke=theme.paper, stroke_width=1.5),
            nc.Text(x, y + size * 0.36, str(number), size, nc.ink_on(paint, theme), bold=True, anchor="middle")]


def _numbered(events: list[Event], theme: "ChartTheme", box: "Box", words: _Words) -> "Plot":
    """A numbered dot on the line for each event, stacked where days are close, periods as
    bars under the line, and the words in a list under the scale, two columns when wide."""
    first = min(event.start.day for event in events)
    last = max((event.end or event.start).day for event in events)
    radius = BADGE if len(events) < 100 else BADGE + 2
    left, right = box.x + radius + 1, box.x + box.width - radius - 1
    d0, d1, ticks = time_domain(first, last, right - left, years=words.said)
    total = max(1, (d1 - d0).days + 1)

    def at(day: date, middle: bool = True) -> float:
        return left + ((day - d0).days + (0.5 if middle else 0.0)) / total * (right - left)

    # each dot at its day, lifted one step above a dot it would meet
    pitch = 2 * radius + 3
    levels: list[tuple[float, int]] = []
    for event in events:
        x = at(event.start.day)
        level = 0
        while any(abs(x - other) < 2 * radius + 2 and taken == level for other, taken in levels):
            level += 1
        levels.append((x, level))
    highest = max(level for _, level in levels)
    axis = box.y + highest * pitch + radius + 2
    marks: list[Mark] = [nc.Line(((box.x, axis), (box.x + box.width, axis)), theme.axis, 1.0)]
    # periods: a bar each under the line, in tracks
    tracks: list[list[tuple[float, float]]] = []
    bars: list[tuple[int, float, float, Event]] = []
    for event in events:
        if not event.period or event.end is None:
            continue
        x0, x1 = at(event.start.day, False), at(event.end.day + timedelta(days=1), False)
        track = next((index for index, spans in enumerate(tracks) if all(x1 + 4 <= c or d + 4 <= x0 for c, d in spans)),
                     len(tracks))
        if track == len(tracks):
            tracks.append([])
        tracks[track].append((x0, x1))
        bars.append((track, x0, x1, event))
    bar_top = axis + radius + 3
    for track, x0, x1, event in bars:
        marks.append(nc.fill_rect(event.paint, x0, bar_top + track * 9, max(x1 - x0, 2.0), 6.0,
                                  3.0 if theme.radius else 0.0, "all", theme))
    tick_top = bar_top + len(tracks) * 9 if tracks else axis
    tick_y = tick_top + 9 + theme.tick_size + (2 if tracks else 0)
    for day, text in ticks:
        x = at(day, False)
        marks.append(nc.Line(((x, axis), (x, axis + 5)), theme.axis, 1.0))
        marks.append(_tick(x, tick_y, text, theme, box))
    # the list, column by column, the days in a column of their own
    size = theme.label_size
    line_height = size * 1.3
    columns = 2 if box.width >= TWO_COLUMNS and len(events) >= 4 else 1
    gap = 28.0
    column_width = (box.width - gap * (columns - 1)) / columns
    whens = [words.when(event, year=words.years) for event in events]
    date_width = max(nc.text_width(when, size, theme.head, bold=True) for when in whens)
    words_x = 2 * LIST_BADGE + 8 + date_width + 10
    stacked = column_width - words_x < 140
    room = column_width - (2 * LIST_BADGE + 8 if stacked else words_x)
    items: list[tuple[list[str], float]] = []
    for event in events:
        said = words.words(event)
        found = kinds.lines_of(said, room, size, theme.body) if said else []
        lines = len(found) + (1 if stacked else 0)
        items.append((found, max(2 * LIST_BADGE, max(lines, 1) * line_height)))
    split = _balanced([height for _, height in items], columns)
    top = tick_y + 16
    groups: list[Mark] = []
    cursors = [top] * columns
    for number, (event, when, (found, height)) in enumerate(zip(events, whens, items)):
        column = 0 if number < split else 1
        column_x = box.x + column * (column_width + gap)
        y = cursors[column]
        x, level = levels[number]
        group: list[Mark] = []
        if level:
            group.append(nc.Line(((x, axis), (x, axis - level * pitch + radius)), theme.muted, 0.9))
        group.extend(_badge(x, axis - level * pitch, radius, number + 1, event.paint, theme))
        group.extend(_badge(column_x + LIST_BADGE, y + size * 0.65, LIST_BADGE, number + 1, event.paint, theme))
        date_x = column_x + 2 * LIST_BADGE + 8
        group.append(nc.Text(date_x, y + size, when, size, theme.ink, bold=True))
        full = event.what if words.words(event) != event.what else ""
        text_x = date_x if stacked else column_x + words_x
        first_line = y + size + (line_height if stacked else 0)
        for index, line in enumerate(found):
            group.append(nc.Text(text_x, first_line + index * line_height, line, size, theme.ink2, body=True,
                                 full=full))
        groups.append(nc.Group(tuple(group), event_said(event, words.said)))
        cursors[column] = y + height + 8
    end = max(cursors) - 8
    return nc.Plot([*marks, *groups], end - box.y,
                   facts={"columns": columns, "levels": [level for _, level in levels], "axis": axis,
                          "tracks": len(tracks)})


def _balanced(heights: list[float], columns: int) -> int:
    """Where a list breaks into its second column so the two stand most nearly even; past
    the end in one column."""
    if columns < 2 or len(heights) < 2:
        return len(heights)
    best, where = float("inf"), len(heights)
    for split in range(1, len(heights)):
        tall = max(sum(heights[:split]), sum(heights[split:]))
        if tall < best - 0.5 or (abs(tall - best) <= 0.5 and split > where):
            best, where = tall, split
    return where


# -- list -----------------------------------------------------------------------------------------------


def _listed(events: list[Event], theme: "ChartTheme", box: "Box", words: _Words) -> "Plot":
    """One row an event down the page: its day in a gutter, a rule, a dot for a point or a
    bar for a period, its words beside. The year is said on the first day and where it changes."""
    size = theme.label_size
    whens: list[str] = []
    year: int | None = None
    for event in events:
        changed = event.start.day.year != year
        year = event.start.day.year
        whens.append(words.when(event, year=words.said and changed))
    date_width = min(max(nc.text_width(when, size, theme.head, bold=True) for when in whens), box.width * 0.34)
    rule_x = box.x + date_width + 16
    text_x = rule_x + 16
    room = box.x + box.width - text_x
    marks: list[Mark] = []
    y = box.y
    rows: list[tuple[float, float]] = []
    for event, when in zip(events, whens):
        date_lines = kinds.lines_of(when, date_width, size, theme.head, bold=True)
        said = words.words(event)
        found = kinds.lines_of(said, room, size, theme.body) if said else [""]
        full = event.what if said != event.what else ""
        height = max(len(date_lines), len(found)) * size * 1.3
        group: list[Mark] = []
        for number, line in enumerate(date_lines):
            group.append(nc.Text(rule_x - 16, y + size + number * size * 1.3, line, size, theme.ink, bold=True,
                                 anchor="end"))
        for number, line in enumerate(found):
            group.append(nc.Text(text_x, y + size + number * size * 1.3, line, size, theme.ink2, body=True,
                                 full=full))
        if event.period:
            group.append(nc.fill_rect(event.paint, rule_x - 3.5, y + 2, 7.0, max(height - 2, 8.0),
                                      3.5 if theme.radius else 0.0, "all", theme))
        else:
            group.append(nc.Circle(rule_x, y + size * 0.62, 5.0, event.paint.colour, stroke=theme.paper,
                                   stroke_width=2.0))
        rows.append((y, height))
        marks.append(nc.Group(tuple(group), event_said(event, words.said)))
        y += height + 10
    end = y - 10
    marks.insert(0, nc.Line(((rule_x, box.y + size * 0.62), (rule_x, rows[-1][0] + size * 0.62)), theme.axis, 1.0))
    return nc.Plot(marks, end - box.y, facts={"down": True, "rows": rows})


# -- the picker and the check ---------------------------------------------------------------------------


def fits_timeline(table: "Table") -> bool:
    rows = table.rows
    days = kinds.day_columns(table.headers, rows)
    if not days:
        return False
    return any(index not in days and not nc._numeric(rows, index) and any(row[index] for row in rows)
               for index in range(len(table.headers)))


def check_timeline(reading: "Reading") -> list["Check"]:
    out: list[Check] = []
    start, _, _ = timeline_columns(reading)
    if start is None:
        out.append(kinds._check(reading, "has no column of days: write them as 5 Oct 2026 or 2026-10-05.", None,
                                "missing"))
    written = (reading.block.extra.get("layout") or "").strip()
    if written and written.casefold() not in LAYOUTS:
        out.append(kinds._check(reading, f'is laid out auto, across, numbered or list, not "{nc._cut(written, 20)}".',
                                "layout"))
    labels = (reading.block.extra.get("labels") or "").strip()
    if labels and labels.casefold() not in LABELS:
        out.append(kinds._check(reading, f'labels its events full or short, not "{nc._cut(labels, 20)}".', "labels"))
    return out


from . import notes_chart_kinds as kinds  # noqa: E402  (its days and words; imported last, as the kinds are)
from . import notes_charts as nc  # noqa: E402  (the timeline draws with its marks; it registers it at its foot)
