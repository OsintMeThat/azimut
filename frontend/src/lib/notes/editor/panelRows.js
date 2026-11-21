/**
 * A panel's rows in the infographic builder (`tools/notebook/InfographicBuilder.svelte`),
 * typed in the grid a chart's numbers are (`editor/rowsGrid.js`): the table of panel `index`
 * of the note's `k`-th infographic, written through the note as one change, one Undo.
 *
 * - **Own rows** (`rows: own`, or a page with no data): every gesture of a table.
 * - **Page data**, or a source of the panel's own: a cell typed is written where the rows
 *   live, a sheet or a table of this note, and the panel follows; a table of another note
 *   is shown, not typed in.
 */
import { readChart, setting } from './chartText.js';
import { ELSEWHERE, LOCAL, OWN, SHEET, sourceOf } from './dataLine.js';
import { dataOf, infographicsIn, inherits, readInfographic } from './infographicText.js';
import { rowsGrid, writeLocalCells, writeSheetCells } from './rowsGrid.js';
import { noteCase, noteHandlers } from './state.js';

const sum = (lines) => lines.reduce((total, line) => total + line.length + 1, 0);

/** Panel `index` of the `k`-th infographic as the note holds it now: its chart, and where its table stands; null once gone. */
export function panelAt(text, k, index) {
  const page = infographicsIn(text)[k];
  if (!page) return null;
  const read = readInfographic(page.source);
  const panel = read.panels[index];
  if (!panel || panel.kind !== 'chart') return null;
  const chart = readChart(read.lines.slice(panel.from, panel.to + 1).join('\n'));
  const start = page.from + sum(read.lines.slice(0, panel.from));
  return { page, chart, start, table: chart.tableFrom >= 0 ? start + sum(chart.lines.slice(0, chart.tableFrom)) : -1 };
}

/**
 * Where panel `index`'s rows live: its own `from:`, else the page's `data:` when it takes
 * it (`columns`, the data's columns), else '' for its own rows.
 */
export function panelOrigin(text, k, index, columns) {
  const at = panelAt(text, k, index);
  if (!at) return '';
  const own = setting(at.chart, 'from');
  if (own) return own;
  const data = dataOf(at.page.source);
  return data && columns && inherits(at.page.source, index, columns) ? data : '';
}

/**
 * The grid of panel `index`'s rows in `box`. `columns()` answers the page data's columns
 * (null while unread), `idle()` the columns its drawing does not read, `tools()` the presses
 * its bar ends with (As a form), `say(words)` a refusal, `onleave(where)` Escape or a step
 * past its edge. Answers `{ refresh, destroy }`; `refresh()` follows the note.
 */
export function panelGrid(view, box, { k, index, columns = () => null, idle = () => new Set(), tools = () => [], say = null, onleave = null }) {
  const text = () => view.state.doc.toString();
  const noteId = () => view.state.facet(noteHandlers).noteId ?? '';
  const origin = () => panelOrigin(text(), k, index, columns());
  let grid = null;
  let key = '';
  const host = {
    whole: false,
    outside: true,
    get mode() {
      return sourceOf(origin(), noteId()).mode;
    },
    start: () => panelAt(text(), k, index)?.table ?? -1,
    anchor: () => panelAt(text(), k, index)?.page.from ?? view.state.selection.main.head,
    tools: () => (host.mode === OWN ? tools() : []),
    left: (where) => onleave?.(where),
    async writeCells(found, cells) {
      const written = origin();
      const { mode } = sourceOf(written, noteId());
      const refused = mode === LOCAL ? writeLocalCells(view, written, found, cells)
        : mode === SHEET ? await writeSheetCells(view, { caseId: view.state.field(noteCase).caseId, written, found, cells }) : '';
      if (refused) {
        grid?.redraw({ refused: true });
        say?.(refused);
      }
    },
  };

  function refresh() {
    const at = panelAt(text(), k, index);
    const table = at?.chart.table;
    if (!table) {
      grid?.destroy();
      grid = null;
      key = '';
      box.replaceChildren();
      return;
    }
    const { mode } = host;
    const writable = !view.state.readOnly && mode !== ELSEWHERE;
    const next = `${mode}|${writable}|${host.tools().map((one) => one.label).join(',')}`;
    const spec = { host, table, info: view.state.field(noteCase), writable, idle: idle() };
    if (grid && next === key) {
      grid.update({ ...grid.widget, ...spec });
      return;
    }
    grid?.destroy();
    const holder = document.createElement('div');
    box.replaceChildren(holder);
    grid = rowsGrid(holder, view, spec);
    key = next;
  }

  refresh();
  return {
    refresh,
    destroy() {
      grid?.leave('stay');
      grid?.destroy();
      grid = null;
    },
  };
}
