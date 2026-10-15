// @vitest-environment happy-dom
/**
 * The cursor on a tracked layer's row. The drag needs a laid-out page, which
 * happy-dom does not lay out; the rest is asserted: what it says, the steps
 * between changes, the keys, and what is drawn of the past.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerTimeCursor from './LayerTimeCursor.svelte';

const MOMENTS = ['2026-10-03', '2026-10-12', '2026-10-20'];
let held = null;
let changes;

function show(time = { at: null, trail: true, since: null }, props = {}) {
  changes = [];
  held = mount(LayerTimeCursor, { target: document.body,
    props: { time, moments: MOMENTS, onchange: (patch) => changes.push(patch), ...props } });
  flushSync();
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

const button = (label) => document.body.querySelector(`[aria-label="${label}"]`);
const text = (value) => [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim() === value);

describe('the moment a tracked layer is read at', () => {
  it('reads now by default, a tick per change, and steps back to the last change', () => {
    show();
    expect(document.body.querySelector('.moment').textContent).toBe('Now');
    expect(document.body.querySelectorAll('.tick')).toHaveLength(3);
    expect(button('Next change').disabled).toBe(true);
    button('Previous change').click();
    expect(changes).toEqual([{ at: '2026-10-20' }]);
  });

  it('steps from change to change, and goes back to now', () => {
    show({ at: '2026-10-12', trail: true, since: null });
    expect(document.body.querySelector('.moment').textContent).toBe('12 Oct 2026');
    expect(document.body.querySelector('.tick.on').title).toBe('12 Oct 2026');
    button('Previous change').click();
    button('Next change').click();
    text('Now').click();
    expect(changes).toEqual([{ at: '2026-10-03' }, { at: '2026-10-20' }, { at: null }]);
  });

  it('moves a day at a time from the keyboard, and Home and End go to the first change and to now', () => {
    show({ at: '2026-10-12', trail: true, since: null });
    const slider = document.body.querySelector('[role="slider"]');
    for (const key of ['ArrowRight', 'PageDown', 'Home', 'End']) slider.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    expect(changes).toEqual([{ at: '2026-10-13' }, { at: '2026-10-05' }, { at: '2026-10-03' }, { at: null }]);
  });

  it('keeps the time of day on a layer dated to the minute, on its clock', () => {
    show({ at: '2026-10-12T14:30', trail: true, since: null }, { precision: 'time', zone: 'Europe/Kyiv' });
    const field = document.body.querySelector('input[type="time"]');
    expect(field.value).toBe('14:30');
    expect(document.body.querySelector('.zone').textContent).toBe('Kyiv');
    field.value = '09:05'; field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(changes).toEqual([{ at: '2026-10-12T09:05' }]);
  });

  it('switches the trail and the gains and losses from its menu', () => {
    show();
    button('What the map shows of the past').click(); flushSync();
    text('Show the state before, dashed').click();
    text('Since the state before').click();
    expect(changes).toEqual([{ trail: false }, { since: 'previous' }]);
  });

  it('says when gains and losses are hatched', () => {
    show({ at: null, trail: true, since: 'previous' });
    // the button that sets the past says what is drawn of it, rather than a ⋯ nobody finds
    expect(document.body.querySelector('.past').textContent).toContain('Before · ± last');
    show({ at: null, trail: false, since: null });
    expect([...document.body.querySelectorAll('.past')].at(-1).textContent).toContain('The past');
  });
});
