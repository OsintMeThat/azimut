import { describe, it, expect } from 'vitest';
import {
  variantId,
  isoDay,
  daysBefore,
  validWindow,
  validDay,
  windowLabel,
  cloudLabel,
  cloudClass,
  monthOf,
  addMonths,
  monthLabel,
  monthBounds,
  monthGrid,
  defaultSearchWindow,
  DEFAULT_LAYER,
  SENTINEL_ID,
} from './sentinel.js';

describe('variantId', () => {
  it('leaves the plain default basemap as the bare id', () => {
    // a second name for the same thing would cache twice and read as two
    // providers in a capture's provenance
    expect(variantId(SENTINEL_ID)).toBe('sentinel2');
    expect(variantId(SENTINEL_ID, { layer: DEFAULT_LAYER })).toBe('sentinel2');
    expect(variantId(SENTINEL_ID, { layer: '' })).toBe('sentinel2');
  });

  it('packs the layer and the window into the id', () => {
    expect(variantId(SENTINEL_ID, { layer: 'SWIR' })).toBe('sentinel2~SWIR');
    expect(variantId(SENTINEL_ID, { layer: 'SWIR', from: '2026-05-01', to: '2026-05-31' })).toBe(
      'sentinel2~SWIR~2026-05-01~2026-05-31'
    );
    // a window on the default layer still needs naming
    expect(variantId(SENTINEL_ID, { from: '2026-05-01', to: '2026-05-01' })).toBe(
      'sentinel2~TRUE_COLOR~2026-05-01~2026-05-01'
    );
  });

  it('ignores half a window (both ends or neither)', () => {
    expect(variantId(SENTINEL_ID, { layer: 'SWIR', from: '2026-05-01' })).toBe('sentinel2~SWIR');
  });

  it('never touches another provider', () => {
    expect(variantId('esri-world-imagery', { layer: 'SWIR' })).toBe('esri-world-imagery');
  });
});

describe('isoDay / daysBefore', () => {
  it('dates by the UTC calendar, not the viewer timezone', () => {
    expect(isoDay(new Date(Date.UTC(2026, 6, 14, 23, 30)))).toBe('2026-07-14');
  });

  it('walks back across a month boundary', () => {
    expect(daysBefore(14, new Date(Date.UTC(2026, 6, 7)))).toBe('2026-06-23');
    expect(daysBefore(0, new Date(Date.UTC(2026, 6, 7)))).toBe('2026-07-07');
  });
});

describe('validWindow', () => {
  it('accepts a well-formed range in order', () => {
    expect(validWindow('2026-05-01', '2026-05-31')).toBe(true);
    expect(validWindow('2026-05-01', '2026-05-01')).toBe(true); // a single day
  });

  it('rejects what the backend would reject, before it costs a request', () => {
    expect(validWindow('2026-05-31', '2026-05-01')).toBe(false); // reversed
    expect(validWindow('2026-05-01', '')).toBe(false);
    expect(validWindow('05/01/2026', '2026-05-31')).toBe(false);
    expect(validWindow('2026-5-1', '2026-05-31')).toBe(false); // half-typed
    expect(validWindow(undefined, undefined)).toBe(false);
  });
});

describe('windowLabel', () => {
  it('reads as a day, a range, or the layer default', () => {
    expect(windowLabel('2026-05-01', '2026-05-01')).toBe('2026-05-01');
    expect(windowLabel('2026-05-01', '2026-05-31')).toBe('2026-05-01 → 2026-05-31');
    expect(windowLabel('', '')).toBe('most recent');
    expect(windowLabel('2026-05-31', '2026-05-01')).toBe('most recent');
  });
});

describe('cloudLabel', () => {
  it('is the reason to skip a date without paying to find out', () => {
    expect(cloudLabel(3.4)).toBe('3% cloud');
    expect(cloudLabel(0)).toBe('0% cloud');
  });

  it('is empty when the service gave no figure', () => {
    expect(cloudLabel(null)).toBe('');
    expect(cloudLabel(undefined)).toBe('');
  });
});

describe('validDay', () => {
  it('accepts one well-formed day and nothing else', () => {
    expect(validDay('2026-05-01')).toBe(true);
    expect(validDay('2026-5-1')).toBe(false);
    expect(validDay('')).toBe(false);
  });
});

describe('cloudClass', () => {
  it('grades a pass by how much of it is cloud', () => {
    expect(cloudClass(0)).toBe('clear');
    expect(cloudClass(19.9)).toBe('clear');
    expect(cloudClass(20)).toBe('part');
    expect(cloudClass(59)).toBe('part');
    expect(cloudClass(60)).toBe('cloudy');
    // a pass with no figure is still a pass — it must not read as clear
    expect(cloudClass(null)).toBe('unknown');
    expect(cloudClass(undefined)).toBe('unknown');
  });
});

describe('month arithmetic', () => {
  it('reads the month off a day, defaulting to now', () => {
    expect(monthOf('2026-05-14')).toBe('2026-05');
    expect(monthOf('')).toMatch(/^\d{4}-\d{2}$/);
  });

  it('steps months without a 31st spilling into the next one', () => {
    expect(addMonths('2026-01', 1)).toBe('2026-02');
    expect(addMonths('2026-03', -1)).toBe('2026-02');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('labels a month for a human', () => {
    expect(monthLabel('2026-07')).toBe('July 2026');
  });

  it('bounds a month, leap years included', () => {
    expect(monthBounds('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthBounds('2028-02').to).toBe('2028-02-29'); // leap
  });
});

describe('monthGrid', () => {
  it('pads the first day onto its weekday, Monday-first', () => {
    // 2026-07-01 is a Wednesday → two blanks before it
    const cells = monthGrid('2026-07');
    expect(cells.slice(0, 4)).toEqual([null, null, '2026-07-01', '2026-07-02']);
    expect(cells.at(-1)).toBe('2026-07-31');
    expect(cells.filter(Boolean)).toHaveLength(31);
  });

  it('needs no padding when a month opens on a Monday', () => {
    // 2026-06-01 is a Monday
    expect(monthGrid('2026-06')[0]).toBe('2026-06-01');
  });

  it('handles a Sunday start (the last Monday-first column)', () => {
    // 2026-02-01 is a Sunday → six blanks
    const cells = monthGrid('2026-02');
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe('2026-02-01');
  });
});

describe('defaultSearchWindow', () => {
  it('covers several revisits (Sentinel-2 passes every ~5 days)', () => {
    const now = new Date(Date.UTC(2026, 6, 14));
    expect(defaultSearchWindow(30, now)).toEqual({ from: '2026-06-14', to: '2026-07-14' });
  });
});
