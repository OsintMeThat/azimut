import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER, ORDERS, ORDER_NAMES, ORDER_WORDS, PICTURES_PER_POST, placeLabel, scenesText, shortTimecode, timecode, usesSheet,
  videoSlides, videoThread, videoThreads,
} from './videoThread.js';
import { sceneColorAt } from './scenes.js';

/**
 * A video thread as plain data: the slides of one video, the four orders, and the
 * token values Post's templates fill. Nothing here posts or writes a sentence.
 */

const VIDEO = { path: 'media/convoy.mp4', title: 'Convoy' };

// what `GET /scenes?video=` answers, out of order as a server may list it
const ANSWER = {
  video: VIDEO.path,
  scenes: [
    { kind: 'proof', proof: 'market', proof_id: 'e_m', title: 'Market', moments: [{ start: 65, end: 72 }], at: [], png: 'proofs/market.png', state: 'proved' },
    { kind: 'draft', id: 's9', start: 20, end: 25, label: 'Mast?' },
    { kind: 'proof', proof: 'bridge', proof_id: 'e_b', title: 'Road bridge', moments: [{ start: 0, end: 7 }, { start: 185, end: 192 }], at: [], png: 'proofs/bridge.png', state: 'proved' },
    { kind: 'proof', proof: 'tower', proof_id: 'e_t', title: 'Tower', moments: [], at: [130], png: 'proofs/tower.png', state: 'proved' },
    { kind: 'proof', proof: 'square', proof_id: 'e_s', title: 'Square', moments: [{ start: 3.4, end: null }], at: [], png: 'proofs/square.png', state: 'proved' },
    { kind: 'proof', proof: 'depot', title: 'Depot', moments: [{ start: 40, end: 44 }], at: [], png: 'proofs/depot.png', state: 'abandoned', abandoned: { reason: 'blurry' } },
    { kind: 'proof', proof: 'mast', title: 'Mast', moments: [{ start: 50, end: 52 }], at: [], png: 'proofs/mast.png', state: 'progress' },
    { kind: 'proof', proof: 'shed', title: 'Shed', moments: [{ start: 90, end: 95 }], at: [], png: null, state: 'proved' },
  ],
};

const posted = () => videoSlides(ANSWER).slides;

describe('the slides a thread posts', () => {
  it('keeps the proofs of a place with a picture, in the strip\'s clip order', () => {
    const { video, slides } = videoSlides(ANSWER);
    expect(video).toBe(VIDEO.path);
    expect(slides.map((s) => s.name)).toEqual(['bridge', 'square', 'market', 'tower']);
    expect(slides[0]).toMatchObject({ id: 'e_b', title: 'Road bridge', png: 'proofs/bridge.png' });
  });

  it('leaves out a scene still to prove, and names each proof it leaves out with why', () => {
    const { left } = videoSlides(ANSWER);
    expect(left).toEqual([
      { name: 'depot', title: 'Depot', label: 'Depot', why: 'abandoned' },
      { name: 'mast', title: 'Mast', label: 'Mast', why: 'unplaced' },
      { name: 'shed', title: 'Shed', label: 'Shed', why: 'nopicture' },
    ]);
  });

  it('is empty for no answer', () => {
    expect(videoSlides(null)).toEqual({ video: null, slides: [], left: [] });
  });

  it('colours each place as the strip and Inspect\'s bar do, the scenes still to prove counted', () => {
    // clip order: bridge 0:00, square 0:03, the scene to prove 0:20, then the rest
    const { slides } = videoSlides(ANSWER);
    expect(slides.map((one) => one.row.color)).toEqual([sceneColorAt(0), sceneColorAt(1), sceneColorAt(5), sceneColorAt(7)]);
  });

  it('calls a place by its name, else where it stands, else its point, else its time: never Proof 3', () => {
    const row = (extra) => ({ kind: 'proof', proof: 'Proof 3', title: 'Proof 3', moments: [{ start: 15, end: null }], ...extra });
    expect(placeLabel(row({ title: 'Road bridge', place: 'Al Jawf, Yemen' }))).toBe('Road bridge');
    expect(placeLabel(row({ place: 'Al Jawf, Yemen', points: [{ lat: 1, lon: 2 }] }))).toBe('Al Jawf, Yemen');
    expect(placeLabel(row({ place: '', points: [{ lat: 15.47123, lon: 45.32211 }] }))).toBe('15.4712, 45.3221');
    expect(placeLabel(row({ points: [] }))).toBe('0:15');
    const unnamed = { ...ANSWER, scenes: [row({ proof: 'Proof 3', png: 'proofs/p3.png', state: 'proved', place: 'Marib, Yemen', points: [{ lat: 1, lon: 2 }] })] };
    expect(scenesText(videoSlides(unnamed).slides)).toBe('1. [0:15] Marib, Yemen');
  });
});

describe('the time a post prints', () => {
  it('is one formatter: an instant, a passage, several, and nothing for the whole video', () => {
    expect(timecode([{ start: 15.6, end: null }])).toBe('[0:15]');
    expect(timecode([{ start: 0, end: 7 }])).toBe('[0:00–0:07]');
    expect(timecode([{ start: 0, end: 7 }, { start: 65, end: 72 }])).toBe('[0:00–0:07] [1:05–1:12]');
    expect(timecode([])).toBe('');
    expect(timecode(undefined)).toBe('');
    expect(timecode('0:07')).toBe('');
  });

  it('prints instants beside passages, every one of them, in clip order', () => {
    expect(timecode([{ start: 65, end: 72 }, { start: 3.4, end: null }])).toBe('[0:03] [1:05–1:12]');
    // past two moments it still says them all: a post is not a row
    expect(timecode([{ start: 0, end: 7 }, { start: 65, end: 72 }, { start: 3725, end: 3730 }])).toBe(
      '[0:00–0:07] [1:05–1:12] [1:02:05–1:02:10]',
    );
    // what is no time is left out rather than printed as 0:00
    expect(timecode([{ start: null, end: 4 }, { start: 9, end: null }])).toBe('[0:09]');
  });

  it('says the first time and counts the rest where room is short', () => {
    expect(shortTimecode([{ start: 0, end: 7 }, { start: 65, end: 72 }, { start: 90, end: null }])).toBe('[0:00–0:07] +2');
    expect(shortTimecode([{ start: 0, end: 7 }])).toBe('[0:00–0:07]');
    expect(shortTimecode([{ start: 3, end: null }])).toBe('[0:03]');
    expect(shortTimecode([])).toBe('');
  });

  it('#scenes is the places one a line, numbered as the sheet numbers them, the title alone without a time', () => {
    expect(scenesText(posted())).toBe(
      ['1. [0:00–0:07] [3:05–3:12] Road bridge', '2. [0:03] Square', '3. [1:05–1:12] Market', '4. Tower'].join('\n'),
    );
    expect(scenesText([])).toBe('');
  });
});

describe('the four orders', () => {
  const thread = (order, extra = {}) => videoThread({ video: VIDEO, slides: posted(), order, ...extra });
  const footage = [{ kind: 'video', path: VIDEO.path }];

  it('are named and said, Recap first the default', () => {
    expect(ORDERS).toEqual(['recap', 'video', 'proof', 'all']);
    expect(DEFAULT_ORDER).toBe('recap');
    expect(Object.keys(ORDER_NAMES)).toEqual(ORDERS);
    expect(Object.keys(ORDER_WORDS)).toEqual(ORDERS);
    expect(() => thread('random')).toThrow();
  });

  it('Recap first: the places on the sheet, then the video, then one post per place', () => {
    const pieces = thread('recap');
    expect(pieces.map((p) => p.role)).toEqual(['recap', 'video', 'proof', 'proof', 'proof', 'proof']);
    // the sheet and #scenes number the places the same way, so they share the first post
    expect(pieces[0]).toEqual({
      role: 'recap',
      tokens: { '#video': 'Convoy', '#scenes': scenesText(posted()) },
      media: [{ kind: 'sheet' }],
    });
    // neither platform puts a video and a picture in one post: the video has its own
    expect(pieces[1]).toEqual({ role: 'video', tokens: { '#video': 'Convoy', '#scenes': scenesText(posted()) }, media: footage });
    expect(pieces[2]).toEqual({
      role: 'proof',
      proof: { name: 'bridge', id: 'e_b', title: 'Road bridge' },
      tokens: { '#video': 'Convoy', '#timecode': '[0:00–0:07] [3:05–3:12]' },
      media: [{ kind: 'picture', path: 'proofs/bridge.png', proof: 'bridge' }],
    });
    // an instant prints its time; a proof about the whole video prints none
    expect(pieces[3].tokens['#timecode']).toBe('[0:03]');
    expect(pieces[5].tokens['#timecode']).toBe('');
  });

  it('posts the clip in place of the whole video when one is given, and no file when the link goes instead', () => {
    const clip = 'media/Convoy 0m00s–0m07s.mp4';
    expect(thread('recap', { clip })[1].media).toEqual([{ kind: 'video', path: clip }]);
    expect(thread('video', { clip })[0].media).toEqual([{ kind: 'video', path: clip }]);
    expect(thread('video', { link: true })[0].media).toEqual([]);
    expect(thread('recap', { link: true }).map((p) => p.role)).toEqual(['recap', 'video', 'proof', 'proof', 'proof', 'proof']);
  });

  it('Video first: the video, then one post per proof', () => {
    const pieces = thread('video');
    expect(pieces.map((p) => p.role)).toEqual(['video', 'proof', 'proof', 'proof', 'proof']);
    expect(pieces[0].media).toEqual(footage);
    expect(pieces.slice(1).map((p) => p.proof.name)).toEqual(['bridge', 'square', 'market', 'tower']);
  });

  it('Proof first: the first proof, the video after it, then the rest', () => {
    const pieces = thread('proof');
    expect(pieces.map((p) => p.proof?.name ?? p.role)).toEqual(['bridge', 'video', 'square', 'market', 'tower']);
  });

  it('All in one: one post with every picture up to four, and the sheet past four places', () => {
    const [piece, ...rest] = thread('all');
    expect(rest).toEqual([]);
    expect(piece.role).toBe('all');
    expect(piece.media.map((m) => m.proof)).toEqual(['bridge', 'square', 'market', 'tower']);
    const six = [...posted(), { name: 'gate', title: 'Gate', moments: [{ start: 200, end: 204 }], png: 'proofs/gate.png' },
      { name: 'pier', title: 'Pier', moments: [], png: 'proofs/pier.png' }];
    const [wide] = videoThread({ video: VIDEO, slides: six, order: 'all' });
    expect(wide.media).toEqual([{ kind: 'sheet' }]);
    expect(wide.tokens['#scenes'].split('\n')).toHaveLength(6);
  });

  it('says which threads carry the sheet', () => {
    expect(PICTURES_PER_POST).toBe(4);
    expect([usesSheet('recap', 2), usesSheet('recap', 0), usesSheet('video', 9), usesSheet('proof', 9)]).toEqual([true, false, false, false]);
    expect([usesSheet('all', 4), usesSheet('all', 5)]).toEqual([false, true]);
  });

  it('keeps the order the caller hands, so a composer can reorder the places', () => {
    const swapped = [posted()[2], posted()[0]];
    const pieces = videoThread({ video: VIDEO, slides: swapped, order: 'video' });
    expect(pieces.slice(1).map((p) => p.proof.name)).toEqual(['market', 'bridge']);
  });

  it('of a video with no slide is the video alone', () => {
    for (const order of ['recap', 'video', 'proof']) {
      expect(videoThread({ video: VIDEO, slides: [], order }).map((p) => p.media)).toEqual([footage]);
    }
  });

  it('builds all four at once, as plain data a draft can keep', () => {
    const all = videoThreads({ video: VIDEO, slides: posted() });
    expect(Object.keys(all)).toEqual(ORDERS);
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
    expect(all.recap).toEqual(thread('recap'));
  });
});
