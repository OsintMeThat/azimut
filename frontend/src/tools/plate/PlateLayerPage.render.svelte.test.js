// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateLayerPage from './PlateLayerPage.svelte';
import { houseLayout } from '../../lib/plate/page.js';

let held = null;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00Z')); });
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; vi.useRealTimers(); });

const front = { name: 'front', title: 'Front', categories: [{ name: 'Held' }, { name: 'Rumoured' }], editable: true };
const fresh = (extra = {}) => ({ name: 'front', hidden: [], stroke: 1, icons: 1, ...extra });
const settle = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); flushSync(); };
const press = (node) => { node.click(); flushSync(); };
const named = (label) => document.body.querySelector(`[aria-label="${label}"]`);
const button = (text) => [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); flushSync(); };
// what the pointer can rest on: every field, every chooser, every key and every button, each saying what it does
const bare = () => [...document.body.querySelectorAll('.layer-page :is(select, input, [role="group"], .key, button.btn)')]
  .filter((node) => !node.closest('[title]')?.getAttribute('title')).map((node) => node.getAttribute('aria-label') || node.textContent.trim());

/** The page of `front` on the first of the plate's maps, a second map drawing it too when `second` is given. */
function show({ entry = fresh(), second = null, at = '2026-10-05', props = {} } = {}) {
  const spec = $state(houseLayout());
  spec.time = { ...spec.time, at };
  const map = spec.elements.find((element) => element.kind === 'map');
  map.layers = [entry];
  if (second) spec.elements.push({ ...JSON.parse(JSON.stringify(map)), id: 'other', name: 'After', layers: [second] });
  held = mount(PlateLayerPage, { target: document.body, props: { spec, map, name: 'front', rows: [front], at, ...props } });
  flushSync();
  return { spec, map, other: spec.elements.find((element) => element.id === 'other') };
}

describe('a layer on a page of its own', () => {
  it('says which map it is on, that what is set changes that map only, and goes back to it', () => {
    const back = vi.fn();
    show({ props: { onback: back } });
    expect(document.body.querySelector('h3').textContent).toBe('Front');
    expect(document.body.querySelector('.where').textContent).toContain('On Map');
    expect(document.body.querySelector('.where').textContent).toContain('changes this map only');
    press(document.body.querySelector('.back'));
    expect(back).toHaveBeenCalled();
  });

  it('gives a layer what it stands for in one press, its fill with it, and its own look back', () => {
    const { spec, map } = show();
    expect(button('Back to its own look')).toBeUndefined();
    choose(named('Front stands for'), 'claimed');
    expect(map.layers[0]).toMatchObject({ name: 'front', role: 'claimed', colour: spec.theme.accent, fill: 'hatch', dash: 'dashed' });
    const fill = (label) => [...named('Front areas on this plate').querySelectorAll('button')].find((node) => node.textContent === label);
    expect(fill('Hatched').getAttribute('aria-pressed')).toBe('true');
    press(fill('Full'));
    expect(map.layers[0].fill).toBe('solid');
    press(button('Back to its own look'));
    expect(map.layers[0]).toMatchObject({ role: '', colour: null, fill: '', dash: '', stroke: 1, icons: 1 });
    expect(button('Back to its own look')).toBeUndefined();
  });

  it('sets its lines, weights and colour on this map', () => {
    const { map } = show();
    press([...named('Front lines on this plate').querySelectorAll('button')].find((node) => node.textContent === 'Dotted'));
    const weight = named('Front line weight');
    weight.value = '2'; weight.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    const marks = named('Front mark size');
    marks.value = '1.5'; marks.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(map.layers[0]).toMatchObject({ dash: 'dotted', stroke: 2, icons: 1.5 });
    expect(document.body.querySelector('.colour').textContent).toContain('its own colours');
    press(button('None'));
    expect(map.layers[0].colour).toBeNull();
  });

  it('leaves a group out of this map and shows it again', () => {
    const { map } = show();
    const chip = (text) => [...document.body.querySelectorAll('.chip')].find((node) => node.textContent === text);
    press(chip('Rumoured'));
    expect(map.layers[0].hidden).toEqual(['Rumoured']);
    expect(chip('Rumoured').classList.contains('off')).toBe(true);
    press(chip('Rumoured'));
    expect(map.layers[0].hidden).toEqual([]);
  });

  it('starts a dated layer on a day of the map, and puts the plate on it when it stood before', async () => {
    const { spec, map } = show({ props: { datedLayer: () => true } });
    expect(named('Front first day').textContent).toContain('Its first day');
    press(named('Front first day'));
    press(button('This day'));
    expect(map.layers[0].start).toBe('2026-10-05');
    expect(spec.time.at).toBe('2026-10-05');
    press(named('Front first day'));
    press(document.body.querySelector('button[title="2026-10-12"]'));
    expect(map.layers[0].start).toBe('2026-10-12');
    expect([spec.time.at, spec.time.step]).toEqual(['2026-10-12', null]);
    press(named('Front first day'));
    await settle();
    expect(bare()).toEqual([]);
    press(button('Its first day'));
    expect(map.layers[0].start).toBeNull();
  });

  it('ends a dated layer on a day, one calendar open at a time, the first day pulled back rather than crossed', () => {
    const { spec, map } = show({ entry: fresh({ start: '2026-10-05' }), at: '2026-10-15', props: { datedLayer: () => true } });
    press(named('Front last day'));
    expect(named('Front last day calendar')).not.toBeNull();
    expect(named('Front first day calendar')).toBeNull();
    press(document.body.querySelector('button[title="2026-10-12"]'));
    expect([map.layers[0].start, map.layers[0].end]).toEqual(['2026-10-05', '2026-10-12']);
    expect([spec.time.at, spec.time.step]).toEqual(['2026-10-12', null]);
    press(named('Front last day'));
    press(document.body.querySelector('button[title="2026-10-02"]'));
    expect([map.layers[0].start, map.layers[0].end]).toEqual(['2026-10-02', '2026-10-02']);
  });

  it('has no days to set on a layer that is not dated', () => {
    show({ props: { datedLayer: () => false } });
    expect(named('Front first day')).toBeNull();
  });

  it('lists the features hidden on the map by name, each shown again by a press', () => {
    const { map } = show({ entry: fresh({ hidden_features: ['post', '~Gate@2.30000,48.86000'] }),
      props: { featureName: (layer, id) => (layer === 'front' && id === 'post' ? 'Post' : '') } });
    const chips = () => [...document.body.querySelectorAll('.hidden-here .chip')];
    expect(chips().map((chip) => chip.textContent)).toEqual(['Post', 'No name']);
    press(chips()[0]);
    expect(map.layers[0].hidden_features).toEqual(['~Gate@2.30000,48.86000']);
    press(chips()[0]);
    expect(document.body.querySelector('.hidden-here')).toBeNull();
    expect(document.body.textContent).toContain('A right-click on one of its features');
  });

  it('gives the other maps that draw it this look and these groups, their days their own', () => {
    const { map, other } = show({ entry: fresh({ role: 'held', fill: 'solid', colour: '#c8102e', hidden: ['Rumoured'], start: '2026-10-01' }),
      second: fresh({ end: '2026-10-09' }) });
    press(button('Same on the other map'));
    expect(other.layers[0]).toMatchObject({ role: 'held', fill: 'solid', colour: '#c8102e', hidden: ['Rumoured'], end: '2026-10-09' });
    expect(other.layers[0].start).toBeUndefined();
    expect(map.layers[0].start).toBe('2026-10-01');
    // alike now: the press has nothing left to give
    expect(button('Same on every map').disabled).toBe(true);
  });

  it('moves to the same layer on another map that draws it', () => {
    const onmap = vi.fn();
    show({ second: fresh(), props: { onmap } });
    const select = named('Map the layer is set on');
    expect([...select.options].map((option) => option.textContent)).toEqual(['Map', 'After']);
    choose(select, 'other');
    expect(onmap).toHaveBeenCalledWith(expect.objectContaining({ id: 'other' }));
  });

  it('opens a layer the analyst draws in the Map, labels its names, and takes it off this map', () => {
    const opened = vi.fn();
    const labelled = vi.fn();
    const back = vi.fn();
    const { map } = show({ props: { onopen: opened, onlabels: labelled, onback: back } });
    press(button('Edit the layer in the Map'));
    press(button('Label its named features'));
    expect(opened).toHaveBeenCalledWith(map, front);
    expect(labelled).toHaveBeenCalledWith(map, front);
    press(button('Take it off this map'));
    expect(map.layers).toEqual([]);
    expect(back).toHaveBeenCalled();
  });

  it('says what each of its settings does', async () => {
    show({ entry: fresh({ hidden_features: ['post'] }), second: fresh(), props: { datedLayer: () => true, onopen: () => {}, onlabels: () => {}, onmap: () => {} } });
    await settle();
    expect(bare()).toEqual([]);
  });
});
