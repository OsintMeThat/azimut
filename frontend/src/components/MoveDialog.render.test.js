// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { patch, get } = vi.hoisted(() => ({ patch: vi.fn(async () => ({})), get: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { patch, get } }));

const { caseState, uiState } = await import('../lib/state.svelte.js');
const { default: MoveDialog } = await import('./MoveDialog.svelte');

let live = null;
let target = null;

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flushSync();
}

function show(entities) {
  caseState.current = { id: 'c1', name: 'Case', folders: ['Port', 'Port/Docks', 'Airbase'] };
  get.mockImplementation(async () => ({ ...caseState.current }));
  uiState.moving = entities;
  target = document.createElement('div');
  document.body.append(target);
  live = mount(MoveDialog, { target });
  flushSync();
}

const dialog = () => document.querySelector('[role="dialog"]');
const button = (label) => [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const option = (label) => [...document.querySelectorAll('.menu .opt')].find((b) => b.textContent.trim().startsWith(label));

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  uiState.moving = null;
  patch.mockClear();
});

describe('Move to…', () => {
  it('opens on where the items already are, and only moves to somewhere else', () => {
    show([{ id: 'p1', type: 'place', label: 'Gate', attrs: { folder: 'Port' } }]);
    expect(dialog().getAttribute('aria-label')).toBe('Move “Gate”');
    expect(dialog().textContent).toContain('Port');
    expect(button('Move').disabled).toBe(true);
  });

  it('files every item the way the sidebar does, then closes', async () => {
    show([
      { id: 'p1', type: 'place', label: 'Gate', attrs: { folder: 'Port' } },
      { id: 'm1', type: 'media', label: 'Shot', attrs: { path: 'media/shot.png', folder: 'Airbase' } },
    ]);
    expect(dialog().getAttribute('aria-label')).toBe('Move 2 items');
    dialog().querySelector('.folder-select .trigger').click();
    flushSync();
    option('Docks').click();
    flushSync();
    button('Move').click();
    await settle();
    expect(patch).toHaveBeenCalledWith('/api/cases/c1/entities/p1', { attrs: { folder: 'Port/Docks' } });
    expect(patch).toHaveBeenCalledWith('/api/cases/c1/media', { path: 'media/shot.png', folder: 'Port/Docks' });
    expect(uiState.moving).toBeNull();
    expect(uiState.toasts.at(-1).message).toBe('Moved 2 items to Port/Docks');
  });

  it('shows nothing while there is nothing to move', () => {
    show(null);
    expect(dialog()).toBeNull();
  });
});
