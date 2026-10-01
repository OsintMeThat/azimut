// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import CheckMarks from './CheckMarks.svelte';

const engine = { on: () => () => {}, latLngToContainerPoint: ({ lon }) => ({ x: lon * 100, y: 50 }) };

function render(props) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(CheckMarks, { target, props: { engine, ...props } });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}

it('pins each pin to its ground point, saying what it expects and how it came out', () => {
  const { target, done } = render({ pins: [
    { point: [1, 48], expect: 'found', ok: true },
    { point: [2, 48], expect: 'empty', ok: false },
    { point: [3, 48], expect: 'found', ok: null },
  ] });
  const marks = [...target.querySelectorAll('.mark')];
  expect(marks.map((mark) => mark.style.left)).toEqual(['100px', '200px', '300px']);
  expect(marks.map((mark) => mark.getAttribute('aria-label'))).toEqual([
    'Pin 1: Should be found, and it is', 'Pin 2: Should stay empty, and it is not', 'Pin 3: Should be found']);
  expect(marks[0].classList.contains('pass')).toBe(true);
  expect(marks[1].classList.contains('fail')).toBe(true);
  expect(marks[2].classList.contains('pass') || marks[2].classList.contains('fail')).toBe(false);
  done();
});

it('hands a pressed pin back by its place in the list, and marks the one the card is about', () => {
  const onpick = vi.fn();
  const { target, done } = render({ onpick, selected: 1, pins: [
    { point: [1, 48], expect: 'found', ok: null }, { point: [2, 48], expect: 'empty', ok: null }] });
  const marks = [...target.querySelectorAll('.mark')];
  marks[1].click();
  expect(onpick).toHaveBeenCalledWith(1);
  expect(marks.map((mark) => mark.classList.contains('selected'))).toEqual([false, true]);
  done();
});

it('leaves the click to the map while a pin is armed', () => {
  const { target, done } = render({ armed: true, pins: [{ point: [1, 48], expect: 'found', ok: null }] });
  expect(target.querySelector('.mark').classList.contains('armed')).toBe(true);
  done();
});

it('draws no frame and no veil: a check is its pins and nothing around them', () => {
  const { target, done } = render({ pins: [{ point: [1, 48], expect: 'found', ok: null }] });
  expect(target.querySelector('svg')).toBeNull();
  expect(target.querySelector('.ground-name')).toBeNull();
  done();
});
