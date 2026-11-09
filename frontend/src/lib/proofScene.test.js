import { describe, expect, it } from 'vitest';
import {
  badgeText, frameOrigin, handoffTitle, momentHolds, outsideFrames, panelFrames, playSegments, proofVideos,
  readHandoff, readStatedScene, sceneBadges, sceneColor, sceneOfFrames, segmentAt, starVideo, statedMoments,
  mediaTitles, videoName,
} from './proofScene.js';
import { sceneList } from './scenes.js';

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

  it('keeps on its video a cut of a straightened collage filed before instants were recorded', () => {
    // Proof 24's shape: the video three times, bent into one picture, then a cut of it,
    // neither recording an instant
    const composed = (sources, extra = {}) => ({ kind: 'image', source: { type: 'inspect', op: 'collage', sources, ...extra } });
    const media = new Map([
      [CLIP, { kind: 'video' }],
      ['media/Collage 15 straightened.png', composed([CLIP, CLIP, CLIP], { straightened: true })],
      ['media/Collage 15.png', composed(['media/Collage 15 straightened.png'])],
    ]);
    expect(frameOrigin(media.get('media/Collage 15.png'), media)).toEqual({ video: CLIP, time: null });
    expect(panelFrames([{ id: 'p1', src: 'media/Collage 15.png' }], media)).toEqual([
      { panel: 'p1', src: 'media/Collage 15.png', video: CLIP, time: null },
    ]);
    // the instants it does know still count, at every depth
    media.set('media/bent.png', composed([CLIP, CLIP], { times: [3, 1.5] }));
    expect(frameOrigin(composed(['media/bent.png']), media)).toEqual({ video: CLIP, time: 1.5 });
    // a frame with no instant shows outside no moment, and its proof is still the video's
    const frames = panelFrames([{ id: 'p1', src: 'media/Collage 15.png' }], media);
    expect(starVideo(frames, null)).toBe(CLIP);
    expect(outsideFrames(frames, CLIP, [{ start: 1, end: 2 }])).toEqual([]);
    expect(sceneBadges(true, frames, CLIP, [{ start: 1, end: 2 }]).get('p1')).toBe('0:01–0:02');
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
      ['other', true, 1],
      ['clip', false, 2],
    ]);
    // a video the proof states keeps its field when its panels are gone
    expect(proofVideos([], { video: CLIP, moments: [] }).map((v) => v.name)).toEqual(['clip']);
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

  it('names a video by its title in Media, else its file name without the extension', () => {
    expect(videoName(CLIP)).toBe('clip');
    expect(videoName('media\\win\\clip.mp4')).toBe('clip');
    expect(videoName('media/road.v2.webm')).toBe('road.v2');
    expect(videoName('media/.hidden')).toBe('.hidden');
    expect(videoName(CLIP, 'Harbour, from the ferry')).toBe('Harbour, from the ferry');
    expect(videoName(CLIP, '  ')).toBe('clip');
    const titleOf = mediaTitles([{ path: CLIP, title: 'Harbour' }, { path: 'media/b.mp4' }]);
    expect(videoName(CLIP, titleOf)).toBe('Harbour');
    expect(videoName('media/b.mp4', titleOf)).toBe('b');
    expect(proofVideos(panelFrames(PANELS, MEDIA), null, titleOf)[0]).toMatchObject({ video: CLIP, name: 'Harbour', star: true });
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

describe('the scene a proof made by hand finds by its frames', () => {
  const draft = (id, start, end, extra = {}) => ({
    kind: 'draft', id, start, end, label: '', state: 'todo', captures: [], abandoned: null, ...extra,
  });
  const proofRow = (name, extra = {}) => ({ kind: 'proof', proof: name, title: name, moments: [], at: [], stated: false, ...extra });
  /** What `GET /scenes` answers for the clip: a bridge passage, a tower instant, a market passage. */
  const answer = (scenes, extra = {}) => ({ video: CLIP, scenes, taken: [], collages: [], ...extra });
  const SCENES = [
    draft('s1', 0, 7, { label: 'Bridge?' }),
    draft('s2', 30, null),
    draft('s3', 60, 90, { label: 'Market?' }),
  ];
  const at = (...times) => times.map((time, i) => ({ panel: `p${i}`, src: `media/f${i}.png`, video: CLIP, time }));

  it('takes the one scene still to prove every frame falls in, with its moments, name and colour', () => {
    const found = sceneOfFrames(at(0.2, 3, 6.9), CLIP, answer(SCENES));
    const bar = sceneList(SCENES, SCENES);
    expect(found).toEqual({
      id: 's1', moments: [{ start: 0, end: 7 }], title: 'Bridge?', color: bar.find((s) => s.id === 's1').color, whole: false,
    });
    // an instant holds the frame cut on it; a scene with no label is named by its time
    expect(sceneOfFrames(at(30), CLIP, answer(SCENES))).toMatchObject({ id: 's2', moments: [{ start: 30, end: null }], title: '0:30' });
  });

  it('decides nothing for frames in two scenes, nor for frames in none', () => {
    expect(sceneOfFrames(at(3, 70), CLIP, answer(SCENES))).toBeNull();
    expect(sceneOfFrames(at(3, 20), CLIP, answer(SCENES))).toBeNull();
    expect(sceneOfFrames(at(20, 40), CLIP, answer(SCENES))).toBeNull();
    // two scenes over the same frame are two scenes
    expect(sceneOfFrames(at(3), CLIP, answer([...SCENES, draft('s4', 2, 4)]))).toBeNull();
    // nor for a proof with no frame of the clip, or a reading of another video
    expect(sceneOfFrames([], CLIP, answer(SCENES))).toBeNull();
    expect(sceneOfFrames(at(3), CLIP, { ...answer(SCENES), video: OTHER })).toBeNull();
    expect(sceneOfFrames(at(3), CLIP, null)).toBeNull();
  });

  it('reads a frame in a scene by Inspect\'s rule, half a frame at each edge, at the clip\'s rate', () => {
    // the frame before the passage starts, at 25 fps: its middle is outside
    expect(sceneOfFrames(at(6.96), CLIP, answer([draft('s1', 7, 9)]), { frame: 0.04 })).toBeNull();
    // a frame read off the file a hair before the start S counted: its middle is inside
    expect(sceneOfFrames(at(6.981), CLIP, answer([draft('s1', 7, 9)]), { frame: 0.04 })).toMatchObject({ id: 's1' });
    // while the clip's rate is unknown a frame lasts a thirtieth, so that middle falls outside
    expect(sceneOfFrames(at(6.981), CLIP, answer([draft('s1', 7, 9)]))).toBeNull();
    // the last frame of the passage is in it, the one at its end is not
    expect(sceneOfFrames(at(8.96), CLIP, answer([draft('s1', 7, 9)]), { frame: 0.04 })).toMatchObject({ id: 's1' });
    expect(sceneOfFrames(at(9), CLIP, answer([draft('s1', 7, 9)]), { frame: 0.04 })).toBeNull();
  });

  it('leaves out a scene given up on, and one a proof has taken up', () => {
    const abandoned = SCENES.map((s) => (s.id === 's1' ? { ...s, abandoned: { reason: 'blurry' }, state: 'abandoned' } : s));
    expect(sceneOfFrames(at(3), CLIP, answer(abandoned))).toBeNull();
    // taken: named by the server, or cited by a proof of the clip
    expect(sceneOfFrames(at(3), CLIP, answer(SCENES, { taken: ['s1'] }))).toBeNull();
    const cited = [proofRow('bridge', { moments: [{ start: 0, end: 7 }], draft: 's1', stated: true }), ...SCENES];
    expect(sceneOfFrames(at(3), CLIP, answer(cited))).toBeNull();
  });

  it('counts the scene of another proof its frames fall in, never its own row', () => {
    // another proof pinned at the same frame: two scenes hold it
    const shared = [...SCENES, proofRow('old', { at: [3] })];
    expect(sceneOfFrames(at(3), CLIP, answer(shared))).toBeNull();
    // the proof open is listed under its name: its own frames are no other scene
    expect(sceneOfFrames(at(3), CLIP, answer(shared), { own: 'old' })).toMatchObject({ id: 's1' });
  });

  it('takes a scene about the whole video only as the video\'s one scene', () => {
    const whole = draft('w', null, null, { label: 'Which town?' });
    expect(sceneOfFrames(at(3, 50), CLIP, answer([whole]))).toMatchObject({ id: 'w', moments: [], title: 'Which town?', whole: true });
    // a timed scene holding the frames wins over the whole video's
    expect(sceneOfFrames(at(3), CLIP, answer([whole, ...SCENES]))).toMatchObject({ id: 's1', whole: false });
    // frames outside the timed scenes say nothing while there are others
    expect(sceneOfFrames(at(20), CLIP, answer([whole, ...SCENES]))).toBeNull();
    // nor beside another proof of the clip, whichever frames it rests on
    expect(sceneOfFrames(at(3), CLIP, answer([whole, proofRow('elsewhere', { at: [50] })]))).toBeNull();
    expect(sceneOfFrames(at(3), CLIP, answer([whole, proofRow('mine', { at: [3] })]), { own: 'mine' })).toMatchObject({ id: 'w' });
    // given up on, it is no scene to take
    expect(sceneOfFrames(at(3), CLIP, answer([{ ...whole, abandoned: { reason: '' } }]))).toBeNull();
  });

  it('reads a collage of the clip by every piece, as Inspect lists it under its scenes', () => {
    const collage = { panel: 'pc', src: 'collages/bridge.png', video: CLIP, time: 1 };
    const listed = (times) => answer(SCENES, { collages: [{ collage: 'c1', export: 'collages/bridge.png', times, start: times[0] }] });
    expect(sceneOfFrames([collage], CLIP, listed([1, 4, 6]))).toMatchObject({ id: 's1' });
    // a piece in another scene: the collage spans two
    expect(sceneOfFrames([collage], CLIP, listed([1, 65]))).toBeNull();
    // a collage the reading does not list stands at its first piece, as the server traces it
    expect(sceneOfFrames([collage], CLIP, answer(SCENES))).toMatchObject({ id: 's1' });
  });

  it('reads only the frames of the ★ video', () => {
    const frames = [...at(3), { panel: 'po', src: 'media/o.png', video: OTHER, time: 70 }];
    expect(sceneOfFrames(frames, CLIP, answer(SCENES))).toMatchObject({ id: 's1' });
  });
});
