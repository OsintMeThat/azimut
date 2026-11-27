// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import JourneyTrail, { stepIcon, trailPath } from './JourneyTrail.svelte';
import { JOURNEYS, journeyEdges } from '../lib/guide.js';

const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate');
const build = JOURNEYS.find((journey) => journey.id === 'create-an-analyzer');

let live;
function draw(props) {
  const target = document.createElement('div');
  document.body.append(target);
  // happy-dom lays nothing out: the trail is given a width, as a browser would measure it
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
  live = mount(JourneyTrail, { target, props: { picked: null, onpick: vi.fn(), ...props } });
  flushSync();
}
const point = (label) => [...document.querySelectorAll('.point')].find((one) => one.querySelector('.step-name').textContent.trim() === label);

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  delete HTMLElement.prototype.clientWidth;
});

describe('a journey drawn as a trail', () => {
  it('sets a waypoint per step and its result, and a way between each two it links', () => {
    draw({ journey: geolocate });
    expect(document.querySelectorAll('.point')).toHaveLength(geolocate.steps.length + 1);
    expect(document.querySelectorAll('path.way')).toHaveLength(journeyEdges(geolocate).length + 1);
    expect(point('Where?').classList.contains('ask')).toBe(true);
    expect(point('Skyline').classList.contains('optional')).toBe(true);
    expect(point('Skyline').classList.contains('above')).toBe(true);
    expect(point('Result').classList.contains('result')).toBe(true);
  });

  it('keeps a straight journey on one row, its steps numbered when it stays in one tool', () => {
    const straight = { id: 'straight', steps: ['Rules', 'Check', 'Save'].map((label) => ({ tool: 'detect', label, marks: [] })) };
    draw({ journey: straight });
    expect([...document.querySelectorAll('.number')].map((one) => one.textContent)).toEqual(['1', '2', '3']);
    expect(new Set([...document.querySelectorAll('.point')].map((one) => one.style.top)).size).toBe(1);
  });

  it('numbers only the way, leaving questions and detours their icons, and ends every branch on the result', () => {
    draw({ journey: build });
    const way = build.steps.filter((step) => !step.ask && !step.at[1]);
    expect([...document.querySelectorAll('.number')].map((one) => one.textContent)).toEqual(way.map((_, at) => String(at + 1)));
    // run once or as a routine, both reach the analyzer in the library
    expect(document.querySelectorAll('path.way').length).toBe(journeyEdges(build).length + 2);
  });

  it('ends a branch that stops early on a flag of its own, never across the steps after it', () => {
    const plate = JOURNEYS.find((journey) => journey.id === 'make-a-plate');
    draw({ journey: plate });
    // the geolocation card and the before and after end on their own; the situation goes on
    expect(document.querySelectorAll('.end-cap')).toHaveLength(2);
    const ends = ['card-out', 'pair-out'];
    const toResult = [...document.querySelectorAll('path.way')].length;
    expect(toResult).toBe(journeyEdges(plate).length + 2 + ends.length);
    // no two waypoints share a spot
    const spots = [...document.querySelectorAll('.point')].map((one) => `${one.style.left}|${one.style.top}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('opens the step pressed', () => {
    const onpick = vi.fn();
    draw({ journey: geolocate, onpick });
    point('Capture').click();
    expect(onpick).toHaveBeenCalledWith('capture');
  });

  it('draws the way the case went in amber, pins where it is and marks the way on', () => {
    draw({
      journey: geolocate,
      picked: 'how',
      here: { done: ['photo', 'where', 'mark', 'geolocate', 'satellite', 'sure', 'spot'], here: 'how', next: ['capture', 'elsewhere'] },
    });
    expect(point('Capture where?').classList.contains('here')).toBe(true);
    expect(point('Capture where?').getAttribute('aria-current')).toBe('step');
    expect(document.querySelector('.pin .tag').textContent).toBe('You are here');
    expect(point('Search the map').classList.contains('done')).toBe(true);
    expect(point('Search the map').querySelector('.tick')).not.toBeNull();
    expect(point('Capture').classList.contains('next')).toBe(true);
    // a detour may be taken, never ticked
    expect(point('Reverse search').classList.contains('done')).toBe(false);
    expect(document.querySelectorAll('path.way.ahead')).toHaveLength(2);
    expect(document.querySelectorAll('path.way.done').length).toBeGreaterThan(3);
  });

  it('draws the reader’s own way in amber, the step being read filled in', () => {
    draw({ journey: geolocate, picked: 'how', walked: ['photo', 'where', 'mark', 'geolocate', 'satellite', 'sure', 'spot'] });
    expect(point('Search the map').classList.contains('walked')).toBe(true);
    expect(point('Search the map').querySelector('.tick')).toBeNull();
    expect(point('Capture where?').classList.contains('current')).toBe(true);
    // the way walked, the answer that searched again included
    expect(document.querySelectorAll('path.way.done')).toHaveLength(8);
    expect(document.querySelector('.pin')).toBeNull();
  });

  it('only shows the way with no case to read', () => {
    draw({ journey: geolocate });
    expect(document.querySelector('.point.here, .point.done, .point.next, .pin')).toBeNull();
  });
});

describe('the trail’s pieces', () => {
  it('names a step by its own icon, its tool’s, or a question’s', () => {
    expect(stepIcon({ tool: 'media', icon: 'image' })).toBe('image');
    expect(stepIcon({ tool: 'satellite' })).toBe('satellite');
    expect(stepIcon({ tool: 'satellite', ask: true })).toBe('help');
  });

  it('runs straight along the way and bends onto a detour', () => {
    expect(trailPath({ x: 0, y: 50 }, { x: 100, y: 50 })).toBe('M0,50 L100,50');
    expect(trailPath({ x: 0, y: 50 }, { x: 100, y: 90 })).toBe('M0,50 C50,50 50,90 100,90');
  });
});
