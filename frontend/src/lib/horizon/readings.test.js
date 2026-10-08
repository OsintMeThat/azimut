import { describe, expect, it } from 'vitest';
import { pointerReading, summitReading, targetReading, upOrDown } from './readings.js';

describe('what the Horizon tab says', () => {
  it('reads the pointer as a direction, up or down, and how far', () => {
    expect(pointerReading({ azimuth: 107.04, elevation: 2.54, distance: 9010 })).toBe('107° · 2.5° up · 9.01 km away');
    expect(pointerReading({ azimuth: 107.04, elevation: 12, distance: null }, { fov: 5 })).toBe('107.0° · 12.0° up · sky');
    expect(upOrDown(-0.44)).toBe('0.4° down');
    expect(upOrDown(0.02)).toBe('level');
    expect(pointerReading({ azimuth: 10, elevation: -1, distance: 500 }, { units: 'imperial' })).toBe('10° · 1.0° down · 1640 ft away');
  });

  it('reads a summit by its name, height and distance', () => {
    const label = { name: 'Eiger', peak: { ele: 3967, distance: 13_200 } };
    expect(summitReading(label)).toBe('Eiger · 3967 m · 13.2 km away');
    expect(summitReading({ name: 'Nameless', peak: {} })).toBe('Nameless');
  });

  it('says whether the marked point is in sight and by how much', () => {
    const seen = targetReading({ visible: true, distance: 3640, azimuth: 70.81, margin_deg: 1.2 });
    expect(seen).toEqual({
      verdict: 'In sight',
      where: '3.64 km away · bearing 70.8°',
      margin: '1.2° above the ground in front',
    });
    const hidden = targetReading({ visible: false, distance: 3640, azimuth: 66.02, margin_deg: -3.92 });
    expect(hidden.verdict).toBe('Hidden by the ground');
    expect(hidden.where).toBe('3.64 km away · bearing 66°');
    expect(hidden.margin).toBe('3.9° under the ground in front');
  });
});
