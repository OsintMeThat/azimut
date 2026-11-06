// @vitest-environment happy-dom
/** Export, in the Horizon header, offers the pinned note the photo above the terrain and the viewpoint. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { putInNote } = vi.hoisted(() => ({ putInNote: vi.fn(async () => null) }));
vi.mock('../../lib/notes/putInNote.svelte.js', async (actual) => ({ ...(await actual()), putInNote }));

const { pinNote } = await import('../../lib/notes/putInNote.svelte.js');
const { default: ExportMenu } = await import('./ExportMenu.svelte');

let app;
let host;
let unpin = () => {};

const pair = { id: 'pair', label: 'The photo above the terrain', hint: 'Both', put: async () => ({ text: 'x' }) };
const viewpoint = { id: 'viewpoint', label: 'This viewpoint', hint: 'The eye', put: async () => ({ text: 'y' }) };

function show(props = {}) {
  host = document.createElement('div');
  document.body.append(host);
  app = mount(ExportMenu, { target: host, props: { onexport: vi.fn(), onproof: vi.fn(), notes: [pair, viewpoint], ...props } });
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
    expect(rows.map((row) => row.textContent.trim())).toEqual([
      'Put the photo above the terrain in “Ridge above the town”',
      'Put this viewpoint in “Ridge above the town”',
    ]);
    rows[1].click();
    flushSync();
    expect(putInNote).toHaveBeenCalledWith(viewpoint);
    expect(host.querySelector('.em-menu')).toBeNull();
  });

  it('offers only the viewpoint when no photo is laid', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Ridge', editor: {} });
    flushSync();
    show({ notes: [viewpoint] });
    expect([...host.querySelectorAll('[data-put]')].map((row) => row.dataset.put)).toEqual(['viewpoint']);
  });
});
