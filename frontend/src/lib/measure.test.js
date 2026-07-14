import { describe, it, expect } from 'vitest';
import {
  haversine,
  pathLength,
  polygonArea,
  angleAt,
  formatDistance,
  formatArea,
  formatAngle,
} from './measure.js';

describe('haversine', () => {
  it('measures a known one-degree of latitude (~111 km)', () => {
    const d = haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  it('is zero for identical points', () => {
    expect(haversine({ lat: 48.8, lon: 2.3 }, { lat: 48.8, lon: 2.3 })).toBe(0);
  });
});

describe('pathLength', () => {
  it('sums consecutive legs', () => {
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 2 },
    ];
    expect(pathLength(pts)).toBeCloseTo(2 * haversine(pts[0], pts[1]), 0);
  });

  it('is zero for a single point', () => {
    expect(pathLength([{ lat: 1, lon: 1 }])).toBe(0);
  });
});

describe('polygonArea', () => {
  it('needs at least three points', () => {
    expect(polygonArea([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }])).toBe(0);
  });

  it('approximates a 1°×1° cell near the equator (~12,300 km²)', () => {
    const km2 =
      polygonArea([
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
        { lat: 1, lon: 1 },
        { lat: 1, lon: 0 },
      ]) / 1e6;
    expect(km2).toBeGreaterThan(12000);
    expect(km2).toBeLessThan(12500);
  });

  it('is orientation-independent (always positive)', () => {
    const cw = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 0, lon: 1 },
    ];
    expect(polygonArea(cw)).toBeGreaterThan(0);
  });
});

describe('angleAt', () => {
  it('is 90° for a right angle', () => {
    const a = { lat: 1, lon: 0 };
    const v = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 1 };
    expect(angleAt(a, v, b)).toBeCloseTo(90, 1);
  });

  it('is 180° for a straight line', () => {
    expect(angleAt({ lat: 0, lon: -1 }, { lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(
      180,
      1
    );
  });
});

describe('formatting', () => {
  it('switches metres → km', () => {
    expect(formatDistance(250)).toBe('250 m');
    expect(formatDistance(1500)).toBe('1.50 km');
  });

  it('switches m² → ha → km²', () => {
    expect(formatArea(500)).toBe('500 m²');
    expect(formatArea(50000)).toBe('5.00 ha');
    expect(formatArea(5e6)).toBe('5.00 km²');
  });

  it('reports the acute and obtuse angle pair', () => {
    expect(formatAngle(90)).toBe('90.0° · 90.0°');
    expect(formatAngle(65)).toBe('65.0° · 115.0°');
    expect(formatAngle(150)).toBe('30.0° · 150.0°');
  });
});
