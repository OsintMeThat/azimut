import { describe, expect, it } from 'vitest';
import { roadWords, stackOf, step } from './mediaViewer.js';

const at = (key, lat, lon) => ({ id: key.split('@')[0], key, kind: 'media', lat, lon });

describe('walking a stack', () => {
  it('wraps at both ends', () => {
    expect(step(0, 1, 3)).toBe(1);
    expect(step(2, 1, 3)).toBe(0);
    expect(step(0, -1, 3)).toBe(2);
  });

  it('stays put on an empty stack', () => {
    expect(step(0, 1, 0)).toBe(0);
  });
});

describe('the stack a row opens', () => {
  it('is every file on the same metre, with the pressed one selected', () => {
    const rows = [
      at('a@48.1,2.1', 48.1, 2.1),
      at('b@48.1,2.1', 48.1, 2.1),
      at('c@50,3', 50, 3),
    ];
    const { items, index } = stackOf(rows, rows[1]);
    expect(items.map((row) => row.key)).toEqual(['a@48.1,2.1', 'b@48.1,2.1']);
    expect(index).toBe(1);
  });

  it('tells apart two points of one file', () => {
    // one video recorded on a roof and showing the street is two stacks
    const rows = [at('v@48.1,2.1', 48.1, 2.1), at('v@48.2,2.2', 48.2, 2.2)];
    expect(stackOf(rows, rows[1]).items).toEqual([rows[1]]);
  });

  it('opens the row alone when it is no longer in the list', () => {
    const gone = at('z@1,1', 1, 1);
    expect(stackOf([], gone)).toEqual({ items: [gone], index: 0 });
  });
});

describe('why a file stands here', () => {
  it('names each road once, in the order they were found', () => {
    expect(
      roadWords({
        roads: [
          { type: 'located-at', status: 'confirmed' },
          { type: 'depicts', status: 'confirmed' },
          { type: 'proof', title: 'Roofline', status: 'confirmed' },
          { type: 'proof', title: 'Roofline', status: 'confirmed' },
        ],
      })
    ).toBe('Recorded here · Shows this place · Via Roofline');
  });

  it('names an untitled artifact by its type', () => {
    expect(roadWords({ roads: [{ type: 'capture', title: '' }] })).toBe('Via a capture');
  });

  it('says nothing about a row with no roads', () => {
    expect(roadWords({})).toBe('');
  });
});
