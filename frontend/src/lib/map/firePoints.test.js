import { describe, expect, it } from 'vitest';
import {
  FIRE_MARKS, HANDOVER, MARK_PX, POINT_LAYERS, POINTS_MAX_ZOOM, SQUARE,
  markSize, marksUrl, squareImage, TILE_REVISION,
} from './firePoints.js';

/** An `interpolate` expression with exponential base 2, read at one zoom for one feature. */
function sizeAt(zoom, side) {
  const [, [, base], , ...stops] = markSize();
  const at = (i) => {
    const [, floor, [, [, ], ratio]] = stops[i + 1];
    return Math.max(floor, side * ratio);
  };
  for (let i = 0; i < stops.length - 2; i += 2) {
    const [z0, z1] = [stops[i], stops[i + 2]];
    if (zoom >= z0 && zoom <= z1) {
      const t = (base ** (zoom - z0) - 1) / (base ** (z1 - z0) - 1);
      return at(i) + (at(i + 2) - at(i)) * t;
    }
  }
  return at(stops.length - 2);
}

describe('FIRMS marks, drawn by the map', () => {
  it('asks the app for one question, where the key stays', () => {
    expect(marksUrl({ sensor: 'modis', window: '48h' })).toBe('/api/firms/points/{z}/{x}/{y}?sensor=modis&window=48h&v=2');
    // a dated range is asked with its days, the same tiles at every zoom
    expect(marksUrl({ sensor: 'viirs', window: 'dates', first: '2026-09-01', last: '2026-09-03' }))
      .toBe('/api/firms/points/{z}/{x}/{y}?sensor=viirs&window=dates&first=2026-09-01&last=2026-09-03&v=2');
    expect(FIRE_MARKS.sources({ sensor: 'viirs', window: '24h' })).toEqual({
      marks: '/api/firms/points/{z}/{x}/{y}?sensor=viirs&window=24h&v=2',
    });
    expect(POINT_LAYERS.every((layer) => layer.source === 'marks')).toBe(true);
  });

  it('names the tile format in the address, so a cached tile of an older one is not reused', () => {
    expect(new URL(marksUrl({ sensor: 'viirs', window: 'dates' }), 'http://x').searchParams.get('v'))
      .toBe(TILE_REVISION);
  });

  it('asks the zooms the backend serves', () => {
    expect(POINTS_MAX_ZOOM).toBe(13);
  });

  it('keeps a mark the same size on screen until its footprint is bigger', () => {
    // a 375 m VIIRS pixel is a speck far out, at z8 and at z10: all the 7 px mark
    expect(sizeAt(3, 375) * MARK_PX).toBeCloseTo(MARK_PX);
    expect(sizeAt(8, 375) * MARK_PX).toBeCloseTo(MARK_PX);
    expect(sizeAt(10, 375) * MARK_PX).toBeCloseTo(MARK_PX);
    // where it outgrows the mark, it grows from there and no sooner
    expect(Math.abs(sizeAt(10.6, 375) * MARK_PX - (375 * 2 ** 10.6) / 78271.517)).toBeLessThan(0.1);
    // then it is the ground: 375 m is 19.6 px at z12 on the 512 px world
    expect(sizeAt(12, 375) * MARK_PX).toBeCloseTo((375 * 2 ** 12) / 78271.517, 1);
    // and doubles with each zoom, never jumping between two levels
    const steps = [11, 11.25, 11.5, 11.75, 12].map((zoom) => sizeAt(zoom, 375));
    for (let i = 1; i < steps.length; i += 1) expect(steps[i] / steps[i - 1]).toBeCloseTo(2 ** 0.25, 2);
  });

  it('hands a mark over to its footprint across one half zoom, and keeps one that has none', () => {
    const byId = Object.fromEntries(POINT_LAYERS.map((layer) => [layer.id, layer]));
    expect(byId.mark.paint['icon-opacity']).toEqual(['interpolate', ['linear'], ['zoom'],
      HANDOVER[0], 1, HANDOVER[1], ['case', ['==', ['get', 'foot'], 1], 0, 1]]);
    expect(byId['foot-fill'].paint['fill-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], HANDOVER[0], 0, HANDOVER[1], 0.35]);
    expect(byId['foot-edge'].paint['line-opacity'].slice(-2)).toEqual([HANDOVER[1], 1]);
    // a mark read off a picture has no footprint to give way to, so it is drawn at every zoom
    expect(byId.mark.maxzoom).toBeUndefined();
    for (const id of ['foot-fill', 'foot-ring', 'foot-edge']) expect(byId[id].minzoom).toBe(HANDOVER[0]);
  });

  it('draws every detection, red over amber, lying on the ground', () => {
    const mark = POINT_LAYERS.find((layer) => layer.id === 'mark');
    expect(mark.layout).toMatchObject({
      'icon-image': SQUARE,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'symbol-sort-key': ['get', 'recent'],
    });
    expect(mark.paint['icon-halo-width']).toBe(2);
    // footprints under the marks, fills under every edge
    expect(POINT_LAYERS.map((layer) => layer.id)).toEqual(['foot-fill', 'foot-ring', 'foot-edge', 'mark']);
    const ring = POINT_LAYERS.find((layer) => layer.id === 'foot-ring');
    const edge = POINT_LAYERS.find((layer) => layer.id === 'foot-edge');
    // the ring just outside a clockwise outline, the edge just inside it
    expect(ring.paint['line-offset']).toBeLessThan(0);
    expect(edge.paint['line-offset']).toBeGreaterThan(0);
  });

  it('writes the square as the distance field MapLibre reads', () => {
    const { width, height, data } = squareImage();
    expect([width, height]).toEqual([15, 15]);
    const alpha = (x, y) => data[(y * width + x) * 4 + 3] / 255;
    // solid inside, 0.75 on the edge, falling an eighth a pixel outwards
    expect(alpha(7, 7)).toBe(1);
    expect(alpha(4, 7)).toBeCloseTo(0.75 + 0.5 / 8, 2);
    expect(alpha(3, 7)).toBeCloseTo(0.75 - 0.5 / 8, 2);
    expect(alpha(1, 7)).toBeCloseTo(0.75 - 2.5 / 8, 2);
    // a 2 px ring has room: the field still falls at the image's border
    expect(alpha(0, 7)).toBeGreaterThan(0);
    // square, so the same on every side
    expect(alpha(7, 3)).toBe(alpha(3, 7));
    expect(alpha(11, 7)).toBe(alpha(3, 7));
  });
});
