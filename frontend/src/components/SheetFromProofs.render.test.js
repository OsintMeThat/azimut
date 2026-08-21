// @vitest-environment happy-dom
/**
 * The two shapes a sheet can be built in, and the one screen that asks which.
 *
 * The `geoloc` template and the proofs shape carry almost the same columns and run in
 * opposite directions: one takes addresses in and downloads them, the other lays out
 * proofs the case already established. Choosing between them is the first thing this
 * modal asks, because it decides everything after it — and the outgoing branch takes
 * neither a type nor a field list, which is what these tests are here to hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get, post } }));

const { default: SheetFromCase } = await import('./SheetFromCase.svelte');

const TYPES = [
  { type: 'person', label: 'Person', promotable: true, attrs: [{ key: 'role', label: 'Role' }] },
  { type: 'proof', label: 'Proof', promotable: true, attrs: [] },
];

let live = null;

function open(props) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(SheetFromCase, { target, props });
  flushSync();
  return target;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

const flat = (target) => target.textContent.replace(/\s+/g, ' ');

const press = (target, text) => {
  const found = [...target.querySelectorAll('button')].find((node) =>
    node.textContent.replace(/\s+/g, ' ').trim().startsWith(text),
  );
  found.click();
  flushSync();
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url) => {
    if (url.endsWith('/catalog/summary')) {
      return Promise.resolve({ by_type: { person: 4, proof: 12 } });
    }
    return Promise.resolve(TYPES);
  });
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('choosing what the sheet is', () => {
  const onmake = vi.fn();

  beforeEach(() => onmake.mockReset());

  it('offers both shapes and starts on the one that was here first', async () => {
    const target = open({ caseId: 'c1', onmake, onclose: vi.fn() });
    await settle();
    expect(flat(target)).toContain('One row per entity');
    expect(flat(target)).toContain('My geolocations');
    expect(target.querySelector('.shape.on strong').textContent).toBe('One row per entity');
  });

  it('drops the type and the fields on the outgoing branch', async () => {
    const target = open({ caseId: 'c1', onmake, onclose: vi.fn() });
    await settle();
    // The incoming branch asks both questions: the type, and — on a type that declares
    // any — which of its fields deserve a column.
    expect(target.querySelector('.types')).not.toBeNull();
    press(target, 'Person');
    expect(target.querySelector('.fields')).not.toBeNull();

    press(target, 'My geolocations');
    // The outgoing one asks neither: its shape is fixed, which is what lets it be kept
    // level with the case afterwards.
    expect(target.querySelector('.types')).toBeNull();
    expect(target.querySelector('.fields')).toBeNull();
  });

  it('counts the proofs, not whatever type the other branch was sitting on', async () => {
    const target = open({ caseId: 'c1', onmake, onclose: vi.fn() });
    await settle();
    press(target, 'My geolocations');
    expect(flat(target)).toContain('12 rows, one per proof');
    expect(flat(target)).toContain('its source media, its place and its coordinates');
  });

  it('names the sheet after the shape until the analyst says otherwise', async () => {
    const target = open({ caseId: 'c1', onmake, onclose: vi.fn() });
    await settle();
    press(target, 'My geolocations');
    expect(target.querySelector('input.input').value).toBe('My geolocations');
  });

  it('says the case holds no proofs rather than offering an empty build', async () => {
    get.mockImplementation((url) =>
      url.endsWith('/catalog/summary')
        ? Promise.resolve({ by_type: { person: 4 } })
        : Promise.resolve(TYPES),
    );
    const target = open({ caseId: 'c1', onmake, onclose: vi.fn() });
    await settle();
    press(target, 'My geolocations');
    expect(flat(target)).toContain('This case holds no proofs yet');
    const build = [...target.querySelectorAll('button')].find((node) =>
      node.textContent.includes('Build the sheet'),
    );
    expect(build.disabled).toBe(true);
  });

  it('carries the shape to the route that builds it', async () => {
    const target = open({ caseId: 'c1', onmake, onclose: vi.fn() });
    await settle();
    press(target, 'My geolocations');
    press(target, 'Build the sheet');
    expect(onmake).toHaveBeenCalledWith(
      expect.objectContaining({ shape: 'proofs', title: 'My geolocations' }),
    );
  });

  it('still sends the generic shape with its type and fields', async () => {
    const target = open({ caseId: 'c1', onmake, onclose: vi.fn() });
    await settle();
    press(target, 'Build the sheet');
    expect(onmake).toHaveBeenCalledWith(
      expect.objectContaining({ shape: 'generic', type: 'proof' }),
    );
  });
});
