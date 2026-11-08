import { describe, expect, it } from 'vitest';
import {
  abandonedScenes, captureCount, captureWords, firstScenes, gatheredScene, isPicture, openScenes, queueColor, queueMark, queueName, queueState,
  queueShortTime, queueTime, sceneCount, waitingWords, withProofs,
} from './sceneQueue.js';
import { sceneList } from './scenes.js';

const row = (id, start, end, label = '', extra = {}) => ({
  kind: 'draft', video: 'media/a.mp4', id, start, end, label, state: 'todo', captures: [], abandoned: null, ...extra,
});

const FILES = [
  { video: 'media/a.mp4', title: 'A', scenes: [row('w', null, null), row('g', 5, null, 'Gone', { state: 'abandoned' }), row('p', 10, 20)] },
  { video: 'media/b.mp4', title: 'B', scenes: [row('x', 1, null, '', { state: 'abandoned' })] },
  { video: 'media/c.mp4', title: 'C', scenes: [row('c1', 1, null), row('c2', 2, null)] },
];

describe('what a row says', () => {
  it('calls a scene by its label, else by its time', () => {
    expect(queueName(row('a', 238, 252, 'bridge?'))).toBe('bridge?');
    expect(queueName(row('a', 238, 252))).toBe('3:58–4:12');
    expect(queueName(row('a', 3, null))).toBe('0:03');
    expect(queueName(row('a', null, null))).toBe('Whole video');
  });

  it('says every moment of a scene showing its place again, and the first with the rest counted where room is short', () => {
    const twice = row('a', 0, 7, '', { more: [{ start: 65, end: 72 }] });
    expect(queueTime(twice)).toBe('0:00–0:07 · 1:05–1:12');
    expect(queueName(twice)).toBe('0:00–0:07 · 1:05–1:12');
    expect(queueShortTime(twice)).toBe('0:00–0:07 +1');
    expect(queueShortTime(row('b', 3, null))).toBe('0:03');
    expect(queueMark(twice)).toBe('passage');
    // a proof with no place yet, in the To-do beside the scenes, says its own moments
    const proofRow = { kind: 'proof', id: 'proof:P', proof: 'P', label: 'P', start: 0, end: 7, moments: [{ start: 0, end: 7 }, { start: 80, end: null }] };
    expect(queueTime(proofRow)).toBe('0:00–0:07 · 1:20');
  });

  it('says Whole picture for a picture, which has no time to read', () => {
    const picture = row('a', null, null, '', { file_kind: 'image' });
    expect(queueTime(picture)).toBe('Whole picture');
    expect(queueName(picture)).toBe('Whole picture');
    expect(queueName({ ...picture, label: 'Harbour wall' })).toBe('Harbour wall');
    expect(queueTime(row('a', 238, 252, '', { file_kind: 'video' }))).toBe('3:58–4:12');
  });

  it('tells a picture from a video on a row and on a file of the queue', () => {
    expect(isPicture({ file_kind: 'image' })).toBe(true);
    expect(isPicture({ file_kind: 'video' })).toBe(false);
    expect(isPicture({ kind: 'image', title: 'A file' })).toBe(true);
    // a row's own `kind` is `draft`, never read for its file
    expect(isPicture({ kind: 'draft', file_kind: 'video' })).toBe(false);
    expect(isPicture(null)).toBe(false);
  });

  it('counts what waits in words', () => {
    expect(waitingWords(1)).toBe('1 scene to geolocate');
    expect(waitingWords(3)).toBe('3 scenes to geolocate');
  });

  it('says the state, the captures it holds, and which one is being geolocated', () => {
    expect(queueState(row('a', 1, null))).toBe('To geolocate');
    expect(queueState(row('a', 1, null, '', { state: 'progress', captures: ['x'] }))).toBe('In progress · 1 capture');
    expect(queueState(row('a', 1, null, '', { state: 'progress', captures: ['x', 'y'] }))).toBe('In progress · 2 captures');
    // a capture sent to the Trash meanwhile leaves nothing to count
    expect(queueState(row('a', 1, null, '', { state: 'progress', captures: [] }))).toBe('To geolocate');
    expect(queueState(row('a', 1, null), true)).toBe('Geolocating');
    expect(queueState(row('a', 1, null, '', { captures: ['x', 'y', 'z'] }), true)).toBe('Geolocating · 3 captures');
    expect(captureWords(0)).toBe('0 captures');
  });
});

describe('a scene as a nudge leaves it', () => {
  const nudge = (capture, captures) => ({ type: 'geolocating', case_id: 'c1', video: 'media/a.mp4', draft: 'a', capture, captures });

  it('attaches the capture it names, once, and is in progress from the first', () => {
    const first = gatheredScene(row('a', 1, null), nudge('media/c1.png', 1));
    expect(first).toMatchObject({ captures: ['media/c1.png'], state: 'progress' });
    expect(first.captureCount).toBe(undefined);
    expect(gatheredScene(first, nudge('media/c1.png', 1)).captures).toEqual(['media/c1.png']);
    expect(queueState(gatheredScene(first, nudge('media/c2.png', 2)), true)).toBe('Geolocating · 2 captures');
  });

  it('keeps the number it gives when the list is behind, and leaves the scene it had alone', () => {
    const scene = row('a', 1, null, '', { state: 'progress', captures: ['media/c1.png'] });
    const next = gatheredScene(scene, nudge('media/c4.png', 4));
    expect(next.captures).toEqual(['media/c1.png', 'media/c4.png']);
    expect(captureCount(next)).toBe(4);
    expect(queueState(next)).toBe('In progress · 4 captures');
    expect(scene.captures).toEqual(['media/c1.png']);
    // a later word that agrees with the list hands the count back to it
    expect(captureCount(gatheredScene(next, nudge('media/c5.png', 3)))).toBe(3);
    expect(gatheredScene({ ...next, captures: ['a', 'b', 'c', 'd'] }, nudge('d', 4)).captureCount).toBe(undefined);
  });

  it('changes nothing on a word that names no capture, as a start does', () => {
    const scene = row('a', 1, null);
    expect(gatheredScene(scene, { draft: 'a' })).toEqual(scene);
    expect(gatheredScene(row('g', 1, null, '', { state: 'abandoned' }), nudge('x', 1)).state).toBe('abandoned');
    expect(captureCount(null)).toBe(0);
  });
});

describe('the rows a list shows', () => {
  it('parts the open scenes from the abandoned, file by file', () => {
    expect(openScenes(FILES).map((f) => [f.title, f.scenes.map((s) => s.id)])).toEqual([['A', ['w', 'p']], ['C', ['c1', 'c2']]]);
    expect(abandonedScenes(FILES).map((f) => [f.title, f.scenes.map((s) => s.id)])).toEqual([['A', ['g']], ['B', ['x']]]);
    expect(sceneCount(openScenes(FILES))).toBe(4);
    expect(openScenes(null)).toEqual([]);
  });

  it('lists a file’s proofs with no place yet among its scenes, in the order its bar draws them', () => {
    const proof = (name, order, state = 'progress') => ({ kind: 'proof', id: `proof:${name}`, proof: name, video: 'media/v.mp4', label: name, start: order, end: null, state, order });
    const files = withProofs([
      { video: 'media/v.mp4', title: 'V', scenes: [row('s0', 0, null, '', { order: 0 }), row('s2', 20, null, '', { order: 2 })],
        proofs: [proof('Bridge', 1), proof('Depot', 3, 'abandoned')] },
      { video: 'media/w.mp4', title: 'W', scenes: [], proofs: [proof('Only', 0)] },
      { video: 'media/x.mp4', title: 'X', scenes: [row('x0', 1, null)] },
    ]);
    expect(openScenes(files).map((f) => [f.title, f.scenes.map((s) => s.id)])).toEqual([
      ['V', ['s0', 'proof:Bridge', 's2']], ['W', ['proof:Only']], ['X', ['x0']],
    ]);
    expect(abandonedScenes(files).map((f) => f.scenes.map((s) => s.id))).toEqual([['proof:Depot']]);
    expect(sceneCount(openScenes(files))).toBe(5);
    // the extension's queue carries no proofs, and reads as it did
    expect(withProofs(FILES)).toEqual(FILES);
  });

  it('keeps the first few across the files, and always the one named', () => {
    const open = openScenes(FILES);
    expect(firstScenes(open, 3).map((f) => f.scenes.map((s) => s.id))).toEqual([['w', 'p'], ['c1']]);
    expect(firstScenes(open, 1, (s) => s.id === 'c2').map((f) => f.scenes.map((s) => s.id))).toEqual([['w'], ['c2']]);
  });
});

describe('how a row marks its scene', () => {
  it('wears the colour Inspect gives the scene at that place in its clip', () => {
    const drafts = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, start: i }));
    const listed = sceneList([], drafts);
    listed.forEach((scene, order) => expect(queueColor(row('x', 1, null, '', { order }))).toBe(scene.color));
    expect(queueColor(row('x', 1, null))).toBe(listed[0].color);
    expect(queueColor(row('x', 1, null, '', { order: -1 }))).toBe(listed[0].color);
  });

  it('is a band for a passage, a pin for an instant, nothing for the whole video', () => {
    expect(queueMark(row('a', 10, 20))).toBe('passage');
    expect(queueMark(row('a', 10, null))).toBe('instant');
    expect(queueMark(row('a', 10, 10))).toBe('instant');
    expect(queueMark(row('a', null, null))).toBe(null);
    // a picture has no bar, whatever its work holds
    expect(queueMark(row('a', 10, 20, '', { file_kind: 'image' }))).toBe(null);
  });
});
