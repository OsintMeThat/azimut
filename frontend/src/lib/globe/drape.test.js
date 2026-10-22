import { describe, expect, it } from 'vitest';
import { DRAPE_SIZE, engineZoom, paintTile, tilePixel } from './drape.js';
import { compileLayer } from './style.js';

/** A 2D context that writes down what it was asked to paint. */
function recorder() {
  const calls = [];
  const path = [];
  const ctx = {
    calls,
    save() {},
    restore() {},
    beginPath() {
      path.length = 0;
    },
    moveTo(x, y) {
      path.push(['M', x, y]);
    },
    lineTo(x, y) {
      path.push(['L', x, y]);
    },
    closePath() {},
    setLineDash(dash) {
      ctx.dash = dash;
    },
    stroke() {
      calls.push({ op: 'stroke', colour: ctx.strokeStyle, width: ctx.lineWidth, dash: ctx.dash, path: [...path] });
    },
    fill() {
      calls.push({ op: 'fill', colour: ctx.fillStyle, alpha: ctx.globalAlpha, path: [...path] });
    },
    drawImage(image, ...box) {
      calls.push({ op: 'image', image, box, alpha: ctx.globalAlpha });
    },
    createPattern: (image) => ({ pattern: image }),
  };
  return ctx;
}

const LINE = compileLayer({
  id: 'line',
  type: 'line',
  source: 'shapes',
  filter: ['has', 'stroke'],
  paint: { 'line-color': ['get', 'stroke'], 'line-width': 3, 'line-dasharray': [2, 1] },
});
const FILL = compileLayer({ id: 'fill', type: 'fill', source: 'shapes', filter: ['has', 'fill'], paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.5 } });

describe('a tile of the globe’s ground, painted', () => {
  it('places a point on the tile it falls in, in the tile’s pixels', () => {
    expect(tilePixel(-180, 85.0511, { z: 0, x: 0, y: 0 })).toEqual([0, expect.closeTo(0, 3)]);
    const [x, y] = tilePixel(0, 0, { z: 1, x: 1, y: 1 });
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(engineZoom(12)).toBe(11);
  });

  it('strokes a line with its colour, its width and its dash in pixels', () => {
    const ctx = recorder();
    const features = [{ type: 'LineString', geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] }, properties: { stroke: '#ff0000' } }];
    const drawn = paintTile(ctx, { z: 1, x: 1, y: 1 }, [{ layer: LINE, features }]);
    expect(drawn).toBe(1);
    const [stroke] = ctx.calls;
    expect(stroke).toMatchObject({ op: 'stroke', colour: 'rgba(255,0,0,1)', width: 3, dash: [6, 3] });
    expect(stroke.path[0][1]).toBeCloseTo(0);
    expect(stroke.path[1][1]).toBeCloseTo((10 / 180) * DRAPE_SIZE);
  });

  it('fills an area, and leaves out what its filter refuses', () => {
    const ctx = recorder();
    const square = { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] };
    const features = [
      { type: 'Polygon', geometry: square, properties: { fill: '#0000ff' } },
      { type: 'Polygon', geometry: square, properties: {} },
    ];
    expect(paintTile(ctx, { z: 1, x: 1, y: 0 }, [{ layer: FILL, features }, { layer: LINE, features }])).toBe(1);
    expect(ctx.calls).toEqual([expect.objectContaining({ op: 'fill', colour: 'rgba(0,0,255,0.5)' })]);
  });

  it('lays a raster overlay’s tile, or the quarter of its parent that covers this tile', () => {
    const raster = compileLayer({ id: 'r', type: 'raster', source: 'rail', paint: { 'raster-opacity': 0.85 } });
    const ctx = recorder();
    const image = { width: 256 };
    paintTile(ctx, { z: 5, x: 3, y: 2 }, [{ layer: raster, image, from: { z: 4, x: 1, y: 1 } }]);
    expect(ctx.calls[0]).toMatchObject({ op: 'image', alpha: 0.85, box: [128, 0, 128, 128, 0, 0, DRAPE_SIZE, DRAPE_SIZE] });
  });

  it('paints a vector tile’s lines, read in the tile they come from', () => {
    const border = compileLayer({ id: 'b', type: 'line', source: 'omt', 'source-layer': 'boundary', paint: { 'line-color': '#fff' } });
    const feature = { type: 2, properties: { admin_level: 2 }, loadGeometry: () => [[{ x: 0, y: 2048 }, { x: 4096, y: 2048 }]] };
    const vector = { layers: { boundary: { extent: 4096, length: 1, feature: () => feature } } };
    const ctx = recorder();
    paintTile(ctx, { z: 3, x: 1, y: 0 }, [{ layer: border, vector, from: { z: 2, x: 0, y: 0 } }]);
    // the parent's middle line is this tile's bottom edge
    expect(ctx.calls[0].path).toEqual([['M', -256, 256], ['L', 256, 256]]);
  });

  it('paints nothing for a layer out of its zoom range or hidden', () => {
    const late = compileLayer({ id: 'l', type: 'line', source: 's', minzoom: 9, paint: { 'line-color': '#fff' } });
    const features = [{ type: 'LineString', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} }];
    expect(paintTile(recorder(), { z: 8, x: 128, y: 127 }, [{ layer: late, features }])).toBe(0);
  });
});
