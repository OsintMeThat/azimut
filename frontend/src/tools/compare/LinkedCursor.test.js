// @vitest-environment happy-dom
/**
 * The cross echoing the other pane's pointer. It must follow the camera: a
 * wheel zoom moves the ground under a still mouse, and the cross with it.
 */
import { afterEach, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: LinkedCursor } = await import('./LinkedCursor.svelte');

let live, target, handlers;

function fakeMap(left, origin = { x: 0, y: 0 }) {
  return {
    origin,
    container: { getBoundingClientRect: () => ({ left, top: 0, width: 400, height: 300 }) },
    on: (name, handler) => { handlers[name] = handler; return () => delete handlers[name]; },
    containerPointToLatLng: ({ x, y }) => ({ lon: (x + origin.x) / 10, lat: (y + origin.y) / 10 }),
    latLngToContainerPoint: ({ lon, lat }) => ({ x: lon * 10 - origin.x, y: lat * 10 - origin.y }),
  };
}

function render(props) {
  handlers = {};
  target = document.createElement('div');
  document.body.append(target);
  live = mount(LinkedCursor, { target, props });
  flushSync();
}

afterEach(() => {
  if (live) unmount(live);
  target?.remove();
  live = null;
});

it('draws the cross where the other pane points, out of the way of clicks', () => {
  render({ source: fakeMap(0), engine: fakeMap(400), client: { x: 120, y: 80 } });
  const cross = target.querySelector('.linked-cursor');
  expect(cross).not.toBeNull();
  expect(cross.style.left).toBe('120px');
  expect(cross.style.top).toBe('80px');
  expect(cross.getAttribute('aria-hidden')).toBe('true');
});

it('moves with the camera under a still pointer', () => {
  const engine = fakeMap(400);
  render({ source: fakeMap(0), engine, client: { x: 120, y: 80 } });
  engine.origin.x = 30;
  handlers['view-move']();
  flushSync();
  expect(target.querySelector('.linked-cursor').style.left).toBe('90px');
});

it('draws nothing when the ground is off this pane', () => {
  render({ source: fakeMap(0), engine: fakeMap(400, { x: 2000, y: 0 }), client: { x: 120, y: 80 } });
  expect(target.querySelector('.linked-cursor')).toBeNull();
});
