/**
 * A chart: a `::: chart` block of `key: value` lines over a table
 * (`engine/notes_charts.py`), drawn in the note as the server draws it for the PDF and
 * the HTML page (`POST /notes/figure`), kept by its text so it is drawn once.
 *
 * - **Made from a table**: the grid's Chart button, or `/` › Chart, shows every kind
 *   the table fits already drawn from its rows (`editor/chartCard.js`). The one picked
 *   is written under the table, or where `/` was typed: its kind, the title its data
 *   proposes (*at least* when the count is a floor), its columns, the table's rows
 *   copied in and `from:`, where they came from. With no table in the note, `/` ›
 *   Chart starts a small one to fill.
 * - **Its bar**: Kind (the picker again, the chart's own settings kept), Settings (the
 *   card: title, count, by, coloured by, show, style), Read again (once the table its
 *   rows came from changed), The numbers (its rows, and the way to the table), Export
 *   (a picture for X, 4:5, 1:1, the PDF page, or an SVG).
 * - **Its checks**: what the check before export says of it, in the honesty rules'
 *   words, under it, with a one-press fix where the check offers one.
 *
 * Every choice writes the block's lines, the changed ones only, as one Undo step. In
 * the raw Markdown the block is its lines, as before.
 */
import { isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';

import { rovingToolbar } from '../pictureSize.js';
import { registerBlock } from './blocks.js';
import { EXPORTS, drawChart, exportChart, keptDrawing } from './chartFigure.js';
import { chartSettings, openKindPicker } from './chartCard.js';
import {
  CHART_OPEN, compareRows, headingAbove, newChart, originFor, readChart, readOrigin, setting, tableUnder, withSettings, withTable,
} from './chartText.js';
import { tablesOf } from './gridEdits.js';
import { button, icon, openMenu } from './gridMenu.js';
import { blockAt } from './puts.js';
import { blocksIn, openSource } from './ranges.js';
import { noteCase, noteHandlers } from './state.js';
import { registerTableChart } from './tableGrid.js';
import { gridAt } from './tablePictures.js';
import { insertTable } from './tableInsert.js';
import { lineChanges, plainText } from './tableText.js';
import { BlockWidget, markPicked, sourceButton } from './widgets.js';

/** The rows The numbers shows before it says how many more. */
export const NUMBERS_SHOWN = 60;
/** The table `/` › Chart starts with when the note holds none. */
export const STARTER_TABLE = '| Category | Count |\n| --- | ---: |\n|  |  |\n|  |  |\n|  |  |';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The words a fix's button says: what it writes, plainly. */
export function fixLabel(fix, title = '') {
  if (fix.length === 1 && fix[0][0] === 'title') {
    return /\bat least\b/i.test(fix[0][1]) && !/\bat least\b/i.test(title) ? 'Add “at least” to the title' : `Use “${fix[0][1]}”`;
  }
  if (fix.length === 1 && fix[0][0] === 'kind') return `Draw it as ${fix[0][1]}`;
  return `Write ${fix.map(([key, value]) => `“${key}: ${value}”`).join(', ')}`;
}

/** How a table is named to the analyst: under the heading above it. */
function tableName(text, line) {
  const heading = headingAbove(text, line);
  return heading ? `the table under “${heading}”` : 'the table above';
}

/** A chart drawn in the note, kept on its box (`box.chart`). */
class ChartBox {
  constructor(box, widget, view) {
    this.box = box;
    this.view = view;
    this.widget = widget;
    this.chart = readChart(widget.source);
    this.drawn = null;
    this.asked = null;
    this.origin = null;
    this.settings = null;
    this.numbersOpen = false;
    this.gone = false;
    box.chart = this;
    this.build();
    this.draw();
    this.refreshOrigin();
  }

  get info() {
    return this.widget.info;
  }

  get handlers() {
    return this.view.state.facet(noteHandlers);
  }

  get noteId() {
    return this.handlers.noteId ?? '';
  }

  get writable() {
    return this.widget.writable && !this.view.state.readOnly;
  }

  /** Where the block stands in the note now, `{ from, to }`, or null once it is gone. */
  range() {
    let from;
    try {
      from = this.view.posAtDOM(this.box);
    } catch {
      return null;
    }
    return blocksIn(this.view.state, from).find((block) => block.from === from && block.kind === 'chart') ?? null;
  }

  /** Whether the rows came from a table of this very note, which the editor reads as it is typed. */
  local() {
    const origin = readOrigin(setting(this.chart, 'from'));
    return Boolean(origin && origin.kind === 'note' && this.noteId && origin.id === this.noteId);
  }

  // -- drawing --

  build() {
    const { box } = this;
    box.className = 'cm-block cm-block-chart cm-chart-block';
    box.dataset.block = 'chart';
    const frame = element('div', 'cm-chart-frame');
    if (this.writable) frame.append(this.makeBar());
    this.settingsPanel = element('div', 'cm-chart-settings-panel cm-chart-ui');
    this.settingsPanel.hidden = true;
    this.settingsPanel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleSettings(false);
      this.settingsButton?.focus({ preventScroll: true });
    });
    this.figure = element('div', 'cm-chart-figure');
    this.checks = element('ul', 'cm-chart-checks cm-chart-ui');
    this.checks.setAttribute('aria-label', 'What the check says of this chart');
    this.numbers = element('div', 'cm-chart-numbers cm-chart-ui');
    this.numbers.hidden = true;
    frame.append(this.settingsPanel, this.figure, this.checks, this.numbers);
    box.append(frame);
    if (!this.writable) box.append(sourceButton(this.view, box));
  }

  makeBar() {
    const bar = element('div', 'cm-chart-bar cm-chart-ui');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Chart');
    const tool = (className, options, run) => {
      const node = button(`cm-chart-tool ${className}`, options);
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => run(node));
      bar.append(node);
      return node;
    };
    this.kindButton = tool('cm-chart-kind', { label: 'Kind', iconName: 'chart', title: 'Draw it as another kind' }, (node) => this.pickKind(node));
    this.settingsButton = tool('cm-chart-settings', { label: 'Settings', iconName: 'sliders', title: 'Title, what it counts, by what, and its look' },
      () => this.toggleSettings());
    this.settingsButton.setAttribute('aria-pressed', 'false');
    this.againButton = tool('cm-chart-again', { label: 'Read again', iconName: 'reset' }, () => this.readAgain());
    this.againButton.hidden = true;
    this.numbersButton = tool('cm-chart-numbers-btn', { label: 'The numbers', iconName: 'table', title: 'The rows it is drawn from' }, () => this.toggleNumbers());
    this.numbersButton.setAttribute('aria-pressed', 'false');
    tool('cm-chart-export', { label: 'Export', iconName: 'download', title: 'A picture for X, 4:5, 1:1, the PDF page, or an SVG' }, (node) => this.exportMenu(node));
    bar.append(element('span', 'cm-chart-spring'));
    const source = button('cm-chart-tool cm-chart-source', { label: 'Edit the source', alone: true, title: 'Edit the source' });
    source.dataset.editSource = 'true';
    source.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.toSource();
    });
    source.addEventListener('click', (event) => {
      if (event.detail === 0) this.toSource();
    });
    bar.append(source);
    rovingToolbar(bar);
    return bar;
  }

  /** The block's lines changed: draw it again, and say again what its rows are. */
  update(widget) {
    const before = this.widget;
    this.widget = widget;
    this.chart = readChart(widget.source);
    if (widget.source !== before.source || widget.info.caseId !== before.info.caseId) this.draw();
    this.refreshOrigin();
    if (this.numbersOpen) this.renderNumbers();
    this.settings?.refresh();
  }

  draw() {
    const caseId = this.info.caseId;
    if (!caseId) {
      this.figure.replaceChildren(element('p', 'cm-chart-said', 'A chart is drawn in a note of a case.'));
      return;
    }
    const request = { caseId, noteId: this.noteId, text: this.widget.source, origins: !this.local() };
    const kept = keptDrawing(request);
    if (kept) {
      this.show(kept);
      return;
    }
    // the drawing it had stays, paler, until the new one comes: nothing jumps
    if (!this.figure.querySelector('svg')) this.figure.replaceChildren(element('p', 'cm-chart-said', 'Drawing the chart…'));
    this.figure.classList.add('cm-chart-loading');
    const asked = drawChart(request);
    this.asked = asked;
    asked.then((answer) => {
      if (this.gone || this.asked !== asked) return;
      this.show(answer);
    });
  }

  show(answer) {
    this.figure.classList.remove('cm-chart-loading');
    this.asked = null;
    if (answer.error) {
      this.drawn = null;
      this.figure.replaceChildren(element('p', 'cm-chart-said cm-chart-failed', `Chart not drawn: ${answer.error}`));
      this.renderChecks([]);
    } else {
      this.drawn = answer;
      // the engine's own drawing, its words escaped there
      this.figure.innerHTML = answer.svg;
      this.figure.querySelector('svg')?.setAttribute('aria-label', answer.title || 'Chart');
      this.renderChecks(answer.checks);
    }
    if (this.kindButton) {
      const label = this.drawn?.kind?.label;
      this.kindButton.lastChild.textContent = label || 'Kind';
      this.kindButton.setAttribute('aria-label', label ? `Kind: ${label}` : 'Kind');
    }
    this.settings?.refresh();
    this.view.requestMeasure();
  }

  renderChecks(checks) {
    const items = checks.map((check) => {
      const item = element('li', `cm-chart-check cm-chart-check-${check.kind}`);
      item.append(icon('alert', 13), element('span', 'cm-chart-check-said', check.message));
      if (check.fix.length && this.writable) {
        const fix = button('cm-chart-fix', { label: fixLabel(check.fix, setting(this.chart, 'title')) });
        fix.title = check.fix.map(([key, value]) => `${key}: ${value}`).join('\n');
        fix.addEventListener('mousedown', (event) => event.preventDefault());
        fix.addEventListener('click', () => this.write(Object.fromEntries(check.fix)));
        item.append(fix);
      }
      return item;
    });
    this.checks.replaceChildren(...items);
    this.checks.hidden = !items.length;
  }

  /** Whether the rows still match the table of this note they were copied from. */
  refreshOrigin() {
    const origin = readOrigin(setting(this.chart, 'from'));
    let state = null;
    if (origin && this.local() && this.chart.table) {
      const text = this.view.state.doc.toString();
      const line = tableUnder(text, origin.anchor);
      const found = line >= 0 ? tablesOf(this.view.state).find((table) => table.line === line) : null;
      state = found
        ? { state: compareRows(this.chart.table, found.table), found, name: tableName(text, line) }
        : { state: 'gone', name: origin.anchor ? `the table under “${origin.anchor}”` : 'the table it came from' };
    }
    const was = this.origin?.state;
    this.origin = state;
    if (this.againButton) {
      const differs = state?.state === 'differs';
      this.againButton.hidden = !differs;
      this.againButton.title = differs ? `${state.name[0].toUpperCase()}${state.name.slice(1)} changed: copy its rows again` : '';
    }
    if (this.numbersOpen && was !== state?.state) this.renderNumbers();
  }

  // -- the bar's gestures --

  /** Write `changes` (`{ key: value }`, '' taking a line out) as one step. */
  write(changes) {
    return this.edit((source) => withSettings(source, changes));
  }

  /** Change the block's text with `change(source)`, as one step Undo takes back. */
  edit(change) {
    if (!this.writable) return false;
    const range = this.range();
    if (!range) return false;
    const source = this.view.state.sliceDoc(range.from, range.to);
    const next = change(source);
    if (next === source) return false;
    this.view.dispatch({
      changes: lineChanges(source, next).map((piece) => ({ from: range.from + piece.from, to: range.from + piece.to, insert: piece.insert })),
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.chart')],
    });
    return true;
  }

  pickKind(anchor) {
    const range = this.range();
    if (!range) return;
    const text = this.view.state.sliceDoc(range.from, range.to);
    openKindPicker(this.view, anchor, {
      caseId: this.info.caseId,
      noteId: this.noteId,
      text,
      chart: true,
      current: this.drawn?.kind?.name ?? '',
      onPick: (kind) => this.write(kind.settings),
    });
  }

  /** Open or close the settings on the chart, between its bar and its drawing; open, the title takes the keyboard. */
  toggleSettings(open = this.settingsPanel.hidden) {
    if (!this.writable) return;
    if (!open) {
      this.settings?.commit();
      this.settings = null;
      this.settingsPanel.hidden = true;
      this.settingsPanel.replaceChildren();
    } else if (!this.settings) {
      this.settingsPanel.hidden = false;
      this.settings = chartSettings(this.settingsPanel, {
        state: () => (this.gone ? null : { chart: this.chart, drawn: this.drawn }),
        write: (changes) => this.write(changes),
      });
    }
    this.settingsButton?.setAttribute('aria-pressed', String(open));
    if (open) this.settings.focus();
    this.view.requestMeasure();
  }

  readAgain() {
    const found = this.origin?.found;
    if (!found) return;
    const text = this.view.state.sliceDoc(found.from, found.to);
    this.edit((source) => withTable(source, text));
  }

  toggleNumbers(open = !this.numbersOpen) {
    this.numbersOpen = open;
    this.numbersButton?.setAttribute('aria-pressed', String(open));
    this.numbers.hidden = !open;
    if (open) this.renderNumbers();
    this.view.requestMeasure();
  }

  renderNumbers() {
    const { table } = this.chart;
    const parts = [];
    if (!table) parts.push(element('p', 'cm-chart-said', 'This chart holds no rows yet.'));
    else {
      const sheet = element('table', 'cm-chart-rows');
      const head = element('tr');
      for (const cell of table.header) head.append(element('th', '', plainText(cell)));
      const thead = element('thead');
      thead.append(head);
      const body = element('tbody');
      for (const row of table.rows.slice(0, NUMBERS_SHOWN)) {
        const line = element('tr');
        row.forEach((cell, at) => {
          const node = element('td', '', plainText(cell));
          if (table.align[at] === 'right') node.style.textAlign = 'right';
          line.append(node);
        });
        body.append(line);
      }
      sheet.append(thead, body);
      const scroll = element('div', 'cm-chart-rows-scroll');
      scroll.append(sheet);
      parts.push(scroll);
      if (table.rows.length > NUMBERS_SHOWN) parts.push(element('p', 'cm-chart-said', `And ${table.rows.length - NUMBERS_SHOWN} more rows.`));
    }
    const said = element('div', 'cm-chart-numbers-said');
    const origin = this.origin;
    const words = !origin ? (setting(this.chart, 'from') ? 'Copied from another note or a sheet.' : 'These rows are the chart’s own.')
      : origin.state === 'same' ? `Same as ${origin.name}.`
        : origin.state === 'differs' ? `${origin.name[0].toUpperCase()}${origin.name.slice(1)} changed since they were copied.`
          : origin.state === 'columns' ? `${origin.name[0].toUpperCase()}${origin.name.slice(1)} no longer has these columns.`
            : `${origin.name[0].toUpperCase()}${origin.name.slice(1)} is no longer in this note.`;
    said.append(element('span', origin?.state === 'same' ? 'cm-chart-same' : '', words));
    const act = (label, run, className = '') => {
      const node = button(`cm-chart-link ${className}`, { label });
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', run);
      said.append(node);
    };
    if (origin?.state === 'differs' && this.writable) act('Read again', () => this.readAgain(), 'cm-chart-link-strong');
    if (origin?.found) act('Go to the table', () => this.goToTable());
    if (this.writable) act('Edit them as text', () => this.toSource());
    parts.push(said);
    this.numbers.replaceChildren(...parts);
  }

  goToTable() {
    const found = this.origin?.found;
    if (!found) return;
    this.view.dispatch({ selection: { anchor: found.from }, scrollIntoView: true });
    this.view.focus();
  }

  exportMenu(anchor) {
    const items = EXPORTS.map((destination) => ({
      label: destination.label, hint: destination.hint, iconName: destination.format === 'svg' ? 'file' : 'image',
      run: () => this.exportAs(destination),
    }));
    openMenu(this.view, anchor, items, { label: 'Export as a picture' });
  }

  async exportAs(destination) {
    const range = this.range();
    if (!range || !this.info.caseId) return;
    const toast = this.handlers.tableToast;
    try {
      const name = await exportChart({ caseId: this.info.caseId, noteId: this.noteId, text: this.view.state.sliceDoc(range.from, range.to), destination });
      toast?.(`Saved ${name} to your downloads.`);
    } catch (error) {
      toast?.(`Not exported: ${error?.message ?? error}`, [], 'warn');
    }
  }

  toSource() {
    const range = this.range();
    if (range) openSource(this.view, range);
  }

  destroy() {
    this.gone = true;
  }
}

/** A chart drawn in place: drawn again in place, its box and its bar kept, when its lines change. */
export class ChartWidget extends BlockWidget {
  constructor(spec) {
    super('chart', spec.source, spec.info, spec.writable, '', spec.pinned, spec.picked);
  }

  toDOM(view) {
    const box = document.createElement('div');
    // eslint-disable-next-line no-new
    new ChartBox(box, this, view);
    markPicked(box, this.picked);
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('.cm-chart-ui, a')) return;
      event.preventDefault();
      // a press picks the chart, which stays drawn; a double press opens its settings
      view.dispatch({ selection: { anchor: view.posAtDOM(box) } });
      view.focus();
    });
    box.addEventListener('dblclick', (event) => {
      if (event.target.closest('.cm-chart-ui')) return;
      event.preventDefault();
      box.chart.toggleSettings(true);
    });
    return box;
  }

  updateDOM(dom, _view, previous) {
    if (!dom.chart || !(previous instanceof ChartWidget) || previous.writable !== this.writable) return false;
    if (!previous.same(this)) dom.chart.update(this);
    else dom.chart.widget = this;
    markPicked(dom, this.picked);
    return true;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown' || Boolean(event.target?.closest?.('.cm-chart-ui'));
  }

  destroy(dom) {
    dom.chart?.destroy();
  }

  get estimatedHeight() {
    return 440;
  }
}

/** Enter on a picked chart, or a double press: its settings; a locked note opens the source. */
function openChart(view, block) {
  const box = [...view.contentDOM.querySelectorAll('.cm-chart-block')].find((node) => {
    try {
      return view.posAtDOM(node) === block.from;
    } catch {
      return false;
    }
  });
  if (!box?.chart || !box.chart.writable) return openSource(view, block);
  box.chart.toggleSettings(true);
  return true;
}

/** After the note changes, each chart says again whether its rows match the table they came from. */
const watchOrigins = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.timer = null;
  }

  update(update) {
    if (!update.docChanged) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      for (const box of this.view.contentDOM.querySelectorAll('.cm-chart-block')) box.chart?.refreshOrigin();
    }, 200);
  }

  destroy() {
    clearTimeout(this.timer);
  }
});

// -- making a chart ----------------------------------------------------------------------

/** An anchor at the cursor, for a panel to stand under; taken out with it. */
function cursorAnchor(view) {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head) ?? view.dom.getBoundingClientRect();
  const anchor = document.createElement('span');
  anchor.className = 'cm-chart-anchor';
  anchor.style.cssText = `position: fixed; left: ${coords.left}px; top: ${coords.top}px; width: 1px; height: ${Math.max(14, coords.bottom - coords.top)}px; pointer-events: none;`;
  view.dom.append(anchor);
  return anchor;
}

/**
 * The block a kind picked from the table at `found` writes: its settings, the title its
 * data proposes, where its rows came from, and the rows. `noteId` names the note they
 * are in; a note with none (a template) writes no `from:`.
 */
export function chartFromTable(state, found, kind, noteId = '') {
  const text = state.sliceDoc(found.from, found.to);
  const settings = { ...kind.settings, title: kind.title ?? '' };
  if (noteId) settings.from = originFor(noteId, state.doc.toString(), found.line ?? state.doc.lineAt(found.from).number - 1);
  return newChart(settings, text);
}

/** Write the chart `kind` makes of the table `found` at `pos`, as one step, and pick it. */
function placeChart(view, found, kind, pos) {
  if (view.state.readOnly) return;
  const noteId = view.state.facet(noteHandlers).noteId ?? '';
  const block = chartFromTable(view.state, found, kind, noteId);
  const { insert, start } = blockAt(view.state, pos, block);
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + start },
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.chart')],
    scrollIntoView: true,
  });
  view.focus();
}

/** The kind picker for the table at `found`, under `anchor`; the chart lands at `pos`. */
export function chartTable(view, anchor, found, { pos = found.to, onClose = null } = {}) {
  const { caseId } = view.state.field(noteCase);
  return openKindPicker(view, anchor, {
    caseId,
    noteId: view.state.facet(noteHandlers).noteId ?? '',
    text: view.state.sliceDoc(found.from, found.to),
    onPick: (kind) => placeChart(view, found, kind, pos),
    onClose,
  });
}

/** The grid's Chart button, for the panel to stand under. */
function chartButtonOf(view, from) {
  const grid = gridAt(view, from);
  return grid?.box?.querySelector('.cm-grid-chart') ?? null;
}

/**
 * `/` › Chart: the kind picker for the note's one table, a menu of its tables when it
 * holds several, or a small table to fill when it holds none, its Chart button then
 * one press away.
 */
export function startChart(view) {
  if (view.state.readOnly) return;
  const tables = tablesOf(view.state).filter((found) => !inChart(view.state, found.from));
  if (!tables.length) {
    insertTable(view, STARTER_TABLE, { said: 'Fill the table, then press Chart above it.' });
    return;
  }
  const pos = view.state.selection.main.head;
  const anchor = cursorAnchor(view);
  const drop = () => anchor.remove();
  const text = view.state.doc.toString();
  if (tables.length === 1) {
    chartTable(view, anchor, tables[0], { pos, onClose: drop });
    return;
  }
  const items = tables.map((found) => ({
    label: `${tableName(text, found.line)[0].toUpperCase()}${tableName(text, found.line).slice(1)}`,
    hint: `${found.table.rows.length} × ${found.table.header.length}`,
    iconName: 'table',
    run: () => chartTable(view, anchor, found, { pos, onClose: drop }),
  }));
  const menu = openMenu(view, anchor, items, { label: 'Which table' });
  // the menu leaves without a pick: its anchor goes with it
  const watch = new MutationObserver(() => {
    if (!menu.isConnected && !view.dom.querySelector('.cm-chart-picker')) {
      watch.disconnect();
      drop();
    }
  });
  watch.observe(view.dom, { childList: true });
}

/** Whether `pos` is inside a chart block: its rows are a copy, never a table to chart. */
function inChart(state, pos) {
  const line = state.doc.lineAt(pos).number;
  for (let number = line - 1; number >= 1; number -= 1) {
    const text = state.doc.line(number).text;
    if (CHART_OPEN.test(text)) return true;
    if (/^:::[ \t]*$/.test(text) || !text.trim()) return false;
  }
  return false;
}

const TOOL = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 9px', border: '1px solid transparent',
  borderRadius: '5px', background: 'none', color: 'var(--text-2)', font: 'inherit', fontSize: '12.5px', cursor: 'pointer', whiteSpace: 'nowrap',
};

const THEME = {
  '.cm-chart-block': { padding: '10px var(--note-gutter, 32px)', cursor: 'default' },
  '.cm-chart-frame': {
    position: 'relative', border: '1px solid var(--border-strong)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-1)',
    fontFamily: 'var(--font-sans)', fontSize: '12.5px', lineHeight: '1.45', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal',
  },
  '.cm-chart-block.cm-picked': { outline: 'none' },
  '.cm-chart-block.cm-picked .cm-chart-frame': { boxShadow: '0 0 0 2px var(--accent)' },
  '.cm-chart-bar': {
    display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 6px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
  },
  '.cm-chart-spring': { flex: '1' },
  '.cm-chart-tool': TOOL,
  // what a chart shows only at times (Read again, its checks, its numbers) stays out of sight when hidden
  '.cm-chart-tool[hidden], .cm-chart-ui[hidden], .cm-chart-proposed[hidden]': { display: 'none' },
  '.cm-chart-tool:hover, .cm-chart-tool:focus-visible': { background: 'var(--bg-3)', color: 'var(--text-1)', outline: 'none' },
  '.cm-chart-tool svg': { flex: 'none', opacity: '0.85' },
  '.cm-chart-kind': { color: 'var(--text-1)', fontWeight: '600' },
  '.cm-chart-again': { color: 'var(--accent)', fontWeight: '600', background: 'var(--accent-soft)' },
  '.cm-chart-again:hover, .cm-chart-again:focus-visible': { background: 'var(--accent)', color: 'var(--accent-text)' },
  '.cm-chart-tool[aria-pressed="true"]': { background: 'var(--bg-3)', color: 'var(--text-1)' },
  '.cm-chart-source': { padding: '0 7px', minWidth: '28px', justifyContent: 'center' },
  '.cm-chart-source::before': { content: '"</>"', fontFamily: 'var(--font-mono)', fontSize: '11px' },
  '.cm-chart-figure': { position: 'relative', background: 'var(--bg-0)', minHeight: '60px' },
  '.cm-chart-figure > svg': { display: 'block', width: '100%', height: 'auto', transition: 'opacity 0.2s var(--ease)' },
  '.cm-chart-loading > svg': { opacity: '0.55' },
  '.cm-chart-said': { margin: '0', padding: '26px 16px', color: 'var(--text-3)', textAlign: 'center' },
  '.cm-chart-failed': { color: 'var(--danger)' },
  '.cm-chart-checks': {
    listStyle: 'none', margin: '0', padding: '7px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-1)',
    display: 'flex', flexDirection: 'column', gap: '5px',
  },
  '.cm-chart-check': { display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--text-2)', flexWrap: 'wrap' },
  '.cm-chart-check > svg': { color: 'var(--warn)', flex: 'none', marginTop: '3px' },
  '.cm-chart-check-missing > svg': { color: 'var(--danger)' },
  '.cm-chart-check-said': { flex: '1 1 260px', minWidth: '0' },
  '.cm-chart-fix': {
    height: '24px', padding: '0 10px', border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)', borderRadius: '12px',
    background: 'var(--accent-soft)', color: 'var(--text-1)', font: 'inherit', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-chart-fix:hover, .cm-chart-fix:focus-visible': { background: 'var(--accent)', color: 'var(--accent-text)', outline: 'none' },
  '.cm-chart-numbers': { borderTop: '1px solid var(--border)', background: 'var(--bg-1)' },
  '.cm-chart-rows-scroll': { maxHeight: '280px', overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--border-strong) transparent' },
  'table.cm-chart-rows': { width: '100%', borderCollapse: 'separate', borderSpacing: '0', fontSize: '12px', fontVariantNumeric: 'tabular-nums' },
  '.cm-chart-rows th, .cm-chart-rows td': {
    padding: '4px 10px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', textAlign: 'left', verticalAlign: 'top',
    color: 'var(--text-1)', maxWidth: '22em',
  },
  '.cm-chart-rows th': { position: 'sticky', top: '0', background: 'var(--bg-2)', color: 'var(--text-2)', fontWeight: '600', zIndex: '1' },
  '.cm-chart-numbers-said': { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px', padding: '7px 12px', color: 'var(--text-2)' },
  '.cm-chart-same': { color: 'var(--ok)' },
  '.cm-chart-link': {
    padding: '0', border: 'none', background: 'none', color: 'var(--info)', font: 'inherit', cursor: 'pointer', textDecoration: 'underline',
    textDecorationColor: 'color-mix(in srgb, var(--info) 40%, transparent)', textUnderlineOffset: '2px',
  },
  '.cm-chart-link:hover, .cm-chart-link:focus-visible': { color: 'var(--text-1)', outline: 'none' },
  '.cm-chart-link-strong': { color: 'var(--accent)', fontWeight: '600' },
  // the kind picker stands over the note, as the grid's menus do
  '.cm-chart-picker': {
    position: 'fixed', zIndex: '60', background: 'var(--bg-2)', border: '1px solid var(--border-strong)', borderRadius: '9px',
    boxShadow: 'var(--shadow-2)', fontFamily: 'var(--font-sans)', fontSize: '12.5px', color: 'var(--text-1)', outline: 'none',
  },
  '.cm-chart-picker': { width: 'min(744px, calc(100vw - 24px))', padding: '12px 14px 10px', boxSizing: 'border-box' },
  '.cm-chart-picker-head': { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px' },
  '.cm-chart-picker-head strong': { fontSize: '13.5px' },
  '.cm-chart-picker-said': { color: 'var(--text-2)' },
  '.cm-chart-picker-grid': {
    display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px', maxHeight: 'min(560px, 70vh)', overflowY: 'auto',
    padding: '2px', scrollbarWidth: 'thin',
  },
  '.cm-chart-pick': {
    display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 6px 7px', border: '1px solid var(--border)', borderRadius: '7px',
    background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: '0',
  },
  'button.cm-chart-pick:hover': { borderColor: 'var(--border-strong)', background: 'var(--bg-3)' },
  'button.cm-chart-pick:focus-visible': { outline: 'none', borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' },
  '.cm-chart-pick.cm-chart-now': { borderColor: 'color-mix(in srgb, var(--accent) 70%, transparent)' },
  '.cm-chart-waiting': {
    height: '152px', boxSizing: 'border-box', background: 'linear-gradient(100deg, var(--bg-1) 30%, var(--bg-3) 50%, var(--bg-1) 70%)',
    backgroundSize: '300% 100%', animation: 'cm-chart-wait 1.4s linear infinite',
  },
  '@keyframes cm-chart-wait': { from: { backgroundPosition: '100% 0' }, to: { backgroundPosition: '0 0' } },
  '.cm-chart-thumb': {
    position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'safe center', height: '118px', overflow: 'hidden',
    borderRadius: '4px', background: '#ffffff',
  },
  '.cm-chart-thumb:has(.az-chart-book)': { background: '#efe6d3' },
  '.cm-chart-thumb:has(.az-chart-dark)': { background: '#12161b' },
  '.cm-chart-thumb > svg': { display: 'block', width: '100%', height: 'auto', flex: 'none' },
  '.cm-chart-pick-name': { display: 'flex', alignItems: 'baseline', gap: '6px', padding: '0 2px', fontWeight: '600', fontSize: '12.5px' },
  '.cm-chart-pick-name small': { color: 'var(--accent)', fontWeight: '500', fontSize: '11px' },
  '.cm-chart-picker-foot': { margin: '10px 2px 0', color: 'var(--text-3)', fontSize: '11.5px' },
  // the settings, on the chart between its bar and its drawing
  '.cm-chart-settings-panel': {
    display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 14px 13px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)',
  },
  '.cm-chart-field': { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '0' },
  '.cm-chart-title-field': { display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', alignItems: 'start', gap: '10px' },
  '.cm-chart-title-field .cm-chart-field-name': { paddingTop: '6px' },
  '.cm-chart-field-name': { color: 'var(--text-2)', fontSize: '11.5px' },
  '.cm-chart-columns': { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px', paddingLeft: '74px' },
  '.cm-chart-looks': { display: 'flex', flexWrap: 'wrap', gap: '10px 28px', paddingLeft: '74px' },
  '.cm-chart-select, .cm-chart-title': {
    boxSizing: 'border-box', width: '100%', minHeight: '28px', padding: '4px 8px', border: '1px solid var(--border-strong)', borderRadius: '5px',
    background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', outline: 'none',
  },
  '.cm-chart-title': { resize: 'none', lineHeight: '1.4', fontWeight: '600', fontSize: '13.5px', overflow: 'hidden' },
  '.cm-chart-select:focus, .cm-chart-title:focus': { borderColor: 'var(--info)' },
  '.cm-chart-proposed': { paddingLeft: '74px', marginTop: '-4px', color: 'var(--text-3)', fontSize: '11.5px' },
  '.cm-chart-proposed em': { color: 'var(--text-2)' },
  '.cm-chart-use': {
    marginLeft: '6px', padding: '0', border: 'none', background: 'none', color: 'var(--info)', font: 'inherit', cursor: 'pointer', textDecoration: 'underline',
  },
  '.cm-chart-looks .cm-chart-field': { flexDirection: 'row', alignItems: 'center', gap: '10px' },
  '.cm-chart-seg': { display: 'inline-flex', border: '1px solid var(--border-strong)', borderRadius: '6px', overflow: 'hidden' },
  '.cm-chart-seg-btn': {
    height: '26px', padding: '0 11px', border: 'none', borderRight: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-2)',
    font: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-chart-seg-btn:last-child': { borderRight: 'none' },
  '.cm-chart-seg-btn:hover, .cm-chart-seg-btn:focus-visible': { color: 'var(--text-1)', background: 'var(--bg-3)', outline: 'none' },
  '.cm-chart-seg-btn[aria-checked="true"]': {
    background: 'var(--accent-soft)', color: 'var(--text-1)', fontWeight: '600', boxShadow: 'inset 0 -2px 0 var(--accent)',
  },
};

registerTableChart((view, found) => {
  const anchor = chartButtonOf(view, found.from);
  if (!anchor) return;
  chartTable(view, anchor, found);
});

registerBlock({
  name: 'chart',
  fence: CHART_OPEN,
  widget: (spec) => new ChartWidget(spec),
  open: openChart,
  atomic: true,
  height: 440,
  extensions: [watchOrigins],
  theme: THEME,
});
