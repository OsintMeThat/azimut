/**
 * What a new sheet for a figure starts from, offered in the source picker
 * (`components/DataPicker.svelte`) so a chart or an infographic gets data it reads in one
 * press: `{ title, columns, rows }`.
 *
 * - A chart: its own table, columns and rows as written; a chart with no table yet, the
 *   columns its kind reads (`chartFormText.columnsFor`) and no row.
 * - An infographic: the columns its chart panels read, each once in the order met; rows
 *   only when every chart panel holds the same columns (one data copied in each), from
 *   the panel holding the most.
 */
import { readChart, setting } from './editor/chartText.js';
import { columnsFor } from './editor/chartFormText.js';
import { plainText } from './editor/tableText.js';
import { panelText, readInfographic } from './editor/infographicText.js';

/** The blank rows a sheet made with a figure's columns opens with, ready to type. */
export const BLANK_ROWS = 3;

function named(words, fallback) {
  const said = plainText(String(words ?? '')).trim();
  return said || fallback;
}

/** A chart block's seed (its source as written, `::: chart` to `:::`). */
export function chartSeed(source) {
  const chart = readChart(source);
  const title = named(setting(chart, 'title'), 'Chart data');
  const table = chart.table;
  if (table?.header?.length) {
    return { title, columns: table.header.map((head) => plainText(head).trim()), rows: table.rows.map((row) => [...row]) };
  }
  return { title, columns: columnsFor(setting(chart, 'kind')), rows: [] };
}

/** An infographic block's seed (its source as written, `:::: infographic` to `::::`). */
export function infographicSeed(source) {
  const read = readInfographic(source);
  const title = named(read.settings.title?.value, 'Infographic data');
  const seeds = read.panels.map((panel, index) => (panel.kind === 'chart' ? chartSeed(panelText(source, index)) : null))
    .filter((seed) => seed && seed.columns.length);
  const columns = [];
  for (const seed of seeds) for (const column of seed.columns) if (!columns.includes(column)) columns.push(column);
  const key = (seed) => [...seed.columns].sort().join('\u0000');
  const alike = seeds.length > 0 && seeds.every((seed) => key(seed) === key(seeds[0]));
  const fullest = alike ? seeds.reduce((best, seed) => (seed.rows.length > best.rows.length ? seed : best)) : null;
  return { title, columns: fullest ? fullest.columns : columns, rows: fullest ? fullest.rows : [] };
}

/** The rows a sheet "with its columns" starts with: a few blank ones. */
export function blankRows(columns) {
  return Array.from({ length: BLANK_ROWS }, () => columns.map(() => ''));
}

/**
 * How the columns pasted meet the ones a figure reads: for each column it reads that the
 * paste does not name, the pasted column nearest to it (same words in another case, one
 * holding the other), or '' for none. Columns already named alike are left out.
 */
export function matchColumns(wanted, pasted) {
  const fold = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
  const taken = new Set(pasted.map(fold));
  const free = pasted.filter((column) => !wanted.some((want) => fold(want) === fold(column)));
  const out = [];
  for (const want of wanted) {
    if (taken.has(fold(want))) continue;
    const near = free.find((column) => fold(column).includes(fold(want)) || fold(want).includes(fold(column))) ?? '';
    out.push({ want, from: near });
  }
  return out;
}

/** The pasted columns renamed as matched (`{ want, from }`), the rest kept. */
export function renamed(columns, matches) {
  const to = new Map(matches.filter((match) => match.from).map((match) => [match.from, match.want]));
  return columns.map((column) => to.get(column) ?? column);
}
