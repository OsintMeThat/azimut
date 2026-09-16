import { describe, expect, it, vi } from 'vitest';
import { linkCameras } from './cameraLink.js';
import { mapFacade } from './facade.js';

/**
 * A map whose jumps fire move events synchronously, the way the engine's own
 * `jumpTo` does. That synchronicity is what the link's guard relies on.
 */
function fakeMap(frame = { lng: 2, lat: 48, zoom: 15, bearing: 0 }) {
  const listeners = new Map();
  const map = {
    frame: { ...frame },
    jumps: 0,
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    off(name, handler) {
      listeners.get(name)?.delete(handler);
    },
    fire(name) {
      for (const handler of [...(listeners.get(name) ?? [])]) handler({});
    },
    getCenter: () => ({ lng: map.frame.lng, lat: map.frame.lat }),
    getZoom: () => map.frame.zoom,
    getBearing: () => map.frame.bearing,
    jumpTo({ center, zoom, bearing }) {
      map.jumps += 1;
      map.frame = { lng: center[0], lat: center[1], zoom, bearing };
      map.fire('move');
      map.fire('moveend');
    },
    /** What a gesture does: move the camera, then report it. */
    gesture(next, { end = false } = {}) {
      map.frame = { ...map.frame, ...next };
      map.fire('move');
      if (end) map.fire('moveend');
    },
  };
  return map;
}

function pair() {
  const leftMap = fakeMap();
  const rightMap = fakeMap({ lng: 30, lat: 10, zoom: 4, bearing: 0 });
  return { leftMap, rightMap, left: mapFacade(leftMap), right: mapFacade(rightMap) };
}

describe('linked map cameras', () => {
  it('copies a live gesture frame by frame, fractional zoom and bearing included', () => {
    const { leftMap, rightMap, left, right } = pair();
    linkCameras([left, right]);
    leftMap.gesture({ lng: 2.5, lat: 48.2, zoom: 15.37, bearing: -12 });
    expect(rightMap.frame).toEqual({ lng: 2.5, lat: 48.2, zoom: 15.37, bearing: -12 });
  });

  it('never sends a copied frame back to the map that led it', () => {
    const { leftMap, rightMap, left, right } = pair();
    linkCameras([left, right]);
    leftMap.gesture({ zoom: 15.5 }, { end: true });
    // one jump per leader event (move, moveend) and none coming back
    expect(rightMap.jumps).toBe(2);
    expect(leftMap.jumps).toBe(0);
  });

  it('reports a settled view on the copy only for the leader’s last frame', () => {
    const { leftMap, right, left } = pair();
    const settled = vi.fn();
    right.on('view-settled', settled);
    linkCameras([left, right]);
    leftMap.gesture({ zoom: 15.4 });
    leftMap.gesture({ zoom: 15.8 });
    expect(settled).not.toHaveBeenCalled();
    leftMap.gesture({ zoom: 16 }, { end: true });
    expect(settled).toHaveBeenCalledOnce();
    expect(settled.mock.calls[0][0].zoom).toBe(17);
  });

  it('marks the copy as following only while the jump runs', () => {
    const { leftMap, rightMap, left, right } = pair();
    const seen = [];
    rightMap.on('move', () => seen.push(right.following()));
    linkCameras([left, right]);
    leftMap.gesture({ zoom: 12 });
    expect(seen).toEqual([true]);
    expect(right.following()).toBe(false);
  });

  it('realigns every map on one of them after a layout change', () => {
    const { rightMap, left, right } = pair();
    const link = linkCameras([left, right]);
    link.align(0);
    expect(rightMap.frame).toEqual({ lng: 2, lat: 48, zoom: 15, bearing: 0 });
  });

  it('stops following once disposed', () => {
    const { leftMap, rightMap, left, right } = pair();
    const link = linkCameras([left, right]);
    link.dispose();
    leftMap.gesture({ zoom: 9 }, { end: true });
    expect(rightMap.jumps).toBe(0);
  });
});
