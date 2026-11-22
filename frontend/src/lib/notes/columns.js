/**
 * A row of columns in a note: `:::: columns` around two or three `::: column` blocks,
 * pictures or words side by side. The PDF, the HTML page and WordPress read the same
 * lines (`engine/notes_markdown.py`).
 *
 * ```
 * :::: columns
 * ::: column
 * [[media:e_ab12|Posted photo]]{caption="The photo as posted"}
 * :::
 * ::: column width=66%
 * Words, lists, callouts, case chips, pictures.
 * :::
 * ::::
 * ```
 *
 * A column may say its width; the ones that do not share what is left. A row whose
 * every column holding something holds one picture alone sets its pictures at one
 * height, nothing cropped, whatever the widths say. An empty column prints nothing.
 *
 * Plain functions over the text, so the editor's gestures, the `/` menu and the preview
 * read and write the same lines, each tested without a browser. A gesture answers the
 * text that replaces the whole block: what a column loses goes under the row, never away.
 */
import { PICTURE_LINE, picturesIn, writeAttrs } from './pictureSize.js';

export const COLUMNS_OPEN = /^::::[ \t]*columns[ \t]*$/;
export const COLUMNS_CLOSE = /^::::[ \t]*$/;
export const COLUMN_OPEN = /^:::[ \t]*column(?:[ \t]+([^\n]*?))?[ \t]*$/;
export const COLUMN_CLOSE = /^:::[ \t]*$/;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 3;
/** The share of the row the wide one of two columns takes, in percent. */
export const WIDE = 66;

/** What `/` › Columns writes: two empty columns, a line in each for the caret. */
export const EMPTY_COLUMNS = ':::: columns\n::: column\n\n:::\n::: column\n\n:::\n::::';
/** Where the caret lands in `EMPTY_COLUMNS`: the first column's empty line. */
export const EMPTY_FIRST = ':::: columns\n::: column\n'.length;

/** The widths two columns of words can take; three are always equal. */
export const WIDTHS = [
  { id: 'equal', label: 'Equal', widths: [null, null] },
  { id: 'left', label: 'Wide left', widths: [WIDE, null] },
  { id: 'right', label: 'Wide right', widths: [null, WIDE] },
];

/** The width a column's line writes, in percent, or null for its share of what is left. */
export function widthIn(attrs) {
  const match = /\bwidth[ \t]*=[ \t]*(\d{1,3}(?:\.\d+)?)[ \t]*%?/.exec(String(attrs ?? ''));
  const value = match ? Number(match[1]) : NaN;
  return value > 0 && value < 100 ? Math.round(value * 10) / 10 : null;
}

/**
 * A block's lines read: its columns in order, each `{ width, open, close, lines, text }`
 * (`open` and `close` the indexes of its fence lines in the block, `close` -1 when it
 * runs to the block's end), and the lines standing in no column (`stray`, `{ at, text }`),
 * kept so nothing written is lost. The block's own fence lines may be left out.
 */
export function readColumns(source) {
  const all = Array.isArray(source) ? source : String(source ?? '').split('\n');
  const start = COLUMNS_OPEN.test(all[0] ?? '') ? 1 : 0;
  const end = all.length > start && COLUMNS_CLOSE.test(all.at(-1)) ? all.length - 1 : all.length;
  const columns = [];
  const stray = [];
  let current = null;
  for (let at = start; at < end; at += 1) {
    const line = all[at];
    if (!current) {
      const open = COLUMN_OPEN.exec(line);
      if (open) {
        current = { width: widthIn(open[1]), open: at, close: -1, lines: [] };
        columns.push(current);
      } else if (line.trim()) stray.push({ at, text: line });
      continue;
    }
    if (COLUMN_CLOSE.test(line)) {
      current.close = at;
      current = null;
    } else current.lines.push(line);
  }
  for (const column of columns) column.text = trimLines(column.lines.join('\n'));
  return { columns, stray };
}

/** Text without the empty lines around it. */
function trimLines(text) {
  return String(text ?? '').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '').replace(/^[ \t]*$/, '');
}

/** The block the columns write, `{ width, text }` each: an empty one keeps a line for the caret. */
export function writeColumns(columns) {
  const out = [':::: columns'];
  for (const column of columns) {
    out.push(column.width ? `::: column width=${column.width}%` : '::: column', trimLines(column.text), ':::');
  }
  out.push('::::');
  return out.join('\n');
}

/** The block `columns` write, then `after` under it, a blank line between: what replaces a block. */
function blockThen(columns, after = []) {
  const under = after.map(trimLines).filter(Boolean);
  return [writeColumns(columns), ...under].join('\n\n');
}

/** The words standing in no column, which a gesture puts under the row. */
function strayText(read) {
  return read.stray.map((line) => line.text).join('\n');
}

/** Whether a column holds nothing. */
export function isEmptyColumn(column) {
  return !trimLines(column?.text ?? '');
}

/** The picture a column holds alone, `{ line, ...picture }` as `picturesIn` reads it, or null. */
export function pictureOf(column) {
  const lines = String(column?.text ?? '').split('\n').filter((line) => line.trim());
  if (lines.length !== 1 || !PICTURE_LINE.test(lines[0])) return null;
  const [picture] = picturesIn(lines[0]);
  return picture ? { line: lines[0].trim(), ...picture } : null;
}

/** Whether every column holding something holds a picture alone, and one does: they share one height. */
export function picturesOnly(columns) {
  const full = columns.filter((column) => !isEmptyColumn(column));
  return full.length > 0 && full.every((column) => pictureOf(column));
}

/**
 * The share of the row each column takes, from 0 to 1, by the widths written: the ones
 * that write none share what is left, and shares that run over are scaled to fit.
 */
export function columnShares(columns) {
  const count = columns.length;
  if (!count) return [];
  const written = columns.map((column) => (column.width > 0 ? column.width : null));
  const taken = written.reduce((sum, width) => sum + (width ?? 0), 0);
  const free = written.filter((width) => width === null).length;
  const left = Math.max(0, 100 - taken);
  const widths = written.map((width) => width ?? (free ? Math.max(left / free, 10) : 0));
  const total = widths.reduce((sum, width) => sum + width, 0) || 1;
  return widths.map((width) => width / total);
}

/** The width two columns take now, `equal`, `left` or `right`, or null for anything else. */
export function widthsOf(columns) {
  if (columns.length !== 2) return columns.every((column) => !column.width) ? 'equal' : null;
  const [a, b] = columns.map((column) => column.width ?? null);
  return WIDTHS.find((preset) => preset.widths[0] === a && preset.widths[1] === b)?.id ?? null;
}

// -- gestures: each answers the text that replaces the whole block -------------------------

/** The block with `count` columns: one added empty, or the last ones taken off, their words put under the row. */
export function withCount(source, count) {
  const read = readColumns(source);
  const wanted = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, count));
  const columns = read.columns.map((column) => ({ width: column.width, text: column.text }));
  const after = [];
  while (columns.length > wanted) after.unshift(columns.pop().text);
  while (columns.length < wanted) columns.push({ width: null, text: '' });
  // three columns are always equal; two keep the widths they had only if they had two
  const sized = wanted === read.columns.length ? columns : columns.map((column) => ({ ...column, width: null }));
  return blockThen(sized, [...after, strayText(read)]);
}

/** Two columns at the widths `id` names (`WIDTHS`). */
export function withWidths(source, id) {
  const preset = WIDTHS.find((one) => one.id === id);
  const read = readColumns(source);
  if (!preset || read.columns.length !== 2) return null;
  const columns = read.columns.map((column, at) => ({ width: preset.widths[at], text: column.text }));
  return blockThen(columns, [strayText(read)]);
}

/** The block with column `index` holding `text`, a picture line for an empty column. */
export function withColumnText(source, index, text) {
  const read = readColumns(source);
  if (!read.columns[index]) return null;
  const columns = read.columns.map((column, at) => ({ width: column.width, text: at === index ? text : column.text }));
  return blockThen(columns, [strayText(read)]);
}

/** Column `index` moved one place left (`step` -1) or right (1), its width kept with the place. */
export function movedColumn(source, index, step) {
  const read = readColumns(source);
  const other = index + step;
  if (!read.columns[index] || !read.columns[other]) return null;
  const texts = read.columns.map((column) => column.text);
  [texts[index], texts[other]] = [texts[other], texts[index]];
  return blockThen(read.columns.map((column, at) => ({ width: column.width, text: texts[at] })), [strayText(read)]);
}

/**
 * Column `index` taken out of the row and put under it, on its own. A row left with one
 * column holding something is a row no more: its words stand in its place.
 */
export function takenOut(source, index) {
  const read = readColumns(source);
  const out = read.columns[index];
  if (!out) return null;
  const kept = read.columns.filter((_, at) => at !== index);
  if (kept.filter((column) => !isEmptyColumn(column)).length <= 1) {
    return [...kept.map((column) => column.text), out.text, strayText(read)].map(trimLines).filter(Boolean).join('\n\n');
  }
  const columns = kept.map((column) => ({ width: kept.length === 2 ? column.width : null, text: column.text }));
  return blockThen(columns, [out.text, strayText(read)]);
}

/** Every column's words one under the other, in order: the row taken apart. */
export function takenApart(source) {
  const read = readColumns(source);
  return [...read.columns.map((column) => column.text), strayText(read)].map(trimLines).filter(Boolean).join('\n\n');
}

/** A picture's line as a column holds it: its size and place dropped, since it fills its column. */
export function inRowLine(line) {
  const text = String(line ?? '').trim();
  const [picture] = picturesIn(text);
  if (!picture) return text;
  return `${text.slice(0, picture.attrFrom)}${writeAttrs({ caption: picture.caption, rest: picture.rest })}`;
}

/** A row of two columns holding `first` and `second`, a picture's line or any words. */
export function rowOf(first, second) {
  return writeColumns([{ width: null, text: inRowLine(first) }, { width: null, text: inRowLine(second) }]);
}

/**
 * A row with `line` added as a new column at the left (`side` 'left') or the right, or
 * null when the row has its three already.
 */
export function withColumnAdded(source, line, side) {
  const read = readColumns(source);
  if (read.columns.length >= MAX_COLUMNS) return null;
  const columns = read.columns.map((column) => ({ width: null, text: column.text }));
  const added = { width: null, text: inRowLine(line) };
  if (side === 'left') columns.unshift(added);
  else columns.push(added);
  return blockThen(columns, [strayText(read)]);
}

/**
 * Every row of columns in a note's lines, `{ first, last }` as line indexes: from its
 * `:::: columns` to its `::::`. One left open is no row, as an unclosed fence is not.
 */
export function rowsIn(lines) {
  const all = Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
  const rows = [];
  let fenced = false;
  for (let at = 0; at < all.length; at += 1) {
    if (/^\s*(```|~~~)/.test(all[at])) fenced = !fenced;
    if (fenced || !COLUMNS_OPEN.test(all[at])) continue;
    let end = at + 1;
    while (end < all.length && !COLUMNS_CLOSE.test(all[end])) end += 1;
    if (end >= all.length) break;
    rows.push({ first: at, last: end });
    at = end;
  }
  return rows;
}
