import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { reloadCase, toast } from './state.svelte.js';
import {
  deletedToast,
  deleteEntities,
  emptyTrash,
  entityDeletePrompt,
  formatSize,
  purgeGroup,
  readTrash,
  restoreGroup,
  RESTORABLE,
  trashUrl,
  undoAction,
} from './trash.js';

vi.mock('./api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('./state.svelte.js', () => ({
  reloadCase: vi.fn(),
  toast: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('case trash API', () => {
  it('uses one case-scoped endpoint for list, restore, purge and empty', async () => {
    await readTrash('case-1');
    await restoreGroup('case-1', 'trash-1');
    await purgeGroup('case-1', 'trash-1');
    await emptyTrash('case-1');

    expect(trashUrl('case-1')).toBe('/api/cases/case-1/trash');
    expect(api.get).toHaveBeenCalledWith('/api/cases/case-1/trash');
    expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/trash/trash-1/restore', {});
    expect(api.del).toHaveBeenCalledWith('/api/cases/case-1/trash/trash-1');
    expect(api.del).toHaveBeenCalledWith('/api/cases/case-1/trash');
    expect(reloadCase).toHaveBeenCalledOnce();
  });

  it('only offers undo when the delete returned a trash group', async () => {
    expect(undoAction('case-1', { deleted: ['e1'] })).toBeNull();

    const action = undoAction('case-1', { trash: 'trash-1' });
    expect(action.label).toBe('Undo');
    await action.onClick();

    expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/trash/trash-1/restore', {});
    expect(toast).toHaveBeenCalledWith('Restored', 'ok', 2200);
  });

  it('counts a cascade in the delete toast and attaches its undo', () => {
    deletedToast('case-1', { deleted: ['e1', 'e2'], trash: 'trash-1' }, 'Source');

    expect(toast).toHaveBeenCalledWith(
      'Deleted 2 items',
      'info',
      7000,
      expect.objectContaining({ label: 'Undo' })
    );
  });
});

describe('trash size labels', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1024 * 1024, '1 MB'],
    [1.5 * 1024 * 1024 * 1024, '1.5 GB'],
  ])('formats %s bytes as %s', (bytes, label) => {
    expect(formatSize(bytes)).toBe(label);
  });
});

describe('deleting a selection', () => {
  const rows = [
    { id: 'e1', label: 'Quai sud', type: 'place' },
    { id: 'e2', label: 'Clip', type: 'media' },
  ];

  it('sends a selection over the bulk route, so the whole act is one trash group', async () => {
    await deleteEntities('case-1', ['e1', 'e2']);

    expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/entities/delete', {
      ids: ['e1', 'e2'],
    });
    expect(api.del).not.toHaveBeenCalled();
  });

  it('sends one row over its own route', async () => {
    await deleteEntities('case-1', ['e1']);

    expect(api.del).toHaveBeenCalledWith('/api/cases/case-1/entities/e1');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('counts the selection in the dialog, and promises the way back', async () => {
    const prompt = await entityDeletePrompt('case-1', rows, { get: vi.fn() });

    expect(prompt.title).toBe('Delete 2 items?');
    expect(prompt.confirmLabel).toBe('Delete all');
    expect(prompt.restorable).toBe(RESTORABLE);
    // one of the two is backed by a file, so the dialog says the files go too
    expect(prompt.detail).toBe('Moves the items and their files to the case trash.');
  });

  it('says only what a selection of pure graph rows really touches', async () => {
    const prompt = await entityDeletePrompt('case-1', [rows[0], { id: 'e3', type: 'person' }], {
      get: vi.fn(),
    });

    expect(prompt.detail).toBe('Moves the items to the case trash.');
  });

  it('names the row when there is one, and previews what goes with it', async () => {
    const get = vi.fn(async () => ({ cascade: [{ label: 'Inspect session' }], tombstone: [] }));
    const prompt = await entityDeletePrompt('case-1', [rows[1]], { get });

    expect(get).toHaveBeenCalledWith('/api/cases/case-1/entities/e2/dependents');
    expect(prompt.title).toBe('Delete everywhere?');
    expect(prompt.message).toContain('Clip');
    expect(prompt.consequences.cascade).toHaveLength(1);
  });

  it('asks for no preview per row of a selection, and still asks the dialog', async () => {
    const get = vi.fn();
    const prompt = await entityDeletePrompt('case-1', rows, { get });

    expect(get).not.toHaveBeenCalled();
    expect(prompt.consequences).toBeNull();
  });

  it('opens on the dialog even when the preview fails: the plan is the backend’s', async () => {
    const get = vi.fn(async () => {
      throw new Error('offline');
    });
    const prompt = await entityDeletePrompt('case-1', [rows[0]], { get });

    expect(prompt.consequences).toBeNull();
    expect(prompt.confirmLabel).toBe('Delete everywhere');
  });
});
