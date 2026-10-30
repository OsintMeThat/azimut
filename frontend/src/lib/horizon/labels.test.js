import { describe, expect, it } from 'vitest';
import { LABEL_SPACING, labelAt, labelWidth, mergePeaks, placeLabels, SAME_PEAK_M, TEXT_HEIGHT } from './labels.js';
import { toScreen } from './camera.js';

const CAMERA = { heading: 90, tilt: 0, roll: 0, fov: 60, width: 1200, height: 600, projection: 'camera' };
/** A flat skyline 2° up across the frame. */
const SKYLINE = (x) => toScreen(CAMERA, 90, 2).y + x * 0;

function boxes(placed) {
  return placed.map((label) => ({
    left: label.left,
    right: label.left + label.width,
    top: label.top,
    bottom: label.baseline,
  }));
}

describe('summit names on the view', () => {
  it('sets a lone name in the sky above its summit, over the skyline', () => {
    const [label] = placeLabels([{ name: 'Eiger', ele: 3967, azimuth: 90, angle: 1 }], CAMERA, { skylineY: SKYLINE });
    expect(label.x).toBeCloseTo(600, 6);
    expect(label.left + label.width / 2).toBeCloseTo(600, 6);
    // above the skyline, not just above the summit standing lower in front of it
    expect(label.baseline).toBeLessThan(SKYLINE(600));
    expect(label.baseline).toBeLessThan(label.y);
  });

  it('never lets two names overlap, names the highest first, and stays one per spacing', () => {
    const crowd = Array.from({ length: 30 }, (_, i) => ({
      name: `Summit ${i}`,
      ele: 4000 - i * 10,
      azimuth: 75 + i,
      angle: 1 + (i % 5) * 0.3,
    }));
    const placed = placeLabels(crowd, CAMERA, { skylineY: SKYLINE });
    expect(placed[0].name).toBe('Summit 0');
    expect(placed.length).toBeLessThanOrEqual(Math.floor(CAMERA.width / LABEL_SPACING));
    const drawn = boxes(placed);
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        const a = drawn[i];
        const b = drawn[j];
        expect(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom).toBe(true);
      }
    }
  });

  it('keeps names inside the frame and out of a reserved corner', () => {
    const edge = placeLabels([{ name: 'Very long summit name', ele: 3000, azimuth: 61, angle: 1 }], CAMERA);
    expect(edge[0].left).toBeGreaterThanOrEqual(0);
    const corner = { left: 900, right: 1200, top: 0, bottom: 600 };
    expect(placeLabels([{ name: 'Covered', ele: 3000, azimuth: 110, angle: 1 }], CAMERA, { reserved: [corner] })).toEqual([]);
  });

  it('leaves out what is behind the camera or off the frame', () => {
    expect(placeLabels([{ name: 'Behind', azimuth: 270, angle: 1 }], CAMERA)).toEqual([]);
    expect(placeLabels([{ name: 'Above', azimuth: 90, angle: 60 }], CAMERA)).toEqual([]);
  });

  it('names a summit from the top down when the skyline stands above the frame', () => {
    const [label] = placeLabels([{ name: 'Cliff', ele: 2000, azimuth: 90, angle: 0 }], CAMERA, { skylineY: () => -400 });
    expect(label.top).toBeGreaterThanOrEqual(0);
    expect(label.baseline).toBeLessThan(label.y);
  });

  it('prefers the English name when OpenStreetMap has one', () => {
    const [label] = placeLabels([{ name: 'Mönch', name_en: 'Monk', azimuth: 90, angle: 2 }], CAMERA);
    expect(label.name).toBe('Monk');
    expect(label.width).toBe(labelWidth('Monk'));
  });

  it('finds the name under the pointer, or its summit', () => {
    const placed = placeLabels([{ name: 'Eiger', ele: 3967, azimuth: 90, angle: 1 }], CAMERA);
    const [label] = placed;
    expect(labelAt(placed, label.left + 4, label.baseline - TEXT_HEIGHT / 2)).toBe(label);
    expect(labelAt(placed, label.x + 3, label.y - 2)).toBe(label);
    expect(labelAt(placed, 10, 590)).toBeNull();
  });
});

describe('one name per top', () => {
  it('keeps the higher of two tops named alike or standing within a few hundred metres', () => {
    const merged = mergePeaks([
      { name: 'Wengen Jungfrau', ele: 4089, lat: 46.5465, lon: 7.9612 },
      { name: 'Jungfrau', ele: 4158, lat: 46.5367, lon: 7.9625 },
      { name: 'jungfrau ', ele: 3000, lat: 46.6, lon: 8.1 },
      { name: 'Silberhorn', ele: 3695, lat: 46.5333, lon: 7.9333 },
    ]);
    // Wengen Jungfrau stands 1.1 km from the summit: a top of its own
    expect(merged.map((peak) => peak.name)).toEqual(['Jungfrau', 'Wengen Jungfrau', 'Silberhorn']);
    const close = mergePeaks([
      { name: 'Rock', ele: 3000, lat: 46.5, lon: 7.9 },
      { name: 'Summit', ele: 3010, lat: 46.5 + (SAME_PEAK_M * 0.5) / 111_000, lon: 7.9 },
    ]);
    expect(close.map((peak) => peak.name)).toEqual(['Summit']);
  });
});
