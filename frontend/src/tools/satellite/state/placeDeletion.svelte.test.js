// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaceDeletionState } from './placeDeletion.svelte.js';

let api, owner, notify, reloadCase, ondeleted, refresh;
const usage = { place: { id: 'p1', label: 'Gate' }, related: [{ id: 'proof', label: 'Proof' }],
  layers: [{ name: 'working', title: 'Working' }] };
const store = () => createPlaceDeletionState({ api, caseId: () => owner, notify, reloadCase, ondeleted, refresh });
beforeEach(() => {
  owner = 'c1';
  api = { get: vi.fn(async (path) => path.endsWith('/usage') ? usage : { cascade: [], tombstone: [] }),
    del: vi.fn(async () => ({ deleted: ['p1'], trash: 'trash-1' })) };
  notify = vi.fn(); reloadCase = vi.fn(); ondeleted = vi.fn(); refresh = vi.fn();
});

describe('place deletion', () => {
  it('reads links and memberships before asking and deletes only after confirmation', async () => {
    const state = store();
    expect(api.get).not.toHaveBeenCalled();
    await state.open('p1');
    expect(state.target.usage).toEqual(usage);
    expect(api.get).toHaveBeenCalledWith('/api/cases/c1/entities/p1/dependents');
    expect(api.del).not.toHaveBeenCalled();
    await state.confirm();
    expect(api.del).toHaveBeenCalledWith('/api/cases/c1/entities/p1');
    expect(reloadCase).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(ondeleted).toHaveBeenCalledWith('c1', { deleted: ['p1'], trash: 'trash-1' }, 'Gate');
    expect(state.target).toBeNull();
  });

  it('refuses to present missing link information as an empty preview', async () => {
    api.get.mockRejectedValueOnce(new Error('Cannot read links'));
    const state = store();
    await state.open('p1');
    expect(state.target).toBeNull();
    await state.confirm();
    expect(api.del).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Cannot read links', 'danger');
  });

  it('ignores a preview arriving after cancel or a case switch', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const state = store();
    const opening = state.open('p1');
    state.cancel(); owner = 'c2';
    finish(usage);
    await opening;
    expect(state.target).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('cannot delete a place from a dialog belonging to another case', async () => {
    const state = store(); await state.open('p1');
    owner = 'c2'; await state.confirm();
    expect(api.del).not.toHaveBeenCalled();
  });
});
