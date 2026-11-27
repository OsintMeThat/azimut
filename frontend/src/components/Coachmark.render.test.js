// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Coachmark, { placeUnder } from './Coachmark.svelte';

// happy-dom's URL will not name a file, so the path is built the node way
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Coachmark.svelte'), 'utf8');

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
  window.innerHeight = 800;
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

  it('goes over a control with no room under it', () => {
    const room = { ...WINDOW, bottom: 800 };
    expect(placeUnder({ left: 600, width: 40, top: 760, bottom: 790 }, 200, room, 30)).toEqual({ left: 520, top: 720, arrow: 100, above: true });
    // under it still while it fits there
    expect(placeUnder({ left: 600, width: 40, top: 700, bottom: 730 }, 200, room, 30)).toEqual({ left: 520, top: 740, arrow: 100 });
  });

  it('stays on screen beside a control as tall as the window', () => {
    const place = placeUnder({ left: 0, width: 64, top: 0, bottom: 800 }, 200, { ...WINDOW, bottom: 800 }, 30);
    expect(place.top).toBe(762);
    expect(place.above).toBeUndefined();
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

  it('follows the control when a panel scrolls it along', async () => {
    const bubble = show();
    const before = bubble.style.left;
    const panel = document.createElement('div');
    document.body.append(panel);
    rect = { ...rect, left: 1150, right: 1178 };
    // a scroll does not bubble: heard all the same
    panel.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    flushSync();
    expect(bubble.style.left).not.toBe(before);
    panel.remove();
  });

  it('goes over a control at the foot of the window, its arrow turned down', () => {
    window.innerHeight = 800;
    rect = { left: 600, top: 770, width: 40, height: 24, right: 640, bottom: 794 };
    expect(show().classList.contains('above')).toBe(true);
  });
});

describe('the ring', () => {
  const ringOf = () => document.querySelector('.ring');

  it('is drawn only when asked, so a plain coachmark stays a word and an arrow', () => {
    show();
    expect(ringOf()).toBeNull();
  });

  it('closes round the control a little off its edge, unheard by screen readers', () => {
    rect = { left: 400, top: 200, width: 80, height: 28, right: 480, bottom: 228 };
    show({ ring: true, action: '' });
    const ring = ringOf();
    expect([ring.style.left, ring.style.top, ring.style.width, ring.style.height]).toEqual(['395px', '195px', '90px', '38px']);
    expect(ring.getAttribute('aria-hidden')).toBe('true');
  });

  it('points the bubble at the ring rather than into it', () => {
    rect = { left: 400, top: 200, width: 80, height: 28, right: 480, bottom: 228 };
    const bubble = show({ ring: true });
    // the control's foot, the ring's room round it, then the bubble's gap
    expect(bubble.style.top).toBe('243px');
  });

  it('leaves the control under it pressable: a press there reaches it and takes the pointer down', () => {
    const pressed = vi.fn();
    show({ ring: true });
    anchor.addEventListener('pointerdown', pressed);
    anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(pressed).toHaveBeenCalled();
    expect(onclose).toHaveBeenCalled();
  });

  it('moves with the control', async () => {
    rect = { left: 400, top: 200, width: 80, height: 28, right: 480, bottom: 228 };
    show({ ring: true });
    rect = { ...rect, top: 120, bottom: 148 };
    document.body.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    flushSync();
    expect(ringOf().style.top).toBe('115px');
  });

  it('takes no press, and drops its echo for a reader who asked for less motion', () => {
    const css = source.slice(source.indexOf('<style>'));
    const rule = css.slice(css.indexOf('.ring {'), css.indexOf('}', css.indexOf('.ring {')));
    expect(rule).toContain('pointer-events: none');
    const calm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(calm).toContain('.ring::after');
  });
});
