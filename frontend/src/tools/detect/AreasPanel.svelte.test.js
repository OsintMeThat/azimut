// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../../lib/state.svelte.js', () => ({
  prefs: { units: 'metric' },
  ensureCase: vi.fn(async () => ({ id: 'case-1' })),
  reloadCase: vi.fn(async () => {}),
}));
vi.mock('../../lib/areaFile.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadAreas: vi.fn(),
  importAreasFile: vi.fn(),
}));

const { downloadAreas, importAreasFile } = await import('../../lib/areaFile.js');
const AreasPanel = (await import('./AreasPanel.svelte')).default;

const RING = [[2.29, 48.855], [2.3, 48.855], [2.3, 48.862], [2.29, 48.862], [2.29, 48.855]];
const area = (id, name) => ({ id, name, colour: '#38bdf8', geometry: { type: 'Polygon', coordinates: [RING] } });

let live, target;
afterEach(() => { if (live) unmount(live); live = null; target?.remove(); });
beforeEach(() => { vi.clearAllMocks(); });

function open(extra = {}) {
  const props = $state({
    caseId: 'case-1', areas: [area('aaaaaaaaaaaa', 'Pump 1')], groups: [], routines: [],
    onrefresh: async () => {}, ...extra,
  });
  target = document.createElement('div');
  document.body.append(target);
  live = mount(AreasPanel, { target, props });
  flushSync();
  return props;
}
const press = (label) => {
  const button = [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  button.closest('details')?.setAttribute('open', '');
  flushSync();
  button.click();
  flushSync();
};

it('hands one area on as a file of its own', () => {
  open();
  press('Share area');
  expect(downloadAreas).toHaveBeenCalledWith('case-1', 'areas', 'aaaaaaaaaaaa');
});

it('hands a group on as the folder it is, not as its areas one by one', () => {
  open({ groups: [{ id: '111111111111', title: 'Pumping stations', area_ids: ['aaaaaaaaaaaa'], position: 0 }] });
  press('Share group');
  expect(downloadAreas).toHaveBeenCalledWith('case-1', 'zones', '111111111111');
});

async function pick(text = '{}') {
  const input = target.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => text }] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(importAreasFile).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0)); // the reload and the note it leaves
  flushSync();
}

it('reloads the list on an import and says what arrived and what was renamed', async () => {
  const onrefresh = vi.fn(async () => {});
  importAreasFile.mockResolvedValue({
    areas: [{ id: 'b'.repeat(12), name: 'Pump 1 2' }], groups: [{ id: 'c'.repeat(12), title: 'Stations' }],
    renamed: ['Pump 1'], ignored_fields: [],
  });
  open({ onrefresh });
  await pick();

  expect(importAreasFile).toHaveBeenCalledWith('case-1', expect.anything());
  expect(onrefresh).toHaveBeenCalled();
  const notes = [...target.querySelectorAll('.notice li')].map((li) => li.textContent);
  expect(notes).toHaveLength(2);
  expect(notes[0]).toBe('1 area and 1 group added.');
  expect(notes[1]).toContain('Pump 1');
});

it('a file that is not areas says so and files nothing', async () => {
  const onrefresh = vi.fn(async () => {});
  importAreasFile.mockRejectedValue(new Error('this file is not Azimut areas'));
  open({ onrefresh });
  await pick('nope');
  expect(target.querySelector('.warn').textContent).toContain('not Azimut areas');
  expect(onrefresh).not.toHaveBeenCalled();
  expect(target.querySelector('.notice')).toBe(null);
});
