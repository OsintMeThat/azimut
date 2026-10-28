// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MediaViewer from './MediaViewer.svelte';

/** A case file on the whole screen, walked with the arrows. */

const ITEMS = [
  { key: 'a', path: 'media/harbor.jpg', kind: 'image', name: 'harbor.jpg' },
  { key: 'b', path: 'media/departure.mp4', kind: 'video', name: 'departure.mp4', poster: '.thumbs/departure.jpg' },
  { key: 'c', path: 'media/radio.mp3', kind: 'audio', name: 'radio.mp3' },
];

let live = null;
let target = null;
let moved = [];
let closed = 0;

function show(props) {
  moved = [];
  closed = 0;
  target = document.createElement('div');
  document.body.append(target);
  live = mount(MediaViewer, {
    target,
    props: {
      caseId: 'case-a',
      items: ITEMS,
      onmove: (key) => moved.push(key),
      onclose: () => (closed += 1),
      ...props,
    },
  });
  flushSync();
}

const viewer = () => document.querySelector('.viewer');
const press = (key, init = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }));

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.querySelectorAll('.viewer').forEach((node) => node.remove());
});

describe('the viewer', () => {
  it('shows nothing until a file is asked for', () => {
    show({ current: null });
    expect(viewer()).toBeNull();
  });

  it('draws a picture full screen, with its place in the list', () => {
    show({ current: 'a' });
    expect(viewer().querySelector('img').getAttribute('src')).toContain('media/harbor.jpg');
    expect(viewer().querySelector('.caption').textContent).toContain('harbor.jpg · 1/3');
  });

  it('plays a video with its controls, the list’s picture as the first frame', () => {
    show({ current: 'b' });
    const video = viewer().querySelector('video');
    expect(video.getAttribute('src')).toContain('media/departure.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(true);
    expect(video.getAttribute('poster')).toContain('.thumbs/departure.jpg');
  });

  it('plays a sound', () => {
    show({ current: 'c' });
    expect(viewer().querySelector('audio').getAttribute('src')).toContain('media/radio.mp3');
  });

  it('walks the list with the arrows, round from either end', () => {
    show({ current: 'a' });
    press('ArrowRight');
    press('ArrowLeft');
    expect(moved).toEqual(['b', 'c']);
  });

  it('walks it with the buttons too', () => {
    show({ current: 'b' });
    viewer().querySelector('.nav.next').click();
    viewer().querySelector('.nav.prev').click();
    expect(moved).toEqual(['c', 'a']);
  });

  it('closes on Escape, Space, or a press beside the file', () => {
    show({ current: 'a' });
    press('Escape');
    press(' ');
    viewer().querySelector('img').click();
    viewer().click();
    expect(closed).toBe(3);
  });

  it('is not closed by the Space that opened it', () => {
    show({ current: 'a' });
    const opening = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    opening.preventDefault();
    window.dispatchEvent(opening);
    expect(closed).toBe(0);
  });

  it('leaves the arrows and Space to a pressed video', () => {
    show({ current: 'b' });
    const video = viewer().querySelector('video');
    video.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    video.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(moved).toEqual([]);
    expect(closed).toBe(0);
  });

  it('hides the arrows when there is nothing else to walk to', () => {
    show({ current: 'a', items: [ITEMS[0]] });
    expect(viewer().querySelector('.nav')).toBeNull();
    expect(viewer().querySelector('.caption').textContent.trim()).toBe('harbor.jpg');
  });
});

describe('a file the browser cannot read', () => {
  it('says so instead of drawing a broken picture', () => {
    show({ current: 'a' });
    viewer().querySelector('img').dispatchEvent(new Event('error'));
    flushSync();
    expect(viewer().querySelector('img')).toBeNull();
    expect(viewer().querySelector('.unreadable').textContent).toBe('This browser cannot show this file.');
    expect(viewer().querySelector('.caption').textContent).toContain('harbor.jpg');
  });
});
