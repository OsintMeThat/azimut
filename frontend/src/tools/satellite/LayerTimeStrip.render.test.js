// @vitest-environment happy-dom
/**
 * The time strip on an added layer's row. The drags themselves need a laid-out
 * page to measure against, which happy-dom does not lay out; what is asserted
 * here is everything that does not: what the strip says, and what each of its
 * other ways in hands back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerTimeStrip from './LayerTimeStrip.svelte';
import { indexDates } from '../../lib/map/layerDates.js';

const at = (date, category = 'Russia') => ({ properties: { category, date } });
const INDEX = indexDates({
  features: [at('2026-09-01'), at('2026-09-01'), at('2026-09-10', 'Ukraine'), at('2026-09-18')],
});

let held = null;

function show(props = {}) {
  held = mount(LayerTimeStrip, {
    target: document.body,
    props: { index: INDEX, label: 'GeoConfirmed', ...props },
  });
  flushSync();
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

const bars = () => [...document.body.querySelectorAll('rect')];
const button = (text) =>
  [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
const handles = () => [...document.body.querySelectorAll('[role="slider"]')];

describe('the time strip', () => {
  it('draws a bar a day across a short layer, and says what it spans', () => {
    show();

    expect(bars()).toHaveLength(18);
    expect(button('1 Sep 2026')).toBeTruthy();
    expect(button('18 Sep 2026')).toBeTruthy();
  });

  it('offers no way to clear a period nobody set', () => {
    show();

    expect(document.body.querySelector('[aria-label="Show every date"]')).toBeNull();
  });

  it('says the period that is kept, and clears it in one press', () => {
    const onchange = vi.fn();
    show({ period: { start: '2026-09-05', end: '2026-09-12' }, onchange });

    expect(button('5 Sep 2026')).toBeTruthy();
    expect(button('12 Sep 2026')).toBeTruthy();
    document.body.querySelector('[aria-label="Show every date"]').click();

    expect(onchange).toHaveBeenCalledWith(null);
  });

  it('moves a bound a day with the arrow keys', () => {
    const onchange = vi.fn();
    show({ period: { start: '2026-09-05', end: '2026-09-12' }, onchange });

    handles()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(onchange).toHaveBeenCalledWith({ start: '2026-09-05', end: '2026-09-13' });
  });

  it('leaves a bound pushed to the layer’s own edge open', () => {
    const onchange = vi.fn();
    show({ period: { start: '2026-09-05', end: '2026-09-12' }, onchange });

    handles()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));

    expect(onchange).toHaveBeenCalledWith({ start: '2026-09-05', end: '' });
  });

  it('opens a calendar on a date, bounded by the layer’s own days', () => {
    const onchange = vi.fn();
    show({ onchange });

    button('1 Sep 2026').click();
    flushSync();

    expect(document.body.querySelector('[aria-label="First day calendar"]')).toBeTruthy();
    const day = [...document.body.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === '10' && !node.disabled
    );
    day.click();
    flushSync();

    expect(onchange).toHaveBeenCalledWith({ start: '2026-09-10', end: '' });
    expect(document.body.querySelector('[aria-label="First day calendar"]')).toBeNull();
  });

  it('lets every date back in on a double click', () => {
    const onchange = vi.fn();
    show({ period: { start: '2026-09-05', end: '' }, onchange });

    document.body.querySelector('.track').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onchange).toHaveBeenCalledWith(null);
  });

  it('leaves the bars of a hidden group out', () => {
    show({ hidden: ['Russia'] });

    const tall = bars().filter((rect) => Number(rect.getAttribute('height')) > 0);
    expect(tall).toHaveLength(1); // only Ukraine's day
  });
});
