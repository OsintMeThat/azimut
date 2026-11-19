/**
 * An infographic's text, read and written as the engine reads it
 * (`engine/notes_infographic.py`): a `:::: infographic` fence of four colons holding its
 * own lines (kicker, title, standfirst, look, legend, widths) and then its panels, each a
 * `::: chart` or `::: map` block or the words between two blocks. Nothing here touches
 * the editor: the builder hands each result to it as one change, so one Undo.
 *
 * Writing changes only the lines a gesture touches: a setting is its own line, replaced
 * where it stands, put after the others when it is new, taken out when emptied; a panel
 * moves as its lines, and `widths:` moves with it so each panel keeps its width.
 */

export const INFOGRAPHIC_OPEN = /^::::[ \t]*infographic[ \t]*$/;
export const INFOGRAPHIC_CLOSE = /^::::[ \t]*$/;
const INNER_OPEN = /^:::[ \t]*(chart|map)[ \t]*$/;
const INNER_CLOSE = /^:::[ \t]*$/;
const SETTING = /^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s?(.*)$/;
const COMMENT_ONLY = /^\s*(?:<!--[\s\S]*?-->\s*)+$/;

/** Every way a setting may be written, to the one word the Notebook writes (`notes_infographic.KEYS`). */
export const INFOGRAPHIC_KEYS = {
  kicker: 'kicker', eyebrow: 'kicker', title: 'title', headline: 'title',
  standfirst: 'standfirst', subtitle: 'standfirst', dek: 'standfirst', intro: 'standfirst',
  look: 'look', style: 'look', widths: 'widths', width: 'widths', panels: 'widths', legend: 'legend',
};
export const WRITTEN_ORDER = ['kicker', 'title', 'standfirst', 'look', 'legend', 'widths'];
export const HALF = 'half';
export const WIDE = 'wide';
/** The three looks, whole presets (`notes_charts.STYLES`). */
export const LOOKS = ['report', 'book', 'dark'];
/** What `legend:` says to keep one legend per chart. */
export const EACH_PANEL = 'each panel';
/** The chart kinds that span the page unless `widths:` says otherwise. */
const WIDE_KINDS = ['key figures', 'timeline'];

function keyOf(line) {
  const found = SETTING.exec(line.trim());
  if (!found) return '';
  return INFOGRAPHIC_KEYS[found[1].split(/\s+/).join(' ').toLowerCase()] ?? '';
}

/** Every infographic in a note's text, outside code fences: `{ from, to, first, last, source }`, offsets and 0-based lines. */
export function infographicsIn(text) {
  const lines = String(text ?? '').split('\n');
  const found = [];
  let offset = 0;
  const starts = lines.map((line) => { const at = offset; offset += line.length + 1; return at; });
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(```|~~~)/.test(lines[index])) { fenced = !fenced; continue; }
    if (fenced || !INFOGRAPHIC_OPEN.test(lines[index])) continue;
    let end = index + 1;
    while (end < lines.length && !INFOGRAPHIC_CLOSE.test(lines[end])) end += 1;
    if (end >= lines.length) break;
    found.push({
      from: starts[index], to: starts[end] + lines[end].length, first: index, last: end,
      source: lines.slice(index, end + 1).join('\n'),
    });
    index = end;
  }
  return found;
}

/** A chart's kind and title as its lines write them. */
function chartSaid(lines) {
  const said = { kind: '', title: '' };
  for (const line of lines) {
    if (line.trim().startsWith('|')) break;
    const found = SETTING.exec(line.trim());
    if (!found) continue;
    const key = found[1].trim().toLowerCase();
    if ((key === 'kind' || key === 'type') && !said.kind) said.kind = found[2].trim().toLowerCase();
    if (key === 'title' && !said.title) said.title = found[2].trim();
  }
  return said;
}

/** The width a panel takes when `widths:` does not say: words, key figures and a timeline span the page. */
export function defaultWidth(panel) {
  if (panel.kind === 'words') return WIDE;
  if (panel.kind === 'chart' && WIDE_KINDS.includes(panel.chartKind)) return WIDE;
  return HALF;
}

/**
 * An infographic block read: `lines` (the whole block, its fences included),
 * `settings` (key → `{ value, line }`, the first of each), and `panels`, each
 * `{ kind, from, to, title, chartKind, written, width }`, `from`–`to` its lines (both
 * included, a block's fences with it).
 */
export function readInfographic(source) {
  const lines = String(source ?? '').split('\n');
  const last = lines.length > 1 && INFOGRAPHIC_CLOSE.test(lines.at(-1)) ? lines.length - 1 : lines.length;
  const settings = {};
  let index = INFOGRAPHIC_OPEN.test(lines[0] ?? '') ? 1 : 0;
  let settingsEnd = index;
  for (; index < last; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const key = keyOf(line);
    if (!key || INNER_OPEN.test(line)) break;
    if (!(key in settings)) settings[key] = { value: SETTING.exec(line.trim())[2].trim(), line: index };
    settingsEnd = index + 1;
  }
  const panels = [];
  let words = null;
  const closeWords = (end) => {
    if (!words) return;
    let from = words;
    let to = end;
    while (from <= to && !lines[from].trim()) from += 1;
    while (to >= from && !lines[to].trim()) to -= 1;
    const text = lines.slice(from, to + 1).join('\n');
    if (from <= to && !COMMENT_ONLY.test(text)) {
      const heading = lines.slice(from, to + 1).find((line) => /^#{1,6}\s/.test(line));
      const first = lines.slice(from, to + 1).find((line) => line.trim() && !line.trim().startsWith('<!--')) ?? '';
      panels.push({ kind: 'words', from, to, title: (heading ?? first).replace(/^#{1,6}\s+/, '').trim(), chartKind: '' });
    }
    words = null;
  };
  for (; index < last; index += 1) {
    const opened = INNER_OPEN.exec(lines[index]);
    if (!opened) {
      if (words === null) words = index;
      continue;
    }
    let end = index + 1;
    while (end < last && !INNER_CLOSE.test(lines[end])) end += 1;
    if (end >= last) {
      if (words === null) words = index;
      index = last;
      break;
    }
    closeWords(index - 1);
    const inner = lines.slice(index + 1, end);
    const said = opened[1] === 'chart' ? chartSaid(inner) : { kind: '', title: (inner.map((line) => /^\s*title\s*:\s*(.*)$/i.exec(line)).find(Boolean) ?? [])[1] ?? '' };
    panels.push({ kind: opened[1], from: index, to: end, title: said.title, chartKind: said.kind });
    index = end;
  }
  closeWords(last - 1);
  const widths = widthWords(settings.widths?.value ?? '');
  panels.forEach((panel, at) => {
    panel.written = widths[at] ?? '';
    panel.width = panel.written || defaultWidth(panel);
  });
  return { lines, settings, panels, settingsEnd, last };
}

function widthWords(value) {
  return String(value ?? '').split(',').map((word) => word.trim().toLowerCase()).filter(Boolean)
    .map((word) => (word === HALF || word === WIDE ? word : ''));
}

/** The infographic's lines with `key` set to `value` (one line, in place), or taken out when `value` is empty. */
export function withSetting(source, key, value) {
  const read = readInfographic(source);
  const lines = [...read.lines];
  const said = String(value ?? '').replace(/\s+/g, ' ').trim();
  const at = read.settings[key]?.line;
  if (at !== undefined) {
    if (said) lines[at] = `${key}: ${said}`;
    else lines.splice(at, 1);
    return lines.join('\n');
  }
  if (!said) return source;
  // a new setting goes where the Notebook writes it: after the ones before it in the order
  const rank = WRITTEN_ORDER.indexOf(key);
  const before = Object.entries(read.settings)
    .filter(([name]) => WRITTEN_ORDER.indexOf(name) <= rank)
    .map(([, setting]) => setting.line);
  const after = Object.entries(read.settings)
    .filter(([name]) => WRITTEN_ORDER.indexOf(name) > rank)
    .map(([, setting]) => setting.line);
  const place = before.length ? Math.max(...before) + 1 : after.length ? Math.min(...after) : read.settingsEnd;
  lines.splice(place, 0, `${key}: ${said}`);
  return lines.join('\n');
}

/** `widths:` as the panels now stand, each its written width or, past them, its kind's; none when every panel takes its kind's. */
function widthsLine(panels) {
  if (panels.every((panel) => panel.width === defaultWidth(panel))) return '';
  return panels.map((panel) => panel.width).join(', ');
}

/** Panel `index` set to `width` (`half` or `wide`): one change to `widths:`. */
export function withWidth(source, index, width) {
  const read = readInfographic(source);
  if (!read.panels[index] || ![HALF, WIDE].includes(width)) return source;
  read.panels[index].width = width;
  return withSetting(source, 'widths', widthsLine(read.panels));
}

/** The text a panel holds, its lines from `from` to `to`. */
export function panelText(source, index) {
  const read = readInfographic(source);
  const panel = read.panels[index];
  return panel ? read.lines.slice(panel.from, panel.to + 1).join('\n') : '';
}

/** Panel `index`'s lines replaced by `text` (a chart's settings written by its card), the rest as it was. */
export function withPanelText(source, index, text) {
  const read = readInfographic(source);
  const panel = read.panels[index];
  if (!panel) return source;
  const lines = [...read.lines];
  lines.splice(panel.from, panel.to - panel.from + 1, ...String(text).split('\n'));
  return lines.join('\n');
}

/**
 * Panel `from` moved to stand at `to` (its place after the move): its lines go, a blank
 * line keeps it apart from its neighbours, and `widths:` moves with it.
 */
export function movePanel(source, from, to) {
  const read = readInfographic(source);
  const { panels } = read;
  if (from === to || !panels[from] || to < 0 || to >= panels.length) return source;
  const order = panels.map((_, at) => at);
  order.splice(to, 0, order.splice(from, 1)[0]);
  return withPanels(read, order.map((at) => ({ text: read.lines.slice(panels[at].from, panels[at].to + 1).join('\n'), panel: panels[at] })));
}

/** The infographic written again with these panels, in order, its own lines kept as they were. */
function withPanels(read, kept) {
  const head = read.lines.slice(0, read.settingsEnd);
  const body = kept.map((one) => one.text).join('\n\n');
  const close = read.lines.slice(read.last);
  const text = [...head, '', ...(body ? body.split('\n') : []), ...close].join('\n');
  const panels = kept.map((one) => ({ ...one.panel }));
  return withSetting(text, 'widths', widthsLine(panels));
}

/** A panel added at the end (`text` a whole `::: chart` or `::: map` block, or words), `width` its width. */
export function addPanel(source, text, width = '') {
  const read = readInfographic(source);
  const kept = read.panels.map((panel) => ({ text: read.lines.slice(panel.from, panel.to + 1).join('\n'), panel }));
  const added = readInfographic(`:::: infographic\n${text}\n::::`).panels[0];
  if (!added) return source;
  added.width = width === HALF || width === WIDE ? width : defaultWidth(added);
  kept.push({ text: String(text).trim(), panel: added });
  return withPanels(read, kept);
}

/** Panel `index` taken out, with its width. */
export function removePanel(source, index) {
  const read = readInfographic(source);
  if (!read.panels[index]) return source;
  const kept = read.panels.map((panel) => ({ text: read.lines.slice(panel.from, panel.to + 1).join('\n'), panel }))
    .filter((_, at) => at !== index);
  return withPanels(read, kept);
}

/** One legend on top for a colour column the charts share, or one each: the `legend:` line. */
export function withLegend(source, shared) {
  return withSetting(source, 'legend', shared ? '' : EACH_PANEL);
}

/** Whether the page draws one shared legend (it does unless `legend: each panel`). */
export function sharesLegend(source) {
  return String(readInfographic(source).settings.legend?.value ?? '').toLowerCase() !== EACH_PANEL;
}

/** An empty infographic, with the line that says how to fill it (never printed). */
export const EMPTY_INFOGRAPHIC = ':::: infographic\n<!--? Add its panels from the builder beside the note: a chart from a table of this note, a map, words -->\n::::';

/** A words panel to start from: a heading and a line the analyst writes over. */
export const WORDS_PANEL = '### A heading\nA few words about what the panels show.';

/** A key figures chart to fill in: two figures with the words under them. */
export const KEY_FIGURES_PANEL = '::: chart\nkind: key figures\n| Figure | Words |\n| --- | --- |\n|  |  |\n|  |  |\n:::';
