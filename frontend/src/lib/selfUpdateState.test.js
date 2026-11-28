/**
 * @vitest-environment happy-dom
 *
 * The one-click update's store: the box is the only say-so for a download, the
 * press the only one for an install, and the tab says how the restart went.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

let api;
let store;
let state;

const binary = { kind: 'binary', system: 'linux', program: '/home/u/Apps/azimut-linux-x86_64' };
const able = { state: 'idle', supported: true, reason: null, busy: null };

beforeEach(async () => {
  vi.resetModules();
  ({ api } = await import('./api.js'));
  for (const verb of ['get', 'post', 'put']) api[verb].mockReset();
  state = await import('./state.svelte.js');
  store = await import('./selfUpdateState.svelte.js');
  state.prefs.updateCheckOnStart = true;
  state.prefs.updateAutoDownload = false;
  state.updatesState.app = { update_available: true, latest: 'v0.3.5', install: binary, self_update: able };
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('the box is the say-so for a download', () => {
  it('downloads nothing while unticked', async () => {
    await store.prepareIfTicked();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('ticking it saves the setting and downloads the release the check found', async () => {
    api.put.mockResolvedValue({ update_auto_download: true });
    api.post.mockResolvedValue({ ...able, state: 'ready', version: '0.3.5' });
    await store.setAutoDownload(true);
    expect(api.put).toHaveBeenCalledWith('/api/settings/prefs', { update_auto_download: true });
    expect(api.post).toHaveBeenCalledWith('/api/settings/update/prepare', { tag: 'v0.3.5' });
    expect(store.selfUpdate.state).toBe('ready');
  });

  it('a box that could not be saved goes back and downloads nothing', async () => {
    api.put.mockRejectedValue(new Error('disk full'));
    await store.setAutoDownload(true);
    expect(state.prefs.updateAutoDownload).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
    expect(state.uiState.toasts.at(-1).message).toContain('disk full');
  });

  it('unticking it forgets the download', async () => {
    store.adopt({ ...able, state: 'ready', version: '0.3.5' }, binary);
    api.put.mockResolvedValue({ update_auto_download: false });
    await store.setAutoDownload(false);
    expect(store.selfUpdate.state).toBe('idle');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a refused download says why', async () => {
    state.prefs.updateAutoDownload = true;
    api.post.mockRejectedValue(new Error('The release has no signed binary for this system.'));
    await store.prepareIfTicked();
    expect(store.selfUpdate.state).toBe('failed');
    expect(store.selfUpdate.error).toBe('The release has no signed binary for this system.');
  });

  it('follows the progress until the download is ready, then stops asking', async () => {
    vi.useFakeTimers();
    state.prefs.updateAutoDownload = true;
    api.post.mockResolvedValue({ ...able, state: 'downloading', version: '0.3.5', done: 0, total: 10 });
    api.get
      .mockResolvedValueOnce({ self_update: { ...able, state: 'downloading', version: '0.3.5', done: 5, total: 10 } })
      .mockResolvedValueOnce({ self_update: { ...able, state: 'ready', version: '0.3.5', done: 10, total: 10 } });
    await store.prepareIfTicked();
    await vi.advanceTimersByTimeAsync(500);
    expect(store.selfUpdate.done).toBe(5);
    await vi.advanceTimersByTimeAsync(500);
    expect(store.selfUpdate.state).toBe('ready');
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});

describe('the press is the say-so for an install', () => {
  it('starts the restart, remembers it across the reload and closes the pop-up', async () => {
    vi.useFakeTimers();
    state.updateState.show = true;
    api.post.mockResolvedValue({ restarting: true, version: '0.3.5' });
    await store.installNow();
    expect(api.post).toHaveBeenCalledWith('/api/settings/update/install');
    expect(store.restart).toEqual({ phase: 'restarting', version: '0.3.5' });
    expect(localStorage.getItem(store.MARK)).toBe('0.3.5');
    expect(state.updateState.show).toBe(false);
  });

  it('an install the server holds back says why and starts nothing', async () => {
    api.post.mockRejectedValue(new Error('Waits for the media download to finish.'));
    api.get.mockResolvedValue({ self_update: able });
    await store.installNow();
    expect(store.restart.phase).toBe('');
    expect(localStorage.getItem(store.MARK)).toBeNull();
    expect(state.uiState.toasts.at(-1).message).toContain('media download');
  });

  it('says it lost Azimut when nothing answers for two minutes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    api.post.mockResolvedValue({ restarting: true, version: '0.3.5' });
    await store.installNow();
    await vi.advanceTimersByTimeAsync(121_000);
    expect(store.restart.phase).toBe('lost');
    vi.unstubAllGlobals();
  });
});

describe('back from the restart', () => {
  it('says the update landed, once', () => {
    localStorage.setItem(store.MARK, '0.3.5');
    state.appInfo.version = '0.3.5';
    store.announceRestart();
    expect(state.uiState.toasts.at(-1)).toMatchObject({ kind: 'ok', message: expect.stringContaining('Updated to 0.3.5') });
    expect(localStorage.getItem(store.MARK)).toBeNull();
  });

  it('says it did not when the old version answers', () => {
    localStorage.setItem(store.MARK, '0.3.5');
    state.appInfo.version = '0.3.4';
    store.announceRestart();
    expect(state.uiState.toasts.at(-1)).toMatchObject({ kind: 'danger', message: '0.3.5 did not install. You are still on 0.3.4.' });
  });

  it('says nothing on an ordinary load', () => {
    const before = state.uiState.toasts.length;
    store.announceRestart();
    expect(state.uiState.toasts.length).toBe(before);
  });
});
