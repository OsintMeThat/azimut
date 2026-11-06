import { describe, expect, it, vi } from 'vitest';
import { areaKey, pairOffer, reliefSources, viewpointOffer, viewpointText } from './horizonNote.js';

const observer = { lat: 46.5586, lon: 7.8353, mode: 'ground', height: 1.7 };
const camera = { heading: 107.4, fov: 60.64, projection: 'camera' };
const panorama = { observer: { altitude: 412.3 }, resolution: 30, credits: [{ label: 'Copernicus DEM GLO-30', attribution: 'x' }, { label: 'Copernicus DEM GLO-30' }] };

describe('the viewpoint of a Horizon view put in a note', () => {
  it('says the eye, where it looks and the relief it was read on, one line each', () => {
    expect(viewpointText({ observer, camera, panorama })).toBe([
      '- Eye: 46.55860, 7.83530, on foot, 1.7 m above the ground (412 m above the sea)',
      '- Looking: 107° E, field of view 60.6°',
      '- Relief: Copernicus DEM GLO-30, read at 30 m',
    ].join('\n'));
  });

  it('gives an aircraft its height above the sea, and a whole turn its width', () => {
    expect(viewpointText({ observer: { ...observer, mode: 'aircraft', height: 1200.4 }, camera: { heading: 180, fov: 360, projection: 'panorama' } }))
      .toBe('- Eye: 46.55860, 7.83530, aircraft, 1200 m above the sea\n- Looking: 180° S, 360° across');
  });

  it('says what it knows and nothing more: no relief line without a turn read, no look without a camera', () => {
    expect(viewpointText({ observer })).toBe('- Eye: 46.55860, 7.83530, on foot, 1.7 m above the ground');
    expect(viewpointText({})).toBe('');
    expect(reliefSources(null)).toEqual([]);
    expect(reliefSources(panorama)).toEqual(['Copernicus DEM GLO-30']);
  });

  it('is never a score: nothing of Find reaches the text', () => {
    const text = viewpointText({ observer, camera, panorama, find: { score: 0.76, rank: 1 } });
    expect(text).not.toMatch(/score|rank|explains|%/i);
  });

  it('is offered as text, and refuses with a sentence when no eye stands', async () => {
    const offer = viewpointOffer({ read: () => ({ observer, camera, panorama }) });
    expect(offer).toMatchObject({ id: 'viewpoint', label: 'This viewpoint' });
    expect(offer.picture).toBeUndefined();
    expect((await offer.put({})).text).toContain('- Eye: 46.55860, 7.83530');
    await expect(viewpointOffer({ read: () => ({}) }).put({})).rejects.toThrow('Stand an eye');
  });
});

describe('an area of the photo above the terrain put in a note', () => {
  it('files both pictures of the area once, at the page width', async () => {
    const keep = vi.fn().mockResolvedValue({ entity: { id: 'e_pair' }, label: 'Ridge, photo above terrain', fresh: true });
    const offer = pairOffer({ keep, unsaved: () => true });
    expect(offer).toMatchObject({ id: 'pair', label: 'An area of the photo above the terrain', picture: true });
    expect(offer.busy).toMatch(/^Drag over the view/);
    expect(offer.hint).toBe('Drag over the view: the view is saved, then both pictures of the area filed one above the other');
    // the put's signal reaches the area being dragged, so Cancel calls it off
    const signal = new AbortController().signal;
    expect(await offer.put({ signal })).toEqual({ text: '[[media:e_pair|Ridge, photo above terrain]]{width=100%}', filed: ['e_pair'] });
    expect(keep).toHaveBeenCalledWith({ signal });
    keep.mockResolvedValue({ entity: { id: 'e_pair' }, label: 'R', fresh: false });
    expect((await offer.put({})).filed).toEqual([]);
    expect(pairOffer({ keep, unsaved: () => false }).hint)
      .toBe('Drag over the view: both pictures of the area one above the other, the ridge lines on both');
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

  it('refuses with a sentence when nothing was kept', async () => {
    await expect(pairOffer({ keep: async () => ({}) }).put({})).rejects.toThrow('could not be kept');
  });
});
