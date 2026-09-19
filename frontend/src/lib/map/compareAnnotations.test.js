import { describe, expect, it, vi } from 'vitest';
import {
  comparisonAnnotations,
  drawAnnotations,
  ellipseRing,
  glyphBox,
  markGlyph,
  markLabel,
  markMetric,
  markSize,
  movedMark,
  nextMarkNumber,
  onSide,
  projectMark,
} from './compareAnnotations.js';

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
      number: 1, glyph: 'point',
    }]);
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
