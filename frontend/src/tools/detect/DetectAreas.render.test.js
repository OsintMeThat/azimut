// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DetectAreas from './DetectAreas.svelte';

const engine = {
  on: vi.fn(() => () => {}),
  latLngToContainerPoint: vi.fn(({ lat, lon }) => ({ x: (lon - 2) * 1000, y: (48 - lat) * 1000 })),
};
// The fake projection is 1000 px per degree, so the first area draws 100 px
// across and the second only 10.
const groups = [
  { id: 'w1', title: 'Harbour weekly', colour: '#38bdf8',
    zones: [{ id: 'z1', name: 'Anchorage', kind: 'rect', points: [[2, 48], [2.1, 47.9]] }] },
  { id: 'w2', title: 'Airfield', colour: '#f97316',
    zones: [{ id: 'z2', name: 'Apron', kind: 'rect', points: [[2.2, 48.2], [2.21, 48.19]] }] },
];

let live, target;
afterEach(() => { if (live) unmount(live); target?.remove(); });

function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(DetectAreas, { target, props: { engine, groups, ...props } });
  flushSync();
}

// The drawn outline; the one beside it is the wider invisible one a press reads.
const outlines = () => [...target.querySelectorAll('polygon:not(.hit)')];

it('draws every watched area in its own colour, named by what watches it', () => {
  open();
  const shapes = outlines();
  expect(shapes).toHaveLength(2);
  expect(shapes.map((shape) => shape.getAttribute('stroke'))).toEqual(['#38bdf8', '#f97316']);
  // zoomed out, a name longer than its own shape would bury the map, so only
  // the area with room for one carries it
  expect([...target.querySelectorAll('text')].map((label) => label.textContent))
    .toEqual(['Harbour weekly']);
  // a rectangle is drawn as its four ground corners, projected
  expect(shapes[0].getAttribute('points').split(' ')).toHaveLength(4);
});

it('presses through to the routine that owns the area', () => {
  const onpick = vi.fn();
  open({ onpick });
  target.querySelector('g.area').dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  expect(onpick).toHaveBeenCalledWith('w1');
  // The middle button turns the map under the area rather than opening it.
  target.querySelector('g.area').dispatchEvent(new MouseEvent('click', { bubbles: true, button: 1 }));
  expect(onpick).toHaveBeenCalledTimes(1);
});

it('hands the wheel down to the map it is drawn over', () => {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  const zoomed = vi.fn();
  canvas.addEventListener('wheel', zoomed);
  open({ engine: { ...engine, container } });
  const svg = target.querySelector('.detect-areas');
  document.elementsFromPoint = () => [svg, canvas];
  svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
  expect(zoomed).toHaveBeenCalled();
  expect(zoomed.mock.calls[0][0].deltaY).toBe(-120);
  container.remove();
});

it('picks up a press on the outline only, so the fill is still the map', () => {
  open();
  // A wide invisible outline is the hit target; the drawn one takes no press.
  expect([...target.querySelectorAll('polygon.hit')]).toHaveLength(2);
});

it('draws the one under the pointer heavier, and names it whatever its size', () => {
  open({ highlight: ['w2'] });
  const [one, two] = outlines();
  expect(one.getAttribute('stroke-width')).toBe('1.5');
  expect(two.getAttribute('stroke-width')).toBe('2.5');
  expect(Number(two.getAttribute('fill-opacity'))).toBeGreaterThan(Number(one.getAttribute('fill-opacity')));
  expect([...target.querySelectorAll('text')].map((label) => label.textContent))
    .toEqual(['Harbour weekly', 'Airfield']);
});
