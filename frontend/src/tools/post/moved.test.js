import { describe, expect, it } from 'vitest';
import { movedNames } from './moved.js';

describe('movedNames — what a rename elsewhere moved under the post open', () => {
  it('reads a proof renamed, and a picture and a video renamed in Media', () => {
    const written = {
      proofPng: 'proofs/Depot.png', mediaPaths: ['media/roof.png', 'media/yard.png'],
      description: 'Smoke over the depot',
    };
    const onDisk = { ...written, proofPng: 'proofs/Fuel depot.png', mediaPaths: ['media/North roof.png', 'media/yard.png'] };
    expect(movedNames(written, onDisk)).toEqual(new Map([
      ['proofs/Depot.png', 'proofs/Fuel depot.png'], ['media/roof.png', 'media/North roof.png'],
    ]));
  });

  it('reads a video thread\'s place keys and pictures renamed with their proof', () => {
    const written = {
      kind: 'video', video: 'media/convoy.mp4', first: 'place:Depot',
      extraTweets: [
        { text: 'Mine', key: 'place:Depot', mediaPaths: ['proofs/Depot.png'] },
        { text: '', key: 'place:Yard', mediaPaths: ['proofs/Yard.png'] },
      ],
    };
    const onDisk = {
      ...written, first: 'place:Fuel depot',
      extraTweets: [
        { text: 'Mine', key: 'place:Fuel depot', mediaPaths: ['proofs/Fuel depot.png'] },
        { text: '', key: 'place:Yard', mediaPaths: ['proofs/Yard.png'] },
      ],
    };
    expect(movedNames(written, onDisk)).toEqual(new Map([
      ['place:Depot', 'place:Fuel depot'], ['proofs/Depot.png', 'proofs/Fuel depot.png'],
    ]));
  });

  it('reads nothing when nothing moved, and no rename in a change the composer made itself', () => {
    const written = { proofPng: 'proofs/Depot.png', mediaPaths: ['media/a.png', 'media/b.png'] };
    expect(movedNames(written, structuredClone(written)).size).toBe(0);
    // two pictures reordered while the write was on its way: both names still stand
    expect(movedNames(written, { ...written, mediaPaths: ['media/b.png', 'media/a.png'] }).size).toBe(0);
    // a proof taken off is no rename, nor is a draft that could not be read
    expect(movedNames(written, { ...written, proofPng: null }).size).toBe(0);
    expect(movedNames(written, null).size).toBe(0);
    expect(movedNames(null, written).size).toBe(0);
  });
});
