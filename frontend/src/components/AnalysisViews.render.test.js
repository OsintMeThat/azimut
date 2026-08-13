// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/** Rows whose three orderings all differ, so a sort choice can be told apart. */
const VIEWS = [
  {
    id: 'v_ports', name: 'ports', mode: 'live', surface: 'board',
    snapshot_count: 0, created_at: '2026-08-12T09:00:00Z', updated_at: '2026-08-12T09:00:00Z',
  },
  {
    id: 'v_ammo', name: 'Ammunition', mode: 'snapshot', surface: 'graph',
    snapshot_count: 340, created_at: '2026-08-11T18:30:00Z', updated_at: '2026-08-11T18:30:00Z',
  },
  {
    id: 'v_bridge', name: 'Bridges', mode: 'live', surface: 'graph',
    snapshot_count: 0, created_at: '2026-08-13T07:15:00Z', updated_at: '2026-08-13T07:15:00Z',
  },
];

const patch = vi.fn((url, body) => {
  const id = url.split('/').pop();
  const row = VIEWS.find((view) => view.id === id);
  return Promise.resolve({ ...row, name: body.name, updated_at: '2026-08-13T11:00:00Z' });
});

vi.mock('../lib/api.js', () => ({
  api: {
    get: () => Promise.resolve({ views: VIEWS }),
    post: vi.fn(),
    put: vi.fn(),
    patch,
    del: vi.fn(),
  },
}));

const toast = vi.fn();
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('./views.fixture.svelte.js');
  return { caseState, registerCaseChangeGuard: () => () => {}, toast };
});
vi.mock('../lib/trash.js', () => ({ restoreGroup: vi.fn() }));

const { caseState } = await import('./views.fixture.svelte.js');
const { activateAnalysisView, catalogViews, openAnalysisCase } =
  await import('../lib/analysisSearch.svelte.js');
const { default: AnalysisViews } = await import('./AnalysisViews.svelte');

let live = null;

async function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(AnalysisViews, { target, props: { surface: 'board', ...props } });
  flushSync();
  await settle();
  target.querySelector('button[aria-expanded]').click();
  flushSync();
  return target;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  flushSync();
}

const labelled = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const names = (root) => [...root.querySelectorAll('.open strong')].map((el) => el.textContent);
const row = (root, name) =>
  [...root.querySelectorAll('.open')].find((el) => el.querySelector('strong').textContent === name);

function sortBy(root, order) {
  const select = root.querySelector('select');
  select.value = order;
  // Svelte 5 delegates `change` from the root, so a non-bubbling event never lands.
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
  return select;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  caseState.current = { id: 'case-a', name: 'Renaming' };
  openAnalysisCase(null);
  patch.mockClear();
  toast.mockClear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('managing saved views', () => {
  it('states each reading with its surface and when it was last written', async () => {
    const root = await open();

    expect(row(root, 'Ammunition').textContent.replace(/\s+/g, ' '))
      .toContain('340 captured · graph · ');
    expect(row(root, 'Ammunition').querySelector('time').getAttribute('title'))
      .toBe('2026-08-11 18:30 UTC');
    expect(row(root, 'ports').textContent.replace(/\s+/g, ' ')).toContain('live · board · ');
  });

  it('opens on the order the case wrote, and re-sorts on request', async () => {
    const root = await open();
    expect(names(root)).toEqual(['Bridges', 'ports', 'Ammunition']);

    const select = sortBy(root, 'name');
    expect([...select.options].map((option) => option.value))
      .toEqual(['recent', 'name', 'surface']);
    expect(names(root)).toEqual(['Ammunition', 'Bridges', 'ports']);

    sortBy(root, 'surface');
    expect(names(root)).toEqual(['ports', 'Ammunition', 'Bridges']);
  });

  it('offers no ordering for a list with nothing to order', async () => {
    const root = await open({ surface: 'timeline' });

    expect(root.querySelector('select')).toBeNull();
    expect(root.querySelector('.empty').textContent).toContain('No saved timeline views yet.');
  });

  it('renames a frozen capture in place, without sending its spec back', async () => {
    const root = await open();
    labelled(root, 'Rename Ammunition').click();
    flushSync();

    const input = labelled(root, 'New name for Ammunition');
    expect(document.activeElement).toBe(input);
    input.value = '  Ammunition depot  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();

    expect(patch).toHaveBeenCalledWith(
      '/api/cases/case-a/analysis-views/v_ammo', { name: 'Ammunition depot' }
    );
    expect(names(root)).toContain('Ammunition depot');
    expect(toast).not.toHaveBeenCalled();
  });

  it('carries the new name onto the reading being held, so an autosave keeps it', async () => {
    const root = await open();
    activateAnalysisView('case-a', {
      id: 'v_ports', name: 'ports', mode: 'live', surface: 'board',
      spec: { query: { filter: {} } },
    });
    flushSync();

    labelled(root, 'Rename ports').click();
    flushSync();
    const input = labelled(root, 'New name for ports');
    input.value = 'Port berths';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    labelled(root, 'Save name').click();
    await settle();

    expect(catalogViews.activeView.name).toBe('Port berths');
  });

  it('leaves a name alone when the edit is abandoned', async () => {
    const root = await open();
    labelled(root, 'Rename ports').click();
    flushSync();
    const input = labelled(root, 'New name for ports');
    input.value = 'Discarded';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();

    expect(patch).not.toHaveBeenCalled();
    expect(names(root)).toContain('ports');
  });
});
