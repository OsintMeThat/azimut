import { describe, expect, it } from 'vitest';
import {
  bandsGradient,
  clockOf,
  MAP_LIGHT,
  minuteOf,
  SHADOW_DEPTH,
  shadowKeep,
  skyAt,
  skyLight,
  skyLines,
  skyTracks,
  sunBands,
} from './sky.js';

/** A day sampled every 2 minutes: the sun rises at 06:00 behind a ridge it clears at 07:00. */
function answer() {
  const count = 721;
  const sun = { azimuth: [], altitude: [], clear: [] };
  const moon = { azimuth: [], altitude: [], clear: [] };
  for (let i = 0; i < count; i += 1) {
    const minute = i * 2;
    sun.azimuth.push((60 + (minute / 1440) * 240) % 360);
    sun.altitude.push(40 * Math.sin(((minute - 360) / 720) * Math.PI));
    sun.clear.push(minute >= 420 && minute < 1080);
    moon.azimuth.push((minute / 4) % 360);
    moon.altitude.push(-10);
    moon.clear.push(false);
  }
  return {
    step_minutes: 2,
    sun: {
      ...sun,
      events: [
        { kind: 'appears', minute: 420, azimuth: 130 },
        { kind: 'hides', minute: 1080, azimuth: 240 },
      ],
      sea_level: { rise: { local: '2026-03-20T06:00:00+01:00' }, set: { local: '2026-03-20T18:00:00+01:00' } },
    },
    moon: { ...moon, events: [], illuminated: 0.42 },
  };
}

describe('the sun and the moon on the view', () => {
  it('reads and writes clock times', () => {
    expect(clockOf(462)).toBe('07:42');
    expect(minuteOf('07:42')).toBe(462);
    expect(minuteOf('25:00')).toBeNull();
    expect(minuteOf('')).toBeNull();
  });

  it('places a body between two samples, the short way round north', () => {
    const sky = { step_minutes: 2, sun: { azimuth: [359, 1], altitude: [10, 12], clear: [true, true] } };
    const at = skyAt(sky, 'sun', 1);
    expect(at.azimuth).toBeCloseTo(0, 6);
    expect(at.altitude).toBeCloseTo(11, 6);
  });

  it('draws the track while the body is up, with hour marks and the disc at the time', () => {
    const [sun, moon] = skyTracks(answer(), { minute: 720 });
    const marks = sun.points.filter((point) => point.label).map((point) => point.label);
    expect(marks[0]).toBe('06');
    expect(marks).toContain('12');
    expect(sun.now.altitude).toBeCloseTo(40, 0);
    expect(sun.points.some((point) => point.clear === false)).toBe(true); // behind the ridge, still drawn
    expect(moon.points).toEqual([]);
    expect(moon.now).toBeNull();
  });

  it('says when the sun comes out over the ridges and when it goes, beside the almanac', () => {
    const lines = skyLines(answer());
    expect(lines[0]).toBe('Sun out over the ridges 07:00 · behind them 18:00');
    expect(lines[1]).toBe('Sea-level sunrise 06:00, sunset 18:00');
    expect(lines[2]).toBe('Moon not over the ridges today · 42% lit');
    // an answer missing its tracks says nothing rather than breaking the panel
    expect(skyLines({ step_minutes: 2, sun: {}, moon: {} })).toEqual([]);
  });

  it('paints the sun\'s day along the time slider: down, behind the ridges, clear', () => {
    const bands = sunBands(answer());
    expect(bands.map((band) => band.kind)).toEqual(['down', 'hidden', 'clear', 'hidden', 'down']);
    const clear = bands.find((band) => band.kind === 'clear');
    expect([clear.from, clear.to]).toEqual([420, 1080]);
    expect(bands[0].from).toBe(0);
    expect(bands.at(-1).to).toBe(1440);
    // the sun rises at 06:00 behind the ridge: the slider shows it up but hidden until 07:00
    expect(bands[1].to).toBe(420);
    expect(bands[1].from).toBeGreaterThan(340);
    const gradient = bandsGradient(bands, { clear: 'gold', hidden: 'tan', down: 'grey' });
    expect(gradient).toMatch(/^linear-gradient\(to right, grey 0\.00% /);
    expect(gradient).toContain('gold 29.17% 75.00%');
    expect(sunBands(null)).toEqual([]);
    expect(bandsGradient([], {})).toBe('none');
  });

  it('lights the ground from the sun by day, warmer as it sinks', () => {
    const noon = skyLight(answer(), 720);
    expect(noon).toMatchObject({ phase: 'day', body: 'sun', strength: 1, sky: 1 });
    // the sky's own light stays low by day, so a shadow reads
    expect(noon.ambient).toBeLessThan(MAP_LIGHT.ambient);
    expect(noon.altitude).toBeCloseTo(40, 0);
    expect(noon.tint).toEqual([1, 1, 1]);
    const evening = skyLight(answer(), 1070); // the sun 1° up
    expect(evening.tint[2]).toBeLessThan(0.65);
    expect(evening.sky).toBeLessThan(1);
  });

  it('fades through twilight to a night lit by the moon, or by nothing', () => {
    const dusk = skyLight(answer(), 1090); // the sun just under the horizon
    expect(dusk.phase).toBe('twilight');
    expect(dusk.strength).toBe(0);
    const night = skyLight(answer(), 120);
    expect(night).toMatchObject({ phase: 'night', body: null, strength: 0 });
    expect(night.ambient).toBeLessThan(0.05);
    expect(night.sky).toBeLessThan(0.05);
    // the same night with a moon up, 42% lit
    const moonlit = answer();
    moonlit.moon.altitude = moonlit.moon.altitude.map(() => 30);
    const lit = skyLight(moonlit, 120);
    expect(lit.body).toBe('moon');
    expect(lit.altitude).toBeCloseTo(30, 6);
    expect(lit.strength).toBeCloseTo(0.3 * 0.42, 6);
    expect(lit.tint[2]).toBeGreaterThan(lit.tint[0]);
  });

  it('darkens or lightens only the shadows, the default leaving them as built', () => {
    expect(shadowKeep(SHADOW_DEPTH)).toBeCloseTo(1, 9);
    expect(shadowKeep(0)).toBeCloseTo(2.4, 9);
    expect(shadowKeep(1)).toBeCloseTo(0.3, 9);
    expect(shadowKeep(0.3)).toBeGreaterThan(1);
    expect(shadowKeep(0.8)).toBeLessThan(1);
    expect(shadowKeep(7)).toBeCloseTo(0.3, 9);
    expect(shadowKeep(Number.NaN)).toBeCloseTo(1, 9);
    // the sky's light in the open is the hour's, whatever the shadows are set to
    expect(skyLight(answer(), 720).ambient).toBeCloseTo(0.1, 9);
  });

  it('keeps the map\'s north-west light while no day is read', () => {
    expect(skyLight(null, 600)).toBe(MAP_LIGHT);
    expect(skyLight({ step_minutes: 2, sun: {}, moon: {} }, 600)).toBe(MAP_LIGHT);
    expect(MAP_LIGHT).toMatchObject({ azimuth: 315, altitude: 45, strength: 1, body: null });
  });
});
