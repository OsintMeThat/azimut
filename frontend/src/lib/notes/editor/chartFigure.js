/**
 * What the note editor asks the server of a chart (`api/notecharts.py`): its drawing
 * and what the check says of it, every kind its table fits for the kind picker, a
 * picture of it for one destination, and the rows it may be copied from elsewhere. A
 * drawing and a gallery are kept by the block's text, so a chart drawn once is drawn again
 * at once; a picture is asked for each time.
 */
import { api } from '../../api.js';

/** How many drawings and galleries are kept, the oldest going first. */
export const KEPT = 40;

/**
 * Where a chart can go as a picture, in the order the Export menu lists them: the
 * engine's destinations (`notes_charts.DESTINATIONS`) and the SVG for a designer.
 */
export const EXPORTS = [
  { id: 'x', label: 'For X', hint: '16:9 · 1600 × 900', format: 'png', size: 'x' },
  { id: 'portrait', label: 'Portrait', hint: '4:5 · 1080 × 1350', format: 'png', size: 'portrait' },
  { id: 'square', label: 'Square', hint: '1:1 · 1080 × 1080', format: 'png', size: 'square' },
  { id: 'page', label: 'PDF page', hint: 'Print width, 300 dpi', format: 'png', size: 'page' },
  { id: 'svg', label: 'SVG', hint: 'For a designer', format: 'svg', size: 'page' },
];

/** How long the rows read from another note or a sheet are kept before they are asked again, in ms. */
export const ROWS_KEPT_MS = 3000;

const drawings = new Map();
const galleries = new Map();
const copied = new Map();

function keep(store, key, value) {
  store.delete(key);
  store.set(key, value);
  while (store.size > KEPT) store.delete(store.keys().next().value);
  return value;
}

/** A JSON list a header carries, or an empty one. */
function listOf(headers, name) {
  try {
    const value = JSON.parse(headers?.get?.(name) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function objectOf(headers, name) {
  try {
    const value = JSON.parse(headers?.get?.(name) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function textOf(headers, name) {
  try {
    const value = JSON.parse(headers?.get?.(name) ?? '""');
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/**
 * What the check says of a chart, from the figure route's headers: `{ message, line,
 * kind, fix }`, `line` in the block (its fence is line 0) and `fix` the settings that
 * mend it, `[[key, value], …]`, empty when only the analyst can.
 */
export function readChecks(headers) {
  const messages = listOf(headers, 'X-Note-Warnings');
  const lines = listOf(headers, 'X-Note-Warning-Lines');
  const kinds = listOf(headers, 'X-Note-Warning-Kinds');
  const fixes = listOf(headers, 'X-Note-Warning-Fixes');
  return messages.map((message, at) => ({
    message: String(message),
    // the route counts the block's lines from the first under its fence
    line: Number.isInteger(lines[at]) ? lines[at] + 1 : null,
    kind: typeof kinds[at] === 'string' ? kinds[at] : 'other',
    fix: (Array.isArray(fixes[at]) ? fixes[at] : []).filter((pair) => Array.isArray(pair) && pair.length === 2).map(([key, value]) => [String(key), String(value)]),
  }));
}

/** Each value a chart colours, `{ value, colour, origin }` (`origin`: "case", "order", "grade", "chart"…). */
export function readColours(headers) {
  return listOf(headers, 'X-Chart-Colours')
    .filter((one) => one && typeof one.value === 'string' && /^#[0-9a-f]{6}$/i.test(String(one.colour)))
    .map((one) => ({ value: one.value, colour: String(one.colour).toLowerCase(), origin: String(one.origin ?? '') }));
}

/**
 * A chart drawn: `{ svg, title, proposed, kind, checks, colours }`, or `{ error }`: `kind` is what
 * it is drawn as (`{ name, label, counts, parts, stacked, style }`). `noteId` is the note it
 * stands in, read for its look; `origins` false leaves `from:` to the editor, which reads
 * the rows of its own note as they are typed.
 */
export function drawChart({ caseId, noteId = '', text, origins = true }, { post = api.postBytes } = {}) {
  const key = JSON.stringify([caseId, noteId, origins, text]);
  const known = drawings.get(key);
  if (known) return known instanceof Promise ? known : Promise.resolve(known);
  const asked = post(`/api/cases/${encodeURIComponent(caseId)}/notes/figure`, { text, note: noteId ?? '', origins })
    .then(({ data, headers }) => ({
      svg: new TextDecoder().decode(data),
      title: textOf(headers, 'X-Chart-Title'),
      proposed: textOf(headers, 'X-Chart-Proposed-Title'),
      kind: objectOf(headers, 'X-Chart-Kind'),
      checks: readChecks(headers),
      colours: readColours(headers),
    }))
    .catch((error) => ({ error: error?.message ?? String(error) }))
    .then((answer) => {
      // a failure is asked again next time; a drawing is kept
      if (answer.error) drawings.delete(key);
      else keep(drawings, key, answer);
      return answer;
    });
  keep(drawings, key, asked);
  return asked;
}

/** The drawing kept for a chart, or null: what it shows at once while it is asked again. */
export function keptDrawing({ caseId, noteId = '', text, origins = true }) {
  const known = drawings.get(JSON.stringify([caseId, noteId, origins, text]));
  return known && !(known instanceof Promise) ? known : null;
}

/**
 * Every kind a table (or a chart's block) fits, drawn small from its rows: `{ rows,
 * kinds: [{ kind, label, settings, title, svg }] }`, or `{ error }`.
 */
export function chartKinds({ caseId, noteId = '', text }, { post = api.post } = {}) {
  const key = JSON.stringify([caseId, noteId, text]);
  const known = galleries.get(key);
  if (known) return known instanceof Promise ? known : Promise.resolve(known);
  const asked = post(`/api/cases/${encodeURIComponent(caseId)}/notes/figure/kinds`, { text, note: noteId ?? '' })
    .then((answer) => ({ rows: Number(answer?.rows) || 0, kinds: Array.isArray(answer?.kinds) ? answer.kinds : [] }))
    .catch((error) => ({ error: error?.message ?? String(error) }))
    .then((answer) => {
      if (answer.error) galleries.delete(key);
      else keep(galleries, key, answer);
      return answer;
    });
  keep(galleries, key, asked);
  return asked;
}

/**
 * The rows a chart's `from:` names when they came from another note or a sheet, as a
 * table's Markdown: `{ found, name, text }`, or `{ error }`. Kept a few seconds
 * (`ROWS_KEPT_MS`), so typing in the note does not ask again at every key; `fresh` asks now.
 */
export function chartRows({ caseId, origin, fresh = false }, { post = api.post, now = Date.now } = {}) {
  const key = JSON.stringify([caseId, origin]);
  const known = copied.get(key);
  if (known && !fresh && now() - known.at < ROWS_KEPT_MS) return known.asked;
  const asked = post(`/api/cases/${encodeURIComponent(caseId)}/notes/figure/rows`, { origin })
    .then((answer) => ({ found: Boolean(answer?.found), name: String(answer?.name ?? ''), text: String(answer?.text ?? '') }))
    .catch((error) => {
      copied.delete(key);
      return { error: error?.message ?? String(error) };
    });
  keep(copied, key, { at: now(), asked });
  return asked;
}

/**
 * What a chart's rows may be copied from (*Copy rows from…*): the tables of the case's
 * other notes, `{ origin, note, heading, rows, columns }`, and its sheets, `{ origin,
 * title, rows, columns }`, or `{ error }`.
 */
export function chartSources({ caseId, noteId = '' }, { get = api.get } = {}) {
  const query = noteId ? `?note=${encodeURIComponent(noteId)}` : '';
  return get(`/api/cases/${encodeURIComponent(caseId)}/notes/figure/sources${query}`)
    .then((answer) => ({ tables: Array.isArray(answer?.tables) ? answer.tables : [], sheets: Array.isArray(answer?.sheets) ? answer.sheets : [] }))
    .catch((error) => ({ error: error?.message ?? String(error) }));
}

/** A file name for a chart's picture: its title, then where it goes. */
export function pictureName(title, destination) {
  const words = String(title || 'Chart').replace(/[\\/<>:"|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Chart';
  const where = { x: 'X', portrait: '4x5', square: '1x1', page: 'page', svg: '' }[destination.id] ?? destination.id;
  return `${words}${where ? ` (${where})` : ''}.${destination.format}`;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The chart as a picture for `destination` (one of `EXPORTS`), downloaded. Answers
 * the file's name, or throws the route's reason.
 */
export async function exportChart({ caseId, noteId = '', text, destination }, { post = api.postBytes, save = saveBlob } = {}) {
  const { data, headers } = await post(`/api/cases/${encodeURIComponent(caseId)}/notes/figure`, {
    text, note: noteId ?? '', format: destination.format, size: destination.size,
  });
  const name = pictureName(textOf(headers, 'X-Chart-Title'), destination);
  save(new Blob([data], { type: destination.format === 'svg' ? 'image/svg+xml' : 'image/png' }), name);
  return name;
}

/** Forget every drawing and gallery kept (a test, a case left). */
export function forgetDrawings() {
  drawings.clear();
  galleries.clear();
  copied.clear();
}
