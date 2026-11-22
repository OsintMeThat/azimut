// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import PlateLayers from './PlateLayers.svelte';
import PlateElements from './PlateElements.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

const rows = [
  { name: 'front', title: 'Front line', editable: true, track: { on: true, precision: 'day', zone: 'UTC' } },
  { name: 'strikes', title: 'Strikes', editable: true },
  { name: 'geoconfirmed', title: 'GeoConfirmed', editable: false },
];
const grounds = [['plain', 'Plain'], ['esri-wayback', 'World Imagery Wayback, dated'], ['esri-world-imagery', 'Esri World Imagery']];

function show(elements, props = {}) {
  const spec = $state({ elements });
  const calls = { onsettings: vi.fn(), onopen: vi.fn(), onnewlayer: vi.fn(), onkeepdrawn: vi.fn() };
  held = mount(PlateLayers, { target: document.body, props: { spec, rows, grounds, releases: [{ release: 41, date: '2024-03-12' }], ...calls, ...props } });
  flushSync();
  return { spec, calls };
}
const sections = () => [...document.body.querySelectorAll('section.map')];
const boxes = (section) => [...section.querySelectorAll('li')].map((li) => [li.querySelector('.title').textContent, li.querySelector('input').checked]);

describe('where the plate\'s maps get what they draw', () => {
  it('says each map\'s ground and the day its picture was taken, and the layers it draws first', () => {
    show([
      { id: 'm', kind: 'map', basemap: 'esri-wayback', release: 41, layers: [{ name: 'strikes', hidden: [], stroke: 1, icons: 1 }] },
      { id: 'i', kind: 'inset' },
      { id: 'd', kind: 'map', of: 'm', basemap: 'esri-world-imagery', layers: [] },
    ]);
    expect(sections().map((section) => section.querySelector('h5').textContent)).toEqual(['Map', 'Detail map']);
    expect(sections()[0].querySelector('.ground').textContent.replace(/\s+/g, ' ').trim()).toBe('Ground World Imagery Wayback, dated · 12 Mar 2024');
    expect(sections()[1].querySelector('.ground').textContent).toContain('several days');
    expect(boxes(sections()[0])).toEqual([['Strikes', true], ['Front line', false], ['GeoConfirmed', false]]);
    // a layer followed over time is marked, since the plate draws it as it stood on its day
    expect([...sections()[0].querySelectorAll('li')].map((li) => !!li.querySelector('.tag'))).toEqual([false, true, false]);
    expect(sections()[1].textContent).toContain('Draws no layer yet');
  });

  it('lets a map on a picture of one day draw its layers as they stood that day, and only such a map', () => {
    const { spec } = show([{ id: 'm', kind: 'map', basemap: 'esri-wayback', release: 41, layers: [] },
      { id: 'n', kind: 'map', basemap: 'esri-world-imagery', layers: [] }]);
    const boxes = [...document.body.querySelectorAll('.own-day input')];
    expect(boxes).toHaveLength(1);
    boxes[0].click(); flushSync();
    expect(spec.elements[0].layers_on).toBe('imagery');
    boxes[0].click(); flushSync();
    expect(spec.elements[0].layers_on).toBe('plate');
  });

  it('draws a layer on a map, or takes it off, at a tick', () => {
    const { spec } = show([{ id: 'm', kind: 'map', basemap: 'plain', layers: [] }]);
    const front = [...document.body.querySelectorAll('li')].find((li) => li.textContent.includes('Front line')).querySelector('input');
    front.click(); flushSync();
    expect(spec.elements[0].layers).toEqual([{ name: 'front', hidden: [], stroke: 1, icons: 1 }]);
    front.click(); flushSync();
    expect(spec.elements[0].layers).toEqual([]);
  });

  it('opens a layer the analyst draws in the Map, and a map\'s settings in the inspector', () => {
    const { spec, calls } = show([{ id: 'm', kind: 'map', basemap: 'plain', layers: [] }]);
    // a layer the analyst does not draw (an added source) has nothing to edit
    expect(document.body.querySelector('[aria-label="Open GeoConfirmed in the Map"]')).toBeNull();
    document.body.querySelector('[aria-label="Open Strikes in the Map"]').click();
    expect(calls.onopen).toHaveBeenCalledWith(spec.elements[0], rows[1]);
    document.body.querySelector('[aria-label="Settings of Map"]').click();
    expect(calls.onsettings).toHaveBeenCalledWith(spec.elements[0]);
    [...document.body.querySelectorAll('button')].find((button) => button.textContent.includes('New layer here')).click();
    expect(calls.onnewlayer).toHaveBeenCalledOnce();
  });

  it('draws a map\'s layers over or under each other, says what the map does to each, and opens a layer\'s page', () => {
    const onlayer = vi.fn();
    const { spec } = show([{ id: 'm', kind: 'map', basemap: 'plain', layers: [
      { name: 'strikes', hidden: [], stroke: 1, icons: 1 }, { name: 'front', hidden: ['Rumoured'], stroke: 1, icons: 1, role: 'claimed', fill: 'hatch' }] }], { onlayer });
    const named = (label) => document.body.querySelector(`[aria-label="${label}"]`);
    // the first can go no higher, the last no lower, and a layer it does not draw has no order
    expect(named('Draw Strikes higher').disabled).toBe(true);
    expect(named('Draw Front line lower').disabled).toBe(true);
    expect(named('Draw GeoConfirmed higher')).toBeNull();
    named('Draw Strikes lower').click(); flushSync();
    expect(spec.elements[0].layers.map((entry) => entry.name)).toEqual(['front', 'strikes']);
    expect([...document.body.querySelectorAll('.said')].map((node) => node.textContent)).toEqual(['Claimed · hatched · 1 group left out', 'Its own look']);
    document.body.querySelector('.said').click();
    named('Strikes on Map').click();
    expect(onlayer.mock.calls.map(([map, row]) => [map.id, row.name])).toEqual([['m', 'front'], ['m', 'strikes']]);
    expect(named('GeoConfirmed on Map')).toBeNull();
  });

  it('makes a layer of what was drawn on the map once something is', () => {
    const { spec, calls } = show([{ id: 'm', kind: 'map', basemap: 'plain', layers: [] }]);
    const button = (start) => [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(start));
    expect(button('Make a layer of')).toBeUndefined();
    spec.elements.push({ id: 'z', kind: 'zone', of: 'm', box: [0, 0, 1, 1], points: [[2, 48], [2.1, 48], [2.1, 48.1]] }); flushSync();
    button('Make a layer of the 1 drawn here').click();
    expect(calls.onkeepdrawn).toHaveBeenCalledWith(spec.elements[0]);
  });

  it('says how to start when the case has no layer, the page no map, or the plate is a template', () => {
    show([{ id: 'm', kind: 'map', basemap: 'plain', layers: [] }], { rows: [] });
    expect(document.body.textContent).toContain('The case has no map layers yet');
    unmount(held); held = null; document.body.innerHTML = '';
    show([]);
    expect(document.body.textContent).toContain('No map on the page yet');
    unmount(held); held = null; document.body.innerHTML = '';
    show([{ id: 'm', kind: 'map', basemap: 'plain', layers: [] }], { template: true });
    expect(document.body.textContent).toContain('A template keeps no layers');
    expect(document.body.querySelector('li')).toBeNull();
  });
});

describe('the list\'s two tabs', () => {
  it('shows what the page holds, or where its maps get what they draw', () => {
    const spec = $state({ elements: [{ id: 'm', kind: 'map', box: [0, 0, 10, 10], layers: [] }], time: {} });
    const layers = createRawSnippet(() => ({ render: () => '<p class="layers-panel">Layers here</p>' }));
    const props = $state({ spec, tab: 'page', layers });
    held = mount(PlateElements, { target: document.body, props });
    flushSync();
    const tabs = [...document.body.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent.replace(/\s+/g, ' ').trim())).toEqual(['On the page', 'Layers']);
    expect(tabs[0].title).toBe('What the page holds, top first: 1');
    expect(document.body.querySelector('.layers-panel')).toBeNull();
    tabs[1].click(); flushSync();
    expect(document.body.querySelector('.layers-panel')).not.toBeNull();
    expect(document.body.querySelector('.list')).toBeNull();
  });
});
