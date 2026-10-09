// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReliefWheel,
  FAR_PAN,
  flingOf,
  GLIDE_GRACE,
  GLIDE_REACH,
  metresPerPixel,
  ORBIT_TILT_PER_PX,
  ORBIT_TURN_PER_PX,
  panSpeedCap,
  startGroundPan,
  startRectDrag,
  startRotateDrag,
  turnFromKey,
  turnFromPress,
  viewReach,
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
  function orbitEngine({ sky = false, swing = [-0.003, 0.006] } = {}) {
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
    const drift = () => (engine.pitches.length ? swing : [0, 0]);
    engine.containerPointToLatLng = ({ x, y }) => ({
      lat: y / 1000 + centre[0] - drift()[0],
      lon: x / 1000 + centre[1] - drift()[1],
    });
    const drawn = ({ lat, lon }, at) => {
      if (sky) return { x: 9999, y: -9999 };
      return { x: (lon - at[1] + drift()[1]) * 1000, y: (lat - at[0] + drift()[0]) * 1000 };
    };
    engine.latLngToContainerPoint = (point) => drawn(point, centre);
    // the same projection off a copy of the camera, which the shift moves as a real one would
    engine.probes = 0;
    engine.pointAfterShift = (point, { lat, lon }) => {
      engine.probes += 1;
      return drawn(point, [centre[0] + lat * 0.8, centre[1] + lon * 0.8]);
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
    // a copy of the camera nudged north and east to read how the point moves,
    // and the real one shifted home once: every jump is a frame's worth of work
    expect(engine.probes).toBeGreaterThan(2);
    expect(engine.shifts).toHaveLength(1);
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

  it('never moves the camera further than the orbit’s own arc to hold the pivot', () => {
    // a view grazing the ground: a hair of turn swings the pivot by degrees on screen
    const engine = orbitEngine({ swing: [-3, 6] });
    turnFromPress(engine, press(1, 140, 120), { tilt: true });
    drag(140, 116);
    const moved = engine.shifts.reduce((sum, s) => sum + Math.hypot(s.lat, s.lon), 0);
    // a degree of turn about ground ~40 km off is ~1.4 km of arc; the nudges that
    // measure the slope add a few metres each
    expect(moved).toBeGreaterThan(0);
    expect(moved * 111320).toBeLessThan(5000);
  });
});

describe('dragging the ground over the relief', () => {
  /**
   * A tilted view, as far as a drag can tell: across, a pixel is a thousandth
   * of a degree; down the screen the ground runs off toward a horizon at the
   * top, where a pixel is ever more ground (3 / y degrees from the centre).
   */
  function tiltedEngine({ sky = false, horizon = 0, misread = 0 } = {}) {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 40, top: 20, width: 800, height: 600 });
    let centre = { lat: 0, lon: 0 };
    // above `horizon` px the screen is sky: what it reads there never projects back
    const drawn = ({ lat, lon }, at) =>
      sky || (horizon && 3 / (lat - at.lat) < horizon)
        ? { x: 9999, y: -9999 }
        : { x: (lon - at.lon) * 1000, y: 3 / (lat - at.lat) + misread };
    const engine = {
      container,
      shifts: [],
      released: 0,
      focus: vi.fn(),
      camera: () => ({ ...centre, zoom: 12, bearing: 0, pitch: 60 }),
      holdElevation: vi.fn(() => () => (engine.released += 1)),
      shiftBy({ lat, lon }) {
        engine.shifts.push({ lat, lon });
        centre = { lat: centre.lat + lat, lon: centre.lon + lon };
      },
      containerPointToLatLng: ({ x, y }) => ({ lat: centre.lat + 3 / y, lon: centre.lon + x / 1000 }),
      latLngToContainerPoint: (point) => drawn(point, centre),
      pointAfterShift: (point, { lat, lon }) => drawn(point, { lat: centre.lat + lat, lon: centre.lon + lon }),
      offset(pinned, at) {
        const now = engine.latLngToContainerPoint(pinned);
        return Math.hypot(now.x - at.x, now.y - at.y);
      },
      moved: () => engine.shifts.reduce((sum, s) => ({ lat: sum.lat + s.lat, lon: sum.lon + s.lon }), { lat: 0, lon: 0 }),
    };
    return engine;
  }

  /** client px for a container point */
  const client = ({ x, y }) => ({ clientX: x + 40, clientY: y + 20 });
  const pressAt = (point) => ({ ...press(0, client(point).clientX, client(point).clientY), target: {} });
  function dragTo(point) {
    drag(client(point).clientX, client(point).clientY);
  }

  it('keeps the grabbed ground under the hand, near ground and across', () => {
    const engine = tiltedEngine();
    const grabbed = { x: 100, y: 500 };
    const pinned = engine.containerPointToLatLng(grabbed);
    let now = 0;
    expect(startGroundPan(engine, pressAt(grabbed), { now: () => now })).toBe(true);
    for (let y = 495; y >= 430; y -= 5) dragTo({ x: 100 + (500 - y), y });
    expect(engine.offset(pinned, { x: 170, y: 430 })).toBeLessThan(0.5);
    // the centre's height is held through the drag, and let go at the end
    expect(engine.holdElevation).toHaveBeenCalledTimes(1);
    // the hand rests before letting go: no glide
    now = 1000;
    release();
    expect(engine.released).toBe(1);
  });

  it('orbits about the ground just below a press that reads back wrong, and about the centre over the sky', () => {
    const near = tiltedEngine({ horizon: 100 });
    near.setPitch = vi.fn();
    near.setBearing = vi.fn();
    const pivots = [];
    turnFromPress(near, { ...press(1, 140, 116), target: {} }, { tilt: true, onPivot: (p) => pivots.push(p) });
    // pressed 4 px above the horizon: the ground 2 px below the horizon is held, and marked
    expect(pivots[0]).toEqual({ x: 100, y: 102 });
    release();
    const sky = tiltedEngine({ horizon: 100 });
    sky.setPitch = vi.fn();
    sky.setBearing = vi.fn();
    turnFromPress(sky, { ...press(1, 140, 40), target: {} }, { tilt: true, onPivot: (p) => pivots.push(p) });
    expect(pivots[1]).toEqual({ x: 100, y: 20 });
    drag(150, 30);
    expect(sky.shifts).toEqual([]);
    expect(sky.setPitch).toHaveBeenCalled();
  });

  it('lets far ground slip rather than throw the view kilometres a pixel', () => {
    const engine = tiltedEngine();
    const grabbed = { x: 100, y: 20 };
    const pinned = engine.containerPointToLatLng(grabbed);
    startGroundPan(engine, pressAt(grabbed));
    dragTo({ x: 100, y: 25 });
    dragTo({ x: 100, y: 30 });
    // holding it would take 0.05° (3/20 - 3/30); a hand's 10 px may move this much
    const budget = 10 * panSpeedCap(engine.camera());
    expect(Math.abs(engine.moved().lat)).toBeLessThanOrEqual(budget * 1.0001);
    expect(Math.abs(engine.moved().lat)).toBeGreaterThan(budget * 0.5);
    expect(engine.offset(pinned, { x: 100, y: 30 })).toBeGreaterThan(1);
  });

  it('leaves a press that never moved to the map’s own click', () => {
    const engine = tiltedEngine();
    const onEnd = vi.fn();
    const event = pressAt({ x: 100, y: 500 });
    startGroundPan(engine, event, { onEnd });
    dragTo({ x: 101, y: 501 });
    release();
    expect(engine.holdElevation).not.toHaveBeenCalled();
    expect(engine.shifts).toEqual([]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    // the press is not stopped: the engine still tells a click from a drag
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(engine.focus).toHaveBeenCalled();
  });

  it('holds the ground just under a press on the sky, at its distance from the hand', () => {
    const engine = tiltedEngine({ horizon: 100 });
    const press = { x: 100, y: 50 };
    // the first ground that reads back true, a few 6 px steps down the screen
    const pinned = engine.containerPointToLatLng({ x: 100, y: 104 });
    expect(startGroundPan(engine, pressAt(press))).toBe(true);
    dragTo({ x: 100, y: 53 });
    dragTo({ x: 100, y: 60 });
    expect(engine.shifts.length).toBeGreaterThan(0);
    // it keeps its 54 px below the hand, so nothing jumps when the drag starts
    expect(engine.offset(pinned, { x: 100, y: 60 + 54 })).toBeLessThan(0.5);
  });

  it('holds what the press reads before the relief under it has arrived, where it is drawn', () => {
    // every reading comes back 10 px off, as it does over ground not loaded yet
    const engine = tiltedEngine({ misread: 10 });
    const press = { x: 100, y: 500 };
    const pinned = engine.containerPointToLatLng(press);
    expect(startGroundPan(engine, pressAt(press))).toBe(true);
    dragTo({ x: 120, y: 480 });
    expect(engine.shifts.length).toBeGreaterThan(0);
    expect(engine.offset(pinned, { x: 120, y: 490 })).toBeLessThan(0.5);
  });

  it('starts nothing on the sky', () => {
    const engine = tiltedEngine({ sky: true });
    const event = pressAt({ x: 100, y: 500 });
    expect(startGroundPan(engine, event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    dragTo({ x: 100, y: 400 });
    expect(engine.shifts).toEqual([]);
  });

  it('lets far ground move faster the more the view is tilted, never slower than flat', () => {
    const flat = panSpeedCap({ lat: 0, zoom: 12, pitch: 0 });
    expect(flat * 111320).toBeCloseTo(metresPerPixel({ lat: 0, zoom: 12 }) * FAR_PAN);
    expect(panSpeedCap({ lat: 0, zoom: 12, pitch: 60 })).toBe(flat);
    expect(panSpeedCap({ lat: 0, zoom: 12, pitch: 85 })).toBeGreaterThan(3 * flat);
  });

  describe('letting go while the hand still moves', () => {
    const trail = [
      { t: 0, lat: 0, lon: 0 },
      { t: 50, lat: 0.001, lon: 0 },
    ];

    it('glides on at the ground’s own speed', () => {
      const fling = flingOf(trail, 60, 1e6);
      expect(fling.lat).toBeCloseTo((0.001 / 50) * 280);
      expect(fling.lon).toBe(0);
    });

    it('never further than a share of what the view spans', () => {
      const reach = 1000;
      const fling = flingOf(trail, 60, reach);
      expect(fling.lat * 111320).toBeCloseTo(reach * GLIDE_REACH, 0);
    });

    it('not at all when the hand had stopped first', () => {
      expect(flingOf(trail, 50 + GLIDE_GRACE + 1, 1e6)).toBeNull();
      expect(flingOf(trail.slice(0, 1), 10, 1e6)).toBeNull();
    });

    it('measures the view it caps against on the ground', () => {
      expect(viewReach({ lat: 0, zoom: 12 }, 800, 600)).toBeCloseTo(metresPerPixel({ lat: 0, zoom: 12 }) * 500);
    });

    function flung() {
      let now = 0;
      const queue = [];
      const engine = tiltedEngine();
      const grabbed = { x: 100, y: 500 };
      startGroundPan(engine, pressAt(grabbed), {
        now: () => now,
        nextFrame: (run) => queue.push(run),
      });
      for (let i = 1; i <= 5; i += 1) {
        now = i * 16;
        dragTo({ x: 100 + 10 * i, y: 500 });
      }
      const dragged = engine.moved();
      release();
      const frame = (ms) => {
        now += ms;
        queue.splice(0).forEach((run) => run());
      };
      return { engine, dragged, frame };
    }

    it('glides frame by frame after the release, and lets the height go at the end', () => {
      const { engine, dragged, frame } = flung();
      expect(engine.released).toBe(0);
      for (let i = 0; i < 40; i += 1) frame(16);
      const glided = engine.moved().lon - dragged.lon;
      // the hand moved the ground east at its own pace; the glide carries on that way
      expect(Math.sign(glided)).toBe(Math.sign(dragged.lon));
      expect(Math.abs(glided)).toBeGreaterThan(0);
      expect(engine.released).toBe(1);
    });

    it('stops at the next press, wheel or key', () => {
      const { engine, frame } = flung();
      frame(16);
      const before = engine.shifts.length;
      window.dispatchEvent(new window.MouseEvent('mousedown'));
      frame(16);
      frame(16);
      expect(engine.shifts.length).toBe(before);
      expect(engine.released).toBe(1);
    });
  });
});

describe('the wheel over the relief', () => {
  /** The tilted view of the drag tests, its ground scaled by the zoom. */
  function zoomingEngine({ ceiling = 20, sky = false } = {}) {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 40, top: 20, width: 800, height: 600 });
    let centre = { lat: 0, lon: 0 };
    let zoom = 12;
    const scale = () => 2 ** (zoom - 12);
    const engine = {
      container,
      released: 0,
      zooms: [],
      camera: () => ({ ...centre, zoom: Math.round(zoom), bearing: 0, pitch: 60 }),
      exactZoom: () => zoom,
      maxZoom: () => ceiling,
      setZoom(next) {
        engine.zooms.push(next);
        zoom = Math.min(ceiling, next);
      },
      // the eye straight toward the point: it scales the view about that point
      dollyToward(point, levels) {
        engine.dollies.push(levels);
        zoom += levels;
        const k = 2 ** -levels;
        centre = { lat: point.lat - (point.lat - centre.lat) * k, lon: point.lon - (point.lon - centre.lon) * k };
        return true;
      },
      dollies: [],
      holdElevation: vi.fn(() => () => (engine.released += 1)),
      shiftBy({ lat, lon }) {
        centre = { lat: centre.lat + lat, lon: centre.lon + lon };
      },
      containerPointToLatLng: ({ x, y }) => ({ lat: centre.lat + 3 / y / scale(), lon: centre.lon + x / 1000 / scale() }),
      latLngToContainerPoint: ({ lat, lon }) =>
        sky
          ? { x: 9999, y: -9999 }
          : { x: (lon - centre.lon) * 1000 * scale(), y: 3 / ((lat - centre.lat) * scale()) },
    };
    return engine;
  }

  function frames() {
    const queue = [];
    return {
      next: (run) => queue.push(run),
      runAll() {
        for (let i = 0; i < 200 && queue.length; i += 1) queue.splice(0).forEach((run) => run());
      },
    };
  }

  const notch = (x, y, deltaY = -100) => ({
    deltaY,
    deltaMode: 0,
    clientX: x + 40,
    clientY: y + 20,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });

  it('zooms a level a notch, toward the ground under the pointer, which stays there', () => {
    const engine = zoomingEngine();
    const frame = frames();
    const wheel = createReliefWheel(engine, { nextFrame: frame.next });
    const pointer = { x: 300, y: 450 };
    const pinned = engine.containerPointToLatLng(pointer);
    const event = notch(pointer.x, pointer.y);
    wheel.wheel(event);
    expect(event.preventDefault).toHaveBeenCalled();
    frame.runAll();
    expect(engine.exactZoom()).toBeCloseTo(13, 3);
    // the eye moved toward the point, eased in over several frames, not in one jump
    expect(engine.dollies.length).toBeGreaterThan(3);
    expect(engine.zooms).toEqual([]);
    const now = engine.latLngToContainerPoint(pinned);
    expect(Math.hypot(now.x - pointer.x, now.y - pointer.y)).toBeLessThan(1);
    expect(engine.holdElevation).toHaveBeenCalledTimes(1);
    expect(engine.released).toBe(1);
  });

  it('adds notches that come while it eases, and stops at the map’s ceiling', () => {
    const engine = zoomingEngine({ ceiling: 13.5 });
    const frame = frames();
    const wheel = createReliefWheel(engine, { nextFrame: frame.next });
    wheel.wheel(notch(300, 450));
    wheel.wheel(notch(300, 450));
    wheel.wheel(notch(300, 450));
    frame.runAll();
    expect(engine.exactZoom()).toBeCloseTo(13.5, 2);
    expect(engine.exactZoom()).toBeLessThanOrEqual(13.5);
    expect(engine.holdElevation).toHaveBeenCalledTimes(1);
    expect(engine.released).toBe(1);
  });

  it('stops easing at the next press', () => {
    const engine = zoomingEngine();
    const frame = frames();
    const wheel = createReliefWheel(engine, { nextFrame: frame.next });
    wheel.wheel(notch(300, 450, 100));
    window.dispatchEvent(new window.MouseEvent('mousedown'));
    frame.runAll();
    expect(engine.exactZoom()).toBe(12);
    expect(engine.released).toBe(1);
  });

  it('zooms about the middle of the view over the sky, with no ground to aim at', () => {
    const engine = zoomingEngine({ sky: true });
    const frame = frames();
    createReliefWheel(engine, { nextFrame: frame.next }).wheel(notch(300, 450, 100));
    frame.runAll();
    expect(engine.dollies).toEqual([]);
    expect(engine.exactZoom()).toBeCloseTo(11, 3);
  });

  it('leaves a wheel that does not zoom to the page', () => {
    const engine = zoomingEngine();
    const wheel = createReliefWheel(engine, { nextFrame: () => {} });
    const sideways = { ...notch(300, 450), deltaY: 0 };
    wheel.wheel(sideways);
    expect(sideways.preventDefault).not.toHaveBeenCalled();
    expect(engine.holdElevation).not.toHaveBeenCalled();
  });
});
