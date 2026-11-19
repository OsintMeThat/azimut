/**
 * An infographic's data, as its Data bar says it (`editor/infographicBlock.js`, the builder's
 * top): what `data:` names (a sheet of the case, or a table of a note), its rows read now, and
 * which panels take it. The source picker's choices are listed here too, so the builder, the
 * block in the note and a chart's settings card offer the same ones in the same order: the
 * case's sheets first (recommended), then the tables of this note, then *New data…*.
 *
 * Rows from a sheet or another note are asked of the server (`POST /notes/figure/rows`, kept a
 * few seconds); a table of this very note is read from the note as it is typed.
 */
import { chartRows } from './chartFigure.js';
import { compareRows, headingAbove, newChart, originFor, readChart, readOrigin, tableUnder } from './chartText.js';
import { noteTables } from './infographicPanels.js';
import { dataOf, inheritingPanels, ownSourcePanels, panelText } from './infographicText.js';
import { parseTable, plainText, tablesIn } from './tableText.js';

/** How many rows, said. */
export function rowsWord(count) {
  return `${count} row${count === 1 ? '' : 's'}`;
}

/**
 * The rows `origin` names, read now: `{ origin, kind, local, found, name, text, table, rows,
 * columns }`, `text` the table's Markdown, or `{ error }`. A table of note `noteId` itself is
 * read from `noteText`; anything else is asked (`fresh` asks now).
 */
export async function readData({ caseId, noteId = '', noteText = '', origin, fresh = false }, { rows = chartRows } = {}) {
  const said = readOrigin(origin);
  if (!said) return { origin, found: false, kind: '', name: '', error: 'data: names a sheet or a table of a note' };
  if (said.kind === 'note' && noteId && said.id === noteId) {
    const line = tableUnder(noteText, said.anchor);
    const table = line >= 0 ? tablesIn(noteText).find((one) => one.line === line) : null;
    const heading = table ? headingAbove(noteText, line) : '';
    if (!table) return { origin, kind: 'note', local: true, found: false, name: said.anchor ? `the table under “${said.anchor}”` : 'the table' };
    return found({ origin, kind: 'note', local: true, name: heading || 'a table of this note', text: noteText.slice(table.from, table.to), line });
  }
  if (!caseId) return { origin, kind: said.kind, found: false, name: '' };
  const answer = await rows({ caseId, origin, fresh });
  if (answer?.error) return { origin, kind: said.kind, error: answer.error };
  if (!answer?.found) return { origin, kind: said.kind, found: false, name: '' };
  return found({ origin, kind: said.kind, local: false, name: answer.name, text: answer.text, total: answer.total });
}

function found(data) {
  const table = parseTable(data.text);
  const rows = table?.rows.length ?? 0;
  return { ...data, found: Boolean(table), table, rows, total: Math.max(rows, data.total ?? 0), columns: (table?.header ?? []).map((cell) => plainText(cell)) };
}

/** The data's name as the bar says it: Sheet “Register”, Table “The register” of this note, Table in “Note”. */
export function dataLabel(data) {
  if (!data) return 'None';
  if (!data.found) return data.kind === 'sheet' ? 'A sheet no longer in the case' : 'A table no longer in the case';
  if (data.kind === 'sheet') return `Sheet “${data.name}”`;
  return data.local ? `Table “${data.name}” of this note` : `Table in “${data.name}”`;
}

/**
 * Which panels take the data and whether their rows still match it: `{ inheriting, own,
 * differs }`, each a list of panel indices (`differs` among `inheriting`).
 */
export function dataPanels(source, data) {
  const own = ownSourcePanels(source);
  if (!data?.found) return { inheriting: [], own, differs: [] };
  const inheriting = inheritingPanels(source, data.columns);
  const differs = inheriting.filter((index) => {
    const { table } = readChart(panelText(source, index));
    return !table || compareRows(table, data.table) !== 'same';
  });
  return { inheriting, own, differs };
}

/** What the bar says after the name: its rows, how many panels read it, whether it changed since. */
export function dataSaid(data, panels) {
  if (!data) return 'each panel keeps its own rows';
  if (data.error) return `not read: ${data.error}`;
  if (!data.found) return 'its panels keep the rows they copied';
  const reading = panels.inheriting.length;
  // a chart holds its first rows only: the bar says so rather than a smaller count
  const count = data.total > data.rows ? `first ${data.rows} of ${data.total} rows` : rowsWord(data.rows);
  const parts = [count, reading ? `${reading} panel${reading === 1 ? '' : 's'} read it` : 'no panel reads it yet'];
  if (panels.differs.length) parts.push('changed since');
  return parts.join(' · ');
}

/** The data of the infographic `source`, read now, with what its panels make of it: `{ data, panels }`; `data` null without `data:`. */
export async function dataState({ caseId, noteId = '', noteText = '', source, fresh = false }, options = {}) {
  const origin = dataOf(source);
  if (!origin) return { data: null, panels: { inheriting: [], own: ownSourcePanels(source), differs: [] } };
  const data = await readData({ caseId, noteId, noteText, origin, fresh }, options);
  return { data, panels: dataPanels(source, data) };
}

/**
 * The chart panel a kind picked from the data's rows writes (`kind` an answer of the kind
 * picker): its settings and title, the rows copied in, and no `from:`, so it takes the page's data.
 */
export function dataPanel(kind, dataText) {
  return newChart({ ...(kind.settings ?? {}), title: kind.title ?? '' }, dataText);
}

/**
 * The source picker's choices: the case's sheets (from `GET /notes/figure/sources`) first,
 * then the tables of the note `noteId` as `noteText` holds them. Each `{ group, origin, label,
 * hint, columns }`, `group` `sheet` or `table`. `current` marks the one in use.
 */
export function sourceChoices({ sheets = [], noteId = '', noteText = '', current = '' }) {
  const choices = sheets.map((sheet) => ({
    group: 'sheet', origin: sheet.origin, label: sheet.title, hint: `Sheet · ${rowsWord(sheet.rows)}`, columns: sheet.columns ?? [],
  }));
  if (noteId) {
    const text = String(noteText ?? '');
    noteTables(text).forEach((found, at) => {
      const origin = originFor(noteId, text, found.line);
      choices.push({
        group: 'table', origin, label: found.heading || `Table ${at + 1}`, hint: `This note · ${rowsWord(found.table.rows.length)}`,
        columns: found.table.header.map((cell) => plainText(cell)),
      });
    });
  }
  return choices.map((choice) => ({ ...choice, current: Boolean(current) && choice.origin === current }));
}
