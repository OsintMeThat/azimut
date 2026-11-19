/**
 * Cells coming in from outside: a spreadsheet's or a web page's table pasted
 * anywhere in the note becomes a table, and a CSV, TSV or HTML file is read as
 * one. `tableText.js` reads them (`readClipboard`, `readFile`, `readHtmlTable`);
 * this module says what a paste makes and puts it in the note.
 *
 * Only in the drawn mode: the raw Markdown pastes what the clipboard says, as
 * before. A paste into code, or into a table's open source, stays text too. One
 * cell is words, never a table.
 *
 * The editor's `handlers.tableToast(message, actions)` says what was pasted, with
 * Paste as text (the clipboard's words in its place) and Undo, each changing the
 * note only while the table is as it landed.
 */
import { Prec, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { tableNear } from './gridEdits.js';
import { blockAt, heldRange, holdRange, releaseRange } from './puts.js';
import { pickedBlock } from './ranges.js';
import { noteHandlers } from './state.js';
import { MAX_ROWS, gridToTable, readClipboard, readFile, readHtmlTable } from './tableText.js';

/** The largest file read as a table: past it, a note is the wrong place for it. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** How many cells a grid read from outside holds. */
export function cellCount(grid) {
  return grid?.cells?.length ? grid.cells.length * grid.cells[0].length : 0;
}

/** Where pasted cells came from, as the toast names it. */
export function pasteSource(html, grid) {
  if (grid?.format !== 'html') return 'a spreadsheet';
  return /LibreOffice|urn:schemas-microsoft-com:office|google-sheets-html-origin|data-sheets-value|ProgId[^>]*Excel/i.test(html)
    ? 'a spreadsheet'
    : 'a web page';
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** `13 rows × 3 columns`. */
export function sizeSaid(rows, columns) {
  return `${plural(rows, 'row')} × ${plural(columns, 'column')}`;
}

/** The line naming a cut, when a table kept only its first rows. */
export function cutSaid(cut) {
  return cut > 0 ? ` The first ${MAX_ROWS} rows were kept, ${cut} left out.` : '';
}

/**
 * What pasting the clipboard makes: a table when it holds a table of two cells or
 * more, `{ grid, table, text, cut, rows, columns, source }`, else null (it stays text).
 */
export function pastedTable({ html = '', text = '' } = {}) {
  const grid = readClipboard({ html, text });
  if (cellCount(grid) < 2) return null;
  const made = gridToTable(grid);
  return { grid, ...made, rows: made.table.rows.length, columns: made.table.header.length, source: pasteSource(html, grid) };
}

/** Whether `pos` is in code, where a paste stays text. */
function inCode(state, pos) {
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  for (let node = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'HTMLBlock', 'CommentBlock'].includes(node.name)) return true;
  }
  return false;
}

/**
 * Put `text` (a table) in place of `from`–`to` on lines of its own, as one
 * transaction, the cursor under it. Answers the stretch it landed as, held as the
 * note changes, and `swap(words)`, which puts `words` in its place while it is as it
 * landed (answering whether it did).
 */
export function landTable(view, text, { from, to = from, userEvent = 'input.paste' } = {}) {
  const was = view.state.sliceDoc(from, to);
  const emptied = view.state.update({ changes: { from, to } }).state;
  const { insert } = blockAt(emptied, from, text);
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of(userEvent)],
    scrollIntoView: true,
  });
  const id = holdRange(view, from, from + insert.length);
  const swap = (words) => {
    const held = heldRange(view, id);
    if (!held || view.state.readOnly || view.state.sliceDoc(held.from, held.to) !== insert) return false;
    view.dispatch({
      changes: { from: held.from, to: held.to, insert: words },
      selection: { anchor: held.from + words.length },
      annotations: Transaction.userEvent.of('input.paste'),
    });
    releaseRange(view, id);
    return true;
  };
  return { id, insert, was, swap, start: from + insert.indexOf(text) };
}

/** Say what was pasted, with its two ways back. */
function sayPasted(view, made, landed, plain) {
  const toast = view.state.facet(noteHandlers).tableToast;
  if (!toast) return;
  const changed = () => toast('That part of the note was changed since, so it stays', [], 'warn');
  toast(`Pasted ${sizeSaid(made.rows, made.columns)} from ${made.source}.${cutSaid(made.cut)}`, [
    { label: 'Paste as text', onClick: () => { if (!landed.swap(plain)) changed(); } },
    { label: 'Undo', onClick: () => { if (!landed.swap(landed.was)) changed(); } },
  ]);
}

/**
 * The paste of a spreadsheet's or a web page's table, in the drawn mode: a table
 * where the cursor is. Read before the editor's own paste, which keeps pictures and
 * links.
 */
export const pasteAsTable = Prec.high(EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData;
    if (!data || view.state.readOnly) return false;
    const html = data.getData('text/html');
    const plain = data.getData('text/plain');
    if (!html && !plain.includes('\t')) return false;
    // a picked block (a table, a picture) keeps its lines: the table goes under it
    const picked = pickedBlock(view.state);
    const { from, to } = picked ? { from: picked.to, to: picked.to } : view.state.selection.main;
    if (!picked && (inCode(view.state, from) || tableNear(view.state, from))) return false;
    const made = pastedTable({ html, text: plain });
    if (!made) return false;
    event.preventDefault();
    const landed = landTable(view, made.text, { from, to });
    sayPasted(view, made, landed, plain.replace(/\r\n?/g, '\n'));
    return true;
  },
}));

// -- files ------------------------------------------------------------------------

/** A file's words: UTF-8, else UTF-16 with its mark (Excel's Unicode text), else Windows-1252 (an older CSV). */
export function decodeTableFile(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder('utf-16le').decode(view);
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder('utf-16be').decode(view);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    return new TextDecoder('windows-1252').decode(view);
  }
}

/**
 * The table a CSV, TSV or HTML file holds, as a grid (`tableText.js`), or an error
 * that says why there is none.
 */
export async function readTableFile(file) {
  if (!file) throw new Error('No file was chosen');
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large for a table in a note (5 MB at most)');
  const text = decodeTableFile(await file.arrayBuffer());
  const html = /\.x?html?$/i.test(file.name ?? '') || file.type === 'text/html';
  const grid = html ? readHtmlTable(text) : readFile(text, { name: file.name ?? '' });
  if (!grid || !cellCount(grid)) throw new Error(`No table found in ${file.name || 'that file'}`);
  return grid;
}

/** The kinds of file read as a table, for a file picker. */
export const TABLE_FILES = '.csv,.tsv,.tab,.txt,.html,.htm,text/csv,text/tab-separated-values,text/html,text/plain';

/** Ask for a table file; answers it, or null when none was chosen. */
export function chooseTableFile() {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = TABLE_FILES;
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    input.click();
  });
}
