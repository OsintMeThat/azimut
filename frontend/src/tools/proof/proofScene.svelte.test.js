import { describe, expect, it, vi } from 'vitest';
import { ProofScene } from './proofScene.svelte.js';

/**
 * The scene of the proof open in Geo Proof: written at once through its own route for
 * a saved proof, with an Undo, and held for the first save of one never saved.
 */

const CLIP = 'media/clip.mp4';
const OTHER = 'media/other.mp4';

function setup({ name = 'depot', frames = [{ panel: 'p1', video: CLIP, time: 130 }], answer, listed = null } = {}) {
  const where = { caseId: 'case', name };
  const scenes = { answer: listed };
  const puts = [];
  const api = {
    put: vi.fn(async (url, body) => {
      puts.push({ url, body });
      if (answer) return answer(body);
      // the server's answer: a scene that states nothing its frames do not say is no scene
      const traced = body.video === CLIP && !body.moments.length && !body.draft;
      return { proof: where.name, video: body.video, moments: body.moments, at: [130], stated: !traced, draft: body.draft ?? null };
    }),
  };
  const toast = vi.fn();
  const onstated = vi.fn();
  const scene = new ProofScene({ api, toast, where: () => where, frames: () => frames, listed: () => scenes.answer, onstated });
  return { scene, api, puts, toast, onstated, where, scenes };
}

describe('a saved proof\'s scene', () => {
  it('reads the ★ off the panels until the proof states one', () => {
    const { scene } = setup();
    expect([scene.star, scene.moments, scene.videos.map((v) => v.name)]).toEqual([CLIP, [], ['clip.mp4']]);
    scene.load({ video: CLIP, start: 130, end: 158 });
    expect(scene.moments).toEqual([{ start: 130, end: 158 }]);
  });

  it('writes a new time at once through its own route, and takes it back from the toast', async () => {
    const { scene, puts, toast, onstated } = setup();
    scene.openTime();
    scene.edit.setKind('passage', { start: 130, end: 130.04 });
    scene.edit.typeEnd('2:38');
    await scene.applyTime();
    expect(puts).toEqual([{ url: '/api/cases/case/proofs/depot/scene', body: { moments: [{ start: 130, end: 158 }], video: CLIP } }]);
    expect(scene.moments).toEqual([{ start: 130, end: 158 }]);
    expect(scene.edit.scene).toBeNull();
    expect(onstated).toHaveBeenCalledTimes(1);
    const [words, , , action] = toast.mock.calls[0];
    expect(words).toBe('Scene now 2:10–2:38');
    action.onClick();
    await vi.waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body).toEqual({ moments: [], video: CLIP });
    await vi.waitFor(() => expect(scene.stated).toBeNull());
    // the undo is not offered again
    expect(toast.mock.calls[1][3]).toBeNull();
  });

  it('keeps nothing when Apply would change nothing', async () => {
    const { scene, puts } = setup();
    scene.openTime();
    await scene.applyTime();
    expect(puts).toEqual([]);
  });

  it('adds an instant at each panel outside the moments, at once or into the open time', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: CLIP, time: 300 }, { panel: 'p3', video: CLIP, time: 300 }];
    const { scene, puts } = setup({ frames });
    scene.load({ video: CLIP, moments: [{ start: 120, end: 140 }] });
    expect(scene.outside.map((f) => f.panel)).toEqual(['p2', 'p3']);
    await scene.addInstants(scene.outside.map((f) => f.time));
    expect(puts[0].body.moments).toEqual([{ start: 120, end: 140 }, { start: 300, end: null }]);
    expect(scene.outside).toEqual([]);

    scene.openTime();
    await scene.addInstants([400]);
    expect(puts).toHaveLength(1); // nothing written while the time is open
    expect(scene.edit.moments.map((m) => m.start)).toEqual([120, 300, 400]);
  });

  it('makes a confirmation the ★, whose time starts as the whole video', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: OTHER, time: 12 }];
    const { scene, puts, toast } = setup({ frames });
    scene.load({ video: CLIP, moments: [{ start: 120, end: 140 }] });
    expect(scene.videos.map((v) => [v.name, v.star])).toEqual([['clip.mp4', true], ['other.mp4', false]]);
    await scene.makeStar(OTHER);
    expect(puts[0].body).toEqual({ moments: [], video: OTHER });
    expect(scene.star).toBe(OTHER);
    expect(toast.mock.calls[0][0]).toBe('The proof is now about other.mp4');
  });

  it('says what the server refused, and keeps what was there', async () => {
    const { scene, toast } = setup({ answer: () => { throw new Error('that time is past the end of the video'); } });
    expect(await scene.write({ video: CLIP, moments: [{ start: 9000, end: null }] })).toBe(false);
    expect(toast).toHaveBeenCalledWith('that time is past the end of the video', 'danger');
    expect(scene.moments).toEqual([]);
  });

  it('leaves the answer of a proof since closed alone', async () => {
    const { scene, where } = setup({ answer: (body) => { where.name = 'another'; return { stated: true, video: CLIP, moments: body.moments }; } });
    expect(await scene.write({ video: CLIP, moments: [{ start: 1, end: null }] })).toBe(false);
    expect(scene.stated).toBeNull();
  });
});

describe('a proof never saved', () => {
  it('holds its time, and writes it with the scene it came from right after its first save', async () => {
    const { scene, puts, where, onstated } = setup({ name: null });
    scene.hold({ video: CLIP, moments: [{ start: 292, end: 320 }], draft: 's3' });
    expect([scene.held, scene.moments]).toEqual([true, [{ start: 292, end: 320 }]]);
    await scene.write({ video: CLIP, moments: [{ start: 292, end: 320 }, { start: 400, end: null }] });
    expect(puts).toEqual([]);
    expect(scene.stated.draft).toBe('s3');
    expect(onstated).toHaveBeenCalledTimes(1);

    where.name = 'bridge';
    await scene.flush();
    expect(puts).toEqual([{
      url: '/api/cases/case/proofs/bridge/scene',
      body: { moments: [{ start: 292, end: 320 }, { start: 400, end: null }], video: CLIP, draft: 's3' },
    }]);
    expect(scene.held).toBe(false);
    // the first save is no change the analyst made
    expect(onstated).toHaveBeenCalledTimes(1);
    await scene.flush();
    expect(puts).toHaveLength(1);
  });

  it('stays held when the write fails, so the next save tries again', async () => {
    const { scene, toast, where } = setup({ name: null, answer: () => { throw new Error('offline'); } });
    scene.hold({ video: CLIP, moments: [], draft: 's3' });
    where.name = 'bridge';
    await scene.flush();
    expect(scene.held).toBe(true);
    expect(toast).toHaveBeenCalledWith('The scene\'s time was not written: offline', 'danger', 8000);
  });
});

describe('a proof made by hand, whose frames fall in a scene still to prove', () => {
  /** The clip's scenes as `GET /scenes` reads them: Bridge? from 2:00 to 2:20, and another at 5:00. */
  const LISTED = {
    video: CLIP,
    scenes: [
      { kind: 'draft', id: 's1', start: 120, end: 140, label: 'Bridge?', state: 'todo', captures: [], abandoned: null },
      { kind: 'draft', id: 's2', start: 300, end: null, label: '', state: 'todo', captures: [], abandoned: null },
    ],
    taken: [],
    collages: [],
  };

  it('reads the scene\'s time and takes it up right after its first save, as Make the proof does', async () => {
    const { scene, puts, where } = setup({ name: null, listed: LISTED });
    expect(scene.match).toMatchObject({ id: 's1', title: 'Bridge?' });
    expect([scene.stated, scene.moments, scene.draft]).toEqual([null, [{ start: 120, end: 140 }], 's1']);
    where.name = 'bridge';
    await scene.flush();
    expect(puts).toEqual([{
      url: '/api/cases/case/proofs/bridge/scene',
      body: { moments: [{ start: 120, end: 140 }], video: CLIP, draft: 's1' },
    }]);
    expect(scene.stated).toEqual({ video: CLIP, moments: [{ start: 120, end: 140 }], draft: 's1' });
    expect(scene.match).toBeNull();
  });

  it('follows the panels: frames moved into two scenes, or out of it, take nothing', () => {
    const held = $state({ frames: [{ panel: 'p1', video: CLIP, time: 130 }], answer: LISTED });
    const scene = new ProofScene({
      api: {}, toast: vi.fn(), where: () => ({ caseId: 'case', name: null }), frames: () => held.frames, listed: () => held.answer,
    });
    expect(scene.match?.id).toBe('s1');
    held.frames = [...held.frames, { panel: 'p2', video: CLIP, time: 300 }];
    expect([scene.match, scene.moments]).toEqual([null, []]);
    held.frames = [{ panel: 'p1', video: CLIP, time: 200 }];
    expect(scene.match).toBeNull();
    held.frames = [{ panel: 'p1', video: CLIP, time: 135 }];
    expect(scene.match?.id).toBe('s1');
    // the strip read again once another proof took the scene up
    held.answer = { ...LISTED, taken: ['s1'] };
    expect(scene.match).toBeNull();
  });

  it('leaves a proof that states a scene alone', () => {
    const { scene } = setup({ listed: LISTED });
    scene.load({ video: CLIP, moments: [{ start: 125, end: 135 }] });
    expect(scene.match).toBeNull();
    expect(scene.moments).toEqual([{ start: 125, end: 135 }]);
    // nor one made from a scene of Inspect
    scene.hold({ video: CLIP, moments: [], draft: 's9' });
    expect(scene.match).toBeNull();
  });

  it('finds the scene of a slide begun with + New scene, which holds only its video', () => {
    const { scene } = setup({ name: null, listed: LISTED });
    scene.hold({ video: CLIP, moments: [], draft: null });
    expect(scene.match?.id).toBe('s1');
  });

  it('keeps an older proof as it is on disk until it is saved', async () => {
    const { scene, puts } = setup({ listed: { ...LISTED, scenes: [...LISTED.scenes, { kind: 'proof', proof: 'depot', moments: [], at: [130], stated: false }] } });
    scene.load(undefined);
    // its own row is no other scene
    expect(scene.match?.id).toBe('s1');
    expect(puts).toEqual([]);
    await scene.flush();
    expect(puts[0].body).toEqual({ moments: [{ start: 120, end: 140 }], video: CLIP, draft: 's1' });
  });

  it('refuses it with Not this scene, for this proof and the session, writing nothing', async () => {
    const { scene, puts, where, onstated } = setup({ name: null, listed: LISTED });
    scene.refuse();
    expect([scene.match, scene.moments, scene.draft]).toEqual([null, [], null]);
    expect(onstated).toHaveBeenCalledTimes(1);
    where.name = 'bridge';
    await scene.flush();
    expect(puts).toEqual([]);
    // opened again in the session, it stays apart; another proof is asked afresh
    scene.load(undefined);
    expect(scene.match).toBeNull();
    where.name = 'market';
    scene.load(undefined);
    expect(scene.match?.id).toBe('s1');
    scene.reset();
    expect(scene.refused).toEqual([]);
  });

  it('states the scene with a time changed meanwhile, at once for a saved proof', async () => {
    const { scene, puts } = setup({ listed: LISTED });
    scene.openTime();
    expect(scene.edit.moments.map((m) => [m.start, m.end])).toEqual([[120, 140]]);
    scene.edit.typeEnd('2:10');
    await scene.applyTime();
    expect(puts[0].body).toEqual({ moments: [{ start: 120, end: 130 }], video: CLIP, draft: 's1' });
    expect(scene.stated.draft).toBe('s1');
  });

  it('takes nothing to another video made the ★', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: OTHER, time: 12 }];
    const { scene, puts } = setup({ listed: LISTED, frames });
    expect(scene.match?.id).toBe('s1');
    await scene.makeStar(OTHER);
    expect(puts[0].body).toEqual({ moments: [], video: OTHER });
  });
});

describe('the player in the Scene tab', () => {
  it('opens on a video, paused at a frame or running, and keeps a time open as the tab is left', async () => {
    const { scene, puts } = setup();
    scene.show(CLIP, { play: true });
    expect(scene.view).toMatchObject({ video: CLIP, play: true, n: 1 });
    scene.show(CLIP, { at: 130 });
    expect(scene.view).toMatchObject({ at: 130, play: false, n: 2 });
    scene.openTime();
    scene.edit.here('start', { start: 131, end: 131.04 });
    scene.leaveTime();
    // the player stays where it stood, for the tab shown again
    expect(scene.view).toMatchObject({ video: CLIP, n: 3 });
    expect(scene.edit.scene).toBeNull();
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body.moments).toEqual([{ start: 131, end: null }]);
  });

  it('starts empty for a new proof', () => {
    const { scene } = setup();
    scene.load({ video: CLIP, moments: [{ start: 1, end: null }] });
    scene.show(CLIP);
    scene.reset();
    expect([scene.stated, scene.held, scene.view, scene.edit.scene]).toEqual([null, false, null, null]);
  });
});
