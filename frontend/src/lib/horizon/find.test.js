/** Find where a photo was taken: the area, the alignments and where they cross. */
import { describe, expect, it } from 'vitest';
import {
  ALIGN_STEPS,
  alignmentBearing,
  alignmentLine,
  alignmentWedge,
  areaPoints,
  areaProblem,
  areaText,
  crossing,
  facingFrom,
  fromLocal,
  HEAT_RAMP,
  heatStyle,
  inArea,
  local,
  meeting,
  onAlignment,
  photoOffset,
  sameAsk,
  searchedReach,
  searchedWhen,
} from './find.js';
import { destination, haversine } from '../measure.js';
import { bearingBetween } from './geometry.js';

const CAMERA = { lat: 16.9988, lon: 45.0938 };

/** An alignment as the camera at `camera` would see it: a near point and a far one on the same bearing. */
function lined(camera, bearing, nearM, farM, { offset = 0 } = {}) {
  const near = destination(camera, bearing, nearM);
  const far = destination(camera, bearing + offset, farM);
  return { map: { near, far }, photo: { near: { u: 0.5, v: 0.6 }, far: { u: 0.5, v: 0.4 } }, offset };
}

describe('the area searched', () => {
  const square = [
    { lat: 16.95, lon: 45.05 },
    { lat: 16.95, lon: 45.15 },
    { lat: 17.05, lon: 45.15 },
    { lat: 17.05, lon: 45.05 },
  ];

  it('says its size in words, and holds the points inside it', () => {
    expect(areaText(square)).toMatch(/^1[01] × 11 km · 1[12]\d km²$/);
    expect(inArea(square, CAMERA)).toBe(true);
    expect(inArea(square, { lat: 17.2, lon: 45.1 })).toBe(false);
    expect(areaText(square.slice(0, 2))).toBe('');
  });

  it('asks for three corners and an area within reason', () => {
    expect(areaProblem(square)).toBe('');
    expect(areaProblem(square.slice(0, 2))).toBe('Draw at least three corners');
    const tiny = square.map((p) => ({ lat: 16.95 + (p.lat - 16.95) / 1000, lon: 45.05 + (p.lon - 45.05) / 1000 }));
    expect(areaProblem(tiny)).toBe('The area is too small to search');
    const huge = square.map((p) => ({ lat: 16.95 + (p.lat - 16.95) * 10, lon: 45.05 + (p.lon - 45.05) * 10 }));
    expect(areaProblem(huge)).toMatch(/too large/);
  });

  it('works flat about a point, there and back', () => {
    const away = { lat: 17.01, lon: 45.12 };
    const back = fromLocal(CAMERA, local(CAMERA, away));
    expect(back.lat).toBeCloseTo(away.lat, 9);
    expect(back.lon).toBeCloseTo(away.lon, 9);
    const { x, y } = local(CAMERA, away);
    expect(Math.hypot(x, y)).toBeCloseTo(haversine(CAMERA, away), -1);
  });
});

describe('an alignment', () => {
  it('has the guided clicks in order: two on the photo, then the same two on the map', () => {
    expect(ALIGN_STEPS.map((s) => `${s.on} ${s.end}`)).toEqual(['photo near', 'photo far', 'map near', 'map far']);
  });

  it('puts the camera on the line through the two, on the near side', () => {
    const one = lined(CAMERA, 40, 800, 12_000);
    expect(alignmentBearing(one)).toBeCloseTo(220, 1);
    const [from, to] = alignmentLine(one);
    expect(from).toBe(one.map.near);
    expect(haversine(from, to)).toBeCloseTo(40_000, -2);
    expect(onAlignment(one, CAMERA)).toBe(true);
    // beyond the far one is the wrong side
    expect(onAlignment(one, destination(CAMERA, 40, 20_000))).toBe(false);
    expect(onAlignment(one, destination(CAMERA, 130, 500))).toBe(false);
    expect(alignmentWedge(one)).toHaveLength(3);
  });

  it('turns about the near one by how far apart the two stand across the photo', () => {
    // the far peak stands 6° right of the near mast in the photo
    const one = lined(CAMERA, 40, 600, 30_000, { offset: 6 });
    expect(onAlignment(one, CAMERA, 0.3)).toBe(true);
    expect(onAlignment({ ...one, offset: 0 }, CAMERA, 0.3)).toBe(false);
  });

  it('reads that offset through the lens, or says it cannot', () => {
    expect(photoOffset({ u: 0.5, v: 0.6 }, { u: 0.5, v: 0.2 })).toBe(0);
    expect(photoOffset({ u: 0.5, v: 0.6 }, { u: 0.6, v: 0.2 })).toBeNull();
    // two hand clicks a hair apart are one above the other, lens or not
    expect(photoOffset({ u: 0.5, v: 0.6 }, { u: 0.508, v: 0.2 })).toBe(0);
    expect(photoOffset({ u: 0.5, v: 0.6 }, { u: 0.508, v: 0.2 }, { fov: 60 })).not.toBe(0);
    // through a 60° lens, the right edge is 30° off the middle
    expect(photoOffset({ u: 0.5, v: 0.6 }, { u: 1, v: 0.2 }, { fov: 60 })).toBeCloseTo(30, 9);
    // along a panorama's strip, as many degrees as it spans
    expect(photoOffset({ u: 0.25, v: 0.6 }, { u: 0.75, v: 0.2 }, { fov: 200, projection: 'panorama' })).toBeCloseTo(100, 9);
  });

  it('says which way the photo faces from a place', () => {
    const one = lined(CAMERA, 40, 800, 12_000);
    // the near mast at the photo's middle: the photo faces it
    expect(facingFrom(one, CAMERA, { fov: 60 })).toBeCloseTo(40, 1);
    const right = { ...one, photo: { ...one.photo, near: { u: 0.75, v: 0.6 } } };
    // a quarter across a 60° lens is atan(0.5 · tan 30°) right of the middle
    expect(facingFrom(right, CAMERA, { fov: 60 })).toBeCloseTo(40 - (Math.atan(0.5 * Math.tan(Math.PI / 6)) * 180) / Math.PI, 1);
    expect(facingFrom(one, CAMERA)).toBeNull();
  });
});

describe('alignments crossing', () => {
  it('meet where the photo was taken', () => {
    const a = lined(CAMERA, 40, 800, 12_000);
    const b = lined(CAMERA, 115, 1500, 20_000);
    const at = crossing(a, b);
    expect(haversine(at, CAMERA)).toBeLessThan(1);
    const met = meeting([a, b, lined(CAMERA, 300, 2000, 9000)]);
    expect(haversine(met.at, CAMERA)).toBeLessThan(1);
    expect(met.spread).toBeLessThan(1);
    expect(met.crossings).toBe(3);
  });

  it('say how far apart they miss when the clicks are a little off', () => {
    const a = lined(CAMERA, 40, 800, 12_000);
    const b = lined(CAMERA, 115, 1500, 20_000);
    const off = { ...lined(CAMERA, 300, 2000, 9000), map: { near: destination(destination(CAMERA, 300, 2000), 30, 60), far: destination(CAMERA, 300, 9000) } };
    const met = meeting([a, b, off]);
    expect(met.spread).toBeGreaterThan(5);
    expect(haversine(met.at, CAMERA)).toBeLessThan(80);
  });

  it('say nothing when they run side by side, or cross behind a near point', () => {
    const a = lined(CAMERA, 40, 800, 12_000);
    const near = lined(destination(CAMERA, 130, 300), 41, 800, 12_000);
    expect(crossing(a, near)).toBeNull();
    // seen the other way round, their lines cross on the far side of both
    const back = { ...a, map: { near: a.map.far, far: a.map.near } };
    const back2 = (() => {
      const b = lined(CAMERA, 115, 1500, 20_000);
      return { ...b, map: { near: b.map.far, far: b.map.near } };
    })();
    expect(crossing(back, back2)).toBeNull();
    expect(meeting([a])).toBeNull();
    expect(bearingBetween(CAMERA, a.map.near)).toBeCloseTo(40, 3);
  });
});

describe('the heatmap', () => {
  it('draws the best ground in the ramp’s lightest step, nearly opaque, and the worst kept faint and dark', () => {
    expect(heatStyle(0.9, 0.9, 0.2)).toEqual({ fill: HEAT_RAMP.at(-1), opacity: 0.72 });
    expect(heatStyle(0.2, 0.9, 0.2)).toEqual({ fill: HEAT_RAMP[0], opacity: 0.12 });
    const middle = heatStyle(0.55, 0.9, 0.2);
    expect(HEAT_RAMP.indexOf(middle.fill)).toBeGreaterThan(0);
    expect(middle.opacity).toBeGreaterThan(0.12);
    expect(middle.opacity).toBeLessThan(0.72);
    // one point alone is the best
    expect(heatStyle(0.4, 0.4, 0.4).fill).toBe(HEAT_RAMP.at(-1));
  });
});


describe('a reach the analyst gives', () => {
  it('is searched on to twice as far, within Auto\'s farthest, as the engine reads it', () => {
    expect(searchedReach(5_000)).toBe(10_000);
    expect(searchedReach(40_000)).toBe(50_000);
    expect(searchedReach(100_000)).toBe(100_000);
  });
});

describe('a search kept, against the setup now', () => {
  const ask = {
    area: [[46.5, 7.8], [46.5, 7.9], [46.6, 7.9]],
    who: { mode: 'ground', low: 1.7, high: 1.7 },
    spacing: null,
    alignments: [{ near: { lat: 46.55, lon: 7.85 }, far: { lat: 46.6, lon: 7.95 }, tops: false, heights: { near: 0, far: 0 } }],
    photo: { path: 'media/ridge.jpg', strokes: [[{ u: 0.1, v: 0.4 }, { u: 0.5, v: 0.38 }]], marks: null },
    hints: { zoom: 'wide', reach: 'auto' },
  };
  const now = () => ({
    ...structuredClone(ask),
    area: ask.area.map(([lat, lon]) => ({ lat, lon })),
    photo: { ...structuredClone(ask.photo), marks: { lines: [0], inner: [], pairs: [], cuts: [] } },
  });

  it('reads the same setup the same, the area as pairs or points and empty marks as none', () => {
    expect(sameAsk(ask, now())).toBe(true);
  });

  it('reads any change as changed, and nothing as not kept', () => {
    const moved = now();
    moved.area[0].lat += 0.01;
    expect(sameAsk(ask, moved)).toBe(false);
    const traced = now();
    traced.photo.strokes.push([{ u: 0.6, v: 0.3 }]);
    expect(sameAsk(ask, traced)).toBe(false);
    const told = now();
    told.hints = { zoom: 'zoomed', reach: 'auto' };
    expect(sameAsk(ask, told)).toBe(false);
    const flown = now();
    flown.who = { mode: 'drone', low: 10, high: 120 };
    expect(sameAsk(ask, flown)).toBe(false);
    const cut = now();
    cut.photo.marks.cuts = [0.5];
    expect(sameAsk(ask, cut)).toBe(false);
    expect(sameAsk(ask, null)).toBe(false);
    expect(sameAsk(null, now())).toBe(false);
  });
});

describe('a search in a line', () => {
  it('says when it was made on this computer’s clock, and nothing for no date', () => {
    expect(searchedWhen('2026-10-14T19:05:00')).toBe('14 Oct 2026, 19:05');
    expect(searchedWhen(null)).toBe('');
    expect(searchedWhen('not a date')).toBe('');
  });

  it('reads an area kept as pairs or drawn as points', () => {
    expect(areaPoints([[1, 2]])).toEqual([{ lat: 1, lon: 2 }]);
    expect(areaPoints([{ lat: 1, lon: 2, extra: true }])).toEqual([{ lat: 1, lon: 2 }]);
    expect(areaPoints(null)).toEqual([]);
  });
});

