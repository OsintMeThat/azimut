// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerStyleButton from './LayerStyleButton.svelte';
import choices from '../../lib/map/layerSymbols.json';

vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async () => ({ colours: [] })), put: vi.fn() } }));

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const show = (props) => { held = mount(LayerStyleButton, { target: document.body, props: { label: 'Marker', ...props } }); flushSync(); };
const open = () => { document.querySelector('[aria-label="Marker"]').click(); flushSync(); };
const type = (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); };

it('lays the icons out by theme, and answers a search with the matches alone', () => {
  show({});
  open();
  const themes = [...document.querySelectorAll('.icons .theme')].map((node) => node.textContent);
  expect(themes).toEqual(['Markers', 'Sources', 'Events', 'Forces', 'Vehicles', 'Places']);
  expect(document.querySelectorAll('.icons button')).toHaveLength(choices.length);
  type(document.querySelector('[aria-label="Marker find icon"]'), 'vehicles');
  expect(document.querySelector('.icons .theme')).toBeNull();
  expect(document.querySelectorAll('.icons button')).toHaveLength(choices.filter((choice) => choice.group === 'Vehicles').length);
});

it('applies an icon and a colour at once and stays open for the next pick', () => {
  const onpick = vi.fn();
  show({ symbol: 'pin', colour: '#009e73', onpick });
  open();
  type(document.querySelector('[aria-label="Marker find icon"]'), 'vessel');
  const vessel = document.querySelector('[aria-label="Marker Vessel icon"]');
  // the disc, after its halo, is painted in the colour being edited
  expect(vessel.querySelectorAll('svg path')[1].getAttribute('fill')).toBe('#009e73');
  vessel.click(); flushSync();
  expect(onpick).toHaveBeenLastCalledWith({ symbol: 'badge-ship' });
  document.querySelector('[aria-label="Marker orange"]').click(); flushSync();
  expect(onpick).toHaveBeenLastCalledWith({ colour: '#d55e00' });
  expect(document.querySelector('[aria-label="Marker picker"]')).toBeTruthy();
});

it('offers the layer’s own styles first, and its groups when it can move features', () => {
  const onpick = vi.fn(), ongroup = vi.fn();
  show({ onpick, ongroup, used: [{ symbol: 'star', colour: '#d55e00' }, { symbol: 'flag', colour: '#0072b2' }],
    groups: [{ id: 'a', name: 'Seen' }, { id: 'b', name: 'Checked' }], group: '', groupLabel: 'Add to' });
  open();
  document.querySelector('[aria-label="Marker as Star in #d55e00"]').click(); flushSync();
  expect(onpick).toHaveBeenCalledWith({ symbol: 'star', colour: '#d55e00' });
  const select = document.querySelector('[aria-label="Marker group"]');
  expect(select.closest('label').textContent).toContain('Add to');
  // several groups in the selection: none is claimed
  expect(select.querySelector('option[disabled]').textContent).toBe('Several');
  select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(ongroup).toHaveBeenCalledWith('b');
});

it('says what a pick will restyle, and shows a line by its colour alone', () => {
  show({ point: false, colour: '#cc79a7', note: 'Checked has one style for all its features. A pick here restyles the whole group.' });
  expect(document.querySelector('[aria-label="Marker"] .dot')).toBeTruthy();
  open();
  expect(document.body.textContent).toContain('restyles the whole group');
  expect(document.querySelector('[aria-label="Marker find icon"]')).toBeNull();
  expect(document.querySelector('[aria-label="Marker colour"]')).toBeTruthy();
});

it('closes on an outside press or Escape and gives the focus back', () => {
  show({});
  const trigger = document.querySelector('[aria-label="Marker"]');
  open();
  document.querySelector('[aria-label="Marker find icon"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); flushSync();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); flushSync();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  open();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
  expect(document.querySelector('[aria-label="Marker picker"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
