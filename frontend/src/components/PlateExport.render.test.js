// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const PAGE = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  width: 900,
  height: 600,
  filename: 'graph-rooftop-202608132010',
};

const writePlate = vi.fn(() => Promise.resolve({ file: 'graph.svg', path: '/home/a/reports' }));
const copyPlateImage = vi.fn(() => Promise.resolve());
const revealPlates = vi.fn(() => Promise.resolve());
/** The rule itself is `plateExport.test.js`'s; here it only has to be the same one. */
const plateScale = ({ width, height }) => Math.min(2, 4000 / Math.max(width, height, 1));
vi.mock('../lib/plateExport.js', () => ({ writePlate, copyPlateImage, revealPlates, plateScale }));

const readDestinations = vi.fn(() => Promise.resolve({ views: '/home/a/reports' }));
vi.mock('../lib/exportDest.js', () => ({
  readDestinations,
  destinationLabel: (path) => String(path).split('/').pop(),
  CASE_FOLDER_LABEL: "the case's exports folder",
}));

const toast = vi.fn();
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('./views.fixture.svelte.js');
  return { caseState, toast };
});
vi.mock('./ExportFolderPicker.svelte', async () => await import('./Modal.svelte'));

const { caseState } = await import('./views.fixture.svelte.js');
const { default: PlateExport } = await import('./PlateExport.svelte');

let live = null;

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  flushSync();
}

async function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(PlateExport, { target, props: { surface: 'graph', plate: () => PAGE, ...props } });
  flushSync();
  target.querySelector('button').click();
  await settle();
  return target;
}

/** Scoped to the dialog: the toolbar button that opens it also reads "Export". */
const pressed = (label) =>
  [...document.querySelectorAll('.plate-form button')]
    .find((button) => button.textContent.trim().startsWith(label));

beforeEach(() => {
  caseState.current = { id: 'case-a', name: 'Bakhmut convoy' };
  writePlate.mockClear();
  copyPlateImage.mockClear();
  toast.mockClear();
  readDestinations.mockClear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('exporting a reading', () => {
  it('offers the vector page first, and names where the file will land', async () => {
    await open();

    expect(document.body.textContent).toContain('SVG');
    expect(document.body.textContent).toContain('PNG');
    expect(document.body.textContent).toContain('/home/a/reports');
    expect(document.querySelector('input[value="svg"]').checked).toBe(true);
  });

  it('writes the plate the surface handed over, and offers the folder afterwards', async () => {
    await open();
    pressed('Export').click();
    await settle();

    expect(writePlate).toHaveBeenCalledWith('case-a', PAGE, { format: 'svg' });
    expect(toast.mock.calls[0][0]).toBe('graph.svg written to reports');
    // The toast carries the way back to the file, like every other export.
    expect(toast.mock.calls[0][3].label).toBe('Show');
    toast.mock.calls[0][3].onClick();
    expect(revealPlates).toHaveBeenCalledWith('case-a');
  });

  it('sends an image when the analyst asks for one', async () => {
    await open();
    const png = document.querySelector('input[value="png"]');
    png.checked = true;
    png.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    pressed('Export').click();
    await settle();

    expect(writePlate).toHaveBeenCalledWith('case-a', PAGE, { format: 'png' });
  });

  it('copies the same page as pixels', async () => {
    await open();
    pressed('Copy image').click();
    await settle();

    expect(copyPlateImage).toHaveBeenCalledWith(PAGE);
    expect(toast).toHaveBeenCalledWith('Copied as an image', 'ok');
  });

  it('says there is nothing to export rather than writing an empty page', async () => {
    await open({ plate: () => null });
    pressed('Export').click();
    await settle();

    expect(writePlate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('There is nothing on the graph to export yet.', 'warn');
  });

  it('promises the scale the image will really have', async () => {
    await open();
    expect(document.body.textContent).toContain('twice the page size');

    unmount(live);
    live = null;
    // A page wider than half the canvas cap cannot be rasterised at 2×, and a dialog
    // that says otherwise sends the analyst off with a softer image than it promised.
    await open({ plate: () => ({ ...PAGE, width: 3000, height: 2200 }) });
    expect(document.body.textContent).toContain('at 1.3× the page size');
    expect(document.body.textContent).not.toContain('twice the page size');
  });

  it('does not name the default folder when the saved one could not be read', async () => {
    readDestinations.mockRejectedValueOnce(new Error('settings unreadable'));
    await open();

    expect(document.body.textContent).toContain('the folder saved for views');
    expect(document.body.textContent).not.toContain("the case's exports folder");
  });

  it('reports a failed write instead of closing on it', async () => {
    writePlate.mockRejectedValueOnce(new Error('folder is read-only'));
    await open();
    pressed('Export').click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Export failed: folder is read-only', 'danger');
    expect(document.body.textContent).toContain('Destination');
  });
});
