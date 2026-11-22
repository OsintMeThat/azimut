// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateMapBar from './PlateMapBar.svelte';
import { createPlateSentinel } from './plateSentinel.svelte.js';
import { api } from '../../lib/api.js';

let held = null;
/** The effect roots a plate's Sentinel-2 choices live in, as MapPlate's would. */
let roots = [];
afterEach(() => { if (held) unmount(held); held = null; roots.forEach((stop) => stop()); roots = []; document.body.innerHTML = ''; vi.useRealTimers(); });

function show(element, props = {}) {
  const state = $state(element);
  held = mount(PlateMapBar, { target: document.body, props: { element: state, grounds: [['plain', 'Plain'], ['plain-news', 'Newsroom'], ['plain-dark', 'Plain, dark'],
    ['esri-world-imagery', 'Esri World Imagery']], ...props } });
  flushSync();
  return state;
}
const button = (label) => document.body.querySelector(`[aria-label="${label}"]`);
const item = (label) => [...document.body.querySelectorAll('.fm-item')].find((node) => node.textContent.trim() === label);

describe('a plate map\'s own bar', () => {
  it('says how many of the case\'s layers the map draws, and opens them on a press', () => {
    let asked = 0;
    show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [], layers: [{ name: 'front' }, { name: 'strikes' }] },
      { onlayers: () => { asked += 1; } });
    expect(button('Layers').textContent.trim()).toBe('2 layers');
    button('Layers').click();
    expect(asked).toBe(1);
  });

  it('frames a map as the other map of its group at a press, never while it keeps the framing before it', () => {
    let asked = 0;
    show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [] }, { onsameview: () => { asked += 1; } });
    button('Same view as the other map').click();
    expect(asked).toBe(1);
    unmount(held); held = null; document.body.innerHTML = '';
    show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [] }, { onsameview: () => {}, keep: true });
    expect(button('Same view as the other map').disabled).toBe(true);
    unmount(held); held = null; document.body.innerHTML = '';
    show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [] });
    expect(button('Same view as the other map')).toBeNull();
  });

  it('says a map that draws none of the case\'s layers, and has no such button for an inset or with nowhere to show them', () => {
    show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [], layers: [] }, { onlayers: () => {} });
    expect(button('Layers').textContent.trim()).toBe('No layer');
    expect(button('Layers').classList.contains('none')).toBe(true);
    unmount(held); held = null; document.body.innerHTML = '';
    show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [], layers: [] });
    expect(button('Layers')).toBeNull();
  });

  it('turns the map a step either way, and a press on the compass puts north up', () => {
    const element = show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 10 }, basemap: 'plain', overlays: [] });
    button('Turn the map left').click();
    expect(element.view.bearing).toBe(25);
    button('Turn the map right').click(); button('Turn the map right').click();
    expect(element.view.bearing).toBe(-5);
    const dial = document.body.querySelector('.dial');
    dial.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(element.view.bearing).toBe(0);
  });

  it('keeps its hover words off a menu it has opened, so they never cover it', () => {
    show({ id: 'm', kind: 'map', basemap: 'esri-wayback', release: 41, view: { lat: 0, lon: 0, zoom: 4 }, layers: [] },
      { grounds: [['esri-wayback', 'World Imagery Wayback, dated']], releases: [{ release: 41, date: '2024-03-12' }] });
    for (const label of ['Ground', 'Ground\'s day']) {
      expect(button(label).title).not.toBe('');
      button(label).click(); flushSync();
      expect(button(label).getAttribute('aria-expanded')).toBe('true');
      expect(button(label).hasAttribute('title')).toBe(false);
      button(label).click(); flushSync();
      expect(button(label).title).not.toBe('');
    }
  });

  it('wraps a turn round the half circle', () => {
    const element = show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 175 }, basemap: 'plain', overlays: [] });
    button('Turn the map left').click();
    expect(element.view.bearing).toBe(-170);
  });

  it('changes the ground and what lies over it from one menu, the relief asked for wherever the ground does not shade its own', () => {
    const element = show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [] });
    button('Ground').click(); flushSync();
    item('Relief shading').click(); flushSync();
    expect(element.overlays).toEqual(['relief']);
    item('Esri World Imagery').click(); flushSync();
    expect(element.basemap).toBe('esri-world-imagery');
    button('Ground').click(); flushSync();
    expect(item('Relief shading')).toBeDefined();
    expect(item('Borders and big names')).toBeDefined();
    item('Newsroom').click(); flushSync();
    expect(element.basemap).toBe('plain-news');
    button('Ground').click(); flushSync();
    expect(item('Relief shading')).toBeUndefined();
  });

  it('frames and turns a map, only changes the ground of an inset', () => {
    let framed = 0;
    show({ kind: 'inset', basemap: 'plain', overlays: [] }, { onframe: () => { framed += 1; } });
    expect(button('Frame the map')).toBeNull();
    expect(button('Turn the map left')).toBeNull();
    expect(button('Ground')).not.toBeNull();
    unmount(held); held = null; document.body.innerHTML = '';
    show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [] }, { onframe: () => { framed += 1; } });
    button('Frame the map').click();
    expect(framed).toBe(1);
  });

  it('holds a day\'s framing to the one before until it is let go, and frames it there on its own after', () => {
    const element = { kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [] };
    const seen = [];
    const kept = [];
    show(element, { view: { lat: 1, lon: 1, zoom: 9, bearing: 0 }, keep: true, onview: (next) => seen.push(next), onkeep: (keep) => kept.push(keep) });
    const box = document.body.querySelector('.keep input');
    expect(box.checked).toBe(true);
    // held: the hand frames nothing here
    expect(button('Zoom the map in').disabled).toBe(true);
    expect(button('Turn the map left').disabled).toBe(true);
    box.click();
    expect(kept).toEqual([false]);
    unmount(held); held = null; document.body.innerHTML = '';
    show(element, { view: { lat: 1, lon: 1, zoom: 9, bearing: 0 }, keep: false, onview: (next) => seen.push(next) });
    button('Zoom the map in').click();
    // the day's own framing moves, never the map's view under it
    expect(seen.at(-1)).toEqual({ lat: 1, lon: 1, zoom: 9.5, bearing: 0 });
    expect(element.view.zoom).toBe(5);
  });

  it('says nothing of the framing before on the first day, and leans a map in 3D', () => {
    const element = show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0, pitch: 50 }, terrain: 1.5, basemap: 'plain', overlays: [] });
    expect(document.body.querySelector('.keep')).toBeNull();
    button('Tilt the map more').click();
    expect(element.view.pitch).toBe(60);
    button('Tilt the map less').click(); button('Tilt the map less').click();
    expect(element.view.pitch).toBe(40);
  });

  it('lays the key-less layers of the Map over any ground', () => {
    const element = show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'esri-world-imagery', overlays: [] });
    button('Ground').click(); flushSync();
    item('Railways').click(); flushSync();
    item('Power lines and plants').click(); flushSync();
    expect(element.overlays).toEqual(['railway', 'power']);
  });

  describe('the ground\'s day', () => {
    const grounds = [['plain', 'Plain'], ['esri-world-imagery', 'Esri World Imagery'], ['esri-wayback', 'World Imagery Wayback, dated'],
      ['s2cloudless', "Sentinel-2 cloudless, a year's mosaic"], ['sentinel2', 'Sentinel-2, one dated pass'], ['osm', 'OpenStreetMap']];
    const releases = [{ release: 900, date: '2025-02-20' }, { release: 41, date: '2024-03-12' }];
    const years = [{ year: 2025, licence: 'CC BY-NC-SA 4.0', free: false }, { year: 2016, licence: 'CC BY 4.0', free: true }];
    const map = (fields) => ({ id: 'm', kind: 'map', view: { lat: 47.5, lon: 34.6, zoom: 12, bearing: 0 }, overlays: [], ...fields });
    const chip = () => button('Ground\'s day');
    const choice = (label) => [...document.body.querySelectorAll('.float-menu .fm-item')].find((node) => node.querySelector('.fm-grow')?.textContent.trim() === label);
    const layered = () => [...document.body.querySelectorAll('.float-menu label')].find((node) => node.textContent.includes('Layers as they stood that day'));

    it('is said beside the ground that has one, and nowhere else', () => {
      for (const [fields, said] of [[{ basemap: 'esri-wayback', release: 41 }, '12 Mar 2024'], [{ basemap: 'esri-wayback' }, '20 Feb 2025'],
        [{ basemap: 's2cloudless' }, '2025'], [{ basemap: 'sentinel2', acquired: '2026-10-08' }, '8 Oct 2026'], [{ basemap: 'sentinel2' }, 'No pass yet']]) {
        show(map(fields), { grounds, releases, years });
        expect(chip().textContent.trim()).toBe(said);
        unmount(held); held = null; document.body.innerHTML = '';
      }
      for (const basemap of ['plain', 'esri-world-imagery', 'osm']) {
        show(map({ basemap }), { grounds, releases, years });
        expect(chip()).toBeNull();
        unmount(held); held = null; document.body.innerHTML = '';
      }
      // an inset keeps its ground plain: no day of its own on its bar
      show({ kind: 'inset', basemap: 'esri-wayback', overlays: [] }, { grounds, releases, years });
      expect(chip()).toBeNull();
    });

    it('picks a Wayback release from its menu, newest first, and draws the layers as they stood that day', () => {
      const element = show(map({ basemap: 'esri-wayback', release: 41, layers: [] }), { grounds, releases, years });
      chip().click(); flushSync();
      expect(document.body.querySelector('.float-menu .fm-head').textContent).toBe('Wayback release');
      expect([...document.body.querySelectorAll('.float-menu [role="menuitemradio"] .fm-grow')].map((node) => node.textContent)).toEqual(['Newest', '20 Feb 2025', '12 Mar 2024']);
      expect(choice('12 Mar 2024').getAttribute('aria-checked')).toBe('true');
      choice('20 Feb 2025').click(); flushSync();
      expect(element.release).toBe(900);
      expect(chip().textContent.trim()).toBe('20 Feb 2025');
      layered().querySelector('input').click(); flushSync();
      expect(element.layers_on).toBe('imagery');
      layered().querySelector('input').click(); flushSync();
      expect(element.layers_on).toBe('plate');
      choice('Newest').click(); flushSync();
      expect(element.release).toBeNull();
      // another ground closes it, and coming back does not open it again
      element.basemap = 'plain'; flushSync();
      expect(chip()).toBeNull();
      expect(document.body.querySelector('.float-menu')).toBeNull();
      element.basemap = 'esri-wayback'; flushSync();
      expect(chip().getAttribute('aria-expanded')).toBe('false');
      expect(document.body.querySelector('.float-menu')).toBeNull();
    });

    it('offers no layers switch on a template, nor before the release\'s day is known', () => {
      show(map({ basemap: 'esri-wayback', release: 41 }), { grounds, releases, years, template: true });
      chip().click(); flushSync();
      expect(choice('12 Mar 2024')).toBeDefined();
      expect(layered()).toBeUndefined();
      unmount(held); held = null; document.body.innerHTML = '';
      show(map({ basemap: 'esri-wayback', release: 41 }), { grounds, years });
      expect(chip().textContent.trim()).toBe('Release 41');
      chip().click(); flushSync();
      expect(layered()).toBeUndefined();
    });

    it('picks a cloudless year with its terms, which holds no one day to draw the layers on', () => {
      const element = show(map({ basemap: 's2cloudless' }), { grounds, releases, years });
      chip().click(); flushSync();
      expect(document.body.querySelector('.float-menu').textContent).toContain('Free for non-commercial use only');
      expect(choice('2016').textContent).toContain('free for any use');
      choice('2016').click(); flushSync();
      expect(element.year).toBe(2016);
      expect(chip().textContent.trim()).toBe('2016');
      expect(document.body.querySelector('.float-menu').textContent).toContain('Free for any use, with its credit.');
      expect(layered()).toBeUndefined();
    });

    /** Copernicus as a fake: a month's passes, the layers the configuration serves, a day's coverage. */
    function copernicus() {
      const asked = [];
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        asked.push(String(url));
        const body = String(url).includes('/sentinel/layers') ? { layers: [{ id: 'TRUE_COLOR', label: 'True colour' }], source: 'instance' }
          : String(url).includes('/sentinel/coverage') ? { available: true }
            : { dates: [{ date: '2026-10-18', cloud: 76 }, { date: '2026-10-13', cloud: 8.2 }, { date: '2026-10-08', cloud: 0 }] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      roots.push(() => fetch.mockRestore());
      return asked;
    }
    const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); flushSync(); };

    it('opens Satellite\'s calendar on a Sentinel-2 map, picked alone first, its pass written into the map', async () => {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
      const asked = copernicus();
      const picked = $state({ ids: ['m', 'badge'] });
      const element = $state(map({ basemap: 'sentinel2', acquired: '2026-10-08', maxcc: 30, layers: [] }));
      let sentinel = null;
      roots.push($effect.root(() => {
        sentinel = createPlateSentinel({ target: () => (picked.ids.length === 1 && picked.ids[0] === element.id ? element : null),
          place: (one) => ({ lat: one.view.lat, lon: one.view.lon }), notify: () => {}, api });
      }));
      held = mount(PlateMapBar, { target: document.body, props: { element, grounds, releases, years, sentinel, onpick: () => { picked.ids = [element.id]; } } });
      flushSync();
      await settle();
      // nothing is asked of Copernicus until the day is opened
      expect(asked).toEqual([]);
      expect(chip().textContent.trim()).toBe('8 Oct 2026');
      chip().click(); flushSync();
      expect(picked.ids).toEqual(['m']);
      await vi.waitFor(() => expect(document.body.querySelectorAll('.float-menu .s2-menu.inline .cal-day.has').length).toBe(3));
      expect(asked.filter((url) => url.includes('/sentinel/dates?'))).toHaveLength(1);
      expect(document.body.querySelector('.float-menu [aria-label="Sentinel-2 layer and date"]')).toBeNull();
      // the pass already on the map stays its pass: no newest one put over it
      expect(element.acquired).toBe('2026-10-08');
      expect(document.body.querySelector('.float-menu').textContent).toContain('the pass of 2026-10-08.');
      const day = [...document.body.querySelectorAll('.float-menu .cal-day.has')].find((node) => node.textContent.trim() === '13');
      day.click();
      await vi.waitFor(() => expect(element.acquired).toBe('2026-10-13'));
      flushSync();
      expect(chip().textContent.trim()).toBe('13 Oct 2026');
      expect(element.maxcc).toBe(30);
      expect(layered()).toBeDefined();
    });
  });
});
