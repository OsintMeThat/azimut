// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSavedState } from './saved.svelte.js';

/**
 * The Map panel's own reading of the case.
 *
 * These were assertions about the tool's source text until the store existed;
 * they are the same guarantees, now exercised against what it actually does —
 * which is what a Locate pass looping in the wrong case needs.
 */

const ROWS = [
  { id: 'e1', kind: 'place', path: null, title: 'Quai sud', geo: { state: 'ok', country: 'FR' } },
  { id: 'e2', kind: 'capture', path: 'media/a.png', title: 'a' },
  { id: 'e3', kind: 'screenshot', path: 'media/b.png', title: 'b' },
];
const MEDIA = [
  { id: 'm1', key: 'm1@1,2', kind: 'media', media_kind: 'video', path: 'media/clip.mp4', title: 'clip', lat: 1, lon: 2 },
  { id: 'm1', key: 'm1@3,4', kind: 'media', media_kind: 'video', path: 'media/clip.mp4', title: 'clip', lat: 3, lon: 4 },
];

let api;
let notify;
let assignFolder;
let reloadCase;
let calls;

function store() {
  return createSavedState({ api, notify, assignFolder, reloadCase });
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
  notify = vi.fn();
  assignFolder = vi.fn(async () => ({}));
  reloadCase = vi.fn(async () => {});
  api = {
    get: vi.fn(async (path) => {
      calls.push(path);
      if (path.includes('/satellite/media')) return MEDIA;
      return ROWS;
    }),
    post: vi.fn(async () => ({ located: 0, failed: 0, remaining: 0 })),
    patch: vi.fn(async () => ({})),
    del: vi.fn(async () => ({ trash: 'slot-1' })),
  };
});

describe('opening a case', () => {
  it('reads one compact index, not a row per capture', async () => {
    const saved = store();
    saved.load('case-1');
    await vi.waitFor(() => expect(saved.rows).toHaveLength(3));
    expect(calls).toEqual(['/api/cases/case-1/satellite/index']);
  });

  it('opens on located media, the position a map is first read for', () => {
    expect(store().kind).toBe('media');
  });

  it('pays nothing for the media index while another position is open', async () => {
    const saved = store();
    saved.kind = 'places';
    saved.load('case-1');
    saved.loadMode('case-1', 3);
    await vi.waitFor(() => expect(saved.rows).toHaveLength(3));
    expect(calls).toEqual(['/api/cases/case-1/satellite/index']);
    // the two that filter read the compact index and nothing else
    expect(saved.shownRows).toEqual(ROWS);
    expect(calls.some((path) => path.includes('/satellite/media'))).toBe(false);
  });

  it('reads the media index for the media position, one row per point', async () => {
    const saved = store();
    saved.loadMode('case-1', 3);
    await vi.waitFor(() => expect(saved.media).toHaveLength(2));
    expect(calls).toEqual(['/api/cases/case-1/satellite/media']);
    expect(saved.shownRows).toEqual(MEDIA);
    expect(saved.shown.map((row) => row.key)).toEqual(['m1@1,2', 'm1@3,4']);
  });

  it('re-reads the media index when the case is reloaded, not only when it changes', async () => {
    // filing a file reloads the case; keying only on the id would leave the
    // panel showing the folder it just left
    const saved = store();
    saved.loadMode('case-1', 3);
    await vi.waitFor(() => expect(saved.media).toHaveLength(2));
    const before = api.get.mock.calls.length;
    saved.loadMode('case-1', 3);
    expect(api.get).toHaveBeenCalledTimes(before); // same revision: nothing to re-read
    saved.loadMode('case-1', 4);
    await vi.waitFor(() => expect(api.get.mock.calls.length).toBe(before + 1));
  });

  it('keeps an answer that arrives after the position was left', async () => {
    // the stamp is spent when the request goes out, so dropping the answer would
    // leave the position empty until the case happened to reload
    let release;
    api.get = vi.fn(() => new Promise((resolve) => (release = () => resolve(MEDIA))));
    const saved = store();
    saved.loadMode('case-1', 1);
    saved.kind = 'places';
    release();
    await vi.waitFor(() => expect(saved.media).toHaveLength(2));
  });

  it('drops every index before loading a different case', async () => {
    const saved = store();
    saved.load('case-1');
    saved.loadMode('case-1', 1);
    await vi.waitFor(() => expect(saved.rows).toHaveLength(3));
    await vi.waitFor(() => expect(saved.media).toHaveLength(2));
    saved.load('case-2');
    expect(saved.rows).toEqual([]);
    expect(saved.media).toEqual([]);
  });

  it('lands no answer from a case that was left while it was on its way', async () => {
    let release;
    api.get = vi.fn(() => new Promise((resolve) => (release = () => resolve(MEDIA))));
    const saved = store();
    saved.load('case-1');
    const first = release;
    saved.loadMode('case-1', 1);
    const media = release;
    saved.load('case-2');
    first();
    media();
    await Promise.resolve();
    await Promise.resolve();
    expect(saved.media).toEqual([]);
  });

  it('ignores an earlier case’s answer once the case has changed', async () => {
    let release;
    api.get = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ROWS);
        })
    );
    const saved = store();
    const stop = saved.load('case-1');
    stop(); // the case changed under the request
    release();
    await Promise.resolve();
    expect(saved.rows).toEqual([]);
  });
});

describe('what the panel is showing', () => {
  it('is what the map layer draws: the filter, never the whole index', async () => {
    const saved = store();
    saved.load('case-1');
    await vi.waitFor(() => expect(saved.rows).toHaveLength(3));
    saved.kind = 'all';
    expect(saved.shown).toHaveLength(3);
    saved.kind = 'places';
    expect(saved.shown.map((row) => row.id)).toEqual(['e1']);
    saved.kind = 'all';
    saved.query = 'quai';
    expect(saved.shown.map((row) => row.id)).toEqual(['e1']);
  });

  it('remembers which grouping the panel was left on', () => {
    const saved = store();
    expect(saved.group).toBe('geo');
    saved.group = 'folders';
    expect(localStorage.getItem('azimut:satelliteSavedGroup')).toBe('folders');
    expect(store().group).toBe('folders');
  });
});

describe('a Locate pass', () => {
  it('runs in bounded batches until the backlog is empty', async () => {
    const batches = [
      { located: 10, failed: 0, remaining: 12 },
      { located: 10, failed: 0, remaining: 2 },
      { located: 2, failed: 0, remaining: 0 },
    ];
    api.post = vi.fn(async () => batches.shift());
    const saved = store();
    saved.rows = Array.from({ length: 22 }, (_, i) => ({ id: `e${i}`, kind: 'place' }));
    await saved.runLocate('case-1');
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/satellite/locate?limit=10');
    expect(notify).toHaveBeenCalledWith('Located 22 of 22', 'ok');
    expect(saved.locating).toBeNull();
  });

  it('stops when a batch resolves nothing, instead of hammering forever', async () => {
    // offline, every batch comes back with the same backlog
    api.post = vi.fn(async () => ({ located: 0, failed: 4, remaining: 4 }));
    const saved = store();
    saved.rows = [{ id: 'e1', kind: 'place' }];
    await saved.runLocate('case-1');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('run Locate again to retry'), 'warn');
  });

  it('says to wait when OpenStreetMap is rate-limiting the address', async () => {
    // a 429 is not a lookup failure: running the pass again is the wrong advice
    api.post = vi.fn(async () => ({ located: 1, failed: 0, remaining: 3, throttled: true }));
    const saved = store();
    saved.rows = Array.from({ length: 4 }, (_, i) => ({ id: `e${i}`, kind: 'place' }));
    await saved.runLocate('case-1');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('rate-limiting'), 'warn');
  });

  it('can be stopped, and keeps what was already resolved', async () => {
    const saved = store();
    saved.rows = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, kind: 'place' }));
    api.post = vi.fn(async () => {
      saved.stopLocate();
      return { located: 10, failed: 0, remaining: 20 };
    });
    await saved.runLocate('case-1');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Located 10 of 30', 'ok');
  });

  it('does not let a pass continue in another case', async () => {
    const saved = store();
    saved.rows = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, kind: 'place' }));
    api.post = vi.fn(async () => {
      saved.load('case-2'); // the analyst opened another case mid-pass
      return { located: 10, failed: 0, remaining: 20 };
    });
    await saved.runLocate('case-1');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled(); // it says nothing about a case it left
    // and the case it left is never re-read into the panel now showing another
    expect(calls).toEqual(['/api/cases/case-2/satellite/index']);
  });

  it('refuses to start twice over', async () => {
    let release;
    api.post = vi.fn(() => new Promise((resolve) => (release = () => resolve({ located: 1, failed: 0, remaining: 0 }))));
    const saved = store();
    saved.rows = [{ id: 'e1', kind: 'place' }];
    const first = saved.runLocate('case-1');
    await saved.runLocate('case-1');
    expect(api.post).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('counts only what still has no country', async () => {
    const saved = store();
    saved.rows = ROWS;
    expect(saved.pending).toBe(2);
  });
});

describe('acting on a row', () => {
  it('accepts a point with the same PATCH the sidebar sends', async () => {
    const saved = store();
    await saved.accept('case-1', { id: 'e1' });
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/entities/e1', {
      status: 'confirmed',
    });
    // …then re-reads the case, or the row would keep claiming it is proposed
    expect(reloadCase).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Point accepted', 'ok', 1600);
  });

  it('accepts one point at a time', async () => {
    let release;
    api.patch = vi.fn(() => new Promise((resolve) => (release = resolve)));
    const saved = store();
    const first = saved.accept('case-1', { id: 'e1' });
    expect(saved.acceptingId).toBe('e1');
    await saved.accept('case-1', { id: 'e2' });
    expect(api.patch).toHaveBeenCalledTimes(1);
    release({});
    await first;
    expect(saved.acceptingId).toBeNull();
  });

  it('files a dragged row through its own entity type', async () => {
    // a place filed as a capture would be routed to PATCH /media, the sidecar
    // of an image the place is not
    const saved = store();
    await saved.move('case-1', { id: 'e1', kind: 'place', path: null }, 'Quays');
    expect(assignFolder).toHaveBeenCalledWith(
      'case-1',
      { id: 'e1', type: 'place', attrs: { path: null } },
      'Quays'
    );
    await saved.move('case-1', { id: 'e3', kind: 'screenshot', path: 'media/b.png' }, '');
    // a screenshot rides the capture type
    expect(assignFolder).toHaveBeenLastCalledWith(
      'case-1',
      { id: 'e3', type: 'capture', attrs: { path: 'media/b.png' } },
      ''
    );
    // a photo keeps its sidecar in step, through the media route
    await saved.move('case-1', { id: 'm1', kind: 'media', path: 'media/clip.mp4' }, 'Quays');
    expect(assignFolder).toHaveBeenLastCalledWith(
      'case-1',
      { id: 'm1', type: 'media', attrs: { path: 'media/clip.mp4' } },
      'Quays'
    );
    // a comparison is filed as its saved session, never as its preview image
    await saved.move('case-1', { id: 's1', kind: 'comparison', path: 'media/Harbour.png' }, 'Quays');
    expect(assignFolder).toHaveBeenLastCalledWith(
      'case-1',
      { id: 's1', type: 'compare-session', attrs: { path: 'media/Harbour.png' } },
      'Quays'
    );
    expect(reloadCase).toHaveBeenCalledTimes(4);
    expect(notify).toHaveBeenLastCalledWith('Filed in Quays', 'ok', 1600);
  });

  it('deletes a place as an entity and a capture as a file', async () => {
    const saved = store();
    await saved.remove('case-1', { id: 'e1', kind: 'place' });
    expect(api.del).toHaveBeenCalledWith('/api/cases/case-1/entities/e1');
    await saved.remove('case-1', { id: 'e2', kind: 'capture', path: 'media/a b.png' });
    expect(api.del).toHaveBeenLastCalledWith(
      '/api/cases/case-1/satellite?path=media%2Fa%20b.png'
    );
    // a comparison goes as its session; its images stay in Media
    await saved.remove('case-1', { id: 's1', kind: 'comparison', path: 'media/Harbour.png' });
    expect(api.del).toHaveBeenLastCalledWith('/api/cases/case-1/entities/s1');
  });
});
