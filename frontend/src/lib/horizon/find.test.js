/** Find where a photo was taken: the area, the alignments and where they cross. */
import { describe, expect, it } from 'vitest';
import {
  ALIGN_STEPS,
  alignmentBearing,
  alignmentLine,
  alignmentWedge,
  areaMiddle,
  areaPoints,
  areaProblem,
  areaText,
  chanceFit,
  cleanFacing,
  cleanStands,
  cleanSun,
  crossing,
  facingFan,
  facingFrom,
  facingRings,
  facingSectors,
  facingText,
  fanOf,
  fromLocal,
  groundText,
  HEAT_RAMP,
  heatOf,
  heatStyle,
  inArea,
  local,
  meeting,
  neighbourFit,
  onAlignment,
  photoOffset,
  reliability,
  sameAsk,
  searchedReach,
  ringsOf,
  searchedWhen,
  standsText,
  SUN_SIDES,
  sunAsked,
  toggleFacing,
  toggleStand,
  traceTurns,
  withGround,
  lookingOf,
  traceSpan,
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

  it('shades by how far off the terrain the trace lies where nothing explains it, so the map is never blank', () => {
    const scored = heatOf([{ explained: 0.6, gap: 0.2 }, { explained: 0.1, gap: 0.9 }]);
    expect(scored[0]).toMatchObject({ fill: HEAT_RAMP.at(-1), tip: 'Explains 60% of the trace' });
    const none = heatOf([{ explained: 0, gap: 0.3 }, { explained: 0, gap: 2.1 }, { explained: 0 }]);
    expect(none[0]).toMatchObject({ fill: HEAT_RAMP.at(-1), tip: 'Explains 0%: the trace lies 0.3° off the terrain' });
    expect(none[1].fill).toBe(HEAT_RAMP[0]);
    expect(none[2]).toMatchObject({ fill: HEAT_RAMP[0], tip: 'Explains 0%' });
    // a search kept before points said their gap draws as it did
    expect(heatOf([{ explained: 0 }, { explained: 0 }])[0].tip).toBe('Explains 0% of the trace');
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
    // a zoom word kept alone reads as that word ticked alone
    expect(sameAsk(ask, { ...now(), hints: { zoom: ['wide'], reach: 'auto' } })).toBe(true);
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
    expect(sameAsk(ask, { ...now(), facing: ['n'] })).toBe(false);
    expect(sameAsk(ask, { ...now(), stands: ['summit'] })).toBe(false);
    expect(sameAsk(ask, { ...now(), view: ['down'] })).toBe(false);
    expect(sameAsk(ask, { ...now(), mirror: true })).toBe(false);
    const zoned = { ...ask, zones: [{ area: [[46.5, 7.8], [46.5, 7.81], [46.51, 7.81]], spacing: 100, out: false }] };
    const zonedNow = { ...now(), zones: [{ area: [{ lat: 46.5, lon: 7.8 }, { lat: 46.5, lon: 7.81 }, { lat: 46.51, lon: 7.81 }], spacing: 100, out: false }] };
    expect(sameAsk(zoned, zonedNow)).toBe(true);
    expect(sameAsk(zoned, { ...zonedNow, zones: [{ ...zonedNow.zones[0], spacing: 250 }] })).toBe(false);
    expect(sameAsk(zoned, now())).toBe(false);
    const said = now();
    said.photo.marks = { ...said.photo.marks, far: [{ line: 0, bands: ['b1'] }] };
    expect(sameAsk(ask, said)).toBe(false);
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


describe('which way the photo faces', () => {
  it('ticks directions in the compass order, once each, and nothing else', () => {
    expect(cleanFacing(['e', 'n', 'e', 'north'])).toEqual(['n', 'e']);
    expect(cleanFacing(undefined)).toEqual([]);
    expect(toggleFacing(['n'], 'ne')).toEqual(['n', 'ne']);
    expect(toggleFacing(['n', 'ne'], 'n')).toEqual(['ne']);
  });

  it('joins directions side by side into one sector, round north too, as the app does', () => {
    expect(facingSectors(['n'])).toEqual([{ centre: 0, half: 22.5 }]);
    expect(facingSectors(['n', 'ne', 'e'])).toEqual([{ centre: 45, half: 67.5 }]);
    expect(facingSectors(['nw', 'n', 'ne'])).toEqual([{ centre: 0, half: 67.5 }]);
    expect(facingSectors(['n', 's'])).toEqual([
      { centre: 0, half: 22.5 },
      { centre: 180, half: 22.5 },
    ]);
    // none ticked, or all, is any way
    expect(facingSectors([])).toEqual([]);
    expect(facingSectors(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])).toEqual([]);
    expect(facingText(['nw', 'n', 'ne', 's'])).toBe('S, NW to NE');
    expect(facingText(['ne'])).toBe('NE');
    expect(facingText([])).toBe('');
  });

  it('draws a fan from the middle of the area, out as far as the search reads', () => {
    const area = [
      { lat: 10, lon: 40 },
      { lat: 10, lon: 41 },
      { lat: 11, lon: 41 },
      { lat: 11, lon: 40 },
    ];
    const middle = areaMiddle(area);
    expect(middle).toEqual({ lat: 10.5, lon: 40.5 });
    const [ring] = facingFan(middle, ['e'], 20_000);
    expect(ring[0]).toEqual(middle);
    for (const point of ring.slice(1)) {
      expect(haversine(middle, point)).toBeCloseTo(20_000, -1);
      const bearing = bearingBetween(middle, point);
      expect(bearing).toBeGreaterThanOrEqual(67.4);
      expect(bearing).toBeLessThanOrEqual(112.6);
    }
    expect(facingFan(middle, ['n', 's'], 5_000)).toHaveLength(2);
    expect(facingFan(middle, [], 5_000)).toEqual([]);
  });

  it('rings the fan at 2, 5, 10, 20, 50 and 100 km, as far as the search reads', () => {
    const middle = { lat: 10.5, lon: 40.5 };
    const rings = facingRings(middle, ['e'], 20_000);
    expect(rings.map((r) => r.metres)).toEqual([2_000, 5_000, 10_000, 20_000]);
    for (const ring of rings) {
      for (const point of ring.points) expect(haversine(middle, point)).toBeCloseTo(ring.metres, -1);
      // its words stand on the sector's middle
      expect(bearingBetween(middle, ring.label)).toBeCloseTo(90, 3);
    }
    expect(facingRings(middle, ['n', 's'], 50_000)).toHaveLength(10);
    expect(facingRings(middle, [], 50_000)).toEqual([]);
  });
});

describe('how far a result can be trusted', () => {
  const points = Array.from({ length: 21 }, (_, i) => ({ lat: 0, lon: 0, explained: i / 50 }));
  const ask = { trace: { known: false, within: [30, 65] }, who: { mode: 'ground' }, photo: { path: 'media/p.png' } };
  const best = { lat: 12.9, lon: 43.6, explained: 0.79, heading: 123, fov: 42, tilt: -3, roll: 1.7 };
  const far = (km) => destination(best, 90, km * 1000);

  it('reads the area’s chance fits off its top tenth', () => {
    expect(chanceFit(points)).toBeCloseTo(0.36, 6);
    expect(chanceFit(points.slice(0, 5))).toBeNull();
  });

  it('is solid when one place stands out and nothing speaks against it', () => {
    const second = { ...far(10), explained: 0.5 };
    expect(reliability({ verdict: 'match', places: [best, second], points }, { ask })).toEqual({ level: 'solid', reasons: [], chance: chanceFit(points) });
  });

  it('says each thing that lowers it, one alone asking for a check and two making it weak', () => {
    const rival = { ...far(12), explained: 0.72 };
    const one = reliability({ verdict: 'match', places: [best, rival], points }, { ask });
    expect(one).toMatchObject({ level: 'check', reasons: ['Another place 12 km away explains nearly as much'] });
    // a rival nearer than 3 km is the same hot spot
    expect(reliability({ verdict: 'match', places: [best, { ...far(2), explained: 0.78 }], points }, { ask }).level).toBe('solid');
    const pushed = { ...best, fov: 64, roll: -4.9, tilt: -16 };
    expect(reliability({ verdict: 'match', places: [pushed], points }, { ask }).reasons).toEqual([
      'The lens found, 64°, is the widest tried',
      'The camera had to roll 5°, the most allowed',
      'The camera tilts 16° down',
    ]);
    // a drone looks down as it likes; a lens the photo says has no edge to sit at
    const drone = reliability({ verdict: 'match', places: [{ ...best, tilt: -30 }], points }, { ask: { ...ask, who: { mode: 'drone' } } });
    expect(drone.level).toBe('solid');
    const known = reliability({ verdict: 'match', places: [{ ...best, fov: 30 }], points }, { ask: { ...ask, trace: { known: true, within: [30, 65] } } });
    expect(known.level).toBe('solid');
    const marked = reliability({ verdict: 'match', places: [{ ...best, inner: 0.3, pairs: [1, 3] }], points }, { ask });
    expect(marked).toMatchObject({ level: 'weak', reasons: ['The ridges in front lie off the terrain there', '2 of 3 front and behind pairs are out of order'] });
  });

  it('says when a decoy of the trace fits the best place nearly as well', () => {
    const decoyed = reliability({ verdict: 'match', places: [{ ...best, decoy: 0.7 }], points }, { ask });
    expect(decoyed.reasons).toEqual(['A decoy of the trace fits there nearly as well (70%)']);
    expect(reliability({ verdict: 'match', places: [{ ...best, decoy: 0.3 }], points }, { ask }).level).toBe('solid');
  });

  it('says when the best barely rises above what the area fits by chance', () => {
    const low = reliability({ verdict: 'match', places: [{ ...best, explained: 0.45 }], points }, { ask });
    expect(low.reasons).toEqual(['Barely above the chance fits of the area (36%)']);
  });

  it('is weak whenever the verdict names no single place, without saying the verdict again', () => {
    const rival = { ...far(30), explained: 0.77 };
    const ambiguous = reliability({ verdict: 'ambiguous', places: [best, rival], points }, { ask });
    expect(ambiguous).toMatchObject({ level: 'weak', reasons: [] });
    expect(reliability({ verdict: 'loose', places: [best], points }, { ask }).level).toBe('weak');
    expect(reliability({ verdict: 'none', places: [], points }, { ask }).level).toBe('weak');
  });

  it('weighs the other searches of the same photo that named a place elsewhere as strongly', () => {
    const elsewhere = { name: 'other', title: 'Ridge search 2', status: 'done', verdict: 'match', photo: 'media/p.png', best: { ...far(29), explained: 0.75 } };
    const told = reliability({ verdict: 'match', places: [best], points }, { ask, name: 'mine', others: [elsewhere] });
    expect(told).toMatchObject({ level: 'check', reasons: ['“Ridge search 2” found a place 29 km away that explains 75%'] });
    // not the search itself, another photo's, one that named no single place, a weaker one, or one that agrees
    for (const row of [
      { ...elsewhere, name: 'mine' },
      { ...elsewhere, photo: 'media/q.png' },
      { ...elsewhere, verdict: 'ambiguous' },
      { ...elsewhere, best: { ...elsewhere.best, explained: 0.5 } },
      { ...elsewhere, best: { ...far(1), explained: 0.8 } },
    ]) {
      expect(reliability({ verdict: 'match', places: [best], points }, { ask, name: 'mine', others: [row] }).level).toBe('solid');
    }
  });
});

describe('a best place standing alone, and a trace too plain', () => {
  const best = { lat: 12.9, lon: 43.6, explained: 0.71, heading: 65, fov: 54, tilt: 2, roll: -2 };
  const ask = { trace: { known: false, within: [30, 65] }, who: { mode: 'ground' } };
  const ring = (explained, metres = 100) => Array.from({ length: 8 }, (_, i) => ({ ...destination(best, i * 45, metres), explained }));

  it('reads what the ground right round the best place explains, from enough points', () => {
    expect(neighbourFit(best, ring(0.66))).toBeCloseTo(0.66, 6);
    // farther points, or too few, say nothing
    expect(neighbourFit(best, ring(0.2, 400))).toBeNull();
    expect(neighbourFit(best, ring(0.2).slice(0, 3))).toBeNull();
  });

  it('says a lone spike where the ground round it explains far less, and nothing where it rises too', () => {
    const lone = reliability({ verdict: 'match', places: [best], points: ring(0.18) }, { ask });
    expect(lone).toMatchObject({ level: 'check', reasons: ['The ground 150 m around explains much less (18%): a lone spike'] });
    expect(reliability({ verdict: 'match', places: [best], points: ring(0.66) }, { ask }).level).toBe('solid');
  });

  it('counts the turns of the trace across the picture, small wobbles left out', () => {
    const x = Array.from({ length: 61 }, (_, i) => -1 + i / 30);
    const wavy = { x, y: x.map((v) => 0.05 * Math.sin(v * 9)), half_width: 600 };
    expect(traceTurns(wavy)).toBe(6);
    const wobbly = { x, y: x.map((v, i) => 0.002 * (i % 2)), half_width: 600 };
    expect(traceTurns(wobbly)).toBe(0);
    // read from left to right whatever order the points came in
    expect(traceTurns({ ...wavy, x: [...wavy.x].reverse(), y: [...wavy.y].reverse() })).toBe(6);
  });

  it('says when the trace turns too few times to name one place', () => {
    const x = Array.from({ length: 41 }, (_, i) => -1 + i / 20);
    const plain = { ...ask, trace: { ...ask.trace, x, y: x.map((v) => 0.1 * Math.cos(v * 3)), half_width: 600 } };
    const told = reliability({ verdict: 'match', places: [best], points: [] }, { ask: plain });
    // one rise and fall across the picture: a single turn
    expect(told.reasons).toEqual(['The trace turns only 1 time: a plain shape fits many places']);
  });
});

describe('the sun against the camera', () => {
  it('keeps the sides in the menu order and asks with the sun only once a day and a side are said', () => {
    expect(cleanSun({ date: '2024-06-21', start: '7:00', end: '19:30', sides: ['behind', 'ahead', 'up'] })).toEqual({
      date: '2024-06-21',
      start: '06:00',
      end: '19:30',
      sides: ['ahead', 'behind'],
    });
    expect(sunAsked({ date: '', sides: ['ahead'] })).toBeNull();
    expect(sunAsked({ date: '2024-06-21', sides: [] })).toBeNull();
    expect(sunAsked({ date: '2024-06-21', sides: ['left'] })).toEqual({ date: '2024-06-21', start: '06:00', end: '18:00', sides: ['left'] });
    expect(SUN_SIDES.map((side) => side.id)).toEqual(['ahead', 'left', 'right', 'behind']);
  });

  it('draws any sectors as a fan', () => {
    const from = { lat: 10, lon: 40 };
    expect(fanOf(from, [{ centre: 180, half: 45 }], 5_000)).toHaveLength(1);
    expect(ringsOf(from, [{ centre: 180, half: 45 }], 10_000).map((r) => r.metres)).toEqual([2_000, 5_000, 10_000]);
  });
});

describe('where the eye stands', () => {
  it('ticks grounds in the menu order, once each, and says them', () => {
    expect(cleanStands(['plain', 'summit', 'plain', 'cliff'])).toEqual(['summit', 'plain']);
    expect(toggleStand(['summit'], 'slope')).toEqual(['summit', 'slope']);
    expect(toggleStand(['summit', 'slope'], 'summit')).toEqual(['slope']);
    expect(standsText(['summit', 'slope'])).toBe('summit or ridge or slope');
    expect(standsText([])).toBe('');
  });

  it('says what the grid keeps of the ground ticked, and the water left out', () => {
    const preview = { total: 2400, kept: 640, kinds: { summit: 640, slope: 900, valley: 500, plain: 240, water: 120 } };
    expect(groundText(preview, ['summit'])).toBe('Keeps 640 of 2,400 points (27%), 120 on water left out.');
    expect(groundText({ ...preview, kept: 2280 }, [])).toBe('120 on water left out.');
    expect(groundText({ ...preview, kinds: { ...preview.kinds, water: 0 } }, [])).toBe('');
    expect(groundText(null, ['summit'])).toBe('');
    // water ticked is searched, not left out
    expect(groundText(preview, ['summit', 'water'])).toBe('Keeps 640 of 2,400 points (27%).');
    expect(cleanStands(['water', 'plain'])).toEqual(['plain', 'water']);
  });

  it('shrinks the size said by what the ground leaves out, the filling-in with it', () => {
    const estimated = { points: 1000, coarse: 800, most: 3400, step: 0.5 };
    expect(withGround(estimated, { total: 800, kept: 200 })).toEqual({ points: 400, coarse: 800, most: 1000, step: 0.5 });
    expect(withGround(estimated, null)).toBe(estimated);
    expect(withGround(null, { total: 800, kept: 200 })).toBeNull();
  });
});

describe('what the trace says before a search', () => {
  it('reads which way the camera looks from where the skyline stands in the frame', () => {
    // a portrait phone frame from a hilltop: the skyline 1.2 half widths up through a 51° lens asks about 30° down
    const high = { y: [1.13, 1.2, 1.31], fov: 51, projection: 'camera' };
    expect(lookingOf(high, 'ground')).toBe('down');
    expect(lookingOf(high, 'drone')).toBeNull();
    expect(lookingOf({ y: [0.05, 0.1, 0.2], fov: 51 }, 'ground')).toBeNull();
    expect(lookingOf({ y: [-1.6, -1.5, -1.4], fov: 60 }, 'ground')).toBe('up');
    expect(lookingOf({ y: [], fov: 51 })).toBeNull();
    // a panorama reads its rows evenly: 0.4 half widths up a 60° strip is 12°, a whole one 30°
    expect(lookingOf({ y: [0.3, 0.4, 0.5], fov: 60, projection: 'panorama' }, 'ground')).toBeNull();
    expect(lookingOf({ y: [0.9, 1, 1.1], fov: 60, projection: 'panorama' }, 'ground')).toBe('down');
    // the same height through a long lens is a small angle: 12° up a 24° frame stays well within the bounds
    expect(lookingOf({ y: [0.9, 1, 1.1], fov: 24, projection: 'camera' }, 'ground')).toBeNull();
    // a ridge stands over the horizon, so a skyline asking 17° down is offered already
    expect(lookingOf({ y: [0.9, 1, 1.1], fov: 33.2 }, 'ground')).toBe('down');
  });

  it('says how wide a trace spans', () => {
    expect(traceSpan({ x: [-1, 0, 1], fov: 60 })).toBeCloseTo(60, 6);
    expect(traceSpan({ x: [-0.8, 0.76], fov: 125.78, projection: 'panorama' })).toBeCloseTo(98.1, 1);
    expect(traceSpan({ x: [], fov: 60 })).toBe(0);
  });
});

