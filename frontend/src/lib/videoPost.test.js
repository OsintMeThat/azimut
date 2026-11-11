import { describe, expect, it } from 'vitest';
import { VIDEO_THREAD_STARTERS } from './post.js';
import {
  MAX_THREAD_POSTS, layoutPosts, placeCoords, placeFields, threadPostLabel, videoLayout, videoLink, videoPosts,
} from './videoPost.js';
import { videoSlides } from './videoThread.js';

/**
 * A video thread written: each piece a post, from its template's text for that kind of
 * post, with the case files it carries. The three places stand for the three times a
 * proof can state: a passage, an instant, and the whole video.
 */

const VIDEO = { path: 'media/convoy.mp4', title: 'Convoy on the coast road' };
const SOURCE = 'https://x.com/example/status/1';
const row = (proof, title, moments, extra = {}) => ({
  kind: 'proof', proof, proof_id: `e_${proof}`, title, moments, at: [], png: `proofs/${proof}.png`, state: 'proved',
  points: [], description: null, when: null, when_zone: null, ...extra,
});
const ANSWER = {
  video: VIDEO.path,
  scenes: [
    row('bridge', 'Road bridge', [{ start: 0, end: 7 }], {
      description: 'The convoy crosses the road bridge south of the port',
      points: [{ lat: 48.85, lon: 2.35, coords: '48.85, 2.35', label: '' }, { lat: 48.851, lon: 2.352, coords: '48.851000, 2.352000', label: 'Camera' }],
    }),
    row('gate', 'Port gate', [{ start: 15, end: null }], { points: [{ lat: 48.86, lon: 2.36, coords: '48.860000, 2.360000', label: '' }] }),
    row('village', 'Hilltop village', [], { at: [40], points: [{ lat: 48.87, lon: 2.37, coords: '48.870000, 2.370000', label: '' }] }),
  ],
};
const slides = () => videoSlides(ANSWER).slides;
const common = { mention: '@GeoConfirmed', source: SOURCE };
const starter = (order) => VIDEO_THREAD_STARTERS.find((one) => one.order === order);
const thread = (order, extra = {}) => videoPosts({
  video: VIDEO, slides: slides(), layout: videoLayout(starter(order)), common, sheet: 'media/convoy contact sheet.jpg', ...extra,
});

const RECAP = [
  'Convoy on the coast road',
  '',
  '1. [0:00–0:07] Road bridge',
  '2. [0:15] Port gate',
  '3. Hilltop village',
  '',
  '@GeoConfirmed',
].join('\n');
const PLACES = [
  'The convoy crosses the road bridge south of the port\n[0:00–0:07]\n\n48.850000, 2.350000\nCamera — 48.851000, 2.352000',
  'Port gate\n[0:15]\n\n48.860000, 2.360000',
  'Hilltop village\n\n48.870000, 2.370000',
];

describe('the layout', () => {
  it('reads a template, the default start filling what it leaves out', () => {
    expect(videoLayout()).toEqual({
      order: 'recap', recap: starter('recap').body, video: 'Source: #source', place: '#description\n#timecode\n\n#coordinates',
    });
    expect(videoLayout({ order: 'proof', body: '#scenes', posts: [{ role: 'place', body: '#timecode' }] })).toMatchObject({
      order: 'proof', recap: '#scenes', video: 'Source: #source', place: '#timecode',
    });
    expect(videoLayout({ order: 'sideways', body: '  ' })).toMatchObject({ order: 'recap', recap: starter('recap').body });
  });

  it('keeps its texts as a template does', () => {
    expect(layoutPosts(videoLayout(starter('video')))).toEqual(starter('video').posts.map((one) => ({ ...one })));
  });
});

describe('the four orders, written', () => {
  it('Recap first: the places on the sheet, the video with its link, then a post per place', () => {
    const { posts, cut } = thread('recap');
    expect(cut).toBe(0);
    expect(posts.map((p) => [p.key, p.mediaType, p.mediaPaths])).toEqual([
      ['recap', 'images', ['media/convoy contact sheet.jpg']],
      ['video', 'video', [VIDEO.path]],
      ['place:bridge', 'images', ['proofs/bridge.png']],
      ['place:gate', 'images', ['proofs/gate.png']],
      ['place:village', 'images', ['proofs/village.png']],
    ]);
    expect(posts.map((p) => p.text)).toEqual([RECAP, `Source: ${SOURCE}`, ...PLACES]);
  });

  it('Video first: the video with the mention, then a post per place', () => {
    const { posts } = thread('video');
    expect(posts.map((p) => p.key)).toEqual(['video', 'place:bridge', 'place:gate', 'place:village']);
    expect(posts[0].text).toBe(`Convoy on the coast road\n\n@GeoConfirmed\n\nSource: ${SOURCE}`);
    expect(posts.slice(1).map((p) => p.text)).toEqual(PLACES);
  });

  it('Proof first: the first place, then the video naming every place, then the others', () => {
    const { posts } = thread('proof');
    expect(posts.map((p) => p.key)).toEqual(['place:bridge', 'video', 'place:gate', 'place:village']);
    expect(posts[1].text).toBe(`Convoy on the coast road\n\n${RECAP.split('\n').slice(2, 5).join('\n')}\n\n@GeoConfirmed\n\nSource: ${SOURCE}`);
  });

  it('All in one: one post, its pictures, every place named', () => {
    const { posts } = thread('all');
    expect(posts).toHaveLength(1);
    expect(posts[0].mediaPaths).toEqual(['proofs/bridge.png', 'proofs/gate.png', 'proofs/village.png']);
    expect(posts[0].text).toBe(`${RECAP}\n\nSource: ${SOURCE}`);
  });

  it('keeps the same words for a place whatever the order', () => {
    const text = (order, key) => thread(order).posts.find((p) => p.key === key).text;
    for (const order of ['recap', 'video', 'proof']) expect(text(order, 'place:gate')).toBe(PLACES[1]);
  });
});

describe('the video', () => {
  it('goes as the clip picked in place of the whole video', () => {
    const clip = 'media/Convoy 0m00s–0m07s.mp4';
    const video = thread('recap', { clip }).posts.find((p) => p.key === 'video');
    expect([video.mediaType, video.mediaPaths]).toEqual(['video', [clip]]);
  });

  it('goes as its link with no file, the link said even when its text leaves the source out', () => {
    const video = thread('recap', { link: true }).posts.find((p) => p.key === 'video');
    expect([video.mediaType, video.mediaPaths, video.text]).toEqual(['none', [], `Source: ${SOURCE}`]);
    const bare = videoPosts({ video: VIDEO, slides: slides(), layout: { ...videoLayout(), video: '#video' }, common, link: true });
    expect(bare.posts[1].text).toBe(`Convoy on the coast road\n\n${SOURCE}`);
    expect(videoLink({ source: { type: 'download', url: 'https://t.me/x/1', webpage_url: SOURCE } })).toBe(SOURCE);
    expect(videoLink({ source: { type: 'upload', url: ' https://example.org/a ' } })).toBe('https://example.org/a');
    expect(videoLink({ source: { type: 'upload' } })).toBe('');
    expect(videoLink(null)).toBe('');
  });

  it('waits for the sheet: the recap carries nothing until it is filed', () => {
    const [recap] = thread('recap', { sheet: null }).posts;
    expect([recap.mediaType, recap.mediaPaths]).toEqual(['none', []]);
  });
});

describe('a place', () => {
  it('fills its address once read, and its date in the clock it was stated in', () => {
    const [bridge] = slides();
    const fields = placeFields(
      { ...bridge, row: { ...bridge.row, when: '2025-10-24T14:30:00', when_zone: 'Europe/Kyiv' } },
      common,
      { place: 'Odesa, Ukraine', plusCode: '8GV8XXXX+XX' },
    );
    expect(fields).toMatchObject({ place: 'Odesa, Ukraine', plusCode: '8GV8XXXX+XX', date: '2025-10-24 14:30 UTC+3', lat: 48.85, lon: 2.35 });
    const layout = { ...videoLayout(), place: '#place - #pluscode\n#date' };
    const { posts } = videoPosts({ video: VIDEO, slides: slides(), layout, common, facts: { bridge: { place: 'Odesa', plusCode: '8GV8' } } });
    expect(posts.find((p) => p.key === 'place:bridge').text).toBe('Odesa - 8GV8');
  });

  it('says its title when it has no sentence, unless the title is the number it was given', () => {
    const named = placeFields({ title: 'Port gate', row: {} });
    const numbered = placeFields({ title: 'Proof 4', row: {} });
    expect([named.description, numbered.description]).toEqual(['Port gate', '']);
  });

  it('carries every point, named, one a line', () => {
    expect(placeCoords([{ coords: '1, 2', label: '' }, { coords: ' 3, 4 ', label: 'Camera' }, { coords: '' }, null])).toBe('1, 2\nCamera — 3, 4');
  });
});

describe('a long thread', () => {
  it('holds 21 posts, and counts the places it leaves out', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `p${i}`, title: `Place ${i}`, moments: [], png: `proofs/p${i}.png`, row: {} }));
    const { posts, cut } = videoPosts({ video: VIDEO, slides: many, layout: videoLayout(), common });
    expect(posts).toHaveLength(MAX_THREAD_POSTS);
    expect(cut).toBe(25 + 2 - MAX_THREAD_POSTS);
  });

  it('ends on the template\'s boilerplate posts, within the same count', () => {
    const { posts } = thread('video', { extra: [{ text: 'Follow for more' }, { text: '  ' }] });
    expect(posts.at(-1)).toEqual({ key: 'extra:0', role: 'extra', proof: null, text: 'Follow for more', mediaType: 'none', mediaPaths: [] });
  });
});

describe('what a post is called', () => {
  it('names a place by its title, and the video by what it carries', () => {
    const titles = new Map([['gate', 'Port gate']]);
    expect(threadPostLabel({ role: 'place', proof: 'gate' }, titles)).toBe('Port gate');
    expect(threadPostLabel({ role: 'recap' })).toBe('Recap');
    expect(threadPostLabel({ role: 'video', mediaType: 'video' })).toBe('Video');
    expect(threadPostLabel({ role: 'video', mediaType: 'none' })).toBe('Video link');
    expect(threadPostLabel({ role: 'all' })).toBe('All in one');
    expect(threadPostLabel({})).toBe('Context');
  });
});
