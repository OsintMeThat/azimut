import { describe, expect, it } from 'vitest';
import { readSpots, spotLine, wordAt, wordUnder } from './spots.js';

describe('a double-click on the preview finds its line', () => {
  const spots = readSpots([0, 120, 2, 0, 300, 4, 0, 610, 6, 1, 80, 9, 1, 500, 12]);

  it('reads the header flat, three numbers a block, and drops what is not one', () => {
    expect(spots[0]).toEqual({ page: 0, top: 0.12, line: 2 });
    expect(spots).toHaveLength(5);
    expect(readSpots([0, 120, -1, 'x', 1, 2])).toEqual([]);
    expect(readSpots(null)).toEqual([]);
  });

  it('takes the last block starting above the point on its page', () => {
    expect(spotLine(spots, [0, 7], 0, 0.35)).toBe(4);
    expect(spotLine(spots, [0, 7], 0, 0.9)).toBe(6);
    expect(spotLine(spots, [0, 7], 1, 0.6)).toBe(12);
  });

  it('runs a block on from the page before, else says where the page starts', () => {
    expect(spotLine(spots, [0, 7], 1, 0.02)).toBe(6);
    expect(spotLine([], [0, 7], 1, 0.5)).toBe(7);
    expect(spotLine(spots, [0, 7], 0, 0.05)).toBe(0);
  });

  it('reads the word under a point of a page as PDF.js lays its text out', () => {
    const items = [
      { str: 'The line held at the ridge.', transform: [10, 0, 0, 10, 100, 700], width: 270, height: 10 },
      { str: 'Last words.', transform: [10, 0, 0, 10, 100, 680], width: 110, height: 10 },
    ];
    expect(wordUnder(items, 100 + 270 * (6 / 27), 703)).toBe('line');
    expect(wordUnder(items, 160, 683)).toBe('words');
    expect(wordUnder(items, 50, 703)).toBe('');
    expect(wordAt('a, b', 1)).toBe('');
    expect(wordAt('Nation’s Shield', 3)).toBe('Nation’s');
  });
});
