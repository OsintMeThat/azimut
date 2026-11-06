// @vitest-environment happy-dom
/** Export, in the Horizon header, offers the pinned note an area of the view. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { putInNote } = vi.hoisted(() => ({ putInNote: vi.fn(async () => null) }));
vi.mock('../../lib/notes/putInNote.svelte.js', async (actual) => ({ ...(await actual()), putInNote }));

const { pinNote } = await import('../../lib/notes/putInNote.svelte.js');
const { default: ExportMenu } = await import('./ExportMenu.svelte');

let app;
let host;
let unpin = () => {};

const area = { id: 'area', label: 'An area of the view', hint: 'Drag over the view', put: async () => ({ text: 'x' }) };

function show(props = {}) {
  host = document.createElement('div');
  document.body.append(host);
  app = mount(ExportMenu, { target: host, props: { onexport: vi.fn(), onproof: vi.fn(), notes: [area], ...props } });
  flushSync();
  host.querySelector('.em-open').click();
  flushSync();
}

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = null;
  unpin();
  unpin = () => {};
  vi.clearAllMocks();
});

describe('putting a Horizon view in the note', () => {
  it('shows no row while no note is pinned', () => {
    show();
    expect(host.querySelectorAll('[data-put]')).toHaveLength(0);
  });

  it('names the note and what goes in it, and closes the menu on a press', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Ridge above the town', editor: {} });
    flushSync();
    show();
    const rows = [...host.querySelectorAll('[data-put]')];
    expect(rows.map((row) => row.textContent.trim())).toEqual(['Put an area of the view in “Ridge above the town”']);
    rows[0].click();
    flushSync();
    expect(putInNote).toHaveBeenCalledWith(area);
    expect(host.querySelector('.em-menu')).toBeNull();
  });

  it('offers nothing while no eye stands', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Ridge', editor: {} });
    flushSync();
    show({ notes: [] });
    expect(host.querySelectorAll('[data-put]')).toHaveLength(0);
  });
});
