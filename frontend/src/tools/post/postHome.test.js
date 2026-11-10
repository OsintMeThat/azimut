import { describe, expect, it } from 'vitest';
import { draftLine, draftPicture, findDrafts, postsWords, readyToPost, recentDrafts } from './postHome.js';

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
