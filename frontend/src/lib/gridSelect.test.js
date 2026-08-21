import { describe, it, expect } from 'vitest';
import { marqueeHits, marqueeRect, toggleCheck, toggleSelection } from './gridSelect.js';

const rect = (id, left, top, right, bottom) => ({ id, left, top, right, bottom });

describe('marqueeRect', () => {
  it('normalizes either drag direction into a positive rect', () => {
    expect(marqueeRect(30, 40, 10, 20)).toEqual({ left: 10, top: 20, right: 30, bottom: 40 });
    expect(marqueeRect(10, 20, 30, 40)).toEqual({ left: 10, top: 20, right: 30, bottom: 40 });
  });
});

describe('marqueeHits', () => {
  const tiles = [
    rect('a', 0, 0, 50, 50),
    rect('b', 60, 0, 110, 50),
    rect('c', 0, 60, 50, 110),
  ];

  it('selects tiles the marquee overlaps', () => {
    expect(marqueeHits(tiles, marqueeRect(10, 10, 70, 10 + 1))).toEqual(['a', 'b']);
  });

  it('counts edge contact as a hit', () => {
    // marquee's right edge just touches tile b's left edge (x=60); it starts
    // past tile a's right edge (x=50), so only b is grazed
    expect(marqueeHits(tiles, { left: 55, top: 0, right: 60, bottom: 40 })).toEqual(['b']);
  });

  it('a zero-area marquee (a plain click) selects nothing', () => {
    expect(marqueeHits(tiles, { left: 10, top: 10, right: 10, bottom: 10 })).toEqual([]);
  });

  it('returns nothing when the marquee misses every tile', () => {
    expect(marqueeHits(tiles, marqueeRect(200, 200, 260, 260))).toEqual([]);
  });
});

describe('toggleSelection', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('plain click selects just that id and anchors it', () => {
    expect(toggleSelection(['a', 'b'], 'c', {}, order, 'a')).toEqual({
      selected: ['c'],
      anchor: 'c',
    });
  });

  it('meta-click toggles one in and out, keeping the rest', () => {
    expect(toggleSelection(['a'], 'b', { meta: true }, order, 'a')).toEqual({
      selected: ['a', 'b'],
      anchor: 'b',
    });
    expect(toggleSelection(['a', 'b'], 'b', { meta: true }, order, 'a').selected).toEqual(['a']);
  });

  it('shift-click selects the contiguous range from the anchor', () => {
    expect(toggleSelection(['b'], 'd', { shift: true }, order, 'b')).toEqual({
      selected: ['b', 'c', 'd'],
      anchor: 'b',
    });
  });

  it('shift-click works when the target sits before the anchor', () => {
    expect(toggleSelection(['c'], 'a', { shift: true }, order, 'c').selected).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('shift with no anchor falls back to a plain single select', () => {
    expect(toggleSelection([], 'c', { shift: true }, order, null)).toEqual({
      selected: ['c'],
      anchor: 'c',
    });
  });
});

describe('toggleCheck', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('ticking a box never clears the boxes already ticked', () => {
    expect(toggleCheck(['a'], 'c', {}, order, 'a')).toEqual({
      selected: ['a', 'c'],
      anchor: 'c',
    });
  });

  it('clicking a ticked box unticks that one alone', () => {
    expect(toggleCheck(['a', 'b'], 'a', {}, order, 'b').selected).toEqual(['b']);
  });

  it('shift ticks the whole run from the last box touched', () => {
    expect(toggleCheck(['a'], 'd', { shift: true }, order, 'a')).toEqual({
      selected: ['a', 'b', 'c', 'd'],
      anchor: 'd',
    });
  });

  it('shift on a ticked box unticks the run, so a mis-drag is one gesture back', () => {
    expect(
      toggleCheck(['a', 'b', 'c', 'd'], 'c', { shift: true }, order, 'a').selected
    ).toEqual(['d']);
  });

  it('runs the other way too', () => {
    expect(toggleCheck(['d'], 'b', { shift: true }, order, 'd').selected).toEqual([
      'd',
      'b',
      'c',
    ]);
  });

  it('shift with no anchor is a plain tick', () => {
    expect(toggleCheck([], 'c', { shift: true }, order, null)).toEqual({
      selected: ['c'],
      anchor: 'c',
    });
  });

  it('keeps a tick the current order no longer lists, since it is still going', () => {
    expect(toggleCheck(['gone'], 'a', {}, order, null).selected).toEqual(['gone', 'a']);
  });
});
