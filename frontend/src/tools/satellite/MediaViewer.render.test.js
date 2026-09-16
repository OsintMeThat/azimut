// @vitest-environment happy-dom
/**
 * The player in the Saved panel, actually mounted.
 *
 * What it owes: the file on screen is the one the counter names, the arrows walk
 * the stack in both directions and wrap, the keyboard reaches them without a
 * click, and a focused video keeps its own arrows for seeking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: MediaViewer } = await import('./MediaViewer.svelte');

const live = [];

const photo = {
  id: 'e1',
  key: 'e1@48.1,2.1',
  kind: 'media',
  media_kind: 'image',
  title: 'quay',
  path: 'media/quay.png',
  lat: 48.1,
  lon: 2.1,
  status: 'confirmed',
  roads: [{ type: 'located-at', status: 'confirmed' }],
  linked_proofs: [],
};
const clip = {
  ...photo,
  id: 'e2',
  key: 'e2@48.1,2.1',
  media_kind: 'video',
  title: 'rooftop',
  path: 'media/rooftop.mp4',
  status: 'suggested',
  roads: [{ type: 'proof', id: 'p1', title: 'Roofline', status: 'confirmed' }],
  linked_proofs: [{ id: 'p1', name: 'Roofline', title: 'Roofline' }],
};

function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(MediaViewer, {
    target,
    props: {
      items: [photo, clip],
      index: 0,
      caseId: 'case-1',
      coords: (row) => `${row.lat}, ${row.lon}`,
      onclose: vi.fn(),
      onmedia: vi.fn(),
      onproof: vi.fn(),
      ...props,
    },
  });
  live.push(app);
  flushSync();
  return app;
}

const text = () => document.body.textContent.replace(/\s+/g, ' ');
const button = (label) =>
  [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);

afterEach(() => {
  while (live.length) unmount(live.pop());
  document.body.innerHTML = '';
});

describe('the file on screen', () => {
  it('plays a photo as an image and footage as a player', () => {
    open();
    expect(document.querySelector('img').getAttribute('src')).toContain('media/quay.png');
    expect(document.querySelector('video')).toBeNull();

    button('Next').click();
    flushSync();
    expect(document.querySelector('video').getAttribute('src')).toContain('media/rooftop.mp4');
    expect(document.querySelector('video').hasAttribute('controls')).toBe(true);
  });

  it('says why it stands here, and marks what only a tool has claimed', () => {
    open({ index: 0 });
    expect(text()).toContain('Recorded here');
    expect(text()).not.toContain('suggested');

    button('Next').click();
    flushSync();
    expect(text()).toContain('Via Roofline');
    expect(text()).toContain('suggested');
  });

  it('offers the file in Media, and the proofs built on it', () => {
    const onmedia = vi.fn();
    const onproof = vi.fn();
    open({ index: 1, onmedia, onproof });
    const acts = [...document.querySelectorAll('.acts button')];
    expect(acts.map((b) => b.textContent.trim())).toEqual(['Open in Media', 'Roofline']);
    acts[0].click();
    expect(onmedia).toHaveBeenCalledWith(clip);
    acts[1].click();
    expect(onproof).toHaveBeenCalledWith(clip.linked_proofs[0]);
  });

  it('leaves a lone file no arrows to press', () => {
    open({ items: [photo] });
    expect(button('Next')).toBeUndefined();
    expect(text()).not.toContain('1 / 1');
  });
});

describe('walking the stack', () => {
  it('counts from one and wraps at the end', () => {
    open();
    expect(text()).toContain('1 / 2');
    button('Next').click();
    flushSync();
    expect(text()).toContain('2 / 2');
    button('Next').click();
    flushSync();
    expect(text()).toContain('1 / 2');
    button('Previous').click();
    flushSync();
    expect(text()).toContain('2 / 2');
  });

  it('takes the keyboard when it opens, so the arrows work without a click', async () => {
    open();
    await Promise.resolve();
    await Promise.resolve();
    const viewer = document.querySelector('.viewer');
    expect(document.activeElement).toBe(viewer);

    viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    expect(text()).toContain('2 / 2');
  });

  it('leaves the arrows to a focused video, which seeks with them', () => {
    open({ index: 1 });
    const video = document.querySelector('video');
    video.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    expect(text()).toContain('2 / 2'); // still the same file
  });

  it('closes on Escape, the way every other overlay in the app does', () => {
    const onclose = vi.fn();
    open({ onclose });
    document
      .querySelector('.viewer')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onclose).toHaveBeenCalled();
  });
});
