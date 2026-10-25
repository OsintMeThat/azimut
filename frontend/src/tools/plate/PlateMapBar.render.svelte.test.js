// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateMapBar from './PlateMapBar.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

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
});
