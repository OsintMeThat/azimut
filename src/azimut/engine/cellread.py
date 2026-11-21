"""The one reader of a table cell: the day or the number it holds, in any language.

A chart is drawn off its cells, and the analyst writes them however their sources do:
``5 mars 2026``, ``05/03/2026``, ``2026年3月5日``, ``1 200,5``, ``at least 60``. Both
readers of a cell, this one for the engine and `lib/cellRead.js` for the browser, read
them by the same rules, so a cell the browser says it understood is the cell the chart
draws. `frontend/src/lib/cellReading.fixture.json` holds the cases both must answer alike.

- **Days** (`read_day`): ISO (``2026-03-05``, ``2026-03``, ``2026``), day first
  (``05/03/2026``, month first only when the day-first reading cannot be a day), a month
  and its year (``03/2026``), and words in the 113 languages of ``cell_words.json``: a
  day, a month and a year in any order, a day and a month, a month and a year, or a month
  alone, with one weekday and the connectors (``de``, ``of``, ``г.``) passed over. CJK
  and Korean marks (``2026年3月5日``) and the Vietnamese ``tháng 3`` too. A day or month
  without its year is placed in `NO_YEAR` and says so.
- **Numbers** (`read_amount`): a currency before or after, ``k`` / ``M`` / ``bn``,
  floors (``≥ 41``, ``at least``, ``60+``), ceilings, "about", a unit, and a range (two
  ends, no single value). Thousands grouped by a comma, point, apostrophe or space. A
  comma followed by exactly three digits groups thousands unless the column says the
  comma is its decimal mark (`column_marks`).

Every Unicode decimal digit reads as its ASCII digit, and the Arabic decimal and
thousands separators as ``.`` and ``,``, before anything else.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from .notetext import COMMENT, EMPHASIS, ENTITY_REF, IMAGE, LINK, MEDIA_REF

#: The word tables `scripts/cell_words.mjs` writes; `frontend/src/lib/cellWords.json` is the same file.
WORDS_FILE = Path(__file__).with_name("cell_words.json")
#: The year a day written without one is placed in, when no cell says one: a leap year,
#: never printed.
NO_YEAR = 2000
#: What XML refuses and no chart should print.
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def plain_cell(cell: str) -> str:
    """A cell as a reader says it: a chip by its label, a link by its words, no marks."""
    text = COMMENT.sub("", CONTROL.sub("", cell))
    text = MEDIA_REF.sub(lambda match: match.group(2), text)
    text = ENTITY_REF.sub(lambda match: match.group(2), text)
    text = IMAGE.sub(lambda match: match.group(1), text)
    text = LINK.sub(lambda match: match.group(1), text)
    text = EMPHASIS.sub("", text)
    text = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|~<>])", r"\1", text)
    return " ".join(text.split())


# -- the words ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Words:
    """``cell_words.json`` as the reader looks words up in it."""

    months: dict[str, int]
    weekdays: frozenset[str]
    connectors: frozenset[str]
    ordinals: frozenset[str]
    year_marks: str
    month_marks: str
    day_marks: str
    month_number: frozenset[str]
    prefixes: tuple[str, ...]
    #: The first words of the month names written in several: ``am`` of ``am faoilleach``.
    month_openers: frozenset[str]


@lru_cache(maxsize=1)
def words() -> Words:
    """The word tables, read once."""
    data: dict[str, Any] = json.loads(WORDS_FILE.read_text(encoding="utf-8"))
    marks = data["marks"]
    return Words(
        months={str(word): int(month) for word, month in data["months"].items()},
        weekdays=frozenset(data["weekdays"]),
        connectors=frozenset(data["connectors"]),
        # folded as a cell's word is: NFKC makes ``º`` an ``o``
        ordinals=frozenset(fold(ordinal) for ordinal in data["ordinals"]),
        year_marks="".join(marks["year"]),
        month_marks="".join(marks["month"]),
        day_marks="".join(marks["day"]),
        month_number=frozenset(data["month_number"]),
        prefixes=tuple(data["prefixes"]),
        month_openers=frozenset(word.split(" ")[0] for word in data["months"] if " " in word),
    )


#: JavaScript's ``\s``, so a word folds here exactly as `scripts/cell_words.mjs` folds it.
_JS_SPACE_CHARS = "".join(chr(code) for code in (9, 10, 11, 12, 13, 32, 0xA0, 0x1680, *range(0x2000, 0x200B),
                                                  0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF))
_SPACES = re.compile(f"[{re.escape(_JS_SPACE_CHARS)}]+")
#: A dot, the two direction marks, the Arabic letter mark and the tatweel: nothing a word says.
_UNSAID = re.compile("[.\u200e\u200f\u061c\u0640]")


def _latin(word: str) -> bool:
    """Whether a word is written in the Latin script alone (marks, spaces, apostrophes and
    hyphens aside), where an accent is often left out when typing."""
    for char in unicodedata.normalize("NFKD", word):
        if char.isascii():
            if not (char.isalpha() or char in _JS_SPACE_CHARS or char in "'-"):
                return False
            continue
        category = unicodedata.category(char)
        if category.startswith("M") or char in _JS_SPACE_CHARS or char in "'’-":
            continue
        if not (category.startswith("L") and unicodedata.name(char, "").startswith("LATIN ")):
            return False
    return bool(word)


@lru_cache(maxsize=8192)
def fold(word: str) -> str:
    """A word as both readers look it up (`scripts/cell_words.mjs` ``fold``): NFKC, lower
    case, no dots nor direction marks, and no accents in the Latin script only."""
    said = _SPACES.sub(" ", _UNSAID.sub("", unicodedata.normalize("NFKC", word).lower())).strip(_JS_SPACE_CHARS)
    if _latin(said):
        said = unicodedata.normalize("NFC", "".join(char for char in unicodedata.normalize("NFKD", said)
                                                    if not unicodedata.category(char).startswith("M")))
    return said


def digits(text: str) -> str:
    """Every decimal digit of any script as its ASCII digit, and the Arabic decimal and
    thousands separators as ``.`` and ``,``: ``١٬٢٠٠`` is ``1,200``."""
    if text.isascii():
        return text
    out = []
    for char in text:
        if char == "\u066b":
            out.append(".")
        elif char == "\u066c":
            out.append(",")
        elif char.isdecimal() and not char.isascii():
            out.append(str(unicodedata.decimal(char)))
        else:
            out.append(char)
    return "".join(out)


def month_word(word: str) -> int | None:
    """The month (1 to 12) a word names in any language of the tables, or None:
    ``mars``, ``févr.``, ``марта``, ``במרץ`` (``in March``)."""
    found = fold(word)
    table = words().months
    if found in table:
        return table[found]
    for prefix in words().prefixes:
        if found.startswith(prefix) and found[len(prefix):] in table:
            return table[found[len(prefix):]]
    return None


@lru_cache(maxsize=8192)
def _clean(cell: str) -> str:
    """A cell's plain words with ASCII digits; a chart asks for each cell many times."""
    return digits(plain_cell(cell))


# -- days -----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Day:
    """A day a cell names, how precisely (``day``, ``month``, ``year``) and whether it said its year."""

    day: date
    precision: str = "day"
    year: bool = True


_ISO = re.compile(r"(\d{4})([-/])(\d{1,2})(?:\2(\d{1,2}))?")
_YEAR = re.compile(r"\d{4}")
_DAY_FIRST = re.compile(r"(\d{1,2})([/.-])(\d{1,2})\2(\d{4})")
_MONTH_YEAR = re.compile(r"(\d{1,2})[/.-](\d{4})")
_TOKENS = re.compile(r"[\s,]+")
#: A number in a worded day: ``5``, ``5.`` (``5. März``), ``2026``; never ``1.5``.
_NUMBER_TOKEN = re.compile(r"(\d+)\.?")
#: A day with its ordinal, once folded: ``1er``, ``5th``, ``5º`` (folded ``5o``).
_ORDINAL_TOKEN = re.compile(r"(\d{1,2})(\D+)")
#: The month's number after ``tháng``, read as written: ``tháng 1.2`` is no month.
_MONTH_NUMBER = re.compile(r"(\d{1,2})\.?")
#: The most words one month name is written in: ``арван нэгдүгээр сар``.
_MONTH_TOKENS = 3
#: What a day says: its year (None when it says none), its month and its day (None when
#: it names a whole month), or a year alone as (year, None, None).
Parts = tuple[int | None, int | None, int | None]


def _year(value: int) -> int | None:
    return value if 1000 <= value <= 2999 else None


def _numeric(text: str) -> Parts | bool:
    """A day written in digits, False for one whose year cannot be (``05/03/26``,
    ``0999``), or True when the cell is not written in digits alone."""
    match = _ISO.fullmatch(text)
    if match:
        year, month, day = _year(int(match.group(1))), int(match.group(3)), match.group(4)
    elif _YEAR.fullmatch(text):
        year, month, day = _year(int(text)), None, None
    elif match := _DAY_FIRST.fullmatch(text):
        first, second = int(match.group(1)), int(match.group(3))
        if second > 12 and first <= 12:  # 3/25/2026 cannot be day first
            first, second = second, first
        year, month, day = _year(int(match.group(4))), second, str(first)
    elif match := _MONTH_YEAR.fullmatch(text):
        year, month, day = _year(int(match.group(2))), int(match.group(1)), None
    else:
        return True
    if year is None:
        return False
    return year, month, int(day) if day else None


def _marked(token: str) -> list[tuple[str, int]] | None:
    """``2026年3月5日`` or ``3월`` as its parts, or None for a token that is not one."""
    found = words()
    marks = re.escape(found.year_marks + found.month_marks + found.day_marks)
    if not re.fullmatch(rf"(?:\d+[{marks}])+", token):
        return None
    parts = []
    for number, mark in re.findall(rf"(\d+)([{marks}])", token):
        if mark in found.year_marks:
            if len(number) != 4 or _year(int(number)) is None:
                return []
            parts.append(("year", int(number)))
        else:
            parts.append(("month" if mark in found.month_marks else "day", int(number)))
    return parts


def _worded(text: str) -> Parts | None:
    """A day written with words, or None when anything else is in the cell: a month, with
    its day, its year or both, in any order, and one weekday and the connectors passed over."""
    found = words()
    tokens = [token for token in _TOKENS.split(text) if token]
    said: dict[str, int] = {}
    weekday = False

    def put(part: str, value: int) -> bool:
        if part in said:
            return False
        said[part] = value
        return True

    index = 0
    while index < len(tokens):
        token = tokens[index]
        number = _NUMBER_TOKEN.fullmatch(token)
        if number:
            value = number.group(1)
            if len(value) == 4 and _year(int(value)):
                if not put("year", int(value)):
                    return None
            elif len(value) > 2 or not put("day", int(value)):
                return None
            index += 1
            continue
        word = fold(token)
        ordinal = _ORDINAL_TOKEN.fullmatch(word)
        if ordinal and ordinal.group(2) in found.ordinals:
            if not put("day", int(ordinal.group(1))):
                return None
            index += 1
            continue
        marked = _marked(word)
        if marked is not None:
            if not marked or not all(put(part, value) for part, value in marked):
                return None
            index += 1
            continue
        if word in found.month_number and index + 1 < len(tokens):
            after = _MONTH_NUMBER.fullmatch(tokens[index + 1])
            if after:
                if not put("month", int(after.group(1))):
                    return None
                index += 2
                continue
        # the longest run of words that names a month first: `am faoilleach` opens on a connector
        size = min(_MONTH_TOKENS if word in found.month_openers else 1, len(tokens) - index)
        month = None
        while size and (month := month_word(" ".join(tokens[index:index + size]))) is None:
            size -= 1
        if month is not None:
            if not put("month", month):
                return None
            index += size
            continue
        if word in found.connectors:
            index += 1
            continue
        if word in found.weekdays and not weekday:
            weekday = True
            index += 1
            continue
        return None
    if "month" not in said:
        return None  # a day, a year or a weekday alone is no day
    return said.get("year"), said["month"], said.get("day")


def _read(text: str, year: int | None) -> Day | None:
    if not text:
        return None
    numeric = _numeric(text)
    if numeric is False:
        return None
    parts = _worded(text) if numeric is True else numeric
    if parts is None or isinstance(parts, bool):
        return None
    said_year, month, day = parts
    try:
        if month is None:
            return Day(date(said_year or NO_YEAR, 1, 1), "year")
        placed = said_year or year or NO_YEAR
        said = said_year is not None or bool(year)
        if day is None:
            return Day(date(placed, month, 1), "month", said)
        return Day(date(placed, month, day), "day", said)
    except ValueError:
        return None


@lru_cache(maxsize=4096)
def _read_cached(text: str, year: int | None) -> Day | None:
    return _read(text, year)


def read_day(cell: str, year: int | None = None) -> Day | None:
    """A cell's day in any language, or None: ``2026-03-05``, ``05/03/2026``,
    ``5 mars 2026``, ``March 2026``, ``Mars``, ``2026年3月5日``. A day or month written
    without its year takes ``year``, else `NO_YEAR`, and says it had none unless given one."""
    return _read_cached(_clean(str(cell or "")), year)


# -- numbers --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Amount:
    """What a cell says of a number: its value (None for a range), the two ends of a
    range, whether it is a floor, a ceiling or about, its unit, and the marks it used."""

    value: float | None
    range: tuple[float, float] | None = None
    floor: bool = False
    ceiling: bool = False
    approx: bool = False
    unit: str = ""
    decimal: str = "."
    thousands: str = ""


@dataclass(frozen=True)
class Marks:
    """A column's decimal mark and the separator grouping its thousands."""

    decimal: str
    thousands: str


@dataclass(frozen=True)
class _Part:
    value: float
    scale: float
    scaled: bool
    unit: str
    thousands: str
    decimal: str
    length: int


_PLACEHOLDER = re.compile(r"(?:[-–—‒?]+|n/?a)", re.I)
_FLOOR = re.compile(r"^(?:≥|>=|⩾|>|at least|no (?:fewer|less) than|more than|over|min(?:imum)?\.?(?=\s|\d|\Z))\s*",
                    re.I)
_CEILING = re.compile(r"^(?:≤|<=|⩽|<|up to|at most|no more than|fewer than|less than|under|"
                      r"max(?:imum)?\.?(?=\s|\d|\Z))\s*", re.I)
_APPROX = re.compile(r"^(?:~|≈|∼|about|around|approx(?:imately|\.)?|roughly|nearly|almost|some|circa|ca\.|c\.)\s*",
                     re.I)
_TAIL = re.compile(r"\s*(?:\+|\s(?:or|and) more|\s(?:or (?:less|fewer)))\Z", re.I)
_CURRENCY = re.compile(r"^(?:US\$|A\$|C\$|HK\$|NZ\$|\$|€|£|¥|₹|₽|₺|₴|₪|﷼|(?:USD|EUR|GBP|JPY|CNY|RUB|UAH|TRY|SAR|AED|"
                       r"YER|ILS|IRR|CHF|CAD|AUD|INR|EGP|QAR|KWD|OMR|JOD|LBP|SYP|IQD)(?=[\s\d]))\s?")
_NUMBER = re.compile(r"^(\d{1,3}(?:([,.' \u00a0\u202f’])\d{3})(?:\2\d{3})*(?!\d)|\d+)([.,]\d+)?")
_MULTIPLIER = re.compile(r"^(?:\s?(bn|billion|billions|mn|million|millions|thousand)\b|(k|K|M|Mn|B|Bn)(?![^\W_]))")
_SCALE = {"k": 1e3, "K": 1e3, "thousand": 1e3, "M": 1e6, "Mn": 1e6, "mn": 1e6, "million": 1e6, "millions": 1e6,
          "B": 1e9, "Bn": 1e9, "bn": 1e9, "billion": 1e9, "billions": 1e9}
_UNIT = re.compile(r"^(?:\s?(%|‰|°[CF]?|€|£|\$|¥|₽|₺|₴|₪)|\s?(USD|EUR|GBP|AED|SAR|YER)|"
                   r"\s?([a-zµ][a-zµ²³/]{0,3})(?![^\W_])|\s([^\W\d_](?:[^\W\d_]|[’'-]){0,15}))", re.I)
_RANGE = re.compile(r"^\s*(?:[-–—]|to)\s*", re.I)
_CORE = re.compile(r"\d[\d,.' \u00a0\u202f’]*\d|\d")


def _scaled(value: float, scale: float) -> float:
    """``8.3`` times a million as 8300000, not 8300000.000000001."""
    return value if scale == 1 else float(f"{value * scale:.15g}")


def _part(text: str, decimal: str | None) -> _Part | None:
    """One amount at the start of ``text``: sign, currency, digits, scale and unit."""
    at = 0
    unit = ""
    sign = 1
    if text[:1] in ("-", "−"):
        sign, at = -1, 1
    currency = _CURRENCY.match(text[at:])
    if currency:
        unit = currency.group(0).strip()
        at += len(currency.group(0))
    if sign == 1 and text[at:at + 1] in ("-", "−"):
        sign, at = -1, at + 1
    number = _NUMBER.match(text[at:])
    if number is None:
        return None
    at += len(number.group(0))
    whole, group, fraction = number.group(1), number.group(2), number.group(3)
    thousands = ""
    mark = fraction[0] if fraction else ""
    if group and fraction and fraction[0] == group:
        return None
    if group and not fraction and group in ",." and len(whole.split(group)) == 2 and group == decimal:
        value = float(whole.replace(group, "."))
        mark = group
    else:
        thousands = group or ""
        value = float((whole.replace(group, "") if group else whole) + (f".{fraction[1:]}" if fraction else ""))
    scale = 1.0
    scaled = False
    multiplier = _MULTIPLIER.match(text[at:])
    if multiplier:
        scale = _SCALE[multiplier.group(1) or multiplier.group(2)]
        scaled = True
        at += len(multiplier.group(0))
    suffix = _UNIT.match(text[at:])
    if suffix:
        word = suffix.group(1) or suffix.group(2) or suffix.group(3) or suffix.group(4)
        # `5 mars` is a day, not five of something
        if month_word(word) is None and not re.fullmatch(r"to|or|and", word, re.I):
            unit = unit or word
            at += len(suffix.group(0))
    return _Part(sign * value, scale, scaled, unit, thousands, mark, at)


def _amount(rest: str, decimal: str | None) -> Amount | None:
    if not rest or _PLACEHOLDER.fullmatch(rest):
        return None
    found = _read_cached(rest, None)
    if found is not None and found.precision != "year":
        return None  # a whole day is no number; a bare year still counts
    said: set[str] = set()
    changed = True
    while changed:
        changed = False
        for pattern, flag in ((_FLOOR, "floor"), (_CEILING, "ceiling"), (_APPROX, "approx")):
            match = pattern.match(rest)
            if match and match.group(0):
                said.add(flag)
                rest = rest[match.end():]
                changed = True
    tail = _TAIL.search(rest)
    if tail:
        said.add("ceiling" if re.search(r"less|fewer", tail.group(0), re.I) else "floor")
        rest = rest[:tail.start()]
    floor, ceiling, approx = "floor" in said, "ceiling" in said, "approx" in said
    first = _part(rest, decimal)
    if first is None:
        return None
    rest = rest[first.length:]
    mark = first.decimal or decimal or "."
    between = _RANGE.match(rest)
    if between and len(rest) > between.end():
        second = _part(rest[between.end():], decimal)
        if second is None or len(rest) != between.end() + second.length:
            return None
        # `8-10M` scales both ends; `$120k-$250k` each its own
        ends = (_scaled(first.value, first.scale if first.scaled else second.scale), _scaled(second.value, second.scale))
        return Amount(None, ends, floor, ceiling, approx, first.unit or second.unit, mark, first.thousands)
    if rest.strip():
        return None
    return Amount(_scaled(first.value, first.scale), None, floor, ceiling, approx, first.unit, mark, first.thousands)


@lru_cache(maxsize=4096)
def _amount_cached(text: str, decimal: str | None) -> Amount | None:
    return _amount(text, decimal)


def read_amount(cell: str, decimal: str | None = None) -> Amount | None:
    """The number a cell holds, or None when it is none: ``41``, ``1 234,5``, ``$8.3M``,
    ``80%``, ``≥ 41`` or ``41+`` (a floor), ``up to 20`` (a ceiling), ``~12`` (about).
    ``8–10`` is a range: no single value, its two ends in ``range``. ``decimal`` says which
    of ``.`` and ``,`` is the decimal mark when the cell alone cannot tell (``1,234``)."""
    return _amount_cached(_clean(str(cell or "")), decimal)


def _most_common(values: Iterable[str], fallback: str) -> str:
    counts: dict[str, int] = {}
    best, top = fallback, 0
    for value in values:
        counts[value] = counts.get(value, 0) + 1
        if counts[value] > top:
            best, top = value, counts[value]
    return best


def column_marks(cells: Iterable[str], fallback: str | None = None) -> Marks:
    """Which of ``.`` and ``,`` is a column's decimal mark, and what groups its thousands:
    a cell holding both says it, ``1,5`` says comma, ``12.7590`` says point, ``1,234,567``
    says the comma groups thousands. Nothing telling leaves ``fallback``, else ``.``."""
    comma = point = 0.0
    groups: list[str] = []
    for cell in cells:
        core = _CORE.search(_clean(str(cell or "")))
        if core is None:
            continue
        match = _NUMBER.match(core.group(0))
        if match is None:
            continue
        whole, group, fraction = match.group(0), match.group(2), match.group(3)
        if fraction:
            if fraction[0] == ",":
                comma += 1
            else:
                point += 1
        if group:
            groups.append(group)
            if not fraction and group in ",." and len(whole.split(group)) > 2:
                if group == ",":
                    point += 0.5
                else:
                    comma += 0.5
    decimal = "," if comma > point else "." if point > comma else fallback or "."
    return Marks(decimal, _most_common((group for group in groups if group != decimal), ""))
