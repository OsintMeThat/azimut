/** What the analyst knows about a photo, told to Fit: the words, what they stand for, and the request. */
import { describe, expect, it } from 'vitest';
import {
  acrossFor,
  ANY_WITHIN,
  AUTO_REACH,
  cleanHints,
  cleanZoom,
  FACING_HALF,
  hintsSummary,
  NO_HINTS,
  PANORAMA_WITHIN,
  panoramaLikely,
  panoramaOffered,
  panoramaWidth,
  REACHES,
  reachText,
  searchHints,
  toggleZoom,
  ZOOMS,
  zoomText,
  zoomWithin,
} from './hints.js';

describe('what the analyst knows about a photo', () => {
  it('starts at knowing nothing, and anything it cannot read is nothing too', () => {
    expect(cleanHints(undefined)).toEqual(NO_HINTS);
    expect(cleanHints({ zoom: 'huge', facing: { heading: 'north' }, reach: 12_345 })).toEqual(NO_HINTS);
  });

  it('keeps a lens measured on the video, within the lenses there are', () => {
    expect(cleanHints({ lens: { fov: 41.234, at: 12 } }).lens).toEqual({ fov: 41.23, at: 12 });
    expect(cleanHints({ lens: { fov: 400 } })).toEqual(NO_HINTS);
    expect(cleanHints({ lens: { fov: 40, at: -3 } }).lens).toEqual({ fov: 40, at: 0 });
  });

  it('keeps a heading round the turn, at the sector everyone uses', () => {
    expect(cleanHints({ facing: { heading: 370 } }).facing).toEqual({ heading: 10, half: FACING_HALF });
    expect(cleanHints({ facing: { heading: -90 } }).facing.heading).toBe(270);
  });

  it('has zoom words whose lenses overlap, so a lens on a border belongs to both', () => {
    for (let i = 1; i < ZOOMS.length; i += 1) expect(ZOOMS[i].within[1]).toBeGreaterThan(ZOOMS[i - 1].within[0]);
    for (const zoom of ZOOMS) expect(zoom.within[1]).toBeLessThanOrEqual(ANY_WITHIN[1]);
    expect(ZOOMS.map((zoom) => zoom.label)).toEqual(['×0.5', '×1', '×2–3', '×5+']);
    expect(ANY_WITHIN[0]).toBeLessThan(2);
    expect(ANY_WITHIN[1]).toBeGreaterThanOrEqual(110);
  });

  it('turns a phone’s zoom into degrees across the picture’s own shape', () => {
    // a phone's main camera is about 66° across a landscape frame, about 40° across a portrait one
    expect(acrossFor(66, 16 / 9)).toBe(66);
    expect(acrossFor(66, 9 / 16)).toBeCloseTo(40.1, 1);
    expect(zoomWithin(['normal'], 9 / 16)[1]).toBeLessThan(zoomWithin(['normal'], 16 / 9)[1]);
    expect(searchHints({ zoom: 'normal' }, { aspect: 9 / 16 }).within[0]).toBeCloseTo(acrossFor(50, 9 / 16), 0);
  });

  it('takes several zoom words when unsure, from the narrowest to the widest, none being any lens', () => {
    expect(cleanZoom(['zoomed', 'wide', 'zoomed', 'huge'])).toEqual(['wide', 'zoomed']);
    // one word, as views kept it before several could be ticked; 'any' is none
    expect(cleanZoom('normal')).toEqual(['normal']);
    expect(cleanZoom('any')).toEqual([]);
    expect(cleanZoom(undefined)).toEqual([]);
    expect(toggleZoom(['wide'], 'normal')).toEqual(['wide', 'normal']);
    expect(toggleZoom(['wide', 'normal'], 'wide')).toEqual(['normal']);
    expect(zoomWithin([])).toEqual(ANY_WITHIN);
    expect(zoomWithin(['wide', 'normal'])).toEqual([50, 120]);
    // two apart are tried across what lies between
    expect(zoomWithin(['wide', 'zoomed'])).toEqual([20, 120]);
    expect(zoomText(['wide', 'normal'])).toBe('×0.5 or ×1');
    expect(zoomText([])).toBe('');
  });

  it('tries no farther than the auto reach on its own, and keeps farther reaches to be asked for', () => {
    expect(REACHES).toContain(AUTO_REACH);
    expect(REACHES.filter((reach) => reach > AUTO_REACH).length).toBeGreaterThan(0);
    expect(reachText(AUTO_REACH)).toBe('50 km');
  });

  it('sums up what is known in the band’s words', () => {
    expect(hintsSummary(NO_HINTS)).toBe('');
    expect(hintsSummary({ zoom: 'telephoto', facing: { heading: 218 }, reach: 'auto' }, 20_000)).toBe('×5+ · 218° SW · within 20 km');
    expect(hintsSummary({ zoom: ['normal', 'zoomed'] })).toBe('×1 or ×2–3');
    expect(hintsSummary({ reach: 'all' }, null)).toBe('clear air');
    // a reach Fit found reads like one the analyst set
    expect(hintsSummary(NO_HINTS, 10_000)).toBe('within 10 km');
  });

  it('tells the search the lenses and the sector, the lens left out when the photo says it', () => {
    expect(searchHints(NO_HINTS)).toEqual({ within: [1.5, 120] });
    expect(searchHints({ zoom: 'zoomed', facing: { heading: 200 } })).toEqual({ within: [20, 55], facing: [200, FACING_HALF] });
    expect(searchHints({ zoom: ['zoomed', 'normal'] })).toEqual({ within: [20, 85] });
    expect(searchHints({ zoom: 'zoomed' }, { lensKnown: true })).toEqual({});
  });

  it('offers a panorama for any image, never a video, and points a wide picture or a stitched collage to it', () => {
    // a hand-made collage only twice as wide as tall may still be one
    expect(panoramaOffered({ kind: 'image', aspect: 2.1 })).toBe(true);
    expect(panoramaOffered({ kind: 'image', aspect: 4 / 3 })).toBe(true);
    expect(panoramaOffered({ kind: 'video', aspect: 3.5 })).toBe(false);
    expect(panoramaLikely({ kind: 'image', aspect: 4 / 3 })).toBe(false);
    expect(panoramaLikely({ kind: 'image', aspect: 3.5 })).toBe(true);
    expect(panoramaLikely({ kind: 'image', aspect: 2.1, stitched: { degrees: 47 } })).toBe(true);
    expect(panoramaLikely({ kind: 'video', aspect: 3.5 })).toBe(false);
    expect(cleanHints({ picture: 'fisheye' }).picture).toBe('photo');
  });

  it('takes a panorama as wide as its stitch says, else as its shape suggests, within reason', () => {
    expect(panoramaWidth({ aspect: 2, stitched: { degrees: 47.4 } })).toBe(47.4);
    expect(panoramaWidth({ aspect: 3.5 })).toBe(210);
    expect(panoramaWidth({ aspect: 9 })).toBe(PANORAMA_WITHIN[1]);
    expect(panoramaWidth({ aspect: 0.5 })).toBe(PANORAMA_WITHIN[0]);
  });

  it('searches a panorama across the widths a panorama has, and says it is one', () => {
    expect(searchHints({ picture: 'panorama', zoom: 'zoomed' })).toEqual({ within: PANORAMA_WITHIN });
    expect(searchHints({ picture: 'panorama' }, { lensKnown: true })).toEqual({});
    expect(hintsSummary({ picture: 'panorama', zoom: 'zoomed', facing: { heading: 90 } })).toBe('Panorama · 90° E');
  });
});
