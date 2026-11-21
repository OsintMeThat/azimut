/**
 * A chart's rows that live in a sheet are typed in where they live: a cell typed in The
 * numbers is written into the sheet, through the sheet's own save (`PUT
 * /api/cases/{id}/sheets/{sheet}`), with the stamp of the read it was made from, read again
 * and tried once more when the file moved meanwhile. The copy in the note then follows the
 * sheet (`editor/follow.js`).
 *
 * The chart's copy is the sheet's rows in their order, its key column left out
 * (`engine/notecharts.origin_table`): a chart's row is the sheet's row at the same place,
 * a column the sheet's column of the same name. A row is written only when every cell the
 * two share still reads the same. A cell is never written where the sheet keeps it itself:
 * a column the app fills (its date stamp, a computed or a locked column, a row's pointer, an
 * offset) or a cell linked to a record of the case. Those open the sheet instead.
 */
import { api } from '../../api.js';
import { plainText } from './tableText.js';

/** The column roles a sheet fills or keeps itself (`engine/sheetroles.ROLE_KINDS`). */
const KEPT_ROLES = new Set(['stamped', 'computed', 'locked', 'row', 'offset']);

const fold = (words) => plainText(words).split(/\s+/).join(' ').toLowerCase();
const isKey = (name) => String(name ?? '').trim().toLowerCase() === 'id';

/**
 * The sheet `sheet` (as `GET …/sheets/{id}` answers it) with `cells` (`[{ row, col, text }]`
 * of the chart's `table`) written in: `{ rows }`, or `{ refused }` saying in a few words why
 * not, the sheet left as it was.
 */
export function sheetEdit(sheet, table, cells) {
  const columns = (sheet?.columns ?? []).map(String);
  const key = Math.max(0, columns.findIndex(isKey));
  const keyed = columns.some(isKey);
  const byName = new Map();
  columns.forEach((name, at) => {
    if (!isKey(name) && !byName.has(fold(name))) byName.set(fold(name), at);
  });
  const rows = (sheet?.rows ?? []).map((row) => [...row]);
  const roles = sheet?.meta?.roles ?? {};
  const links = sheet?.meta?.links ?? {};
  for (const cell of cells) {
    const head = table.header[cell.col] ?? '';
    const at = byName.get(fold(head));
    if (at === undefined) return { refused: `The sheet has no column “${plainText(head)}”` };
    const row = rows[cell.row];
    const ours = table.rows[cell.row] ?? [];
    const same = row && table.header.every((name, col) => {
      const theirs = byName.get(fold(name));
      return theirs === undefined || plainText(row[theirs] ?? '') === plainText(ours[col] ?? '');
    });
    if (!same) return { refused: 'That row reads otherwise in the sheet now' };
    if (KEPT_ROLES.has(roles[columns[at]]?.kind)) return { refused: `The sheet fills “${columns[at]}” itself` };
    if (keyed && links[row[key]]?.[columns[at]]) return { refused: 'That cell points at a record of the case' };
    row[at] = cell.text;
  }
  return { rows };
}

/**
 * Write `cells` of the chart's `table` into the sheet `sheetId` of case `caseId`: read it,
 * write the cells, save with its stamp; a save refused because the file moved is tried once
 * more on a fresh read. Answers `{ written: true }`, `{ refused }` (the words why), or
 * `{ error }`.
 */
export async function writeThroughSheet({ caseId, sheetId, table, cells }, { get = api.get, put = api.put } = {}) {
  const path = `/api/cases/${encodeURIComponent(caseId)}/sheets/${encodeURIComponent(sheetId)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let sheet;
    try {
      sheet = await get(path);
    } catch (error) {
      return { error: error?.message ?? String(error) };
    }
    const edit = sheetEdit(sheet, table, cells);
    if (edit.refused) return edit;
    try {
      await put(path, { columns: sheet.columns, rows: edit.rows, meta: sheet.meta ?? {}, stamp: sheet.stamp ?? null });
      return { written: true };
    } catch (error) {
      if (error?.status !== 409 || attempt) return { error: error?.message ?? String(error) };
    }
  }
  return { error: 'the sheet kept changing' };
}
