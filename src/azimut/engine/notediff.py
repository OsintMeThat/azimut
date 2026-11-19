"""What changed between two public texts of a note, said the way a reader would say it.

The Editions dialog compares two texts a note kept (`engine/noteeditions.py`), or one of
them and the note as it would print now. `compare` reads each as blocks (headings,
paragraphs, list items, tables, pictures, charts, maps, infographics and diagrams) and
answers in two parts:

- **sentences**, what changed in each figure, in plain words: *The chart “At least 41
  armoured…” now counts 42, not 41.*, *“Figure 1” shows another picture: “b.jpg” in
  place of “a.jpg”.*, *In the table under “What it cost”, the row “Streit Cougar” now
  reads 9 under “Count”, not 8.* A figure is never shown as a raw text diff. Each names
  its ``figure``, its first sentence the one a correction line takes, in its ``short``
  words when the dialog's are too detailed for a reader;
- **paragraphs**, the words that changed, paragraph by paragraph, each under the heading
  it sits under: a few words kept either side as context, the rest of a long paragraph
  folded to “…”.

A paragraph is paired with the one it became when most of its words are still there;
otherwise it was taken out and another written. Both texts are what was printed, so the
comparison is of public texts only, and nothing here is ever put in a file: it reaches a
page only through the What changed line the analyst writes from it.

Bounded: at most `MAX_PARAGRAPHS` paragraphs and `MAX_SENTENCES` sentences are listed,
the rest counted. Nothing is fetched or written.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Callable, Sequence

from . import notes_charts as nc
from .notetext import MEDIA_REF, plain_line

#: How many changed paragraphs and figure sentences one comparison lists.
MAX_PARAGRAPHS = 200
MAX_SENTENCES = 120
#: Words kept on either side of a change, the rest of a long run folded to "…".
CONTEXT = 8
#: How much of a paragraph added or taken out is shown, in characters.
MAX_SHOWN = 600
#: How similar two paragraphs must be, by their words, to be one paragraph reworded.
SIMILAR = 0.5
#: Pairs of paragraphs weighed in one stretch of change at most; past it, none is paired.
MAX_PAIRING = 4000
#: How many changed rows one table or chart names before it counts the rest.
MAX_ROWS_SAID = 4
#: How long a title, a label or a value is in a sentence.
NAME_CHARS = 32
VALUE_CHARS = 40

FENCE = re.compile(r"^\s*(`{3,}|~{3,})\s*([\w-]*)")
OPEN = re.compile(r"^(:{3,})[ \t]*([A-Za-z][\w -]*?)[ \t]*$")
CLOSE = re.compile(r"^:{3,}[ \t]*$")
HEADING = re.compile(r"^\s{0,3}#{1,6}\s+\S")
BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
SETTING = re.compile(r"^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*?)\s*$")
IMAGE = re.compile(r'^!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)(?:\{([^}\n]*)\})?$')
ATTR = re.compile(r'([A-Za-z][\w-]*)=(?:"([^"]*)"|(\S+))')
LINK = re.compile(r"(?<!!)\[([^\]]+)\]\(\s*<?([^)\s>]+)>?[^)]*\)")

#: Blocks compared word by word; every other kind is a figure, said in a sentence.
WORDS = ("heading", "text", "code")
#: A map's and an infographic's settings that list several values, one a line.
MANY = {"layer", "layers", "hide", "colour", "step", "card", "proofs", "widths"}
#: What a chart's settings are called in a sentence.
CHART_SETTINGS = {
    "count": "what it counts", "by": "its bars", "colour_by": "what colours it", "order": "its order",
    "colours": "its colours", "only": "what it leaves out", "highlight": "what it highlights",
    "sort": "its sort", "last": "what it keeps last", "show": "whether it shows its table",
    "caption": "its caption", "source": "its source line", "style": "its look", "bars": "its direction",
    "extra": "its settings", "origin": "where its rows come from",
}

Names = Callable[[str], str]
#: How a figure's sentence is said: its kind, the sentence, where it stands, and
#: ``short``, the words the correction line takes, ``gone`` for a figure taken out.
Say = Callable[..., None]


@dataclass
class Block:
    """One block of a text: its kind, as written, and the heading it sits under."""

    kind: str
    raw: str
    under: str
    order: int


@dataclass
class Comparison:
    sentences: list[dict[str, Any]] = field(default_factory=list)
    paragraphs: list[dict[str, Any]] = field(default_factory=list)
    unchanged: int = 0
    #: Paragraphs and sentences past the caps, counted rather than listed.
    more: int = 0
    same: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {"same": self.same, "sentences": self.sentences, "paragraphs": self.paragraphs,
                "unchanged": self.unchanged, "more": self.more}


# -- reading a text as blocks -----------------------------------------------------------


def blocks(text: str) -> list[Block]:
    """A text's blocks in reading order. A chart's or a map's block is one block; an
    infographic is its own settings, then its panels as blocks of their own; any other
    container (centred text, columns) is read as the lines it holds."""
    lines = str(text or "").replace("\r\n", "\n").split("\n")
    out: list[Block] = []
    para: list[str] = []
    under = ""

    def add(kind: str, raw: str) -> None:
        out.append(Block(kind, raw, under, len(out)))

    def flush() -> None:
        if para:
            raw = "\n".join(para).strip()
            if raw:
                add("picture" if _picture(raw) is not None else "text", raw)
            para.clear()

    index = 0
    while index < len(lines):
        line = lines[index]
        fence = FENCE.match(line)
        if fence:
            flush()
            mark = fence.group(1)
            end = index + 1
            while end < len(lines) and not lines[end].strip().startswith(mark):
                end += 1
            add("diagram" if fence.group(2).casefold() == "mermaid" else "code", "\n".join(lines[index:end + 1]))
            index = end + 1
            continue
        opened = OPEN.match(line)
        if opened:
            flush()
            name = opened.group(2).strip().casefold()
            if name in ("chart", "map"):
                end = index + 1
                while end < len(lines) and not CLOSE.match(lines[end]):
                    end += 1
                add(name, "\n".join(lines[index + 1:end]))
                index = end + 1
                continue
            if name == "infographic":
                end = index + 1
                while end < len(lines) and lines[end].strip() and not OPEN.match(lines[end]) and not CLOSE.match(lines[end]):
                    end += 1
                add("infographic", "\n".join(lines[index + 1:end]))
                index = end
                continue
            index += 1
            continue
        if CLOSE.match(line) or not line.strip():
            flush()
            index += 1
            continue
        if HEADING.match(line):
            flush()
            add("heading", line.strip())
            under = plain_line(line)
            index += 1
            continue
        if line.lstrip().startswith("|"):
            flush()
            end = index
            while end < len(lines) and lines[end].lstrip().startswith("|"):
                end += 1
            add("table", "\n".join(lines[index:end]))
            index = end
            continue
        if BULLET.match(line):
            flush()  # each item of a list is a paragraph of its own
        para.append(line)
        index += 1
    flush()
    return out


def _plain(block: Block) -> str:
    if block.kind == "code":
        return " ".join(block.raw.split())
    return " ".join(said for said in (plain_line(line) for line in block.raw.split("\n")) if said)


# -- words, paragraph by paragraph ----------------------------------------------------------


def _parts(old: str, new: str) -> list[list[str]]:
    """Two paragraphs' words as runs kept (``=``), taken out (``-``) and added (``+``),
    a long run kept folded to its first and last `CONTEXT` words."""
    a, b = old.split(), new.split()
    runs: list[tuple[str, list[str]]] = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            runs.append(("=", a[i1:i2]))
            continue
        if i2 > i1:
            runs.append(("-", a[i1:i2]))
        if j2 > j1:
            runs.append(("+", b[j1:j2]))
    out: list[list[str]] = []
    for index, (op, words) in enumerate(runs):
        if op == "=":
            first, last = index == 0, index == len(runs) - 1
            if first and last:
                pass
            elif first and len(words) > CONTEXT:
                words = ["…", *words[-CONTEXT:]]
            elif last and len(words) > CONTEXT:
                words = [*words[:CONTEXT], "…"]
            elif not first and not last and len(words) > 2 * CONTEXT + 1:
                words = [*words[:CONTEXT], "…", *words[-CONTEXT:]]
        out.append([op, " ".join(words)])
    return out


def _shown(text: str) -> str:
    return text if len(text) <= MAX_SHOWN else text[: MAX_SHOWN - 1].rstrip() + "…"


def _similar(old: str, new: str) -> float:
    matcher = SequenceMatcher(None, old.split(), new.split(), autojunk=False)
    if matcher.real_quick_ratio() < SIMILAR or matcher.quick_ratio() < SIMILAR:
        return 0.0
    return matcher.ratio()


def _pairs(olds: Sequence[str], news: Sequence[str]) -> list[tuple[int, int]]:
    """Which paragraph of a stretch of change became which, in order: each old one the
    most similar new one after the last paired, when it is similar enough."""
    if len(olds) * len(news) > MAX_PAIRING:
        return []
    out: list[tuple[int, int]] = []
    start = 0
    for i, old in enumerate(olds):
        best, at = 0.0, -1
        for j in range(start, len(news)):
            score = _similar(old, news[j])
            if score > best:
                best, at = score, j
        if at >= 0 and best >= SIMILAR:
            out.append((i, at))
            start = at + 1
    return out


def _links(raw: str) -> dict[str, str]:
    return {" ".join(label.split()): target for label, target in LINK.findall(raw)}


class _Words:
    """The paragraphs that changed, each with where it stands in the newer text, and what
    a paragraph's links say."""

    def __init__(self, result: Comparison, say: Say):
        self.result = result
        self.say = say
        self.listed: list[tuple[int, int, dict[str, Any]]] = []

    def entry(self, state: str, block: Block, parts: list[list[str]], *, at: int | None = None,
              what: str = "") -> None:
        if len(self.listed) >= MAX_PARAGRAPHS:
            self.result.more += 1
            return
        entry: dict[str, Any] = {"state": state, "under": block.under, "heading": block.kind == "heading",
                                 "parts": parts}
        if what:
            entry["what"] = what
        self.listed.append((block.order if at is None else at, len(self.listed), entry))

    def done(self) -> None:
        self.result.paragraphs = [entry for _, _, entry in sorted(self.listed, key=lambda item: (item[0], item[1]))]

    def links(self, old: Block, new: Block) -> None:
        before, after = _links(old.raw), _links(new.raw)
        for label, target in after.items():
            if label in before and before[label] != target:
                self.say("link", f"{_in(new.under)}the link {_name(label)} now leads to another address.", new.order,
                         short=f"The link {_name(label)} now leads to another address.")

    def compare(self, old: list[Block], new: list[Block]) -> None:
        a, b = [_plain(block) for block in old], [_plain(block) for block in new]
        for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
            if tag == "equal":
                self.result.unchanged += i2 - i1
                for i, j in zip(range(i1, i2), range(j1, j2)):
                    if old[i].raw != new[j].raw:
                        self.links(old[i], new[j])
                continue
            paired = _pairs(a[i1:i2], b[j1:j2])
            i, j = i1, j1
            for pi, pj in [*((i1 + x, j1 + y) for x, y in paired), (i2, j2)]:
                # what was taken out stands where the newer text goes on, before what was added
                here = new[j].order if j < len(new) else (new[-1].order + 1 if new else 0)
                for gone in range(i, pi):
                    self.entry("removed", old[gone], [["-", _shown(a[gone])]], at=here)
                for made in range(j, pj):
                    self.entry("added", new[made], [["+", _shown(b[made])]])
                if pi < i2 and pj < j2:
                    self.entry("changed", new[pj], _parts(a[pi], b[pj]))
                    self.links(old[pi], new[pj])
                i, j = pi + 1, pj + 1


# -- figures ----------------------------------------------------------------------------


def _cut(value: str, limit: int) -> str:
    """A value cut to ``limit`` characters at a word's end, "…" after it."""
    value = " ".join(str(value or "").split())
    if len(value) <= limit:
        return value
    head = value[: limit - 1]
    if " " in head[limit // 2:]:
        head = head.rsplit(" ", 1)[0]
    return head.rstrip(" ,;:.–-") + "…"


def _name(value: str) -> str:
    return f"“{_cut(value, NAME_CHARS)}”"


def _value(value: str) -> str:
    return _cut(plain_line(value), VALUE_CHARS) or "nothing"


def _in(under: str) -> str:
    return f"In “{_cut(under, NAME_CHARS)}”, " if under else ""


def _listed(parts: Sequence[str]) -> str:
    parts = list(parts)
    if len(parts) <= 2:
        return " and ".join(parts)
    return f"{', '.join(parts[:-1])} and {parts[-1]}"


def _match(olds: list[Any], news: list[Any], *keys: Callable[[Any], Any]) -> tuple[list[tuple[Any, Any]], list[Any], list[Any]]:
    """Pair figures across two texts: by each key in turn, in order of appearance; what is
    left over was taken out or added."""
    pairs: list[tuple[Any, Any]] = []
    left_old, left_new = list(olds), list(news)
    for key in keys:
        for old in list(left_old):
            wanted = key(old)
            if wanted in (None, ""):
                continue
            for new in left_new:
                if key(new) == wanted:
                    pairs.append((old, new))
                    left_old.remove(old)
                    left_new.remove(new)
                    break
    return pairs, left_old, left_new


# a table's rows -------------------------------------------------------------------------


def _table(raw: str) -> tuple[list[str], list[list[str]]]:
    """A GFM table's headers and rows as a reader sees them."""
    rows = [[plain_line(cell) or cell.strip() for cell in nc.split_row(line)] for line in raw.split("\n") if line.strip()]
    rows = [row for row in rows if not all(re.fullmatch(r":?-{2,}:?", cell.replace(" ", "")) for cell in row if cell)]
    if not rows:
        return [], []
    return rows[0], rows[1:]


def _row_keys(headers: list[str], rows: list[list[str]], other: list[list[str]]) -> int:
    """How many first columns name a row once in both tables; two at least when the first
    only numbers the rows, so a row is said by what it is (“12 · Al-Wahsh”)."""
    numbered = len(headers) > 1 and all(re.fullmatch(r"#?\d{1,6}", row[0].strip()) for row in [*rows, *other] if row)
    for width in range(2 if numbered else 1, max(1, len(headers)) + 1):
        if all(len({tuple(row[:width]) for row in table}) == len(table) for table in (rows, other)):
            return width
    return max(1, len(headers))


def _rows(old_raw: str, new_raw: str, *, single: str = "") -> list[str]:
    """What changed in a table's rows, each a phrase: a cell that reads otherwise, a row
    added or taken out, a column added or taken out. ``single`` is the column a chart
    counts, said without its name."""
    old_head, old_rows = _table(old_raw)
    new_head, new_rows = _table(new_raw)
    phrases: list[str] = []
    for column in new_head:
        if column and column not in old_head:
            phrases.append(f"gains the column {_name(column)}")
    for column in old_head:
        if column and column not in new_head:
            phrases.append(f"loses the column {_name(column)}")
    width = _row_keys(new_head, new_rows, old_rows)

    def key(row: list[str]) -> str:
        return " · ".join(cell for cell in row[:width] if cell)

    before = {key(row): row for row in old_rows}
    after = {key(row): row for row in new_rows}
    common = [column for column in new_head if column in old_head]
    # a row whose naming cells were rewritten in place is that row, not one lost and one gained
    lost = {index: name for index, name in enumerate(before) if name not in after}
    renamed = {name: lost[index] for index, name in enumerate(after) if name not in before and index in lost}
    for name, row in after.items():
        if name in renamed:
            phrases.append(f"the row {_name(renamed[name])} now reads {_name(name)}")
            continue
        if name not in before:
            phrases.append(f"gains the row {_name(name)}")
            continue
        was = before[name]
        moved = []
        for column in common:
            o, n = old_head.index(column), new_head.index(column)
            old_cell = was[o] if o < len(was) else ""
            new_cell = row[n] if n < len(row) else ""
            if old_cell != new_cell:
                moved.append((column, old_cell, new_cell))
        if len(moved) == 1:
            column, old_cell, new_cell = moved[0]
            where = "" if column == single else f" under {_name(column)}"
            phrases.append(f"the row {_name(name)} now reads {_value(new_cell)}{where}, not {_value(old_cell)}")
        elif moved:
            phrases.append(f"the row {_name(name)} changed under {_listed([_name(column) for column, _, _ in moved])}")
    for name in before:
        if name not in after and name not in renamed.values():
            phrases.append(f"loses the row {_name(name)}")
    return phrases


def _rows_said(phrases: list[str], subject: str) -> list[str]:
    """A table's or a chart's changed rows as sentences, at most `MAX_ROWS_SAID` named:
    ``subject`` is what holds them, "the chart “…”" or "the table under “…”"."""
    out = []
    for phrase in phrases[:MAX_ROWS_SAID]:
        out.append(f"In {subject}, {phrase}." if phrase.startswith("the row") else f"{subject} {phrase}.")
    if len(phrases) > MAX_ROWS_SAID:
        out.append(f"In {subject}, {len(phrases) - MAX_ROWS_SAID} more rows changed.")
    return out


# charts ---------------------------------------------------------------------------------


def _chart_settings(block: nc.ChartBlock) -> dict[str, Any]:
    return {
        "count": block.count, "by": block.by, "colour_by": block.colour_by, "order": block.order,
        "colours": block.colours, "only": [only.text() for only in block.only], "highlight": block.highlight,
        "sort": block.sort, "last": block.last, "show": block.show, "caption": block.caption,
        "source": block.source, "style": block.style, "bars": block.bars, "extra": block.extra,
        "origin": block.origin,
    }


def _total(block: nc.ChartBlock) -> tuple[float, bool] | None:
    """What a chart counts, and whether it is a floor; None for a kind that counts nothing."""
    try:
        reading = nc.read(block)
    except Exception:  # a block the chart itself cannot read says so in its own check
        return None
    if not reading.categories:
        return None
    return reading.total, reading.floor


def _chart(old_block: Block, new_block: Block, say: Say) -> None:
    old, new = nc.parse_block(old_block.raw), nc.parse_block(new_block.raw)
    at = new_block.order
    kind = nc.effective_kind(new)
    # a chart with no title is named by its kind and where it stands
    plain = f"the {kind.name if kind is not None else 'untitled'} chart" + (
        f" under “{_cut(new_block.under, NAME_CHARS)}”" if new_block.under else "")
    subject = f"the chart {_name(new.title)}" if new.title else plain
    said = subject[:1].upper() + subject[1:]
    if old.title != new.title:
        if old.title and new.title:
            say("chart", f"The chart {_name(old.title)} is now titled {_name(new.title)}.", at)
        elif new.title:
            say("chart", f"A chart now has the title {_name(new.title)}.", at)
        else:
            say("chart", f"The chart {_name(old.title)} lost its title.", at)
    old_kind, new_kind = nc.effective_kind(old), nc.effective_kind(new)
    if old_kind is not None and new_kind is not None and old_kind.name != new_kind.name:
        say("chart", f"{said} is now drawn as {new_kind.name}, not {old_kind.name}.", at)
    before, after = _total(old), _total(new)
    if before is not None and after is not None and before[0] != after[0]:
        floor = "at least " if after[1] else ""
        say("chart", f"{said} now counts {floor}{nc.number_text(after[0])}, not {nc.number_text(before[0])}.", at)
    if old.table is not None or new.table is not None:
        single = ""
        if new.table is not None and new.count and new.count != "rows":
            single = next((header for header in new.table.headers if header.casefold() == new.count.casefold()), "")
        phrases = _rows(old.table.text() if old.table else "", new.table.text() if new.table else "", single=single)
        for sentence in _rows_said(phrases, subject):
            say("chart", sentence, at)
    moved = [CHART_SETTINGS[key] for key, value in _chart_settings(new).items() if _chart_settings(old)[key] != value]
    if moved:
        say("chart", f"{said} changed {_listed(list(dict.fromkeys(moved)))}.", at)


# pictures -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Picture:
    label: str
    source: str
    caption: str
    layout: tuple[tuple[str, str], ...]


def _picture(raw: str) -> Picture | None:
    """A paragraph that is only a picture, read: its label, what it shows, its caption."""
    text = raw.strip()
    found = MEDIA_REF.fullmatch(text)
    if found:
        label, source, attrs = found.group(2), f"media:{found.group(1)}", found.group(3) or ""
    else:
        image = IMAGE.match(text)
        if image is None:
            return None
        source, attrs = image.group(2), image.group(3) or ""
        label = image.group(1) or source.rsplit("/", 1)[-1]
    values = {found.group(1): found.group(2) if found.group(2) is not None else found.group(3)
              for found in ATTR.finditer(attrs)}
    caption = values.pop("caption", "")
    return Picture(" ".join(label.split()), source, caption, tuple(sorted(values.items())))


def _shows(source: str, names: Names) -> str:
    if source.startswith("media:"):
        return names(source[6:]) or ""
    return source.rsplit("/", 1)[-1]


def _pictures(old: list[Block], new: list[Block], say: Say, words: _Words,
              names: Names) -> None:
    olds = [(block, picture) for block in old if (picture := _picture(block.raw)) is not None]
    news = [(block, picture) for block in new if (picture := _picture(block.raw)) is not None]
    pairs, gone, added = _match(
        olds, news,
        lambda item: (item[1].label.casefold(), item[1].source),
        lambda item: item[1].label.casefold(),
        lambda item: item[1].source,
    )
    renamed = []
    for (old_block, was), (new_block, now) in pairs:
        at = new_block.order
        name = _name(now.label)
        if was.label != now.label:
            renamed.append((was.label, now.label, at))
        if was.source != now.source:
            before, after = _shows(was.source, names), _shows(now.source, names)
            detail = f": {_name(after)} in place of {_name(before)}" if before and after and before != after else ""
            say("picture", f"{name} shows another picture{detail}.", at, short=f"{name} shows another picture.")
        if was.caption != now.caption:
            say("picture", f"The caption of {name} was rewritten." if was.caption and now.caption
                else f"{name} {'has a caption now' if now.caption else 'lost its caption'}.", at)
            words.entry("changed", new_block, _parts(plain_line(was.caption), plain_line(now.caption)),
                        what=f"The caption of {name}")
        if was.layout != now.layout:
            say("picture", f"{name} is laid out differently.", at)
    if len(renamed) > 2:
        say("picture", f"{len(renamed)} pictures took new names, {_name(renamed[0][0])} now {_name(renamed[0][1])} first.",
            renamed[0][2])
    else:
        for was_label, now_label, at in renamed:
            say("picture", f"{_name(was_label)} is now called {_name(now_label)}.", at)
    for block, picture in added:
        say("picture", f"{_in(block.under)}a picture was added: {_name(picture.label)}.", block.order)
    for block, picture in gone:
        say("picture", f"{_name(picture.label)} was taken out.", block.order, gone=True)


# maps, infographics, tables, diagrams ----------------------------------------------------------


def _settings(raw: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for line in raw.split("\n"):
        found = SETTING.match(line)
        if found and not line.lstrip().startswith("|"):
            out.setdefault(found.group(1).casefold(), []).append(found.group(2))
    return out


def _title_of(raw: str, *keys: str) -> str:
    settings = _settings(raw)
    for key in keys:
        if settings.get(key):
            return settings[key][0]
    return ""


def _setting_phrases(old: dict[str, list[str]], new: dict[str, list[str]]) -> list[str]:
    phrases = []
    for key in dict.fromkeys([*new, *old]):
        before, after = old.get(key, []), new.get(key, [])
        if before == after:
            continue
        if key in MANY:
            for value in after:
                if value not in before:
                    phrases.append(f"{key} {_name(_value(value))} added")
            for value in before:
                if value not in after:
                    phrases.append(f"{key} {_name(_value(value))} taken out")
            if not any(value not in before for value in after) and not any(value not in after for value in before):
                phrases.append(f"its {key} in another order")
        elif not before:
            phrases.append(f"{key} set to {_name(_value(after[0]))}")
        elif not after:
            phrases.append(f"{key} left out")
        else:
            phrases.append(f"{key} now {_name(_value(after[0]))}, not {_name(_value(before[0]))}")
    return phrases


def _said_settings(lead: str, phrases: list[str]) -> str:
    shown = phrases[:4]
    more = f" and {len(phrases) - 4} more" if len(phrases) > 4 else ""
    return f"{lead} changed: {'; '.join(shown)}{more}."


def _maps(old: list[Block], new: list[Block], say: Say) -> None:
    def title(block: Block) -> str:
        return _title_of(block.raw, "title", "layer", "plate").casefold()

    pairs, gone, added = _match([b for b in old if b.kind == "map"], [b for b in new if b.kind == "map"],
                                title, lambda block: block.raw)
    leftover = list(zip(gone, added))
    pairs += leftover
    gone, added = gone[len(leftover):], added[len(leftover):]
    for was, now in pairs:
        phrases = _setting_phrases(_settings(was.raw), _settings(now.raw))
        if phrases:
            named = _title_of(now.raw, "title", "layer", "plate")
            lead = f"The map {_name(named)}" if named else f"The map under “{_cut(now.under, NAME_CHARS)}”"
            say("map", _said_settings(lead, phrases), now.order)
    for block in added:
        named = _title_of(block.raw, "title", "layer", "plate")
        say("map", f"{_in(block.under)}a map was added{': ' + _name(named) if named else ''}.", block.order)
    for block in gone:
        named = _title_of(block.raw, "title", "layer", "plate")
        say("map", f"The map {_name(named) if named else 'under ' + _name(block.under)} was taken out.", block.order,
            gone=True)


def _infographics(old: list[Block], new: list[Block], say: Say) -> None:
    def title(block: Block) -> str:
        return _title_of(block.raw, "title", "kicker").casefold()

    pairs, gone, added = _match([b for b in old if b.kind == "infographic"], [b for b in new if b.kind == "infographic"],
                                title, lambda block: block.raw)
    leftover = list(zip(gone, added))
    pairs += leftover
    gone, added = gone[len(leftover):], added[len(leftover):]
    for was, now in pairs:
        phrases = _setting_phrases(_settings(was.raw), _settings(now.raw))
        if phrases:
            named = _title_of(now.raw, "title", "kicker") or _title_of(was.raw, "title", "kicker")
            say("infographic", _said_settings(f"The infographic {_name(named)}" if named else "An infographic",
                                              phrases), now.order)
    for block in added:
        named = _title_of(block.raw, "title", "kicker")
        say("infographic", f"An infographic was added{': ' + _name(named) if named else ''}.", block.order)
    for block in gone:
        named = _title_of(block.raw, "title", "kicker")
        say("infographic", f"The infographic {_name(named) if named else 'with no title'} was taken out.", block.order,
            gone=True)


def _tables(old: list[Block], new: list[Block], say: Say) -> None:
    def head(block: Block) -> tuple[str, ...]:
        return tuple(_table(block.raw)[0])

    pairs, gone, added = _match([b for b in old if b.kind == "table"], [b for b in new if b.kind == "table"],
                                lambda block: (head(block), block.under), head, lambda block: block.under)
    for was, now in pairs:
        if was.raw == now.raw:
            continue
        where = f"the table under “{_cut(now.under, NAME_CHARS)}”" if now.under else "the first table"
        for sentence in _rows_said(_rows(was.raw, now.raw), where):
            say("table", sentence, now.order)
    for block in added:
        say("table", f"{_in(block.under)}a table was added.", block.order)
    for block in gone:
        say("table", f"The table under “{_cut(block.under, NAME_CHARS)}” was taken out." if block.under
            else "A table was taken out.", block.order, gone=True)


def _diagrams(old: list[Block], new: list[Block], say: Say) -> None:
    olds = [b for b in old if b.kind == "diagram"]
    news = [b for b in new if b.kind == "diagram"]
    pairs, gone, added = _match(olds, news, lambda block: block.raw)
    leftover = list(zip(gone, added))
    gone, added = gone[len(leftover):], added[len(leftover):]
    for _, now in leftover:
        say("diagram", f"{_in(now.under)}a diagram was redrawn.", now.order)
    for block in added:
        say("diagram", f"{_in(block.under)}a diagram was added.", block.order)
    for block in gone:
        say("diagram", f"{_in(block.under)}a diagram was taken out.", block.order, gone=True)


# -- the comparison ---------------------------------------------------------------------


def compare(old_text: str, new_text: str, *, names: Names | None = None) -> Comparison:
    """What changed from ``old_text`` to ``new_text``: figure by figure in sentences, and
    paragraph by paragraph in words. ``names`` says what a media entity is called, to
    name the picture that replaced another; nothing is read without it."""
    result = Comparison(same=old_text == new_text)
    if result.same:
        return result
    names = names or (lambda _: "")
    old, new = blocks(old_text), blocks(new_text)
    said: list[tuple[int, int, dict[str, Any]]] = []

    def say(kind: str, sentence: str, at: int, *, short: str = "", gone: bool = False) -> None:
        # one figure's sentences share where it stands, so the correction line can take its first
        entry = {"kind": kind, "said": sentence[:1].upper() + sentence[1:],
                 "figure": f"{kind}:{at}{':gone' if gone else ''}"}
        if short:
            entry["short"] = short[:1].upper() + short[1:]
        said.append((at, len(said), entry))

    words = _Words(result, say)
    words.compare([b for b in old if b.kind in WORDS], [b for b in new if b.kind in WORDS])
    charts, gone, added = _match(
        [b for b in old if b.kind == "chart"], [b for b in new if b.kind == "chart"],
        lambda block: nc.parse_block(block.raw).title.casefold(), lambda block: block.raw,
    )
    leftover = list(zip(gone, added))
    for was, now in [*charts, *leftover]:
        if was.raw != now.raw:
            _chart(was, now, say)
    for block in added[len(leftover):]:
        title = nc.parse_block(block.raw).title
        say("chart", f"{_in(block.under)}a chart was added{': ' + _name(title) if title else ''}.", block.order)
    for block in gone[len(leftover):]:
        title = nc.parse_block(block.raw).title
        say("chart", f"The chart {_name(title)} was taken out." if title else f"{_in(block.under)}a chart was taken out.",
            block.order, gone=True)
    _tables(old, new, say)
    _pictures(old, new, say, words, names)
    _maps(old, new, say)
    _infographics(old, new, say)
    _diagrams(old, new, say)
    words.done()
    ordered = [sentence for _, _, sentence in sorted(said, key=lambda item: (item[0], item[1]))]
    result.sentences = ordered[:MAX_SENTENCES]
    result.more += max(0, len(ordered) - MAX_SENTENCES)
    return result
