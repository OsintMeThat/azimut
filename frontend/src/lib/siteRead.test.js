// @vitest-environment happy-dom
/**
 * The session's read of the site: asked on a press only, one at a time, kept for every panel, a deleted folder
 * taken out of it, and forgotten when asked to be.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('./api.js', () => ({ api: { post, get: vi.fn(), put: vi.fn(), del: vi.fn() } }));
const { dropFolder, forgetRead, runRead, siteRead } = await import('./siteRead.svelte.js');

const ANSWER = {
  ok: true, address: 'https://octo.github.io/articles/', home: 'azimut', marked: [''], legal: '', privacy: '',
  items: [{ folder: 'a', title: 'A', role: 'article', category: 'X', bytes: 100 }, { folder: 'b', title: 'B', role: 'article', category: 'X', bytes: 50 }],
  categories: [{ name: 'X', count: 2, pages: [] }], size: { site: 1000, repository: null },
};

beforeEach(() => {
  post.mockReset();
  forgetRead();
});

describe('the read', () => {
  it('is empty until it is pressed, and asks nothing by being imported', () => {
    expect(siteRead.data).toBeNull();
    expect(siteRead.at).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps what a read found, when and of which repository', async () => {
    post.mockResolvedValue(ANSWER);
    expect(await runRead('octo/articles@main')).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/publishing/github/site/read');
    expect(siteRead.data.items.map((entry) => entry.folder)).toEqual(['a', 'b']);
    expect(siteRead.at).toBeInstanceOf(Date);
    expect(siteRead.key).toBe('octo/articles@main');
    expect(siteRead.busy).toBe(false);
  });

  it('runs one read at a time', async () => {
    let answer;
    post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const first = runRead();
    expect(siteRead.busy).toBe(true);
    expect(await runRead()).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    answer(ANSWER);
    expect(await first).toBe(true);
  });

  it('keeps what it had when a later read fails or finds something missing, and says why', async () => {
    post.mockResolvedValueOnce(ANSWER);
    await runRead();
    post.mockRejectedValueOnce(new Error('GitHub did not answer.'));
    expect(await runRead()).toBe(false);
    expect(siteRead.error).toBe('GitHub did not answer.');
    expect(siteRead.data.items).toHaveLength(2);
    post.mockResolvedValueOnce({ ok: false, needs: 'pages', detail: 'Pages is off for octo/articles.' });
    expect(await runRead()).toBe(false);
    expect(siteRead.error).toBe('');
    expect(siteRead.needs).toEqual({ needs: 'pages', detail: 'Pages is off for octo/articles.' });
    // a read that works clears both
    post.mockResolvedValueOnce(ANSWER);
    await runRead();
    expect(siteRead.needs).toBeNull();
  });

  it('takes a deleted folder out of the read, and forgets the whole read on request', async () => {
    post.mockResolvedValue(ANSWER);
    await runRead('octo/articles@main');
    dropFolder('a');
    expect(siteRead.data.items.map((entry) => entry.folder)).toEqual(['b']);
    expect(siteRead.data.categories[0].count).toBe(1);
    expect(siteRead.data.size.site).toBe(900);
    forgetRead();
    expect(siteRead.data).toBeNull();
    expect(siteRead.key).toBe('');
    // nothing to take it out of: no error
    dropFolder('b');
    expect(siteRead.data).toBeNull();
  });
});
