import { describe, expect, it, vi } from 'vitest';
import { collageOffer, frameClock, frameLabel, frameOffer, frameWidth } from './frameNote.js';

describe('a frame put in a note', () => {
  it('is labelled with the instant it was cut at', () => {
    expect(frameClock(12.48)).toBe('00:12.480');
    expect(frameClock(3723.4567)).toBe('1:02:03.457');
    expect(frameLabel({ time: 12.48 }, 'clip 00-12')).toBe('Frame at 00:12.480');
    // an edited still has no instant: it keeps its saved name
    expect(frameLabel({ time: null }, 'photo edit')).toBe('photo edit');
  });

  it('takes half the page, less for a tall phone frame', () => {
    expect(frameWidth({ w: 1920, h: 1080 })).toBe('50%');
    expect(frameWidth({ w: 1080, h: 1920 })).toBe('39%');
    expect(frameWidth({})).toBe('50%');
  });

  it('cites a frame already saved, and Undo leaves it in the case', async () => {
    const file = vi.fn().mockResolvedValue({ entity: { id: 'e_frame' }, fresh: false });
    const offer = frameOffer({ frame: () => ({ id: 'f1', time: 12.48, w: 1920, h: 1080 }), file });
    expect(offer).toMatchObject({ id: 'frame', label: 'This frame', picture: true });
    expect(await offer.put({})).toEqual({ text: '[[media:e_frame|Frame at 00:12.480]]{width=50%}', filed: [] });
  });

  it('saves a frame not saved yet, which Undo sends to the Trash', async () => {
    const shown = { id: 'f1', time: 1, w: 100, h: 100 };
    const file = vi.fn().mockResolvedValue({ entity: { id: 'e_new' }, fresh: true });
    const offer = frameOffer({ frame: () => shown, file });
    const put = await offer.put({ signal: 'sig' });
    expect(file).toHaveBeenCalledWith(shown, { signal: 'sig' });
    expect(put.filed).toEqual(['e_new']);
  });

  it('refuses with a sentence when there is no frame or it could not be saved', async () => {
    await expect(frameOffer({ frame: () => null, file: vi.fn() }).put({})).rejects.toThrow('No frame is open');
    const failing = frameOffer({ frame: () => ({ id: 'f', time: 0 }), file: async () => ({ entity: null }) });
    await expect(failing.put({})).rejects.toThrow('could not be saved');
  });
});

describe('a collage put in a note', () => {
  it('goes in at the page width under its own name', async () => {
    const offer = collageOffer({ title: () => 'Quay panorama', file: async () => ({ entity: { id: 'e_c' }, fresh: true }) });
    expect(offer).toMatchObject({ id: 'collage', label: 'This collage', picture: true });
    expect(await offer.put({})).toEqual({ text: '[[media:e_c|Quay panorama]]{width=100%}', filed: ['e_c'] });
  });
});
