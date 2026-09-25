// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import CheckMarks from './CheckMarks.svelte';

it('pins each mark to its ground point, saying what it expects and how it came out', () => {
  const engine = { on: () => () => {}, latLngToContainerPoint: ({ lon }) => ({ x: lon * 100, y: 50 }) };
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(CheckMarks, { target, props: { engine, marks: [
    { point: [1, 48], expect: 'found', ok: true },
    { point: [2, 48], expect: 'empty', ok: false },
    { point: [3, 48], expect: 'found', ok: null },
  ] } });
  flushSync();
  const marks = [...target.querySelectorAll('.mark')];
  expect(marks.map((mark) => mark.style.left)).toEqual(['100px', '200px', '300px']);
  expect(marks.map((mark) => mark.getAttribute('aria-label'))).toEqual([
    'Should be found, and it is', 'Should stay empty, and it is not', 'Should be found']);
  expect(marks[0].classList.contains('pass')).toBe(true);
  expect(marks[1].classList.contains('fail')).toBe(true);
  unmount(live);
  target.remove();
});

it('draws the open check’s view as a frame with its name', () => {
  const engine = { on: () => () => {}, latLngToContainerPoint: ({ lon, lat }) => ({ x: lon * 100, y: (50 - lat) * 100 }) };
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(CheckMarks, { target, props: { engine, marks: [],
    ground: { name: 'Check 4', bounds: { west: 1, south: 48, east: 2, north: 49 } } } });
  flushSync();
  expect(target.querySelector('polygon').getAttribute('points')).toBe('100,100 200,100 200,200 100,200');
  expect(target.querySelector('.ground-name').textContent).toBe('Check 4');
  // The ground outside the frame is veiled: the frame is cut out of a ring past the screen.
  const veil = target.querySelector('path.veil');
  expect(veil.getAttribute('fill-rule')).toBe('evenodd');
  expect(veil.getAttribute('d')).toBe('M-1e5,-1e5H1e5V1e5H-1e5Z M100,100 L200,100 L200,200 L100,200Z');
  unmount(live);
  target.remove();
});

it('veils nothing while no check is open', () => {
  const engine = { on: () => () => {}, latLngToContainerPoint: () => ({ x: 0, y: 0 }) };
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(CheckMarks, { target, props: { engine, marks: [{ point: [1, 48], expect: 'found', ok: null }] } });
  flushSync();
  expect(target.querySelector('path.veil')).toBeNull();
  unmount(live);
  target.remove();
});
