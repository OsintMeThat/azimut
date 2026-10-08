import { afterEach, describe, expect, it, vi } from 'vitest';
import { eyeFrame } from './geo.js';
import { createScene, GRIDS, progressOf, WALK_REACH, workerCount } from './scene.js';

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
    dropTile: vi.fn(),
    setGrids: vi.fn(),
    setPhoto: vi.fn(),
    draw: vi.fn(),
    pick: vi.fn(() => 1000),
    pickSoon: vi.fn(async () => 1000),
    dispose: vi.fn(),
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
    s.scene.place({ ...EYE, lat: farLat }, 300000);
    expect(s.sent('eye')).toHaveLength(3 * s.workers.length);
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

  it('lets everything go when the view closes', () => {
    const s = setUp();
    s.scene.place(EYE, FAR);
    s.scene.dispose();
    expect(s.workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(s.renderer.dispose).toHaveBeenCalled();
  });
});
