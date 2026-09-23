// @vitest-environment happy-dom
/**
 * The export frame drawn over imagery A.
 *
 * What matters here is that the rectangle is kept on the ground rather than on
 * the screen: an export framed before a pan must cut the same roofs after it.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { fromMercator, toMercator } from '../../lib/map/groundFrame.js';

const { default: ExportFrame } = await import('./ExportFrame.svelte');

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

/**
 * A camera at one pixel to the metre, turned by the app's bearing: the map's
 * clockwise turn, so the compass direction up is its negative. Its matrix is
 * its own inverse, so the same one maps both ways.
 */
function turningEngine() {
  handlers = {};
  const engine = { bearing: 0 };
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

/** The frame's four corners on screen, read off its outline. */
const corners = () => [...edge().getAttribute('d').matchAll(/(-?[\d.e-]+),(-?[\d.e-]+)/g)]
  .map((match) => [Number(match[1]), Number(match[2])]);
const side = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function press(node, type, x, y) {
  node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  flushSync();
}

function stage(props) {
  live = mount(ExportFrame, { target, props: { engine: fakeEngine(), ...props } });
  flushSync();
  const root = target.querySelector('.export-frame');
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  return root;
}

const edge = () => target.querySelector('.edge');
/** The corner xs of the drawn outline, which is a path now that it can turn. */
const edgeXs = () => [...edge().getAttribute('d').matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
  .map((match) => Number(match[1]));

beforeEach(() => { target = document.createElement('div'); document.body.append(target); });
afterEach(() => { if (live) unmount(live); target.remove(); });

it('hands back the ground the drag covered', () => {
  const onframe = vi.fn();
  const root = stage({ drawing: true, onframe });

  press(root, 'pointerdown', 20, 0);
  press(root, 'pointermove', 380, 300);
  press(root, 'pointerup', 380, 300);

  // The bearing the box was drawn at travels with it, so it can be turned back upright.
  expect(onframe).toHaveBeenCalledWith({ points: [[2, 0], [38, 30]], angle: 0 });
});

it('keeps the frame on its ground when the camera moves', () => {
  stage({ frame: { points: [[5, 4], [25, 19]] } });
  expect(Math.min(...edgeXs())).toBeCloseTo(50, 6);
  expect(Math.max(...edgeXs())).toBeCloseTo(250, 6);

  origin.x = 120;
  handlers['view-move']();
  flushSync();
  expect(Math.min(...edgeXs())).toBeCloseTo(-70, 6);
  expect(Math.max(...edgeXs()) - Math.min(...edgeXs())).toBeCloseTo(200, 6);
});

it('treats a press that barely travels as a click, not a frame', () => {
  const onframe = vi.fn();
  const oncancel = vi.fn();
  const root = stage({ drawing: true, onframe, oncancel });

  press(root, 'pointerdown', 50, 40);
  press(root, 'pointerup', 56, 44);

  expect(onframe).not.toHaveBeenCalled();
  expect(oncancel).toHaveBeenCalled();
});

it('gives up the drawing on Escape', () => {
  const oncancel = vi.fn();
  stage({ drawing: true, oncancel });

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  flushSync();
  expect(oncancel).toHaveBeenCalled();
});

it('reads the frame as the ground it covers', () => {
  stage({ frame: { points: [[5, 4], [25, 19]] } });
  expect(target.querySelector('.frame-tag').textContent).toContain('Export frame');
  expect(target.querySelector('.frame-tag').textContent).toMatch(/km|m/);
});

it('shows B the same box without letting it be drawn on', () => {
  const onframe = vi.fn();
  const root = stage({ frame: { points: [[5, 4], [25, 19]] }, readonly: true, onframe });
  expect(root.classList.contains('readonly')).toBe(true);
  expect(target.querySelector('.frame-tag')).toBeNull();

  press(root, 'pointerdown', 50, 40);
  press(root, 'pointerup', 250, 190);
  expect(onframe).not.toHaveBeenCalled();
});

it('records the bearing it was drawn at', () => {
  const onframe = vi.fn();
  const engine = turningEngine();
  engine.bearing = 35;
  const root = stage({ engine, drawing: true, bearing: 35, onframe });
  press(root, 'pointerdown', 40, 30);
  press(root, 'pointermove', 380, 280);
  press(root, 'pointerup', 380, 280);
  // The map turned 35° clockwise puts compass 325° up.
  expect(onframe.mock.calls[0][0].angle).toBe(325);
});

it('keeps its shape when the camera turns, turning with the ground', () => {
  // The frame used to be the screen box around its two corners, which stretched
  // and squashed as the camera turned.
  const engine = turningEngine();
  engine.bearing = 20;
  const drawn = [{ x: 100, y: 80 }, { x: 300, y: 200 }]
    .map((at) => engine.containerPointToLatLng(at)).map(({ lon, lat }) => [lon, lat]);
  stage({ engine, frame: { points: drawn, angle: 340 } });
  const [a, b, c] = corners();
  expect(a[0]).toBeCloseTo(100, 4);
  expect(c[1]).toBeCloseTo(200, 4);
  expect(side(a, b)).toBeCloseTo(200, 4);
  expect(side(b, c)).toBeCloseTo(120, 4);

  engine.bearing = 65;
  handlers['view-move']();
  flushSync();
  const [e, f, g, h] = corners();
  expect(side(e, f)).toBeCloseTo(200, 4);
  expect(side(f, g)).toBeCloseTo(120, 4);
  expect(side(e, g)).toBeCloseTo(side(f, h), 4);
  // The map turned 45° further clockwise, and the frame with the ground.
  expect((Math.atan2(f[1] - e[1], f[0] - e[0]) * 180) / Math.PI).toBeCloseTo(45, 4);
});
