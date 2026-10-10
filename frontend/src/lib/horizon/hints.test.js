/** What the analyst knows about a photo, told to Fit: the words, what they stand for, and the request. */
import { describe, expect, it } from 'vitest';
import {
  AUTO_REACH,
  cleanHints,
  FACING_HALF,
  hintsSummary,
  NO_HINTS,
  REACHES,
  reachText,
  saysNothing,
  searchHints,
  ZOOMS,
} from './hints.js';

describe('what the analyst knows about a photo', () => {
  it('starts at knowing nothing, and anything it cannot read is nothing too', () => {
    expect(saysNothing(NO_HINTS)).toBe(true);
    expect(cleanHints(undefined)).toEqual(NO_HINTS);
    expect(cleanHints({ zoom: 'huge', facing: { heading: 'north' }, reach: 12_345 })).toEqual(NO_HINTS);
  });

  it('keeps a heading round the turn, at the sector everyone uses', () => {
    expect(cleanHints({ facing: { heading: 370 } }).facing).toEqual({ heading: 10, half: FACING_HALF });
    expect(cleanHints({ facing: { heading: -90 } }).facing.heading).toBe(270);
  });

  it('has zoom words whose lenses overlap, so a lens on a border belongs to both', () => {
    const ranged = ZOOMS.filter((zoom) => zoom.id !== 'any');
    for (let i = 1; i < ranged.length; i += 1) expect(ranged[i].within[1]).toBeGreaterThan(ranged[i - 1].within[0]);
    const any = ZOOMS.find((zoom) => zoom.id === 'any').within;
    for (const zoom of ranged) expect(zoom.within[1]).toBeLessThanOrEqual(110);
    expect(any[0]).toBeLessThan(2);
    expect(any[1]).toBeGreaterThanOrEqual(110);
  });

  it('tries no farther than the auto reach on its own, and keeps farther reaches to be asked for', () => {
    expect(REACHES).toContain(AUTO_REACH);
    expect(REACHES.filter((reach) => reach > AUTO_REACH).length).toBeGreaterThan(0);
    expect(reachText(AUTO_REACH)).toBe('50 km');
  });

  it('sums up what is known in the band’s words', () => {
    expect(hintsSummary(NO_HINTS)).toBe('');
    expect(hintsSummary({ zoom: 'telephoto', facing: { heading: 218 }, reach: 'auto' }, 20_000)).toBe('Very zoomed · 218° SW · within 20 km');
    expect(hintsSummary({ reach: 'all' }, null)).toBe('clear air');
    // a reach Fit found reads like one the analyst set
    expect(hintsSummary(NO_HINTS, 10_000)).toBe('within 10 km');
  });

  it('tells the search the lenses and the sector, the lens left out when the photo says it', () => {
    expect(searchHints(NO_HINTS)).toEqual({ within: [1.5, 120] });
    expect(searchHints({ zoom: 'zoomed', facing: { heading: 200 } })).toEqual({ within: [10, 35], facing: [200, FACING_HALF] });
    expect(searchHints({ zoom: 'zoomed' }, { lensKnown: true })).toEqual({});
  });
});
