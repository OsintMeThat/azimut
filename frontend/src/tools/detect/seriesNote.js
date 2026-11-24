/**
 * A routine's dashboard, put in a note: its figures, its two charts and its spots,
 * each as a block the Notebook draws and keeps editable (`::: chart` over its own
 * table, `engine/notes_charts.py`), or as a CSV file for a spreadsheet.
 *
 * What a block says is what the runs measured: candidates the detector found and
 * nobody dismissed, spots grouped by the rule it states. A count of candidates is
 * not a count of aircraft or vehicles, so the words say candidates.
 */
import { NOTE_ROWS, cutLine, toMarkdown } from '../../lib/sheetExport.js';
import { CATEGORIES, areaColours, presenceLine, seriesFigures, shortDay, spansYears } from '../../lib/map/detectSeries.js';

/** A name as a chart setting can hold it: no comma, no pipe, one line. */
const plain = (text) => String(text ?? '').replace(/[,|]/g, ' ').replace(/\s+/g, ' ').trim();

/** `{ dayOf, areaName }` for a series: day labels with the year only when it spans two. */
function labels(series, areas) {
  const year = spansYears(series.passes.map((pass) => pass.date));
  const names = new Map((areas ?? []).map((area) => [area.id, plain(area.name) || 'Area']));
  return { dayOf: (day) => shortDay(day, year), areaName: (id) => names.get(id) ?? 'Area' };
}

const span = (series) => {
  const first = series.passes[0]?.date;
  const last = series.passes.at(-1)?.date;
  if (!first) return '';
  return first === last ? shortDay(first, true) : `${shortDay(first, first.slice(0, 4) !== last.slice(0, 4))} to ${shortDay(last, true)}`;
};

/** Where the figures come from, for each block's `source:` line. */
export function sourceLine({ analyzer = '', sensor = 'sentinel2' } = {}) {
  const imagery = sensor === 'sentinel1' ? 'Sentinel-1' : 'Sentinel-2';
  return `${imagery} passes read by Azimut Detect${analyzer ? ` (${plain(analyzer)})` : ''}`;
}

function block(settings, table) {
  const lines = Object.entries(settings).filter(([, value]) => value !== '' && value != null)
    .map(([key, value]) => `${key}: ${value}`);
  return ['::: chart', ...lines, toMarkdown(table).trimEnd(), ':::'].join('\n');
}

/** Four headline figures as tiles. */
export function figuresBlock(series, { title = '', source = '' } = {}) {
  const figures = seriesFigures(series);
  if (!figures.passes) return '';
  const rows = [
    [String(figures.passes), `passes read, ${span(series)}`],
    [String(figures.candidates), 'candidates found and not dismissed'],
    [String(figures.spots), `spots, candidates within ${series.radius} m counted as one`],
    [String(figures.steady), 'regular spots, on 4 passes in 5 or more'],
  ];
  return block({ kind: 'key figures', title: plain(title), source }, { columns: ['Figure', 'What it says'], rows });
}

/**
 * Candidates on each pass: one column a pass, or with `byArea` stacked by area in
 * the areas' own colours.
 */
export function perPassBlock(series, { title = '', source = '', areas = [], byArea = false } = {}) {
  if (!series.passes.length) return '';
  const { dayOf, areaName } = labels(series, areas);
  const name = plain(title) || 'Candidates per pass';
  if (!byArea) {
    return block({ kind: 'columns', title: name, count: 'Candidates', by: 'Pass', source },
      { columns: ['Pass', 'Candidates'], rows: series.passes.map((pass) => [dayOf(pass.date), String(pass.counts.total)]) });
  }
  const used = [...new Set(series.passes.flatMap((pass) => Object.keys(pass.byArea)))];
  const order = (areas ?? []).map((area) => area.id).filter((id) => used.includes(id));
  const ids = [...order, ...used.filter((id) => !order.includes(id))];
  const tints = areaColours(ids, areas);
  const colours = ids.map((id) => `${areaName(id)} ${tints[id]}`).join(', ');
  const rows = series.passes.flatMap((pass) => ids.map((id) => [dayOf(pass.date), areaName(id), String(pass.byArea[id]?.total ?? 0)]));
  return block({ kind: 'stacked columns', title: name, count: 'Candidates', by: 'Pass', 'colour by': 'Area',
    order: ids.map(areaName).join(', '), colours, source }, { columns: ['Pass', 'Area', 'Candidates'], rows });
}

/** Spots that appeared and spots that left on each pass, against the pass before. */
export function changesBlock(series, { title = '', source = '' } = {}) {
  const compared = series.passes.filter((pass) => pass.compared);
  if (!compared.length) return '';
  const { dayOf } = labels(series, []);
  const rows = compared.flatMap((pass) => [
    [dayOf(pass.date), 'Appeared', String(pass.arrived.length)],
    [dayOf(pass.date), 'Left', String(pass.left.length)],
  ]);
  return block({ kind: 'stacked columns', title: plain(title) || 'Spots that appeared and left, pass after pass',
    count: 'Spots', by: 'Pass', 'colour by': 'Change', order: 'Appeared, Left',
    colours: 'Appeared #3f9d5a, Left #d97070', source }, { columns: ['Pass', 'Change', 'Spots'], rows });
}

/** The spots as a table: where each is, when it was seen and its passes as ● ○ ·. */
export function spotsTable(series, { areas = [], spots = series.spots, limit = NOTE_ROWS } = {}) {
  if (!spots.length) return '';
  const { dayOf, areaName } = labels(series, areas);
  const category = new Map(CATEGORIES.map((entry) => [entry.id, entry.label]));
  const rows = spots.slice(0, limit).map((spot) => [
    spot.id, areaName(spot.areaId), `${spot.centre[1].toFixed(5)}, ${spot.centre[0].toFixed(5)}`,
    dayOf(spot.first), dayOf(spot.last), `${spot.seen} of ${spot.read}`, category.get(spot.category) ?? '',
    presenceLine(spot.presence),
  ]);
  const said = [`Spots: candidates within ${series.radius} m on two passes count as one. Passes: ● seen, ○ looked at and empty, · not read.`];
  const cut = cutLine({ kept: rows.length, total: spots.length, noun: 'spots', narrow: 'The spots CSV holds every one.' });
  if (cut) said.push(cut);
  return toMarkdown({ columns: ['Spot', 'Area', 'Coordinates', 'First seen', 'Last seen', 'Passes', 'Kind', 'Each pass'], rows }, said);
}

/** Everything at once, under a heading: the dashboard as a section of the note. */
export function wholeSection(series, options = {}) {
  const parts = [
    figuresBlock(series, { ...options, title: '' }),
    perPassBlock(series, { ...options, title: '' }),
    changesBlock(series, { ...options, title: '' }),
    spotsTable(series, options),
  ].filter(Boolean);
  if (!parts.length) return '';
  return [`## ${plain(options.title) || 'Routine'}, ${span(series)}`, ...parts].join('\n\n');
}

/** The note offers of a dashboard (`offerPuts`), each read when pressed. */
export function seriesOffers(read) {
  const offer = (id, label, hint, icon, make) => ({
    id, label, hint, icon,
    put: async () => {
      const { series, ...options } = read();
      const text = series ? make(series, options) : '';
      if (!text) throw new Error('This routine has no finished pass to put in a note yet');
      return { text };
    },
  });
  return [
    offer('series-all', 'The whole dashboard', 'Figures, both charts and the spots, under a heading', 'note', wholeSection),
    offer('series-figures', 'The key figures', 'Passes, candidates and spots as tiles', 'hash', figuresBlock),
    offer('series-passes', 'Candidates per pass', 'A chart the Notebook keeps editable', 'chart', perPassBlock),
    offer('series-changes', 'Appeared and left', 'Spots that came and went, pass after pass', 'changes', changesBlock),
    offer('series-spots', 'The spots table', 'Each spot with its passes as ● ○ ·', 'table', spotsTable),
  ];
}

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csv = (columns, rows) => `${[columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;

/** One row per candidate, every pass, with the spot it belongs to. */
export function candidatesCsv(series, { areas = [] } = {}) {
  const { areaName } = labels(series, areas);
  const spotOf = new Map(series.spots.flatMap((spot) => spot.members.map((member) => [`${member.runId}/${member.result.id}`, spot.id])));
  const rows = series.passes.flatMap((pass) => pass.results
    .filter((result) => !series.only || result.area_id === series.only)
    .map((result) => [
      pass.date, pass.reference, areaName(result.area_id), spotOf.get(`${pass.id}/${result.id}`) ?? '',
      result.coordinates[1].toFixed(6), result.coordinates[0].toFixed(6), result.strength ?? '',
      result.area != null ? Math.round(result.area) : '', result.review === 'kept' ? 'pinned' : result.review === 'noted' ? 'kept here' : 'to review',
      pass.id, result.id,
    ]));
  return csv(['pass', 'reference', 'area', 'spot', 'latitude', 'longitude', 'strength', 'size_m2', 'verdict', 'run', 'candidate'], rows);
}

/** One row per spot, with its passes. */
export function spotsCsv(series, { areas = [] } = {}) {
  const { areaName } = labels(series, areas);
  const category = new Map(CATEGORIES.map((entry) => [entry.id, entry.label]));
  const rows = series.spots.map((spot) => [
    spot.id, areaName(spot.areaId), spot.centre[1].toFixed(6), spot.centre[0].toFixed(6), spot.first, spot.last,
    spot.seen, spot.read, category.get(spot.category) ?? '', presenceLine(spot.presence),
  ]);
  return csv(['spot', 'area', 'latitude', 'longitude', 'first_seen', 'last_seen', 'passes_seen', 'passes_read', 'kind', 'each_pass'], rows);
}

/** A file name from a routine's title: letters, digits and dashes. */
export function fileName(title, what) {
  const stem = String(title ?? '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'routine';
  return `${stem}-${what}.csv`;
}

/** Hand a CSV to the browser as a download. */
export function downloadCsv(text, name, doc = document) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
