// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { Bench } from '../../lib/map/bench.svelte.js';
import { newCheck, newRecipe, signature } from '../../lib/map/analyzerRules.js';
import AnalyzerChecks from './AnalyzerChecks.svelte';

const METHODS = [{ id: 'rules', sizes: { all: {} } }];
const pass = (date) => ({ provider: 'sentinel2', date, layer: 'TRUE_COLOR', maxcc: 100 });
const made = (name, marks = [{ point: [2.01, 48.01], expect: 'found' }, { point: [2.05, 48.05], expect: 'empty' }], extra = {}) =>
  ({ ...newCheck({ name, a: pass('2026-05-04'), b: pass('2026-05-11'), marks }), ...extra });

let live, bench, target;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  if (live) unmount(live);
  bench?.destroy();
  live = bench = null;
  target?.remove();
  vi.useRealTimers();
});

function open({ dates = 'two', checks = [] } = {}) {
  const recipe = $state({ ...newRecipe(METHODS, { dates }), name: 'Mine', checks });
  const api = { post: vi.fn(async (url, body) => (url.endsWith('/plan') ? { tiles: 1, missing: 2 }
    : { ready: true, missing: 0, count: 1, covered: body.check.marks.map((mark) => mark.expect === 'found'), size: 512, tiles: [],
      rules: [], candidates: [], readings: [] })) };
  bench = new Bench({ api, recipe, limits: { max_checks: 2, max_marks: 20 }, viewBounds: () => null });
  target = document.createElement('div');
  document.body.append(target);
  live = mount(AnalyzerChecks, { target, props: { bench } });
  flushSync();
  return recipe;
}
const settle = async () => { await vi.advanceTimersByTimeAsync(300); flushSync(); };
const query = (selector) => target.querySelector(selector);
const named = (text) => [...target.querySelectorAll('button')].find((button) => button.textContent.trim().startsWith(text));
const click = (node) => { node.click(); flushSync(); };

it('says what a check is, and that one is needed, while there are none', () => {
  open();
  expect(query('.hint').textContent).toBe('A check is two passes and the pins that say where something should be found and where nothing may be.');
  expect(query('.need').textContent).toBe('Saving needs a check with a pin where something should be found.');
  expect(named('Test all')).toBeUndefined();
});

it('lists each check with its passes and how it last came out, and puts the one pressed on the map', async () => {
  const recipe = open({ checks: [made('The plot'), made('The reef', [], {})] });
  await settle();
  const rows = [...target.querySelectorAll('.check')].map((row) => row.querySelector('.open').textContent.replace(/\s+/g, ' ').trim());
  expect(rows[0]).toBe('The plot Before 2026-05-04 → After 2026-05-11 Not tested yet · 2 requests to read');
  expect(rows[1]).toContain('Needs a pin');
  expect(query('.check:last-child .state').textContent).toBe('!');
  click(query('button[aria-label="Put the check The plot on the map"]'));
  expect(bench.selected).toBe(recipe.checks[0].id);
  expect(query('.check.on')).not.toBe(null);
  click(query('button[aria-label="Put the check The plot on the map"]'));
  expect(bench.selected).toBe(null);
});

it('reads one date as a date, and a check with no pass as none', () => {
  open({ dates: 'one', checks: [made('Ships', [{ point: [2, 48], expect: 'found' }], { a: {} }), made('Nothing', [{ point: [2, 48], expect: 'found' }], { a: {}, b: { date: '' } })] });
  const lines = [...target.querySelectorAll('.check')].map((row) => row.querySelectorAll('small')[0].textContent);
  expect(lines).toEqual(['2026-05-11', 'no passes yet']);
});

it('opens the check on the map for renaming, changing its passes, and turning or removing its pins', async () => {
  const recipe = open({ checks: [made('The plot')] });
  bench.select(recipe.checks[0].id); flushSync();
  const name = query('input[aria-label="Check name"]');
  name.value = 'The burned plot'; name.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
  expect(recipe.checks[0].name).toBe('The burned plot');
  click(named('Change'));
  expect(bench.editingPasses).toBe(true);
  const pins = [...target.querySelectorAll('.marks li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  expect(pins).toEqual(['Should be found Turn', 'Should stay empty Turn']);
  click(query('button[aria-label="Turn pin 2 into a pin that should be found"]'));
  expect(recipe.checks[0].marks.map((mark) => mark.expect)).toEqual(['found', 'found']);
  click(query('button[aria-label="Remove pin 1"]'));
  expect(recipe.checks[0].marks).toHaveLength(1);
});

it('shows a verdict on each pin once the check has been tested with the rules as they stand', async () => {
  const recipe = open({ checks: [made('The plot')] });
  bench.select(recipe.checks[0].id); flushSync();
  await settle();
  expect(query('.verdict')).toBe(null);
  await bench.test(); flushSync();
  expect([...target.querySelectorAll('.verdict')].map((node) => node.textContent)).toEqual(['✓', '✓']);
  expect(query('.check .state').textContent).toBe('✓');
  expect(query('.outcome').textContent).toBe('1 of 1 found · stayed empty');
  expect(recipe.checks[0].result.signature).toBe(signature(recipe));
});

it('tests them all, says what that would cost, and stops at the limit of checks', async () => {
  const recipe = open({ checks: [made('One'), made('Two')] });
  await settle();
  expect(named('Test all').textContent.trim()).toBe('Test all · up to 4 requests');
  expect(named('New check').disabled).toBe(true);          // two checks is the limit here
  click(named('Test all')); await settle();
  expect(recipe.checks.map((check) => check.result?.count)).toEqual([1, 1]);
  expect(named('Test all').textContent.trim()).toBe('Test all');
});

it('removes a check', () => {
  const recipe = open({ checks: [made('The plot')] });
  click(query('button[aria-label="Remove the check The plot"]'));
  expect(recipe.checks).toHaveLength(0);
});
