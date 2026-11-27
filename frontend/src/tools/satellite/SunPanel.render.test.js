// @vitest-environment happy-dom
/**
 * Sun and moon's shadow, as the panel offers it: an addition pressed when it is
 * wanted, which leaves the date, the hour and the anchor as they were.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SunPanel from './SunPanel.svelte';

let held = [];
afterEach(() => {
  for (const one of held) unmount(one);
  held = [];
  document.body.innerHTML = '';
});

const calls = () => ({
  ondate: vi.fn(),
  onindex: vi.fn(),
  onplace: vi.fn(),
  onclose: vi.fn(),
  ontraceshadow: vi.fn(),
  onclearshadow: vi.fn(),
  onmoment: vi.fn(),
  oncopyshadow: vi.fn(),
  onswapshadow: vi.fn(),
});

function show(props) {
  held.push(mount(SunPanel, { target: document.body, props: { day: '2026-06-21', anchor: { lat: 48.85, lon: 2.35 }, ...props } }));
  flushSync();
}

const button = (name) => [...document.querySelectorAll('button')].find((one) => one.textContent.trim() === name || one.getAttribute('aria-label') === name);
const shadow = (more) => ({ step: null, traced: true, busy: false, error: '', date: '2026-06-21', answered: false, moments: [], noDay: false, ...more });

it('offers a shadow with one button, and says nothing more about it until pressed', () => {
  const on = calls();
  show({ ...on });
  expect(document.querySelector('.shadow').textContent.trim()).toBe('Read a shadow');
  button('Read a shadow').click();
  expect(on.ontraceshadow).toHaveBeenCalledTimes(1);
  // the anchor's own button is there as it was
  expect(button('Move')).toBeTruthy();
});

it('says which click comes next while the shadow is put down, and lets it go', () => {
  const on = calls();
  show({ ...on, shadow: shadow({ step: 'foot', traced: false }) });
  expect(document.querySelector('.tracing').textContent).toContain('Click the foot of what casts it');
  button('Cancel').click();
  expect(on.ontraceshadow).toHaveBeenCalledTimes(1);
});

it('gives each hour the shadow names, and puts the slider on the one pressed', () => {
  const on = calls();
  const moments = [
    { clock: '10:05', zone: 'CEST', height: '23 m', sun: 'sun at 120°, 41.2° up' },
    { clock: '16:40', zone: 'CEST', height: '9 m', sun: 'sun at 260°, 18.0° up' },
  ];
  show({ ...on, shadow: shadow({ answered: true, moments }) });
  const hours = document.querySelectorAll('.moment');
  expect([...hours].map((one) => one.querySelector('.when').textContent)).toEqual(['10:05 CEST', '16:40 CEST']);
  expect(hours[0].textContent).toContain('about 23 m tall');
  hours[1].click();
  expect(on.onmoment).toHaveBeenCalledWith(1);
  button('Copy the shadow').click();
  expect(on.oncopyshadow).toHaveBeenCalled();
  button('Remove the shadow').click();
  expect(on.onclearshadow).toHaveBeenCalled();
  expect(document.querySelector('.shadow').textContent).toContain('Assumes level ground seen from overhead.');
});

it('says when no hour casts it, when it is being read, and when the imagery has no day', () => {
  show({ ...calls(), shadow: shadow({ answered: true, noDay: true }) });
  expect(document.querySelector('.shadow').textContent).toContain('No hour of 2026-06-21 casts this shadow');
  expect(document.querySelector('.shadow').textContent).toContain('The imagery has no day: the shadow is read on the date above.');
  expect(button('Copy the shadow')).toBeFalsy();
  unmount(held.pop());
  show({ ...calls(), shadow: shadow({ busy: true }) });
  expect(document.querySelector('.shadow').textContent).toContain('Reading the sun…');
});

it('says which way that day’s shadows fall when no hour casts it, and offers the ends the other way round', () => {
  const on = calls();
  const falls = 'That day, shadows fall between 277° and 083°, through north.';
  show({ ...on, shadow: shadow({ answered: true, falls, swappable: true }) });
  expect(document.querySelector('.shadow').textContent).toContain(falls);
  button('Swap the ends').click();
  expect(on.onswapshadow).toHaveBeenCalledTimes(1);
  unmount(held.pop());
  // drawn either way round with no hour, there is nothing to swap
  show({ ...calls(), shadow: shadow({ answered: true, falls, swappable: false }) });
  expect(button('Swap the ends')).toBeFalsy();
});
