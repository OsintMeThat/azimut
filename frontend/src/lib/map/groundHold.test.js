import { describe, expect, it, vi } from 'vitest';
import { createGroundHold, HAND, PLACED, reseatKeepingEye } from './groundHold.js';

/** An engine map with relief: who seats the centre, and when. */
function reliefMap({ ground = true } = {}) {
  const listeners = new Map();
  const calls = { clamp: [], recalculated: 0, drawn: 0 };
  const map = {
    calls,
    terrain: { exaggeration: 1 },
    moving: false,
    _camera: {
      elevationFreeze: false,
      transform: {
        centerPoint: { x: 400, y: 300 },
        // whether any of the ground under the middle of the view has arrived
        screenTerrainPointToMercatorCoordinate: () => (ground ? { x: 0.5, y: 0.5, z: 1 } : null),
        recalculateZoomAndCenter: () => (calls.recalculated += 1),
      },
    },
    _update: () => (calls.drawn += 1),
    isMoving: () => map.moving,
    setCenterClampedToGround: (on) => calls.clamp.push(on),
    on: (name, handler) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    off: (name, handler) => listeners.get(name)?.delete(handler),
    fire: (name, event = {}) => [...(listeners.get(name) ?? [])].forEach((handler) => handler(event)),
    listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
  return map;
}

/** A frame that only comes when the test says so. */
function frames() {
  const queue = [];
  return { next: (run) => queue.push(run), run: () => queue.splice(0).forEach((run) => run()) };
}

describe('seating the centre on the ground', () => {
  it('moves the centre and keeps the eye, then draws', () => {
    const map = reliefMap();
    expect(reseatKeepingEye(map)).toBe(true);
    expect(map.calls).toMatchObject({ recalculated: 1, drawn: 1 });
  });

  it('leaves the pivot alone while a gesture holds it, with nothing under it, or with no relief', () => {
    const frozen = reliefMap();
    frozen._camera.elevationFreeze = true;
    expect(reseatKeepingEye(frozen)).toBe(false);
    const sky = reliefMap({ ground: false });
    expect(reseatKeepingEye(sky)).toBe(false);
    const flat = reliefMap();
    flat.terrain = null;
    expect(reseatKeepingEye(flat)).toBe(false);
    expect(reseatKeepingEye({})).toBe(false);
    for (const map of [frozen, sky, flat]) expect(map.calls.recalculated).toBe(0);
  });
});

describe('who put the camera where it is', () => {
  it('lets the eye ride the ground the app sent it to, until that ground is in', () => {
    const map = reliefMap();
    const hold = createGroundHold(map, { relief: 'dem' });
    hold.start();
    expect(map.calls.clamp).toEqual([true]);
    expect(hold.byHand).toBe(false);
    map.fire('idle');
    expect(map.calls.clamp).toEqual([true, false]);
    expect(hold.byHand).toBe(true);
  });

  it('keeps the eye where a hand leaves it, whether the engine’s gesture or one of ours', () => {
    for (const event of [{ originalEvent: {} }, HAND]) {
      const map = reliefMap();
      const hold = createGroundHold(map, { relief: 'dem' });
      hold.start();
      map.fire('movestart', event);
      expect(map.calls.clamp.at(-1)).toBe(false);
      map.fire('moveend');
      expect(map.calls.recalculated).toBe(1);
    }
  });

  it('follows the ground again when the app places the camera, and an unmarked move changes nothing', () => {
    const map = reliefMap();
    const hold = createGroundHold(map, { relief: 'dem' });
    hold.start();
    map.fire('movestart', { originalEvent: {} });
    // the glide after a drag and a wheel notch come without their input event
    map.fire('movestart', {});
    expect(hold.byHand).toBe(true);
    map.fire('movestart', PLACED);
    expect(hold.byHand).toBe(false);
    expect(map.calls.clamp.at(-1)).toBe(true);
    // a turn right after the placement is part of it
    map.fire('movestart', {});
    expect(hold.byHand).toBe(false);
    map.fire('moveend');
    expect(map.calls.recalculated).toBe(0);
  });

  it('seats a view at rest as its relief lands, once a frame, and not while it moves', () => {
    const frame = frames();
    const map = reliefMap();
    const hold = createGroundHold(map, { relief: 'dem', nextFrame: frame.next });
    hold.start();
    map.fire('idle');
    map.fire('sourcedata', { sourceId: 'dem', tile: {} });
    map.fire('sourcedata', { sourceId: 'dem', tile: {} });
    // imagery landing changes no height, and a source event with no tile is not a landing
    map.fire('sourcedata', { sourceId: 'imagery', tile: {} });
    map.fire('sourcedata', { sourceId: 'dem' });
    frame.run();
    expect(map.calls.recalculated).toBe(1);
    map.moving = true;
    map.fire('sourcedata', { sourceId: 'dem', tile: {} });
    frame.run();
    expect(map.calls.recalculated).toBe(1);
  });

  it('leaves the engine’s own seating to it while the app’s placement settles', () => {
    const frame = frames();
    const map = reliefMap();
    const hold = createGroundHold(map, { relief: 'dem', nextFrame: frame.next });
    hold.start();
    map.fire('sourcedata', { sourceId: 'dem', tile: {} });
    frame.run();
    expect(map.calls.recalculated).toBe(0);
  });

  it('does nothing while the relief is off, puts the engine’s seating back, and lets go of the map', () => {
    const map = reliefMap();
    const hold = createGroundHold(map, { relief: 'dem' });
    map.fire('movestart', { originalEvent: {} });
    map.fire('moveend');
    expect(map.calls).toMatchObject({ clamp: [], recalculated: 0 });
    hold.start();
    map.fire('idle');
    hold.stop();
    expect(map.calls.clamp.at(-1)).toBe(true);
    map.fire('moveend');
    expect(map.calls.recalculated).toBe(0);
    hold.dispose();
    expect(map.listening()).toBe(0);
  });

  it('works on an engine with none of the handles', () => {
    const map = { on: vi.fn(), off: vi.fn() };
    const hold = createGroundHold(map);
    expect(() => {
      hold.start();
      hold.stop();
      hold.dispose();
    }).not.toThrow();
  });
});
