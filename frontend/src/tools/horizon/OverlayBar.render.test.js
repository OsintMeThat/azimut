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
    moves: 'terrain',
    setWarping: vi.fn(),
    resetWarp: vi.fn(),
    setLocked: vi.fn(),
    pressHand: vi.fn(),
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

  it('brings out the ridge pen, the pairing, the cuts and the magnet beside the skyline pen', () => {
    const overlay = fakeOverlay({
      strokes: [[{ u: 0, v: 0.5 }, { u: 1, v: 0.5 }], [{ u: 0, v: 0.6 }, { u: 0.5, v: 0.6 }]],
      pen: 'sky',
      magnet: true,
      linking: false,
      cutting: false,
      setPen: vi.fn(),
      setLinking: vi.fn(),
      setCutting: vi.fn(),
      setMagnet: vi.fn(),
    });
    const root = bar(overlay);
    button(root, 'Trace a ridge').click();
    expect(overlay.setPen).toHaveBeenCalledWith('ridge');
    button(root, 'Pair a line in front with one behind').click();
    expect(overlay.setLinking).toHaveBeenCalledWith(true);
    button(root, 'Cut the collage').click();
    expect(overlay.setCutting).toHaveBeenCalledWith(true);
    const magnet = button(root, 'Snap to edges');
    expect(magnet.getAttribute('aria-pressed')).toBe('true');
    magnet.click();
    expect(overlay.setMagnet).toHaveBeenCalledWith(false);
    // one line alone has nothing to pair with
    const alone = bar(fakeOverlay({ pen: 'sky', magnet: true }));
    expect(button(alone, 'Pair a line in front with one behind').disabled).toBe(true);
    expect(button(alone, 'Pair a line in front with one behind').title).toBe('Draw two lines first');
  });

  it('shows the trace’s details on a press, and the photo above the terrain on another', () => {
    const overlay = fakeOverlay({ details: false, setDetails: vi.fn() });
    const onside = vi.fn();
    const root = bar(overlay, { onside });
    const details = button(root, 'Details');
    expect(details.getAttribute('aria-pressed')).toBe('false');
    expect(details.title).toMatch(/^Show how far the terrain may be off/);
    details.click();
    expect(overlay.setDetails).toHaveBeenCalledWith(true);
    button(root, 'Side by side').click();
    expect(onside).toHaveBeenCalledOnce();
    // while the two are being drawn, a second press waits
    const busy = bar(fakeOverlay(), { siding: true });
    expect(button(busy, 'Side by side').disabled).toBe(true);
    const shown = bar(fakeOverlay({ details: true, setDetails: vi.fn() }));
    expect(button(shown, 'Details').getAttribute('aria-pressed')).toBe('true');
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
      'Drag → Move what a hand is lit beside: the photo, the terrain or both',
      'Wheel → Zoom it, or pinch',
      'Shift+wheel → Change the lens',
      'Shift+drag → Roll the terrain about the pivot',
      'Shift+click → Set the pivot',
      'Alt+wheel → Change the eye height',
      'Space+drag → Move both, or the middle button',
      'Space+wheel → Look closer at both',
      'L → Move both, or back to one alone',
      'Alt+drag → Draw the other way, snapped or not',
      'R → Draw a ridge seen against farther land',
      'P → Pair a line in front with the line behind it',
      'X → Cut a collage where its frames meet',
      'M → Snap to edges, or not',
      'E → Rub out',
      'H → Hide or show the trace',
      'D → Show how far the terrain may be off, the cuts and the pairs',
      'Ctrl+Z → Take the last change back',
      'W → Reshape the photo by its corners and edges',
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

  it('says the photo lies as the search read it, and lays it flat on a press', () => {
    expect(button(bar(fakeOverlay()), 'Lay the photo flat')).toBeNull();
    const layFlat = vi.fn();
    const root = bar(fakeOverlay({ asSearched: { kind: 'frames' }, layFlat }));
    const laid = button(root, 'Lay the photo flat');
    expect(laid.textContent).toContain('As searched');
    expect(laid.title).toBe('Each frame of the collage where the search read it: press to lay the photo flat');
    laid.click();
    expect(layFlat).toHaveBeenCalledOnce();
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

  it('keeps every button’s name when the band hides its words', () => {
    const root = bar(fakeOverlay());
    expect(button(root, 'Trace skyline')).not.toBeNull();
    expect(button(root, 'Blink')).not.toBeNull();
  });

  it('gives up its words a step at a time, by what overflows, until its last button fits', async () => {
    const steps = (el) => [1, 2, 3, 4, 5, 6].filter((n) => el.classList.contains(`t${n}`)).length;
    let full = 1200;
    const isBar = (el) => el.classList?.contains('overlay-bar');
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return isBar(this) ? 800 : 0;
    });
    // each step takes 150 px of words away
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return isBar(this) ? full - 150 * steps(this) : 0;
    });
    try {
      const settle = () => new Promise((done) => setTimeout(done, 0));
      const wide = bar(fakeOverlay());
      await settle();
      const toolbar = wide.querySelector('.overlay-bar');
      // 1200 → 1050 → 900 → 750: the third step is the first that fits in 800
      expect(steps(toolbar)).toBe(3);
      // past every step the band takes a second row rather than hide a button
      full = 2000;
      const crowded = bar(fakeOverlay());
      await settle();
      expect(steps(crowded.querySelector('.overlay-bar'))).toBe(6);
      full = 700;
      const roomy = bar(fakeOverlay());
      await settle();
      expect(steps(roomy.querySelector('.overlay-bar'))).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps the fit whole however narrow the band, its neighbours giving up their words first', () => {
    const source = readFileSync(resolve('src/tools/horizon/OverlayBar.svelte'), 'utf8');
    const style = source.slice(source.indexOf('<style>'));
    const reading = style.slice(style.indexOf('.reading {'), style.indexOf('}', style.indexOf('.reading {')));
    expect(reading).toContain('flex: none');
    expect(reading).not.toContain('overflow: hidden');
  });

  it('names the photo and the terrain once, a hand beside each saying which a drag moves', () => {
    const overlay = fakeOverlay();
    const root = bar(overlay);
    // the slider's two ends, each with its hand outside it
    const order = [...root.querySelectorAll('.overlay-bar > button, .overlay-bar > .zone.fade > button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent.trim()
    );
    expect(order.slice(0, 4)).toEqual(['Move the photo', 'Photo', 'Terrain', 'Move the terrain']);
    expect(root.querySelector('[role="radiogroup"]')).toBeNull();
    expect(button(root, 'Move the terrain').getAttribute('aria-pressed')).toBe('true');
    expect(button(root, 'Move the terrain').title).toBe('Drag and the wheel move the terrain');
    expect(button(root, 'Move the photo').getAttribute('aria-pressed')).toBe('false');
    expect(button(root, 'Move the photo').title).toMatch(/^Move the photo too, both held together \(L\)/);
    button(root, 'Move the photo').click();
    expect(overlay.pressHand).toHaveBeenCalledWith('photo');
    button(root, 'Move the terrain').click();
    expect(overlay.pressHand).toHaveBeenCalledWith('terrain');
    // a press on a name still shows that side alone
    [...root.querySelectorAll('.end')].find((b) => b.textContent.trim() === 'Terrain').click();
    expect(overlay.setMix).toHaveBeenCalledWith(0);
    const video = bar(fakeOverlay({ source: { kind: 'video', name: 'clip.mp4' }, moves: 'photo' }));
    expect(button(video, 'Move the video').getAttribute('aria-pressed')).toBe('true');
    expect(button(video, 'Move the terrain').getAttribute('aria-pressed')).toBe('false');
  });

  it('lights both hands to move both, which offers no fit and no reshape', () => {
    const held = bar(fakeOverlay({ locked: true, moves: 'both', warped: true }), { gap: { median: 0.4, span: 52, offset: 0.1, points: 40 } });
    expect(button(held, 'Move the photo').getAttribute('aria-pressed')).toBe('true');
    expect(button(held, 'Move the terrain').getAttribute('aria-pressed')).toBe('true');
    expect(button(held, 'Move the photo').title).toBe('Drag and the wheel move both, held together (L)');
    expect(button(held, 'Fit to trace').disabled).toBe(true);
    expect(button(held, 'Reshape the photo').disabled).toBe(true);
    expect(button(held, 'Square the photo again').disabled).toBe(true);
  });

  it('leaves how the ground is drawn to the view', () => {
    const view = { camera: { heading: 0, tilt: 0, fov: 60 }, ground: 'relief', lines: true, setGround: vi.fn(), setLines: vi.fn() };
    const root = bar(fakeOverlay(), { view, gap: { median: 0.4, span: 52, offset: 0.1, points: 40 } });
    const words = [...root.querySelectorAll('button')].map((b) => b.textContent.trim());
    for (const word of ['Ridge lines', 'Relief', 'Satellite', 'Plain']) expect(words).not.toContain(word);
  });
});

describe('a panorama on the band', () => {
  it('holds the photo’s hand and Reshape: a panorama turns with the terrain alone', () => {
    const root = bar(fakeOverlay({ isPanorama: true }));
    expect(button(root, 'Move the photo').disabled).toBe(true);
    expect(button(root, 'Move the photo').title).toBe('A panorama stays put: turn the terrain under it');
    expect(button(root, 'Move the terrain').disabled).toBe(false);
    expect(button(root, 'Reshape the photo').disabled).toBe(true);
    expect(button(root, 'Reshape the photo').title).toBe('A panorama keeps its shape');
  });
});
