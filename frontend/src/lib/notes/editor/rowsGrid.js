/**
 * A chart's rows as a grid the analyst types in: The numbers of a chart in the note
 * (`editor/chartBlock.js`) and a panel's rows in the infographic builder. It is the note
 * tables' own grid (`editor/tableGrid.js`), standing over the table inside the block: its
 * cells drawn with their chips, links and pictures, its `@`, its keys (Tab, Enter, the
 * arrows, Escape), a picture of the case dropped on a cell, and the fold of a long table.
 *
 * Where the rows come from decides what a gesture writes (`host.mode`):
 *
 * - **its own rows**: every gesture of a note's table, a cell typed, a row or a column
 *   added, moved, sorted or deleted, cells pasted; each one change to the block's table,
 *   the changed lines only, one Undo step;
 * - **a table of this note** or **a sheet**: a cell typed is written where the rows live,
 *   by the host (`host.writeCells`), and the copy in the note follows. Rows and columns are
 *   the source's, so they are added there;
 * - **a table of another note**: shown, never typed in.
 *
 * A column the chart does not draw stays, greyed and marked "not drawn" (`widget.idle`).
 * A column it reads as days or as numbers says so in its heading, and each of its cells
 * says what the chart reads in it (`widget.reads`, `chartReads`, `lib/cellHints.js`); any
 * other column it draws says what the drawing does with it (`widget.roles`, `chartColumns`).
 *
 * `host` is the block the grid stands in: `start()` where its table's header line stands
 * in the note, `anchor(where)` where the cursor goes on leaving ('pick', 'before', 'after'),
 * `mode`, `whole` (kept across redraws), `tools()` the presses its bar ends with, and
 * `writeCells(found, cells)` for rows that live elsewhere.
 */
import { isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';

import { NUMBERS, cellSays, columnReads, headingTag, readsKey, roleReads } from '../../cellHints.js';
import { Grid } from './tableGrid.js';
import { chartRows } from './chartFigure.js';
import { FORMS, formKind } from './chartFormText.js';
import { readOrigin, setting, tableUnder } from './chartText.js';
import { followSource, forgetFollow } from './follow.js';
import { chain, tableNear, tablesOf } from './gridEdits.js';
import { button } from './gridMenu.js';
import { rovingToolbar } from '../pictureSize.js';
import { OWN } from './dataLine.js';
import { pictureColumns } from './tablePictures.js';
import { plainText, setCell } from './tableText.js';
import { writeThroughSheet } from './throughSheet.js';

const fold = (header) => plainText(header).split(/\s+/).join(' ').toLowerCase();
const NO_READS = new Map();
const NO_ROLES = [];

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * The cells `after` holds that `before` did not, `[{ row, col, text, was }]`: what a
 * gesture of a grid whose rows live elsewhere asks to write there.
 */
export function changedCells(before, after) {
  const cells = [];
  after.rows.forEach((cells_, row) => {
    cells_.forEach((text, col) => {
      const was = before.rows[row]?.[col] ?? '';
      if (text !== was) cells.push({ row, col, text, was });
    });
  });
  return cells;
}

/** A chart's rows drawn as a grid: the note table's grid over the table of a block (`box.grid`). */
export class RowsGrid extends Grid {
  get host() {
    return this.widget.host;
  }

  get from() {
    return this.host.start();
  }

  get structural() {
    return this.host.mode === OWN;
  }

  get picks() {
    return this.host.mode === OWN;
  }

  isWhole() {
    return Boolean(this.host.whole);
  }

  /** The columns the chart reads as days or as numbers (`chartReads`). */
  get reads() {
    return this.widget.reads ?? NO_READS;
  }

  /** What the drawing does with each column, '' for one it does not read (`chartColumns`). */
  get roles() {
    return this.widget.roles ?? NO_ROLES;
  }

  /** What the headings and cells say, as a key, to tell when they must be drawn again. */
  saidKey() {
    return `${readsKey(this.reads)}|${this.roles.join(',')}`;
  }

  render() {
    super.render();
    this.saidDrawn = this.saidKey();
  }

  /** A cell's words, then what the chart reads in it; a heading, then what its column holds or does. */
  fill(cell, pictures) {
    super.fill(cell, pictures);
    if (this.editing?.cell === cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const read = this.reads.get(col);
    const words = cell.querySelector('.cm-grid-text');
    if (!words) return;
    if (row === -1) {
      const said = headingTag(read, this.roles[col]);
      if (!said) return;
      const tag = element('span', 'cm-grid-expects');
      tag.textContent = said.text;
      tag.title = said.title;
      words.after(tag);
      return;
    }
    if (!read) return;
    const says = cellSays(this.textAt(row, col), read);
    if (says?.example) {
      words.dataset.placeholder = says.example;
      words.classList.add('cm-grid-example');
    } else if (says?.unread) {
      words.classList.add('cm-grid-unread');
      words.title = says.unread;
    } else if (says?.reading) {
      const reading = element('span', 'cm-grid-reading');
      reading.textContent = says.reading;
      reading.title = read.kind === NUMBERS ? 'The number the chart draws' : 'The day the chart draws';
      words.append(reading);
    }
  }

  keepWhole(whole) {
    this.host.whole = whole;
  }

  build() {
    const { box } = this;
    box.className = `cm-rows-grid cm-grid-ui${this.writable ? '' : ' cm-grid-locked'}`;
    const frame = element('div', 'cm-grid-frame cm-rows-frame');
    const bar = this.writable ? this.makeBar() : null;
    if (bar) frame.append(bar);
    this.scroller = element('div', 'cm-grid-scroll cm-grid-ui');
    this.sheet = element('table', 'cm-grid');
    this.head = element('thead');
    this.body = element('tbody');
    this.sheet.append(this.head, this.body);
    this.scroller.append(this.sheet);
    this.foot = element('div', 'cm-grid-fold cm-grid-ui');
    const well = element('div', 'cm-grid-well');
    well.append(this.scroller);
    frame.append(well, this.foot);
    box.append(frame);
  }

  /** Row, Column and Paste for its own rows; then what the host adds (As a form, Fill from the case…). */
  makeBar() {
    const extra = this.host.tools?.() ?? [];
    if (!this.structural && !extra.length) return null;
    const bar = element('div', 'cm-grid-bar cm-rows-bar cm-grid-ui');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Rows');
    const tool = (className, options, run) => {
      const node = button(`cm-grid-tool ${className}`, options);
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => run(node));
      bar.append(node);
      return node;
    };
    if (this.structural) {
      tool('cm-grid-add-row', { label: 'Row', iconName: 'plus', title: 'Add a row at the end' }, () => this.addRow());
      tool('cm-grid-add-col', { label: 'Column', iconName: 'plus', title: 'Add a column at the end' }, () => this.addColumn());
      tool('cm-grid-paste', { label: 'Paste from a spreadsheet', iconName: 'clipboard', title: 'Cells copied in a spreadsheet or a web page' },
        (node) => this.pasteBox(node));
    }
    bar.append(element('span', 'cm-grid-spring'));
    for (const one of extra) tool(one.className ?? '', { label: one.label, iconName: one.iconName, title: one.title }, (node) => {
      this.leave('stay');
      one.run(node);
    });
    rovingToolbar(bar);
    return bar;
  }

  /**
   * Leaving writes the cell. Escape picks the chart where it is, the note left where it is
   * scrolled to; outside the note (the infographic builder), the note's cursor stays put.
   */
  leave(where) {
    if (where === 'stay' || where === 'blur' || (where !== 'pick' && !this.host.outside)) return super.leave(where);
    const grid = this.write([this.step(this.close())]);
    grid.dropGhost();
    grid.setPick(null);
    if (this.host.outside) this.host.left?.(where);
    else {
      this.view.dispatch({ selection: { anchor: this.anchorFor('pick') } });
      this.view.focus();
    }
    return grid;
  }

  /** The chart's frame holds it: no room is taken beside the text. */
  fit() {
    this.edges();
  }

  /** The editor's cursor goes to the block's start, so Undo comes back here. */
  engage() {
    const at = this.anchorFor('pick');
    const range = this.view.state.selection.main;
    if (at >= 0 && !(range.empty && range.head === at)) this.view.dispatch({ selection: { anchor: at } });
  }

  anchorFor(where) {
    return this.host.anchor(where);
  }

  toSource() {
    this.leave('stay');
    this.host.toSource?.();
  }

  /**
   * Write `steps` as one gesture. Its own rows: the block's table, as a note's table is
   * written. Rows that live elsewhere: the cells changed go to the host, drawn as typed
   * until the copy in the note follows.
   */
  write(steps) {
    if (this.host.mode === OWN) return super.write(steps);
    const live = steps.filter(Boolean);
    const found = tableNear(this.view.state, this.from);
    if (!live.length || !found) return this;
    const cells = changedCells(found.table, chain(found.table, ...live).table);
    if (!cells.length) return this;
    this.pending = new Map(cells.map((cell) => [`${cell.row},${cell.col}`, cell.text]));
    this.redraw();
    this.host.writeCells(found, cells);
    return this;
  }

  /** A cell typed and sent where its rows live shows its words until the note's copy follows. */
  textAt(row, col) {
    const sent = row >= 0 ? this.pending?.get(`${row},${col}`) : undefined;
    return sent ?? super.textAt(row, col);
  }

  update(widget) {
    this.pending = null;
    super.update(widget);
    // a column that turned to days, to a comma for its decimals or to another role says it in every cell
    const key = this.saidKey();
    if (key === this.saidDrawn) return;
    this.saidDrawn = key;
    this.quiet = true;
    const pictures = pictureColumns(this.table);
    for (const cell of this.sheet.querySelectorAll('.cm-grid-cell')) this.fill(cell, pictures);
    this.quiet = false;
  }

  /** Every cell drawn again, the one typed in left alone: after a write sent, or refused there. */
  redraw({ refused = false } = {}) {
    if (refused) this.pending = null;
    this.quiet = true;
    for (const cell of this.body.querySelectorAll('td.cm-grid-cell')) if (this.editing?.cell !== cell) this.fill(cell);
    this.quiet = false;
  }

  destroy() {
    if (this.host.mode === OWN) {
      super.destroy();
      return;
    }
    this.view.contentDOM.removeEventListener('focus', this.unpick);
    this.resized?.disconnect();
    const step = this.step(this.close());
    // drawn away while a cell was typed in: what was typed is still written
    if (step) {
      queueMicrotask(() => {
        try {
          this.write([step]);
        } catch { /* the editor is gone */ }
      });
    }
  }
}

/**
 * Cells typed in rows copied from a table of this note (`written`, the `from:` or `data:`
 * naming it), written in the table and in the copy (`found`, the copy's table as the note
 * holds it) in one change, one Undo. A row is written only where every cell the two share
 * reads the same. Answers '' once written, else the words why not.
 */
export function writeLocalCells(view, written, found, cells) {
  const origin = readOrigin(written);
  const line = tableUnder(view.state.doc.toString(), origin?.anchor ?? '');
  const target = line >= 0 ? tablesOf(view.state).find((table) => table.line === line) : null;
  if (!target) return 'The table it came from is no longer in this note';
  const theirs = new Map(target.table.header.map((head, at) => [fold(head), at]));
  const shared = (row) => found.table.header.every((head, col) => {
    const at = theirs.get(fold(head));
    return at === undefined || plainText(target.table.rows[row]?.[at] ?? '') === plainText(found.table.rows[row]?.[col] ?? '');
  });
  for (const cell of cells) {
    if (theirs.get(fold(found.table.header[cell.col])) === undefined) return `The table has no column “${plainText(found.table.header[cell.col])}”`;
    if (!target.table.rows[cell.row] || !shared(cell.row)) return 'That row reads otherwise in the table now: edit it there';
  }
  const ours = chain(found.table, ...cells.map((cell) => (table) => setCell(table, cell.row, cell.col, cell.text)));
  const there = chain(target.table, ...cells.map((cell) => (table) => setCell(table, cell.row, theirs.get(fold(found.table.header[cell.col])), cell.text)));
  const changes = [
    ...ours.changes.map((piece) => ({ from: found.from + piece.from, to: found.from + piece.to, insert: piece.insert })),
    ...there.changes.map((piece) => ({ from: target.from + piece.from, to: target.from + piece.to, insert: piece.insert })),
  ].sort((a, b) => a.from - b.from);
  if (changes.length) view.dispatch({ changes, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.table')] });
  return '';
}

/**
 * Cells typed in rows copied from a sheet: written in the sheet (`editor/throughSheet.js`),
 * then every copy of it in the note follows (`editor/follow.js`), one step Undo takes back.
 * Answers '' once written, else the words why not.
 */
export async function writeSheetCells(view, { caseId, written, found, cells }) {
  const origin = readOrigin(written);
  const answer = await writeThroughSheet({ caseId, sheetId: origin?.id ?? '', table: found.table, cells });
  if (!answer.written) return answer.refused ? `${answer.refused}: edit it in the sheet` : `Not written in the sheet: ${answer.error}`;
  forgetFollow(view, written);
  const rows = await chartRows({ caseId, origin: written, fresh: true });
  if (rows?.found) followSource(view, written, rows.text);
  return '';
}

/**
 * The columns of a chart's rows it reads as days or as numbers. Once drawn, by the part the
 * engine names for each column (`roles`, `lib/cellHints.js` `roleReads`); before, guessed from
 * its kind (`kind`, the one it is drawn as, else its `kind:` line) and its cells (`columnReads`):
 * none it does not draw (`idle`), and never the categories a chart counts by, however
 * they are written.
 */
export function chartReads(chart, { kind = '', idle = new Set(), roles = NO_ROLES } = {}) {
  const table = chart?.table;
  if (!table) return NO_READS;
  // the engine named each column's part: it says which read as days or amounts, every cell checked
  if (roles.some(Boolean)) return roleReads(table, roles);
  const family = FORMS[formKind(kind || setting(chart, 'kind'))]?.family ?? '';
  const skip = new Set(idle);
  const by = fold(setting(chart, 'by'));
  const named = by ? table.header.findIndex((header) => fold(header) === by) : -1;
  if (family === 'categories' && named >= 0) skip.add(named);
  const reads = columnReads(table, family, skip);
  // no `by:` line: the categories are the first column, unless it is the only one of numbers
  if (family === 'categories' && named < 0 && reads.get(0)?.kind === NUMBERS
    && [...reads].some(([column, read]) => column > 0 && read.kind === NUMBERS)) reads.delete(0);
  return reads;
}

/**
 * What a chart's drawing does with each column of its rows, as the engine names it (`roles`
 * in the kind it is drawn as, `X-Chart-Kind`): `roles`, one a column ('' for one it does not
 * read), and `idle`, the columns with none, greyed as not drawn. A kind that reads every
 * column (key figures), or a chart not drawn yet, names none: no role, nothing idle.
 */
export function chartColumns(kind, table) {
  if (!Array.isArray(kind?.roles)) return { roles: NO_ROLES, idle: new Set() };
  const roles = (table?.header ?? []).map((_, at) => (typeof kind.roles[at] === 'string' ? kind.roles[at] : ''));
  return { roles, idle: new Set(roles.flatMap((role, at) => (role ? [] : [at]))) };
}

/**
 * A grid of a chart's rows in `box`, for `host` (see the module): `table` the rows as the
 * note holds them, `info` the case (chips and pictures), `writable`, `idle` the columns
 * its drawing does not read and `roles` what it does with the others (`chartColumns`),
 * `reads` the ones it reads as days or numbers (`chartReads`). Answers the grid;
 * `update(spec)` draws it again from new rows.
 */
export function rowsGrid(box, view, { host, table, info, writable, idle, roles, reads }) {
  return new RowsGrid(box, { host, table, info, writable, idle, roles, reads, look: null, tableId: null }, view);
}
