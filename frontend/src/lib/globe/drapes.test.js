import { describe, expect, it, vi } from 'vitest';
import { createDrapes, overlaps, tileBounds } from './drapes.js';

/** A drape store whose tiles the test paints by hand. */
function harness() {
  const pending = [];
  const compose = vi.fn((tile, signal) => new Promise((resolve, reject) => {
    pending.push({ tile, resolve });
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const release = vi.fn();
  let n = 0;
  const drapes = createDrapes({ compose, upload: () => ({ texture: `t${(n += 1)}`, bytes: 10 }), release });
  return { drapes, pending, compose, release };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const frame = (drapes, tiles) => {
  drapes.begin();
  const out = tiles.map((t) => drapes.drapeFor(t, 0));
  drapes.end();
  return out;
};
const T = { z: 10, x: 532, y: 361 };

describe('what the globe lays over its imagery, a tile at a time', () => {
  it('knows a tile’s ground in degrees', () => {
    const b = tileBounds({ z: 1, x: 1, y: 0 });
    expect(b.west).toBe(0);
    expect(b.east).toBe(180);
    expect(b.south).toBeCloseTo(0);
    expect(b.north).toBeCloseTo(85.0511, 3);
    expect(overlaps(b, { west: 10, east: 20, south: 10, north: 20 })).toBe(true);
    expect(overlaps(b, { west: -20, east: -10, south: 10, north: 20 })).toBe(false);
  });

  it('paints a tile once, and draws it from the next frame on', async () => {
    const { drapes, pending, compose } = harness();
    expect(frame(drapes, [T])).toEqual([null]);
    pending[0].resolve({ close: vi.fn() });
    await flush();
    frame(drapes, [T]);
    const [drape] = frame(drapes, [T]);
    expect(drape).toEqual({ handle: expect.objectContaining({ texture: 't1' }), box: [1, 1, 0, 0] });
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('holds no picture for a tile nothing lies on, and asks nothing more of it', async () => {
    const { drapes, pending, compose } = harness();
    frame(drapes, [T]);
    pending[0].resolve(null);
    await flush();
    frame(drapes, [T]);
    expect(frame(drapes, [T])).toEqual([null]);
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('paints again only the tiles a change falls on, keeping the old picture meanwhile', async () => {
    const { drapes, pending, compose, release } = harness();
    const far = { z: 10, x: 10, y: 10 };
    frame(drapes, [T, far]);
    pending.forEach((p) => p.resolve({}));
    await flush();
    frame(drapes, [T, far]);
    drapes.invalidate(tileBounds(T));
    const [kept] = frame(drapes, [T, far]);
    expect(kept.handle.texture).toBe('t1');
    expect(compose).toHaveBeenCalledTimes(3);
    expect(compose.mock.calls[2][0]).toMatchObject(T);
    pending[2].resolve({});
    await flush();
    frame(drapes, [T, far]);
    // the replaced picture is let go a frame later, once no frame draws it
    expect(release).not.toHaveBeenCalled();
    const [fresh] = frame(drapes, [T, far]);
    expect(fresh.handle.texture).toBe('t3');
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ texture: 't1' }));
  });

  it('draws a tile with its parent’s picture while its own is on its way', async () => {
    const { drapes, pending } = harness();
    const parent = { z: 9, x: 266, y: 180 };
    frame(drapes, [parent]);
    pending[0].resolve({});
    await flush();
    frame(drapes, [parent]);
    const [child] = frame(drapes, [T]);
    expect(child).toEqual({ handle: expect.objectContaining({ texture: 't1' }), box: [0.5, 0.5, 0, 0.5] });
  });

  it('counts the tiles still to be painted', async () => {
    const { drapes, pending } = harness();
    frame(drapes, [T]);
    expect(drapes.waiting).toBe(1);
    pending[0].resolve({});
    await flush();
    frame(drapes, [T]);
    drapes.begin();
    drapes.drapeFor(T, 0);
    expect(drapes.waiting).toBe(0);
  });
});
