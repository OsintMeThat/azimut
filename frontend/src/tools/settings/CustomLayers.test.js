// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The list half of writing a layer: Settings keeps them, the map writes them.
 * What matters here is that the card is honest without a key — visible and
 * marked, not hidden — and that removing one says what it costs.
 */

let saved = [];
const calls = [];
vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(async (path) => {
      calls.push(['GET', path]);
      return { layers: saved, max: 40, max_script: 4000 };
    }),
    put: vi.fn(async (path, body) => {
      calls.push(['PUT', path, body]);
      saved = [...saved.filter((row) => row.id !== body.id), body];
      return body;
    }),
    del: vi.fn(async (path) => {
      calls.push(['DELETE', path]);
      saved = saved.filter((row) => !path.endsWith(row.id));
      return {};
    }),
  },
}));
vi.mock('../../lib/state.svelte.js', () => ({ toast: vi.fn() }));

const CustomLayers = (await import('./CustomLayers.svelte')).default;

let live;
let target;

function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CustomLayers, { target, props: { keyed: true, ...props } });
  flushSync();
  return target;
}

const button = (label) =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));

beforeEach(() => {
  calls.length = 0;
  saved = [];
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

it('stays visible without a key, and says what is missing', () => {
  const root = open({ keyed: false });
  expect(root.textContent).toContain('Save your Sentinel Hub key above');
  expect(root.querySelector('.custom-layers').classList.contains('locked')).toBe(true);
  // the option is marked, not taken away: it is still worth knowing it exists
  expect(button('Write one')).toBeDefined();
});

it('says nothing about a missing key once there is one', () => {
  expect(open({ keyed: true }).textContent).not.toContain('Sentinel Hub key above');
});

it('lists what is saved, with the layer each script reads through', async () => {
  saved = [{ id: 'PLUME_SWIR', label: 'SWIR plume', base: 'TRUE_COLOR', hint: 'hot spots', script: 'x' }];
  const root = open();
  await vi.waitFor(() => expect(root.textContent).toContain('PLUME_SWIR'));
  expect(root.textContent).toContain('hot spots');
  expect(root.textContent).toContain('reads TRUE_COLOR');
  expect(root.textContent).toContain('1/40');
});

it('reads the list without asking Copernicus anything', async () => {
  open();
  await vi.waitFor(() => expect(calls.length).toBe(1));
  expect(calls[0]).toEqual(['GET', '/api/satellite/sentinel/custom-layers']);
});

it('opens the saved script to edit, and keeps the name', async () => {
  saved = [{ id: 'PLUME_SWIR', label: 'Plume', base: 'SWIR', hint: '', script: '//VERSION=3\nkept\n' }];
  const root = open();
  await vi.waitFor(() => expect(button('Edit')).toBeDefined());
  button('Edit').click();
  flushSync();
  expect(root.querySelector('textarea').value).toBe('//VERSION=3\nkept\n');
  expect(root.querySelector('input.mono').disabled).toBe(true);
});

it('warns that removing one stops rendering work already filed under it', async () => {
  saved = [{ id: 'PLUME_SWIR', label: 'Plume', base: 'TRUE_COLOR', hint: '', script: 'x' }];
  open();
  await vi.waitFor(() => expect(button('Remove')).toBeDefined());
  expect(button('Remove').title).toContain('provenance');
  button('Remove').click();
  await vi.waitFor(() =>
    expect(calls.some(([method]) => method === 'DELETE')).toBe(true)
  );
});

it('stops offering a new one when the list is full', async () => {
  saved = Array.from({ length: 40 }, (_, index) => ({
    id: `L${index}`, label: '', base: 'TRUE_COLOR', hint: '', script: 'x',
  }));
  const root = open();
  await vi.waitFor(() => expect(root.textContent).toContain('40/40'));
  expect(button('Write one').disabled).toBe(true);
  expect(button('Write one').title).toContain('remove one first');
});
