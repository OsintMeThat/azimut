// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateWords from './PlateWords.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

const theme = { paper: '#ffffff', ink: '#111111', accent: '#c8102e', font: 'inter' };
function show(element) {
  const state = $state(element);
  held = mount(PlateWords, { target: document.body, props: { element: state, theme } });
  flushSync();
  return state;
}
const pressed = (group) => [...document.body.querySelectorAll(`[aria-label="${group}"] button`)];

describe('the words of a picked element', () => {
  it('sets the words on the ground as a text\'s: their weight, their case, a box behind them', () => {
    const zone = show({ kind: 'zone', text: 'Depot', colour: '#00aa00' });
    // bold on a halo, as they were always drawn
    expect(pressed('Text weight').find((button) => button.getAttribute('aria-pressed') === 'true').textContent).toBe('Bold');
    expect(pressed('What stands behind the words').find((button) => button.getAttribute('aria-pressed') === 'true').textContent).toBe('Halo');
    pressed('Text weight').find((button) => button.textContent === 'Regular').click();
    pressed('Text style').find((button) => button.textContent === 'CAPS').click();
    pressed('What stands behind the words').find((button) => button.textContent === 'Box').click();
    flushSync();
    expect([zone.weight, zone.upper, zone.back, zone.fill]).toEqual([400, true, 'box', '#ffffff']);
    expect(document.body.querySelector('[aria-label="Box colour"]')).not.toBeNull();
  });

  it('shows nothing for an element that writes nothing', () => {
    show({ kind: 'image' });
    expect(document.body.textContent.trim()).toBe('');
  });
});
