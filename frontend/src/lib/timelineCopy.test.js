import { describe, expect, it } from 'vitest';
import {
  CHRONOLOGY_COLUMNS,
  COPY_LIMIT,
  chronologyBlock,
  chronologyMarkdown,
  chronologyRows,
  readChronology,
} from './timelineCopy.js';
import { parseBlock } from './sheetClipboard.js';

const entry = (id, earliest, extra = {}) => ({
  id,
  label: `Entry ${id}`,
  raw: earliest.slice(0, 10),
  earliest,
  latest: earliest,
  category: 'statement',
  ...extra,
});

describe('copying the chronology', () => {
  it('lists each dated entry once, in the order it happened', () => {
    const rows = chronologyRows([
      entry('b', '2026-08-02T00:00:00Z'),
      entry('a', '2026-08-01T00:00:00Z'),
      entry('b', '2026-08-02T00:00:00Z'),
      { id: 'u', label: 'Undated', raw: null, earliest: null },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('writes the spreadsheet columns a reader who never saw the app can read', () => {
    const [row] = chronologyRows([entry('a', '2026-08-11T14:05:00Z', {
      raw: '2026-08-11T17:05:00+03:00',
      latest: '2026-08-11T14:05:01Z',
      label: 'Convoy crossed the "east" bridge',
      subject_entities: [{ id: 'v', label: 'MV Aurora' }, { id: 'o', label: 'Northwind' }],
      place_entities: [{ id: 'p', label: 'East bridge' }],
      source_entities: [{ id: 's', label: 'VID_0312' }],
      confidence: 'probable',
      status: 'confirmed',
    })]);
    const table = parseBlock(chronologyBlock([row]));
    expect(table[0]).toEqual(CHRONOLOGY_COLUMNS);
    expect(table[1]).toEqual([
      // as written, with its own offset; the bounds stay in UTC whatever the axis reads
      '2026-08-11T17:05:00+03:00', '2026-08-11T14:05:00Z', '2026-08-11T14:05:01Z',
      'Convoy crossed the "east" bridge', 'MV Aurora; Northwind', 'East bridge', 'VID_0312',
      'probable', 'confirmed',
    ]);
  });

  it('writes a Markdown table that reads the date and says where it came from', () => {
    const rows = chronologyRows([entry('a', '2026-08-03T00:00:00Z', { raw: '2026-08', label: 'Recruitment | announced' })]);
    const text = chronologyMarkdown(rows, ['Harbour · Timeline — 1 of 1 rows']);
    expect(text).toBe([
      '> Harbour · Timeline — 1 of 1 rows',
      '',
      '| Date | Statement | Subjects | Places | Sources | Confidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| Aug 2026 | Recruitment \\| announced |  |  |  |  |',
      '',
    ].join('\n'));
  });

  it('reads every page of every track, once, up to the ceiling', async () => {
    const asked = [];
    const pages = {
      events: [
        { items: [entry('a', '2026-08-01T00:00:00Z'), entry('b', '2026-08-02T00:00:00Z')], next_cursor: 'c1' },
        { items: [entry('c', '2026-08-03T00:00:00Z')], next_cursor: null },
      ],
      media: [{ items: [entry('b', '2026-08-02T00:00:00Z'), entry('m', '2026-08-04T00:00:00Z')], next_cursor: null }],
    };
    const get = async (url) => {
      const params = new URL(url, 'http://x').searchParams;
      asked.push(params);
      const track = JSON.parse(params.get('track')).label;
      return pages[track][params.get('cursor') ? 1 : 0];
    };
    const tracks = [
      { id: 'events', categories: ['statement'], query: { label: 'events' }, hidden: ['gone'] },
      { id: 'media', categories: ['media'], query: { label: 'media' }, hidden: [] },
    ];
    const read = await readChronology(get, { caseId: 'c', tracks, from: '2026-08-01', to: '2026-08-10' });
    expect(read.items.map((item) => item.id)).toEqual(['a', 'b', 'c', 'm']);
    expect(read.truncated).toBe(false);
    // the whole window, never the axis's spread sample, and what a track hides stays hidden
    expect(asked.every((params) => !params.has('spread') && params.get('include_undated') === 'false')).toBe(true);
    expect(JSON.parse(asked[0].get('track')).hidden).toEqual(['gone']);
    expect(asked[1].get('cursor')).toBe('c1');

    const capped = await readChronology(get, { caseId: 'c', tracks, limit: 2 });
    expect(capped).toMatchObject({ truncated: true });
    expect(capped.items).toHaveLength(2);
    expect(COPY_LIMIT).toBe(5000);
  });
});
