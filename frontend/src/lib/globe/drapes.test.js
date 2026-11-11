import { describe, expect, it, vi } from 'vitest';
import { createDrapes, overlaps, STAND_IN_LEVELS, tileBounds } from './drapes.js';

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

  it('borrows an ancestor only a few levels up, where its lines are still lines', async () => {
    const { drapes, pending } = harness();
    const parent = { z: 9, x: 266, y: 180 };
    frame(drapes, [parent]);
    pending[0].resolve({});
    await flush();
    frame(drapes, [parent]);
    const near = { z: 9 + STAND_IN_LEVELS, x: 266 << STAND_IN_LEVELS, y: 180 << STAND_IN_LEVELS };
    const far = { z: 10 + STAND_IN_LEVELS, x: 266 << (STAND_IN_LEVELS + 1), y: 180 << (STAND_IN_LEVELS + 1) };
    const [borrowed, bare] = frame(drapes, [near, far]);
    const s = 1 / 2 ** STAND_IN_LEVELS;
    expect(borrowed).toEqual({ handle: expect.objectContaining({ texture: 't1' }), box: [s, s, 0, 0] });
    // a dense layer's 2 px lines, five levels up, were one sheet of colour over the ground near the eye
    expect(bare).toBeNull();
    // a tile itself drawn a level coarser than wanted may climb one level less
    drapes.begin();
    expect(drapes.drapeFor(near, 0, STAND_IN_LEVELS - 1)).toBeNull();
    expect(drapes.drapeFor({ z: 10, x: 532, y: 360 }, 0, STAND_IN_LEVELS - 1)).not.toBeNull();
    drapes.end();
  });

  it('paints first the tiles left with nothing meanwhile, before those a near ancestor covers', async () => {
    const { drapes, pending, compose } = harness();
    const parent = { z: 9, x: 266, y: 180 };
    const lone = { z: 10, x: 10, y: 10 };
    const coarse = { z: 5, x: 0, y: 0 };
    frame(drapes, [parent, coarse]);
    pending.forEach((p) => p.resolve({}));
    await flush();
    frame(drapes, [parent, coarse]);
    const covered = [];
    for (let x = 0; x < 4; x += 1) for (let y = 0; y < 3; y += 1) covered.push({ z: 11, x: 1064 + x, y: 720 + y });
    drapes.begin();
    for (const t of covered) expect(drapes.drapeFor(t, 11e9)).not.toBeNull();
    // asked last and with the worst rank, yet painted in the first round
    expect(drapes.drapeFor(lone, 20e9)).toBeNull();
    drapes.end();
    const sent = compose.mock.calls.slice(2).map(([tile]) => `${tile.z}/${tile.x}/${tile.y}`);
    expect(sent[0]).toBe('10/10/10');
    expect(sent.length).toBeLessThan(covered.length + 1);
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
