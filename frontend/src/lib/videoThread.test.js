import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTANTS, DEFAULT_ORDER, ORDERS, ORDER_NAMES, scenesText, shortTimecode, timecode, videoSlides, videoThread, videoThreads,
} from './videoThread.js';

/**
 * A video thread as plain data: the slides of one video, the four orders, and the
 * token values Post's templates will fill. Nothing here posts or writes a sentence.
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
      { name: 'depot', title: 'Depot', why: 'abandoned' },
      { name: 'mast', title: 'Mast', why: 'unplaced' },
      { name: 'shed', title: 'Shed', why: 'nopicture' },
    ]);
  });

  it('is empty for no answer', () => {
    expect(videoSlides(null)).toEqual({ video: null, slides: [], left: [] });
  });
});

describe('the token values', () => {
  it('#timecode is every passage of a proof, and nothing for the whole video', () => {
    expect(timecode([{ start: 0, end: 7 }, { start: 65, end: 72 }])).toBe('0:00–0:07 · 1:05–1:12');
    expect(timecode([])).toBe('');
    expect(timecode(undefined)).toBe('');
    // past two passages it still says them all: a post is not a row
    expect(timecode([{ start: 0, end: 7 }, { start: 65, end: 72 }, { start: 3725, end: 3730 }])).toBe(
      '0:00–0:07 · 1:05–1:12 · 1:02:05–1:02:10',
    );
  });

  it('says the first time and counts the rest where room is short', () => {
    expect(shortTimecode([{ start: 0, end: 7 }, { start: 65, end: 72 }, { start: 90, end: null }])).toBe('0:00–0:07 +2');
    expect(shortTimecode([{ start: 0, end: 7 }])).toBe('0:00–0:07');
    expect(shortTimecode([])).toBe('');
    expect(shortTimecode([{ start: 3, end: null }], { instants: 'none' })).toBe('');
  });

  it('prints an instant plainly by default, and not at all when asked', () => {
    expect(DEFAULT_INSTANTS).toBe('plain');
    expect(timecode([{ start: 3.4, end: null }])).toBe('0:03');
    expect(timecode([{ start: 3.4, end: null }], { instants: 'none' })).toBe('');
    expect(timecode([{ start: 3.4, end: null }, { start: 65, end: 72 }], { instants: 'none' })).toBe('1:05–1:12');
  });

  it('#scenes is the places one a line, the title alone without a passage', () => {
    expect(scenesText(posted())).toBe(
      ['0:00–0:07 · 3:05–3:12 Road bridge', '0:03 Square', '1:05–1:12 Market', 'Tower'].join('\n'),
    );
    expect(scenesText(posted(), { instants: 'none' }).split('\n')[1]).toBe('Square');
  });
});

describe('the four orders', () => {
  const thread = (order, extra = {}) => videoThread({ video: VIDEO, slides: posted(), order, ...extra });

  it('are named, Recap first the default', () => {
    expect(ORDERS).toEqual(['recap', 'video', 'proof', 'all']);
    expect(DEFAULT_ORDER).toBe('recap');
    expect(Object.keys(ORDER_NAMES)).toEqual(ORDERS);
    expect(() => thread('random')).toThrow();
  });

  it('Recap first: the video with #scenes, the sheet after it, then one post per place', () => {
    const pieces = thread('recap');
    expect(pieces.map((p) => p.role)).toEqual(['recap', 'sheet', 'proof', 'proof', 'proof', 'proof']);
    expect(pieces[0]).toEqual({
      role: 'recap',
      tokens: { '#video': 'Convoy', '#scenes': scenesText(posted()) },
      media: [{ kind: 'video', path: VIDEO.path }],
    });
    // neither platform puts a video and a picture in one post
    expect(pieces[1].media).toEqual([{ kind: 'sheet' }]);
    expect(pieces[2]).toEqual({
      role: 'proof',
      proof: { name: 'bridge', id: 'e_b', title: 'Road bridge' },
      tokens: { '#video': 'Convoy', '#timecode': '0:00–0:07 · 3:05–3:12' },
      media: [{ kind: 'picture', path: 'proofs/bridge.png', proof: 'bridge' }],
    });
    // a proof about the whole video has no timecode
    expect(pieces[5].tokens['#timecode']).toBe('');
    expect(videoThread({ video: VIDEO, slides: posted(), platform: 'bluesky' })).toEqual(pieces);
  });

  it('posts the clip in place of the whole video when one is given', () => {
    const clip = 'media/Convoy 0m00s–0m07s.mp4';
    expect(thread('recap', { clip })[0].media).toEqual([{ kind: 'video', path: clip }]);
    expect(thread('video', { clip })[0].media).toEqual([{ kind: 'video', path: clip }]);
  });

  it('Video first: the video, then one post per proof', () => {
    const pieces = thread('video');
    expect(pieces.map((p) => p.role)).toEqual(['video', 'proof', 'proof', 'proof', 'proof']);
    expect(pieces[0]).toEqual({ role: 'video', tokens: { '#video': 'Convoy' }, media: [{ kind: 'video', path: VIDEO.path }] });
    expect(pieces.slice(1).map((p) => p.proof.name)).toEqual(['bridge', 'square', 'market', 'tower']);
  });

  it('Proof first: the first proof, the video after it, then the rest', () => {
    const pieces = thread('proof');
    expect(pieces.map((p) => p.proof?.name ?? p.role)).toEqual(['bridge', 'video', 'square', 'market', 'tower']);
  });

  it('All in one: one post, four pictures at most, and every place in #scenes', () => {
    const six = [...posted(), { name: 'gate', title: 'Gate', moments: [{ start: 200, end: 204 }], png: 'proofs/gate.png' },
      { name: 'pier', title: 'Pier', moments: [], png: 'proofs/pier.png' }];
    const [piece, ...rest] = videoThread({ video: VIDEO, slides: six, order: 'all' });
    expect(rest).toEqual([]);
    expect(piece.role).toBe('all');
    expect(piece.media.map((m) => m.proof)).toEqual(['bridge', 'square', 'market', 'tower']);
    expect(piece.tokens['#scenes'].split('\n')).toHaveLength(6);
    expect(piece.unpictured.map((p) => p.name)).toEqual(['gate', 'pier']);
  });

  it('keeps the order the caller hands, so a composer can reorder the places', () => {
    const swapped = [posted()[2], posted()[0]];
    const pieces = videoThread({ video: VIDEO, slides: swapped, order: 'video' });
    expect(pieces.slice(1).map((p) => p.proof.name)).toEqual(['market', 'bridge']);
  });

  it('of a video with no slide is the video alone', () => {
    for (const order of ['recap', 'video', 'proof']) {
      expect(videoThread({ video: VIDEO, slides: [], order }).map((p) => p.media)).toEqual([[{ kind: 'video', path: VIDEO.path }]]);
    }
  });

  it('builds all four at once, as plain data a draft can keep', () => {
    const all = videoThreads({ video: VIDEO, slides: posted() });
    expect(Object.keys(all)).toEqual(ORDERS);
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
    expect(all.recap).toEqual(thread('recap'));
  });
});
