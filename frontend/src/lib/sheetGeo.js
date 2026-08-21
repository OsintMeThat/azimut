/**
 * Reading a column of place names into coordinates, and a column of coordinates back into
 * place names.
 *
 * Both directions already existed in this app — the map's own search and the country
 * backfill go through `/api/geo/geocode` and `/api/geo/reverse` — and the sheet, which is
 * where a geolocation index is actually worked, could reach neither. So an analyst holding
 * four hundred rows of `Kherson, Ukraine` typed the coordinates in by hand, or gave up on
 * the column.
 *
 * Two rules, and they are the same rule twice:
 *
 * - **Nothing is applied on its own.** The pass proposes a cell per row and the analyst
 *   presses to write them, because a geocoder's first hit is a guess and a guess written
 *   into a column of evidence is indistinguishable from a fact somebody established.
 * - **Only where the answer is missing.** A row that already holds a point is never asked
 *   about: overwriting a coordinate somebody read off a photograph with one Nominatim
 *   guessed from a name is the worst thing this could do.
 *
 * Distinct values rather than rows, because a column of four hundred rows holds forty
 * places. Nominatim is paced server-side at one request per 1.1 s, so forty values is
 * three quarters of a minute — which is why the caller walks them one at a time and can
 * stop.
 *
 * **And the case is asked before the internet is.** A forward pass used to send every row
 * to Nominatim, including the ones whose cell already points at an entity the case has
 * placed — a second of somebody else's server spent guessing a name the case could have
 * answered exactly, and no answer at all when the cell says `3rd Bde` rather than a
 * toponym. So the pass has two halves: what the graph knows, written straight, and the
 * words left over, looked up.
 */

import { api } from './api.js';
import { linkAt, rowKey } from './sheet.js';
import { formatLatLon, parseLatLon } from './sheetRoles.js';

/** How many distinct values one pass will look up. Past this it is a batch job, and a
 *  browser tab waiting four minutes on a paced geocoder is a tab that looks broken. */
export const MAX_LOOKUPS = 60;

/** How many entities one pass asks the place of. Mirrors `api/sheets.MAX_POINTS`: this
 *  half is answered off the case's own graph, so it is bounded by the sheet's working
 *  size and not by a stranger's rate limit. */
export const MAX_CASE_POINTS = 2000;

/**
 * The rows a forward pass can answer without leaving the machine: their cell in the source
 * column points at an entity, and their target cell is empty.
 *
 * Rows and not values, because the link is on the cell. Two rows saying `Kherson` may point
 * at two different entities, and a pass that grouped them would put one row's place on the
 * other's ground — the same reason the reverse pass is row by row.
 */
export function linkedRows(table, meta, sourceIndex, targetIndex, rows) {
  const column = table?.columns?.[sourceIndex];
  if (column === undefined) return [];
  const wanted = [];
  for (const index of rows ?? []) {
    const row = table?.rows?.[index];
    if (!row) continue;
    // An empty cell is not a place to read, the same rule the lookup half is under. It
    // also covers a link left behind by a cell somebody blanked.
    if (!String(row[sourceIndex] ?? '').trim()) continue;
    if (targetIndex !== -1 && String(row[targetIndex] ?? '').trim()) continue;
    const id = linkAt(meta, rowKey(table.columns, row), column);
    if (id) wanted.push({ row: index, id: String(id) });
  }
  return wanted.slice(0, MAX_CASE_POINTS);
}

/**
 * Where the case puts these entities, as `{ id: { lat, lon } }`.
 *
 * Never throws: a case that cannot answer leaves every row to the geocoder, which is the
 * behaviour this pass had before it learned to ask.
 */
export async function casePoints(caseId, sheetId, ids) {
  if (!caseId || !sheetId || !ids?.length) return {};
  try {
    const answer = await api.post(`/api/cases/${caseId}/sheets/${sheetId}/points`, {
      ids: [...new Set(ids)].slice(0, MAX_CASE_POINTS),
    });
    return answer?.points ?? {};
  } catch {
    return {};
  }
}

/** One place name, as the geocoder's best answer or null. Never throws: a value nothing
 *  answers for is a row left alone, not a pass that stops. */
export async function geocodeValue(value) {
  try {
    return await api.get(`/api/geo/geocode?q=${encodeURIComponent(value)}`);
  } catch {
    return null;
  }
}

/** One point, as what is around it, or null. */
export async function reverseValue(lat, lon) {
  try {
    return await api.get(`/api/geo/reverse?lat=${lat}&lon=${lon}`);
  } catch {
    return null;
  }
}

/**
 * The distinct words a forward pass would look up: filled in the source column, missing in
 * the target one.
 *
 * Every value carries the rows holding it, so one lookup fills all of them — and so the
 * dialog can say `Kherson · 34 rows` before anything is written.
 */
export function namesToRead(table, sourceIndex, targetIndex, rows) {
  const found = new Map();
  for (const index of rows ?? []) {
    const row = table?.rows?.[index];
    if (!row) continue;
    const value = String(row[sourceIndex] ?? '').trim();
    if (!value) continue;
    if (targetIndex !== -1 && String(row[targetIndex] ?? '').trim()) continue;
    if (!found.has(value)) found.set(value, { value, rows: [] });
    found.get(value).rows.push(index);
  }
  return [...found.values()].sort((a, b) => b.rows.length - a.rows.length);
}

/**
 * The rows a reverse pass would ask about: a readable point in the source column, nothing
 * in the target one.
 *
 * Rows rather than values, because two rows are never the same point: five decimals is a
 * metre, and rounding them together to save a lookup would put one row's answer on
 * another row's ground.
 */
export function pointsToRead(table, sourceIndex, targetIndex, rows) {
  const wanted = [];
  for (const index of rows ?? []) {
    const row = table?.rows?.[index];
    if (!row) continue;
    if (targetIndex !== -1 && String(row[targetIndex] ?? '').trim()) continue;
    const point = parseLatLon(row[sourceIndex]);
    if (point && !point.outOfBounds) wanted.push({ row: index, point });
  }
  return wanted;
}

/** A geocoder answer as the cell a point column holds: the app's one spelling, five
 *  decimals, which is about a metre — and no more, because the answer is a guess about a
 *  name and a sixth decimal would dress it up as a survey. */
export function pointCell(answer) {
  if (!answer || !Number.isFinite(answer.lat) || !Number.isFinite(answer.lon)) return '';
  return formatLatLon({ lat: Number(answer.lat), lon: Number(answer.lon) });
}

/** Which parts of a reverse answer make a place name a person would write. Ordered from
 *  the closest thing to a street up to the country, and cut to the two that fit a cell. */
const PLACE_KEYS = ['city', 'town', 'village', 'municipality', 'county', 'state', 'country'];

/**
 * A reverse answer as a short place name — `Kherson, Ukraine` — or the empty string.
 *
 * The full `display_name` is a postal address seven parts long, which is a cell nobody can
 * read in a grid thirty pixels tall. The town and the country are what a worklist means by
 * "where is this".
 */
export function placeCell(answer) {
  const address = answer?.address ?? {};
  const local = PLACE_KEYS.map((key) => String(address[key] ?? '').trim()).filter(Boolean);
  const country = String(address.country ?? '').trim();
  const near = local.find((name) => name !== country) ?? '';
  if (near && country && near !== country) return `${near}, ${country}`;
  return near || country || String(answer?.display_name ?? '').split(',')[0].trim();
}
