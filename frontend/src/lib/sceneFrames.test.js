import { describe, expect, it } from 'vitest';
import {
  collagesOfScene, collagesUnder, frameInMoment, frameScenes, frameToCapture, frameUses, framesOfScene, inScenes, pictureHandoff,
  proofHandoff, sceneOfCollage, scenesAt, usedIn,
} from './sceneFrames.js';
import { sceneList } from './scenes.js';

const FRAME = 0.04; // 25 fps
const m = (start, end = null) => ({ start, end });
const draft = (id, start, end = null, label = '') => ({ id, start, end, label });
const proof = (name, extra = {}) => ({
  kind: 'proof', proof: name, title: name, moments: [], at: [], stated: false, draft: null, ...extra,
});
const frame = (id, time, extra = {}) => ({ id, path: 'media/clip.mp4', time, url: `blob:${id}`, filed: null, ...extra });

describe('a frame in a scene', () => {
  it('falls in a passage from its start up to its end', () => {
    expect(frameInMoment(10, m(10, 12), FRAME)).toBe(true);
    expect(frameInMoment(11.96, m(10, 12), FRAME)).toBe(true);
    // the end of a passage is the end of its last frame, so the next one is out
    expect(frameInMoment(12, m(10, 12), FRAME)).toBe(false);
    expect(frameInMoment(9.96, m(10, 12), FRAME)).toBe(false);
  });

  it('holds an instant when it is the frame showing it', () => {
    expect(frameInMoment(3.2, m(3.2), FRAME)).toBe(true);
    // the frame's own timestamp, a hair either side of the one the player counted
    expect(frameInMoment(3.1998, m(3.2), FRAME)).toBe(true);
    expect(frameInMoment(3.2002, m(3.2), FRAME)).toBe(true);
    expect(frameInMoment(3.16, m(3.2), FRAME)).toBe(false);
    expect(frameInMoment(3.24, m(3.2), FRAME)).toBe(false);
  });

  it('is decided by the frame, not the float, on a real clip at 23.976 fps', () => {
    // S kept the start as the player counts it; the frame captured there carries its
    // pts, 0.24 ms earlier. All three frames of the passage are in it, and the one
    // before is not.
    const frame = 1 / 23.976;
    const start = 238.44678011344678;
    const passage = m(start, start + 3 * frame);
    const pts = [238.446542, 238.446542 + frame, 238.446542 + 2 * frame];
    expect(pts.map((t) => frameInMoment(t, passage, frame))).toEqual([true, true, true]);
    expect(frameInMoment(238.446542 - frame, passage, frame)).toBe(false);
    expect(frameInMoment(238.446542 + 3 * frame, passage, frame)).toBe(false);
    expect(frameInMoment(238.446542, m(start), frame)).toBe(true);
    expect(frameInMoment(238.446542 + frame, m(start), frame)).toBe(false);
    const strip = pts.map((t, i) => ({ id: `f${i}`, time: t, url: `blob:${i}` }));
    expect(framesOfScene(draft('sc', start, start + 3 * frame), strip, frame)).toHaveLength(3);
    expect(frameScenes(strip, sceneList([], [draft('sc', start, start + 3 * frame)]), frame).size).toBe(3);
  });

  it('reads a frame as a thirtieth of a second while the clip\'s rate is unknown', () => {
    expect(frameInMoment(1.01, m(1), undefined)).toBe(true);
    expect(frameInMoment(1.02, m(1), undefined)).toBe(false);
    expect(frameInMoment(1.02, m(1), 0)).toBe(false);
  });

  it('belongs to every scene that holds it, a proof about the whole video by its own frames', () => {
    const scenes = sceneList(
      [proof('Depot', { at: [5] }), proof('Bridge', { moments: [m(4, 8)], stated: true })],
      [draft('sc_a', 4.5, 6), draft('sc_all', null)],
    );
    expect(scenesAt(5, scenes, FRAME).map((s) => s.key)).toEqual(['proof:Bridge', 'sc_a', 'proof:Depot']);
    // a draft about the whole video would mark every frame, so it marks none
    expect(scenesAt(20, scenes, FRAME)).toEqual([]);
  });

  it('gives the strip a dot per scene in its colour, and leaves a frame in none alone', () => {
    const scenes = sceneList([], [draft('sc_a', 4, 6, 'bridge?'), draft('sc_b', 5)]);
    const dots = frameScenes([frame('in', 5), frame('out', 9), frame('still', null)], scenes, FRAME);
    expect([...dots.keys()]).toEqual(['in']);
    expect(dots.get('in')).toEqual([
      { key: 'sc_a', color: scenes[0].color, title: 'bridge?' },
      { key: 'sc_b', color: scenes[1].color, title: 'a scene to geolocate' },
    ]);
    expect(inScenes(dots.get('in'))).toBe('In bridge? and a scene to geolocate');
  });
});

describe('a frame in a scene of several moments', () => {
  it('belongs to it inside any of its moments, dotted in its one colour, and is offered to its proof', () => {
    const scenes = sceneList([], [{ ...draft('sc_1', 0, 7), more: [m(65, 72)] }, draft('sc_2', 30)]);
    expect(scenesAt(66, scenes, FRAME).map((s) => s.id)).toEqual(['sc_1']);
    expect(scenesAt(20, scenes, FRAME)).toEqual([]);
    const frames = [frame('a', 3), frame('b', 30), frame('c', 66)];
    const dots = frameScenes(frames, scenes, FRAME);
    expect(dots.get('a')[0].color).toBe(dots.get('c')[0].color);
    expect(framesOfScene(scenes[0], frames, FRAME).map((f) => f.id)).toEqual(['a', 'c']);
  });
});

describe('a frame in an abandoned scene', () => {
  const row = (id, extra) => ({ kind: 'draft', id, start: 4, end: 6, label: '', captures: [], abandoned: null, ...extra });

  it('still belongs to it, so no scene is offered there, and its dot is greyed', () => {
    const listed = [row('sc_a', { abandoned: { reason: 'no landmark', at: 't' } }), row('sc_b', { start: 5, end: null, abandoned: { reason: '', at: 't' } })];
    const scenes = sceneList(listed, [draft('sc_a', 4, 6, 'bridge?'), draft('sc_b', 5)]);
    expect(scenesAt(5, scenes, FRAME).map((s) => s.key)).toEqual(['sc_a', 'sc_b']);
    const dots = frameScenes([frame('in', 5)], scenes, FRAME);
    expect(dots.get('in')).toEqual([
      { key: 'sc_a', color: scenes[0].color, title: 'bridge? (abandoned)', abandoned: true },
      { key: 'sc_b', color: scenes[1].color, title: 'an abandoned scene', abandoned: true },
    ]);
  });
});

describe('a frame a proof lays out', () => {
  it('says which proofs, each once', () => {
    expect(usedIn([{ proof: 'p29', title: 'Proof 29' }])).toBe('Used in Proof 29');
    expect(usedIn([{ proof: 'a', title: 'Bridge' }, { proof: 'b', title: 'Depot' }, { proof: 'a', title: 'Bridge' }]))
      .toBe('Used in Bridge and Depot');
    expect(usedIn([])).toBe('');
  });

  it('is found by the path it was saved under', () => {
    const used = { 'media/f1.png': [{ proof: 'p29', title: 'Proof 29' }] };
    const uses = frameUses([
      frame('a', 1, { filed: { path: 'media/f1.png' } }), frame('b', 2, { filed: { path: 'media/f2.png' } }), frame('c', 3),
    ], used);
    expect([...uses]).toEqual([['a', 'Used in Proof 29']]);
  });
});

describe('the frames a scene\'s proof starts from', () => {
  const strip = [frame('late', 30), frame('mid', 12), frame('early', 10.5), frame('rendering', 11, { url: null }),
    frame('lost', 11.5, { missing: true }), frame('flash', 3.2)];

  it('takes the frames inside a passage, in clip order', () => {
    expect(framesOfScene(draft('sc', 10, 20), strip, FRAME).map((f) => f.id)).toEqual(['early', 'mid']);
  });

  it('takes the frame showing an instant', () => {
    expect(framesOfScene(draft('sc', 3.2), strip, FRAME).map((f) => f.id)).toEqual(['flash']);
    expect(framesOfScene(draft('sc', 3.3), strip, FRAME)).toEqual([]);
  });

  it('takes every frame for the whole video', () => {
    expect(framesOfScene(draft('sc', null), strip, FRAME).map((f) => f.id)).toEqual(['flash', 'early', 'mid', 'late']);
  });
});

describe('the frame captured for a scene that holds none', () => {
  const scan = {
    frames: [{ time: 2, score: 9 }, { time: 14, score: 5 }, { time: 15, score: 7 }],
    shots: [{ start: 10, end: 20, best: 16, score: 6 }, { start: 20, end: 40, best: 30, score: 8 }],
  };

  it('is the sharpest a scan found inside the passage', () => {
    expect(frameToCapture(draft('sc', 10, 20), { scan, frame: FRAME })).toEqual({ time: 15, why: 'sharpest' });
  });

  it('is the one it starts on when no scan found one there', () => {
    expect(frameToCapture(draft('sc', 50, 60), { scan, frame: FRAME })).toEqual({ time: 50, why: 'start' });
    expect(frameToCapture(draft('sc', 10, 20), { frame: FRAME })).toEqual({ time: 10, why: 'start' });
  });

  it('is the instant itself for an instant', () => {
    expect(frameToCapture(draft('sc', 14), { scan, frame: FRAME })).toEqual({ time: 14, why: 'instant' });
  });

  it('is the sharpest of the clip for the whole video, else the one on screen', () => {
    expect(frameToCapture(draft('sc', null), { scan, now: 7, frame: FRAME })).toEqual({ time: 2, why: 'sharpest' });
    expect(frameToCapture(draft('sc', null), { now: 7, frame: FRAME })).toEqual({ time: 7, why: 'screen' });
  });
});

describe('what Geo Proof is handed', () => {
  it('names the video, the scene\'s time, the draft it takes up and the saved frames', () => {
    expect(proofHandoff(draft('sc_1', 10, 20, 'bridge?'), 'media/clip.mp4', ['media/a.png', 'media/b.png'])).toEqual({
      video: 'media/clip.mp4',
      moments: [{ start: 10, end: 20 }],
      draft: 'sc_1',
      panels: ['media/a.png', 'media/b.png'],
      label: 'bridge?',
    });
    expect(proofHandoff(draft('sc_2', 3.2), 'media/clip.mp4', []).moments).toEqual([{ start: 3.2, end: null }]);
    expect(proofHandoff(draft('sc_3', null), 'media/clip.mp4', []).moments).toEqual([]);
  });

  it('hands every moment of a scene showing its place again', () => {
    const twice = { ...draft('sc_1', 0, 7, 'Bridge'), more: [m(65, 72)] };
    expect(proofHandoff(twice, 'media/clip.mp4', []).moments).toEqual([m(0, 7), m(65, 72)]);
  });

  it('keeps the panels in the order given: the frames, then the captures', () => {
    const panels = ['media/frame-1.png', 'media/frame-2.png', 'media/capture.png'];
    expect(proofHandoff(draft('sc_1', 10, 20), 'media/clip.mp4', panels).panels).toEqual(panels);
  });
});

describe('what Geo Proof is handed for a picture', () => {
  it('lays out the picture, then its captures, and states no time and no draft', () => {
    expect(pictureHandoff({ label: 'Market?' }, 'media/market.jpg', ['media/cap-1.png', 'media/cap-2.png'])).toEqual({
      picture: 'media/market.jpg',
      panels: ['media/market.jpg', 'media/cap-1.png', 'media/cap-2.png'],
      label: 'Market?',
    });
  });

  it('holds with no capture, and never lays the picture out twice', () => {
    expect(pictureHandoff({ label: '' }, 'media/market.jpg').panels).toEqual(['media/market.jpg']);
    expect(pictureHandoff({}, 'media/market.jpg', ['media/market.jpg', '']).panels).toEqual(['media/market.jpg']);
  });
});

describe('a collage among the scenes', () => {
  const collage = (name, times) => ({ collage: name, title: name, times, start: times[0], end: times.length > 1 ? times.at(-1) : null });
  const listed = (drafts, proofs = []) => sceneList(proofs, drafts);

  it('is in the scene holding most of its pieces, else in the whole video, else in none', () => {
    const scenes = listed([draft('whole', null), draft('a', 1, 3), draft('b', 2, 6)]);
    expect(sceneOfCollage([2.4, 3.6, 5], scenes, FRAME).id).toBe('b');
    expect(sceneOfCollage([1.2], scenes, FRAME).id).toBe('a');
    expect(sceneOfCollage([40], scenes, FRAME).id).toBe('whole');
    expect(sceneOfCollage([40], listed([draft('a', 1, 3)]), FRAME)).toBeNull();
  });

  it('counts a piece on the last instant of a period marked from it', () => {
    // a period marked first to last piece: the last piece starts where it ends
    const scenes = listed([draft('p', 1.2, 3.6)]);
    expect(sceneOfCollage([3.6], scenes, FRAME)).toBeNull();
    expect(sceneOfCollage([1.2, 3.6], scenes, FRAME).id).toBe('p');
  });

  it('is held by no abandoned scene, and by a proof at the frames it rests on', () => {
    const gone = { kind: 'draft', id: 'gone', captures: [], abandoned: { reason: '' } };
    const scenes = sceneList([gone, proof('Bridge', { at: [5] })], [draft('gone', 1, 3)]);
    expect(sceneOfCollage([2], scenes, FRAME)).toBeNull();
    expect(sceneOfCollage([5], scenes, FRAME).kind).toBe('proof');
  });

  it('is listed under each scene holding a piece, and under the whole video when none does', () => {
    const scenes = listed([draft('whole', null), draft('a', 1, 3), draft('b', 2, 6)]);
    const under = collagesUnder(scenes, [collage('Pan', [1.5, 2.5]), collage('Far', [30])], FRAME);
    expect(under.get('a').map((c) => c.collage)).toEqual(['Pan']);
    expect(under.get('b').map((c) => c.collage)).toEqual(['Pan']);
    expect(under.get('whole').map((c) => c.collage)).toEqual(['Far']);
  });

  it('is offered to a scene\'s proof when it holds one of its moments, and to the whole video always', () => {
    const pieces = [collage('Late', [8, 9]), collage('Pan', [1.5, 2.5])];
    expect(collagesOfScene(listed([draft('a', 2, 4)])[0], pieces, FRAME).map((c) => c.collage)).toEqual(['Pan']);
    expect(collagesOfScene(listed([draft('w', null)])[0], pieces, FRAME).map((c) => c.collage)).toEqual(['Pan', 'Late']);
  });
});
