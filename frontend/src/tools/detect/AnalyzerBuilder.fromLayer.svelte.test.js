// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { newRecipe } from '../../lib/map/analyzerRules.js';

/**
 * Building a rule out of a layer written here.
 *
 * The menu lists *every* layer, because a layer silently missing from it reads
 * as "rules cannot be built from my layers", which is the opposite of what is
 * true. The ones that are one quantity are offered; the ones that are not carry
 * the reason and cannot be pressed.
 */

const LAYERS = [
  { id: 'PLUME', label: 'Plume', form: { way: 'index', high: 'B12', low: 'B11', threshold: 0.15 } },
  { id: 'B12_GREY', label: 'B12', form: { way: 'composite', red: 'B12', green: 'B12', blue: 'B12', gain: 2.5 } },
  { id: 'FALSE_COLOUR', label: 'False colour', form: { way: 'composite', red: 'B08', green: 'B04', blue: 'B03', gain: 2.5 } },
  { id: 'HAND', label: 'Hand written', form: null },
];

let served = LAYERS;
const got = vi.fn();
vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(async (path) => {
      got(path);
      return { layers: served, max: 40, bands: [], radar_layer: 'RADAR' };
    }),
    post: vi.fn(async () => ({ tiles: 1, missing: 0 })),
  },
}));
vi.mock('../../lib/state.svelte.js', () => ({ toast: vi.fn() }));

const AnalyzerBuilder = (await import('./AnalyzerBuilder.svelte')).default;

const METHODS = [{ id: 'rules', sizes: { all: {} } }];
let live, target;
// A rune, so the builder's `$bindable` recipe is the reactive object it expects.
let recipe = $state(null);

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.body.innerHTML = '';
});

async function open({ wait = true } = {}) {
  recipe = { ...newRecipe(METHODS, { dates: 'two' }), name: 'Mine' };
  target = document.createElement('div');
  document.body.append(target);
  live = mount(AnalyzerBuilder, {
    target,
    props: {
      catalogue: { rules: { max_rules: 6 }, methods: METHODS, radar_layer: 'RADAR' },
      get recipe() { return recipe; },
      set recipe(next) { recipe = next; },
      isNew: true,
      layers: [],
    },
  });
  if (!wait) return recipe;
  await vi.waitFor(() => {
    flushSync();
    if (!target.querySelector('.from-layer')) throw new Error('not read yet');
  });
  return recipe;
}

const button = (label) =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));
const options = () => [...target.querySelectorAll('.layer-opt')];

beforeEach(() => {
  served = LAYERS;
  got.mockClear();
});

it('lists every layer written here, offered or with the reason it is not', async () => {
  await open();
  button('Reuse a formula').click();
  flushSync();
  const rows = options().map((node) => ({
    name: node.querySelector('.layer-name').textContent.trim(),
    says: node.querySelector('.layer-sum').textContent.trim(),
    off: node.disabled,
  }));
  expect(rows).toEqual([
    { name: 'Plume', says: '(B12 − B11) / (B12 + B11) ≥ 0.15', off: false },
    { name: 'B12', says: 'B12 reflectance', off: false },
    { name: 'False colour', says: 'three bands in colour, not one quantity', off: true },
    { name: 'Hand written', says: 'written as a script, so no quantity to read', off: true },
  ]);
});

it('adds an index layer as the normalised difference it paints', async () => {
  const made = await open();
  const before = made.rules.length;
  button('Reuse a formula').click();
  flushSync();
  options()[0].click();
  flushSync();
  expect(recipe.rules).toHaveLength(before + 1);
  expect(recipe.rules.at(-1)).toMatchObject({
    measure: 'nd', bands: ['B12', 'B11'], op: 'ge', value: 0.15,
  });
});

it('adds a band painted grey as that band, on the line a band rule starts at', async () => {
  const made = await open();
  const before = made.rules.length;
  button('Reuse a formula').click();
  flushSync();
  options()[1].click();
  flushSync();
  expect(recipe.rules).toHaveLength(before + 1);
  // the gain the layer is drawn with is not a threshold, so the rule takes its own
  expect(recipe.rules.at(-1)).toMatchObject({ measure: 'band', band: 'B12', op: 'ge', value: 0.25 });
});

it('reads the layer list once, even when there is nothing in it', async () => {
  /*
   * A regression with teeth: waiting on `mine.length` made an empty list its
   * own trigger. The read assigns a fresh array, the array is the effect's
   * dependency, and the effect reads again — forever. One analyzer builder in a
   * test file took a worker from 7 seconds to a 4 GB heap death.
   */
  served = [];
  await open({ wait: false });
  await vi.waitFor(() => expect(got).toHaveBeenCalled());
  const after = got.mock.calls.length;
  // nothing more arrives on its own
  await new Promise((resolve) => setTimeout(resolve, 60));
  flushSync();
  expect(got.mock.calls.length).toBe(after);
  expect(after).toBeLessThanOrEqual(1);
  // and with nothing to offer, the button is not there at all
  expect(target.querySelector('.from-layer')).toBe(null);
});
