/**
 * What a grid says of a column the chart reads as days or as numbers, and of each of its
 * cells, so the analyst sees what to write and what was understood: The numbers of a chart
 * (`notes/editor/rowsGrid.js`) and a sheet's `when` and `number` columns (`tools/Sheet.svelte`).
 *
 * - the column's heading takes a quiet tag, `Days` or `Numbers`; in The numbers, any other
 *   column the drawing reads says what it does with it (`ROLES`), as the engine names it;
 * - a cell that reads but is written otherwise than the chart prints it shows the reading
 *   after its words, muted (`5 mars 2026` shows `5 Mar 2026`);
 * - a cell that does not read is underlined, and its title says what would;
 * - an empty cell shows an example, grey.
 *
 * Nothing here writes a cell: what the analyst typed stays as typed.
 */
import { blankCell, dayColumn, dayColumns, dayText, numberText, plainText, readDay, readNumber, separators } from './cellRead.js';
import { parseNumber, parseWhen } from './sheetRoles.js';

export const DAYS = 'days';
export const NUMBERS = 'numbers';

/** The tag a column's heading takes. */
export const EXPECTS = { [DAYS]: 'Days', [NUMBERS]: 'Numbers' };
/** Two ways of writing what a column takes, said on hover. */
export const EXAMPLES = { [DAYS]: '5 Mar 2026 or 2026-03-05', [NUMBERS]: '1 200 or at least 60' };
/** What the tag says on hover. */
export const EXPECTS_TITLE = {
  [DAYS]: `The chart reads this column as days, e.g. ${EXAMPLES[DAYS]}`,
  [NUMBERS]: `The chart reads this column as numbers, e.g. ${EXAMPLES[NUMBERS]}`,
};
/**
 * The tag a heading of a chart's rows takes for what its drawing does with the column, by
 * the role the engine names (`engine/notes_charts.py` `COLUMN_ROLES`), and what it says on hover.
 */
export const ROLES = {
  picture: 'Picture',
  label: 'Label',
  words: 'Words',
  groups: 'Groups',
  parts: 'Parts',
  colour: 'Colour',
  icon: 'Icon',
  flag: 'Flag',
  count: 'Count',
  start: 'When',
  until: 'Until',
  event: 'Words',
  along: 'Along',
  height: 'Height',
  filter: 'Filter',
};
export const ROLE_TITLE = {
  picture: 'The picture each frame shows',
  label: 'The label under each picture',
  words: 'The words under each picture',
  groups: 'The chart groups its rows by this column',
  parts: 'Each value is a part of the whole',
  colour: 'Each value takes its own colour',
  icon: 'The icon each row is drawn as',
  flag: 'The flag shown beside each group',
  count: 'The chart adds up this column',
  start: 'The day each event starts',
  until: 'The day a period runs until',
  event: 'The words of each event',
  along: 'The line runs along this column',
  height: 'How high the line stands at each point',
  filter: 'The chart keeps or leaves out rows by this column',
};

/** How the drawing reads the cells of a column by its role: a timeline's days, a count's or a
 * line's amounts, a line's run either (`null`, by its cells). Every other part (a grade written
 * 1, 2, 3 that colours the bars) is read as written, never as days or amounts. */
export const ROLE_READS = { start: DAYS, until: DAYS, count: NUMBERS, height: NUMBERS, along: null };

/** What an empty cell shows. */
export const EXAMPLE = { [DAYS]: '5 Mar 2026', [NUMBERS]: '1 200' };
/** What a cell that does not read says on hover. */
export const UNREAD = {
  [DAYS]: 'Not read as a day. Try 5 Mar 2026, 05/03/2026 or 2026-03-05, in any language.',
  [NUMBERS]: 'Not read as a number. Try 1200, 1 200, 1,5 or at least 60.',
};

/**
 * The one tag a heading of a chart's rows takes, `{ text, title }`, or null: `Days` or
 * `Numbers` where the chart reads them (`read`, `columnReads`), else what its drawing does
 * with the column (`role`, a key of `ROLES`).
 */
export function headingTag(read, role) {
  if (read) {
    // a timeline's Until says what it is, then how to write it
    const part = typeof role === 'string' && Object.hasOwn(ROLE_READS, role) ? ROLE_TITLE[role] : '';
    return { text: EXPECTS[read.kind], title: part ? `${part}, e.g. ${EXAMPLES[read.kind]}` : EXPECTS_TITLE[read.kind] };
  }
  if (typeof role === 'string' && Object.hasOwn(ROLES, role)) return { text: ROLES[role], title: ROLE_TITLE[role] };
  return null;
}

/**
 * The columns a drawing reads as days or as numbers when the engine names each column's part
 * (`roles`, see `ROLE_READS`): `Map(column → { kind, decimal })`, every cell of such a column
 * checked, however few of them read yet. A timeline's Until written `ongoing` is underlined.
 */
export function roleReads(table, roles) {
  const reads = new Map();
  if (!table?.header?.length) return reads;
  const { rows } = table;
  roles.forEach((role, column) => {
    if (typeof role !== 'string' || !Object.hasOwn(ROLE_READS, role)) return;
    const kind = ROLE_READS[role] ?? (dayColumn(rows, column) ? DAYS : NUMBERS);
    if (kind === DAYS) {
      reads.set(column, { kind });
      return;
    }
    reads.set(column, { kind, decimal: separators(rows.map((row) => row[column] ?? '')).decimal });
  });
  return reads;
}

const FAMILY_DAYS = new Set(['timeline', 'line']);
const FAMILY_NUMBERS = new Set(['figures', 'categories', 'line']);

/**
 * The columns a chart of `family` (`chartFormText.FORMS`) reads as days or as numbers, as
 * the engine decides it: `Map(column → { kind, decimal })`. Days where the chart reads days
 * (a timeline, a line), by `dayColumns`; numbers where three quarters of the filled cells
 * read as one. `skip` holds the columns it does not read as either: the ones not drawn, and
 * the categories a chart counts by.
 */
export function columnReads(table, family, skip = new Set()) {
  const reads = new Map();
  if (!table?.header?.length) return reads;
  const { header, rows } = table;
  if (FAMILY_DAYS.has(family)) {
    for (const column of dayColumns(header, rows)) if (!skip.has(column)) reads.set(column, { kind: DAYS });
  }
  if (!FAMILY_NUMBERS.has(family)) return reads;
  header.forEach((_, column) => {
    // a column of days or years is never a column of amounts: `2024` prints 2024, not 2,024
    if (reads.has(column) || skip.has(column) || dayColumn(rows, column)) return;
    const texts = rows.map((row) => row[column] ?? '');
    const marks = separators(texts);
    const filled = texts.filter((text) => !blankCell(text)).length;
    const count = texts.filter((text) => readNumber(text, { decimal: marks.decimal })?.value != null).length;
    if (count > 0 && count >= 0.75 * filled) reads.set(column, { kind: NUMBERS, decimal: marks.decimal });
  });
  return reads;
}

/** A column's reading as a key, to tell when a grid must draw its cells again. */
export function readsKey(reads) {
  return [...reads].map(([column, read]) => `${column}:${read.kind}${read.decimal ?? ''}`).join(',');
}

const squash = (text) => text.toLowerCase().replace(/[\s'’]/g, '');

/** The number as the chart prints it, and whether the cell already writes it so. */
function numberSaid(plain, reading) {
  const printed = `${reading.floor ? 'at least ' : ''}${numberText(reading.value)}`;
  let core = squash(plain);
  if (reading.thousands) core = core.split(reading.thousands).join('');
  const unit = reading.unit.toLowerCase().replace(/\s/g, '');
  if (unit && core.endsWith(unit)) core = core.slice(0, -unit.length);
  else if (unit && core.startsWith(unit)) core = core.slice(unit.length);
  return core === squash(printed).replace(/,/g, '') ? '' : printed;
}

/**
 * What a cell of a column read as `read` (`columnReads`) says of itself: `{ example }` when
 * empty, `{ unread }` (the title) when it does not read, `{ reading }` when it reads but is
 * written otherwise than the chart prints it, else null. A dash or a `?` says unknown: null.
 */
export function cellSays(text, read) {
  if (!read) return null;
  const plain = plainText(text).split(/\s+/).join(' ').trim();
  if (!plain) return { example: EXAMPLE[read.kind] };
  if (blankCell(plain)) return null;
  if (read.kind === DAYS) {
    const day = readDay(plain);
    if (!day) return { unread: UNREAD[DAYS] };
    const printed = dayText(day);
    return printed === plain ? null : { reading: printed };
  }
  const reading = readNumber(plain, { decimal: read.decimal });
  if (reading?.value == null) return { unread: UNREAD[NUMBERS] };
  const printed = numberSaid(plain, reading);
  return printed ? { reading: printed } : null;
}

/** What a sheet's column says it holds, by its role: days for a `when` (not a column of bare clocks), numbers for a `number`. */
export function sheetExpects(role) {
  if (role?.kind === 'number') return NUMBERS;
  return role?.kind === 'when' && role.shape !== 'time' ? DAYS : '';
}

/** A moment a sheet's `when` column read (`sheetRoles.parseWhen`), as the chart prints a day: `5 Mar 2026 06:42`. */
export function momentText(read) {
  if (read.shape !== 'moment') return read.text;
  const [date, clock] = read.text.split('T');
  const precision = { 4: 'year', 7: 'month' }[date.length] ?? 'day';
  const day = dayText({ precision, date: `${date}-01-01`.slice(0, 10), year: true });
  return clock ? `${day} ${clock}` : day;
}

/**
 * What a sheet's cell says of itself under its column's role, as `cellSays`, read the way
 * the role reads it (`sheetRoles.parseWhen`, `parseNumber`): `{ example }`, `{ unread }`,
 * `{ reading }`, or `{}` when it is written as the chart prints it. null for a column that
 * expects neither days nor numbers.
 */
export function sheetSays(role, cell) {
  const kind = sheetExpects(role);
  if (!kind) return null;
  const plain = String(cell ?? '').split(/\s+/).join(' ').trim();
  if (!plain) return { example: EXAMPLE[kind] };
  if (kind === DAYS) {
    const read = parseWhen(plain, role);
    if (!read) return { unread: UNREAD[DAYS] };
    const printed = momentText(read);
    return printed === plain ? {} : { reading: printed };
  }
  const value = parseNumber(plain);
  if (value === null) return { unread: UNREAD[NUMBERS] };
  const reading = readNumber(plain);
  // read alike by both: said as the chart says it; read by the sheet's own grammar
  // (`1,500` is 1.5 there), the value it read
  const printed = reading?.value === value ? numberSaid(plain, reading) : sameDigits(plain, numberText(value));
  return printed ? { reading: printed } : {};
}

function sameDigits(plain, printed) {
  return squash(plain) === squash(printed).replace(/,/g, '') ? '' : printed;
}
