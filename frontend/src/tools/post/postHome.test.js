import { describe, expect, it } from 'vitest';
import {
  draftLine, draftPicture, draftPill, draftState, filterPosts, findDrafts, homeDrafts, isPosted, postedOn, postFacets, postsWords,
  readyToPost, recentDrafts, shortLink, threadVideos,
} from './postHome.js';

// An X status id for a known moment, as X makes them.
const snowflake = (iso) => (((BigInt(Date.parse(iso)) - 1288834974657n) << 22n) | 9n).toString();

const proof = (name, extra = {}) => ({ name, title: name, png: `proofs/${name}.png`, thumb: null, video: null, ...extra });
const slide = (name, slideAt, extra = {}) => proof(name, { video: 'media/clip.mp4', video_title: 'Convoy', slide: slideAt, slides: 3, order: slideAt - 1, ...extra });

describe('what a draft card says', () => {
  it('names its platform, its kind when it is not a geolocation, and its posts when there are several', () => {
    expect(draftLine({ target: 'bluesky', kind: 'geolocation', posts: 3 })).toBe('Bluesky · 3 posts');
    expect(draftLine({ target: 'x', kind: 'geolocation', posts: 2 })).toBe('X · 2 posts');
    expect(draftLine({ target: 'bluesky', kind: 'free', posts: 1 })).toBe('Bluesky · Free post');
    expect(draftLine({ target: 'x', kind: 'plate', posts: 4 })).toBe('X · Map plate · 4 posts');
    // a draft from before the list said these reads as an X geolocation of one post
    expect(draftLine({})).toBe('X');
    expect([0, 1, 2, 1.5, '3'].map(postsWords)).toEqual(['', '', '2 posts', '', '']);
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
    const proofs = [slide('s1', 1), slide('s2', 2)];
    const drafts = [{ proof: 'proofs/s1.png' }, { proof: 'proofs/s2.png' }];
    expect(readyToPost(proofs, drafts, { threads: false }).videos).toEqual([]);
    expect(readyToPost(proofs, drafts, { threads: true }).videos).toHaveLength(1);
    // a video thread naming the video is its post
    const threaded = [...drafts, { kind: 'video', video: 'media/clip.mp4' }];
    expect(readyToPost(proofs, threaded, { threads: true }).videos).toEqual([]);
  });

  it('offers a video\'s thread for two proofs to post or more, its slides still one by one', () => {
    const two = readyToPost([slide('s1', 1), slide('s2', 2)], [], { threads: true }).videos[0];
    expect([two.thread, two.postable, two.slides.length]).toEqual([true, 2, 2]);
    // one proof is a geolocation of its own: no thread, and its slide still waits
    const one = readyToPost([slide('s1', 1)], [], { threads: true }).videos[0];
    expect([one.thread, one.slides.length]).toEqual([false, 1]);
    // nothing to offer and nothing waiting: the video is not listed
    expect(readyToPost([slide('s1', 1)], [{ proof: 'proofs/s1.png' }], { threads: true }).videos).toEqual([]);
    // a proof still geolocated or given up on is no post of the thread
    const unplaced = readyToPost([slide('s1', 1), slide('s2', 2, { postable: false })], [], { threads: true }).videos[0];
    expect([unplaced.thread, unplaced.postable, unplaced.count]).toEqual([false, 1, 2]);
    // a thread already in the case is not offered twice; its slides wait on their own
    const held = readyToPost([slide('s1', 1), slide('s2', 2)], [{ kind: 'video', video: 'media/clip.mp4' }], { threads: true }).videos[0];
    expect([held.thread, held.slides.length]).toEqual([false, 2]);
  });
});

describe('threadVideos — what New post → Video thread lists', () => {
  it('lists the videos with two proofs to post or more, with the first slide\'s picture', () => {
    const proofs = [
      slide('s2', 2, { thumb: 'proofs/.thumbs/s2.webp' }), slide('s1', 1, { thumb: 'proofs/.thumbs/s1.webp' }),
      slide('o1', 1, { video: 'media/other.mp4', video_title: 'Other' }),
      slide('u1', 1, { video: 'media/third.mp4', video_title: 'Third' }), slide('u2', 2, { video: 'media/third.mp4', video_title: 'Third', postable: false }),
      proof('photo'),
    ];
    expect(threadVideos(proofs, [])).toEqual([
      { video: 'media/clip.mp4', title: 'Convoy', count: 2, threaded: false, thumb: 'proofs/.thumbs/s1.webp' },
    ]);
    expect(threadVideos(proofs, [{ kind: 'video', video: 'media/clip.mp4' }])[0].threaded).toBe(true);
    expect(threadVideos([], [])).toEqual([]);
  });
});

describe('where each post stands', () => {
  const at = (name, state, extra = {}) => ({ name, title: name, state, target: 'x', ...extra });

  it('reads a state the list gives, and a draft for anything else, an opened one included', () => {
    expect(['draft', 'opened', 'posted', 'changed', undefined, 'gone'].map((state) => draftState({ state })))
      .toEqual(['draft', 'draft', 'posted', 'changed', 'draft', 'draft']);
    expect(['draft', 'posted', 'changed'].map((state) => isPosted({ state }))).toEqual([false, true, true]);
  });

  it('wears one of three pills, and never an Opened one', () => {
    expect(draftPill(at('a', 'opened', { site: 'bluesky' }))).toEqual({ state: 'draft', label: 'Draft' });
    expect(draftPill(at('a', 'posted')).label).toBe('Posted');
    expect(draftPill(at('a', 'changed')).label).toBe('Changed since posted');
    expect(draftPill({}).label).toBe('Draft');
  });

  it('splits in progress from posted, the latest to go out first by the day its link holds', () => {
    const drafts = [
      at('d', 'draft'),
      // marked last, but its link says it went out first
      at('p1', 'posted', { posted: { url: `https://x.com/desk/status/${snowflake('2025-01-05T10:00:00Z')}`, at: '2026-11-10T10:00:00Z' } }),
      at('o', 'opened'),
      at('p2', 'posted', { posted: { url: null, site: 'x', at: '2026-11-08T10:00:00Z' } }),
      at('p3', 'posted', { posted: { url: `https://x.com/desk/status/${snowflake('2026-02-01T10:00:00Z')}`, at: '2026-02-03T10:00:00Z' } }),
      at('c', 'changed'),
    ];
    const { progress, posted } = homeDrafts(drafts);
    expect(progress.map((d) => d.name)).toEqual(['d', 'o', 'c']);
    expect(posted.map((d) => d.name)).toEqual(['p2', 'p3', 'p1']);
    const now = new Date(2026, 10, 11, 12);
    expect(posted.map((d) => postedOn(d, now))).toEqual(['8 Nov', '1 Feb', '5 Jan 2025']);
    expect(shortLink('https://x.com/a/status/1')).toBe('x.com/a/status/1');
  });
});

describe('the Open list', () => {
  const drafts = [
    { name: 'a', title: 'Convoy east', kind: 'geolocation', state: 'posted' },
    { name: 'b', title: 'Depot fire', kind: 'free', state: 'draft' },
    { name: 'c', title: 'Convoy west', state: 'changed' },
    { name: 'd', title: 'Front plate', kind: 'plate', state: 'posted' },
  ];

  it('offers the kinds and the states its posts hold, counted, in their own order', () => {
    expect(postFacets(drafts)).toEqual({
      kinds: [{ id: 'geolocation', label: 'Geolocation', count: 2 }, { id: 'plate', label: 'Map plate', count: 1 }, { id: 'free', label: 'Free post', count: 1 }],
      states: [{ id: 'draft', label: 'Draft', count: 1 }, { id: 'posted', label: 'Posted', count: 2 }, { id: 'changed', label: 'Changed since posted', count: 1 }],
    });
    expect(postFacets([])).toEqual({ kinds: [], states: [] });
  });

  it('narrows by kind, by state and by words, together', () => {
    const names = (filter) => filterPosts(drafts, filter).map((d) => d.name);
    expect(names({})).toEqual(['a', 'b', 'c', 'd']);
    expect(names({ kind: 'geolocation' })).toEqual(['a', 'c']);
    expect(names({ state: 'posted' })).toEqual(['a', 'd']);
    expect(names({ kind: 'geolocation', state: 'posted' })).toEqual(['a']);
    expect(names({ query: 'convoy', state: 'changed' })).toEqual(['c']);
    // an earlier build's opened post is a draft, and filters as one
    expect(filterPosts([{ name: 'o', title: 'Old', state: 'opened' }], { state: 'draft' }).map((d) => d.name)).toEqual(['o']);
  });
});
