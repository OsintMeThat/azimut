// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PanelEdge from './PanelEdge.svelte';
import { panelWidth } from '../lib/panelWidth.js';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

function show(side, width = 300) {
  const helpers = { ...panelWidth({ key: 'azimut:testEdge', min: 200, max: 500, def: 280, fraction: 1 }), saveWidth: vi.fn() };
  const box = $state({ width });
  held = mount(PanelEdge, { target: document.body, props: { helpers, side, get width() { return box.width; }, set width(value) { box.width = value; } } });
  flushSync();
  return { box, helpers, edge: document.body.querySelector('button.edge') };
}
const key = (edge, name) => { edge.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); flushSync(); };

describe('the edge of a side panel', () => {
  it('widens a panel on the right by its left edge, from the keyboard, and keeps the width', () => {
    const { box, helpers, edge } = show('left');
    key(edge, 'ArrowLeft');
    expect(box.width).toBe(316);
    key(edge, 'ArrowRight');
    key(edge, 'ArrowRight');
    expect(box.width).toBe(284);
    expect(helpers.saveWidth).toHaveBeenLastCalledWith(284);
  });

  it('widens a panel on the left by its right edge', () => {
    const { box, edge } = show('right');
    key(edge, 'ArrowRight');
    expect(box.width).toBe(316);
  });

  it('stays between its bounds, and a double click puts the width back', () => {
    const { box, edge } = show('left', 492);
    key(edge, 'ArrowLeft');
    expect(box.width).toBe(500);
    edge.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();
    expect(box.width).toBe(280);
  });

  it('keeps the arrows from moving what is picked on the page', () => {
    const { edge } = show('left');
    const page = vi.fn();
    window.addEventListener('keydown', page);
    key(edge, 'ArrowLeft');
    window.removeEventListener('keydown', page);
    expect(page).not.toHaveBeenCalled();
  });
});
