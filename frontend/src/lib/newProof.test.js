import { describe, expect, it } from 'vitest';
import {
  SOURCES, inFolder, inSource, movePick, pictureFolders, proofSources, sceneMaterial, scenesToProve, sourceOf,
  togglePick, videoBlocks,
} from './newProof.js';

const sat = { src: 'captures/sat.png', kind: 'satellite', sourceType: 'satellite', origin: null, collage: false, folder: '' };
const street = { src: 'captures/street.png', kind: 'media', sourceType: 'screenshot', origin: null, collage: false, folder: 'site' };
const frameA = { src: 'media/a.png', kind: 'media', sourceType: 'inspect', origin: { video: 'media/clip.mp4', time: 4 }, collage: false, folder: '', added_at: '2026-01-02' };
const frameB = { src: 'media/b.png', kind: 'media', sourceType: 'inspect', origin: { video: 'media/clip.mp4', time: 1.5 }, collage: false, folder: '', added_at: '2026-01-01' };
const clipCollage = { src: 'media/c.png', kind: 'media', sourceType: 'inspect', origin: { video: 'media/clip.mp4', time: 2 }, collage: true, folder: '' };
const otherFrame = { src: 'media/d.png', kind: 'media', sourceType: 'inspect', origin: { video: 'media/road.mp4', time: 0 }, collage: false, folder: '', added_at: '2026-03-01' };
const mixed = { src: 'media/mix.png', kind: 'media', sourceType: 'inspect', origin: null, collage: true, folder: '' };
const photo = { src: 'media/photo.jpg', kind: 'media', sourceType: 'upload', origin: null, collage: false, folder: 'site/roof' };
const horizon = { src: 'media/h.png', kind: 'media', sourceType: 'horizon', origin: null, collage: false, folder: '' };
const ALL = [sat, street, frameA, frameB, clipCollage, otherFrame, mixed, photo, horizon];

describe('where a picture comes from', () => {
  it('reads each picture to one source, a collage of one video under its video', () => {
    expect(ALL.map(sourceOf)).toEqual([
      'satellite', 'screenshots', 'videos', 'videos', 'videos', 'videos', 'collages', 'photos', 'screenshots',
    ]);
  });

  it('lists a collage of one video under Collages too', () => {
    expect(ALL.filter((item) => inSource(item, 'collages')).map((item) => item.src)).toEqual(['media/c.png', 'media/mix.png']);
    expect(ALL.every((item) => inSource(item, 'all'))).toBe(true);
  });

  it('counts each source and leaves the empty ones out, All always there', () => {
    expect(proofSources(ALL).map((s) => [s.id, s.count])).toEqual([
      ['all', 9], ['satellite', 1], ['videos', 4], ['collages', 2], ['screenshots', 2], ['photos', 1],
    ]);
    expect(proofSources([photo]).map((s) => s.id)).toEqual(['all', 'photos']);
    expect(proofSources([]).map((s) => s.id)).toEqual(['all']);
    expect(SOURCES.map((s) => s.label)).toEqual(['All', 'Satellite', 'Videos', 'Collages', 'Screenshots', 'Photos']);
  });

  it('lists every folder a picture is filed in, the parents too, each with its depth', () => {
    expect(pictureFolders(ALL)).toEqual([
      { path: 'site', name: 'site', depth: 0 },
      { path: 'site/roof', name: 'roof', depth: 1 },
    ]);
    expect(ALL.filter((item) => inFolder(item, 'site')).map((item) => item.src)).toEqual(['captures/street.png', 'media/photo.jpg']);
    expect(inFolder(photo, '')).toBe(true);
    expect(inFolder({ folder: 'sites' }, 'site')).toBe(false);
  });
});

describe('the Videos source', () => {
  it('makes a block per video, frames in clip order then collages, the video worked on last first', () => {
    const titles = { 'media/clip.mp4': 'Clip' };
    const blocks = videoBlocks(ALL, (path) => titles[path] ?? '');
    expect(blocks.map((b) => [b.video, b.title])).toEqual([['media/road.mp4', 'road'], ['media/clip.mp4', 'Clip']]);
    expect(blocks[1].frames.map((f) => f.src)).toEqual(['media/b.png', 'media/a.png']);
    expect(blocks[1].collages.map((f) => f.src)).toEqual(['media/c.png']);
  });
});

describe('the scenes still to prove', () => {
  const files = [
    { video: 'media/clip.mp4', title: 'clip.mp4', kind: 'video', scenes: [
      { kind: 'draft', id: 's1', start: 3, end: 8, label: 'Water tower?', state: 'todo', captures: [], order: 1 },
      { kind: 'draft', id: 's2', start: 9, end: null, label: '', state: 'progress', captures: ['captures/sat.png'], order: 2 },
      { kind: 'draft', id: 's3', start: 12, end: 14, label: 'Blurry', state: 'abandoned', captures: [], abandoned: { reason: 'x' }, order: 3 },
    ] },
    { video: 'media/roof.jpg', title: 'Roof', kind: 'image', scenes: [
      { kind: 'draft', id: 'p1', start: null, end: null, label: '', state: 'todo', captures: [], file_kind: 'image', order: 0 },
    ] },
  ];

  it('lists the open ones by file, each with its dot, name, time, file and state', () => {
    const listed = scenesToProve(files, { video: 'media/clip.mp4', id: 's2' });
    expect(listed.map((s) => [s.key, s.name, s.time, s.title, s.picture])).toEqual([
      ['media/clip.mp4#s1', 'Water tower?', '0:03–0:08', 'clip.mp4', false],
      ['media/clip.mp4#s2', '0:09', '0:09', 'clip.mp4', false],
      ['media/roof.jpg#p1', 'Whole picture', 'Whole picture', 'Roof', true],
    ]);
    expect(listed[1].state).toBe('Geolocating · 1 capture');
    expect(listed[0].color).not.toBe(listed[1].color);
    // the row keeps its file, which Make the proof hands over
    expect(listed[0].row).toMatchObject({ id: 's1', video: 'media/clip.mp4' });
  });

  it('is empty for a case with no scene', () => {
    expect(scenesToProve([])).toEqual([]);
    expect(scenesToProve(null)).toEqual([]);
  });
});

describe('the pictures picked', () => {
  it('adds a picture at the end, and takes it out on a second press', () => {
    expect(togglePick(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePick(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('moves one to another place, clamped to the list', () => {
    expect(movePick(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(movePick(['a', 'b', 'c'], 2, -4)).toEqual(['c', 'a', 'b']);
    expect(movePick(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('a scene\'s material', () => {
  it('lays its frames and collages in clip order, then its captures, a frame not filed keyed by its id', () => {
    const material = {
      frames: [{ id: 'f1', time: 4, path: 'media/a.png' }, { id: 'f2', time: 1, path: null }],
      collages: [{ path: 'media/c.png', start: 2 }],
      captures: [{ path: 'captures/sat.png' }, { path: 'media/a.png' }],
      capture: null,
    };
    expect(sceneMaterial(material).map((one) => [one.key, one.group])).toEqual([
      ['frame:f2', 'frames'], ['media/c.png', 'collages'], ['media/a.png', 'frames'], ['captures/sat.png', 'captures'],
    ]);
  });

  it('draws the frame at its start for a scene holding no frame yet', () => {
    const [one] = sceneMaterial({ frames: [], collages: [], captures: [], capture: { time: 6, why: 'start' } });
    expect(one).toMatchObject({ key: 'frame:start', group: 'frames', frame: { id: 'start', time: 6, path: null } });
  });

  it('puts a picture marked to geolocate first, before what was gathered for it', () => {
    const listed = sceneMaterial({ picture: { path: 'media/roof.jpg' }, frames: [], collages: [], captures: [{ path: 'captures/sat.png' }] });
    expect(listed.map((one) => [one.key, one.group])).toEqual([['media/roof.jpg', 'picture'], ['captures/sat.png', 'captures']]);
  });
});
