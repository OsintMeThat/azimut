import { describe, expect, it } from 'vitest';
import { appendRows, guessMapping, mappingSummary } from './sheetAppend.js';

const SHEET = {
  columns: ['id', 'Subject', 'Status', 'Source'],
  rows: [['r1', 'Quai sud', 'done', 'https://a.org/1']],
};

describe('proposing where the incoming columns land', () => {
  it('matches on the name, and on the same name in another casing', () => {
    // `Source` and `source` are the same column in every export anybody actually sends.
    const mapping = guessMapping(['Subject', 'source', 'Comment'], SHEET.columns);
    expect(mapping).toEqual({ Subject: 'Subject', source: 'Source', Comment: '' });
  });

  it('guesses nothing beyond the name', () => {
    // A `Place` landing in `City` because both look geographic is a silent mistake in a
    // column of evidence.
    expect(guessMapping(['Place'], ['id', 'City'])).toEqual({ Place: '' });
  });

  it('never offers the row handle, in either direction', () => {
    // Rows arriving from elsewhere are keyed here; writing somebody else's identifier in
    // would hang this sheet's colours on a stranger.
    expect(guessMapping(['id', 'Subject'], SHEET.columns)).toEqual({ Subject: 'Subject' });
    expect(guessMapping(['Subject'], ['id', 'Subject'])).toEqual({ Subject: 'Subject' });
  });

  it('says what would be dropped, before the press', () => {
    const mapping = guessMapping(['id', 'Subject', 'Comment', 'Rank'], SHEET.columns);
    expect(mappingSummary(['id', 'Subject', 'Comment', 'Rank'], mapping)).toEqual({
      taken: 1,
      dropped: ['Comment', 'Rank'],
    });
  });
});

describe('the rows appended', () => {
  const incoming = {
    columns: ['Subject', 'Source'],
    rows: [
      ['Pont nord', 'https://a.org/2'],
      ['Zone 5', 'https://a.org/3'],
    ],
  };

  it('lands each row in the columns it was mapped to, keyed anew', () => {
    const grown = appendRows(SHEET, incoming, { Subject: 'Subject', Source: 'Source' });
    expect(grown.added).toBe(2);
    expect(grown.table.rows).toHaveLength(3);
    expect(grown.table.rows[1].slice(1)).toEqual(['Pont nord', '', 'https://a.org/2']);
    expect(grown.table.rows[1][0]).toMatch(/^r[0-9a-f]{10}$/);
    expect(new Set(grown.table.rows.map((row) => row[0])).size).toBe(3);
    // The sheet it was given is untouched, because an append is one undoable step.
    expect(SHEET.rows).toHaveLength(1);
  });

  it('writes only the columns the mapping names', () => {
    const grown = appendRows(SHEET, incoming, { Subject: 'Status' });
    expect(grown.table.rows[1].slice(1)).toEqual(['', 'Pont nord', '']);
  });

  it('leaves out a row that arrives blank in every mapped column', () => {
    // An export's trailing empty line should not become a row somebody has to delete.
    const trailing = { columns: ['Subject'], rows: [['Pont nord'], ['  '], ['']] };
    expect(appendRows(SHEET, trailing, { Subject: 'Subject' }).added).toBe(1);
  });

  it('adds nothing when the mapping carries no column of this sheet', () => {
    const grown = appendRows(SHEET, incoming, { Subject: '', Source: '' });
    expect(grown.added).toBe(0);
    expect(grown.table).toBe(SHEET);
  });

  it('refuses to write into the row handle even when told to', () => {
    expect(appendRows(SHEET, incoming, { Subject: 'id' }).added).toBe(0);
  });
});
