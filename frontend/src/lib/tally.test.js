import { describe, it, expect } from 'vitest';
import {
  confidenceLine,
  countLines,
  isEmpty,
  noteLines,
  readingNotes,
} from './tally.js';
import { buildTallyQuery, buildCatalogQuery } from './catalog.js';

const reads = { destroyed: 'Destroyed', damaged: 'Damaged', probable: 'Probable' };
const label = (value) => reads[value] ?? value;

const row = (extra = {}) => ({
  id: 'e_1',
  label: 'T-72B3',
  type: 'equipment-type',
  statements: 0,
  counted: 0,
  total: 0,
  refuted: 0,
  conditions: [],
  confidence: [],
  ...extra,
});

describe('countLines', () => {
  it('reads one line per condition, in the order the server sent', () => {
    const lines = countLines(
      row({
        conditions: [
          { value: 'destroyed', total: 5, statements: 2, counted: 2 },
          { value: 'damaged', total: 1, statements: 1, counted: 1 },
        ],
      }),
      label
    );
    expect(lines.map((line) => line.text)).toEqual(['5 destroyed', '1 damaged']);
  });

  it('words the unstated bucket rather than printing a bare number', () => {
    const lines = countLines(row({ conditions: [{ value: '', total: 3, counted: 1 }] }), label);
    expect(lines[0].text).toBe('3 unstated');
  });

  it('draws no line for a condition nothing counted', () => {
    // Two statements saying "destroyed" with no number add nothing, and "0 destroyed"
    // would say the case checked and found none.
    const lines = countLines(
      row({ conditions: [{ value: 'destroyed', total: 0, statements: 2, counted: 0 }] }),
      label
    );
    expect(lines).toEqual([]);
  });

  it('falls back to the stored word when the registry has no reading for it', () => {
    const lines = countLines(row({ conditions: [{ value: 'scuttled', total: 1 }] }), label);
    expect(lines[0].text).toBe('1 scuttled');
  });

  it('answers an absent row with nothing', () => {
    expect(countLines(null)).toEqual([]);
    expect(countLines({})).toEqual([]);
  });
});

describe('noteLines', () => {
  it('says how many statements carried no number', () => {
    expect(noteLines(row({ statements: 3, counted: 1 }))).toEqual(['2 without a number']);
  });

  it('says how many were ruled out, apart from the sum', () => {
    expect(noteLines(row({ statements: 2, counted: 2, refuted: 4 }))).toEqual(['4 ruled out']);
  });

  it('says both when both happened', () => {
    expect(noteLines(row({ statements: 3, counted: 2, refuted: 1 }))).toEqual([
      '1 without a number',
      '1 ruled out',
    ]);
  });

  it('stays quiet when every statement was counted and none eliminated', () => {
    expect(noteLines(row({ statements: 2, counted: 2 }))).toEqual([]);
  });
});

describe('confidenceLine', () => {
  it('reads the levels the server ordered', () => {
    const line = confidenceLine(
      row({ confidence: [{ value: 'probable', statements: 2 }, { value: '', statements: 1 }] }),
      label
    );
    expect(line).toBe('2 probable · 1 not assessed');
  });

  it('is empty when nothing stands', () => {
    expect(confidenceLine(row())).toBe('');
  });
});

describe('readingNotes', () => {
  it('states the cut before anything else, because it changes every number under it', () => {
    const notes = readingNotes({ read: 2000, matched: 3400, truncated: true, unattributed: 0 });
    expect(notes).toEqual(['Added up 2000 of 3400 statements']);
  });

  it('reports the statements that name no subject', () => {
    expect(readingNotes({ truncated: false, unattributed: 1 })).toEqual([
      '1 statement says nothing about what it concerns',
    ]);
    expect(readingNotes({ truncated: false, unattributed: 3 })).toEqual([
      '3 statements say nothing about what it concerns',
    ]);
  });

  it('says nothing about a whole reading that lost nothing', () => {
    expect(readingNotes({ read: 4, matched: 4, truncated: false, unattributed: 0 })).toEqual([]);
    expect(readingNotes(null)).toEqual([]);
  });
});

describe('isEmpty', () => {
  it('is empty only when there is neither a row nor a loose statement', () => {
    expect(isEmpty({ rows: [], unattributed: 0 })).toBe(true);
    expect(isEmpty({ rows: [row()], unattributed: 0 })).toBe(false);
    expect(isEmpty({ rows: [], unattributed: 2 })).toBe(false);
    expect(isEmpty(null)).toBe(true);
  });
});

describe('buildTallyQuery', () => {
  it('asks the same narrowing as the page beside it', () => {
    const options = {
      types: ['claim'],
      status: 'confirmed',
      query: 'quay',
      folder: 'Ground',
      recursive: true,
      attr: 'confidence',
      value: 'probable',
      linked: 'place',
      since: '2026-01-01',
      by: ['user'],
    };
    const tally = new URL(buildTallyQuery('c1', options), 'http://x');
    const page = new URL(buildCatalogQuery('c1', options), 'http://x');

    expect(tally.pathname).toBe('/api/cases/c1/catalog/tally');
    expect(tally.searchParams.toString()).toBe(page.searchParams.toString());
  });

  it('carries nothing that belongs to a page', () => {
    const url = buildTallyQuery('c1', {
      types: ['claim'],
      cursor: '12',
      limit: 100,
      order: 'label',
      view: 'v_1',
    });
    expect(url).toBe('/api/cases/c1/catalog/tally?type=claim');
  });

  it('asks for the whole case when nothing is narrowed', () => {
    expect(buildTallyQuery('c1')).toBe('/api/cases/c1/catalog/tally');
  });
});
