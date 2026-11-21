/**
 * Pictures in a table: a column of them, one picture of the case a cell (a media
 * chip, `[[media:id|label]]`), as the wall of losses needs one frame per vehicle.
 *
 * - A column holds pictures when its header names them (Picture, Photo, Frame…) or
 *   one of its cells holds one already.
 * - A row names a video and a time when one of its cells cites a video of the case
 *   (`[[entity:id|Video 1]]`) next to a time (`4:18`), or a column's header cites the
 *   video and the row's cell under it holds the time (`S04 0:23-0:37`). The first
 *   one found, left to right, is the row's.
 * - An empty picture cell in such a row offers to cut that frame in Inspect.
 *
 * A cell is picked while it is being typed in, and stays picked once the keyboard
 * leaves for another tool, so a tool's Put in lands in it rather than under the
 * table. The pick is kept by note (`pickCell`), since the note on the side and the
 * Notebook show the same text in two editors; it goes once the note's text is
 * pressed elsewhere, Escape leaves the grid, or a picture landed in it.
 */
import { EditorView } from '@codemirror/view';

import { heldRange, holdRange, placeText, releaseRange } from './puts.js';
import { changeTable, tablesOf } from './gridEdits.js';
import { resolve } from './state.js';
import { plainText, setCell } from './tableText.js';

const PICTURE_HEADER = /\b(?:pictures?|photos?|photographs?|images?|frames?|stills?|thumbnails?|screenshots?)\b/i;
const MEDIA_CHIP = /\[\[media:[A-Za-z0-9_-]+\|[^\]\n]+\]\]/;
const CITED = /\[\[(?:entity|media):([A-Za-z0-9_-]+)\|[^\]\n]+\]\]/g;
// `4:18`, `0:23-0:37` (its start), `1:02:07`, `6:20.5`; a clock in a coordinate or a date is no time
const TIME = /(?<![\d:.])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?(?![\d:])/;

/** Seconds into a video from the first time a text writes (`S04 0:23-0:37` is 23), or null. */
export function readTime(text) {
  const match = TIME.exec(plainText(text));
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  if (Number(seconds) > 59 || (hours !== undefined && Number(minutes) > 59)) return null;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0);
}

/** Whether a cell holds nothing, or only a dash written for nothing. */
export function isBlankCell(text) {
  return /^[\s–—-]*$/.test(plainText(text));
}

/** The columns of `table` that hold pictures, as a set of indexes. */
export function pictureColumns(table) {
  const found = new Set();
  table.header.forEach((head, column) => {
    if (PICTURE_HEADER.test(plainText(head)) || table.rows.some((cells) => MEDIA_CHIP.test(cells[column] ?? ''))) found.add(column);
  });
  return found;
}

function isVideo(entity) {
  return entity?.type === 'media' && entity.attrs?.kind === 'video' && Boolean(entity.attrs?.path);
}

/** The first video of the case a cell cites, or null. */
export function videoIn(markdown, info) {
  for (const match of String(markdown ?? '').matchAll(CITED)) {
    const entity = resolve(info, match[1]);
    if (isVideo(entity)) return entity;
  }
  return null;
}

/**
 * The video and the time `row` of `table` names, `{ entity, time }`, as the module
 * says it reads them, or null.
 */
export function rowVideo(table, row, info) {
  const cells = table.rows[row];
  if (!cells || !info) return null;
  for (let column = 0; column < cells.length; column += 1) {
    const entity = videoIn(cells[column], info);
    if (!entity) continue;
    const time = readTime(cells[column].replace(CITED, ' ')) ?? cells.map(readTime).find((value) => value !== null) ?? null;
    if (time !== null) return { entity, time };
  }
  for (let column = 0; column < table.header.length; column += 1) {
    const entity = videoIn(table.header[column], info);
    const time = entity ? readTime(cells[column] ?? '') : null;
    if (time !== null) return { entity, time };
  }
  return null;
}

/** `4:18`, `1:02:07`: a time as the offer names it. */
export function timeLabel(seconds) {
  const whole = Math.floor(Number(seconds) || 0);
  const pad = (value) => String(value).padStart(2, '0');
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours}:${pad(minutes)}:${pad(whole % 60)}` : `${minutes}:${pad(whole % 60)}`;
}

// -- the picked cell ---------------------------------------------------------------

const picked = new Map();

/**
 * The cell of a note a picture goes to: `{ table, row, col }`, the table counted
 * among the note's tables from the top, or null to let it go. `key` names the note
 * (the editor's `noteKey`); a note with none keeps no pick.
 */
export function pickCell(key, cell) {
  if (!key) return;
  if (cell) picked.set(key, { table: cell.table, row: cell.row, col: cell.col });
  else picked.delete(key);
}

/** The cell picked in the note named `key`, or null. */
export function pickedCell(key) {
  return key ? picked.get(key) ?? null : null;
}

/** The table a pick names, as the note stands now, or null when it no longer has that cell. */
export function cellTable(state, cell) {
  const found = cell ? tablesOf(state)[cell.table] : null;
  if (!found || cell.col >= found.table.header.length || cell.row < -1 || cell.row >= found.table.rows.length) return null;
  return found;
}

/**
 * Put the picture `text` names (a put's `[[media:…]]` line, its size and caption
 * left out) in the picked `cell`, after what the cell holds unless that is nothing
 * or a dash. One transaction. Answers what a put landing answers (`{ id, text }`,
 * the chip held for the put's Undo), or null when the cell is gone or `text`
 * names no picture.
 */
export function putInCell(view, cell, text) {
  const found = cellTable(view.state, cell);
  const chip = MEDIA_CHIP.exec(String(text ?? ''))?.[0];
  if (!found || !chip) return null;
  const { row, col } = cell;
  const now = row === -1 ? found.table.header[col] : found.table.rows[row][col];
  const next = isBlankCell(now) ? chip : `${now} ${chip}`;
  const changed = changeTable(view, found.from, (table) => setCell(table, row, col, next), { userEvent: 'input' });
  if (!changed) return null;
  // the chip on its row's line: the header is the table's first line, its rows start two lines under it
  const line = view.state.doc.line(view.state.doc.lineAt(changed.from).number + (row === -1 ? 0 : row + 2));
  const at = line.text.lastIndexOf(chip);
  if (at < 0) return null;
  const id = holdRange(view, line.from + at, line.from + at + chip.length);
  // the note brings its row into sight, then the grid lights the cell once it is drawn
  view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
  const light = () => gridAt(view, changed.from)?.flash(row, col);
  if (gridAt(view, changed.from)) light();
  else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(light);
  return { id, text: chip, cell: true };
}

/**
 * The grid drawn for the table starting at `pos`, or null (`editor/tableGrid.js` hangs it on
 * its box): a table's own, or a chart's numbers, whose table stands inside its block.
 */
export function gridAt(view, pos) {
  for (const box of view.contentDOM.querySelectorAll('.cm-grid-block, .cm-rows-grid')) {
    try {
      if (box.classList.contains('cm-rows-grid') ? box.grid?.from === pos : view.posAtDOM(box) === pos) return box.grid ?? null;
    } catch { /* a box being taken down */ }
  }
  return null;
}

/**
 * Hold where a tool's picture goes while a cell of the note named `key` is picked:
 * `{ cell, held }`, the table's start held as the note changes, or null when no
 * cell is picked (the put lands at the cursor, as before).
 */
export function holdCell(view, key) {
  const cell = pickedCell(key);
  const found = cellTable(view.state, cell);
  return found ? { cell, held: holdRange(view, found.from) } : null;
}

/** Let go of a place `holdCell` held. */
export function releaseCell(view, spot) {
  releaseRange(view, spot.held);
}

/**
 * Put a tool's picture where `spot` holds: in its cell, the pick then let go; under
 * its table when the cell is gone or the put is no picture. Answers what landed.
 */
export function placeInCell(view, spot, text, key, options = {}) {
  const at = heldRange(view, spot.held);
  releaseRange(view, spot.held);
  const index = at ? tablesOf(view.state).findIndex((found) => found.from === at.from) : -1;
  const landed = putInCell(view, index >= 0 ? { ...spot.cell, table: index } : spot.cell, text);
  if (landed) {
    pickCell(key, null);
    return landed;
  }
  const found = at ? tablesOf(view.state).find((item) => item.from <= at.from && at.from <= item.end) : null;
  return placeText(view, found ? found.end : view.state.doc.length, text, options);
}
