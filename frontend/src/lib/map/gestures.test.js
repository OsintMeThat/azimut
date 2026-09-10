// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRectDrag, startRotateDrag } from './gestures.js';

/** The façade, as far as the gestures reach into it. */
function stubEngine({ bearing = 0 } = {}) {
  const container = document.createElement('div');
  // happy-dom gives an unlaid-out element a zero rect; the offset is what the
  // gestures subtract, so state one.
  container.getBoundingClientRect = () => ({ left: 40, top: 20, width: 800, height: 600 });
  return {
    container,
    bearings: [],
    pans: [],
    camera: () => ({ lat: 0, lon: 0, zoom: 12, bearing }),
    containerPointToLatLng: ({ x, y }) => ({ lat: y / 10, lon: x / 10 }),
    latLngToContainerPoint: ({ lat, lon }) => ({ x: lon * 10 + 6, y: lat * 10 - 3 }),
    setBearing(deg) {
      this.bearings.push(deg);
    },
    panBy(dx, dy) {
      this.pans.push([dx, dy]);
    },
  };
}

function press(button = 0, clientX = 100, clientY = 100) {
  return {
    button,
    clientX,
    clientY,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  };
}

function drag(clientX, clientY) {
  window.dispatchEvent(new window.MouseEvent('mousemove', { clientX, clientY }));
}

function release() {
  window.dispatchEvent(new window.MouseEvent('mouseup'));
}

afterEach(release);

describe('pulling a rectangle', () => {
  it('owns the gesture, so the map does not pan under the box', () => {
    const event = press();
    startRectDrag(stubEngine(), event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('measures inside the container, not on the page', () => {
    const seen = [];
    startRectDrag(stubEngine(), press(0, 140, 120), { onChange: (r) => seen.push(r) });
    expect(seen[0]).toEqual({ x0: 100, y0: 100, x1: 100, y1: 100 });
  });

  it('follows the pointer, and hands the last box over on release', () => {
    const seen = [];
    const done = vi.fn();
    startRectDrag(stubEngine(), press(0, 140, 120), {
      onChange: (r) => seen.push(r),
      onDone: done,
    });
    drag(340, 320);
    expect(seen.at(-1)).toEqual({ x0: 100, y0: 100, x1: 300, y1: 300 });
    release();
    expect(done).toHaveBeenCalledWith({ x0: 100, y0: 100, x1: 300, y1: 300 });
  });

  it('locks a ratio off the larger delta, in the direction dragged', () => {
    const seen = [];
    startRectDrag(stubEngine(), press(0, 140, 120), {
      ratio: 16 / 9,
      onChange: (r) => seen.push(r),
    });
    drag(340, 150); // 200 across, 30 down — width leads
    const box = seen.at(-1);
    expect(box.x1 - box.x0).toBe(200);
    expect(box.y1 - box.y0).toBeCloseTo(112.5, 3);

    drag(120, 400); // dragged up and left: the box follows, ratio kept
    const back = seen.at(-1);
    expect(back.x1 - back.x0).toBeCloseTo(-497.78, 1);
    expect(back.y1 - back.y0).toBe(280);
  });

  it('keeps following after the pointer leaves the map', () => {
    // a marquee pulled past the edge still finishes
    const done = vi.fn();
    startRectDrag(stubEngine(), press(0, 140, 120), { onDone: done });
    drag(2000, -500);
    release();
    expect(done).toHaveBeenCalledWith({ x0: 100, y0: 100, x1: 1960, y1: -520 });
  });

  it('stops listening once released', () => {
    const seen = [];
    startRectDrag(stubEngine(), press(), { onChange: (r) => seen.push(r) });
    release();
    const after = seen.length;
    drag(500, 500);
    expect(seen).toHaveLength(after);
  });
});

describe('grabbing a point and turning', () => {
  it('reports the grabbed point in container px, for the target drawn there', () => {
    const onPivot = vi.fn();
    startRotateDrag(stubEngine(), press(1, 240, 220), { onPivot });
    expect(onPivot).toHaveBeenCalledWith({ x: 200, y: 200 });
  });

  it('ignores a nudge, so a click does not spin the map', () => {
    const engine = stubEngine();
    startRotateDrag(engine, press(1, 240, 220));
    drag(244, 224); // ~5.7 px, inside the deadzone
    expect(engine.bearings).toEqual([]);
  });

  it('turns once out of the deadzone, taking that direction as the reference', () => {
    const engine = stubEngine({ bearing: 30 });
    startRotateDrag(engine, press(1, 240, 220));
    drag(340, 220); // leaves the deadzone: this direction is 0 of the sweep
    expect(engine.bearings).toEqual([]);
    drag(240, 320); // a quarter turn from the reference spoke
    expect(engine.bearings).toHaveLength(1);
    expect(engine.bearings[0] - 30).toBeCloseTo(90, 6);
  });

  it('pans the grabbed location back under the cursor after every turn', () => {
    // the map rotates about its centre, so without this the point drifts away
    const engine = stubEngine();
    startRotateDrag(engine, press(1, 240, 220));
    drag(340, 220);
    drag(240, 320);
    expect(engine.pans).toEqual([[6, -3]]); // what the stub projection displaced
  });

  it('says when the turn is over', () => {
    const onEnd = vi.fn();
    startRotateDrag(stubEngine(), press(1), { onEnd });
    release();
    expect(onEnd).toHaveBeenCalledTimes(1);
    const engine = stubEngine();
    startRotateDrag(engine, press(1, 240, 220), {});
    release();
    drag(600, 600);
    expect(engine.bearings).toEqual([]);
  });
});
