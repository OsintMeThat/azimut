import { describe, expect, it, vi } from 'vitest';
import { boxWithin, createPictures, pictureTile, UPLOADS_PER_FRAME } from './pictures.js';
import { FREE_FAR_PROVIDER } from '../map/quotaGuard.js';

const tile = (z, x, y) => ({ z, x, y });

/** A picture store whose fetches the test answers by hand. */
function harness({ budget } = {}) {
  const pending = [];
  const fetch = vi.fn(
    (provider, z, x, y, signal) =>
      new Promise((resolve, reject) => {
        pending.push({ provider, z, x, y, resolve, reject });
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
  );
  const release = vi.fn();
  const onMetered = vi.fn();
  const onFailed = vi.fn();
  const pictures = createPictures({
    fetch,
    upload: (bitmap) => ({ texture: bitmap.name, bytes: 1000 }),
    release,
    onMetered,
    onFailed,
    ...(budget ? { budget } : {}),
  });
  return { pictures, pending, fetch, release, onMetered, onFailed };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const bitmap = (name) => ({ name, close: vi.fn() });

describe('which picture a tile is drawn with', () => {
  it('takes the imagery tile of its own place, a level up for a grid of 512 px pictures', () => {
    expect(pictureTile(tile(10, 532, 361), 0, 19)).toEqual(tile(10, 532, 361));
    expect(pictureTile(tile(10, 532, 361), 1, 19)).toEqual(tile(9, 266, 180));
    // deeper than the provider goes, its last level, enlarged
    expect(pictureTile(tile(18, 1000, 1000), 0, 14)).toEqual(tile(14, 62, 62));
  });

  it('reads the part of a bigger picture its tile covers', () => {
    expect(boxWithin(tile(10, 532, 361), tile(10, 532, 361))).toEqual([1, 1, 0, 0]);
    expect(boxWithin(tile(10, 533, 361), tile(9, 266, 180))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe('the pictures of the globe', () => {
  it('asks a tile its own picture and draws it once it is laid on the GPU', async () => {
    const { pictures, pending } = harness();
    pictures.setImagery({ provider: 'esri-world-imagery', metered: false, shift: 0, deepest: 19 });
    pictures.begin();
    expect(pictures.pictureFor(tile(5, 16, 11), 0)).toBe(null);
    pictures.end();
    expect(pending.map((p) => [p.provider, p.z, p.x, p.y])).toEqual([['esri-world-imagery', 5, 16, 11]]);
    pending[0].resolve(bitmap('a'));
    await flush();
    pictures.begin();
    pictures.end();
    pictures.begin();
    expect(pictures.pictureFor(tile(5, 16, 11), 0)).toEqual({ handle: { texture: 'a', bytes: 1000 }, box: [1, 1, 0, 0] });
    pictures.end();
  });

  it('draws a tile with the nearest picture above it while its own is on the way', async () => {
    const { pictures, pending } = harness();
    pictures.setImagery({ provider: 'esri-world-imagery', metered: false, shift: 0, deepest: 19 });
    pictures.begin();
    pictures.pictureFor(tile(3, 4, 2), 0);
    pictures.end();
    pending.shift().resolve(bitmap('coarse'));
    await flush();
    pictures.begin();
    pictures.end();
    pictures.begin();
    const shown = pictures.pictureFor(tile(5, 17, 9), 0);
    expect(shown.handle.texture).toBe('coarse');
    expect(shown.box).toEqual([0.25, 0.25, 0.25, 0.25]);
    pictures.end();
  });

  it('asks billed imagery near the view only, the far ground of the free provider, and says what it billed', async () => {
    const { pictures, pending, onMetered } = harness();
    const view = { lat: 46.56, lon: 7.91, zoom: 13, width: 1280, height: 720, pitch: 70 };
    pictures.setImagery({ provider: 'google-satellite', metered: true, shift: 0, deepest: 19, view });
    pictures.begin();
    // the tile under the view and one far toward the horizon
    pictures.pictureFor(tile(14, 8552, 5793), 0);
    pictures.pictureFor(tile(10, 600, 300), 1);
    pictures.end();
    expect(pending.map((p) => p.provider)).toEqual(['google-satellite', FREE_FAR_PROVIDER]);
    pending[0].resolve(bitmap('billed'));
    await flush();
    expect(onMetered).toHaveBeenCalledWith('google-satellite');
  });

  it('asks the free provider for ground coarser than the chosen one renders', () => {
    // Sentinel Hub refuses a pixel over 1500 m, and a refusal raised the error panel
    const { pictures, pending } = harness();
    pictures.setImagery({ provider: 'sentinel2', metered: true, shift: 1, deepest: 13, shallowest: 6 });
    pictures.begin();
    pictures.pictureFor(tile(5, 16, 11), 0);
    pictures.pictureFor(tile(8, 133, 90), 1);
    pictures.end();
    expect(pending.map((p) => [p.provider, p.z])).toEqual([[FREE_FAR_PROVIDER, 4], ['sentinel2', 7]]);
  });

  it('says a refusal of the chosen imagery, not of the free ground under it', async () => {
    const { pictures, pending, onFailed } = harness();
    pictures.setImagery({ provider: 'sentinel2', metered: true, shift: 1, deepest: 13, shallowest: 6 });
    pictures.begin();
    pictures.pictureFor(tile(5, 16, 11), 0);
    pictures.pictureFor(tile(8, 133, 90), 1);
    pictures.end();
    const refused = Object.assign(new Error('refused'), { status: 400 });
    pending[0].reject(refused);
    await flush();
    expect(onFailed).not.toHaveBeenCalled();
    pending[1].reject(refused);
    await flush();
    expect(onFailed).toHaveBeenCalledWith('sentinel2', refused);
  });

  it('lays a few arrivals a frame, so a burst never stalls one', async () => {
    const { pictures, pending } = harness();
    pictures.setImagery({ provider: 'esri-world-imagery', metered: false, shift: 0, deepest: 19 });
    pictures.begin();
    for (let x = 0; x < 10; x += 1) pictures.pictureFor(tile(8, x, 90), x);
    pictures.end();
    for (const p of pending) p.resolve(bitmap(`t${p.x}`));
    await flush();
    pictures.begin();
    for (let x = 0; x < 10; x += 1) pictures.pictureFor(tile(8, x, 90), x);
    expect(pictures.end()).toBe(true);
    expect(pictures.bytes).toBe(UPLOADS_PER_FRAME * 1000);
  });

  it('gives up asking for what no frame wants any more', async () => {
    const { pictures, pending } = harness();
    pictures.setImagery({ provider: 'esri-world-imagery', metered: false, shift: 0, deepest: 19 });
    pictures.begin();
    pictures.pictureFor(tile(12, 2000, 1400), 0);
    pictures.end();
    for (let i = 0; i < 4; i += 1) {
      pictures.begin();
      pictures.end();
    }
    await flush();
    // aborted: it waits to be asked again
    pictures.begin();
    expect(pictures.pictureFor(tile(12, 2000, 1400), 0)).toBe(null);
    pictures.end();
    expect(pending.length).toBe(2);
  });

  it('lets the least used pictures go past its budget, the coarsest kept', async () => {
    const { pictures, pending, release } = harness({ budget: 2500 });
    pictures.setImagery({ provider: 'esri-world-imagery', metered: false, shift: 0, deepest: 19 });
    for (const x of [0, 1, 2, 3]) {
      pictures.begin();
      pictures.pictureFor(tile(9, x, 100), 0);
      pictures.end();
      pending.at(-1).resolve(bitmap(`p${x}`));
      await flush();
      pictures.begin();
      pictures.end();
    }
    expect(release).toHaveBeenCalled();
    expect(pictures.bytes).toBeLessThanOrEqual(2500);
  });
});
