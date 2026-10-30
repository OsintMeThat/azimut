import { describe, expect, it } from 'vitest';
import { DRAPE_SIZE, engineZoom, LINE_MARGIN, paintTile, tilePixel, visibleRuns } from './drape.js';
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
      calls.push({ op: 'stroke', colour: ctx.strokeStyle, width: ctx.lineWidth, dash: ctx.dash, offset: ctx.lineDashOffset ?? 0, path: [...path] });
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

  it('traces only what of an ancestor’s line can show on the tile, and leaves a tile it misses bare', () => {
    const border = compileLayer({ id: 'b', type: 'line', source: 'omt', 'source-layer': 'boundary', paint: { 'line-color': '#fff', 'line-width': 2 } });
    // a border of the z2 tile wandering across all of it, read on one of its z6 children
    const wander = Array.from({ length: 400 }, (_, i) => ({ x: i * 10, y: 2048 + 1500 * Math.sin(i / 9) }));
    const feature = { type: 2, properties: {}, loadGeometry: () => [wander] };
    const vector = { layers: { boundary: { extent: 4096, length: 1, feature: () => feature } } };
    const ctx = recorder();
    const tile = { z: 6, x: 8, y: 8 };
    paintTile(ctx, tile, [{ layer: border, vector, from: { z: 2, x: 0, y: 0 } }]);
    const traced = ctx.calls.flatMap((call) => call.path);
    expect(traced.length).toBeGreaterThan(1);
    expect(traced.length).toBeLessThan(wander.length / 4);
    // each segment kept comes within reach of the tile
    const reach = LINE_MARGIN + 2;
    for (const [, x, y] of traced) expect(Math.min(Math.abs(x - 128), Math.abs(y - 128))).toBeLessThan(DRAPE_SIZE * 16);
    expect(traced.some(([, x, y]) => x >= -reach && x <= DRAPE_SIZE + reach && y >= -reach && y <= DRAPE_SIZE + reach)).toBe(true);
    // a child the line never comes near paints nothing, so it has no picture to lay
    const away = recorder();
    expect(paintTile(away, { z: 6, x: 8, y: 0 }, [{ layer: border, vector, from: { z: 2, x: 0, y: 0 } }])).toBe(0);
    expect(away.calls).toEqual([]);
  });

  it('keeps a segment that crosses the tile though both its ends lie far off it', () => {
    expect(visibleRuns([[-5000, 100], [5000, 120]], 256, 10)).toEqual([{ from: 0, points: [[-5000, 100], [5000, 120]] }]);
    expect(visibleRuns([[-5000, -100], [5000, -120]], 256, 10)).toEqual([]);
  });

  it('starts each part of a dashed line where the whole line has its dash, so dashes meet across tiles', () => {
    const runs = visibleRuns([[-300, 50], [-100, 50], [100, 50], [400, 50], [400, 900], [100, 900], [100, 200]], 256, 10);
    expect(runs.map((run) => run.from)).toEqual([200, 200 + 200 + 300 + 850 + 300]);
    const ctx = recorder();
    const features = [{ type: 'LineString', geometry: { type: 'LineString', coordinates: [[-40, 0], [-20, 0], [40, 0]] }, properties: { stroke: '#ff0000' } }];
    paintTile(ctx, { z: 3, x: 4, y: 3 }, [{ layer: LINE, features }]);
    const [stroke] = ctx.calls;
    // the tile spans 45°, and the part traced starts 20° along the line: its dash is offset by that much
    expect(stroke.path[0][1]).toBeCloseTo((-20 / 45) * DRAPE_SIZE, 1);
    expect(stroke.offset).toBeCloseTo((20 / 45) * DRAPE_SIZE, 1);
  });

  it('drops points nearer than a quarter pixel, the ends kept', () => {
    const points = [[10, 10], [10.05, 10], [10.1, 10], [20, 10], [20.1, 10.05]];
    expect(visibleRuns(points, 256, 10)).toEqual([{ from: 0, points: [[10, 10], [20, 10], [20.1, 10.05]] }]);
  });

  it('paints nothing for a layer out of its zoom range or hidden', () => {
    const late = compileLayer({ id: 'l', type: 'line', source: 's', minzoom: 9, paint: { 'line-color': '#fff' } });
    const features = [{ type: 'LineString', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} }];
    expect(paintTile(recorder(), { z: 8, x: 128, y: 127 }, [{ layer: late, features }])).toBe(0);
  });
});
