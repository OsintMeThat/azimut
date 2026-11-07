// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlayerTrack from './PlayerTrack.svelte';
import {
  followWindow, narrowestSpan, panWindow, preciseClock, wheelFactor, wholeWindow, windowFraction, windowTime,
  zoomWindow,
} from '../../lib/inspectPlayer.js';

/**
 * The bar under the video, pressed the way an analyst presses it: anywhere is a
 * time, and near a marker is that marker's own time. The wheel zooms its time.
 */

let live = null;
let target = null;
// What the player hands the bar and reads back: the clip's time, and the window.
let box = null;
let observers = [];
const NativeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      observers.push(callback);
    }
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  globalThis.ResizeObserver = NativeObserver;
  vi.restoreAllMocks();
});

function open(props) {
  observers = [];
  target = document.createElement('div');
  document.body.append(target);
  const held = $state({ time: props.time ?? 0, zoom: null });
  box = held;
  live = mount(PlayerTrack, {
    target,
    props: {
      duration: 10,
      ...props,
      get time() { return box.time; },
      get zoom() { return box.zoom; },
      set zoom(value) { box.zoom = value; },
    },
  });
  flushSync();
  const track = target.querySelector('.track');
  // 100 px wide, so a pixel is a tenth of a second
  track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 });
  Object.defineProperty(track, 'clientWidth', { configurable: true, value: 100 });
  for (const measure of observers) measure([]);
  flushSync();
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

  it('greys an abandoned scene where it was, hollow, its band and its pin alike', () => {
    open({
      scenes: [
        { key: 'sc_1', start: 2, end: 5, color: 'red', label: 'Bridge · abandoned', abandoned: true },
        { key: 'sc_2', start: 7, end: null, color: 'red', label: 'Market · abandoned', abandoned: true },
        { key: 'sc_3', start: 8, end: null, color: 'red', label: 'Square' },
      ],
    });
    expect(target.querySelector('[data-testid="scene-band"]').classList.contains('abandoned')).toBe(true);
    expect([...target.querySelectorAll('[data-testid="scene-pin"]')].map((p) => p.classList.contains('abandoned'))).toEqual([true, false]);
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

describe('a click on a scene', () => {
  const SCENES = [
    { key: 'sc_1', scene: 'sc_1', start: 2, end: 5, color: 'red', label: 'Bridge' },
    { key: 'sc_2', scene: 'sc_2', start: 7, end: null, color: 'red', label: 'Market' },
    { key: 'sc_3', scene: 'sc_3', start: 3, end: 4, color: 'red', label: 'Inner' },
    { key: 'proof:P#1', scene: 'proof:P', start: 9, end: null, color: 'red', label: 'P' },
  ];

  it('names the scene of a band or a pin pressed, and still moves the clip', () => {
    const onscene = vi.fn();
    const onseek = vi.fn();
    const track = open({ scenes: SCENES, onscene, onseek });
    press(track, 45);
    expect(onscene).toHaveBeenLastCalledWith('sc_1');
    press(track, 71);
    expect(onscene).toHaveBeenLastCalledWith('sc_2');
    expect(onseek).toHaveBeenLastCalledWith(7, true);
    // a proof's moment names the proof, not the moment
    press(track, 90);
    expect(onscene).toHaveBeenLastCalledWith('proof:P');
  });

  it('names only a pin while bands are shut, a band moving the clip alone', () => {
    const onscene = vi.fn();
    const onseek = vi.fn();
    const track = open({ scenes: SCENES, onscene, onseek, bandsOpen: false });
    press(track, 45);
    expect(onscene).not.toHaveBeenCalled();
    expect(onseek).toHaveBeenLastCalledWith(4.5, false);
    // nor the shortest of two stacked, while a pin and a proof's moment still do
    press(track, 35);
    expect(onscene).not.toHaveBeenCalled();
    press(track, 71);
    expect(onscene).toHaveBeenLastCalledWith('sc_2');
    press(track, 90);
    expect(onscene).toHaveBeenLastCalledWith('proof:P');
  });

  it('takes the shortest of the bands stacked there', () => {
    const onscene = vi.fn();
    press(open({ scenes: SCENES, onscene }), 35);
    expect(onscene).toHaveBeenCalledWith('sc_3');
  });

  it('names nothing away from a scene, or for a drag across one', () => {
    const onscene = vi.fn();
    const track = open({ scenes: SCENES, onscene, onseek: vi.fn() });
    press(track, 15);
    expect(onscene).not.toHaveBeenCalled();
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: 40, button: 0, bubbles: true }));
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, bubbles: true }));
    track.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, button: 0, bubbles: true }));
    expect(onscene).not.toHaveBeenCalled();
  });

  it('leaves the handles of the scene in hand to their drag', () => {
    const onscene = vi.fn();
    const track = open({ scenes: SCENES, onscene, onseek: vi.fn(), onedit: vi.fn(), editing: { key: 'sc_1', start: 2, end: 5, color: 'red' } });
    press(track, 20);
    expect(onscene).not.toHaveBeenCalled();
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

describe('the bar zoomed by the wheel', () => {
  const fps = 25;
  // 10 s on 100 px at 25 fps: the deepest window holds 100 / FRAME_PX frames
  const least = narrowestSpan(10, fps, 100);
  const wheel = (track, x, init = {}) => {
    const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, ...init });
    // happy-dom's wheel event keeps only its deltas: where it is and Shift are set by hand
    Object.defineProperties(event, { clientX: { value: x }, shiftKey: { value: Boolean(init.shiftKey) } });
    track.dispatchEvent(event);
    flushSync();
    return event;
  };
  const deepest = (track, x) => {
    for (let i = 0; i < 20; i += 1) wheel(track, x);
  };
  const lefts = (selector) => [...target.querySelectorAll(selector)].map((el) => parseFloat(el.style.left));
  const marks = [{ id: 'm1', time: 2 }, { id: 'm2', time: 5 }];

  it('zooms about the pointer, and keeps the page from scrolling', () => {
    const onseek = vi.fn();
    const track = open({ fps, marks, onseek });
    const event = wheel(track, 80);
    expect(event.defaultPrevented).toBe(true);
    const win = zoomWindow(wholeWindow(10), wheelFactor(-100), 8, 0.8, 10, least);
    expect(box.zoom).toEqual(win);
    // the moment under the pointer stays under it, the rest spreads out about it
    expect(lefts('.mark')[0]).toBeCloseTo(windowFraction(2, win) * 100, 9);
    expect(lefts('.mark')[1]).toBeCloseTo(windowFraction(5, win) * 100, 9);
    expect(target.querySelector('.peek-time').textContent).toBe(preciseClock(8));
    // a press lands on the time under it on the new scale
    press(track, 60);
    expect(onseek).toHaveBeenLastCalledWith(windowTime(0.6, win), false);
    // a notch the other way, and the bar shows the whole clip again
    wheel(track, 80, { deltaY: 100 });
    expect(box.zoom).toBe(null);
    expect(lefts('.mark')).toEqual([20, 50]);
  });

  it('stops where a frame is drawn wide, with a line between frames, and snaps within its own pixels', () => {
    const onseek = vi.fn();
    const track = open({ fps, marks, onseek });
    expect(target.querySelector('[data-testid="frame-grid"]')).toBeNull();
    deepest(track, 50);
    expect(box.zoom.span).toBeCloseTo(least, 9);
    expect(box.zoom.start).toBeCloseTo(5 - least / 2, 9);
    expect(parseFloat(target.querySelector('[data-testid="frame-grid"]').style.backgroundSize)).toBeCloseTo(24, 6);
    // 6 px of the zoomed bar is a few milliseconds: a press 3 px off the mark is the mark
    press(track, 53);
    expect(onseek).toHaveBeenLastCalledWith(5, true);
    // 8 px off is a time of its own, where the whole clip would have read 5.8 s
    press(track, 58);
    expect(onseek.mock.calls.at(-1)[0]).toBeCloseTo(windowTime(0.58, box.zoom), 9);
    expect(onseek.mock.calls.at(-1)[1]).toBe(false);
  });

  it('slides with Shift+wheel or a sideways scroll, never past the clip', () => {
    const track = open({ fps, marks });
    for (let i = 0; i < 3; i += 1) wheel(track, 50);
    const win = box.zoom;
    wheel(track, 50, { shiftKey: true, deltaY: 50 });
    expect(box.zoom).toEqual(panWindow(win, win.span / 2, 10));
    wheel(track, 50, { deltaX: -50, deltaY: 0 });
    expect(box.zoom.start).toBeCloseTo(win.start, 9);
    // a wheel counted in lines, as Firefox can, goes as far as forty pixels a line
    wheel(track, 50, { shiftKey: true, deltaY: -30, deltaMode: 1 });
    expect(box.zoom).toEqual({ start: 0, span: win.span });
  });

  it('draws the scenes, the loop, the playhead and the handles in the window', () => {
    const editing = { key: 'sc_1', start: 2, end: 5, color: 'red' };
    const track = open({
      fps, time: 2.5, editing, loop: { a: 1, b: 4 },
      scenes: [{ key: 'sc_1', start: 2, end: 5, color: 'red', label: 'Bridge' }, { key: 'sc_2', start: 3, end: null, color: 'blue', label: '' }],
    });
    for (let i = 0; i < 3; i += 1) wheel(track, 30);
    const win = box.zoom;
    const x = (t) => windowFraction(t, win) * 100;
    const band = target.querySelector('[data-testid="scene-band"]');
    expect(parseFloat(band.style.left)).toBeCloseTo(x(2), 9);
    expect(parseFloat(band.style.width)).toBeCloseTo(x(5) - x(2), 9);
    expect(lefts('[data-testid="scene-pin"]')[0]).toBeCloseTo(x(3), 9);
    expect(lefts('[data-testid="scene-grip-start"]')[0]).toBeCloseTo(x(2), 9);
    expect(lefts('[data-testid="scene-grip-end"]')[0]).toBeCloseTo(x(5), 9);
    expect(lefts('.loop')[0]).toBeCloseTo(x(1), 9);
    expect(lefts('.head')[0]).toBeCloseTo(x(2.5), 9);
    expect(parseFloat(target.querySelector('.played').style.width)).toBeCloseTo(x(2.5), 9);
    // and what lies past the window is cut at the bar's ends
    expect(target.querySelector('.lane').classList.contains('zoomed')).toBe(true);
  });

  it('drags a handle frame by frame on the zoomed bar', () => {
    const onedit = vi.fn();
    const editing = { key: 'sc_1', start: 2, end: 5, color: 'red' };
    const track = open({ fps, editing, onedit, onseek: vi.fn(), scenes: [{ key: 'sc_1', start: 2, end: 5, color: 'red', label: '' }] });
    deepest(track, 20);
    // a frame is now drawn 24 px wide, and the handle moves a frame for each 24 px
    expect(lefts('[data-testid="scene-grip-start"]')[0]).toBeCloseTo(20, 6);
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, button: 0, bubbles: true }));
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 45, bubbles: true }));
    expect(onedit.mock.calls.at(-1)[0]).toBe('start');
    expect(onedit.mock.calls.at(-1)[1]).toBeCloseTo(2.04, 9);
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 66, bubbles: true }));
    expect(onedit.mock.calls.at(-1)[1]).toBeCloseTo(2.08, 9);
    track.dispatchEvent(new PointerEvent('pointerup', { clientX: 66, button: 0, bubbles: true }));
  });

  it('pages after the playhead once it runs off, but never just after the wheel moved the window', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const track = open({ fps, time: 5 });
    for (let i = 0; i < 3; i += 1) wheel(track, 50);
    const win = box.zoom;
    box.time = 9;
    flushSync();
    expect(box.zoom).toEqual(win);
    now += 2000;
    box.time = 6;
    flushSync();
    expect(box.zoom).toEqual(win);
    box.time = 9.1;
    flushSync();
    expect(box.zoom).toEqual(followWindow(win, 9.1, 10));
  });

  it('shows where the window sits in the clip, until the player puts the whole clip back', () => {
    const track = open({ fps, marks });
    expect(target.querySelector('[data-testid="bar-overview"]')).toBeNull();
    for (let i = 0; i < 3; i += 1) wheel(track, 50);
    const shown = target.querySelector('.overview-window');
    expect(parseFloat(shown.style.left)).toBeCloseTo((box.zoom.start / 10) * 100, 9);
    expect(parseFloat(shown.style.width)).toBeCloseTo((box.zoom.span / 10) * 100, 9);
    box.zoom = null;
    flushSync();
    expect(target.querySelector('[data-testid="bar-overview"]')).toBeNull();
    expect(lefts('.mark')).toEqual([20, 50]);
  });

  it('zooms about the playhead from the keyboard', () => {
    open({ fps, time: 3 });
    live.zoomBy(1);
    flushSync();
    expect(box.zoom).toEqual(zoomWindow(wholeWindow(10), wheelFactor(-100), 3, 0.3, 10, least));
    live.zoomBy(-1);
    flushSync();
    expect(box.zoom).toBe(null);
  });

  it('keeps telling assistive technology the time in the clip', () => {
    const track = open({ fps, time: 3.2 });
    deepest(track, 50);
    expect(track.getAttribute('aria-valuemax')).toBe('10');
    expect(track.getAttribute('aria-valuetext')).toBe('0:03.200');
  });
});
