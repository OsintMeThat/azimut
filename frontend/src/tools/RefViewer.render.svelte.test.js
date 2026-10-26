// @vitest-environment happy-dom
/**
 * A reference window, actually mounted.
 *
 * What is asserted is what the analyst can see and reach: the fade lets the map
 * through, the details unfold only when there are some, a docked window drops
 * the controls that mean nothing in the column, and a clip plays in a player of
 * its own that steps one frame, slows down and keeps a frame as a picture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RefViewer from './RefViewer.svelte';
import { createViewer } from '../lib/refViewers.js';

const SHOT = { path: 'media/roof.jpg', filename: 'roof.jpg', title: 'Roof', kind: 'image' };
const POSTED = {
  ...SHOT,
  notes: 'North wall',
  taken_at: '2026-03-12T14:02:09',
  source: { webpage_url: 'https://x.com/a/status/1', uploader: 'someone', upload_date: '20260313' },
};
const CLIP = { path: 'media/walk.mp4', filename: 'walk.mp4', title: 'Walk', kind: 'video' };

let app = null;

function open(item, spawn = {}) {
  const viewer = $state(createViewer('ref-1', item, { x: 40, y: 40, z: 1, ...spawn }));
  const target = document.createElement('div'); // the map it floats over
  document.body.appendChild(target);
  const on = { onfocus: vi.fn(), onclose: vi.fn(), onplace: vi.fn(), onkeep: vi.fn() };
  app = mount(RefViewer, { target, props: { viewer, caseId: 'case-1', ...on } });
  flushSync();
  const root = target.querySelector('.ref-viewer');
  const button = (name) => root.querySelector(`button[aria-label="${name}"]`);
  return { viewer, root, button, ...on };
}

const press = (node) => {
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  flushSync();
};

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

describe('the fade', () => {
  it('flips the picture half see-through and lets the map take the pointer', () => {
    const { viewer, root, button } = open(SHOT);
    expect(root.classList.contains('see-through')).toBe(false);

    press(button('Fade'));
    expect(viewer.opacity).toBe(0.5);
    expect(root.querySelector('.rv-body').style.opacity).toBe('0.5');
    expect(root.classList.contains('see-through')).toBe(true);

    press(button('Fade'));
    expect(viewer.opacity).toBe(1);
    expect(root.classList.contains('see-through')).toBe(false);
  });

  it('remembers the value worked on the slider for the next flip', () => {
    const { viewer, root, button } = open(SHOT);
    const range = root.querySelector('input[aria-label="Opacity"]');
    range.value = '0.3';
    range.dispatchEvent(new window.Event('input', { bubbles: true }));
    flushSync();
    expect(viewer.opacity).toBe(0.3);

    press(button('Fade')); // solid
    press(button('Fade')); // and back to where it was
    expect(viewer.opacity).toBe(0.3);
  });
});

describe('the details', () => {
  it('offers no button when the case knows nothing about the file', () => {
    const { button } = open(SHOT);
    expect(button('Details')).toBe(null);
  });

  it('unfolds the dates, the source and the notes under the title', () => {
    const { root, button } = open(POSTED);
    expect(root.querySelector('.rv-facts')).toBe(null); // folded to start

    press(button('Details'));
    const facts = root.querySelector('.rv-facts');
    expect(facts.textContent).toContain('Captured 12 Mar 2026, 14:02 · Published 13 Mar 2026');
    expect(facts.textContent).toContain('North wall');
    const link = facts.querySelector('a');
    expect(link.getAttribute('href')).toBe('https://x.com/a/status/1');
    expect(link.textContent).toContain('x.com · someone');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('its place', () => {
  it('offers the six places where the title was, and asks for the one picked', () => {
    const { root, button, onplace } = open(SHOT);
    press(button('Place'));
    expect(root.querySelector('.rv-title')).toBe(null);
    expect(button('Close')).toBe(null); // the row needs the room
    const places = [...root.querySelectorAll('.rv-places button')].map((b) => b.getAttribute('aria-label'));
    expect(places).toEqual([
      'Column on the left',
      'Column on the right',
      'Top left corner',
      'Top right corner',
      'Bottom left corner',
      'Bottom right corner',
    ]);

    press(button('Top right corner'));
    expect(onplace).toHaveBeenCalledWith('ref-1', 'tr');
    expect(root.querySelector('.rv-title')).not.toBe(null); // the row folds away
  });

  it('marks the place it is in, which sets it free when picked again', () => {
    const { root, button } = open(SHOT, { docked: 'left' });
    press(button('Place'));
    const here = root.querySelector('.rv-places button[aria-label="Column on the left"]');
    expect(here.getAttribute('aria-pressed')).toBe('true');
    expect(here.title).toBe('Free it');
  });

  it('puts the places away on Escape', () => {
    const { root, button } = open(SHOT);
    press(button('Place'));
    root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(root.querySelector('.rv-places')).toBe(null);
  });

  it('pinned, grows from the corner that faces the map’s middle', () => {
    const { root } = open(SHOT, { corner: 'br' });
    expect(root.querySelector('.rv-resize').classList.contains('from-br')).toBe(true);
  });

  // Drag the resize handle by (dx, dy) over a 1000×800 map.
  function resize(root, dx, dy) {
    root.parentElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 });
    const at = (type, x, y, node = window) =>
      node.dispatchEvent(new window.MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    at('pointerdown', 300, 300, root.querySelector('.rv-resize'));
    at('pointermove', 300 + dx, 300 + dy);
    at('pointerup', 300 + dx, 300 + dy);
    flushSync();
  }

  it('free, resizes from its bottom right corner', () => {
    const { viewer, root } = open(SHOT);
    expect(viewer.corner).toBe(false);
    resize(root, 60, 40);
    expect(viewer.w).toBe(380);
    expect(viewer.h).toBe(300);
  });

  it('pinned, grows away from its corner', () => {
    const { viewer, root } = open(SHOT, { corner: 'br' });
    resize(root, -60, -40);
    expect(viewer.w).toBe(380);
    expect(viewer.h).toBe(300);
  });

  it('takes the shape of its picture once it has loaded', () => {
    const { viewer, root } = open(SHOT);
    const img = root.querySelector('img');
    Object.defineProperty(img, 'naturalWidth', { value: 1600 });
    Object.defineProperty(img, 'naturalHeight', { value: 900 });
    img.dispatchEvent(new window.Event('load'));
    flushSync();
    expect(viewer.aspect).toBeCloseTo(16 / 9, 6);
  });

  it('docked, keeps only what means something in the column', () => {
    const { root, button } = open(SHOT, { docked: 'right' });
    expect(root.classList.contains('docked')).toBe(true);
    expect(root.style.left).toBe('');
    expect(root.style.width).toBe('');
    expect(root.querySelector('.rv-resize')).toBe(null);
    expect(button('Fade')).toBe(null); // nothing under it to see through to
    expect(button('Place').title).toBe('Column on the right: move or free it');
  });
});

describe('a clip', () => {
  const clip = (spawn) => {
    const opened = open(CLIP, spawn);
    const video = opened.root.querySelector('video');
    video.pause = vi.fn();
    video.play = vi.fn(() => Promise.resolve());
    return { ...opened, video };
  };

  it('plays in a player of its own, since native controls would zoom with it', () => {
    const { video, button } = clip();
    expect(video.controls).toBe(false);
    for (const name of ['Play', 'Back one frame', 'Forward one frame', 'Speed', 'Mute', 'Keep this frame']) {
      expect(button(name), name).not.toBe(null);
    }
  });

  it('steps one frame of its own rate, from the keys too', () => {
    const { viewer, root, video, button } = clip();
    viewer.fps = 25;
    flushSync();
    press(button('Forward one frame'));
    // half a frame into the next one, as the Inspect player seeks
    expect(video.currentTime).toBeCloseTo(0.06, 6);
    expect(video.pause).toHaveBeenCalled();

    video.currentTime = 1.02;
    video.dispatchEvent(new window.Event('timeupdate'));
    root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    flushSync();
    expect(video.currentTime).toBeCloseTo(0.98, 6);
  });

  it('slows down step by step and comes back to normal speed', () => {
    const { viewer, video, button } = clip();
    press(button('Speed'));
    expect(viewer.rate).toBe(0.5);
    expect(video.playbackRate).toBe(0.5);
    for (let i = 0; i < 3; i += 1) press(button('Speed'));
    expect(viewer.rate).toBe(1);
  });

  it('mutes and gives the sound back', () => {
    const { viewer, video, button } = clip();
    press(button('Mute'));
    expect(viewer.muted).toBe(true);
    expect(video.muted).toBe(true);
    press(button('Sound on'));
    expect(video.muted).toBe(false);
  });

  it('zooms into the clip on a wheel, and offers the way back to the fit', () => {
    const { viewer, root, video } = clip();
    expect(root.querySelector('.rv-zoom')).toBe(null);
    root.querySelector('.rv-body').dispatchEvent(new window.WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    flushSync();
    expect(viewer.scale).toBeCloseTo(1.15, 6);
    expect(video.style.transform).toContain('scale(1.15)');
    press(root.querySelector('.rv-zoom'));
    expect(viewer.scale).toBe(1);
  });

  it('keeps the frame on screen as a picture', () => {
    const { video, button, onkeep } = clip();
    Object.defineProperty(video, 'videoWidth', { value: 1920 });
    Object.defineProperty(video, 'videoHeight', { value: 1080 });
    const getContext = vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() });
    const toDataURL = vi
      .spyOn(window.HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/jpeg;base64,AA');
    press(button('Keep this frame'));
    expect(video.pause).toHaveBeenCalled();
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.95);
    expect(onkeep).toHaveBeenCalledWith('ref-1', 'data:image/jpeg;base64,AA', 0);
    getContext.mockRestore();
    toDataURL.mockRestore();
  });

  it('remembers where it was when the window is drawn again for the dock', () => {
    const { viewer, video } = clip();
    Object.defineProperty(video, 'readyState', { value: 1 });
    video.currentTime = 3;
    unmount(app);
    app = null;
    expect(viewer.at).toBe(3);
    expect(viewer.playing).toBe(false);
  });
});
