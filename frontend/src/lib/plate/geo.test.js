import { describe, expect, it } from 'vitest';
import { bearingTo, circle, corners, decimalLabel, degreeLabel, distance, fromUTM, graticule, inFrame, metresPerPixel, project, roundLength, sameView, scaleBar,
  scaleRatio, sector, toUTMIn, travel, unproject, utmGrid, utmLabel } from './geo.js';

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

describe('a view coming back', () => {
  it('is the same camera once rounded as a plate keeps it, across the antimeridian too', () => {
    const live = { lat: 48.8566123, lon: 2.3522449, zoom: 12.34567, bearing: 12.34 };
    const kept = { lat: 48.856612, lon: 2.352245, zoom: 12.346, bearing: 12.3 };
    expect(sameView(live, kept)).toBe(true);
    expect(sameView({ ...live, lon: 362.3522449 }, kept)).toBe(true);
    expect(sameView({ ...live, bearing: 180 }, { ...kept, bearing: -179.96 })).toBe(true);
    expect(sameView(live, { ...kept, lat: 48.8567 })).toBe(false);
    expect(sameView(live, { ...kept, zoom: 12.4 })).toBe(false);
    expect(sameView(live, { ...kept, bearing: 13 })).toBe(false);
  });
});

describe('what a frame shows, and shapes on the ground', () => {
  const view = { lat: 10, lon: 20, zoom: 10, bearing: 0 };
  const frame = { width: 400, height: 300 };

  it('says whether a feature is drawn in the frame: a point, a line crossing it, an area round it', () => {
    expect(inFrame({ type: 'Point', coordinates: [20, 10] }, view, frame)).toBe(true);
    expect(inFrame({ type: 'Point', coordinates: [25, 10] }, view, frame)).toBe(false);
    expect(inFrame({ type: 'LineString', coordinates: [[19, 10], [21, 10]] }, view, frame)).toBe(true);
    expect(inFrame({ type: 'LineString', coordinates: [[19, 12], [21, 12]] }, view, frame)).toBe(false);
    expect(inFrame({ type: 'Polygon', coordinates: [[[19, 9], [21, 9], [21, 11], [19, 11], [19, 9]]] }, view, frame)).toBe(true);
  });

  it('travels a distance on a bearing and measures it back', () => {
    const there = travel([20, 10], 90, 5000);
    expect(distance([20, 10], there)).toBeCloseTo(5000, -1);
    expect(bearingTo([20, 10], there)).toBeCloseTo(90, 0);
    const ring = circle([20, 10], 1000, 12);
    expect(ring).toHaveLength(13);
    expect(sector([20, 10], 0, 90, 1000, 4)).toHaveLength(7);
  });

  it('turns a UTM point back into the ground it came from', () => {
    for (const point of [[20.3, 10.2], [2.35, 48.85], [-70.6, -33.4]]) {
      const zone = Math.floor((point[0] + 180) / 6) + 1;
      const utm = toUTMIn(zone, point);
      const [lon, lat] = fromUTM(zone, utm.north, utm.easting, utm.northing);
      expect(lon).toBeCloseTo(point[0], 6);
      expect(lat).toBeCloseTo(point[1], 6);
    }
    const grid = utmGrid(view, frame);
    expect(grid.zone).toBe(34);
    expect(grid.lines.length).toBeGreaterThan(4);
    expect(utmLabel(482000, 1000)).toBe('482');
    expect(utmLabel(482000, 1000, true)).toBe('82');
  });

  it('writes a decimal label and the plate\'s scale as a ratio', () => {
    expect(decimalLabel(48.856, 'lat', 0.01)).toBe('48.86°N');
    expect(scaleRatio({ lat: 0, lon: 0, zoom: 12, bearing: 0 }, 96 / 25.4)).toMatch(/^1:\d{1,3}(,\d{3})+$/);
  });
});
