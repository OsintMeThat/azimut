import { describe, expect, it } from 'vitest';
import {
  azimuthTicks,
  bearingBetween,
  cardinal,
  distanceBetween,
  elsewhere,
  elevationTicks,
  faceTowards,
  footprint,
  groundPoint,
  headingText,
  levelLine,
  parseHeading,
  windOf,
} from './geometry.js';
import { rayFor } from './camera.js';

const EYE = { lat: 46.5586, lon: 7.8353 };

describe('the ground the picture points at', () => {
  it('walks out along an azimuth and comes back by distance and bearing', () => {
    const there = groundPoint(EYE, 73, 41_250);
    expect(distanceBetween(EYE, there)).toBeCloseTo(41_250, 3);
    expect(bearingBetween(EYE, there)).toBeCloseTo(73, 6);
  });

  it('wraps across the antimeridian', () => {
    const there = groundPoint({ lat: 0, lon: 179.9 }, 90, 50_000);
    expect(there.lon).toBeLessThan(-179);
  });

  it('names the eight compass points and nothing else', () => {
    expect(cardinal(0)).toBe('N');
    expect(cardinal(360)).toBe('N');
    expect(cardinal(135)).toBe('SE');
    expect(cardinal(10)).toBeNull();
  });
});

describe('the field of view on the map', () => {
  const panorama = {
    far: 150_000,
    azimuth: { start: 0, step: 1, count: 360 },
    skyline: Array.from({ length: 360 }, () => 1),
    skylineDistance: Array.from({ length: 360 }, (_, i) => (i < 180 ? 10_000 : 40_000)),
  };

  it('fans out from the eye to the skyline across the lens', () => {
    const fan = footprint(EYE, panorama, { heading: 90, fov: 60 }, { step: 10 });
    expect(fan[0]).toEqual(EYE);
    expect(fan).toHaveLength(8);
    for (const point of fan.slice(1)) expect(distanceBetween(EYE, point)).toBeCloseTo(10_000, 0);
    expect(bearingBetween(EYE, fan[1])).toBeCloseTo(60, 4);
    expect(bearingBetween(EYE, fan.at(-1))).toBeCloseTo(120, 4);
  });

  it('stops where thick air does', () => {
    const fan = footprint(EYE, panorama, { heading: 90, fov: 60 }, { step: 10, limit: 4_000 });
    for (const point of fan.slice(1)) expect(distanceBetween(EYE, point)).toBeCloseTo(4_000, 0);
  });

  it('is a ring all round for the whole turn', () => {
    const ring = footprint(EYE, panorama, { heading: 0, fov: 360 }, { step: 30 });
    expect(ring[0]).not.toEqual(EYE);
    expect(Math.max(...ring.map((p) => distanceBetween(EYE, p)))).toBeCloseTo(40_000, 0);
  });

  it('draws nothing without an eye or a picture', () => {
    expect(footprint(null, panorama, { heading: 0, fov: 60 })).toEqual([]);
    expect(footprint(EYE, null, { heading: 0, fov: 60 })).toEqual([]);
  });
});

describe('the azimuth ruler', () => {
  const lens = { heading: 0, tilt: 0, roll: 0, fov: 60, width: 1200, height: 600, projection: 'camera' };

  it('counts in a step that keeps its labels apart, north named', () => {
    const ticks = azimuthTicks(lens);
    const steps = ticks.slice(1).map((t, i) => (t.azimuth - ticks[i].azimuth + 360) % 360);
    expect(new Set(steps).size).toBe(1);
    expect(steps[0]).toBe(5);
    const north = ticks.find((t) => t.azimuth === 0);
    expect(north.label).toBe('N');
    expect(north.x).toBeCloseTo(600, 6);
    expect(ticks.every((t, i) => i === 0 || t.x > ticks[i - 1].x)).toBe(true);
  });

  it('reads finer through a telephoto', () => {
    const ticks = azimuthTicks({ ...lens, heading: 123.4, fov: 2 });
    expect(ticks[1].azimuth - ticks[0].azimuth).toBeCloseTo(0.2, 6);
    expect(ticks[0].label).toMatch(/^12[23]\.\d°$/);
  });

  it('spans the whole turn on a strip', () => {
    const ticks = azimuthTicks({ ...lens, projection: 'panorama', fov: 360, width: 1440 });
    expect(ticks.map((t) => t.label)).toContain('S');
    expect(ticks.length).toBeGreaterThanOrEqual(8);
  });

  it('has nothing to say on a frame with no size', () => {
    expect(azimuthTicks({ ...lens, width: 0 })).toEqual([]);
  });
});

describe('the heading caret, the level line and the elevation scale', () => {
  const LENS = { heading: 95, tilt: 0, roll: 0, fov: 60, width: 1200, height: 700, projection: 'camera' };

  it('says a heading in whole degrees and its wind, a decimal through a telephoto', () => {
    expect(headingText(95, 60)).toBe('95° E');
    expect(headingText(212.4, 60)).toBe('212° SW');
    expect(headingText(359.8, 60)).toBe('0° N');
    expect(headingText(107.04, 4)).toBe('107.0° E');
    expect(windOf(22.4)).toBe('N');
    expect(windOf(22.6)).toBe('NE');
    expect(windOf(-10)).toBe('N');
  });

  it('faces a direction, tilting only when it is out of the frame\'s height', () => {
    expect(faceTowards(LENS, { azimuth: 200, elevation: 3 })).toEqual({ heading: 200, tilt: 0 });
    expect(faceTowards(LENS, { azimuth: 200, elevation: 40 })).toEqual({ heading: 200, tilt: 40 });
    expect(faceTowards({ ...LENS, tilt: 5 }, { azimuth: 10 })).toEqual({ heading: 10, tilt: 5 });
  });

  it('reads a typed heading as degrees or a wind', () => {
    expect(parseHeading('212')).toBe(212);
    expect(parseHeading(' 212.5° ')).toBe(212.5);
    expect(parseHeading('-10')).toBe(350);
    expect(parseHeading('sw')).toBe(225);
    expect(parseHeading('NE')).toBe(45);
    expect(parseHeading('east')).toBeNull();
    expect(parseHeading('')).toBeNull();
  });

  it('drops the ruler labels under the caret and keeps their marks', () => {
    const ticks = azimuthTicks(LENS, { clear: 40 });
    const middle = ticks.find((tick) => Math.abs(tick.x - 600) < 40);
    expect(middle.label).toBe('');
    expect(ticks.filter((tick) => tick.label).every((tick) => Math.abs(tick.x - 600) >= 40)).toBe(true);
  });

  it('draws the level across the middle of a level lens, and tilted with a rolled one', () => {
    const level = levelLine(LENS);
    expect(level.x1).toBeCloseTo(0, 6);
    expect(level.x2).toBeCloseTo(1200, 6);
    expect(level.y1).toBeCloseTo(350, 6);
    expect(level.y2).toBeCloseTo(350, 6);
    const rolled = levelLine({ ...LENS, roll: 10 });
    expect(rolled.y1).not.toBeCloseTo(rolled.y2, 0);
    // every point of it reads level
    const mid = rayFor({ ...LENS, roll: 10 }, (rolled.x1 + rolled.x2) / 2, (rolled.y1 + rolled.y2) / 2);
    expect(mid.elevation).toBeCloseTo(0, 6);
    expect(levelLine({ ...LENS, tilt: 60 })).toBeNull(); // looking up: the level is under the frame
  });

  it('ticks every 5° down an ordinary lens, every 1° through a telephoto, each where it reads true', () => {
    const ticks = elevationTicks(LENS);
    expect(ticks.map((tick) => tick.label)).toContain('+5°');
    expect(ticks.map((tick) => tick.label)).toContain('\u22125°');
    expect(ticks.some((tick) => tick.elevation === 0)).toBe(false);
    for (const tick of ticks) expect(rayFor(LENS, 0, tick.y).elevation).toBeCloseTo(tick.elevation, 3);
    const strip = elevationTicks({ ...LENS, projection: 'panorama', fov: 171, width: 1036, height: 725 });
    expect(strip.every((tick) => tick.elevation % 10 === 0)).toBe(true); // 5° would pack them 30 px apart
    expect(ticks.every((tick) => tick.elevation % 5 === 0)).toBe(true);
    const narrow = elevationTicks({ ...LENS, fov: 12, tilt: 3 });
    expect(narrow.map((tick) => tick.elevation)).toEqual(expect.arrayContaining([1, 2, 4, 5]));
    // a lens just over 12° tall still gets more than one tick
    const telephoto = elevationTicks({ ...LENS, width: 1036, height: 725, fov: 18.1 });
    expect(telephoto.length).toBeGreaterThan(5);
    expect(elevationTicks({ ...LENS, width: 0 })).toEqual([]);
  });
});

describe('the other maps, looking elsewhere', () => {
  const EYE = { lat: 46.5586, lon: 7.8353 };

  it('says where they look once it is past a short walk from the eye', () => {
    const far = { lat: 46.7, lon: 7.9, zoom: 14, bearing: 0, by: 'satellite' };
    const away = elsewhere(far, EYE);
    expect(away).toMatchObject({ lat: 46.7, lon: 7.9, zoom: 14 });
    expect(away.metres).toBeGreaterThan(15_000);
  });

  it('says nothing nearby, for its own camera, or with no camera at all', () => {
    expect(elsewhere({ lat: 46.5596, lon: 7.8353, zoom: 17, by: 'satellite' }, EYE)).toBeNull();
    expect(elsewhere({ lat: 46.7, lon: 7.9, zoom: 14, by: 'horizon' }, EYE)).toBeNull();
    expect(elsewhere(null, EYE)).toBeNull();
    expect(elsewhere({ lat: 46.7, lon: 7.9, zoom: 14, by: 'link' }, null)).toBeNull();
  });
});
