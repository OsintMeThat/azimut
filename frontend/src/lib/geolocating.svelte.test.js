import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
const answers = new Map();
vi.mock('./api.js', () => {
  const request = (method) => async (path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path.split('?')[0]}`;
    if (!answers.has(key)) throw new Error(`unexpected ${key}`);
    return answers.get(key);
  };
  return { api: { get: request('GET'), put: request('PUT'), del: request('DELETE'), post: request('POST') } };
});

vi.mock('./state.svelte.js', () => ({ uiState: { tool: 'inspect', geolocateRef: null } }));

const { dispatch } = await import('./events.js');
const { uiState } = await import('./state.svelte.js');
const {
  abandonScene, geolocateScene, geolocating, holdSceneQueue, sceneEdit, readGeolocating, readSceneQueue, restoreScene, sceneQueue, startGeolocating, stopGeolocating,
} = await import('./geolocating.svelte.js');

const SCENE = { video: 'media/clip.mp4', id: 's1', label: 'Bridge', state: 'todo', captures: [] };

beforeEach(() => {
  calls.length = 0;
  answers.clear();
  Object.assign(geolocating, { caseId: null, scene: null, error: '' });
  Object.assign(sceneQueue, { caseId: null, files: null, busy: false, error: '' });
});

describe('the scene being geolocated', () => {
  it('is read, started and stopped through the case routes', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: null });
    expect(await readGeolocating('c1')).toBe(null);
    answers.set('PUT /api/cases/c1/geolocating', { geolocating: SCENE });
    await startGeolocating('c1', 'media/clip.mp4', 's1');
    expect(calls.at(-1).body).toEqual({ video: 'media/clip.mp4', draft: 's1' });
    expect(geolocating.scene).toEqual(SCENE);
    answers.set('DELETE /api/cases/c1/geolocating', { ended: true });
    expect(await stopGeolocating('c1')).toBe(true);
    expect(geolocating.scene).toBe(null);
  });

  it('is read again when the server says it changed, for the case held only', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    geolocating.caseId = 'c1';
    dispatch({ type: 'geolocating', case_id: 'c2', video: null, draft: null });
    expect(calls).toHaveLength(0);
    dispatch({ type: 'geolocating', case_id: 'c1', video: 'media/clip.mp4', draft: 's1' });
    await vi.waitFor(() => expect(geolocating.scene).toEqual(SCENE));
  });
});

describe('Geolocate', () => {
  it('starts on the server, then hands the scene to Satellite and goes there', async () => {
    answers.set('PUT /api/cases/c1/geolocating', { geolocating: { ...SCENE, start: 4, end: 9, order: 2 } });
    await geolocateScene('c1', { video: 'media/clip.mp4', id: 's1' });
    // its place among the video's scenes, which colours its mark on the reference window
    expect(uiState.geolocateRef).toEqual({ video: 'media/clip.mp4', draft: 's1', start: 4, end: 9, label: 'Bridge', order: 2 });
    expect(uiState.tool).toBe('satellite');
  });

  it('leaves the tool where it is when the server refuses', async () => {
    uiState.tool = 'inspect';
    uiState.geolocateRef = null;
    await expect(geolocateScene('c1', { video: 'media/clip.mp4', id: 'gone' })).rejects.toThrow();
    expect(uiState.tool).toBe('inspect');
    expect(uiState.geolocateRef).toBe(null);
  });
});

describe('the queue', () => {
  it('reads the files and the scene being geolocated in one answer', async () => {
    const files = [{ video: 'media/clip.mp4', title: 'clip', scenes: [SCENE] }];
    answers.set('GET /api/cases/c1/scenes/queue', { files, geolocating: SCENE });
    await readSceneQueue('c1');
    expect(sceneQueue.files).toEqual(files);
    expect(geolocating.scene).toEqual(SCENE);
  });

  it('abandons with a word, ends the geolocating of that scene, and reads the queue again', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', { files: [], geolocating: SCENE });
    await readSceneQueue('c1');
    answers.set('PUT /api/cases/c1/scenes/s1/abandon', { scene: { ...SCENE, state: 'abandoned' } });
    answers.set('GET /api/cases/c1/scenes/queue', { files: [], geolocating: null });
    const row = await abandonScene('c1', 'media/clip.mp4', 's1', 'too dark');
    expect(row.state).toBe('abandoned');
    expect(calls.find((c) => c.method === 'PUT').body).toEqual({ video: 'media/clip.mp4', reason: 'too dark' });
    expect(geolocating.scene).toBe(null);
    expect(calls.at(-1)).toMatchObject({ method: 'GET', path: '/api/cases/c1/scenes/queue' });
  });

  it('is read again, once, after a burst of scenes or saved nudges about its case', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', { files: [], geolocating: null });
    await readSceneQueue('c1');
    calls.length = 0;
    const release = holdSceneQueue();
    vi.useFakeTimers();
    try {
      dispatch({ type: 'scenes', case_id: 'c1', video: 'media/clip.mp4' });
      dispatch({ type: 'saved', case_id: 'c1' });
      dispatch({ type: 'scenes', case_id: 'c2', video: 'media/other.mp4' });
      expect(calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(400);
    } finally {
      vi.useRealTimers();
      release();
    }
    expect(calls).toEqual([{ method: 'GET', path: '/api/cases/c1/scenes/queue', body: undefined }]);
  });

  it('is left alone once no surface shows it, the scene being geolocated read alone', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', { files: [], geolocating: null });
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await readSceneQueue('c1');
    const release = holdSceneQueue();
    release();
    release(); // a second release counts for nothing
    calls.length = 0;
    vi.useFakeTimers();
    try {
      dispatch({ type: 'scenes', case_id: 'c1', video: 'media/clip.mp4' });
      dispatch({ type: 'geolocating', case_id: 'c1', video: 'media/clip.mp4', draft: 's1' });
      await vi.advanceTimersByTimeAsync(400);
    } finally {
      vi.useRealTimers();
    }
    expect(calls.map((c) => c.path)).toEqual(['/api/cases/c1/geolocating']);
  });

  it('brings an abandoned scene back by its video', async () => {
    answers.set('DELETE /api/cases/c1/scenes/s1/abandon', { scene: SCENE });
    const before = sceneEdit.n;
    await restoreScene('c1', 'media/clip.mp4', 's1');
    expect(calls[0].path).toBe('/api/cases/c1/scenes/s1/abandon?video=media%2Fclip.mp4');
    // Inspect, showing that video beside the To-do, reads its list again
    expect(sceneEdit).toMatchObject({ caseId: 'c1', video: 'media/clip.mp4', n: before + 1 });
  });
});
