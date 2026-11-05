import { describe, expect, it, vi } from 'vitest';
import { pinCaption, pinOffer } from './pinNote.js';

describe('a pinned candidate put in a note', () => {
  it('is captioned with what the run measured and when, never a verdict', () => {
    expect(pinCaption({
      reading: 'NBR 0.61 → −0.28', strength: 'Strong', area: 12_000,
      a: { date: '2026-03-02' }, b: { date: '2026-03-14' },
    })).toBe('NBR 0.61 → −0.28 (strong) · 1.20 ha · between 2 Mar 2026 and 14 Mar 2026');
    // a method that reads one pass says the day it saw it
    expect(pinCaption({ reading: 'Ships 3', area: 0, b: { date: '2026-03-14' }, single: true }))
      .toBe('Ships 3 · seen 14 Mar 2026');
    expect(pinCaption({})).toBe('');
  });

  it('puts the pin\'s own evidence picture, filing nothing', async () => {
    const evidence = vi.fn().mockResolvedValue({ entity: { id: 'e_ev' }, label: 'Burn scar north' });
    const offer = pinOffer({ evidence, caption: () => 'NBR 0.61 → −0.28 (strong)' });
    expect(offer).toMatchObject({ id: 'pin', label: 'This pin', picture: true });
    expect(await offer.put({})).toEqual({
      text: '[[media:e_ev|Burn scar north]]{caption="NBR 0.61 → −0.28 (strong)"}',
      filed: [],
    });
  });

  it('refuses when the evidence picture left the case', async () => {
    const offer = pinOffer({ evidence: async () => ({ entity: null }), caption: () => '' });
    await expect(offer.put({})).rejects.toThrow('no longer in the case');
  });
});
