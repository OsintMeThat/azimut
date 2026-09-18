// @vitest-environment happy-dom
/**
 * The export frame drawn over imagery A.
 *
 * What matters here is that the rectangle is kept on the ground rather than on
 * the screen: an export framed before a pan must cut the same roofs after it.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

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

beforeEach(() => { target = document.createElement('div'); document.body.append(target); });
afterEach(() => { if (live) unmount(live); target.remove(); });

it('hands back the ground the drag covered', () => {
  const onframe = vi.fn();
  const root = stage({ drawing: true, onframe });

  press(root, 'pointerdown', 20, 0);
  press(root, 'pointermove', 380, 300);
  press(root, 'pointerup', 380, 300);

  expect(onframe).toHaveBeenCalledWith({ points: [[2, 0], [38, 30]] });
});

it('keeps the frame on its ground when the camera moves', () => {
  stage({ frame: { points: [[5, 4], [25, 19]] } });
  expect(edge().getAttribute('x')).toBe('50.5');

  origin.x = 120;
  handlers['view-move']();
  flushSync();
  expect(edge().getAttribute('x')).toBe('-69.5');
  expect(edge().getAttribute('width')).toBe('199');
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
