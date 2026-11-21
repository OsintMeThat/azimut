/**
 * A figure's copy of its rows follows its source by itself: no Read again. A chart whose
 * `from:` names a sheet or a table, a panel of an infographic with a `from:` of its own, and
 * the panels that take an infographic's `data:` keep a copy of the rows in the note, which
 * the PDF and the pages read. When the editor finds the source changed (a chart or a page
 * coming into sight, the Notebook shown again, the window back, the note opened), it rewrites
 * every copy of that source in the note at once.
 *
 * - **One transaction**, added to the history: Ctrl+Z brings the old copy back. What Undo
 *   brought back stays: the same source is never followed twice to the same rows, until the
 *   source changes once more, or comes back to the copy by itself (`settled`).
 * - A copy whose columns the source no longer has is left as it is.
 * - Only a note that can be written is rewritten; a read-only view draws the fresh rows.
 */
import { isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';

import { CHART_OPEN, compareRows, readChart, readOrigin, setting, withTable } from './chartText.js';
import { dataOf, infographicsIn, inheritingPanels, readInfographic } from './infographicText.js';
import { lineChanges, parseTable, plainText } from './tableText.js';

/** What a following writes as: no typing, no step of the analyst's to join. */
export const FOLLOW_EVENT = 'input.follow';

const CLOSE = /^:::[ \t]*$/;
const FENCE = /^\s*(```|~~~)/;

/** An origin as one key, however it was written: `sheet:s1`, `note:n2#count`; '' for none. */
export function originKey(written) {
  const origin = readOrigin(written);
  return origin ? `${origin.kind}:${origin.id}${origin.anchor ? `#${origin.anchor}` : ''}` : '';
}

/** Every chart block of a note's text, `{ from, to, source }`, an infographic's panels included, none in code. */
export function chartBlocks(text) {
  const lines = String(text ?? '').split('\n');
  const found = [];
  let offset = 0;
  let fenced = false;
  let open = null;
  for (const line of lines) {
    if (!open && FENCE.test(line)) fenced = !fenced;
    else if (!fenced && !open && CHART_OPEN.test(line)) open = offset;
    else if (open !== null && CLOSE.test(line)) {
      const to = offset + line.length;
      found.push({ from: open, to, source: String(text).slice(open, to) });
      open = null;
    }
    offset += line.length + 1;
  }
  return found;
}

/**
 * The changes that bring every copy of `origin`'s rows in `text` up to `rows` (a table's
 * Markdown): each chart and panel whose `from:` names it and whose rows differ, and each
 * infographic whose `data:` names it, in the panels that take it. `[{ from, to, insert }]`,
 * the changed lines only; [] when every copy matches.
 */
export function followChanges(text, origin, rows) {
  const key = originKey(origin);
  const table = parseTable(rows);
  if (!key || !table) return [];
  const changes = [];
  const add = (from, before, after) => {
    if (after === before) return;
    for (const piece of lineChanges(before, after)) changes.push({ from: from + piece.from, to: from + piece.to, insert: piece.insert });
  };
  for (const block of chartBlocks(text)) {
    const chart = readChart(block.source);
    if (originKey(setting(chart, 'from')) !== key || !chart.table) continue;
    if (compareRows(chart.table, table) === 'differs') add(block.from, block.source, withTable(block.source, rows));
  }
  // the panels that take a page's data: each changed on its own lines, never a page rewritten whole
  const columns = table.header.map((cell) => plainText(cell));
  for (const page of infographicsIn(text)) {
    if (originKey(dataOf(page.source)) !== key) continue;
    const read = readInfographic(page.source);
    const starts = [];
    read.lines.reduce((at, line) => {
      starts.push(at);
      return at + line.length + 1;
    }, 0);
    for (const index of inheritingPanels(page.source, columns)) {
      const panel = read.panels[index];
      const before = read.lines.slice(panel.from, panel.to + 1).join('\n');
      const own = readChart(before).table;
      if (own && compareRows(own, table) !== 'differs') continue;
      add(page.from + starts[panel.from], before, withTable(before, rows));
    }
  }
  return changes.sort((a, b) => a.from - b.from);
}

const followed = new WeakMap();

function memory(view) {
  let kept = followed.get(view);
  if (!kept) {
    kept = new Map();
    followed.set(view, kept);
  }
  return kept;
}

/**
 * Rewrite every copy of `origin` in the note `view` holds to `rows`, as one transaction
 * added to the history, unless this very source was followed to these very rows already
 * (an Undo took them back). Answers whether the note was written.
 */
export function followSource(view, origin, rows) {
  const key = originKey(origin);
  if (!key || !rows || view.state.readOnly) return false;
  const kept = memory(view);
  if (kept.get(key) === rows) return false;
  const changes = followChanges(view.state.doc.toString(), origin, rows);
  kept.set(key, rows);
  if (!changes.length) return false;
  view.dispatch({ changes, annotations: [isolateHistory.of('full'), Transaction.userEvent.of(FOLLOW_EVENT)] });
  return true;
}

/** A write in the source itself: `origin` is followed on its next change, whatever Undo kept before. */
export function forgetFollow(view, origin) {
  memory(view).delete(originKey(origin));
}

/**
 * The copies of `origin` match its rows `rows`. Rows followed a moment ago stay remembered,
 * so an Undo that brings the old copy back is kept; rows that came back to the copy by
 * themselves (the source typed back) are forgotten, and followed again on their next change.
 */
export function settled(view, origin, rows) {
  const kept = memory(view);
  const key = originKey(origin);
  if (kept.has(key) && kept.get(key) !== rows) kept.delete(key);
}

/** Whether the copy of `origin` was taken back by Undo and kept as it was. */
export function heldBack(view, origin, rows) {
  return memory(view).get(originKey(origin)) === rows;
}
