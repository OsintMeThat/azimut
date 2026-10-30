import { afterEach, describe, expect, it, vi } from 'vitest';
import { eyeFrame } from './geo.js';
import { createScene, GRIDS, progressOf, TRY_AGAIN_MS, WALK_REACH, workerCount } from './scene.js';

const EYE = { lat: 45.94, lon: 7.82, mode: 'ground', height: 1.7 };
const FAR = 150000;
const CAMERA = { heading: 0, tilt: 0, roll: 0, fov: 60, width: 240, height: 160, projection: 'camera' };

function fakeWorker() {
  return { sent: [], postMessage(message) { this.sent.push(message); }, terminate: vi.fn(), onmessage: null };
}

function fakeRenderer() {
  return {
    addTile: vi.fn((data) => ({ key: data.key, texture: data.image ?? null })),
    setImage: vi.fn(),
    dropTile: vi.fn((tile, keep) => (keep ? tile.texture : null)),
    adoptTexture: vi.fn((tile, texture) => (tile.texture = texture)),
    deleteTexture: vi.fn(),
    setGrids: vi.fn(),
    setPhoto: vi.fn(),
    draw: vi.fn(),
    pick: vi.fn(() => 1000),
    pickSoon: vi.fn(async () => 1000),
    dispose: vi.fn(),
    addBuildingChunk: vi.fn(),
    dropBuildingChunk: vi.fn(),
    clearBuildingChunks: vi.fn(),
  };
}

function setUp() {
  const workers = [];
  const renderer = fakeRenderer();
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const onChange = vi.fn();
  const onRefused = vi.fn();
  const scene = createScene(canvas, {
    onChange,
    onRefused,
    makeWorker: () => {
      const worker = fakeWorker();
      workers.push(worker);
      return worker;
    },
    makeRenderer: () => renderer,
  });
  const answer = (data, worker = workers[0]) => worker.onmessage({ data });
  const sent = (type) => workers.flatMap((worker) => worker.sent.filter((message) => message.type === type));
  return { scene, workers, renderer, onChange, onRefused, answer, sent };
}

/** The eye's answer from the first worker, as worker.js gives it. */
function landed(s, alt = 3101.7, ground = 3100) {
  const id = s.sent('eye').at(-1).id;
  s.answer({ type: 'eye', id, ground, alt });
  return id;
}

afterEach(() => vi.useRealTimers());

describe('the scene', () => {
  it('needs WebGL2: without it there is no scene and no worker', () => {
    const makeWorker = vi.fn();
    expect(createScene({ addEventListener: vi.fn() }, { makeWorker, makeRenderer: () => null })).toBeNull();
    expect(makeWorker).not.toHaveBeenCalled();
  });

  it('builds tiles on one worker per four threads, three at most', () => {
    expect(workerCount(2)).toBe(1);
    expect(workerCount(8)).toBe(2);
    expect(workerCount(32)).toBe(3);
  });

  it('lands an eye: the sky alone until the ground under it is read, then the tiles all round', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    expect(s.sent('eye')).toHaveLength(s.workers.length);
    expect(s.sent('eye')[0]).toMatchObject({ lat: EYE.lat, lon: EYE.lon, mode: 'ground', height: 1.7 });
    expect(s.scene.draw(CAMERA)).toEqual({ phase: 'landing', share: 0 });
    expect(s.renderer.draw).toHaveBeenLastCalledWith(CAMERA, [], expect.objectContaining({ shaded: false }));
    expect(s.scene.landed).toBe(false);
    landed(s);
    expect(s.scene.landed).toBe(true);
    const progress = s.scene.draw(CAMERA);
    expect(progress.phase).toBe('landing');
    expect(s.sent('tiles').length).toBeGreaterThan(0);
  });

  it('says how far the ground all round has come, then its pictures, the shadows, the lens', () => {
    const base = { meshed: 0, done: 0, total: 10 };
    expect(progressOf({ landed: true, base, sharpening: 0 })).toEqual({ phase: 'landing', share: 0 });
    expect(progressOf({ landed: true, base: { ...base, meshed: 10, done: 4 } })).toEqual({ phase: 'imagery', share: 0.4 });
    expect(progressOf({ landed: true, base: { ...base, meshed: 10, done: 10 }, shadows: true })).toEqual({ phase: 'shadows', share: 1 });
    expect(progressOf({ landed: true, base: { ...base, meshed: 10, done: 10 }, sharpening: 3 })).toEqual({ phase: 'sharpening', share: 1 });
    expect(progressOf({ landed: true, base: { ...base, meshed: 10, done: 10 }, sharpening: 0 })).toEqual({ phase: '', share: 1 });
  });

  it('walks among the tiles it has, and lands again past its reach or for another one', async () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    landed(s);
    s.scene.draw(CAMERA);
    const frame = eyeFrame({ lat: EYE.lat, lon: EYE.lon, alt: 0 });
    const [lat, lon] = frame.destination(0, 400);
    s.scene.place({ ...EYE, lat, lon }, FAR);
    expect(s.sent('eye')).toHaveLength(s.workers.length);
    const ask = s.sent('height').at(-1);
    expect(ask).toMatchObject({ lat, lon });
    s.answer({ type: 'height', id: ask.id, ask: ask.ask, ground: 3150 });
    await Promise.resolve();
    s.scene.draw(CAMERA);
    const offset = s.renderer.draw.mock.calls.at(-1)[2].eye;
    expect(offset[1]).toBeCloseTo(400, 0);
    expect(offset[2]).toBeCloseTo(3151.7 - 3101.7 - 400 ** 2 / (2 * frame.R), 1);
    // a new height at the same place needs no ground read
    s.scene.place({ ...EYE, lat, lon, height: 11.7 }, FAR);
    await Promise.resolve();
    s.scene.draw(CAMERA);
    expect(s.renderer.draw.mock.calls.at(-1)[2].eye[2]).toBeCloseTo(offset[2] + 10, 3);
    const [farLat] = frame.destination(0, WALK_REACH + 100);
    s.scene.place({ ...EYE, lat: farLat }, FAR);
    expect(s.sent('eye')).toHaveLength(2 * s.workers.length);
    landed(s);
    // a farther reach (an aircraft) keeps the tiles held: no new landing
    s.scene.place({ ...EYE, lat: farLat }, 300000);
    expect(s.sent('eye')).toHaveLength(2 * s.workers.length);
  });

  it('reads the shadows\' grids ahead once the turn is in, so a sun switched on later casts them at once', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    const id = landed(s);
    for (let round = 0; round < 60 && s.scene.draw(CAMERA).phase === 'landing'; round += 1) {
      for (const worker of s.workers) {
        for (const ask of worker.sent.splice(0).filter((message) => message.type === 'tiles')) {
          for (const t of ask.tiles) s.answer({ type: 'tile', id, key: t.key, data: new Float32Array(8), size: 4, low: 0, high: 10 }, worker);
        }
      }
    }
    expect(s.scene.draw(CAMERA).phase).not.toBe('landing');
    expect(s.sent('grids')).toEqual([{ type: 'grids', id, grids: GRIDS }]);
  });

  it('casts shadows once a light asks for them: the grids read once, said while they come', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    const id = landed(s);
    s.scene.draw(CAMERA);
    expect(s.sent('grids')).toEqual([]);
    const waiting = s.scene.draw(CAMERA, { shaded: true });
    s.scene.draw(CAMERA, { shaded: true });
    expect(s.sent('grids')).toEqual([{ type: 'grids', id, grids: GRIDS }]);
    expect(s.renderer.draw.mock.calls.at(-1)[2].shaded).toBe(false);
    expect(waiting.phase === 'shadows' || waiting.phase === 'landing').toBe(true);
    s.answer({ type: 'grids', id, grids: GRIDS.map(() => ({ heights: new Float32Array(4), top: 100 })) });
    expect(s.renderer.setGrids).toHaveBeenLastCalledWith(expect.objectContaining({ top: 105 }));
    s.scene.draw(CAMERA, { shaded: true });
    expect(s.renderer.draw.mock.calls.at(-1)[2].shaded).toBe(true);
  });

  it('reads the ground under a pixel off the frame drawn, and the sky as no distance', () => {
    const s = setUp();
    expect(s.scene.groundAt(CAMERA, 120, 100)).toBeNull();
    s.scene.place(EYE, FAR);
    landed(s);
    s.scene.draw(CAMERA);
    const ground = s.scene.groundAt(CAMERA, 120, 80);
    expect(ground.distance).toBeCloseTo(1000, 0);
    expect(ground.azimuth).toBeCloseTo(0, 6);
    expect(ground.lat).toBeGreaterThan(EYE.lat);
    s.renderer.pick.mockReturnValue(null);
    expect(s.scene.groundAt(CAMERA, 120, 10).distance).toBeNull();
  });

  it('reads the ground under the pointer a moment later, dropping a reading overtaken by a newer one', async () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    landed(s);
    s.scene.draw(CAMERA);
    expect((await s.scene.groundSoon(CAMERA, 120, 80)).distance).toBeCloseTo(1000, 0);
    s.renderer.pickSoon.mockResolvedValueOnce(undefined);
    expect(await s.scene.groundSoon(CAMERA, 120, 80)).toBeUndefined();
  });

  it('drops what comes for an eye it has left, and says when the app refused imagery', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    const old = landed(s);
    s.scene.place({ ...EYE, lat: 46.5 }, FAR);
    const image = { close: vi.fn() };
    s.answer({ type: 'image', id: old, key: '6/33/22', provider: 'esri-world-imagery', image });
    expect(image.close).toHaveBeenCalled();
    s.answer({ type: 'refused', provider: 'sentinel2~x', status: 429, message: 'Sentinel Hub is paused' });
    expect(s.onRefused).toHaveBeenCalledWith(expect.objectContaining({ message: 'Sentinel Hub is paused' }));
  });

  it('says when the ground under the eye could not be read, and lands again when asked', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    const id = s.sent('eye')[0].id;
    s.answer({ type: 'eye', id, ground: null, alt: null });
    expect(s.scene.failed).toBe(true);
    s.scene.retry();
    expect(s.sent('eye')).toHaveLength(2 * s.workers.length);
    expect(s.scene.failed).toBe(false);
  });

  describe('when ground could not be read', () => {
    /** An eye landed whose tiles all fail as they are asked. */
    function failing() {
      vi.useFakeTimers();
      const s = setUp();
      s.scene.place(EYE, FAR);
      const id = landed(s);
      const fail = () => {
        s.scene.draw(CAMERA);
        const asked = s.sent('tiles').flatMap((message) => message.tiles);
        for (const worker of s.workers) worker.sent = worker.sent.filter((message) => message.type !== 'tiles');
        for (const { key } of asked) s.answer({ type: 'tile', id, key, failed: true });
        return asked.length;
      };
      return { s, fail };
    }

    it('asks again by itself, keeping the bar where it is, then stops waiting and says so', () => {
      const { s, fail } = failing();
      expect(fail()).toBeGreaterThan(0);
      expect(s.scene.draw(CAMERA).phase).toBe('landing');
      expect(s.scene.gaps).toBe(false);
      for (const wait of TRY_AGAIN_MS) {
        // nothing is asked before its wait is over
        vi.advanceTimersByTime(wait - 1);
        expect(fail()).toBe(0);
        vi.advanceTimersByTime(1);
        expect(s.scene.gaps).toBe(false);
        expect(fail()).toBeGreaterThan(0);
      }
      // no try left: the view is done with what is missing, and no timer asks again
      expect(s.scene.draw(CAMERA).phase).toBe('');
      expect(s.scene.gaps).toBe(true);
      vi.advanceTimersByTime(60000);
      expect(fail()).toBe(0);
    });

    it('stops saying so when asked by hand, which gives the tries back', () => {
      const { s, fail } = failing();
      fail();
      for (const wait of TRY_AGAIN_MS) {
        vi.advanceTimersByTime(wait);
        fail();
      }
      s.scene.draw(CAMERA);
      expect(s.scene.gaps).toBe(true);
      s.scene.retry();
      expect(s.scene.gaps).toBe(false);
      expect(fail()).toBeGreaterThan(0);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('forgets the tries and the wait when the eye lands somewhere else, or the view closes', () => {
      const { s, fail } = failing();
      fail();
      expect(vi.getTimerCount()).toBe(1);
      s.scene.place({ ...EYE, lat: 46.5 }, FAR);
      expect(vi.getTimerCount()).toBe(0);
      const id = landed(s);
      s.scene.draw(CAMERA);
      const asked = s.sent('tiles').filter((message) => message.id === id).flatMap((message) => message.tiles);
      s.answer({ type: 'tile', id, key: asked[0].key, failed: true });
      expect(vi.getTimerCount()).toBe(1);
      s.scene.dispose();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('asks again for the shadows\' grids too', () => {
      vi.useFakeTimers();
      const s = setUp();
      s.scene.place(EYE, FAR);
      const id = landed(s);
      s.scene.draw(CAMERA, { shaded: true });
      expect(s.sent('grids')).toHaveLength(1);
      s.answer({ type: 'grids', id, failed: true });
      vi.advanceTimersByTime(TRY_AGAIN_MS[0]);
      s.scene.draw(CAMERA, { shaded: true });
      expect(s.sent('grids')).toHaveLength(2);
    });
  });

  it('says when the graphics card dropped the view, and lands again once it is given back', () => {
    const listeners = {};
    const canvas = { addEventListener: (name, listener) => (listeners[name] = listener), removeEventListener: vi.fn() };
    const worker = fakeWorker();
    const onChange = vi.fn();
    const scene = createScene(canvas, { onChange, makeWorker: () => worker, makeRenderer: () => fakeRenderer() });
    scene.place(EYE, FAR);
    onChange.mockClear();
    const event = { preventDefault: vi.fn() };
    listeners.webglcontextlost(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(scene.lost).toBe(true);
    expect(onChange).toHaveBeenCalled();
    listeners.webglcontextrestored();
    expect(scene.lost).toBe(false);
  });

  it('lets everything go when the view closes', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    s.scene.dispose();
    expect(s.workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(s.renderer.dispose).toHaveBeenCalled();
  });
});

/** Every tile the ground all round asks for, answered: the base is in. */
function groundIn(s, id) {
  for (let round = 0; round < 80; round += 1) {
    s.scene.draw(CAMERA);
    let asked = 0;
    for (const worker of s.workers) {
      for (const ask of worker.sent.filter((message) => message.type === 'tiles' && !message.answered)) {
        ask.answered = true;
        for (const t of ask.tiles) {
          asked += 1;
          s.answer({ type: 'tile', id, key: t.key, data: new Float32Array(8), size: 4, low: 0, high: 10 }, worker);
        }
      }
    }
    if (!asked && s.scene.draw(CAMERA).phase !== 'landing') return;
  }
}

describe('the buildings round the eye', () => {
  const tile = (key, version = 'v1') => {
    const [, x, y] = key.split('/').map(Number);
    return { key, x, y, bytes: new ArrayBuffer(8), version };
  };
  const built = (s, message, extra = {}) =>
    s.answer({
      type: 'building-chunk', id: message.id, key: message.chunks[0].key, version: message.chunks[0].version,
      x: 0, y: 0, vertices: new Float32Array(9), indices: new Uint32Array(3), cells: new Uint16Array(1),
      cellStart: new Uint32Array(2), roofs: new Float32Array([4, 50, -5, -5, 5, -5, 5, 5, -5, 5]), count: 1, ...extra,
    });

  it('waits for the ground all round before building any, then builds each tile once in its frame', () => {
    const s = setUp();
    s.scene.setBuildings([tile('14/1/2')]);
    expect(s.sent('buildings')).toEqual([]);
    s.scene.place(EYE, FAR);
    const id = landed(s);
    // the relief comes first
    expect(s.sent('buildings')).toEqual([]);
    groundIn(s, id);
    const [message] = s.sent('buildings');
    expect(message).toMatchObject({ id, unknown: 'draw', chunks: [{ key: '14/1/2', x: 1, y: 2, version: 'v1' }] });
    // the same tile at the same version is not built twice
    s.scene.setBuildings([tile('14/1/2')]);
    expect(s.sent('buildings')).toHaveLength(1);
    built(s, message);
    expect(s.renderer.addBuildingChunk).toHaveBeenCalledWith('14/1/2', expect.objectContaining({ count: 1 }));
  });

  it('builds a tile again when it changes, and lets go of one no longer asked for', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    groundIn(s, landed(s));
    s.scene.setBuildings([tile('14/1/2'), tile('14/1/3')]);
    s.scene.setBuildings([tile('14/1/2', 'v2')]);
    expect(s.sent('buildings').at(-1).chunks.map((c) => [c.key, c.version])).toEqual([['14/1/2', 'v2']]);
    expect(s.renderer.dropBuildingChunk).toHaveBeenCalledWith('14/1/3');
  });

  it('draws no tile built for a version since replaced', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    groundIn(s, landed(s));
    s.scene.setBuildings([tile('14/1/2')]);
    const stale = s.sent('buildings').at(-1);
    s.scene.setBuildings([tile('14/1/2', 'v2')]);
    built(s, stale);
    expect(s.renderer.addBuildingChunk).not.toHaveBeenCalled();
  });

  it('hides the buildings without letting them go, and shown again builds only what changed', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    groundIn(s, landed(s));
    s.scene.setBuildings([tile('14/1/2'), tile('14/1/3')]);
    built(s, s.sent('buildings').at(-1));
    s.scene.setBuildingsShown(false);
    expect(s.renderer.dropBuildingChunk).not.toHaveBeenCalled();
    expect(s.renderer.clearBuildingChunks).toHaveBeenCalledTimes(1); // the landing's only
    // a tile that changes while hidden is not built until they show
    s.scene.setBuildings([tile('14/1/2'), tile('14/1/3', 'v2')]);
    const asked = s.sent('buildings').length;
    s.scene.setBuildingsShown(true);
    expect(s.sent('buildings')).toHaveLength(asked + 1);
    expect(s.sent('buildings').at(-1).chunks.map((c) => [c.key, c.version])).toEqual([['14/1/3', 'v2']]);
  });

  it('builds every tile again when unknown heights are drawn differently', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    groundIn(s, landed(s));
    s.scene.setBuildings([tile('14/1/2')]);
    s.scene.setBuildingOptions({ unknown: 'hide' });
    expect(s.sent('buildings').at(-1)).toMatchObject({ unknown: 'hide', chunks: [{ key: '14/1/2' }] });
    s.scene.setBuildingOptions({ unknown: 'hide' });
    expect(s.sent('buildings')).toHaveLength(2);
  });

  it('starts over in a new frame when the eye lands somewhere else', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    groundIn(s, landed(s));
    s.scene.setBuildings([tile('14/1/2')]);
    const frame = eyeFrame({ lat: EYE.lat, lon: EYE.lon, alt: 0 });
    const [farLat] = frame.destination(0, WALK_REACH + 100);
    s.scene.place({ ...EYE, lat: farLat }, FAR);
    expect(s.renderer.clearBuildingChunks).toHaveBeenCalled();
    const id = landed(s);
    groundIn(s, id);
    expect(s.sent('buildings').at(-1)).toMatchObject({ id, chunks: [{ key: '14/1/2' }] });
  });

  it('raises the buildings in the shadows\' finest grid, a moment after they come', () => {
    vi.useFakeTimers();
    const s = setUp();
    s.scene.place(EYE, FAR);
    const id = landed(s);
    groundIn(s, id);
    s.scene.draw(CAMERA, { shaded: true });
    s.answer({ type: 'grids', id, grids: GRIDS.map((g) => ({ heights: new Float32Array(g.size * g.size), top: 10 })) });
    expect(s.renderer.setGrids).toHaveBeenLastCalledWith(expect.objectContaining({ top: 15, buildings: 0 }));
    s.scene.setBuildings([tile('14/1/2')]);
    built(s, s.sent('buildings').at(-1));
    vi.advanceTimersByTime(300);
    const raised = s.renderer.setGrids.mock.calls.at(-1)[0];
    expect(raised.top).toBe(55);
    // how far the roofs reach, for the shadows' tops kept round them
    expect(raised.buildings).toBeGreaterThan(0);
    expect(raised.buildings).toBeLessThanOrEqual(raised.list[0].reach);
    const finest = raised.list[0];
    const middle = (finest.size / 2) * finest.size + finest.size / 2;
    expect(finest.heights[middle]).toBe(50);
  });
});


describe('a new eye nearby', () => {
  it('builds the ground again but keeps the pictures it held, asking none of them again', () => {
    const s = setUp();
    s.scene.setImagery({ provider: 'esri', near: null });
    s.scene.place(EYE, FAR);
    const first = landed(s);
    s.scene.draw(CAMERA);
    const ask = s.sent('tiles')[0];
    const t = ask.tiles[0];
    expect(t.provider).toBe('esri');
    s.answer({ type: 'tile', id: first, key: t.key, data: new Float32Array(8), size: 4, low: 0, high: 10, image: 'picture', provider: 'esri' });
    // past the walk's reach: a new landing
    const frame = eyeFrame({ lat: EYE.lat, lon: EYE.lon, alt: 0 });
    const [farLat] = frame.destination(0, WALK_REACH + 100);
    s.scene.place({ ...EYE, lat: farLat }, FAR);
    const second = landed(s);
    s.scene.draw(CAMERA);
    const again = s.sent('tiles').flatMap((m) => m.tiles).filter((x) => x.key === t.key).at(-1);
    expect(again.provider).toBeNull();
    s.answer({ type: 'tile', id: second, key: t.key, data: new Float32Array(8), size: 4, low: 0, high: 10, provider: null });
    expect(s.renderer.adoptTexture).toHaveBeenCalledWith(expect.anything(), 'picture');
    // the tile counts as pictured: no picture is asked for it
    s.scene.draw(CAMERA);
    expect(s.sent('images').flatMap((m) => m.tiles).some((x) => x.key === t.key)).toBe(false);
  });
});
