// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerGroupMenu from './LayerGroupMenu.svelte';
import { LAYER_HELP } from '../../lib/map/layerHelp.js';

vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async () => ({ colours: [] })), put: vi.fn() } }));

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const item = (label) => [...document.querySelectorAll('.fm-item')].find((node) => node.textContent.trim() === label);

function show(group, extra = {}) {
  const groups = [{ id: 'g', name: 'Markers', mode: 'individual' }, group];
  const controller = { editor: { caseId: 'case', track: { on: true } }, features: [], groups, pending: 0,
    updateGroup: vi.fn(), removeGroup: vi.fn(), selectGroup: vi.fn(), unnamed: () => [], ...extra };
  const onclose = vi.fn();
  held = mount(LayerGroupMenu, { target: document.body, props: { controller, group, anchor: null, members: 3, onclose } });
  flushSync();
  return { controller, onclose };
}

it('says what each setting of a group does on hover', () => {
  show({ id: 'h', name: 'Strikes', mode: 'uniform', colour: '#d55e00', symbol: 'pin', size: 1, stroke: 2 });
  const settings = [...document.querySelectorAll('.float-menu .field, .float-menu .switch, .float-menu .modes button')];
  expect(settings.length).toBe(11);
  expect(settings.filter((node) => !node.title)).toEqual([]);
  expect(document.querySelector('.float-menu [aria-label="Strikes are events"]').closest('label').title).toBe(LAYER_HELP.events);
});

it('styles a group three ways, each its own, one colour or one style', () => {
  const modes = () => [...document.querySelectorAll('[aria-label="How Strikes is styled"] button')];
  const { controller } = show({ id: 'h', name: 'Strikes', mode: 'individual', colour: '#d55e00', symbol: 'pin', size: 1, stroke: 2 });
  expect(modes().map((node) => [node.textContent.trim(), node.getAttribute('aria-pressed')]))
    .toEqual([['Each its own', 'true'], ['One colour', 'false'], ['One style', 'false']]);
  expect(modes().map((node) => node.title)).toEqual([LAYER_HELP.individual, LAYER_HELP.oneColour, LAYER_HELP.uniform]);
  expect(document.querySelector('[aria-label="Group style"]')).toBeNull();
  expect(document.querySelector('[aria-label="Group colour"]')).toBeNull();
  modes()[1].click();
  expect(controller.updateGroup).toHaveBeenCalledWith('h', { mode: 'colour' });
});

it('gives a group in one colour a colour alone, offered from every colour the layer wears', () => {
  const features = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { key: 'a', group: 'g', symbol: 'star', colour: '#123456' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { key: 'b', group: 'g', colour: '#abcdef' } }];
  const { controller } = show({ id: 'h', name: 'Strikes', mode: 'colour', colour: '#d55e00', symbol: 'pin', size: 1, stroke: 2 }, { features });
  expect(document.querySelector('[aria-label="Group style"]')).toBeNull();
  document.querySelector('[aria-label="Group colour"]').click(); flushSync();
  // a colour alone: no icon to pick
  expect(document.querySelector('[aria-label="Group colour icon palette"]')).toBeNull();
  expect(document.querySelector('[aria-label="Group colour #123456"]')).not.toBeNull();
  document.querySelector('[aria-label="Group colour #abcdef"]').click();
  expect(controller.updateGroup).toHaveBeenCalledWith('h', { colour: '#abcdef' });
});

it('ungroups as one edit, its features going to the first group', () => {
  const { controller, onclose } = show({ id: 'h', name: 'Strikes', mode: 'individual', size: 1, stroke: 2 });
  expect(item('Ungroup').title).toBe('Its features move to the first group');
  item('Ungroup').click();
  expect(controller.removeGroup).toHaveBeenCalledWith('h');
  expect(onclose).toHaveBeenCalledOnce();
});
