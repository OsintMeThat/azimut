import { describe, expect, it, vi } from 'vitest';
import { measureNoteText, measureOffer, pointNoteText, pointOffer, viewOffer, viewWidth } from './mapNote.js';

describe('the map view put in a note', () => {
  it('is a capture at half the page, named after the place open, and filed once', async () => {
    const take = vi.fn().mockResolvedValue({ entity: { id: 'e_cap', label: '15.369400, 44.191000' }, fresh: true, width: 1200, height: 675 });
    const offer = viewOffer({ take, label: () => 'Water tower' });
    expect(offer).toMatchObject({ id: 'view', label: 'This view', picture: true });
    expect(await offer.put({})).toEqual({ text: '[[media:e_cap|Water tower]]{width=50%}', filed: ['e_cap'] });
    // the same view again is the capture already filed, which Undo leaves
    take.mockResolvedValue({ entity: { id: 'e_cap', label: '15.369400, 44.191000' }, fresh: false, width: 1200, height: 675 });
    const again = await viewOffer({ take }).put({});
    expect(again).toEqual({ text: '[[media:e_cap|15.369400, 44.191000]]{width=50%}', filed: [] });
  });

  it('keeps a tall frame within half the page height', () => {
    expect(viewWidth(1200, 675)).toBe('50%');
    expect(viewWidth(675, 1200)).toBe('39%');
  });

  it('refuses with the capture\'s own sentence', async () => {
    const offer = viewOffer({ take: () => Promise.reject(new Error('Google views are captured through the Azimut Capture extension')) });
    await expect(offer.put({})).rejects.toThrow('Azimut Capture extension');
  });
});

describe('a point put in a note', () => {
  it('writes five decimals, which the note makes a chip', async () => {
    expect(pointNoteText({ lat: 15.3694123, lon: 44.19104 })).toBe('15.36941, 44.19104');
    const put = await pointOffer({ point: () => ({ lat: -33.9, lon: 151.2 }) }).put({});
    expect(put).toEqual({ text: '-33.90000, 151.20000', inline: true });
  });

  it('leads with the saved place open, then its own coordinates', () => {
    expect(pointNoteText({ place: { id: 'e_pl', label: 'Water [tower]', lat: 15.37, lon: 44.191 }, lat: 1, lon: 2 }))
      .toBe('[[entity:e_pl|Water tower]] 15.37000, 44.19100');
  });

  it('refuses a point off the Earth', async () => {
    await expect(pointOffer({ point: () => ({ lat: 95, lon: 0 }) }).put({})).rejects.toThrow('No point');
  });
});

describe('the measure in hand put in a note', () => {
  it('writes what its Copy gives, line by line, then what it assumes', () => {
    expect(measureNoteText({
      text: 'Distance 1.2 km, bearing 45.0° (back 225.0°)\nFrom 15.36941, 44.19104 to 15.37700, 44.19900\nAbout 12 m tall (sun at 225°, 45.0° up at 14:05 AST)',
      use: 'shadow',
      shadowDate: '2026-03-12',
    })).toBe([
      '- Distance 1.2 km, bearing 45.0° (back 225.0°)',
      '- From 15.36941, 44.19104 to 15.37700, 44.19900',
      '- About 12 m tall (sun at 225°, 45.0° up at 14:05 AST)',
      '- Sun read for 2026-03-12.',
      '- Assumes level ground seen from overhead.',
    ].join('\n'));
  });

  it('says the ground is bare when heights were read, and nothing for a flat distance', () => {
    expect(measureNoteText({ text: 'Distance 3 km', use: 'line', ground: true }))
      .toBe('- Distance 3 km\n- Bare ground: buildings and trees are not in the heights.');
    expect(measureNoteText({ text: 'Area 2 ha, perimeter 600 m' })).toBe('- Area 2 ha, perimeter 600 m');
  });

  it('refuses when no measure is drawn', async () => {
    await expect(measureOffer({ measure: () => null }).put({})).rejects.toThrow('Draw a measure first');
  });
});
