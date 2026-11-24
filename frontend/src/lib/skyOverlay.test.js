import { describe, expect, it } from 'vitest';
import {
  bodyReading,
  bodySvg,
  clockOf,
  hourTicks,
  isBelow,
  markScale,
  nearestSample,
  phaseAngleOf,
  shadowSentence,
  upRuns,
} from './skyOverlay.js';

describe('upRuns', () => {
  it('keeps only the stretches the body spends above the horizon', () => {
    expect(upRuns([-5, -1, 3, 9, 12, 4, -2, -8])).toEqual([[2, 3, 4, 5]]);
  });

  it('splits a day the body rises twice in, rather than joining the two arcs', () => {
    // A polar-summer day: down for a few samples around local midnight.
    expect(upRuns([4, 9, 2, -1, -3, 2, 8, 5])).toEqual([
      [0, 1, 2],
      [5, 6, 7],
    ]);
  });

  it('drops a lone sample, because a polyline needs two points', () => {
    expect(upRuns([-2, 1, -2, 4, 6])).toEqual([[3, 4]]);
  });

  it('treats the horizon itself as up, so a grazing pass is still drawn', () => {
    expect(upRuns([-1, 0, 0, -1])).toEqual([[1, 2]]);
  });

  it('says nothing for a body that never rises', () => {
    expect(upRuns([-9, -12, -30])).toEqual([]);
  });

  it('closes a run that is still open at the end of the day', () => {
    expect(upRuns([-1, 2, 3])).toEqual([[1, 2]]);
  });
});

describe('nearestSample', () => {
  const clock = ['00:00', '00:30', '01:00', '01:30', '02:00'];

  it('finds the sample a wall clock lands on', () => {
    expect(nearestSample(clock, '01:00')).toBe(2);
  });

  it('rounds to the closest label rather than interpolating', () => {
    expect(nearestSample(clock, '01:20')).toBe(3);
    expect(nearestSample(clock, '01:10')).toBe(2);
  });

  it('reads the day own labels, so a repeated hour is not an hour off', () => {
    // The night daylight saving ends: 02:00 comes round twice, and dividing the
    // sample index by two would land on the wrong one.
    const dst = ['01:00', '01:30', '02:00', '02:30', '02:00', '02:30', '03:00'];
    expect(nearestSample(dst, '02:00')).toBe(2);
    expect(nearestSample(dst, '03:00')).toBe(6);
  });

  it('falls on the first sample when asked for something before the day starts', () => {
    expect(nearestSample(clock, '00:00')).toBe(0);
  });
});

describe('hourTicks', () => {
  const minutes = [0, 30, 60, 90, 120, 150, 180, 210];

  it('ticks on the hour and never between', () => {
    const up = minutes.map(() => 10);
    expect(hourTicks(minutes, up).map((t) => t.index)).toEqual([0, 2, 4, 6]);
  });

  it('draws every third hour longer', () => {
    const up = minutes.map(() => 10);
    expect(hourTicks(minutes, up).filter((t) => t.long).map((t) => t.index)).toEqual([0, 6]);
  });

  it('leaves the hours the body is under the horizon unmarked', () => {
    const altitudes = [-3, 0, 5, 0, 8, 0, -1, 0];
    expect(hourTicks(minutes, altitudes).map((t) => t.index)).toEqual([2, 4]);
  });
});

describe('the mark on the ray', () => {
  it('sits on the arc at the horizon and on the anchor at the zenith', () => {
    expect(markScale(0)).toBe(1);
    expect(markScale(90)).toBe(0);
  });

  it('rides closer to the anchor the higher the body is', () => {
    expect(markScale(60)).toBeLessThan(markScale(30));
  });

  it('calls a body below the horizon below, and the horizon itself up', () => {
    expect(isBelow(-0.1)).toBe(true);
    expect(isBelow(0)).toBe(false);
  });
});

describe('phaseAngleOf', () => {
  it('reads a full moon as no phase angle, and a new one as half a turn', () => {
    expect(phaseAngleOf(1)).toBeCloseTo(0);
    expect(phaseAngleOf(0)).toBeCloseTo(180);
  });

  it('reads a half moon as a quarter turn', () => {
    expect(phaseAngleOf(0.5)).toBeCloseTo(90);
  });

  it('never goes imaginary on a fraction just outside the range', () => {
    expect(Number.isNaN(phaseAngleOf(1.0001))).toBe(false);
    expect(Number.isNaN(phaseAngleOf(-0.0001))).toBe(false);
  });
});

describe('bodySvg', () => {
  it('draws the sun as one filled disc', () => {
    const svg = bodySvg('sun', '#bd8721', 1, true);
    expect(svg).toContain('fill="#bd8721"');
    expect(svg).not.toContain('<path');
  });

  it('draws the moon as a lit path over a dimmed disc', () => {
    const svg = bodySvg('moon', '#4a93cc', 0.4, true);
    expect(svg).toContain('opacity="0.25"');
    expect(svg).toContain('<path d="');
  });

  it('turns the lit side with the phase, so waxing and waning differ', () => {
    const waxing = bodySvg('moon', '#fff', 0.3, true);
    const waning = bodySvg('moon', '#fff', 0.3, false);
    expect(waxing).not.toBe(waning);
  });

  it('scales the whole glyph off one size', () => {
    expect(bodySvg('sun', '#fff', 1, true, 40)).toContain('width="40"');
  });
});

describe('bodyReading', () => {
  it('states the body, the time, the bearing and the height, rounded', () => {
    expect(bodyReading('Sun', '14:30', 213.4, 27.6)).toBe('Sun 14:30 · az 213° · alt 28°');
  });
});

describe('a shadow read', () => {
  it('reads a moment on the same clock as the day’s samples', () => {
    expect(clockOf({ local: '2024-06-21T14:12:05+02:00' })).toBe('14:12');
    expect(clockOf(null)).toBe('');
  });

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
