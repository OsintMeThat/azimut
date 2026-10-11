// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerIconPicker from './LayerIconPicker.svelte';
import choices from '../../lib/map/layerSymbols.json';
import { paths } from '../../components/Icon.svelte';

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

it('offers distinct conflict and infrastructure symbols from the app icon set', () => {
  expect(choices.filter((choice) => choice.id.startsWith('badge-'))).toHaveLength(52);
  expect(choices.every((choice) => paths[choice.icon])).toBe(true);
  expect(paths.drone).not.toBe(paths.fpvDrone);
  expect(paths.radar).not.toBe(paths.radarAntenna);
  expect(paths.truck).not.toBe(paths.pickup);
});

it('finds and chooses a round icon in the current colour', () => {
  const onchange = vi.fn();
  held = mount(LayerIconPicker, { target: document.body,
    props: { value: 'pin', colour: '#009e73', label: 'Marker', onchange } });
  flushSync();
  document.querySelector('[aria-label="Marker icons"]').click(); flushSync();
  const search = document.querySelector('[aria-label="Marker find icon"]');
  search.value = 'vessel'; search.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  const button = document.querySelector('[aria-label="Marker Vessel icon"]');
  expect(button.querySelector('.round').style.getPropertyValue('--colour')).toBe('#009e73');
  expect(document.querySelectorAll('.icons button')).toHaveLength(1);
  button.click(); flushSync();
  expect(onchange).toHaveBeenCalledWith({ symbol: 'badge-ship' });
  expect(document.querySelector('.icon-menu')).toBeNull();
  expect(document.querySelector('select')).toBeNull();
  expect(document.querySelector('[aria-label="Marker icons"]').title).toContain('Vessel');
});

it('keeps clicks inside the palette and closes on an outside click or Escape', () => {
  held = mount(LayerIconPicker, { target: document.body, props: { label: 'Marker' } });
  flushSync();
  const trigger = document.querySelector('[aria-label="Marker icons"]');
  expect(trigger.querySelector('svg')).toBeTruthy();
  expect(trigger.title).toContain('choose an icon');
  trigger.click(); flushSync();
  const search = document.querySelector('input');
  search.click(); flushSync();
  expect(document.querySelector('.icon-menu')).toBeTruthy();
  search.value = 'UAV'; search.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  expect(document.querySelectorAll('.icons button')).toHaveLength(2);
  document.body.click(); flushSync();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.click(); flushSync();
  document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
  expect(document.querySelector('.icon-menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
