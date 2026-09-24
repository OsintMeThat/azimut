import { describe, it, expect } from 'vitest';
import { beyondGuide, keyTurn, pivotPanOffset, stepBearing, sweepDelta, turnBearing, TURN_RADIUS } from './turn.js';

const key = (k, mods = {}) => ({ key: k, shiftKey: true, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('sweepDelta', () => {
  const pivot = { x: 100, y: 100 };

  it('reads the angle swept about the pivot, clockwise positive', () => {
    // east of the pivot to south of it is a quarter turn clockwise on screen
    expect(sweepDelta(pivot, { x: 200, y: 100 }, { x: 100, y: 200 })).toBeCloseTo(90, 9);
    expect(sweepDelta(pivot, { x: 200, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(-90, 9);
  });

  it('keeps going the way the hand went across the back of the circle', () => {
    // just past west, either side: a small step, not most of a turn back
    expect(sweepDelta(pivot, { x: 0, y: 99 }, { x: 0, y: 101 })).toBeCloseTo(-2 * (180 / Math.PI) * Math.atan(1 / 100), 6);
    expect(sweepDelta(pivot, { x: 0, y: 101 }, { x: 0, y: 99 })).toBeGreaterThan(0);
  });

  it('reads nothing inside the guide circle, where a pixel is a huge angle', () => {
    expect(sweepDelta(pivot, { x: 110, y: 100 }, { x: 100, y: 110 })).toBeNull();
    expect(sweepDelta(pivot, { x: 100 + TURN_RADIUS, y: 100 }, { x: 105, y: 100 })).toBeNull();
    expect(beyondGuide(pivot, { x: 100 + TURN_RADIUS, y: 100 })).toBe(true);
    expect(beyondGuide(pivot, { x: 100 + TURN_RADIUS - 1, y: 100 })).toBe(false);
  });
});

describe('turnBearing', () => {
  it('adds the angle swept, and wraps past a full turn', () => {
    expect(turnBearing(30, 40)).toBeCloseTo(70, 9);
    expect(turnBearing(350, 20)).toBeCloseTo(10, 9);
    expect(turnBearing(10, -40)).toBeCloseTo(330, 9);
    expect(turnBearing(0, 720 + 90)).toBeCloseTo(90, 9); // several turns of the wheel
  });

  it('settles on north when it comes close, from either side', () => {
    expect(turnBearing(10, -8)).toBe(0);
    expect(turnBearing(350, 8)).toBe(0);
    expect(turnBearing(10, -6)).toBeCloseTo(4, 9); // just outside
  });

  it('lays the turn on whole steps when stepped', () => {
    expect(turnBearing(0, 20, { stepped: true })).toBe(15);
    expect(turnBearing(0, 24, { stepped: true })).toBe(30);
    expect(turnBearing(10, -12, { stepped: true })).toBe(0); // -2° → 0, not 360
  });
});

describe('stepBearing', () => {
  it('moves a whole step from a clean reading', () => {
    expect(stepBearing(0, 1)).toBe(15);
    expect(stepBearing(0, -1)).toBe(345);
    expect(stepBearing(345, 1)).toBe(0);
  });

  it('goes to the nearer step that way from an angle between steps', () => {
    expect(stepBearing(7, 1)).toBe(15);
    expect(stepBearing(7, -1)).toBe(0);
    expect(stepBearing(29.9999999999, 1)).toBe(45); // float noise on 30 is 30
  });
});

describe('keyTurn', () => {
  it('reads Shift and the arrows: left and right step, up is north', () => {
    expect(keyTurn(key('ArrowRight'), 0)).toEqual({ to: 15 });
    expect(keyTurn(key('ArrowLeft'), 0)).toEqual({ to: 345 });
    expect(keyTurn(key('ArrowUp'), 123)).toEqual({ to: 0 });
  });

  it('leaves bare arrows, other keys and other modifiers alone', () => {
    expect(keyTurn(key('ArrowRight', { shiftKey: false }), 0)).toBeNull();
    expect(keyTurn(key('ArrowDown'), 0)).toBeNull();
    expect(keyTurn(key('e'), 0)).toBeNull();
    expect(keyTurn(key('ArrowLeft', { ctrlKey: true }), 0)).toBeNull();
    expect(keyTurn(key('ArrowLeft', { altKey: true }), 0)).toBeNull();
  });
});

describe('pivotPanOffset', () => {
  it('cancels the drift so panBy re-pins the pivot under the grab point', () => {
    // A pan shifts container points by -offset; panning by (now-grab) moves
    // the drifted pivot (now) back onto grab.
    const grab = { x: 120, y: 80 };
    const now = { x: 135, y: 60 };
    const [dx, dy] = pivotPanOffset(grab, now);
    expect([dx, dy]).toEqual([15, -20]);
    expect(now.x - dx).toBe(grab.x);
    expect(now.y - dy).toBe(grab.y);
  });

  it('is zero when the pivot did not drift', () => {
    expect(pivotPanOffset({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual([0, 0]);
  });
});
