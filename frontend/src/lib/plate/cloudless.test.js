import { describe, expect, it } from 'vitest';
import { CLOUDLESS_ID, cloudlessId, cloudlessSaid, cloudlessYear } from './cloudless.js';

describe('Sentinel-2 cloudless as a plate\'s ground', () => {
  const years = [{ year: 2025 }, { year: 2024 }, { year: 2016 }];

  it('asks for its own year\'s tiles, or the newest', () => {
    expect(cloudlessId(2016)).toBe(`${CLOUDLESS_ID}~2016`);
    expect(cloudlessId(null)).toBe(CLOUDLESS_ID);
  });

  it('reads the year a map shows, the newest when it names none or one no longer offered', () => {
    expect(cloudlessYear({ year: 2016 }, years)).toEqual({ year: 2016 });
    expect(cloudlessYear({}, years)).toEqual({ year: 2025 });
    expect(cloudlessYear({ year: 2017 }, years)).toEqual({ year: 2025 });
    expect(cloudlessYear({}, [])).toBe(null);
  });

  it('says a year\'s mosaic, never a day', () => {
    expect(cloudlessSaid({ year: 2024 })).toBe("Sentinel-2 cloudless 2024, a year's mosaic");
    expect(cloudlessSaid(null)).toBe('');
  });
});
