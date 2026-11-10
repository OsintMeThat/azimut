import { describe, expect, it } from 'vitest';
import {
  draftLine, draftPicture, draftPill, draftState, findDrafts, homeDrafts, postsWords, readyToPost, recentDrafts, shortLink,
} from './postHome.js';

const proof = (name, extra = {}) => ({ name, title: name, png: `proofs/${name}.png`, thumb: null, video: null, ...extra });
const slide = (name, slideAt, extra = {}) => proof(name, { video: 'media/clip.mp4', video_title: 'Convoy', slide: slideAt, slides: 3, order: slideAt - 1, ...extra });

describe('what a draft card says', () => {
  it('names its platform, its kind when it is not a geolocation, and its posts', () => {
    expect(draftLine({ target: 'bluesky', kind: 'geolocation', posts: 3 })).toBe('Bluesky · 3 posts');
    expect(draftLine({ target: 'x', kind: 'free', posts: 1 })).toBe('X · Free post · 1 post');
    // a draft from before the list said these reads as an X geolocation of one post
    expect(draftLine({})).toBe('X · 1 post');
    expect(postsWords(0)).toBe('1 post');
  });

  it('shows its proof\'s thumbnail while the case lists that proof', () => {
    const proofs = [proof('a', { thumb: 'proofs/.thumbs/a.webp' }), proof('b')];
    expect(draftPicture({ proof: 'proofs/a.png' }, proofs)).toBe('proofs/.thumbs/a.webp');
    expect(draftPicture({ proof: 'proofs/b.png' }, proofs)).toBe('proofs/b.png');
    expect(draftPicture({ proof: 'proofs/gone.png' }, proofs)).toBeNull();
    expect(draftPicture({}, proofs)).toBeNull();
  });

  it('shows the first file a post carries when it has no proof, from the media list', () => {
    const media = new Map([
      ['media/a.png', { kind: 'image', thumbnail: 'media/.thumbs/a.webp' }],
      ['media/b.png', { kind: 'image', thumbnail: null }],
      ['media/c.mp4', { kind: 'video', thumbnail: null }],
    ]);
    expect(draftPicture({ picture: 'media/a.png' }, [], media)).toBe('media/.thumbs/a.webp');
    expect(draftPicture({ picture: 'media/b.png' }, [], media)).toBe('media/b.png');
    // a video with no thumbnail yet, and a file the case no longer lists, show the kind's icon
    expect(draftPicture({ picture: 'media/c.mp4' }, [], media)).toBeNull();
    expect(draftPicture({ picture: 'media/gone.png' }, [], media)).toBeNull();
    // the proof's thumbnail, named by `picture` as by `proof`
    expect(draftPicture({ picture: 'proofs/a.png' }, [proof('a', { thumb: 'proofs/.thumbs/a.webp' })], media)).toBe('proofs/.thumbs/a.webp');
  });

  it('lists the last ones, and finds one by any word of its name', () => {
    const drafts = Array.from({ length: 8 }, (_, i) => ({ name: `d${i}`, title: `Draft ${i}` }));
    expect(recentDrafts(drafts)).toHaveLength(6);
    expect(findDrafts([{ name: 'a', title: 'Convoy east' }, { name: 'b', title: 'Depot' }], 'east conv').map((d) => d.name)).toEqual(['a']);
    expect(findDrafts(drafts, '  ')).toEqual([]);
  });
});

describe('readyToPost — what has no post yet', () => {
  it('leaves out a proof a draft names, and one with no picture saved', () => {
    const ready = readyToPost([proof('a'), proof('b'), proof('c', { png: null })], [{ proof: 'proofs/a.png' }]);
    expect(ready.photos.map((row) => row.name)).toEqual(['b']);
  });

  it('groups a video\'s slides under it in slide order, the posted ones out', () => {
    const ready = readyToPost([slide('s3', 3), slide('s1', 1), slide('s2', 2)], [{ proof: 'proofs/s2.png' }]);
    expect(ready.photos).toEqual([]);
    expect(ready.videos).toHaveLength(1);
    expect(ready.videos[0]).toMatchObject({ video: 'media/clip.mp4', title: 'Convoy', count: 3 });
    expect(ready.videos[0].slides.map((row) => row.name)).toEqual(['s1', 's3']);
  });

  it('keeps a video whose slides all have a post only while its thread can still be started', () => {
    const proofs = [slide('s1', 1)];
    const drafts = [{ proof: 'proofs/s1.png' }];
    expect(readyToPost(proofs, drafts, { threads: false }).videos).toEqual([]);
    expect(readyToPost(proofs, drafts, { threads: true }).videos).toHaveLength(1);
    // a video thread naming the video is its post
    const threaded = [...drafts, { kind: 'video', video: 'media/clip.mp4' }];
    expect(readyToPost(proofs, threaded, { threads: true }).videos).toEqual([]);
  });
});

describe('where each post stands', () => {
  const at = (name, state, extra = {}) => ({ name, title: name, state, target: 'x', ...extra });

  it('reads a state the list gives, and a draft for anything else', () => {
    expect(['draft', 'opened', 'posted', 'changed', undefined, 'gone'].map((state) => draftState({ state })))
      .toEqual(['draft', 'opened', 'posted', 'changed', 'draft', 'draft']);
  });

  it('wears a pill, an opened post naming the site it was opened on', () => {
    expect(draftPill(at('a', 'opened', { site: 'bluesky' }))).toEqual({ state: 'opened', label: 'Opened in Bluesky' });
    expect(draftPill(at('a', 'opened'))).toEqual({ state: 'opened', label: 'Opened in X' });
    expect(draftPill(at('a', 'changed')).label).toBe('Changed since posted');
    expect(draftPill({}).label).toBe('Draft');
  });

  it('splits in progress from posted, the latest to go out first', () => {
    const drafts = [
      at('d', 'draft'), at('p1', 'posted', { posted: { at: '2026-11-08T10:00:00Z' } }), at('o', 'opened'),
      at('p2', 'posted', { posted: { at: '2026-11-10T10:00:00Z' } }), at('c', 'changed'),
    ];
    const { progress, posted } = homeDrafts(drafts);
    expect(progress.map((d) => d.name)).toEqual(['d', 'o', 'c']);
    expect(posted.map((d) => d.name)).toEqual(['p2', 'p1']);
    expect(shortLink('https://x.com/a/status/1')).toBe('x.com/a/status/1');
  });
});
