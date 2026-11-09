import { describe, expect, it, vi } from 'vitest';
import {
  canTurn,
  comparisonAnnotations,
  drawAnnotations,
  ellipseRing,
  glyphBox,
  glyphParts,
  markGlyph,
  markCentre,
  markLabel,
  markMetric,
  markRing,
  markTop,
  markSize,
  marksReady,
  modelLook,
  modelMarkup,
  movedMark,
  nextMarkNumber,
  onSide,
  projectMark,
  screenHeading,
  turnedMark,
} from './compareAnnotations.js';
import { fromMercator, toMercator } from './groundFrame.js';
import { modelsNow } from '../icons/loadModels.svelte.js';
import { STAMPS } from '../icons/stamps.js';
import { stampParts } from '../proofIcons.js';

const mark = (patch) => ({ id: 'm', colour: '#f6a81a', side: 'both', ...patch });

describe('ground annotations', () => {
  it('keeps marks the server accepts and drops the rest', () => {
    expect(comparisonAnnotations([
      mark({ kind: 'rect', colour: '#FF0000', points: [[2, 48], [2.1, 48.1]], fill_opacity: 4, side: 'x' }),
      mark({ kind: 'text', text: '   ', points: [[2, 48]] }),
      mark({ kind: 'arrow', points: [[2, 48]] }),
      mark({ kind: 'line', points: [[200, 48], [2, 48]] }),
      mark({ kind: 'unknown', points: [[2, 48]] }),
      // an annotation saved on screen coordinates before they were pinned
      { id: 'old', kind: 'rect', x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4 },
    ])).toEqual([{
      id: 'm', kind: 'rect', side: 'both', colour: '#ff0000',
      points: [[2, 48], [2.1, 48.1]], stroke_width: 3, fill_opacity: 1, font_size: 16, text: '',
      number: 1, glyph: 'point', angle: 0,
    }]);
  });

  it('keeps the angle a box was drawn at, and only on the kinds that have sides', () => {
    const [box, line] = comparisonAnnotations([
      mark({ kind: 'rect', points: [[2, 48], [2.1, 48.1]], angle: -30 }),
      mark({ kind: 'line', points: [[2, 48], [2.1, 48.1]], angle: 40 }),
    ]);
    expect(box.angle).toBeCloseTo(330);
    expect(line.angle).toBe(0);
  });

  it('belongs to one side or both', () => {
    expect(onSide(mark({ side: 'a' }), 'a')).toBe(true);
    expect(onSide(mark({ side: 'a' }), 'b')).toBe(false);
    expect(onSide(mark({ side: 'both' }), 'b')).toBe(true);
  });

  it('measures on the ground, not on the screen', () => {
    const measure = mark({ kind: 'measure', points: [[0, 0], [0, 0.01]] });
    expect(markMetric(measure).distance).toBeCloseTo(1113.2, 0);
    expect(markLabel(measure)).toBe('1.11 km');
    const square = mark({ kind: 'polygon', points: [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]] });
    expect(markMetric(square).area).toBeCloseTo(12392, -2);
    expect(markLabel(square, 'metric')).toBe('1.24 ha');
  });

  it('moves every point by a ground offset', () => {
    expect(movedMark(mark({ kind: 'line', points: [[1, 1], [179.5, 2]] }), 1, 0.5).points)
      .toEqual([[2, 1.5], [180, 2.5]]);
  });

  it('draws an ellipse as a ring inscribed in its ground box', () => {
    const ring = ellipseRing([[0, 0], [2, 1]], 4);
    expect(ring[0]).toEqual([2, 0.5]);
    expect(ring[1][0]).toBeCloseTo(1);
    expect(ring[1][1]).toBeCloseTo(1);
  });

  it('draws a box along the screen it was drawn on, not along north', () => {
    // Drawn on an east-up screen, top-left to bottom-right: its first side runs
    // south from the first corner, and its second runs west.
    const points = [[0, 0.001], [-0.002, -0.001]];
    const ring = markRing(mark({ kind: 'rect', points, angle: 90 }));
    expect(ring).toHaveLength(4);
    expect(ring[1][0]).toBeCloseTo(0, 9);
    expect(ring[1][1]).toBeCloseTo(-0.001, 9);
    expect(ring[3][0]).toBeCloseTo(-0.002, 9);
    expect(ring[3][1]).toBeCloseTo(0.001, 9);
    expect(markRing(mark({ kind: 'ellipse', points, angle: 90 }))).toHaveLength(48);
    const centre = markCentre(mark({ kind: 'ellipse', points, angle: 90 }));
    expect(centre[0]).toBeCloseTo(-0.001, 9);
    expect(centre[1]).toBeCloseTo(0, 9);
  });

  it("turns a mark about its centre, and a box's sides with it", () => {
    const box = mark({ kind: 'rect', points: [[0, 0], [0.002, -0.001]], angle: 0 });
    const turned = turnedMark(box, markCentre(box), 90);
    expect(turned.angle).toBe(90);
    // The same box, stood on end: its ring holds the same four corners turned.
    const metres = (ring) => ring.map((point) => toMercator(...point));
    const [a, b] = metres(markRing(turned));
    const [c, d] = metres(markRing(box));
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(Math.hypot(d[0] - c[0], d[1] - c[1]), 3);
    expect(Math.abs(b[1] - a[1])).toBeGreaterThan(Math.abs(b[0] - a[0]));
    const polygon = mark({ kind: 'polygon', points: [[0, 0], [0.002, 0], [0.001, 0.001]] });
    const spun = turnedMark(polygon, markCentre(polygon), 180);
    expect(spun.points[0][0]).toBeCloseTo(0.002, 9);
    expect(spun.angle).toBeUndefined();
    // One point turns about itself, which is no turn at all.
    const stamp = mark({ kind: 'number', points: [[1, 1]] });
    expect(turnedMark(stamp, [0, 0], 90)).toBe(stamp);
  });

  it("stands the turn grip on a box's own top edge", () => {
    const box = mark({ kind: 'rect', points: [[0, 0.002], [0.002, 0]], angle: 0 });
    const top = markTop(box);
    expect(top[0]).toBeCloseTo(0.001, 9);
    expect(top[1]).toBeCloseTo(0.002, 9);
    // Drawn from the bottom corner up, the top is still the top.
    const upward = markTop(mark({ kind: 'rect', points: [[0, 0], [0.002, 0.002]], angle: 0 }));
    expect(upward[1]).toBeCloseTo(0.002, 9);
    expect(markTop(mark({ kind: 'polygon', points: [[0, 0], [1, 0], [1, 1]] }))).toBeNull();
  });

  it('projects a box as a closed ring and an arrow with a head', () => {
    const project = ([lon, lat]) => [lon * 100, -lat * 100];
    const box = projectMark(mark({ kind: 'rect', points: [[0, 0], [1, 1]] }), project);
    expect(box.closed).toBe(true);
    expect(box.path).toHaveLength(4);
    expect(box.anchor).toEqual([50, -50]);
    const arrow = projectMark(mark({ kind: 'arrow', points: [[0, 0], [1, 0]], stroke_width: 3 }), project);
    expect(arrow.head[0]).toEqual([100, -0]);
    expect(arrow.anchor).toEqual([50, -0]);
  });

  it('burns marks and their labels into an exported picture through its projection', () => {
    const ctx = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), arcTo: vi.fn(), fillText: vi.fn(),
      setLineDash: vi.fn(), measureText: (text) => ({ width: text.length * 7 }),
    };
    drawAnnotations(ctx, [
      mark({ kind: 'measure', points: [[0, 0], [0, 0.01]] }),
      mark({ kind: 'text', points: [[0, 0]], text: 'Before' }),
    ], ([lon, lat]) => [lon * 1000 + 10, 500 - lat * 1000], { scale: 2 });
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 500);
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 490);
    expect(ctx.setLineDash).toHaveBeenCalledWith([16, 12]);
    expect(ctx.fillText.mock.calls.map((call) => call[0])).toEqual(['1.11 km', 'Before']);
  });
});

describe('the two marks stamped on one point', () => {
  const stamp = (extra) => mark({ kind: 'number', points: [[2, 48]], ...extra });

  it('counts a series per colour, refilling the gaps a deletion leaves', () => {
    const marks = [
      stamp({ id: 'a', colour: '#ef4444', number: 1 }),
      stamp({ id: 'b', colour: '#ef4444', number: 3 }),
      stamp({ id: 'c', colour: '#22c55e', number: 1 }),
      mark({ kind: 'rect', colour: '#ef4444', points: [[0, 0], [1, 1]] }),
    ];
    expect(nextMarkNumber(marks, '#ef4444')).toBe(2);
    // a second colour is a second feature, so it starts over
    expect(nextMarkNumber(marks, '#38bdf8')).toBe(1);
    expect(nextMarkNumber([], '#ef4444')).toBe(1);
  });

  it('is sized by its own number, having no line to widen', () => {
    expect(markSize({ font_size: 16 })).toBe(29);
    expect(markSize({ font_size: 8 })).toBe(14);
  });

  it('hangs a symbol on the point it names rather than on a corner', () => {
    const pin = { ...stamp({ kind: 'icon', glyph: 'point' }), font_size: 20 };
    const box = glyphBox(pin, [100, 200]);
    // the point glyph hangs from its tip, so the box sits above the ground point
    expect(box.x).toBe(100 - box.size / 2);
    expect(box.y).toBeLessThan(200);
    expect(box.scale).toBeCloseTo(box.size / 24, 6);
    // and a glyph this build does not know is still drawn as something
    expect(markGlyph({ glyph: 'not-a-symbol' }).name).toBe('point');
  });

  it('draws a symbol the way a proof stamps it: haloed, filled, its stroke as weight', () => {
    const truck = { ...stamp({ kind: 'icon', glyph: 'truck' }), colour: '#ef4444', stroke_width: 6 };
    const [halo, body, cut] = glyphParts(truck);
    expect(halo.fill).toBe('rgba(0, 0, 0, 0.6)');
    expect(body.fill).toBe('#ef4444');
    expect(body.width).toBeGreaterThan(glyphParts({ ...truck, stroke_width: 2 })[1].width);
    expect(cut.d).toBe(markGlyph(truck).cut);
  });

  it('burns a numbered disc into an export at the point it was stamped on', () => {
    const ctx = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), arc: vi.fn(), arcTo: vi.fn(),
      fillText: vi.fn(), translate: vi.fn(), scale: vi.fn(), setLineDash: vi.fn(),
      measureText: (text) => ({ width: text.length * 7 }),
    };
    drawAnnotations(ctx, [stamp({ number: 4, font_size: 16 })],
      ([lon, lat]) => [lon * 10, lat * 10], { scale: 2 });

    expect(ctx.arc).toHaveBeenCalledWith(20, 480, 29, 0, Math.PI * 2);
    expect(ctx.fillText).toHaveBeenCalledWith('4', 20, 480);
  });
});

/** A context that records what is drawn on it, Path2D included. */
function recorder() {
  const calls = [];
  const ctx = new Proxy({ calls, measureText: (text) => ({ width: text.length * 7 }) }, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => calls.push([name, ...args]);
    },
    set(target, name, value) {
      target[name] = value;
      calls.push([`=${String(name)}`, value]);
      return true;
    },
  });
  return { ctx, calls };
}
globalThis.Path2D ??= class { constructor(d) { this.d = d; } };

describe('the symbols the proof picker offers, on the ground', () => {
  const symbol = (glyph, extra) => mark({ kind: 'icon', points: [[2, 48]], glyph, ...extra });

  it('loads the models only once a mark names one', async () => {
    // first in this file to touch the models, so nothing has loaded them yet
    expect(modelsNow()).toBeNull();
    await marksReady([symbol('tank'), symbol('badge-flame'), mark({ kind: 'line', points: [[0, 0], [1, 1]] })]);
    expect(modelsNow()).toBeNull();
    expect(modelMarkup(symbol('model-tank'), 0)).toBe('');
    await marksReady([symbol('model-tank')]);
    expect(modelsNow()).not.toBeNull();
  });

  it('keeps every name the picker can give, and still draws junk as the pin', () => {
    const names = ['vehicle', 'nord', 'badge-flame', 'badge-hospital', 'model-tank', 'model-cargo',
      'not-a-symbol', 'pin', 'model-', '', null];
    expect(comparisonAnnotations(names.map((glyph) => symbol(glyph))).map((m) => m.glyph)).toEqual([
      'vehicle', 'nord', 'badge-flame', 'badge-hospital', 'model-tank', 'model-cargo',
      // a plain layer marker is a layer's, never a stamp
      'point', 'point', 'point', 'point', 'point',
    ]);
    expect(markGlyph(symbol('badge-flame')).name).toBe('badge-flame');
    expect(markGlyph(symbol('pin')).name).toBe('point');
  });

  it("keeps a model's heading in the angle a box keeps its up in, and no other symbol's", () => {
    const [tank, truck, fire] = comparisonAnnotations([
      symbol('model-tank', { angle: -45 }),
      symbol('truck', { angle: 70 }),
      symbol('badge-flame', { angle: 70 }),
    ]);
    expect(tank.angle).toBe(315);
    expect(truck.angle).toBe(0);
    expect(fire.angle).toBe(0);
    // the stored shape is the one every mark has had: nothing added to it
    expect(Object.keys(tank).sort()).toEqual(Object.keys(truck).sort());
  });

  it('turns a model on its point, and leaves every other symbol where it was', () => {
    const tank = symbol('model-tank', { angle: 350 });
    expect(canTurn(tank)).toBe(true);
    const turned = turnedMark(tank, [0, 0], 25);
    expect(turned.angle).toBe(15);
    expect(turned.points).toEqual(tank.points);
    for (const glyph of ['truck', 'badge-flame']) {
      expect(canTurn(symbol(glyph))).toBe(false);
      expect(turnedMark(symbol(glyph), [0, 0], 25)).toEqual(symbol(glyph));
    }
  });

  it("reads where a model's nose points through the picture's own projection", () => {
    const north = ([lon, lat]) => { const [x, y] = toMercator(lon, lat); return [x, -y]; };
    expect(screenHeading(symbol('model-tank', { angle: 0 }), north)).toBeCloseTo(0, 6);
    expect(screenHeading(symbol('model-tank', { angle: 120 }), north)).toBeCloseTo(120, 6);
    // the map turned 30° clockwise turns the model with it
    const turn = (30 * Math.PI) / 180;
    const turned = (point) => {
      const [x, y] = north(point);
      return [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)];
    };
    expect(screenHeading(symbol('model-tank', { angle: 0 }), turned)).toBeCloseTo(30, 6);
    expect(screenHeading(symbol('model-tank', { angle: 340 }), turned)).toBeCloseTo(10, 6);
  });

  it('draws one of the eleven stamps exactly as before', () => {
    for (const { name } of STAMPS) {
      const stamp = symbol(name, { colour: '#ef4444', stroke_width: 5, font_size: 14 });
      const old = stampParts(name, { color: '#ef4444', strokeWidth: 5, size: markSize(stamp) });
      expect(glyphParts(stamp)).toEqual(old.map((part) => ({ ...part, rule: 'evenodd' })));
    }
  });

  it("draws a badge's glyph as a proof does: haloed, in the mark's colour, its parts turned where they turn", () => {
    const parts = glyphParts(symbol('badge-flame', { colour: '#22c55e' }));
    expect(parts[0].fill).toBe('rgba(0, 0, 0, 0.6)');
    expect(parts.some((part) => part.fill === '#22c55e')).toBe(true);
    expect(parts.every((part) => part.rule === 'nonzero')).toBe(true);
    expect(glyphParts(symbol('model-tank'))).toEqual([]);
  });

  it('draws a model from above, its length the size of the stamp, turned to its heading', () => {
    const tank = symbol('model-tank', { font_size: 20, colour: '#38bdf8' });
    const look = modelLook(tank, 90, 2);
    expect(look).toMatchObject({ px: 72, fit: 'length', heading: 90, tilt: 0, colour: '#38bdf8', mode: 'tone' });
    expect(look.halo).toBeGreaterThan(0);
    const east = modelMarkup(tank, 90);
    expect(east).toContain('<svg width="36" height="36"');
    expect(modelMarkup(tank, 90)).toBe(east);
    expect(modelMarkup(tank, 0)).not.toBe(east);
    expect(modelMarkup({ ...tank, glyph: 'model-nothing' }, 0)).toBe('');
  });

  it('burns a model into an export where it stands, turned as the picture shows it, with no shadow', () => {
    const { ctx, calls } = recorder();
    // north up, ten pixels a metre about the origin
    const project = ([lon, lat]) => { const [x, y] = toMercator(lon, lat); return [x * 10 + 100, 200 - y * 10]; };
    const at = fromMercator(4, -3);
    drawAnnotations(ctx, [symbol('model-tank', { points: [at], angle: 90 })], project, { scale: 2 });
    const moved = calls.find((call) => call[0] === 'translate');
    expect(moved[1]).toBeCloseTo(140, 6);
    expect(moved[2]).toBeCloseTo(230, 6);
    expect(calls.filter((call) => call[0] === 'fill').length).toBeGreaterThan(10);
    expect(calls.some((call) => call[0] === '=shadowBlur' && call[1] > 0)).toBe(false);
  });

  it('keeps the soft shadow an old stamp has always had in an export, and gives none to a glyph', () => {
    const stamped = recorder();
    drawAnnotations(stamped.ctx, [symbol('truck')], () => [10, 10], { scale: 2 });
    expect(stamped.calls).toContainEqual(['=shadowBlur', 6]);
    expect(stamped.calls.filter((call) => call[0] === 'fill').every((call) => call[2] === 'evenodd')).toBe(true);
    const flat = recorder();
    drawAnnotations(flat.ctx, [symbol('badge-flame')], () => [10, 10], { scale: 2 });
    expect(flat.calls.some((call) => call[0] === '=shadowBlur')).toBe(false);
    expect(flat.calls.filter((call) => call[0] === 'fill').length).toBeGreaterThan(0);
  });
});
