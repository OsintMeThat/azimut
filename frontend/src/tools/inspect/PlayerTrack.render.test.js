// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlayerTrack from './PlayerTrack.svelte';

/**
 * The bar under the video, pressed the way an analyst presses it: anywhere is a
 * time, and near a marker is that marker's own time.
 */

let live = null;
let target = null;

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

function open(props) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(PlayerTrack, { target, props: { duration: 10, time: 0, ...props } });
  flushSync();
  const track = target.querySelector('.track');
  // 100 px wide, so a pixel is a tenth of a second
  track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 });
  Object.defineProperty(track, 'clientWidth', { configurable: true, value: 100 });
  window.dispatchEvent(new Event('resize'));
  return track;
}

const press = (track, x) => {
  track.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, button: 0, bubbles: true }));
  track.dispatchEvent(new PointerEvent('pointerup', { clientX: x, button: 0, bubbles: true }));
};

describe('pressing the bar', () => {
  it('lands on a frame already cut when pressed beside it', () => {
    const onseek = vi.fn();
    const track = open({ frames: [{ id: 'f1', time: 5 }], onseek });
    // ResizeObserver never fires in happy-dom: the width is read on mount
    live && flushSync();
    press(track, 53);
    expect(onseek).toHaveBeenCalledWith(5, true);
  });

  it('is a plain time away from any marker', () => {
    const onseek = vi.fn();
    const track = open({ frames: [{ id: 'f1', time: 5 }], marks: [{ id: 'm1', time: 2, label: 'flash' }], onseek });
    press(track, 80);
    expect(onseek).toHaveBeenCalledWith(8, false);
  });

  it('names what it would land on, and shows the time there', () => {
    const track = open({ marks: [{ id: 'm1', time: 2, label: 'flash' }], onseek: vi.fn() });
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 21, bubbles: true }));
    flushSync();
    expect(target.querySelector('.peek-time').textContent).toBe('0:02.000 · flash');
  });

  it('draws each scene as a band over its stretch, and lands on its start', () => {
    const onseek = vi.fn();
    const track = open({
      scenes: [{ key: 'sc_1', start: 2, end: 5, color: 'red', label: 'Bridge' }],
      onseek,
    });
    const band = target.querySelector('[data-testid="scene-band"]');
    expect(band.style.left).toBe('20%');
    expect(band.style.width).toBe('30%');
    press(track, 22);
    expect(onseek).toHaveBeenCalledWith(2, true);
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 21, bubbles: true }));
    flushSync();
    expect(target.querySelector('.peek-time').textContent).toBe('0:02.000 · Bridge');
  });

  it('pins an instant scene where it stands', () => {
    open({ scenes: [{ key: 'sc_2', start: 7, end: null, color: 'red', label: 'Bridge?' }], onseek: vi.fn() });
    expect(target.querySelector('[data-testid="scene-band"]')).toBeNull();
    expect(target.querySelector('[data-testid="scene-pin"]').style.left).toBe('70%');
  });

  it('keeps a portrait clip\'s hover picture small, and inside the bar by its own half width', () => {
    const tiles = { count: 10, columns: 10, rows: 1, width: 160, height: 284, interval: 1 };
    const track = open({ tiles, stripUrl: '/strip' });
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 2, bubbles: true }));
    flushSync();
    const thumb = target.querySelector('.thumb');
    // 9:16, drawn 54 by 96 rather than 160 by 284 over the video
    expect([thumb.style.width, thumb.style.height]).toEqual(['54.08px', '96px']);
    // held in from the bar's edge by half of what is drawn, not half the strip's tile
    expect(parseFloat(target.querySelector('.peek').style.left)).toBeCloseTo((160 * 96) / 284 / 2, 6);
  });

  it('says where the clip is to assistive technology', () => {
    const track = open({ time: 3.2 });
    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-valuetext')).toBe('0:03.200');
  });
});

describe('the handles of a scene whose time is open', () => {
  const move = (track, x) => {
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: x, bubbles: true }));
    flushSync();
  };
  const down = (track, x) => track.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, button: 0, bubbles: true }));
  const up = (track, x) => track.dispatchEvent(new PointerEvent('pointerup', { clientX: x, button: 0, bubbles: true }));

  const passage = { key: 'sc_1', start: 2, end: 5, color: 'red' };
  const scenes = [{ key: 'sc_1', start: 2, end: 5, color: 'red', label: 'Bridge' }];

  it('draws a handle at each end of a passage, and one on an instant', () => {
    open({ scenes, editing: passage, fps: 10 });
    expect(target.querySelector('[data-testid="scene-grip-start"]').style.left).toBe('20%');
    expect(target.querySelector('[data-testid="scene-grip-end"]').style.left).toBe('50%');
    expect(target.querySelector('[data-testid="scene-band"]').classList.contains('held')).toBe(true);
    live && unmount(live);
    live = null;
    target.remove();

    open({ scenes: [{ key: 'sc_2', start: 7, end: null, color: 'red', label: '' }], editing: { key: 'sc_2', start: 7, end: null, color: 'red' } });
    expect(target.querySelector('[data-testid="scene-grip-start"]').style.left).toBe('70%');
    expect(target.querySelector('[data-testid="scene-grip-end"]')).toBeNull();
  });

  it('drags the start by whole frames, showing the frame it stands on', () => {
    const onedit = vi.fn();
    const onseek = vi.fn();
    // 4 fps: a frame is a quarter of a second, two and a half pixels
    const track = open({ scenes, editing: passage, fps: 4, onedit, onseek });
    down(track, 21);
    expect(onedit).not.toHaveBeenCalled(); // taken where it stands
    expect(onseek).toHaveBeenLastCalledWith(2, true);
    move(track, 31.4);
    expect(onedit).toHaveBeenLastCalledWith('start', 3.25);
    expect(onseek).toHaveBeenLastCalledWith(3.25, true);
    expect(target.querySelector('.peek-time').textContent).toBe('0:03.250 · Start');
    up(track, 31.4);
    move(track, 80);
    expect(onedit).toHaveBeenCalledTimes(1); // let go, the handle stays put
  });

  it('drags the end, shows the last frame inside it, and never lets it cross the start', () => {
    const onedit = vi.fn();
    const onseek = vi.fn();
    const track = open({ scenes, editing: passage, fps: 10, onedit, onseek });
    down(track, 51);
    move(track, 61);
    expect(onedit).toHaveBeenLastCalledWith('end', 6.1);
    expect(onseek.mock.calls.at(-1)[0]).toBeCloseTo(6.0, 9);
    move(track, 5);
    expect(onedit.mock.calls.at(-1)[0]).toBe('end');
    expect(onedit.mock.calls.at(-1)[1]).toBeCloseTo(2.1, 9); // a frame after the start
  });

  it('catches on a marker it passes close to, but not on its own scene', () => {
    const onedit = vi.fn();
    const track = open({ scenes, editing: passage, fps: 25, onedit, shots: [{ start: 0 }, { start: 3.6 }] });
    down(track, 20);
    move(track, 34);
    expect(onedit).toHaveBeenLastCalledWith('start', 3.6);
    expect(target.querySelector('.peek-time').textContent).toBe('0:03.600 · Start · Shot 2');
  });

  it('still moves through the clip when pressed away from the handles', () => {
    const onedit = vi.fn();
    const onseek = vi.fn();
    const track = open({ scenes, editing: passage, fps: 10, onedit, onseek });
    press(track, 80);
    expect(onseek).toHaveBeenCalledWith(8, false);
    expect(onedit).not.toHaveBeenCalled();
  });

  it('says a handle can be dragged where the pointer would take it', () => {
    const track = open({ scenes, editing: passage, fps: 10 });
    move(track, 49);
    expect(track.classList.contains('resize')).toBe(true);
    move(track, 35);
    expect(track.classList.contains('resize')).toBe(false);
  });
});
