import { describe, expect, it } from 'vitest';
import { PLATE_MAXCC, passCredit, passId } from './sentinelPass.js';

describe('a plate map on one Sentinel-2 pass', () => {
  it('asks for the pass\'s day alone, in its layer and under its ceiling, and for nothing until a pass is picked', () => {
    expect(passId({ acquired: '2026-05-12' })).toBe('sentinel2~TRUE_COLOR~2026-05-12~2026-05-12');
    expect(passId({ acquired: '2026-05-12', product: 'SWIR', maxcc: 30 })).toBe('sentinel2~SWIR~2026-05-12~2026-05-12~CC30');
    expect(passId({ acquired: null, product: 'SWIR' })).toBeNull();
    expect(passId({})).toBeNull();
    expect(PLATE_MAXCC).toBe(30);
  });

  it('credits a pass by its day, and by its layer when it is not true colour', () => {
    expect(passCredit({ acquired: '2026-05-12' })).toBe('Sentinel-2 pass of 2026-05-12');
    expect(passCredit({ acquired: '2026-05-12', product: 'FALSE_COLOR' })).toBe('Sentinel-2 false color pass of 2026-05-12');
    expect(passCredit({ acquired: null })).toBe('');
  });
});
