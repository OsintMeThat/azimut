import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FPS, SPEEDS, barFraction, captureMoment, clampTime, faster, frameDuration, frameIndex, histogram,
  loopIsSet, loopRestart, preciseClock, seekInto, setLoopEnd, shownFrameTime, slower,
  sortedMarks, speedLabel, stepTarget, tileAt, tileStyle, waveformBars,
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
  it('places a moment along the clip', () => {
    expect(barFraction(5, 20)).toBe(0.25);
    expect(barFraction(30, 20)).toBe(1);
    expect(barFraction(5, 0)).toBe(0);
  });

  it('picks the hover picture the strip holds for a time', () => {
    const tiles = { count: 25, columns: 10, rows: 3, width: 160, height: 90, interval: 2 };
    expect(tileAt(0, tiles)).toEqual({ index: 0, col: 0, row: 0 });
    expect(tileAt(23, tiles)).toEqual({ index: 11, col: 1, row: 1 });
    expect(tileAt(999, tiles)).toEqual({ index: 24, col: 4, row: 2 });
    expect(tileAt(5, null)).toBe(null);
    expect(tileStyle(tileAt(23, tiles), tiles, '/strip')).toContain('background-position:-160px -90px');
  });

  it('scales the waveform to its loudest moment and keeps silence flat', () => {
    expect(waveformBars([0.1, 0.2, 0.05])).toEqual([0.5, 1, 0.25]);
    expect(waveformBars([0, 0])).toEqual([0, 0]);
    expect(waveformBars(null)).toEqual([]);
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
