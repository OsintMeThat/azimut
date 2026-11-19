/**
 * The two panels a chart is made with, drawn inside the editor so they take its look:
 *
 * - **the kind picker**: every kind the table fits, each already drawn from its real
 *   rows (`POST /notes/figure/kinds`), the analyst picking one by its picture. The
 *   arrows move between them, Enter picks, Escape closes; from `/`, its foot offers
 *   the rows of another note or a sheet instead;
 * - **the settings**: only what a chart is about, in plain words: its title, what it
 *   counts, by what, coloured by what, whether its table shows under it, and its look
 *   (Report, Book, Dark), each a whole preset; the colours it chose on its own, and the
 *   press that keeps them for the case. They open on the chart itself, between
 *   its bar and its drawing, so each choice is seen as it is made.
 *
 * Neither writes the note: each says what was chosen, and the chart block writes its
 * lines, one Undo step a choice (`editor/chartBlock.js`).
 */
import { button, openPopover } from './gridMenu.js';
import { chartKinds } from './chartFigure.js';
import { ROWS, SHOWS, STYLES, setting } from './chartText.js';
import { plainText, readColumns } from './tableText.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** How many kinds stand across the picker. */
export const PICKER_COLUMNS = 4;

/** What the picker says under the kinds: changing a chart's kind, a table's chart, rows copied from elsewhere. */
const FOOT = {
  chart: 'The title, the columns and the rows stay; only the drawing changes.',
  table: 'Only the kinds this table fits are here. Its rows are copied under it, and Read again brings them up to date.',
  copied: 'Only the kinds these rows fit are here. They are copied into this note, and Read again brings them up to date.',
};

/** What the picker says it draws from: "60 rows" of a table, "the chart's 12 rows". */
export function rowsSaid(rows, { chart = false } = {}) {
  const count = `${rows} row${rows === 1 ? '' : 's'}`;
  return chart ? `Drawn from the chart’s ${count}` : `Drawn from this table’s ${count}`;
}

/** The arrows, Home and End move between the kinds, a row of `PICKER_COLUMNS` at a time. */
function walkKinds(event, picks) {
  const at = picks.indexOf(document.activeElement);
  if (at < 0) return false;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: PICKER_COLUMNS, ArrowUp: -PICKER_COLUMNS }[event.key];
  let next = null;
  if (step !== undefined) next = Math.max(0, Math.min(picks.length - 1, at + step));
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = picks.length - 1;
  if (next === null) return false;
  picks[next].focus();
  return true;
}

/** One kind drawn small, its name under it; the one the chart is now says so. */
function pickCard(kind, current) {
  const card = element('button', `cm-chart-pick${kind.kind === current ? ' cm-chart-now' : ''}`);
  card.type = 'button';
  card.dataset.kind = kind.kind;
  card.setAttribute('aria-label', kind.kind === current ? `${kind.label}, the kind it is now` : kind.label);
  const thumb = element('span', 'cm-chart-thumb');
  // the engine's own drawing, its words escaped there
  thumb.innerHTML = kind.svg ?? '';
  const name = element('span', 'cm-chart-pick-name', kind.label);
  if (kind.kind === current) name.append(element('small', '', 'now'));
  card.append(thumb, name);
  return card;
}

/**
 * The kind picker under `anchor`: the kinds `text` (a table, or a chart's block) fits,
 * drawn small, while they are asked. `onPick(kind)` gets the one picked, `{ kind, label,
 * settings, title }`. `current` marks the kind a chart is now; `copied` says the rows were
 * copied from another note or a sheet; `copy`, given, offers that copy in its foot instead.
 * Answers its close.
 */
export function openKindPicker(view, anchor, {
  caseId, noteId = '', text, current = '', chart = false, copied = false, copy = null, onPick, ask = chartKinds,
}) {
  const panel = element('div', 'cm-chart-picker');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', chart ? 'Kind of chart' : 'Pick a chart');
  const head = element('div', 'cm-chart-picker-head');
  const title = element('strong', '', chart ? 'Kind of chart' : 'Pick a chart');
  const said = element('span', 'cm-chart-picker-said', 'Drawing each kind from these rows…');
  head.append(title, said);
  const grid = element('div', 'cm-chart-picker-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Kinds this table fits');
  // the places hold while the drawings come, so nothing jumps
  for (let index = 0; index < PICKER_COLUMNS * 2; index += 1) grid.append(element('span', 'cm-chart-pick cm-chart-waiting'));
  const foot = element('p', 'cm-chart-picker-foot', chart ? FOOT.chart : copied ? FOOT.copied : FOOT.table);
  panel.append(head, grid, foot);
  let closed = false;
  const close = openPopover(view, anchor, panel, { onClose: () => { closed = true; } });
  if (copy) {
    // the rows may come from elsewhere: the other notes' tables and the sheets, one press away
    const other = button('cm-chart-use cm-chart-copy', { label: 'Copy rows from another note or a sheet' });
    other.addEventListener('mousedown', (event) => event.preventDefault());
    other.addEventListener('click', () => {
      close(false);
      copy();
    });
    foot.append(' ', other);
  }
  panel.addEventListener('keydown', (event) => {
    if (walkKinds(event, [...grid.querySelectorAll('button.cm-chart-pick')])) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  panel.tabIndex = -1;
  panel.focus({ preventScroll: true });
  if (!caseId) {
    said.textContent = 'A chart is drawn in a note of a case.';
    grid.replaceChildren();
    return close;
  }
  Promise.resolve(ask({ caseId, noteId, text })).then((answer) => {
    if (closed) return;
    if (answer?.error || !answer?.kinds?.length) {
      said.textContent = answer?.error ? `Not drawn: ${answer.error}` : 'No kind of chart fits this table.';
      grid.replaceChildren();
      return;
    }
    said.textContent = rowsSaid(answer.rows, { chart });
    const picks = answer.kinds.map((kind) => {
      const card = pickCard(kind, current);
      card.addEventListener('mousedown', (event) => event.preventDefault());
      card.addEventListener('click', () => {
        close(false);
        onPick?.(kind);
      });
      return card;
    });
    grid.replaceChildren(...picks);
    (picks.find((card) => card.classList.contains('cm-chart-now')) ?? picks[0]).focus({ preventScroll: true });
    // the drawings change the panel's height: it stands where it fits again
    window.dispatchEvent?.(new Event('resize'));
    view.scrollDOM.dispatchEvent(new Event('scroll'));
  });
  return close;
}

// -- the settings ------------------------------------------------------------------------

/** Bars and columns turn stacked once coloured by a column, and plain again without one. */
export const STACKS = { bars: 'stacked bars', columns: 'stacked columns' };
export const UNSTACKS = { 'stacked bars': 'bars', 'stacked columns': 'columns' };

/** The colours a chart chose on its own, which the case can keep: the fixed order's, the grades' ramp, its own `colours`. */
export const KEEPABLE = ['order', 'grade', 'chart'];
/** What keeping them says it does, on the button and in the toast. */
export const KEEP_SAID = 'Name these colours in the case, so every chart, map and layer paints them the same';

/** The looks a chart takes, as the card names them. */
export const STYLE_NAMES = { report: 'Report', book: 'Book', dark: 'Dark' };
export const SHOW_NAMES = { chart: 'Chart', 'chart and table': 'Chart and table' };

/**
 * What the card offers to count, by and colour by, from the chart's table: `count` is
 * Rows then its columns of numbers, `by` its other columns, `colour` its columns of words.
 */
export function cardChoices(table) {
  if (!table) return { count: [{ value: ROWS, label: 'Rows' }], by: [], colour: [] };
  const columns = readColumns(table);
  const name = (header, at) => plainText(header) || `Column ${at + 1}`;
  const numbers = columns.filter((column) => column.numeric);
  const words = columns.filter((column) => !column.numeric);
  return {
    count: [{ value: ROWS, label: 'Rows' }, ...numbers.map((column) => ({ value: name(column.header, column.column), label: name(column.header, column.column) }))],
    by: (words.length ? words : columns).map((column) => ({ value: name(column.header, column.column), label: name(column.header, column.column) })),
    colour: words.map((column) => ({ value: name(column.header, column.column), label: name(column.header, column.column) })),
  };
}

/** A choice's value as written in the block, matched to the choices however it was cased. */
function chosen(options, written) {
  const wanted = String(written ?? '').toLowerCase();
  return options.find((option) => option.value.toLowerCase() === wanted)?.value ?? '';
}

/**
 * The settings a choice in the card writes: `{ key: value }`, '' taking a line out. A
 * colour column turns bars and columns stacked, and none turns them plain again; the
 * kind's own style and show are not written.
 */
export function cardChanges(field, value, { kind = {} } = {}) {
  const name = kind.name ?? '';
  if (field === 'colour by') {
    if (value && STACKS[name]) return { 'colour by': value, kind: STACKS[name] };
    if (!value && UNSTACKS[name]) return { 'colour by': '', kind: UNSTACKS[name] };
    return { 'colour by': value };
  }
  if (field === 'parts') return { by: value, 'colour by': '' };
  if (field === 'show') return { show: value === 'chart' ? '' : value };
  return { [field]: value };
}

function select(label, options, value, onChange, { none = '' } = {}) {
  const row = element('label', 'cm-chart-field');
  row.append(element('span', 'cm-chart-field-name', label));
  const field = element('select', 'cm-chart-select');
  field.setAttribute('aria-label', label);
  const list = none ? [{ value: '', label: none }, ...options] : options;
  for (const option of list) {
    const item = element('option', '', option.label);
    item.value = option.value;
    field.append(item);
  }
  field.value = value;
  field.addEventListener('change', () => onChange(field.value));
  row.append(field);
  return row;
}

function segmented(label, options, value, onChange) {
  const row = element('div', 'cm-chart-field');
  row.append(element('span', 'cm-chart-field-name', label));
  const group = element('div', 'cm-chart-seg');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const choice = element('button', 'cm-chart-seg-btn', option.label);
    choice.type = 'button';
    choice.setAttribute('role', 'radio');
    choice.setAttribute('aria-checked', String(option.value === value));
    choice.addEventListener('mousedown', (event) => event.preventDefault());
    choice.addEventListener('click', () => {
      if (option.value !== value) onChange(option.value);
    });
    group.append(choice);
  }
  row.append(group);
  return row;
}

/**
 * The settings of a chart, drawn in `panel` (the chart's own, between its bar and its
 * drawing, so every choice is seen at once on the chart). `state()` answers the chart
 * as it stands, `{ chart, drawn }` (`readChart`, the figure's answer), read again on each
 * `refresh()`; `write(changes)` writes one choice. A kind of parts is drawn by one
 * column, its parts: choosing it writes `by` and takes `colour by` out. Answers `{
 * refresh, commit, focus }`, `commit` writing a title typed and not yet written.
 */
export function chartSettings(panel, { state, write, keep = null }) {
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Chart settings');
  // the title field stays the same element while the panel is drawn again, so typing in it is never lost
  const titleRow = element('label', 'cm-chart-field cm-chart-title-field');
  titleRow.append(element('span', 'cm-chart-field-name', 'Title'));
  const titleField = element('textarea', 'cm-chart-title');
  titleField.rows = 1;
  titleField.setAttribute('aria-label', 'Title');
  titleRow.append(titleField);
  const offer = element('div', 'cm-chart-proposed');
  const columns = element('div', 'cm-chart-columns');
  const looks = element('div', 'cm-chart-looks');
  const colours = element('div', 'cm-chart-field cm-chart-colours');
  panel.replaceChildren(titleRow, offer, columns, looks, colours);

  const size = () => {
    titleField.style.height = 'auto';
    titleField.style.height = `${titleField.scrollHeight + 2}px`;
  };
  const commit = () => {
    const { chart } = state() ?? {};
    if (!chart) return;
    const typed = titleField.value.replace(/\s+/g, ' ').trim();
    if (typed !== setting(chart, 'title')) write({ title: typed });
  };
  titleField.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit();
  });
  titleField.addEventListener('input', size);
  titleField.addEventListener('change', commit);

  function render() {
    const { chart, drawn } = state();
    const kind = drawn?.kind ?? {};
    const choices = cardChoices(chart.table);
    if (document.activeElement !== titleField) titleField.value = setting(chart, 'title');
    titleField.placeholder = drawn?.proposed || 'A title that says what is counted';
    size();
    const proposed = drawn?.proposed ?? '';
    offer.replaceChildren();
    offer.hidden = !proposed || proposed === setting(chart, 'title');
    if (!offer.hidden) {
      offer.append(element('span', '', 'From the data: '), element('em', '', proposed));
      const use = button('cm-chart-use', { label: 'Use it', title: 'Write this title' });
      use.addEventListener('mousedown', (event) => event.preventDefault());
      use.addEventListener('click', () => write({ title: proposed }));
      offer.append(use);
    }
    const fields = [];
    if (kind.counts !== false) {
      const count = setting(chart, 'count');
      fields.push(select('Count', choices.count, chosen(choices.count, count) || (count ? count : ROWS), (value) => write(cardChanges('count', value, { kind }))));
      // a kind of parts is drawn by its colour column when it has one, else by its by column
      const parts = kind.parts ? setting(chart, 'colour by') || setting(chart, 'by') : setting(chart, 'by');
      const by = chosen(choices.by, parts);
      fields.push(select(kind.parts ? 'Parts' : 'By', choices.by, by, (value) => write(cardChanges(kind.parts ? 'parts' : 'by', value, { kind })),
        { none: by ? '' : 'The first column' }));
      if (!kind.parts) {
        const colours = choices.colour.filter((option) => option.value.toLowerCase() !== setting(chart, 'by').toLowerCase());
        fields.push(select('Coloured by', colours, chosen(colours, setting(chart, 'colour by')), (value) => write(cardChanges('colour by', value, { kind })), { none: 'One colour' }));
      }
    }
    const focused = panel.contains(document.activeElement) && document.activeElement !== titleField ? document.activeElement.getAttribute('aria-label') : null;
    columns.replaceChildren(...fields);
    columns.hidden = !fields.length;
    looks.replaceChildren(
      segmented('Show', SHOWS.map((value) => ({ value, label: SHOW_NAMES[value] })), setting(chart, 'show') || 'chart',
        (value) => write(cardChanges('show', value, { kind }))),
      segmented('Style', STYLES.map((value) => ({ value, label: STYLE_NAMES[value] })), setting(chart, 'style') || kind.style || 'report',
        (value) => write(cardChanges('style', value, { kind }))),
    );
    renderColours(drawn?.colours ?? []);
    if (focused) [...panel.querySelectorAll('[aria-label]')].find((node) => node.getAttribute('aria-label') === focused)?.focus({ preventScroll: true });
  }

  /** The values the chart coloured on its own, and the one press that names them in the case. */
  function renderColours(all) {
    const own = all.filter((one) => KEEPABLE.includes(one.origin));
    colours.hidden = !own.length || !keep;
    if (colours.hidden) {
      colours.replaceChildren();
      return;
    }
    const list = element('span', 'cm-chart-swatches');
    for (const one of own) {
      const chip = element('span', 'cm-chart-swatch', one.value);
      chip.style.setProperty('--swatch', one.colour);
      chip.title = one.colour;
      list.append(chip);
    }
    const press = button('cm-chart-use cm-chart-keep', { label: 'Keep these colours for the case', title: KEEP_SAID });
    press.addEventListener('mousedown', (event) => event.preventDefault());
    press.addEventListener('click', () => keep(own.map(({ value, colour }) => ({ value, colour }))));
    colours.replaceChildren(element('span', 'cm-chart-field-name', 'Colours'), list, press);
  }

  render();
  return { refresh: render, commit, focus: () => titleField.focus({ preventScroll: true }) };
}
