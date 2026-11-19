/**
 * Figure templates in the browser: an infographic's, a chart's or a map's layout without
 * its data (`engine/figuretemplates.py` keeps them, `api/templates.py` serves them). A
 * template is the block's own text, so the Notebook's own readers read it here.
 *
 * - Settings › Templates › Figures lists them by figure, makes one blank, from a ready one
 *   or from a figure of a case, and edits it (`tools/settings/FigureTemplateEditor.svelte`);
 * - the infographic builder starts a page from one, a chart's card and a map's apply one
 *   (`figureTemplatePicker.js`), the template's columns matched onto the data's by name,
 *   the rest asked (`stepRows`, `mappingOf`).
 *
 * Nothing here invents a number: what the server writes is the template's layout and the
 * rows the data holds, and a column the data does not name is asked, never guessed.
 */
import { api } from '../api.js';
import { FORMS, starterBlock } from './editor/chartFormText.js';
import { ROWS, readChart, setting } from './editor/chartText.js';
import { HALF, WIDE, infographicsIn, panelText, readInfographic, withSetting } from './editor/infographicText.js';
import { BASES, readMap } from './editor/mapText.js';
import { escapeCell, plainText } from './editor/tableText.js';

/** The figures a template may be, in the order Settings lists them. */
export const FIGURES = [
  { id: 'infographic', label: 'Infographics', one: 'Infographic', icon: 'grid' },
  { id: 'chart', label: 'Charts', one: 'Chart', icon: 'chart' },
  { id: 'map', label: 'Maps', one: 'Map', icon: 'mapArea' },
];
export const FIGURE_NAMES = Object.fromEntries(FIGURES.map((figure) => [figure.id, figure.one]));

/** A blank template of each figure: a page with no panel, a bars chart's columns, a map as the map card leaves it. */
export function blankText(figure) {
  if (figure === 'chart') return starterBlock('bars');
  if (figure === 'map') return '::: map\n:::';
  return ':::: infographic\n::::';
}

/** Which figure a template is. */
export const figureOf = (record) => record?.data?.figure ?? 'infographic';

// -- the server --------------------------------------------------------------------------------

let readyAsked = null;
/** The ready templates the app ships, asked once. */
export function readyFigures({ get = api.get } = {}) {
  readyAsked ??= get('/api/templates/figure/ready').then((answer) => answer?.ready ?? []).catch((error) => {
    readyAsked = null;
    throw error;
  });
  return readyAsked;
}

/** A figure of a case (its block's text) as a template, not saved: `{ figure, text, name }`. */
export function figureFrom(text, { post = api.post } = {}) {
  return post('/api/templates/figure/from', { text });
}

/**
 * A template applied, writing nothing: `{ needs, columns, ask }`, then with a mapping (or
 * when every column is named) the infographic's `{ text, panels }` or a chart's or a map's
 * `{ changes }`. `table` is the data's Markdown ('' for none), `origin` where it is from.
 */
export function applyFigure({ template, table = '', origin = '', mapping = null, rows = [] }, { post = api.post } = {}) {
  return post('/api/templates/figure/apply', { template, table, origin, mapping, rows });
}

// -- what a template holds ---------------------------------------------------------------------

const fold = (word) => plainText(String(word ?? '')).split(/\s+/).join(' ').toLowerCase();

/** A chart's kind as a label: `donut` → Donut. */
export function kindLabel(kind) {
  const word = String(kind || 'bars');
  return FORMS[word]?.label ?? word[0].toUpperCase() + word.slice(1);
}

/** The columns a chart template reads: its table's header, a key figures' none (typed in each page). */
export function chartColumns(source) {
  const chart = readChart(source);
  if ((setting(chart, 'kind') || '').toLowerCase() === 'key figures') return [];
  return (chart.table?.header ?? []).map((cell) => plainText(cell)).filter(Boolean);
}

/** An infographic template's panels: `{ kind, chartKind, width, text, columns }`. */
export function templatePanels(text) {
  const read = readInfographic(text);
  return read.panels.map((panel, index) => {
    const own = panelText(text, index);
    return { kind: panel.kind, chartKind: panel.chartKind || (panel.kind === 'chart' ? 'bars' : ''), width: panel.width, text: own,
      columns: panel.kind === 'chart' ? chartColumns(own) : [] };
  });
}

/** Every column a template reads, the same name once. */
export function templateColumns(data) {
  const figure = data?.figure ?? 'infographic';
  if (figure === 'map') return [];
  const lists = figure === 'chart' ? [chartColumns(data?.text ?? '')] : templatePanels(data?.text ?? '').map((panel) => panel.columns);
  const seen = new Map();
  for (const name of lists.flat()) if (!seen.has(fold(name))) seen.set(fold(name), name);
  return [...seen.values()];
}

const LOOK_NAMES = { report: 'Report', book: 'Book', dark: 'Dark' };
const BASE_NAMES = { satellite: 'Satellite', map: 'Map', topographic: 'Topographic', dark: 'Dark' };

/** What a map template sets, said short: "Dark base · north arrow · legend folded". */
export function mapSaid(source) {
  const map = readMap(source);
  const parts = [];
  if (map.base && BASES.includes(map.base)) parts.push(`${BASE_NAMES[map.base]} base`);
  if (map.north === 'on') parts.push('north arrow');
  if (map.scale === 'off') parts.push('no scale');
  if (map.scale === 'on') parts.push('scale on the PDF');
  if (map.legend) parts.push(`legend ${map.legend}`);
  if (map.size) parts.push(map.size === 'full' ? 'full height' : map.size);
  if (map.timeline === 'off') parts.push('no timeline');
  if (map.speed) parts.push(`${map.speed} Play`);
  if (map.labels) parts.push(map.labels === 'on' ? 'every name' : 'no names');
  return parts.join(' · ') || 'As a map starts';
}

/** A template's line under its name in Settings. */
export function figureSaid(data) {
  const figure = data?.figure ?? 'infographic';
  const text = data?.text ?? '';
  if (figure === 'map') return mapSaid(text);
  const columns = templateColumns(data);
  const reads = columns.length ? `reads ${columns.slice(0, 3).join(', ')}${columns.length > 3 ? '…' : ''}` : 'typed in';
  if (figure === 'chart') return `${kindLabel(setting(readChart(text), 'kind'))} · ${reads}`;
  const read = readInfographic(text);
  const count = read.panels.length;
  const look = LOOK_NAMES[read.settings.look?.value?.toLowerCase()] ?? '';
  return [count ? `${count} panel${count === 1 ? '' : 's'}` : 'No panel yet', look, count ? reads : ''].filter(Boolean).join(' · ');
}

// -- the figures of a note ---------------------------------------------------------------------

/** The infographics, charts and maps a note holds, charts and maps inside a page left to it: `{ figure, label, text }`. */
export function figuresIn(noteText) {
  const text = String(noteText ?? '');
  const found = infographicsIn(text).map((one) => {
    const read = readInfographic(one.source);
    const title = read.settings.title?.value ?? '';
    return { figure: 'infographic', label: title || `Infographic of ${read.panels.length} panel${read.panels.length === 1 ? '' : 's'}`, text: one.source, line: one.first };
  });
  const lines = text.split('\n');
  const inside = new Set();
  for (const one of infographicsIn(text)) for (let line = one.first; line <= one.last; line += 1) inside.add(line);
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(```|~~~)/.test(lines[index])) { fenced = !fenced; continue; }
    const opened = /^:::[ \t]*(chart|map)[ \t]*$/.exec(lines[index]);
    if (fenced || inside.has(index) || !opened) continue;
    let end = index + 1;
    while (end < lines.length && !/^:::[ \t]*$/.test(lines[end])) end += 1;
    if (end >= lines.length) break;
    const source = lines.slice(index, end + 1).join('\n');
    if (opened[1] === 'chart') {
      const chart = readChart(source);
      found.push({ figure: 'chart', label: setting(chart, 'title') || `${kindLabel(setting(chart, 'kind'))} chart`, text: source, line: index });
    } else {
      found.push({ figure: 'map', label: readMap(source).title || 'A map', text: source, line: index });
    }
    index = end;
  }
  return found.sort((a, b) => a.line - b.line);
}

// -- the sketch --------------------------------------------------------------------------------

/** How tall each panel is drawn in a sketch, against a column's width. */
const SKETCH_HEIGHTS = { words: 0.34, map: 0.8, 'key figures': 0.34, timeline: 0.42 };

/**
 * A page's panels laid out as the engine lays them (`notes_infographic`): half panels fill
 * the shorter of two columns, a wide one starts under both. Answers `{ boxes, height }`, each
 * box `{ x, y, w, h, kind, chartKind }` in a page 1 wide, under a band `band` high.
 */
export function sketchLayout(text, { band = 0.16, gap = 0.04 } = {}) {
  const panels = templatePanels(text);
  const read = readInfographic(text);
  const hasBand = ['kicker', 'title', 'standfirst'].some((key) => read.settings[key]?.value);
  let top = hasBand ? band + gap : 0;
  const columns = [top, top];
  const half = (1 - gap) / 2;
  const boxes = [];
  for (const panel of panels) {
    const tall = SKETCH_HEIGHTS[panel.kind === 'chart' ? panel.chartKind : panel.kind] ?? 0.62;
    if (panel.width === WIDE) {
      const y = Math.max(...columns);
      const h = tall * 0.7;
      boxes.push({ x: 0, y, w: 1, h, kind: panel.kind, chartKind: panel.chartKind });
      columns[0] = columns[1] = y + h + gap;
    } else {
      const at = columns[0] <= columns[1] ? 0 : 1;
      const h = tall * half;
      boxes.push({ x: at * (half + gap), y: columns[at], w: half, h, kind: panel.kind, chartKind: panel.chartKind });
      columns[at] += h + gap;
    }
  }
  return { boxes, band: hasBand, height: Math.max(Math.max(...columns) - gap, hasBand ? band : 0.3) };
}

// -- the columns step --------------------------------------------------------------------------

/** What a column does in a panel, in the words the step says it. */
export const ROLE_WORDS = {
  count: 'what it counts', by: 'its bars', parts: 'its parts', 'colour by': 'its colours', when: 'its days', what: 'its events',
  until: 'when each ends', along: 'what runs along', value: 'its values', series: 'its lines', icon: 'each row’s icon',
  flag: 'each row’s flag', only: 'what it keeps',
};

/** Where a template reads a column, said: "Pictograms: its parts · Donut: its colours". */
export function usesSaid(need) {
  return (need.uses ?? []).map((use) => `${use.kind}: ${ROLE_WORDS[use.role] ?? use.role}`).join(' · ');
}

/** A step's choice: a column of the data, the rows counted, or filled by hand. */
export const BY_HAND = 'hand';
export const COUNT_ROWS = 'rows';
export const columnChoice = (index) => `c:${index}`;

/**
 * The step's rows, one a column the data does not name: `{ column, said, counts, required,
 * value }`, `value` the data's column whose name holds it (said, and asked), else by hand.
 */
export function stepRows(answer) {
  const columns = answer?.columns ?? [];
  return (answer?.needs ?? []).filter((need) => !need.match).map((need) => {
    const suggested = need.suggest ? columns.indexOf(need.suggest) : -1;
    return { column: need.column, said: usesSaid(need), counts: Boolean(need.counts), required: Boolean(need.required),
      value: suggested >= 0 ? columnChoice(suggested) : BY_HAND };
  });
}

/** The choices one row of the step offers: the data's columns, the rows counted when it counts, by hand. */
export function stepChoices(row, columns) {
  return [
    ...columns.map((name, index) => ({ value: columnChoice(index), label: name })),
    ...(row.counts ? [{ value: COUNT_ROWS, label: 'Count the rows' }] : []),
    { value: BY_HAND, label: row.required ? 'Fill it by hand' : 'Leave it out' },
  ];
}

/** The step's answers as the server takes them: `{ mapping, rows }`. */
export function mappingOf(rows, columns) {
  const mapping = {};
  const counted = [];
  for (const row of rows) {
    if (row.value === COUNT_ROWS) { counted.push(row.column); mapping[row.column] = ''; continue; }
    const at = row.value?.startsWith('c:') ? Number(row.value.slice(2)) : -1;
    mapping[row.column] = at >= 0 && at < columns.length ? columns[at] : '';
  }
  return { mapping, rows: counted };
}

// -- a page started from a template ------------------------------------------------------------

/**
 * The page `made` (a template applied, `applyFigure`'s `text`) in place of `page`: the band
 * the page already says is kept where the template says none, and its `data:` too when the
 * template met none (data gone from the case still named).
 */
export function pageFromTemplate(page, made) {
  const now = readInfographic(page);
  let next = String(made ?? '');
  if (!next.trim()) return page;
  for (const key of ['data', 'kicker', 'title', 'standfirst']) {
    const own = now.settings[key]?.value ?? '';
    if (own && !readInfographic(next).settings[key]?.value) next = withSetting(next, key, own);
  }
  return next;
}

// -- editing a template in Settings ------------------------------------------------------------

const ONLY_LINE = /^(\s*only\s*:\s*)(.+?)(\s+(?:is not|isn't|is|=|!=)\s+.+)$/i;
const SETTING_LINE = /^(\s*)([A-Za-z][A-Za-z ]{0,24}?)(\s*:\s?)(.*)$/;
/** The settings that may name a column. */
const COLUMN_KEYS = ['count', 'by', 'colour by', 'color by', 'colour', 'color', 'coloured by', 'colored by', 'icon', 'flag'];

/**
 * A chart's column renamed: its header's cell, and every setting naming it (what it counts,
 * by, colours by, a row's icon or flag, a filter). Answers the block, or it as it was for a
 * name left empty or already another column's.
 */
export function renameColumn(source, from, to) {
  const name = String(to ?? '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  const chart = readChart(source);
  const header = (chart.table?.header ?? []).map((cell) => plainText(cell));
  if (!name || fold(name) === fold(from) || !header.some((cell) => fold(cell) === fold(from))
    || header.some((cell) => fold(cell) === fold(name))) return source;
  const lines = [...chart.lines];
  if (chart.tableFrom >= 0) {
    const cells = header.map((cell) => (fold(cell) === fold(from) ? name : cell));
    lines[chart.tableFrom] = `| ${cells.map((cell) => escapeCell(cell)).join(' | ')} |`;
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (index >= chart.tableFrom && index <= chart.tableTo) continue;
    const only = ONLY_LINE.exec(lines[index]);
    if (only) {
      if (fold(only[2]) === fold(from)) lines[index] = `${only[1]}${name}${only[3]}`;
      continue;
    }
    const found = SETTING_LINE.exec(lines[index]);
    if (found && COLUMN_KEYS.includes(found[2].split(/\s+/).join(' ').toLowerCase()) && fold(found[4]) === fold(from)) {
      lines[index] = `${found[1]}${found[2]}${found[3]}${name}`;
    }
  }
  return lines.join('\n');
}

/** What a column does in a chart template, from its own lines: '' for a column it reads otherwise. */
export function columnRole(source, column) {
  const chart = readChart(source);
  const kind = (setting(chart, 'kind') || 'bars').toLowerCase();
  const same = (key) => fold(setting(chart, key)) === fold(column);
  if (kind === 'timeline') {
    const header = (chart.table?.header ?? []).map((cell) => plainText(cell));
    if (same('by')) return 'what';
    if (/\b(?:until|end|to|till)\b/i.test(column)) return 'until';
    return fold(header[0]) === fold(column) ? 'when' : '';
  }
  if (kind === 'line') return same('by') ? 'along' : same('count') ? 'value' : same('colour by') ? 'series' : '';
  if (same('count')) return 'count';
  if (same('colour by')) return 'colour by';
  if (same('by')) return FORMS[kind]?.colours && !FORMS[kind]?.split ? 'parts' : 'by';
  if (same('icon')) return 'icon';
  if (same('flag')) return 'flag';
  return '';
}

/** Whether a chart counts its rows rather than a column. */
export const countsRows = (source) => {
  const count = setting(readChart(source), 'count').toLowerCase();
  return !count || count === ROWS;
};

/** The kinds a chart template may turn into: the kinds of its form's family, the shape of its table kept. */
export function kindChoices(kind) {
  const family = FORMS[kind]?.family;
  if (!family || family !== 'categories') return [kind];
  return Object.entries(FORMS).filter(([, form]) => form.family === family).map(([name]) => name);
}

/** The width words, for the editor's rows. */
export { HALF, WIDE };
