// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerChips from './LayerChips.svelte';
import LayerMenu from './LayerMenu.svelte';

let live;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const row = (id, group, over = {}) => ({ id, group, label: id, title: `${id} title`, on: false, toggle: vi.fn(), ...over });

function show(component, props) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(component, { target, props });
  flushSync();
  return target;
}

const chip = (target, text) => [...target.querySelectorAll('.chip')].find((entry) => entry.textContent.trim() === text);

describe('the layer chips', () => {
  it('lists the layers under their headings, in the catalogue’s order, with the case’s own last', () => {
    const target = show(LayerChips, {
      rows: [row('Saved work', 'case'), row('Borders', 'reference', { on: true }), row('Active fires', 'events')],
      added: [{ name: 'ua', title: 'GeoConfirmed UA', enabled: true }],
    });
    expect([...target.querySelectorAll('h4')].map((entry) => entry.textContent)).toEqual([
      'Reference', 'Events', 'Case', 'Added layers',
    ]);
    expect(chip(target, 'Borders').getAttribute('aria-pressed')).toBe('true');
    expect(chip(target, 'GeoConfirmed UA').getAttribute('aria-pressed')).toBe('true');
  });

  it('switches a layer from its chip, and an added one through the store', () => {
    const ontoggleadded = vi.fn();
    const roads = row('Roads', 'reference');
    const layer = { name: 'ua', title: 'GeoConfirmed UA', enabled: false };
    const target = show(LayerChips, { rows: [roads], added: [layer], ontoggleadded });
    chip(target, 'Roads').click();
    chip(target, 'GeoConfirmed UA').click();
    expect(roads.toggle).toHaveBeenCalled();
    expect(ontoggleadded).toHaveBeenCalledWith(layer);
  });

  it('says what a layer that asks a question shows, and opens its settings only on Change', () => {
    const target = show(LayerChips, {
      rows: [row('Night lights', 'events', {
        on: true,
        summary: 'NOAA-20 · 2025-06-02',
        controls: [{ label: 'Showing', options: [{ id: 'noaa20', label: 'NOAA-20' }], value: 'noaa20', pick: vi.fn() }],
      })],
    });
    expect(target.textContent).toContain('Night lights: NOAA-20 · 2025-06-02');
    expect(target.querySelector('.settings')).toBeNull();
    const change = [...target.querySelectorAll('button')].find((entry) => entry.textContent === 'Change');
    change.click();
    flushSync();
    expect(target.querySelector('.settings').textContent).toContain('Showing');
    expect(change.textContent).toBe('Done');
  });

  it('keeps a locked layer listed, greyed, with the way to unlock it', () => {
    const run = vi.fn();
    const target = show(LayerChips, {
      rows: [row('Active fires', 'events', { disabled: true, lock: { text: 'needs a free key', action: 'Add a FIRMS key', run } })],
    });
    expect(chip(target, 'Active fires').disabled).toBe(true);
    expect(target.textContent).toContain('Active fires: needs a free key.');
    [...target.querySelectorAll('button')].find((entry) => entry.textContent === 'Add a FIRMS key').click();
    expect(run).toHaveBeenCalled();
  });

  it('points to Satellite for adding a layer, only where it was asked to', () => {
    const onmanage = vi.fn();
    const target = show(LayerChips, { rows: [], added: [], onmanage });
    const link = [...target.querySelectorAll('button')].find((entry) => entry.textContent.includes('Satellite'));
    expect(link.textContent.trim()).toBe('Add your own layers in Satellite');
    link.click();
    expect(onmanage).toHaveBeenCalled();
  });
});

describe('the Layers menu', () => {
  it('counts what is on, and opens beside the map rather than over it', () => {
    const target = show(LayerMenu, {
      rows: [row('Borders', 'reference', { on: true }), row('Roads', 'reference', { on: true, disabled: true })],
      added: [{ name: 'ua', title: 'GeoConfirmed UA', enabled: true }],
    });
    const trigger = target.querySelector('.layer-menu > button');
    // a disabled layer draws nothing, so it is not counted
    expect(trigger.textContent).toContain('2');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    flushSync();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(target.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Layers');
  });

  it('closes on Escape and on a press outside, and stays open for a press inside', () => {
    const target = show(LayerMenu, { rows: [row('Borders', 'reference')] });
    const trigger = target.querySelector('.layer-menu > button');
    trigger.click();
    flushSync();
    target.querySelector('.chip').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    flushSync();
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    flushSync();
    expect(target.querySelector('[role="dialog"]')).toBeNull();

    trigger.click();
    flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });
});
