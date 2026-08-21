import { describe, expect, it } from 'vitest';
import { normalizeRole } from './sheetRoles.js';
import { backLinks, namingColumn, rowLabel, rowTargets, unresolved } from './sheetRows.js';

/** An order of battle as the binders wrote one: a brigade listing its companies, each
 *  company naming its brigade back, and one name that no longer matches anything. */
const orbat = {
  columns: ['id', 'Unit', 'Links with others'],
  rows: [
    ['r1', '3rd Brigade', '1st Coy, 2nd Coy'],
    ['r2', '1st Coy', '3rd Brigade'],
    ['r3', '2nd Coy', '3rd Brigade'],
    ['r4', 'Recon Coy', '3rd Bde'],
  ],
};

const role = normalizeRole({ kind: 'row', of: 'Unit', multi: ', ' });
const at = orbat.columns.indexOf('Links with others');

describe('one row pointing at another', () => {
  it('follows the words, because the words are what the file holds', () => {
    // Not keys: a file whose links read `r7f3a` is a file the collaborator opening it
    // in a spreadsheet cannot follow.
    const found = rowTargets(orbat, at, role);
    expect(found.get('r1').keys).toEqual(['r2', 'r3']);
    expect(found.get('r2').keys).toEqual(['r1']);
  });

  it('reports a name that reaches no row rather than guessing which one it meant', () => {
    // The binders' own column had decayed to `#REF!` for exactly this reason. Here the
    // same decay is a list of what to fix instead of a cell that says nothing.
    const found = rowTargets(orbat, at, role);
    expect(found.get('r4').keys).toEqual([]);
    expect(found.get('r4').missing).toEqual(['3rd Bde']);
    expect(unresolved(found)).toBe(1);
  });

  it('reports a name two rows share rather than picking one of them', () => {
    const twins = {
      columns: ['id', 'Unit', 'Parent'],
      rows: [
        ['r1', '1st Coy', 'HQ'],
        ['r2', 'HQ', ''],
        ['r3', 'HQ', ''],
      ],
    };
    const found = rowTargets(twins, 2, normalizeRole({ kind: 'row', of: 'Unit' }));
    expect(found.get('r1')).toEqual({ keys: [], missing: ['HQ'] });
  });

  it('never lets a row point at itself', () => {
    const alone = { columns: ['id', 'Unit', 'Parent'], rows: [['r1', 'HQ', 'HQ']] };
    const found = rowTargets(alone, 2, normalizeRole({ kind: 'row', of: 'Unit' }));
    expect(found.get('r1')).toEqual({ keys: [], missing: ['HQ'] });
  });

  it('shows the other side without a second column being kept in step', () => {
    // The reading the binders kept by hand and could not keep true: who points at me.
    const back = backLinks(rowTargets(orbat, at, role));
    expect(back.get('r1')).toEqual(['r2', 'r3']);
    expect(back.get('r2')).toEqual(['r1']);
    expect(back.has('r4')).toBe(false);
  });

  it('names a row by its own subject cell, and by its key when that cell is empty', () => {
    expect(rowLabel(orbat, 'r2', role)).toBe('1st Coy');
    const blank = { columns: ['id', 'Unit'], rows: [['r9', '']] };
    expect(rowLabel(blank, 'r9', role)).toBe('r9');
  });

  it('falls back to the first column that is not the key', () => {
    // Which is the subject column on every sheet anyone builds, and the one a reader
    // would have used anyway.
    expect(namingColumn(orbat.columns, { kind: 'row' })).toBe('Unit');
    expect(namingColumn(orbat.columns, { kind: 'row', of: 'Gone' })).toBe('Unit');
    expect(namingColumn(['id'], { kind: 'row' })).toBeNull();
  });
});
