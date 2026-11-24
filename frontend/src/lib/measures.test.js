import { describe, expect, it } from 'vitest';
import { destination, haversine } from './measure.js';
import { bearingBetween } from './horizon/geometry.js';
import {
  bandEnd,
  bands,
  bandWidth,
  clampReach,
  clampTolerance,
  coneWidth,
  crossings,
  fieldUnit,
  fieldValue,
  headline,
  isPair,
  labels,
  legs,
  MAX_REACH,
  meeting,
  meetingWords,
  newMeasure,
  pairReading,
  parseDistance,
  pathOf,
  REACH,
  runsOn,
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
    expect(headline(line([A, B], { use: 'align' }), 'metric')).toBe('Alignment · 090°');
    expect(headline(line([A, B], { use: 'align', tolerance: 1 }), 'metric')).toBe('Alignment · 090° ±1°');
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

  it('draws nothing more for a plain line or a viewshed', () => {
    for (const use of [null, 'viewshed']) expect(useShapes(line([A, B], { use }))).toEqual([]);
  });

  it('runs an alignment on past both ends, the reach out from each', () => {
    const shapes = useShapes(line([A, B], { use: 'align' }));
    expect(shapes.map((shape) => shape.kind)).toEqual(['line', 'line']);
    const [pastA, pastB] = runsOn(line([A, B], { use: 'align' }));
    expect([pastA.end, pastB.end]).toEqual(['a', 'b']);
    expect(pastA.points[0]).toEqual(A);
    expect(pastB.points[0]).toEqual(B);
    expect(haversine(A, pastA.points.at(-1))).toBeCloseTo(REACH, 0);
    expect(haversine(B, pastB.points.at(-1))).toBeCloseTo(REACH, 0);
    expect(pastA.points.at(-1).lon).toBeLessThan(A.lon);
    expect(pastB.points.at(-1).lon).toBeGreaterThan(B.lon);
  });

  it('runs an alignment on past one end only, as asked', () => {
    expect(runsOn(line([A, B], { use: 'align', past: 'b' })).map((run) => run.end)).toEqual(['b']);
    expect(runsOn(line([A, B], { use: 'align', past: 'a' })).map((run) => run.end)).toEqual(['a']);
    expect(runsOn(line([A, B], { use: 'cone' }))).toEqual([]);
  });

  it('follows the great circle through A and B, not a straight line on the flat map', () => {
    const [run] = runsOn(line([A, B], { use: 'align', past: 'b', reach: 100_000 }));
    // heading due east from 46° N, the line of sight bends toward the equator
    expect(run.points.at(-1).lat).toBeLessThan(46 - 0.005);
    // and every point of it stays on the circle through A and B
    const across = (point) => {
      const d = haversine(A, point) / 6378137;
      const turn = ((bearingBetween(A, point) - bearingBetween(A, B)) * Math.PI) / 180;
      return Math.abs(Math.asin(Math.sin(d) * Math.sin(turn)) * 6378137);
    };
    for (const point of run.points) expect(across(point)).toBeLessThan(0.5);
  });

  it('keeps how far it runs between a hundred metres and its ceiling', () => {
    expect(clampReach(5)).toBe(100);
    expect(clampReach(1e9)).toBe(MAX_REACH);
    expect(clampReach('far')).toBe(REACH);
    expect(clampReach(42_000)).toBe(42_000);
  });

  it('is drawn whole, from past A through A and B to past B', () => {
    const path = pathOf(line([A, B], { use: 'align' }));
    const at = path.findIndex((point) => point === A || (point.lat === A.lat && point.lon === A.lon));
    expect(path[at + 1]).toEqual(B);
    expect(haversine(path[0], A)).toBeCloseTo(REACH, 0);
    expect(haversine(path.at(-1), B)).toBeCloseTo(REACH, 0);
    expect(pathOf(line([A, B, C]))).toEqual([A, B, C]);
  });
});

describe('how far off true an alignment may be', () => {
  const D = haversine(A, B);

  it('keeps between none and five degrees, to a tenth', () => {
    expect(clampTolerance(7)).toBe(5);
    expect(clampTolerance(-1)).toBe(0);
    expect(clampTolerance('far')).toBe(0);
    expect(clampTolerance(1.04)).toBe(1);
    expect(clampTolerance('0.5')).toBe(0.5);
  });

  it('draws no band while it is nil', () => {
    expect(bands(line([A, B], { use: 'align' }))).toEqual([]);
    expect(useShapes(line([A, B], { use: 'align' })).map((shape) => shape.role)).toEqual(['run', 'run']);
  });

  it('lays a band either side of each run, under it', () => {
    const roles = useShapes(line([A, B], { use: 'align', tolerance: 1 })).map((shape) => shape.role);
    expect(roles).toEqual(['band', 'edge', 'edge', 'band', 'edge', 'edge', 'run', 'run']);
  });

  it('puts its sides where the camera sees the two things that far apart', () => {
    const [band] = bands(line([A, B], { use: 'align', past: 'b', tolerance: 1 }));
    for (const i of [8, 24, 48, 64]) {
      for (const side of [band.left[i], band.right[i]]) {
        const seen = Math.abs(((bearingBetween(side, A) - bearingBetween(side, B) + 540) % 360) - 180);
        expect(seen).toBeCloseTo(1, 1);
      }
    }
  });

  it('opens at the tolerance by the nearer thing, then widens faster than a fan', () => {
    expect(bandWidth(10, D, 1) / 10).toBeCloseTo(Math.tan(Math.PI / 180), 3);
    expect(bandWidth(10_000, D, 1)).toBeGreaterThan(10_000 * Math.tan(Math.PI / 180) * 5);
    expect(bandWidth(0, D, 0)).toBe(0);
  });

  it('says where it stops ruling anything out, when that is short of the run', () => {
    expect(bandEnd(D, 5)).toBeCloseTo((D * (Math.sqrt(1 + Math.tan(Math.PI / 36) ** 2) - Math.tan(Math.PI / 36))) / (2 * Math.tan(Math.PI / 36)), 6);
    expect(bandWidth(bandEnd(D, 5) + 10, D, 5)).toBe(null);
    const [wide] = bands(line([A, B], { use: 'align', past: 'b', tolerance: 5 }));
    expect(wide.opensAt).toBeCloseTo(bandEnd(D, 5), 6);
    expect(haversine(B, wide.left.at(-1))).toBeGreaterThan(wide.opensAt);
    const [narrow] = bands(line([A, B], { use: 'align', past: 'b', tolerance: 1 }));
    expect(narrow.opensAt).toBe(null);
    expect(narrow.ring).toHaveLength(2 * narrow.left.length - 1);
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

  it('marks where two alignments cross far past what was clicked', () => {
    const east = { ...line([A, { lat: 46, lon: 7.01 }]), id: 1 };
    const north = { ...line([{ lat: 45.99, lon: 7.05 }, { lat: 45.995, lon: 7.05 }]), id: 2 };
    expect(crossings([east, north])).toEqual([]);
    const [found] = crossings([{ ...east, use: 'align' }, { ...north, use: 'align' }]);
    expect(found.at.lon).toBeCloseTo(7.05, 4);
    expect(found.at.lat).toBeCloseTo(46, 2);
  });

  it('marks nothing where two alignments share the thing they were lined up on', () => {
    const steeple = { lat: 46.01, lon: 7.01 };
    const one = { ...line([A, steeple], { use: 'align' }), id: 1 };
    const other = { ...line([B, steeple], { use: 'align' }), id: 2 };
    expect(crossings([one, other])).toEqual([]);
    expect(meeting([one, other]).crossed).toBe(0);
  });
});

describe('where the alignments meet', () => {
  const camera = { lat: 46.05, lon: 7.05 };
  /** An alignment lined up on two things on a bearing from the camera, the far one clicked first. */
  const lined = (id, bearing, aside = 0) => ({
    ...line([destination(destination(camera, bearing, 5000), bearing + 90, aside), destination(camera, bearing, 2000)], { use: 'align' }),
    id,
  });

  it('waits for two alignments, and leaves plain lines out', () => {
    expect(meeting([lined(1, 10)])).toBe(null);
    expect(meeting([lined(1, 10), { ...line([A, B]), id: 2 }])).toBe(null);
  });

  it('finds the camera where three alignments meet, and how well they agree', () => {
    const exact = meeting([lined(1, 10), lined(2, 120), lined(3, 250)]);
    expect(exact).toMatchObject({ lines: 3, pairs: 3, crossed: 3 });
    expect(haversine(exact.at, camera)).toBeLessThan(1);
    expect(exact.spread).toBeLessThan(1);
    const off = meeting([lined(1, 10), lined(2, 120), lined(3, 250, 30)]);
    expect(off.spread).toBeGreaterThan(5);
    expect(off.spread).toBeLessThan(100);
    expect(meetingWords(off, 'metric').lead).toMatch(/^3 alignments meet within \d+ m$/);
    expect(meetingWords(off, 'metric').missing).toBe('');
  });

  it('says which pairs do not cross, and when none do', () => {
    expect(meetingWords({ lines: 2, pairs: 1, crossed: 1, at: camera, spread: 0 }, 'metric')).toEqual({ lead: 'The two alignments cross', missing: '' });
    expect(meetingWords({ lines: 3, pairs: 3, crossed: 1, at: camera, spread: 0 }, 'metric')).toEqual({
      lead: 'Two of the alignments cross',
      missing: '2 pairs do not cross within reach',
    });
    expect(meetingWords({ lines: 2, pairs: 1, crossed: 0, at: null, spread: null }, 'metric').lead).toMatch(/do not cross/);
    expect(meetingWords(null, 'metric')).toBe(null);
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

  it('says how far an alignment runs on, and which way', () => {
    expect(summary(line([A, B], { use: 'align' }), 'metric', { coords })).toContain('Alignment run on 20.0 km past both ends');
    expect(summary(line([A, B], { use: 'align', past: 'b', reach: 5000 }), 'metric', { coords })).toContain('Alignment run on 5.00 km past B');
    const loose = summary(line([A, B], { use: 'align', tolerance: 5 }), 'metric', { coords });
    expect(loose).toContain('Alignment run on 20.0 km past both ends, within ±5°');
    expect(loose).toMatch(/At ±5° it rules nothing out past 8\.\d\d km/);
  });
});

describe('legs', () => {
  it('runs from each point to the next', () => {
    const pieces = legs(line([A, B, C]));
    expect(pieces).toHaveLength(2);
    expect(pieces[1].bearing).toBeCloseTo(0, 0);
  });
});
