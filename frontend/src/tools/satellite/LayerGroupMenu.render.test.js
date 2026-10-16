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
  const settings = [...document.querySelectorAll('.float-menu .field, .float-menu .switch')];
  expect(settings.length).toBe(9);
  expect(settings.filter((node) => !node.title)).toEqual([]);
  expect(document.querySelector('.float-menu [aria-label="Strikes are events"]').closest('label').title).toBe(LAYER_HELP.events);
});

it('ungroups as one edit, its features going to the first group', () => {
  const { controller, onclose } = show({ id: 'h', name: 'Strikes', mode: 'individual', size: 1, stroke: 2 });
  expect(item('Ungroup').title).toBe('Its features move to the first group');
  item('Ungroup').click();
  expect(controller.removeGroup).toHaveBeenCalledWith('h');
  expect(onclose).toHaveBeenCalledOnce();
});
