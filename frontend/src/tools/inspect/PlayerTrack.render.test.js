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

  it('says where the clip is to assistive technology', () => {
    const track = open({ time: 3.2 });
    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-valuetext')).toBe('0:03.200');
  });
});
