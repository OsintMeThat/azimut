import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn().mockResolvedValue([]);
const put = vi.fn().mockResolvedValue({});
const del = vi.fn().mockResolvedValue([]);
const get = vi.fn();
vi.mock('./api.js', () => ({
  api: {
    post: (...a) => post(...a),
    put: (...a) => put(...a),
    del: (...a) => del(...a),
    get: (...a) => get(...a),
  },
}));

const { caseState, uiState } = await import('./state.svelte.js');
const folders = await import('./folders.js');
const {
  ancestorsOf, filedToast, inSubtree, leafOf, parentOf, removeFolder, removeFolderPrompt,
  renameFolder, renamedPath, setWorkFolder, workFolder,
} = folders;

beforeEach(() => {
  post.mockClear();
  put.mockClear();
  del.mockClear();
  caseState.current = { id: 'c1', name: 'Case', folders: [], work_folder: null };
  get.mockImplementation(async () => ({ ...caseState.current }));
  uiState.toasts = [];
  uiState.moving = null;
});

describe('paths', () => {
  it('names a folder by its last segment and finds its parent', () => {
    expect(leafOf('Airbase/North')).toBe('North');
    expect(parentOf('Airbase/North')).toBe('Airbase');
    expect(parentOf('Airbase')).toBe('');
    expect(ancestorsOf('A/B/C')).toEqual(['A', 'A/B', 'A/B/C']);
  });

  it('tells a subfolder from a folder that only starts with the same letters', () => {
    expect(inSubtree('Air/North', 'Air')).toBe(true);
    expect(inSubtree('Air', 'Air')).toBe(true);
    expect(inSubtree('Airbase', 'Air')).toBe(false);
    expect(inSubtree('', 'Air')).toBe(false);
  });

  it('renames in place: same parent, one new segment, and nothing when unchanged', () => {
    expect(renamedPath('Airbase/North', ' Hangars ')).toBe('Airbase/Hangars');
    expect(renamedPath('Airbase', 'Isfahan')).toBe('Isfahan');
    expect(renamedPath('Airbase', 'Airbase')).toBeNull();
    expect(renamedPath('Airbase', '  ')).toBeNull();
    expect(renamedPath('Airbase', 'a/b')).toBeNull();
  });
});

describe('folder actions', () => {
  it('renames, then offers the way back on the toast', async () => {
    await renameFolder('c1', 'Airbase', 'Isfahan');
    expect(post).toHaveBeenCalledWith('/api/cases/c1/folders/rename', { source: 'Airbase', target: 'Isfahan' });
    const toast = uiState.toasts.at(-1);
    expect(toast.message).toBe('Renamed to Isfahan');
    await toast.action.onClick();
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/folders/rename', { source: 'Isfahan', target: 'Airbase' });
  });

  it('removes a folder through the server and reloads the case', async () => {
    await removeFolder('c1', 'Air base');
    expect(del).toHaveBeenCalledWith('/api/cases/c1/folders?name=Air%20base');
    expect(get).toHaveBeenCalledWith('/api/cases/c1');
  });

  it('asks before removing, counting the subfolders that go with it', () => {
    const prompt = removeFolderPrompt('Air', ['Air', 'Air/N', 'Air/S', 'Airbase']);
    expect(prompt.message).toBe('“Air” and its 2 subfolders will be removed.');
    expect(prompt.detail).toBe('Items inside are unfiled. No files are deleted.');
    expect(removeFolderPrompt('Airbase', ['Airbase']).message).toBe('“Airbase” will be removed.');
  });

  it('sets the work folder, and clears it with an empty one', async () => {
    await setWorkFolder('c1', 'Airbase');
    expect(put).toHaveBeenLastCalledWith('/api/cases/c1/work-folder', { folder: 'Airbase' });
    await setWorkFolder('c1', '');
    expect(put).toHaveBeenLastCalledWith('/api/cases/c1/work-folder', { folder: null });
  });

  it('reads the work folder off the open case', () => {
    expect(workFolder()).toBeNull();
    caseState.current = { ...caseState.current, work_folder: 'Airbase' };
    expect(workFolder()).toBe('Airbase');
  });
});

describe('filedToast', () => {
  const filed = { id: 'e1', attrs: { folder: 'Air/North' } };

  it('says the plain thing when no work folder took it', () => {
    filedToast('2 files filed', [filed], { fallback: '2 files added to the case' });
    expect(uiState.toasts.at(-1)).toMatchObject({ message: '2 files added to the case', action: null });
  });

  it('names the work folder and offers Move when it took everything', () => {
    caseState.current = { ...caseState.current, work_folder: 'Air/North' };
    filedToast('2 files filed', [filed, { id: 'e2', attrs: { folder: 'Air/North' } }]);
    const toast = uiState.toasts.at(-1);
    expect(toast.message).toBe('2 files filed in North');
    toast.action.onClick();
    expect(uiState.moving.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('does not claim the work folder for what landed elsewhere', () => {
    caseState.current = { ...caseState.current, work_folder: 'Air/North' };
    filedToast('Image filed', [{ id: 'e3', attrs: { folder: '' } }], { fallback: 'Image added to the case' });
    expect(uiState.toasts.at(-1).message).toBe('Image added to the case');
  });

  it('keeps an offer the toast already makes', () => {
    caseState.current = { ...caseState.current, work_folder: 'Air/North' };
    const offer = { label: 'Set source', onClick: () => {} };
    filedToast('1 file filed', [filed], { action: offer });
    expect(uiState.toasts.at(-1)).toMatchObject({ message: '1 file filed in North', action: offer });
  });
});
