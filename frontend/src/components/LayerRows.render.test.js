// @vitest-environment happy-dom
/**
 * The Layers list's eyes: open while a layer is drawn, crossed out while it is
 * not, or while it cannot be (a greyed switch waiting for a key).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerRows from './LayerRows.svelte';

let held = null;
afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

describe('a layer row', () => {
  it('crosses its eye out unless the layer is drawn', () => {
    held = mount(LayerRows, {
      target: document.body,
      props: {
        rows: [
          { id: 'borders', label: 'Borders', on: true, toggle: () => {} },
          { id: 'roads', label: 'Roads', on: false, toggle: () => {} },
          { id: 'fires', label: 'Active fires', on: true, disabled: true, toggle: () => {} },
        ],
      },
    });
    flushSync();
    const eyes = [...document.querySelectorAll('.eye svg')].map((svg) => svg.getAttribute('data-icon'));
    expect(eyes).toEqual(['eye', 'eyeOff', 'eyeOff']);
  });
});
