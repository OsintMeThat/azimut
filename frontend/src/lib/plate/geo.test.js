import { describe, expect, it } from 'vitest';
import { corners, degreeLabel, graticule, metresPerPixel, project, roundLength, scaleBar, unproject } from './geo.js';

const frame = { width: 800, height: 600 };

describe('the ground in a frame', () => {
  it('puts the centre in the middle and the east to the right, north up', () => {
    const view = { lat: 48.85, lon: 2.35, zoom: 10, bearing: 0 };
    expect(project(view, frame, [2.35, 48.85])).toEqual([400, 300]);
    const [x, y] = project(view, frame, [2.45, 48.85]);
    expect(x).toBeGreaterThan(400);
    expect(y).toBeCloseTo(300);
  });

  it('turns with the map: at a bearing of 90 the east is up', () => {
    const [x, y] = project({ lat: 0, lon: 0, zoom: 8, bearing: 90 }, frame, [0.1, 0]);
    expect(x).toBeCloseTo(400);
    expect(y).toBeLessThan(300);
  });

  it('reads a point back off the frame', () => {
    const view = { lat: 50.4, lon: 30.5, zoom: 11.3, bearing: 33 };
    const [lon, lat] = unproject(view, frame, project(view, frame, [30.55, 50.38]));
    expect(lon).toBeCloseTo(30.55, 9);
    expect(lat).toBeCloseTo(50.38, 9);
    expect(corners(view, frame)).toHaveLength(4);
  });

  it('keeps a point across the antimeridian on the near side', () => {
    const [x] = project({ lat: 0, lon: 179.9, zoom: 8, bearing: 0 }, frame, [-179.9, 0]);
    expect(x).toBeGreaterThan(400);
    expect(x).toBeLessThan(800);
  });

  it('knows how much ground a pixel covers', () => {
    // 512-pixel tiles: at zoom 0 the equator is 40,075 km over 512 pixels
    expect(metresPerPixel({ lat: 0, zoom: 0 })).toBeCloseTo(78271.5, 0);
  });
});

describe('the scale and the graticule', () => {
  it('rounds a length down to 1, 2 or 5 of its power', () => {
    expect([roundLength(7300), roundLength(1999), roundLength(0.7), roundLength(0)]).toEqual([5000, 1000, 0.5, 0]);
  });

  it('draws a bar no wider than asked, in kilometres or metres, and miles on request', () => {
    const wide = scaleBar({ lat: 48, zoom: 9 }, 150);
    expect(wide.pixels).toBeLessThanOrEqual(150);
    expect(wide.label).toMatch(/ km$/);
    expect(scaleBar({ lat: 48, zoom: 17 }, 150).label).toMatch(/ m$/);
    expect(scaleBar({ lat: 48, zoom: 9 }, 150, true).label).toMatch(/ mi$/);
    expect([5, 4, 2]).toContain(wide.segments);
  });

  it('lays a few graticule lines each way, and names them to the minute when they are close', () => {
    const { step, lines } = graticule({ lat: 48.85, lon: 2.35, zoom: 10, bearing: 0 }, frame);
    expect(step).toBeLessThan(1);
    expect(lines.filter((line) => line.axis === 'lon').length).toBeGreaterThanOrEqual(3);
    expect(degreeLabel(48.75, 'lat', 0.25)).toBe('48°45′N');
    expect(degreeLabel(-2, 'lon', 1)).toBe('2°W');
  });
});
