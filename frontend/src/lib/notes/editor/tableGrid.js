/**
 * A table in the drawn note is a grid the analyst types in, and its Markdown stays
 * the pipes an expert would write.
 *
 * - A press puts the caret in a cell, which shows its Markdown while it is typed in
 *   and its chips, links and pictures drawn otherwise. Tab and Shift+Tab move
 *   along, Enter goes down and Shift+Enter up, the arrows leave a cell at its
 *   edges, Escape leaves the grid for the text. Tab past the last cell, or Enter
 *   on the last row, opens a new row under the table, written once something is
 *   typed in it.
 * - A cell's words are written when the caret leaves it (Tab, Enter, an arrow, a
 *   press elsewhere): one transaction, one Undo step, its row's line only. Undo
 *   in a cell takes back the typing first, then the grid's last gesture.
 * - The bar above the grid adds a row or a column, pastes cells from a
 *   spreadsheet, reads a CSV, TSV or HTML file, and opens the source. Each
 *   column's ▾ sorts it, inserts, moves, aligns, fills down or deletes; each
 *   row's number inserts, duplicates, moves or deletes it.
 * - A long table shows its first rows and says how many more (`gridEdits.js`).
 * - `@` in a cell offers the case's records, as in the text; a chip or a link in a
 *   cell opens on Ctrl+click, since a press types in it. A picture of the
 *   case dropped on a cell lands in it as a chip, and so does a tool's Put in while
 *   a cell is picked; an empty picture cell offers to cut its row's frame in
 *   Inspect (`tablePictures.js`).
 *
 * The Chart button is the charts' (`editor/chartBlock.js` registers it through
 * `registerTableChart(open)`): it shows every kind the table fits, drawn from its rows.
 * Settings opens how the table shows in the report (`editor/tableSettings.js`), written
 * on a line under its last row that the grid stands over.
 *
 * Only in the drawn mode, and only a note that can be written takes the grid's
 * gestures; the raw Markdown shows the pipes as before. A table only the
 * Markdown parser sees (inside a quote) is drawn as it reads, as before.
 */
import { redo, undo } from '@codemirror/commands';

import { carriesMedia, droppedMedia } from '../../drag.js';
import { entityReference, markdownInlineHtml, mediaReference } from '../../markdown.js';
import { rovingToolbar } from '../pictureSize.js';
import { blockKind, registerBlock } from './blocks.js';
// the plain table this module turns into a grid, registered first wherever this is read from
import './tableBlock.js';
import { cellMention } from './cellMention.js';
import {
  FOLD_PAST, FOLD_SHOWN, chain, changeTable, rowsShown, showTableWhole, shownWhole, tableIdAt, tableIds, tableNear,
  tableStartingAt, tablesOf, wholeTables,
} from './gridEdits.js';
import { button, openMenu, openPopover } from './gridMenu.js';
import { heldHeight, holdHeight, moveHeight, releaseHeight } from './heights.js';
import { ChipWidget } from './inline.js';
import { chooseTableFile, cutSaid, pasteAsTable, pastedTable, readTableFile, sizeSaid } from './pasteTable.js';
import { openSource, settle } from './ranges.js';
import { noteCase, noteHandlers, resolve } from './state.js';
import { gridAt, isBlankCell, pickCell, pictureColumns, rowVideo, timeLabel } from './tablePictures.js';
import { SETTINGS_THEME, markSettings, openTableSettings, settingsButton } from './tableSettings.js';
import {
  MAX_ROWS, cellText, duplicateRow, fillColumn, gridToTable, insertColumn, insertRow, isTotalRow, lineChanges, moveColumn,
  moveRow, parseTable, pasteInto, plainText, removeColumn, removeRow, serializeTable, setAlign, setCell, sortRows,
} from './tableText.js';
import { BlockWidget, markPicked, sourceButton } from './widgets.js';

// -- the Chart button, which the charts register ----------------------------------------

let chartHook = null;

/**
 * Give the grid's bar its Chart button: `open(view, { from, to, table })` runs on
 * its press, with the table as it stands. Until a module registers one, the button
 * is not drawn. Answers the undoing.
 */
export function registerTableChart(open) {
  chartHook = typeof open === 'function' ? open : null;
  return () => {
    if (chartHook === open) chartHook = null;
  };
}

// -- drawing a cell ----------------------------------------------------------------

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** A record cited in a cell, drawn as the text's chips are, under the words written for it, which are what prints. */
function cellChip(id, label, info) {
  const entity = resolve(info, id);
  const chip = new ChipWidget({ id, label }, entity).toDOM();
  chip.lastChild.textContent = label || entity?.label || id;
  // in a grid a press types in the cell: the record opens on Ctrl+click, as a link does
  chip.title = entity ? `${entity.label} · ${entity.type}. Ctrl+click to open` : 'No longer in the case';
  return chip;
}

/** A cell's Markdown as it shows: its marks and links, a chip for each record it cites, its pictures small. */
function drawCell(node, text, info) {
  node.innerHTML = text ? markdownInlineHtml(text, info) : '';
  for (const link of node.querySelectorAll('a[data-entity-id]')) link.replaceWith(cellChip(link.dataset.entityId, link.textContent, info));
  for (const video of node.querySelectorAll('video')) {
    const id = /\[\[media:([A-Za-z0-9_-]+)\|/.exec(text)?.[1] ?? '';
    video.replaceWith(cellChip(id, video.textContent, info));
  }
  for (const picture of node.querySelectorAll('img')) {
    picture.classList.add('cm-grid-thumb');
    picture.loading = 'lazy';
    picture.draggable = false;
    picture.removeAttribute('style');
  }
  for (const caption of node.querySelectorAll('.markdown-caption')) caption.remove();
  for (const link of node.querySelectorAll('a[href]:not([data-entity-id])')) link.title = `${link.getAttribute('href')}\nCtrl+click to open`;
}

/** Where in its words a press on a plain cell lands, or null when the cell holds marks (the caret then goes to the end). */
function caretAt(cell, text, event) {
  if (!text || plainText(text) !== text) return null;
  const words = cell.querySelector('.cm-grid-text');
  const doc = cell.ownerDocument;
  let node = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const found = doc.caretPositionFromPoint(event.clientX, event.clientY);
    node = found?.offsetNode;
    offset = found?.offset ?? 0;
  } else if (doc.caretRangeFromPoint) {
    const found = doc.caretRangeFromPoint(event.clientX, event.clientY);
    node = found?.startContainer;
    offset = found?.startOffset ?? 0;
  }
  // a press on what the chart reads in it (`editor/rowsGrid.js`) is past the words
  if (!node || !words?.contains(node) || node.nodeType !== 3 || node.parentElement?.closest('.cm-grid-reading')) return null;
  return Math.min(text.length, offset);
}

/**
 * How narrow each column may get: a column of sentences keeps the width of a few
 * words, so a wide table scrolls sideways rather than stand its words one a line.
 */
export function columnWidths(table) {
  return table.header.map((head, col) => {
    let longest = plainText(head).length;
    for (const cells of table.rows.slice(0, 200)) longest = Math.max(longest, plainText(cells[col]).length);
    return longest > 40 ? '12em' : longest > 18 ? '8em' : '';
  });
}

/** Whether two rows hold the same cells. */
function sameCells(a, b) {
  return Boolean(a && b) && a.length === b.length && a.every((cell, at) => cell === b[at]);
}

/** A column's name as the menus and the fields say it. */
function columnName(table, col) {
  return plainText(table.header[col]) || `Column ${col + 1}`;
}

/** The labels of a column's two sorts, by what it holds. */
const SORTS = {
  number: ['Sort 1 → 9', 'Sort 9 → 1'],
  date: ['Sort oldest first', 'Sort newest first'],
  text: ['Sort A → Z', 'Sort Z → A'],
};

/** A table as a spreadsheet takes it: the cells' words, a tab between them, a line each. */
export function tableTsv(table) {
  const line = (cells) => cells.map((cell) => plainText(cell).replace(/[\t\r\n]+/g, ' ')).join('\t');
  return [table.header, ...table.rows].map(line).join('\n');
}

/** A whole table written in place of another: what bringing cells into an empty table does. */
function replaceWith(text) {
  return (table) => ({ table: parseTable(text), text, changes: lineChanges(serializeTable(table), text) });
}

// -- the grid ----------------------------------------------------------------------

let pickedGrid = null;

/** No column greyed. */
const NONE = new Set();

/**
 * One table drawn as a grid, kept on its box (`box.grid`). It draws the table its
 * widget holds and, when the widget changes, draws again only the cells that
 * changed, never the one being typed in.
 *
 * A chart's rows are drawn by the same grid (`editor/rowsGrid.js` extends it): where
 * its table stands (`from`), whether it is shown whole, where the cursor goes on leaving
 * (`anchorFor`), whether rows and columns can be added and moved (`structural`), and the
 * columns its drawing does not read (`widget.idle`, greyed and marked) are the hooks.
 */
export class Grid {
  constructor(box, widget, view) {
    this.box = box;
    this.view = view;
    this.widget = widget;
    this.table = widget.table;
    this.editing = null;
    this.ghost = false;
    this.pick = null;
    // set while the grid moves or takes down its own field, so the field's blur is not the caret leaving
    this.quiet = false;
    box.grid = this;
    this.build();
    this.render();
    this.listen();
  }

  get writable() {
    return this.widget.writable;
  }

  get info() {
    return this.widget.info;
  }

  get handlers() {
    return this.view.state.facet(noteHandlers);
  }

  /** Where the table starts in the note now, or -1 once its box is gone. */
  get from() {
    try {
      return this.view.posAtDOM(this.box);
    } catch {
      return -1;
    }
  }

  /** The table as the note holds it now, `{ from, to, table }`. */
  found() {
    return tableNear(this.view.state, this.from);
  }

  isWhole() {
    return shownWhole(this.view.state, this.widget.tableId);
  }

  shownRows() {
    return rowsShown(this.table.rows.length, this.isWhole());
  }

  textAt(row, col) {
    if (row === -1) return this.table.header[col] ?? '';
    return this.table.rows[row]?.[col] ?? '';
  }

  /** Whether rows and columns are added, moved and deleted here, or only cells typed in. */
  get structural() {
    return true;
  }

  /** The columns drawn greyed, marked "not drawn": a chart's columns its drawing does not read. */
  get idle() {
    return this.widget.idle ?? NONE;
  }

  // -- drawing --

  build() {
    const { box } = this;
    box.className = `cm-block cm-block-table cm-grid-block${this.writable ? '' : ' cm-grid-locked'}`;
    box.dataset.block = 'table';
    const frame = element('div', 'cm-grid-frame');
    if (this.writable) frame.append(this.makeBar());
    this.scroller = element('div', 'cm-grid-scroll cm-grid-ui');
    this.sheet = element('table', 'cm-grid');
    this.head = element('thead');
    this.body = element('tbody');
    this.sheet.append(this.head, this.body);
    this.scroller.append(this.sheet);
    this.foot = element('div', 'cm-grid-fold cm-grid-ui');
    // the well holds the shadows of the columns out of sight, which stay put while the grid scrolls
    const well = element('div', 'cm-grid-well');
    well.append(this.scroller);
    frame.append(well, this.foot);
    box.append(frame);
    if (!this.writable) box.append(sourceButton(this.view, box));
  }

  makeBar() {
    const bar = element('div', 'cm-grid-bar cm-grid-ui');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Table');
    const tool = (className, options, run) => {
      const node = button(`cm-grid-tool ${className}`, options);
      // a press keeps the caret in its cell, so the gesture writes the cell with it, in one step
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => run(node));
      bar.append(node);
      return node;
    };
    tool('cm-grid-add-row', { label: 'Row', iconName: 'plus', title: 'Add a row at the end' }, () => this.addRow());
    tool('cm-grid-add-col', { label: 'Column', iconName: 'plus', title: 'Add a column at the end' }, () => this.addColumn());
    tool('cm-grid-paste', { label: 'Paste from a spreadsheet', iconName: 'clipboard', title: 'Cells copied in a spreadsheet or a web page' },
      (node) => this.pasteBox(node));
    tool('cm-grid-file', { label: 'From a file', iconName: 'upload', title: 'A CSV, TSV or HTML file' }, () => this.fromFile());
    bar.append(element('span', 'cm-grid-spring'));
    this.settings = tool(...settingsButton(), (node) => openTableSettings(this.view, node, this.leave('stay').from));
    markSettings(this.settings, this.widget.look);
    if (chartHook) {
      tool('cm-grid-chart', { label: 'Chart', iconName: 'chart', title: 'Draw a chart from this table' }, () => {
        this.leave('stay');
        const found = this.found();
        if (found) chartHook(this.view, found);
      });
    }
    tool('cm-grid-more', { label: 'More', iconName: 'more', alone: true, title: 'More' }, (node) => this.moreMenu(node));
    // the </> acts on the press, as every block's does; the keyboard's Enter and Space give a click
    const source = button('cm-grid-tool cm-grid-source', { label: 'Edit the source', alone: true, title: 'Edit the source' });
    source.dataset.editSource = 'true';
    source.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.toSource();
    });
    source.addEventListener('click', (event) => {
      if (event.detail === 0) this.toSource();
    });
    bar.append(source);
    rovingToolbar(bar);
    return bar;
  }

  render() {
    const saved = this.saveEdit();
    this.idleDrawn = [...this.idle].join(',');
    this.quiet = true;
    this.renderHead();
    this.renderBody();
    this.renderFoot();
    this.quiet = false;
    if (saved) this.edit(saved.row, saved.col, saved);
    this.markPick();
    this.fit();
  }

  /**
   * A table wider than the text takes the room beside it, up to the page's width,
   * so a register of nine columns reads as a sheet rather than a column of words;
   * past that it scrolls sideways in its frame.
   */
  fit() {
    const { box, sheet, view } = this;
    if (!box.isConnected || typeof window === 'undefined') return;
    const was = box.style.marginLeft;
    box.style.marginLeft = '';
    box.style.marginRight = '';
    sheet.style.width = 'max-content';
    const natural = sheet.offsetWidth;
    sheet.style.width = '';
    const inner = this.scroller.clientWidth;
    const room = view.scrollDOM.clientWidth - view.contentDOM.offsetWidth - 32;
    const extra = Math.floor(Math.max(0, Math.min(natural - inner, room)) / 2) * 2;
    if (extra >= 16) {
      box.style.marginLeft = `${-extra / 2}px`;
      box.style.marginRight = `${-extra / 2}px`;
    }
    if (box.style.marginLeft !== was) view.requestMeasure();
    this.edges();
  }

  /** A shadow at a side the grid scrolls on to, so columns out of sight are not missed. */
  edges() {
    const { scroller } = this;
    const well = scroller.parentElement;
    well.classList.toggle('cm-grid-more-left', scroller.scrollLeft > 2);
    well.classList.toggle('cm-grid-more-right', scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2);
  }

  renderHead() {
    const row = element('tr');
    row.append(element('th', 'cm-grid-corner'));
    const widths = columnWidths(this.table);
    this.table.header.forEach((_, col) => {
      const cell = element('th', `cm-grid-head cm-grid-cell${this.idle.has(col) ? ' cm-grid-idle' : ''}`);
      cell.style.minWidth = widths[col];
      cell.scope = 'col';
      cell.dataset.row = '-1';
      cell.dataset.col = String(col);
      row.append(cell);
      this.fill(cell);
    });
    this.head.replaceChildren(row);
  }

  renderBody() {
    const rows = [];
    const shown = this.shownRows();
    const pictures = pictureColumns(this.table);
    for (let row = 0; row < shown; row += 1) rows.push(this.makeRow(row, pictures));
    if (this.ghost) rows.push(this.makeRow(this.table.rows.length, pictures, true));
    this.body.replaceChildren(...rows);
    this.pictures = [...pictures].join(',');
  }

  makeRow(row, pictures, ghost = false) {
    const line = element('tr', ghost ? 'cm-grid-row cm-grid-ghost' : 'cm-grid-row');
    line.dataset.row = String(row);
    const number = element('th', 'cm-grid-num');
    number.scope = 'row';
    if (this.writable && !ghost && this.structural) {
      const press = button('cm-grid-rowbtn', { label: String(row + 1), title: 'Insert, duplicate, move or delete this row' });
      press.setAttribute('aria-label', `Row ${row + 1}`);
      press.setAttribute('aria-haspopup', 'menu');
      press.addEventListener('mousedown', (event) => event.preventDefault());
      press.addEventListener('click', () => this.rowMenu(Number(line.dataset.row), press));
      number.append(press);
    } else number.textContent = ghost ? '+' : String(row + 1);
    line.append(number);
    for (let col = 0; col < this.table.header.length; col += 1) {
      const cell = element('td', `cm-grid-cell${this.idle.has(col) ? ' cm-grid-idle' : ''}`);
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      line.append(cell);
      this.fill(cell, pictures);
    }
    return line;
  }

  /** Draw a cell's words, unless it is the one being typed in. */
  fill(cell, pictures = pictureColumns(this.table)) {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const align = this.table.align[col];
    cell.style.textAlign = align ?? '';
    if (this.editing?.cell === cell) return;
    const text = this.textAt(row, col);
    const words = element('div', 'cm-grid-text');
    drawCell(words, text, this.info);
    if (row === -1) {
      // a short name stays on one line, as a sheet's column names do
      words.classList.toggle('cm-grid-short', plainText(text).length <= 24);
      const inner = element('div', `cm-grid-head-in${align === 'right' ? ' cm-grid-end' : align === 'center' ? ' cm-grid-middle' : ''}`);
      if (!text) words.dataset.placeholder = `Column ${col + 1}`;
      inner.append(words);
      if (this.idle.has(col)) {
        const mark = element('span', 'cm-grid-idle-mark');
        mark.textContent = 'not drawn';
        mark.title = 'The chart does not draw this column; it is kept with its rows';
        inner.append(mark);
      }
      if (this.writable && this.structural) {
        const menu = button('cm-grid-colbtn', { label: `${columnName(this.table, col)}: sort, insert, move, align, fill, delete`, iconName: 'chevronDown', alone: true });
        menu.setAttribute('aria-haspopup', 'menu');
        menu.addEventListener('mousedown', (event) => event.preventDefault());
        menu.addEventListener('click', () => this.columnMenu(Number(cell.dataset.col), menu));
        inner.append(menu);
      }
      cell.replaceChildren(inner);
      return;
    }
    cell.replaceChildren(words);
    if (!this.writable || !pictures.has(col) || !isBlankCell(text) || !this.handlers.cutFrame || row >= this.table.rows.length) return;
    const video = rowVideo(this.table, row, this.view.state.field(noteCase));
    if (!video) return;
    const cut = button('cm-grid-cut', { label: 'Cut a frame', iconName: 'scissors' });
    cut.title = `Open ${video.entity.label} in Inspect at ${timeLabel(video.time)}; Put in lands here`;
    const at = element('small');
    at.textContent = timeLabel(video.time);
    cut.append(at);
    cut.addEventListener('mousedown', (event) => event.preventDefault());
    cut.addEventListener('click', () => this.cutFrame(Number(cell.dataset.row), Number(cell.dataset.col)));
    // an empty cell holds the offer alone, on its first line; a dash stays beside it
    if (!text.trim()) words.remove();
    cell.append(cut);
  }

  renderFoot() {
    const total = this.table.rows.length;
    this.foot.replaceChildren();
    this.foot.hidden = total <= FOLD_PAST;
    if (this.foot.hidden) return;
    const whole = this.isWhole();
    const toggle = button('cm-grid-foldbtn', {
      label: whole ? `Show the first ${FOLD_SHOWN} only` : `${total - FOLD_SHOWN} more rows · show all ${total}`,
      iconName: whole ? 'chevronUp' : 'chevronDown',
    });
    toggle.setAttribute('aria-expanded', String(whole));
    toggle.addEventListener('mousedown', (event) => event.preventDefault());
    toggle.addEventListener('click', () => this.setWhole(!this.isWhole()));
    this.foot.append(toggle);
  }

  /** Keep whether the table is shown whole: the note's tables keep it by name, across their redraws. */
  keepWhole(whole) {
    showTableWhole(this.view, this.widget.tableId, whole);
  }

  setWhole(whole) {
    if (this.isWhole() === whole) return;
    this.keepWhole(whole);
    this.quiet = true;
    const saved = this.saveEdit();
    this.renderBody();
    this.renderFoot();
    this.quiet = false;
    if (saved && saved.row < this.shownRows() + (this.ghost ? 1 : 0)) this.edit(saved.row, saved.col, saved);
    this.markPick();
    this.view.requestMeasure();
  }

  /** The cell at `row` and `col` as drawn now, or null. */
  cellAt(row, col) {
    const scope = row === -1 ? this.head : this.body;
    return scope.querySelector(`.cm-grid-cell[data-row="${row}"][data-col="${col}"]`);
  }

  /** The widget changed: draw again what changed, and nothing else. */
  update(widget) {
    const before = this.table;
    const freshCase = widget.info !== this.widget.info;
    this.widget = widget;
    this.table = widget.table;
    markSettings(this.settings, widget.look);
    const idle = [...this.idle].join(',');
    if (before.header.length !== this.table.header.length || idle !== this.idleDrawn) {
      this.ghost = false;
      this.render();
      return;
    }
    const pictures = pictureColumns(this.table);
    const freshPictures = [...pictures].join(',') !== this.pictures;
    this.pictures = [...pictures].join(',');
    this.quiet = true;
    const widths = columnWidths(this.table);
    this.table.header.forEach((text, col) => {
      const head = this.cellAt(-1, col);
      head.style.minWidth = widths[col];
      if (freshCase || text !== before.header[col] || this.table.align[col] !== before.align[col]) this.fill(head, pictures);
    });
    const shown = this.shownRows();
    const lines = [...this.body.children].filter((line) => !line.classList.contains('cm-grid-ghost'));
    for (let row = 0; row < shown; row += 1) {
      const line = lines[row];
      if (!line) {
        this.body.insertBefore(this.makeRow(row, pictures), this.body.querySelector('.cm-grid-ghost'));
        continue;
      }
      const aligned = this.table.align.every((side, col) => side === before.align[col]);
      if (freshCase || freshPictures || !aligned || !sameCells(before.rows[row], this.table.rows[row])) {
        for (const cell of line.querySelectorAll('td.cm-grid-cell')) this.fill(cell, pictures);
      }
    }
    for (const line of lines.slice(shown)) line.remove();
    const ghost = this.body.querySelector('.cm-grid-ghost');
    if (ghost && !this.ghost) ghost.remove();
    else if (ghost) {
      ghost.dataset.row = String(this.table.rows.length);
      for (const cell of ghost.querySelectorAll('.cm-grid-cell')) cell.dataset.row = String(this.table.rows.length);
      if (this.editing?.ghost) this.editing.row = this.table.rows.length;
    }
    this.quiet = false;
    this.renderFoot();
    if (!this.editing) this.fit();
    // an Undo or another editor changed the cell being typed in, before anything was typed: the field follows
    const edit = this.editing;
    if (edit && !edit.ghost) {
      const now = this.textAt(edit.row, edit.col);
      if (now !== edit.original && edit.input.value === edit.original) {
        edit.input.value = now;
        edit.original = now;
        this.size(edit.input);
      }
    }
    this.markPick();
  }

  // -- typing in a cell --

  /** Open the field of a cell: `caret` is 'end', 'start' or an offset; `value` and `original` carry a field over a redraw. */
  edit(row, col, { caret = 'end', value, original, start, end } = {}) {
    if (!this.writable || this.view.state.readOnly) return false;
    if (col < 0 || col >= this.table.header.length || row < -1 || row > this.table.rows.length) return false;
    if (this.editing?.row === row && this.editing?.col === col) {
      this.editing.input.focus({ preventScroll: true });
      return true;
    }
    if (this.editing) this.leave('stay');
    const ghost = row === this.table.rows.length;
    if (ghost && !this.structural) return false;
    if (ghost && !this.ghost) {
      this.ghost = true;
      this.body.append(this.makeRow(row, pictureColumns(this.table), true));
    }
    if (!ghost && row >= this.shownRows()) this.setWhole(true);
    const cell = this.cellAt(row, col);
    if (!cell) return false;
    this.engage();
    const text = this.textAt(row, col);
    const input = element('textarea', 'cm-grid-input');
    input.rows = 1;
    // a field is as wide as its column, never wider: a text field's own width would widen it
    input.cols = 1;
    input.spellcheck = true;
    input.value = value ?? text;
    input.setAttribute('aria-label', `${columnName(this.table, col)}, ${row === -1 ? 'header' : ghost ? 'new row' : `row ${row + 1}`}`);
    // the column keeps its width while its cell is typed in, so the grid does not jump
    cell.style.minWidth = `${Math.round(cell.getBoundingClientRect().width)}px`;
    cell.classList.add('cm-grid-editing');
    this.quiet = true;
    cell.replaceChildren(input);
    this.editing = { row, col, cell, input, original: original ?? text, ghost, mention: null };
    this.editing.mention = cellMention(input, { view: this.view, entities: () => this.view.state.field(noteCase).entities });
    input.addEventListener('keydown', (event) => this.key(event));
    input.addEventListener('input', () => {
      this.size(input);
      if (this.editing?.input === input) this.editing.mention.read();
    });
    input.addEventListener('blur', () => this.blurred(input));
    input.addEventListener('paste', (event) => this.pasted(event));
    input.focus({ preventScroll: true });
    this.quiet = false;
    const length = input.value.length;
    if (start !== undefined) input.setSelectionRange(start, end ?? start);
    else if (caret === 'start') input.setSelectionRange(0, 0);
    else if (typeof caret === 'number') input.setSelectionRange(caret, caret);
    else input.setSelectionRange(length, length);
    this.size(input);
    cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    this.setPick(row, col);
    return true;
  }

  size(input) {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  /** The editor's cursor goes to the table's start, so Undo comes back here and never scrolls away. */
  engage() {
    const from = this.from;
    const range = this.view.state.selection.main;
    if (from >= 0 && !(range.empty && range.head === from)) this.view.dispatch({ selection: { anchor: from } });
  }

  /** Take the field down and draw the cell's words again; answers what was typed, `{ row, col, typed, changed, ghost }`. */
  close() {
    const edit = this.editing;
    if (!edit) return null;
    this.editing = null;
    edit.mention.close();
    const typed = cellText(edit.input.value);
    edit.cell.classList.remove('cm-grid-editing');
    edit.cell.style.minWidth = '';
    this.quiet = true;
    this.fill(edit.cell);
    this.quiet = false;
    return { row: edit.row, col: edit.col, typed, changed: typed !== cellText(edit.original), ghost: edit.ghost };
  }

  /** What the field carries over a redraw, its typing and its caret; null when none is open. */
  saveEdit() {
    const edit = this.editing;
    if (!edit) return null;
    this.editing = null;
    edit.mention.close();
    return { row: edit.row, col: edit.col, value: edit.input.value, original: edit.original, start: edit.input.selectionStart, end: edit.input.selectionEnd };
  }

  /** The change a closed field writes: its cell, or the new row it was typed in. */
  step(done) {
    if (!done?.changed) return null;
    const { row, col, typed } = done;
    if (done.ghost) {
      if (!typed) return null;
      return (table) => insertRow(table, table.rows.length, table.header.map((_, at) => (at === col ? typed : '')));
    }
    return (table) => setCell(table, row, col, typed);
  }

  /** Write `steps` as one gesture; answers the grid drawing the table now (this one, or the one CodeMirror drew instead). */
  write(steps) {
    const from = this.from;
    const live = steps.filter(Boolean);
    if (from < 0 || !live.length) return this;
    changeTable(this.view, from, (table) => chain(table, ...live));
    return gridAt(this.view, from) ?? this;
  }

  /** Leave the cell being typed in for `row`, `col`, writing it first. */
  go(row, col, caret = 'end') {
    const done = this.close();
    const grid = this.write([this.step(done)]);
    const rows = grid.table.rows.length;
    if (row < rows && grid.ghost) grid.dropGhost();
    if (row > rows || (row === rows && !grid.structural)) {
      grid.leave('after');
      return;
    }
    grid.edit(row, col, { caret });
  }

  dropGhost() {
    if (!this.ghost) return;
    this.ghost = false;
    if (this.editing?.ghost) this.close();
    this.body.querySelector('.cm-grid-ghost')?.remove();
  }

  /**
   * Leave the grid, its cell written: 'stay' keeps the pick (a menu, a tool's Put
   * in), 'blur' too; 'pick' picks the table as a block (Escape), 'before' and 'after'
   * put the editor's cursor around it.
   */
  leave(where) {
    const from = this.from;
    const grid = this.write([this.step(this.close())]);
    grid.dropGhost();
    if (where === 'stay' || where === 'blur') return grid;
    grid.setPick(null);
    this.view.dispatch({ selection: { anchor: this.anchorFor(where, from) }, scrollIntoView: true });
    this.view.focus();
    return grid;
  }

  /** Where the editor's cursor goes as the grid is left: on the table ('pick'), or before or after it. */
  anchorFor(where, from = this.from) {
    const { state } = this.view;
    const found = tableNear(state, from);
    if (where === 'before' && from > 0) return settle(state, from - 1);
    if (where === 'after' && found) return found.end < state.doc.length ? settle(state, found.end + 1) : found.end;
    return from;
  }

  blurred(input) {
    if (this.quiet || this.editing?.input !== input) return;
    // the window left (another program): the field is where the analyst comes back to
    if (typeof document !== 'undefined' && !document.hasFocus()) return;
    this.leave('blur');
  }

  /** Whether the caret is on the field's first (or last) line, where Up (or Down) leaves the cell. */
  onEdgeLine(input, down) {
    const line = parseFloat(getComputedStyle(input).lineHeight) || 20;
    if (input.scrollHeight <= line * 1.6) return true;
    return down ? input.selectionStart === input.value.length : input.selectionEnd === 0;
  }

  key(event) {
    const edit = this.editing;
    if (!edit || edit.mention.key(event)) return;
    if (event.isComposing || event.keyCode === 229) return;
    const { row, col, input } = edit;
    const cols = this.table.header.length;
    const rows = this.table.rows.length;
    const mod = event.ctrlKey || event.metaKey;
    const collapsed = input.selectionStart === input.selectionEnd;
    const plainKey = !mod && !event.altKey;
    let act = null;
    if (event.key === 'Tab' && !mod && !event.altKey) {
      if (event.shiftKey) {
        if (col > 0) act = () => this.go(row, col - 1);
        else if (row > -1) act = () => this.go(row - 1, cols - 1);
        else act = () => {};
      } else if (col < cols - 1) act = () => this.go(row, col + 1);
      // past the last cell, a new row; past an empty new row, its first cell again
      else act = () => this.go(edit.ghost && !cellText(input.value) ? row : row + 1, 0, 'start');
    } else if (event.key === 'Enter' && plainKey) {
      if (event.shiftKey) act = () => (row > -1 ? this.go(row - 1, col) : this.leave('before'));
      else if (edit.ghost && !cellText(input.value)) act = () => this.leave('after');
      else act = () => this.go(row + 1, col);
    } else if (event.key === 'Escape' && !mod) {
      act = () => this.leave('pick');
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.altKey && !mod && !event.shiftKey) {
      const to = event.key === 'ArrowUp' ? row - 1 : row + 1;
      if (row >= 0 && !edit.ghost && to >= 0 && to < rows && this.structural) act = () => this.moveRowTo(row, to, col);
      else act = () => {};
    } else if (event.key === 'ArrowUp' && plainKey && !event.shiftKey && this.onEdgeLine(input, false)) {
      act = () => (row === -1 ? this.leave('before') : this.go(row - 1, col));
    } else if (event.key === 'ArrowDown' && plainKey && !event.shiftKey && this.onEdgeLine(input, true)) {
      act = () => (row >= rows - 1 ? this.leave('after') : this.go(row + 1, col));
    } else if (event.key === 'ArrowLeft' && plainKey && !event.shiftKey && collapsed && input.selectionStart === 0) {
      if (col > 0) act = () => this.go(row, col - 1, 'end');
      else if (row > -1) act = () => this.go(row - 1, cols - 1, 'end');
    } else if (event.key === 'ArrowRight' && plainKey && !event.shiftKey && collapsed && input.selectionEnd === input.value.length) {
      if (col < cols - 1) act = () => this.go(row, col + 1, 'start');
      else if (row < rows - 1) act = () => this.go(row + 1, 0, 'start');
    } else if (mod && !event.altKey && input.value === edit.original && ['z', 'y'].includes(event.key.toLowerCase())) {
      // nothing typed in the cell yet: Undo and Redo are the grid's, as in the text
      const back = event.key.toLowerCase() === 'z' && !event.shiftKey;
      act = () => (back ? undo(this.view) : redo(this.view));
    }
    if (!act) return;
    event.preventDefault();
    event.stopPropagation();
    act();
  }

  /** Cells pasted in a cell: a block of two or more fills the grid from there, adding the rows and columns it needs. */
  pasted(event) {
    const data = event.clipboardData;
    const made = data && pastedTable({ html: data.getData('text/html'), text: data.getData('text/plain') });
    if (!made || !this.editing || !this.structural) return;
    event.preventDefault();
    const { row, col } = this.editing;
    const cells = made.grid.cells.slice(0, MAX_ROWS);
    this.close();
    const grid = this.write([(table) => pasteInto(table, { row, column: col }, cells)]);
    grid.dropGhost();
    this.say(`Pasted ${sizeSaid(cells.length, cells[0].length)} from ${made.source}.${cutSaid(made.grid.cells.length - cells.length)}`);
    grid.edit(Math.min(row, grid.table.rows.length - 1), col);
  }

  // -- picking a cell, for a picture to land in --

  /** Whether a tool's Put in lands in the cell picked here. */
  get picks() {
    return true;
  }

  setPick(row, col) {
    if (pickedGrid && pickedGrid !== this) pickedGrid.clearPick();
    this.pick = row === null ? null : { row, col };
    pickedGrid = this.pick ? this : null;
    const index = this.picks ? tablesOf(this.view.state).findIndex((found) => found.from === this.from) : -1;
    pickCell(this.handlers.noteKey, this.pick && index >= 0 ? { table: index, ...this.pick } : null);
    this.markPick();
  }

  clearPick() {
    this.pick = null;
    this.markPick();
  }

  markPick() {
    for (const cell of this.box.querySelectorAll('.cm-grid-picked')) cell.classList.remove('cm-grid-picked');
    if (this.pick) this.cellAt(this.pick.row, this.pick.col)?.classList.add('cm-grid-picked');
  }

  /** Light a cell a moment, where a picture just landed. */
  flash(row, col) {
    if (row >= this.shownRows()) this.setWhole(true);
    const cell = this.cellAt(row, col);
    if (!cell) return;
    cell.classList.add('cm-grid-flash');
    cell.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    setTimeout(() => cell.classList.remove('cm-grid-flash'), 1800);
  }

  cutFrame(row, col) {
    const video = rowVideo(this.table, row, this.view.state.field(noteCase));
    if (!video) return;
    this.leave('stay');
    this.setPick(row, col);
    this.handlers.cutFrame?.({ entity: video.entity, time: video.time });
  }

  /** Case pictures dropped on a cell: their chips, after what it holds. */
  dropped(cell, items) {
    const info = this.view.state.field(noteCase);
    const byPath = new Map(info.entities.filter((entity) => entity.attrs?.path).map((entity) => [entity.attrs.path, entity]));
    const chips = items.map((item) => byPath.get(item.attrs?.path)).filter(Boolean)
      .map((entity) => (entity.attrs?.kind === 'video' ? entityReference(entity) : mediaReference(entity)));
    if (!chips.length) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const done = this.close();
    const now = this.textAt(row, col);
    const text = isBlankCell(now) ? chips.join(' ') : `${now} ${chips.join(' ')}`;
    const ghost = row >= this.table.rows.length;
    const grid = this.write([this.step(done), ghost
      ? (table) => insertRow(table, table.rows.length, table.header.map((_, at) => (at === col ? text : '')))
      : (table) => setCell(table, row, col, text)]);
    grid.dropGhost();
    grid.setPick(row, col);
    grid.flash(row, col);
  }

  // -- the bar --

  say(message, actions = [], kind = 'info') {
    this.handlers.tableToast?.(message, actions, kind);
  }

  /** An Undo for a toast: it takes the gesture back while nothing was written since. */
  undoAction() {
    const after = this.view.state.doc;
    return {
      label: 'Undo',
      onClick: () => {
        if (this.view.state.doc === after) undo(this.view);
        else this.say('The table was changed since, so it stays', [], 'warn');
      },
    };
  }

  addRow() {
    const grid = this.write([this.step(this.close()), (table) => insertRow(table, table.rows.length)]);
    grid.dropGhost();
    grid.edit(grid.table.rows.length - 1, 0, { caret: 'start' });
  }

  addColumn() {
    const grid = this.write([this.step(this.close()), (table) => insertColumn(table, table.header.length)]);
    grid.edit(-1, grid.table.header.length - 1);
  }

  pasteBox(anchor) {
    const grid = this.leave('stay');
    const panel = element('div', 'cm-grid-pastebox');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Paste from a spreadsheet');
    const said = element('p');
    said.textContent = 'Copy the cells in your spreadsheet, then paste them here.';
    const field = element('textarea', 'cm-grid-pastefield');
    field.rows = 2;
    field.placeholder = /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? '⌘V' : 'Ctrl+V';
    field.setAttribute('aria-label', 'Paste the cells here');
    const where = element('small');
    where.textContent = grid.pick && grid.pick.row >= 0 ? 'They fill the grid from the picked cell.' : 'They are added under the last row.';
    panel.append(said, field, where);
    let close = () => {};
    field.addEventListener('paste', (event) => {
      const data = event.clipboardData;
      const made = data && pastedTable({ html: data.getData('text/html'), text: data.getData('text/plain') });
      event.preventDefault();
      if (!made) {
        where.textContent = 'That holds no cells. Copy a range of two cells or more.';
        return;
      }
      close(false);
      (gridAt(this.view, this.from) ?? grid).bring(made.grid, `from ${made.source}`);
    });
    close = openPopover(this.view, anchor, panel);
    field.focus({ preventScroll: true });
  }

  async fromFile() {
    const from = this.from;
    this.leave('stay');
    const file = await chooseTableFile();
    if (!file) return;
    try {
      const grid = await readTableFile(file);
      (gridAt(this.view, from) ?? this).bring(grid, `from ${file.name}`);
    } catch (error) {
      this.say(error.message, [], 'warn');
    }
  }

  /**
   * Cells from outside: an empty table takes them whole (their header too), any
   * other gets them from its picked cell, or under its last row, a first row
   * naming its own columns left out.
   */
  bring(grid, said) {
    const table = this.table;
    const empty = table.rows.every((cells) => cells.every((cell) => !plainText(cell)));
    const named = table.header.some((cell) => plainText(cell));
    let step;
    let rows;
    let columns;
    let cut = 0;
    if (empty && (grid.header || !named)) {
      const made = gridToTable(grid);
      step = replaceWith(made.text);
      ({ cut } = made);
      rows = made.table.rows.length;
      columns = made.table.header.length;
    } else {
      const same = grid.header && grid.cells[0].length <= table.header.length
        && grid.cells[0].every((cell, at) => plainText(cell).toLowerCase() === plainText(table.header[at]).toLowerCase());
      const all = same || (empty && grid.header) ? grid.cells.slice(1) : grid.cells;
      const cells = all.slice(0, MAX_ROWS);
      cut = all.length - cells.length;
      const start = this.pick && this.pick.row >= 0 && !empty ? this.pick : { row: empty ? 0 : table.rows.length, col: 0 };
      step = (current) => {
        const next = pasteInto(current, { row: start.row, column: start.col }, cells);
        // an empty table's own blank rows past the cells go
        if (!empty || next.table.rows.length <= cells.length) return next;
        let trimmed = next;
        while (trimmed.table.rows.length > cells.length) trimmed = removeRow(trimmed.table, trimmed.table.rows.length - 1);
        return trimmed;
      };
      rows = cells.length;
      columns = cells[0]?.length ?? 0;
    }
    if (!rows && !columns) return;
    const written = this.write([step]);
    written.say(`Added ${sizeSaid(rows, columns)} ${said}.${cutSaid(cut)}`, [written.undoAction()]);
  }

  moreMenu(anchor) {
    const grid = this.leave('stay');
    const items = [
      {
        label: 'Copy for a spreadsheet', iconName: 'copy', hint: 'Tab-separated',
        run: () => {
          navigator.clipboard?.writeText(tableTsv(grid.table))
            .then(() => grid.say(`Copied ${sizeSaid(grid.table.rows.length, grid.table.header.length)}. Paste it in a spreadsheet.`, [], 'ok'))
            .catch(() => grid.say('The clipboard would not take it', [], 'warn'));
        },
      },
      '-',
      { label: 'Delete the table', iconName: 'trash', danger: true, run: () => grid.deleteTable() },
    ];
    openMenu(this.view, anchor, items, { label: 'Table' });
  }

  deleteTable() {
    const found = this.found();
    if (!found) return;
    const { doc } = this.view.state;
    const first = doc.lineAt(found.from);
    const last = doc.lineAt(found.end);
    let from = first.from;
    let to = last.to;
    if (last.number < doc.lines) {
      to = doc.line(last.number + 1).from;
      const blankAfter = !doc.line(last.number + 1).text.trim();
      const blankBefore = first.number === 1 || !doc.line(first.number - 1).text.trim();
      if (blankAfter && blankBefore && last.number + 1 < doc.lines) to = doc.line(last.number + 2).from;
    } else if (first.number > 1) from = doc.line(first.number - 1).to;
    this.setPick(null);
    this.view.dispatch({ changes: { from, to }, selection: { anchor: from }, scrollIntoView: true, userEvent: 'delete' });
    this.view.focus();
  }

  toSource() {
    const grid = this.leave('stay');
    grid.setPick(null);
    const found = grid.found();
    if (found) openSource(this.view, { from: found.from, to: found.end });
  }

  // -- a column's and a row's menus --

  /** A structure gesture from a menu: written, then the keyboard on `focus` (`['col', i]`, `['row', i]` or a cell to type in). */
  apply(step, focus) {
    const grid = this.write([step]);
    if (!focus) return;
    const [what, at, col] = focus;
    if (what === 'cell') grid.edit(at, col);
    else if (what === 'col') grid.cellAt(-1, at)?.querySelector('.cm-grid-colbtn')?.focus({ preventScroll: true });
    else if (what === 'row') {
      if (at >= grid.shownRows()) grid.setWhole(true);
      grid.body.querySelector(`.cm-grid-row[data-row="${at}"] .cm-grid-rowbtn`)?.focus({ preventScroll: true });
    }
  }

  columnMenu(col, anchor) {
    const grid = this.leave('stay');
    const table = grid.table;
    const last = table.header.length - 1;
    const [up, down] = SORTS[sortRows(table, col, 'asc').kind] ?? SORTS.text;
    const side = table.align[col] ?? 'left';
    const back = grid.cellAt(-1, col)?.querySelector('.cm-grid-colbtn') ?? anchor;
    const items = [
      { label: up, iconName: 'sortUp', run: () => grid.apply((t) => sortRows(t, col, 'asc'), ['col', col]) },
      { label: down, iconName: 'sortDown', run: () => grid.apply((t) => sortRows(t, col, 'desc'), ['col', col]) },
      '-',
      { label: 'Insert a column left', iconName: 'plus', run: () => grid.apply((t) => insertColumn(t, col), ['cell', -1, col]) },
      { label: 'Insert a column right', iconName: 'plus', run: () => grid.apply((t) => insertColumn(t, col + 1), ['cell', -1, col + 1]) },
      { label: 'Move left', iconName: 'chevronLeft', disabled: col === 0, run: () => grid.apply((t) => moveColumn(t, col, col - 1), ['col', col - 1]) },
      { label: 'Move right', iconName: 'chevronRight', disabled: col === last, run: () => grid.apply((t) => moveColumn(t, col, col + 1), ['col', col + 1]) },
      '-',
      { label: 'Align left', iconName: 'alignLeft', checked: side === 'left', run: () => grid.apply((t) => setAlign(t, col, null), ['col', col]) },
      { label: 'Align centre', iconName: 'alignCentreH', checked: side === 'center', run: () => grid.apply((t) => setAlign(t, col, 'center'), ['col', col]) },
      { label: 'Align right', iconName: 'alignRight', checked: side === 'right', hint: 'Numbers', run: () => grid.apply((t) => setAlign(t, col, 'right'), ['col', col]) },
      '-',
      { label: 'Fill down', iconName: 'fillDown', hint: 'Empty cells take the one above', run: () => grid.apply((t) => fillDown(t, col), ['col', col]) },
      '-',
      { label: 'Delete the column', iconName: 'trash', danger: true, disabled: last === 0, run: () => grid.apply((t) => removeColumn(t, col), ['col', Math.min(col, last - 1)]) },
    ];
    openMenu(this.view, back, items, { label: `Column ${columnName(table, col)}` });
  }

  rowMenu(row, anchor) {
    const grid = this.leave('stay');
    const last = grid.table.rows.length - 1;
    const back = grid.body.querySelector(`.cm-grid-row[data-row="${row}"] .cm-grid-rowbtn`) ?? anchor;
    const items = [
      { label: 'Insert a row above', iconName: 'plus', run: () => grid.apply((t) => insertRow(t, row), ['cell', row, 0]) },
      { label: 'Insert a row below', iconName: 'plus', run: () => grid.apply((t) => insertRow(t, row + 1), ['cell', row + 1, 0]) },
      { label: 'Duplicate', iconName: 'copy', run: () => grid.apply((t) => duplicateRow(t, row), ['row', row + 1]) },
      '-',
      { label: 'Move up', iconName: 'chevronUp', disabled: row === 0, run: () => grid.apply((t) => moveRow(t, row, row - 1), ['row', row - 1]) },
      { label: 'Move down', iconName: 'chevronDown', disabled: row === last, run: () => grid.apply((t) => moveRow(t, row, row + 1), ['row', row + 1]) },
      '-',
      { label: 'Delete the row', iconName: 'trash', danger: true, run: () => grid.apply((t) => removeRow(t, row), last > 0 ? ['row', Math.min(row, last - 1)] : null) },
    ];
    openMenu(this.view, back, items, { label: `Row ${row + 1}` });
  }

  /** Alt+Up or Alt+Down in a cell: its row moves, the caret with it. */
  moveRowTo(row, to, col) {
    const grid = this.write([this.step(this.close()), (table) => moveRow(table, row, to)]);
    grid.edit(to, col);
  }

  // -- the box's own events --

  listen() {
    const { box, view } = this;
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (target.closest('.cm-grid-input, button, .cm-grid-menu, .cm-grid-pastebox, .cm-grid-mention')) return;
      const inGrid = target.closest('.cm-grid-ui');
      const chip = target.closest('[data-chip]');
      // Ctrl+click opens a record cited in a cell, and a link as the browser does; a press types in the cell
      if (chip && inGrid && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const entity = resolve(view.state.field(noteCase), chip.dataset.entityId);
        if (entity) this.handlers.open?.(entity);
        return;
      }
      if (inGrid && target.closest('a[href]') && (event.ctrlKey || event.metaKey)) return;
      const cell = target.closest('.cm-grid-cell');
      if (cell && inGrid && this.writable && !view.state.readOnly) {
        event.preventDefault();
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        if (this.editing?.row === row && this.editing?.col === col) return;
        const caret = caretAt(cell, this.textAt(row, col), event);
        if (this.editing) this.go(row, col, caret ?? 'end');
        else this.edit(row, col, { caret: caret ?? 'end' });
        return;
      }
      if (inGrid && this.writable) {
        event.preventDefault();
        return;
      }
      // the frame around the grid, or a note that cannot be written: the press picks the block
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.anchorFor('pick') } });
      view.focus();
    });
    box.addEventListener('click', (event) => {
      const link = event.target.closest?.('.cm-grid-ui a[href]');
      if (link && !(event.ctrlKey || event.metaKey)) event.preventDefault();
    });
    box.addEventListener('dragover', (event) => {
      const cell = event.target.closest?.('.cm-grid-cell');
      if (!cell || !this.writable || !carriesMedia(event) || cell.dataset.row === '-1') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      for (const other of box.querySelectorAll('.cm-grid-drop')) if (other !== cell) other.classList.remove('cm-grid-drop');
      cell.classList.add('cm-grid-drop');
    });
    box.addEventListener('dragleave', (event) => {
      const cell = event.target.closest?.('.cm-grid-cell');
      if (cell && !cell.contains(event.relatedTarget)) cell.classList.remove('cm-grid-drop');
    });
    box.addEventListener('drop', (event) => {
      const cell = event.target.closest?.('.cm-grid-cell');
      for (const other of box.querySelectorAll('.cm-grid-drop')) other.classList.remove('cm-grid-drop');
      if (!cell || !this.writable || !carriesMedia(event) || cell.dataset.row === '-1') return;
      event.preventDefault();
      event.stopPropagation();
      this.dropped(cell, droppedMedia(event));
    });
    this.scroller.addEventListener('scroll', () => this.edges(), { passive: true });
    // on a column's or a row's button, or the bar, Undo and Redo are the note's, as in the text
    box.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target.closest('textarea, input')) return;
      const letter = event.key.toLowerCase();
      if (letter !== 'z' && letter !== 'y') return;
      event.preventDefault();
      if (letter === 'z' && !event.shiftKey) undo(view);
      else redo(view);
    });
    box.addEventListener('focusin', () => box.classList.add('cm-grid-active'));
    box.addEventListener('focusout', (event) => {
      if (!box.contains(event.relatedTarget)) box.classList.remove('cm-grid-active');
    });
    // a press in the note's text lets the pick go: a put lands at the cursor again
    this.unpick = () => {
      if (this.pick) this.setPick(null);
    };
    view.contentDOM.addEventListener('focus', this.unpick);
    // the page grows or shrinks: a wide table takes the room it has
    if (typeof ResizeObserver === 'function') {
      let frame = 0;
      this.resized = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this.fit());
      });
      this.resized.observe(view.scrollDOM);
    }
  }

  destroy() {
    this.view.contentDOM.removeEventListener('focus', this.unpick);
    this.resized?.disconnect();
    if (pickedGrid === this) pickedGrid = null;
    const edit = this.editing;
    if (!edit) return;
    // drawn away while a cell was typed in (scrolled far, or the note redrawn): what was typed is still written
    const from = this.from;
    const step = this.step(this.close());
    if (step && from >= 0) {
      queueMicrotask(() => {
        try {
          changeTable(this.view, from, (table) => chain(table, step));
        } catch { /* the editor is gone */ }
      });
    }
  }
}

/** Fill down: each empty cell of `col` takes the filled one above it; total rows are left alone. */
export function fillDown(table, col) {
  let carried = '';
  const values = table.rows.map((cells) => {
    if (isTotalRow(cells)) return cells[col];
    if (plainText(cells[col])) carried = cells[col];
    return carried;
  });
  return fillColumn(table, col, (_cells, row) => values[row], { onlyEmpty: true });
}

// -- the widget --------------------------------------------------------------------

/**
 * A table drawn as a grid. It is drawn again in place, cell by cell, only for its
 * own table (`tableIds`): another table changed in the same step never takes its
 * box.
 */
export class GridWidget extends BlockWidget {
  constructor(spec) {
    super('table', spec.source, spec.info, spec.writable, '', spec.pinned, spec.picked);
    this.table = spec.table ?? parseTable(spec.source);
    this.tableId = spec.tableId ?? null;
    this.whole = Boolean(spec.whole);
    this.look = spec.look ?? null;
  }

  toDOM(view) {
    const box = document.createElement('div');
    // eslint-disable-next-line no-new
    new Grid(box, this, view);
    markPicked(box, this.picked);
    holdHeight(box, this);
    return box;
  }

  updateDOM(dom, _view, previous) {
    if (!dom.grid || !(previous instanceof GridWidget) || previous.tableId !== this.tableId || previous.writable !== this.writable) return false;
    if (previous.same(this)) dom.grid.widget = this;
    else dom.grid.update(this);
    markPicked(dom, this.picked);
    moveHeight(dom, this);
    return true;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown' || Boolean(event.target?.closest?.('.cm-grid-ui'));
  }

  destroy(dom) {
    releaseHeight(dom);
    dom.grid?.destroy();
  }

  /** A table folded or shown whole is another height. */
  heightKey() {
    this.gridKey ??= `${super.heightKey()}${this.whole ? ' whole' : ''}`;
    return this.gridKey;
  }

  /** The height it was last drawn at, else rows of 34 px. */
  get estimatedHeight() {
    const held = heldHeight(this);
    if (held) return held;
    const rows = rowsShown(this.table.rows.length, this.whole);
    return 60 + 34 * (rows + 1) + (this.table.rows.length > FOLD_PAST ? 34 : 0);
  }
}

/** Enter on a picked table, or a double press on its frame: the caret in its first cell; a locked note opens the source. */
function openGrid(view, block) {
  const grid = gridAt(view, block.from);
  if (!grid || !grid.writable || view.state.readOnly) return openSource(view, block);
  return grid.edit(grid.table.rows.length ? 0 : -1, 0);
}

/** A table `tableText.js` reads, as the page draws it: a grid. */
function gridSpec(ctx, found) {
  const tableId = tableIdAt(ctx.state, found.from);
  return { from: found.from, to: found.end, grid: true, table: found.table, look: found.look, tableId, whole: shownWhole(ctx.state, tableId) };
}

const plain = blockKind('table');

const THEME = {
  '.cm-grid-block': { padding: '8px var(--note-gutter, 32px)', cursor: 'default' },
  '.cm-grid-frame': {
    position: 'relative', border: '1px solid var(--border-strong)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-0)',
    fontFamily: 'var(--font-sans)', fontSize: '0.88em', lineHeight: '1.45',
    // the editor's lines break anywhere; a cell breaks between words, as a sheet does
    overflowWrap: 'normal', wordBreak: 'normal', whiteSpace: 'normal',
  },
  '.cm-grid-block.cm-picked': { outline: 'none' },
  '.cm-grid-block.cm-picked .cm-grid-frame': { boxShadow: '0 0 0 2px var(--accent)' },
  '.cm-grid-bar': {
    display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 6px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  '.cm-grid-spring': { flex: '1' },
  '.cm-grid-tool': {
    display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 9px', border: '1px solid transparent',
    borderRadius: '5px', background: 'none', color: 'var(--text-2)', font: 'inherit', fontSize: '12.5px', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-grid-tool:hover, .cm-grid-tool:focus-visible': { background: 'var(--bg-3)', color: 'var(--text-1)', outline: 'none' },
  '.cm-grid-tool:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-grid-tool svg': { flex: 'none', opacity: '0.85' },
  '.cm-grid-chart': { background: 'var(--accent)', color: 'var(--accent-text)', fontWeight: '650' },
  '.cm-grid-chart:hover, .cm-grid-chart:focus-visible': { background: 'var(--accent-hover)', color: 'var(--accent-text)' },
  '.cm-grid-more, .cm-grid-source': { padding: '0 7px', minWidth: '28px', justifyContent: 'center' },
  '.cm-grid-source::before': { content: '"</>"', fontFamily: 'var(--font-mono)', fontSize: '11px' },
  '.cm-grid-scroll': { overflowX: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--border-strong) transparent' },
  '.cm-grid-well': { position: 'relative' },
  '.cm-grid-more-right::after, .cm-grid-more-left::before': {
    content: '""', position: 'absolute', top: '0', bottom: '0', width: '26px', pointerEvents: 'none', zIndex: '1',
  },
  // the cut columns fade out into the page
  '.cm-grid-more-right::after': { right: '0', width: '44px', background: 'linear-gradient(to right, color-mix(in srgb, var(--bg-0) 0%, transparent), var(--bg-0) 85%)' },
  '.cm-grid-more-left::before': { left: '0', width: '44px', background: 'linear-gradient(to left, color-mix(in srgb, var(--bg-0) 0%, transparent), var(--bg-0) 85%)' },
  '.cm-grid-text.cm-grid-short': { whiteSpace: 'nowrap' },
  'table.cm-grid': { width: '100%', borderCollapse: 'separate', borderSpacing: '0', fontSize: 'inherit', tableLayout: 'auto' },
  '.cm-grid th, .cm-grid td': {
    border: 'none', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '0', textAlign: 'left',
    verticalAlign: 'top', background: 'none',
  },
  '.cm-grid tr > :last-child': { borderRight: 'none' },
  '.cm-grid tbody tr:last-child > *': { borderBottom: 'none' },
  '.cm-grid-cell': { position: 'relative', minWidth: '3.2em', cursor: 'text' },
  '.cm-grid-locked .cm-grid-cell': { cursor: 'default' },
  // a long cell wraps at a width a sheet would give it; an address breaks anywhere rather than widen its column
  '.cm-grid-text': { padding: '6px 10px', minHeight: '1.45em', maxWidth: '20em', color: 'var(--text-1)' },
  '.cm-grid-text a, .cm-grid-text code': { overflowWrap: 'anywhere' },
  '.cm-grid-editing': { maxWidth: '20em' },
  '.cm-grid-text:empty::before': { content: 'attr(data-placeholder)', color: 'var(--text-3)', fontStyle: 'italic', fontWeight: '400' },
  '.cm-grid-text p': { margin: '0' },
  '.cm-grid-text a': { color: 'var(--info)', textDecoration: 'none', borderBottom: '1px solid color-mix(in srgb, var(--info) 40%, transparent)' },
  '.cm-grid-text code': { fontFamily: 'var(--font-mono)', fontSize: '0.92em', background: 'var(--bg-2)', borderRadius: '3px', padding: '0 3px' },
  '.cm-grid-text .cm-chip': { fontSize: '0.96em', lineHeight: '1.5' },
  '.cm-grid .cm-grid-thumb': {
    display: 'inline-block', verticalAlign: 'middle', maxHeight: '56px', maxWidth: '100px', width: 'auto', margin: '1px 4px 1px 0',
    borderRadius: '3px', boxShadow: '0 0 0 1px var(--border)',
  },
  '.cm-grid thead th': { background: 'var(--bg-2)', color: 'var(--text-2)', fontWeight: '650', verticalAlign: 'middle' },
  '.cm-grid-head .cm-grid-text': { color: 'var(--text-2)', flex: '1', minWidth: '0' },
  // a column the chart does not draw stays with its rows, greyed and marked
  '.cm-grid .cm-grid-idle': { background: 'color-mix(in srgb, var(--text-1) 3.5%, transparent)' },
  '.cm-grid .cm-grid-idle .cm-grid-text, .cm-grid .cm-grid-idle .cm-chip': { color: 'var(--text-3)' },
  '.cm-grid .cm-grid-idle .cm-grid-thumb': { opacity: '0.55' },
  // what a chart reads in, or does with, a column of its rows (`editor/rowsGrid.js`, `lib/cellHints.js`)
  '.cm-grid-expects': {
    flex: 'none', marginRight: '2px', padding: '0 5px', borderRadius: '3px', background: 'var(--bg-3)', color: 'var(--text-3)',
    fontSize: '10.5px', fontWeight: '500', lineHeight: '16px', whiteSpace: 'nowrap',
  },
  '.cm-grid-reading': { marginLeft: '0.5em', color: 'var(--text-3)', fontSize: '0.92em', whiteSpace: 'nowrap' },
  // a cell the chart cannot read: a warning's wavy line, as a spelling checker marks a word
  '.cm-grid-unread': {
    textDecorationLine: 'underline', textDecorationStyle: 'wavy', textDecorationColor: 'var(--warn)', textDecorationThickness: '1.5px',
    textUnderlineOffset: '3px', textDecorationSkipInk: 'none',
  },
  '.cm-grid-text.cm-grid-example:empty::before': { fontStyle: 'normal', opacity: '0.75' },
  '.cm-grid-idle-mark': {
    flex: 'none', marginRight: '4px', padding: '0 5px', border: '1px dashed var(--border-strong)', borderRadius: '3px', color: 'var(--text-3)',
    fontSize: '10.5px', fontWeight: '500', lineHeight: '16px', whiteSpace: 'nowrap',
  },
  '.cm-grid-head-in': { display: 'flex', alignItems: 'center', gap: '2px', paddingRight: '4px' },
  '.cm-grid-head-in.cm-grid-end .cm-grid-text': { textAlign: 'right' },
  '.cm-grid-head-in.cm-grid-middle .cm-grid-text': { textAlign: 'center' },
  '.cm-grid-colbtn': {
    flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', padding: '0',
    border: 'none', borderRadius: '4px', background: 'none', color: 'var(--text-2)', cursor: 'pointer',
  },
  '.cm-grid-colbtn:hover, .cm-grid-colbtn:focus-visible, .cm-grid-colbtn[aria-expanded="true"]': { background: 'var(--bg-3)', color: 'var(--text-1)', outline: 'none' },
  '.cm-grid-corner, .cm-grid-num': { width: '34px', minWidth: '34px', background: 'var(--bg-1) !important' },
  '.cm-grid-num': { color: 'var(--text-3)', textAlign: 'center !important', fontWeight: '400', fontSize: '0.88em', verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' },
  '.cm-grid-locked .cm-grid-num': { paddingTop: '7px' },
  '.cm-grid-rowbtn': {
    display: 'block', width: '100%', minHeight: '30px', padding: '6px 0 0', border: 'none', background: 'none', color: 'inherit', font: 'inherit',
    cursor: 'pointer', verticalAlign: 'top',
  },
  '.cm-grid-rowbtn:hover, .cm-grid-rowbtn:focus-visible, .cm-grid-rowbtn[aria-expanded="true"]': { color: 'var(--text-1)', background: 'var(--bg-3)', outline: 'none' },
  '.cm-grid-colbtn:focus-visible, .cm-grid-rowbtn:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-grid-ghost .cm-grid-num': { color: 'var(--accent)', paddingTop: '6px' },
  '.cm-grid-ghost td': { background: 'color-mix(in srgb, var(--accent) 4%, transparent)' },
  '.cm-grid tbody tr:hover > td': { background: 'color-mix(in srgb, var(--text-1) 2.5%, transparent)' },
  '.cm-grid td.cm-grid-editing, .cm-grid th.cm-grid-editing': {
    background: 'color-mix(in srgb, var(--info) 8%, var(--bg-0)) !important', boxShadow: 'inset 0 0 0 1.5px var(--info)',
  },
  '.cm-grid .cm-grid-picked': { boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--info) 70%, transparent)' },
  '.cm-grid .cm-grid-drop': { boxShadow: 'inset 0 0 0 2px var(--accent)', background: 'var(--accent-soft) !important' },
  '.cm-grid .cm-grid-flash': { background: 'color-mix(in srgb, var(--accent) 22%, transparent) !important', transition: 'background-color 0.6s ease-out' },
  '.cm-grid-input': {
    display: 'block', boxSizing: 'border-box', width: '100%', minWidth: '0', minHeight: '100%', margin: '0', padding: '6px 10px', border: 'none',
    outline: 'none', background: 'transparent', color: 'var(--text-1)', font: 'inherit', lineHeight: 'inherit', resize: 'none',
    overflow: 'hidden', caretColor: 'var(--accent)', textAlign: 'inherit',
  },
  '.cm-grid-head .cm-grid-input': { fontWeight: '650', color: 'var(--text-1)' },
  '.cm-grid-cut': {
    display: 'inline-flex', alignItems: 'center', gap: '6px', margin: '4px 8px 5px', padding: '2px 8px', border: '1px dashed var(--border-strong)',
    borderRadius: '5px', background: 'none', color: 'var(--text-3)', font: 'inherit', fontSize: '0.92em', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-grid-cut small': { fontVariantNumeric: 'tabular-nums', opacity: '0.85' },
  '.cm-grid-cut:hover, .cm-grid-cut:focus-visible': { color: 'var(--accent)', borderColor: 'var(--accent)', borderStyle: 'solid', outline: 'none' },
  '.cm-grid-text + .cm-grid-cut': { marginTop: '0' },
  '.cm-grid-fold': { borderTop: '1px solid var(--border)', background: 'var(--bg-1)' },
  '.cm-grid-foldbtn': {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 10px 6px 11px', border: 'none', background: 'none',
    color: 'var(--text-3)', font: 'inherit', fontSize: '0.95em', cursor: 'pointer', textAlign: 'left',
  },
  '.cm-grid-foldbtn:hover, .cm-grid-foldbtn:focus-visible': { color: 'var(--text-1)', outline: 'none' },
  '.cm-grid-menu, .cm-grid-pastebox, .cm-table-picker': {
    position: 'fixed', zIndex: '60', background: 'var(--bg-2)', border: '1px solid var(--border-strong)', borderRadius: '7px',
    boxShadow: 'var(--shadow-2)', fontFamily: 'var(--font-sans)', fontSize: '12.5px', color: 'var(--text-1)',
  },
  '.cm-grid-menu': { minWidth: '220px', padding: '4px', display: 'flex', flexDirection: 'column' },
  '.cm-grid-menu-item': {
    display: 'grid', gridTemplateColumns: '16px 1fr auto', alignItems: 'center', gap: '9px', width: '100%', padding: '5px 9px', border: 'none',
    borderRadius: '4px', background: 'none', color: 'var(--text-1)', font: 'inherit', textAlign: 'left', cursor: 'pointer',
  },
  '.cm-grid-menu-item small': { color: 'var(--text-3)', fontSize: '11px' },
  '.cm-grid-menu-item:hover:not(:disabled), .cm-grid-menu-item:focus-visible': { background: 'var(--bg-3)', outline: 'none' },
  '.cm-grid-menu-item:disabled': { color: 'var(--text-3)', cursor: 'default' },
  '.cm-grid-menu-item svg': { color: 'var(--text-2)' },
  '.cm-grid-menu-item[aria-checked="true"]': { color: 'var(--accent)' },
  '.cm-grid-menu-item[aria-checked="true"] svg': { color: 'var(--accent)' },
  '.cm-grid-menu-item.danger': { color: 'var(--danger)' },
  '.cm-grid-menu-item.danger svg': { color: 'var(--danger)' },
  '.cm-grid-menu-line': { height: '1px', margin: '4px 6px', background: 'var(--border)' },
  '.cm-grid-pastebox': { width: '280px', padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  '.cm-grid-pastebox p': { margin: '0', color: 'var(--text-2)' },
  '.cm-grid-pastebox small': { color: 'var(--text-3)' },
  '.cm-grid-pastefield': {
    boxSizing: 'border-box', width: '100%', resize: 'none', padding: '8px 10px', border: '1px dashed var(--border-strong)', borderRadius: '5px',
    background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', outline: 'none', textAlign: 'center',
  },
  '.cm-grid-pastefield:focus': { borderColor: 'var(--info)', borderStyle: 'solid' },
  '.cm-tooltip.cm-grid-mention': { position: 'fixed', zIndex: '60' },
  '.cm-tooltip.cm-grid-mention > ul': { maxWidth: 'min(440px, 90vw)', minWidth: '220px' },
  '.cm-table-picker': { padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px', width: 'max-content' },
  '.cm-table-picker-head': { display: 'flex', alignItems: 'baseline', gap: '10px' },
  '.cm-table-picker-head span': { color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' },
  '.cm-table-picker-grid': { display: 'grid', gap: '3px', padding: '2px', borderRadius: '4px', outline: 'none', alignSelf: 'flex-start' },
  '.cm-table-picker-grid:focus-visible': { boxShadow: '0 0 0 2px color-mix(in srgb, var(--info) 60%, transparent)' },
  '.cm-table-picker-grid span': {
    width: '16px', height: '16px', boxSizing: 'border-box', borderRadius: '3px', border: '1px solid var(--border-strong)', background: 'var(--bg-1)',
    cursor: 'pointer',
  },
  '.cm-table-picker-grid span.on': { background: 'color-mix(in srgb, var(--info) 38%, var(--bg-1))', borderColor: 'var(--info)' },
  '.cm-table-picker small': { color: 'var(--text-3)', maxWidth: '190px' },
  '.cm-table-picker-file': {
    alignSelf: 'stretch', height: '28px', border: '1px solid var(--border-strong)', borderRadius: '5px', background: 'var(--bg-1)',
    color: 'var(--text-1)', font: 'inherit', cursor: 'pointer',
  },
  '.cm-table-picker-file:hover, .cm-table-picker-file:focus-visible': { borderColor: 'var(--accent)', outline: 'none' },
};

registerBlock({
  ...plain,
  // a table the parser draws: the lines `tableText.js` reads, as a grid; one inside a quote, as it reads
  read: (node, ctx) => {
    const found = tableNear(ctx.state, node.from);
    return found ? gridSpec(ctx, found) : { from: node.from, to: node.to };
  },
  // a table the parser misses (a chip in its header): found by its first line
  line: (line, ctx) => {
    const found = tableStartingAt(ctx.state, line.from);
    if (!found || ctx.isOpen(found.from, found.end)) return null;
    ctx.standsWhole({ from: found.from, to: found.end });
    return gridSpec(ctx, found);
  },
  widget: (spec) => (spec.grid ? new GridWidget(spec) : plain.widget(spec)),
  open: openGrid,
  height: 220,
  theme: { ...THEME, ...SETTINGS_THEME },
  extensions: [tableIds, wholeTables, pasteAsTable],
});
