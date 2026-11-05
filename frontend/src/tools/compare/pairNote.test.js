import { describe, expect, it, vi } from 'vitest';
import { nearestPlace, pairName, pairOffer } from './pairNote.js';

describe('a Compare pair put in a note', () => {
  const rows = [
    { kind: 'place', title: 'Water tower', lat: 15.3700, lon: 44.1910 },
    { kind: 'place', title: 'Far mosque', lat: 15.40, lon: 44.21 },
    { kind: 'capture', title: '15.369, 44.191', lat: 15.3694, lon: 44.1910 },
  ];

  it('is named after the case\'s place there, else its point, then its two days', () => {
    const place = nearestPlace(rows, 15.3694, 44.1910);
    expect(place).toBe('Water tower');
    expect(pairName({ place, a: { imageryWhen: '2024-05-03', imageryExact: false }, b: { imageryWhen: '2026-09-02T10:00:00Z' } }))
      .toBe('Water tower, ~2024-05-03 to 2026-09-02');
    // nothing saved within reach: the point names it
    expect(nearestPlace(rows, 16, 45)).toBe('');
    expect(pairName({ lat: 15.369412, lon: 44.19104, a: {}, b: { imageryWhen: '2026-09-02' } }))
      .toBe('15.3694, 44.1910, undated to 2026-09-02');
  });

  it('keeps both pictures side by side at the page width, kept once', async () => {
    const keep = vi.fn().mockResolvedValue({ entity: { id: 'e_pair' }, label: 'Water tower, 2024 to 2026', fresh: true });
    const offer = pairOffer({ keep, unsaved: () => true });
    expect(offer).toMatchObject({ id: 'pair', label: 'This pair', picture: true });
    expect(offer.hint).toBe('Saves the comparison, then keeps both pictures side by side');
    expect(await offer.put({})).toEqual({ text: '[[media:e_pair|Water tower, 2024 to 2026]]{width=100%}', filed: ['e_pair'] });
    // the same pair kept before is cited, and Undo leaves it
    keep.mockResolvedValue({ entity: { id: 'e_pair' }, label: 'P', fresh: false });
    expect((await offer.put({})).filed).toEqual([]);
  });

  it('refuses with a sentence when the pair could not be kept', async () => {
    const offer = pairOffer({ keep: async () => ({ entity: null }) });
    await expect(offer.put({})).rejects.toThrow('could not be kept');
  });
});
