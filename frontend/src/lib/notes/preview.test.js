import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { postBytes } = vi.hoisted(() => ({ postBytes: vi.fn() }));
vi.mock('../api.js', () => ({ api: { postBytes } }));
vi.mock('../notesExport.js', () => ({ drawDiagrams: vi.fn() }));

const {
  MOST_DELAY, createPreview, fetchPreview, forgetDiagrams, headerList, internalHeader, noteWarnings, pageLine,
} = await import('./preview.js');

const page = (overrides = {}) => ({ data: new ArrayBuffer(4), pages: [0], diagrams: [], warnings: [], ...overrides });

beforeEach(() => {
  vi.useFakeTimers();
  forgetDiagrams();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('asking the server for a page', () => {
  it('posts a note of the case, and reads the page map, the diagrams and the warnings it answers', async () => {
    const headers = new Headers({
      'X-Note-Pages': '[0, 14, 40]',
      'X-Note-Diagrams': '[{"key":"ab12","source":"flowchart LR"}]',
      'X-Note-Warnings': '["A picture is missing"]',
    });
    postBytes.mockResolvedValue({ data: new ArrayBuffer(8), headers });
    const answer = await fetchPreview({ caseId: 'c1', note: 'n1', title: 'Lead', text: '# Lead', look: { style: 'report' } });
    expect(postBytes).toHaveBeenCalledWith('/api/cases/c1/notes/preview',
      { note: 'n1', title: 'Lead', text: '# Lead', look: { style: 'report' }, diagrams: {}, edition: 'internal' }, { signal: undefined });
    expect(answer.pages).toEqual([0, 14, 40]);
    expect(answer.diagrams).toEqual([{ key: 'ab12', source: 'flowchart LR' }]);
    expect(answer.warnings).toEqual([{ text: 'A picture is missing', line: null, kind: 'other' }]);
  });

  it('gives each warning the line the server says it is about', () => {
    const headers = new Headers({
      'X-Note-Warnings': '["Section \\"Method\\" is empty.", "A picture is missing"]',
      'X-Note-Warning-Lines': '[12, null]',
    });
    expect(noteWarnings(headers)).toEqual([
      { text: 'Section "Method" is empty.', line: 12, kind: 'other' },
      { text: 'A picture is missing', line: null, kind: 'other' },
    ]);
  });

  it('gives each warning its kind, and `other` for one it does not know', () => {
    const headers = new Headers({
      'X-Note-Warnings': '["Picture \\"Roof\\" is no longer in the case.", "Picture \\"Roof\\" has no source.", "3 tasks are still open.", "Odd"]',
      'X-Note-Warning-Lines': '[4, 4, 9, null]',
      'X-Note-Warning-Kinds': '["missing", "unsourced", "open-task", "shiny"]',
    });
    expect(noteWarnings(headers).map(({ kind, line }) => [kind, line])).toEqual([
      ['missing', 4], ['unsourced', 4], ['open-task', 9], ['other', null],
    ]);
  });

  it('gives no warning a line, or a kind, when the lists do not pair up', () => {
    const headers = new Headers({ 'X-Note-Warnings': '["One", "Two"]', 'X-Note-Warning-Lines': '[3]', 'X-Note-Warning-Kinds': '["missing"]' });
    expect(noteWarnings(headers)).toEqual([{ text: 'One', line: null, kind: 'other' }, { text: 'Two', line: null, kind: 'other' }]);
    const odd = new Headers({ 'X-Note-Warnings': '["One"]', 'X-Note-Warning-Lines': '[-1]', 'X-Note-Warning-Kinds': 'not json' });
    expect(noteWarnings(odd)).toEqual([{ text: 'One', line: null, kind: 'other' }]);
  });

  it('asks for the edition picked, and reads how many internal passages the note holds', async () => {
    postBytes.mockResolvedValue({ data: new ArrayBuffer(8), headers: new Headers({ 'X-Note-Internal': '3' }) });
    const answer = await fetchPreview({ caseId: 'c1', note: 'n1', text: 'x', edition: 'public' });
    expect(postBytes.mock.calls[0][1].edition).toBe('public');
    expect(answer.internal).toBe(3);
    expect(internalHeader(new Headers())).toBe(0);
    expect(internalHeader(new Headers({ 'X-Note-Internal': 'many' }))).toBe(0);
    expect(internalHeader(new Headers({ 'X-Note-Internal': '-2' }))).toBe(0);
  });

  it('posts a template to the route that needs no case, without a note', async () => {
    postBytes.mockResolvedValue({ data: new ArrayBuffer(8), headers: new Headers() });
    const answer = await fetchPreview({ title: 'Brief', text: '## Claim', look: {} });
    const [url, body] = postBytes.mock.calls[0];
    expect(url).toBe('/api/templates/note/preview');
    expect('note' in body).toBe(false);
    expect(answer.pages).toEqual([]);
  });

  it('reads where each picture landed, and drops one it cannot place', async () => {
    const pushed = { line: 9, ref: 'media:m1', page: 1, box: [0.1, 0.1, 0.8, 0.5], width: '100%', align: 'left', gap: [0, 0.6, 0.9, 0.1, 0.9], fit: 48 };
    const placed = { line: 2, ref: '/files/c1/a.png', page: 0, box: [0.1, 0.2, 0.3, 0.2], width: '', align: 'center' };
    const broken = [{ line: 1, ref: '', page: 0, box: [0, 0, 1, 1] }, { line: 1, ref: 'x', page: 0, box: [0, 0, 2, 1] },
      { line: 1, ref: 'x', page: 0, box: [0, 0, 1, 1], gap: [0, 0.5] }];
    const headers = new Headers({ 'X-Note-Pictures': JSON.stringify([pushed, ...broken, placed]) });
    postBytes.mockResolvedValue({ data: new ArrayBuffer(8), headers });
    const answer = await fetchPreview({ caseId: 'c1', note: 'n1', text: 'x' });
    expect(answer.pictures).toEqual([pushed, placed]);
  });

  it('reads a header that is missing or broken as an empty list', () => {
    expect(headerList(new Headers({ 'X-Note-Pages': 'not json' }), 'X-Note-Pages')).toEqual([]);
    expect(headerList(new Headers({ 'X-Note-Pages': '{"a":1}' }), 'X-Note-Pages')).toEqual([]);
    expect(headerList(null, 'X-Note-Pages')).toEqual([]);
    expect(pageLine([0, 12], 1)).toBe(12);
    expect(pageLine([0, 12], 5)).toBe(0);
  });
});

describe('a pane drawn as the note is typed', () => {
  it('waits until typing stops, then asks once for the last text', async () => {
    const fetch = vi.fn(async () => page());
    const onresult = vi.fn();
    const preview = createPreview({ fetch, onresult, draw: vi.fn() });
    preview.ask({ text: 'a' });
    await vi.advanceTimersByTimeAsync(500);
    preview.ask({ text: 'ab' });
    await vi.advanceTimersByTimeAsync(899);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].text).toBe('ab');
    expect(onresult).toHaveBeenCalledTimes(1);
  });

  it('lets the request in flight finish, then asks once for the newest made meanwhile', async () => {
    const signals = [];
    let release;
    const fetch = vi.fn((request, signal) => {
      signals.push(signal);
      if (request.text === 'old') return new Promise((resolve) => { release = () => resolve(page({ pages: [9] })); });
      return Promise.resolve(page({ pages: [1] }));
    });
    const onresult = vi.fn();
    const busy = [];
    const preview = createPreview({ fetch, onresult, draw: vi.fn(), onbusy: (flag) => busy.push(flag) });
    const first = preview.now({ text: 'old' });
    void preview.now({ text: 'middle' });
    const last = preview.now({ text: 'new' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);
    release();
    await first;
    await last;
    expect(fetch.mock.calls.map(([request]) => request.text)).toEqual(['old', 'new']);
    expect(onresult.mock.calls.map(([answer]) => answer.pages)).toEqual([[9], [1]]);
    expect(busy).toEqual([true, false]);
  });

  it('waits after typing as long as the last pages took to draw, up to a bound', async () => {
    let time = 0;
    const fetch = vi.fn(async () => {
      time += 3000;
      return page();
    });
    const preview = createPreview({ fetch, draw: vi.fn(), now: () => time });
    await preview.now({ text: 'a' });
    preview.ask({ text: 'ab' });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    // a note whose pages took a minute waits no longer than the bound
    fetch.mockImplementation(async () => {
      time += 60_000;
      return page();
    });
    await preview.now({ text: 'abc' });
    preview.ask({ text: 'abcd' });
    await vi.advanceTimersByTimeAsync(MOST_DELAY - 1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('asks again after it was stopped, for a request made since', async () => {
    let release;
    const fetch = vi.fn((request, signal) => (request.text === 'old'
      ? new Promise((_resolve, reject) => {
        release = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        signal.addEventListener('abort', release);
      })
      : Promise.resolve(page({ pages: [2] }))));
    const onresult = vi.fn();
    const preview = createPreview({ fetch, onresult, draw: vi.fn() });
    const first = preview.now({ text: 'old' });
    preview.stop();
    const again = preview.now({ text: 'new' });
    await first;
    await again;
    expect(onresult.mock.calls.map(([answer]) => answer.pages)).toEqual([[2]]);
  });

  it('draws the diagrams the server could not, once, and asks again with them', async () => {
    const fetch = vi.fn(async (request) => (Object.keys(request.diagrams).length
      ? page({ pages: [0, 3] })
      : page({ diagrams: [{ key: 'k1', source: 'flowchart LR\n A --> B' }] })));
    const draw = vi.fn(async (pending) => Object.fromEntries(pending.map((item) => [item.key, 'cG5n'])));
    const onresult = vi.fn();
    const preview = createPreview({ fetch, draw, onresult });
    await preview.now({ text: 'x' });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0].diagrams).toEqual({ k1: 'cG5n' });
    expect(onresult.mock.calls[0][0].pages).toEqual([0, 3]);
    // typed again: the picture goes with the first request, and is not drawn again
    await preview.now({ text: 'xy' });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[2][0].diagrams).toEqual({ k1: 'cG5n' });
  });

  it('does not try a diagram Mermaid failed on again, and keeps its source on the page', async () => {
    const fetch = vi.fn(async () => page({ diagrams: [{ key: 'bad', source: 'flowchart LR\n A -->' }] }));
    const draw = vi.fn(async () => ({}));
    const onresult = vi.fn();
    const preview = createPreview({ fetch, draw, onresult });
    await preview.now({ text: 'x' });
    await preview.now({ text: 'x' });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onresult).toHaveBeenCalledTimes(2);
  });

  it('says why in one line when the page could not be drawn', async () => {
    const onerror = vi.fn();
    const preview = createPreview({ fetch: vi.fn(async () => { throw new Error('look.style: unknown\nTraceback'); }), onerror });
    await preview.now({ text: 'x' });
    expect(onerror).toHaveBeenCalledWith('look.style: unknown');
  });

  it('stays quiet about a request it cancelled itself', async () => {
    const onerror = vi.fn();
    const fetch = vi.fn((_request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const preview = createPreview({ fetch, onerror });
    const pending = preview.now({ text: 'x' });
    preview.stop();
    await pending;
    expect(onerror).not.toHaveBeenCalled();
  });

  it('drops a request still waiting when the pane closes', async () => {
    const fetch = vi.fn(async () => page());
    const preview = createPreview({ fetch });
    preview.ask({ text: 'x' });
    preview.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).not.toHaveBeenCalled();
  });
});
