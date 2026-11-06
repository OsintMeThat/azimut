// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The export dialog offers the pinned note the page it shows or the days picked side by
 * side, and only while a note is pinned: with none, the dialog is as it was.
 */
const { putInNote } = vi.hoisted(() => ({ putInNote: vi.fn(async () => null) }));
vi.mock('../../lib/notes/putInNote.svelte.js', async (actual) => ({ ...(await actual()), putInNote }));

const { pinNote } = await import('../../lib/notes/putInNote.svelte.js');
const { default: PlateExportDialog } = await import('./PlateExportDialog.svelte');

let held = null;
let unpin = () => {};
afterEach(() => {
  if (held) unmount(held);
  held = null;
  unpin();
  document.body.innerHTML = '';
  try { localStorage.clear(); } catch { /* none here */ }
  vi.clearAllMocks();
});

const page = { id: 'plate-page', label: 'This page', hint: 'At print resolution', put: async () => ({ text: 'x' }) };
const days = vi.fn((picked) => ({ id: 'plate-sheet', label: 'The days', hint: 'One still', days: picked, put: async () => ({ text: 'y' }) }));

function show(props = {}) {
  const onclose = vi.fn();
  held = mount(PlateExportDialog, { target: document.body, props: { onexport: vi.fn(), onclose, moments: ['2026-09-01', '2026-09-15', '2026-10-01'], notePage: page, noteSheet: days, ...props } });
  flushSync();
  return { onclose };
}
const row = () => document.body.querySelector('.acts [data-put]');
const radio = (value) => document.body.querySelector(`input[value="${value}"]`);

describe('putting an exported plate in the note', () => {
  it('shows nothing while no note is pinned', () => {
    show();
    expect(row()).toBeNull();
  });

  it('puts the page in the pinned note and closes the dialog', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Port strike', editor: {} });
    flushSync();
    const { onclose } = show();
    expect(row().dataset.put).toBe('plate-page');
    expect(row().textContent.trim()).toBe('Put in “Port strike”');
    row().click();
    expect(putInNote).toHaveBeenCalledWith(page);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('puts the days picked side by side, not the page, when the format is the sheet', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Port strike', editor: {} });
    flushSync();
    show();
    radio('sheet').click();
    flushSync();
    expect(row().dataset.put).toBe('plate-sheet');
    expect(days).toHaveBeenLastCalledWith(['2026-09-01', '2026-09-15', '2026-10-01']);
    const [first] = document.body.querySelectorAll('select');
    first.value = '2026-09-15';
    first.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(days).toHaveBeenLastCalledWith(['2026-09-15', '2026-10-01']);
  });

  it('opens on the PNG the first time, whatever days the plate plays', () => {
    show();
    expect(radio('png').checked).toBe(true);
  });

  it('offers neither for a video', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Port strike', editor: {} });
    flushSync();
    show();
    radio('mp4').click();
    flushSync();
    expect(row()).toBeNull();
  });
});
