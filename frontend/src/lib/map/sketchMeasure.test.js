import { describe, expect, it } from 'vitest';
import { circleRadius, sketchReading } from './sketchMeasure.js';
import { destination } from '../measure.js';
import { shapeRing } from '../../tools/satellite/state/myLayers.svelte.js';

const ORIGIN = [2.35, 48.85];
/** The point `metres` from the origin on a bearing, as `[lon, lat]`. */
const away = (bearing, metres) => { const point = destination({ lat: ORIGIN[1], lon: ORIGIN[0] }, bearing, metres); return [point.lon, point.lat]; };

describe('sketchReading', () => {
  it('counts the leg to the pointer in a line being drawn', () => {
    const sketch = { type: 'LineString', key: null, rings: [[ORIGIN, away(90, 600)]] };
    expect(sketchReading(sketch, null)).toBe('600 m');
    expect(sketchReading(sketch, away(90, 1500))).toBe('1.50 km');
    expect(sketchReading(sketch, away(90, 1500), 'imperial')).toBe('4921 ft');
  });

  it('says nothing until a line has two corners, pointer included', () => {
    expect(sketchReading({ type: 'LineString', key: null, rings: [[]] }, away(0, 100))).toBe('');
    expect(sketchReading({ type: 'LineString', key: null, rings: [[ORIGIN]] }, away(0, 100))).toBe('100 m');
  });

  it('reads an area once it has three corners, and its side before', () => {
    const square = [ORIGIN, away(90, 1200)];
    expect(sketchReading({ type: 'Polygon', key: null, rings: [square] }, null)).toBe('1.20 km');
    expect(sketchReading({ type: 'Polygon', key: null, rings: [square] }, away(45, Math.SQRT2 * 1200))).toMatch(/ha|km²/);
  });

  it('gives a circle its radius and a box its two sides', () => {
    const circle = { type: 'Polygon', key: null, shape: 'circle', anchor: ORIGIN, rings: [shapeRing('circle', ORIGIN, away(90, 250))] };
    expect(circleRadius(circle)).toBeCloseTo(250, 0);
    expect(sketchReading(circle)).toBe('Radius 250 m');
    const box = { type: 'Polygon', key: null, shape: 'rect', anchor: ORIGIN, rings: [shapeRing('rect', ORIGIN, [away(90, 300)[0], away(0, 200)[1]])] };
    expect(sketchReading(box)).toBe('300 m × 200 m');
  });

  it('leaves a circle with no centre yet, a reshape and a move unsaid', () => {
    expect(circleRadius({ type: 'Polygon', shape: 'circle', anchor: null, rings: [[]] })).toBeNull();
    expect(sketchReading({ type: 'LineString', key: 'k', rings: [[ORIGIN, away(0, 10)]] }, away(0, 20))).toBe('');
    expect(sketchReading({ type: 'Selection', key: 'selection', rings: [[ORIGIN]] }, away(0, 20))).toBe('');
  });
});
