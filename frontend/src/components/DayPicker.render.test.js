// @vitest-environment happy-dom
/**
 * The calendar, actually mounted.
 *
 * What it replaced was a browser's own picker, and the failures that made it
 * worth replacing are all in the DOM rather than in the source: a calendar that
 * opens over the panel instead of inside it, a day the bounds should have
 * refused, a month arrow that walks into years the service cannot answer for.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: DayPicker } = await import('./DayPicker.svelte');

const live = [];

function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live.push(mount(DayPicker, { target, props }));
  flushSync();
  return target;
}

const field = (root) => root.querySelector('.field');
const days = (root) => [...root.querySelectorAll('.day')];
const dayNamed = (root, iso) => days(root).find((b) => b.title === iso);

afterEach(() => {
  while (live.length) unmount(live.pop());
  document.body.innerHTML = '';
});

describe('the field', () => {
  it('reads the day the way the rest of the app writes one', () => {
    const root = open({ value: '2026-09-12' });
    expect(field(root).textContent).toContain('2026-09-12');
    expect(field(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('says what an empty one means rather than showing a blank box', () => {
    const root = open({ value: '', placeholder: 'That day alone' });
    expect(field(root).textContent).toContain('That day alone');
  });
});

describe('the calendar it opens', () => {
  it('is drawn in the panel, not over it', () => {
    const root = open({ value: '2026-09-12' });
    field(root).click();
    flushSync();
    const cal = root.querySelector('.cal');
    expect(cal).not.toBe(null);
    // the whole reason it exists: nothing here is positioned out of the flow,
    // so no edge of any panel can cut it
    expect(getComputedStyle(cal).position).not.toBe('absolute');
    expect(getComputedStyle(cal).position).not.toBe('fixed');
  });

  it('opens on the month of the day it holds, and walks whole months', () => {
    const root = open({ value: '2026-09-12' });
    field(root).click();
    flushSync();
    expect(root.querySelector('.month').textContent).toBe('Sep 2026');
    root.querySelector('[aria-label="Previous month"]').click();
    flushSync();
    expect(root.querySelector('.month').textContent).toBe('Aug 2026');
  });

  it('hands the day back in the one form the services take, and closes', () => {
    const onpick = vi.fn();
    const root = open({ value: '2026-09-12', onpick });
    field(root).click();
    flushSync();
    dayNamed(root, '2026-09-03').click();
    flushSync();
    expect(onpick).toHaveBeenCalledWith('2026-09-03');
    expect(root.querySelector('.cal')).toBe(null);
  });

  it('marks the day it holds, and refuses the ones outside its bounds', () => {
    const root = open({ value: '2026-09-12', min: '2026-09-10', max: '2026-09-20' });
    field(root).click();
    flushSync();
    expect(dayNamed(root, '2026-09-12').classList.contains('on')).toBe(true);
    expect(dayNamed(root, '2026-09-09').disabled).toBe(true);
    expect(dayNamed(root, '2026-09-21').disabled).toBe(true);
    expect(dayNamed(root, '2026-09-15').disabled).toBe(false);
  });

  it('greys the arrow into a month every day of which is refused', () => {
    const root = open({ value: '2026-09-12', min: '2026-09-01', max: '2026-09-30' });
    field(root).click();
    flushSync();
    expect(root.querySelector('[aria-label="Next month"]').disabled).toBe(true);
    expect(root.querySelector('[aria-label="Previous month"]').disabled).toBe(true);
  });

  it('takes the day back out only where an empty field means something', () => {
    const onpick = vi.fn();
    const plain = open({ value: '2026-09-12', onpick });
    field(plain).click();
    flushSync();
    expect([...plain.querySelectorAll('.act')].map((b) => b.textContent.trim())).toEqual(['Today']);

    const ranged = open({ value: '2026-09-12', clearable: true, onpick });
    field(ranged).click();
    flushSync();
    const clear = [...ranged.querySelectorAll('.act')].find((b) => b.textContent.trim() === 'Clear');
    clear.click();
    flushSync();
    expect(onpick).toHaveBeenCalledWith('');
  });
});
