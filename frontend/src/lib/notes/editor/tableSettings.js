/**
 * A table's settings card, opened from its grid's bar: how the table shows in the
 * report, as a few plain choices. Each choice writes the table's settings line
 * (`tableLook.js`) under its last row at once, one Undo step a choice, so the Page
 * pane's HTML view draws it again as it is made; a table back to every default has
 * no line at all. The search bar, sorting, folding and the first column kept in sight
 * are the web page's, which each one's title says; the PDF prints the rest.
 */
import { Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';

import { tableNear } from './gridEdits.js';
import { button, openPopover } from './gridMenu.js';
import { DEFAULT_LOOK, FOLDS, cleanLookText, writeLook } from './tableLook.js';
import { plainText, readColumns } from './tableText.js';

/** What the card says of each choice, on its control's title. */
export const SAID = {
  button: 'How this table shows in the report: search bar, sorting, long tables, colours, caption',
  search: 'A box that filters the rows; Auto shows it past 12 rows. Web page only.',
  sort: 'A press on a column’s header sorts the rows by it. Web page only.',
  fold: 'On a long table, its first rows, the rest folded under Show all. Web page only: the PDF prints every row.',
  header: 'Kept at the top while the page scrolls, and printed again on each page of the PDF.',
  column: 'Kept in sight while a wide table slides sideways. Web page only.',
  stripes: 'Every other row tinted, on the web page and in the PDF. A styled PDF stripes its tables anyway.',
  colour: 'Each row tinted by its value in this column, in the case’s colours, as charts are.',
  density: 'Rows set closer, on the web page and in the PDF.',
  caption: 'A line under the table.',
  source: 'Where its rows came from, said under the table.',
  reset: 'Every choice back to how a table shows by default',
};

const SEARCH_NAMES = { auto: 'Auto', always: 'Always', never: 'Never' };
const DENSITY_NAMES = { comfortable: 'Comfortable', compact: 'Compact' };

/** The bar's button, as `tool(className, options)` takes it. */
export function settingsButton() {
  return ['cm-grid-look', { label: 'Settings', iconName: 'sliders', title: SAID.button }];
}

/** The button says, with a dot, that the table has settings of its own. */
export function markSettings(node, look) {
  if (!node) return;
  const set = Boolean(look && writeLook(look));
  node.classList.toggle('cm-grid-look-set', set);
  node.setAttribute('aria-label', set ? 'Settings, some set' : 'Settings');
}

/** The table's settings as its line says them, without where the line stands. */
export function lookOf(found) {
  if (!found?.look) return { ...DEFAULT_LOOK };
  const { from: _from, to: _to, ...look } = found.look;
  return { ...DEFAULT_LOOK, ...look };
}

/**
 * Write `changes` into the settings of the table standing at `from`, as one step:
 * the line under its last row written, rewritten, or taken out once nothing is set.
 * Answers the settings now, or null when nothing changed.
 */
export function setLook(view, from, changes) {
  if (view.state.readOnly) return null;
  const found = tableNear(view.state, from);
  if (!found) return null;
  const look = { ...lookOf(found), ...changes };
  const text = writeLook(look);
  let change = null;
  if (found.look) {
    if (text === view.state.sliceDoc(found.look.from, found.look.to)) return null;
    change = text ? { from: found.look.from, to: found.look.to, insert: text } : { from: found.to, to: found.look.to };
  } else if (text) change = { from: found.to, insert: `\n${text}` };
  if (!change) return null;
  view.dispatch({ changes: change, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.table')] });
  return look;
}

/** The columns a table's rows may be coloured by: its columns of words, by their header's words. */
export function colourColumns(table) {
  if (!table) return [];
  return readColumns(table).filter((column) => !column.numeric)
    .map((column) => plainText(column.header) || `Column ${column.column + 1}`)
    .filter((name, at, all) => all.indexOf(name) === at);
}

/** The folds offered: the card's own, and one written by hand. */
function folds(fold) {
  return FOLDS.includes(fold) ? FOLDS : [...FOLDS, fold].sort((a, b) => a - b);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(label, title, control) {
  const line = element('div', 'cm-table-look-row');
  line.title = title;
  const name = element('span', 'cm-table-look-name', label);
  line.append(name, control);
  return line;
}

function segmented(label, options, value, onPick) {
  const group = element('div', 'cm-table-look-seg');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const choice = element('button', 'cm-table-look-seg-btn', option.label);
    choice.type = 'button';
    if (option.name) choice.setAttribute('aria-label', option.name);
    choice.setAttribute('role', 'radio');
    choice.setAttribute('aria-checked', String(option.value === value));
    choice.addEventListener('click', () => {
      if (option.value !== value) onPick(option.value);
    });
    group.append(choice);
  }
  return group;
}

function check(label, title, value, onPick) {
  const line = element('label', 'cm-table-look-row cm-table-look-check');
  line.title = title;
  const box = element('input');
  box.type = 'checkbox';
  box.checked = value;
  box.addEventListener('change', () => onPick(box.checked));
  line.append(box, element('span', '', label));
  return line;
}

/**
 * The card under `anchor`, for the table standing at `from`. Every choice is written
 * as it is made; the card reads the table again after each, so it says what the note
 * holds. Answers its close.
 */
export function openTableSettings(view, anchor, from) {
  const panel = element('div', 'cm-table-look');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Table settings');
  const head = element('div', 'cm-table-look-head');
  const title = element('strong', '', 'Table settings');
  const reset = button('cm-table-look-reset', { label: 'Reset', title: SAID.reset });
  head.append(title, reset);
  const said = element('p', 'cm-table-look-said', 'How it shows on the web page and in the PDF.');
  const body = element('div', 'cm-table-look-body');
  panel.append(head, said, body);

  const current = () => tableNear(view.state, from);
  // drawn again after each choice; words left by a press elsewhere are written as they stand,
  // so the control that press lands on is still there for its click
  const write = (changes, { redraw = true } = {}) => {
    const look = setLook(view, from, changes);
    if (redraw) render();
    else if (look) reset.disabled = !writeLook(look);
  };
  reset.addEventListener('click', () => write({ ...DEFAULT_LOOK }));
  // words typed and not yet written are written as the card closes, unless Escape closed it
  const pending = new Set();
  let cancelled = false;
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancelled = true;
  });

  function text(label, title, key, value) {
    const field = element('input', 'cm-table-look-text');
    field.type = 'text';
    field.value = value;
    field.placeholder = key === 'caption' ? 'What the table shows' : 'Our register, 17 Nov 2026';
    field.setAttribute('aria-label', label);
    field.maxLength = 300;
    const commit = (redraw = true) => {
      pending.delete(commit);
      if (cleanLookText(field.value) !== cleanLookText(lookOf(current())[key])) write({ [key]: field.value }, { redraw });
    };
    field.addEventListener('input', () => pending.add(commit));
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit();
    });
    field.addEventListener('change', () => commit(false));
    return row(label, title, field);
  }

  function render() {
    const found = current();
    if (!found) {
      close(false);
      return;
    }
    const look = lookOf(found);
    const focused = panel.contains(document.activeElement) ? document.activeElement.closest('[data-key]')?.dataset.key : null;
    const columns = colourColumns(found.table);
    const colour = element('select', 'cm-table-look-select');
    colour.setAttribute('aria-label', 'Colour rows by');
    const named = columns.find((name) => name.toLowerCase() === look.colour.toLowerCase());
    const options = [['', 'None'], ...columns.map((name) => [name, name])];
    // a column the table no longer has stays named, so the card says what the line does
    if (look.colour && !named) options.push([look.colour, `${look.colour} (not in the table)`]);
    for (const [value, label] of options) {
      const option = element('option', '', label);
      option.value = value;
      colour.append(option);
    }
    colour.value = named ?? look.colour;
    colour.addEventListener('change', () => write({ colour: colour.value }));
    const rows = [
      ['search', row('Search bar', SAID.search, segmented('Search bar', Object.entries(SEARCH_NAMES).map(([value, label]) => ({ value, label })),
        look.search, (value) => write({ search: value })))],
      ['sort', check('Sort by a press on a header', SAID.sort, look.sort, (value) => write({ sort: value }))],
      ['fold', row('Rows shown', SAID.fold, segmented('Rows shown', folds(look.fold).map((value) => ({
        value, label: value ? String(value) : 'All', name: value ? `The first ${value} rows` : 'All rows',
      })), look.fold, (value) => write({ fold: value })))],
      ['header', check('Header stays on screen', SAID.header, look.stickyHeader, (value) => write({ stickyHeader: value }))],
      ['column', check('First column stays on screen', SAID.column, look.stickyColumn, (value) => write({ stickyColumn: value }))],
      ['stripes', check('Striped rows', SAID.stripes, look.stripes === true, (value) => write({ stripes: value ? true : null }))],
      ['colour', row('Colour rows by', SAID.colour, colour)],
      ['density', row('Density', SAID.density, segmented('Density', Object.entries(DENSITY_NAMES).map(([value, label]) => ({ value, label })),
        look.density, (value) => write({ density: value })))],
      ['caption', text('Caption', SAID.caption, 'caption', look.caption)],
      ['source', text('Source', SAID.source, 'source', look.source)],
    ];
    for (const [key, node] of rows) node.dataset.key = key;
    body.replaceChildren(...rows.map(([, node]) => node));
    reset.disabled = !writeLook(look);
    if (focused) body.querySelector(`[data-key="${focused}"]`)?.querySelector('button[aria-checked="true"], input, select, button')?.focus({ preventScroll: true });
  }

  // it ends at its button, so it stands over the table rather than the page beside the note
  const close = openPopover(view, anchor, panel, {
    end: true,
    onClose: () => {
      if (!cancelled) for (const commit of [...pending]) commit(false);
    },
  });
  render();
  body.querySelector('button, input, select')?.focus({ preventScroll: true });
  return close;
}

export const SETTINGS_THEME = {
  '.cm-grid-look': { position: 'relative' },
  '.cm-grid-look-set::after': {
    content: '""', position: 'absolute', top: '3px', right: '3px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)',
  },
  '.cm-table-look': {
    position: 'fixed', zIndex: '60', width: '330px', padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: '6px',
    background: 'var(--bg-2)', border: '1px solid var(--border-strong)', borderRadius: '7px', boxShadow: 'var(--shadow-2)',
    fontFamily: 'var(--font-sans)', fontSize: '12.5px', color: 'var(--text-1)', textAlign: 'left',
  },
  '.cm-table-look-head': { display: 'flex', alignItems: 'center', gap: '8px' },
  '.cm-table-look-head strong': { flex: '1', fontSize: '13px' },
  '.cm-table-look-reset': {
    height: '24px', padding: '0 8px', border: '1px solid var(--border)', borderRadius: '5px', background: 'none', color: 'var(--text-2)',
    font: 'inherit', cursor: 'pointer',
  },
  '.cm-table-look-reset:hover:not(:disabled), .cm-table-look-reset:focus-visible': { borderColor: 'var(--accent)', color: 'var(--text-1)', outline: 'none' },
  '.cm-table-look-reset:disabled': { opacity: '0.45', cursor: 'default' },
  '.cm-table-look-said': { margin: '0 0 4px', color: 'var(--text-3)' },
  '.cm-table-look-body': { display: 'flex', flexDirection: 'column', gap: '7px' },
  '.cm-table-look-row': { display: 'grid', gridTemplateColumns: '96px 1fr', alignItems: 'center', gap: '8px', minHeight: '26px' },
  '.cm-table-look-name': { color: 'var(--text-2)' },
  '.cm-table-look-check': { display: 'flex', cursor: 'pointer' },
  '.cm-table-look-check input': { margin: '0 2px 0 0', accentColor: 'var(--accent)' },
  '.cm-table-look-seg': { display: 'flex', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', background: 'var(--bg-1)' },
  '.cm-table-look-seg-btn': {
    flex: '1', height: '26px', padding: '0 6px', border: 'none', borderRight: '1px solid var(--border)', background: 'none',
    color: 'var(--text-2)', font: 'inherit', whiteSpace: 'nowrap', cursor: 'pointer',
  },
  '.cm-table-look-seg-btn:last-child': { borderRight: 'none' },
  '.cm-table-look-seg-btn:hover, .cm-table-look-seg-btn:focus-visible': { background: 'var(--bg-3)', color: 'var(--text-1)', outline: 'none' },
  '.cm-table-look-seg-btn[aria-checked="true"]': { background: 'var(--accent-soft)', color: 'var(--text-1)', fontWeight: '650' },
  '.cm-table-look-select, .cm-table-look-text': {
    boxSizing: 'border-box', width: '100%', height: '28px', padding: '0 8px', border: '1px solid var(--border)', borderRadius: '5px',
    background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', outline: 'none',
  },
  '.cm-table-look-select:focus, .cm-table-look-text:focus': { borderColor: 'var(--info)' },
};
