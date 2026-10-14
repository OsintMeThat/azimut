// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
const mocks = vi.hoisted(() => ({ downloadLayer: vi.fn(), toast: vi.fn(), patch: vi.fn(), edited: vi.fn(),
  layers: { rows: [], time: () => ({ at: null }) } }));
vi.mock('../../lib/map/layerExport.js', () => ({ downloadLayer: mocks.downloadLayer }));
vi.mock('../../lib/state.svelte.js', () => ({ toast: mocks.toast }));
vi.mock('../../lib/api.js', () => ({ api: { patch: mocks.patch } }));
vi.mock('../../lib/map/addedLayersState.svelte.js', () => ({ addedLayers: {
  get rows() { return mocks.layers.rows; }, time: (name) => mocks.layers.time(name), edited: mocks.edited } }));
import LayerExportDialog from './LayerExportDialog.svelte';
let held;
afterEach(() => {
  if (held) unmount(held); held = null; document.body.innerHTML = ''; vi.resetAllMocks();
  mocks.layers.rows = []; mocks.layers.time = () => ({ at: null });
});
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); flushSync(); };
const open = (target, onclose = vi.fn()) => {
  held = mount(LayerExportDialog, { target: document.body, props: { target, onclose } }); flushSync();
  return onclose;
};
describe('layer download dialog', () => {
  it('holds the dialog during preparation and closes after downloading', async () => {
    let complete; mocks.downloadLayer.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const target = { caseId: 'case', row: { name: 'work', title: 'Working' } };
    const onclose = open(target);
    document.querySelector('.formats button').click(); flushSync();
    expect(mocks.downloadLayer).toHaveBeenCalledWith('case', target.row, 'kmz', { at: null, history: false });
    expect([...document.querySelectorAll('.formats button')].every((button) => button.disabled)).toBe(true);
    document.querySelector('[aria-label="Close"]').click(); expect(onclose).not.toHaveBeenCalled();
    complete(); await settle(); expect(onclose).toHaveBeenCalledOnce();
  });
  it('shows a refused download and lets the user retry', async () => {
    mocks.downloadLayer.mockRejectedValue(new Error('Layer no longer available'));
    const onclose = open({ caseId: 'case', row: { title: 'Working' } });
    document.querySelector('.formats button').click(); await settle();
    expect(mocks.toast).toHaveBeenCalledWith('Layer no longer available', 'danger');
    expect(onclose).not.toHaveBeenCalled(); expect(document.querySelector('.formats button').disabled).toBe(false);
  });
  it('offers an untracked layer no choice of day', () => {
    open({ caseId: 'case', row: { name: 'work', title: 'Working', editable: true } });
    expect(document.querySelector('.which')).toBeNull();
  });
});

describe('a tracked layer out of the case', () => {
  const row = { name: 'front', title: 'Front', editable: true, track: { on: true } };

  it('goes out on its day or with its whole history', async () => {
    mocks.layers.rows = [row]; mocks.layers.time = () => ({ at: '2026-10-12' });
    mocks.downloadLayer.mockResolvedValue();
    open({ caseId: 'case', row });
    const labels = [...document.querySelectorAll('.which label')].map((label) => label.textContent.trim());
    expect(labels).toEqual(['The layer now', 'The layer on 12 Oct 2026', 'Every state, dated for a time slider']);
    document.querySelector('input[value="cursor"]').click(); flushSync();
    document.querySelector('.formats button').click(); await settle();
    expect(mocks.downloadLayer).toHaveBeenLastCalledWith('case', row, 'kmz', { at: '2026-10-12', history: false });
  });

  it('sends one day to My Maps, keeps the address and opens it', async () => {
    mocks.layers.rows = [row]; mocks.layers.time = () => ({ at: '2026-10-12' });
    mocks.downloadLayer.mockResolvedValue();
    mocks.patch.mockResolvedValue({ layer: { ...row, mymaps: 'kept' } });
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onclose = open({ caseId: 'case', row, mode: 'mymaps' });
    // a history is not something My Maps can hold
    expect(document.querySelector('input[value="history"]')).toBeNull();
    const send = document.querySelector('.acts .btn-primary');
    expect(send.disabled).toBe(true);
    const field = document.querySelector('.address input');
    field.value = 'https://www.google.com/maps/d/edit?mid=1AbC'; field.dispatchEvent(new Event('input')); flushSync();
    document.querySelector('input[value="cursor"]').click(); flushSync();
    send.click(); await settle();
    expect(mocks.patch).toHaveBeenCalledWith('/api/cases/case/map-layers/front/edit', { mymaps: 'https://www.google.com/maps/d/edit?mid=1AbC' });
    expect(mocks.edited).toHaveBeenCalledWith('case', { ...row, mymaps: 'kept' });
    expect(mocks.downloadLayer).toHaveBeenCalledWith('case', row, 'kmz', { at: '2026-10-12' });
    expect(opened).toHaveBeenCalledWith('https://www.google.com/maps/d/edit?mid=1AbC', '_blank', 'noopener');
    expect(onclose).toHaveBeenCalledOnce();
    opened.mockRestore();
  });
});
