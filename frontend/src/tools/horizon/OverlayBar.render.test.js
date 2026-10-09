// @vitest-environment happy-dom
/**
 * The band over a photo laid on the Horizon view, over a stand-in for the
 * overlay state: what the analyst meets there to work the trace, and the list
 * of every gesture and key the photo answers to.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import OverlayBar from './OverlayBar.svelte';

function fakeOverlay(over = {}) {
  return {
    source: { name: 'summit.jpg', kind: 'image' },
    mix: 1,
    blink: false,
    tracing: false,
    erasing: false,
    traceHidden: false,
    traceShown: true,
    strokes: [[{ u: 0, v: 0.5 }, { u: 1, v: 0.5 }]],
    busy: false,
    error: '',
    setMix: vi.fn(),
    setBlink: vi.fn(),
    setTracing: vi.fn(),
    setErasing: vi.fn(),
    setTraceHidden: vi.fn(),
    clearTrace: vi.fn(),
    remove: vi.fn(),
    warping: false,
    warped: false,
    locked: false,
    setWarping: vi.fn(),
    resetWarp: vi.fn(),
    setLocked: vi.fn(),
    ...over,
  };
}

let live = [];

function bar(overlay, props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(OverlayBar, { target, props: { overlay, ...props } });
  live.push({ component, target });
  flushSync();
  return target;
}

afterEach(() => {
  for (const { component, target } of live) {
    unmount(component);
    target.remove();
  }
  live = [];
});

const button = (root, label) => root.querySelector(`button[aria-label="${label}"]`);

describe('the band over a photo', () => {
  it('clears the whole trace in one press, and has nothing to clear without one', () => {
    const overlay = fakeOverlay();
    const root = bar(overlay);
    button(root, 'Clear the whole trace').click();
    expect(overlay.clearTrace).toHaveBeenCalledOnce();
    expect(button(root, 'Clear the whole trace').title).toMatch(/Ctrl\+Z brings it back/);
    const empty = bar(fakeOverlay({ strokes: [] }));
    expect(button(empty, 'Clear the whole trace')).toBeNull();
  });

  it('hides the trace, rubs it out and asks for the skyline found', () => {
    const overlay = fakeOverlay();
    const ondetect = vi.fn();
    const root = bar(overlay, { ondetect });
    button(root, 'Hide the trace').click();
    expect(overlay.setTraceHidden).toHaveBeenCalledWith(true);
    button(root, 'Rub out part of the trace').click();
    expect(overlay.setErasing).toHaveBeenCalledWith(true);
    button(root, 'Detect the skyline').click();
    expect(ondetect).toHaveBeenCalledOnce();
  });

  it('lists every gesture and key, and folds the list away on Escape or a press elsewhere', () => {
    const root = bar(fakeOverlay());
    const open = button(root, 'Gestures and keys');
    expect(root.querySelector('#hz-photo-keys')).toBeNull();
    open.click();
    flushSync();
    const list = root.querySelector('#hz-photo-keys');
    const rows = [...list.querySelectorAll('dt')].map((dt) => `${dt.textContent.trim()} → ${dt.nextElementSibling.textContent}`);
    for (const row of [
      'Shift+wheel → Change the lens',
      'Shift+drag → Roll about the pivot',
      'Shift+click → Set the pivot',
      'Alt+wheel → Change the eye height',
      'Wheel → Look closer, or pinch',
      'Space+drag → Move around the photo, or the middle button',
      'Alt+drag → Draw without snapping',
      'E → Rub out',
      'H → Hide or show the trace',
      'Ctrl+Z → Take the last change back',
      'W → Reshape the photo by its corners',
      'L → Pin the photo to the terrain, or unpin it',
    ]) {
      expect(rows).toContain(row);
    }
    // a video's own keys only for a video
    expect(rows.some((row) => row.startsWith('Space →'))).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(root.querySelector('#hz-photo-keys')).toBeNull();
    open.click();
    flushSync();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    flushSync();
    expect(root.querySelector('#hz-photo-keys')).toBeNull();
  });

  it('adds a video’s keys for a video', () => {
    const root = bar(fakeOverlay({ source: { name: 'pan.mp4', kind: 'video' } }));
    button(root, 'Gestures and keys').click();
    flushSync();
    const text = root.querySelector('#hz-photo-keys').textContent;
    expect(text).toContain('Play or pause');
    expect(text).toContain('A frame back');
  });

  it('reshapes a photo by its corners, and squares it again once it was', () => {
    const overlay = fakeOverlay();
    const root = bar(overlay);
    button(root, 'Reshape the photo').click();
    expect(overlay.setWarping).toHaveBeenCalledWith(true);
    expect(button(root, 'Square the photo again')).toBeNull();
    const pulled = fakeOverlay({ warping: true, warped: true });
    const again = bar(pulled);
    expect(button(again, 'Reshape the photo').getAttribute('aria-pressed')).toBe('true');
    button(again, 'Square the photo again').click();
    expect(pulled.resetWarp).toHaveBeenCalledOnce();
    // a video keeps its shape
    const video = bar(fakeOverlay({ source: { name: 'pan.mp4', kind: 'video' } }));
    expect(button(video, 'Reshape the photo')).toBeNull();
  });

  it('lights the fit once there is a gap to close', () => {
    const quiet = bar(fakeOverlay());
    expect(button(quiet, 'Fit to trace')).toBeNull();
    const onfit = vi.fn();
    const root = bar(fakeOverlay(), { gap: { median: 0.4, span: 52, offset: 0.1, points: 40 }, onfit });
    const fit = button(root, 'Fit to trace');
    expect(fit.classList.contains('primary')).toBe(true);
    fit.click();
    expect(onfit).toHaveBeenCalledOnce();
  });

  it('waits on the search with the fit held, so it cannot be asked twice', () => {
    const root = bar(fakeOverlay(), { gap: { median: 0.4, span: 52, offset: 0.1, points: 40 }, fitting: true });
    const fit = button(root, 'Fit to trace');
    expect(fit.disabled).toBe(true);
    expect(fit.getAttribute('aria-busy')).toBe('true');
    expect(fit.textContent).toContain('Fitting…');
    expect(fit.title).toMatch(/whole turn/);
  });

  it('lists the places the search found when none stood out, and lights the one in view', () => {
    const gap = { median: 0.4, span: 52, offset: 0.1, points: 40 };
    const place = (heading, explained) => ({ camera: { heading, tilt: 1, fov: 60 }, gap: { median: 0.21 }, explained, close: true });
    const onplace = vi.fn();
    const view = { camera: { heading: 147.3, tilt: 1, fov: 60 }, ground: 'relief', lines: true, setLines: vi.fn() };
    const places = [place(299.6, 0.47), place(147.3, 0.4)];
    const root = bar(fakeOverlay(), { gap, view, places, onplace });
    const open = button(root, 'Places that fit');
    expect(open.textContent).toContain('2');
    expect(root.querySelector('#hz-photo-places')).toBeNull();
    open.click();
    flushSync();
    const rows = [...root.querySelectorAll('#hz-photo-places button')];
    expect(rows.map((b) => b.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      '300° NW explains 47% of the trace',
      '147° SE explains 40% of the trace',
    ]);
    expect(rows.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    rows[0].click();
    expect(onplace).toHaveBeenCalledWith(0);
    // Escape folds the list away
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(root.querySelector('#hz-photo-places')).toBeNull();
    // one place is the fit itself: nothing to choose between
    const one = bar(fakeOverlay(), { gap, view, places: [place(299.6, 0.47)] });
    expect(button(one, 'Places that fit')).toBeNull();
  });

  it('keeps every button’s name when the band hides its words', () => {
    const root = bar(fakeOverlay());
    expect(button(root, 'Trace skyline')).not.toBeNull();
    expect(button(root, 'Blink')).not.toBeNull();
  });

  it('keeps the fit whole however narrow the band, its neighbours giving up their words first', () => {
    const source = readFileSync(resolve('src/tools/horizon/OverlayBar.svelte'), 'utf8');
    const style = source.slice(source.indexOf('<style>'));
    const reading = style.slice(style.indexOf('.reading {'), style.indexOf('}', style.indexOf('.reading {')));
    expect(reading).toContain('flex: none');
    expect(reading).not.toContain('overflow: hidden');
  });

  it('keeps how the ground is drawn in a menu of its own, off the photo', () => {
    const view = { ground: 'relief', lines: true, setGround: vi.fn(), setLines: vi.fn(), releases: [], placed: null };
    const root = bar(fakeOverlay(), { view });
    const open = [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-controls') === 'hz-photo-ground');
    expect(open.textContent).toContain('Relief');
    expect(root.querySelector('#hz-photo-ground')).toBeNull();
    open.click();
    flushSync();
    const menu = root.querySelector('#hz-photo-ground');
    [...menu.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Plain').click();
    expect(view.setGround).toHaveBeenCalledWith('plain');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(root.querySelector('#hz-photo-ground')).toBeNull();
    // without the view's state the band offers no such menu
    const bare = bar(fakeOverlay());
    expect([...bare.querySelectorAll('button')].some((b) => b.getAttribute('aria-controls') === 'hz-photo-ground')).toBe(false);
    expect([...bare.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Ridge lines')).toBe(false);
  });

  it('keeps the ridge lines on the band itself, and the imagery open in the ground menu', () => {
    const view = {
      ground: 'imagery',
      lines: true,
      setGround: vi.fn(),
      setLines: vi.fn(),
      drapeSource: 'esri-world-imagery',
      releases: [],
      releasesBusy: false,
      nearOn: false,
      nearReach: 5000,
      nearEstimate: null,
      nearPasses: [],
      placed: null,
    };
    const root = bar(fakeOverlay(), { view });
    const lines = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ridge lines');
    expect(lines.getAttribute('aria-pressed')).toBe('true');
    // ticked like the switch on the view without a photo, so it reads as one
    expect(lines.querySelector('.box svg')).not.toBeNull();
    lines.click();
    expect(view.setLines).toHaveBeenCalledWith(false);
    [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-controls') === 'hz-photo-ground').click();
    flushSync();
    const menu = root.querySelector('#hz-photo-ground');
    // one switch for the lines, the band's: the menu is how the ground is drawn
    expect([...menu.querySelectorAll('button')].some((b) => b.textContent.includes('Ridge lines'))).toBe(false);
    // already a menu, it lays the imagery open rather than folding it under another button
    expect(menu.querySelector('[aria-label="Which imagery"]')).not.toBeNull();
    expect(menu.querySelector('[aria-controls="hz-imagery"]')).toBeNull();
  });

  it('locks the photo to the terrain, and then offers no fit and no reshape', () => {
    const overlay = fakeOverlay();
    const root = bar(overlay);
    const lock = button(root, 'Lock the photo to the terrain');
    expect(lock.textContent.trim()).toBe('Lock');
    lock.click();
    expect(overlay.setLocked).toHaveBeenCalledWith(true);
    const held = bar(fakeOverlay({ locked: true, warped: true }), { gap: { median: 0.4, span: 52, offset: 0.1, points: 40 } });
    expect(button(held, 'Lock the photo to the terrain').getAttribute('aria-pressed')).toBe('true');
    expect(button(held, 'Lock the photo to the terrain').textContent.trim()).toBe('Locked');
    expect(button(held, 'Fit to trace').disabled).toBe(true);
    expect(button(held, 'Reshape the photo').disabled).toBe(true);
    expect(button(held, 'Square the photo again').disabled).toBe(true);
  });
});
