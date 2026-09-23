export function pinDefaults(candidate, single) {
  return {
    title: `${candidate.phenomenon} · ${candidate.coordinates[1].toFixed(4)}, ${candidate.coordinates[0].toFixed(4)}`.slice(0, 120),
    description: '', after_only: single, shape: candidate.geometry?.type === 'Point' || single ? 'point' : 'area',
  };
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
