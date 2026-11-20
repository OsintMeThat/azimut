/**
 * A chart's form read and written as text (`editor/chartForm.js` draws it): which kinds
 * have a form and what each needs, the shape of each kind's table, a day at the day, the
 * month or the year, and what *Fill from the case* writes. Nothing here touches the page.
 *
 * Four families of table:
 *
 * - **timeline**: `| When | What happened |`, `| Until |` once a row is a period, and a
 *   `| Kind |` that colours each event (`colour by:`) once one says it, with `layout:` and
 *   `labels: short`;
 * - **figures** (key figures): `| Figure | What it says |`, a floor written `at least 41`;
 * - **categories** (bars, columns, the stacked kinds, pie, donut, segments, pictograms,
 *   silhouette rows, waffle, circles): `| Category | Count |`, `| Split |` between them for
 *   the stacked kinds, the counts' heading saying `(at least)` when they are floors, with
 *   `count:`, `by:`, `colour by:`, `colours:`, `icons:` and a waffle's `of:`;
 * - **line**: `| Day | Value |`, or one row a value of a series, `| Day | Series | Value |`,
 *   with `by:`, `count:` and `colour by:`;
 * - **pictures** (a picture wall): `| Picture | # |` then the words, the group and the
 *   colour each row holds, a picture of the case a row (`[[media:id|label]]`), with
 *   `picture:`, `label:`, `words:`, `by:`, `colour by:` and `shape:`.
 *
 * A block whose table holds more than its kind's form reads (a register counted row by
 * row, more columns) is not read into a form: it is edited as a table.
 */
import { readPairs, writePairs } from './chartIcons.js';
import { readChart, setting, withSettings, withTable } from './chartText.js';
import { newTable, plainText, serializeTable } from './tableText.js';

// -- the kinds ----------------------------------------------------------------------------

/**
 * Each kind with a form: its family (the shape of its table), what it needs said in one
 * line for the gallery, and what the family offers it (a split, colours, icons, a whole,
 * at most so many rows). The order is the gallery's.
 */
export const FORMS = {
  timeline: { family: 'timeline', label: 'Timeline', needs: 'Days and what happened' },
  'key figures': { family: 'figures', label: 'Key figures', needs: 'A figure and what it says' },
  bars: { family: 'categories', label: 'Bars', needs: 'Categories and their counts' },
  columns: { family: 'categories', label: 'Columns', needs: 'Categories and their counts' },
  donut: { family: 'categories', label: 'Donut', needs: 'Categories and their counts', colours: true },
  pie: { family: 'categories', label: 'Pie', needs: 'Categories and their counts', colours: true },
  segments: { family: 'categories', label: 'Segments', needs: 'Categories and their counts', colours: true },
  'stacked bars': { family: 'categories', label: 'Stacked', needs: 'Categories split in groups, and counts', split: true },
  'stacked columns': { family: 'categories', label: 'Stacked columns', needs: 'Categories split in groups, and counts', split: true },
  pictograms: { family: 'categories', label: 'Pictograms', needs: 'Categories, counts and an icon', colours: true, icons: true, whole: false },
  'silhouette rows': { family: 'categories', label: 'Silhouette rows', needs: 'Categories, counts and an icon', icons: true },
  waffle: { family: 'categories', label: 'Waffle', needs: 'A part and its whole', colours: true, whole: true },
  line: { family: 'line', label: 'Line', needs: 'Days or numbers and a value per series' },
  circles: { family: 'categories', label: 'Circles', needs: 'Two or three amounts to compare', colours: true, most: 3 },
  pictures: { family: 'pictures', label: 'Picture wall', needs: 'A picture of the case a row' },
};

/** The kinds in the gallery's order. */
export const SCRATCH_KINDS = Object.keys(FORMS);

/** Every word the engine reads a kind by (`notes_charts.register`), to the kind. */
const KIND_WORDS = {
  bar: 'bars', 'bar chart': 'bars', 'horizontal bars': 'bars', column: 'columns', 'column chart': 'columns', 'vertical bars': 'columns',
  stacked: 'stacked bars', 'stacked bar': 'stacked bars', 'stacked column': 'stacked columns', 'pie chart': 'pie',
  doughnut: 'donut', 'donut chart': 'donut', ring: 'donut', 'segmented bar': 'segments', segment: 'segments', 'share bar': 'segments',
  '100% bar': 'segments', pictogram: 'pictograms', 'unit chart': 'pictograms', isotype: 'pictograms', icons: 'pictograms',
  silhouettes: 'silhouette rows', 'icon rows': 'silhouette rows', 'pictogram rows': 'silhouette rows', 'waffle chart': 'waffle',
  squares: 'waffle', grid: 'waffle', figures: 'key figures', 'stat tiles': 'key figures', tiles: 'key figures', stats: 'key figures',
  'time line': 'timeline', chronology: 'timeline', sequence: 'timeline', 'line chart': 'line', lines: 'line',
  'circle comparison': 'circles', 'compare circles': 'circles',
  'picture wall': 'pictures', gallery: 'pictures', 'photo wall': 'pictures', 'pictures wall': 'pictures', 'wall of pictures': 'pictures',
};

/** The kind a block's `kind:` names, as the engine reads it; bars when it names none. */
export function formKind(word) {
  const said = String(word ?? '').split(/\s+/).join(' ').trim().toLowerCase();
  if (!said) return 'bars';
  return FORMS[said] ? said : KIND_WORDS[said] ?? '';
}

/** The headings a form's table starts with, by family and by kind. */
const HEADS = {
  timeline: { when: 'When', what: 'What happened', until: 'Until', colour: 'Kind' },
  figures: { figure: 'Figure', words: 'What it says' },
  categories: { category: 'Category', count: 'Count', split: 'Split' },
  line: { x: 'Day', value: 'Value', series: 'Series' },
  pictures: { picture: 'Picture', label: '#', words: 'Words', group: 'Group', colour: 'Grade' },
};
const KIND_HEADS = {
  circles: { category: 'Name', count: 'Amount' },
  waffle: { category: 'Part', count: 'Count' },
};

/**
 * The columns a new sheet for a chart of `kind` starts with: what its form reads, in the
 * order its table writes them, so the chart reads the sheet as soon as it is filled.
 * [] for a kind with no form.
 */
export function columnsFor(kind) {
  const form = FORMS[formKind(kind)];
  if (!form) return [];
  const heads = { ...HEADS[form.family], ...(KIND_HEADS[formKind(kind)] ?? {}) };
  const order = {
    timeline: ['when', 'what', 'colour'],
    figures: ['figure', 'words'],
    categories: form.split ? ['category', 'split', 'count'] : ['category', 'count'],
    line: ['x', 'value', 'series'],
    pictures: ['picture', 'label', 'words', 'group', 'colour'],
  }[form.family];
  return order.map((key) => heads[key]);
}

/** What the drawing says while the form holds no row yet. */
export const EMPTY_SAID = {
  timeline: 'Add an event or a period: the timeline is drawn as you fill it.',
  figures: 'Add a figure: the tiles are drawn as you fill them.',
  categories: 'Add a category and its count: the chart is drawn as you fill it.',
  line: 'Add a row of values: the line is drawn as you fill it.',
  pictures: 'Add a picture of the case: the wall is drawn as you fill it.',
};

// -- days ---------------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_WORDS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
/** The precisions a day is written at, as the engine reads them (`notes_chart_kinds.read_day`). */
export const PRECISIONS = [{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }];

function realDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * A cell's day as the form edits it: `{ precision, year, month, day }` (numbers, `month` and
 * `day` 0 when the precision leaves them out), `{ precision: 'day', empty: true }` for an empty
 * cell, or `{ precision: 'text', text }` for words the chart cannot read as a day of a year.
 */
export function readWhen(cell) {
  const text = plainText(cell).trim().replace(/\.$/, '');
  if (!text) return { precision: 'day', year: 0, month: 0, day: 0, empty: true };
  const month = (word) => MONTH_WORDS[String(word).toLowerCase().replace(/\.$/, '')] ?? 0;
  const make = (precision, year, at = 0, day = 0) => {
    if (year < 1000 || year > 2999) return null;
    if (precision === 'day' && !realDay(year, at, day)) return null;
    if (precision !== 'year' && !(at >= 1 && at <= 12)) return null;
    return { precision, year, month: precision === 'year' ? 0 : at, day: precision === 'day' ? day : 0 };
  };
  let found = null;
  let match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (match) found = match[3] ? make('day', +match[1], +match[2], +match[3]) : make('month', +match[1], +match[2]);
  else if ((match = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(text))) found = make('month', +match[2], month(match[1]));
  else if ((match = /^(\d{4})$/.exec(text))) found = make('year', +match[1]);
  else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(text))) found = make('day', +match[3], month(match[2]), +match[1]);
  else if ((match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(text))) found = make('day', +match[3], month(match[1]), +match[2]);
  return found ?? { precision: 'text', text };
}

/** A day written as the chart prints it: `5 Oct 2026`, `Oct 2026`, `2026`; '' while it is not whole. */
export function writeWhen({ precision, year, month = 0, day = 0 }) {
  if (!(year >= 1000 && year <= 2999)) return '';
  if (precision === 'year') return String(year);
  if (!(month >= 1 && month <= 12)) return '';
  if (precision === 'month') return `${MONTH_NAMES[month - 1]} ${year}`;
  return realDay(year, month, day) ? `${day} ${MONTH_NAMES[month - 1]} ${year}` : '';
}

/** A day as a date field holds it, `2026-10-05`, or ''. */
export function isoDay({ year, month, day }) {
  if (!realDay(year, month, day)) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A day at a coarser precision, or at a finer one as far as it is known. */
export function atPrecision(when, precision) {
  if (when.precision === 'text' || when.empty) return { precision, year: 0, month: 0, day: 0, empty: true };
  return { precision, year: when.year, month: precision === 'year' ? 0 : when.month, day: precision === 'day' ? when.day : 0 };
}

// -- reading a block into a form -------------------------------------------------------------

const FLOOR_WORDS = /\bat least\b|\bminimum\b|≥|>=|\bor more\b|\bno fewer than\b/i;
const FLOOR_START = /^\s*(?:at least|no fewer than|minimum|≥|>=)\s*/i;
const FLOOR_END = /\s*(?:\+|or more)\s*$/i;
const UNTIL_HEADER = /until|end|to\b|till/i;
const DAY_HEADER = /^\s*(?:when|days?|dates?|from|start|since)\b/i;
const NUMBER_CELL = /^\s*(?:≥|>=)?\s*(?:~|≈|about|c\.|ca\.)?\s*[+-]?\d[\d,.  ]*\s*(?:k|m|bn|thousand|million|billion)?\s*\+?\s*%?\s*$/i;

/** A figure or a count with its floor said apart: `{ text, floor }`. */
export function readFloor(cell) {
  const text = String(cell ?? '').trim();
  const bare = text.replace(FLOOR_START, '').replace(FLOOR_END, '').trim();
  return { text: bare, floor: bare !== text };
}

/** A column's heading without the words that say its numbers are floors. */
export function baseHeading(header, fallback) {
  const bare = plainText(header).replace(FLOOR_WORDS, ' ').replace(/[()[\],:;]/g, ' ').split(/\s+/).join(' ').trim();
  return bare || fallback;
}

/** A column whose heading is `name`, however it is cased; -1 when none is. */
function columnNamed(headers, name) {
  const wanted = plainText(name).split(/\s+/).join(' ').trim().toLowerCase();
  if (!wanted) return -1;
  return headers.findIndex((header) => plainText(header).split(/\s+/).join(' ').trim().toLowerCase() === wanted);
}

const numberCell = (cell) => NUMBER_CELL.test(plainText(cell));
const numericColumn = (rows, column) => {
  const cells = rows.map((row) => row[column]).filter((cell) => plainText(cell));
  return cells.length > 0 && cells.every(numberCell);
};
const dayCells = (rows, column) => rows.map((row) => row[column]).filter((cell) => plainText(cell));
function dayColumns(headers, rows) {
  const found = headers.map((_, column) => column).filter((column) => {
    const cells = dayCells(rows, column);
    const days = cells.filter((cell) => readWhen(cell).precision !== 'text').length;
    return days >= 2 && days * 2 >= cells.length;
  });
  if (found.length) return found;
  const named = headers.findIndex((header, column) => DAY_HEADER.test(plainText(header))
    && dayCells(rows, column).every((cell) => readWhen(cell).precision !== 'text'));
  return named >= 0 ? [named] : [];
}

/** `colours: Confirmed #184f95, UAE #eb6834` read as `[name, colour]` pairs. */
export function readColours(text) {
  return String(text ?? '').split(',').map((part) => /^(.+?)\s+(#[0-9a-f]{6})$/i.exec(part.split(/\s+/).join(' ').trim()))
    .filter(Boolean).map((match) => [match[1], match[2].toLowerCase()]);
}

/** Pairs written back as `colours:` reads them. */
export function writeColours(pairs) {
  return pairs.filter(([name, colour]) => name && !name.includes(',') && /^#[0-9a-f]{6}$/i.test(colour)).map(([name, colour]) => `${name} ${colour}`).join(', ');
}

const notFit = (kind, why) => ({ kind, form: null, model: null, why });

/**
 * A chart block read for its form: `{ kind, form, model }`, or `{ kind, form: null, why }`
 * when the kind has no form or its table holds what the form cannot (a register whose rows
 * are counted, columns past the form's). `kind` is the block's own, else `kindName` (the
 * kind it is drawn as).
 */
export function readForm(source, kindName = '') {
  const chart = readChart(source);
  const kind = formKind(setting(chart, 'kind')) || formKind(kindName);
  const form = FORMS[kind];
  if (!form) return notFit(kind, 'This kind has no form.');
  const table = chart.table;
  const heads = { ...HEADS[form.family], ...(KIND_HEADS[kind] ?? {}) };
  const headers = table?.header ?? [];
  const rows = table?.rows ?? [];
  const read = { timeline: readTimeline, figures: readFigures, categories: readCategories, line: readLine, pictures: readPictures }[form.family];
  const model = read({ chart, kind, form, heads, headers, rows });
  if (model.why) return notFit(kind, model.why);
  return { kind, form, model };
}

const SEVERAL = 'Its table holds more columns than this kind reads: edit it as a table.';

/** A timeline's layouts (`notes_chart_timeline.LAYOUTS`), Auto first: what its `layout:` line writes. */
export const TIMELINE_LAYOUTS = [
  { value: 'auto', label: 'Auto', title: 'Up to 8 events across, up to 20 numbered, more as a list; always a list on a phone' },
  { value: 'across', label: 'Across', title: 'The days on one line, each label beside its day, above and below' },
  { value: 'numbered', label: 'Numbered', title: 'A numbered dot on the line for each event, its words in a list under it' },
  { value: 'list', label: 'List', title: 'One row an event, its day on the left' },
];
/** The kinds an event is offered under before any is written (`colour by:` paints them). */
export const EVENT_KINDS = ['Claim', 'Geolocated', 'Press'];
/** What `labels: short` does, said once for the form and the card. */
export const SHORT_SAID = 'Each event’s day and first words; the page shows the rest on hover, the PDF and pictures print them whole';

/**
 * What the form and the card say of the layout drawn, beside the one asked: what Auto took
 * on the page, or that an across too crowded for its lanes was numbered; '' otherwise.
 */
export function layoutSaid(asked, drawn) {
  const name = TIMELINE_LAYOUTS.find((one) => one.value === drawn)?.label.toLowerCase();
  if (!name || (asked !== 'auto' && asked === drawn)) return '';
  return asked === 'auto' ? `Drawn ${name} here` : `Too crowded across: drawn ${name}`;
}

/**
 * A timeline's columns as the engine reads them (`notes_chart_timeline.timeline_columns`):
 * `{ when, what, until }` by name, and `colours`, the columns of words its events may be
 * coloured by, which are neither its days nor its words.
 */
export function timelineColumns(table, chart) {
  const headers = table?.header ?? [];
  const rows = table?.rows ?? [];
  const name = (at) => (at >= 0 ? plainText(headers[at]) || `Column ${at + 1}` : '');
  const days = dayColumns(headers, rows);
  const start = days[0] ?? -1;
  const until = headers.map((_, at) => at).find((at) => at !== start && UNTIL_HEADER.test(plainText(headers[at]))
    && dayCells(rows, at).some((cell) => readWhen(cell).precision !== 'text')) ?? (days.length > 1 ? days[1] : -1);
  const colour = columnNamed(headers, setting(chart, 'colour by'));
  const by = columnNamed(headers, setting(chart, 'by'));
  const what = by >= 0 && !days.includes(by) ? by
    : headers.findIndex((_, at) => !days.includes(at) && at !== colour && !(rows.length && numericColumn(rows, at)));
  const colours = headers.map((_, at) => at).filter((at) => !days.includes(at) && at !== until && at !== what
    && !(rows.length && numericColumn(rows, at))).map(name);
  return { when: name(start), what: name(what), until: name(until), colours };
}

/** A timeline's `layout:` as the form and the card choose it: one of `TIMELINE_LAYOUTS`, Auto when it names none. */
export function timelineLayout(chart) {
  const written = setting(chart, 'layout').toLowerCase();
  return TIMELINE_LAYOUTS.some((one) => one.value === written) ? written : 'auto';
}

function readTimeline({ chart, heads, headers, rows }) {
  const layout = timelineLayout(chart);
  const short = setting(chart, 'labels').toLowerCase() === 'short';
  if (!headers.length) return { heads, rows: [], layout, short };
  const days = dayColumns(headers, rows);
  const start = days[0] ?? (rows.length ? -1 : Math.max(0, headers.findIndex((header) => DAY_HEADER.test(plainText(header)))));
  if (start < 0) return { why: 'Its table has no column of days.' };
  const ends = headers.map((_, column) => column).filter((column) => column !== start && UNTIL_HEADER.test(plainText(headers[column]))
    && (!rows.length || dayCells(rows, column).some((cell) => readWhen(cell).precision !== 'text')));
  const until = ends[0] ?? (days.length > 1 ? days[1] : -1);
  const by = columnNamed(headers, setting(chart, 'by'));
  const named = columnNamed(headers, setting(chart, 'colour by'));
  const colour = named >= 0 && named !== start && named !== until ? named : -1;
  const what = by >= 0 && by !== start && by !== until && by !== colour ? by
    : headers.findIndex((_, column) => column !== start && column !== until && column !== colour && !(rows.length && numericColumn(rows, column)));
  if (headers.length > [start, what, until, colour].filter((column) => column >= 0).length) return { why: SEVERAL };
  const cell = (row, at) => (at >= 0 ? row[at] ?? '' : '');
  return {
    heads: {
      when: plainText(headers[start]) || heads.when, what: what >= 0 ? plainText(headers[what]) : heads.what,
      until: until >= 0 ? plainText(headers[until]) : heads.until, colour: colour >= 0 ? plainText(headers[colour]) || heads.colour : heads.colour,
    },
    rows: rows.map((row) => ({ when: cell(row, start), what: cell(row, what), until: cell(row, until), colour: cell(row, colour) })),
    layout,
    short,
  };
}

function readFigures({ heads, headers, rows }) {
  if (headers.length > 2) return { why: SEVERAL };
  const headFloor = FLOOR_WORDS.test(plainText(headers[0] ?? ''));
  return {
    heads: { figure: headers.length ? baseHeading(headers[0], heads.figure) : heads.figure, words: plainText(headers[1] ?? '') || heads.words },
    rows: rows.map((row) => {
      const { text, floor } = readFloor(row[0] ?? '');
      return { figure: text, words: row[1] ?? '', floor: floor || headFloor };
    }),
  };
}

function readCategories({ chart, kind, form, heads, headers, rows }) {
  const colours = readColours(setting(chart, 'colours'));
  const icons = readPairs(setting(chart, 'icons'));
  const empty = { heads, floor: false, rows: [], colours, icons, whole: { name: '', amount: '' } };
  if (!headers.length) return empty;
  const countSaid = setting(chart, 'count');
  let count = countSaid && countSaid.toLowerCase() !== 'rows' ? columnNamed(headers, countSaid) : -1;
  if (count < 0) {
    const numeric = headers.map((_, column) => column).filter((column) => rows.length && numericColumn(rows, column));
    if (countSaid.toLowerCase() === 'rows' || numeric.length !== 1) {
      if (rows.length) return { why: 'Its rows are counted, one a line: edit them as a table.' };
    }
    count = numeric[0] ?? headers.findIndex((header) => /count|amount|number|total/i.test(plainText(header)));
  }
  const colourBy = columnNamed(headers, setting(chart, 'colour by'));
  const byCol = columnNamed(headers, setting(chart, 'by'));
  const parts = !form.split && colourBy >= 0 ? colourBy : -1;
  let category = parts >= 0 ? parts : byCol;
  if (category < 0 || category === count) category = headers.findIndex((_, column) => column !== count && column !== colourBy);
  const split = form.split ? (colourBy >= 0 && colourBy !== category ? colourBy : -1) : -1;
  if (!form.split && colourBy >= 0 && colourBy !== category) return { why: SEVERAL };
  const used = [category, count, split].filter((column) => column >= 0);
  if (headers.length > used.length) return { why: SEVERAL };
  const headFloor = count >= 0 && FLOOR_WORDS.test(plainText(headers[count]));
  let cellFloor = false;
  let read = rows.map((row) => {
    const { text, floor } = readFloor(count >= 0 ? row[count] ?? '' : '');
    cellFloor ||= floor;
    return { category: category >= 0 ? row[category] ?? '' : '', split: split >= 0 ? row[split] ?? '' : '', count: text };
  });
  let whole = { name: '', amount: '' };
  if (form.whole) {
    const of = setting(chart, 'of');
    const at = read.findIndex((row) => of && plainText(row.category).toLowerCase() === of.toLowerCase());
    if (at >= 0) {
      whole = { name: read[at].category, amount: read[at].count };
      read = read.filter((_, index) => index !== at);
    } else if (of) whole = { name: '', amount: readFloor(of).text };
  }
  return {
    heads: {
      category: category >= 0 ? plainText(headers[category]) || heads.category : heads.category,
      count: count >= 0 ? baseHeading(headers[count], heads.count) : heads.count,
      split: split >= 0 ? plainText(headers[split]) || heads.split : heads.split,
    },
    floor: headFloor || cellFloor,
    rows: read,
    colours,
    icons,
    whole,
  };
}

function readLine({ chart, heads, headers, rows }) {
  const empty = { heads, days: true, series: [''], rows: [] };
  if (!headers.length) return empty;
  let x = columnNamed(headers, setting(chart, 'by'));
  if (x < 0) x = dayColumns(headers, rows)[0] ?? 0;
  let value = columnNamed(headers, setting(chart, 'count'));
  if (value < 0 || value === x) value = [...headers.keys()].reverse().find((column) => column !== x && (!rows.length || numericColumn(rows, column))) ?? -1;
  const seriesAt = columnNamed(headers, setting(chart, 'colour by'));
  const series = seriesAt >= 0 && seriesAt !== x && seriesAt !== value ? seriesAt : -1;
  if (headers.length > [x, value, series].filter((column) => column >= 0).length) return { why: SEVERAL };
  // days along, unless every one is a bare year: the chart draws years as numbers, and so does the form
  const xCells = dayCells(rows, x).map(readWhen);
  const days = xCells.length ? xCells.filter((when) => when.precision !== 'text').length * 2 >= xCells.length && !xCells.every((when) => when.precision === 'year')
    : !/^\s*(?:number|step|year|x)\b/i.test(plainText(headers[x]));
  const out = {
    heads: { x: plainText(headers[x]) || heads.x, value: value >= 0 ? plainText(headers[value]) || heads.value : heads.value, series: series >= 0 ? plainText(headers[series]) || heads.series : heads.series },
    days,
  };
  if (series < 0) return { ...out, series: [''], rows: rows.map((row) => ({ x: row[x] ?? '', values: [value >= 0 ? row[value] ?? '' : ''] })) };
  // one row a value of a series: one row a day, a column a series
  const names = [];
  const byX = new Map();
  for (const row of rows) {
    const name = row[series] ?? '';
    if (!names.some((one) => one.toLowerCase() === name.toLowerCase())) names.push(name);
    const key = plainText(row[x] ?? '').toLowerCase();
    if (!byX.has(key)) byX.set(key, { x: row[x] ?? '', values: {} });
    const at = names.findIndex((one) => one.toLowerCase() === name.toLowerCase());
    byX.get(key).values[at] = row[value] ?? '';
  }
  return { ...out, series: names, rows: [...byX.values()].map((row) => ({ x: row.x, values: names.map((_, at) => row.values[at] ?? '') })) };
}

// -- a picture wall --------------------------------------------------------------------------

/** A cell naming a picture of the case: a media or an entity chip, or its id alone (`notes_chart_wall.picture_ref`). */
const PICTURE_CHIP = /\[\[(?:media|entity):([A-Za-z0-9_-]+)\|[^\]\n]+\]\]/;
const PICTURE_ID = /^e_[0-9A-Za-z]{4,40}$/;
const PICTURE_HEADER = /\b(?:pictures?|photos?|photographs?|images?|frames?|stills?|thumbnails?|screenshots?)\b/i;
const LABEL_HEADER = /^(?:#|n[o°º]?\.?|nr\.?|id|ref\.?|label|name)$/i;
/** The shapes a wall's pictures are cropped to (`notes_chart_wall.SHAPES`), the first its own. */
export const WALL_SHAPES = ['3:2', '4:3', '1:1', '16:9'];
/** The grades the bar under a frame reads in their ramp (`notes_charts.GRADES`), offered as its colour values. */
export const GRADE_WORDS = ['Confirmed', 'Almost sure', 'Strong doubt', 'Set aside'];

/** The id of the picture a cell names, or ''. */
export function pictureRef(cell) {
  const text = String(cell ?? '').trim();
  const chip = PICTURE_CHIP.exec(text);
  if (chip) return chip[1];
  return PICTURE_ID.test(text) ? text : '';
}

/** The column of pictures: the one `picture:` names, else the first mostly of pictures, else one named for them. */
export function wallPictureColumn(headers, rows, said = '') {
  if (said) return columnNamed(headers, said);
  let named = -1;
  for (let column = 0; column < headers.length; column += 1) {
    const cells = rows.map((row) => row[column] ?? '').filter((cell) => cell.trim());
    const held = cells.filter((cell) => pictureRef(cell)).length;
    if (held && held * 2 >= cells.length) return column;
    if (named < 0 && PICTURE_HEADER.test(plainText(headers[column])) && (held || !rows.length)) named = column;
  }
  return named;
}

function readPictures({ chart, heads, headers, rows }) {
  const shape = setting(chart, 'shape');
  const empty = { heads, rows: [], shape };
  if (!headers.length) return empty;
  const picture = wallPictureColumn(headers, rows, setting(chart, 'picture'));
  if (picture < 0) return { why: 'Its table has no column of pictures: edit it as a table.' };
  const labelSaid = setting(chart, 'label');
  const label = labelSaid ? columnNamed(headers, labelSaid) : headers.findIndex((header, at) => at !== picture && LABEL_HEADER.test(plainText(header).trim()));
  const group = columnNamed(headers, setting(chart, 'by'));
  const colour = columnNamed(headers, setting(chart, 'colour by'));
  const wordsSaid = setting(chart, 'words');
  const used = new Set([picture, label, group, colour].filter((at) => at >= 0));
  const words = /^(?:none|no|nothing)$/i.test(wordsSaid) ? -1 : wordsSaid ? columnNamed(headers, wordsSaid)
    : headers.findIndex((_, at) => !used.has(at));
  if (words >= 0) used.add(words);
  if (headers.length > used.size) return { why: SEVERAL };
  const head = (at, fallback) => (at >= 0 ? plainText(headers[at]) || fallback : fallback);
  const cell = (row, at) => (at >= 0 ? row[at] ?? '' : '');
  return {
    heads: { picture: head(picture, heads.picture), label: head(label, heads.label), words: head(words, heads.words), group: head(group, heads.group), colour: head(colour, heads.colour) },
    rows: rows.map((row) => ({ picture: cell(row, picture), label: cell(row, label), words: cell(row, words), group: cell(row, group), colour: cell(row, colour) })),
    shape: empty.shape,
  };
}

function writePictures(model) {
  const rows = model.rows.filter(filled);
  const has = (key) => rows.some((row) => plainText(row[key]).trim());
  const columns = ['picture', 'label', ...['words', 'group', 'colour'].filter(has)];
  const header = columns.map((key) => model.heads[key]);
  return {
    settings: {
      picture: model.heads.picture,
      label: model.heads.label,
      words: has('words') ? model.heads.words : '',
      by: has('group') ? model.heads.group : '',
      'colour by': has('colour') ? model.heads.colour : '',
      shape: model.shape && model.shape !== WALL_SHAPES[0] ? model.shape : '',
      count: '',
    },
    table: tableOf(header, rows.map((row) => columns.map((key) => row[key] ?? '')), []),
  };
}

/** A picture of the case as a wall's cell writes it: `[[media:id|label]]`. */
export function pictureCell(entity) {
  return `[[media:${entity.id}|${String(entity.label ?? '').replace(/[[\]|\n]/g, '').trim() || 'Picture'}]]`;
}

/**
 * The rows a wall gains from pictures of the case picked in Fill from the case, in their
 * order: each its chip, and as its label the number its name holds (`vehicle-07.jpg` is
 * `#7`), else its name. A picture the wall shows already is left out.
 */
export function pictureRows(entities, rows = []) {
  const held = new Set(rows.map((row) => pictureRef(row.picture)).filter(Boolean));
  return entities.filter((entity) => !held.has(entity.id)).map((entity) => {
    const name = String(entity.label ?? '').replace(/\.[A-Za-z0-9]{2,5}$/, '');
    const number = /(\d+)(?!.*\d)/.exec(name);
    return { picture: pictureCell(entity), label: number ? `#${Number(number[1])}` : name, words: '', group: '', colour: '' };
  });
}

// -- writing a form into a block ------------------------------------------------------------

const RIGHT = 'right';
/** The chart's own fallback colours (`notes_charts.CATEGORICAL`), offered after the case's. */
export const CHART_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const tableOf = (header, rows, align) => serializeTable(newTable({ header, rows, align }));
/** Whether a row holds something written in it. */
export const filled = (row) => Object.values(row).some((value) => (Array.isArray(value) ? value.some((one) => String(one ?? '').trim()) : typeof value === 'string' && value.trim()));

/** The heading of a column of counts, `(at least)` when they are floors. */
export function countHeading(name, floor) {
  return floor ? `${name} (at least)` : name;
}

/**
 * The block with `model` written: the settings its kind reads (the lines it owns only,
 * every other line kept) and its table in the shape the kind reads.
 */
export function writeForm(source, kind, model) {
  const form = FORMS[kind];
  if (!form) return source;
  const write = { timeline: writeTimeline, figures: writeFigures, categories: writeCategories, line: writeLine, pictures: writePictures }[form.family];
  const { settings, table } = write(model, form);
  return withTable(withSettings(source, settings), table);
}

function writeTimeline(model) {
  const rows = model.rows.filter(filled);
  const has = (key) => rows.some((row) => plainText(row[key] ?? '').trim());
  const columns = ['when', 'what', ...['until', 'colour'].filter(has)];
  return {
    settings: {
      'colour by': has('colour') ? model.heads.colour : '',
      layout: model.layout && model.layout !== 'auto' ? model.layout : '',
      labels: model.short ? 'short' : '',
    },
    table: tableOf(columns.map((key) => model.heads[key]), rows.map((row) => columns.map((key) => row[key] ?? '')), []),
  };
}

function writeFigures(model) {
  const rows = model.rows.filter((row) => String(row.figure ?? '').trim() || String(row.words ?? '').trim());
  return {
    settings: {},
    table: tableOf([model.heads.figure, model.heads.words], rows.map((row) => [row.floor && row.figure ? `at least ${row.figure}` : row.figure, row.words]), []),
  };
}

function writeCategories(model, form) {
  const rows = model.rows.filter(filled);
  const count = countHeading(model.heads.count, model.floor);
  const header = form.split ? [model.heads.category, model.heads.split, count] : [model.heads.category, count];
  const cells = rows.map((row) => (form.split ? [row.category, row.split, row.count] : [row.category, row.count]));
  const whole = form.whole ? model.whole ?? { name: '', amount: '' } : { name: '', amount: '' };
  if (whole.name.trim()) cells.push(form.split ? [whole.name, '', whole.amount] : [whole.name, whole.amount]);
  const align = form.split ? [null, null, RIGHT] : [null, RIGHT];
  const names = new Set(rows.map((row) => plainText(form.split ? row.split : row.category).toLowerCase()));
  const kept = (pairs) => pairs.filter(([name]) => names.has(name.toLowerCase()));
  return {
    settings: {
      count, by: model.heads.category, 'colour by': form.split ? model.heads.split : '',
      ...(form.colours || form.split ? { colours: writeColours(kept(model.colours ?? [])) } : {}),
      ...(form.icons ? { icons: writePairs(kept(model.icons ?? [])) } : {}),
      ...(form.whole ? { of: whole.name.trim() ? whole.name.trim() : String(whole.amount ?? '').trim() } : {}),
    },
    table: tableOf(header, cells, align),
  };
}

function writeLine(model) {
  const many = model.series.length > 1;
  const rows = model.rows.filter(filled);
  if (!many) {
    return {
      settings: { by: model.heads.x, count: model.heads.value, 'colour by': '' },
      table: tableOf([model.heads.x, model.heads.value], rows.map((row) => [row.x, row.values[0] ?? '']), [null, RIGHT]),
    };
  }
  const cells = [];
  for (const row of rows) {
    const values = model.series.map((name, at) => [name, row.values[at] ?? '']).filter(([, value]) => String(value).trim());
    if (!values.length) cells.push([row.x, model.series[0], '']);
    for (const [name, value] of values) cells.push([row.x, name, value]);
  }
  return {
    settings: { by: model.heads.x, count: model.heads.value, 'colour by': model.heads.series },
    table: tableOf([model.heads.x, model.heads.series, model.heads.value], cells, [null, null, RIGHT]),
  };
}

/** The block a kind starts with from scratch: its kind, the columns it reads, no row. */
export function starterBlock(kind) {
  const form = FORMS[kind];
  const block = `::: chart\nkind: ${kind}\n:::`;
  const { model } = readForm(block, kind);
  return form ? writeForm(block, kind, model) : block;
}

/** Whether a block's table holds a row with something written in it. */
export function hasRows(source) {
  const { table } = readChart(source);
  return Boolean(table?.rows.some((row) => row.some((cell) => plainText(cell))));
}

// -- what Fill from the case writes ------------------------------------------------------------

/** A day of the case (`2026-10-05`) written at a precision, as the timeline writes it. */
export function caseDay(iso, precision = 'day') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return '';
  return writeWhen({ precision, year: +match[1], month: +match[2], day: +match[3] });
}

/**
 * The case's events as the timeline's rows would hold them, `{ event, row, ticked, said }`:
 * an event the table holds already, a refuted one, or one written twice the same is listed
 * unticked and says why.
 */
export function eventRows(items, rows = []) {
  const key = (row) => `${plainText(row.when).toLowerCase()}|${plainText(row.until).toLowerCase()}|${plainText(row.what).toLowerCase()}`;
  const held = new Set(rows.map(key));
  const seen = new Set();
  return items.map((event) => {
    const when = caseDay(event.day, event.precision);
    const until = event.last ? caseDay(event.last, event.precision) : '';
    // a month or a year read as its days is one month or one year, not a period
    const row = { when, until: until === when ? '' : until, what: event.what };
    const known = key(row);
    const said = held.has(known) ? 'already in the chart' : seen.has(known) ? 'the same as the one above' : event.refuted ? 'refuted' : '';
    seen.add(known);
    return { event, row, ticked: !said, said };
  });
}

/** The rows a count answered (`chartCounts`) makes for a family: categories and counts, figures, a line's values. */
export function countedRows(answer, family, { split = false } = {}) {
  const rows = answer?.rows ?? [];
  if (family === 'figures') return rows.map((row) => ({ figure: row.count, words: row.value, floor: Boolean(answer.floor) }));
  if (family === 'line') {
    const names = [...new Set(rows.map((row) => row.split))];
    const byX = new Map();
    for (const row of rows) {
      if (!byX.has(row.value)) byX.set(row.value, { x: row.value, values: names.map(() => '') });
      byX.get(row.value).values[names.indexOf(row.split)] = row.count;
    }
    return { series: names.length ? names : [''], rows: [...byX.values()] };
  }
  return rows.map((row) => ({ category: row.value, split: split ? row.split : '', count: row.count }));
}

/** What a count left out, in one sentence, or ''. */
export function leftOutSaid(answer) {
  const parts = [];
  if (answer?.blank) parts.push(`${answer.blank} with no value`);
  if (answer?.unread) parts.push(`${answer.unread} with no number or day it can read`);
  if (answer?.totals) parts.push(`${answer.totals} total row${answer.totals === 1 ? '' : 's'}`);
  return parts.length ? `Left out: ${parts.join(', ')}.` : '';
}
