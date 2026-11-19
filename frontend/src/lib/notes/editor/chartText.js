/**
 * A chart block's text, read and written as the engine reads it
 * (`engine/notes_charts.py`): its settings as `key: value` lines under `::: chart`,
 * then its table, then `:::`. Nothing here touches the editor.
 *
 * Writing changes only the lines a gesture touches: a setting is its own line,
 * replaced where it stands, put where the Notebook writes it (`WRITTEN_ORDER`) when it
 * is new, taken out when it is emptied. Every other line, a setting written another
 * way included, stays as it was.
 *
 * Where the rows came from (`from:`) is written as the engine reads it
 * (`engine/notecharts.py`): `note:<id>#<heading>` is the first table under that
 * heading, `#<heading>/<n>` its n-th, `#/<n>` the n-th of the note. A chart's own rows
 * are never counted as a table there.
 */
import { plainText, parseTable } from './tableText.js';

/** The fence a chart opens with. */
export const CHART_OPEN = /^:::[ \t]*chart[ \t]*$/;
const CLOSE = /^:::[ \t]*$/;
const SETTING = /^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s?(.*)$/;

/** Every way a setting may be written, to the one word the Notebook writes (`notes_charts.KEYS`). */
export const CHART_KEYS = {
  kind: 'kind', type: 'kind', title: 'title', caption: 'caption', count: 'count', by: 'by',
  'colour by': 'colour by', 'color by': 'colour by', colour: 'colour by', color: 'colour by', 'coloured by': 'colour by', 'colored by': 'colour by',
  order: 'order', colours: 'colours', colors: 'colours', only: 'only', highlight: 'highlight', sort: 'sort', last: 'last', show: 'show',
  bars: 'bars', source: 'source', sources: 'source', credit: 'source', from: 'from', rows: 'rows', style: 'style',
  // what a kind reads besides (`Kind.keys` in `engine/notes_charts.py`)
  centre: 'centre', center: 'center', icon: 'icon', 'per glyph': 'per glyph', flag: 'flag', of: 'of', squares: 'squares',
  icons: 'icons', flags: 'flags',
};

/** The order the Notebook writes settings in (`notes_charts.WRITTEN_ORDER`), a kind's own next, then the last ones. */
export const WRITTEN_ORDER = ['kind', 'title', 'caption', 'count', 'by', 'colour by', 'order', 'colours', 'only', 'highlight', 'sort', 'last', 'show', 'bars'];
export const WRITTEN_LAST = ['source', 'from', 'rows', 'style'];
/** `rows: own`: the rows are the chart's own, typed in its form, never an infographic's data (`notes_charts.OWN_ROWS`). */
export const OWN_ROWS = 'own';

/** What `count:` says to count rows. */
export const ROWS = 'rows';
/** The two ways a chart shows, and its three looks (`notes_charts.SHOWS`, `STYLES`). */
export const SHOWS = ['chart', 'chart and table'];
export const STYLES = ['report', 'book', 'dark'];

function rank(key) {
  const at = WRITTEN_ORDER.indexOf(key);
  if (at >= 0) return at;
  const last = WRITTEN_LAST.indexOf(key);
  return last >= 0 ? WRITTEN_ORDER.length + 1 + last : WRITTEN_ORDER.length;
}

/** A setting line's key as the Notebook writes it, or '' for a line that is no setting. */
function keyOf(line) {
  const found = SETTING.exec(line.trim());
  if (!found) return '';
  return CHART_KEYS[found[1].split(/\s+/).join(' ').toLowerCase()] ?? '';
}

/**
 * A chart block read: `lines` (its own), `settings` (key → `{ value, line }`, the first
 * of each, as the engine reads it), and its table: the `table` (`tableText.js`), its
 * `text` and the lines it spans (`tableFrom`, `tableTo`, -1 without one).
 */
export function readChart(source) {
  const lines = String(source ?? '').split('\n');
  const last = CLOSE.test(lines.at(-1) ?? '') && lines.length > 1 ? lines.length - 1 : lines.length;
  const settings = {};
  let tableFrom = -1;
  let tableTo = -1;
  for (let index = CHART_OPEN.test(lines[0] ?? '') ? 1 : 0; index < last; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('|')) {
      if (tableFrom >= 0) continue;
      tableFrom = index;
      tableTo = index;
      while (tableTo + 1 < last && lines[tableTo + 1].trim().startsWith('|')) tableTo += 1;
      index = tableTo;
      continue;
    }
    const key = keyOf(line);
    if (key && !(key in settings)) settings[key] = { value: SETTING.exec(line.trim())[2].split(/\s+/).join(' ').trim(), line: index };
  }
  const text = tableFrom >= 0 ? lines.slice(tableFrom, tableTo + 1).join('\n') : '';
  return { lines, settings, tableFrom, tableTo, text, table: text ? parseTable(text) : null };
}

/** A setting's value as written, '' when it is not. */
export function setting(chart, key) {
  return chart.settings[key]?.value ?? '';
}

/**
 * The block with `changes` written (`{ key: value }`, '' taking a line out): a setting
 * written is replaced where it stands, a new one put where the Notebook writes it.
 */
export function withSettings(source, changes) {
  const chart = readChart(source);
  const lines = [...chart.lines];
  const out = [];
  const keys = Object.keys(changes);
  // what is replaced or taken out, where it stands
  const gone = new Set();
  for (const key of keys) {
    const at = chart.settings[key]?.line;
    if (at === undefined) continue;
    const value = String(changes[key] ?? '').trim();
    if (value) lines[at] = `${key}: ${value}`;
    else gone.add(at);
  }
  // a new one goes after the last setting written before it in the Notebook's order
  const fresh = keys.filter((key) => chart.settings[key] === undefined && String(changes[key] ?? '').trim());
  const placed = new Map();
  const end = chart.tableFrom >= 0 ? chart.tableFrom : Math.max(1, lines.length - 1);
  for (const key of fresh) {
    let after = CHART_OPEN.test(lines[0] ?? '') ? 0 : -1;
    for (let index = after + 1; index < end; index += 1) {
      const there = keyOf(lines[index]);
      if (there && rank(there) <= rank(key)) after = index;
    }
    if (!placed.has(after)) placed.set(after, []);
    placed.get(after).push(key);
  }
  if (placed.has(-1)) out.push(...placed.get(-1).sort((a, b) => rank(a) - rank(b)).map((key) => `${key}: ${String(changes[key]).trim()}`));
  lines.forEach((line, index) => {
    if (!gone.has(index)) out.push(line);
    if (placed.has(index)) out.push(...placed.get(index).sort((a, b) => rank(a) - rank(b)).map((key) => `${key}: ${String(changes[key]).trim()}`));
  });
  return out.join('\n');
}

/** The block with its table's lines replaced by `text`, the settings left as they are. */
export function withTable(source, text) {
  const chart = readChart(source);
  if (chart.tableFrom < 0) {
    const lines = [...chart.lines];
    const at = CLOSE.test(lines.at(-1) ?? '') && lines.length > 1 ? lines.length - 1 : lines.length;
    lines.splice(at, 0, text);
    return lines.join('\n');
  }
  return [...chart.lines.slice(0, chart.tableFrom), text, ...chart.lines.slice(chart.tableTo + 1)].join('\n');
}

/**
 * The block a kind picked from a note's table writes: its settings, the title its data
 * proposes, where its rows came from and the rows. `text` is the note's text, `found` the
 * table in it (`{ from, to, line }`), `kind` the kind picker's answer; `noteId` names the
 * note they are in, and a note with none (a template) writes no `from:`.
 */
export function chartOfTable(text, found, kind, noteId = '') {
  const note = String(text ?? '');
  const settings = { ...kind.settings, title: kind.title ?? '' };
  if (noteId) settings.from = originFor(noteId, note, found.line ?? note.slice(0, found.from).split('\n').length - 1);
  return newChart(settings, note.slice(found.from, found.to));
}

/** A new chart block: `settings` in the Notebook's order, then the table's lines as they stand. */
export function newChart(settings, tableText) {
  const keys = Object.keys(settings).filter((key) => String(settings[key] ?? '').trim()).sort((a, b) => rank(a) - rank(b));
  return ['::: chart', ...keys.map((key) => `${key}: ${String(settings[key]).trim()}`), String(tableText).replace(/\n+$/, ''), ':::'].join('\n');
}

// -- where the rows came from ---------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** A heading's anchor as the HTML report names it (`notecharts.slug`). */
export function slug(words) {
  const folded = String(words ?? '').normalize('NFKC').toLowerCase().replace(/ß/g, 'ss');
  const cut = (text) => text.replace(/^[-_]+|[-_]+$/g, '');
  return cut(Array.from(cut(folded.replace(/[^\p{L}\p{N}_]+/gu, '-'))).slice(0, 60).join(''));
}

/** The tables a note's lines hold as the engine counts them, `{ line, end }`, a chart's own rows left out. */
function noteTables(lines) {
  const found = [];
  let fenced = false;
  let charted = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (CHART_OPEN.test(line)) charted = true;
    else if (charted && CLOSE.test(line)) charted = false;
    else if (!charted && line.trim().startsWith('|')) {
      let end = index;
      while (end + 1 < lines.length && lines[end + 1].trim().startsWith('|')) end += 1;
      if (end > index && RULE.test(lines[index + 1].trim())) found.push({ line: index, end });
      index = end;
    }
  }
  return found;
}

/** The headings of a note's lines, outside code: `{ line, level, slug }`. */
function headings(lines) {
  const found = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced && HEADING.test(line)) {
      const [, marks, words] = HEADING.exec(line);
      found.push({ line: index, level: marks.length, slug: slug(words) });
    }
  });
  return found;
}

/** The words of the heading above line `line` of a note's text, its marks taken off, or ''. */
export function headingAbove(text, line) {
  const lines = String(text ?? '').split('\n');
  const above = headings(lines).filter((heading) => heading.line < line).at(-1);
  return above ? plainText(HEADING.exec(lines[above.line])[2]) : '';
}

/** The lines `anchor` reads in: the note's, or under the first heading of that name, to the next of its level. */
function stretch(lines, anchor) {
  if (!anchor) return { from: 0, to: lines.length };
  const all = headings(lines);
  const at = all.findIndex((heading) => heading.slug === slug(anchor));
  if (at < 0) return null;
  const next = all.slice(at + 1).find((heading) => heading.level <= all[at].level);
  return { from: all[at].line + 1, to: next ? next.line : lines.length };
}

/** The 0-based line of the table `anchor` names in a note's text (`#heading`, `#heading/2`, `#/2`), or -1. */
export function tableUnder(text, anchor = '') {
  const lines = String(text ?? '').split('\n');
  const [name, nth] = String(anchor ?? '').split('/');
  const wanted = /^\d+$/.test(nth ?? '') && Number(nth) > 0 ? Number(nth) : 1;
  const within = stretch(lines, name.trim());
  if (!within) return -1;
  const tables = noteTables(lines).filter((table) => table.line >= within.from && table.line < within.to);
  return tables[wanted - 1]?.line ?? -1;
}

/**
 * The anchor that names the table whose header is on `line` of a note's text: its
 * heading's name, with `/<n>` when it is not the first table under it, or `/<n>` from
 * the note's start when no heading names it. '' for the note's first table.
 */
export function anchorFor(text, line) {
  const lines = String(text ?? '').split('\n');
  const above = headings(lines).filter((heading) => heading.line < line).at(-1);
  const tries = above ? [above.slug, ''] : [''];
  for (const name of tries) {
    const within = stretch(lines, name);
    if (!within) continue;
    const tables = noteTables(lines).filter((table) => table.line >= within.from && table.line < within.to);
    const at = tables.findIndex((table) => table.line === line);
    if (at < 0) continue;
    if (!name) return at === 0 ? '' : `/${at + 1}`;
    return at === 0 ? name : `${name}/${at + 1}`;
  }
  return '';
}

/** `from:` read: `{ kind: 'note', id, anchor }`, `{ kind: 'sheet', id }`, or null. */
export function readOrigin(value) {
  const found = /^\s*(note|sheet)\s*:\s*([^#\s]+)\s*(?:#(.*))?$/i.exec(String(value ?? ''));
  if (!found) return null;
  return { kind: found[1].toLowerCase(), id: found[2], anchor: (found[3] ?? '').trim() };
}

/** What `from:` says for a table of note `noteId` whose header is on `line` of `text`. */
export function originFor(noteId, text, line) {
  const anchor = anchorFor(text, line);
  return `note:${noteId}${anchor ? `#${anchor}` : ''}`;
}

/**
 * Whether a chart's rows are those of the table they were copied from, kept to the
 * chart's own columns and in any order (`notecharts.origin_warning`): `'same'`,
 * `'differs'`, or `'columns'` when the source has none of the chart's columns.
 */
export function compareRows(chartTable, sourceTable) {
  const fold = (words) => plainText(words).split(/\s+/).join(' ').toLowerCase();
  const theirs = new Map(sourceTable.header.map((header, at) => [fold(header), at]));
  const shared = chartTable.header.map((header, at) => [at, theirs.get(fold(header))]).filter(([, at]) => at !== undefined);
  if (!shared.length) return 'columns';
  const counted = (rows, pick) => {
    const counts = new Map();
    for (const row of rows) {
      const key = JSON.stringify(shared.map((pair) => plainText(row[pick(pair)] ?? '')));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const mine = counted(chartTable.rows, ([at]) => at);
  const other = counted(sourceTable.rows, ([, at]) => at);
  if (mine.size !== other.size) return 'differs';
  for (const [key, count] of mine) if (other.get(key) !== count) return 'differs';
  return 'same';
}
