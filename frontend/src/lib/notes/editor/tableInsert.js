/**
 * A new table: `/` › Table asks how many rows by how many columns on a small grid
 * of squares (3 by 3 unless another is picked), or reads a file. The table lands at
 * the cursor on lines of its own, as one Undo step, and the caret goes to its
 * first header cell, where its columns are named.
 */
import { openPopover } from './gridMenu.js';
import { cellCount, chooseTableFile, cutSaid, landTable, readTableFile, sizeSaid } from './pasteTable.js';
import { noteHandlers } from './state.js';
import { gridAt } from './tablePictures.js';
import { gridToTable, newTable, serializeTable } from './tableText.js';

/** How far the picker's squares go. */
export const PICKER_ROWS = 8;
export const PICKER_COLUMNS = 8;

/** An empty table of `rows` under a header, `columns` wide. */
export function emptyTable(rows = 3, columns = 3) {
  const blank = () => new Array(columns).fill('');
  return serializeTable(newTable({ header: blank(), rows: Array.from({ length: rows }, blank) }));
}

/** Put a table's `text` at the cursor, then the caret in its first header cell. Answers where the table starts. */
export function insertTable(view, text, { said = '' } = {}) {
  const { from, to } = view.state.selection.main;
  const landed = landTable(view, text, { from, to, userEvent: 'input.table' });
  const start = landed.start;
  const enter = () => gridAt(view, start)?.edit(-1, 0);
  // the grid is drawn by now, unless the note is in the raw Markdown
  if (!gridAt(view, start)) requestAnimationFrame(enter);
  else enter();
  if (said) view.state.facet(noteHandlers).tableToast?.(said, [{ label: 'Undo', onClick: () => landed.swap(landed.was) }]);
  return start;
}

/** A file read as a new table at the cursor. */
export async function tableFromFile(view) {
  const file = await chooseTableFile();
  if (!file) return;
  const toast = view.state.facet(noteHandlers).tableToast;
  try {
    const grid = await readTableFile(file);
    if (!cellCount(grid)) return;
    const made = gridToTable(grid);
    insertTable(view, made.text, { said: `Added ${sizeSaid(made.table.rows.length, made.table.header.length)} from ${file.name}.${cutSaid(made.cut)}` });
  } catch (error) {
    toast?.(error.message, [], 'warn');
  }
}

/**
 * The picker at the cursor: hovering or the arrows size the table, a press or
 * Enter writes it, From a file reads one. `back` gets the keyboard when Escape
 * closes it.
 */
export function openTablePicker(view) {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head) ?? view.dom.getBoundingClientRect();
  // an anchor where the cursor is, for the picker to stand under
  const anchor = document.createElement('span');
  anchor.className = 'cm-table-anchor';
  anchor.style.cssText = `position: fixed; left: ${coords.left}px; top: ${coords.top}px; width: 1px; height: ${Math.max(14, coords.bottom - coords.top)}px; pointer-events: none;`;
  view.dom.append(anchor);
  let rows = 3;
  let columns = 3;
  const panel = document.createElement('div');
  panel.className = 'cm-table-picker';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'New table');
  const title = document.createElement('div');
  title.className = 'cm-table-picker-head';
  const name = document.createElement('strong');
  name.textContent = 'Table';
  const size = document.createElement('span');
  title.append(name, size);
  const squares = document.createElement('div');
  squares.className = 'cm-table-picker-grid';
  squares.dataset.guide = 'notebook.table-size';
  squares.tabIndex = 0;
  squares.setAttribute('role', 'slider');
  squares.setAttribute('aria-label', 'Rows by columns. Arrows to size, Enter to put in');
  squares.style.gridTemplateColumns = `repeat(${PICKER_COLUMNS}, 16px)`;
  const cells = [];
  for (let row = 0; row < PICKER_ROWS; row += 1) {
    for (let col = 0; col < PICKER_COLUMNS; col += 1) {
      const square = document.createElement('span');
      square.dataset.row = String(row + 1);
      square.dataset.col = String(col + 1);
      squares.append(square);
      cells.push(square);
    }
  }
  const hint = document.createElement('small');
  hint.textContent = 'Plus a header row, where the columns are named.';
  const file = document.createElement('button');
  file.type = 'button';
  file.className = 'cm-table-picker-file';
  file.textContent = 'From a file… (CSV, TSV, HTML)';
  panel.append(title, squares, hint, file);

  const draw = () => {
    size.textContent = `${rows} ${rows === 1 ? 'row' : 'rows'} × ${columns} ${columns === 1 ? 'column' : 'columns'}`;
    squares.setAttribute('aria-valuetext', size.textContent);
    for (const square of cells) square.classList.toggle('on', Number(square.dataset.row) <= rows && Number(square.dataset.col) <= columns);
  };
  draw();
  let close = () => {};
  const done = () => {
    anchor.remove();
  };
  const put = () => {
    close(false);
    view.focus();
    insertTable(view, emptyTable(rows, columns));
  };
  squares.addEventListener('mouseover', (event) => {
    const square = event.target.closest?.('span[data-row]');
    if (!square) return;
    rows = Number(square.dataset.row);
    columns = Number(square.dataset.col);
    draw();
  });
  squares.addEventListener('mousedown', (event) => event.preventDefault());
  squares.addEventListener('click', (event) => {
    if (event.target.closest?.('span[data-row]')) put();
  });
  squares.addEventListener('keydown', (event) => {
    const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    if (moves[event.key]) {
      rows = Math.max(1, Math.min(PICKER_ROWS, rows + moves[event.key][0]));
      columns = Math.max(1, Math.min(PICKER_COLUMNS, columns + moves[event.key][1]));
      draw();
    } else if (event.key === 'Enter' || event.key === ' ') put();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  file.addEventListener('click', () => {
    close(false);
    view.focus();
    void tableFromFile(view);
  });
  close = openPopover(view, anchor, panel, { back: view.contentDOM, onClose: done });
  squares.focus({ preventScroll: true });
  return panel;
}
