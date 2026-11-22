/**
 * A row of columns (`lib/notes/columns.js`): pictures or words side by side, drawn as
 * the PDF prints them. Its bar sets two or three columns and their widths. An empty
 * column offers a case picture or a file. A picture writes its caption in place, moves
 * left or right, is replaced, opens where it was made or comes out of the row. A row of
 * pictures alone sets them at one height, nothing cropped.
 *
 * Words are written in place: a press on a column's words puts the caret there, and
 * while it stays, that column's lines stand where the column does, the other columns
 * drawn beside them, so the row keeps its shape as it is typed (`writtenIn`). Tab goes
 * to the next column, Escape picks the row, the arrows leave it at its top and bottom,
 * and the row's other lines stand still meanwhile (`guardRow`). Its `</>` shows the
 * Markdown, as every block's does.
 *
 * Every gesture is one change, so one Undo takes it back.
 */
import { completionStatus } from '@codemirror/autocomplete';
import { EditorState, Prec } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view';

import {
  COLUMNS_CLOSE, COLUMNS_OPEN, MAX_COLUMNS, MIN_COLUMNS, WIDTHS, columnShares, isEmptyColumn, movedColumn, pictureOf,
  picturesOnly, readColumns, takenApart, takenOut, widthsOf, withColumnText, withCount, withWidths,
} from '../columns.js';
import { CAPTION_HELP, SOURCE_HELP, captionField, pictureReference, replacedLine, rovingToolbar } from '../pictureSize.js';
import { registerBlock } from './blocks.js';
import { openBlockMenu } from './blockMenu.js';
import { openCasePicker } from './casePicker.js';
import { drawn } from './decorations.js';
import { iconSvg } from './icon.js';
import { openSourceField, pictureEntity, resizePicture } from './pictureBlock.js';
import { columnAt, rowAround, rowOver } from './columnsRow.js';
import { openSource } from './ranges.js';
import { noteCase, noteHandlers, openBlock } from './state.js';
import { BlockWidget, drawMarkdown, pickBlock } from './widgets.js';

/** The room between two columns, in pixels, on the page as in the editor. */
const GAP = 16;
/** What a gesture on a row is written as, so the row's guard lets it through. */
const EVENT = 'input.columns';

function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

function button(className, { label = '', icon = '', title = '', data = {} } = {}) {
  const made = el('button', className);
  made.type = 'button';
  if (icon) made.append(iconSvg(icon));
  if (label) made.append(document.createTextNode(label));
  if (title) made.title = title;
  if (!label && title) made.setAttribute('aria-label', title);
  for (const [key, value] of Object.entries(data)) made.dataset[key] = value;
  return made;
}

/** The column being written in: the cursor's, on the drawn page, unless the row's source is open. */
function writing(state) {
  if (!state.field(drawn, false)) return null;
  const range = state.selection.main;
  const at = columnAt(state, range.head);
  if (!at) return null;
  const open = state.field(openBlock, false);
  return open && open.from <= at.row.from && open.to >= at.row.to ? null : at;
}

// -- gestures -----------------------------------------------------------------------------

/** Replace the row at `rowFrom` with `text`, one change, the row picked after (or where it stood, taken apart). */
function rewrite(view, rowFrom, text) {
  const row = rowAround(view.state, rowFrom);
  if (!row || text === null || view.state.readOnly) return false;
  if (text === row.source) return false;
  view.dispatch({ changes: { from: row.from, to: row.to, insert: text }, selection: { anchor: row.from }, userEvent: EVENT });
  view.focus();
  return true;
}

/**
 * Put the caret in column `index` of the row at `rowFrom`: at the end of its words, or
 * where `at` (a point on screen) falls in them once they are laid out. A column with no
 * line between its fences gets one.
 */
export function writeInColumn(view, rowFrom, index, { at = null } = {}) {
  if (view.state.readOnly) return false;
  const row = rowAround(view.state, rowFrom);
  const column = row?.columns[index];
  if (!column) return false;
  if (column.contentFrom === null) {
    const pos = view.state.doc.line(column.openLine).to;
    view.dispatch({ changes: { from: pos, insert: '\n' }, selection: { anchor: pos + 1 }, userEvent: EVENT, scrollIntoView: true });
  } else view.dispatch({ selection: { anchor: column.contentTo }, userEvent: 'select' });
  view.focus();
  if (at) {
    view.requestMeasure({
      read: (measured) => measured.posAtCoords(at),
      // the editor takes no change while it measures: the caret moves once it is done
      write: (pos, measured) => queueMicrotask(() => {
        const now = columnAt(measured.state, pos ?? -1);
        if (now && now.row.from === rowAround(measured.state, rowFrom)?.from && now.index === index) {
          measured.dispatch({ selection: { anchor: pos }, userEvent: 'select' });
        }
      }),
    });
  }
  return true;
}

/** Open the case's pictures by `anchor`; the one picked is written by `write(entity)`. */
function pickPicture(view, anchor, title, write) {
  openCasePicker(view, anchor, { title, pick: (entity) => write(entity) });
}

/** Write the caption of the picture of column `index` in a field under it, in `figure`. */
function openColumnCaption(view, figure, rowFrom, index, returnTo = null) {
  if (figure.querySelector('.picture-caption-field')) return;
  const row = rowAround(view.state, rowFrom);
  const column = row?.columns[index];
  const picture = column ? pictureOf(column) : null;
  if (!picture) return;
  figure.classList.add('cm-captioning');
  const field = captionField({
    caption: picture.caption,
    title: picture.title,
    write: (caption) => {
      const now = rowAround(view.state, rowFrom)?.columns[index];
      if (!now) return;
      // the picture's line among the column's, found by what it shows
      resizePicture(view, now.openLine, picture.ref, { caption });
    },
    done: (by) => {
      figure.classList.remove('cm-captioning');
      field.remove();
      if (by !== 'keyboard') return;
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
      else view.focus();
    },
  });
  figure.append(field);
  field.focus({ preventScroll: true });
  field.select();
}

/**
 * A press in a row (drawn whole, or beside the column being written in): its bar, an
 * empty column's offers, a picture's bar and caption, or a column's words. `box` is
 * the element the row is drawn in, whose start is the row's.
 */
function pressRow(target, box, view, point = null) {
  const rowFrom = view.posAtDOM(box);
  const row = rowAround(view.state, rowFrom);
  if (!row) return;
  const columnBox = target.closest('[data-column]');
  const index = columnBox ? Number(columnBox.dataset.column) : -1;
  const column = row.columns[index] ?? null;
  const pressed = target.closest('button');
  const handlers = view.state.facet(noteHandlers);
  if (pressed?.dataset.count) return rewrite(view, rowFrom, withCount(row.source, Number(pressed.dataset.count)));
  if (pressed?.dataset.widths) return rewrite(view, rowFrom, withWidths(row.source, pressed.dataset.widths));
  if (pressed?.dataset.colsSource) return openSource(view, { from: row.from, to: row.to });
  if (pressed?.dataset.colsMore) {
    openBlockMenu(view, { from: row.from, to: row.to, kind: 'columns' }, { anchor: pressed, label: 'Columns' });
    return true;
  }
  if (!column) {
    pickBlock(view, box, { focus: true });
    return true;
  }
  if (pressed?.dataset.addPicture) {
    return pickPicture(view, pressed, 'Add a picture', (entity) => rewrite(view, rowFrom, withColumnText(row.source, index, pictureReference(entity))));
  }
  if (pressed?.dataset.addFile) {
    if (writeInColumn(view, rowFrom, index)) handlers.upload?.();
    return true;
  }
  const picture = pictureOf(column);
  if (picture) {
    const figure = columnBox.querySelector('.cm-col-figure');
    if (pressed?.dataset.colCaption || target.closest('[data-caption-edit]')) return openColumnCaption(view, figure, rowFrom, index, pressed);
    if (pressed?.dataset.colMove) return rewrite(view, rowFrom, movedColumn(row.source, index, Number(pressed.dataset.colMove)));
    if (pressed?.dataset.colOut) return rewrite(view, rowFrom, takenOut(row.source, index));
    if (pressed?.dataset.colReplace) {
      return pickPicture(view, pressed, 'Replace the picture', (entity) => {
        rewrite(view, rowFrom, withColumnText(row.source, index, replacedLine(picture.line, picture.ref, entity) ?? picture.line));
      });
    }
    const entity = pictureEntity(view.state.field(noteCase), picture);
    if (entity && pressed?.dataset.colOpen) return handlers.opener?.(entity)?.open();
    if (entity && pressed?.dataset.colSource) return openSourceField(view, figure, entity);
    if (pressed) return true;
    // a press on the picture itself picks the row, as a press on any picture picks it
    view.dispatch({ selection: { anchor: row.from }, userEvent: 'select' });
    view.focus();
    return true;
  }
  // a column's words: the caret goes there, or the row is picked in a note that cannot be written
  if (!writeInColumn(view, rowFrom, index, { at: point })) pickBlock(view, box, { focus: true });
  return true;
}

// -- drawing ------------------------------------------------------------------------------

/** The bar over a row: two or three columns, the widths of two columns of words, the menu and the source. */
function rowBar(row) {
  const bar = el('div', 'cm-cols-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Columns');
  // Tab on the picked row walks into it, as into a picture's bar (`editor/blockKeys.js`)
  bar.dataset.sizeBar = 'true';
  const said = el('span', 'cm-cols-said', iconSvg('columns'), 'Columns');
  const count = el('span', 'cm-cols-seg');
  for (let number = MIN_COLUMNS; number <= MAX_COLUMNS; number += 1) {
    const one = button('cm-cols-count', { label: String(number), title: `${number} columns`, data: { count: String(number) } });
    one.setAttribute('aria-pressed', String(row.columns.length === number));
    count.append(one);
  }
  bar.append(said, count);
  if (picturesOnly(row.columns)) bar.append(el('span', 'cm-cols-note', 'Pictures at one height, none cropped'));
  else if (row.columns.length === 2) {
    const now = widthsOf(row.columns);
    const widths = el('span', 'cm-cols-seg');
    for (const preset of WIDTHS) {
      const one = button('cm-cols-width', { title: preset.label, data: { widths: preset.id } });
      const drawing = el('span', 'cm-cols-wicon');
      for (const width of preset.widths) {
        const part = el('i');
        part.style.width = `${width ? 15 : preset.widths.some(Boolean) ? 7 : 11}px`;
        drawing.append(part);
      }
      one.append(drawing);
      one.setAttribute('aria-pressed', String(now === preset.id));
      widths.append(one);
    }
    bar.append(widths);
  }
  bar.append(
    button('cm-cols-more', { icon: 'more', title: 'Take apart, move, duplicate or delete the row', data: { colsMore: 'true' } }),
    button('cm-size-edit', { title: 'Edit the source', data: { colsSource: 'true' } }),
  );
  rovingToolbar(bar);
  return bar;
}

/** A picture's bar in a column: its caption, its place in the row, another picture, its tool, its source, out of the row. */
function columnPictureBar(view, picture, index, count, info) {
  const bar = el('div', 'cm-col-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Picture');
  bar.append(button('', { icon: 'text', title: CAPTION_HELP.button, data: { colCaption: 'true' } }));
  if (index > 0) bar.append(button('', { icon: 'chevronLeft', title: 'Move left', data: { colMove: '-1' } }));
  if (index < count - 1) bar.append(button('', { icon: 'chevronRight', title: 'Move right', data: { colMove: '1' } }));
  bar.append(button('', { icon: 'swap', title: 'Replace: another picture of the case in its place, its caption kept', data: { colReplace: 'true' } }));
  const handlers = view.state.facet(noteHandlers);
  const entity = pictureEntity(info, picture);
  const opener = entity ? handlers.opener?.(entity) : null;
  if (opener) bar.append(button('cm-col-open', { label: opener.label, title: `${opener.label}, where this picture was made`, data: { colOpen: 'true' } }));
  bar.append(button('', { icon: 'unlink', title: 'Out of the row: back under it, on its own', data: { colOut: 'true' } }));
  rovingToolbar(bar);
  // whether the analyst may state a source is read off the file, so it is asked once the bar is drawn
  if (entity && !entity.attrs?.source_url && handlers.sourceable) {
    Promise.resolve(handlers.sourceable(entity)).then((yes) => {
      if (!yes || !bar.isConnected || bar.querySelector('[data-col-source]')) return;
      const said = button('cm-col-open', { label: 'Source…', title: SOURCE_HELP.button, data: { colSource: 'true' } });
      said.tabIndex = -1;
      bar.insertBefore(said, bar.querySelector('[data-col-out]'));
    }).catch(() => {});
  }
  return bar;
}

/** What an empty column offers: words typed in it, a case picture or a file. */
function emptyOffers(view, { here = false } = {}) {
  const offers = el('span', 'cm-col-offers');
  offers.append(button('cm-col-add', { icon: 'image', label: 'Case picture', title: 'A picture of the case in this column', data: { addPicture: 'true' } }));
  if (view.state.facet(noteHandlers).upload) {
    offers.append(button('cm-col-add', { icon: 'upload', label: 'From a file', title: 'A picture from this computer, added to the case', data: { addFile: 'true' } }));
  }
  if (here) return offers;
  return el('div', 'cm-col-drop', el('span', 'cm-col-hint', 'Type, or add a picture'), offers);
}

/** One column drawn: its words, its picture with its bar, or what an empty one offers. */
function drawColumn(view, column, { index, count, info, writable, sizing }) {
  const box = el('div', 'cm-col');
  box.dataset.column = String(index);
  if (isEmptyColumn(column)) {
    box.classList.add('cm-col-empty');
    if (writable) box.append(emptyOffers(view));
    return box;
  }
  const picture = pictureOf(column);
  if (picture) {
    box.classList.add('cm-col-picture');
    const figure = el('div', 'cm-col-figure');
    drawMarkdown(figure, { source: picture.line, info });
    const caption = figure.querySelector('.markdown-caption');
    if (caption && writable) {
      caption.dataset.captionEdit = 'true';
      caption.title = 'Press to write the caption';
    }
    box.append(figure);
    if (writable) box.append(columnPictureBar(view, picture, index, count, info));
    // a row of pictures alone sets them at one height: each column as wide as its picture's shape
    const media = figure.querySelector('img');
    if (sizing && media) {
      const fit = () => {
        if (media.naturalWidth && media.naturalHeight) box.style.flexGrow = String(media.naturalWidth / media.naturalHeight);
      };
      if (media.complete) fit();
      else media.addEventListener('load', fit, { once: true });
    }
    return box;
  }
  box.classList.add('cm-col-words');
  const words = el('div', 'cm-col-text');
  drawMarkdown(words, { source: column.text, info });
  box.append(words);
  return box;
}

/** The row drawn whole: its bar, then its columns side by side. */
function drawRow(box, widget, view) {
  box.title = '';
  const row = { columns: readColumns(widget.source).columns, source: widget.source };
  const sizing = picturesOnly(row.columns);
  const shares = columnShares(row.columns);
  const line = el('div', `cm-cols-row${sizing ? ' cm-cols-pictures' : ''}`);
  line.style.gap = `${GAP}px`;
  row.columns.forEach((column, index) => {
    const drawnColumn = drawColumn(view, column, { index, count: row.columns.length, info: widget.info, writable: widget.writable, sizing });
    drawnColumn.style.flex = `${sizing ? 1 : shares[index] * 100} 1 0`;
    line.append(drawnColumn);
  });
  box.append(line);
}

// -- written in place ----------------------------------------------------------------------

/** The share of the row before column `index`, and its own. */
function placeOf(shares, index) {
  return { before: shares.slice(0, index).reduce((sum, share) => sum + share, 0), share: shares[index] };
}

/** A length across the row: `share` of what the columns take, plus `gaps` of the room between them. */
function across(count, share, gaps) {
  return `calc((100% - 2 * var(--note-gutter, 32px) - ${(count - 1) * GAP}px) * ${share.toFixed(4)} + ${gaps * GAP}px)`;
}

/** Where a column's lines stand while it is written in: the margins that put them in its place. */
export function columnStyle(shares, index) {
  const { before, share } = placeOf(shares, index);
  const count = shares.length;
  const left = across(count, before, index);
  const right = across(count, Math.max(0, 1 - before - share), count - 1 - index);
  return `margin-left: calc(var(--note-gutter, 32px) + ${left}); margin-right: calc(var(--note-gutter, 32px) + ${right}); padding-left: 0; padding-right: 0;`;
}

/**
 * The lines above the column being written in (the row's fence, the columns before it and
 * its own fence): the row's bar, and the other columns drawn where they stand.
 */
class RowTop extends WidgetType {
  constructor({ row, index, info, writable }) {
    super();
    this.row = { from: row.from, to: row.to };
    this.index = index;
    this.info = info;
    this.writable = writable;
    this.columns = row.columns.map((column) => ({ width: column.width, text: column.text }));
    this.key = JSON.stringify([index, this.columns.map((column, at) => (at === index ? [column.width, isEmptyColumn(column)] : column)),
      picturesOnly(row.columns), info.caseId, writable]);
  }

  get blockKind() {
    return 'columns';
  }

  eq(other) {
    return other.key === this.key && other.info.entities === this.info.entities;
  }

  toDOM(view) {
    const top = el('div', 'cm-cols-edit');
    top.append(rowBar({ columns: this.columns }));
    const over = el('div', 'cm-cols-over');
    const shares = columnShares(this.columns);
    const count = this.columns.length;
    this.columns.forEach((column, index) => {
      const { before, share } = placeOf(shares, index);
      const slot = index === this.index ? el('div', 'cm-cols-frame') : drawColumn(view, column, { index, count, info: this.info, writable: this.writable, sizing: false });
      slot.classList.add('cm-cols-slot');
      slot.style.left = `calc(var(--note-gutter, 32px) + ${across(count, before, index)})`;
      slot.style.width = across(count, share, 0);
      over.append(slot);
    });
    top.append(over);
    top.addEventListener('pointerdown', (event) => {
      top.pressedAt = { x: event.clientX, y: event.clientY };
    });
    top.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('.picture-caption-field, .picture-source-field')) return;
      event.preventDefault();
      pressRow(event.target, top, view, top.pressedAt ?? { x: event.clientX, y: event.clientY });
    });
    // the keyboard's Enter and Space on a button give a click with no press before it
    top.addEventListener('click', (event) => {
      if (event.detail === 0 && event.target.closest('button')) pressRow(event.target, top, view);
    });
    return top;
  }

  // what is drawn here answers its own presses: the editor leaves them alone
  ignoreEvent() {
    return true;
  }

  get estimatedHeight() {
    return 40;
  }
}

/** The lines under the column being written in: room as tall as the columns beside it need. */
class RowEnd extends WidgetType {
  constructor({ row, index }) {
    super();
    this.row = { from: row.from, to: row.to };
    this.index = index;
  }

  get blockKind() {
    return 'columns';
  }

  eq(other) {
    return other.index === this.index;
  }

  toDOM() {
    return el('div', 'cm-cols-edit-end');
  }

  ignoreEvent() {
    return true;
  }

  get estimatedHeight() {
    return 12;
  }
}

/** Where an empty column being written in says what it takes, the caret before it. */
class EmptyHere extends WidgetType {
  eq() {
    return true;
  }

  toDOM(view) {
    const here = el('span', 'cm-col-here', el('span', 'cm-col-hint', 'Type, or add a picture'), emptyOffers(view, { here: true }));
    here.addEventListener('mousedown', (event) => {
      const pressed = event.target.closest('button');
      if (!pressed || event.button !== 0) return;
      event.preventDefault();
      const at = columnAt(view.state, view.state.selection.main.head);
      if (!at) return;
      if (pressed.dataset.addFile) view.state.facet(noteHandlers).upload?.();
      else pickPicture(view, pressed, 'Add a picture', (entity) => rewrite(view, at.row.from, withColumnText(at.row.source, at.index, pictureReference(entity))));
    });
    return here;
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * The row while the cursor is in one of its columns: the lines above and under that
 * column drawn as the bar and the other columns, its own lines set where it stands.
 * False when the cursor stands in no column's words (an Undo can leave it on a fence),
 * and the row shows its source then.
 */
function writtenIn(ctx, found) {
  const { state } = ctx;
  const { doc } = state;
  const row = rowOver(state, doc.lineAt(found.from).number, doc.lineAt(found.to).number);
  const head = state.selection.main.head;
  const index = row.columns.findIndex((column) => column.contentFrom !== null && head >= column.contentFrom && head <= column.contentTo);
  if (index < 0) return false;
  const column = row.columns[index];
  const style = columnStyle(columnShares(row.columns), index);
  const above = doc.line(column.openLine).to;
  const under = doc.line(column.closeLine).from;
  ctx.decorate(Decoration.replace({ widget: new RowTop({ row, index, info: ctx.info, writable: !state.readOnly }), block: true }).range(row.from, above));
  ctx.cover(row.from, above);
  ctx.decorate(Decoration.replace({ widget: new RowEnd({ row, index }), block: true }).range(under, row.to));
  ctx.cover(under, row.to);
  const firstLine = doc.lineAt(column.contentFrom).number;
  const lastLine = doc.lineAt(column.contentTo).number;
  for (let number = firstLine; number <= lastLine; number += 1) {
    ctx.decorate(Decoration.line({ class: 'cm-col-line', attributes: { style } }).range(doc.line(number).from));
    ctx.columns.set(number, style);
  }
  if (isEmptyColumn(column) && !state.readOnly) {
    ctx.decorate(Decoration.widget({ widget: new EmptyHere(), side: 1 }).range(doc.line(firstLine).from));
  }
  return true;
}

/** Sets the room under the column being written in, and its frame, once the page is laid out. */
const rowRoom = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.schedule();
  }

  update(update) {
    if (update.docChanged || update.geometryChanged || update.viewportChanged || update.selectionSet) this.schedule();
  }

  schedule() {
    this.view.requestMeasure({ key: this, read: (view) => this.read(view), write: (rows, view) => this.write(rows, view) });
  }

  read(view) {
    const rows = [];
    for (const top of view.contentDOM.querySelectorAll('.cm-cols-edit')) {
      let end = top.nextElementSibling;
      while (end && !end.classList.contains('cm-cols-edit-end')) end = end.nextElementSibling;
      if (!end) continue;
      const beside = [...top.querySelectorAll('.cm-cols-over > .cm-col')].reduce((most, column) => Math.max(most, column.offsetHeight), 0);
      const written = Math.max(0, end.getBoundingClientRect().top - top.getBoundingClientRect().bottom);
      rows.push({ top, end, beside, written, now: parseFloat(end.style.height) || 0 });
    }
    return rows;
  }

  write(rows, view) {
    let moved = false;
    for (const row of rows) {
      const room = Math.max(0, Math.ceil(row.beside - row.written));
      if (Math.abs(room - row.now) > 1) {
        row.end.style.height = `${room}px`;
        moved = true;
      }
      const frame = row.top.querySelector('.cm-cols-frame');
      if (frame) frame.style.height = `${Math.max(row.written, row.beside)}px`;
    }
    // the editor reads the heights again, so what follows the row is where it is drawn
    if (moved) view.requestMeasure();
  }
});

// -- keys and the row's guard -------------------------------------------------------------

/** A list's line, where Tab indents rather than going to the next column. */
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Tab and Shift+Tab: the next or the previous column, the caret at the end of its words. */
function stepColumn(step) {
  return (view) => {
    if (completionStatus(view.state)) return false;
    const at = writing(view.state);
    if (!at) return false;
    if (LIST_LINE.test(view.state.doc.lineAt(view.state.selection.main.head).text)) return false;
    if (!at.row.columns[at.index + step]) return true;
    return writeInColumn(view, at.row.from, at.index + step);
  };
}

/** Escape: the row picked, the caret out of its columns. */
function leaveColumn(view) {
  if (completionStatus(view.state)) return false;
  const at = writing(view.state);
  if (!at) return false;
  view.dispatch({ selection: { anchor: at.row.from }, userEvent: 'select', scrollIntoView: true });
  return true;
}

/** The arrows out of a column's top or bottom: up picks the row, down goes under it. */
function stepOut(down) {
  return (view) => {
    if (completionStatus(view.state)) return false;
    const range = view.state.selection.main;
    const at = range.empty ? writing(view.state) : null;
    if (!at) return false;
    let target;
    try { target = view.moveVertically(range, down).head; } catch { return false; }
    if (target !== range.head && target >= at.column.contentFrom && target <= at.column.contentTo) return false;
    const { doc } = view.state;
    const anchor = !down ? at.row.from : at.row.to < doc.length ? at.row.to + 1 : at.row.to;
    view.dispatch({ selection: { anchor }, userEvent: 'select', scrollIntoView: true });
    return true;
  };
}

/** Backspace at a column's start and Delete at its end stay in the column: its fences are the row's. */
function holdEdge(forward) {
  return (view) => {
    const range = view.state.selection.main;
    const at = range.empty ? writing(view.state) : null;
    if (!at) return false;
    return forward ? range.head === at.column.contentTo : range.head === at.column.contentFrom;
  };
}

const rowKeys = Prec.highest(keymap.of([
  { key: 'Tab', run: stepColumn(1), shift: stepColumn(-1) },
  { key: 'Escape', run: leaveColumn },
  { key: 'ArrowUp', run: stepOut(false) },
  { key: 'ArrowDown', run: stepOut(true) },
  { key: 'Backspace', run: holdEdge(false) },
  { key: 'Delete', run: holdEdge(true) },
]));

/** What the keyboard and the clipboard do, as against a gesture of the row's own or a tool's. */
const TYPED = ['input.type', 'input.paste', 'input.drop', 'input.complete', 'delete', 'move'];

/**
 * While a column is written in, what is typed, pasted or deleted stays in its words: the
 * row's fences and its other columns, drawn beside it, stand still. A change that takes
 * the whole row (the row deleted) goes through.
 */
const guardRow = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged || !TYPED.some((event) => tr.isUserEvent(event))) return true;
  const at = writing(tr.startState);
  if (!at) return true;
  let whole = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= at.row.from && toA >= at.row.to) whole = true;
  });
  return whole ? true : [at.row.from, at.column.contentFrom, at.column.contentTo, at.row.to];
});

// -- the kind -----------------------------------------------------------------------------

registerBlock({
  name: 'columns',
  fence: COLUMNS_OPEN,
  close: COLUMNS_CLOSE,
  widget: (spec) => new BlockWidget('columns', spec.source, spec.info, spec.writable, '', false, spec.picked),
  draw: drawRow,
  writtenIn,
  atomic: true,
  height: 220,
  // Enter and a double press write in the first column; its </> shows the source
  open: (view, block) => (view.state.readOnly ? openSource(view, block) : writeInColumn(view, block.from, 0)),
  tools: (box, widget) => (widget.writable ? rowBar({ columns: readColumns(widget.source).columns }) : null),
  bar: '.cm-cols-bar, .cm-col',
  press: (target, box, view) => pressRow(target, box, view, box.pressedAt ?? null),
  fields: '.picture-caption-field, .picture-source-field',
  listen: (box, widget, view) => {
    box.addEventListener('pointerdown', (event) => {
      box.pressedAt = { x: event.clientX, y: event.clientY };
    });
    box.addEventListener('click', (event) => {
      if (event.detail === 0 && event.target.closest('.cm-cols-bar button, .cm-col button')) pressRow(event.target, box, view);
    });
    if (!widget.writable) return;
    // a file dropped on a column lands in it
    box.addEventListener('dragover', (event) => {
      if (event.target.closest('[data-column]')) event.preventDefault();
    });
    box.addEventListener('drop', (event) => {
      const columnBox = event.target.closest('[data-column]');
      if (!columnBox) return;
      const handlers = view.state.facet(noteHandlers);
      const image = [...(event.dataTransfer?.files ?? [])].find((file) => file.type.startsWith('image/'));
      const rowFrom = view.posAtDOM(box);
      const index = Number(columnBox.dataset.column);
      const row = rowAround(view.state, rowFrom);
      if (!row?.columns[index] || !isEmptyColumn(row.columns[index])) return;
      event.preventDefault();
      if (!writeInColumn(view, rowFrom, index)) return;
      const at = view.state.selection.main.head;
      if (!handlers.media?.(event, at) && image) handlers.image?.(image);
    });
  },
  // the block menu offers to take the row apart, its columns one under the other
  actions: (state, block) => [{
    id: 'apart', label: 'Take apart', icon: 'list', hint: 'one under the other', run: (now) => takeApartRow(now, block),
  }],
  extensions: [rowRoom, rowKeys, guardRow],
  theme: {
    '.cm-block-columns': { paddingTop: '10px', paddingBottom: '10px' },
    '.cm-cols-row': { display: 'flex', alignItems: 'flex-start' },
    // drawn Markdown, whose line breaks are not the editor's
    '.cm-col': { position: 'relative', minWidth: '0', whiteSpace: 'normal' },
    '.cm-col-text > :first-child': { marginTop: '0' },
    '.cm-col-text > :last-child': { marginBottom: '0' },
    '.cm-col-text p': { margin: '0 0 0.6em' },
    '.cm-col-text ul, .cm-col-text ol': { margin: '0 0 0.6em', paddingLeft: '1.3em' },
    '.cm-col-text li': { margin: '0 0 0.15em' },
    '.cm-col-text li::marker': { color: 'var(--accent)' },
    '.cm-col-figure img, .cm-col-figure video': {
      display: 'block', width: '100% !important', maxWidth: '100%', marginLeft: '0 !important', marginRight: '0 !important', borderRadius: '4px',
    },
    '.cm-col-figure .markdown-caption': {
      display: 'block', marginTop: '6px', color: 'var(--text-2)', fontFamily: 'var(--font-sans)', fontSize: '0.84em', lineHeight: '1.4',
      textAlign: 'center',
    },
    '.cm-col-figure .markdown-caption[data-caption-edit]': { cursor: 'text', borderRadius: '3px' },
    '.cm-col-figure .markdown-caption[data-caption-edit]:hover': { background: 'var(--bg-2)', boxShadow: '0 0 0 3px var(--bg-2)' },
    '.cm-col-figure.cm-captioning .markdown-caption': { display: 'none' },
    '.cm-block-columns .cm-col-words, .cm-cols-over .cm-col-words': { cursor: 'text' },
    // an empty column: a dashed place saying what it takes
    '.cm-col-drop': {
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', minHeight: '132px',
      padding: '12px', boxSizing: 'border-box', border: '1px dashed var(--border-strong)', borderRadius: '6px', color: 'var(--text-3)',
      fontFamily: 'var(--font-sans)', fontSize: '0.84em', cursor: 'text',
    },
    '.cm-col-offers': { display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px' },
    '.cm-col-add': {
      display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 10px', border: '1px solid var(--border-strong)',
      borderRadius: '4px', background: 'var(--bg-2)', color: 'var(--text-1)', font: 'inherit', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
    },
    '.cm-col-add:hover': { borderColor: 'var(--accent)' },
    '.cm-col-here': { display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginLeft: '6px', color: 'var(--text-3)', fontSize: '0.84em', verticalAlign: 'middle' },
    // the bars: the row's above it, a picture's over it, each shown while the pointer is there or the row is picked
    '.cm-cols-bar': {
      position: 'absolute', left: 'var(--note-gutter, 32px)', top: '-30px', zIndex: '3', display: 'flex', alignItems: 'center', gap: '2px',
      padding: '3px', background: 'var(--bg-1)', border: '1px solid var(--border-strong)', borderRadius: '6px', boxShadow: 'var(--shadow-2)',
      fontFamily: 'var(--font-sans)', fontSize: '11.5px', lineHeight: '1', color: 'var(--text-2)', opacity: '0', pointerEvents: 'none',
      whiteSpace: 'nowrap',
    },
    '.cm-block-columns:hover > .cm-cols-bar, .cm-block-columns.cm-picked > .cm-cols-bar, .cm-cols-bar:focus-within, .cm-cols-edit > .cm-cols-bar': {
      opacity: '1', pointerEvents: 'auto',
    },
    '.cm-cols-said': { display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '0 8px 0 5px', color: 'var(--text-1)', fontWeight: '600' },
    '.cm-cols-seg': { display: 'inline-flex', gap: '1px', margin: '0 3px', padding: '1px', border: '1px solid var(--border)', borderRadius: '4px' },
    '.cm-cols-bar button, .cm-col-bar button': {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px', minWidth: '26px', height: '22px', padding: '0 6px',
      border: 'none', borderRadius: '3px', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', font: 'inherit',
    },
    '.cm-cols-bar button:hover, .cm-col-bar button:hover': { background: 'var(--bg-3, var(--bg-2))', color: 'var(--text-1)' },
    '.cm-cols-bar button[aria-pressed="true"]': { background: 'var(--accent-soft, var(--bg-2))', color: 'var(--accent)' },
    '.cm-cols-bar button:focus-visible, .cm-col-bar button:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
    '.cm-cols-wicon': { display: 'inline-flex', gap: '2px' },
    '.cm-cols-wicon i': { display: 'block', height: '10px', border: '1.5px solid currentColor', borderRadius: '1.5px', boxSizing: 'border-box' },
    '.cm-cols-note': { padding: '0 8px', color: 'var(--text-3)' },
    '.cm-col-bar': {
      position: 'absolute', top: '6px', right: '6px', zIndex: '2', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '2px',
      maxWidth: 'calc(100% - 12px)', padding: '3px', boxSizing: 'border-box', background: 'var(--bg-1)', border: '1px solid var(--border-strong)',
      borderRadius: '6px', boxShadow: 'var(--shadow-2)', fontFamily: 'var(--font-sans)', fontSize: '11px', lineHeight: '1', opacity: '0',
      pointerEvents: 'none',
    },
    '.cm-col-picture:hover > .cm-col-bar, .cm-col-bar:focus-within': { opacity: '1', pointerEvents: 'auto' },
    '.cm-col-bar button.cm-col-open': { padding: '0 8px', color: 'var(--accent)', whiteSpace: 'nowrap' },
    // written in: the bar in its place, the other columns beside the lines being typed, a frame round them
    '.cm-cols-edit': { position: 'relative', height: '34px', zIndex: '2' },
    '.cm-cols-edit > .cm-cols-bar': { top: '2px' },
    '.cm-cols-over': { position: 'absolute', left: '0', right: '0', top: '100%', pointerEvents: 'none' },
    '.cm-cols-slot': { position: 'absolute', top: '0', boxSizing: 'border-box' },
    '.cm-cols-over > .cm-col': { pointerEvents: 'auto' },
    '.cm-cols-frame': { outline: '1px dashed color-mix(in srgb, var(--accent) 55%, transparent)', outlineOffset: '5px', borderRadius: '2px' },
    '.cm-cols-edit-end': { height: '0', boxSizing: 'content-box', paddingBottom: '12px' },
  },
});

/** The row at `block` taken apart, its columns' words one under the other, as a transaction. */
function takeApartRow(state, block) {
  const row = rowAround(state, block.from);
  if (!row) return null;
  return { changes: { from: row.from, to: row.to, insert: takenApart(row.source) }, selection: { anchor: row.from }, userEvent: EVENT };
}
