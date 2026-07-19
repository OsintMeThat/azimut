import { describe, it, expect } from 'vitest';
import {
  degSteps,
  aoiBounds,
  createGrid,
  cellKey,
  parseKey,
  cellRange,
  cellBounds,
  cellCenter,
  pointInPolygon,
  rectIntersectsPolygon,
  estimateCells,
  cellsInAoi,
  coverage,
  cycleStatus,
  nextUnchecked,
  pruneStatuses,
  resizeRect,
  resizePolygon,
} from './gridSearch.js';

const rect = (south, west, north, east) => ({ type: 'rect', bounds: { south, west, north, east } });

describe('degSteps', () => {
  it('makes square-ish cells at the equator', () => {
    const { latStep, lonStep } = degSteps(0, 1000);
    expect(latStep).toBeCloseTo(lonStep, 6);
  });

  it('widens the lon step with latitude (cells stay ~metric on the ground)', () => {
    const eq = degSteps(0, 1000);
    const north = degSteps(60, 1000);
    // at 60°N, one metre east spans ~2× the longitude of the equator
    expect(north.lonStep).toBeCloseTo(eq.lonStep * 2, 3);
    expect(north.latStep).toBeCloseTo(eq.latStep, 9);
  });

  it('never blows up at the pole', () => {
    expect(Number.isFinite(degSteps(90, 1000).lonStep)).toBe(true);
  });
});

describe('aoiBounds', () => {
  it('returns rect bounds unchanged', () => {
    expect(aoiBounds(rect(1, 2, 3, 4)).north).toBe(3);
  });

  it('computes the bbox of a polygon', () => {
    const b = aoiBounds({ type: 'polygon', vertices: [[0, 0], [2, 1], [1, 3]] });
    expect(b).toEqual({ south: 0, west: 0, north: 2, east: 3 });
  });
});

describe('cellKey / parseKey', () => {
  it('round-trips, including negative indices', () => {
    expect(parseKey(cellKey(-3, 7))).toEqual([-3, 7]);
  });
});

describe('createGrid', () => {
  it('anchors the lattice at the south-west corner', () => {
    const g = createGrid(rect(48, 2, 48.02, 2.02), 500);
    expect(g.anchor).toEqual({ lat: 48, lon: 2 });
    expect(g.statuses).toEqual({});
    expect(g.cell_m).toBe(500);
  });
});

describe('cellRange / cellBounds', () => {
  it('covers the whole box and tiles it without gaps', () => {
    const g = createGrid(rect(0, 0, 0.03, 0.03), 1000); // ~0.009° cells
    const { iMin, iMax, jMin, jMax } = cellRange(g);
    expect(iMin).toBe(0);
    // cell 0 starts at the anchor; consecutive cells share an edge
    const c0 = cellBounds(g, 0, 0);
    const c1 = cellBounds(g, 1, 0);
    expect(c1.south).toBeCloseTo(c0.north, 9);
    // the top cell reaches past the northern edge (full coverage)
    expect(cellBounds(g, iMax, jMax).north).toBeGreaterThanOrEqual(0.03);
  });
});

describe('cellCenter', () => {
  it('is the midpoint of the cell bounds', () => {
    const g = createGrid(rect(0, 0, 0.01, 0.01), 1000);
    const b = cellBounds(g, 0, 0);
    const c = cellCenter(g, 0, 0);
    expect(c.lat).toBeCloseTo((b.south + b.north) / 2, 12);
    expect(c.lon).toBeCloseTo((b.west + b.east) / 2, 12);
  });
});

describe('pointInPolygon', () => {
  const square = [[0, 0], [0, 2], [2, 2], [2, 0]];
  it('is true inside', () => {
    expect(pointInPolygon({ lat: 1, lon: 1 }, square)).toBe(true);
  });
  it('is false outside', () => {
    expect(pointInPolygon({ lat: 3, lon: 1 }, square)).toBe(false);
  });
});

describe('rectIntersectsPolygon', () => {
  const tri = [[0, 0], [0, 4], [4, 0]]; // region lat>=0, lon>=0, lat+lon<=4
  it('is true when the polygon clips a cell corner (centre outside)', () => {
    // centre (2, 2.5) has lat+lon=4.5 → outside; SW corner (1.5, 2) sums to
    // 3.5 → inside. A strict centre test would wrongly drop this edge cell.
    const cell = { south: 1.5, west: 2, north: 2.5, east: 3 };
    expect(pointInPolygon({ lat: 2, lon: 2.5 }, tri)).toBe(false);
    expect(rectIntersectsPolygon(cell, tri)).toBe(true);
  });
  it('is false for a cell the polygon never touches', () => {
    expect(rectIntersectsPolygon({ south: 5, west: 5, north: 6, east: 6 }, tri)).toBe(false);
  });
});

describe('cellsInAoi', () => {
  it('fills a rectangle completely', () => {
    const g = createGrid(rect(0, 0, 0.02, 0.03), 1000);
    const { iMin, iMax, jMin, jMax } = cellRange(g);
    const expected = (iMax - iMin + 1) * (jMax - jMin + 1);
    expect(cellsInAoi(g).length).toBe(expected);
  });

  it('keeps only centres inside a polygon', () => {
    // a big triangle covering roughly half of its bounding box
    const g = createGrid(
      { type: 'polygon', vertices: [[0, 0], [0, 0.05], [0.05, 0]] },
      1000
    );
    const inside = cellsInAoi(g).length;
    const box = estimateCells(g);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(box); // the polygon prunes corner cells
  });
  it('covers the full polygon: cells only clipping an edge are included', () => {
    // a slanted triangle: with a strict centre test, the diagonal edge would
    // leave a bare staircase of half-cells; intersection tiling fills them
    const aoi = { type: 'polygon', vertices: [[0, 0], [0, 0.05], [0.05, 0]] };
    const g = createGrid(aoi, 1000);
    // every cell whose centre is inside is a subset of the cells that overlap
    const overlap = cellsInAoi(g).length;
    let centres = 0;
    const { iMin, iMax, jMin, jMax } = cellRange(g);
    for (let i = iMin; i <= iMax; i++)
      for (let j = jMin; j <= jMax; j++)
        if (pointInPolygon(cellCenter(g, i, j), aoi.vertices)) centres++;
    expect(overlap).toBeGreaterThan(centres);
  });});

describe('coverage', () => {
  it('tallies cleared / flagged / unchecked and a percentage', () => {
    const g = createGrid(rect(0, 0, 0.02, 0.02), 1000);
    const cells = cellsInAoi(g);
    g.statuses[cellKey(...cells[0])] = 'cleared';
    g.statuses[cellKey(...cells[1])] = 'flagged';
    const cov = coverage(g);
    expect(cov.total).toBe(cells.length);
    expect(cov.cleared).toBe(1);
    expect(cov.flagged).toBe(1);
    expect(cov.unchecked).toBe(cells.length - 2);
    expect(cov.percent).toBe(Math.round((2 / cells.length) * 100));
  });

  it('is 0% for an empty grid', () => {
    const g = createGrid(rect(0, 0, 0.01, 0.01), 1000);
    expect(coverage(g).percent).toBe(0);
  });
});

describe('cycleStatus', () => {
  it('goes unchecked -> cleared -> flagged -> unchecked', () => {
    expect(cycleStatus(undefined)).toBe('cleared');
    expect(cycleStatus('cleared')).toBe('flagged');
    expect(cycleStatus('flagged')).toBe(null);
  });
});

describe('nextUnchecked', () => {
  it('walks unchecked cells and wraps', () => {
    const g = createGrid(rect(0, 0, 0.03, 0.03), 1000);
    const first = nextUnchecked(g, null);
    expect(first).not.toBeNull();
    g.statuses[cellKey(...first)] = 'cleared';
    const second = nextUnchecked(g, cellKey(...first));
    expect(cellKey(...second)).not.toBe(cellKey(...first));
  });

  it('returns null once every cell is marked', () => {
    const g = createGrid(rect(0, 0, 0.01, 0.01), 1000);
    for (const [i, j] of cellsInAoi(g)) g.statuses[cellKey(i, j)] = 'cleared';
    expect(nextUnchecked(g, null)).toBeNull();
  });
});

describe('resizeRect', () => {
  it('keeps the lattice fixed and preserves surviving marks', () => {
    const g = createGrid(rect(0, 0, 0.02, 0.02), 1000);
    const anchor = { ...g.anchor };
    const step = g.lat_step;
    const cells = cellsInAoi(g);
    g.statuses[cellKey(...cells[0])] = 'cleared';
    // grow the box: anchor and step must not move, the mark must stay
    const grown = resizeRect(g, { south: -0.02, west: -0.02, north: 0.04, east: 0.04 });
    expect(grown.anchor).toEqual(anchor);
    expect(grown.lat_step).toBe(step);
    expect(grown.statuses[cellKey(...cells[0])]).toBe('cleared');
  });

  it('drops marks that fall outside the shrunken area', () => {
    const g = createGrid(rect(0, 0, 0.04, 0.04), 1000);
    const cells = cellsInAoi(g);
    const far = cells[cells.length - 1]; // a north-east cell
    g.statuses[cellKey(...far)] = 'flagged';
    const shrunk = resizeRect(g, { south: 0, west: 0, north: 0.01, east: 0.01 });
    expect(shrunk.statuses[cellKey(...far)]).toBeUndefined();
  });
});

describe('pruneStatuses', () => {
  it('removes keys with no cell in the area', () => {
    const g = createGrid(rect(0, 0, 0.02, 0.02), 1000);
    g.statuses['999:999'] = 'cleared';
    expect(pruneStatuses(g)['999:999']).toBeUndefined();
  });
});

describe('resizePolygon', () => {
  it('keeps the lattice fixed and preserves surviving marks', () => {
    const aoi = { type: 'polygon', vertices: [[0, 0], [0, 0.03], [0.03, 0.03], [0.03, 0]] };
    const g = createGrid(aoi, 1000);
    const anchor = { ...g.anchor };
    const cells = cellsInAoi(g);
    g.statuses[cellKey(...cells[0])] = 'cleared';
    // nudge one vertex outward: anchor/step stay, the SW-corner mark survives
    const grown = resizePolygon(g, [[0, 0], [0, 0.04], [0.04, 0.04], [0.04, 0]]);
    expect(grown.anchor).toEqual(anchor);
    expect(grown.aoi.type).toBe('polygon');
    expect(grown.statuses[cellKey(...cells[0])]).toBe('cleared');
  });
});
