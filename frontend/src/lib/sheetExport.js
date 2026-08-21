/**
 * Getting a sheet out of the case, as the CSV somebody else opens.
 *
 * What travels is **what is on screen**: the columns that are drawn, in the order they
 * are drawn, and the rows the filter and the sort left. The case folder already holds
 * `sheets/<name>.csv`, so a button that copied that file byte for byte would hand the
 * analyst something they already have. What they do not have is this reading of it.
 *
 * The file is written **by the server, into the folder saved for sheet exports** — the
 * case's own `exports/` until the analyst picks another. That is what every other finished
 * thing in this app does, and a table that landed in the browser's downloads instead was
 * the one export nobody could find twice. It also keeps the single CSV writer in Python
 * (`engine/sheets.py`): a second one here would be a second answer to how a quoted newline
 * is written, on the one artifact whose whole promise is that any spreadsheet opens it.
 */

import { api } from './api.js';

/** The drawn columns and the shown rows, as a plain table. Indices are translated
 *  here because the grid draws in one order and stores in another. */
export function viewTable(table, drawn, shown) {
  return {
    columns: (drawn ?? []).map((column) => column.name),
    rows: (shown ?? []).map((index) =>
      (drawn ?? []).map((column) => table?.rows?.[index]?.[column.index] ?? ''),
    ),
  };
}

/**
 * Where a copied table came from, as the two lines that make it citable.
 *
 * This is what the app kept from the idea of a sheet **plate** and the only part of it
 * worth keeping. A picture of a grid is worse than the CSV *and* worse than the Markdown
 * — not selectable, not sortable, not diffable — but a plate carried one thing a bare
 * table does not: its provenance on the page. Twelve rows pasted into a ticket with no
 * case, no filter and no timestamp are twelve rows nobody can check a week later, and
 * "which sheet was this, and what was hidden when you copied it" is the first question
 * anybody asks.
 *
 * The filter is stated because it is the line that changes what the rows *mean*: `12 of
 * 468` is a reading, and a reader who cannot see that `Coordinates is empty` was on has
 * been handed a sample presented as a set.
 */
export function provenance({ caseName, sheet, filter, sort, shown, total, at } = {}) {
  const said = [];
  const title = [caseName, sheet].filter(Boolean).join(' · ');
  const count =
    Number.isFinite(shown) && Number.isFinite(total)
      ? `${shown} of ${total} ${total === 1 ? 'row' : 'rows'}`
      : '';
  if (title || count) said.push([title, count].filter(Boolean).join(' — '));
  if (filter) said.push(`Showing ${filter}`);
  if (sort) said.push(`Sorted by ${sort}`);
  if (at) said.push(String(at).replace('T', ' ').slice(0, 16));
  return said;
}

/**
 * The same reading as a Markdown table, for the report rather than for the spreadsheet.
 *
 * A CSV is what a collaborator opens; a Markdown table is what goes in the Notebook, a
 * ticket or a message, and re-typing twelve rows into a note is exactly the step that
 * makes an analyst stop citing the sheet. Pipes inside a cell are escaped and newlines
 * become `<br>`, because a table that breaks its own rows is a table nobody can read.
 *
 * The header is a blockquote above it rather than a caption below, because what is
 * quoted has to be read before the numbers are: it is the difference between a table
 * pasted into a ticket and a table somebody can cite.
 */
export function toMarkdown(view, said = []) {
  const columns = view?.columns ?? [];
  if (!columns.length) return '';
  const cell = (value) =>
    String(value ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\n+/g, '<br>')
      .trim();
  const lines = [
    ...(said.length ? [...said.map((line) => `> ${line}`), ''] : []),
    `| ${columns.map(cell).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...(view?.rows ?? []).map((row) => `| ${columns.map((_, at) => cell(row[at])).join(' | ')} |`),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Write the view out, into the folder this case files sheet CSVs in.
 *
 * Answers the file and the folder, so the caller can say where it went and how much of the
 * sheet that was — an export of twelve rows out of four hundred is worth hearing before it
 * is mailed.
 */
export async function exportCsv(caseId, sheetId, view) {
  return api.post(`/api/cases/${caseId}/sheets/${sheetId}/csv`, view);
}

/** Open that folder. The same gesture the note PDFs and the analysis plates offer, since
 *  a file written somewhere the analyst cannot see is a file they will export twice. */
export const revealSheetExports = (caseId) =>
  api.post(`/api/cases/${caseId}/sheets/csv/reveal`);
