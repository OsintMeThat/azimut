/**
 * @vitest-environment happy-dom
 *
 * The startup check reads the extension's marker off <html>, so this file needs
 * a document like extBridge's own tests do.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { caseState, uiState, closeCase, setSidebarWidth } from './state.svelte.js';
import { MIN_W, MAX_W } from './sidebar.js';

// The prefs tests below exercise import-time module state, so the transport is
// stubbed and the module re-imported fresh per test. The static import above
// still works: these tests never call the API.
vi.mock('./api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

async function freshState() {
  vi.resetModules();
  return import('./state.svelte.js');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('closeCase', () => {
  beforeEach(() => {
    caseState.current = { id: 'case-a', name: 'Case A' };
    uiState.composeQueue = ['media/a.jpg'];
    uiState.postProof = { title: 'x' };
    uiState.openProof = 'proof-a';
    uiState.openDraft = 'draft-a';
    uiState.inspectPath = 'media/a.jpg';
    uiState.focusMedia = 'media/a.jpg';
    uiState.openInspect = 'session-a';
    uiState.drawInGraph = { label: 'A question' };
    uiState.openBoardEntity = 'entity-a';
    uiState.openGraphEntity = 'entity-a';
    uiState.timelineFocus = { itemId: 'event-a' };
    uiState.timelineRange = { from: '2026-01-01', to: '2026-02-01' };
    uiState.mapTimelineRange = { from: '2026-01-01', to: '2026-02-01' };
    uiState.gotoCoords = { lat: 1, lon: 2 };
  });

  it('drops the open case', () => {
    closeCase();
    expect(caseState.current).toBeNull();
  });

  it('clears every cross-tool handoff, so nothing meant for the closed case leaks into whatever opens next', () => {
    closeCase();
    expect(uiState.composeQueue).toEqual([]);
    expect(uiState.postProof).toBeNull();
    expect(uiState.openProof).toBeNull();
    expect(uiState.openDraft).toBeNull();
    expect(uiState.inspectPath).toBeNull();
    expect(uiState.focusMedia).toBeNull();
    expect(uiState.openInspect).toBeNull();
    expect(uiState.drawInGraph).toBeNull();
    expect(uiState.openBoardEntity).toBeNull();
    expect(uiState.openGraphEntity).toBeNull();
    expect(uiState.timelineFocus).toBeNull();
    expect(uiState.timelineRange).toBeNull();
    expect(uiState.mapTimelineRange).toBeNull();
    expect(uiState.gotoCoords).toBeNull();
  });
});

describe('setSidebarWidth', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes a dragged width as-is when it fits', () => {
    vi.stubGlobal('window', { innerWidth: 1600 });
    setSidebarWidth(440);
    expect(uiState.sidebarW).toBe(440);
  });

  it('clamps against the live window, not just the fixed bounds', () => {
    vi.stubGlobal('window', { innerWidth: 900 });
    setSidebarWidth(MAX_W); // legal on a wide screen, half the canvas here
    expect(uiState.sidebarW).toBe(450);

    setSidebarWidth(10);
    expect(uiState.sidebarW).toBe(MIN_W);
  });
});

describe('prefsReady — tools must not race the settings fetch', () => {
  let api;
  beforeEach(async () => {
    ({ api } = await import('./api.js'));
    api.get.mockReset();
  });

  it('does not resolve before the preferences land', async () => {
    let release;
    api.get.mockReturnValue(new Promise((r) => (release = r)));
    const { prefsReady, loadPrefs, prefs } = await freshState();

    let ready = false;
    prefsReady.then(() => (ready = true));
    loadPrefs();
    await Promise.resolve();
    expect(ready).toBe(false); // a tool awaiting this is still parked

    release({ home_view: { lat: -33.8568, lon: 151.2153, zoom: 17 } });
    await prefsReady;
    // the home view is readable the moment prefsReady resolves — that ordering
    // is what keeps the Satellite map off its built-in default
    expect(prefs.homeView).toEqual({ lat: -33.8568, lon: 151.2153, zoom: 17 });
  });

  it('resolves even when the settings read fails, leaving the defaults', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    const { prefsReady, loadPrefs, prefs } = await freshState();

    await loadPrefs().catch(() => {});
    await expect(prefsReady).resolves.toBeUndefined(); // never hangs a tool
    expect(prefs.homeView).toEqual({ lat: 48.8584, lon: 2.2945, zoom: 16 });
  });
});

describe('applyPrefs', () => {
  it('adopts a settings payload and ignores absent fields', async () => {
    const { applyPrefs, prefs } = await freshState();
    applyPrefs({ coord_format: 'mgrs', units: 'imperial' });
    expect(prefs.coordFormat).toBe('mgrs');
    expect(prefs.units).toBe('imperial');
    expect(prefs.postMention).toBe('@GeoConfirmed'); // untouched by a partial payload
    expect(prefs.postTarget).toBe('x'); // untouched by a partial payload
    expect(prefs.signatureHandle).toBe(''); // untouched by a partial payload

    applyPrefs({ post_mention: '' }); // an empty mention is a real choice, not absence
    expect(prefs.postMention).toBe('');

    applyPrefs({ post_target: 'bluesky' });
    expect(prefs.postTarget).toBe('bluesky');

    applyPrefs({ signature_handle: '@example' });
    expect(prefs.signatureHandle).toBe('@example');
  });
});

describe('startup update check', () => {
  it('checks the app and the downloaders by default, and neither when the Settings switch is off', async () => {
    const { api } = await import('./api.js');
    api.get.mockReset().mockResolvedValue({
      current: 'v0.1.0', latest: null, update_available: false, scrapers: [],
    });
    const { applyPrefs, checkForUpdatesOnStart } = await freshState();

    await checkForUpdatesOnStart();
    expect(api.get).toHaveBeenCalledWith('/api/settings/update?check=true');
    expect(api.get).toHaveBeenCalledWith('/api/settings/scrapers?check=true');

    api.get.mockClear();
    applyPrefs({ update_check_on_start: false });
    await checkForUpdatesOnStart();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('records what the downloaders check found', async () => {
    const { api } = await import('./api.js');
    const entries = [{ dist: 'yt-dlp', version: '2026.1.1', latest: '2026.7.1', outdated: true }];
    api.get.mockReset().mockImplementation((path) =>
      path.startsWith('/api/settings/scrapers')
        ? Promise.resolve({ scrapers: entries })
        : Promise.resolve({ update_available: false }),
    );
    const { checkForUpdatesOnStart, updatesState } = await freshState();

    await checkForUpdatesOnStart();
    expect(updatesState.scrapers).toEqual(entries);
  });

  it('compares the installed extension without asking the network', async () => {
    const { api } = await import('./api.js');
    api.get.mockReset().mockRejectedValue(new Error('must not be called'));
    document.documentElement.dataset.azimutCaptureExtension = '0.2.1';
    const { applyPrefs, checkForUpdatesOnStart, updatesState } = await freshState();
    applyPrefs({ update_check_on_start: false, extension_version: '0.2.5' });

    await checkForUpdatesOnStart();
    expect(api.get).not.toHaveBeenCalled();
    expect(updatesState.extensionInstalled).toBe('0.2.1');
    expect(updatesState.extensionBundled).toBe('0.2.5');
    delete document.documentElement.dataset.azimutCaptureExtension;
  });

  it('does not surface an offline failure', async () => {
    const { api } = await import('./api.js');
    api.get.mockReset().mockRejectedValue(new Error('offline'));
    const { checkForUpdatesOnStart, updatesState } = await freshState();
    await expect(checkForUpdatesOnStart()).resolves.toBeUndefined();
    expect(updatesState.app).toBeNull();
    expect(updatesState.scrapers).toBeNull();
  });
});

describe('templates store', () => {
  let api;
  beforeEach(async () => {
    ({ api } = await import('./api.js'));
    api.get.mockReset();
    api.post.mockReset();
    api.del.mockReset();
  });

  it('loadTemplates mirrors both families, tolerating a bad payload', async () => {
    const { loadTemplates, templatesState } = await freshState();
    ({ api } = await import('./api.js'));
    api.get.mockResolvedValue({ proof: [{ id: 'a', name: 'Dark' }], post: [{ id: 'b', name: 'Terse' }] });
    await loadTemplates();
    expect(templatesState.proof.map((t) => t.id)).toEqual(['a']);
    expect(templatesState.post.map((t) => t.id)).toEqual(['b']);

    api.get.mockRejectedValue(new Error('offline'));
    await loadTemplates(); // never throws; leaves the last good store
    expect(templatesState.proof.map((t) => t.id)).toEqual(['a']);
  });

  it('saveTemplate posts to the kind endpoint then refreshes the store', async () => {
    const { saveTemplate, templatesState } = await freshState();
    ({ api } = await import('./api.js'));
    api.post.mockResolvedValue({ id: 'x', name: 'Dark', data: {} });
    api.get.mockResolvedValue({ proof: [{ id: 'x', name: 'Dark' }], post: [] });
    const rec = await saveTemplate('proof', { name: 'Dark', data: { bg: '#000' } });
    expect(api.post).toHaveBeenCalledWith('/api/templates/proof', { name: 'Dark', data: { bg: '#000' } });
    expect(rec.id).toBe('x');
    expect(templatesState.proof).toHaveLength(1);
  });

  it('deleteTemplate hits the id endpoint then refreshes', async () => {
    const { deleteTemplate, templatesState } = await freshState();
    ({ api } = await import('./api.js'));
    api.del.mockResolvedValue({ deleted: true });
    api.get.mockResolvedValue({ proof: [], post: [] });
    await deleteTemplate('post', 'b');
    expect(api.del).toHaveBeenCalledWith('/api/templates/post/b');
    expect(templatesState.post).toEqual([]);
  });
});

describe('case request ownership', () => {
  let api;
  let state;

  beforeEach(async () => {
    state = await freshState();
    ({ api } = await import('./api.js'));
    api.get.mockReset();
    state.caseState.current = null;
    state.caseState.loading = false;
    state.caseState.rev = 0;
  });

  it('keeps the latest case when an older open finishes last', async () => {
    const first = deferred();
    const second = deferred();
    api.get.mockImplementation((path) =>
      path.endsWith('/case-a') ? first.promise : second.promise
    );

    const openingA = state.openCase('case-a');
    const openingB = state.openCase('case-b');
    second.resolve({ id: 'case-b', name: 'Case B' });
    await openingB;
    first.resolve({ id: 'case-a', name: 'Case A' });
    await openingA;

    expect(state.caseState.current).toEqual({ id: 'case-b', name: 'Case B' });
    expect(state.caseState.loading).toBe(false);
  });

  it('waits for case-owned work and cancels the switch when it cannot be saved', async () => {
    const guard = vi.fn().mockResolvedValue(false);
    const unregister = state.registerCaseChangeGuard(guard);
    state.caseState.current = { id: 'case-a', name: 'Case A' };

    await state.openCase('case-b');

    expect(guard).toHaveBeenCalledWith({ fromId: 'case-a', toId: 'case-b' });
    expect(api.get).not.toHaveBeenCalled();
    expect(state.caseState.current.id).toBe('case-a');
    expect(state.caseState.loading).toBe(false);
    unregister();
  });

  it('does not let a late refresh reopen the case it started in', async () => {
    const refresh = deferred();
    api.get.mockReturnValue(refresh.promise);
    state.caseState.current = { id: 'case-a', name: 'Case A' };

    const reloading = state.reloadCase();
    state.caseState.current = { id: 'case-b', name: 'Case B' };
    refresh.resolve({ id: 'case-a', name: 'Case A refreshed' });
    await reloading;

    expect(state.caseState.current).toEqual({ id: 'case-b', name: 'Case B' });
    expect(state.caseState.rev).toBe(0);
  });

  it('keeps the latest refresh when two writes finish out of order', async () => {
    const first = deferred();
    const second = deferred();
    api.get
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    state.caseState.current = { id: 'case-a', name: 'Before' };

    const older = state.reloadCase();
    const newer = state.reloadCase();
    second.resolve({ id: 'case-a', name: 'Newest' });
    await newer;
    first.resolve({ id: 'case-a', name: 'Older' });
    await older;

    expect(state.caseState.current).toEqual({ id: 'case-a', name: 'Newest' });
    expect(state.caseState.rev).toBe(1);
  });
});
