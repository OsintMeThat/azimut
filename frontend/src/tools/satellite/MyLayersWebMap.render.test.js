// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/** My layers › Publish as a web map…: one press makes the note and opens the Notebook on it. */

const { makeWebMap, openNotebook, toast } = vi.hoisted(() => ({ makeWebMap: vi.fn(), openNotebook: vi.fn(), toast: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async () => ({ colours: [] })), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() } }));
vi.mock('../../lib/notes/webMap.js', () => ({ makeWebMap }));
vi.mock('../../lib/navigate.js', () => ({ openNotebook }));
vi.mock('../../lib/state.svelte.js', async (actual) => ({ ...(await actual()), toast, caseState: { current: { id: 'case-a' } } }));

const { default: MyLayers } = await import('./MyLayers.svelte');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ROW = { name: 'vehicles', title: 'Vehicles by kind', editable: true, enabled: true, features: 54, source: { kind: 'editable' } };

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('Publish as a web map', () => {
  it('makes the layer a web map and opens the Notebook on it', async () => {
    makeWebMap.mockResolvedValue({ id: 'n7' });
    held = mount(MyLayers, { target: document.body, props: { rows: [ROW], controller: { editor: null } } });
    flushSync();
    const button = document.querySelector('button[aria-label="Publish Vehicles by kind as a web map"]');
    expect(button.title).toContain('Publish as a web map…');
    button.click();
    await settle();
    expect(makeWebMap).toHaveBeenCalledWith('case-a', { title: 'Vehicles by kind', layers: ['vehicles'] });
    expect(openNotebook).toHaveBeenCalledWith('n7');
  });

  it('says why when the map cannot be made, and opens nothing', async () => {
    makeWebMap.mockRejectedValue(new Error('The imagery could not be fetched'));
    held = mount(MyLayers, { target: document.body, props: { rows: [ROW], controller: { editor: null } } });
    flushSync();
    document.querySelector('button[aria-label="Publish Vehicles by kind as a web map"]').click();
    await settle();
    expect(toast).toHaveBeenLastCalledWith('The imagery could not be fetched', 'danger');
    expect(openNotebook).not.toHaveBeenCalled();
  });
});
