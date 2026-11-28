// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import NewsReel from './NewsReel.svelte';

const REEL = [
  { shot: 'article-chart-kinds', from: [0.3, 0.4, 1.5], to: [0.3, 0.4, 1.6], seconds: 2, chip: 'Pick a chart' },
  { shot: 'inspect-scenes', ring: 'geo.pill', label: 'Geolocating', seconds: 3, chip: 'Inspect' },
];

let live = null;
let undo = [];

/** happy-dom lays nothing out: the reel is given the room What's new gives it. */
function sized(name, value) {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get() {
      return this.classList?.contains('reel') ? value : 0;
    },
  });
  return () => (own ? Object.defineProperty(HTMLElement.prototype, name, own) : delete HTMLElement.prototype[name]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  undo = [sized('clientWidth', 720), sized('clientHeight', 420)];
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  undo.forEach((restore) => restore());
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function show(reel, props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(NewsReel, { target, props: { reel, ...props } });
  flushSync();
}

const beats = () => [...document.querySelectorAll('.beat')];
const shown = () => beats().findIndex((beat) => beat.classList.contains('on'));
const chip = () => document.querySelector('.chip')?.textContent.trim();
const wait = (ms) => {
  vi.advanceTimersByTime(ms);
  flushSync();
};

describe('a reel', () => {
  it('plays its beats in turn and comes round again, the chip saying which', () => {
    show(REEL);
    expect(shown()).toBe(0);
    expect(chip()).toBe('1Pick a chart');
    wait(1990);
    expect(shown()).toBe(0);
    wait(20);
    expect(shown()).toBe(1);
    expect(chip()).toBe('2Inspect');
    wait(3000);
    expect(shown()).toBe(0);
  });

  it('brings a picture from its first framing to its last once shown', () => {
    show(REEL);
    const box = beats()[0].querySelector('.box');
    expect(box.style.getPropertyValue('--from')).toMatch(/scale\(1\.5\)/);
    expect(box.style.getPropertyValue('--to')).toMatch(/scale\(1\.6\)/);
    expect(beats()[0].classList.contains('go')).toBe(false);
    wait(40);
    expect(beats()[0].classList.contains('go')).toBe(true);
  });

  it('keeps the beat fading out on its last framing, not snapping back', () => {
    show(REEL);
    wait(2000);
    expect(beats()[0].classList.contains('go')).toBe(true);
    expect(beats()[0].classList.contains('on')).toBe(false);
    wait(500);
    expect(beats()[0].classList.contains('go')).toBe(false);
  });

  it('lights the control it names where the guide measured it, and names it', () => {
    show(REEL);
    const ring = beats()[1].querySelector('.ring');
    expect(ring.style.left).toMatch(/%$/);
    expect(beats()[1].querySelector('.name').textContent.trim()).toBe('Geolocating');
  });

  it('holds a film as long as it runs, at its rate', () => {
    show([{ shot: 'article-lead', film: true, rate: 2, chip: 'Written' }, REEL[0]]);
    const film = beats()[0].querySelector('video');
    Object.defineProperty(film, 'duration', { configurable: true, value: 6 });
    film.dispatchEvent(new Event('loadedmetadata'));
    expect(film.playbackRate).toBe(2);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    wait(2990);
    expect(shown()).toBe(0);
    wait(20);
    expect(shown()).toBe(1);
  });

  it('deals a report’s pages, the middle one lifted, then names what they come out as', () => {
    show([{ deck: ['report-glance', 'report-cover', 'report-story'], pills: ['PDF', 'HTML page'], seconds: 4 }]);
    const sheets = [...document.querySelectorAll('.sheet')];
    expect(sheets).toHaveLength(3);
    expect(sheets.map((sheet) => sheet.classList.contains('hero'))).toEqual([false, true, false]);
    expect([...document.querySelectorAll('.pills span')].map((pill) => pill.textContent)).toEqual(['PDF', 'HTML page']);
    expect(beats()[0].classList.contains('spread')).toBe(false);
    wait(1600);
    expect(beats()[0].classList.contains('spread')).toBe(true);
  });

  it('scrolls a site in its browser, then presses where it says', () => {
    show([{ page: 'site-home', browser: 'your-name.github.io', scroll: 0.5, click: [0.25, 0.75], seconds: 4 }]);
    expect(document.querySelector('.address').textContent.trim()).toBe('your-name.github.io');
    expect(document.querySelector('.page').style.getPropertyValue('--scroll')).toBe('-360px');
    // pressed a quarter of a width below the scroll, in the room under the bar
    expect(document.querySelector('.pointer').style.getPropertyValue('--to-y')).toBe('180px');
  });

  it('holds still for a reader who asked for less motion', () => {
    show([REEL[0], { shot: 'article-lead', film: true }], { calm: true });
    expect(document.querySelector('.strip')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
    wait(10_000);
    expect(shown()).toBe(0);
    expect(beats()[0].classList.contains('go')).toBe(false);
  });

  it('plays nothing it cannot draw whole', () => {
    show([REEL[0], { shot: 'no-such-picture' }]);
    expect(document.querySelector('.reel')).toBeNull();
  });

  it('leaves no timer behind once put away', () => {
    show(REEL);
    wait(100);
    unmount(live);
    live = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
