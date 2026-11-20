import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Open the example case: one press asks the server for it, waits for its import when it
 * is new, then opens it on the Notebook. Nothing else is asked of the network.
 */

const uiState = { tool: 'home' };
const toast = vi.fn();
const openCase = vi.fn(async () => true);
const refreshCaseList = vi.fn(async () => {});
vi.mock('./state.svelte.js', () => ({ uiState, toast, openCase, refreshCaseList, sessionStarted: () => Promise.resolve() }));
const post = vi.fn();
vi.mock('./api.js', () => ({ api: { post: (...args) => post(...args) } }));
const waitForBundle = vi.fn();
vi.mock('./bundles.js', () => ({ waitForBundle: (...args) => waitForBundle(...args) }));

const { EXAMPLE_NAME, openExampleCase } = await import('./exampleCase.js');

beforeEach(() => {
  uiState.tool = 'home';
  for (const mock of [toast, openCase, refreshCaseList, post, waitForBundle]) mock.mockReset();
  openCase.mockResolvedValue(true);
});

describe('the example case', () => {
  it('is named as the server names it, fictional in its name', () => {
    expect(EXAMPLE_NAME).toBe('Example case (fictional)');
  });

  it('is made from the bundle the app ships, then opened on its notes', async () => {
    post.mockResolvedValue({ case_id: 'c9', name: EXAMPLE_NAME, job_id: 'j1', state: 'queued' });
    waitForBundle.mockResolvedValue({ state: 'ready' });
    expect(await openExampleCase()).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/cases/example', {});
    expect(waitForBundle).toHaveBeenCalledWith('c9', 'j1');
    expect(refreshCaseList).toHaveBeenCalled();
    expect(openCase).toHaveBeenCalledWith('c9');
    expect(uiState.tool).toBe('notebook');
  });

  it('opens the one already made without importing it again', async () => {
    post.mockResolvedValue({ case_id: 'c9', name: EXAMPLE_NAME, job_id: null, state: 'ready' });
    expect(await openExampleCase()).toBe(true);
    expect(waitForBundle).not.toHaveBeenCalled();
    expect(openCase).toHaveBeenCalledWith('c9');
  });

  it('says why when the import fails, and stays where it was', async () => {
    post.mockResolvedValue({ case_id: 'c9', name: EXAMPLE_NAME, job_id: 'j1', state: 'queued' });
    waitForBundle.mockResolvedValue({ state: 'failed', error: 'not enough free space' });
    expect(await openExampleCase()).toBe(false);
    expect(openCase).not.toHaveBeenCalled();
    expect(uiState.tool).toBe('home');
    expect(toast).toHaveBeenCalledWith('The example case could not be made: not enough free space', 'danger', 7000);
  });

  it('leaves the tool alone when the case being left keeps itself open', async () => {
    post.mockResolvedValue({ case_id: 'c9', name: EXAMPLE_NAME, job_id: null, state: 'ready' });
    openCase.mockResolvedValue(false);
    expect(await openExampleCase()).toBe(false);
    expect(uiState.tool).toBe('home');
  });

  it('answers one press at a time', async () => {
    let answer;
    post.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const first = openExampleCase();
    expect(await openExampleCase()).toBe(false);
    answer({ case_id: 'c9', name: EXAMPLE_NAME, job_id: null, state: 'ready' });
    expect(await first).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
