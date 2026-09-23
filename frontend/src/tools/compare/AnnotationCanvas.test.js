// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: Canvas } = await import('./AnnotationCanvas.svelte');
const { markRing } = await import('../../lib/map/compareAnnotations.js');
const { fromMercator, toMercator } = await import('../../lib/map/groundFrame.js');

globalThis.ResizeObserver = class { observe() {} disconnect() {} };

let live, target, handlers, origin;

/** Ten pixels to the degree, shifted by wherever the camera has been panned. */
function fakeEngine() {
  handlers = {};
  origin = { x: 0, y: 0 };
  return {
    on: (name, handler) => { handlers[name] = handler; return () => delete handlers[name]; },
    latLngToContainerPoint: ({ lon, lat }) => ({ x: lon * 10 - origin.x, y: lat * 10 - origin.y }),
    containerPointToLatLng: ({ x, y }) => ({ lon: (x + origin.x) / 10, lat: (y + origin.y) / 10 }),
  };
}

const area = () => ({ id: 'z1', kind: 'rect', side: 'both', colour: '#38bdf8',
  points: [[1, 1], [3, 3]], stroke_width: 2, fill_opacity: 0.08, font_size: 12, text: 'Area 1' });

/**
 * A camera at one pixel to the metre, turned by the app's bearing: the map's
 * clockwise turn, so the compass direction up is its negative. Its matrix is
 * its own inverse, so the same one maps both ways.
 */
function turningEngine(bearing = 0) {
  handlers = {};
  const engine = { bearing };
  const turn = (a, b) => {
    const t = (-engine.bearing * Math.PI) / 180;
    return [a * Math.cos(t) - b * Math.sin(t), -a * Math.sin(t) - b * Math.cos(t)];
  };
  Object.assign(engine, {
    on: (name, handler) => { handlers[name] = handler; return () => delete handlers[name]; },
    latLngToContainerPoint: ({ lon, lat }) => {
      const [x, y] = turn(...toMercator(lon, lat));
      return { x: 200 + x, y: 150 + y };
    },
    containerPointToLatLng: ({ x, y }) => {
      const [lon, lat] = fromMercator(...turn(x - 200, y - 150));
      return { lon, lat };
    },
  });
  return engine;
}

function press(node, type, x, y, init = {}) {
  node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, ...init }));
  flushSync();
}

/** A mark's ring as the screen shows it, rounded to a hundredth of a pixel. */
const onScreen = (engine, mark) => markRing(mark).map((point) => {
  const at = engine.latLngToContainerPoint({ lon: point[0], lat: point[1] });
  return [Math.round(at.x * 100) / 100, Math.round(at.y * 100) / 100];
});

function stage(props) {
  live = mount(Canvas, { target, props: { engine: fakeEngine(), ...props } });
  flushSync();
  const svg = target.querySelector('svg');
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  return svg;
}

beforeEach(() => { target = document.createElement('div'); document.body.append(target); });
afterEach(() => { if (live) unmount(live); target.remove(); });

it('keeps the corner handles on their ground when the camera moves', () => {
  stage({ annotations: [area()], editVertices: true, selectedId: 'z1', tool: 'select' });
  const handle = () => target.querySelectorAll('.vertex rect:last-child')[0];
  expect(handle().getAttribute('x')).toBe('5');       // 1° → 10px, less half the handle

  origin.x = 40;
  handlers['view-move']();
  flushSync();
  expect(handle().getAttribute('x')).toBe('-35');     // panned with the imagery, not left behind
});

it('treats a press that does not travel as a selection, never as a move', () => {
  const onchange = vi.fn();
  const svg = stage({ annotations: [area()], editVertices: true, tool: 'select', onchange });
  const edge = target.querySelector('.edge');

  press(edge, 'pointerdown', 20, 20);
  press(svg, 'pointermove', 22, 21);
  press(svg, 'pointerup', 22, 21);
  expect(onchange).not.toHaveBeenCalled();

  press(edge, 'pointerdown', 20, 20);
  press(svg, 'pointermove', 60, 20);
  press(svg, 'pointerup', 60, 20);
  const dragged = onchange.mock.calls.filter(([, commit]) => !commit).at(-1)[0];
  expect(dragged[0].points[0][0]).toBeCloseTo(5);     // four degrees east, and only east
  expect(dragged[0].points[0][1]).toBeCloseTo(1);
  expect(onchange.mock.calls.at(-1)[1]).toBe(true);   // one entry to undo, at the end
});

it('gives every mark an edge to grab, and an area nothing else', () => {
  stage({ annotations: [area()], tool: 'select' });
  expect(target.querySelectorAll('.edge')).toHaveLength(1);
  expect(target.querySelector('.mark').classList.contains('area')).toBe(false);
  unmount(live);

  // Only a Detect area gives its middle back to the map; an annotation stays
  // grabbable anywhere it is painted.
  stage({ annotations: [area()], edgeOnly: true, tool: 'select' });
  expect(target.querySelector('.mark').classList.contains('area')).toBe(true);
});

it('hands the selected mark its handles, and leaves a note without any', () => {
  stage({ annotations: [area()], editVertices: true, selectedId: 'z1', tool: 'select' });
  expect(target.querySelectorAll('.vertex')).toHaveLength(2);
  unmount(live);

  const note = { ...area(), kind: 'text', points: [[1, 1]], text: 'Here' };
  stage({ annotations: [note], editVertices: true, selectedId: 'z1', tool: 'select' });
  expect(target.querySelectorAll('.vertex')).toHaveLength(0);
});

it('lets a mark go when the ground beside it is clicked, but not when the map is panned', () => {
  const map = document.createElement('div');
  map.className = 'map-wrap';
  document.body.append(map);
  stage({ annotations: [area()], editVertices: true, selectedId: 'z1', tool: 'select' });
  const selected = () => target.querySelector('.mark').classList.contains('selected');
  expect(selected()).toBe(true);

  press(map, 'pointerdown', 300, 200);
  press(map, 'pointerup', 380, 240);
  expect(selected()).toBe(true);              // a drag is a pan, and keeps the pick

  press(map, 'pointerdown', 300, 200);
  press(map, 'pointerup', 301, 200);
  expect(selected()).toBe(false);
  map.remove();
});

it('anchors a measure on a point handed to it, and closes it on the next click', () => {
  const onchange = vi.fn();
  const svg = stage({ annotations: [], editVertices: true, tool: 'measure', onchange });
  live.startFrom([1, 1]);
  flushSync();

  // Armed, not held: the release of whatever press was in flight keeps it open.
  press(svg, 'pointerup', 10, 10);
  expect(onchange).not.toHaveBeenCalled();

  press(svg, 'pointermove', 60, 10);
  press(svg, 'pointerdown', 60, 10);
  const [saved, commit] = onchange.mock.calls.at(-1);
  expect(commit).toBe(true);
  expect(saved[0].kind).toBe('measure');
  expect(saved[0].points[0]).toEqual([1, 1]);
  expect(saved[0].points[1][0]).toBeCloseTo(6);
});

it('draws a box along a turned camera, not along north', () => {
  const onchange = vi.fn();
  const engine = turningEngine(30);
  const svg = stage({ engine, annotations: [], tool: 'rect', bearing: 30, turnable: true, onchange });
  press(svg, 'pointerdown', 100, 80);
  press(svg, 'pointermove', 300, 200);
  press(svg, 'pointerup', 300, 200);
  const [box] = onchange.mock.calls.at(-1)[0];
  // The map turned 30° clockwise puts compass 330° up.
  expect(box.angle).toBe(330);
  expect(onScreen(engine, box)).toEqual([[100, 80], [300, 80], [300, 200], [100, 200]]);
});

it('keeps a Detect area north-up, since its zones are north-up boxes', () => {
  const onchange = vi.fn();
  const svg = stage({ engine: turningEngine(30), annotations: [], tool: 'rect', bearing: 30, onchange });
  press(svg, 'pointerdown', 100, 80);
  press(svg, 'pointermove', 300, 200);
  press(svg, 'pointerup', 300, 200);
  expect(onchange.mock.calls.at(-1)[0][0].angle).toBe(0);
});

describe('turning a mark', () => {
  const box = (engine) => {
    const [first, second] = [{ x: 100, y: 100 }, { x: 300, y: 200 }]
      .map((at) => engine.containerPointToLatLng(at)).map(({ lon, lat }) => [lon, lat]);
    return { ...area(), points: [first, second], angle: 0 };
  };
  const grip = () => target.querySelector('.turn circle:last-of-type');
  // The marks as the drag last left them; the release commits the parent's copy.
  const lastDrag = (onchange) => onchange.mock.calls.filter(([, commit]) => !commit).at(-1)[0];

  it('stands a grip past the top of the selected mark, only where turning is on', () => {
    const engine = turningEngine();
    stage({ engine, annotations: [box(engine)], editVertices: true, selectedId: 'z1', tool: 'select', turnable: true });
    expect(Number(grip().getAttribute('cx'))).toBeCloseTo(200, 4);
    expect(Number(grip().getAttribute('cy'))).toBeCloseTo(100 - 26, 4);
    unmount(live);

    stage({ engine, annotations: [box(engine)], editVertices: true, selectedId: 'z1', tool: 'select' });
    expect(target.querySelector('.turn')).toBeNull();
    unmount(live);

    const note = { ...area(), kind: 'text', points: [[1, 1]], text: 'Here' };
    stage({ annotations: [note], editVertices: true, selectedId: 'z1', tool: 'select', turnable: true });
    expect(target.querySelector('.turn')).toBeNull();
  });

  it('turns a box about its centre as the grip is dragged round it', () => {
    const onchange = vi.fn();
    const engine = turningEngine();
    const svg = stage({ engine, annotations: [box(engine)], editVertices: true, selectedId: 'z1',
      tool: 'select', turnable: true, onchange });
    // From straight above the centre to straight right of it: a quarter turn clockwise.
    press(grip().parentNode, 'pointerdown', 200, 74);
    press(svg, 'pointermove', 276, 150);
    press(svg, 'pointerup', 276, 150);
    const [turned] = lastDrag(onchange);
    expect(onchange.mock.calls.at(-1)[1]).toBe(true);     // one entry to undo, at the end
    expect(turned.angle).toBeCloseTo(90, 6);
    const ring = onScreen(engine, turned);
    const xs = ring.map((point) => point[0]);
    const ys = ring.map((point) => point[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([150, 250, 50, 250]);
  });

  it('snaps the turn to 15° with Shift held', () => {
    const onchange = vi.fn();
    const engine = turningEngine();
    const svg = stage({ engine, annotations: [box(engine)], editVertices: true, selectedId: 'z1',
      tool: 'select', turnable: true, onchange });
    press(grip().parentNode, 'pointerdown', 200, 74);
    // 37° clockwise from straight up.
    const turn = (37 * Math.PI) / 180;
    const at = [200 + 76 * Math.sin(turn), 150 - 76 * Math.cos(turn)];
    press(svg, 'pointermove', ...at, { shiftKey: true });
    press(svg, 'pointerup', ...at, { shiftKey: true });
    expect(lastDrag(onchange)[0].angle).toBeCloseTo(30, 6);
  });

  it('turns a polygon by its points, having no sides of its own', () => {
    const onchange = vi.fn();
    const engine = turningEngine();
    const points = [[100, 100], [300, 100], [200, 200]]
      .map(([x, y]) => engine.containerPointToLatLng({ x, y })).map(({ lon, lat }) => [lon, lat]);
    const svg = stage({ engine, annotations: [{ ...area(), kind: 'polygon', points }], editVertices: true,
      selectedId: 'z1', tool: 'select', turnable: true, onchange });
    press(grip().parentNode, 'pointerdown', 200, 74);
    press(svg, 'pointermove', 200, 226);
    press(svg, 'pointerup', 200, 226);
    const [turned] = lastDrag(onchange);
    const apex = engine.latLngToContainerPoint({ lon: turned.points[2][0], lat: turned.points[2][1] });
    // Half a turn about the middle of what it spans: the apex points up now.
    expect(apex.x).toBeCloseTo(200, 4);
    expect(apex.y).toBeCloseTo(100, 4);
  });
});
