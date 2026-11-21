import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const { sheetEdit, writeThroughSheet } = await import('./throughSheet.js');
const { parseTable } = await import('./tableText.js');

/**
 * A cell typed in rows that live in a sheet is written in the sheet, through its own save
 * with the stamp of the read, read again and tried once more when the file moved; never in a
 * row that reads otherwise there, nor in a cell the sheet keeps itself.
 */

const TABLE = parseTable('| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n| [[media:e_1|#2]] | Almost sure |');
const SHEET = {
  columns: ['id', 'Model', 'Grade', 'On map'],
  rows: [['r1', 'Cougar', 'Confirmed', 'YES'], ['r2', '#2', 'Almost sure', 'NO']],
  meta: { roles: { 'On map': { kind: 'computed' } }, links: { r2: { Model: 'e_1' } } },
  stamp: 's-1',
};

describe('a cell written in the sheet', () => {
  it('lands in the sheet’s row at the same place, in its column of the same name', () => {
    const edit = sheetEdit(SHEET, TABLE, [{ row: 0, col: 1, text: 'Almost sure' }]);
    expect(edit.rows[0]).toEqual(['r1', 'Cougar', 'Almost sure', 'YES']);
    // the sheet as read is left as it was
    expect(SHEET.rows[0][2]).toBe('Confirmed');
  });

  it('refuses a row that reads otherwise there, a column it has not, a cell it fills or links itself', () => {
    const moved = { ...SHEET, rows: [['r1', 'Lenco', 'Confirmed', 'YES'], SHEET.rows[1]] };
    expect(sheetEdit(moved, TABLE, [{ row: 0, col: 1, text: 'x' }])).toEqual({ refused: 'That row reads otherwise in the sheet now' });
    const wider = parseTable('| Model | Seen |\n| --- | --- |\n| Cougar | 2 |');
    expect(sheetEdit(SHEET, wider, [{ row: 0, col: 1, text: '3' }])).toEqual({ refused: 'The sheet has no column “Seen”' });
    expect(sheetEdit(SHEET, TABLE, [{ row: 1, col: 0, text: 'Kirpi' }])).toEqual({ refused: 'That cell points at a record of the case' });
    const filled = parseTable('| Model | On map |\n| --- | --- |\n| Cougar | YES |');
    expect(sheetEdit(SHEET, filled, [{ row: 0, col: 1, text: 'NO' }])).toEqual({ refused: 'The sheet fills “On map” itself' });
  });

  it('saves with the stamp it read, and reads again once when the file moved meanwhile', async () => {
    const get = vi.fn(async () => SHEET);
    const conflict = Object.assign(new Error('this file changed on disk since it was opened'), { status: 409 });
    const put = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ status: 'saved' });
    const answer = await writeThroughSheet({ caseId: 'c1', sheetId: 'e_s1', table: TABLE, cells: [{ row: 0, col: 1, text: 'Almost sure' }] }, { get, put });
    expect(answer).toEqual({ written: true });
    expect(get).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1]).toEqual(['/api/cases/c1/sheets/e_s1', {
      columns: SHEET.columns, rows: [['r1', 'Cougar', 'Almost sure', 'YES'], SHEET.rows[1]], meta: SHEET.meta, stamp: 's-1',
    }]);
    // twice moved: said, never forced
    const always = vi.fn().mockRejectedValue(conflict);
    expect(await writeThroughSheet({ caseId: 'c1', sheetId: 'e_s1', table: TABLE, cells: [{ row: 0, col: 1, text: 'x' }] }, { get, put: always }))
      .toEqual({ error: 'this file changed on disk since it was opened' });
    expect(always).toHaveBeenCalledTimes(2);
  });
});
