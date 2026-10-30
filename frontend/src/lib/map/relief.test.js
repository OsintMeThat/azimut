import { describe, expect, it } from 'vitest';
import { EXAGGERATIONS, exaggerationOf, READING_TILT, STEADY_LEVELS, steadyZoom } from './relief.js';

describe('the 3D view’s settings', () => {
  it('offers real scale first and refuses a made-up exaggeration', () => {
    expect(EXAGGERATIONS[0]).toBe(1);
    expect(exaggerationOf(2)).toBe(2);
    expect(exaggerationOf('1.5')).toBe(1.5);
    expect(exaggerationOf(10)).toBe(1);
    expect(exaggerationOf(undefined)).toBe(1);
  });

  it('leans a flat view only as far as reads the relief on one or two imagery levels', () => {
    expect(READING_TILT).toBeGreaterThan(0);
    expect(READING_TILT).toBeLessThanOrEqual(30);
  });

  it('chooses the imagery again only once the zoom has really moved', () => {
    expect(steadyZoom(15, 16)).toBe(15);
    expect(steadyZoom(15, 14)).toBe(15);
    expect(steadyZoom(15, 15 + STEADY_LEVELS)).toBe(15 + STEADY_LEVELS);
    expect(steadyZoom(15, 15 - STEADY_LEVELS)).toBe(15 - STEADY_LEVELS);
    expect(steadyZoom(undefined, 16)).toBe(16);
  });
});
