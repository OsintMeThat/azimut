// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proofPicker } from '../../lib/icons/catalog.js';
import { loadModels } from '../../lib/icons/loadModels.svelte.js';
import { setStampView, stampViewId } from '../../lib/icons/stampView.svelte.js';
import { PROOF_ICONS } from '../../lib/proofIcons.js';
import StampPicker from './StampPicker.svelte';

let shown = null;
function show(props) {
  const target = document.createElement('div');
  document.body.append(target);
  shown = mount(StampPicker, { target, props });
  flushSync();
  return target;
}
afterEach(() => {
  if (shown) unmount(shown);
  shown = null;
  document.body.innerHTML = '';
  setStampView('top');
});

const named = (target, label) => target.querySelector(`button[aria-label="${label}"]`);

describe('the stamp picker', () => {
  it('files everything under its five groups, each icon named', () => {
    const target = show({ iconName: 'point' });
    const headings = [...target.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Marks', 'Vehicles', 'Events', 'Places', 'People']);
    const tiles = target.querySelectorAll('.tile');
    expect(tiles.length).toBe(proofPicker().reduce((n, g) => n + g.items.length, 0));
    for (const tile of tiles) expect(tile.getAttribute('aria-label')).toBeTruthy();
  });

  it('offers the eleven stamps, the flat vehicles saying so beside the models', () => {
    const target = show({ iconName: 'point' });
    for (const entry of PROOF_ICONS) {
      const flat = ['vehicle', 'truck', 'tank', 'drone'].includes(entry.name);
      expect(named(target, flat ? `${entry.label}, flat` : entry.label), entry.name).not.toBeNull();
    }
    expect(named(target, 'Tank')).not.toBeNull();
    expect(named(target, 'Tank, flat')).not.toBeNull();
  });

  it('marks the icon in hand and hands back what is pressed', () => {
    const pick = vi.fn();
    const target = show({ iconName: 'model-tank', pick });
    expect(named(target, 'Tank').classList.contains('active')).toBe(true);
    expect(named(target, 'Tank, flat').classList.contains('active')).toBe(false);
    named(target, 'Fire').click();
    expect(pick).toHaveBeenCalledWith('badge-flame');
  });

  it('draws the models once they land, at the view in hand, and the view stays', async () => {
    const target = show({ iconName: 'point' });
    await loadModels();
    flushSync();
    const tile = named(target, 'Helicopter');
    await vi.waitFor(() => expect(tile.querySelector('svg path')).not.toBeNull());
    const top = tile.innerHTML;
    expect(top).toContain('currentColor');

    target.querySelector('[role="radio"]:nth-child(2)').click();
    flushSync();
    expect(stampViewId()).toBe('angled');
    expect(tile.innerHTML).not.toBe(top);
    expect(target.querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Angled');
  });
});
