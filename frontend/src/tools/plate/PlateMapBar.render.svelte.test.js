// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateMapBar from './PlateMapBar.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

function show(element, props = {}) {
  const state = $state(element);
  held = mount(PlateMapBar, { target: document.body, props: { element: state, grounds: [['plain', 'Plain'], ['plain-dark', 'Plain, dark'],
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

  it('changes the ground and what lies over it from one menu, relief only on the plain ground', () => {
    const element = show({ kind: 'map', view: { lat: 0, lon: 0, zoom: 5, bearing: 0 }, basemap: 'plain', overlays: [] });
    button('Ground').click(); flushSync();
    item('Relief shading').click(); flushSync();
    expect(element.overlays).toEqual(['relief']);
    item('Esri World Imagery').click(); flushSync();
    expect(element.basemap).toBe('esri-world-imagery');
    button('Ground').click(); flushSync();
    expect(item('Relief shading')).toBeUndefined();
    expect(item('Borders and big names')).toBeDefined();
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
});
