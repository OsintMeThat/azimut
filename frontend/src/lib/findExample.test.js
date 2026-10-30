// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const finds = (id) => `/api/cases/${id}/horizon/finds`;
const NAME = 'Half Dome 1901';

vi.mock('./api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./state.svelte.js', () => ({
  caseState: { current: null },
  uiState: { tool: 'media', openHorizonFind: null },
  createCase: vi.fn(),
  openCase: vi.fn(),
  reloadCase: vi.fn(),
  sessionStarted: vi.fn(),
  toast: vi.fn(),
}));

const { api } = await import('./api.js');
const { caseState, createCase, openCase, reloadCase, sessionStarted, toast, uiState } = await import('./state.svelte.js');
const { EXAMPLE_CASE, openFindExample } = await import('./findExample.js');
const { default: ask } = await import('./findExample.json');

/** The server as it stands: the cases there are, and the searches each one keeps. */
function server({ cases = [], searches = [] } = {}) {
  api.get.mockImplementation(async (path) => (path === '/api/cases' ? cases : searches));
  api.post.mockImplementation(async (path) => (path.endsWith('/media/upload') ? { item: { path: 'half_dome_1901.jpg' } } : { name: NAME }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['photo'], { type: 'image/jpeg' }) })));
  sessionStarted.mockResolvedValue();
  createCase.mockImplementation(async () => {
    caseState.current = { id: 'made' };
    return caseState.current;
  });
  openCase.mockImplementation(async (id) => {
    caseState.current = { id };
    return true;
  });
  caseState.current = { id: 'working' };
  uiState.tool = 'media';
  uiState.openHorizonFind = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the example, the first time', () => {
  it('makes its own case, files the photo and the search unrun, then opens it in Find', async () => {
    server();
    const named = vi.spyOn(FormData.prototype, 'append');
    await openFindExample();
    expect(createCase).toHaveBeenCalledWith(EXAMPLE_CASE);
    const [uploadTo, form] = api.post.mock.calls[0];
    expect(uploadTo).toBe('/api/cases/made/media/upload');
    expect(named.mock.calls[0][2]).toBe('half_dome_1901.jpg');
    expect(form.get('source_url')).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    const [searchTo, body] = api.post.mock.calls[1];
    expect(searchTo).toBe(finds('made'));
    expect(body.run).toBe(false);
    expect(body.photo.path).toBe('half_dome_1901.jpg');
    expect(uiState.tool).toBe('horizon');
    expect(uiState.openHorizonFind).toBe(NAME);
  });

  it('reads the case again, so what reads it finds the photo and the search filed', async () => {
    server();
    await openFindExample();
    expect(reloadCase).toHaveBeenCalledTimes(1);
  });

  it('waits for startup, whose last case would land over the example', async () => {
    server();
    let started;
    sessionStarted.mockReturnValue(new Promise((resolve) => (started = resolve)));
    const opening = openFindExample();
    await new Promise((resolve) => setTimeout(resolve));
    expect(api.get).not.toHaveBeenCalled();
    expect(createCase).not.toHaveBeenCalled();
    started();
    await opening;
    expect(uiState.openHorizonFind).toBe(NAME);
  });
});

describe('the example, pressed again', () => {
  const kept = { id: 'kept', name: EXAMPLE_CASE };

  it('opens its case on the newest search, the one that ran before the one filed, filing nothing', async () => {
    server({
      cases: [{ id: 'other', name: 'Real case' }, kept],
      searches: [
        { name: 'half_dome_1901 search', status: 'done' },
        { name: NAME, status: 'saved' },
      ],
    });
    await openFindExample();
    expect(createCase).not.toHaveBeenCalled();
    expect(openCase).toHaveBeenCalledWith('kept');
    expect(api.post).not.toHaveBeenCalled();
    expect(reloadCase).not.toHaveBeenCalled();
    expect(uiState.openHorizonFind).toBe('half_dome_1901 search');
  });

  it('files the search again in the case when it was taken away', async () => {
    server({ cases: [kept], searches: [] });
    await openFindExample();
    expect(createCase).not.toHaveBeenCalled();
    expect(api.post.mock.calls[1][0]).toBe(finds('kept'));
  });
});

describe('the example, refused', () => {
  it('stays where it is when the case being worked on keeps the analyst there', async () => {
    server();
    createCase.mockResolvedValue(null);
    await openFindExample();
    expect(api.post).not.toHaveBeenCalled();
    expect(uiState.tool).toBe('media');
    expect(uiState.openHorizonFind).toBeNull();
  });

  it('says what went wrong, and can be pressed again', async () => {
    server();
    api.post.mockRejectedValueOnce(new Error('No room left on the disk'));
    await openFindExample();
    expect(toast).toHaveBeenCalledWith('No room left on the disk', 'danger');
    expect(uiState.openHorizonFind).toBeNull();
    api.post.mockClear();
    server();
    await openFindExample();
    expect(uiState.openHorizonFind).toBe(NAME);
  });

  it('files no error page as the photo', async () => {
    server();
    fetch.mockResolvedValueOnce({ ok: false, blob: async () => new Blob(['Not Found']) });
    await openFindExample();
    expect(api.post).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('The example photo could not be read', 'danger');
    expect(uiState.openHorizonFind).toBeNull();
  });

  it('files one example however fast it is pressed', async () => {
    server();
    await Promise.all([openFindExample(), openFindExample()]);
    expect(createCase).toHaveBeenCalledTimes(1);
  });
});

describe('what it files', () => {
  it('is a whole setup, its path left for the copy filed', () => {
    expect(ask.photo.path).toBe('');
    expect(ask.photo.strokes).toHaveLength(7);
    expect(ask.area.length).toBeGreaterThanOrEqual(3);
    expect(ask.trace.x.length).toBeGreaterThan(0);
  });
});
