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
  abandonScene, ensureSceneQueue, geolocateScene, geolocating, holdSceneCount, holdSceneQueue, joinScenes, markToGeolocate, sceneEdit,
  readGeolocating, readSceneQueue, restoreScene, sceneQueue, scenesWaiting, startGeolocating, stopGeolocating, unjoinScenes,
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

  it('hands Satellite every moment of a scene showing its place again', async () => {
    const more = [{ start: 65, end: 72 }];
    answers.set('PUT /api/cases/c1/geolocating', { geolocating: { ...SCENE, start: 0, end: 7, more, order: 0 } });
    await geolocateScene('c1', { video: 'media/clip.mp4', id: 's1' });
    expect(uiState.geolocateRef).toMatchObject({ start: 0, end: 7, more });
  });

  it('hands Satellite a picture as a picture', async () => {
    const picture = { ...SCENE, video: 'media/photo.png', start: null, end: null, order: 0, file_kind: 'image' };
    answers.set('PUT /api/cases/c1/geolocating', { geolocating: picture });
    await geolocateScene('c1', { video: 'media/photo.png', id: 's1' });
    expect(uiState.geolocateRef).toMatchObject({ video: 'media/photo.png', draft: 's1', kind: 'image' });
  });

  it('hands Satellite a collage of the video to open beside it', async () => {
    answers.set('PUT /api/cases/c1/geolocating', { geolocating: { ...SCENE, start: 1, end: 4, order: 0 } });
    await geolocateScene('c1', { video: 'media/clip.mp4', id: 's1' }, { picture: 'media/Pan.png' });
    expect(uiState.geolocateRef).toMatchObject({ video: 'media/clip.mp4', kind: 'video', picture: 'media/Pan.png' });
  });

  it('leaves the tool where it is when the server refuses', async () => {
    uiState.tool = 'inspect';
    uiState.geolocateRef = null;
    await expect(geolocateScene('c1', { video: 'media/clip.mp4', id: 'gone' })).rejects.toThrow();
    expect(uiState.tool).toBe('inspect');
    expect(uiState.geolocateRef).toBe(null);
  });
});

describe('Same place as…', () => {
  it('joins one scene into another through its route, and the scene geolocated follows it', async () => {
    const joined = { ...SCENE, id: 's2', start: 0, end: 7, more: [{ start: 65, end: 72 }], captures: ['media/c.png'] };
    const undo = { kept: { id: 's2' }, gone: { id: 's1' }, geolocating: 's1' };
    Object.assign(geolocating, { caseId: 'c1', scene: { ...SCENE, since: 't' } });
    answers.set('POST /api/cases/c1/scenes/s1/join', { scene: joined, undo });
    const seen = sceneEdit.n;

    const answer = await joinScenes('c1', 'media/clip.mp4', 's1', 's2');

    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { video: 'media/clip.mp4', into: 's2' } });
    expect(answer.undo).toEqual(undo);
    expect(geolocating.scene).toMatchObject({ id: 's2', more: [{ start: 65, end: 72 }], since: 't' });
    // Inspect, if it shows that video, reads its scenes again
    expect([sceneEdit.n, sceneEdit.video]).toEqual([seen + 1, 'media/clip.mp4']);
  });

  it('puts both scenes back through the Undo route, and reads the scene geolocated again', async () => {
    const undo = { kept: { id: 's2' }, gone: { id: 's1' }, geolocating: 's1' };
    geolocating.caseId = 'c1';
    answers.set('POST /api/cases/c1/scenes/s2/unjoin', { scenes: [{ id: 's2' }, { id: 's1' }] });
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });

    await unjoinScenes('c1', 'media/clip.mp4', undo);

    expect(calls.find((c) => c.method === 'POST').body).toEqual({ video: 'media/clip.mp4', ...undo });
    expect(geolocating.scene).toEqual(SCENE);
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

  it('marks a moment of a video, and a collage of one as its video', async () => {
    answers.set('POST /api/cases/c1/scenes/mark', { scene: { ...SCENE, start: 1.2, end: 3.6 } });
    const before = sceneEdit.n;
    await markToGeolocate('c1', 'media/Pan.png', '', { start: 1.2, end: 3.6 });
    expect(calls.at(-1).body).toEqual({ path: 'media/Pan.png', label: '', start: 1.2, end: 3.6 });
    // the list told to read again is the video's, which the collage marked
    expect(sceneEdit).toMatchObject({ video: 'media/clip.mp4', n: before + 1 });
    await markToGeolocate('c1', 'media/clip.mp4', '', { start: 2, end: 2 });
    expect(calls.at(-1).body).toEqual({ path: 'media/clip.mp4', label: '', start: 2 });
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

describe('a nudge, shown before the server is read again', () => {
  const VIDEO = 'media/clip.mp4';
  const HELD = { ...SCENE, kind: 'draft', video: VIDEO, id: 's1', state: 'todo', captures: [], order: 1 };
  const gathered = (n) => Array.from({ length: n }, (_, i) => `media/cap-${i + 1}.png`);
  let held = [];

  /** Reads that wait to be answered, in the order they were asked. */
  let pending;
  let spy;
  async function answeredByHand() {
    const { api } = await import('./api.js');
    pending = [];
    spy = vi.spyOn(api, 'get').mockImplementation((path) => new Promise((resolve) => pending.push({ path, resolve })));
  }
  const tick = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  afterEach(async () => {
    // every read still out answered, so none holds the next test's back
    for (let round = 0; round < 4 && pending?.length; round += 1) {
      for (const read of pending.splice(0)) read.resolve(read.path.endsWith('/queue') ? { files: [], geolocating: null } : { geolocating: null });
      await tick();
    }
    spy?.mockRestore();
    spy = null;
    for (const release of held) release();
    held = [];
  });

  it('counts the capture attached at once, the read behind it coming after', async () => {
    Object.assign(geolocating, { caseId: 'c1', scene: { ...HELD } });
    await answeredByHand();
    dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 's1', capture: 'media/cap-1.png', captures: 1 });
    // nothing answered yet, and the scene holds its capture already
    expect(geolocating.scene.captures).toEqual(['media/cap-1.png']);
    expect(geolocating.scene.state).toBe('progress');
    expect(pending.map((read) => read.path)).toEqual(['/api/cases/c1/geolocating']);
    pending[0].resolve({ geolocating: { ...HELD, state: 'progress', captures: ['media/cap-1.png'], since: 't' } });
    await tick();
    expect(geolocating.scene).toMatchObject({ captures: ['media/cap-1.png'], since: 't' });
  });

  it('trusts the number it gives over a list that is behind', async () => {
    Object.assign(geolocating, { caseId: 'c1', scene: { ...HELD, captures: gathered(2), state: 'progress' } });
    await answeredByHand();
    dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 's1', capture: 'media/cap-9.png', captures: 5 });
    expect(geolocating.scene.captures).toHaveLength(3);
    expect(geolocating.scene.captureCount).toBe(5);
    // the server's list, once read, is the count again
    pending[0].resolve({ geolocating: { ...HELD, state: 'progress', captures: gathered(5) } });
    await tick();
    expect(geolocating.scene.captureCount).toBe(undefined);
    expect(geolocating.scene.captures).toHaveLength(5);
  });

  it('drops an answer asked before it landed, and reads once more after', async () => {
    Object.assign(geolocating, { caseId: 'c1', scene: { ...HELD, captures: gathered(2), state: 'progress' } });
    await answeredByHand();
    // a read already out, as the pill asks when the case reloads
    readGeolocating('c1');
    dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 's1', capture: 'media/cap-3.png', captures: 3 });
    dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 's1', capture: 'media/cap-4.png', captures: 4 });
    expect(geolocating.scene.captures).toHaveLength(4);
    // the first nudge's read is out, the second waits for it: two reads, not three
    expect(pending).toHaveLength(2);
    pending[0].resolve({ geolocating: { ...HELD, captures: gathered(2), state: 'progress' } });
    pending[1].resolve({ geolocating: { ...HELD, captures: gathered(3), state: 'progress' } });
    await tick();
    expect(geolocating.scene.captures).toHaveLength(4);
    expect(pending).toHaveLength(3);
    pending[2].resolve({ geolocating: { ...HELD, captures: gathered(4), state: 'progress' } });
    await tick();
    expect(geolocating.scene.captures).toEqual(gathered(4));
    expect(pending).toHaveLength(3);
  });

  it('drops the scene at once when it ends, and an answer asked before cannot bring it back', async () => {
    Object.assign(geolocating, { caseId: 'c1', scene: { ...HELD } });
    await answeredByHand();
    readGeolocating('c1');
    dispatch({ type: 'geolocating', case_id: 'c1', video: null, draft: null });
    expect(geolocating.scene).toBe(null);
    pending[0].resolve({ geolocating: { ...HELD } });
    await tick();
    expect(geolocating.scene).toBe(null);
  });

  it('holds a scene the queue lists as soon as it starts elsewhere', async () => {
    const files = [{ video: VIDEO, title: 'clip', scenes: [{ ...HELD }] }];
    answers.set('GET /api/cases/c1/scenes/queue', { files, geolocating: null });
    await readSceneQueue('c1');
    held.push(holdSceneQueue());
    await answeredByHand();
    dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 's1' });
    expect(geolocating.scene).toMatchObject({ video: VIDEO, id: 's1', label: 'Bridge', order: 1 });
    // the queue is held for its rows, so it is the queue that is read behind it
    expect(pending.map((read) => read.path)).toEqual(['/api/cases/c1/scenes/queue']);
  });

  it('tells the queue’s row too, and a queue read asked before keeps what the row was told', async () => {
    const files = [{ video: VIDEO, title: 'clip', scenes: [{ ...HELD }] }];
    answers.set('GET /api/cases/c1/scenes/queue', { files, geolocating: { ...HELD } });
    await readSceneQueue('c1');
    held.push(holdSceneQueue());
    await answeredByHand();
    readSceneQueue('c1');
    dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 's1', capture: 'media/cap-1.png', captures: 1 });
    expect(sceneQueue.files[0].scenes[0]).toMatchObject({ captures: ['media/cap-1.png'], state: 'progress' });
    // the read asked before the capture lands with the row as it was
    pending[0].resolve({ files: structuredClone(files), geolocating: { ...HELD } });
    await tick();
    expect(geolocating.scene.captures).toEqual(['media/cap-1.png']);
    expect(sceneQueue.files[0].scenes[0]).toMatchObject({ captures: ['media/cap-1.png'], state: 'progress' });
  });

  it('leaves a scene it knows nothing of to the read', async () => {
    Object.assign(geolocating, { caseId: 'c1', scene: null });
    await answeredByHand();
    dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 's9', capture: 'media/cap-1.png', captures: 1 });
    expect(geolocating.scene).toBe(null);
    expect(pending).toHaveLength(1);
  });

  it('keeps a start or a stop answered here over a read asked before it', async () => {
    Object.assign(geolocating, { caseId: 'c1', scene: null });
    await answeredByHand();
    readGeolocating('c1');
    answers.set('DELETE /api/cases/c1/geolocating', { ended: true });
    const { api } = await import('./api.js');
    const put = vi.spyOn(api, 'put').mockResolvedValue({ geolocating: { ...HELD } });
    await startGeolocating('c1', VIDEO, 's1');
    put.mockRestore();
    pending[0].resolve({ geolocating: null });
    await tick();
    expect(geolocating.scene).toMatchObject({ id: 's1' });
  });
});
