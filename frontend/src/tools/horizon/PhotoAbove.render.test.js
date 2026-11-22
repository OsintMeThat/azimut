// @vitest-environment happy-dom
/**
 * The photo alone above the terrain while Side by side is on: drawn through
 * its loupe with the trace on it, moved and zoomed by the hand, which is
 * handed up to the view.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PhotoAbove from './PhotoAbove.svelte';

const SIZE = { width: 800, height: 400 };
const STROKE = [
  { u: 0.25, v: 0.5 },
  { u: 0.75, v: 0.25 },
];

let live = [];

function photo(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const on = { onmove: vi.fn(), onzoom: vi.fn(), onfit: vi.fn(), onpoint: vi.fn() };
  const component = mount(PhotoAbove, { target, props: { size: SIZE, trace: [STROKE], ridges: [true], ...on, ...props } });
  live.push(component);
  flushSync();
  const root = target.querySelector('.above');
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400 });
  return { root, ...on };
}

const pointer = (node, type, init) => {
  node.dispatchEvent(new window.PointerEvent(type, { bubbles: true, pointerId: 1, ...init }));
  flushSync();
};

afterEach(() => {
  for (const component of live) unmount(component);
  live = [];
  document.body.innerHTML = '';
});

describe('the photo alone above the terrain', () => {
  it('lays the trace on the photo as the loupe shows it, and offers the way back only once zoomed', () => {
    const whole = photo();
    expect(whole.root.querySelector('polyline.over').getAttribute('points')).toBe('200.0,200.0 600.0,100.0');
    expect(whole.root.querySelector('polyline.over').classList.contains('ridge')).toBe(true);
    expect(whole.root.querySelector('.zoom')).toBeNull();
    expect(whole.root.querySelector('.tag').textContent).toBe('Photo');

    // the right half of the photo, twice as big
    const closer = photo({ loupe: { zoom: 2, x: 0.75, y: 0.5 } });
    expect(closer.root.querySelectorAll('polyline.over')[0].getAttribute('points')).toBe('-400.0,200.0 400.0,0.0');
    expect(closer.root.querySelector('.zoom .mono').textContent).toBe('×2.0');
    closer.root.querySelector('.zoom button').click();
    expect(closer.onfit).toHaveBeenCalledOnce();
  });

  it('hands up a drag as it goes and the wheel about the pointer, and the pointer’s column', () => {
    const { root, onmove, onzoom, onpoint } = photo();
    root.setPointerCapture = vi.fn();
    pointer(root, 'pointermove', { clientX: 120, clientY: 50 });
    expect(onpoint).toHaveBeenCalledWith(120);
    pointer(root, 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    pointer(root, 'pointermove', { clientX: 80, clientY: 110 });
    expect(onmove).toHaveBeenCalledWith(-20, 10);
    expect(onpoint).toHaveBeenLastCalledWith(null);
    pointer(root, 'pointerup', {});
    // happy-dom's wheel takes no pointer place: it is handed one
    const wheel = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    Object.defineProperties(wheel, { clientX: { value: 300 }, clientY: { value: 150 } });
    root.dispatchEvent(wheel);
    flushSync();
    const [factor, at] = onzoom.mock.calls[0];
    expect(factor).toBeLessThan(1);
    expect(at).toEqual({ x: 300, y: 150 });
  });

  it('says whether the terrain follows, and draws the line from the terrain’s pointer', () => {
    expect(photo().root.getAttribute('aria-label')).toMatch(/locked: drag to move it, wheel to zoom, the terrain following/);
    const free = photo({ locked: false, what: 'Video', cross: 250 });
    expect(free.root.getAttribute('aria-label')).toBe('The video alone, unlocked: drag to move it, wheel to zoom');
    expect(free.root.querySelector('.cross').style.left).toBe('250px');
  });
});
