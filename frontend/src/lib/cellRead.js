/**
 * The one reader of what a cell says, a day or a number, in any language: the browser's
 * half of `engine/cellread.py`, which draws the chart off the same cell. The grids say in
 * the cell what the chart will draw, so the two must agree on every cell;
 * `cellReading.fixture.json` is the list they are both held to (`cellRead.test.js`,
 * `tests/test_cellread.py`).
 *
 * Before reading, a cell is its plain text (chips by their label, links by their words, no
 * bold), every decimal digit of any script made ASCII (`٥` is 5), `٫` a point and `٬` a
 * comma.
 *
 * **A day** (`readDay`) is numeric (`2026-03-05`, `2026/03/05`, `2026-03`, `2026`,
 * `05/03/2026` day first unless the second number cannot be a month, `03/2026`) or written
 * in words in any of the languages `cellWords.json` holds: a day, a month and a year in any
 * order, a day and a month, a month and a year, or a month alone, with a weekday, an ordinal
 * (`1er`, `5th`) and the small words a date is written with (`de`, `г.`) left aside;
 * `2026年3月5日` and `2026년 3월 5일`, `tháng 3`, `במרץ`. Anything else in the cell and it is
 * not a day: `Mars rover`, `Q1 2026`. A two-digit year is never read. A day or a month
 * without its year is placed in `NO_YEAR` and says so.
 *
 * **A number** (`readNumber`) is a count or an amount as people write one: a currency
 * before or after, `k`, `M`, `bn`, a floor (`≥ 41`, `at least 41`, `41+`), "about" (`~12`),
 * a unit, thousands grouped by a comma, a point, an apostrophe or a space. A comma followed
 * by three digits groups thousands unless the column says the comma is its decimal mark
 * (`columnMarks`). A range (`8–10`) holds no single value.
 */
import WORDS from './cellWords.json';

// -- a cell's plain text --------------------------------------------------------------

// The same patterns as `engine/notetext.py` and `lib/markdown.js`.
export const ENTITY_REF = /\[\[entity:([A-Za-z0-9_-]+)\|([^\]]+)\]\]/g;
export const MEDIA_REF = /\[\[media:([A-Za-z0-9_-]+)\|([^\]]+)\]\](?:\{([^}\n]+)\})?/g;

/** A cell's Markdown as the words it shows: chips and links as their labels, no marks. */
export function plainText(markdown) {
  return String(markdown ?? '')
    .replace(MEDIA_REF, (_match, _id, label) => label)
    .replace(ENTITY_REF, (_match, _id, label) => label)
    .replace(/!\[([^\]]*)\]\([^)]*\)(?:\{[^}\n]*\})?/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])([*_])(?=\S)([\s\S]*?\S)\2(?![\w*])/g, '$1$3')
    .replace(/(`+)([\s\S]*?)\1/g, '$2')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .trim();
}

const PLACEHOLDER = /^(?:[-–—‒?]+|n\/?a)$/i;

/** Whether a cell says nothing: empty, or a dash, a `?` or `n/a` standing for unknown. */
export function blankCell(text) {
  const plain = plainText(text);
  return !plain || PLACEHOLDER.test(plain);
}

const DIGIT = /\p{Nd}/u;
const digitValues = new Map();

/** The value of a decimal digit of any script: its distance from the zero of its run of ten. */
function digitValue(char) {
  let value = digitValues.get(char);
  if (value === undefined) {
    const code = char.codePointAt(0);
    let start = code;
    // every script's ten digits stand in a row from its zero, and rows that touch start on a zero too
    while (start > 0 && DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
    value = (code - start) % 10;
    digitValues.set(char, value);
  }
  return value;
}

/** Every decimal digit made ASCII (`٢٠٢٦` is `2026`), `٫` a point and `٬` a comma. */
export function digits(text) {
  return String(text ?? '')
    .replace(/[\u066b\u066c]/g, (mark) => (mark === '\u066b' ? '.' : ','))
    .replace(/\p{Nd}/gu, (char) => (char >= '0' && char <= '9' ? char : String(digitValue(char))));
}

const LATIN = /^[\p{Script=Latin}\p{M}\s'’-]+$/u;

/**
 * A word as the tables hold it (`scripts/cell_words.mjs`): NFKC, lower case, no dots nor
 * direction marks, and no accents in the Latin script only, where `fevrier` is how
 * `février` is often typed.
 */
export function fold(word) {
  let said = String(word ?? '').normalize('NFKC').toLocaleLowerCase('en').replace(/[.\u200e\u200f\u061c\u0640]/g, '').replace(/\s+/g, ' ').trim();
  if (LATIN.test(said.normalize('NFKD'))) said = said.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC');
  return said;
}

// -- the words of a day ---------------------------------------------------------------

const MONTHS = new Map(Object.entries(WORDS.months));
const WEEKDAYS = new Set(WORDS.weekdays);
const CONNECTORS = new Set(WORDS.connectors);
// folded as the word they follow is: NFKC writes º and ª as o and a
const ORDINAL = new RegExp(`^(\\d{1,2})(?:${WORDS.ordinals.map(fold).join('|')})$`);
const MONTH_NUMBER = new Set(WORDS.month_number);
const MARKS = Object.entries(WORDS.marks).flatMap(([part, marks]) => marks.map((mark) => [mark, part]));
const MARKED = new RegExp(`(\\d+)(${MARKS.map(([mark]) => mark).join('|')})`, 'gy');
const MARK_PART = new Map(MARKS);
// the most words a month is written with (`арван нэгдүгээр сар`)
const LONGEST = Math.max(...[...MONTHS.keys()].map((word) => word.split(' ').length));

/** The days' names as the chart prints them. */
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The month (1–12) a word names in any language, `במרץ` included; null when it names none. */
export function monthWord(word) {
  const said = fold(word);
  if (!said) return null;
  if (MONTHS.has(said)) return MONTHS.get(said);
  for (const prefix of WORDS.prefixes) {
    if (said.startsWith(prefix) && MONTHS.has(said.slice(prefix.length))) return MONTHS.get(said.slice(prefix.length));
  }
  return null;
}

/** Whether a word only wraps a day's parts (`de`, `the`, `г.`), said in a day and skipped. */
export function connectorWord(word) {
  return CONNECTORS.has(fold(word));
}

/**
 * The day, month and year a cell writes in words, unchecked: `{ day, month, year }`
 * (numbers, `day` and `year` null when it says none), or null when it holds anything
 * else, or no month. A weekday is left aside once, the small words always.
 */
export function dayWords(text) {
  const tokens = digits(text).split(/[\s,]+/).filter(Boolean);
  const found = { day: null, month: null, year: null };
  let weekday = false;
  const put = (part, value) => {
    if (found[part] !== null) return false;
    found[part] = value;
    return true;
  };
  for (let at = 0; at < tokens.length;) {
    // a month of several words first: `كانون الثاني`, `am faoilleach` (`am` is a small word too)
    let taken = 0;
    for (let size = Math.min(LONGEST, tokens.length - at); size >= 1 && !taken; size -= 1) {
      const month = monthWord(tokens.slice(at, at + size).join(' '));
      if (month !== null) {
        if (!put('month', month)) return null;
        taken = size;
      }
    }
    if (taken) {
      at += taken;
      continue;
    }
    const raw = tokens[at];
    const word = fold(raw);
    at += 1;
    if (CONNECTORS.has(word)) continue;
    if (WEEKDAYS.has(word)) {
      if (weekday) return null;
      weekday = true;
      continue;
    }
    if (MONTH_NUMBER.has(word)) {
      // tháng 3: the month said by its number
      const number = /^(\d{1,2})\.?$/.exec(tokens[at] ?? '');
      if (!number || !put('month', Number(number[1]))) return null;
      at += 1;
      continue;
    }
    // a number read as written, a dot after it at most (`5.` is the 5th): folded, `1.5` would be 15
    const number = /^(\d+)\.?$/.exec(raw);
    if (number) {
      const size = number[1].length;
      if (size === 4 ? !put('year', Number(number[1])) : size > 2 || !put('day', Number(number[1]))) return null;
      continue;
    }
    const day = ORDINAL.exec(word);
    if (day) {
      if (!put('day', Number(day[1]))) return null;
      continue;
    }
    // 2026年3月5日, 2026년 3월 5일: a number then the mark of what it counts
    MARKED.lastIndex = 0;
    let read = 0;
    for (let piece = MARKED.exec(word); piece; piece = MARKED.exec(word)) {
      if (!put(MARK_PART.get(piece[2]), Number(piece[1]))) return null;
      read = MARKED.lastIndex;
    }
    if (!read || read !== word.length) return null;
  }
  return found.month === null ? null : found;
}

// -- a day ----------------------------------------------------------------------------

/** The year a day written without one is placed in, when nothing says one: a leap year, never printed. */
export const NO_YEAR = 2000;

const ISO = /^(\d{4})([-/])(\d{1,2})(?:\2(\d{1,2}))?$/;
const YEAR = /^\d{4}$/;
const DAY_MONTH_YEAR = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/;
const MONTH_YEAR = /^(\d{1,2})([/.-])(\d{4})$/;

/** Whether the calendar has this day. */
export function realDay(year, month, day) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const pad = (value, size = 2) => String(value).padStart(size, '0');

function made(precision, { year, month = 1, day = 1 }, given) {
  const said = year !== null && year !== undefined;
  const full = said ? year : given || NO_YEAR;
  if (full < 1000 || full > 2999 || !realDay(full, month, day)) return null;
  return { precision, date: `${pad(full, 4)}-${pad(month)}-${pad(day)}`, year: Boolean(said || given) };
}

/**
 * The day a cell names: `{ precision, date, year }`, `precision` 'day', 'month' or 'year',
 * `date` its first day as `YYYY-MM-DD`, `year` whether the cell (or `year`, given) said its
 * year; null when the cell is not a day. A day or a month without its year takes `year`,
 * else `NO_YEAR`.
 */
export function readDay(cell, year = null) {
  const text = digits(plainText(cell)).split(/\s+/).join(' ').trim();
  if (!text) return null;
  let match = ISO.exec(text);
  if (match) {
    return match[4] ? made('day', { year: +match[1], month: +match[3], day: +match[4] })
      : made('month', { year: +match[1], month: +match[3] });
  }
  if (YEAR.test(text)) return made('year', { year: +text });
  match = DAY_MONTH_YEAR.exec(text);
  if (match) {
    let [day, month] = [+match[1], +match[3]];
    // 3/25/2026: the second cannot be a month, so the first is
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return made('day', { year: +match[4], month, day });
  }
  match = MONTH_YEAR.exec(text);
  if (match) return made('month', { year: +match[3], month: +match[1] });
  const words = dayWords(text);
  if (!words) return null;
  return words.day === null ? made('month', { year: words.year, month: words.month }, year)
    : made('day', words, year);
}

/** A day's year, month and day as numbers. */
export function dayParts(reading) {
  const [year, month, day] = reading.date.split('-').map(Number);
  return { year, month, day };
}

/** A day as the chart prints it: `5 Mar 2026`, `Mar 2026`, `2026`, or `5 Mar` and `Mar` without its year. */
export function dayText(reading, { year = true } = {}) {
  const parts = dayParts(reading);
  if (reading.precision === 'year') return String(parts.year);
  const month = MONTH_NAMES[parts.month - 1];
  if (reading.precision === 'month') return reading.year ? `${month} ${parts.year}` : month;
  const shown = `${parts.day} ${month}`;
  return year && reading.year ? `${shown} ${parts.year}` : shown;
}

/** A column named for days: one day read in it is enough. */
export const DAY_HEADER = /^\s*(?:when|days?|dates?|from|start|since)\b/i;

const filledCells = (rows, column) => rows.map((row) => row[column] ?? '').filter((cell) => plainText(cell));

/** Whether a column holds days: at least two, and half its filled cells or more. */
export function dayColumn(rows, column) {
  const cells = filledCells(rows, column);
  const found = cells.filter((cell) => readDay(cell) !== null).length;
  return found >= 2 && found * 2 >= cells.length;
}

/**
 * The columns of days (`dayColumn`), as the engine's `day_columns`; with none, a column
 * named for days whose every filled cell reads as one, so a table of one dated row has its days.
 */
export function dayColumns(headers, rows) {
  const found = headers.map((_, column) => column).filter((column) => dayColumn(rows, column));
  if (found.length) return found;
  const named = headers.findIndex((header, column) => {
    const cells = filledCells(rows, column);
    return DAY_HEADER.test(plainText(header)) && cells.length > 0 && cells.every((cell) => readDay(cell) !== null);
  });
  return named >= 0 ? [named] : [];
}

// -- a number -------------------------------------------------------------------------

const FLOOR = /^(?:≥|>=|⩾|>|at least|no (?:fewer|less) than|more than|over|min(?:imum)?\.?(?=\s|\d|$))\s*/i;
const CEILING = /^(?:≤|<=|⩽|<|up to|at most|no more than|fewer than|less than|under|max(?:imum)?\.?(?=\s|\d|$))\s*/i;
const APPROX = /^(?:~|≈|∼|about|around|approx(?:imately|\.)?|roughly|nearly|almost|some|circa|ca\.|c\.)\s*/i;
const CURRENCY = /^(?:US\$|A\$|C\$|HK\$|NZ\$|\$|€|£|¥|₹|₽|₺|₴|₪|﷼|(?:USD|EUR|GBP|JPY|CNY|RUB|UAH|TRY|SAR|AED|YER|ILS|IRR|CHF|CAD|AUD|INR|EGP|QAR|KWD|OMR|JOD|LBP|SYP|IQD)(?=[\s\d]))\s?/;
const NUMBER = /^(\d{1,3}(?:([,.' \u00a0\u202f’])\d{3})(?:\2\d{3})*(?!\d)|\d+)([.,]\d+)?/;
const MULTIPLIER = /^(?:\s?(bn|billion|billions|mn|million|millions|thousand)\b|(k|K|M|Mn|B|Bn)(?![\p{L}\d]))/u;
const SCALE = { k: 1e3, K: 1e3, thousand: 1e3, M: 1e6, Mn: 1e6, mn: 1e6, million: 1e6, millions: 1e6, B: 1e9, Bn: 1e9, bn: 1e9, billion: 1e9, billions: 1e9 };
const UNIT = /^(?:\s?(%|‰|°[CF]?|€|£|\$|¥|₽|₺|₴|₪)|\s?(USD|EUR|GBP|AED|SAR|YER)|\s?([a-zµ][a-zµ²³/]{0,3})(?![\p{L}\d])|\s([\p{L}][\p{L}’'-]{0,15}))/iu;
const RANGE = /^\s*(?:[-–—]|to)\s*/i;

/**
 * The number a written cell holds, or null when it is not one: `41`, `1 234,5`,
 * `$8.3M`, `80%`, `≥ 41` or `41+` (a floor), `up to 20` (a ceiling), `~12` (about).
 * `8–10` is a range: no single value, its two ends in `range`. A cell that reads whole as
 * a day is not a number, a bare year aside (`2026` is a count too). `decimal` says which
 * of `.` and `,` is the decimal mark when the cell alone cannot tell (`1,234`).
 * @returns {null | { value: number|null, range: [number, number]|null, floor: boolean, ceiling: boolean, approx: boolean, unit: string, decimal: '.'|',', thousands: string }}
 */
export function readNumber(text, { decimal } = {}) {
  let rest = digits(plainText(text));
  if (!rest || PLACEHOLDER.test(rest)) return null;
  const day = readDay(rest);
  if (day && day.precision !== 'year') return null;
  const reading = { value: null, range: null, floor: false, ceiling: false, approx: false, unit: '', decimal: decimal ?? '.', thousands: '' };
  for (let changed = true; changed;) {
    changed = false;
    for (const [pattern, flag] of [[FLOOR, 'floor'], [CEILING, 'ceiling'], [APPROX, 'approx']]) {
      const match = pattern.exec(rest);
      if (match && match[0]) {
        reading[flag] = true;
        rest = rest.slice(match[0].length);
        changed = true;
      }
    }
  }
  const tail = /\s*(?:\+|\s(?:or|and) more|\s(?:or (?:less|fewer)))$/i.exec(rest);
  if (tail) {
    if (/less|fewer/i.test(tail[0])) reading.ceiling = true;
    else reading.floor = true;
    rest = rest.slice(0, rest.length - tail[0].length);
  }
  const first = amountAt(rest, decimal);
  if (!first) return null;
  rest = rest.slice(first.length);
  reading.unit = first.unit;
  reading.thousands = first.thousands;
  if (first.decimal) reading.decimal = first.decimal;
  const between = RANGE.exec(rest);
  if (between && rest.length > between[0].length) {
    const second = amountAt(rest.slice(between[0].length), decimal);
    if (!second || rest.length !== between[0].length + second.length) return null;
    // `8-10M` scales both ends; `$120k-$250k` each its own
    reading.range = [scaled(first.value, first.scaled ? first.scale : second.scale), scaled(second.value, second.scale)];
    reading.unit = first.unit || second.unit;
    return reading;
  }
  if (rest.trim()) return null;
  reading.value = scaled(first.value, first.scale);
  return reading;
}

/**
 * A cell's single number as the chart draws it, `{ value, floor }`, or null when it holds
 * none (empty, words, a day, a range): the engine's `read_amount`.
 */
export function readAmount(cell, decimal) {
  const reading = readNumber(cell, { decimal });
  return reading && reading.value !== null ? { value: reading.value, floor: reading.floor } : null;
}

/** `8.3` times a million as 8300000, not 8300000.000000001. */
function scaled(value, scale) {
  return scale === 1 ? value : Number((value * scale).toPrecision(15));
}

/** One amount at the start of `text`: sign, currency, digits, scale and unit. */
function amountAt(text, decimal) {
  let at = 0;
  let unit = '';
  let sign = 1;
  if (/^[-−]/.test(text)) {
    sign = -1;
    at += 1;
  }
  const currency = CURRENCY.exec(text.slice(at));
  if (currency) {
    unit = currency[0].trim();
    at += currency[0].length;
  }
  if (sign === 1 && /^[-−]/.test(text.slice(at))) {
    sign = -1;
    at += 1;
  }
  const number = NUMBER.exec(text.slice(at));
  if (!number) return null;
  at += number[0].length;
  const [, whole, group, fraction] = number;
  let value;
  let thousands = '';
  let mark = fraction ? fraction[0] : '';
  if (group && fraction && fraction[0] === group) return null;
  if (group && !fraction && (group === ',' || group === '.') && whole.split(group).length === 2 && group === decimal) {
    value = Number(whole.replace(group, '.'));
    mark = group;
  } else {
    if (group) thousands = group;
    value = Number(whole.split(group || '\u0000').join('') + (fraction ? `.${fraction.slice(1)}` : ''));
  }
  let scale = 1;
  let isScaled = false;
  const multiplier = MULTIPLIER.exec(text.slice(at));
  if (multiplier) {
    scale = SCALE[multiplier[1] ?? multiplier[2]];
    isScaled = true;
    at += multiplier[0].length;
  }
  const suffix = UNIT.exec(text.slice(at));
  if (suffix) {
    const word = suffix[1] ?? suffix[2] ?? suffix[3] ?? suffix[4];
    // `5 Mar` is a day, not five of something
    if (monthWord(word) === null && !/^(?:to|or|and)$/i.test(word)) {
      unit = unit || word;
      at += suffix[0].length;
    }
  }
  return { value: sign * value, scale, scaled: isScaled, unit, thousands, decimal: mark, length: at };
}

function mostCommon(values, fallback) {
  const counts = new Map();
  let best = fallback;
  let top = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > top) {
      top = count;
      best = value;
    }
  }
  return best;
}

/**
 * Which of `.` and `,` is a column's decimal mark, and what groups its thousands:
 * a cell holding both says it, `1,5` says comma, `12.7590` says point, `1,234,567`
 * says the comma groups thousands. Nothing telling leaves `fallback`.
 */
export function separators(texts, fallback) {
  let comma = 0;
  let point = 0;
  const groups = [];
  for (const text of texts) {
    const core = /\d[\d,.' \u00a0\u202f’]*\d|\d/.exec(digits(plainText(text)))?.[0];
    if (!core) continue;
    const match = NUMBER.exec(core);
    if (!match) continue;
    const [whole, , group, fraction] = [match[0], match[1], match[2], match[3]];
    if (fraction) {
      if (fraction[0] === ',') comma += 1;
      else point += 1;
    }
    if (group) {
      groups.push(group);
      if (!fraction && (group === ',' || group === '.') && whole.split(group).length > 2) {
        if (group === ',') point += 0.5;
        else comma += 0.5;
      }
    }
  }
  const decimal = comma > point ? ',' : point > comma ? '.' : fallback ?? '.';
  const thousands = mostCommon(groups.filter((group) => group !== decimal), '');
  return { decimal, thousands };
}

/** A column's decimal mark and thousands separator, said by its cells (the engine's `column_marks`). */
export function columnMarks(cells) {
  return separators(cells);
}

/** A number written with every digit, its thousands grouped: Python's `{:,}`. */
function grouped(digitsText) {
  return digitsText.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `value` at two decimals, a tie to the even digit as Python's `format` rounds it. */
function twoDecimals(value) {
  const exact = Math.abs(value).toFixed(100);
  const at = exact.indexOf('.') + 3;
  let shown = Math.abs(value).toFixed(2);
  if (exact[at] === '5' && /^0*$/.test(exact.slice(at + 1))) {
    // exactly half way: toFixed goes up, Python to the even digit
    const down = exact.slice(0, at);
    if (Number(down[down.length - 1]) % 2 === 0) shown = down;
  }
  return value < 0 && Number(shown) !== 0 ? `-${shown}` : shown;
}

/** A value as a chart prints it: whole numbers with thousands marked, else at most two decimals. */
export function numberText(value) {
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    const whole = Math.round(value);
    return `${whole < 0 ? '-' : ''}${grouped(String(Math.abs(whole)))}`;
  }
  const shown = twoDecimals(value);
  const [whole, fraction] = shown.replace('-', '').split('.');
  const trimmed = `${grouped(whole)}.${fraction}`.replace(/0+$/, '').replace(/\.$/, '');
  return `${shown.startsWith('-') ? '-' : ''}${trimmed}`;
}
