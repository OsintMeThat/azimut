import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The frames a case does not hold yet, drawn from their video for a list: through the
 * edits Inspect keeps for each, one after the other, and let go once the list closes.
 */

const gets = [];
vi.mock('./api.js', () => ({
  api: {
    get: async (path) => {
      gets.push(path);
      return { filters: [{ id: 'brightness', params: [{ name: 'amount', default: 1 }] }, { id: 'crop' }] };
    },
  },
}));

const { frameDrawer, frameOps } = await import('./unfiledFrames.js');

let made = 0;
let revoked = [];
let bodies = [];
let answer = () => ({ ok: true, blob: async () => new Blob(['jpeg']) });

beforeEach(() => {
  made = 0;
  revoked = [];
  bodies = [];
  answer = () => ({ ok: true, blob: async () => new Blob(['jpeg']) });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    bodies.push({ url, ...JSON.parse(init.body), signal: init.signal });
    return answer(init);
  }));
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++made}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revoked.push(url));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const frame = (id, time, edits = {}) => ({ id, time, edits, url: '' });

describe('a frame drawn through its edits', () => {
  it('renders as Inspect would save it, its sliders read once for every list', async () => {
    expect(await frameOps({})).toEqual([]);
    expect(gets).toEqual([]);
    const ops = await frameOps({ rotation: 90, adjust: { brightness: 1.4 } });
    expect(ops.some((o) => o.op === 'brightness')).toBe(true);
    await frameOps({ rotation: 90 });
    expect(gets).toEqual(['/api/inspect/ops']);
  });
});

describe('a list’s drawer', () => {
  it('draws the frames with no picture, one after the other, each into the list shown', async () => {
    const shown = [frame('a', 1.5), { ...frame('b', 2), url: '/files/c1/b.jpg' }, frame('c', 3)];
    const drawer = frameDrawer();
    await drawer.draw('c1', 'media/clip.mp4', shown, () => shown);
    expect(bodies.map((b) => [b.url, b.path, b.time, b.format])).toEqual([
      ['/api/cases/c1/inspect/render-preview', 'media/clip.mp4', 1.5, 'jpeg'],
      ['/api/cases/c1/inspect/render-preview', 'media/clip.mp4', 3, 'jpeg'],
    ]);
    expect(shown.map((f) => f.url)).toEqual(['blob:1', '/files/c1/b.jpg', 'blob:2']);
  });

  it('draws no more than it is asked to', async () => {
    const shown = [1, 2, 3, 4, 5].map((t) => frame(`f${t}`, t));
    await frameDrawer().draw('c1', 'media/clip.mp4', shown, () => shown, { limit: 3 });
    expect(bodies).toHaveLength(3);
    expect(shown.filter((f) => f.url)).toHaveLength(3);
  });

  it('stops at the first that cannot be drawn, the rest keeping their fallback', async () => {
    answer = () => ({ ok: false });
    const shown = [frame('a', 1), frame('b', 2)];
    await frameDrawer().draw('c1', 'media/clip.mp4', shown, () => shown);
    expect(bodies).toHaveLength(1);
    expect(shown.every((f) => !f.url)).toBe(true);
  });

  it('runs one draw after the other, never two renders at once', async () => {
    let open = 0;
    let most = 0;
    answer = async () => {
      most = Math.max(most, ++open);
      await Promise.resolve();
      open -= 1;
      return { ok: true, blob: async () => new Blob(['jpeg']) };
    };
    const first = [frame('a', 1), frame('b', 2)];
    const second = [frame('c', 3)];
    const drawer = frameDrawer();
    await Promise.all([
      drawer.draw('c1', 'v.mp4', first, () => first),
      drawer.draw('c1', 'v.mp4', second, () => second),
    ]);
    expect(most).toBe(1);
    expect(bodies.map((b) => b.time)).toEqual([1, 2, 3]);
  });

  it('lets every picture go once the list closes, and stops the one on its way', async () => {
    const shown = [frame('a', 1), frame('b', 2), frame('c', 3)];
    const drawer = frameDrawer();
    await drawer.draw('c1', 'v.mp4', shown.slice(0, 1), () => shown);
    let release;
    answer = (init) => new Promise((resolve, reject) => {
      release = () => resolve({ ok: true, blob: async () => new Blob(['jpeg']) });
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const run = drawer.draw('c1', 'v.mp4', shown, () => shown);
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    drawer.drop();
    expect(bodies[1].signal.aborted).toBe(true);
    expect(revoked).toEqual(['blob:1']);
    release();
    await run;
    // nothing more is asked, and nothing made after the close
    expect(bodies).toHaveLength(2);
    expect(made).toBe(1);
  });

  it('draws nothing for a list already closed', async () => {
    const shown = [frame('a', 1)];
    await frameDrawer().draw('c1', 'v.mp4', shown, () => null);
    expect(bodies).toHaveLength(0);
  });
});

describe('one copy', () => {
  it('is the only place a list draws an unsaved frame', () => {
    for (const file of ['../tools/ProofComposer.svelte', '../components/GatheredPanel.svelte']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toContain('render-preview');
      expect(source, file).toContain("from '../lib/unfiledFrames.js'");
    }
  });
});
