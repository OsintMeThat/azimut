import { describe, expect, it } from 'vitest';
import { createWheelKind, TRACKPAD_ZOOM_RATE, WHEEL_NOTCH, WHEEL_ZOOM_RATE, wheelLevels, wheelValue } from './wheel.js';

describe('the wheel, read as the flat map reads it', () => {
  it('counts a line as 40 and slows to a quarter under Shift', () => {
    expect(wheelValue({ deltaMode: 1, deltaY: 3 })).toBe(120);
    expect(wheelValue({ deltaMode: 0, deltaY: 100, shiftKey: true })).toBe(25);
  });

  it('tells a mouse from a trackpad, one gesture at a time', () => {
    let clock = 0;
    const kind = createWheelKind(() => clock);
    // a notch on the macOS grid is a mouse, whatever its size
    expect(kind(WHEEL_NOTCH * 2)).toBe('wheel');
    clock += 1000;
    // a sliver is a trackpad
    expect(kind(2.5)).toBe('trackpad');
    clock += 1000;
    // otherwise the gesture's first event decides for the rest of it
    expect(kind(120)).toBe('wheel');
    clock += 30;
    expect(kind(12)).toBe('wheel');
    clock += 1000;
    expect(kind(12)).toBe('trackpad');
  });

  it('zooms a notch about a level and a sliver a little, as the engine works it out', () => {
    const level = (delta, rate) => Math.log2(2 / (1 + Math.exp(-Math.abs(delta * rate))));
    expect(wheelLevels(100, 'wheel')).toBeCloseTo(level(100, WHEEL_ZOOM_RATE), 9);
    expect(wheelLevels(100, 'wheel')).toBeGreaterThan(0.99);
    expect(wheelLevels(-100, 'wheel')).toBeCloseTo(-level(100, WHEEL_ZOOM_RATE), 9);
    expect(wheelLevels(3, 'trackpad')).toBeCloseTo(level(3, TRACKPAD_ZOOM_RATE), 9);
    // a single small notch zooms at the trackpad's rate, as the engine does
    expect(wheelLevels(WHEEL_NOTCH, 'wheel')).toBeCloseTo(level(WHEEL_NOTCH, TRACKPAD_ZOOM_RATE), 9);
    expect(wheelLevels(0, 'wheel')).toBe(0);
  });
});
