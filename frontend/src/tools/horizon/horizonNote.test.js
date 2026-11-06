import { describe, expect, it, vi } from 'vitest';
import { areaKey, areaOffer } from './horizonNote.js';

describe('an area of the view put in a note', () => {
  it('is the photo above the terrain while a photo is laid, else the view alone, filed once at the page width', async () => {
    const keep = vi.fn().mockResolvedValue({ entity: { id: 'e_pair' }, label: 'Ridge, photo above terrain', fresh: true });
    let laid = true;
    let saved = false;
    const offer = areaOffer({ keep, photo: () => laid, unsaved: () => !saved });
    expect(offer).toMatchObject({ id: 'area', label: 'An area of the photo above the terrain', picture: true });
    expect(offer.busy).toMatch(/^Drag over the view/);
    expect(offer.hint).toBe('Drag over the view: the view is saved, then both pictures of the area one above the other, the ridge lines on both');
    // the put's signal reaches the area being dragged, so Cancel calls it off
    const signal = new AbortController().signal;
    expect(await offer.put({ signal })).toEqual({ text: '[[media:e_pair|Ridge, photo above terrain]]{width=100%}', filed: ['e_pair'] });
    expect(keep).toHaveBeenCalledWith({ signal });
    // the same area kept before is cited, and Undo leaves it
    keep.mockResolvedValue({ entity: { id: 'e_pair' }, label: 'R', fresh: false });
    expect((await offer.put({})).filed).toEqual([]);
    // no photo laid: the offer stays, as the view alone
    laid = false;
    saved = true;
    expect(offer.label).toBe('An area of the view');
    expect(offer.hint).toBe('Drag over the view: the area with its names, ruler and credits');
  });

  it('refuses with a sentence when nothing was kept', async () => {
    await expect(areaOffer({ keep: async () => ({}) }).put({})).rejects.toThrow('could not be kept');
  });

  it('tells two areas apart by their box and where they face, not by their size alone', () => {
    const box = { x: 10.4, y: 20, width: 300, height: 200 };
    const lens = { heading: 87.123, tilt: 1.5, fov: 30.004 };
    const key = areaKey(box, lens);
    expect(JSON.parse(key)).toEqual({ x: 10, y: 20, width: 300, height: 200, heading: 87.12, tilt: 1.5, fov: 30 });
    // the same area read again is the same key
    expect(areaKey({ ...box }, { ...lens, heading: 87.1201 })).toBe(key);
    // the same size elsewhere, or under a loupe facing elsewhere, is another picture
    expect(areaKey({ ...box, x: 400 }, lens)).not.toBe(key);
    expect(areaKey(box, { ...lens, heading: 120 })).not.toBe(key);
    // a camera without a tilt still keys
    expect(JSON.parse(areaKey(box, { heading: 5, fov: 60 })).tilt).toBeNull();
  });
});
