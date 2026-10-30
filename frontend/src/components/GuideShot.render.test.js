// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import GuideShot from './GuideShot.svelte';

let live;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const shot = {
  src: 'shot.webp',
  width: 1000,
  height: 600,
  anchors: {
    home: { x: 0, y: 0, w: 120, h: 40 },
    rail: { x: 0, y: 0, w: 60, h: 600 },
    tabs: { x: 60, y: 0, w: 400, h: 40 },
    map: { x: 60, y: 40, w: 940, h: 560 },
    menu: { x: 700, y: 300, w: 200, h: 200 },
  },
};
const mark = (anchor, opens) => ({ anchor, title: anchor, text: `${anchor}.`, ...(opens ? { opens } : {}) });

function show(marks, props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(GuideShot, { target, props: { shot, marks, ...props } });
  flushSync();
  return [...target.querySelectorAll('.pin')].map((pin) => ({ pin }));
}

describe('the numbers on a picture', () => {
  it('draws nothing for an anchor the picture did not measure', () => {
    expect(show([mark('home'), mark('gone')])).toHaveLength(1);
  });
});

describe('a picture with a film', () => {
  const filmed = { ...shot, film: 'shot.webm' };

  it('plays it in a silent loop, the picture as its poster', () => {
    show([], { shot: filmed });
    const video = document.querySelector('.shot video');
    expect(video.getAttribute('src')).toBe('shot.webm');
    expect(video.getAttribute('poster')).toBe('shot.webp');
    expect(video.loop && video.muted && video.autoplay).toBe(true);
    expect(document.querySelector('.shot img')).toBeNull();
  });

  it('shows the picture alone to a reader who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    show([], { shot: filmed });
    vi.unstubAllGlobals();
    expect(document.querySelector('.shot video')).toBeNull();
    expect(document.querySelector('.shot img').getAttribute('src')).toBe('shot.webp');
  });

  it('never plays one the picture does not have', () => {
    show([]);
    expect(document.querySelector('.shot video')).toBeNull();
  });
});

describe('a number that leads somewhere', () => {
  it('carries its tab and opens on a press, where a plain number does nothing', () => {
    const onopen = vi.fn();
    const pins = show([mark('home'), mark('menu', { shot: 'menu', lead: 'It opens.' })], { onopen });
    expect(pins[0].pin.classList.contains('leads')).toBe(false);
    expect(pins[1].pin.classList.contains('leads')).toBe(true);
    pins[0].pin.click();
    expect(onopen).not.toHaveBeenCalled();
    pins[1].pin.click();
    expect(onopen).toHaveBeenCalledWith(1);
  });
});
