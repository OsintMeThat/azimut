/**
 * What an infographic's panels are made from, read the way the chart block reads a table:
 * the note's own tables, each drawn as every kind it fits by the chart's kind picker
 * (`POST /notes/figure/kinds`, `chartKinds`), and the panel the one picked writes, its
 * rows copied in and `from:` saying where they came from (`chartText.chartOfTable`). The builder's
 * Add a panel and `/` › Infographic's starter both go through here, so a chart made for a
 * page is written exactly as a chart made under its table.
 */
import { chartKinds } from './chartFigure.js';
import { CHART_OPEN, chartOfTable, headingAbove } from './chartText.js';
import { EMPTY_INFOGRAPHIC, HALF, WIDE, infographicsIn } from './infographicText.js';
import { tablesIn } from './tableText.js';

const CLOSE = /^:::[ \t]*$/;
const MAP_OPEN = /^:::[ \t]*map[ \t]*$/;

/** The kinds a starter picks, in the order it prefers them: its key figures, its main chart, its parts. */
export const STARTER_FIGURES = ['key figures'];
export const STARTER_MAIN = ['silhouette rows', 'stacked columns', 'stacked bars', 'columns', 'bars', 'pictograms'];
export const STARTER_PARTS = ['donut', 'segments', 'pie'];
/** Kinds that span the page in a starter. */
const WIDE_KINDS = ['key figures', 'timeline'];

/** The lines of a note held by `:::` blocks drawn whole (a chart, a map) and by infographics: no panel is made from what they hold. */
function heldLines(lines, text) {
  const held = new Set();
  for (const found of infographicsIn(text)) for (let line = found.first; line <= found.last; line += 1) held.add(line);
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(```|~~~)/.test(lines[index])) fenced = !fenced;
    if (fenced || held.has(index) || !(CHART_OPEN.test(lines[index]) || MAP_OPEN.test(lines[index]))) continue;
    let end = index + 1;
    while (end < lines.length && !CLOSE.test(lines[end])) end += 1;
    for (let line = index; line <= Math.min(end, lines.length - 1); line += 1) held.add(line);
    index = end;
  }
  return held;
}

/** The note's own tables, outside charts, maps and infographics: `{ from, to, line, table, heading }`. */
export function noteTables(text) {
  const source = String(text ?? '');
  const held = heldLines(source.split('\n'), source);
  return tablesIn(source).filter((found) => !held.has(found.line))
    .map((found) => ({ ...found, heading: headingAbove(source, found.line) }));
}

/** The note's maps outside its infographics: `{ title, block }`, each a whole `::: map` block. */
export function noteMaps(text) {
  const lines = String(text ?? '').split('\n');
  const inside = new Set();
  for (const found of infographicsIn(text)) for (let line = found.first; line <= found.last; line += 1) inside.add(line);
  const maps = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(```|~~~)/.test(lines[index])) { fenced = !fenced; continue; }
    if (fenced || inside.has(index) || !MAP_OPEN.test(lines[index])) continue;
    let end = index + 1;
    while (end < lines.length && !CLOSE.test(lines[end])) end += 1;
    if (end >= lines.length) break;
    const block = lines.slice(index, end + 1).join('\n');
    const title = (/^\s*title\s*:\s*(.*)$/im.exec(block) ?? [])[1]?.trim() ?? '';
    maps.push({ title, block });
    index = end;
  }
  return maps;
}

/** The chart panel kind `kind` (an answer of the kind picker) makes of the note's table `found`. */
export function chartPanel(text, found, kind, noteId = '') {
  return chartOfTable(String(text ?? ''), found, kind, noteId);
}

/**
 * What a starter is made of, from each table's kinds (`[{ found, kinds }]`): its key
 * figures, its main chart and a chart of its parts, each the first kind of its list any
 * table fits, two never the same table drawn the same way. `[{ found, kind }]`.
 */
export function pickStarter(galleries) {
  const picked = [];
  const taken = new Set();
  for (const names of [STARTER_FIGURES, STARTER_MAIN, STARTER_PARTS]) {
    let chosen = null;
    for (const name of names) {
      for (const { found, kinds } of galleries) {
        const kind = (kinds ?? []).find((one) => one.kind === name);
        if (kind && !taken.has(`${found.line}:${name}`)) { chosen = { found, kind }; break; }
      }
      if (chosen) break;
    }
    if (chosen) {
      taken.add(`${chosen.found.line}:${chosen.kind.kind}`);
      picked.push(chosen);
    }
  }
  return picked;
}

/** A starter page of `panels` (`[{ text, wide }]`): every panel's width written, a lone half one at the end made wide. */
export function starterText(panels) {
  if (!panels.length) return EMPTY_INFOGRAPHIC;
  const widths = panels.map((panel) => (panel.wide ? WIDE : HALF));
  if (widths.filter((width) => width === HALF).length % 2 === 1) widths[widths.lastIndexOf(HALF)] = WIDE;
  return [':::: infographic', `widths: ${widths.join(', ')}`, '', panels.map((panel) => panel.text).join('\n\n'), '::::'].join('\n');
}

/**
 * `/` › Infographic's starter from a note's text: its key figures, its main chart and a
 * donut, each made from the note's own tables by the kind picker, and its first map; the
 * empty page, saying how to fill it, when the note holds none. Never numbers it does not hold.
 */
export async function starterFor({ caseId, noteId = '', text }, { ask = chartKinds } = {}) {
  const tables = caseId ? noteTables(text) : [];
  const galleries = [];
  for (const found of tables.slice(0, 6)) {
    const answer = await ask({ caseId, noteId, text: String(text).slice(found.from, found.to) });
    if (!answer?.error) galleries.push({ found, kinds: answer.kinds ?? [] });
  }
  const panels = pickStarter(galleries).map(({ found, kind }) => ({
    text: chartPanel(text, found, kind, noteId), wide: WIDE_KINDS.includes(kind.kind),
  }));
  const [map] = noteMaps(text);
  if (map) panels.push({ text: map.block, wide: false });
  return starterText(panels);
}
