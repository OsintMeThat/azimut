import { describe, expect, it } from 'vitest';
import { GatheredJoin, addedWords, holdsScene } from './gatheredJoin.js';

/**
 * What a scene being geolocated gathers, its map captures and the pictures of its video,
 * joins the proof open in Geo Proof that holds it, saved or not, each once and only while
 * Geo Proof is in front.
 */

const VIDEO = 'media/clip.mp4';
const KEY = `c1\n${VIDEO}\nsc_1`;
const held = (extra = {}) => ({ video: VIDEO, id: 'sc_1', file_kind: 'video', captures: [], ...extra });

describe('the proof open holding the scene geolocated', () => {
  it('holds a video’s scene it takes up, saved or not, and no other', () => {
    expect(holdsScene(held(), { draft: 'sc_1' })).toBe(true);
    expect(holdsScene(held(), { draft: 'sc_2' })).toBe(false);
    expect(holdsScene(held(), { draft: null, panels: [VIDEO] })).toBe(false);
    expect(holdsScene(null, { draft: 'sc_1' })).toBe(false);
  });

  it('holds a picture marked to geolocate by laying it out', () => {
    const picture = held({ video: 'media/street.jpg', file_kind: 'image' });
    expect(holdsScene(picture, { panels: ['media/street.jpg', 'media/cap.png'] })).toBe(true);
    expect(holdsScene(picture, { draft: 'sc_1', panels: ['media/cap.png'] })).toBe(false);
  });
});

describe('the captures that join it', () => {
  it('passes over what the scene gathered before the proof took it up, and lays what it gathers since', () => {
    const join = new GatheredJoin();
    expect(join.take({ key: KEY, sources: { captures: ['media/old.png'] }, panels: [], front: true })).toEqual([]);
    expect(join.take({ key: KEY, sources: { captures: ['media/old.png', 'media/new.png'] }, panels: [], front: true })).toEqual(['media/new.png']);
    // once only, even when the analyst takes it off again
    expect(join.take({ key: KEY, sources: { captures: ['media/old.png', 'media/new.png'] }, panels: [], front: true })).toEqual([]);
  });

  it('waits for Geo Proof to come to the front, then lays everything gathered meanwhile', () => {
    const join = new GatheredJoin();
    join.take({ key: KEY, sources: { captures: [] }, front: false });
    expect(join.take({ key: KEY, sources: { captures: ['media/a.png'] }, front: false })).toEqual([]);
    expect(join.take({ key: KEY, sources: { captures: ['media/a.png', 'media/b.png'] }, front: false })).toEqual([]);
    expect(join.take({ key: KEY, sources: { captures: ['media/a.png', 'media/b.png'] }, front: true })).toEqual(['media/a.png', 'media/b.png']);
  });

  it('never lays the pictures a handoff lays out itself, even when their word lands after', () => {
    const join = new GatheredJoin();
    join.hand(['media/view photo.png', 'media/view terrain.png']);
    // the new proof takes the scene up before the server said it gathered them
    expect(join.take({ key: KEY, sources: { captures: [] }, front: true })).toEqual([]);
    expect(join.take({ key: KEY, sources: { captures: ['media/view photo.png', 'media/view terrain.png'] }, front: true })).toEqual([]);
    expect(join.take({ key: KEY, sources: { captures: ['media/view photo.png', 'media/view terrain.png', 'media/sat.png'] }, front: true }))
      .toEqual(['media/sat.png']);
  });

  it('leaves a capture already laid out where the analyst leaves it', () => {
    const join = new GatheredJoin();
    join.take({ key: KEY, sources: { captures: [] }, panels: [], front: false });
    expect(join.take({ key: KEY, sources: { captures: ['media/a.png'] }, panels: ['media/a.png'], front: true })).toEqual([]);
    // taken off: it stays off
    expect(join.take({ key: KEY, sources: { captures: ['media/a.png'] }, panels: [], front: true })).toEqual([]);
  });

  it('takes the frames and collages of the video as a second source, its first read passed over, frames first', () => {
    const join = new GatheredJoin();
    const at = (captures, footage, front = true) => join.take({ key: KEY, sources: { footage, captures }, front });
    // the proof took the scene up before the video's pictures were read: captures go on alone
    expect(at(['media/old.png'], null)).toEqual([]);
    expect(at(['media/old.png', 'media/sat.png'], null)).toEqual(['media/sat.png']);
    // their first read says what was saved before: none of it is laid
    expect(at(['media/old.png', 'media/sat.png'], ['media/frame 1.png'])).toEqual([]);
    // a frame saved in Inspect and a capture filed while Geo Proof was behind
    expect(at(['media/old.png', 'media/sat.png', 'media/sat 2.png'], ['media/frame 1.png', 'media/frame 2.png'], false)).toEqual([]);
    expect(at(['media/old.png', 'media/sat.png', 'media/sat 2.png'], ['media/frame 1.png', 'media/frame 2.png']))
      .toEqual(['media/frame 2.png', 'media/sat 2.png']);
  });

  it('reads the video’s pictures anew for another proof, what was saved before it passed over', () => {
    const join = new GatheredJoin();
    join.take({ key: KEY, sources: { footage: ['media/a.png'] }, front: true });
    join.reset();
    // the new proof's own read, after a frame was saved for the chooser
    expect(join.take({ key: KEY, sources: { footage: null }, front: true })).toEqual([]);
    expect(join.take({ key: KEY, sources: { footage: ['media/a.png', 'media/b.png'] }, front: true })).toEqual([]);
    expect(join.take({ key: KEY, sources: { footage: ['media/a.png', 'media/b.png', 'media/c.png'] }, front: true })).toEqual(['media/c.png']);
  });

  it('lays nothing while the proof holds no scene, and starts over on another proof or another scene', () => {
    const join = new GatheredJoin();
    expect(join.take({ key: '', sources: { captures: ['media/a.png'] }, front: true })).toEqual([]);
    expect(join.take({ key: '', sources: { captures: ['media/a.png', 'media/b.png'] }, front: true })).toEqual([]);
    // the scene geolocated from here on: what it gathered so far is passed over
    expect(join.take({ key: KEY, sources: { captures: ['media/a.png', 'media/b.png'] }, front: true })).toEqual([]);
    expect(join.take({ key: KEY, sources: { captures: ['media/a.png', 'media/b.png', 'media/c.png'] }, front: true })).toEqual(['media/c.png']);
    // another proof opened on the same scene takes what is gathered as it stands
    join.reset();
    expect(join.take({ key: KEY, sources: { captures: ['media/a.png', 'media/b.png', 'media/c.png', 'media/d.png'] }, front: true })).toEqual([]);
    expect(join.take({ key: `c1\n${VIDEO}\nsc_2`, sources: { captures: ['media/e.png'] }, front: true })).toEqual([]);
  });
});

describe('what the toast says of it', () => {
  it('names map captures and pictures of the video, together when both came', () => {
    expect(addedWords(1, 0)).toBe('1 map capture added');
    expect(addedWords(3, 0)).toBe('3 map captures added');
    expect(addedWords(0, 1)).toBe('1 picture of the video added');
    expect(addedWords(2, 2)).toBe('2 map captures and 2 pictures of the video added');
    expect(addedWords(0, 0)).toBe('');
  });
});
