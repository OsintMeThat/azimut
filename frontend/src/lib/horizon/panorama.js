/**
 * A panorama as the app sends it (`/api/horizon/panorama`), opened up for the
 * Horizon tab.
 *
 * The rasters cover the whole turn over azimuth, or a window of it, and a band
 * of elevation, one cell per step: the distance to the ground the eye meets
 * there (sky where it meets none) and the ground's slope, as the east and north
 * parts of its unit normal. They arrive deflated in base64 and are inflated
 * here by the browser's own DecompressionStream, so nothing ships a
 * decompressor. Distances come as 16-bit codes on a log scale (api/horizon.py)
 * and are opened back into metres.
 *
 * Reading a cell back is plain arithmetic on the grid, kept here so the view,
 * the labels and the click all read the same pixel.
 */

/** What the depth raster holds where the eye meets no ground. */
export const SKY = -1;

/** Bytes the app sent deflated in base64. */
export async function inflate(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Metres from the app's 16-bit log codes; code 0 is sky, which becomes `SKY`. */
export function openDepth(bytes, scale) {
  const codes = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const depth = new Float32Array(codes.length);
  const ratio = Math.log(scale.max / scale.min) / scale.codes;
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    depth[i] = code === 0 ? SKY : scale.min * Math.exp((code - 1) * ratio);
  }
  return depth;
}

/**
 * The skyline at each reach the app kept it at (`skyline_cuts`): one row of
 * float32 angles per reach, NaN where no ground stands. `[{ reach, skyline }]`,
 * nearest first; none when the app sent none.
 */
export function openCuts(bytes, reaches, count) {
  if (!bytes?.byteLength || !reaches?.length || !(count > 0)) return [];
  const rows = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (rows.length < reaches.length * count) return [];
  return reaches.map((reach, i) => ({ reach, skyline: rows.subarray(i * count, (i + 1) * count) }));
}

/**
 * The panorama's skyline within a reach: the cut it keeps there (`cuts`, the
 * skyline haze would leave), or the whole turn's for none, or for a reach this
 * panorama does not keep (one past its far limit is the whole turn anyway).
 */
export function skylineWithin(panorama, reach = null) {
  if (!Number.isFinite(reach)) return panorama?.skyline ?? null;
  return panorama?.cuts?.find((cut) => cut.reach === reach)?.skyline ?? panorama?.skyline ?? null;
}

/**
 * The answer, with its rasters as typed arrays. Sky becomes `SKY`, which a
 * shader can test for where NaN would be lost on the way to the GPU.
 */
export async function decodePanorama(answer) {
  const cuts = answer.skyline_cuts;
  const [depthBytes, eastBytes, northBytes, cutBytes] = await Promise.all([
    inflate(answer.depth),
    inflate(answer.normal_east),
    inflate(answer.normal_north),
    cuts?.skylines ? inflate(cuts.skylines) : null,
  ]);
  const depth = openDepth(depthBytes, answer.depth_scale);
  return {
    observer: answer.observer,
    far: answer.far,
    near: answer.near ?? 0,
    refraction: answer.refraction,
    azimuth: answer.azimuth,
    elevation: answer.elevation,
    skyline: answer.skyline,
    skylineDistance: answer.skyline_distance,
    cuts: openCuts(cutBytes, cuts?.reach, answer.azimuth.count),
    depth,
    east: new Int8Array(eastBytes.buffer, eastBytes.byteOffset, eastBytes.byteLength),
    north: new Int8Array(northBytes.buffer, northBytes.byteOffset, northBytes.byteLength),
    resolution: answer.resolution_m,
    credits: answer.credits ?? [],
  };
}

/** 0–360, whatever was added up. */
export function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

/** The raster column at an azimuth, or -1 outside a window of the turn. */
export function columnAt(panorama, azimuth) {
  const { azimuth: az } = panorama;
  const column = Math.round(wrap360(azimuth - az.start) / az.step);
  if (az.full === false) return column < az.count ? column : -1;
  return column % az.count;
}

/** The raster cell at an azimuth and elevation, or -1 off the picture. */
export function cellAt(panorama, azimuth, elevation) {
  const { azimuth: az, elevation: el } = panorama;
  const row = Math.round((el.top - elevation) / el.step);
  if (row < 0 || row >= el.count) return -1;
  const column = columnAt(panorama, azimuth);
  return column < 0 ? -1 : row * az.count + column;
}

/** The ground's distance in metres at an azimuth and elevation, or null for sky. */
export function depthAt(panorama, azimuth, elevation) {
  const cell = cellAt(panorama, azimuth, elevation);
  if (cell < 0) return null;
  const value = panorama.depth[cell];
  return value === SKY ? null : value;
}

/** The skyline's elevation at an azimuth, in degrees, or null off a window. */
export function skylineAt(panorama, azimuth) {
  const column = columnAt(panorama, azimuth);
  return column < 0 ? null : panorama.skyline[column];
}

/**
 * Whether a summit stands in sight: just under its top the picture shows ground
 * about as far as the summit itself. A nearer ridge in front shows nearer ground
 * there; past the skyline there is nothing to show at all.
 *
 * `below` is how far under the top to look, in degrees: a round summit's very
 * top hides behind its own shoulder (engine/horizon.py), so the test reads a
 * hair lower than the label points.
 */
export function inSight(panorama, peak, { below = 0.12, tolerance = 0.08 } = {}) {
  const ground = depthAt(panorama, peak.azimuth, peak.angle - below);
  if (ground == null) return false;
  return ground >= peak.distance * (1 - tolerance) && ground <= peak.distance * (1 + tolerance) + 500;
}
