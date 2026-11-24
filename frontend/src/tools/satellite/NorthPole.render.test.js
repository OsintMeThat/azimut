// @vitest-environment happy-dom
/**
 * Below the North Pole, mounted over a stand-in globe.
 *
 * The eyes show only through the hole, the fall takes the view once per
 * approach, the way back out sets the camera over the Arctic with its ground
 * given (no height asked of anyone), and nothing goes to the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { EARTH } from '../../lib/globe/earth.js';
import NorthPole from './NorthPole.svelte';

const W = 1000;
const H = 800;

/** A globe looked into: the hole's rim `radius` px round the middle, the centre of the Earth shown `through` latitude. */
function stand() {
  const listeners = new Map();
  const engine = {
    view: { radius: 0, through: 70 },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    emit(name) {
      for (const fn of listeners.get(name) ?? []) fn();
    },
    projectAt(lat, lon, metres) {
      if (lat === 90 && metres === -EARTH) return { x: W / 2, y: H / 2 };
      const a = (lon * Math.PI) / 180;
      return { x: W / 2 + engine.view.radius * Math.cos(a), y: H / 2 + engine.view.radius * Math.sin(a) };
    },
    surfaceAt: () => ({ lat: engine.view.through, lon: 0 }),
    camera: () => ({ lat: 87, lon: 12, zoom: 5, bearing: 0, pitch: 0 }),
    exactZoom: () => 5.2,
    setCamera: vi.fn(),
  };
  return engine;
}

let app;
let target;
let engine;

function open() {
  engine = stand();
  target = document.createElement('div');
  document.body.append(target);
  app = mount(NorthPole, { target, props: { engine } });
  const host = target.querySelector('.np-host');
  Object.defineProperty(host, 'clientWidth', { value: W, configurable: true });
  Object.defineProperty(host, 'clientHeight', { value: H, configurable: true });
  host.getBoundingClientRect = () => ({ left: 64, top: 78, width: W, height: H, right: 64 + W, bottom: 78 + H });
}

function look(radius, through = 89) {
  engine.view = { radius, through };
  engine.emit('view-move');
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
  // reduced motion: the whole way down at once, which is what a test can follow
  vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  document.querySelectorAll('.np-abyss').forEach((el) => el.remove());
  app = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the hole at the North Pole', () => {
  it('shows a lamp and two eyes at the centre of the Earth, through the hole only', () => {
    open();
    look(240, 60); // the ground hides the centre
    expect(target.querySelector('.np-hint')).toBeNull();
    look(100); // seen through, but small
    expect(target.querySelector('.np-hint')).toBeNull();
    look(240);
    const hint = target.querySelector('.np-hint');
    expect(hint).not.toBeNull();
    expect(hint.style.left).toBe(`${W / 2}px`);
    expect(Number(hint.style.opacity)).toBeGreaterThan(0);
    expect(hint.querySelectorAll('.np-blink')).toHaveLength(2);
  });

  it('takes the view once the hole fills the screen, down to the centre of the Earth', async () => {
    open();
    look(500);
    expect(document.querySelector('.np-abyss')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(400);
    flushSync();
    const card = document.querySelector('.np-card');
    expect(card.textContent).toContain('If you came all the way down here to geolocate something');
    expect(document.querySelector('.np-depth').textContent).toContain('−6 371 km');
    expect(document.querySelector('.np-depth').textContent).toContain('centre of the Earth');
    // at the bottom, a lamp and two eyes and nothing else: no beak, no body
    const who = document.querySelector('.np-who');
    expect(who.querySelectorAll('.np-wink')).toHaveLength(2);
    expect(who.querySelectorAll('path')).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('climbs back out over the Arctic with its ground given, and lets the map be', async () => {
    open();
    look(500);
    await vi.advanceTimersByTimeAsync(400);
    flushSync();
    document.querySelector('.np-card button').click();
    flushSync();
    expect(engine.setCamera).toHaveBeenCalledWith({ lat: 72, lon: 12, zoom: 3, bearing: 0, pitch: 0, elevation: 0 });
    await vi.advanceTimersByTimeAsync(50);
    flushSync();
    expect(document.querySelector('.np-abyss')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('climbs out on Escape too', async () => {
    open();
    look(500);
    await vi.advanceTimersByTimeAsync(400);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.advanceTimersByTimeAsync(50);
    flushSync();
    expect(engine.setCamera).toHaveBeenCalled();
    expect(document.querySelector('.np-abyss')).toBeNull();
  });

  it('falls in once per approach: the view has to leave the hole first', async () => {
    open();
    look(500);
    await vi.advanceTimersByTimeAsync(400);
    document.querySelector('.np-card button').click();
    await vi.advanceTimersByTimeAsync(50);
    flushSync();
    look(500); // straight back in: only the eyes
    expect(document.querySelector('.np-abyss')).toBeNull();
    look(50); // away from the hole
    look(500);
    expect(document.querySelector('.np-abyss')).not.toBeNull();
  });
});
