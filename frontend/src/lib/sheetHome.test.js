import { describe, expect, it } from 'vitest';

import { caseProposals, progressWords, recentSheets } from './sheetHome.js';

describe('recentSheets', () => {
  const sheets = [
    { id: 'a', modified_at: '2026-09-01T00:00:00Z' },
    { id: 'b', modified_at: '2026-09-30T00:00:00Z' },
    { id: 'c', created_at: '2026-09-15T00:00:00Z' },
  ];

  it('puts the newest edit first, and falls back to when it was filed', () => {
    expect(recentSheets(sheets).map((sheet) => sheet.id)).toEqual(['b', 'c', 'a']);
  });

  it('leads with the sheet last open', () => {
    expect(recentSheets(sheets, 'a').map((sheet) => sheet.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores a last sheet that is gone', () => {
    expect(recentSheets(sheets, 'gone').map((sheet) => sheet.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('progressWords', () => {
  it('says done for a status column and filled for any other', () => {
    expect(progressWords({ kind: 'state', count: 8, total: 21 })).toBe('8 of 21 done');
    expect(progressWords({ kind: 'fill', count: 3, total: 4 })).toBe('3 of 4 filled');
  });

  it('says nothing about an empty sheet or one with no progress column', () => {
    expect(progressWords(null)).toBe('');
    expect(progressWords({ kind: 'state', count: 0, total: 0 })).toBe('');
  });
});

describe('caseProposals', () => {
  it('offers the files worklist with how many still lack a proof', () => {
    const [files] = caseProposals({ files: { total: 21, answered: 8, sheet: null } });
    expect(files.shape).toBe('files');
    expect(files.detail).toBe('21 imported files, 13 without a proof');
    expect(files.open).toBeNull();
  });

  it('says so when every file is answered', () => {
    const [files] = caseProposals({ files: { total: 2, answered: 2 } });
    expect(files.detail).toBe('2 imported files, every one with a proof');
  });

  it('opens a shape already built rather than offering a twin', () => {
    const answer = caseProposals({
      files: { total: 3, answered: 0, sheet: 'e_list' },
      proofs: 4,
      sheets: [{ id: 'e_index', shape: 'proofs' }],
    });
    expect(answer.map((proposal) => [proposal.shape, proposal.open])).toEqual([
      ['files', 'e_list'],
      ['proofs', 'e_index'],
    ]);
  });

  it('offers nothing the case has nothing for', () => {
    expect(caseProposals({ files: { total: 0 }, proofs: 0 })).toEqual([]);
    expect(caseProposals()).toEqual([]);
  });
});
