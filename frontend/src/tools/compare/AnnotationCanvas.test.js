// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: Canvas } = await import('./AnnotationCanvas.svelte');

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

function press(node, type, x, y) {
  node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  flushSync();
}

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
