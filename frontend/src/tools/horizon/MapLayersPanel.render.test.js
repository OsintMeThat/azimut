// @vitest-environment happy-dom
/** Horizon's Layers menu, shared by the small map and Find's: the base map, then the layers by group. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MapLayersPanel from './MapLayersPanel.svelte';

let live = [];
function panel(props) {
  const target = document.createElement('div');
  document.body.append(target);
  live.push({ component: mount(MapLayersPanel, { target, props }), target });
  flushSync();
  return target;
}
afterEach(() => {
  for (const { component, target } of live) {
    unmount(component);
    target.remove();
  }
  live = [];
});

const BASES = [
  { id: 'esri-world-imagery', label: 'Satellite', title: 'Esri satellite imagery' },
  { id: 'osm', label: 'Streets', title: 'OpenStreetMap' },
];

describe('the Layers menu of Horizon’s maps', () => {
  it('picks the base map and lights the one in use', () => {
    let providerId = 'esri-world-imagery';
    const target = panel({
      id: 'menu',
      bases: BASES,
      get providerId() {
        return providerId;
      },
      set providerId(next) {
        providerId = next;
      },
    });
    const group = target.querySelector('[role="group"][aria-label="Base map"]');
    const [satellite, streets] = group.querySelectorAll('button');
    expect(satellite.getAttribute('aria-pressed')).toBe('true');
    streets.click();
    flushSync();
    expect(providerId).toBe('osm');
  });

  it('lists the layers under their groups, the case’s own apart, each switched by its eye', () => {
    const toggle = vi.fn();
    const ontoggleadded = vi.fn();
    const added = [
      { name: 'mine', title: 'Drawn sites', editable: true, enabled: true },
      { name: 'theirs', title: 'Imported sites', editable: false, enabled: false },
    ];
    const target = panel({
      id: 'menu',
      bases: BASES,
      providerId: 'osm',
      rows: [{ id: 'boundaries', label: 'Borders', group: 'reference', on: false, toggle }],
      added,
      ontoggleadded,
    });
    expect(target.querySelector('[role="dialog"]').id).toBe('menu');
    expect(target.querySelector('section[aria-label="Reference"]')).not.toBeNull();
    target.querySelector('button[aria-label="Borders"]').click();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(target.querySelector('section[aria-label="My layers"] button[aria-label="Drawn sites"]')).not.toBeNull();
    target.querySelector('section[aria-label="Added layers"] button[aria-label="Imported sites"]').click();
    expect(ontoggleadded).toHaveBeenCalledWith(added[1]);
  });
});
