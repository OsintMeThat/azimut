import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { reloadCase, toast } from './state.svelte.js';
import {
  deletedToast,
  emptyTrash,
  formatSize,
  purgeGroup,
  readTrash,
  restoreGroup,
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
