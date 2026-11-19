/**
 * A sheet on a map: the columns proposed for it, and the four requests that make it and keep
 * it in step (`engine/sheetmap.py`).
 *
 * The proposal reads what the sheet already says of its columns, a role the analyst set first,
 * then `detectRole`, the one reading a column's cells is given anywhere in the app. It adds no
 * reading of its own beyond a column's name where a role cannot tell: two columns of numbers
 * named like a latitude and a longitude, a column named like a grade among several sets of
 * values. Everything is a proposal the dialog shows and the analyst corrects.
 */
import { api } from './api.js';
import { keyIndex } from './sheet.js';
import { detectRole, parseNumber } from './sheetRoles.js';

/** The columns a point's card may show. Mirrors `engine/sheetmap.MAX_CARD`. */
export const MAX_CARD = 8;
/** The columns a card shows when nobody has chosen. */
const CARD_START = 6;

const LAT = /^(lat|latitude|y)$/i;
const LON = /^(lon|lng|long|longitude|x)$/i;
const PLACE_WORDS = /place|location|position|where|site|coord|mgrs|grid|town|city|village/i;
const COLOUR_WORDS = /grade|confidence|status|state|side|faction|type|kind|category|class|unit/i;
const END_WORDS = /end|until|till|to\b|last|stop|gone|left/i;

/** How each way of reading a place is said, by `engine/sheetmap.HOWS`. */
export const HOW_WORDS = {
  columns: 'a latitude and a longitude',
  coordinates: 'coordinates',
  mgrs: 'a grid reference',
  linked: 'what the cell links to',
  named: 'a place of the case',
};

function cells(table, name) {
  const at = (table?.columns ?? []).indexOf(name);
  return at === -1 ? [] : (table?.rows ?? []).map((row) => String(row[at] ?? '').trim());
}

/** A column's role: the one it was given, else what its cells look like. */
function roleOf(table, meta, name) {
  return meta?.roles?.[name]?.kind ?? detectRole(cells(table, name));
}

/** Whether most of a column's filled cells are numbers. */
function numeric(table, name) {
  const filled = cells(table, name).filter(Boolean);
  return filled.length > 0 && filled.filter((cell) => parseNumber(cell) !== null).length / filled.length >= 0.66;
}

function linked(meta, name) {
  return Object.values(meta?.links ?? {}).some((cellsOf) => cellsOf?.[name]) || Boolean(Object.keys(meta?.values?.[name] ?? {}).length);
}

/**
 * The columns a sheet is proposed to go on a map with, as `engine/sheetmap.CHOICE`:
 * `{ place, lon, name, card, colour, start, end }`, each '' where nothing fits.
 */
export function suggestChoice(table, meta = {}) {
  const columns = table?.columns ?? [];
  const usable = columns.filter((_, index) => index !== keyIndex(columns));
  const role = (name) => roleOf(table, meta, name);
  let place = usable.find((name) => role(name) === 'latlon') ?? '';
  let lon = '';
  const latColumn = usable.find((name) => LAT.test(name.trim()));
  const lonColumn = usable.find((name) => LON.test(name.trim()));
  if (!place && latColumn && lonColumn && numeric(table, latColumn) && numeric(table, lonColumn)) {
    place = latColumn;
    lon = lonColumn;
  }
  if (!place) place = usable.find((name) => linked(meta, name) && PLACE_WORDS.test(name)) ?? '';
  if (!place) place = usable.find((name) => PLACE_WORDS.test(name)) ?? usable.find((name) => linked(meta, name)) ?? '';
  const taken = new Set([place, lon]);
  const whens = usable.filter((name) => !taken.has(name) && role(name) === 'when');
  const start = whens.find((name) => !END_WORDS.test(name)) ?? whens[0] ?? '';
  const end = whens.find((name) => name !== start && END_WORDS.test(name)) ?? '';
  const sets = usable.filter((name) => !taken.has(name) && ['state', 'choice', 'boolean'].includes(role(name)));
  const distinct = (name) => new Set(cells(table, name).filter(Boolean).map((cell) => cell.toLowerCase())).size;
  const colour = sets.find((name) => COLOUR_WORDS.test(name))
    ?? [...sets].sort((a, b) => distinct(a) - distinct(b)).find((name) => distinct(name) > 1) ?? '';
  const name = usable.find((column) => !taken.has(column) && column !== start && column !== end && column !== colour
    && cells(table, column).some(Boolean) && !numeric(table, column)) ?? '';
  const card = usable.filter((column) => !taken.has(column) && column !== name && cells(table, column).some(Boolean))
    .slice(0, CARD_START);
  return { place, lon, name, card, colour, start, end };
}

/** The choice as the server takes it: no empty card, nothing undefined. */
export function cleanChoice(choice) {
  const out = {};
  for (const key of ['place', 'lon', 'name', 'colour', 'start', 'end']) out[key] = choice?.[key] ?? '';
  out.card = (choice?.card ?? []).filter(Boolean).slice(0, MAX_CARD);
  if (!out.start) out.end = '';
  return out;
}

/** "18 of 23 rows go on the map", the plan's first line. */
export function placedWords(plan) {
  if (!plan) return '';
  if (!plan.placed) return plan.rows ? 'No row has a place the map can read.' : 'This sheet has no row yet.';
  return plan.placed === plan.rows
    ? `All ${plan.rows} ${plan.rows === 1 ? 'row goes' : 'rows go'} on the map.`
    : `${plan.placed} of ${plan.rows} rows go on the map.`;
}

/** How the places were read: "read as coordinates (17) and a grid reference (1)". */
export function howWords(hows) {
  const parts = Object.entries(hows ?? {}).filter(([, count]) => count).map(([how, count]) => `${HOW_WORDS[how] ?? how} (${count})`);
  if (!parts.length) return '';
  return `Read as ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}.`;
}

/** The rows left off the map, counted. */
export function unplacedWords(plan) {
  const count = plan?.unplaced_count ?? 0;
  if (!count) return '';
  return `${count} ${count === 1 ? 'row has' : 'rows have'} no place the map can read and ${count === 1 ? 'stays' : 'stay'} off it.`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function day(iso) {
  const [year, month, date] = String(iso ?? '').split('-').map(Number);
  return year ? `${date} ${MONTHS[month - 1]} ${year}` : '';
}

/** What the days say, or '' with no date column. */
export function datedWords(plan, choice) {
  if (!choice?.start || !plan) return '';
  const span = plan.first && plan.last && plan.first !== plan.last ? `from ${day(plan.first)} to ${day(plan.last)}` : plan.first ? `on ${day(plan.first)}` : '';
  const dated = plan.dated ? `${plan.dated} ${plan.dated === 1 ? 'point is' : 'points are'} dated ${span}.` : 'No point has a readable date.';
  const rest = plan.undated ? ` ${plan.undated} with no readable date ${plan.undated === 1 ? 'shows' : 'show'} on every day.` : '';
  return dated + rest;
}

/** What an update did, in one line for its toast, the rows still off the map counted. */
export function updatedWords(updated, unplaced = 0) {
  const parts = [];
  if (updated?.added) parts.push(`${updated.added} added`);
  if (updated?.changed) parts.push(`${updated.changed} changed`);
  if (updated?.removed) parts.push(`${updated.removed} taken off`);
  const said = parts.length ? `Layer updated: ${parts.join(', ')}.` : 'The layer already says what the sheet says.';
  const kept = [];
  if (updated?.kept) kept.push(`${updated.kept} ${updated.kept === 1 ? 'point keeps' : 'points keep'} your edits`);
  if (updated?.left_out) kept.push(`${updated.left_out} you took out ${updated.left_out === 1 ? 'stays' : 'stay'} out`);
  const off = unplaced ? ` ${unplaced} ${unplaced === 1 ? 'row has' : 'rows have'} no place and ${unplaced === 1 ? 'stays' : 'stay'} off it.` : '';
  return (kept.length ? `${said} ${kept.join('; ')}.` : said) + off;
}

/** What a layer made from a sheet says of it on its row, or '' for any other layer. */
export function sheetLine(row) {
  const sheet = row?.sheet;
  if (!sheet) return '';
  if (sheet.gone) return `Its sheet “${sheet.title || 'Sheet'}” is no longer in the case`;
  if (sheet.problem) return `The sheet changed: ${sheet.problem}`;
  if (sheet.changed) return 'The sheet changed';
  return `From the sheet “${sheet.title}”`;
}

export function previewSheetMap(caseId, sheetId, choice) {
  return api.post(`/api/cases/${caseId}/sheets/${sheetId}/map/preview`, { choice: cleanChoice(choice) });
}

export function makeSheetMap(caseId, sheetId, choice, title = '') {
  return api.post(`/api/cases/${caseId}/sheets/${sheetId}/map`, { choice: cleanChoice(choice), title });
}

export function updateFromSheet(caseId, name, { replace = false } = {}) {
  return api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(name)}/sheet`, { replace });
}

export function undoSheetUpdate(caseId, name, token) {
  return api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(name)}/sheet/undo`, { token });
}
