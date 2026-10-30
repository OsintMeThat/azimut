import { describe, expect, it } from 'vitest';
import { anchorShift, createCollisions, drawStanding, markedAt, placeStanding, shiftMark, shiftStanding } from './standing.js';
import { compileLayer } from './style.js';

const NAMES = compileLayer({
  id: 'names',
  type: 'symbol',
  source: 'omt',
  layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'symbol-sort-key': ['get', 'rank'] },
  paint: { 'text-color': '#fff' },
});
const DOTS = compileLayer({ id: 'dots', type: 'circle', source: 's', paint: { 'circle-radius': 4, 'circle-color': '#f00' } });

/** A view where a point's screen place is written on it, and nothing hides it. */
const view = (extra = {}) => ({
  project: (lat, lon, memo) => (memo.hidden ? null : { x: memo.x, y: memo.y, distance: 1000 }),
  zoomAt: () => 10,
  width: 800,
  height: 600,
  ...extra,
});
/** Every name a box 10 px a letter wide, as the browser would measure it, roughly. */
const assets = { label: (spec) => ({ image: spec.text, width: spec.text.length * 10, height: 14 }), icon: () => null };
const name = (text, x, y, more = {}) => ({ layer: NAMES, order: 1, lat: 0, lon: 0, type: 'Point', properties: { name: text, rank: more.rank ?? 0 }, x, y, ...more });

describe('what stands on the globe facing the eye', () => {
  it('moves an anchored box so its point is where the anchor says', () => {
    expect(anchorShift('center', 20, 10)).toEqual([0, 0]);
    expect(anchorShift('bottom', 20, 10)).toEqual([0, -5]);
    expect(anchorShift('top-left', 20, 10)).toEqual([10, 5]);
  });

  it('keeps out a box that would cover one already placed', () => {
    const collisions = createCollisions();
    collisions.add({ x0: 0, y0: 0, x1: 50, y1: 20 });
    expect(collisions.free({ x0: 40, y0: 10, x1: 90, y1: 30 })).toBe(false);
    expect(collisions.free({ x0: 60, y0: 10, x1: 90, y1: 30 })).toBe(true);
  });

  it('places names by sort key and leaves out the one that would cover another', () => {
    const placed = placeStanding([name('Second', 100, 100, { rank: 2 }), name('First', 105, 102, { rank: 1 }), name('Apart', 400, 300)], view(), assets);
    expect(placed.map((m) => m.label.text)).toEqual(['Apart', 'First']);
    expect(placed.waiting).toBe(false);
  });

  it('draws the layer on top first, and every dot whatever it covers', () => {
    const dot = (x) => ({ layer: DOTS, order: 5, lat: 0, lon: 0, type: 'Point', properties: {}, x, y: 100 });
    const placed = placeStanding([name('Under', 100, 100), dot(100), dot(102)], view(), assets);
    expect(placed.map((m) => (m.circle ? 'dot' : m.label.text))).toEqual(['dot', 'dot', 'Under']);
  });

  it('leaves out what is out of sight or off the screen', () => {
    const placed = placeStanding([name('Hidden', 100, 100, { hidden: true }), name('Away', 5000, 100), name('Here', 300, 300)], view(), assets);
    expect(placed.map((m) => m.label.text)).toEqual(['Here']);
  });

  it('says it is waiting when a name could not be written this frame', () => {
    const placed = placeStanding([name('Late', 100, 100)], view(), { ...assets, label: () => null });
    expect(placed.length).toBe(0);
    expect(placed.waiting).toBe(true);
  });

  it('writes the pictures of the names that fit only, when their sizes can be had first', () => {
    const written = [];
    const sized = {
      ...assets,
      labelSize: (spec) => ({ width: spec.text.length * 10, height: 14 }),
      label: (spec) => (written.push(spec.text), assets.label(spec)),
    };
    const placed = placeStanding([name('Second', 100, 100, { rank: 2 }), name('First', 105, 102, { rank: 1 }), name('Apart', 400, 300)], view(), sized);
    expect(placed.map((m) => m.label.text)).toEqual(['Apart', 'First']);
    expect(written.sort()).toEqual(['Apart', 'First']);
    expect(placed[0].label).toMatchObject({ w: 50, h: 14, picture: { image: 'Apart' } });
  });

  it('holds the place of a name whose picture waits, so a lower one does not take it meanwhile', () => {
    const sized = { ...assets, labelSize: (spec) => ({ width: spec.text.length * 10, height: 14 }), label: (spec) => (spec.text === 'First' ? null : assets.label(spec)) };
    const placed = placeStanding([name('Second', 100, 100, { rank: 2 }), name('First', 105, 102, { rank: 1 })], view(), sized);
    expect(placed.length).toBe(0);
    expect(placed.waiting).toBe(true);
    // a name that cannot even be measured this frame waits too
    const unmeasured = placeStanding([name('Late', 100, 100)], view(), { ...sized, labelSize: () => null });
    expect(unmeasured.waiting).toBe(true);
  });

  it('places a dot that paints nothing for clicks only: never drawn, never moved between placements', () => {
    const TARGETS = compileLayer({ id: 'hit', type: 'circle', source: 's', paint: { 'circle-radius': 12, 'circle-opacity': 0 } });
    const target = { layer: TARGETS, order: 1, lat: 0, lon: 0, type: 'Point', properties: {}, x: 200, y: 200 };
    const dot = { layer: DOTS, order: 2, lat: 0, lon: 0, type: 'Point', properties: {}, x: 300, y: 300 };
    const placed = placeStanding([target, dot], view(), assets);
    expect(placed.map((m) => [m.candidate.layer.id, Boolean(m.unseen)])).toEqual([['dots', false], ['hit', true]]);
    const arcs = [];
    const ctx = { beginPath() {}, arc: (x) => arcs.push(x), fill() {}, stroke() {}, set globalAlpha(_) {}, set fillStyle(_) {} };
    drawStanding(ctx, placed);
    expect(arcs).toEqual([300]);
    dot.x = 310;
    target.x = 210;
    const moved = shiftStanding(placed, view().project);
    expect(moved[0].x).toBe(310);
    expect(moved[1]).toBe(placed[1]);
    expect(shiftMark(placed[1], view().project).x).toBe(210);
    expect(markedAt(placed, { x0: 205, y0: 200, x1: 205, y1: 200 }).map((m) => m.candidate)).toEqual([target]);
  });

  it('moves the marks placed with the view between two placements', () => {
    const candidate = name('Here', 300, 300);
    const placed = placeStanding([candidate], view(), assets);
    candidate.x = 320;
    candidate.y = 290;
    const [moved] = shiftStanding(placed, view().project);
    expect(moved).toMatchObject({ x: 320, y: 290 });
    expect(moved.label.cx).toBe(placed[0].label.cx + 20);
    expect(moved.boxes[0].y0).toBe(placed[0].boxes[0].y0 - 10);
    candidate.hidden = true;
    expect(shiftStanding(placed, view().project).length).toBe(0);
  });

  it('answers which marks lie under a point of the screen, for a click', () => {
    const dot = { layer: DOTS, order: 5, lat: 0, lon: 0, type: 'Point', properties: {}, x: 200, y: 200 };
    const placed = placeStanding([dot, name('Label', 400, 400)], view(), assets);
    expect(markedAt(placed, { x0: 203, y0: 202, x1: 203, y1: 202 }).map((m) => m.candidate)).toEqual([dot]);
    expect(markedAt(placed, { x0: 210, y0: 210, x1: 210, y1: 210 })).toEqual([]);
    expect(markedAt(placed, { x0: 400, y0: 400, x1: 400, y1: 400 }, new Set(['dots']))).toEqual([]);
  });
});
