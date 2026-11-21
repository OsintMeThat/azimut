/**
 * A figure's Data line, said the same way on a chart (its settings card and The numbers),
 * an infographic (the block in the note, the builder's Data bar) and each of the builder's
 * panel cards: where its rows come from, in one line, and the one press that edits them
 * where they live.
 *
 * - **Its own rows · Edit**: the rows are the chart's, typed in The numbers.
 * - **Sheet “Register” · Open in Sheet**: a sheet of the case, which the copy in the note
 *   follows by itself (`editor/follow.js`).
 * - **Table “Count” of this note · Go to the table**, or **of the note “Register”**.
 *
 * A source that no longer has the chart's columns, or is gone, is said in one short clause,
 * and the chart keeps its copy. *Change…* (the source picker) stands at its end.
 */
import { readOrigin } from './chartText.js';
import { button } from './gridMenu.js';

/** Where a figure's rows live, as its `from:` says: its own, a table of this note, a sheet, a table of another note. */
export const OWN = 'own';
export const LOCAL = 'local';
export const SHEET = 'sheet';
export const ELSEWHERE = 'note';

/** Where `from:` (or `data:`) says the rows live, read against the note `noteId`: `{ mode, id, anchor }`. */
export function sourceOf(written, noteId = '') {
  const origin = readOrigin(written);
  if (!origin) return { mode: OWN, id: '', anchor: '' };
  if (origin.kind === 'sheet') return { mode: SHEET, id: origin.id, anchor: '' };
  return { mode: noteId && origin.id === noteId ? LOCAL : ELSEWHERE, id: origin.id, anchor: origin.anchor };
}

/** A table's name from the anchor that finds it: `#count` is “Count”, `#count/2` the second under it. */
export function anchorName(anchor) {
  const [name, nth] = String(anchor ?? '').split('/');
  const words = name.replace(/-+/g, ' ').trim();
  const said = words ? `${words[0].toUpperCase()}${words.slice(1)}` : '';
  if (said && nth) return `${said}, ${nth}`;
  return said || (nth ? `Table ${nth}` : '');
}

/** What each state adds after the name. */
const STATES = {
  columns: 'no longer has these columns: the chart keeps its copy',
  gone: 'the chart keeps its copy',
  held: 'an older copy, kept by Undo',
};

/**
 * The words of a Data line: `{ name, act, state }`. `mode` is where the rows live (`sourceOf`),
 * `name` what that source is called (a sheet's title, a table's heading), `note` the note
 * holding a table of another note, `state` '' or `columns`, `gone`, `held`. `act` is the press
 * that edits them there, `{ id, label, title }`: `edit`, `sheet` or `table`; null when gone.
 */
export function dataWords({ mode = OWN, name = '', note = '', state = '' } = {}) {
  const said = STATES[state] ?? '';
  if (mode === OWN) return { name: 'Its own rows', act: { id: 'edit', label: 'Edit', title: 'Type in its rows, under the chart' }, state: '' };
  if (state === 'gone') {
    const what = mode === SHEET ? 'A sheet' : 'A table';
    return { name: `${what} no longer in ${mode === LOCAL ? 'this note' : 'the case'}`, act: null, state: said };
  }
  if (mode === SHEET) {
    return { name: name ? `Sheet “${name}”` : 'A sheet', act: { id: 'sheet', label: 'Open in Sheet', title: 'Edit its rows in the Sheet tool; the chart follows' }, state: said };
  }
  const table = name ? `Table “${name}”` : 'A table';
  const where = mode === LOCAL ? `${table} of this note` : `${table} of the note${note ? ` “${note}”` : ''}`;
  return { name: where, act: { id: 'table', label: 'Go to the table', title: 'Its rows live there; the chart follows them' }, state: said };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Draw a Data line in `node`: "Data", the name, its press, the state, `said` (more words,
 * an infographic's rows and panels), then Change… (`changeLabel`) when `change` is given.
 * `act(id, press)` runs the press. Answers `node`.
 */
export function drawDataLine(node, words, { act = null, change = null, changeLabel = 'Change…', said = '', prefix = 'cm-chart' } = {}) {
  const parts = [element('span', `${prefix}-field-name ${prefix}-data-word`, 'Data'), element('span', `${prefix}-data-name`, words.name)];
  if (words.act && act) {
    const press = button(`${prefix}-use ${prefix}-data-act`, { label: words.act.label, title: words.act.title });
    press.dataset.dataAct = words.act.id;
    press.addEventListener('mousedown', (event) => event.preventDefault());
    press.addEventListener('click', () => act(words.act.id, press));
    parts.push(element('span', `${prefix}-data-dot`, '·'), press);
  }
  if (words.state) parts.push(element('span', `${prefix}-data-state`, words.state));
  if (said) parts.push(element('span', `${prefix}-data-said`, said));
  if (change) {
    parts.push(element('span', `${prefix}-data-spring`));
    const press = button(`${prefix}-use ${prefix}-data-change`, { label: changeLabel, title: 'Read its rows from a sheet, a table of this note, or keep its own' });
    press.addEventListener('mousedown', (event) => event.preventDefault());
    press.addEventListener('click', () => change(press));
    parts.push(press);
  }
  node.replaceChildren(...parts);
  return node;
}
