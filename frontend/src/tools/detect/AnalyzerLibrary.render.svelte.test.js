// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const del = vi.fn(async () => ({}));
vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async () => ({})), post: vi.fn(), put: vi.fn(), del } }));
const toast = vi.fn();
vi.mock('../../lib/state.svelte.js', async (importOriginal) => ({ ...(await importOriginal()), toast }));

const { default: AnalyzerLibrary } = await import('./AnalyzerLibrary.svelte');

const MINE = { id: 'an_1', name: 'Port watch', colour: '#22aa88', method: 'rules', rules: [], checks: [] };

let live;
let target;

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  del.mockClear();
});

function mountLibrary(onchanged = vi.fn(async () => {})) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(AnalyzerLibrary, { target, props: { catalogue: { builtins: [], custom: [MINE] }, onchanged } });
  flushSync();
  return onchanged;
}

const dialogButton = (label) =>
  [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim().startsWith(label));

describe('deleting an analyzer of your own', () => {
  it('asks first, naming it, and deletes nothing on Cancel', () => {
    mountLibrary();
    target.querySelector('button[aria-label="Delete Port watch"]').click();
    flushSync();

    expect(document.body.textContent).toContain('Delete Port watch');
    dialogButton('Cancel').click();
    flushSync();
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes once confirmed', async () => {
    const onchanged = mountLibrary();
    target.querySelector('button[aria-label="Delete Port watch"]').click();
    flushSync();
    dialogButton('Delete').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(del).toHaveBeenCalledWith('/api/compare/analyzers/an_1');
    expect(onchanged).toHaveBeenCalled();
  });
});
