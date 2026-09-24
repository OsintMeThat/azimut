import { orientedExtent } from '../measure.js';

export function pinDefaults(candidate, single) {
  return {
    title: `${candidate.phenomenon} · ${candidate.coordinates[1].toFixed(4)}, ${candidate.coordinates[0].toFixed(4)}`.slice(0, 120),
    description: '', after_only: single, shape: candidate.geometry?.type === 'Point' || single ? 'point' : 'area',
  };
}

/**
 * How big a candidate is: the long and short sides of its footprint, in metres,
 * turned to fit it. A ship on the diagonal is measured along its hull, where the
 * box squared to north would call it wider than it is long. A result older than
 * footprints is measured on its box; a manual point has nothing to measure.
 */
export function candidateSize(candidate) {
  const [west, south, east, north] = candidate?.bbox ?? [];
  const shape = candidate?.geometry ?? (candidate?.bbox
    ? { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north]]] }
    : null);
  if (!shape || shape.type === 'Point') return null;
  const polygons = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates;
  return orientedExtent(polygons.flatMap((polygon) => polygon[0] ?? []).map(([lon, lat]) => ({ lat, lon })));
}

/**
 * The review queue in the order asked. The run already lists it strongest
 * first; largest first goes by length, so the big hulls come up before the
 * skiffs, and a manual point, which has no outline, by its one pixel. Equal
 * sizes keep the run's order.
 */
export function orderCandidates(rows, order = 'strength') {
  if (order !== 'size') return rows;
  const key = (row) => candidateSize(row)?.length ?? Math.sqrt(row.area || 0);
  return rows.map((row) => [key(row), row]).sort((a, b) => b[0] - a[0]).map(([, row]) => row);
}

/**
 * The two passes a candidate was read between: its own, else its area's, else
 * the run's. A detector that reads one pass has the same picture twice.
 */
export function candidatePair(candidate, run) {
  const ready = (pair) => pair.status === 'ready';
  const area = run?.area_runs?.find((pair) => ready(pair) && pair.area_id === candidate?.area_id)
    ?? run?.area_runs?.find(ready);
  return {
    a: candidate?.sources?.a ?? area?.a ?? run?.input?.a ?? null,
    b: candidate?.sources?.b ?? area?.b ?? run?.input?.b ?? null,
  };
}

/** Where a blink is worth having: two dated passes of one Copernicus archive, not one pass twice. */
export function blinkable(pair) {
  const { a, b } = pair ?? {};
  if (!a?.date || !b?.date || a.provider !== b.provider) return false;
  if (b.provider !== 'sentinel2' && b.provider !== 'sentinel1') return false;
  return a.date !== b.date || (a.time ?? '') !== (b.time ?? '');
}

export function candidatePaths(geometry, project) {
  if (!geometry || geometry.type === 'Point') return '';
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => polygon.map((ring) => ring.map((point, i) => {
    const p = project(point); return `${i ? 'L' : 'M'}${p.x},${p.y}`;
  }).join(' ') + 'Z')).join(' ');
}

/** The high-resolution picture a lone detection is held up against. */
export const HIGH_RESOLUTION = 'esri-world-imagery';

/**
 * The pair Compare opens a candidate on, framed close on it.
 *
 * At 10 m a candidate is a cue rather than a verdict, so the question Compare
 * answers depends on what was found. A change is read on the two passes that
 * found it, so the analyst can swipe, blink or run Difference over them. A thing
 * present on one pass, a hull or a fire, is held against today's high-resolution
 * picture: a platform, a rock or a flare stack is still there, a ship is not.
 * Nothing is fetched to decide it: the candidate already names its passes.
 */
export function comparePairFor(candidate, { single = false, method = '' } = {}) {
  const [lon, lat] = candidate.coordinates;
  const { a, b } = candidate.sources ?? {};
  if (!b?.date) return null;
  const side = (source, layer) => (source.provider === 'sentinel1'
    ? { provider: 'sentinel1', radar: { date: source.date, time: source.time ?? '' }, present: true }
    : { provider: 'sentinel2', sentinel: { date: source.date, layer, maxcc: 100 }, present: true });
  // A fire reads in short-wave infrared, which is where the detector saw it.
  const layer = method === 'hotspots' ? 'SWIR' : 'TRUE_COLOR';
  const lone = single || !a?.date || (a.date === b.date && a.time === b.time);
  return {
    lat,
    lon,
    zoom: 16,
    title: `${candidate.phenomenon} · ${b.date}`.slice(0, 120),
    a: lone ? { provider: HIGH_RESOLUTION, present: true } : side(a, layer),
    b: side(b, layer),
    dates: lone ? ['', b.date] : [a.date, b.date],
  };
}
