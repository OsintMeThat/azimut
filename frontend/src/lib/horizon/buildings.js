/**
 * Buildings round Horizon's eye: the words and numbers the view says about them.
 *
 * What the app answers about an area (api/horizon_buildings.py) is turned here
 * into what the Layers row says, honest about where each height comes from, and
 * the analyst's image alignment into what the renderer moves.
 */

/** The sources, in the order the app's rule ranks them (engine/buildings/merge.py). */
export const SOURCES = [
  { id: 'ign', label: 'IGN (France)', title: 'BD TOPO®: footprints and heights the IGN measured, France only' },
  { id: 'osm', label: 'OpenStreetMap', title: 'Footprints mapped by hand, and the heights mappers gave' },
  { id: 'globfp', label: '3D-GloBFP', title: 'Worldwide footprints with a height a model estimated, as of about 2020' },
];

/** Radii offered, metres. */
export const RADII = [1000, 2000, 5000, 10000];

export const DEFAULTS = Object.freeze({
  on: false,
  radius: 2000,
  sources: Object.freeze({ ign: true, osm: true, globfp: true }),
  unknown: 'draw',
  roofs: 'tint',
  look: 'solid',
  showKinds: true,
  // metres east and north the image is moved to meet the footprints, and roofs' lean per metre of height
  shift: Object.freeze([0, 0]),
  lean: Object.freeze([0, 0]),
});

/** Settings read back from storage, anything missing or out of range taken from the defaults. */
export function readSettings(raw) {
  let saved = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    saved = {};
  }
  if (!saved || typeof saved !== 'object') saved = {};
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const pair = (value) =>
    Array.isArray(value) && value.length === 2 && value.every((v) => Number.isFinite(v) && Math.abs(v) <= 50)
      ? [value[0], value[1]]
      : [0, 0];
  const sources = {};
  for (const { id } of SOURCES) sources[id] = typeof saved.sources?.[id] === 'boolean' ? saved.sources[id] : DEFAULTS.sources[id];
  return {
    on: saved.on === true,
    radius: pick(saved.radius, RADII, DEFAULTS.radius),
    sources,
    unknown: pick(saved.unknown, ['draw', 'hide'], DEFAULTS.unknown),
    roofs: pick(saved.roofs, ['tint', 'photo'], DEFAULTS.roofs),
    look: pick(saved.look, ['solid', 'outline'], DEFAULTS.look),
    showKinds: typeof saved.showKinds === 'boolean' ? saved.showKinds : DEFAULTS.showKinds,
    shift: pair(saved.shift),
    lean: pair(saved.lean),
  };
}

/** The sources switched on, as the app's `sources` parameter. */
export function sourcesParam(sources) {
  return SOURCES.filter(({ id }) => sources[id]).map(({ id }) => id).join(',');
}

/**
 * What the renderer moves for an image alignment at latitude `lat`: the ground
 * and its picture by `shift` (metres east, north), and where a roof's photo is
 * looked up, in Mercator metres east and south: back by the shift, out by the
 * lean for each metre of height (a roof the satellite saw leaning east is east
 * of its footprint in the picture).
 */
export function alignment({ shift, lean }, lat) {
  const k = 1 / Math.cos((lat * Math.PI) / 180);
  return {
    groundShift: [shift[0], shift[1]],
    imageShift: [-shift[0] * k, shift[1] * k],
    imageLean: [lean[0] * k, -lean[1] * k],
  };
}

/** Whether an alignment moves anything. */
export const aligned = ({ shift, lean }) => [...shift, ...lean].some((v) => v !== 0);

const share = (n, total) => `${Math.round((100 * n) / total)}%`;

/**
 * One line on what the area holds: how many buildings, and where their heights
 * come from. Nothing is rounded into a claim: a share under one percent shows as
 * "<1%", and unknown heights are always named when there are any.
 */
export function summary(status) {
  const counts = status?.counts;
  if (!counts) return '';
  const total = counts.measured + counts.estimated + counts.range + counts.unknown;
  if (!total) return status.pending ? '' : 'No buildings known here';
  const part = (n, word) => {
    if (!n) return null;
    const pct = (100 * n) / total;
    // never 0% or 100% for a share that is neither
    const said = pct < 1 ? '<1%' : pct > 99 && n < total ? '>99%' : share(n, total);
    return `${said} ${word}`;
  };
  const heights = [
    part(counts.measured, 'measured'),
    part(counts.estimated, 'estimated'),
    part(counts.range, 'a range of storeys'),
    part(counts.unknown, 'unknown'),
  ].filter(Boolean);
  return `${total.toLocaleString('en')} buildings · heights ${heights.join(', ')}`;
}

/** The sources drawn, with their licence and how old their data is: `BD TOPO® (IGN), Licence Ouverte 2.0, 2010–2026`. */
export function credits(status) {
  return (status?.sources ?? []).map((s) => {
    const years = [s.oldest, s.newest].map((d) => (d ? d.slice(0, 4) : '')).filter(Boolean);
    const span = years.length === 2 && years[0] !== years[1] ? `${years[0]}–${years[1]}` : (years[0] ?? '');
    return { id: s.id, text: [s.label, s.licence, span].filter(Boolean).join(', '), link: s.link };
  });
}

/** Bytes as a person reads them: 38 MB, 1.9 GB. */
export function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

/** The grids the analyst is asked about: those the app needs and they have not declined. */
export function question(status, declined) {
  const grids = (status?.needs ?? []).filter((need) => !declined.has(need.grid));
  if (!grids.length) return null;
  const size = grids.reduce((sum, need) => sum + need.size, 0);
  return {
    grids: grids.map((need) => need.grid),
    size,
    text: `Estimated heights here come from 3D-GloBFP: ${formatSize(size)} to download once, kept on this machine.`,
  };
}

/** What is downloading, as one line: `3D-GloBFP 12 of 38 MB`. */
export function downloading(status) {
  const live = (status?.downloads ?? []).filter((d) => !d.error);
  if (!live.length) return '';
  const done = live.reduce((sum, d) => sum + d.done, 0);
  const total = live.reduce((sum, d) => sum + d.total, 0);
  return `3D-GloBFP ${formatSize(done)} of ${formatSize(total)}`;
}

/** What could not be read, one sentence each. */
export function problems(status) {
  return [
    ...(status?.failed ?? []).map((f) => f.reason),
    ...(status?.downloads ?? []).filter((d) => d.error).map((d) => d.error),
  ];
}

/** The ready tiles whose content the view does not hold yet: `[{ key, version }]`. */
export function tilesToFetch(status, held) {
  return (status?.tiles ?? []).filter((t) => t.ready && held.get(t.key)?.version !== t.version);
}

/** `14/8411/5844` as its numbers. */
export function keyNumbers(key) {
  const [z, x, y] = key.split('/').map(Number);
  return { z, x, y };
}

/** A batch of tiles from `/api/horizon/buildings/tiles`: key → bytes (null for one not ready). */
export function splitBatch(buffer, keys) {
  const view = new DataView(buffer);
  const out = new Map();
  let at = 0;
  for (const key of keys) {
    const length = view.getUint32(at, true);
    at += 4;
    out.set(key, length ? buffer.slice(at, at + length) : null);
    at += length;
  }
  return out;
}

/** What one building under the pointer is, in words: `18.6 m, measured · BD TOPO® (IGN), 2022-08-10`. */
export function describeBuilding(found, labels = {}) {
  if (!found) return '';
  const name = (id) => labels[id] ?? SOURCES.find((s) => s.id === id)?.label ?? id;
  const height = found.height == null ? 'Height unknown' : `${found.height.toFixed(1)} m, ${found.kind === 'range' ? 'a range of storeys' : found.kind}`;
  const from = found.height_source || found.source;
  const when = found.height_date || (from === found.source ? found.date : '');
  const heightFrom = found.height == null ? '' : ` · height from ${name(from)}${when ? ` (${when})` : ''}`;
  const footprint = `footprint from ${name(found.source)}${found.date ? ` (${found.date})` : ''}`;
  return `${height}${heightFrom} · ${footprint}`;
}
