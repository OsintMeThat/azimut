import { describe, it, expect } from 'vitest';
import { bearingBetween } from './horizon/geometry.js';
import {
  containsPoint,
  haversine,
  pathLength,
  polygonArea,
  angleAt,
  formatDistance,
  formatArea,
  formatHeight,
  formatBearing,
  destination,
  orientedExtent,
  perimeter,
  crossing,
  centroid,
  cone,
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

  it('reads a bearing as three digits, wrapping a whisker short of north to north', () => {
    expect(formatBearing(47)).toBe('047°');
    expect(formatBearing(47.26, 1)).toBe('047.3°');
    expect(formatBearing(359.7)).toBe('000°');
    expect(formatBearing(359.96, 1)).toBe('000.0°');
    expect(formatBearing(-90)).toBe('270°');
  });
});

describe('nautical units', () => {
  it('reads distances in nautical miles and heights in metres', () => {
    expect(formatDistance(1852, 'nautical')).toBe('1.00 NM');
    expect(formatDistance(463, 'nautical')).toBe('0.25 NM');
    expect(formatDistance(1852 * 150, 'nautical')).toBe('150.0 NM');
    expect(formatHeight(12.4, 'nautical')).toBe('12 m');
  });

  it('reads a sea area in square nautical miles, a small one as on land', () => {
    expect(formatArea(1852 * 1852 * 3, 'nautical')).toBe('3.00 NM²');
    expect(formatArea(500, 'nautical')).toBe('500 m²');
  });
});

describe('the shapes a measure draws', () => {
  const square = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.01 },
    { lat: 0.01, lon: 0.01 },
    { lat: 0.01, lon: 0 },
  ];

  it('goes round a ring back to its first corner for the perimeter', () => {
    expect(perimeter(square)).toBeCloseTo(4 * haversine(square[0], square[1]), 0);
    expect(perimeter(square.slice(0, 2))).toBeCloseTo(haversine(square[0], square[1]), 6);
  });

  it('finds where two drawn lines cross, and nothing where they miss', () => {
    const at = crossing(square[0], square[2], square[1], square[3]);
    expect(at.lat).toBeCloseTo(0.005, 6);
    expect(at.lon).toBeCloseTo(0.005, 6);
    expect(crossing(square[0], square[1], square[3], square[2])).toBe(null); // parallel
    expect(crossing(square[0], { lat: 0.001, lon: 0.001 }, square[1], square[3])).toBe(null); // short of it
  });

  it('writes an area in its middle', () => {
    const middle = centroid(square);
    expect(middle.lat).toBeCloseTo(0.005, 6);
    expect(middle.lon).toBeCloseTo(0.005, 6);
  });

  it('lays a view cone from its apex, as wide as asked, as long as asked', () => {
    const apex = { lat: 46, lon: 7 };
    const shape = cone(apex, 90, 60, 1000);
    expect(shape[0]).toEqual(apex);
    for (const point of shape.slice(1)) expect(haversine(apex, point)).toBeCloseTo(1000, 0);
    expect(bearingBetween(apex, shape[1])).toBeCloseTo(60, 1);
    expect(bearingBetween(apex, shape.at(-1))).toBeCloseTo(120, 1);
    // a full turn is a ring round the apex, with no wedge back to it
    expect(cone(apex, 0, 360, 1000)[0]).not.toEqual(apex);
  });
});

describe('imperial units', () => {
  it('switches ft → mi', () => {
    expect(formatDistance(1, 'imperial')).toBe('3.3 ft');
    expect(formatDistance(250, 'imperial')).toBe('820 ft');
    expect(formatDistance(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatDistance(50000, 'imperial')).toBe('31.1 mi');
  });

  it('switches ft² → acres → mi²', () => {
    expect(formatArea(500, 'imperial')).toBe('5382 ft²');
    expect(formatArea(50000, 'imperial')).toBe('12.36 acres');
    expect(formatArea(5e6, 'imperial')).toBe('1.93 mi²');
  });

  it('stays metric unless imperial is asked for', () => {
    expect(formatDistance(1500)).toBe('1.50 km');
    expect(formatDistance(1500, 'metric')).toBe('1.50 km');
    expect(formatArea(50000, 'metric')).toBe('5.00 ha');
  });

  it('agrees with the metric reading at the same distance', () => {
    // 1 km is 0.62 mi — the same measurement, two labels
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(1000, 'imperial')).toBe('3281 ft');
  });
});

describe('destination', () => {
  const paris = { lat: 48.8584, lon: 2.2945 };

  it('lands the requested distance away, on the requested bearing', () => {
    for (const bearing of [0, 47, 90, 168, 270, 359]) {
      const there = destination(paris, bearing, 5000);
      expect(haversine(paris, there)).toBeCloseTo(5000, 0);
    }
  });

  it('goes north, east, south and west as the compass says', () => {
    expect(destination(paris, 0, 10000).lat).toBeGreaterThan(paris.lat);
    expect(destination(paris, 180, 10000).lat).toBeLessThan(paris.lat);
    expect(destination(paris, 90, 10000).lon).toBeGreaterThan(paris.lon);
    expect(destination(paris, 270, 10000).lon).toBeLessThan(paris.lon);
    // due east and west stay on the parallel, near enough over 10 km
    expect(destination(paris, 90, 10000).lat).toBeCloseTo(paris.lat, 2);
  });

  it('wraps the antimeridian instead of running past 180°', () => {
    const east = destination({ lat: 0, lon: 179.9 }, 90, 40000);
    expect(east.lon).toBeLessThan(0);
    expect(east.lon).toBeGreaterThan(-180);
  });
});

describe('containsPoint', () => {
  // A traced footprint and the pin it belongs to: the shape has to hold the point,
  // or the place claims an area it does not sit in.
  const quay = [
    { lat: 53.43, lon: 14.54 },
    { lat: 53.43, lon: 14.56 },
    { lat: 53.45, lon: 14.56 },
    { lat: 53.45, lon: 14.54 },
  ];

  it('holds a point inside the ring and refuses one outside it', () => {
    expect(containsPoint(quay, { lat: 53.44, lon: 14.55 })).toBe(true);
    expect(containsPoint(quay, { lat: 53.5, lon: 14.6 })).toBe(false);
  });

  it('reads a concave shape as drawn rather than as its bounding box', () => {
    // an L: the notch is inside the box and outside the shape
    const bay = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 4 },
      { lat: 2, lon: 4 },
      { lat: 2, lon: 2 },
      { lat: 4, lon: 2 },
      { lat: 4, lon: 0 },
    ];
    expect(containsPoint(bay, { lat: 1, lon: 1 })).toBe(true);
    expect(containsPoint(bay, { lat: 3, lon: 3 })).toBe(false);
  });

  it('is nothing at all without an area or a point', () => {
    expect(containsPoint(quay.slice(0, 2), { lat: 53.44, lon: 14.55 })).toBe(false);
    expect(containsPoint(quay, null)).toBe(false);
  });
});

describe('orientedExtent', () => {
  // A 200 m hull, 30 m across, lying 30° off north off Hodeidah.
  const centre = { lat: 14.8, lon: 42.95 };
  const corner = (along, across) => destination(destination(centre, 30, along), 120, across);
  const hull = [corner(100, 15), corner(100, -15), corner(-100, -15), corner(-100, 15)];

  it('measures a turned shape along its own sides, not the box squared to north', () => {
    const { length, width } = orientedExtent(hull);
    expect(length).toBeCloseTo(200, 0);
    expect(width).toBeCloseTo(30, 0);
    // the north-up box around the same hull calls it four times as wide
    const lons = hull.map((p) => p.lon);
    const across = haversine({ lat: centre.lat, lon: Math.min(...lons) }, { lat: centre.lat, lon: Math.max(...lons) });
    expect(across).toBeGreaterThan(4 * width);
  });

  it('reads the long side first whichever way the points run', () => {
    const { length, width } = orientedExtent([...hull].reverse());
    expect(length).toBeGreaterThan(width);
  });

  it('gives a line its length and nothing across, and a point nothing at all', () => {
    const line = orientedExtent([corner(100, 0), corner(-100, 0)]);
    expect(line.length).toBeCloseTo(200, 0);
    expect(line.width).toBe(0);
    expect(orientedExtent([centre])).toEqual({ length: 0, width: 0 });
    expect(orientedExtent([])).toBe(null);
  });

  it('keeps a shape across the antimeridian its own size', () => {
    const { length } = orientedExtent([{ lat: 0, lon: 179.9995 }, { lat: 0, lon: -179.9995 }]);
    expect(length).toBeCloseTo(111, 0);
  });
});

describe('formatHeight', () => {
  it('reads a height in whole metres or feet', () => {
    expect(formatHeight(2412.4)).toBe('2412 m');
    expect(formatHeight(4806.5, 'imperial')).toBe('15769 ft');
    expect(formatHeight(-28.2)).toBe('-28 m');
    expect(formatHeight(null)).toBe('');
  });
});
