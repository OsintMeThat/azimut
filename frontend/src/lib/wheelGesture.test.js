import { describe, expect, it } from 'vitest';
import { WHEEL_STEP, readWheel } from './wheelGesture.js';

const ev = (init) => ({ deltaMode: 0, deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, ...init });

describe('what a wheel event asks of a canvas', () => {
  it('zooms a notch on a mouse wheel, in lines or in notches of 120', () => {
    expect(readWheel(ev({ deltaMode: 1, deltaY: 3 }))).toEqual({ kind: 'zoom', factor: 1 / WHEEL_STEP });
    expect(readWheel(ev({ deltaMode: 1, deltaY: -3 }))).toEqual({ kind: 'zoom', factor: WHEEL_STEP });
    expect(readWheel(ev({ deltaY: 100, wheelDeltaY: -120 }))).toEqual({ kind: 'zoom', factor: 1 / WHEEL_STEP });
    expect(readWheel(ev({ deltaY: -200, wheelDeltaY: 240 }))).toEqual({ kind: 'zoom', factor: WHEEL_STEP });
  });

  it('pans on two fingers, sideways too, by the pixels they moved', () => {
    expect(readWheel(ev({ deltaX: 6, deltaY: -14.5, wheelDeltaY: 43 }))).toEqual({ kind: 'pan', dx: -6, dy: 14.5 });
    expect(readWheel(ev({ deltaY: 8 }))).toEqual({ kind: 'pan', dx: -0, dy: -8 });
  });

  it('keeps a swipe a pan when one of its events happens to land on 120', () => {
    const memory = { pad: 0 };
    expect(readWheel(ev({ deltaY: 30, wheelDeltaY: -90 }), memory, 1000).kind).toBe('pan');
    expect(readWheel(ev({ deltaY: 40, wheelDeltaY: -120 }), memory, 1100).kind).toBe('pan');
    // a notch well after the swipe is the mouse again
    expect(readWheel(ev({ deltaY: 100, wheelDeltaY: -120 }), memory, 2000).kind).toBe('zoom');
  });

  it('zooms on a pinch by how far it went, and a notch at most for Ctrl with the wheel', () => {
    expect(readWheel(ev({ deltaY: -5, ctrlKey: true })).factor).toBeCloseTo(Math.exp(0.05));
    expect(readWheel(ev({ deltaY: 100, ctrlKey: true })).factor).toBeCloseTo(1 / WHEEL_STEP);
    expect(readWheel(ev({ deltaMode: 1, deltaY: 3, ctrlKey: true })).factor).toBeCloseTo(Math.exp(-0.1));
  });

  it('pans sideways on a mouse that scrolls in lines, and asks nothing of a still event', () => {
    expect(readWheel(ev({ deltaMode: 1, deltaX: 2 }))).toEqual({ kind: 'pan', dx: -40, dy: 0 });
    expect(readWheel(ev({}))).toBeNull();
  });
});
