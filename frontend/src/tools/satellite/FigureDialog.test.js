// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { MAX_PANELS } from '../../lib/figures.js';

/**
 * Building a figure from the map: pick the layers, caption them, press once.
 *
 * What matters is that the request says what the figure is — one day, each
 * layer once, captions in the analyst's words — and that the dialog refuses
 * what the route would refuse rather than rendering panels and then failing.
 */

const calls = [];
vi.mock('../../lib/api.js', () => ({
  api: {
    post: vi.fn(async (path, body) => {
      calls.push([path, body]);
      return { proof: { name: 'Fujairah plume' }, panels: body.panels };
    }),
  },
}));
const toast = vi.fn();
vi.mock('../../lib/state.svelte.js', () => ({ toast: (...args) => toast(...args) }));

const FigureDialog = (await import('./FigureDialog.svelte')).default;

let live;
let target;
let built;

const LAYERS = [
  { id: 'TRUE_COLOR', label: 'True colour', hint: 'What the eye would see' },
  { id: 'SWIR', label: 'SWIR', hint: 'Hot ground' },
  { id: 'PLUME_SWIR', label: 'My plume', hint: 'mine', custom: true },
];

function open(props = {}) {
  built = vi.fn();
  target = document.createElement('div');
  document.body.append(target);
  live = mount(FigureDialog, {
    target,
    props: {
      caseId: 'case-1',
      day: '2026-10-04',
      maxcc: 100,
      view: { lat: 26.383333, lon: 56.438333, zoom: 14.2, bearing: 0 },
      width: 900,
      height: 700,
      layers: LAYERS,
      onclose: vi.fn(),
      onbuilt: built,
      ...props,
    },
  });
  flushSync();
  return target;
}

beforeEach(() => {
  calls.length = 0;
  toast.mockClear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.body.innerHTML = '';
});

const button = (label) =>
  [...document.querySelectorAll('button')].find((node) =>
    node.textContent.trim().startsWith(label)
  );
const pick = (label) => {
  const row = [...document.querySelectorAll('.pick')].find((node) =>
    node.textContent.includes(label)
  );
  row.querySelector('input').click();
  flushSync();
};
const type = (selector, value) => {
  const field = document.querySelector(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};

it('says what a figure is, and which acquisition this one is of', () => {
  open();
  expect(document.body.textContent).toContain('2026-10-04');
  expect(document.body.textContent).toContain('filed as its own capture');
});

it('will not build an undated figure, and says why', () => {
  open({ day: '' });
  // every panel is the same acquisition, so there is nothing to build from
  expect(document.body.textContent).toContain('Pick a date first');
  expect(button('Build the figure')).toBeUndefined();
});

it('builds nothing until a layer is picked and the figure is named', () => {
  open();
  expect(button('Build the figure').disabled).toBe(true);
  pick('True colour');
  expect(button('Build the figure').disabled).toBe(true);
  expect(button('Build the figure').title).toContain('Name the figure');
  type('[aria-label="Figure title"]', 'Fujairah plume');
  expect(button('Build the figure').disabled).toBe(false);
});

it('sends one day, the picked layers in order, and the analyst’s captions', async () => {
  open();
  type('[aria-label="Figure title"]', 'Fujairah plume');
  pick('True colour');
  pick('SWIR');
  type('[aria-label="Caption for True colour"]', 'Visible plume (RGB)');

  button('Build the figure').click();
  await vi.waitFor(() => expect(calls.length).toBe(1));
  const [path, body] = calls[0];
  expect(path).toBe('/api/cases/case-1/satellite/figure');
  expect(body.day).toBe('2026-10-04');
  expect(body.zoom).toBe(14); // a zoom is a whole number to the backend
  expect(body.panels).toEqual([
    { layer: 'TRUE_COLOR', caption: 'Visible plume (RGB)' },
    { layer: 'SWIR', caption: 'SWIR' },
  ]);
  expect(body.width).toBe(900);
  expect(body.per_row).toBe(2);
});

it('opens the figure it built, rather than leaving it to be found', async () => {
  open();
  type('[aria-label="Figure title"]', 'Fujairah plume');
  pick('SWIR');
  button('Build the figure').click();
  await vi.waitFor(() => expect(built).toHaveBeenCalled());
  expect(built.mock.calls[0][0].proof.name).toBe('Fujairah plume');
});

it('numbers the panels down the list, so a caption can be referred to', () => {
  open();
  pick('SWIR');
  pick('My plume');
  const numbers = [...document.querySelectorAll('.pick')]
    .map((node) => node.querySelector('.num').textContent.trim())
    .filter(Boolean);
  expect(numbers).toEqual(['1.', '2.']);
});

it('offers a layer written here beside the configured ones, and marks it', () => {
  open();
  const row = [...document.querySelectorAll('.pick')].find((node) =>
    node.textContent.includes('My plume')
  );
  expect(row.textContent).toContain('yours');
});

it('stops at the panel count the route stops at', () => {
  const many = Array.from({ length: MAX_PANELS + 2 }, (_, n) => ({
    id: `L${n}`,
    label: `Layer ${n}`,
  }));
  open({ layers: many });
  for (const entry of many) {
    const row = [...document.querySelectorAll('.pick')].find((node) =>
      node.textContent.includes(entry.label)
    );
    const box = row.querySelector('input');
    if (!box.disabled) box.click();
    flushSync();
  }
  expect(document.body.textContent).toContain(`${MAX_PANELS}/${MAX_PANELS}`);
  expect(calls).toEqual([]);
});

it('unpicking a layer renumbers the rest', () => {
  open();
  pick('True colour');
  pick('SWIR');
  pick('My plume');
  pick('SWIR'); // off again
  const rows = [...document.querySelectorAll('.pick')].map((node) => ({
    text: node.textContent,
    num: node.querySelector('.num').textContent.trim(),
  }));
  expect(rows.find((row) => row.text.includes('True colour')).num).toBe('1.');
  expect(rows.find((row) => row.text.includes('SWIR')).num).toBe('');
  expect(rows.find((row) => row.text.includes('My plume')).num).toBe('2.');
});
