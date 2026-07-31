import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('./api.js', () => ({ api: { get, post } }));

const {
  readStatus,
  inspectFolder,
  useFolder,
  useDefaultFolder,
  moveWorkspace,
  discardOldWorkspace,
  offers,
  moveProgress,
  humanBytes,
} = await import('./workspace.js');

const verdict = (over = {}) => ({
  ok: true,
  state: 'empty',
  cases: 0,
  current_cases: 0,
  problems: [],
  warnings: [],
  ...over,
});

describe('workspace folder API', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('reads and inspects without changing anything', async () => {
    get.mockResolvedValue({ root: '/home/a/Azimut' });
    post.mockResolvedValue(verdict());

    await readStatus();
    await inspectFolder('/tmp/target');

    expect(get).toHaveBeenCalledWith('/api/settings/workspace');
    expect(post).toHaveBeenCalledWith('/api/settings/workspace/inspect', { path: '/tmp/target' });
  });

  it('sends each action to its own route', async () => {
    post.mockResolvedValue({});

    await useFolder('/tmp/here');
    await useDefaultFolder();
    await moveWorkspace('/tmp/there');
    await discardOldWorkspace();

    expect(post.mock.calls.map(([path]) => path)).toEqual([
      '/api/settings/workspace/use',
      '/api/settings/workspace/default',
      '/api/settings/workspace/move',
      '/api/settings/workspace/discard-old',
    ]);
  });
});

describe('what a folder may be used for', () => {
  it('offers nothing for a folder that was refused', () => {
    expect(offers(verdict({ ok: false, problems: ['that folder is a file'] }))).toEqual({
      use: false,
      move: false,
      strands: 0,
    });
    expect(offers(null).use).toBe(false);
  });

  it('offers both actions for a usable empty folder', () => {
    expect(offers(verdict())).toMatchObject({ use: true, move: true });
  });

  it('will not move onto a folder that already holds a workspace', () => {
    expect(offers(verdict({ state: 'workspace', cases: 3 }))).toMatchObject({
      use: true,
      move: false,
    });
  });

  it('counts the cases that would stay behind', () => {
    expect(offers(verdict({ current_cases: 4 })).strands).toBe(4);
    expect(offers(verdict({ current_cases: 4, cases: 2 })).strands).toBe(0);
  });
});

describe('move progress', () => {
  it('is nothing before a move starts', () => {
    expect(moveProgress(null)).toEqual({ percent: 0, label: '', done: false });
  });

  it('follows the bytes while copying', () => {
    const progress = moveProgress({
      step: 'copying',
      copied_bytes: 512,
      total_bytes: 2048,
      done: false,
    });

    expect(progress).toEqual({ percent: 25, label: 'Copying', done: false });
  });

  it('does not divide by an empty workspace', () => {
    expect(moveProgress({ step: 'copying', copied_bytes: 0, total_bytes: 0 }).percent).toBe(0);
  });

  it('names each later step and holds the bar full', () => {
    expect(moveProgress({ step: 'verifying' })).toEqual({
      percent: 100,
      label: 'Verifying the copy',
      done: false,
    });
    expect(moveProgress({ step: 'tidying', done: true }).label).toBe(
      'Setting the old folder aside',
    );
  });

  it('shows a step it does not know rather than nothing', () => {
    expect(moveProgress({ step: 'inventing' }).label).toBe('inventing');
  });
});

describe('sizes', () => {
  it('prints what a person would say', () => {
    expect(humanBytes(0)).toBe('0 B');
    expect(humanBytes(512)).toBe('512 B');
    expect(humanBytes(2048)).toBe('2.0 KB');
    expect(humanBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  });
});
