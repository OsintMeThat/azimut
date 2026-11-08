import { describe, expect, it } from 'vitest';
import {
  badgeText, frameOrigin, handoffTitle, momentHolds, outsideFrames, panelFrames, playSegments, proofVideos,
  readHandoff, readStatedScene, sceneBadges, sceneColor, sceneLine, segmentAt, starVideo, statedMoments, videoName,
} from './proofScene.js';

/**
 * A proof's scene as Geo Proof reads it: the panels Inspect cut from a video, the
 * video the proof is about, and how its panels stand against the time it states.
 */

const CLIP = 'media/Telegram/clip.mp4';
const OTHER = 'media/other.mp4';
const frameOf = (from, time) => ({ source: { type: 'inspect', op: 'frame', from, time } });
const MEDIA = new Map([
  ['media/a.png', frameOf(CLIP, 130.4)],
  ['media/b.png', frameOf(OTHER, 12)],
  ['media/c.png', frameOf(CLIP, 300)],
  ['media/photo.jpg', { source: { type: 'upload' } }],
  ['media/adjusted.png', { source: { type: 'inspect', op: 'adjust', from: CLIP } }],
]);
const PANELS = [
  { id: 'p0', src: 'media/photo.jpg' },
  { id: 'p1', src: 'media/a.png' },
  { id: 'p2', src: 'media/b.png' },
  { id: 'p3', src: 'media/c.png' },
  { id: 'p4', src: 'media/adjusted.png' },
];

describe('the panels cut from a video', () => {
  it('reads the clip and the instant off a frame Inspect cut, and nothing else', () => {
    expect(frameOrigin(frameOf(CLIP, 2.5))).toEqual({ video: CLIP, time: 2.5 });
    expect(frameOrigin({ source: { type: 'upload' } })).toBeNull();
    expect(frameOrigin({ source: { type: 'inspect', op: 'adjust', from: CLIP } })).toBeNull();
    expect(frameOrigin(frameOf('', 2))).toBeNull();
  });

  it('reads a collage of one video\'s frames back to that video at its first piece', () => {
    const collage = (sources, times) => ({ kind: 'image', source: { type: 'inspect', op: 'collage', sources, times } });
    const media = new Map([
      ['frames/a.png', frameOf(CLIP, 4.2)],
      ['frames/b.png', frameOf(CLIP, 2.5)],
      ['frames/other.png', frameOf('media/other.mp4', 1)],
      [CLIP, { kind: 'video' }],
      ['photos/street.jpg', { kind: 'image', source: { type: 'upload' } }],
    ]);
    const pano = collage(['frames/a.png', 'frames/b.png'], [null, null]);
    expect(frameOrigin(pano, media)).toEqual({ video: CLIP, time: 2.5 });
    // a piece taken from the video at an instant counts too
    expect(frameOrigin(collage([CLIP, 'frames/a.png'], [1.5, null]), media)).toEqual({ video: CLIP, time: 1.5 });
    // a straightened collage stands for the frames of the one it bent
    media.set('collages/pano.png', pano);
    expect(frameOrigin(collage(['collages/pano.png'], [null]), media)).toEqual({ video: CLIP, time: 2.5 });
    // two videos, or a photo among the pieces: a picture of its own
    expect(frameOrigin(collage(['frames/a.png', 'frames/other.png'], [null, null]), media)).toBeNull();
    expect(frameOrigin(collage(['frames/a.png', 'photos/street.jpg'], [null, null]), media)).toBeNull();
    // with no media to look the pieces up, nothing is guessed
    expect(frameOrigin(pano)).toBeNull();
    // Geo Proof's panels: the collage panel rests on the clip like a frame
    expect(panelFrames([{ id: 'p1', src: 'collages/pano.png' }], media)).toEqual([
      { panel: 'p1', src: 'collages/pano.png', video: CLIP, time: 2.5 },
    ]);
    expect(frameOrigin(null)).toBeNull();
  });

  it('lists them in the panels\' order', () => {
    expect(panelFrames(PANELS, MEDIA)).toEqual([
      { panel: 'p1', src: 'media/a.png', video: CLIP, time: 130.4 },
      { panel: 'p2', src: 'media/b.png', video: OTHER, time: 12 },
      { panel: 'p3', src: 'media/c.png', video: CLIP, time: 300 },
    ]);
    expect(panelFrames([{ id: 'x', src: 'media/photo.jpg' }], MEDIA)).toEqual([]);
  });
});

describe('the video the proof is about', () => {
  const frames = panelFrames(PANELS, MEDIA);

  it('is the one it states, else the first one a panel was cut from', () => {
    expect(starVideo(frames, null)).toBe(CLIP);
    expect(starVideo(frames, { video: OTHER, moments: [] })).toBe(OTHER);
    expect(starVideo([], null)).toBeNull();
  });

  it('comes first, the others after as confirmations, each with its frames', () => {
    expect(proofVideos(frames, { video: OTHER, moments: [] }).map((v) => [v.name, v.star, v.frames.length])).toEqual([
      ['other.mp4', true, 1],
      ['clip.mp4', false, 2],
    ]);
    // a video the proof states keeps its field when its panels are gone
    expect(proofVideos([], { video: CLIP, moments: [] }).map((v) => v.name)).toEqual(['clip.mp4']);
    expect(proofVideos([], null)).toEqual([]);
  });

  it('carries the moments stated for it, and none for another', () => {
    const stated = { video: CLIP, moments: [{ start: 1, end: null }] };
    expect(statedMoments(stated, CLIP)).toEqual(stated.moments);
    expect(statedMoments(stated, OTHER)).toEqual([]);
    expect(statedMoments(null, CLIP)).toEqual([]);
  });

  it('reads a stated scene in its one shape, the older single span as one moment', () => {
    expect(readStatedScene({ video: CLIP, moments: [{ start: 9, end: 12 }, { start: 3, end: null }], draft: 's3' })).toEqual({
      video: CLIP, moments: [{ start: 3, end: null }, { start: 9, end: 12 }], draft: 's3',
    });
    expect(readStatedScene({ video: CLIP, start: 130, end: 158, draft: null })).toEqual({
      video: CLIP, moments: [{ start: 130, end: 158 }], draft: null,
    });
    // an end before its start is no passage, and a moment with no start no moment
    expect(readStatedScene({ video: CLIP, moments: [{ start: 9, end: 4 }, { end: 3 }] }).moments).toEqual([{ start: 9, end: null }]);
    expect(readStatedScene({ moments: [] })).toBeNull();
    expect(readStatedScene(null)).toBeNull();
  });
});

describe('the time against the panels', () => {
  it('holds a frame inside a passage, and one near an instant', () => {
    expect(momentHolds({ start: 130, end: 158 }, 130.4)).toBe(true);
    expect(momentHolds({ start: 130, end: 158 }, 158.01)).toBe(true);
    expect(momentHolds({ start: 130, end: 158 }, 160)).toBe(false);
    expect(momentHolds({ start: 300, end: null }, 300.4)).toBe(true);
    expect(momentHolds({ start: 300, end: null }, 301)).toBe(false);
    expect(momentHolds({ start: 300, end: null }, null)).toBe(false);
  });

  it('finds the ★ panels outside every moment, and none for the whole video', () => {
    const frames = panelFrames(PANELS, MEDIA);
    expect(outsideFrames(frames, CLIP, [{ start: 130, end: 158 }]).map((f) => f.panel)).toEqual(['p3']);
    expect(outsideFrames(frames, CLIP, [{ start: 130, end: 158 }, { start: 300, end: null }])).toEqual([]);
    expect(outsideFrames(frames, CLIP, [])).toEqual([]);
  });

  it('words the field: the file and its time, or the whole video', () => {
    expect(sceneLine(CLIP, [{ start: 130, end: 158 }])).toBe('clip.mp4 · 2:10–2:38');
    expect(sceneLine(CLIP, [])).toBe('clip.mp4 · Whole video');
    expect(videoName('media\\win\\clip.mp4')).toBe('clip.mp4');
  });
});

describe('the badge on the picture', () => {
  const frames = panelFrames(PANELS, MEDIA);
  const moments = [{ start: 130, end: 158 }, { start: 190, end: 200 }];

  it('prints the moment the panel\'s frame shows in, else every moment', () => {
    expect(badgeText(CLIP, moments, 130.4)).toBe('2:10–2:38');
    expect(badgeText(CLIP, moments, 300)).toBe('2:10–2:38 · 3:10–3:20');
    expect(badgeText(CLIP, [{ start: 144, end: null }], 144)).toBe('2:24');
  });

  it('never prints for the whole video, nor while the switch is off', () => {
    expect(badgeText(CLIP, [], 130)).toBeNull();
    expect(sceneBadges(true, frames, CLIP, []).size).toBe(0);
    expect(sceneBadges(false, frames, CLIP, moments).size).toBe(0);
  });

  it('goes on the ★ video\'s panels alone', () => {
    expect([...sceneBadges(true, frames, CLIP, moments)]).toEqual([
      ['p1', '2:10–2:38'],
      ['p3', '2:10–2:38 · 3:10–3:20'],
    ]);
  });
});

describe('what the player runs through', () => {
  it('plays each passage, holds each instant, in clip order', () => {
    expect(playSegments([{ start: 50, end: null }, { start: 10, end: 20 }])).toEqual([
      { kind: 'passage', start: 10, end: 20 },
      { kind: 'instant', start: 50, end: null },
    ]);
  });

  it('plays the whole video from the first panel\'s frame', () => {
    expect(playSegments([], 12.5)).toEqual([{ kind: 'whole', start: 12.5, end: null }]);
  });

  it('starts on the moment the clip is in, else the next, else the first', () => {
    const list = playSegments([{ start: 10, end: 20 }, { start: 50, end: null }]);
    expect(segmentAt(list, 15)).toBe(0);
    expect(segmentAt(list, 30)).toBe(1);
    expect(segmentAt(list, 80)).toBe(0);
  });
});

describe('the scene\'s colour', () => {
  const listed = [
    { kind: 'proof', proof: 'early', moments: [{ start: 1, end: 2 }], at: [] },
    { kind: 'draft', id: 's3', start: 40, end: null, label: '' },
    { kind: 'proof', proof: 'late', moments: [{ start: 90, end: null }], at: [] },
  ];

  it('is the one Inspect gives it, for a saved proof or the draft it came from', () => {
    expect(sceneColor(listed, { proof: 'late' })).toBe('var(--anno-4)');
    expect(sceneColor(listed, { draft: 's3' })).toBe('var(--anno-1)');
    expect(sceneColor(listed, { proof: 'unknown' })).toBe('var(--anno-2)');
    expect(sceneColor(undefined)).toBe('var(--anno-2)');
  });
});

describe('a Make the proof handoff', () => {
  it('reads the scene, its frames in order and a name from its label', () => {
    expect(readHandoff({
      video: CLIP, moments: [{ start: 292, end: 320 }], draft: 's3', panels: ['media/a.png', 'media/c.png', 'media/a.png', ''], label: 'Road bridge?',
    })).toEqual({
      scene: { video: CLIP, moments: [{ start: 292, end: 320 }], draft: 's3' },
      panels: ['media/a.png', 'media/c.png'],
      title: 'Road bridge',
    });
    expect(readHandoff({ moments: [], panels: ['media/a.png'] })).toBeNull();
  });

  it('reads a picture marked to geolocate as a proof with no scene', () => {
    expect(readHandoff({ picture: 'media/photo.jpg', panels: ['media/photo.jpg', 'media/cap.png', 'media/cap.png'], label: 'Market?' })).toEqual({
      scene: null,
      panels: ['media/photo.jpg', 'media/cap.png'],
      title: 'Market',
    });
    // nothing to lay out is no proof
    expect(readHandoff({ picture: 'media/photo.jpg', panels: [] })).toBeNull();
    // a video named wins: its scene states its time
    expect(readHandoff({ picture: 'media/photo.jpg', video: CLIP, moments: [], panels: ['media/a.png'] }).scene.video).toBe(CLIP);
  });

  it('names the proof after the label, without the question it was kept with', () => {
    expect(handoffTitle('Pont routier ?')).toBe('Pont routier');
    expect(handoffTitle('  Depot  ')).toBe('Depot');
    expect(handoffTitle('???')).toBe('');
    expect(handoffTitle(null)).toBe('');
  });
});
