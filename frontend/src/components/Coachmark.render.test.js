// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Coachmark, { placeUnder } from './Coachmark.svelte';

/**
 * A word pointed at one control for a moment: under it, its arrow on the control's
 * middle, inside the window, and gone on its action, ✕, Escape, a press elsewhere, a
 * while later, or the control leaving.
 */

let live = null;
let anchor = null;
let rect = null;
const onaction = vi.fn();
const onclose = vi.fn();

function show(props = {}) {
  anchor = document.createElement('button');
  document.body.append(anchor);
  anchor.getBoundingClientRect = () => rect;
  live = mount(Coachmark, {
    target: document.body,
    props: { anchor, text: 'Your scenes wait here', action: 'Show', onaction, onclose, ...props },
  });
  flushSync();
  return document.querySelector('.coachmark');
}

beforeEach(() => {
  rect = { left: 1450, top: 8, width: 28, height: 28, right: 1478, bottom: 36 };
  window.innerWidth = 1500;
  onaction.mockClear();
  onclose.mockClear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  anchor?.remove();
  vi.useRealTimers();
});

const WINDOW = { left: 0, right: 1500 };

describe('where it sits', () => {
  it('centres under a control with room, its arrow on the control’s middle', () => {
    expect(placeUnder({ left: 600, width: 40, bottom: 120 }, 200, WINDOW)).toEqual({ left: 520, top: 130, arrow: 100 });
  });

  it('slides in from the window’s edge, the arrow still on the control', () => {
    // the sidebar's toggle, at the top bar's far right
    expect(placeUnder({ left: 1450, width: 28, bottom: 36 }, 260, WINDOW)).toEqual({ left: 1232, top: 46, arrow: 232 });
    // and a control at the far left
    expect(placeUnder({ left: 0, width: 20, bottom: 30 }, 200, WINDOW)).toMatchObject({ left: 8, arrow: 14 });
  });

  it('stays inside the panel the control is in, clear of the work beside it', () => {
    // the To-do tab near the sidebar's left edge, at 960 px
    expect(placeUnder({ left: 1053, width: 54, bottom: 115 }, 260, { left: 960, right: 1280 })).toMatchObject({ left: 968, arrow: 112 });
  });

  it('keeps the arrow off the bubble’s rounded corners', () => {
    expect(placeUnder({ left: 1495, width: 4, bottom: 36 }, 260, WINDOW).arrow).toBe(246);
  });

  it('holds the window’s margin in a window narrower than itself', () => {
    expect(placeUnder({ left: 100, width: 20, bottom: 30 }, 400, { left: 0, right: 300 }).left).toBe(8);
  });
});

describe('the coachmark', () => {
  it('says its word with its one act and a way to close, takes no focus, and is announced', () => {
    const focused = document.activeElement;
    const bubble = show();
    expect(bubble.textContent).toContain('Your scenes wait here');
    expect([...bubble.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label'))).toEqual(['Show', 'Close']);
    expect(bubble.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(focused);
  });

  it('goes on its act, which is handed up, and on ✕', () => {
    const bubble = show();
    bubble.querySelector('.act').click();
    expect(onaction).toHaveBeenCalledTimes(1);
    bubble.querySelector('.shut').click();
    expect(onclose).toHaveBeenCalled();
  });

  it('goes on Escape and on a press elsewhere, which still do their own work', () => {
    show();
    const elsewhere = vi.fn();
    document.body.addEventListener('pointerdown', elsewhere);
    const press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(press);
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(elsewhere).toHaveBeenCalledTimes(1);
    expect(press.defaultPrevented).toBe(false);
    document.body.removeEventListener('pointerdown', elsewhere);

    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(key);
    expect(onclose).toHaveBeenCalledTimes(2);
    expect(key.defaultPrevented).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  it('stays for a press on itself', () => {
    const bubble = show();
    bubble.querySelector('.words').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onclose).not.toHaveBeenCalled();
  });

  it('goes by itself after a while, and waits while the pointer rests on it', () => {
    vi.useFakeTimers();
    const bubble = show({ timeout: 10_000 });
    vi.advanceTimersByTime(6000);
    bubble.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(30_000);
    expect(onclose).not.toHaveBeenCalled();
    bubble.dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(3900);
    expect(onclose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('follows the control when the window is resized, and goes once the control is gone', async () => {
    const bubble = show();
    const before = bubble.style.left;
    rect = { ...rect, left: 1150, right: 1178 };
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    flushSync();
    expect(bubble.style.left).not.toBe(before);
    expect(onclose).not.toHaveBeenCalled();

    anchor.remove();
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(onclose).toHaveBeenCalled();
  });
});
