import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  abandonScene, ensureSceneQueue, geolocateScene, geolocating, holdSceneCount, holdSceneQueue, markToGeolocate, sceneEdit, readGeolocating,
  readSceneQueue, restoreScene, sceneQueue, scenesWaiting, startGeolocating, stopGeolocating,
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
    expect(uiState.geolocateRef).toEqual({ video: 'media/clip.mp4', draft: 's1', start: 4, end: 9, label: 'Bridge', order: 2, kind: 'video' });
    expect(uiState.tool).toBe('satellite');
  });

  it('hands Satellite a picture as a picture', async () => {
    const picture = { ...SCENE, video: 'media/photo.png', start: null, end: null, order: 0, file_kind: 'image' };
    answers.set('PUT /api/cases/c1/geolocating', { geolocating: picture });
    await geolocateScene('c1', { video: 'media/photo.png', id: 's1' });
    expect(uiState.geolocateRef).toMatchObject({ video: 'media/photo.png', draft: 's1', kind: 'image' });
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

  it('shares one read between two surfaces opening at once, and reads a queue left behind', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', { files: [], geolocating: null });
    const release = holdSceneCount();
    await Promise.all([ensureSceneQueue('c1'), ensureSceneQueue('c1')]);
    expect(calls).toHaveLength(1);
    await ensureSceneQueue('c1');
    expect(calls).toHaveLength(1);
    // nothing held it for a moment: nudges went unheard, so the next surface reads it
    release();
    const next = holdSceneCount();
    await ensureSceneQueue('c1');
    next();
    expect(calls).toHaveLength(2);
    // and with nothing holding it at all, whatever is there is not trusted
    await ensureSceneQueue('c1');
    expect(calls).toHaveLength(3);
  });

  it('keeps the later of two reads, whichever lands first', async () => {
    const answered = [];
    const { api } = await import('./api.js');
    const spy = vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => answered.push(resolve)));
    const first = readSceneQueue('c1');
    const second = readSceneQueue('c1');
    answered[1]({ files: [{ video: 'new.mp4', title: 'new', scenes: [] }], geolocating: null });
    await second;
    answered[0]({ files: [{ video: 'old.mp4', title: 'old', scenes: [] }], geolocating: null });
    await first;
    spy.mockRestore();
    expect(sceneQueue.files.map((file) => file.video)).toEqual(['new.mp4']);
    expect(sceneQueue.busy).toBe(false);
  });

  it('counts the scenes waiting, the abandoned left out, and nothing until it is read', async () => {
    expect(scenesWaiting('c1')).toBe(null);
    const files = [
      { video: 'a.mp4', title: 'A', scenes: [SCENE, { ...SCENE, id: 's2', state: 'abandoned' }, { ...SCENE, id: 's3', state: 'progress' }] },
      { video: 'b.mp4', title: 'B', scenes: [{ ...SCENE, id: 's4', state: 'abandoned' }] },
    ];
    answers.set('GET /api/cases/c1/scenes/queue', { files, geolocating: null });
    await readSceneQueue('c1');
    expect(scenesWaiting('c1')).toBe(2);
    expect(scenesWaiting('c2')).toBe(null);
    expect(scenesWaiting(null)).toBe(null);
  });

  it('marks a whole file, then reads a queue a surface holds', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', { files: [], geolocating: null });
    await readSceneQueue('c1');
    calls.length = 0;
    answers.set('POST /api/cases/c1/scenes/mark', { scene: { ...SCENE, video: 'media/photo.png' } });
    const before = sceneEdit.n;
    const scene = await markToGeolocate('c1', 'media/photo.png');
    expect(scene.video).toBe('media/photo.png');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/cases/c1/scenes/mark', body: { path: 'media/photo.png', label: '' } });
    expect(calls.at(-1)).toMatchObject({ method: 'GET', path: '/api/cases/c1/scenes/queue' });
    expect(sceneEdit).toMatchObject({ caseId: 'c1', video: 'media/photo.png', n: before + 1 });
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

describe('the number of scenes waiting', () => {
  const VIDEO = 'media/clip.mp4';
  const file = (...scenes) => ({ video: VIDEO, title: 'clip', kind: 'video', scenes });
  const OPEN = { ...SCENE, kind: 'draft', video: VIDEO, id: 's1', state: 'todo' };
  let release;

  /** The queue read and held for its number alone, the fetches so far forgotten. */
  async function held(files = [file(OPEN)]) {
    answers.set('GET /api/cases/c1/scenes/queue', { files, geolocating: null });
    await readSceneQueue('c1');
    release = holdSceneCount();
    calls.length = 0;
    vi.useFakeTimers();
  }

  afterEach(() => {
    vi.useRealTimers();
    release?.();
    release = null;
  });

  const paths = () => calls.map((call) => call.path.split('?')[0]);

  it('asks an autosaved file alone, and leaves the queue when its open scenes stand', async () => {
    await held();
    answers.set('GET /api/cases/c1/scenes', { scenes: [OPEN, { kind: 'proof', proof: 'p1' }] });
    for (let save = 0; save < 3; save += 1) {
      dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(paths()).toEqual(['/api/cases/c1/scenes']);
    expect(calls[0].path).toBe('/api/cases/c1/scenes?video=media%2Fclip.mp4');
  });

  it('reads the queue when a scene came or went in that file', async () => {
    await held();
    const added = { ...OPEN, id: 's2' };
    answers.set('GET /api/cases/c1/scenes', { scenes: [OPEN, added] });
    answers.set('GET /api/cases/c1/scenes/queue', { files: [file(OPEN, added)], geolocating: null });
    dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
    await vi.advanceTimersByTimeAsync(600);
    expect(paths()).toEqual(['/api/cases/c1/scenes', '/api/cases/c1/scenes/queue']);
    expect(scenesWaiting('c1')).toBe(2);
  });

  it('reads the queue when the first scene lands in a file it does not list', async () => {
    await held([]);
    answers.set('GET /api/cases/c1/scenes', { scenes: [OPEN] });
    answers.set('GET /api/cases/c1/scenes/queue', { files: [file(OPEN)], geolocating: null });
    dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
    await vi.advanceTimersByTimeAsync(600);
    expect(scenesWaiting('c1')).toBe(1);
  });

  it('reads the queue when the file cannot be read: it left the case', async () => {
    await held();
    answers.set('GET /api/cases/c1/scenes/queue', { files: [], geolocating: null });
    dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
    await vi.advanceTimersByTimeAsync(600);
    expect(scenesWaiting('c1')).toBe(0);
  });

  it('reads the queue, once and later, for a nudge that names no file', async () => {
    await held();
    dispatch({ type: 'scenes', case_id: 'c1', video: null });
    dispatch({ type: 'saved', case_id: 'c1' });
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(paths()).toEqual(['/api/cases/c1/scenes/queue']);
  });

  it('leaves the queue for a capture gathered, which the count does not see, and reads it when rows are shown', async () => {
    await held();
    answers.set('GET /api/cases/c1/geolocating', { geolocating: null });
    dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 's1' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(paths()).toEqual(['/api/cases/c1/geolocating']);
    await ensureSceneQueue('c1');
    expect(paths()).toEqual(['/api/cases/c1/geolocating', '/api/cases/c1/scenes/queue']);
  });

  it('keeps to the rows’ own pace once they are shown beside it', async () => {
    await held();
    const rows = holdSceneQueue();
    try {
      dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
      await vi.advanceTimersByTimeAsync(400);
      expect(paths()).toEqual(['/api/cases/c1/scenes/queue']);
    } finally {
      rows();
    }
  });

  it('hears nothing of another case, and nothing once released', async () => {
    await held();
    dispatch({ type: 'scenes', case_id: 'c2', video: VIDEO });
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(0);
    release();
    dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(0);
  });
});
