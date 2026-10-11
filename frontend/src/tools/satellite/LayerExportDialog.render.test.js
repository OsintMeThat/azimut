// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
const mocks = vi.hoisted(() => ({ downloadLayer: vi.fn(), toast: vi.fn() }));
vi.mock('../../lib/map/layerExport.js', () => ({ downloadLayer: mocks.downloadLayer }));
vi.mock('../../lib/state.svelte.js', () => ({ toast: mocks.toast }));
import LayerExportDialog from './LayerExportDialog.svelte';
let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; vi.resetAllMocks(); });
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); flushSync(); };
describe('layer download dialog', () => {
  it('holds the dialog during preparation and closes after downloading', async () => {
    let complete; mocks.downloadLayer.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const onclose = vi.fn(), target = { caseId: 'case', row: { name: 'work', title: 'Working' } };
    held = mount(LayerExportDialog, { target: document.body, props: { target, onclose } }); flushSync();
    document.querySelector('.formats button').click(); flushSync();
    expect(mocks.downloadLayer).toHaveBeenCalledWith('case', target.row, 'kmz');
    expect([...document.querySelectorAll('.formats button')].every((button) => button.disabled)).toBe(true);
    document.querySelector('[aria-label="Close"]').click(); expect(onclose).not.toHaveBeenCalled();
    complete(); await settle(); expect(onclose).toHaveBeenCalledOnce();
  });
  it('shows a refused download and lets the user retry', async () => {
    mocks.downloadLayer.mockRejectedValue(new Error('Layer no longer available')); const onclose = vi.fn();
    held = mount(LayerExportDialog, { target: document.body, props: { target: { caseId: 'case', row: { title: 'Working' } }, onclose } }); flushSync();
    document.querySelector('.formats button').click(); await settle();
    expect(mocks.toast).toHaveBeenCalledWith('Layer no longer available', 'danger');
    expect(onclose).not.toHaveBeenCalled(); expect(document.querySelector('.formats button').disabled).toBe(false);
  });
});
