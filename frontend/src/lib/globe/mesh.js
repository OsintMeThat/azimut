/**
 * One tile of the globe's ground, as the GPU draws it.
 *
 * A tile is a cell of the Web Mercator grid, so the imagery maps onto it
 * straight, but its mesh is its own: `SEG` cells a side whatever the zoom, laid
 * on the sphere and lifted by heights read from whichever terrain tile holds
 * them (worker.js), so the triangles follow how near the ground is, not the grid
 * the terrain is published on. Deep tiles read a terrain tile several levels up;
 * shallow ones read it coarse.
 *
 * Positions are kept relative to the tile's own centre (`centre`, at full
 * precision): single floats then hold a millimetre near the eye, where the
 * whole Earth's coordinates would hold half a metre. Each vertex carries its
 * point on the sphere, the way up there and its height apart, so the shader can
 * exaggerate the relief without a new mesh.
 *
 * A skirt hangs from each edge, so a neighbour drawn a level coarser, whose
 * edge cuts the corners of this one's, never opens a crack to the sky.
 */
import { EARTH, RAD, ecef, localFrame } from './earth.js';
import { tileLat, tileLon } from '../horizon/mesh/geo.js';

/** Cells a side of every tile's mesh. */
export const SEG = 32;
/** Floats a vertex: point on the sphere (3), up (3), height (1), normal (3), picture coordinates (2). */
export const STRIDE = 12;
/** Vertices a tile's mesh holds: the grid, then the skirts. */
export const VERTICES = (SEG + 1) ** 2 + 4 * (SEG + 1);

/** The finest terrain the app's batches serve (engine/terrain.py PLANET_ZOOM). */
export const DEM_MAX = 12;
/** Terrain pixels a side of one of the app's terrain tiles. */
export const DEM_SIZE = 512;

/**
 * The terrain zoom a tile reads its heights from: about one terrain pixel per
 * cell of its mesh (a 512 px tile holds 32 cells of a tile four levels down),
 * never finer than the app serves.
 */
export const demZoomFor = (z) => Math.max(0, Math.min(DEM_MAX, z - 4));

/** Metres a cell of a zoom-z tile spans at latitude `lat`, east-west and north-south alike. */
export const cellMetres = (z, lat, seg = SEG) => (2 * Math.PI * EARTH * Math.cos(lat * RAD)) / (seg * 2 ** z);

/** The point of the grid a tile is centred on, on the sphere. */
export function tileCentre(z, x, y) {
  return ecef(tileLat(y + 0.5, z), tileLon(x + 0.5, z), 0);
}

/**
 * How far a tile's skirt hangs: enough to cover the step to a coarser neighbour,
 * which cuts across about one of its cells, on the steepest ground there is.
 */
export const skirtFor = (z, lat) => Math.min(4000, 20 + 1.5 * cellMetres(z, lat));

/** Indices a quarter of a tile takes: its cells and the skirts of its two outer edges. */
export const QUARTER = ((SEG / 2) ** 2 + 2 * (SEG / 2)) * 6;

/**
 * The triangles every tile shares, as indices into its vertices, a quarter of
 * the tile after another (north-west, north-east, south-west, south-east, the
 * order of a tile's children), each its cells then its outer edges joined to
 * their skirts. A tile standing in for children not yet held is drawn only
 * over theirs, a quarter at a time (`QUARTER` indices each).
 */
export function tileIndices(seg = SEG) {
  const side = seg + 1;
  const grid = side * side;
  const half = seg / 2;
  const out = new Uint16Array(seg * seg * 6 + 4 * seg * 6);
  let o = 0;
  // the edges in the order the skirts are written: north, south, west, east
  const edges = [(k) => k, (k) => seg * side + k, (k) => k * side, (k) => k * side + seg];
  const skirt = (e, k) => {
    const top0 = edges[e](k);
    const top1 = edges[e](k + 1);
    const low0 = grid + e * side + k;
    out.set([top0, low0, top1, top1, low0, low0 + 1], o);
    o += 6;
  };
  for (let q = 0; q < 4; q += 1) {
    const qx = q % 2;
    const qy = Math.floor(q / 2);
    for (let j = qy * half; j < (qy + 1) * half; j += 1) {
      for (let i = qx * half; i < (qx + 1) * half; i += 1) {
        const a = j * side + i;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        out.set([a, c, b, b, c, d], o);
        o += 6;
      }
    }
    for (let k = qx * half; k < (qx + 1) * half; k += 1) skirt(qy === 0 ? 0 : 1, k);
    for (let k = qy * half; k < (qy + 1) * half; k += 1) skirt(qx === 0 ? 2 : 3, k);
  }
  return out;
}

/**
 * A tile's mesh from `height(i, j)`, the ground at grid point (i, j) of the
 * tile, i east and j south, read a point beyond each edge too (−1 and seg+1)
 * for the slopes there.
 *
 * Returns the vertices (`STRIDE` floats each), the tile's `centre` (ECEF at
 * full precision), the grid's heights row by row from the north for reading
 * the ground back (`heights`), and the lowest and highest of them.
 */
export function buildTile(z, x, y, height, seg = SEG) {
  const side = seg + 1;
  const centre = tileCentre(z, x, y);
  const H = new Float64Array((seg + 3) * (seg + 3));
  const at = (i, j) => H[(j + 1) * (seg + 3) + i + 1];
  for (let j = -1; j <= seg + 1; j += 1) {
    for (let i = -1; i <= seg + 1; i += 1) H[(j + 1) * (seg + 3) + i + 1] = height(i, j);
  }
  const vertices = new Float32Array(((seg + 1) ** 2 + 4 * side) * STRIDE);
  const heights = new Float32Array(side * side);
  let low = Infinity;
  let high = -Infinity;
  const skirt = skirtFor(z, tileLat(y + 0.5, z));
  for (let j = 0; j <= seg; j += 1) {
    const lat = tileLat(y + j / seg, z);
    const spacing = Math.max(cellMetres(z, lat, seg), 1e-6);
    for (let i = 0; i <= seg; i += 1) {
      const lon = tileLon(x + i / seg, z);
      const h = at(i, j);
      heights[j * side + i] = h;
      if (h < low) low = h;
      if (h > high) high = h;
      const point = ecef(lat, lon, 0);
      const { up, east, north } = localFrame(point);
      // slopes east and north; the grid's rows run south
      const gE = (at(i + 1, j) - at(i - 1, j)) / (2 * spacing);
      const gN = (at(i, j - 1) - at(i, j + 1)) / (2 * spacing);
      const n = [up[0] - gE * east[0] - gN * north[0], up[1] - gE * east[1] - gN * north[1], up[2] - gE * east[2] - gN * north[2]];
      const nl = Math.hypot(n[0], n[1], n[2]);
      const o = (j * side + i) * STRIDE;
      vertices[o] = point[0] - centre[0];
      vertices[o + 1] = point[1] - centre[1];
      vertices[o + 2] = point[2] - centre[2];
      vertices[o + 3] = up[0];
      vertices[o + 4] = up[1];
      vertices[o + 5] = up[2];
      vertices[o + 6] = h;
      vertices[o + 7] = n[0] / nl;
      vertices[o + 8] = n[1] / nl;
      vertices[o + 9] = n[2] / nl;
      vertices[o + 10] = i / seg;
      vertices[o + 11] = j / seg;
    }
  }
  const grid = side * side;
  const edges = [(k) => k, (k) => seg * side + k, (k) => k * side, (k) => k * side + seg];
  for (let e = 0; e < 4; e += 1) {
    for (let k = 0; k <= seg; k += 1) {
      const from = edges[e](k) * STRIDE;
      const to = (grid + e * side + k) * STRIDE;
      vertices.copyWithin(to, from, from + STRIDE);
      vertices[to + 6] -= skirt;
    }
  }
  return { vertices, centre, heights, low, high };
}

/**
 * The height at grid point (i, j) of tile (z, x, y), bilinear, from one terrain
 * tile `dem` of zoom `zd` at column `dx`, row `dy` (DEM_SIZE² heights, row by
 * row from the north). A point past the terrain tile's edge is carried on from
 * the last two pixels inside, so the slopes at a terrain tile's seam stay close
 * to the ground's own.
 */
export function demSampler(dem, zd, dx, dy, z, x, y, seg = SEG) {
  const scaleUp = 2 ** (zd - z);
  const last = DEM_SIZE - 1;
  const px = (cx, cy) => dem[cy * DEM_SIZE + cx];
  const read = (fx, fy) => {
    const x0 = Math.min(Math.max(Math.floor(fx), 0), last - 1);
    const y0 = Math.min(Math.max(Math.floor(fy), 0), last - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = px(x0, y0) * (1 - tx) + px(x0 + 1, y0) * tx;
    const bottom = px(x0, y0 + 1) * (1 - tx) + px(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  return (i, j) => {
    const fx = ((x + i / seg) * scaleUp - dx) * DEM_SIZE - 0.5;
    const fy = ((y + j / seg) * scaleUp - dy) * DEM_SIZE - 0.5;
    return read(fx, fy);
  };
}
