/**
 * A map's block as text: its lines read, and its settings written back
 * (`engine/notes_maps.py` reads them). Each choice the settings card makes is one line,
 * written where the engine writes it (`MAP_ORDER`), the other lines left as they were,
 * so an old block keeps every line it had and only the line a choice touches changes.
 */

/** The keys a block reads, in the order the engine writes them (`block_text`, `settings_lines`). */
export const MAP_ORDER = [
  'title', 'plate', 'layer', 'proofs', 'ground', 'detail', 'view',
  'base', 'hide', 'colour', 'proof points', 'labels', 'crowds', 'north', 'scale', 'frame',
  'timeline', 'opens on', 'speed', 'card', 'size', 'legend', 'step',
];
/** The keys written once a line each, many to a block. */
export const MANY = new Set(['layer', 'detail', 'hide', 'colour', 'step']);
export const BASES = ['satellite', 'map', 'topographic', 'dark'];
export const CARD_PARTS = ['picture', 'sentence', 'source', 'verify'];
export const CROWDS = ['off', '8', '12', '20'];
export const SPEEDS = ['slow', 'normal', 'fast'];
export const SIZES = ['half', 'wide', 'full'];
export const LEGENDS = ['shown', 'folded', 'hidden'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ENTITY = /^[A-Za-z0-9_-]{1,64}$/;

/** A line's key and value, `null` for a line that is none (a comment, a blank). */
function lineOf(raw) {
  const line = String(raw ?? '').trim();
  if (!line || line.startsWith('<!--')) return null;
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const key = line.slice(0, colon).trim().replace(/\s+/g, ' ').toLowerCase();
  return { key: key === 'layers' ? 'layer' : key, value: line.slice(colon + 1).trim().replace(/\s+/g, ' ') };
}

/** `lat, lon, zoom` read, or null. */
export function viewOf(text) {
  const numbers = String(text ?? '').split(/[,;]/).map((part) => part.trim()).filter(Boolean).map(Number);
  if (numbers.length < 3 || numbers.length > 4 || numbers.some((number) => !Number.isFinite(number))) return null;
  const [lat, lon, zoom] = numbers;
  if (lat < -85 || lat > 85 || lon < -180 || lon > 180 || zoom < 0 || zoom > 22) return null;
  return [lat, lon, zoom];
}

/** `west, south, east, north` read, or null. */
export function frameOf(text) {
  const numbers = String(text ?? '').split(/[,;]/).map((part) => part.trim()).filter(Boolean).map(Number);
  if (numbers.length !== 4 || numbers.some((number) => !Number.isFinite(number))) return null;
  const [west, south, east, north] = numbers;
  if (!(west >= -180 && west < east && east <= 180 && south >= -85 && south < north && north <= 85)) return null;
  return numbers;
}

/** A step's line read: `day | label | lat, lon, zoom | proof | words`, any part empty. */
export function stepOf(text) {
  const parts = String(text ?? '').split('|');
  const head = parts.slice(0, 4).map((part) => part.trim());
  while (head.length < 4) head.push('');
  const words = parts.slice(4).join('|').trim();
  const [day, label, where, proof] = head;
  if (day && !DAY.test(day)) return null;
  if (proof && !ENTITY.test(proof)) return null;
  const view = where ? viewOf(where) : null;
  if (where && !view) return null;
  if (!day && !label && !view && !proof && !words) return null;
  return { day, label, view, proof, words };
}

const trim = (value, places) => String(Number(Number(value).toFixed(places)));

/** A step as its line writes it, its empty tail left off (`step_text`). */
export function stepText(step) {
  const where = step.view ? `${Number(step.view[0]).toFixed(5)}, ${Number(step.view[1]).toFixed(5)}, ${trim(step.view[2], 2)}` : '';
  const parts = [step.day ?? '', String(step.label ?? '').replace(/\s+/g, ' ').trim(), where, step.proof ?? '',
    String(step.words ?? '').replace(/\s+/g, ' ').trim()];
  while (parts.length && !parts.at(-1)) parts.pop();
  return parts.join(' | ');
}

/** A step's whole line value, as `step:` takes it (`step_line`). */
export function stepValue(step) {
  return stepText(step);
}

/** A frame as its line writes it. */
export function frameText(frame) {
  return frame.map((value) => Number(value).toFixed(5)).join(', ');
}

/** A layer's one colour, as its line writes it. */
export function colourText(name, colour) {
  return `${name} = ${String(colour).toLowerCase()}`;
}

/**
 * The block read whole: what it shows and how. A setting it does not hold is ''
 * (or empty), which is its default; `card` is null for a card that shows everything.
 */
export function readMap(source) {
  const read = {
    title: '', layers: [], plate: '', proofs: '', ground: '', details: [], view: null,
    base: '', hidden: [], colours: {}, proofPoints: '', labels: '', crowds: '', north: '', scale: '', frame: null,
    timeline: '', opensOn: '', speed: '', card: null, size: '', legend: '', steps: [],
  };
  for (const raw of String(source ?? '').split('\n')) {
    if (/^\s*:::/.test(raw)) continue;
    const found = lineOf(raw);
    if (!found) continue;
    const { key, value } = found;
    const word = value.toLowerCase();
    if (key === 'layer') { if (value && !read.layers.includes(value)) read.layers.push(value); }
    else if (key === 'detail') { if (value) read.details.push(value); }
    else if (key === 'hide') { if (value && !read.hidden.includes(value)) read.hidden.push(value); }
    else if (key === 'colour') {
      const at = value.lastIndexOf('=');
      const name = at > 0 ? value.slice(0, at).trim() : '';
      const colour = at > 0 ? value.slice(at + 1).trim().toLowerCase() : '';
      if (name && /^#[0-9a-f]{6}$/.test(colour) && !(name in read.colours)) read.colours[name] = colour;
    } else if (key === 'step') {
      const step = stepOf(value);
      if (step) read.steps.push(step);
    } else if (key === 'view') { read.view ??= viewOf(value); }
    else if (key === 'frame') { read.frame ??= frameOf(value); }
    else if (key === 'card') {
      if (read.card === null) {
        const parts = word.split(',').map((part) => part.trim()).filter(Boolean);
        read.card = parts[0] === 'none' ? [] : CARD_PARTS.filter((part) => parts.includes(part));
      }
    } else {
      const field = { 'proof points': 'proofPoints', 'opens on': 'opensOn' }[key] ?? key;
      if (field in read && typeof read[field] === 'string' && !read[field]) {
        read[field] = ['title', 'plate', 'proofs', 'ground', 'opensOn'].includes(field) ? value : word;
      }
    }
  }
  return read;
}

/**
 * The block with `changes` written: `{ key: value }`, '' taking a one-line setting out, and
 * for a key of many lines (`MANY`) an array of values replacing them all, [] taking them out.
 * A key already written keeps its place; a new one goes where the engine would write it.
 * Lines it does not touch, comments and lines it cannot read included, are kept as they were.
 */
export function withMapSettings(source, changes) {
  const lines = String(source ?? '').split('\n');
  const open = lines.findIndex((line) => /^\s*:::\s*map\s*$/.test(line));
  let close = lines.length - 1;
  while (close > open && !/^\s*:::\s*$/.test(lines[close])) close -= 1;
  if (open < 0 || close <= open) return source;
  const body = lines.slice(open + 1, close);
  const keyAt = (line) => lineOf(line)?.key ?? null;
  for (const [key, wanted] of Object.entries(changes)) {
    const values = MANY.has(key) ? (Array.isArray(wanted) ? wanted : [wanted]).filter((value) => value !== '' && value != null) : [];
    const one = MANY.has(key) ? null : String(wanted ?? '').trim();
    const written = MANY.has(key) ? values.map((value) => `${key}: ${String(value).trim()}`) : one ? [`${key}: ${one}`] : [];
    const first = body.findIndex((line) => keyAt(line) === key);
    if (first >= 0) {
      // the first line of the key keeps the place; the others of it go
      const kept = body.filter((line, index) => index === first || keyAt(line) !== key);
      const at = kept.findIndex((line) => keyAt(line) === key);
      kept.splice(at, 1, ...written);
      body.splice(0, body.length, ...kept);
      continue;
    }
    if (!written.length) continue;
    // where the engine writes it: before the first line of a key it writes later
    const rank = MAP_ORDER.indexOf(key);
    let at = body.findIndex((line) => {
      const other = keyAt(line);
      return other !== null && MAP_ORDER.indexOf(other) > rank;
    });
    if (at < 0) {
      at = body.length;
      while (at > 0 && !body[at - 1].trim()) at -= 1;
    }
    body.splice(at, 0, ...written);
  }
  return [...lines.slice(0, open + 1), ...body, ...lines.slice(close)].join('\n');
}

// -- the map's own square --------------------------------------------------------------------

export const mercX = (lon) => (lon + 180) / 360;
export function mercY(lat) {
  const sine = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
}
export const unmercX = (x) => x * 360 - 180;
export const unmercY = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** The width a map is drawn at, in its own units (`FRAME`), and its height for `bounds`. */
export const FRAME = 1600;
export function frameSize(bounds) {
  const [west, south, east, north] = bounds;
  const ratio = Math.max(mercY(south) - mercY(north), 1e-9) / Math.max(mercX(east) - mercX(west), 1e-9);
  return [FRAME, Math.round(FRAME * Math.max(0.2, Math.min(ratio, 3)) * 10) / 10];
}

/**
 * `[lat, lon, zoom]` showing `bounds` whole in a frame of 1200 by 750 (the map engine's
 * zoom, a 512-pixel world at 0), as the engine fits a step or a ground (`fit_view`).
 */
export function fitView(bounds, { width = 1200, height = 750, most = 18 } = {}) {
  const [west, south, east, north] = bounds;
  const x0 = mercX(west);
  const y0 = mercY(north);
  const spanX = Math.max(mercX(east) - x0, 1e-9);
  const spanY = Math.max(mercY(south) - y0, 1e-9);
  const zoom = Math.log2(Math.min(width / spanX, height / spanY) / 512);
  return [unmercY(y0 + spanY / 2), unmercX(x0 + spanX / 2), Math.max(1, Math.min(most, Math.round(zoom * 100) / 100))];
}

/** The `[west, south, east, north]` a view (`[lat, lon, zoom]`) shows in a frame of 1200 by 750. */
export function viewBounds(view, { width = 1200, height = 750 } = {}) {
  const [lat, lon, zoom] = view;
  const world = 512 * 2 ** zoom;
  const x = mercX(lon);
  const y = mercY(lat);
  return [unmercX(x - width / 2 / world), unmercY(y + height / 2 / world), unmercX(x + width / 2 / world), unmercY(y - height / 2 / world)];
}

/** Roughly how large an outline is, in km², read on the map's own square at its latitude. */
export function areaKm2(corners) {
  if (!corners || corners.length < 3) return 0;
  const lat = corners.reduce((sum, point) => sum + point[1], 0) / corners.length;
  const metres = 40075016.7 * Math.cos((lat * Math.PI) / 180);
  let twice = 0;
  corners.forEach((point, index) => {
    const next = corners[(index + 1) % corners.length];
    twice += mercX(point[0]) * mercY(next[1]) - mercX(next[0]) * mercY(point[1]);
  });
  return (Math.abs(twice) / 2) * metres * metres / 1e6;
}

/** An area's size said as the analyst would write it on the map: "about 15 km²", a floor of roundness. */
export function aboutArea(km2) {
  if (!(km2 > 0)) return '';
  if (km2 < 0.1) return `about ${Math.max(100, Math.round((km2 * 1e6) / 100) * 100).toLocaleString('en-GB')} m²`;
  const round = km2 < 10 ? Math.round(km2 * 10) / 10 : km2 < 100 ? Math.round(km2) : Math.round(km2 / 5) * 5;
  return `about ${round.toLocaleString('en-GB')} km²`;
}
