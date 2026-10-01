// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RuleRow from './RuleRow.svelte';
import { newRecipe, newRule } from '../../lib/map/analyzerRules.js';

const METHODS = [{ id: 'rules', sizes: { all: {} } }];
let live, target;
afterEach(() => { if (live) unmount(live); live = null; target?.remove(); });

/** A row on a rule the test can watch change: the row writes its rule back through the props it was given. */
function open(rule, extra = {}) {
  const { recipe, ...rest } = extra;
  const props = $state({ rule, recipe: newRecipe(METHODS, recipe ?? {}), index: 0, colour: '#facc15', ...rest });
  target = document.createElement('div');
  document.body.append(target);
  live = mount(RuleRow, { target, props });
  flushSync();
  return props;
}
const query = (selector) => target.querySelector(selector);
const press = (group, text) => {
  [...query(`[role="group"][aria-label="${group}"]`).querySelectorAll('button')].find((button) => button.textContent.trim() === text).click();
  flushSync();
};
const type = (input, value, event = 'change') => { input.value = value; input.dispatchEvent(new Event(event, { bubbles: true })); flushSync(); };

it('says the rule as the sentence it is, with the number and colour it wears on the map', () => {
  open(newRule('index', 'change'));
  expect(query('.sentence').textContent).toBe('NDVI dropped by 0.25 or more');
  expect(query('.dot').textContent).toBe('1');
  expect(query('.rule').getAttribute('style')).toContain('--tint: #facc15');
});

it('offers before, after and change on two dates, says where each is painted, and nothing on one date', () => {
  open(newRule('index', 'change'));
  expect([...query('[aria-label="Rule 1 reads"]').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Before', 'After', 'Change']);
  expect(query('.note').textContent).toBe('Read as after minus before and painted on both sides.');
  unmount(live); target.remove();
  const props = open(newRule('index', 'a'));
  expect(query('.note').textContent).toBe('Read on the before pass and painted on the left of the split.');
  press('Rule 1 reads', 'After');
  expect(props.rule.on).toBe('b');
  expect(query('.note').textContent).toBe('Read on the after pass and painted on the right of the split.');
  unmount(live); target.remove();
  open(newRule('index', 'b'), { recipe: { dates: 'one' } });
  expect(query('[aria-label="Rule 1 reads"]')).toBe(null);
  expect(query('.sentence').textContent).toBe('NDVI is at least 0.40');
});

it('turns a drop into a rise or a move without losing its size, and a range asks for two values', () => {
  const props = open(newRule('index', 'change'));
  expect([...query('[aria-label="Rule 1 comparison"]').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Dropped', 'Rose', 'Either way', 'Between']);
  press('Rule 1 comparison', 'Rose');
  expect(props.rule).toMatchObject({ op: 'ge', value: 0.25 });
  expect(query('.sentence').textContent).toBe('NDVI rose by 0.25 or more');
  press('Rule 1 comparison', 'Either way');
  expect(props.rule).toMatchObject({ op: 'moved', value: 0.25 });
  press('Rule 1 comparison', 'Between');
  expect(query('[aria-label="Rule 1 upper value"]')).not.toBe(null);
  expect(query('input[type="range"]')).toBe(null);
  press('Rule 1 comparison', 'Dropped');
  expect(props.rule.op).toBe('le');
  expect(query('[aria-label="Rule 1 upper value"]')).toBe(null);
});

it('sets the size of a drop as a positive number, which the rule keeps as a negative one', () => {
  const props = open(newRule('index', 'change'));
  expect(query('[aria-label="Rule 1 value"]').value).toBe('0.25');
  type(query('[aria-label="Rule 1 value"]'), '0.4');
  expect(props.rule.value).toBe(-0.4);
  type(query('[aria-label="Rule 1 line"]'), '0.6', 'input');
  expect(props.rule.value).toBe(-0.6);
  press('Rule 1 comparison', 'Rose');
  type(query('[aria-label="Rule 1 value"]'), '0.1');
  expect(props.rule.value).toBe(0.1);
});

it('shows reflectance in percent and keeps it in fractions', () => {
  const props = open(newRule('band', 'b', { band: 'B12' }));
  expect(query('[aria-label="Rule 1 value"]').value).toBe('25');
  type(query('[aria-label="Rule 1 value"]'), '30');
  expect(props.rule.value).toBe(0.3);
  expect(query('.unit').textContent).toBe('%');
});

it('puts the ground that passes in the accent: above the line for at least and a drop, below it for at most', () => {
  open(newRule('index', 'change'));
  expect(query('input[type="range"]').classList.contains('above')).toBe(true);
  unmount(live); target.remove();
  const props = open(newRule('index', 'a'));
  expect(query('input[type="range"]').classList.contains('above')).toBe(true);
  press('Rule 1 comparison', 'At most');
  expect(props.rule.op).toBe('le');
  expect(query('input[type="range"]').classList.contains('above')).toBe(false);
});

it('lays the pins along the line where the last test read them, and says which is which', () => {
  open(newRule('index', 'change'), { ticks: [
    { pin: 0, expect: 'found', at: 0.6, clipped: false, value: -0.6, passes: true },
    { pin: 1, expect: 'empty', at: 0.05, clipped: false, value: -0.05, passes: false },
  ] });
  const ticks = [...target.querySelectorAll('.line .tick')];
  expect(ticks.map((tick) => [tick.classList.contains('tick-found'), tick.classList.contains('tick-empty'), tick.classList.contains('passes')]))
    .toEqual([[true, false, true], [false, true, false]]);
  expect(ticks[0].getAttribute('style')).toContain('--at: 0.6');
  expect(ticks[0].getAttribute('aria-label')).toBe('Should be found: this rule lets it through');
  expect(ticks[1].getAttribute('aria-label')).toBe('Should stay empty: this rule turns it away');
  expect(query('.key').textContent).toContain('should be found');
});

it('has no line to lay pins on for a ground class, which is or is not a set of grounds', () => {
  const props = open(newRule('class', 'b'));
  expect(query('input[type="range"]')).toBe(null);
  expect([...query('[aria-label="Rule 1 ground classes"]').querySelectorAll('button')].map((b) => b.textContent)).toContain('water');
  press('Rule 1 comparison', 'Is not');
  expect(props.rule.op).toBe('not');
  expect(query('.sentence').textContent).toBe('ground after is not water');
});

it('measures only what its satellite reads, and only as many things as there are to choose', () => {
  open(newRule('radar', 'change'), { recipe: { sensor: 'sentinel1' } });
  expect(query('[aria-label="Rule 1 measures"]')).toBe(null);
  expect(query('[aria-label="Rule 1 polarisation"]')).not.toBe(null);
  unmount(live); target.remove();
  open(newRule('index', 'change'));
  const measures = [...query('[aria-label="Rule 1 measures"]').options].map((option) => option.value);
  expect(measures).toContain('index');
  expect(measures).not.toContain('radar');
  expect(measures).toContain('colour');
  unmount(live); target.remove();
  open(newRule('index', 'b'), { recipe: { dates: 'one' } });
  expect([...query('[aria-label="Rule 1 measures"]').options].map((option) => option.value)).not.toContain('colour');
});

it('says how much of the ground it keeps, and what the pins would come to without it, dimmed once stale', () => {
  open(newRule('index', 'change'), { index: 1, reading: { share: 0.12, kept: 0.03 }, effect: 'Without it, 1 pin would come out wrong.', match: 'all' });
  expect(query('[aria-label="Rule 2 share"]').textContent).toBe('12 % of the ground · 3.0 % left with the ones above');
  expect(query('[aria-label="Rule 2 effect"]').textContent).toBe('Without it, 1 pin would come out wrong.');
  unmount(live); target.remove();
  open(newRule('index', 'change'), { reading: { share: 0.12, kept: 0.12 }, stale: true });
  expect(query('.share').classList.contains('stale')).toBe(true);
  expect(query('.effect')).toBe(null);
});

it('shows and hides its pixels, ranks the candidates, is removed, and tells the map when the pointer is on it', () => {
  const ontoggle = vi.fn();
  const onsignal = vi.fn();
  const onremove = vi.fn();
  const onhover = vi.fn();
  open(newRule('index', 'change'), { index: 1, ontoggle, onsignal, onremove, onhover, signal: false });
  query('button.dot').click();
  query('button.star').click();
  query('button[aria-label="Remove rule 2"]').click();
  expect([ontoggle, onsignal, onremove].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  query('.rule').dispatchEvent(new Event('pointerenter'));
  query('.rule').dispatchEvent(new Event('pointerleave'));
  expect(onhover.mock.calls).toEqual([[1], [null]]);
  expect(query('button.star').getAttribute('aria-label')).toBe('Rank candidates by rule 2');
  unmount(live); target.remove();
  open(newRule('index', 'change'), { signal: true, canRemove: false });
  expect(query('button.star').disabled).toBe(true);
  expect(query('button.star').textContent).toBe('★');
  expect(query('button[aria-label="Remove rule 1"]')).toBe(null);
});

it('names what is wrong with a rule in place of its share', () => {
  open({ ...newRule('nd', 'b'), bands: ['B08', 'B08'] }, { reading: { share: 0.1, kept: 0.1 } });
  expect(query('.warn').textContent).toBe('Pick two different bands.');
  expect(query('.share')).toBe(null);
});
