// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ProofSideTabs from './ProofSideTabs.svelte';
import { sideTabs } from './sideTabs.js';

/** The tab bar on top of Geo Proof's side column, pressed and walked with the keys. */

let live = [];

afterEach(() => {
  for (const [one, target] of live) {
    unmount(one);
    target.remove();
  }
  live = [];
});

function setup({ scene = true, current = 'layout', needs = '' } = {}) {
  const onpick = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  live.push([mount(ProofSideTabs, { target, props: { tabs: sideTabs(scene), current, needs, onpick } }), target]);
  flushSync();
  return { root: target, onpick };
}

const tabs = (root) => [...root.querySelectorAll('[role="tab"]')];
const press = (node, key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
};

describe('the side tabs', () => {
  it('are a tablist, the tab shown selected and the only one in the Tab order', () => {
    const { root } = setup();
    expect(root.querySelector('[role="tablist"]').getAttribute('aria-label')).toBe('Proof settings');
    expect(tabs(root).map((one) => one.textContent.trim())).toEqual(['Proof', 'Scene', 'Layout', 'Style']);
    const layout = tabs(root)[2];
    expect(layout.getAttribute('aria-selected')).toBe('true');
    expect(layout.getAttribute('aria-controls')).toBe('proof-pane-layout');
    expect(layout.id).toBe('proof-tab-layout');
    expect(tabs(root).map((one) => one.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1']);
    expect(layout.getAttribute('title')).toBe('Panels, overlays, annotations and elements');
  });

  it('leave Scene out for a proof on no video', () => {
    const { root } = setup({ scene: false });
    expect(tabs(root).map((one) => one.textContent.trim())).toEqual(['Proof', 'Layout', 'Style']);
  });

  it('pick a tab on a press', () => {
    const { root, onpick } = setup();
    tabs(root)[3].click();
    expect(onpick).toHaveBeenCalledWith('style');
  });

  it('move with the arrows, Home and End, round the ends, and keep the keys from the composer', () => {
    const { root, onpick } = setup({ current: 'layout' });
    const heard = vi.fn();
    window.addEventListener('keydown', heard);
    const layout = tabs(root)[2];
    layout.focus();
    expect(press(layout, 'ArrowRight').defaultPrevented).toBe(true);
    expect(onpick).toHaveBeenLastCalledWith('style');
    expect(document.activeElement).toBe(tabs(root)[3]);
    press(layout, 'ArrowLeft');
    expect(onpick).toHaveBeenLastCalledWith('scene');
    press(layout, 'Home');
    expect(onpick).toHaveBeenLastCalledWith('proof');
    press(layout, 'End');
    expect(onpick).toHaveBeenLastCalledWith('style');
    window.removeEventListener('keydown', heard);
    // the composer reads the arrows as a nudge of the picked mark
    expect(heard).not.toHaveBeenCalled();
  });

  it('wrap round from the last tab to the first', () => {
    const { root, onpick } = setup({ current: 'style' });
    press(tabs(root)[3], 'ArrowRight');
    expect(onpick).toHaveBeenLastCalledWith('proof');
  });

  it('leave every other key to the page', () => {
    const { root, onpick } = setup();
    expect(press(tabs(root)[2], 'r').defaultPrevented).toBe(false);
    expect(onpick).not.toHaveBeenCalled();
  });

  it('mark the Proof tab while a field still needs filling, and say what on hover', () => {
    const { root } = setup({ needs: 'Still needs coordinates and a source' });
    const proof = tabs(root)[0];
    const mark = proof.querySelector('[data-testid="proof-tab-needs"]');
    expect(mark.getAttribute('aria-label')).toBe('Still needs coordinates and a source');
    expect(proof.getAttribute('title')).toBe('Still needs coordinates and a source');
    expect(tabs(root).slice(1).some((one) => one.querySelector('[data-testid="proof-tab-needs"]'))).toBe(false);
  });

  it('mark nothing once the facts are in', () => {
    const { root } = setup();
    expect(root.querySelector('[data-testid="proof-tab-needs"]')).toBeNull();
    expect(tabs(root)[0].getAttribute('title')).toBe('Coordinates, source, description and date');
  });
});
