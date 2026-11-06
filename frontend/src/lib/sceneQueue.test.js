import { describe, expect, it } from 'vitest';
import { abandonedScenes, captureWords, firstScenes, openScenes, queueColor, queueMark, queueName, queueState, sceneCount } from './sceneQueue.js';
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

describe('the rows a list shows', () => {
  it('parts the open scenes from the abandoned, file by file', () => {
    expect(openScenes(FILES).map((f) => [f.title, f.scenes.map((s) => s.id)])).toEqual([['A', ['w', 'p']], ['C', ['c1', 'c2']]]);
    expect(abandonedScenes(FILES).map((f) => [f.title, f.scenes.map((s) => s.id)])).toEqual([['A', ['g']], ['B', ['x']]]);
    expect(sceneCount(openScenes(FILES))).toBe(4);
    expect(openScenes(null)).toEqual([]);
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
  });
});
