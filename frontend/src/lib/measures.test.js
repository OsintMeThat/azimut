import { describe, expect, it } from 'vitest';
import { haversine } from './measure.js';
import {
  coneWidth,
  crossings,
  fieldUnit,
  fieldValue,
  headline,
  isPair,
  labels,
  legs,
  newMeasure,
  pairReading,
  parseDistance,
  shadowSentence,
  sightRuns,
  summary,
  useShapes,
  viewshedGeometry,
} from './measures.js';

const A = { lat: 46, lon: 7 };
const B = { lat: 46, lon: 7.02 }; // due east, about 1.55 km
const C = { lat: 46.01, lon: 7.02 };

function line(points, extra = {}) {
  return { ...newMeasure(1, points[0]), points, ...extra };
}

const coords = (lat, lon) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

describe('a measure read in one line', () => {
  it('reads a line of two points as its length and bearing', () => {
    expect(headline(line([A, B]), 'metric')).toMatch(/^1\.55 km · 090°$/);
  });

  it('reads a longer line as its whole length, and an area as its size', () => {
    expect(headline(line([A, B, C]), 'metric')).toMatch(/^2\.6\d km$/);
    expect(headline(line([A, B, C], { closed: true }), 'metric')).toMatch(/ha$/);
  });

  it('says nothing while it is one point short of meaning anything', () => {
    expect(headline(line([A]), 'metric')).toBe('');
  });

  it('names what a line of two points is used as', () => {
    expect(headline(line([A, B], { use: 'ring' }), 'metric')).toBe('Radius 1.55 km');
    expect(headline(line([A, B], { use: 'cone', aperture: 40 }), 'metric')).toBe('40° cone · 1.55 km');
  });

  it('reads in the units asked for', () => {
    expect(headline(line([A, B]), 'nautical')).toMatch(/^0\.84 NM · 090°$/);
  });
});

describe('the words on the map', () => {
  it('writes each leg its length and bearing, halfway along it', () => {
    const [leg] = labels(line([A, B]), 'metric');
    expect(leg.kind).toBe('leg');
    expect(leg.text).toMatch(/^1\.55 km · 090°$/);
    expect(leg.at.lon).toBeCloseTo(7.01, 6);
  });

  it('adds the whole length and the angle at each inner corner of a longer line', () => {
    const words = labels(line([A, B, C]), 'metric');
    expect(words.find((w) => w.kind === 'total').at).toEqual(C);
    const [angle] = words.filter((w) => w.kind === 'angle');
    expect(angle.at).toEqual(B);
    expect(angle.text).toBe('90°');
  });

  it('closes an area with a leg back to its start, and writes its size in its middle', () => {
    const words = labels(line([A, B, C], { closed: true }), 'metric');
    expect(words.filter((w) => w.kind === 'leg')).toHaveLength(3);
    expect(words.find((w) => w.kind === 'area').text).toMatch(/ha$/);
    expect(words.some((w) => w.kind === 'angle')).toBe(false);
  });

  it('names every ring past the first on its edge', () => {
    const words = labels(line([A, B], { use: 'ring', rings: 3 }), 'metric');
    expect(words.filter((w) => w.kind === 'ring').map((w) => w.text)).toEqual(['3.09 km', '4.64 km']);
  });
});

describe('what a line of two points is used as', () => {
  it('is only offered to a line of exactly two points', () => {
    expect(isPair(line([A, B]))).toBe(true);
    expect(isPair(line([A, B, C]))).toBe(false);
    expect(isPair(line([A, B], { closed: true }))).toBe(false);
  });

  it('draws rings round A, each as wide as the line again', () => {
    const rings = useShapes(line([A, B], { use: 'ring', rings: 3 }));
    expect(rings.map((r) => r.kind)).toEqual(['circle', 'circle', 'circle']);
    const { length } = pairReading(line([A, B]));
    expect(rings.map((r) => Math.round(r.radiusM / length))).toEqual([1, 2, 3]);
    expect(rings[0].at).toEqual(A);
  });

  it('draws a cone from A, centred on B, and says how wide it is there', () => {
    const [shape] = useShapes(line([A, B], { use: 'cone', aperture: 90 }));
    expect(shape.kind).toBe('polygon');
    expect(shape.points[0]).toEqual(A);
    const { length } = pairReading(line([A, B]));
    expect(coneWidth(line([A, B], { aperture: 90 }))).toBeCloseTo(2 * length, 0);
  });

  it('draws nothing more for a plain line, a shadow or a viewshed', () => {
    for (const use of [null, 'shadow', 'viewshed']) expect(useShapes(line([A, B], { use }))).toEqual([]);
  });
});

describe('where two lines cross', () => {
  it('marks the point two bearings from two places meet at', () => {
    const one = { ...line([A, C]), id: 1 };
    const other = { ...line([B, { lat: 46.01, lon: 7 }]), id: 2 };
    const [found] = crossings([one, other]);
    expect(found.at.lat).toBeCloseTo(46.005, 3);
    expect(found.at.lon).toBeCloseTo(7.01, 3);
    expect(found.between).toEqual([1, 2]);
  });

  it('marks nothing where two lines only share an end, or where one is an area', () => {
    const one = { ...line([A, B]), id: 1 };
    const other = { ...line([B, C]), id: 2 };
    expect(crossings([one, other])).toEqual([]);
    const area = { ...line([A, B, C], { closed: true }), id: 3 };
    expect(crossings([area, { ...line([{ lat: 45.99, lon: 7.01 }, { lat: 46.02, lon: 7.01 }]), id: 4 }])).toEqual([]);
  });
});

describe('the sight drawn along the line', () => {
  it('cuts the line where the eye stops seeing it, the two pieces meeting', () => {
    const profile = {
      lat: [46, 46, 46, 46],
      lon: [7, 7.01, 7.02, 7.03],
      sight: { seen: [true, true, false, false] },
    };
    const runs = sightRuns(profile);
    expect(runs.map((r) => r.seen)).toEqual([true, false]);
    expect(runs[0].points.at(-1)).toEqual(runs[1].points[0]);
    expect(runs[1].points.at(-1)).toEqual({ lat: 46, lon: 7.03 });
  });

  it('draws nothing without a sight answer', () => {
    expect(sightRuns({ lat: [], lon: [] })).toEqual([]);
  });
});

describe('a viewshed on the map', () => {
  const answer = { lat: 46, lon: 7, step_deg: 90, runs: [[0, 1000], [200, 500, 800, 900], [], [0, 1000]] };

  it('chains the stretches of neighbouring rays that overlap into one outline', () => {
    const shape = viewshedGeometry(answer);
    expect(shape.type).toBe('MultiPolygon');
    // the first ray and the near stretch of the second are one piece; the far
    // stretch of the second, and the fourth ray past the empty third, two more
    expect(shape.coordinates).toHaveLength(3);
    for (const [ring] of shape.coordinates) expect(ring[0]).toEqual(ring.at(-1));
  });

  it('goes out along the far edges and back along the near ones', () => {
    const [[first]] = viewshedGeometry(answer).coordinates;
    const far = first.slice(0, 4).map(([lon, lat]) => Math.round(haversine({ lat: 46, lon: 7 }, { lat, lon })));
    expect(far).toEqual([1000, 1000, 500, 500]);
    const near = first.slice(4, 8).map(([lon, lat]) => Math.round(haversine({ lat: 46, lon: 7 }, { lat, lon })));
    expect(near).toEqual([200, 200, 0, 0]);
  });
});

describe('typing a distance', () => {
  it('reads a number in the field unit, or in the unit it names', () => {
    expect(parseDistance('2.5', 'km')).toBe(2500);
    expect(parseDistance('2,5 km', 'm')).toBe(2500);
    expect(parseDistance('800 m', 'km')).toBe(800);
    expect(parseDistance('3 NM', 'km')).toBe(5556);
    expect(parseDistance('1 mi', 'm')).toBeCloseTo(1609.344, 3);
  });

  it('refuses nothing, nonsense and zero', () => {
    for (const text of ['', 'far', '0', '-3', '2 parsecs']) expect(parseDistance(text, 'km')).toBe(null);
  });

  it('writes a distance in the unit that reads it best', () => {
    expect(fieldUnit(800, 'metric')).toBe('m');
    expect(fieldUnit(2500, 'metric')).toBe('km');
    expect(fieldUnit(100, 'imperial')).toBe('ft');
    expect(fieldUnit(100, 'nautical')).toBe('nm');
    expect(fieldValue(2500, 'km')).toBe('2.5');
    expect(fieldValue(812.345, 'm')).toBe('812');
    expect(fieldValue(42.345, 'm')).toBe('42.3');
  });
});

describe('the measure as text', () => {
  it('says a line of two points with its bearing both ways and its ends', () => {
    const text = summary(line([A, B]), 'metric', { coords });
    expect(text).toContain('Distance 1.55 km, bearing 090.0° (back 270.0°)');
    expect(text).toContain('From 46.0000, 7.0000 to 46.0000, 7.0200');
  });

  it('adds the ground and the sight once they are read', () => {
    const ground = { corners: [812, 905], sight: { visible: false, blocked_at_m: 640 } };
    const text = summary(line([A, B]), 'metric', { coords, ground });
    expect(text).toContain('Ground 812 m to 905 m (+93 m)');
    expect(text).toContain('ground in the way at 640 m');
  });

  it('says an area by its size, its perimeter and its corners', () => {
    const text = summary(line([A, B, C], { closed: true }), 'metric', { coords });
    expect(text).toMatch(/^Area .* ha, perimeter .* km/);
    expect(text).toContain('Corners: 46.0000, 7.0000; 46.0000, 7.0200; 46.0100, 7.0200');
  });

  it('says what a ring and a cone reach', () => {
    expect(summary(line([A, B], { use: 'ring', rings: 2 }), 'metric', { coords })).toContain(
      'Rings every 1.55 km, out to 3.09 km'
    );
    expect(summary(line([A, B], { use: 'cone', aperture: 60 }), 'metric', { coords })).toMatch(/Cone 60° wide, 1\.79 km across at B/);
  });
});

describe('a shadow read', () => {
  const moment = (local, height, azimuth = 213, altitude = 41.2) => ({
    local,
    abbreviation: 'CEST',
    height_m: height,
    sun_azimuth: azimuth,
    sun_altitude: altitude,
  });

  it('gives the height first, then the sun and the hour it says', () => {
    const text = shadowSentence({ date: '2024-06-21', moments: [moment('2024-06-21T14:12:05+02:00', 23.4)] }, 'metric');
    expect(text).toBe('About 23 m tall (sun at 213°, 41.2° up at 14:12 CEST)');
  });

  it('gives both hours when the sun crossed that bearing twice', () => {
    const text = shadowSentence(
      { date: '2024-06-21', moments: [moment('2024-06-21T11:02:00+03:00', 4), moment('2024-06-21T12:40:00+03:00', 6)] },
      'metric'
    );
    expect(text).toContain(', or 6 m at 12:40');
  });

  it('says so when no hour of the day casts it', () => {
    expect(shadowSentence({ date: '2024-06-21', moments: [] }, 'metric')).toBe('No hour of 2024-06-21 casts this shadow');
  });
});

describe('legs', () => {
  it('runs from each point to the next', () => {
    const pieces = legs(line([A, B, C]));
    expect(pieces).toHaveLength(2);
    expect(pieces[1].bearing).toBeCloseTo(0, 0);
  });
});
