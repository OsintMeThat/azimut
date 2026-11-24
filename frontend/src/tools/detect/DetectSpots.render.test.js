// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DetectSpots from './DetectSpots.svelte';

// 1000 px a degree, and a map 800 × 600 px
const engine = {
  on: vi.fn(() => () => {}),
  latLngToContainerPoint: ({ lat, lon }) => ({ x: (lon - 54) * 1000, y: (25 - lat) * 1000 }),
};
const spot = (id, lon, lat, category = 'steady') => ({ id, centre: [lon, lat], category });

beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(SVGElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

let live, target;
afterEach(() => { if (live) unmount(live); target?.remove(); });

function open(props) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(DetectSpots, { target, props: { engine, ...props } });
  flushSync();
}

it('draws only the spots in view, in the colour of their kind', () => {
  const spots = [spot('S1', 54.1, 24.9), spot('S2', 54.2, 24.8, 'new'), spot('S3', 58, 20), ...Array.from({ length: 3000 }, (_, i) => spot(`F${i}`, 60, 10))];
  open({ spots });
  const drawn = [...target.querySelectorAll('.spot')];
  expect(drawn.map((node) => node.getAttribute('aria-label'))).toEqual(['Spot S1', 'Spot S2']);
  expect(drawn[1].classList.contains('new')).toBe(true);
});

it('names the spot picked and answers a press with its id', () => {
  const onpick = vi.fn();
  open({ spots: [spot('S1', 54.1, 24.9), spot('S2', 54.2, 24.8)], selected: 'S2', onpick });
  expect([...target.querySelectorAll('text')].map((node) => node.textContent)).toEqual(['S2']);
  target.querySelector('.spot').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
  expect(onpick).toHaveBeenCalledWith('S1');
});
