// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../../lib/analyzerFile.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadAnalyzer: vi.fn(),
  importAnalyzerFile: vi.fn(),
}));

const { downloadAnalyzer, importAnalyzerFile } = await import('../../lib/analyzerFile.js');
const AnalyzerLibrary = (await import('./AnalyzerLibrary.svelte')).default;

const METHODS = [{ id: 'rules', label: 'Rules of your own', sizes: { all: {} } }];
const RULE = { measure: 'index', index: 'ndvi', on: 'change', op: 'le', value: -0.2 };
const mine = (over = {}) => ({
  id: 'custom-abc', name: 'Fresh burn', description: 'Burn scars', method: 'rules', colour: '#f6a81a',
  style: 'both', match: 'all', sensor: 'sentinel2', dates: 'two', rules: [RULE], checks: [], ...over,
});
const check = (id) => ({ id, name: `Check ${id}`, a: { date: '2026-05-04' }, b: { date: '2026-05-11' }, marks: [], result: null });

let live, target;
afterEach(() => { if (live) unmount(live); live = null; target?.remove(); });
beforeEach(() => { vi.clearAllMocks(); });

function open(custom, onchanged = async () => {}) {
  const props = $state({
    catalogue: { builtins: [], custom, examples: [], methods: METHODS, groups: [], reliability: {}, as_rules: {} },
    onchanged,
  });
  target = document.createElement('div');
  document.body.append(target);
  live = mount(AnalyzerLibrary, { target, props });
  flushSync();
  return props;
}
const press = (label) => { document.querySelector(`[aria-label="${label}"]`).click(); flushSync(); };
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

it('hands an analyzer with nothing to decide straight to the browser', () => {
  open([mine()]);
  press('Share Fresh burn');
  expect(downloadAnalyzer).toHaveBeenCalledWith('custom-abc');
  expect(document.querySelector('[role="alertdialog"]')).toBe(null);
});

it('asks about the checks before they leave, since they carry where you calibrated', () => {
  open([mine({ checks: [check('a'), check('b')] })]);
  press('Share Fresh burn');
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog.getAttribute('aria-label')).toBe('Share Fresh burn');
  expect(dialog.textContent).toContain('Include its 2 checks');
  expect(dialog.textContent).toContain('none of your keys');

  button('Download').click(); flushSync();
  expect(downloadAnalyzer).toHaveBeenCalledWith('custom-abc', { checks: true });
  expect(document.querySelector('[role="alertdialog"]')).toBe(null);
});

it('leaves the checks behind when the box is cleared', () => {
  open([mine({ checks: [check('a')] })]);
  press('Share Fresh burn');
  expect(document.querySelector('[role="alertdialog"]').textContent).toContain('Include its 1 check');
  const box = document.querySelector('[role="alertdialog"] input[type="checkbox"]');
  box.checked = false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
  button('Download').click(); flushSync();
  expect(downloadAnalyzer).toHaveBeenCalledWith('custom-abc', { checks: false });
});

it('cancelling the share downloads nothing', () => {
  open([mine({ checks: [check('a')] })]);
  press('Share Fresh burn');
  button('Cancel').click(); flushSync();
  expect(downloadAnalyzer).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')).toBe(null);
});

async function pick(text) {
  const input = target.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => text }] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(importAnalyzerFile).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0)); // the reload and the notes it leaves
  flushSync();
}

it('reloads the library on an import and says what the analyzer cannot do here', async () => {
  const onchanged = vi.fn(async () => {});
  importAnalyzerFile.mockResolvedValue({
    analyzer: { id: 'custom-def', name: 'Fresh burn 2' },
    renamed_from: 'Fresh burn', missing_layers: ['BURN_NBR'], ignored_fields: [], written_by: '0.3.2',
  });
  open([mine()], onchanged);
  await pick('{}');

  expect(onchanged).toHaveBeenCalled();
  const notes = [...target.querySelectorAll('.notice li')].map((li) => li.textContent);
  expect(notes).toHaveLength(2);
  expect(notes[0]).toContain('“Fresh burn 2”');
  expect(notes[1]).toContain('BURN_NBR');
});

it('an analyzer that arrived whole leaves no note behind', async () => {
  importAnalyzerFile.mockResolvedValue({
    analyzer: { id: 'custom-def', name: 'Clearing' }, renamed_from: '', missing_layers: [], ignored_fields: [],
  });
  open([mine()]);
  await pick('{}');
  expect(target.querySelector('.notice')).toBe(null);
  expect(target.querySelector('.warn')).toBe(null);
});

it('a file that is not an analyzer says so and changes nothing', async () => {
  const onchanged = vi.fn(async () => {});
  importAnalyzerFile.mockRejectedValue(new Error('this file is not an Azimut analyzer'));
  open([mine()], onchanged);
  await pick('nope');
  expect(target.querySelector('.warn').textContent).toContain('not an Azimut analyzer');
  expect(onchanged).not.toHaveBeenCalled();
  expect(target.querySelector('.notice')).toBe(null);
});
