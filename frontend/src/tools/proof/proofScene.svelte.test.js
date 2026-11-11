import { describe, expect, it, vi } from 'vitest';
import { ProofScene } from './proofScene.svelte.js';

/**
 * The scene of the proof open in Geo Proof: written at once through its own route for
 * a saved proof, with an Undo, and held for the first save of one never saved.
 */

const CLIP = 'media/clip.mp4';
const OTHER = 'media/other.mp4';

function setup({ name = 'depot', frames = [{ panel: 'p1', video: CLIP, time: 130 }], ties = [], answer, listed = null, onDisk = {} } = {}) {
  const where = { caseId: 'case', name };
  const scenes = $state({ answer: listed });
  const puts = [];
  const api = {
    // the proof as the server reads it now, by name: what Inspect wrote meanwhile
    get: vi.fn(async (url) => ({ title: 'Depot', scene: onDisk[decodeURIComponent(url.split('/').pop())] })),
    put: vi.fn(async (url, body) => {
      puts.push({ url, body });
      if (answer) return answer(body);
      // the server's answer: the whole video asked for is kept, and only `traced`, taking a
      // proof back to the frames it was cut from, leaves it stating nothing
      const traced = body.traced === true && (body.video ?? CLIP) === CLIP;
      return { proof: where.name, video: body.video ?? CLIP, moments: body.moments, at: [130], stated: !traced, draft: traced ? null : body.draft ?? null };
    }),
  };
  const toast = vi.fn();
  const onstated = vi.fn();
  const scene = new ProofScene({ api, toast, where: () => where, frames: () => frames, ties: () => ties, listed: () => scenes.answer, onstated });
  return { scene, api, puts, toast, onstated, where, scenes };
}

describe('a saved proof\'s scene', () => {
  it('reads the ★ off the panels until the proof states one', () => {
    const { scene } = setup();
    expect([scene.star, scene.moments, scene.videos.map((v) => v.name)]).toEqual([CLIP, [], ['clip']]);
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
    // it stated nothing before: back to its frames, not the whole video said
    expect(puts[1].body).toEqual({ moments: [], video: CLIP, traced: true });
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
    expect(scene.videos.map((v) => [v.name, v.star])).toEqual([['clip', true], ['other', false]]);
    await scene.makeStar(OTHER);
    expect(puts[0].body).toEqual({ moments: [], video: OTHER });
    expect(scene.star).toBe(OTHER);
    expect(toast.mock.calls[0][0]).toBe('The proof is now about other');
    // back on the video its first panel was cut from: read off its frames, as before it said anything
    await scene.makeStar(CLIP);
    expect(puts[1].body).toEqual({ moments: [], video: CLIP, traced: true });
    expect([scene.stated, scene.star]).toEqual([null, CLIP]);
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

  it('offers an older proof the scene, its time left as on disk, and a save takes nothing up', async () => {
    const { scene, puts } = setup({ listed: { ...LISTED, scenes: [...LISTED.scenes, { kind: 'proof', proof: 'depot', moments: [], at: [130], stated: false }] } });
    scene.load(undefined);
    // its own row is no other scene
    expect([scene.match, scene.proposal?.id, scene.moments, scene.draft]).toEqual([null, 's1', [], null]);
    await scene.flush();
    expect(puts).toEqual([]);
    expect(scene.proposal?.id).toBe('s1');
  });

  it('takes the offered scene up at once with Take it up, and its Undo gives the proof its frames back', async () => {
    const { scene, puts, toast } = setup({ listed: LISTED });
    scene.load(undefined);
    expect(await scene.takeUp()).toBe(true);
    expect(puts[0].body).toEqual({ moments: [{ start: 120, end: 140 }], video: CLIP, draft: 's1' });
    expect([scene.stated, scene.proposal, scene.moments]).toEqual([{ video: CLIP, moments: [{ start: 120, end: 140 }], draft: 's1' }, null, [{ start: 120, end: 140 }]]);
    expect(toast.mock.calls[0][0]).toBe('Scene now 2:00–2:20');
    toast.mock.calls[0][3].onClick();
    await vi.waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body).toEqual({ moments: [], video: CLIP, traced: true });
    await vi.waitFor(() => expect(scene.stated).toBeNull());
    expect(scene.proposal?.id).toBe('s1');
  });

  it('keeps a saved proof apart with Not this scene, writing nothing', () => {
    const { scene, puts, onstated } = setup({ listed: LISTED });
    scene.load(undefined);
    scene.refuse();
    expect([scene.proposal, scene.moments]).toEqual([null, []]);
    // its time never read the scene's, so nothing on the picture moves
    expect(onstated).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
  });

  it('offers nothing to a proof that said the whole video', () => {
    const { scene } = setup({ listed: LISTED });
    scene.load({ video: CLIP, moments: [] });
    expect([scene.proposal, scene.match, scene.moments]).toEqual([null, null, []]);
  });

  it('refuses it with Not this scene, for this proof and the session, writing nothing', async () => {
    const { scene, puts, where, onstated } = setup({ name: null, listed: LISTED });
    scene.refuse();
    expect([scene.match, scene.moments, scene.draft]).toEqual([null, [], null]);
    expect(onstated).toHaveBeenCalledTimes(1);
    where.name = 'bridge';
    await scene.flush();
    expect(puts).toEqual([]);
    // opened again in the session, it stays apart; another saved proof is offered it afresh
    scene.load(undefined);
    expect([scene.match, scene.proposal]).toEqual([null, null]);
    where.name = 'market';
    scene.load(undefined);
    expect(scene.proposal?.id).toBe('s1');
    scene.reset();
    expect(scene.refused).toEqual([]);
  });

  it('holds the scene with a time changed meanwhile, for the first save to write', async () => {
    const { scene, puts, where } = setup({ name: null, listed: LISTED });
    scene.openTime();
    expect(scene.edit.moments.map((m) => [m.start, m.end])).toEqual([[120, 140]]);
    scene.edit.typeEnd('2:10');
    await scene.applyTime();
    expect(scene.stated).toEqual({ video: CLIP, moments: [{ start: 120, end: 130 }], draft: 's1' });
    where.name = 'bridge';
    await scene.flush();
    expect(puts[0].body).toEqual({ moments: [{ start: 120, end: 130 }], video: CLIP, draft: 's1' });
  });

  it('states a saved proof\'s new time without taking the offered scene up', async () => {
    const { scene, puts } = setup({ listed: LISTED });
    scene.load(undefined);
    await scene.write({ video: CLIP, moments: [{ start: 125, end: null }] });
    expect(puts[0].body).toEqual({ moments: [{ start: 125, end: null }], video: CLIP });
  });

  it('takes nothing to another video made the ★', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: OTHER, time: 12 }];
    const { scene, puts } = setup({ listed: LISTED, frames });
    scene.load(undefined);
    expect(scene.proposal?.id).toBe('s1');
    await scene.makeStar(OTHER);
    expect(puts[0].body).toEqual({ moments: [], video: OTHER });
  });
});

describe('a proof of panels made from the footage, never cut from it', () => {
  /** The owner's case: one scene, the whole video, which gathered Horizon's two pictures. */
  const WHOLE = {
    video: CLIP,
    scenes: [{ kind: 'draft', id: 'sc_whole', start: null, end: null, label: '', state: 'progress', captures: ['media/photo.png', 'media/terrain.png'], abandoned: null }],
    taken: [],
    collages: [],
  };
  /** The two Horizon pictures, as `POST /scenes/ties` answers them: their collage's pieces, and the scene. */
  const TIES = ['media/photo.png', 'media/terrain.png'].map((src) => ({ src, video: CLIP, times: [130.3, 130.6, 131.9], scene: 'sc_whole' }));

  it('is about the video its panels are tied to, and a saved one is offered the scene, until Take it up', async () => {
    const { scene, puts, toast } = setup({ frames: [], ties: TIES, listed: WHOLE });
    scene.load(null);
    expect([scene.star, scene.videos.map((v) => [v.name, v.star, v.frames.length])]).toEqual([CLIP, [['clip', true, 0]]]);
    expect([scene.match, scene.proposal?.id, scene.proposal?.by, scene.moments]).toEqual([null, 'sc_whole', 'captures', []]);
    // the time editor pins none of them: they are no frames
    scene.openTime();
    expect(scene.edit.scene.at).toEqual([]);
    scene.edit.close();
    // nothing is written until Take it up
    await scene.flush();
    expect(puts).toEqual([]);
    expect(await scene.takeUp()).toBe(true);
    expect(puts[0]).toEqual({ url: '/api/cases/case/proofs/depot/scene', body: { moments: [], video: CLIP, draft: 'sc_whole' } });
    expect([scene.stated, scene.proposal]).toEqual([{ video: CLIP, moments: [], draft: 'sc_whole' }, null]);
    // its Undo reads it back to the video it is tied to, stating nothing
    toast.mock.calls[0][3].onClick();
    await vi.waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body).toEqual({ moments: [], video: CLIP, traced: true });
  });

  it('takes the scene up at the first save of a proof never saved, as Make the proof does', async () => {
    const { scene, puts, where } = setup({ name: null, frames: [], ties: TIES, listed: WHOLE });
    expect([scene.match?.id, scene.draft]).toEqual(['sc_whole', 'sc_whole']);
    where.name = 'proof-100';
    await scene.flush();
    expect(puts).toEqual([{ url: '/api/cases/case/proofs/proof-100/scene', body: { moments: [], video: CLIP, draft: 'sc_whole' } }]);
  });

  it('offers each scene the panels point at, and Take it up writes the one picked', async () => {
    const two = {
      ...WHOLE,
      scenes: [
        { kind: 'draft', id: 's1', start: 120, end: 140, label: 'Bridge?', state: 'todo', captures: [], abandoned: null },
        { kind: 'draft', id: 's2', start: 300, end: null, label: '', state: 'todo', captures: [], abandoned: null },
      ],
    };
    const ties = [{ src: 'media/photo.png', video: CLIP, times: [130, 300], scene: null }];
    const { scene, puts } = setup({ frames: [], ties, listed: two });
    scene.load(null);
    expect([scene.proposal, scene.choices.map((one) => one.id)]).toEqual([null, ['s1', 's2']]);
    expect(await scene.takeUp('s2')).toBe(true);
    expect(puts[0].body).toEqual({ moments: [{ start: 300, end: null }], video: CLIP, draft: 's2' });
    expect(scene.choices).toEqual([]);
  });

  it('holds the scene picked on a proof never saved, and None of these keeps it apart', async () => {
    const ties = [{ src: 'media/photo.png', video: CLIP, times: [], scene: null }];
    const two = { ...WHOLE, scenes: [
      { kind: 'draft', id: 's1', start: 120, end: 140, label: 'Bridge?', state: 'todo', captures: [], abandoned: null },
      { kind: 'draft', id: 's2', start: 300, end: null, label: '', state: 'todo', captures: [], abandoned: null },
    ] };
    const { scene, puts, where } = setup({ name: null, frames: [], ties, listed: two });
    expect(scene.choices.map((one) => one.id)).toEqual(['s1', 's2']);
    await scene.takeUp('s1');
    expect([scene.stated, scene.held, puts]).toEqual([{ video: CLIP, moments: [{ start: 120, end: 140 }], draft: 's1' }, true, []]);
    where.name = 'bridge';
    await scene.flush();
    expect(puts[0].body).toEqual({ moments: [{ start: 120, end: 140 }], video: CLIP, draft: 's1' });

    const other = setup({ name: null, frames: [], ties, listed: two });
    other.scene.refuse();
    expect([other.scene.choices, other.scene.match, other.scene.refused]).toEqual([[], null, ['s1', 's2']]);
  });
});

describe('a time Inspect changed meanwhile', () => {
  const LISTED = {
    video: CLIP,
    scenes: [{ kind: 'draft', id: 's1', start: 120, end: 140, label: 'Bridge?', state: 'todo', captures: [], abandoned: null }],
    taken: [],
    collages: [],
  };

  it('reads the saved proof\'s scene again, the player left where it stands, writing nothing', async () => {
    const onDisk = { depot: { video: CLIP, moments: [], draft: 's1' } };
    const { scene, puts, onstated } = setup({ onDisk });
    scene.load({ video: CLIP, moments: [{ start: 120, end: 140 }], draft: 's1' });
    scene.show(CLIP, { at: 131 });
    await scene.reread();
    expect([scene.stated, scene.moments]).toEqual([{ video: CLIP, moments: [], draft: 's1' }, []]);
    expect(scene.view).toMatchObject({ video: CLIP, at: 131, n: 1 });
    expect(onstated).toHaveBeenCalledTimes(1);
    // read again with nothing moved: no change said
    await scene.reread();
    expect(onstated).toHaveBeenCalledTimes(1);
    expect(puts).toEqual([]);
  });

  it('starts an open time with no change again from the time read', async () => {
    const onDisk = { depot: { video: CLIP, moments: [{ start: 125, end: 150 }] } };
    const { scene } = setup({ onDisk });
    scene.load({ video: CLIP, moments: [{ start: 120, end: 140 }] });
    scene.openTime();
    await scene.reread();
    expect(scene.edit.moments.map((m) => [m.start, m.end])).toEqual([[125, 150]]);
    expect(scene.edit.changed).toBe(false);
  });

  it('never cuts into a time in hand: the read waits for it to be dropped', async () => {
    const onDisk = { depot: { video: CLIP, moments: [{ start: 125, end: 150 }] } };
    const { scene, puts } = setup({ onDisk });
    scene.load({ video: CLIP, moments: [{ start: 120, end: 140 }] });
    scene.openTime();
    scene.edit.typeEnd('2:30');
    await scene.reread();
    expect(scene.moments).toEqual([{ start: 120, end: 140 }]);
    expect(scene.edit.moments.map((m) => [m.start, m.end])).toEqual([[120, 150]]);
    expect(scene.behind).toBe(true);
    // dropped, the read is made again and lands
    scene.edit.close();
    await scene.reread();
    expect([scene.moments, scene.behind]).toEqual([[{ start: 125, end: 150 }], false]);
    expect(puts).toEqual([]);
  });

  it('drops an answer that crossed a write or an open', async () => {
    let release;
    const onDisk = { depot: { video: CLIP, moments: [{ start: 1, end: null }] } };
    const { scene, api } = setup({ onDisk });
    scene.load({ video: CLIP, moments: [{ start: 120, end: 140 }] });
    api.get.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ scene: onDisk.depot }); }));
    const reading = scene.reread();
    await scene.write({ video: CLIP, moments: [{ start: 200, end: null }] });
    release();
    await reading;
    expect(scene.moments).toEqual([{ start: 200, end: null }]);
  });

  it('reads the whole video Inspect said as the whole video, offering nothing in its place', async () => {
    const onDisk = { depot: { video: CLIP, moments: [], draft: null } };
    const { scene, puts } = setup({ onDisk, listed: LISTED });
    scene.load({ video: CLIP, moments: [{ start: 125, end: 135 }] });
    await scene.reread();
    expect([scene.stated, scene.match, scene.proposal, scene.moments]).toEqual([{ video: CLIP, moments: [], draft: null }, null, null, []]);
    await scene.flush();
    expect(puts).toEqual([]);
  });

  it('keeps the whole video asked for here as said, rather than the scene its frames fall in', async () => {
    const { scene, puts, toast } = setup({ listed: LISTED });
    scene.load({ video: CLIP, moments: [{ start: 125, end: 135 }] });
    await scene.write({ video: CLIP, moments: [] });
    expect(puts[0].body).toEqual({ moments: [], video: CLIP });
    expect([scene.stated, scene.proposal, scene.moments]).toEqual([{ video: CLIP, moments: [], draft: null }, null, []]);
    expect(toast.mock.calls[0][0]).toBe('Scene now the whole video');
    // its Undo states the passage again: it stated one before
    toast.mock.calls[0][3].onClick();
    await vi.waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body).toEqual({ moments: [{ start: 125, end: 135 }], video: CLIP });
  });

  it('offers the scene again to a proof Inspect took back to its frames', async () => {
    const onDisk = { depot: undefined };
    const { scene, onstated } = setup({ onDisk, listed: LISTED });
    scene.load({ video: CLIP, moments: [{ start: 120, end: 140 }], draft: 's1' });
    await scene.reread();
    expect([scene.stated, scene.moments, scene.proposal?.id]).toEqual([null, [], 's1']);
    expect(onstated).toHaveBeenCalledTimes(1);
  });

  it('lets a proof never saved follow the scene it was made from, until a time is stated here', () => {
    const { scene, scenes } = setup({ name: null, listed: LISTED });
    scene.hold({ video: CLIP, moments: [{ start: 120, end: 140 }], draft: 's1' });
    scene.follow();
    const moved = (start, end) => ({ ...LISTED, scenes: [{ ...LISTED.scenes[0], start, end }] });
    scenes.answer = moved(122, 140);
    scene.follow();
    expect(scene.moments).toEqual([{ start: 122, end: 140 }]);
    // a time stated here is the analyst's
    scene.write({ video: CLIP, moments: [{ start: 100, end: null }] });
    scenes.answer = moved(124, 140);
    scene.follow();
    expect(scene.moments).toEqual([{ start: 100, end: null }]);
  });

  it('follows only a move made after the hand-over: a first reading behind it is where Inspect stood', () => {
    const { scene, scenes } = setup({ name: null, listed: null });
    // Make the proof a moment after the time changed, before Inspect's save landed
    scene.hold({ video: CLIP, moments: [{ start: 122, end: 140 }], draft: 's1' });
    scenes.answer = LISTED;
    scene.follow();
    expect(scene.moments).toEqual([{ start: 122, end: 140 }]);
    // the save lands: the scene now reads as handed over
    scenes.answer = { ...LISTED, scenes: [{ ...LISTED.scenes[0], start: 122 }] };
    scene.follow();
    expect(scene.moments).toEqual([{ start: 122, end: 140 }]);
    scenes.answer = { ...LISTED, scenes: [{ ...LISTED.scenes[0], start: 126 }] };
    scene.follow();
    expect(scene.moments).toEqual([{ start: 126, end: 140 }]);
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
