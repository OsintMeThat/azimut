// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerFeatureMenu from './LayerFeatureMenu.svelte';

vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async () => ({ colours: [] })), put: vi.fn() } }));

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const feature = (key, properties = {}, type = 'Point') => ({ geometry: { type, coordinates: [] }, properties: { key, name: key, group: 'g', ...properties } });
const item = (label) => [...document.querySelectorAll('.fm-item')].find((node) => node.textContent.trim() === label);
function show(features, selection) {
  const controller = { editor: { caseId: 'case' }, features, selection, groups: [{ id: 'g', name: 'Markers' }], group: 'g', pending: 0,
    updateSelection: vi.fn(), removeSelection: vi.fn(), editGeometry: vi.fn(), promote: vi.fn(), updateGroup: vi.fn() };
  const onclose = vi.fn();
  held = mount(LayerFeatureMenu, { target: document.body, props: { controller, at: { x: 40, y: 40 }, onclose } });
  flushSync();
  return { controller, onclose };
}

it('sets the status, clears a direction and saves a point as a case place, for the feature under the pointer', () => {
  const { controller, onclose } = show([feature('Gate', { bearing: 90, status: 'damaged' })], ['Gate']);
  expect(document.querySelector('.fm-head').textContent).toBe('Gate');
  expect(document.querySelector('[aria-label="Status"] [aria-pressed="true"]').textContent).toBe('Damaged');
  [...document.querySelectorAll('[aria-label="Status"] button')].find((node) => node.textContent === 'Destroyed').click();
  expect(controller.updateSelection).toHaveBeenCalledWith({ status: 'destroyed' });
  item('Clear the direction').click();
  expect(controller.updateSelection).toHaveBeenLastCalledWith({ bearing: null });
  expect(onclose).toHaveBeenCalledOnce();
  item('Save as case place').click();
  expect(controller.promote).toHaveBeenCalledWith('Gate');
  expect(item('Reshape')).toBeUndefined();
});

it('acts on the whole selection, and reshapes one line', () => {
  const { controller } = show([feature('a'), feature('b', { status: 'destroyed' })], ['a', 'b']);
  expect(document.querySelector('.fm-head').textContent).toBe('2 selected');
  expect(document.querySelector('[aria-label="Status"] [aria-pressed="true"]')).toBeNull();
  expect(item('Clear the direction')).toBeUndefined();
  expect(item('Save as case place')).toBeUndefined();
  item('Remove 2 from the layer').click();
  expect(controller.removeSelection).toHaveBeenCalledOnce();
  unmount(held); held = null; document.body.innerHTML = '';
  const line = show([feature('road', {}, 'LineString')], ['road']);
  item('Reshape').click();
  expect(line.controller.editGeometry).toHaveBeenCalledOnce();
});
