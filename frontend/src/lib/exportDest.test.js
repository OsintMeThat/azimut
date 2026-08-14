import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import {
  CASE_FOLDER_LABEL,
  createFolder,
  destinationLabel,
  folderRoots,
  listFolder,
  readDestinations,
  saveDestination,
} from './exportDest.js';

vi.mock('./api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('export destinations', () => {
  it('reads every kind and fills missing destinations with the case default', async () => {
    api.get.mockResolvedValue({ export_dirs: { notes: '/reports' } });

    await expect(readDestinations()).resolves.toEqual({
      notes: '/reports',
      media: '',
      proofs: '',
      views: '',
    });
    expect(api.get).toHaveBeenCalledWith('/api/settings');
  });

  it('saves one kind without sending the others back', async () => {
    api.put.mockResolvedValue({ export_dirs: { notes: '', media: '/evidence', proofs: '' } });

    await expect(saveDestination('media', '/evidence')).resolves.toEqual({
      notes: '',
      media: '/evidence',
      proofs: '',
      views: '',
    });
    expect(api.put).toHaveBeenCalledWith('/api/settings/prefs', {
      export_dirs: { media: '/evidence' },
    });
  });

  it('uses the shared folder browser endpoints', async () => {
    api.get.mockResolvedValue({ roots: [] });
    api.post.mockResolvedValue({ name: 'Report', path: '/work/Report' });

    await folderRoots();
    await listFolder('/work/Case one');
    await createFolder('/work', 'Report');

    expect(api.get).toHaveBeenNthCalledWith(1, '/api/folders/roots');
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/folders?path=%2Fwork%2FCase%20one');
    expect(api.post).toHaveBeenCalledWith('/api/folders/create', {
      parent: '/work',
      name: 'Report',
    });
  });

  it('shows only the final folder name and names the default consistently', () => {
    expect(destinationLabel('')).toBe(CASE_FOLDER_LABEL);
    expect(destinationLabel('/work/Report')).toBe('Report');
    expect(destinationLabel('C:\\Work\\Evidence')).toBe('Evidence');
  });
});
