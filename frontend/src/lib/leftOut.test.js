import { describe, expect, it } from 'vitest';
import { leftOutLine, leftOutWords, stitchedWords } from './leftOut.js';

describe('why a piece was left out', () => {
  it('says each of the three in plain words', () => {
    expect(leftOutLine('no-overlap')).toBe('No overlap');
    expect(leftOutLine('no-detail')).toBe('Nothing to match: blank or painted out');
    expect(leftOutLine('off-canvas', 'planar')).toBe('Fell off the canvas: try Cylindrical');
  });

  it('points to Cylindrical only from Planar, the projection a wide pan breaks', () => {
    expect(leftOutWords('off-canvas', 'cylindrical')).toEqual({ say: 'Fell off the canvas', more: '' });
    expect(leftOutWords('something new')).toEqual({ say: 'No overlap', more: '' });
  });
});

describe('the message of a stitch', () => {
  it('counts the pieces it placed', () => {
    expect(stitchedWords(3, [])).toBe('Stitched 3 pieces');
  });

  it('keeps the words it had for pieces with no overlap', () => {
    expect(stitchedWords(1, ['no-overlap'])).toBe('Stitched 1. No overlap found for the outlined piece, left where it was');
    expect(stitchedWords(1, ['no-overlap', 'no-overlap'])).toBe('Stitched 1. No overlap found for the 2 outlined pieces, left where they were');
    expect(stitchedWords(0, ['no-overlap', 'no-overlap'])).toBe('No overlap found between the pieces, so none moved');
  });

  it('says the other reasons, one or many', () => {
    expect(stitchedWords(2, ['no-detail'])).toBe('Stitched 2. The outlined piece stays where it was: nothing to match, blank or painted out');
    expect(stitchedWords(2, ['off-canvas', 'off-canvas'], 'planar')).toBe(
      'Stitched 2. The 2 outlined pieces stay where they were: fell off the canvas, try Cylindrical',
    );
    expect(stitchedWords(2, ['no-overlap', 'no-detail', 'no-overlap'])).toBe(
      'Stitched 2. The 3 outlined pieces stay where they were: 2 with no overlap, 1 with nothing to match',
    );
    expect(stitchedWords(0, ['no-detail', 'off-canvas'], 'spherical')).toBe('None of the pieces moved: 1 with nothing to match, 1 off the canvas');
  });
});
