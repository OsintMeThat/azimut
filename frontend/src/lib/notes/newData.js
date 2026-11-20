/**
 * *New data…*: a new sheet of the case, made from a table pasted, a CSV or a workbook, for an
 * infographic or a chart to be drawn from. A paste is read by the note grid's own paste reader
 * (`editor/tableText.js`'s `readClipboard`: a spreadsheet's or a web page's HTML table, else
 * tab-separated text), its cells turned back from the grid's Markdown into a sheet's plain
 * words. A CSV goes to the Sheet tool's import as text, and a workbook to its workbook import,
 * one sheet a tab, so a file lands here as it lands there (`api/sheets.py`). The sheet is then
 * the Sheet tool's like any other.
 */
import { api } from '../api.js';
import { readClipboard, readDelimited } from './editor/tableText.js';

/** What a file may be, by its name. */
export function fileKind(name) {
  if (/\.xlsx$/i.test(name)) return 'xlsx';
  if (/\.(csv|tsv|tab|txt)$/i.test(name)) return 'csv';
  return '';
}

/**
 * A grid cell (Markdown, as the grid reads a paste) as a sheet's plain words: escapes taken
 * off, a link kept as its words and its address, a picture as its words.
 */
export function sheetCell(markdown) {
  return String(markdown ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/g, (_match, words, address) => {
      const label = words.replace(/\\(.)/g, '$1').trim();
      return !label || label === address ? address : `${label} (${address})`;
    })
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .trim();
}

/** A pasted grid as a sheet's `{ columns, rows }`, its first row the columns when `header` (else named Column 1, 2…). */
export function gridToSheet(grid, { header = grid?.header } = {}) {
  if (!grid?.cells?.length) return { columns: [], rows: [] };
  const width = Math.max(...grid.cells.map((row) => row.length));
  const pad = (row) => Array.from({ length: width }, (_, at) => sheetCell(row?.[at] ?? ''));
  const columns = header ? pad(grid.cells[0]).map((name, at) => name || `Column ${at + 1}`) : Array.from({ length: width }, (_, at) => `Column ${at + 1}`);
  return { columns, rows: (header ? grid.cells.slice(1) : grid.cells).map(pad) };
}

/**
 * What a paste holds as a table: the clipboard's HTML table or tab-separated cells, else CSV
 * text of at least two columns; null for words.
 */
export function readPaste({ html = '', text = '' } = {}) {
  const grid = readClipboard({ html, text });
  if (grid && grid.cells[0]?.length > 1) return grid;
  const delimited = text.trim() ? readDelimited(text) : null;
  return delimited && delimited.cells[0]?.length > 1 && delimited.cells.length > 1 ? delimited : null;
}

/**
 * File the new sheet: `grid` (a paste read, its first row the columns when `header`), or a
 * `file`. Answers `{ id, title, others }`, `others` the titles of a workbook's other tabs,
 * filed beside it; throws the route's reason.
 */
export async function createData({ caseId, name, grid = null, header = grid?.header, file = null, rename = null }, { post = api.post } = {}) {
  const root = `/api/cases/${encodeURIComponent(caseId)}/sheets`;
  const title = String(name ?? '').trim();
  if (file && fileKind(file.name) === 'xlsx') {
    const body = new FormData();
    body.append('file', file);
    const made = await post(`${root}/import-xlsx`, body);
    const [first, ...rest] = made?.sheets ?? [];
    if (!first) throw new Error(made?.empty?.length ? 'its tabs hold no cells' : 'it holds no table');
    return { id: first.id, title: first.label, others: rest.map((sheet) => sheet.label) };
  }
  if (!title) throw new Error('name the data first');
  if (file) {
    const text = await file.text();
    const made = await post(`${root}/import`, { title, text });
    return { id: made.id, title: made.label, others: [] };
  }
  const read = gridToSheet(grid, { header });
  // the columns a figure reads take the names it reads them by (`dataSeed.renamed`)
  const columns = rename ? rename(read.columns) : read.columns;
  const { rows } = read;
  if (!columns.length) throw new Error('paste a table first');
  const made = await post(root, { title, columns, rows });
  return { id: made.id, title: made.label, others: [] };
}
