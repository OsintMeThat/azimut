import { describe, it, expect } from 'vitest';
import { bidiSafe, hasRtl, LRI, PDI } from './bidi.js';

const ARABIC = 'قصف على المدينة';

describe('hasRtl', () => {
  it('detects Arabic and Hebrew, not Latin', () => {
    expect(hasRtl(ARABIC)).toBe(true);
    expect(hasRtl('עיר עתיקה')).toBe(true);
    expect(hasRtl('Strike on the city, 48.8584, 2.2945')).toBe(false);
    expect(hasRtl('')).toBe(false);
    expect(hasRtl(null)).toBe(false);
  });
});

describe('bidiSafe — isolates LTR runs inside RTL text', () => {
  it('leaves LTR-only text completely untouched', () => {
    const text = 'Kyiv - 8GXG+Q8\n50.450100, 30.523400\n@GeoConfirmed\nhttps://x.com/a/1';
    expect(bidiSafe(text)).toBe(text);
  });

  it('wraps a coordinate pair so the comma cannot flip', () => {
    const out = bidiSafe(`${ARABIC}\n50.450100, 30.523400`);
    expect(out).toContain(`${LRI}50.450100, 30.523400${PDI}`);
  });

  it('wraps URLs, mentions and plus codes', () => {
    const out = bidiSafe(`${ARABIC} @GeoConfirmed 8GXG+Q8 https://t.me/chan/42`);
    expect(out).toContain(`${LRI}@GeoConfirmed${PDI}`);
    expect(out).toContain(`${LRI}8GXG+Q8${PDI}`);
    expect(out).toContain(`${LRI}https://t.me/chan/42${PDI}`);
  });

  it('keeps the RTL prose itself unwrapped', () => {
    const out = bidiSafe(`${ARABIC}\nhttps://x.com/a/1`);
    expect(out.startsWith(ARABIC)).toBe(true);
  });

  it('is idempotent — re-applying never double-wraps', () => {
    const once = bidiSafe(`${ARABIC} 50.450100, 30.523400`);
    expect(bidiSafe(once)).toBe(once);
  });

  it('handles empty/nullish input', () => {
    expect(bidiSafe('')).toBe('');
    expect(bidiSafe(null)).toBe('');
  });
});
