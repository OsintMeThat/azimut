import { describe, expect, it, vi } from 'vitest';
import { createTiles, ROOT_Z } from './tiles.js';

const EYE = { lat: 45.94, lon: 7.82 };
const CAMERA = { heading: 0, tilt: 0, roll: 0, fov: 60, width: 240, height: 160, projection: 'camera' };

/** A tree with a worker that answers on demand: meshes asked and pictures asked, by key. */
function tree(options = {}) {
  const meshes = [];
  const pictures = [];
  const released = [];
  const attached = [];
  const tiles = createTiles({
    ...EYE,
    far: 20000,
    send: (list) => meshes.push(...list),
    sendImages: (list) => pictures.push(...list),
    release: (tile) => released.push(tile),
    attach: (tile, image) => {
      tile.texture = image;
      attached.push([tile.key, image]);
    },
    ...options,
  });
  /** Every mesh asked so far built, with a picture when one was asked; failing keys come back empty. */
  const build = (failing = () => false) => {
    for (const ask of meshes.splice(0)) {
      const tile = failing(ask) ? null : { key: ask.key, texture: ask.provider ? `${ask.provider}:${ask.key}` : null };
      // level ground, 0 to 10 m above the sea
      tiles.arrived(ask.key, tile, ask.provider, tile ? { low: 0, high: 10 } : null);
    }
  };
  const picture = () => {
    for (const ask of pictures.splice(0)) tiles.imaged(ask.key, ask.provider, `${ask.provider}:${ask.key}`);
  };
  /** Frames until nothing more is asked. */
  const settle = (camera = CAMERA, sharp = 1.5, eye = {}) => {
    let out;
    for (let round = 0; round < 40; round += 1) {
      out = tiles.frame(camera, sharp, eye);
      if (!meshes.length && !pictures.length) break;
      build();
      picture();
    }
    return out;
  };
  return { tiles, meshes, pictures, released, attached, build, picture, settle };
}

describe('the tile tree', () => {
  it('asks the roots round the eye first, and the levels under them it will need with them', () => {
    const t = tree();
    t.tiles.land(CAMERA);
    const first = t.tiles.frame(CAMERA, 1.5);
    expect(first.drawn).toEqual([]);
    expect(t.meshes[0].z).toBe(ROOT_Z);
    // a deep view does not wait for one level after another, four at most ahead
    expect(t.meshes.some((ask) => ask.z > ROOT_Z)).toBe(true);
    expect(Math.max(...t.meshes.map((ask) => ask.z))).toBeLessThanOrEqual(ROOT_Z + 4);
    expect(first.base.meshed).toBe(0);
    expect(first.base.total).toBeGreaterThan(t.meshes.length);
  });

  it('loads the base all round, then sharpens the lens, never drawing a hole meanwhile', () => {
    const t = tree();
    t.tiles.land(CAMERA);
    t.tiles.frame(CAMERA, 1.5);
    t.build();
    // the roots held: drawn while their children come
    const coarse = t.tiles.frame(CAMERA, 1.5);
    expect(coarse.drawn.length).toBeGreaterThan(0);
    expect(coarse.sharpening).toBeGreaterThan(0);
    const done = t.settle();
    expect(done.base.meshed).toBe(done.base.total);
    expect(done.base.done).toBe(done.base.total);
    expect(done.sharpening).toBe(0);
    expect(Math.max(...done.drawn.map((tile) => Number(tile.key.split('/')[0])))).toBeGreaterThan(ROOT_Z + 2);
    // turning round asks nothing more for the base, only what the lens sharpens there
    const behind = { ...CAMERA, heading: 180 };
    const turned = t.tiles.frame(behind, 3);
    expect(turned.drawn.length).toBeGreaterThan(0);
    expect(t.meshes).toEqual([]);
  });

  it('draws a tile instead of its children until every child in sight is held', () => {
    const t = tree();
    t.tiles.land(CAMERA);
    t.tiles.frame(CAMERA, 1.5);
    t.build();
    t.tiles.frame(CAMERA, 1.5);
    const asked = t.meshes.splice(0);
    // all but one child come back: their parents are still the ones drawn
    asked.slice(1).forEach((ask) => t.tiles.arrived(ask.key, { key: ask.key, texture: null }, null));
    const parentOf = (key) => {
      const [z, x, y] = key.split('/').map(Number);
      return `${z - 1}/${x >> 1}/${y >> 1}`;
    };
    const drawn = t.tiles.frame(CAMERA, 1.5).drawn.map((tile) => tile.key);
    expect(drawn).toContain(parentOf(asked[0].key));
    expect(drawn).not.toContain(asked[0].key);
  });

  it('lays the base coarser where it would hold too many tiles', () => {
    const t = tree({ baseMax: 60 });
    t.tiles.land({ ...CAMERA, width: 2000 });
    const out = t.settle({ ...CAMERA, width: 2000 }, 50);
    expect(out.base.total).toBeLessThanOrEqual(60);
  });

  it('lets the tiles a turned-away lens sharpened go past its budget, never what the last frame drew', () => {
    const base = tree();
    base.tiles.land(CAMERA);
    const total = base.settle().base.total;
    const t = tree({ budget: total + 10 });
    t.tiles.land(CAMERA);
    const telephoto = { ...CAMERA, fov: 8 };
    t.settle(telephoto);
    expect(t.released).toEqual([]);
    const away = { ...telephoto, heading: 180 };
    const out = t.settle(away);
    t.tiles.frame(away, 1.5);
    expect(t.released.length).toBeGreaterThan(0);
    const drawn = new Set(out.drawn.map((tile) => tile.key));
    expect(t.released.some((tile) => drawn.has(tile.key))).toBe(false);
  });

  it('asks again what failed once told to try again', () => {
    const t = tree();
    t.tiles.land(CAMERA);
    t.tiles.frame(CAMERA, 1.5);
    t.build(() => true);
    const failed = t.tiles.frame(CAMERA, 1.5);
    expect(failed.base.meshed).toBeGreaterThan(0); // a failure is done with, not waited for
    expect(t.meshes).toEqual([]);
    t.tiles.retry();
    t.tiles.frame(CAMERA, 1.5);
    expect(t.meshes.length).toBeGreaterThan(0);
  });

  it('sharpens only the ground the frame shows, not the ground under its bottom edge', () => {
    const telephoto = { ...CAMERA, fov: 4, tilt: 0 };
    const asked = (eye) => {
      const t = tree();
      t.tiles.land(CAMERA);
      t.settle(CAMERA, 1.5, eye);
      const before = t.tiles.held;
      t.settle(telephoto, 1.5, eye);
      return t.tiles.held - before;
    };
    // from 1000 m over level ground, a lens on the horizon sees nothing nearer than its horizon
    const high = asked({ alt: 1000 });
    const anywhere = asked({});
    expect(high).toBeLessThan(anywhere / 2);
  });

  it('widens what may be in sight by how far the eye has walked from where the tree was laid', () => {
    const t = tree();
    t.tiles.land(CAMERA);
    t.settle();
    const narrow = { ...CAMERA, fov: 10, width: 240 };
    const still = t.tiles.frame(narrow, 1.5).drawn.length;
    const walked = t.tiles.frame(narrow, 1.5, { shift: 1200 }).drawn.length;
    expect(walked).toBeGreaterThan(still);
  });
});

describe('the pictures over the tiles', () => {
  it('reads none while the ground is not Satellite', () => {
    const t = tree();
    t.tiles.land(CAMERA);
    t.settle();
    expect(t.pictures).toEqual([]);
  });

  it('builds each tile with the imagery asked: Sentinel-2 nearer than its reach, the free imagery beyond', () => {
    const imagery = { provider: 'esri-world-imagery', near: { provider: 'sentinel2~x', reach: 3000 } };
    const t = tree({ imagery });
    t.tiles.land(CAMERA);
    const asked = [];
    for (let round = 0; round < 40; round += 1) {
      t.tiles.frame(CAMERA, 1.5);
      if (!t.meshes.length) break;
      asked.push(...t.meshes);
      t.build();
    }
    const providers = new Set(asked.map((ask) => ask.provider));
    expect(providers).toEqual(new Set(['esri-world-imagery', 'sentinel2~x']));
    expect(t.tiles.frame(CAMERA, 1.5).base.done).toBe(t.tiles.frame(CAMERA, 1.5).base.total);
  });

  it('asks the held tiles\' pictures again for another imagery, the ones on screen first, and keeps the old ones meanwhile', () => {
    const t = tree();
    t.tiles.land(CAMERA);
    t.settle();
    t.tiles.setImagery({ provider: 'esri-wayback~1', near: null });
    const out = t.tiles.frame(CAMERA, 1.5);
    expect(out.base.done).toBeLessThan(out.base.total);
    expect(out.sharpening).toBeGreaterThan(0);
    const onScreen = new Set(out.drawn.map((tile) => tile.key));
    const first = t.pictures.slice(0, onScreen.size);
    expect(first.every((ask) => onScreen.has(ask.key))).toBe(true);
    expect(t.pictures.every((ask) => ask.provider === 'esri-wayback~1')).toBe(true);
    t.picture();
    const done = t.settle();
    expect(done.base.done).toBe(done.base.total);
    expect(done.drawn.every((tile) => tile.texture === `esri-wayback~1:${tile.key}`)).toBe(true);
  });

  it('closes a picture that comes back for imagery no longer asked', () => {
    const t = tree();
    t.tiles.land(CAMERA);
    t.settle();
    t.tiles.setImagery({ provider: 'esri-wayback~1', near: null });
    t.tiles.frame(CAMERA, 1.5);
    const ask = t.pictures[0];
    t.tiles.setImagery({ provider: 'esri-world-imagery', near: null });
    const image = { close: vi.fn() };
    t.tiles.imaged(ask.key, ask.provider, image);
    expect(image.close).toHaveBeenCalled();
    expect(t.attached.find(([key]) => key === ask.key)).toBeUndefined();
  });
});
