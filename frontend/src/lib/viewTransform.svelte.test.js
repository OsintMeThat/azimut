// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ZOOM, ViewTransform } from './viewTransform.svelte.js';

const RECT = { left: 0, top: 0, width: 400, height: 300 };
const wheel = (deltaY, x = 200, y = 150) => ({ deltaY, clientX: x, clientY: y });

afterEach(() => vi.restoreAllMocks());

describe('zoom', () => {
  it('zooms toward the pointer, keeping the point under it in place', () => {
    const view = new ViewTransform();
    view.wheel(wheel(-1, 300, 150), RECT);
    expect(view.zoom).toBeCloseTo(1.1);
    // the point 100 px right of centre stays put: pan absorbs the growth
    expect(view.pan.x).toBeCloseTo(-10);
    expect(view.pan.y).toBeCloseTo(0);
    expect(view.dirty).toBe(true);
  });

  it('never goes below the fitted size, and snaps back to centre there', () => {
    const view = new ViewTransform();
    view.wheel(wheel(-1, 300, 100), RECT);
    view.wheel(wheel(1), RECT);
    view.wheel(wheel(1), RECT);
    expect(view.zoom).toBe(1);
    expect(view.pan).toEqual({ x: 0, y: 0 });
    expect(view.dirty).toBe(false);
  });

  it('stops at its ceiling', () => {
    const view = new ViewTransform();
    for (let i = 0; i < 60; i += 1) view.wheel(wheel(-1), RECT);
    expect(view.zoom).toBe(MAX_ZOOM);
  });
});

describe('pan and click', () => {
  const press = (x, y) => ({ clientX: x, clientY: y });
  const send = (type, x, y) => window.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y }));

  it('pans with a drag and does not take it as a click', () => {
    const view = new ViewTransform();
    const onclick = vi.fn();
    view.panFrom(press(10, 10), { onclick });
    send('pointermove', 40, 25);
    send('pointerup', 40, 25);
    expect(view.pan).toEqual({ x: 30, y: 15 });
    expect(onclick).not.toHaveBeenCalled();
  });

  it('takes a press that never moved as a click, and leaves the view alone', () => {
    const view = new ViewTransform();
    const onclick = vi.fn();
    view.panFrom(press(10, 10), { onclick });
    send('pointermove', 12, 11);
    send('pointerup', 12, 11);
    expect(onclick).toHaveBeenCalledTimes(1);
    expect(view.pan).toEqual({ x: 0, y: 0 });
  });

  it('puts zoom, pan and turn back in one reset', () => {
    const view = new ViewTransform();
    view.wheel(wheel(-1, 50, 50), RECT);
    view.matrix = [0, 1, -1, 0, 0, 0];
    expect(view.angle).toBe(90);
    view.reset();
    expect(view.dirty).toBe(false);
    expect(view.angle).toBe(0);
  });
});
