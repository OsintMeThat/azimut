import { expect, it } from 'vitest';
import { mirrorPointer } from './linkedCursor.js';

/** A map at `left`, `top` on the page, ten px to the degree from `origin`. */
function fakeMap({ left = 0, top = 0, width = 400, height = 300, origin = { x: 0, y: 0 } } = {}) {
  return {
    container: { getBoundingClientRect: () => ({ left, top, width, height }) },
    containerPointToLatLng: ({ x, y }) => ({ lon: (x + origin.x) / 10, lat: (y + origin.y) / 10 }),
    latLngToContainerPoint: ({ lon, lat }) => ({ x: lon * 10 - origin.x, y: lat * 10 - origin.y }),
  };
}

it('places the cross on the same ground in the other pane', () => {
  const a = fakeMap({ left: 0 });
  const b = fakeMap({ left: 400 });
  expect(mirrorPointer(a, b, { x: 120, y: 80 })).toEqual({ x: 120, y: 80 });
  expect(mirrorPointer(b, a, { x: 520, y: 80 })).toEqual({ x: 120, y: 80 });
});

it('goes through the ground, so panes framed differently still agree', () => {
  const a = fakeMap({ left: 0 });
  const b = fakeMap({ left: 400, origin: { x: 50, y: -20 } });
  expect(mirrorPointer(a, b, { x: 120, y: 80 })).toEqual({ x: 70, y: 100 });
});

it('shows nothing for a pointer off the source or ground off the target', () => {
  const a = fakeMap({ left: 0 });
  const b = fakeMap({ left: 400, width: 100 });
  expect(mirrorPointer(a, b, { x: 450, y: 80 })).toBeNull();
  expect(mirrorPointer(a, b, { x: 200, y: 80 })).toBeNull();
});

it('shows nothing before both maps are laid out', () => {
  const a = fakeMap();
  expect(mirrorPointer(a, null, { x: 10, y: 10 })).toBeNull();
  expect(mirrorPointer(a, fakeMap({ width: 0 }), { x: 10, y: 10 })).toBeNull();
  expect(mirrorPointer(a, fakeMap(), null)).toBeNull();
});
