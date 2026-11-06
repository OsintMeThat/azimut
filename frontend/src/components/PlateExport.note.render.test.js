// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/** The export dialog of a Graph or a Timeline offers the pinned note the reading as a picture, and only then. */
const PAGE = { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', width: 900, height: 600, filename: 'graph' };
vi.mock('../lib/plateExport.js', () => ({
  writePlate: vi.fn(), copyPlateImage: vi.fn(), revealPlates: vi.fn(), plateScale: () => 2,
}));
vi.mock('../lib/exportDest.js', () => ({
  readDestinations: () => Promise.resolve({ views: '/home/a/reports' }),
  destinationLabel: (path) => String(path).split('/').pop(),
  CASE_FOLDER_LABEL: "the case's exports folder",
}));
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('./views.fixture.svelte.js');
  return { caseState, toast: vi.fn() };
});
vi.mock('./ExportFolderPicker.svelte', async () => await import('./Modal.svelte'));
const { putInNote } = vi.hoisted(() => ({ putInNote: vi.fn(async () => null) }));
vi.mock('../lib/notes/putInNote.svelte.js', async (actual) => ({ ...(await actual()), putInNote }));

const { pinNote } = await import('../lib/notes/putInNote.svelte.js');
const { default: PlateExport } = await import('./PlateExport.svelte');

let live = null;
let unpin = () => {};
afterEach(() => {
  if (live) unmount(live);
  live = null;
  unpin();
  unpin = () => {};
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const figure = { id: 'figure', label: 'This graph', hint: 'A picture of the drawing', put: async () => ({ text: 'x' }) };

async function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(PlateExport, { target, props: { surface: 'graph', plate: () => PAGE, ...props } });
  flushSync();
  target.querySelector('button').click();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  flushSync();
  return target;
}

describe('putting a reading in the note from its export dialog', () => {
  it('shows no row while no note is pinned, or when the tool offers none', async () => {
    await open({ figure });
    expect(document.querySelector('[data-put]')).toBeNull();
    unmount(live);
    live = null;
    document.body.innerHTML = '';
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Network', editor: {} });
    flushSync();
    await open({ figure: null });
    expect(document.querySelector('[data-put]')).toBeNull();
  });

  it('names the note, puts the reading in it and closes the dialog', async () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Network', editor: {} });
    flushSync();
    await open({ figure });
    const row = document.querySelector('[data-put="figure"]');
    expect(row.textContent.trim()).toBe('Put in “Network”');
    row.click();
    flushSync();
    expect(putInNote).toHaveBeenCalledWith(figure);
    expect(document.querySelector('.plate-form')).toBeNull();
  });
});
