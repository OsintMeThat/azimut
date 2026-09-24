// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: FrameViewer } = await import('./FrameViewer.svelte');

let live = null;
let target = null;

function show() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(FrameViewer, {
    target,
    props: {
      frame: { id: 'f1', url: 'blob:f1', w: 800, h: 600, crop: null, adjust: {} },
      preview: { filter: '', transform: '' },
    },
  });
  flushSync();
}

const viewport = () => target.querySelector('.viewport');
const angle = () => [...target.querySelectorAll('.val')].map((el) => el.textContent).find((t) => t.endsWith('°'));

function press(x, y, init = {}) {
  viewport().dispatchEvent(new window.PointerEvent('pointerdown', { button: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }));
}
function move(x, y, init = {}) {
  window.dispatchEvent(new window.PointerEvent('pointermove', { clientX: x, clientY: y, ...init }));
}
function release() {
  window.dispatchEvent(new window.PointerEvent('pointerup'));
  flushSync();
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

// Points on a wheel of radius 100 about (100, 100), clockwise degrees from east.
const on = (deg) => [100 + 100 * Math.cos((deg * Math.PI) / 180), 100 + 100 * Math.sin((deg * Math.PI) / 180)];

describe('turning a frame', () => {
  it('turns by the angle a middle drag sweeps about the grabbed point', () => {
    show();
    press(100, 100);
    move(...on(0)); // out of the circle: the wheel is taken here
    move(...on(20));
    move(...on(40));
    release();
    expect(angle()).toBe('40°');
  });

  it('holds inside the guide circle', () => {
    show();
    press(100, 100);
    move(110, 100);
    move(100, 115); // a quarter turn about the pivot, all inside the circle
    release();
    expect(angle()).toBeUndefined();
  });

  it('settles upright near zero, and on whole steps with Ctrl', () => {
    show();
    press(100, 100);
    move(...on(0));
    move(...on(2)); // 2°: pulled upright
    release();
    expect(angle()).toBeUndefined();

    press(100, 100);
    move(...on(0));
    move(...on(24), { ctrlKey: true }); // 24° laid on 30
    release();
    expect(angle()).toBe('30°');
  });

  it('stands the frame upright again on a middle click', () => {
    show();
    press(100, 100);
    move(...on(0));
    move(...on(40));
    release();
    expect(angle()).toBe('40°');
    press(300, 300);
    release();
    expect(angle()).toBeUndefined();
    expect(target.querySelector('.hint')?.textContent).toContain('middle-drag turns');
  });
});
