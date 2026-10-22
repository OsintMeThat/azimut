import { describe, expect, it, vi } from 'vitest';
import { cameraFor } from './camera.js';
import { ALL, ROOT_Z, createTree } from './tree.js';
import { SEG } from './mesh.js';

const SIZE = { width: 1280, height: 720 };

/** A tree whose meshes are built at once, flat at `height` unless `build` says otherwise. */
function harness({ budget, height = 100, build = null } = {}) {
  const asked = [];
  const release = vi.fn();
  const tree = createTree({ request: (list) => asked.push(...list), release, budget });
  const built = (t) =>
    build?.(t) ?? { mesh: { key: t.key }, heights: new Float32Array((SEG + 1) ** 2).fill(height), centre: [0, 0, 0], low: height, high: height };
  return {
    tree,
    asked,
    release,
    /** Frames until nothing more is asked, every ask answered between two. */
    settle(camera, { rounds = 40, limit } = {}) {
      let out = null;
      for (let i = 0; i < rounds; i += 1) {
        out = tree.frame(camera, SIZE, { limit });
        if (!asked.length) break;
        for (const t of asked.splice(0)) tree.arrived(t.key, built(t));
      }
      return out;
    },
  };
}

describe('the tiles of the globe', () => {
  it('asks the four roots first and draws nothing until they come', () => {
    const { tree, asked } = harness();
    const { drawn } = tree.frame(cameraFor({ lat: 20, lon: 0, zoom: 2 }, SIZE), SIZE);
    expect(drawn).toEqual([]);
    expect(asked.slice(0, 4).map((t) => t.z)).toEqual([ROOT_Z, ROOT_Z, ROOT_Z, ROOT_Z]);
  });

  it('draws finer tiles near the eye than far from it on a tilted view', () => {
    const { settle } = harness();
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 14, bearing: 0, pitch: 75, elevation: 100 }, SIZE);
    const { drawn } = settle(camera);
    const zooms = drawn.map((n) => n.z);
    expect(Math.max(...zooms)).toBeGreaterThanOrEqual(14);
    expect(Math.min(...zooms)).toBeLessThan(11);
    // never the same ground twice: a tile drawn with a child of its own covers only other quarters
    const shown = new Set(drawn);
    for (const n of drawn) {
      if (!n.parent || !shown.has(n.parent)) continue;
      expect(n.parent.quarters & (1 << n.parent.kids.indexOf(n))).toBe(0);
    }
  });

  it('draws a tile over the quarters of its children not held yet, and each child held in its own', () => {
    const { tree, asked } = harness();
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 5 }, SIZE);
    const built = () => ({ mesh: {}, heights: new Float32Array((SEG + 1) ** 2), centre: [0, 0, 0], low: 0, high: 0 });
    tree.frame(camera, SIZE);
    const asks = asked.splice(0);
    for (const t of asks.filter((a) => a.z === ROOT_Z)) tree.arrived(t.key, built());
    // the child under the view, over the Alps
    const first = asks.find((a) => a.key === '2/2/1');
    tree.arrived(first.key, built());
    const { drawn } = tree.frame(camera, SIZE);
    const child = tree.node(first.key);
    expect(drawn).toContain(child);
    expect(child.quarters).toBe(ALL);
    const parent = child.parent;
    expect(drawn).toContain(parent);
    // the parent leaves the held child's quarter to it
    expect(parent.quarters & (1 << parent.kids.indexOf(child))).toBe(0);
    expect(parent.quarters).not.toBe(0);
  });

  it('keeps a tile drawn in place of its children until all those in view are held', () => {
    const { tree, asked } = harness();
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 5 }, SIZE);
    const built = () => ({ mesh: {}, heights: new Float32Array((SEG + 1) ** 2), centre: [0, 0, 0], low: 0, high: 0 });
    tree.frame(camera, SIZE);
    // the roots come, and only the first of the children asked with them
    const asks = asked.splice(0);
    for (const t of asks.filter((a) => a.z === ROOT_Z)) tree.arrived(t.key, built());
    tree.arrived(asks.find((a) => a.z === ROOT_Z + 1).key, built());
    const { drawn, waiting } = tree.frame(camera, SIZE);
    expect(drawn.length).toBeGreaterThan(0);
    // the roots stand in, over the quarters still waiting
    expect(drawn.filter((n) => n.z === ROOT_Z).length).toBeGreaterThan(0);
    expect(drawn.every((n) => n.z <= ROOT_Z + 1)).toBe(true);
    expect(waiting).toBeGreaterThan(0);
  });

  it('asks the children of a tile that will surely be split with it, a few levels at once', () => {
    const { tree, asked } = harness();
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 12 }, SIZE);
    tree.frame(camera, SIZE);
    // with the roots, before any of them has come
    expect(Math.max(...asked.map((t) => t.z))).toBeGreaterThanOrEqual(ROOT_Z + 2);
  });

  it('stops splitting at the deepest level it is allowed', () => {
    const { settle } = harness();
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 17, pitch: 30, elevation: 100 }, SIZE);
    const { drawn } = settle(camera, { limit: 9 });
    expect(Math.max(...drawn.map((n) => n.z))).toBe(9);
  });

  it('lets the meshes no frame uses go past its budget, deepest first, never one with a child held', () => {
    const { tree, settle, release } = harness({ budget: 60 });
    settle(cameraFor({ lat: 46.56, lon: 7.91, zoom: 13, pitch: 60, elevation: 100 }, SIZE));
    expect(tree.groundAt(46.56, 7.91).z).toBeGreaterThanOrEqual(13);
    const sydney = cameraFor({ lat: -33.9, lon: 151.2, zoom: 13, pitch: 60, elevation: 100 }, SIZE);
    settle(sydney);
    for (let i = 0; i < 20; i += 1) tree.frame(sydney, SIZE);
    // a held tile is always reached through held parents
    for (const n of release.mock.calls.map(([node]) => node)) {
      expect((n.kids ?? []).some((c) => c.state === 'ready')).toBe(false);
    }
    // the Alps let go, down to coarse ground that stands for the whole far side
    expect(tree.groundAt(46.56, 7.91)?.z ?? ROOT_Z).toBeLessThan(8);
    // what the view in use holds stays
    expect(tree.groundAt(-33.9, 151.2).z).toBeGreaterThanOrEqual(13);
  });

  it('reads the ground under a point from the finest tile held there', () => {
    const { tree, settle } = harness({
      build: (t) => {
        const heights = new Float32Array((SEG + 1) ** 2);
        // each tile's ground rises a metre a cell eastward, from its zoom × 100
        for (let j = 0; j <= SEG; j += 1) for (let i = 0; i <= SEG; i += 1) heights[j * (SEG + 1) + i] = t.z * 100 + i;
        return { mesh: {}, heights, centre: [0, 0, 0], low: t.z * 100, high: t.z * 100 + SEG };
      },
    });
    expect(tree.groundAt(46.56, 7.91)).toBe(null);
    settle(cameraFor({ lat: 46.56, lon: 7.91, zoom: 12, elevation: 0 }, SIZE));
    const ground = tree.groundAt(46.56, 7.91);
    expect(ground.z).toBeGreaterThanOrEqual(12);
    expect(Math.floor(ground.h / 100)).toBe(ground.z);
    expect(tree.groundAt(89, 0)).toBe(null);
  });

  it('leaves a tile drawn under its children where one of them could not be built, never a hole', () => {
    const { tree, asked } = harness();
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 4 }, SIZE);
    const ok = (key) => tree.arrived(key, { mesh: {}, heights: new Float32Array((SEG + 1) ** 2), centre: [0, 0, 0], low: 0, high: 0 });
    tree.frame(camera, SIZE);
    const asks = asked.splice(0);
    for (const t of asks.filter((a) => a.z === ROOT_Z)) ok(t.key);
    const children = asks.filter((t) => t.z === ROOT_Z + 1);
    tree.arrived(children[0].key, null);
    for (const t of children.slice(1)) ok(t.key);
    const { drawn } = tree.frame(camera, SIZE);
    const failedParent = tree.node(children[0].key).parent;
    expect(drawn).toContain(failedParent);
    // asked again once the app is back
    tree.retry();
    expect(tree.node(children[0].key).state).toBe('idle');
  });
});

describe('ground kept known out of view', () => {
  it('asks the ground under the eye though a tilted view looks away from it', () => {
    const { tree, settle } = harness();
    // looking north over the Alps from 30 km south: the eye's own ground is behind the lens
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 14, pitch: 80, elevation: 100 }, SIZE);
    settle(camera);
    const eye = { lat: 46.56 - 0.065, lon: 7.91 };
    expect(tree.groundAt(eye.lat, eye.lon).z).toBeGreaterThanOrEqual(12);
  });

  it('keeps the ground round an orbit pivot known, from the root down', () => {
    const { tree, settle } = harness();
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 14, pitch: 30, elevation: 100 }, SIZE);
    settle(camera);
    // fifty kilometres west of the view, out of it
    const before = tree.groundAt(46.56, 7.25)?.z ?? 0;
    expect(before).toBeLessThan(12);
    tree.knowGround(46.56, 7.25, 3000);
    settle(camera);
    expect(tree.groundAt(46.56, 7.25).z).toBeGreaterThanOrEqual(12);
  });

  it('forgets the tiles of a place let go, so the tree stays the size of what it holds', () => {
    const { tree, settle } = harness({ budget: 60 });
    const alps = cameraFor({ lat: 46.56, lon: 7.91, zoom: 15, pitch: 40, elevation: 100 }, SIZE);
    settle(alps);
    const deep = tree.groundAt(46.56, 7.91);
    const s = Math.sin(46.56 * (Math.PI / 180));
    const key = `${deep.z}/${Math.floor(((7.91 + 180) / 360) * 2 ** deep.z)}/${Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** deep.z)}`;
    expect(tree.node(key)).not.toBe(null);
    const sydney = cameraFor({ lat: -33.9, lon: 151.2, zoom: 13, pitch: 40, elevation: 100 }, SIZE);
    settle(sydney);
    for (let i = 0; i < 30; i += 1) tree.frame(sydney, SIZE);
    expect(tree.node(key)).toBe(null);
  });
});

describe('the ground all round the eye', () => {
  it('is asked out of view, coarser, after everything in view', () => {
    const { tree, asked } = harness();
    // looking north from low over the Alps: the ground behind the eye is out of view
    const camera = cameraFor({ lat: 46.56, lon: 7.91, zoom: 15, pitch: 75, elevation: 100 }, SIZE);
    const built = (t) => ({ mesh: { key: t.key }, heights: new Float32Array((SEG + 1) ** 2).fill(100), centre: [0, 0, 0], low: 100, high: 100 });
    let round = [];
    for (let i = 0; i < 40; i += 1) {
      ({ round } = tree.frame(camera, SIZE));
      if (!asked.length) break;
      for (const t of asked.splice(0)) tree.arrived(t.key, built(t));
    }
    // ground ten kilometres behind the eye is held, a few levels short of sharp
    const behind = tree.groundAt(46.56 - 0.2, 7.91);
    expect(behind.z).toBeGreaterThanOrEqual(10);
    expect(round.length).toBeGreaterThan(0);
  });
});
