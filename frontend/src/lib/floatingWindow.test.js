// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { dragWindow, fitWindow, MARGIN, resizeWindow, savedWindow, saveWindow } from './floatingWindow.js';

const BOUNDS = { w: 1000, h: 700 };
const MIN = { w: 300, h: 150 };
const WINDOW = { x: 100, y: 400, w: 600, h: 220 };

describe('a floating window', () => {
  it('stays whole inside the map', () => {
    expect(fitWindow({ x: -50, y: 900, w: 600, h: 220 }, BOUNDS, MIN)).toEqual({
      x: MARGIN, y: 700 - 220 - MARGIN, w: 600, h: 220,
    });
  });

  it('shrinks to a map smaller than it, never under its least size', () => {
    expect(fitWindow({ x: 0, y: 0, w: 2000, h: 2000 }, BOUNDS, MIN)).toEqual({
      x: MARGIN, y: MARGIN, w: 1000 - 2 * MARGIN, h: 700 - 2 * MARGIN,
    });
    expect(fitWindow({ x: 0, y: 0, w: 10, h: 10 }, BOUNDS, MIN)).toMatchObject({ w: 300, h: 150 });
  });

  it('follows a drag and stops at the edge', () => {
    expect(dragWindow(WINDOW, 50, -100, BOUNDS, MIN)).toEqual({ ...WINDOW, x: 150, y: 300 });
    expect(dragWindow(WINDOW, 5000, 0, BOUNDS, MIN).x).toBe(1000 - 600 - MARGIN);
  });

  it('grows from its right and lower sides, as far as the map goes', () => {
    expect(resizeWindow(WINDOW, 'se', 100, 40, BOUNDS, MIN)).toEqual({ ...WINDOW, w: 700, h: 260 });
    expect(resizeWindow(WINDOW, 'e', 5000, 0, BOUNDS, MIN).w).toBe(1000 - 100 - MARGIN);
    expect(resizeWindow(WINDOW, 's', 0, -500, BOUNDS, MIN).h).toBe(150);
  });

  it('keeps its right side still when resized from the left', () => {
    const moved = resizeWindow(WINDOW, 'sw', -60, 0, BOUNDS, MIN);
    expect(moved.x + moved.w).toBe(WINDOW.x + WINDOW.w);
    expect(moved.x).toBe(40);
    const narrowest = resizeWindow(WINDOW, 'w', 900, 0, BOUNDS, MIN);
    expect(narrowest.w).toBe(300);
    expect(narrowest.x + narrowest.w).toBe(700);
  });
});

describe('where a window was left', () => {
  afterEach(() => localStorage.clear());

  it('is remembered per window, and a bad record is forgotten', () => {
    expect(savedWindow('profile')).toBeNull();
    saveWindow('profile', WINDOW);
    expect(savedWindow('profile')).toEqual(WINDOW);
    expect(savedWindow('other')).toBeNull();
    localStorage.setItem('azimut.window.profile', '{"x":"left"}');
    expect(savedWindow('profile')).toBeNull();
  });
});
