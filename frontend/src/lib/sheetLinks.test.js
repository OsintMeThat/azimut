import { describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('./api.js', () => ({ api: { post } }));

const { CHUNK, checkLinks, chunk, readVerdicts, urlsInColumn } = await import('./sheetLinks.js');

const TABLE = {
  columns: ['id', 'Source'],
  rows: [
    ['r1', 'https://a.org/one'],
    ['r2', 'seen on https://a.org/one and https://a.org/two'],
    ['r3', 'nothing here'],
    ['r4', 'https://a.org/two'],
  ],
};

describe('the addresses one column holds', () => {
  it('is distinct addresses, each carrying the rows holding it', () => {
    // Eleven rows sourced to one channel hold one address eleven times, and asking that
    // host eleven times would be the rudest way to learn one fact.
    const found = urlsInColumn(TABLE, 1, [0, 1, 2, 3]);
    expect(found.map((entry) => entry.url)).toEqual(['https://a.org/one', 'https://a.org/two']);
    expect(found[0].rows).toEqual([0, 1]);
    expect(found[1].rows).toEqual([1, 3]);
  });

  it('reads the rows it was given, which are the ones on screen', () => {
    // A filter narrowed to the twelve rows left to check is the question being asked;
    // checking all four hundred answers a different one.
    expect(urlsInColumn(TABLE, 1, [3]).map((entry) => entry.url)).toEqual(['https://a.org/two']);
    expect(urlsInColumn(TABLE, 1, [])).toEqual([]);
  });
});

describe('walking a long column in batches', () => {
  it('cuts the list the size the route takes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([])).toEqual([]);
    expect(chunk(null)).toEqual([]);
  });

  it('mirrors the cap the server holds, so a batch is never refused at the door', () => {
    expect(CHUNK).toBe(25);
    expect(chunk(Array.from({ length: 26 }, (_, n) => n))[0]).toHaveLength(25);
  });

  it('asks the sheet own route, and takes an empty answer as an empty answer', async () => {
    post.mockResolvedValueOnce({ links: { 'https://a.org/one': { state: 'ok' } } });
    expect(await checkLinks('case-a', 'e_sheet', ['https://a.org/one'])).toEqual({
      'https://a.org/one': { state: 'ok' },
    });
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/sheets/e_sheet/links/check', {
      urls: ['https://a.org/one'],
    });

    post.mockResolvedValueOnce({});
    expect(await checkLinks('case-a', 'e_sheet', [])).toEqual({});
  });
});

describe('what a sweep found', () => {
  const entries = [
    { url: 'https://a.org/live', rows: [0] },
    { url: 'https://a.org/deleted', rows: [1, 2, 3] },
    { url: 'https://a.org/behind-a-login', rows: [4] },
    { url: 'https://a.org/nowhere', rows: [5] },
    { url: 'https://a.org/unanswered', rows: [6] },
  ];
  const verdicts = {
    'https://a.org/live': { state: 'ok', code: 200 },
    'https://a.org/deleted': { state: 'gone', code: 404 },
    'https://a.org/behind-a-login': { state: 'refused', code: 403 },
    'https://a.org/nowhere': { state: 'unreachable', code: null },
  };

  it('counts what answered apart from what refused to say', () => {
    // A 403 behind a login says nothing about whether the page is there, so folding it
    // into "dead" is how a source gets thrown away for having a paywall.
    const read = readVerdicts(entries, verdicts);
    expect(read.ok).toBe(1);
    expect(read.refused).toBe(1);
    expect(read.bad.map((entry) => entry.state)).toEqual(['gone', 'unreachable']);
  });

  it('puts the address the most rows rest on first', () => {
    expect(readVerdicts(entries, verdicts).bad[0].url).toBe('https://a.org/deleted');
  });

  it('hands back the rows to paint, deduplicated', () => {
    // The point of knowing eleven sources are dead is painting those eleven rows.
    expect(readVerdicts(entries, verdicts).rows).toEqual([1, 2, 3, 5]);
  });

  it('says nothing about an address the batch never got an answer for', () => {
    const read = readVerdicts(entries, verdicts);
    expect(read.bad.map((entry) => entry.url)).not.toContain('https://a.org/unanswered');
    expect(readVerdicts([], {})).toEqual({ ok: 0, refused: 0, skipped: 0, bad: [], rows: [] });
  });

  it('counts the addresses the batch ran out of time for apart from the dead ones', () => {
    // "We did not ask" is not a fact about the page, and a sweep that folded it into
    // "answered" would report a column as checked when a third of it was not.
    const read = readVerdicts(
      [...entries, { url: 'https://a.org/late', rows: [7] }],
      { ...verdicts, 'https://a.org/late': { state: 'skipped', code: null } },
    );
    expect(read.skipped).toBe(1);
    expect(read.ok).toBe(1);
    expect(read.bad.map((entry) => entry.url)).not.toContain('https://a.org/late');
  });
});
