/** Geographic analyzer inputs have no dependency on a screen or camera. */
import { describeReading, isRules, readsRadar } from './analyzerRules.js';

export const clone = (value) => JSON.parse(JSON.stringify(value));

export function zoneMarks(zones) {
  return zones.map((zone) => ({ ...zone, side: 'both', colour: '#38bdf8',
    stroke_width: 2, fill_opacity: 0.08, font_size: 12, text: zone.name }));
}

export function marksToZones(marks, previous = []) {
  return marks.filter((mark) => ['rect', 'polygon', 'ellipse'].includes(mark.kind)).map((mark, i) => ({
    id: mark.id, name: previous.find((zone) => zone.id === mark.id)?.name || `Area ${i + 1}`,
    kind: mark.kind, points: clone(mark.points),
  }));
}

/** Display clustering changes only marker layout; persisted candidates stay intact. */
export function displayGroups(rows, project, radius = 24) {
  const groups = [];
  for (const row of rows) {
    const at = project(row.coordinates);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
    const near = groups.find((group) => Math.hypot(group.x - at.x, group.y - at.y) < radius);
    if (near) near.rows.push(row);
    else groups.push({ ...at, rows: [row] });
  }
  return groups;
}

/** A source as a date; runs saved before Detect went Copernicus-only name their release. */
export function sourceLabel(source) {
  if (source.provider === 'esri-wayback') return `Wayback release ${source.release}`;
  if (source.provider === 'sentinel1' && source.date && source.time) {
    return `${source.date} ${source.time.slice(0, 5)} UTC`;
  }
  return source.date || 'no date yet';
}

/**
 * A candidate's reading in words. The catalogue words each method's reading
 * (`METHODS[].measure`), so this only fills the blanks and never needs to know
 * which method it is looking at.
 */
export function describeMeasure(template, measure, index = '') {
  if (!template || !measure) return '';
  const signed = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value))}`;
  const blanks = {
    value: () => Number(measure.value).toFixed(1),
    signed: () => signed(measure.signed),
    before: () => Number(measure.before).toFixed(2),
    after: () => Number(measure.after).toFixed(2),
    index: () => index.toUpperCase(),
  };
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_, name) => {
    const value = name === 'index' ? index : measure[name];
    if (!blanks[name] || value === undefined || value === null) { missing = true; return ''; }
    return blanks[name]();
  });
  return missing ? '' : text;
}

/**
 * A candidate's reading in words, whatever made it: a built-in's catalogue
 * template, or the first measured rule of an analyzer of your own.
 */
export function readingOf(recipe, methods, measure) {
  if (isRules(recipe)) return describeReading(recipe, measure);
  const method = (methods ?? []).find((entry) => entry.id === recipe?.method);
  return describeMeasure(method?.measure, measure, recipe?.parameters?.index);
}

export const STRENGTHS = { weak: 'Weak', clear: 'Clear', strong: 'Strong' };

/** Which of Small, Medium and Large the parameters are, or '' once tuned by hand. */
export function sizeOf(parameters, sizes) {
  for (const [name, values] of Object.entries(sizes ?? {})) {
    if (Object.entries(values).every(([key, value]) => Number(parameters?.[key]) === value)) return name;
  }
  return '';
}

/**
 * What a size preset actually accepts, in ground terms.
 *
 * The buttons read as "how sensitive", which is not what they set: they set the
 * floor and ceiling on a candidate's area. A mark that falls outside the band is
 * dropped after being found, so the band is worth stating rather than implying.
 */
export function sizeBand(values) {
  const min = Number(values?.min_area) || 0;
  const max = Number(values?.max_area) || 0;
  const across = (area) => `${Math.round(Math.sqrt(area))} m`;
  const area = (value) => (value >= 10_000 ? `${Math.round(value / 10_000)} ha` : `${Math.round(value)} m²`);
  if (!min && !max) return 'Any size: nothing is dropped for being too big or too small.';
  if (!min) return `Up to ${area(max)}, about ${across(max)} across.`;
  if (!max) return `From ${area(min)} up, about ${across(min)} across.`;
  return `${area(min)} to ${area(max)}, about ${across(min)} to ${across(max)} across.`;
}

/** A zone's outline, the way the engine reads it: `Zone.ring()` in JavaScript. */
export function zoneRing(zone) {
  if (zone.kind === 'polygon') return zone.points;
  const [[x1, y1], [x2, y2]] = zone.points;
  if (zone.kind === 'rect') return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const [cx, cy, rx, ry] = [(x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2];
  return Array.from({ length: 64 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 64;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });
}

const mercator = (lon, lat) => [
  (lon + 180) / 360,
  (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2,
];

/**
 * What a run will cost, before anything is fetched: ground area, and how many
 * native tiles the areas touch. The tile count enumerates each zone's bounding
 * box, where the engine masks the outline, so a diagonal polygon is counted
 * high rather than low — a pre-flight number should never promise less work
 * than the run does. The grid comes from the catalogue, so this cannot drift
 * away from the engine's own levels.
 */
export function coverage(zones, grid) {
  let metres = 0;
  const tiles = new Set();
  for (const zone of zones) {
    const ring = zoneRing(zone);
    if (ring.length < 3) continue;
    // Shoelace on a local equirectangular plane: metres per degree of longitude
    // shrink with latitude, and over one area that factor is near enough flat.
    const mid = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    const scale = Math.cos((mid * Math.PI) / 180) * 111_320;
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      sum += x1 * scale * (y2 * 111_320) - x2 * scale * (y1 * 111_320);
    }
    metres += Math.abs(sum) / 2;
    if (!grid) continue;
    const [zoom, size] = grid;
    const count = 2 ** zoom;
    const xs = ring.map(([lon, lat]) => mercator(lon, lat)[0]);
    const ys = ring.map(([lon, lat]) => mercator(lon, lat)[1]);
    const left = Math.floor(Math.min(...xs) * count);
    const right = Math.ceil(Math.max(...xs) * count) - 1;
    const top = Math.floor(Math.min(...ys) * count);
    const bottom = Math.ceil(Math.max(...ys) * count) - 1;
    if ((right - left + 1) * (bottom - top + 1) > 1e6) return { km2: Infinity, tiles: Infinity, size };
    for (let y = Math.max(0, top); y <= Math.min(count - 1, bottom); y++) {
      for (let x = Math.max(0, left); x <= Math.min(count - 1, right); x++) tiles.add(`${x}/${y}`);
    }
  }
  return { km2: metres / 1e6, tiles: grid ? tiles.size : 0, size: grid?.[1] ?? 0 };
}

/**
 * What a sweep costs in provider requests and in waiting.
 *
 * One frame is one request, and the request is what the run spends its time
 * on — the detection itself is a few milliseconds a tile. The rate below is a
 * round number for a network round trip, so the answer is an order of
 * magnitude, and the panel says "about". Nobody should discover that an area
 * meant forty minutes by starting it.
 */
export const SECONDS_PER_FRAME = 0.35;

/** Frames fetched per tile: for each date, the picture reviewed and the bands measured.
 *  The catalogue states its own figure per method (`frames`), which wins. */
export function framesPerTile({ single = false } = {}) {
  return single ? 2 : 4;
}

export function readableDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'a long time';
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/**
 * The rectangle the camera is looking at, as a zone. Ids match the annotation
 * marks the drawing canvas makes, because a zone and its mark are the same
 * object seen from the panel and from the map.
 */
export function viewZone(bounds, name = 'Current view') {
  const { west, south, east, north } = bounds;
  return {
    id: crypto.randomUUID(),
    name,
    kind: 'rect',
    points: [[west, north], [east, south]],
  };
}

/**
 * The built-ins as the catalogue groups them, by what an analyst looks for,
 * and the analyst's own after them. A built-in no group names still shows,
 * under Other, so a catalogue ahead of this list never hides one.
 */
export function analyzerGroups(catalogue) {
  const builtins = catalogue?.builtins ?? [];
  const groups = catalogue?.groups?.length
    ? catalogue.groups.map((group) => ({
        label: group.label,
        list: group.recipes.map((id) => builtins.find((entry) => entry.id === id)).filter(Boolean),
      }))
    : [{ label: 'Built in', list: builtins }];
  const grouped = new Set(groups.flatMap((group) => group.list.map((entry) => entry.id)));
  const rest = builtins.filter((entry) => !grouped.has(entry.id));
  if (rest.length) groups.push({ label: 'Other', list: rest });
  if (catalogue?.custom?.length) groups.push({ label: 'Mine', list: catalogue.custom });
  return groups.filter((group) => group.list.length);
}

/**
 * Why an analyzer cannot run yet, or '' when it can: every one without a
 * Copernicus key, the radar ones until Settings has found their layer.
 */
export function analyzerLock(entry, catalogue) {
  if (!entry || !catalogue) return '';
  if (catalogue.copernicus_key === false) return 'Needs a free Copernicus key';
  const method = catalogue.methods?.find((candidate) => candidate.id === entry.method);
  const radar = isRules(entry) ? readsRadar(entry) : method?.sensor === 'sentinel1';
  if (radar && !catalogue.radar_layer) return 'Needs the Sentinel-1 layer';
  return '';
}
