import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
const answers = new Map();
vi.mock('./api.js', () => {
  const request = (method) => async (path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path.split('?')[0]}`;
    if (!answers.has(key)) throw new Error(`unexpected ${key}`);
    const answer = answers.get(key);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { api: { get: request('GET'), put: request('PUT'), del: request('DELETE'), post: request('POST'), patch: request('PATCH') } };
});

vi.mock('./state.svelte.js', () => ({ uiState: { tool: 'inspect', geolocateRef: null }, caseState: { rev: 0 }, toast: vi.fn() }));

const { geolocating, holdInGeoProof, sceneQueue } = await import('./geolocating.svelte.js');
const { gatherFacts, hereOn } = await import('./journeyHere.js');

const OPTIONAL = ['reverse', 'horizon', 'compare', 'elsewhere'];
const ALL = ['where', 'mark', 'geolocate', 'satellite', 'sure', 'spot', 'how', 'capture', 'proof', 'camera', 'save', 'post'];

/** A scene as `gatherFacts` describes one, with what a fixture changes. */
const scene = (over = {}) => ({
  name: 'Harbour clip · 0:04–0:09', kind: 'video', live: true, leads: 0, captures: 0, proof: 'none', post: null, ...over,
});

describe('hereOn', () => {
  it('starts at filing a photo or a video when the case holds nothing', () => {
    expect(hereOn({ media: { photos: 0, videos: 0 }, scene: null })).toEqual({
      kind: null, scene: null, done: [], here: null, next: ['photo', 'video'],
      facts: [{ text: 'nothing filed yet', ok: false }],
    });
  });

  it('claims nothing when what the case holds could not be read', () => {
    expect(hereOn({ media: null, scene: null })).toMatchObject({ here: null, next: ['photo', 'video'], done: [], facts: [] });
    expect(hereOn(undefined)).toMatchObject({ here: null, facts: [] });
  });

  it('asks where it may be once media is filed, each kind filed done', () => {
    expect(hereOn({ media: { photos: 2, videos: 1 }, scene: null })).toEqual({
      kind: null, scene: null, done: ['photo', 'video'], here: 'where', next: ['reverse', 'mark'],
      facts: [{ text: '2 photos and 1 video filed', ok: true }, { text: 'no scene marked yet', ok: false }],
    });
    expect(hereOn({ media: { photos: 1, videos: 0 }, scene: null })).toMatchObject({
      done: ['photo'], here: 'where', facts: [{ text: '1 photo filed', ok: true }, { text: 'no scene marked yet', ok: false }],
    });
  });

  it('asks for Geolocate on a scene marked and not geolocated', () => {
    expect(hereOn({ waiting: 3, scene: scene({ live: false }) })).toEqual({
      kind: 'video', scene: 'Harbour clip · 0:04–0:09', done: ['video', 'where', 'mark'], here: 'geolocate', next: ['satellite'],
      facts: [{ text: '3 scenes to geolocate', ok: true }, { text: 'not being geolocated', ok: false }],
    });
    expect(hereOn({ waiting: null, scene: scene({ live: false }) }).facts[0]).toEqual({ text: 'scene marked', ok: true });
  });

  it('searches the map while the scene geolocated has no lead', () => {
    expect(hereOn({ scene: scene({ kind: 'photo', name: 'Rooftop' }) })).toEqual({
      kind: 'photo', scene: 'Rooftop', done: ['photo', 'where', 'mark', 'geolocate'], here: 'satellite', next: ['sure'],
      facts: [{ text: 'being geolocated', ok: true }, { text: 'no lead yet', ok: false }],
    });
  });

  it('asks where to capture once leads are dropped, before any capture', () => {
    expect(hereOn({ scene: scene({ leads: 2 }) })).toEqual({
      kind: 'video', scene: 'Harbour clip · 0:04–0:09',
      done: ['video', 'where', 'mark', 'geolocate', 'satellite', 'sure', 'spot'], here: 'how', next: ['capture', 'elsewhere'],
      facts: [{ text: '2 leads', ok: true }, { text: 'no capture yet', ok: false }],
    });
  });

  it('says a scene with leads from another session is no longer geolocated', () => {
    const at = hereOn({ scene: scene({ leads: 1, live: false }) });
    expect(at.here).toBe('how');
    expect(at.facts).toEqual([
      { text: '1 lead', ok: true }, { text: 'not being geolocated', ok: false }, { text: 'no capture yet', ok: false },
    ]);
  });

  it('asks for the proof once a capture is gathered, and says how far it went', () => {
    expect(hereOn({ scene: scene({ leads: 1, captures: 1 }) })).toEqual({
      kind: 'video', scene: 'Harbour clip · 0:04–0:09',
      done: ['video', 'where', 'mark', 'geolocate', 'satellite', 'sure', 'spot', 'how', 'capture'], here: 'proof', next: ['camera'],
      facts: [{ text: '1 capture', ok: true }, { text: 'no proof yet', ok: false }],
    });
    expect(hereOn({ scene: scene({ captures: 3, proof: 'open' }) }).facts).toEqual([
      { text: '3 captures', ok: true }, { text: 'proof open, not saved yet', ok: false },
    ]);
    // a proof in the queue counts neither leads nor captures, and waits for its point
    expect(hereOn({ scene: scene({ live: false, leads: null, captures: null, proof: 'saved' }) })).toMatchObject({
      here: 'save', next: ['post'], facts: [{ text: 'proof saved, no point yet', ok: false }],
    });
  });

  it('asks for the post once the proof is saved with its point', () => {
    const proved = scene({ live: false, leads: null, captures: null, proof: 'proved' });
    expect(hereOn({ scene: { ...proved, post: 'none' } })).toEqual({
      kind: 'video', scene: 'Harbour clip · 0:04–0:09',
      done: ['video', 'where', 'mark', 'geolocate', 'satellite', 'sure', 'spot', 'how', 'capture', 'proof', 'camera', 'save'], here: 'post', next: [],
      facts: [{ text: 'proof saved', ok: true }, { text: 'no post yet', ok: false }],
    });
    expect(hereOn({ scene: { ...proved, post: 'drafted' } }).facts[1]).toEqual({ text: 'post drafted, not posted yet', ok: false });
    // the posts could not be read: nothing said of them
    expect(hereOn({ scene: { ...proved, post: null } })).toMatchObject({ here: 'post', facts: [{ text: 'proof saved', ok: true }] });
    // a proof that says nothing of the camera asks for that point first
    expect(hereOn({ scene: { ...proved, camera: false, post: 'none' } })).toMatchObject({
      here: 'camera', next: ['save'], facts: [{ text: 'proof saved', ok: true }, { text: 'no camera point yet', ok: false }],
    });
  });

  it('has every step done once the proof is posted', () => {
    expect(hereOn({ scene: scene({ kind: 'photo', proof: 'proved', post: 'posted' }) })).toEqual({
      kind: 'photo', scene: 'Harbour clip · 0:04–0:09', done: ['photo', ...ALL], here: null, next: [],
      facts: [{ text: 'proof saved', ok: true }, { text: 'posted', ok: true }],
    });
  });

  it('never marks the optional steps done', () => {
    const stages = [
      { media: { photos: 1, videos: 1 } },
      { scene: scene({ live: false }) },
      { scene: scene() },
      { scene: scene({ leads: 2 }) },
      { scene: scene({ captures: 2 }) },
      { scene: scene({ proof: 'proved', post: 'none' }) },
      { scene: scene({ proof: 'proved', post: 'posted' }) },
    ];
    for (const facts of stages) expect(hereOn(facts).done.filter((id) => OPTIONAL.includes(id))).toEqual([]);
  });
});

const QUEUE = '/api/cases/c1/scenes/queue';
const CLIP = { video: 'media/clip.mp4', title: 'Harbour clip', kind: 'video' };
const LIVE = {
  kind: 'draft', video: 'media/clip.mp4', id: 's1', label: '', start: 4, end: 9, state: 'progress', file_kind: 'video',
  file_title: 'Harbour clip', captures: ['captures/a.png'], leads: [{ id: 'l1', n: 1, lat: 1, lon: 2 }, { id: 'l2', n: 2, lat: 3, lon: 4 }],
  order: 0,
};
const PHOTO = {
  kind: 'draft', video: 'media/roof.jpg', id: 's2', label: '', start: null, end: null, state: 'todo', file_kind: 'image',
  file_title: 'Rooftop', captures: [],
};
const queue = (files, held = null) => answers.set(`GET ${QUEUE}`, { files, geolocating: held });

describe('gatherFacts', () => {
  beforeEach(() => {
    calls.length = 0;
    answers.clear();
    Object.assign(geolocating, { caseId: null, scene: null, error: '' });
    Object.assign(sceneQueue, { caseId: null, files: null, busy: false, error: '' });
    holdInGeoProof('c1', null);
  });

  // a reader: it never asks anything that writes
  afterEach(() => expect(calls.filter((call) => call.method !== 'GET')).toEqual([]));

  it('says nothing without a case', async () => {
    expect(await gatherFacts(null)).toEqual({ media: null, waiting: null, scene: null, point: null });
    expect(calls).toEqual([]);
  });

  it('describes the scene being geolocated, read with the queue', async () => {
    queue([{ ...CLIP, scenes: [LIVE] }], LIVE);
    const facts = await gatherFacts('c1');
    expect(facts).toEqual({
      media: null,
      waiting: 1,
      point: null,
      scene: { name: 'Harbour clip · 0:04–0:09', kind: 'video', live: true, leads: 2, captures: 1, proof: 'none', post: null },
    });
    expect(calls.map((call) => call.path)).toEqual([QUEUE]);
    expect(hereOn(facts).here).toBe('proof');
  });

  it('reads the scene held on its own when the queue cannot be read', async () => {
    answers.set(`GET ${QUEUE}`, new Error('down'));
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...LIVE, label: 'Pier', leads: undefined, captures: [] } });
    const facts = await gatherFacts('c1');
    expect(facts.waiting).toBe(null);
    expect(facts.scene).toMatchObject({ name: 'Harbour clip · Pier', live: true, leads: 0, captures: 0 });
    expect(hereOn(facts).here).toBe('satellite');
  });

  it('knows a video scene a proof took up with no place yet', async () => {
    const held = { ...LIVE, proof: 'harbour' };
    queue([{ ...CLIP, scenes: [held] }], held);
    expect((await gatherFacts('c1')).scene.proof).toBe('saved');
  });

  it('finds the proof of a picture among the picture\'s scenes', async () => {
    queue([{ video: PHOTO.video, title: 'Rooftop', kind: 'image', scenes: [PHOTO] }], PHOTO);
    answers.set('GET /api/cases/c1/scenes', { scenes: [{ kind: 'proof', proof: 'roof', state: 'progress' }] });
    const facts = await gatherFacts('c1');
    expect(facts.scene).toMatchObject({ name: 'Rooftop', kind: 'photo', proof: 'saved' });
    expect(calls.at(-1).path).toBe('/api/cases/c1/scenes?video=media%2Froof.jpg');
    // one given up on is no proof
    answers.set('GET /api/cases/c1/scenes', { scenes: [{ kind: 'proof', proof: 'roof', state: 'abandoned' }] });
    expect((await gatherFacts('c1')).scene.proof).toBe('none');
  });

  it('knows a proof open in Geo Proof and never saved', async () => {
    queue([{ video: PHOTO.video, title: 'Rooftop', kind: 'image', scenes: [PHOTO] }], PHOTO);
    answers.set('GET /api/cases/c1/scenes', { scenes: [PHOTO] });
    holdInGeoProof('c1', PHOTO);
    const facts = await gatherFacts('c1');
    expect(facts.scene.proof).toBe('open');
    expect(hereOn(facts)).toMatchObject({ here: 'proof', facts: [{ text: 'proof open, not saved yet', ok: false }] });
  });

  it('describes the first scene waiting when none is geolocated, the abandoned left out', async () => {
    const gone = { ...PHOTO, id: 's0', state: 'abandoned', abandoned: { reason: '' } };
    queue([
      { video: PHOTO.video, title: 'Rooftop', kind: 'image', scenes: [gone, PHOTO] },
      { ...CLIP, scenes: [{ ...LIVE, id: 's3', leads: undefined, captures: [] }] },
    ]);
    answers.set('GET /api/cases/c1/scenes', { scenes: [gone, PHOTO] });
    const facts = await gatherFacts('c1');
    expect(facts).toEqual({
      media: null,
      waiting: 2,
      point: null,
      scene: { name: 'Rooftop', kind: 'photo', live: false, leads: 0, captures: 0, proof: 'none', post: null },
    });
    expect(hereOn(facts)).toMatchObject({ here: 'geolocate', facts: [{ text: '2 scenes to geolocate', ok: true }, { text: 'not being geolocated', ok: false }] });
  });

  it('describes a proof in the queue that states no place yet', async () => {
    const proof = {
      kind: 'proof', id: 'proof:bridge', proof: 'bridge', video: 'media/clip.mp4', label: 'Bridge', moments: [{ start: 3, end: null }],
      start: 3, end: null, state: 'progress', abandoned: null, captures: [], order: 0,
    };
    queue([{ ...CLIP, scenes: [], proofs: [proof] }]);
    const facts = await gatherFacts('c1');
    expect(facts.scene).toEqual({
      name: 'Harbour clip · Bridge', kind: 'video', live: false, leads: null, captures: null, proof: 'saved', post: null,
    });
    expect(hereOn(facts).here).toBe('save');
  });

  describe('once nothing waits', () => {
    const NEWER = { name: 'p2', title: 'p2', points: [{ lat: 1, lon: 2, proposed: true }], png: 'proofs/p2.png', video: null };
    const HARBOUR = { name: 'harbour', title: 'Harbour', points: [{ lat: 12.5, lon: 43.25 }, { lat: 12.6, lon: 43.3 }], png: 'proofs/harbour.png', video: null };

    beforeEach(() => queue([]));

    it('describes the last proof saved with its point, its point and its post', async () => {
      answers.set('GET /api/cases/c1/proofs', [NEWER, HARBOUR]);
      answers.set('GET /api/cases/c1/drafts', [{ name: 'd1', proof: 'proofs/harbour.png', kind: 'geolocation', state: 'posted' }]);
      const facts = await gatherFacts('c1');
      expect(facts).toEqual({
        media: null,
        waiting: 0,
        point: { lat: 12.5, lon: 43.25 },
        scene: { name: 'Harbour', kind: 'photo', live: false, leads: null, captures: null, proof: 'proved', camera: false, post: 'posted' },
      });
      expect(hereOn(facts)).toMatchObject({ here: null, done: ['photo', ...ALL] });
    });

    it('answers with the point of view when the proof names where the camera stood', async () => {
      const both = { ...HARBOUR, points: [{ lat: 12.5, lon: 43.25 }, { lat: 12.6, lon: 43.3, pov: true }] };
      answers.set('GET /api/cases/c1/proofs', [both]);
      answers.set('GET /api/cases/c1/drafts', []);
      expect((await gatherFacts('c1')).point).toEqual({ lat: 12.6, lon: 43.3 });
      // a camera nobody checked is no answer: the conclusion stands
      answers.set('GET /api/cases/c1/proofs', [{ ...both, points: [both.points[0], { ...both.points[1], proposed: true }] }]);
      expect((await gatherFacts('c1')).point).toEqual({ lat: 12.5, lon: 43.25 });
    });

    it('takes a thread of the proof\'s video as its post', async () => {
      answers.set('GET /api/cases/c1/proofs', [{ ...HARBOUR, video: 'media/clip.mp4' }]);
      answers.set('GET /api/cases/c1/drafts', [{ name: 'd1', proof: null, kind: 'video', video: 'media/clip.mp4', state: 'changed' }]);
      expect((await gatherFacts('c1')).scene).toMatchObject({ kind: 'video', post: 'posted' });
    });

    it('tells a post drafted from none, and says nothing when the posts cannot be read', async () => {
      answers.set('GET /api/cases/c1/proofs', [HARBOUR]);
      answers.set('GET /api/cases/c1/drafts', [{ name: 'd1', proof: 'proofs/harbour.png', kind: 'geolocation', state: 'draft' }]);
      expect((await gatherFacts('c1')).scene.post).toBe('drafted');
      answers.set('GET /api/cases/c1/drafts', [{ name: 'd2', proof: 'proofs/other.png', kind: 'geolocation', state: 'posted' }]);
      expect((await gatherFacts('c1')).scene.post).toBe('none');
      answers.set('GET /api/cases/c1/drafts', new Error('down'));
      expect((await gatherFacts('c1')).scene.post).toBe(null);
    });

    it('counts what the case collected when no proof states a place', async () => {
      answers.set('GET /api/cases/c1/proofs', [NEWER]);
      answers.set('GET /api/cases/c1/media/page', { items: [], total: 3, facets: { category_counts: { image: 2, video: 0, satellite: 5 } } });
      const facts = await gatherFacts('c1');
      expect(facts).toEqual({ media: { photos: 2, videos: 0 }, waiting: 0, scene: null, point: null });
      // only what the analyst brought in, one row asked for its counts
      expect(calls.at(-1).path).toBe('/api/cases/c1/media/page?collected_only=true&limit=1');
      expect(hereOn(facts)).toMatchObject({ here: 'where', done: ['photo'] });
    });

    it('claims nothing it could not read', async () => {
      answers.set('GET /api/cases/c1/proofs', new Error('down'));
      answers.set('GET /api/cases/c1/media/page', new Error('down'));
      const facts = await gatherFacts('c1');
      expect(facts).toEqual({ media: null, waiting: 0, scene: null, point: null });
      expect(hereOn(facts)).toMatchObject({ here: null, facts: [] });
    });
  });
});
