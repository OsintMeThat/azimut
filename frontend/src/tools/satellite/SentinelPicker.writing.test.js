// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Writing a layer from the map, which is the only place a script can be judged:
 * Preview draws it over the date and ceiling already chosen, and nothing is
 * filed until Save. The map must never be left showing a preview the user
 * walked away from, and a save must not spend a request to learn what this
 * machine just wrote.
 */

const calls = [];
let radar = '';
vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(async (path) => {
      calls.push(['GET', path]);
      return {
        layers: [],
        max: 40,
        max_script: 4000,
        bands: ['B04', 'B08', 'B11', 'B12'],
        radar_layer: radar,
      };
    }),
    put: vi.fn(async (path, body) => {
      calls.push(['PUT', path, body]);
      if (path.endsWith('/draft-layer')) return { id: 'AZIMUT_DRAFT_ABCDEF123456' };
      return { ...body, label: body.label || body.id, hint: body.hint ?? '' };
    }),
    del: vi.fn(async (path) => {
      calls.push(['DELETE', path]);
      return {};
    }),
  },
}));
const toast = vi.fn();
vi.mock('../../lib/state.svelte.js', () => ({ toast: (...args) => toast(...args) }));

const SentinelPicker = (await import('./SentinelPicker.svelte')).default;
const { sentinelStub } = await import('./sentinelStore.fixture.svelte.js');

let live;
let target;
let s2;

beforeEach(() => {
  calls.length = 0;
  radar = '';
  toast.mockClear();
  s2 = sentinelStub();
  target = document.createElement('div');
  document.body.append(target);
  live = mount(SentinelPicker, {
    target,
    props: {
      s2,
      maxccLabel: () => 'Any cloud',
      monthLabel: () => 'May 2026',
      monthGrid: () => [],
      cloudClass: () => 'clear',
      cloudLabel: () => '',
    },
  });
  flushSync();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

const button = (label) =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));

async function openForm() {
  button('Write a layer…').click();
  await vi.waitFor(() => expect(target.querySelector('[aria-label="Red band"]')).toBeTruthy());
  flushSync();
}

it('offers writing one, and reads the saved list only when asked', async () => {
  expect(button('Write a layer…')).toBeDefined();
  expect(target.querySelector('[aria-label="Red band"]')).toBeNull();
  expect(calls).toEqual([]); // opening the picker asks for nothing
  await openForm();
  // the scripts and the budget are read once the form is actually opened
  expect(calls).toEqual([['GET', '/api/satellite/sentinel/custom-layers']]);
});

it('draws a script on this map before anything is saved', async () => {
  await openForm();
  button('Preview').click();
  await vi.waitFor(() => expect(s2.layer).toBe('AZIMUT_DRAFT_ABCDEF123456'));
  const preview = calls.find(([method, path]) => method === 'PUT' && path.endsWith('/draft-layer'));
  expect(preview[2].base).toBe('TRUE_COLOR');
  expect(preview[2].script).toContain('//VERSION=3');
  // and nothing has been filed under a name yet
  expect(calls.some(([method, path]) => method === 'PUT' && path.endsWith('/custom-layers'))).toBe(
    false
  );
  expect(target.textContent).toContain('Nothing is saved yet');
});

it('keeps the draft and the preview when the form is put away', async () => {
  // Previewing is the reason to close the form — you close it to look at the
  // map — so closing it must not throw away what was typed.
  await openForm();
  const label = target.querySelector('[aria-label="Label"]');
  label.value = 'SWIR plume';
  label.dispatchEvent(new Event('input', { bubbles: true }));
  button('Index').click();
  flushSync();
  button('Preview').click();
  await vi.waitFor(() => expect(s2.draft).toBe(true));

  button('Cancel').click();
  flushSync();
  expect(target.querySelector('[aria-label="Red band"]')).toBeNull(); // put away
  expect(s2.draft).toBe(true); // the map still shows it
  expect(button('Keep writing…')).toBeDefined();
  expect(
    calls.some(([method, path]) => method === 'DELETE' && path.endsWith('/draft-layer'))
  ).toBe(false);

  button('Keep writing…').click();
  await vi.waitFor(() => expect(target.querySelector('[aria-label="Band A"]')).toBeTruthy());
  expect(target.querySelector('[aria-label="Label"]').value).toBe('SWIR plume');
});

it('throws the draft away, and the map with it, only when asked', async () => {
  await openForm();
  button('Preview').click();
  await vi.waitFor(() => expect(s2.draft).toBe(true));
  button('Cancel').click();
  flushSync();

  button('Discard').click();
  await vi.waitFor(() => expect(s2.layer).toBe('TRUE_COLOR'));
  // the preview is this machine's scratch work, and it is forgotten
  expect(
    calls.some(([method, path]) => method === 'DELETE' && path.endsWith('/draft-layer'))
  ).toBe(true);
  expect(button('Write a layer…')).toBeDefined();

  // and a form opened after that starts clean
  button('Write a layer…').click();
  await vi.waitFor(() => expect(target.querySelector('[aria-label="Red band"]')).toBeTruthy());
  expect(target.querySelector('[aria-label="Label"]').value).toBe('');
});

it('keeps a named layer, shows it, and does not re-ask the instance', async () => {
  await openForm();
  const name = target.querySelector('input.mono');
  name.value = 'plume swir';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  button('Save layer').click();
  await vi.waitFor(() => expect(s2.rememberLayer).toHaveBeenCalled());
  expect(s2.rememberLayer.mock.calls[0][0].id).toBe('PLUME_SWIR');
  expect(s2.layer).toBe('PLUME_SWIR');
  expect(s2.loadLayers).not.toHaveBeenCalled();
  expect(target.querySelector('[aria-label="Red band"]')).toBeNull();
});

it('does not offer a configured layer as something to edit', () => {
  // TRUE_COLOR lives in the configuration; its script is not ours to rewrite
  expect(button('Edit this one')).toBeUndefined();
});

it('never offers the radar layer as a Sentinel-2 data source', async () => {
  s2.layers.push({ id: 'RADAR', label: 'Radar' });
  radar = 'RADAR';
  await openForm();
  const source = target.querySelector('[aria-label="Layer to read data from"]');
  expect([...source.options].map((node) => node.value)).toEqual(['TRUE_COLOR', 'SWIR']);
});
