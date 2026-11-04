// @vitest-environment happy-dom
/**
 * The days a played plate goes through. happy-dom lays nothing out, so the track's
 * box is given where a drag or the room for the notches is asserted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateDays from './PlateDays.svelte';
import { momentLabel as momentLabelOf } from '../../lib/map/layerHistory.js';

const DAYS = ['2026-10-03', '2026-10-09', '2026-10-12', '2026-11-02'];
const HOURS = ['2026-11-01T10:00', '2026-11-02T09:00', '2026-11-02T14:30', '2026-11-03T08:00'];
let held = null;

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The track as the plate holds it: a day picked becomes the day shown. */
function show(extra = {}) {
  const calls = { onpick: vi.fn(), onchange: vi.fn(), onhours: vi.fn() };
  const props = $state({ keys: DAYS, at: '2026-10-09', time: { trail: true, since: null, window: null }, ...extra,
    ...calls, onpick: (key) => { calls.onpick(key); props.at = key; } });
  held = mount(PlateDays, { target: document.body, props });
  flushSync();
  return calls;
}
const press = (node) => { node.click(); flushSync(); };
const ticks = () => [...document.body.querySelectorAll('.tick')];
const lefts = () => ticks().map((tick) => Number.parseFloat(tick.style.left).toFixed(1));
const handle = () => document.body.querySelector('[role="slider"]');
const button = (label) => document.body.querySelector(`[aria-label="${label}"]`);
const text = (value) => [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim() === value);
const key = (name) => { handle().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); flushSync(); };

describe('the days a played plate goes through', () => {
  it('sets a notch for each day it plays side by side, the one shown lit, a skipped one faint, dots for its steps', () => {
    show({ faded: ['2026-10-12'], steps: { '2026-10-09': 2, '2026-11-02': 5 } });
    // the calendar's gaps leave no mark: four days, four even places
    expect(lefts()).toEqual(['0.0', '33.3', '66.7', '100.0']);
    expect(ticks().map((tick) => tick.classList.contains('on'))).toEqual([false, true, false, false]);
    expect(ticks().map((tick) => tick.classList.contains('faded'))).toEqual([false, false, true, false]);
    expect(ticks()[2].title).toContain('hidden from the video');
    expect([...document.body.querySelectorAll('.dots')].map((dots) => dots.children.length)).toEqual([2, 3]);
    expect(ticks()[3].title).toBe('2 Nov 2026, 5 steps');
    expect(handle().style.left).toBe(ticks()[1].style.left);
    expect([...document.body.querySelectorAll('.ends > span')].map((end) => end.textContent)).toEqual(['3 Oct', '2 Nov']);
    expect(document.body.querySelector('.overview')).toBeNull();
    expect(document.body.querySelector('.moment').textContent).toBe('9 Oct 2026');
  });

  it('stands between the two days it falls between on a day it does not play', () => {
    show({ at: '2026-10-10' });
    expect(handle().classList.contains('off')).toBe(true);
    expect(Number.parseFloat(handle().style.left)).toBeCloseTo(50);
  });

  it('goes from day to day from its arrows and its keys', () => {
    const calls = show();
    press(button('Next day'));
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-10-12');
    press(button('Previous day'));
    press(button('Previous day'));
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-10-03');
    expect(button('Previous day').disabled).toBe(true);
    key('End');
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-02');
    // a page is a week of the days played, here back to the first
    key('PageDown');
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-10-03');
    key('ArrowRight');
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-10-09');
    key('End');
    key('Home');
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-10-03');
  });

  it('reads a drag on the track as the track stood when it began', () => {
    const calls = show();
    const lane = document.body.querySelector('.lane');
    const box = (left, width) => vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left, width, top: 0, height: 22, right: left + width, bottom: 22 });
    box(100, 300);
    const track = document.body.querySelector('.track');
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
    flushSync();
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-10-12');
    // the bar has shrunk under the pointer: the drag keeps reading the track it began on
    box(100, 100);
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 202, bubbles: true }));
    flushSync();
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-10-09');
    track.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  it('goes to a day of the calendar, and to today', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const calls = show();
    press(text('Today'));
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-02');
    expect(text('Today')).toBeUndefined();
    press(document.body.querySelector('.moment'));
    // the calendar opens on the month shown; a day the plate does not play is shown all the same
    press(document.body.querySelector('button[title="2026-11-01"]'));
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-01');
    expect(handle().classList.contains('off')).toBe(true);
  });
});

describe('a plate played hour by hour', () => {
  it('sets the moments of a day together and a wider gap before the next day, the moment picked under them', () => {
    const calls = show({ keys: HOURS, at: '2026-11-02T14:30', hours: true, canHours: true, steps: { '2026-11-02T09:00': 1 } });
    expect(lefts()).toEqual(['0.0', '40.0', '60.0', '100.0']);
    // the first notch of each day stands taller
    expect(ticks().map((tick) => tick.classList.contains('first'))).toEqual([false, true, false, true]);
    expect(document.body.querySelector('.moment').textContent).toBe('2 Nov 2026');
    const hour = button('Moment of the day');
    expect(hour.textContent.trim()).toBe('14:30');
    press(hour);
    const items = [...document.body.querySelectorAll('.float-menu .fm-item')];
    expect(items.map((item) => item.textContent.trim())).toEqual(['09:001 step', '14:30']);
    expect(items[1].getAttribute('aria-checked')).toBe('true');
    press(items[0]);
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-02T09:00');
    expect(button('Moment of the day').textContent.trim()).toBe('09:00');
    press(button('Next moment'));
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-02T14:30');
    key('PageUp');
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-03T08:00');
    // back on a day, the moment last shown there
    key('PageDown');
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-02T14:30');
  });

  it('keeps a notch a day when the moments are too many to show apart, landing on the moment last shown there', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120);
    const many = Array.from({ length: 20 }, (_, index) => `2026-11-02T${String(index).padStart(2, '0')}:00`);
    const keys = ['2026-11-01T10:00', ...many, '2026-11-03T08:00'];
    const calls = show({ keys, at: '2026-11-02T07:00', hours: true, canHours: true });
    expect(ticks()).toHaveLength(3);
    expect(ticks()[1].title).toBe('2 Nov 2026, 20 moments');
    const lane = document.body.querySelector('.lane');
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 106, top: 0, height: 22, right: 106, bottom: 22 });
    const track = document.body.querySelector('.track');
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, bubbles: true }));
    flushSync();
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-01T10:00');
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 53, bubbles: true }));
    flushSync();
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-02T07:00');
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 106, bubbles: true }));
    flushSync();
    // a day never shown lands on its first moment
    expect(calls.onpick).toHaveBeenLastCalledWith('2026-11-03T08:00');
    track.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  it('offers Hours only on layers dated to the minute, saying which way it plays', () => {
    show();
    expect(text('Hours')).toBeUndefined();
    unmount(held);
    document.body.innerHTML = '';
    const calls = show({ canHours: true });
    const hours = text('Hours');
    expect(hours.getAttribute('aria-pressed')).toBe('false');
    expect(hours.title).toContain('Plays day by day');
    press(hours);
    expect(calls.onhours).toHaveBeenCalledWith(true);
    // played day by day, a day has no moment to pick
    expect(button('Moment of the day')).toBeNull();
  });
});

describe('a plate that plays more days than its track shows apart', () => {
  /** A thousand days played, from 1 Jan 2024. */
  const THOUSAND = Array.from({ length: 1000 }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10));
  const lane = () => document.body.querySelector('.lane');
  const box = (node, left, width) => vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left, width, top: 0, height: 10, right: left + width, bottom: 10 });

  it('shows a window of them around the day shown, and a line of all of them with the window lit', () => {
    // a track 214 px wide shows 21 notches 10 px apart
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(214);
    show({ keys: THOUSAND, at: THOUSAND[500] });
    expect(ticks()).toHaveLength(21);
    expect(ticks()[10].classList.contains('on')).toBe(true);
    expect(handle().style.left).toBe(ticks()[10].style.left);
    expect(handle().getAttribute('aria-valuenow')).toBe('500');
    expect(handle().getAttribute('aria-valuemax')).toBe('999');
    const seen = document.body.querySelector('.overview .seen');
    expect([Number.parseFloat(seen.style.left), Number.parseFloat(seen.style.width)]).toEqual([49, 2.1]);
    // the ends name all the days, their years as they span three, the line says what the track shows
    expect([...document.body.querySelectorAll('.ends > span[aria-hidden]')].map((end) => end.textContent)).toEqual(['1 Jan 2024', '26 Sep 2026']);
    expect(document.body.querySelector('.overview').title).toContain('1000 days: the track shows 5 May 2025 to 25 May 2025');
  });

  it('moves the window a whole window at a time, only when the day shown leaves it', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(214);
    const calls = show({ keys: THOUSAND, at: THOUSAND[500] });
    const first = () => ticks()[0].title;
    expect(first()).toBe('5 May 2025');
    for (let step = 0; step < 10; step += 1) key('ArrowRight');
    // still inside: the notches stay where they are
    expect(calls.onpick).toHaveBeenLastCalledWith(THOUSAND[510]);
    expect(first()).toBe('5 May 2025');
    key('ArrowRight');
    // out past its end: the next window, the day shown first in it
    expect(first()).toBe(momentLabelOf(THOUSAND[511]));
    expect(ticks()[0].classList.contains('on')).toBe(true);
    // a page is a window
    key('PageUp');
    expect(calls.onpick).toHaveBeenLastCalledWith(THOUSAND[532]);
    key('PageDown');
    key('PageDown');
    expect(calls.onpick).toHaveBeenLastCalledWith(THOUSAND[490]);
    expect(ticks().at(-1).classList.contains('on')).toBe(true);
  });

  it('goes anywhere from the line of all the days, and picks the day on the track, as it stood', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(214);
    const calls = show({ keys: THOUSAND, at: THOUSAND[500] });
    const line = document.body.querySelector('.overview');
    box(line, 100, 200);
    line.dispatchEvent(new PointerEvent('pointerdown', { clientX: 280, bubbles: true }));
    flushSync();
    // nine tenths along: the 899th day, the window centred on it
    expect(calls.onpick).toHaveBeenLastCalledWith(THOUSAND[899]);
    expect(ticks()[10].classList.contains('on')).toBe(true);
    line.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    // the track picks among the window's days only
    box(lane(), 0, 200);
    const track = document.body.querySelector('.track');
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, bubbles: true }));
    flushSync();
    expect(calls.onpick).toHaveBeenLastCalledWith(THOUSAND[909]);
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, bubbles: true }));
    flushSync();
    expect(calls.onpick).toHaveBeenLastCalledWith(THOUSAND[889]);
    track.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  it('keeps the handle at the edge, hollow, for a day it does not play out of the window', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(214);
    show({ keys: THOUSAND.filter((_, index) => index % 2 === 0), at: THOUSAND[501] });
    // the day after it is in the window, the handle falls between it and the day before
    expect(handle().classList.contains('off')).toBe(true);
    expect(ticks()).toHaveLength(21);
  });
});
