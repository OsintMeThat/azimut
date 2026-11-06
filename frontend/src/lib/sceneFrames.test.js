import { describe, expect, it } from 'vitest';
import {
  frameInMoment, frameScenes, frameToCapture, frameUses, framesOfScene, inScenes, proofHandoff, scenesAt, usedIn,
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
    expect(frameInMoment(3.18, m(3.2), FRAME)).toBe(true);
    expect(frameInMoment(3.16, m(3.2), FRAME)).toBe(false);
    expect(frameInMoment(3.24, m(3.2), FRAME)).toBe(false);
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
});
