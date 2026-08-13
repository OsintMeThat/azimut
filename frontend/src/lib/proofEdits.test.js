import { describe, expect, it } from 'vitest';
import { PANEL_H } from './composer.js';
import {
  movedBy,
  nextPanelRow,
  notesAfterRemoval,
  nudgeShape,
  PANEL_SCALE_MAX,
  PANEL_SCALE_MIN,
  scaleFromNode,
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
