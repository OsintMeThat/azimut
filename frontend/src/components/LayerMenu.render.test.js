// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerList from './LayerList.svelte';
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

const eye = (target, label) => target.querySelector(`button.eye[aria-label="${label}"]`);
const heading = (target, label) =>
  [...target.querySelectorAll('.sub-head')].find((entry) => entry.textContent.trim().startsWith(label));

describe('the layer list', () => {
  it('lists the layers under the catalogue’s headings, with the case’s own last, each with its eye', () => {
    const target = show(LayerList, {
      rows: [row('Saved work', 'case'), row('Borders', 'reference', { on: true }), row('Active fires', 'events')],
      added: [{ name: 'ua', title: 'GeoConfirmed UA', enabled: true }],
    });
    expect([...target.querySelectorAll('.sub-head')].map((entry) => entry.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Reference 1', 'Events 0', 'Case 0', 'Added layers 1',
    ]);
    expect(eye(target, 'Borders').getAttribute('aria-pressed')).toBe('true');
    expect(eye(target, 'GeoConfirmed UA').getAttribute('aria-pressed')).toBe('true');
  });

  it('lists the layers drawn in the case under My layers, apart from the imported ones, as the Map does', () => {
    const target = show(LayerList, {
      rows: [row('Borders', 'reference')],
      added: [
        { name: 'ua', title: 'GeoConfirmed UA', enabled: false },
        { name: 'mine', title: 'Yemen MP', enabled: true, editable: true },
      ],
    });
    expect([...target.querySelectorAll('.sub-head')].map((entry) => entry.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Reference 0', 'My layers 1', 'Added layers 0',
    ]);
    const section = (label) => target.querySelector(`section[aria-label="${label}"]`);
    expect(eye(section('My layers'), 'Yemen MP')).not.toBeNull();
    expect(eye(section('Added layers'), 'GeoConfirmed UA')).not.toBeNull();
    expect(eye(section('Added layers'), 'Yemen MP')).toBeNull();
  });

  it('switches a layer from its eye, and an added one through the store', () => {
    const ontoggleadded = vi.fn();
    const roads = row('Roads', 'reference');
    const layer = { name: 'ua', title: 'GeoConfirmed UA', enabled: false };
    const target = show(LayerList, { rows: [roads], added: [layer], ontoggleadded });
    eye(target, 'Roads').click();
    eye(target, 'GeoConfirmed UA').click();
    expect(roads.toggle).toHaveBeenCalled();
    expect(ontoggleadded).toHaveBeenCalledWith(layer);
  });

  it('folds a heading away and keeps the rest', () => {
    const target = show(LayerList, { rows: [row('Borders', 'reference'), row('Night lights', 'events')] });
    heading(target, 'Reference').click();
    flushSync();
    expect(heading(target, 'Reference').getAttribute('aria-expanded')).toBe('false');
    expect(eye(target, 'Borders')).toBeNull();
    expect(eye(target, 'Night lights')).not.toBeNull();
  });

  it('shows a layer’s settings under its row and the reason a switch is locked', () => {
    const run = vi.fn();
    const target = show(LayerList, {
      rows: [
        row('Night lights', 'events', {
          on: true,
          detail: 'NOAA-20 · 2025-06-02',
          controls: [{ label: 'Showing', options: [{ id: 'noaa20', label: 'NOAA-20' }], value: 'noaa20', pick: vi.fn() }],
        }),
        row('Active fires', 'events', {
          disabled: true,
          detail: 'needs a free key',
          actions: [{ label: 'Add a FIRMS key', quiet: true, run }],
        }),
      ],
    });
    expect(target.textContent).toContain('NOAA-20 · 2025-06-02');
    expect(target.querySelector('.settings').textContent).toContain('Showing');
    expect(eye(target, 'Active fires').disabled).toBe(true);
    expect(target.textContent).toContain('needs a free key');
    [...target.querySelectorAll('button')].find((entry) => entry.textContent === 'Add a FIRMS key').click();
    expect(run).toHaveBeenCalled();
  });

  it('says nothing was added yet, and points to Satellite for adding one', () => {
    const onmanage = vi.fn();
    const target = show(LayerList, { rows: [], added: [], onmanage });
    expect(target.textContent).toContain('Nothing added yet.');
    const link = [...target.querySelectorAll('button')].find((entry) => entry.textContent.includes('Satellite'));
    expect(link.textContent.trim()).toBe('Add a layer in Satellite');
    link.click();
    expect(onmanage).toHaveBeenCalled();
  });
});

describe('the Layers menu', () => {
  it('opens personal editing and creation from compact controls in the current workspace', () => {
    const oneditadded = vi.fn(), onnewpersonal = vi.fn();
    const personal = { name: 'own', title: 'Working map', editable: true, enabled: false };
    const target = show(LayerMenu, { added: [personal, { name: 'source', title: 'Source map' }], oneditadded, onnewpersonal });
    target.querySelector('.layer-menu > button').click(); flushSync();
    const edit = target.querySelector('[aria-label="Edit Working map"]');
    expect(edit.textContent.trim()).toBe(''); edit.click();
    expect(oneditadded).toHaveBeenCalledWith(personal);
    expect(target.querySelector('[aria-label="Edit Source map"]')).toBeNull();
    [...target.querySelectorAll('button')].find((button) => button.textContent.trim() === 'New layer').click();
    expect(onnewpersonal).toHaveBeenCalledOnce();
  });
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

  it('keeps a folded heading folded the next time it opens', () => {
    const target = show(LayerMenu, { rows: [row('Borders', 'reference')] });
    const trigger = target.querySelector('.layer-menu > button');
    trigger.click();
    flushSync();
    heading(target, 'Reference').click();
    flushSync();
    trigger.click();
    flushSync();
    trigger.click();
    flushSync();
    expect(heading(target, 'Reference').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and on a press outside, and stays open for a press inside', () => {
    const target = show(LayerMenu, { rows: [row('Borders', 'reference')] });
    const trigger = target.querySelector('.layer-menu > button');
    trigger.click();
    flushSync();
    eye(target, 'Borders').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
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
