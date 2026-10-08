import { describe, expect, it } from 'vitest';
import { blockedSample, climb, gradeDegrees, niceStep, profileChart, sampleNear, slopes, stretchLabel } from './profile.js';

const PROFILE = {
  distance_m: [0, 1000, 2000, 3000, 4000],
  elevation: [100, 300, 250, 400, 200],
};
const BOX = { width: 444, height: 132, left: 44, right: 0, top: 10, bottom: 22 };

describe('an elevation profile', () => {
  it('adds up the climb and the descent', () => {
    expect(climb(PROFILE.elevation)).toEqual({ up: 350, down: 250, min: 100, max: 400 });
  });

  it('reads the slope over each sample’s neighbours, in percent', () => {
    expect(slopes(PROFILE.distance_m, PROFILE.elevation)).toEqual([20, 7.5, 5, -2.5, -20]);
  });

  it('cuts an axis on round steps', () => {
    expect(niceStep(300, 4)).toBe(100);
    expect(niceStep(4000, 4)).toBe(1000);
    expect(niceStep(7280, 6)).toBe(2000);
    expect(niceStep(0, 4)).toBe(1);
  });

  it('fills the ground under a line on round axes', () => {
    const chart = profileChart(PROFILE, BOX);
    expect(chart.tops.map((point) => point.x)).toEqual([44, 144, 244, 344, 444]);
    expect(chart.area.startsWith(`M44,${chart.floor} L44,`)).toBe(true);
    expect(chart.area.endsWith(`L444,${chart.floor} Z`)).toBe(true);
    expect(chart.line.startsWith('M44,')).toBe(true);
    expect(chart.yTicks.map((tick) => tick.label)).toEqual(['100 m', '200 m', '300 m', '400 m']);
    expect(chart.xTicks.map((tick) => tick.label)).toEqual(['0', '1 km', '2 km', '3 km', '4 km']);
    expect(chart.xTicks.map((tick) => tick.x)).toEqual([44, 144, 244, 344, 444]);
    expect(chart.sight).toBeNull();
    expect(chart.blocked).toBeNull();
  });

  it('draws the sight line straight over a bulged ground and marks what is in the way', () => {
    const chart = profileChart(
      {
        ...PROFILE,
        sight: { visible: false, blocked_at_m: 3000, eye_m: 101.7, target_m: 200, bulge_m: [0, 10, 20, 10, 0] },
      },
      BOX
    );
    const { eye, target, path } = chart.sight;
    expect(path).toBe(`M${eye.x},${eye.y} L${target.x},${target.y}`);
    expect(chart.blocked.x).toBe(344);
    // the blocking ground is the highest drawn: 400 m with 10 m of bulge
    expect(chart.blocked.y).toBe(Math.min(...chart.tops.map((point) => point.y)));
  });
});

describe('reading the chart under the pointer', () => {
  it('finds the sample drawn nearest the pointer', () => {
    const { tops } = profileChart(PROFILE, BOX);
    expect(sampleNear(tops, 0)).toBe(0);
    expect(sampleNear(tops, 230)).toBe(2);
    expect(sampleNear(tops, 300)).toBe(3);
    expect(sampleNear(tops, 999)).toBe(4);
  });
});

describe('the axes in the analyst’s units', () => {
  it('counts a short line in metres and an imperial one in feet and miles', () => {
    const short = { distance_m: [0, 400, 800], elevation: [10, 30, 20] };
    expect(profileChart(short, BOX).xTicks.map((tick) => tick.label)).toEqual([
      '0', '200 m', '400 m', '600 m', '800 m',
    ]);
    const imperial = profileChart(PROFILE, { ...BOX, units: 'imperial' });
    expect(imperial.xTicks.map((tick) => tick.label)).toEqual(['0', '1 mi', '2 mi']);
    expect(imperial.yTicks.every((tick) => tick.label.endsWith(' ft'))).toBe(true);
  });

  it('reads a cliff in degrees rather than a grade past a hundred percent', () => {
    expect(gradeDegrees(100)).toBeCloseTo(45);
    expect(gradeDegrees(-564)).toBeCloseTo(79.9, 1);
  });
});

describe('what the chart says about itself', () => {
  it('finds the sample where the ground stands in the way', () => {
    const profile = { distance_m: [0, 100, 200, 300], sight: { blocked_at_m: 150 } };
    expect(blockedSample(profile)).toBe(2);
    expect(blockedSample({ distance_m: [0, 1], sight: { blocked_at_m: null } })).toBe(-1);
    expect(blockedSample(null)).toBe(-1);
  });

  it('states how much taller the heights are drawn, and nothing near real scale', () => {
    const profile = { distance_m: [0, 20000], elevation: [1000, 2000] };
    const chart = profileChart(profile, { width: 600, height: 200 });
    expect(chart.stretch).toBeGreaterThan(3);
    expect(stretchLabel(chart.stretch)).toMatch(/^Heights ×\d/);
    expect(stretchLabel(1.05)).toBe('');
    expect(stretchLabel(24.4)).toBe('Heights ×24');
  });
});
