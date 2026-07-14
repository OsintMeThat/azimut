import { describe, it, expect } from 'vitest';
import {
  monthKey,
  monthCount,
  tilesShort,
  tilesOfFree,
  freeTierShare,
  FREE_TIER,
} from './usage.js';

describe('monthKey', () => {
  it('formats a UTC year-month bucket', () => {
    expect(monthKey(new Date(Date.UTC(2026, 6, 14)))).toBe('2026-07');
    expect(monthKey(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12');
  });
});

describe('monthCount', () => {
  const usage = { google: { '2026-07': 1234 }, mapbox: { '2026-07': 87 } };

  it('reads the month bucket for a meter', () => {
    expect(monthCount(usage, 'google', '2026-07')).toBe(1234);
  });

  it('is zero for unknown meters or empty usage', () => {
    expect(monthCount(usage, 'bing', '2026-07')).toBe(0);
    expect(monthCount(undefined, 'google', '2026-07')).toBe(0);
    expect(monthCount(usage, 'google', '2026-01')).toBe(0);
  });
});

describe('tilesShort', () => {
  it('is a compact map-pill readout', () => {
    expect(tilesShort(767)).toBe('767 tiles');
    expect(tilesShort(12430)).toBe('12,430 tiles');
    expect(tilesShort(1)).toBe('1 tile');
  });
});

describe('tilesOfFree', () => {
  it('shows the count against the documented free allowance', () => {
    expect(tilesOfFree(767, 'mapbox')).toBe('767 / 200,000 free tiles');
    expect(tilesOfFree(12430, 'google')).toBe('12,430 / 100,000 free tiles');
  });

  it('falls back to the plain count for meters without a known allowance', () => {
    expect(tilesOfFree(42, 'bing')).toBe('42 tiles');
  });
});

describe('freeTierShare', () => {
  it('is the fraction of the free allowance used', () => {
    expect(freeTierShare(100_000, 'mapbox')).toBe(0.5);
    expect(freeTierShare(150_000, 'google')).toBe(1.5); // over — UI can warn
    expect(freeTierShare(500, 'unknown')).toBe(0);
  });

  it('free tiers stay in sync with the label helper', () => {
    expect(FREE_TIER.mapbox).toBe(200_000);
    expect(FREE_TIER.google).toBe(100_000);
  });
});
