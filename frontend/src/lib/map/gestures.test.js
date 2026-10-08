// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORBIT_TILT_PER_PX,
  ORBIT_TURN_PER_PX,
  startRectDrag,
  startRotateDrag,
  turnFromKey,
  turnFromPress,
} from './gestures.js';

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

  it('holds inside the guide circle, so a press does not spin the map', () => {
    const engine = stubEngine({ bearing: 40 });
    startRotateDrag(engine, press(1, 240, 220));
    drag(250, 220);
    drag(240, 235); // a big angle about the pivot, but all inside the circle
    expect(engine.bearings).toEqual([]);
  });

  it('turns by the angle swept about the grabbed point, like a wheel', () => {
    const engine = stubEngine({ bearing: 30 });
    startRotateDrag(engine, press(1, 240, 220));
    drag(340, 220); // out of the circle, due east: the wheel is taken here
    expect(engine.bearings).toEqual([]);
    drag(310.71, 290.71); // south-east
    drag(240, 320); // due south: a quarter turn clockwise
    expect(engine.bearings.at(-1)).toBeCloseTo(120, 1);
  });

  it('keeps turning the same way all round the circle, and past a full turn', () => {
    // a whole clockwise circle, in eighths: every step adds, none takes back
    const engine = stubEngine({ bearing: 10 });
    startRotateDrag(engine, press(1, 240, 220));
    const steps = 12;
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / 8) * 2 * Math.PI;
      drag(240 + 100 * Math.cos(a), 220 + 100 * Math.sin(a));
    }
    const swept = engine.bearings.map((b, i) => (i ? b - engine.bearings[i - 1] : 0));
    expect(swept.slice(1).every((d) => d > 0 || d < -300)).toBe(true); // only the 360 → 0 wrap goes down
    expect(engine.bearings.at(-1)).toBeCloseTo((10 + 540) % 360, 6); // a turn and a half
  });

  it('picks the turn up without a jump after passing through the circle', () => {
    const engine = stubEngine({ bearing: 0 });
    startRotateDrag(engine, press(1, 240, 220));
    drag(340, 220);
    drag(240, 320); // +90
    const before = engine.bearings.at(-1);
    drag(245, 225); // back in the middle: holds
    drag(140, 220); // out again, due west: taken as the new start, no jump
    expect(engine.bearings.at(-1)).toBe(before);
    drag(240, 120); // west to north: another quarter clockwise
    expect(engine.bearings.at(-1)).toBeCloseTo(180, 6);
  });

  it('lays the turn on whole steps while Ctrl is held', () => {
    const engine = stubEngine();
    startRotateDrag(engine, press(1, 240, 220));
    drag(340, 220);
    const a = (24 * Math.PI) / 180;
    window.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 240 + 100 * Math.cos(a), clientY: 220 + 100 * Math.sin(a), ctrlKey: true }));
    expect(engine.bearings.at(-1)).toBe(30); // 24° → 30
  });

  it('pans the grabbed location back under where it was grabbed after every turn', () => {
    // the map rotates about its centre, so without this the point drifts away
    const engine = stubEngine();
    startRotateDrag(engine, press(1, 240, 220));
    drag(340, 220);
    drag(240, 320);
    expect(engine.pans).toEqual([[6, -3]]); // what the stub projection displaced
  });

  it('puts north back up on a middle click that never turned', () => {
    const engine = stubEngine({ bearing: 75 });
    startRotateDrag(engine, press(1, 240, 220));
    release();
    expect(engine.bearings).toEqual([0]);
  });

  it('leaves the bearing alone on a Shift click, or once a turn happened', () => {
    const shift = stubEngine({ bearing: 75 });
    startRotateDrag(shift, press(0, 240, 220));
    release();
    expect(shift.bearings).toEqual([]);
    const turned = stubEngine({ bearing: 75 });
    startRotateDrag(turned, press(1, 240, 220));
    drag(340, 220);
    drag(240, 320);
    release();
    expect(turned.bearings.at(-1)).not.toBe(0);
  });

  it('says when the turn is over, and stops listening', () => {
    const onEnd = vi.fn();
    startRotateDrag(stubEngine(), press(0), { onEnd });
    release();
    expect(onEnd).toHaveBeenCalledTimes(1);
    const engine = stubEngine();
    startRotateDrag(engine, press(0, 240, 220), {});
    release();
    drag(600, 600);
    expect(engine.bearings).toEqual([]);
  });
});

describe('which presses turn', () => {
  it('takes the middle button, and Shift with the left one', () => {
    expect(turnFromPress(stubEngine(), press(1))).toBe(true);
    release();
    expect(turnFromPress(stubEngine(), { ...press(0), shiftKey: true })).toBe(true);
    release();
  });

  it('leaves a plain left press, and Shift where the tool keeps it', () => {
    expect(turnFromPress(stubEngine(), press(0))).toBe(false);
    expect(turnFromPress(stubEngine(), { ...press(0), shiftKey: true }, { shift: false })).toBe(false);
    expect(turnFromPress(stubEngine(), { ...press(2), shiftKey: true })).toBe(false);
  });
});

describe('turning from the keyboard', () => {
  const keydown = (key, init = {}) => new window.KeyboardEvent('keydown', { key, shiftKey: true, cancelable: true, ...init });

  it('steps with Shift and the side arrows, and puts north up with Shift and up', () => {
    const engine = stubEngine({ bearing: 0 });
    const event = keydown('ArrowRight');
    expect(turnFromKey(engine, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(engine.bearings).toEqual([15]);
    expect(turnFromKey(stubEngine({ bearing: 200 }), keydown('ArrowUp'))).toBe(true);
  });

  it('leaves a key a control already took, or one typed into a field', () => {
    const engine = stubEngine();
    const taken = keydown('ArrowLeft');
    taken.preventDefault();
    expect(turnFromKey(engine, taken)).toBe(false);
    const input = document.createElement('input');
    document.body.append(input);
    const typed = keydown('ArrowLeft');
    input.dispatchEvent(typed);
    expect(turnFromKey(engine, typed)).toBe(false);
    input.remove();
    expect(turnFromKey(engine, keydown('ArrowLeft', { shiftKey: false }))).toBe(false);
    expect(turnFromKey(null, keydown('ArrowLeft'))).toBe(false);
    expect(engine.bearings).toEqual([]);
  });
});

describe('orbiting over the relief', () => {
  /** A map that keeps a ground point where the projection puts it. */
  function orbitEngine({ sky = false } = {}) {
    const engine = stubEngine({ bearing: 10 });
    engine.pitches = [];
    engine.camera = () => ({ lat: 0, lon: 0, zoom: 12, bearing: 10, pitch: 20 });
    engine.setPitch = (deg) => engine.pitches.push(deg);
    // The ground under a pixel is pixel / 1000 shifted by where the camera is; a
    // tilt moves it by six pixels' worth, which the orbit has to shift back. A shift
    // only lands 80% of the way, as over relief, so it takes several. A press
    // on the sky unprojects somewhere that never projects back.
    let centre = [0, 0];
    engine.shifts = [];
    engine.shiftBy = ({ lat, lon }) => {
      engine.shifts.push({ lat, lon });
      centre = [centre[0] + lat * 0.8, centre[1] + lon * 0.8];
    };
    // a thousand pixels to the degree, as at a street-level zoom
    const drift = () => (engine.pitches.length ? [-0.003, 0.006] : [0, 0]);
    engine.containerPointToLatLng = ({ x, y }) => ({
      lat: y / 1000 + centre[0] - drift()[0],
      lon: x / 1000 + centre[1] - drift()[1],
    });
    engine.latLngToContainerPoint = ({ lat, lon }) => {
      if (sky) return { x: 9999, y: -9999 };
      return { x: (lon - centre[1] + drift()[1]) * 1000, y: (lat - centre[0] + drift()[0]) * 1000 };
    };
    engine.offset = (pinned) => {
      const now = engine.latLngToContainerPoint(pinned);
      return Math.hypot(now.x - 100, now.y - 100);
    };
    return engine;
  }

  it('orbits on the middle button and Shift where the map has relief, turns where it has not', () => {
    const engine = orbitEngine();
    expect(turnFromPress(engine, press(1, 140, 120), { tilt: true })).toBe(true);
    drag(140, 60);
    expect(engine.pitches.at(-1)).toBeCloseTo(20 + 60 * ORBIT_TILT_PER_PX);
    release();
    const flat = orbitEngine();
    turnFromPress(flat, press(1, 140, 120), { tilt: false });
    drag(140, 60);
    expect(flat.pitches).toHaveLength(0);
  });

  it('leans toward the horizon dragging up, and the ground follows a sideways hand', () => {
    const engine = orbitEngine();
    turnFromPress(engine, { ...press(0, 140, 120), shiftKey: true }, { tilt: true });
    drag(180, 100);
    expect(engine.pitches.at(-1)).toBeCloseTo(20 + 20 * ORBIT_TILT_PER_PX);
    expect(engine.bearings.at(-1)).toBeCloseTo(10 - 40 * ORBIT_TURN_PER_PX);
  });

  it('shifts the grabbed ground back under the pointer until it is there, and holds none on the sky', () => {
    const engine = orbitEngine();
    const pinned = engine.containerPointToLatLng({ x: 100, y: 100 });
    // mid-gesture, the screen-to-ground reading is a stale frame: it must not be asked
    const unproject = engine.containerPointToLatLng;
    let asked = 0;
    engine.containerPointToLatLng = (point) => {
      asked += 1;
      return unproject(point);
    };
    turnFromPress(engine, press(1, 140, 120), { tilt: true });
    drag(150, 110);
    // nudged north and east to read how the point moves, then shifted home
    expect(engine.shifts.length).toBeGreaterThan(3);
    expect(engine.offset(pinned)).toBeLessThan(0.5);
    // never a pan in pixels, and the ground under the press read only once, at the press
    expect(engine.pans).toEqual([]);
    expect(asked).toBe(1);
    release();
    const sky = orbitEngine({ sky: true });
    turnFromPress(sky, press(1, 140, 120), { tilt: true });
    drag(150, 110);
    expect(sky.shifts).toEqual([]);
    expect(sky.pitches.length).toBeGreaterThan(0);
  });

  it('puts north back up on a middle click that never moved', () => {
    const engine = orbitEngine();
    turnFromPress(engine, press(1, 140, 120), { tilt: true });
    release();
    expect(engine.bearings).toEqual([0]);
    expect(engine.pitches).toEqual([]);
  });
});
