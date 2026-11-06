import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FPS, FRAME_PX, SPEEDS, captureMoment, clampTime, clampWindow, faster, followWindow, frameDuration,
  frameGrid, frameIndex, histogram, isWholeWindow, loopIsSet, loopRestart, narrowestSpan, panWindow,
  preciseClock, seekInto, setLoopEnd, shownFrameTime, slower, sortedMarks, speedLabel, stepTarget, tileAt,
  tileScale, tileStyle, waveformBars, waveformColumns, wheelFactor, wholeWindow, windowFraction, windowTime,
  zoomLabel, zoomWindow,
} from './inspectPlayer.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('the frame on screen', () => {
  it('names a frame by its own timestamp, wherever inside it the clip was paused', () => {
    // frame 12 of a 25 fps clip runs from 0.48 to 0.52
    expect(frameIndex(0.48, 25)).toBe(12);
    expect(frameIndex(0.5, 25)).toBe(12);
    expect(frameIndex(0.5199, 25)).toBe(12);
    expect(near(shownFrameTime(0.5, 25), 0.48)).toBe(true);
  });

  it('takes the timestamp the browser drew over the one worked out from the rate', () => {
    expect(shownFrameTime(0.5, 25, 0.4871)).toBe(0.4871);
    expect(near(shownFrameTime(0.5, 25, null), 0.48)).toBe(true);
  });

  it('works the frame out when the browser only echoes the playback time back', () => {
    // Firefox, paused after a seek, reports the time it was given
    expect(near(shownFrameTime(0.5, 25, 0.5), 0.48)).toBe(true);
  });

  it('asks the server about the moment itself, or the frame stamp the browser gave', () => {
    expect(captureMoment(0.5, 0.48)).toBe(0.48);
    expect(captureMoment(0.5, 0.5)).toBe(0.5);
    expect(captureMoment(0.5, null)).toBe(0.5);
    expect(captureMoment(-2, null)).toBe(0);
  });

  it('is not thrown to the frame before by a timestamp a hair under its start', () => {
    // 29.97 fps: frame 2 starts at 2 × 1001/30000, a value no double holds exactly
    const fps = 30000 / 1001;
    expect(frameIndex((2 * 1001) / 30000, fps)).toBe(2);
    expect(frameIndex((3 * 1001) / 30000 - 1e-12, fps)).toBe(3);
  });

  it('steps a clip with no rate on record at 30 fps', () => {
    expect(frameDuration(null)).toBe(1 / DEFAULT_FPS);
    expect(frameDuration(0)).toBe(1 / DEFAULT_FPS);
  });
});

describe('seeking', () => {
  it('lands half a frame into the frame it shows', () => {
    expect(near(seekInto(0.48, 25), 0.5)).toBe(true);
  });

  it('steps one frame from the frame on screen, never from where inside it the clip sat', () => {
    const d = frameDuration(25);
    expect(near(stepTarget(0.48, d, 25), 0.54)).toBe(true);
    expect(near(stepTarget(0.48, -d, 25), 0.46)).toBe(true);
    expect(frameIndex(stepTarget(0.48, d, 25), 25)).toBe(13);
    expect(frameIndex(stepTarget(0.48, -d, 25), 25)).toBe(11);
  });

  it('stays inside the clip at both ends', () => {
    expect(stepTarget(0, -1, 25, 10)).toBe(0);
    expect(stepTarget(9.96, 1, 25, 10)).toBeLessThan(10);
    expect(clampTime(-3, 25, 10)).toBe(0);
    expect(clampTime(5, 25, 0)).toBe(5);
  });
});

describe('the clock', () => {
  it('reads to the millisecond, with hours only past an hour', () => {
    expect(preciseClock(0)).toBe('0:00.000');
    expect(preciseClock(12.4)).toBe('0:12.400');
    expect(preciseClock(83.0456)).toBe('1:23.046');
    expect(preciseClock(3723.4)).toBe('1:02:03.400');
    expect(preciseClock(-1)).toBe('0:00.000');
  });
});

describe('speed', () => {
  it('walks the list one step at a time and stops at either end', () => {
    expect(slower(1)).toBe(0.5);
    expect(slower(SPEEDS[0])).toBe(SPEEDS[0]);
    expect(faster(1)).toBe(2);
    expect(faster(SPEEDS.at(-1))).toBe(SPEEDS.at(-1));
    expect(speedLabel(0.25)).toBe('0.25×');
  });

  it('finds its place from a speed that is not on the list', () => {
    expect(slower(0.3)).toBe(0.25);
    expect(faster(0.3)).toBe(0.5);
  });
});

describe('the A–B loop', () => {
  it('needs both ends, A before B', () => {
    let loop = { a: null, b: null };
    loop = setLoopEnd(loop, 'a', 2);
    expect(loopIsSet(loop)).toBe(false);
    loop = setLoopEnd(loop, 'b', 5);
    expect(loop).toEqual({ a: 2, b: 5 });
    expect(loopIsSet(loop)).toBe(true);
  });

  it('starts at the beginning when B comes first', () => {
    expect(setLoopEnd({ a: null, b: null }, 'b', 4)).toEqual({ a: 0, b: 4 });
  });

  it('drops the end an out-of-order press would put behind the other', () => {
    expect(setLoopEnd({ a: 2, b: 5 }, 'a', 6)).toEqual({ a: 6, b: null });
    expect(setLoopEnd({ a: 2, b: 5 }, 'b', 1)).toEqual({ a: 2, b: null });
  });

  it('jumps back to A once playback reaches B, and not before', () => {
    expect(loopRestart(4.9, { a: 2, b: 5 })).toBe(null);
    expect(loopRestart(5, { a: 2, b: 5 })).toBe(2);
    expect(loopRestart(7, { a: 2, b: null })).toBe(null);
  });
});

describe('the bar', () => {
  it('places a moment along the clip, or the window the bar is zoomed to', () => {
    expect(windowFraction(5, wholeWindow(20))).toBe(0.25);
    expect(windowFraction(5, wholeWindow(0))).toBe(0);
    // zoomed to 4 s – 6 s: a moment outside it sits beyond either end
    const win = { start: 4, span: 2 };
    expect(windowFraction(5, win)).toBe(0.5);
    expect(windowFraction(3, win)).toBe(-0.5);
    expect(windowFraction(7, win)).toBe(1.5);
    expect(windowTime(0.25, win)).toBe(4.5);
  });

  it('picks the hover picture the strip holds for a time', () => {
    const tiles = { count: 25, columns: 10, rows: 3, width: 160, height: 90, interval: 2 };
    expect(tileAt(0, tiles)).toEqual({ index: 0, col: 0, row: 0 });
    expect(tileAt(23, tiles)).toEqual({ index: 11, col: 1, row: 1 });
    expect(tileAt(999, tiles)).toEqual({ index: 24, col: 4, row: 2 });
    expect(tileAt(5, null)).toBe(null);
    expect(tileStyle(tileAt(23, tiles), tiles, '/strip')).toContain('background-position:-160px -90px');
  });

  it('keeps a hover picture inside its bounds, a portrait clip\'s too, and never grows one', () => {
    const most = { w: 160, h: 96 };
    const wide = { count: 25, columns: 10, rows: 3, width: 160, height: 90, interval: 2 };
    expect(tileScale(wide, most)).toBe(1);
    expect(tileStyle(tileAt(23, wide), wide, '/strip', most)).toBe(
      'background-image:url("/strip");background-size:1600px 270px;background-position:-160px -90px;width:160px;height:90px',
    );
    // a 9:16 clip: the strip draws its tiles 160 by 284, shown 54 by 96
    const tall = { ...wide, height: 284 };
    const k = 96 / 284;
    expect(tileScale(tall, most)).toBeCloseTo(k, 9);
    const style = tileStyle(tileAt(23, tall), tall, '/strip', most);
    expect(style).toContain('width:54.08px;height:96px');
    expect(style).toContain(`background-size:${Math.round(1600 * k * 100) / 100}px ${Math.round(3 * 96 * 100) / 100}px`);
    expect(style).toContain(`background-position:-54.08px -96px`);
    // no bound, the tile's own size
    expect(tileScale(tall)).toBe(1);
    expect(tileScale({ width: 0, height: 0 }, most)).toBe(1);
  });

  it('scales the waveform to its loudest moment and keeps silence flat', () => {
    expect(waveformBars([0.1, 0.2, 0.05])).toEqual([0.5, 1, 0.25]);
    expect(waveformBars([0, 0])).toEqual([0, 0]);
    expect(waveformBars(null)).toEqual([]);
  });

  it('lays the waveform along the bar, and stretches the part a zoomed window shows', () => {
    const bars = [0.1, 0.2, 0.3, 0.4, 0.5];
    // 10 s on 100 px: a bar every 2 s, 20 px wide
    expect(waveformColumns(bars, 10, wholeWindow(10), 100)).toEqual(
      bars.map((level, i) => ({ x: i * 20, w: 20, level })),
    );
    // 3 s – 5 s: the second bar from a half off the left, the third over the rest
    expect(waveformColumns(bars, 10, { start: 3, span: 2 }, 100)).toEqual([
      { x: -50, w: 100, level: 0.2 },
      { x: 50, w: 100, level: 0.3 },
    ]);
    expect(waveformColumns([], 10, wholeWindow(10), 100)).toEqual([]);
    expect(waveformColumns(bars, 0, wholeWindow(0), 100)).toEqual([]);
  });
});

describe('the bar zoomed', () => {
  // 25 fps: a frame is 40 ms
  const fps = 25;

  it('zooms down to frames drawn a few pixels wide, never past the whole clip', () => {
    // 1000 px: the deepest window holds 1000 / 24 frames
    expect(narrowestSpan(60, fps, 1000)).toBeCloseTo((1000 / FRAME_PX) * 0.04, 9);
    // a clip whose frames are already that wide has nothing to zoom
    expect(narrowestSpan(1.2, fps, 1000)).toBe(1.2);
    // a bar not measured yet bounds nothing
    expect(narrowestSpan(60, fps, 0)).toBe(0);
  });

  it('keeps the moment under the pointer where it is', () => {
    const whole = wholeWindow(60);
    // the pointer a quarter along, on 15 s: twice as deep, 15 s still a quarter along
    const twice = zoomWindow(whole, 0.5, 15, 0.25, 60);
    expect(twice).toEqual({ start: 7.5, span: 30 });
    expect(windowFraction(15, twice)).toBe(0.25);
    // a window that would overhang the clip is slid back inside it
    expect(zoomWindow(whole, 0.5, 2, 0.9, 60)).toEqual({ start: 0, span: 30 });
    expect(zoomWindow({ start: 50, span: 10 }, 2, 58, 0.8, 60)).toEqual({ start: 40, span: 20 });
  });

  it('stops at its deepest, and comes back to the whole clip', () => {
    const least = narrowestSpan(60, fps, 1000);
    let win = wholeWindow(60);
    for (let i = 0; i < 40; i += 1) win = zoomWindow(win, wheelFactor(-100), 30, 0.5, 60, least);
    expect(win.span).toBeCloseTo(least, 9);
    expect(win.start).toBeCloseTo(30 - least / 2, 9);
    for (let i = 0; i < 40; i += 1) win = zoomWindow(win, wheelFactor(100), 30, 0.5, 60, least);
    expect(win).toEqual(wholeWindow(60));
    expect(isWholeWindow(win, 60)).toBe(true);
    expect(isWholeWindow(null, 60)).toBe(true);
    expect(isWholeWindow({ start: 0, span: 59 }, 60)).toBe(false);
  });

  it('zooms about one and a half times a wheel notch, and caps a burst', () => {
    expect(wheelFactor(-100)).toBeLessThan(0.7);
    expect(wheelFactor(-100)).toBeGreaterThan(0.6);
    expect(wheelFactor(100)).toBeCloseTo(1 / wheelFactor(-100), 9);
    expect(wheelFactor(-4000)).toBe(wheelFactor(-120));
    expect(wheelFactor(0)).toBe(1);
  });

  it('slides inside the clip, never past either end', () => {
    expect(panWindow({ start: 10, span: 5 }, 2, 60)).toEqual({ start: 12, span: 5 });
    expect(panWindow({ start: 10, span: 5 }, -20, 60)).toEqual({ start: 0, span: 5 });
    expect(panWindow({ start: 10, span: 5 }, 90, 60)).toEqual({ start: 55, span: 5 });
  });

  it('holds a window to the clip it is on', () => {
    expect(clampWindow(null, 60)).toEqual(wholeWindow(60));
    expect(clampWindow({ start: 58, span: 5 }, 60)).toEqual({ start: 55, span: 5 });
    expect(clampWindow({ start: 10, span: 0.5 }, 60, 2)).toEqual({ start: 10, span: 2 });
    expect(clampWindow({ start: 10, span: 90 }, 60)).toEqual(wholeWindow(60));
  });

  it('pages after the playhead once it runs off, and leaves the window be while it is inside', () => {
    const win = { start: 10, span: 5 };
    expect(followWindow(win, 12, 60)).toBe(win);
    expect(followWindow(win, 15, 60)).toBe(win);
    // run off the end: the next page, the playhead a tenth in
    expect(followWindow(win, 15.2, 60)).toEqual({ start: 14.7, span: 5 });
    // sent back before it, or near the clip's end
    expect(followWindow(win, 3, 60)).toEqual({ start: 2.5, span: 5 });
    expect(followWindow(win, 59, 60)).toEqual({ start: 55, span: 5 });
  });

  it('draws a line between frames once they are wide enough to tell apart', () => {
    // 2 s on 1000 px: a frame is 20 px; the window starts 10 ms into a frame
    const grid = frameGrid({ start: 1.01, span: 2 }, fps, 1000);
    expect(grid.size).toBeCloseTo(20, 9);
    expect(grid.offset).toBeCloseTo(-5, 9);
    // the whole minute: frames a third of a pixel, no lines
    expect(frameGrid(wholeWindow(60), fps, 1000)).toBe(null);
  });

  it('reads the zoom the way the player shows it', () => {
    expect(zoomLabel({ start: 0, span: 15 }, 60)).toBe('×4');
    expect(zoomLabel({ start: 0, span: 40 }, 60)).toBe('×1.5');
    expect(zoomLabel({ start: 0, span: 2.5 }, 60)).toBe('×24');
  });
});

describe('the histogram', () => {
  it('counts each channel and the luminance, leaving transparent pixels out', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 0, 255,
      9, 9, 9, 0,
    ]);
    const h = histogram(pixels);
    expect(h.r[255]).toBe(1);
    expect(h.r[0]).toBe(1);
    expect(h.g[0]).toBe(2);
    expect(h.r[9]).toBe(0);
    expect(h.l[54]).toBe(1); // pure red is dark to the eye
    expect(h.l[0]).toBe(1);
  });
});

describe('marks', () => {
  it('reads in playback order without reordering what it was given', () => {
    const marks = [{ id: 'b', time: 9 }, { id: 'a', time: 2 }];
    expect(sortedMarks(marks).map((m) => m.id)).toEqual(['a', 'b']);
    expect(marks[0].id).toBe('b');
  });
});
