/**
 * The canvas hides the same parts of each stitched piece as the saved picture.
 *
 * `tests/fixtures/collage-seams.json` names the piece each point shows, worked out one
 * point at a time by `tests/seamscene.py`; `tests/test_collage_seams.py` composes the
 * same collages and reads the colours back.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { quadCentroid, quadUnitAt } from './inspect.js';
import { footprint, isStitched, seamCells, seamClipPath, seamHoles } from './seams.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../../tests/fixtures/collage-seams.json'), 'utf8'));
const scenes = Object.entries(fixture);
// as the canvas holds them: every piece on screen
const shownNodes = (scene) => scene.pieces.map((p) => ({ ...p, url: `blob:${p.id}` }));

function inside(poly, [x, y]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The piece the canvas shows at a point: the top one holding its picture there, outside its holes. */
function shownAt(nodes, holes, at) {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    // a warped picture holds its pixels within its warp's outline, stitched or warped since by hand
    const warped = (node.save?.ops ?? []).some((o) => o.op === 'remap');
    const own = warped ? footprint(node) : node.quad;
    if (inside(own, at) && !holes[i].some((hole) => inside(hole, at))) return node.id;
  }
  return null;
}

/** The holes a clip-path draws, read back into polygons in the piece's own pixels. */
function clipHoles(path) {
  const d = path.match(/"(.*)"/)[1];
  const parts = d.split('Z').filter(Boolean).slice(1);
  return parts.map((part) => part.slice(1).split('L').map((pair) => pair.split(' ').map(Number)));
}

describe('a stitched collage, as the saved picture shows it', () => {
  it.each(scenes)('%s: every stitched piece owns the cell the server gives it', (name, scene) => {
    const stitched = scene.pieces.filter(isStitched);
    const cells = seamCells(stitched.map((p) => quadCentroid(p.quad)), [0, 0, ...scene.canvas]);
    stitched.forEach((piece, k) => {
      const want = scene.cells[piece.id];
      expect(cells[k]).toHaveLength(want.length);
      cells[k].forEach(([x, y], i) => {
        expect(x).toBeCloseTo(want[i][0], 4);
        expect(y).toBeCloseTo(want[i][1], 4);
      });
    });
  });

  it.each(scenes)('%s: each point shows the piece the rule names', (name, scene) => {
    const nodes = shownNodes(scene);
    const holes = seamHoles(nodes);
    for (const point of scene.points) expect([point.at, shownAt(nodes, holes, point.at)]).toEqual([point.at, point.shows]);
  });

  it.each(scenes)('%s: the clip each piece is drawn with hides exactly its holes', (name, scene) => {
    const nodes = shownNodes(scene);
    const holes = seamHoles(nodes);
    nodes.forEach((node, i) => {
      const path = seamClipPath(node, holes[i]);
      if (!holes[i].length) {
        expect(path).toBeNull();
        return;
      }
      expect(path).toMatch(/^path\(evenodd, "M/);
      const local = clipHoles(path);
      for (const point of scene.points) {
        const [u, v] = quadUnitAt(node.quad, point.at);
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const hidden = local.some((hole) => inside(hole, [u * node.w, v * node.h]));
        expect(hidden).toBe(holes[i].some((hole) => inside(hole, point.at)));
      }
    });
  });

  it('holds every case: a seam moved, a picture laid by hand above and below, an empty corner', () => {
    const pan = fixture.pan.points;
    expect(pan.some((p) => p.stacked === 'b' && p.shows === 'a')).toBe(true);
    expect(pan.some((p) => p.stacked === 'c' && p.shows === 'h')).toBe(true);
    expect(fixture.corner.points.some((p) => p.corner && p.shows === 'f')).toBe(true);
    expect(fixture.warped.points.some((p) => p.shows === 'r')).toBe(true);
    expect(fixture.warped.points.some((p) => p.stacked === 'q' && p.shows === 'p')).toBe(true);
  });
});

describe('isStitched', () => {
  const ops = fixture.pan.pieces[0].save.ops;
  const node = (quad) => ({ save: { ops }, quad });

  it('keeps a stitched piece moved or scaled, still the rectangle the stitch laid', () => {
    expect(isStitched(node([[400, 5], [700, 5], [700, 185], [400, 185]]))).toBe(true);
    expect(isStitched(node([[10, 20], [110, 20.05], [110, 80], [10, 80]]))).toBe(true);
  });

  it('lays by hand a stitched piece whose corner was pulled, or that was turned', () => {
    expect(isStitched(node([[10, 20], [130, 34], [110, 80], [10, 80]]))).toBe(false);
    expect(isStitched(node([[60, 0], [110, 50], [60, 100], [10, 50]]))).toBe(false);
  });
});

describe('seamHoles', () => {
  const remap = { op: 'remap', params: fixture.pan.pieces[0].save.ops[0].params };
  const piece = (id, x, ops = [remap]) => ({
    id, url: `blob:${id}`, w: 100, h: 60, save: { path: `media/${id}.png`, time: null, ops },
    quad: [[x, 0], [x + 100, 0], [x + 100, 60], [x, 60]],
  });

  it('hides nothing while fewer than two pieces are stitched', () => {
    expect(seamHoles([piece('a', 0), piece('b', 50, [])])).toEqual([[], []]);
  });

  it('leaves a planar stitch, which keeps its pixels, in stack order', () => {
    const planar = [piece('a', 0, []), piece('b', 50, [])];
    expect(seamHoles(planar).flat()).toEqual([]);
  });

  it('hides nothing on account of an owner not on screen yet', () => {
    const loading = { ...piece('a', 0), url: null };
    expect(seamHoles([loading, piece('b', 50)])).toEqual([[], []]);
    const lost = { ...piece('a', 0), missing: true };
    expect(seamHoles([lost, piece('b', 50)])).toEqual([[], []]);
  });

  it('cuts the upper piece where the lower one owns the cell, never the lower one', () => {
    const [below, above] = seamHoles([piece('a', 0), piece('b', 50)]);
    expect(below).toEqual([]);
    expect(above).toHaveLength(1);
    // the seam halfway between the middles, at x = 75
    expect(Math.max(...above[0].map(([x]) => x))).toBeCloseTo(75, 6);
  });

  it('gives two pieces at one place to the one drawn later', () => {
    expect(seamHoles([piece('a', 0), piece('b', 0)])).toEqual([[], []]);
  });

  it('cannot read a warp a turn follows, and hides nothing for it', () => {
    const turned = piece('a', 0, [remap, { op: 'rotate', params: { deg: 90 } }]);
    expect(footprint(turned)).toBeNull();
    expect(seamHoles([turned, piece('b', 50)])).toEqual([[], []]);
  });
});
