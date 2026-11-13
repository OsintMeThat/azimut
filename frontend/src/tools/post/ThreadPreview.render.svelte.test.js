// @vitest-environment happy-dom
/**
 * The thread's preview, actually mounted: Write or Preview over the thread's column, and
 * the thread as it goes out, post by post, on X or on Bluesky. Each post with its words
 * as the site shows them, its count against the limit and what runs past it marked, its
 * pictures framed as the site frames one to four, an ALT mark on a picture that has its
 * text, a video's poster, a line to the next post, and the recap map still to make.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ThreadPreview from './ThreadPreview.svelte';
import { prefs } from '../../lib/state.svelte.js';
import { myLogoUrl } from '../../lib/myLogo.js';

const SOURCE = 'https://www.instagram.com/reel/C8kXyZaBcDe/?igsh=MWZ1dGx0a2Y0';
const FIRST = [
  'Al Jawf, Yemen - 7H872G9H+FC', '', 'A formation of 13 helicopters heading East', '', '16.018740, 45.528599', '',
  '@GeoConfirmed', '', `Source: ${SOURCE}`,
].join('\n');
const MEDIA = new Map([
  ['media/yard.jpg', { path: 'media/yard.jpg', kind: 'image', thumbnail: 'media/.thumbs/yard.jpg' }],
  ['media/channel.jpg', { path: 'media/channel.jpg', kind: 'image', thumbnail: 'media/.thumbs/channel.jpg' }],
  ['media/terminal.jpg', { path: 'media/terminal.jpg', kind: 'image', thumbnail: null }],
  ['media/port.jpg', { path: 'media/port.jpg', kind: 'image', thumbnail: 'media/.thumbs/port.jpg' }],
  ['media/convoy.mp4', { path: 'media/convoy.mp4', kind: 'video', thumbnail: 'media/.thumbs/convoy.jpg' }],
  ['media/new.mp4', { path: 'media/new.mp4', kind: 'video', thumbnail: null }],
]);
const PROOFS = [{ name: 'bridge', png: 'proofs/bridge.png', thumb: 'media/.thumbs/bridge.jpg' }];
const PICTURES = ['media/yard.jpg', 'media/channel.jpg', 'media/terminal.jpg', 'media/port.jpg'];
const THREAD = [
  { text: FIRST, files: ['proofs/bridge.png'], alt: { 'proofs/bridge.png': 'Thirteen helicopters over a desert road' } },
  { text: '2/ Image:\nThe yard and the channel', files: PICTURES.slice(0, 3) },
  { text: 'Method: the pylons and the deck line. #Yemen', files: [] },
];

let target;
let app;
let props;

function show(given = {}) {
  target = document.createElement('div');
  document.body.append(target);
  const held = $state({ open: true, posts: THREAD, target: 'x', caseId: 'case-1', media: MEDIA, proofs: PROOFS, recap: null, reply: null, dropped: 0, ...given });
  props = held;
  app = mount(ThreadPreview, {
    target,
    props: {
      get open() { return props.open; },
      set open(value) { props.open = value; },
      get posts() { return props.posts; },
      get target() { return props.target; },
      get caseId() { return props.caseId; },
      get media() { return props.media; },
      get proofs() { return props.proofs; },
      get recap() { return props.recap; },
      get reply() { return props.reply; },
      get dropped() { return props.dropped; },
    },
  });
  flushSync();
}

const posts = () => [...target.querySelectorAll('[data-testid="preview-post"]')];
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((one) => one.textContent.trim() === name);
const textOf = (post) => post.querySelector('.tp-text').textContent;
const media = (post) => post.querySelector('[data-testid="preview-media"]');
/** The frame's shape, width over height, as its style says it. */
const frame = (node) => Number(/aspect-ratio:\s*([\d.]+)/.exec(node.getAttribute('style') ?? '')?.[1]);
const set = (patch) => {
  Object.assign(props, patch);
  flushSync();
};

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  prefs.signatureHandle = '';
  prefs.logoSet = false;
});

describe('Write or Preview', () => {
  it('opens on Write with nothing of the preview mounted, and a press shows the thread', () => {
    show({ open: false });
    expect(tab('Write').getAttribute('aria-selected')).toBe('true');
    expect(target.querySelector('[data-testid="thread-preview"]')).toBeNull();
    tab('Preview').click();
    flushSync();
    expect(props.open).toBe(true);
    expect(tab('Preview').getAttribute('aria-selected')).toBe('true');
    expect(posts()).toHaveLength(3);
    expect(target.querySelector('[data-testid="thread-preview-sum"]').textContent.trim()).toBe('3 posts');
  });

  it('moves between the two with the arrows, as the app’s other tab bars do', () => {
    show({ open: false });
    const bar = target.querySelector('[role="tablist"]');
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    expect(props.open).toBe(true);
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    flushSync();
    expect(props.open).toBe(false);
  });

  it('says there is nothing yet when no post has words or a picture', () => {
    show({ posts: [] });
    expect(target.querySelector('.tp-empty h3').textContent).toBe('Nothing to post yet');
    expect(target.querySelector('[data-testid="thread-preview-sum"]')).toBeNull();
  });
});

describe('the posts, on X', () => {
  it('reads each post as it goes out, joined to the next by a line', () => {
    show();
    const [first, second, third] = posts();
    expect(textOf(first)).toBe(FIRST.replace(SOURCE, 'instagram.com/reel/C8kXyZ…'));
    expect([...first.querySelectorAll('.tp-link')].map((one) => one.textContent)).toEqual(['@GeoConfirmed', 'instagram.com/reel/C8kXyZ…']);
    expect(first.querySelector('.tp-link[title]').getAttribute('title')).toBe(SOURCE);
    expect(posts().map((post) => post.classList.contains('linked'))).toEqual([true, true, false]);
    expect(posts().map((post) => post.querySelector('.tp-count').textContent)).toEqual(['142/280', '34/280', '44/280']);
    expect(third.querySelector('.tp-link').textContent).toBe('#Yemen');
    expect(second.querySelector('.tp-name').textContent).toBe('You');
  });

  it('frames the proof on its thumbnail, with an ALT mark that says its text', () => {
    show();
    const proof = media(posts()[0]);
    expect(proof.classList.contains('solo')).toBe(true);
    const img = proof.querySelector('img');
    expect(img.getAttribute('src')).toBe('/files/case-1/media/.thumbs/bridge.jpg');
    expect([img.getAttribute('loading'), img.getAttribute('decoding')]).toEqual(['lazy', 'async']);
    expect(img.getAttribute('alt')).toBe('Thirteen helicopters over a desert road');
    expect(proof.querySelector('.tp-alt').getAttribute('title')).toBe('Thirteen helicopters over a desert road');
    // a picture with no text has no mark
    expect(media(posts()[1]).querySelectorAll('.tp-alt')).toHaveLength(0);
  });

  it('lays one to four pictures out as X does, in a 16:9 block past one', () => {
    for (const count of [1, 2, 3, 4]) {
      show({ posts: [{ text: '', files: PICTURES.slice(0, count) }] });
      const block = media(posts()[0]);
      expect(block.classList.contains(`n${count}`)).toBe(true);
      expect(block.querySelectorAll('.tp-pic')).toHaveLength(count);
      // one picture takes its own shape, 16:9 until its thumbnail says it
      expect(frame(block)).toBeCloseTo(16 / 9, 5);
      expect(block.classList.contains('solo')).toBe(count === 1);
      unmount(app);
      target.remove();
      app = null;
    }
  });

  it('shows the picture itself when the case keeps no thumbnail, and a video on its poster or on none', () => {
    show({ posts: [{ text: 'a', files: ['media/terminal.jpg'] }, { text: 'b', files: ['media/convoy.mp4'] }, { text: 'c', files: ['media/new.mp4'] }] });
    const [picture, video, fresh] = posts().map(media);
    expect(picture.querySelector('img').getAttribute('src')).toBe('/files/case-1/media/terminal.jpg');
    expect(video.querySelector('.tp-pic.video img').getAttribute('src')).toBe('/files/case-1/media/.thumbs/convoy.jpg');
    expect(video.querySelector('.tp-play')).not.toBeNull();
    // never the video's own bytes
    expect(fresh.querySelector('img')).toBeNull();
    expect(fresh.querySelector('.tp-play')).not.toBeNull();
  });

  it('marks what runs past the limit, softly, and counts the posts that do', () => {
    const long = `${'a'.repeat(275)} hello world`;
    show({ posts: [...THREAD, { text: long, files: [] }] });
    const post = posts().at(-1);
    expect(post.querySelector('.tp-count.over').textContent).toBe('287/280');
    expect(post.querySelector('.tp-count').getAttribute('title')).toBe('7 over the limit');
    expect(post.querySelector('mark.tp-over').textContent).toBe('o world');
    expect(textOf(post)).toBe(long);
    expect(target.querySelector('[data-testid="thread-preview-sum"]').textContent.trim()).toBe('4 posts · 1 too long');
    expect(posts().slice(0, 3).every((one) => !one.querySelector('mark'))).toBe(true);
  });

  it('says the source a reply goes under, on the first post only', () => {
    show({ reply: { site: 'x', url: 'https://x.com/someone/status/1' } });
    expect(posts()[0].querySelector('.tp-reply').textContent).toBe('Replying to @someone');
    expect(posts()[1].querySelector('.tp-reply')).toBeNull();
  });

  it('reads as the handle the proofs are signed with', () => {
    prefs.signatureHandle = '@desk';
    show();
    expect(posts()[0].querySelector('.tp-name').textContent).toBe('@desk');
    expect(posts()[0].querySelector('.tp-avatar').textContent).toBe('D');
    expect(posts()[0].querySelector('.tp-avatar img')).toBeNull();
  });

  it('wears the logo of Settings in its circle, whole and as wide as the circle lets it, the handle beside it', () => {
    prefs.signatureHandle = '@desk';
    prefs.logoSet = true;
    show();
    const avatar = posts()[0].querySelector('.tp-avatar');
    const logo = avatar.querySelector('img');
    expect(avatar.classList).toContain('logo');
    expect(avatar.textContent).toBe('');
    expect(posts()[0].querySelector('.tp-name').textContent).toBe('@desk');
    // where every tool reads it, so the copy the browser holds serves each post
    expect(logo.getAttribute('src')).toBe(myLogoUrl());
    expect(new Set(posts().map((post) => post.querySelector('.tp-avatar img').getAttribute('src')))).toEqual(new Set([myLogoUrl()]));
    // a wide logo takes its own shape, its corners inside the circle
    Object.defineProperty(logo, 'naturalWidth', { value: 400, configurable: true });
    Object.defineProperty(logo, 'naturalHeight', { value: 100, configurable: true });
    logo.dispatchEvent(new Event('load'));
    flushSync();
    const [width, height] = [parseFloat(logo.style.width), parseFloat(logo.style.height)];
    expect(width / height).toBeCloseTo(4, 6);
    expect(Math.hypot(width, height)).toBeLessThanOrEqual(36);
    expect(width).toBeGreaterThan(30);
  });

  it('keeps the initial when the logo does not load', () => {
    prefs.signatureHandle = '@desk';
    prefs.logoSet = true;
    show();
    posts()[0].querySelector('.tp-avatar img').dispatchEvent(new Event('error'));
    flushSync();
    expect(posts().map((post) => post.querySelector('.tp-avatar').textContent)).toEqual(['D', 'D', 'D']);
    expect(target.querySelector('.tp-avatar img')).toBeNull();
  });
});

describe('the same posts, on Bluesky', () => {
  it('switches the limit, the links and the mentions with the platform', () => {
    show();
    set({ target: 'bluesky' });
    const [first] = posts();
    expect(first.querySelector('.tp-count').textContent).toBe('152/300');
    expect(textOf(first)).toBe(FIRST.replace(SOURCE, 'www.instagram.com/reel/C8kXyZa...'));
    // a handle with no domain is words on Bluesky
    expect([...first.querySelectorAll('.tp-link')].map((one) => one.textContent)).toEqual(['www.instagram.com/reel/C8kXyZa...']);
    expect(target.querySelector('.tp-thread').classList.contains('sky')).toBe(true);
  });

  it('lays two or three pictures in a 2:1 block, four in a 3:2 one', () => {
    for (const [count, shape] of [[2, 2], [3, 2], [4, 1.5]]) {
      show({ target: 'bluesky', posts: [{ text: '', files: PICTURES.slice(0, count) }] });
      expect(frame(media(posts()[0]))).toBeCloseTo(shape, 5);
      unmount(app);
      target.remove();
      app = null;
    }
  });
});

describe('a recap map still to make', () => {
  it('shows the column’s small preview on the first post, and says when it is made', () => {
    show({ posts: [{ text: '1. [0:15] - 16.018740, 45.528599', files: [] }], recap: 'blob:recap-preview' });
    const later = media(posts()[0]).querySelector('.tp-pic.later');
    expect(later.querySelector('img').getAttribute('src')).toBe('blob:recap-preview');
    expect(posts()[0].querySelector('.tp-later').textContent).toBe('The map is made when you publish.');
  });

  it('holds its place on a plain ground while the preview is drawn', () => {
    show({ posts: [{ text: 'Recap', files: [] }], recap: '' });
    const later = media(posts()[0]).querySelector('.tp-pic.later');
    expect(later.querySelector('img')).toBeNull();
    expect(later.querySelector('.tp-ground')).not.toBeNull();
  });
});

describe('files past four', () => {
  it('says how many stay behind', () => {
    show({ dropped: 2 });
    expect(target.querySelector('.tp-note').textContent).toBe('2 files stay behind: a post takes four.');
  });
});
