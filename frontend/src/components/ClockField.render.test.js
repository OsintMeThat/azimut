// @vitest-environment happy-dom
/**
 * The one control every date field uses to say which clock it is read on, mounted
 * and pressed: what it offers, in what order, and what a pick hands back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../lib/state.svelte.js', () => ({ caseState: { current: { id: 'case-a' } } }));

const { default: ClockField } = await import('./ClockField.svelte');
const { machineZone } = await import('../lib/timeline.js');
const { forgetAxisZone, noteAxisZone } = await import('../lib/caseAxis.svelte.js');

let live = null;
let target = null;
let picks = [];

function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  picks = [];
  live = mount(ClockField, {
    target,
    props: { value: '2026-08-11', onpick: (zone, how) => picks.push([zone, how.here]), ...props },
  });
  flushSync();
}

const trigger = () => target.querySelector('.clock-trigger');
const menu = () => document.querySelector('.clock-menu');
const rows = () => [...document.querySelectorAll('.clock-menu .rows > button')];
const names = () => rows().map((row) => row.querySelector('span').textContent);

function press(element) {
  element.click();
  flushSync();
}

function search(text) {
  const input = document.querySelector('.clock-menu .search-input');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.body.innerHTML = '';
});

describe('the clock a date is read on', () => {
  it('says the clock and its offset on that day, a place by its own name', () => {
    open({ clock: { zone: 'Europe/Kyiv', fixed: '' } });
    expect(trigger().getAttribute('aria-label')).toBe('Clock: Kyiv UTC+03:00');

    unmount(live);
    open({ value: '2026-01-11', clock: { zone: 'Europe/Kyiv', fixed: '' }, here: [{ zone: 'Europe/Kyiv', place: 'Kharkiv' }] });
    expect(trigger().getAttribute('aria-label')).toBe('Clock: Kharkiv UTC+02:00');
  });

  it('says an offset written with no zone, and a clock nobody knows', () => {
    open({ clock: { zone: null, fixed: '+04:30' } });
    expect(trigger().getAttribute('aria-label')).toBe('Clock: UTC+04:30');
    unmount(live);
    open({ clock: { zone: null, fixed: '' } });
    expect(trigger().getAttribute('aria-label')).toBe('Clock: Clock unknown');
  });

  it('offers the entry’s places first, then UTC and this computer, then the world', () => {
    open({ clock: { zone: 'UTC', fixed: '' }, here: [{ zone: 'Europe/Kyiv', place: 'Kharkiv' }] });
    press(trigger());

    const offered = names();
    expect(offered[0]).toBe('Local at Kharkiv');
    expect(offered[1]).toBe('UTC');
    if (machineZone() !== 'UTC') expect(offered[2]).toBe(machineZone().split('/').at(-1).replace(/_/g, ' '));
    expect(menu().textContent).toContain('Anywhere in the world');
    // a date has no clock to leave unknown
    expect(offered).not.toContain('Clock unknown');
  });

  it('offers the case’s clock, the one its axis reads on', () => {
    noteAxisZone('case-a', 'America/Los_Angeles');
    try {
      open({ clock: { zone: 'UTC', fixed: '' }, here: [{ zone: 'Europe/Kyiv', place: 'Kharkiv' }] });
      press(trigger());
      expect(names().slice(0, 2)).toEqual(['Local at Kharkiv', 'Los Angeles']);
      expect(rows()[1].textContent).toContain("the case's clock");
      press(rows()[1]);
      expect(picks).toEqual([['America/Los_Angeles', false]]);
    } finally {
      forgetAxisZone();
    }
  });

  it('offers an unknown clock for a time only', () => {
    open({ value: '2026-08-11T14:30:00', timed: true, clock: { zone: 'UTC', fixed: '' } });
    press(trigger());
    press(rows().find((row) => row.textContent.includes('Clock unknown')));
    expect(picks).toEqual([[null, false]]);
  });

  it('finds any zone by search, and says whether a pick was one of the places', () => {
    open({ clock: { zone: 'UTC', fixed: '' }, here: [{ zone: 'Europe/Kyiv', place: 'Kharkiv' }] });
    press(trigger());
    search('tokyo');
    expect(names()).toEqual(['Tokyo']);
    press(rows()[0]);
    expect(picks.at(-1)).toEqual(['Asia/Tokyo', false]);
    expect(menu()).toBeNull();

    press(trigger());
    press(rows().find((row) => row.textContent.includes('Local at Kharkiv')));
    expect(picks.at(-1)).toEqual(['Europe/Kyiv', true]);
  });

  it('brings back the zones picked lately in this case', () => {
    open({ clock: { zone: 'UTC', fixed: '' } });
    press(trigger());
    search('aden');
    press(rows()[0]);

    press(trigger());
    expect(names()[0]).toBe('Aden');
    expect(rows()[0].textContent).toContain('used lately');
  });

  it('closes on Escape without picking', () => {
    open({ clock: { zone: 'UTC', fixed: '' } });
    press(trigger());
    menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(menu()).toBeNull();
    expect(picks).toEqual([]);
  });
});
