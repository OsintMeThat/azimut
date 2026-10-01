// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { Bench } from '../../lib/map/bench.svelte.js';
import { newCheck, newRecipe } from '../../lib/map/analyzerRules.js';
import PassDates from './PassDates.svelte';

const METHODS = [{ id: 'rules', sizes: { all: {} } }];
const VIEW = { west: 2, south: 48, east: 2.2, north: 48.2 };
const JUNE = { dates: [{ date: '2026-06-03', cloud: 5, coverage: 1 }, { date: '2026-06-18', cloud: 40, coverage: 1 }] };

let live, bench, target, calls;
beforeEach(() => { vi.useFakeTimers(); calls = []; });
afterEach(() => {
  if (live) unmount(live);
  bench?.destroy();
  live = bench = null;
  target?.remove();
  vi.useRealTimers();
});

function open({ dates = 'two', sensor = 'sentinel2', check = {} } = {}) {
  const recipe = $state({ ...newRecipe(METHODS, { sensor, dates }), name: 'Mine', checks: [] });
  const api = { post: vi.fn(async (url, body) => { calls.push([url, body]); return JUNE; }) };
  bench = new Bench({ api, recipe, limits: { max_checks: 12 }, viewBounds: () => VIEW });
  bench.startDraft();
  Object.assign(bench.draft.check, check);
  target = document.createElement('div');
  document.body.append(target);
  live = mount(PassDates, { target, props: { bench } });
  flushSync();
}
const settle = async () => { await vi.advanceTimersByTimeAsync(10); flushSync(); };
const pick = (name) => target.querySelector(`button[aria-label="${name}"]`);

it('has a button for each side of a check of two dates, and one for a single pass', () => {
  open();
  expect([...target.querySelectorAll('.side strong')].map((node) => node.textContent)).toEqual(['Before', 'After']);
  expect(pick('Before pass').textContent).toContain('Choose a pass');
  unmount(live); bench.destroy(); target.remove();
  open({ dates: 'one' });
  expect([...target.querySelectorAll('.side strong')].map((node) => node.textContent)).toEqual(['Pass']);
});

it('opens a calendar for a side, reads its month once, and picks a day of it', async () => {
  open({ check: { b: { provider: 'sentinel2', date: '2026-06-18', layer: 'TRUE_COLOR', maxcc: 100 } } });
  pick('Before pass').click(); await settle();
  expect(pick('Before pass').getAttribute('aria-expanded')).toBe('true');
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toMatchObject({ collection: 'sentinel2', zones: [expect.objectContaining({ kind: 'rect' })] });
  // the calendar shows June 2026 when the other side is in June; only days with a pass before B can be picked
  const days = [...target.querySelectorAll('.pass-calendar .day')];
  expect(days.filter((day) => !day.disabled).map((day) => day.getAttribute('aria-label').slice(0, 10))).toEqual(['2026-06-03']);
  target.querySelector('button[aria-label^="2026-06-03"]').click(); await settle();
  expect(bench.check.a.date).toBe('2026-06-03');
  expect(bench.calendar.side).toBe('');
  expect(target.querySelector('.pass-calendar')).toBe(null);
  expect(pick('Before pass').textContent).toContain('2026-06-03');
});

it('takes a typed day for one the calendar does not show, and closes from the same button', async () => {
  open();
  pick('After pass').click(); await settle();
  expect(target.querySelector('details.manual-date summary').textContent).toBe('Enter a date');
  bench.typeDay('b', '2026-06-10'); await settle();
  expect(bench.check.b.date).toBe('2026-06-10');
  expect(target.querySelector('.pass-calendar')).not.toBe(null);      // still open for the next try
  pick('After pass').click(); await settle();
  expect(target.querySelector('.pass-calendar')).toBe(null);
});

it('moves from one side to the other with the calendar of the side pressed', async () => {
  open();
  pick('Before pass').click(); await settle();
  expect(target.querySelector('.pass-calendar').getAttribute('aria-label')).toBe('Before pass calendar');
  pick('After pass').click(); await settle();
  expect(target.querySelector('.pass-calendar').getAttribute('aria-label')).toBe('After pass calendar');
});
