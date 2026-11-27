// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CAMERA } from '../../guide/demo.mjs';

vi.mock('./api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./state.svelte.js', () => ({
  caseState: { current: null },
  uiState: { tool: 'overview' },
  createCase: vi.fn(),
  openCase: vi.fn(),
  reloadCase: vi.fn(),
  sessionStarted: vi.fn(),
  toast: vi.fn(),
}));

const { api } = await import('./api.js');
const { caseState, createCase, openCase, reloadCase, sessionStarted, toast, uiState } = await import('./state.svelte.js');
const { PRACTICE_ANSWER, PRACTICE_CASE, checkAnswer, isPractice, openPractice } = await import('./practiceCase.js');

/** The photo's source as the credits list it, so the two cannot drift. */
const SOURCE = /^\| `bridge_channel\.jpg` \|.*\[Commons\]\((.+)\) \|$/m.exec(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../guide/photos/CREDITS.md'), 'utf8')
)[1];
const upload = (id) => `/api/cases/${id}/media/upload`;
const uploads = () => api.post.mock.calls.filter(([path]) => path.endsWith('/media/upload'));

/** The server as it stands: the cases there are, and the files the open one holds. */
function server({ cases = [], media = [] } = {}) {
  api.get.mockImplementation(async (path) => (path === '/api/cases' ? cases : { items: media, next_cursor: null }));
  api.post.mockResolvedValue({ item: { path: 'media/bridge_channel.jpg' } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['photo'], { type: 'image/jpeg' }) })));
  sessionStarted.mockResolvedValue();
  createCase.mockImplementation(async (name) => {
    caseState.current = { id: 'made', name };
    return caseState.current;
  });
  openCase.mockImplementation(async (id) => {
    caseState.current = { id, name: PRACTICE_CASE };
    return true;
  });
  caseState.current = { id: 'working', name: 'Real case' };
  uiState.tool = 'overview';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the practice case, the first time', () => {
  it('makes its own case, files the photo with its source, then lands on Media', async () => {
    server({ cases: [{ id: 'other', name: 'Real case' }] });
    const named = vi.spyOn(FormData.prototype, 'append');
    await openPractice();
    expect(createCase).toHaveBeenCalledWith(PRACTICE_CASE);
    expect(openCase).not.toHaveBeenCalled();
    const [[to, form]] = uploads();
    expect(to).toBe(upload('made'));
    expect(named.mock.calls.find(([field]) => field === 'file')[2]).toBe('bridge_channel.jpg');
    expect(form.get('source_url')).toBe(SOURCE);
    expect(reloadCase).toHaveBeenCalledTimes(1);
    expect(uiState.tool).toBe('media');
  });

  it('looks for the photo in the new case, bounded, by its source', async () => {
    server();
    await openPractice();
    const looked = api.get.mock.calls.map(([path]) => path).find((path) => path.includes('/media/page'));
    expect(looked).toMatch(/^\/api\/cases\/made\/media\/page\?/);
    expect(new URL(looked, 'http://x').searchParams.get('q')).toBe(SOURCE);
  });

  it('waits for startup, whose last case would land over the practice', async () => {
    server();
    let started;
    sessionStarted.mockReturnValue(new Promise((resolve) => (started = resolve)));
    const opening = openPractice();
    await new Promise((resolve) => setTimeout(resolve));
    expect(api.get).not.toHaveBeenCalled();
    expect(createCase).not.toHaveBeenCalled();
    started();
    await opening;
    expect(uiState.tool).toBe('media');
  });
});

describe('the practice case, opened again', () => {
  const kept = { id: 'kept', name: PRACTICE_CASE };

  it('reopens its case and files nothing when the photo is there, renamed or not', async () => {
    const held = { path: 'media/my guess.jpg', source: { type: 'upload', url: SOURCE } };
    server({ cases: [{ id: 'other', name: 'Real case' }, kept], media: [held] });
    await openPractice();
    expect(createCase).not.toHaveBeenCalled();
    expect(openCase).toHaveBeenCalledWith('kept');
    expect(api.post).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(reloadCase).not.toHaveBeenCalled();
    expect(uiState.tool).toBe('media');
  });

  it('finds its case under the name typed another way, as the server would refuse it twice', async () => {
    server({ cases: [{ id: 'kept', name: ' practice: port of los angeles ' }] });
    await openPractice();
    expect(createCase).not.toHaveBeenCalled();
    expect(openCase).toHaveBeenCalledWith('kept');
  });

  it('files the photo again when it was taken away, and only that photo counts', async () => {
    const other = { path: 'media/bridge.jpg', source: { type: 'upload', url: 'https://example.org/a-bridge.jpg' } };
    server({ cases: [kept], media: [other] });
    await openPractice();
    expect(createCase).not.toHaveBeenCalled();
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0][0]).toBe(upload('kept'));
  });
});

describe('the practice case, refused', () => {
  it('stays where it is when the case being worked on keeps the analyst there', async () => {
    server();
    createCase.mockResolvedValue(null);
    await openPractice();
    expect(api.post).not.toHaveBeenCalled();
    expect(uiState.tool).toBe('overview');
  });

  it('says what went wrong, and can be pressed again', async () => {
    server();
    api.post.mockRejectedValueOnce(new Error('No room left on the disk'));
    await openPractice();
    expect(toast).toHaveBeenCalledWith('No room left on the disk', 'danger');
    expect(uiState.tool).toBe('overview');
    await openPractice();
    expect(uiState.tool).toBe('media');
  });

  it('files no error page as the photo', async () => {
    server();
    fetch.mockResolvedValueOnce({ ok: false, blob: async () => new Blob(['Not Found']) });
    await openPractice();
    expect(api.post).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('The practice photo could not be read', 'danger');
    expect(uiState.tool).toBe('overview');
  });

  it('opens one practice case however fast it is pressed', async () => {
    server();
    await Promise.all([openPractice(), openPractice()]);
    expect(createCase).toHaveBeenCalledTimes(1);
    expect(uploads()).toHaveLength(1);
  });
});

describe('the open case', () => {
  it('is the practice case by its name, whatever holds it', () => {
    expect(isPractice({ id: 'kept', name: PRACTICE_CASE })).toBe(true);
    expect(isPractice(PRACTICE_CASE)).toBe(true);
    expect(isPractice({ id: 'other', name: 'Real case' })).toBe(false);
    expect(isPractice(null)).toBe(false);
    expect(isPractice({ id: 'scratch_1' })).toBe(false);
  });
});

describe('the answer', () => {
  it('is where the demo case puts the camera', () => {
    expect({ lat: PRACTICE_ANSWER.lat, lon: PRACTICE_ANSWER.lon }).toEqual(CAMERA);
  });

  it('is right on the spot, and down in the car park on the same line of sight', () => {
    expect(checkAnswer(CAMERA)).toEqual({ metres: 0, right: true });
    const park = checkAnswer({ lat: 33.74284, lon: -118.27781 });
    expect(park.right).toBe(true);
    expect(park.metres).toBeGreaterThan(150);
    expect(park.metres).toBeLessThan(PRACTICE_ANSWER.within);
  });

  it('is wrong up the bank at the cruise berths, and across the water', () => {
    const berths = checkAnswer({ lat: 33.7462, lon: -118.2772 });
    expect(berths).toEqual({ metres: expect.any(Number), right: false });
    expect(berths.metres).toBeGreaterThan(500);
    expect(checkAnswer({ lat: 33.7452, lon: -118.2728 }).right).toBe(false);
  });

  it('holds the line at its tolerance, a metre either side', () => {
    // due north, on the sphere measure.js measures on
    const degree = (6378137 * Math.PI) / 180;
    const north = (metres) => ({ lat: PRACTICE_ANSWER.lat + metres / degree, lon: PRACTICE_ANSWER.lon });
    expect(checkAnswer(north(PRACTICE_ANSWER.within - 1)).right).toBe(true);
    expect(checkAnswer(north(PRACTICE_ANSWER.within + 1)).right).toBe(false);
  });
});
