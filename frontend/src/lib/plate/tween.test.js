import { describe, expect, it } from 'vitest';
import { changes, ease, flight, motion, pictureTransform, transitionPlan, TWEEN_FPS, tweenFrames } from './tween.js';
import { project, unproject } from './geo.js';
import { PX_PER_MM, TRANSITIONS } from './page.js';

/** A canvas that records what is drawn on it and every filter set, a character measured as 5 pixels. */
function fakeCanvas() {
  const calls = [];
  const ctx = new Proxy({ calls, measureText: (text) => ({ width: String(text).length * 5 }) }, {
    get(target, key) { return key in target ? target[key] : (...args) => calls.push([key, ...args]); },
    set(target, key, value) { if (key === 'filter') calls.push(['filter', value]); target[key] = value; return true; },
  });
  return { width: 0, height: 0, getContext: () => ctx, ctx };
}

const frame = { width: 400, height: 300 };
const far = { lat: 45.8, lon: 6.8, zoom: 10, bearing: 0 };
const near = { lat: 45.85, lon: 6.9, zoom: 13, bearing: 40 };

/** The way sampled at `count` even steps, and how far the ground goes on the screen at each. */
function sampled(a, b, count = 10) {
  const fly = flight(a, b, frame);
  const views = Array.from({ length: count + 1 }, (_, index) => fly(index / count));
  return { views, speeds: views.slice(1).map((view, index) => motion(views[index], view, frame)) };
}

describe('a map flying from one beat to the next', () => {
  it('eases in and out, and lands where the next beat frames it', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    const fly = flight(far, near, frame);
    expect(fly(0).lat).toBeCloseTo(45.8);
    expect(fly(0).zoom).toBeCloseTo(10);
    expect(fly(1)).toMatchObject({ lat: 45.85, lon: 6.9, zoom: 13, bearing: 40 });
    expect(fly(0.5).bearing).toBeCloseTo(20);
    // the shorter way round a turn
    expect(flight({ ...far, bearing: 170 }, { ...far, bearing: -170 }, frame)(0.5).bearing).toBeCloseTo(180);
    expect(flight(far, { ...far, pitch: 60 }, frame)(0.5).pitch).toBeCloseTo(30);
  });

  it('crosses the screen at one speed, however far it zooms', () => {
    // from a country to a village, eight levels in: the ground never rushes at the end
    const { speeds } = sampled({ lat: 14.84, lon: 44.46, zoom: 6 }, { lat: 16.03, lon: 45.26, zoom: 14 });
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeLessThan(1.3);
    // a zoom on the spot keeps its centre
    const { views } = sampled(far, { ...far, zoom: 14 });
    expect(views.every((view) => Math.abs(view.lat - far.lat) < 1e-9 && Math.abs(view.lon - far.lon) < 1e-9)).toBe(true);
  });

  it('rises over a long way and comes down where it lands', () => {
    const { views, speeds } = sampled(far, { ...far, lon: 9 });
    const lowest = Math.min(...views.map((view) => view.zoom));
    expect(lowest).toBeLessThan(8);
    expect(views.at(-1).zoom).toBe(10);
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeLessThan(1.6);
  });

  it('carries a picture of the map to where the same ground stands in another view', () => {
    const [a, b, c, d, e, f] = pictureTransform(far, near, frame);
    const at = (x, y) => [a * x + c * y + e, b * x + d * y + f];
    // a point of the ground in the first picture lands where the second view draws it
    const ground = unproject(far, frame, [150, 100]);
    const [x, y] = at(150, 100);
    const [ex, ey] = project(near, frame, ground);
    expect(x).toBeCloseTo(ex, 3);
    expect(y).toBeCloseTo(ey, 3);
  });
});

describe('a transition between two beats', () => {
  it('plays at the video\'s own rate, and does only what it is set to and what the beats call for', () => {
    expect(TWEEN_FPS).toBe(30);
    expect(transitionPlan(TRANSITIONS, { moved: ['map'], fresh: ['z'] })).toBeNull();
    const on = { ...TRANSITIONS, on: true };
    expect(transitionPlan(on, {}, { cut: true })).toBeNull();
    // nothing moves and nothing is new: only the fade
    expect(transitionPlan(on, {})).toEqual({ move: false, blur: false, fade: true, appear: 'none', frames: 24, first: 24 });
    // the maps move first, then what is new comes in
    const both = transitionPlan({ ...on, appear: 'draw' }, { moved: ['map'], fresh: ['z'] });
    expect(both).toMatchObject({ move: true, blur: true, appear: 'draw', frames: Math.round(0.8 * TWEEN_FPS) });
    expect(both.first).toBeLessThan(both.frames);
    expect(transitionPlan({ ...on, blur: false }, { moved: ['map'] }).blur).toBe(false);
    expect(transitionPlan({ ...on, fade: false, move: false, appear: 'none' }, { moved: ['map'], fresh: ['z'] })).toBeNull();
  });

  it('finds the maps framed otherwise and what is new on the next beat', () => {
    const spec = { elements: [{ id: 'map', kind: 'map' }, { id: 'old', kind: 'text', box: [0, 0, 1, 1] },
      { id: 'z', kind: 'zone', step: 's1', box: [0, 0, 1, 1] }] };
    const before = { context: { at: null, place: { steps: ['s1'], index: -1 }, views: { map: { view: far, frame } } } };
    const after = { context: { at: null, place: { steps: ['s1'], index: 0 }, views: { map: { view: near, frame } } } };
    expect(changes(spec, before, after)).toEqual({ moved: ['map'], fresh: ['z'] });
  });

  const spec = { page: { paper: 'a5', orientation: 'landscape' }, theme: { paper: '#ffffff', ink: '#000000', accent: '#c8102e', font: 'inter' },
    elements: [{ id: 'map', kind: 'map', box: [10, 10, 100, 80] }, { id: 'inset', kind: 'inset', of: 'map', box: [120, 10, 40, 30] },
      { id: 'z', kind: 'text', box: [0, 0, 20, 5], text: 'New', step: 's1' }] };
  const picture = { width: 100, height: 80 };
  const insetFrame = { width: 160, height: 120 };
  const beat = (index, view) => ({ context: { at: null, place: { steps: ['s1'], index },
    views: { map: { view, frame }, inset: { view: { ...view, zoom: view.zoom - 4.5, bearing: 0 }, frame: insetFrame } },
    maps: { map: picture, inset: picture } } });
  const all = async (frames) => { const out = []; for await (const canvas of frames) out.push(canvas); return out; };

  it('draws the map again at each frame of its flight, its inset following, then brings in what is new', async () => {
    const plan = transitionPlan({ ...TRANSITIONS, on: true, appear: 'fade' }, { moved: ['map'], fresh: ['z'] });
    const asked = { map: [], inset: [] };
    const ended = [];
    const sitting = (id) => ({ at: async (view) => { asked[id].push(view); return { picture, placer: null }; }, end: () => ended.push(id) });
    const made = [];
    const frames = await all(tweenFrames(spec, 2, beat(-1, far), beat(0, near), plan, { moved: ['map'], fresh: ['z'] },
      { sitting, makeCanvas: () => { const canvas = fakeCanvas(); made.push(canvas); return canvas; } }));
    expect(frames).toHaveLength(plan.frames);
    // every frame of the way, the last landing where the next beat frames the map
    expect(asked.map).toHaveLength(plan.first);
    expect(asked.map.at(-1)).toMatchObject({ lat: near.lat, lon: near.lon, zoom: near.zoom });
    expect(asked.inset.map((view) => view.zoom)).toEqual(asked.map.map((view) => view.zoom - 4.5));
    expect(ended.sort()).toEqual(['inset', 'map']);
    // the map moves blurred, sharp at both ends
    const filters = made.flatMap((canvas) => canvas.ctx.calls.filter(([name]) => name === 'filter').map(([, value]) => value));
    expect(filters.some((value) => value.startsWith('blur('))).toBe(true);
    // what is new is written in the frames after the move
    const last = frames.at(-1).ctx.calls;
    expect(last.some(([name, text]) => name === 'fillText' && text === 'New')).toBe(true);
  });

  it('carries the two beats\' pictures along the way when the map cannot be lent, and gives a map back when stopped', async () => {
    const plan = transitionPlan({ ...TRANSITIONS, on: true, appear: 'none' }, { moved: ['map'] });
    const frames = await all(tweenFrames(spec, 2, beat(-1, far), beat(0, near), plan, { moved: ['map'] }, { makeCanvas: fakeCanvas }));
    expect(frames).toHaveLength(plan.frames);
    const ended = [];
    const sitting = (id) => ({ at: async () => ({ picture, placer: null }), end: () => ended.push(id) });
    const flying = tweenFrames(spec, 2, beat(-1, far), beat(0, near), plan, { moved: ['map'] }, { sitting, makeCanvas: fakeCanvas });
    await flying.next();
    await flying.return();
    expect(ended.sort()).toEqual(['inset', 'map']);
  });

  it('places what is written over a map in 3D through its camera as it stands at each frame', async () => {
    const plan = transitionPlan({ ...TRANSITIONS, on: true, appear: 'none' }, { moved: ['map'] });
    const tilted = { ...spec, elements: [...spec.elements, { id: 'a', kind: 'arrow', of: 'map', box: [0, 0, 1, 1], at: [6.8, 45.8], to: [6.9, 45.85] }] };
    // a camera that sets the ground somewhere the flat sum never would
    const placer = { project: ([lon, lat]) => [lon * 10, lat * 2], unproject: ([x, y]) => [x / 10, y / 2], corners: () => [] };
    const sitting = () => ({ at: async () => ({ picture, placer }), end: () => {} });
    const made = [];
    await all(tweenFrames(tilted, 2, beat(-1, far), beat(0, near), plan, { moved: ['map'] },
      { sitting, makeCanvas: () => { const canvas = fakeCanvas(); made.push(canvas); return canvas; } }));
    const [x, y] = [20 + 68 * (2 / PX_PER_MM), 20 + 91.6 * (2 / PX_PER_MM)];
    const starts = made.flatMap((canvas) => canvas.ctx.calls.filter(([name, px, py]) => name === 'moveTo' && Math.abs(px - x) < 1e-6 && Math.abs(py - y) < 1e-6));
    expect(starts.length).toBeGreaterThan(0);
  });
});
