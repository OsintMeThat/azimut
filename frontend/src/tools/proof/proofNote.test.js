import { describe, expect, it, vi } from 'vitest';
import { pointCoords, pointLine, proofCaption, proofNoteText, proofOffer } from './proofNote.js';

const PROOF = { id: 'e_proof', type: 'proof', label: 'Port strike', attrs: { path: 'proofs/Port strike.png' } };

describe('a proof put in a note', () => {
  it('shows the picture at the page width, captioned with its own sentence, then each point', () => {
    const text = proofNoteText(PROOF, {
      description: 'Smoke rises over the north quay',
      when: '2026-03-12T14:05:00+03:00',
      whenZone: 'Asia/Aden',
      lines: [
        { coords: '15.369410, 44.191040', label: 'Rooftop', pov: true },
        { coords: '15.37, 44.19', label: 'Crane', pov: false },
        { coords: '15.371234567, 44.192', label: '', pov: false },
      ],
    });
    const [picture, blank, ...points] = text.split('\n');
    expect(picture).toMatch(/^\[\[media:e_proof\|Port strike\]\]\{width=100% caption="Smoke rises over the north quay · 2026-03-12 14:05 UTC\+3"\}$/);
    expect(blank).toBe('');
    expect(points).toEqual([
      '- Rooftop (point of view): 15.369410, 44.191040',
      // a coarse point is never dressed up as a precise one
      '- Crane (shown): 15.37, 44.19',
      '- Shown: 15.371234567, 44.192',
    ]);
  });

  it('prefills only what the analyst stated: no sentence and no date, no caption', () => {
    expect(proofCaption({})).toBe('');
    expect(proofNoteText(PROOF, { lines: [] })).toBe('[[media:e_proof|Port strike]]{width=100%}');
  });

  it('writes a point it can read as decimal degrees, and keeps any other as typed', () => {
    expect(pointCoords('48°51′N 2°17′E')).toMatch(/^48\.85\d*, 2\.28\d*$/);
    expect(pointCoords('north end of the bridge')).toBe('north end of the bridge');
    expect(pointLine({ coords: '', label: 'Nowhere' })).toBe('');
  });

  it('waits for the proof to be saved, and refuses when it was not', async () => {
    const saved = vi.fn().mockResolvedValue({ entity: PROOF, description: 'A', lines: [] });
    const offer = proofOffer({ saved, unsaved: () => true });
    expect(offer).toMatchObject({ id: 'proof', label: 'This proof', icon: 'proof', picture: true });
    expect(offer.hint).toBe('Saves the proof, then puts it in with its points');
    const put = await offer.put({ signal: undefined });
    expect(put).toEqual({ text: '[[media:e_proof|Port strike]]{width=100% caption="A"}', filed: [] });

    const refused = proofOffer({ saved: () => Promise.reject(new Error('The proof was not saved, so nothing went in')) });
    await expect(refused.put({})).rejects.toThrow('not saved');
    const blank = proofOffer({ saved: async () => ({ entity: null }) });
    await expect(blank.put({})).rejects.toThrow('no picture yet');
  });

  it('files nothing for the note: the proof is the analyst\'s own work, cited as it is', async () => {
    const offer = proofOffer({ saved: async () => ({ entity: PROOF }) });
    expect((await offer.put({})).filed).toEqual([]);
    expect(offer.hint).toBe('Its picture, its sentence and its points');
  });
});
