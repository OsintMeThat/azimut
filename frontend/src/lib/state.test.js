import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { caseState, uiState, closeCase, setSidebarWidth } from './state.svelte.js';
import { MIN_W, MAX_W } from './sidebar.js';

// The prefs tests below exercise import-time module state, so the transport is
// stubbed and the module re-imported fresh per test. The static import above
// still works: these tests never call the API.
vi.mock('./api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }));

async function freshState() {
  vi.resetModules();
  return import('./state.svelte.js');
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
  it('checks by default and stays silent when the Settings switch is off', async () => {
    const { api } = await import('./api.js');
    api.get.mockReset().mockResolvedValue({
      current: 'v0.1.0', latest: null, update_available: false,
    });
    const { applyPrefs, checkForUpdateOnStart } = await freshState();

    await checkForUpdateOnStart();
    expect(api.get).toHaveBeenCalledWith('/api/settings/update?check=true');

    api.get.mockClear();
    applyPrefs({ update_check_on_start: false });
    await checkForUpdateOnStart();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('does not surface an offline failure', async () => {
    const { api } = await import('./api.js');
    api.get.mockReset().mockRejectedValue(new Error('offline'));
    const { checkForUpdateOnStart } = await freshState();
    await expect(checkForUpdateOnStart()).resolves.toBeUndefined();
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
