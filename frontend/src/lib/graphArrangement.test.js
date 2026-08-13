import { describe, expect, it } from 'vitest';
import { arrangementDiff } from './graph.js';
import { mergedArrangement, validPins } from './graphArrangement.js';

const at = (id, x, y) => ({ id, x, y });

describe('mergedArrangement', () => {
  it('reads the pins the drawing arrived with', () => {
    const nodes = [{ id: 'a', pin: [10, 20] }, { id: 'b' }];
    expect(mergedArrangement({ nodes, held: ['a'] })).toEqual([at('a', 10, 20)]);
  });

  it('lets an unfiled drag win over the pin the drawing carried', () => {
    const nodes = [{ id: 'a', pin: [10, 20] }];
    const pins = new Map([['a', { x: 99, y: 99 }]]);
    expect(mergedArrangement({ nodes, pins, held: ['a'] })).toEqual([at('a', 99, 99)]);
  });

  it('drops a node that is no longer pinned, whichever source still holds it', () => {
    // Let go of a pin and the node may sit in both maps for a moment; carrying it
    // into a snapshot would put it back on the next undo.
    const nodes = [{ id: 'a', pin: [1, 2] }];
    const pins = new Map([['a', { x: 3, y: 4 }], ['b', { x: 5, y: 6 }]]);
    expect(mergedArrangement({ nodes, pins, held: ['b'] })).toEqual([at('b', 5, 6)]);
  });

  it('ignores a drawn node with no pin at all', () => {
    expect(mergedArrangement({ nodes: [{ id: 'a' }], held: ['a'] })).toEqual([]);
  });

  it('keeps a view own pins to itself, ignoring what the drawing carried', () => {
    // A named view holds off-screen pins; an undo taken in it must not rewrite
    // the case-wide arrangement with the subset that happens to be on screen.
    const nodes = [{ id: 'a', pin: [1, 2] }];
    const pins = new Map([['b', { x: 7, y: 8 }]]);
    expect(mergedArrangement({ nodes, pins, held: ['a', 'b'], fromView: true }))
      .toEqual([at('b', 7, 8)]);
  });

  it('answers with nothing when nothing is pinned', () => {
    expect(mergedArrangement({ nodes: [{ id: 'a', pin: [1, 2] }], held: [] })).toEqual([]);
  });

  it('answers something arrangementDiff can compare against itself', () => {
    const nodes = [{ id: 'a', pin: [1, 2] }];
    const now = mergedArrangement({ nodes, held: ['a'] });
    const { place, drop } = arrangementDiff(now, now);
    expect(place).toEqual([]);
    expect(drop).toEqual([]);
  });
});

describe('validPins', () => {
  it('takes the spots a snapshot states properly', () => {
    expect([...validPins([at('a', 1, 2)])]).toEqual([['a', { x: 1, y: 2 }]]);
  });

  it('drops a spot with no id, rather than pinning nothing', () => {
    expect(validPins([{ x: 1, y: 2 }]).size).toBe(0);
    expect(validPins([at(7, 1, 2)]).size).toBe(0);
  });

  it('drops a coordinate that is not finite, which Konva would draw nowhere', () => {
    expect(validPins([at('a', NaN, 2)]).size).toBe(0);
    expect(validPins([at('a', 1, Infinity)]).size).toBe(0);
    expect(validPins([at('a', null, 2)]).size).toBe(0);
  });

  it('keeps the good spots in a list that also holds a bad one', () => {
    const pins = validPins([at('a', 1, 2), at('b', NaN, 0), at('c', 3, 4)]);
    expect([...pins.keys()]).toEqual(['a', 'c']);
  });

  it('reads zero as a position, not as missing', () => {
    expect(validPins([at('a', 0, 0)]).get('a')).toEqual({ x: 0, y: 0 });
  });

  it('answers empty for a snapshot that carries no arrangement', () => {
    expect(validPins(undefined).size).toBe(0);
    expect(validPins(null).size).toBe(0);
  });
});
