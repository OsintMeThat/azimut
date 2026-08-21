import { describe, expect, it } from 'vitest';
import { PANEL_H } from './composer.js';
import {
  canFill,
  fillPaint,
  movedBy,
  nextPanelRow,
  notesAfterRemoval,
  nudgeShape,
  PANEL_SCALE_MAX,
  PANEL_SCALE_MIN,
  pointsWithTransform,
  scaleFromNode,
  textBoxPad,
  viewCentrePoint,
} from './proofEdits.js';

describe('nudgeShape', () => {
  it('moves a boxed shape by its corner', () => {
    expect(nudgeShape({ x: 10, y: 20 }, 3, -4)).toEqual({ x: 13, y: 16 });
  });

  it('treats a shape with no position as sitting at the origin', () => {
    expect(nudgeShape({}, 2, 2)).toEqual({ x: 2, y: 2 });
  });

  it('moves every vertex of a points-based shape, not its origin', () => {
    // A freehand stroke carries its geometry in the list; shifting an x/y it does
    // not have would leave the drawing exactly where it was.
    const stroke = { points: [0, 0, 10, 5, 20, 15] };
    expect(nudgeShape(stroke, 2, -1)).toEqual({ points: [2, -1, 12, 4, 22, 14] });
  });

  it('does not write to the shape it was handed', () => {
    const shape = { x: 1, y: 1 };
    nudgeShape(shape, 5, 5);
    expect(shape).toEqual({ x: 1, y: 1 });
  });
});

describe('notesAfterRemoval', () => {
  const notes = { '#ff5252': 'the vehicle', '#40c4ff': 'the mast' };

  it('keeps the note while another element still carries the colour', () => {
    const remaining = [{ color: '#ff5252' }];
    const kept = notesAfterRemoval(notes, remaining, { color: '#ff5252' });
    expect(kept['#ff5252']).toBe('the vehicle');
  });

  it('drops the note with the last element of its colour', () => {
    const kept = notesAfterRemoval(notes, [{ color: '#40c4ff' }], { color: '#ff5252' });
    expect(kept).toEqual({ '#40c4ff': 'the mast' });
  });

  it('leaves the other colours alone', () => {
    const kept = notesAfterRemoval(notes, [], { color: '#ff5252' });
    expect(kept['#40c4ff']).toBe('the mast');
  });

  it('answers with the same legend when nothing was deleted', () => {
    expect(notesAfterRemoval(notes, [], null)).toBe(notes);
  });

  it('does not write to the legend it was handed', () => {
    notesAfterRemoval(notes, [], { color: '#ff5252' });
    expect(notes['#ff5252']).toBe('the vehicle');
  });
});

describe('nextPanelRow', () => {
  const panels = [{ row: 0 }, { row: 0 }, { row: 1 }];

  it('moves a panel down a row', () => {
    expect(nextPanelRow(panels, 0, 1)).toBe(1);
  });

  it('lets a panel start a fresh row one past the last', () => {
    expect(nextPanelRow(panels, 2, 1)).toBe(2);
  });

  it('refuses two past the last, which would leave an empty row behind', () => {
    expect(nextPanelRow([{ row: 0 }], 0, 2)).toBeNull();
  });

  it('refuses to move above the first row', () => {
    expect(nextPanelRow(panels, 0, -1)).toBeNull();
  });

  it('treats a panel with no row as being on the first one', () => {
    expect(nextPanelRow([{}], 0, 1)).toBe(1);
  });

  it('says nothing about a panel that is not there', () => {
    expect(nextPanelRow(panels, 9, 1)).toBeNull();
  });
});

describe('movedBy', () => {
  const list = ['a', 'b', 'c'];

  it('brings an entry forward', () => {
    expect(movedBy(list, 2, -1)).toEqual(['a', 'c', 'b']);
  });

  it('sends an entry backward', () => {
    expect(movedBy(list, 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('refuses a move off either end', () => {
    expect(movedBy(list, 0, -1)).toBeNull();
    expect(movedBy(list, 2, 1)).toBeNull();
  });

  it('does not write to the list it was handed', () => {
    movedBy(list, 0, 1);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});

describe('scaleFromNode', () => {
  it('reads a panel scale of one back out of an untouched group', () => {
    // group scale = (PANEL_H · 1) / naturalHeight
    const natural = 1080;
    expect(scaleFromNode(PANEL_H / natural, natural)).toBe(1);
  });

  it('doubles the panel when the group is dragged to twice its scale', () => {
    const natural = 1080;
    expect(scaleFromNode((PANEL_H / natural) * 2, natural)).toBe(2);
  });

  it('stops at both bounds rather than letting a drag shrink a panel away', () => {
    expect(scaleFromNode(100, 1080)).toBe(PANEL_SCALE_MAX);
    expect(scaleFromNode(0.0001, 1080)).toBe(PANEL_SCALE_MIN);
  });

  it('rounds to a hundredth, so the step buttons can reach the value again', () => {
    const natural = 1080;
    const scale = scaleFromNode((PANEL_H / natural) * 1.23456, natural);
    expect(scale).toBe(1.23);
  });
});

describe('viewCentrePoint', () => {
  it('is the middle of the document when nothing is panned or zoomed', () => {
    const point = viewCentrePoint(
      { width: 800, height: 600 },
      { x: 0, y: 0, scaleX: 1, scaleY: 1 }
    );
    expect(point).toEqual({ x: 400, y: 300 });
  });

  it('follows the pan, so a paste lands where the analyst is looking', () => {
    const point = viewCentrePoint(
      { width: 800, height: 600 },
      { x: -1000, y: -500, scaleX: 1, scaleY: 1 }
    );
    expect(point).toEqual({ x: 1400, y: 800 });
  });

  it('accounts for the zoom', () => {
    const point = viewCentrePoint(
      { width: 800, height: 600 },
      { x: 0, y: 0, scaleX: 2, scaleY: 2 }
    );
    expect(point).toEqual({ x: 200, y: 150 });
  });
});

describe('a shape fill', () => {
  it('applies to the closed kinds only', () => {
    expect(canFill('rect')).toBe(true);
    expect(canFill('ellipse')).toBe(true);
    expect(['line', 'arrow', 'curve', 'freehand', 'text'].map(canFill)).toEqual(
      [false, false, false, false, false]
    );
    expect(canFill(undefined)).toBe(false);
  });

  it('is the shape colour carrying the chosen opacity', () => {
    expect(fillPaint('#40c4ff', 0.25)).toBe('rgba(64, 196, 255, 0.25)');
    expect(fillPaint('#FFFFFF', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(fillPaint('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('is nothing at all until an opacity is asked for', () => {
    expect(fillPaint('#40c4ff', 0)).toBeNull();
    expect(fillPaint('#40c4ff', undefined)).toBeNull();
    expect(fillPaint('#40c4ff', -1)).toBeNull();
  });

  it('refuses a colour it cannot read rather than painting over the evidence', () => {
    expect(fillPaint('red', 0.5)).toBeNull();
    expect(fillPaint(null, 0.5)).toBeNull();
  });

  it('never paints past opaque', () => {
    expect(fillPaint('#000000', 4)).toBe('rgba(0, 0, 0, 1)');
  });
});

describe('pointsWithTransform', () => {
  // Konva hands back [a, b, c, d, e, f]: x' = ax + cy + e, y' = bx + dy + f.
  const IDENTITY = [1, 0, 0, 1, 0, 0];

  it('leaves a stroke alone when nothing moved it', () => {
    expect(pointsWithTransform([0, 0, 10, 4], IDENTITY)).toEqual([0, 0, 10, 4]);
  });

  it('folds a corner drag into every sample, not just the first', () => {
    // doubled, then moved 5 right and 1 down
    expect(pointsWithTransform([0, 0, 10, 4, 20, 8], [2, 0, 0, 2, 5, 1]))
      .toEqual([5, 1, 25, 9, 45, 17]);
  });

  it('folds a quarter turn in as well, since a stroke has no origin to keep one against', () => {
    const quarter = [0, 1, -1, 0, 0, 0]; // 90° clockwise about the panel origin
    expect(pointsWithTransform([1, 0, 0, 2], quarter)).toEqual([0, 1, -2, 0]);
  });

  it('answers with a new list rather than editing the one it was given', () => {
    const points = [1, 2, 3, 4];
    expect(pointsWithTransform(points, [3, 0, 0, 3, 0, 0])).not.toBe(points);
    expect(points).toEqual([1, 2, 3, 4]);
  });

  it('has nothing to fold into an empty stroke', () => {
    expect(pointsWithTransform([], [2, 0, 0, 2, 5, 5])).toEqual([]);
  });
});

describe('textBoxPad', () => {
  it('grows with the label, so a frame reads the same at any size', () => {
    expect(textBoxPad(28)).toBe(8);
    expect(textBoxPad(100)).toBe(28);
  });

  it('answers for a label that never stated a size', () => {
    expect(textBoxPad(undefined)).toBe(textBoxPad(28));
  });
});
