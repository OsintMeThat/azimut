/**
 * A chart from scratch: a form made for its kind, filled field by field while the chart
 * is drawn beside it. `/` › Chart and an infographic's Add a panel open it on a new chart,
 * and a chart's Settings › Edit the data opens it again.
 *
 * Each kind has the fields it needs, of the right type (`chartFormText.js` says the shape
 * of each table): a timeline's days at the day, the month or the year, a period's two days,
 * and what happened; key figures as written with the line under them and an *at least*
 * tick; categories and their counts, a split for the stacked kinds, a colour from the
 * case's palette or an icon from the library; a waffle's whole; a line's values along days
 * or numbers, a column a series; a picture wall's pictures of the case, each picked from
 * the case's own (`casePicker.js`) with its label, its words, its group and its colour,
 * and the shape they are cropped to. Rows are added, dragged by their grip, moved with
 * Alt+↑/↓ and taken out. The title field is the settings card's own, with the title the data
 * proposes, *at least* included. A wall's *Fill from the case* adds a folder of the case's
 * pictures at once, each labelled by the number in its name.
 *
 * **What it writes is the chart block itself**, so it reopens here, or as a grid through
 * The numbers. A cell nobody changed is written back as it was, chips and links kept. An
 * empty row only carries the hint of what goes there and stays out of the note until
 * something is typed in it: never a number it was not given. *Fill from the case* lists
 * what it would take before writing it (`api/notecharts.py`).
 *
 * Each gesture is one `write(source)`, one Undo step: a field once committed (Enter, Tab or
 * leaving it), a row moved or taken out, a precision, a colour, an icon, a fill. The rows are
 * made again only when their number or their kind changes; otherwise each field takes the
 * block's words in place, the one being typed in left alone, so the keyboard stays put.
 */
import { axisZone } from '../../caseAxis.svelte.js';
import { fetchAllEntities } from '../../catalog.js';
import { layerPalette } from '../../map/layerPalette.svelte.js';
import { casePictures } from '../pictureSize.js';
import { readThumbs, thumbOf } from './casePicker.js';
import { caseEvents, chartCounts, chartRows, chartSources } from './chartFigure.js';
import {
  CHART_COLOURS, FORMS, GRADE_WORDS, PRECISIONS, WALL_SHAPES, atPrecision, countedRows, eventRows, filled, isoDay, leftOutSaid,
  pictureCell, pictureRef, pictureRows, readFloor, readForm, readWhen, writeForm, writeWhen,
} from './chartFormText.js';
import { glyphLabel, glyphNode, glyphWord, openGlyphPicker, readGlyph } from './chartIcons.js';
import { readChart, setting, withSettings } from './chartText.js';
import { button, icon } from './gridMenu.js';
import { parseTable, plainText, readColumns } from './tableText.js';
import './chartForm.css';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const nothing = (event) => event.preventDefault();

/** A select's choice. */
function choiceOf(label, value) {
  const node = element('option', '', label);
  node.value = value;
  return node;
}

/** A press that keeps the keyboard where it is. */
function pressable(node, run) {
  node.addEventListener('mousedown', nothing);
  node.addEventListener('click', run);
  return node;
}

// -- the title, shared with the settings card --------------------------------------------------

/**
 * A chart's title field and the title its data proposes (*at least* when its count is a
 * floor), with *Use it*: the settings card's and the form's. `state()` answers `{ chart,
 * drawn }`; `write(changes)` writes the title. Answers `{ nodes, render, commit, focus }`.
 */
export function titleField({ state, write }) {
  const row = element('label', 'cm-chart-field cm-chart-title-field');
  row.append(element('span', 'cm-chart-field-name', 'Title'));
  const field = element('textarea', 'cm-chart-title');
  field.rows = 1;
  field.setAttribute('aria-label', 'Title');
  row.append(field);
  const offer = element('div', 'cm-chart-proposed');
  const size = () => {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  };
  const commit = () => {
    const { chart } = state() ?? {};
    if (!chart) return;
    const typed = field.value.replace(/\s+/g, ' ').trim();
    if (typed !== setting(chart, 'title')) write({ title: typed });
  };
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit();
  });
  field.addEventListener('input', size);
  field.addEventListener('change', commit);
  function render() {
    const { chart, drawn } = state() ?? {};
    if (!chart) return;
    if (document.activeElement !== field) field.value = setting(chart, 'title');
    field.placeholder = drawn?.proposed || 'A title that says what is counted';
    size();
    const proposed = drawn?.proposed ?? '';
    offer.replaceChildren();
    offer.hidden = !proposed || proposed === setting(chart, 'title');
    if (!offer.hidden) {
      offer.append(element('span', '', 'From the data: '), element('em', '', proposed));
      const use = button('cm-chart-use', { label: 'Use it', title: 'Write this title' });
      pressable(use, () => write({ title: proposed }));
      offer.append(use);
    }
  }
  return { nodes: [row, offer], field, render, commit, focus: () => field.focus({ preventScroll: true }) };
}

// -- the gallery's sketches ------------------------------------------------------------------

const SKETCH = {
  timeline: '<path d="M4 30h56" class="k-axis"/><rect x="22" y="26" width="20" height="8" rx="2" class="k-soft"/><circle cx="10" cy="30" r="3" class="k-ink"/><circle cx="52" cy="30" r="3" class="k-ink"/><path d="M10 26v-9M52 26v-14M32 26v-6" class="k-axis"/><rect x="5" y="11" width="13" height="3" rx="1" class="k-mute"/><rect x="44" y="6" width="15" height="3" rx="1" class="k-mute"/><rect x="25" y="14" width="14" height="3" rx="1" class="k-mute"/>',
  'key figures': '<rect x="4" y="5" width="25" height="2" class="k-ink"/><rect x="35" y="5" width="25" height="2" class="k-ink"/><rect x="4" y="12" width="17" height="11" rx="1.5" class="k-ink"/><rect x="35" y="12" width="13" height="11" rx="1.5" class="k-ink"/><rect x="4" y="28" width="22" height="3" rx="1" class="k-mute"/><rect x="4" y="33" width="14" height="3" rx="1" class="k-mute"/><rect x="35" y="28" width="18" height="3" rx="1" class="k-mute"/>',
  bars: '<rect x="13" y="6" width="44" height="7" rx="1" class="k-ink"/><rect x="13" y="16" width="30" height="7" rx="1" class="k-ink"/><rect x="13" y="26" width="18" height="7" rx="1" class="k-ink"/><rect x="2" y="8" width="8" height="3" rx="1" class="k-mute"/><rect x="2" y="18" width="8" height="3" rx="1" class="k-mute"/><rect x="2" y="28" width="8" height="3" rx="1" class="k-mute"/>',
  columns: '<rect x="8" y="8" width="9" height="26" rx="1" class="k-ink"/><rect x="22" y="16" width="9" height="18" rx="1" class="k-ink"/><rect x="36" y="22" width="9" height="12" rx="1" class="k-ink"/><rect x="50" y="27" width="9" height="7" rx="1" class="k-ink"/><path d="M4 34.5h58" class="k-axis"/>',
  donut: '<circle cx="32" cy="20" r="13" class="k-ring k-c1s"/><path d="M32 7a13 13 0 0 1 12.4 17" class="k-ring k-c2s"/><path d="M44.4 24A13 13 0 0 1 25 31" class="k-ring k-c3s"/>',
  pie: '<circle cx="32" cy="20" r="14" class="k-c1f"/><path d="M32 20V6a14 14 0 0 1 13.3 18.3Z" class="k-c2f"/><path d="M32 20l13.3 4.3A14 14 0 0 1 24 31.5Z" class="k-c3f"/>',
  segments: '<rect x="4" y="15" width="26" height="11" class="k-c1f"/><rect x="30" y="15" width="18" height="11" class="k-c2f"/><rect x="48" y="15" width="12" height="11" class="k-c3f"/>',
  'stacked bars': '<rect x="10" y="6" width="26" height="7" class="k-c1f"/><rect x="36" y="6" width="18" height="7" class="k-c2f"/><rect x="10" y="16" width="20" height="7" class="k-c1f"/><rect x="30" y="16" width="12" height="7" class="k-c2f"/><rect x="10" y="26" width="10" height="7" class="k-c1f"/><rect x="20" y="26" width="10" height="7" class="k-c2f"/>',
  'stacked columns': '<rect x="10" y="14" width="10" height="12" class="k-c1f"/><rect x="10" y="6" width="10" height="8" class="k-c2f"/><rect x="27" y="20" width="10" height="6" class="k-c1f"/><rect x="27" y="12" width="10" height="8" class="k-c2f"/><rect x="44" y="22" width="10" height="4" class="k-c1f"/><rect x="44" y="17" width="10" height="5" class="k-c2f"/><path d="M6 26.5h52" class="k-axis"/><rect x="6" y="31" width="50" height="3" rx="1" class="k-mute"/>',
  pictograms: '<g class="k-c1f"><circle cx="9" cy="10" r="4"/><circle cx="20" cy="10" r="4"/><circle cx="31" cy="10" r="4"/><circle cx="42" cy="10" r="4"/><circle cx="53" cy="10" r="4"/><circle cx="9" cy="21" r="4"/><circle cx="20" cy="21" r="4"/></g><g class="k-c2f"><circle cx="31" cy="21" r="4"/><circle cx="42" cy="21" r="4"/><circle cx="53" cy="21" r="4"/><circle cx="9" cy="32" r="4"/></g>',
  'silhouette rows': '<rect x="2" y="7" width="9" height="3" rx="1" class="k-mute"/><rect x="2" y="19" width="9" height="3" rx="1" class="k-mute"/><rect x="2" y="31" width="9" height="3" rx="1" class="k-mute"/><g class="k-ink"><path d="M15 11h8l2-4h4l3 4v2H15Z"/><path d="M34 11h8l2-4h4l3 4v2H34Z"/><path d="M15 23h8l2-4h4l3 4v2H15Z"/><path d="M15 35h8l2-4h4l3 4v2H15Z"/><path d="M34 35h8l2-4h4l3 4v2H34Z"/></g>',
  waffle: '<g class="k-c1f"><rect x="14" y="3" width="6" height="6"/><rect x="21" y="3" width="6" height="6"/><rect x="28" y="3" width="6" height="6"/><rect x="35" y="3" width="6" height="6"/><rect x="42" y="3" width="6" height="6"/><rect x="14" y="10" width="6" height="6"/><rect x="21" y="10" width="6" height="6"/><rect x="28" y="10" width="6" height="6"/></g><g class="k-soft"><rect x="35" y="10" width="6" height="6"/><rect x="42" y="10" width="6" height="6"/><rect x="14" y="17" width="6" height="6"/><rect x="21" y="17" width="6" height="6"/><rect x="28" y="17" width="6" height="6"/><rect x="35" y="17" width="6" height="6"/><rect x="42" y="17" width="6" height="6"/><rect x="14" y="24" width="6" height="6"/><rect x="21" y="24" width="6" height="6"/><rect x="28" y="24" width="6" height="6"/><rect x="35" y="24" width="6" height="6"/><rect x="42" y="24" width="6" height="6"/><rect x="14" y="31" width="6" height="6"/><rect x="21" y="31" width="6" height="6"/><rect x="28" y="31" width="6" height="6"/><rect x="35" y="31" width="6" height="6"/><rect x="42" y="31" width="6" height="6"/></g>',
  line: '<path d="M4 34.5h56" class="k-axis"/><path d="M6 28 18 22l12 4 12-12 14-6" class="k-line k-c1s"/><path d="M6 32l12-3 12-6 12 2 14-4" class="k-line k-c2s"/><circle cx="56" cy="8" r="2.4" class="k-c1f"/><circle cx="56" cy="21" r="2.4" class="k-c2f"/>',
  circles: '<circle cx="20" cy="21" r="14" class="k-c1f"/><circle cx="44" cy="25" r="8" class="k-c2f"/><circle cx="57" cy="29" r="4" class="k-c3f"/>',
  pictures: '<rect x="3" y="2" width="15" height="2.6" rx="1" class="k-mute"/><rect x="3" y="7" width="12" height="8" rx="1" class="k-soft"/><rect x="17" y="7" width="12" height="8" rx="1" class="k-soft"/><rect x="31" y="7" width="12" height="8" rx="1" class="k-soft"/><rect x="45" y="7" width="12" height="8" rx="1" class="k-soft"/><rect x="3" y="16.5" width="12" height="1.8" class="k-c1f"/><rect x="17" y="16.5" width="12" height="1.8" class="k-c1f"/><rect x="31" y="16.5" width="12" height="1.8" class="k-c2f"/><rect x="45" y="16.5" width="12" height="1.8" class="k-c3f"/><rect x="3" y="22" width="11" height="2.6" rx="1" class="k-mute"/><rect x="33" y="22" width="12" height="2.6" rx="1" class="k-mute"/><rect x="3" y="27" width="12" height="8" rx="1" class="k-soft"/><rect x="17" y="27" width="12" height="8" rx="1" class="k-soft"/><rect x="33" y="27" width="12" height="8" rx="1" class="k-soft"/><rect x="3" y="36.5" width="12" height="1.8" class="k-c2f"/><rect x="17" y="36.5" width="12" height="1.8" class="k-c1f"/><rect x="33" y="36.5" width="12" height="1.8" class="k-c3f"/>',
};

/** A kind drawn as a small sketch for the gallery: shapes only, never a number. */
export function kindSketch(kind) {
  const holder = element('span', 'cf-sketch');
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = `<svg viewBox="0 0 64 40" width="64" height="40">${SKETCH[kind] ?? ''}</svg>`;
  return holder;
}

/**
 * The gallery's cards for every kind with a form, each its sketch, its name and what it
 * needs in one line. `onPick(kind)` gets the kind pressed.
 */
export function scratchCards(onPick) {
  return Object.entries(FORMS).map(([kind, form]) => {
    const card = element('button', 'cm-chart-pick cf-scratch');
    card.type = 'button';
    card.dataset.kind = kind;
    card.dataset.scratch = 'true';
    card.setAttribute('aria-label', `${form.label}, from scratch: ${form.needs.toLowerCase()}`);
    card.title = `A form for a ${form.label.toLowerCase()} chart: ${form.needs.toLowerCase()}`;
    const words = element('span', 'cf-scratch-words');
    words.append(element('span', 'cf-scratch-name', form.label), element('span', 'cf-scratch-needs', form.needs));
    card.append(kindSketch(kind), words);
    return pressable(card, () => onPick(kind));
  });
}

// -- the form ----------------------------------------------------------------------------------

/** What each family's rows are added as: the button's words and the kind of row it makes. */
const ADDS = {
  timeline: [{ id: 'event', label: 'Event', title: 'A day and what happened' }, { id: 'period', label: 'Period', title: 'From one day until another, and what went on' }],
  figures: [{ id: 'figure', label: 'Figure', title: 'A figure as written and the line under it' }],
  categories: [{ id: 'category', label: 'Category', title: 'A category and its count' }],
  line: [{ id: 'row', label: 'Row', title: 'A value along, and one value a series' }],
  pictures: [{ id: 'picture', label: 'Picture', title: 'A picture of the case, and what it shows' }],
};

const blankRow = (family, series = 1) => ({
  timeline: { when: '', what: '', until: '' },
  figures: { figure: '', words: '', floor: false },
  categories: { category: '', split: '', count: '' },
  line: { x: '', values: Array.from({ length: series }, () => '') },
  pictures: { picture: '', label: '', words: '', group: '', colour: '' },
}[family]);

/** What an empty form says under its columns. */
const EMPTY_HINT = {
  timeline: 'No event yet: ＋ Event for a day, ＋ Period for a stretch of days.',
  figures: 'No figure yet: ＋ Figure, then the figure as written and the line under it.',
  categories: 'No category yet: ＋ Category, then its name and its count.',
  line: 'No row yet: ＋ Row, then the value along and one value a series.',
  pictures: 'No picture yet: ＋ Picture, or Fill from the case with a folder of them.',
};

/** What Fill from the case reads, on its button and at its head. */
const FILL_TITLES = {
  timeline: 'The days of the case’s proofs and its Timeline’s events, within a period',
  figures: 'Counts read from a note’s table or a sheet',
  categories: 'Counts read from a note’s table or a sheet',
  line: 'Values over days read from a note’s table or a sheet',
  pictures: 'Pictures of the case, a folder at a time',
};
const FILL_SAID = {
  timeline: 'The days of the case’s proofs and the events of its Timeline. Nothing is written until you add them.',
  figures: 'Each value of a column counted, or a column of numbers summed, from a note’s table or a sheet: one figure a value.',
  categories: 'Each value of a column counted, or a column of numbers summed, from a note’s table or a sheet.',
  line: 'Rows counted, or a column of numbers summed, day by day, from a note’s table or a sheet.',
  pictures: 'The case’s pictures, a row each, labelled by the number in their name. Nothing is written until you add them.',
};

/** How long a day picked with a calendar's arrows rests before it is written, in ms. */
export const DAY_REST_MS = 700;

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const stripped = (row) => {
  const { draft: _draft, type: _type, ...cells } = row;
  return cells;
};

/** Each form's own lists of suggestions (a wall's groups and colours), told apart by this. */
let lists = 0;

/**
 * The form of the chart `state()` answers, `{ source, drawn }` (the block's text and the
 * figure route's answer), drawn in `panel`. `write(source)` writes the block's new text as
 * one step. `caseId` lets it fill from the case; `onClose` is Escape and its ×. A picture
 * wall reads the case's records from `entities()` (else it asks the case for its pictures)
 * and picks one with `pickPicture(anchor, onPick)` (the note's case picker); without it, a
 * picture is written as its id. Answers `{ node, refresh, commit, focus, destroy }`; `focus`
 * puts the keyboard in the first field to fill, a new row's when it holds none.
 */
export function chartForm(panel, { state, write, caseId = '', palette = layerPalette, onClose = null, entities = null, pickPicture = null }) {
  panel.classList.add('cf-form');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'The chart’s data');
  /** The row added and not filled yet, kept out of the note: `{ family, type, row }`. */
  let draft = null;
  /** Each row's day precision while its day is empty, and the rows made as periods whose second day is not written yet. */
  let precisions = [];
  let periods = [];
  let filling = false;
  let shape = '';
  let gone = false;

  const head = element('div', 'cf-head');
  const kindName = element('strong', 'cf-kind');
  const needs = element('span', 'cf-needs');
  const close = button('cf-close', { label: 'Close the form', iconName: 'x', alone: true, title: 'Close the form (Esc)' });
  pressable(close, () => onClose?.());
  head.append(kindName, needs, element('span', 'cf-spring'), close);
  const title = titleField({
    state: () => {
      const now = state();
      return now ? { chart: readChart(now.source), drawn: now.drawn } : null;
    },
    write: (changes) => write(withSettings(state().source, changes)),
  });
  const titleBox = element('div', 'cf-title');
  titleBox.append(...title.nodes);
  const extra = element('div', 'cf-extra');
  const grid = element('div', 'cf-grid');
  grid.setAttribute('role', 'table');
  grid.setAttribute('aria-label', 'Rows');
  const heading = element('div', 'cf-row cf-heading');
  heading.setAttribute('role', 'row');
  const body = element('div', 'cf-body');
  body.setAttribute('role', 'rowgroup');
  grid.append(heading, body);
  const adds = element('div', 'cf-adds');
  const fillBox = element('div', 'cf-fill');
  fillBox.hidden = true;
  fillBox.setAttribute('role', 'region');
  fillBox.setAttribute('aria-label', 'Fill from the case');
  const after = element('div', 'cf-after');
  const said = element('p', 'cf-said');
  lists += 1;
  const groupList = element('datalist');
  groupList.id = `cf-groups-${lists}`;
  const colourList = element('datalist');
  colourList.id = `cf-colours-${lists}`;
  panel.replaceChildren(head, titleBox, extra, grid, adds, fillBox, after, said, groupList, colourList);
  if (caseId) palette.load?.(caseId);

  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.target.closest?.('.cf-fill')) {
      toggleFill(false);
      adds.querySelector('.cf-fill-open')?.focus();
      return;
    }
    commitFocused();
    onClose?.();
  });

  // -- what the block holds now --

  function now() {
    const answer = state();
    if (!answer) return null;
    return { ...readForm(answer.source, answer.drawn?.kind?.name ?? ''), source: answer.source, drawn: answer.drawn };
  }

  /** The rows shown: the block's, then the one added and not filled yet. */
  function shownRows(read) {
    const rows = read.model.rows.map((row) => ({ ...row }));
    if (draft && draft.family === read.form.family) rows.push({ ...draft.row, draft: true, type: draft.type });
    return rows;
  }

  function put(read, model) {
    const next = writeForm(read.source, read.kind, model);
    if (next !== read.source) write(next);
  }

  /** Change the rows shown with `change(rows)` and write them; the row added becomes one once something is in it. */
  function changeRows(change) {
    const read = now();
    if (!read?.form) return;
    const rows = shownRows(read);
    change(rows, read);
    for (const [index, row] of rows.entries()) {
      if (!row.draft || !filled(stripped(row))) continue;
      if (row.type === 'period') periods[index] = true;
      row.draft = false;
      draft = null;
    }
    put(read, { ...read.model, rows: rows.filter((row) => !row.draft).map(stripped) });
  }

  function setCell(index, key, value) {
    changeRows((rows) => {
      if (rows[index]) rows[index][key] = value;
    });
  }

  function setModel(change) {
    const read = now();
    if (!read?.form) return;
    const model = structuredClone(read.model);
    change(model, read);
    put(read, model);
  }

  /** Commit the field being typed in, as leaving it would. */
  function commitFocused() {
    const active = document.activeElement;
    if (!active || !panel.contains(active) || !active.dataset?.commit) return;
    if (active.commitNow) active.commitNow();
    else active.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // -- the fields --

  const shownCell = (raw) => plainText(raw);
  const typedCell = (raw, typed) => (typed === plainText(raw) ? raw : typed);

  /** Enter in a field: the next one of its row or the next row's; past the last row, a new row of the same kind. */
  function enter(node) {
    if (!body.contains(node)) {
      node.blur();
      return;
    }
    const fields = [...body.querySelectorAll('[data-field]')].filter((one) => !one.disabled && one.tagName !== 'BUTTON' && one.type !== 'checkbox' && !one.classList.contains('cf-precision'));
    const next = fields[fields.indexOf(node) + 1];
    if (next) next.focus();
    else enterPastLast();
  }

  function enterPastLast() {
    const read = now();
    if (!read?.form) return;
    const last = shownRows(read).at(-1);
    const period = read.form.family === 'timeline' && last && (last.type === 'period' || periods[read.model.rows.length - 1] || String(last.until ?? '').trim());
    addRow(period ? 'period' : ADDS[read.form.family][0].id);
  }

  function textInput({ value, placeholder, label, field, numeric = false, wide = false, commit }) {
    const input = element('input', `cf-input${numeric ? ' cf-number' : ''}${wide ? ' cf-wide' : ''}`);
    input.type = 'text';
    if (numeric) input.inputMode = 'decimal';
    input.value = value;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    input.dataset.field = field;
    input.dataset.commit = 'true';
    input.dataset.was = value;
    input.addEventListener('change', () => {
      const typed = input.value.replace(/\s+/g, ' ').trim();
      if (typed === input.dataset.was) return;
      input.dataset.was = typed;
      commit(typed);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      enter(input);
    });
    return input;
  }

  /** A day field at a precision: a calendar for a day, a month and a year, a year; words the chart cannot read stay as written. */
  function whenInput({ cell, precision, label, field, commit }) {
    const box = element('span', 'cf-when');
    const when = readWhen(cell);
    if (precision === 'text') {
      const input = textInput({ value: shownCell(cell), placeholder: '5 Oct 2026', label, field, commit: (typed) => commit(typedCell(cell, typed)) });
      input.classList.add('cf-unread');
      input.title = 'Not read as a day: write 5 Oct 2026, Oct 2026 or 2026';
      box.append(input);
      return box;
    }
    const known = when.precision === 'text' ? { empty: true } : when;
    box.dataset.was = known.empty ? '' : writeWhen(known);
    const send = (value) => {
      if (value === box.dataset.was) return;
      box.dataset.was = value;
      commit(value);
    };
    if (precision === 'day') {
      const input = element('input', 'cf-input cf-date');
      input.type = 'date';
      input.setAttribute('aria-label', label);
      input.dataset.field = field;
      input.dataset.commit = 'true';
      input.value = known.empty ? '' : isoDay({ year: known.year, month: known.month || 1, day: known.day || 1 });
      const read = () => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.value);
        return match && +match[1] >= 1000 ? writeWhen({ precision: 'day', year: +match[1], month: +match[2], day: +match[3] }) : null;
      };
      // a calendar's arrows change the day at each press: it is written once they rest, or at once on leaving it
      let timer = null;
      const take = () => {
        clearTimeout(timer);
        const value = read();
        if (value) send(value);
        else if (!input.value) send('');
      };
      input.commitNow = take;
      input.addEventListener('change', () => {
        clearTimeout(timer);
        timer = setTimeout(take, DAY_REST_MS);
      });
      input.addEventListener('blur', take);
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        take();
        enter(input);
      });
      box.append(input);
      return box;
    }
    const year = element('input', 'cf-input cf-year');
    year.type = 'text';
    year.inputMode = 'numeric';
    year.maxLength = 4;
    year.placeholder = 'Year';
    year.value = known.year ? String(known.year) : '';
    year.dataset.commit = 'true';
    year.setAttribute('aria-label', `${label}, year`);
    let month = null;
    if (precision === 'month') {
      month = element('select', 'cf-select cf-month');
      month.setAttribute('aria-label', `${label}, month`);
      month.dataset.field = field;
      month.append(choiceOf('Month', ''));
      MONTH_LONG.forEach((name, at) => month.append(choiceOf(name, String(at + 1))));
      month.value = known.month ? String(known.month) : '';
      year.dataset.field = `${field}-year`;
      box.append(month, year);
    } else {
      year.dataset.field = field;
      box.append(year);
    }
    const take = () => {
      const whole = writeWhen({ precision, year: Number(year.value), month: Number(month?.value ?? 0) });
      if (whole) send(whole);
      else if (!year.value && !month?.value) send('');
    };
    month?.addEventListener('change', take);
    year.addEventListener('change', take);
    year.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      take();
      enter(year);
    });
    return box;
  }

  function precisionSelect(index, precision) {
    const choice = element('select', 'cf-select cf-precision');
    choice.setAttribute('aria-label', 'How precise the day is');
    choice.title = 'A day, a month or a year';
    choice.dataset.field = 'precision';
    for (const option of PRECISIONS) choice.append(choiceOf(option.label, option.value));
    if (precision === 'text') choice.append(choiceOf('As written', 'text'));
    choice.value = precision;
    choice.addEventListener('change', () => {
      const wanted = choice.value;
      if (wanted === 'text') return;
      precisions[index] = wanted;
      // a day already written is written again at the precision chosen, as far as it is known
      let moved = false;
      changeRows((rows) => {
        const row = rows[index];
        if (!row) return;
        for (const key of ['when', 'until', 'x']) {
          if (!(key in row)) continue;
          const when = readWhen(row[key]);
          if (when.empty || when.precision === 'text') continue;
          const next = writeWhen(atPrecision(when, wanted));
          if (next && next !== row[key]) {
            row[key] = next;
            moved = true;
          }
        }
      });
      if (!moved) render(true);
      body.querySelector(`[data-row="${index}"] .cf-precision`)?.focus();
    });
    return choice;
  }

  function rowPrecision(row, index) {
    const cells = 'x' in row ? [row.x] : [row.when, row.until];
    const read = cells.map(readWhen).find((when) => !when.empty);
    return read ? read.precision : precisions[index] ?? 'day';
  }

  const isPeriod = (row, index) => row.type === 'period' || Boolean(periods[index]) || Boolean(String(row.until ?? '').trim());

  // -- a row --

  function rowLabel(family, row, index) {
    return {
      timeline: () => plainText(row.what) || `row ${index + 1}`,
      figures: () => plainText(row.figure) || `figure ${index + 1}`,
      categories: () => plainText(row.category) || `row ${index + 1}`,
      line: () => plainText(row.x) || `row ${index + 1}`,
      pictures: () => plainText(row.label) || plainText(row.picture) || `picture ${index + 1}`,
    }[family]();
  }

  function buildRow(read, row, index) {
    const family = read.form.family;
    const line = element('div', `cf-row${row.draft ? ' cf-draft' : ''}`);
    line.setAttribute('role', 'row');
    line.dataset.row = String(index);
    const label = rowLabel(family, row, index);
    const grip = button('cf-grip', { label: `Move ${label}`, iconName: 'grip', alone: true, title: 'Drag to move it, or Alt+↑ and Alt+↓' });
    grip.addEventListener('pointerdown', (event) => startDrag(event, index));
    grip.addEventListener('mousedown', nothing);
    const cells = element('div', 'cf-cells');
    if (family === 'timeline') {
      const period = isPeriod(row, index);
      line.classList.add(period ? 'cf-period' : 'cf-event');
      const precision = rowPrecision(row, index);
      cells.append(element('span', 'cf-tag', period ? 'Period' : 'Event'), precisionSelect(index, precision),
        whenInput({ cell: row.when, precision, label: period ? 'From' : 'Day', field: 'when', commit: (value) => setCell(index, 'when', value) }));
      if (period) {
        cells.append(element('span', 'cf-to', 'until'),
          whenInput({ cell: row.until, precision, label: 'Until', field: 'until', commit: (value) => setCell(index, 'until', value) }));
      }
      cells.append(textInput({
        value: shownCell(row.what), placeholder: period ? 'What went on' : 'What happened', label: 'What happened', field: 'what', wide: true,
        commit: (typed) => setCell(index, 'what', typedCell(row.what, typed)),
      }));
    } else if (family === 'figures') {
      const tick = element('label', 'cf-tick');
      const box = element('input');
      box.type = 'checkbox';
      box.checked = Boolean(row.floor);
      box.dataset.field = 'floor';
      box.setAttribute('aria-label', 'At least: the figure is a floor');
      box.addEventListener('change', () => setCell(index, 'floor', box.checked));
      tick.append(box, element('span', '', 'at least'));
      tick.title = 'The figure is a floor: it reads “at least”';
      cells.append(tick, textInput({
        value: shownCell(row.figure), placeholder: 'The figure', label: 'Figure', field: 'figure',
        commit: (typed) => {
          const { text, floor } = readFloor(typed);
          changeRows((rows) => {
            if (!rows[index]) return;
            rows[index].figure = typedCell(row.figure, text);
            if (floor) rows[index].floor = true;
          });
        },
      }), textInput({
        value: shownCell(row.words), placeholder: 'What it says', label: 'What it says', field: 'words', wide: true,
        commit: (typed) => setCell(index, 'words', typedCell(row.words, typed)),
      }));
    } else if (family === 'categories') {
      const { form, model } = read;
      cells.append(textInput({
        value: shownCell(row.category), placeholder: model.heads.category, label: model.heads.category, field: 'category', wide: true,
        commit: (typed) => renameCategory(index, typedCell(row.category, typed)),
      }));
      if (form.split) {
        cells.append(textInput({
          value: shownCell(row.split), placeholder: model.heads.split, label: model.heads.split, field: 'split',
          commit: (typed) => setCell(index, 'split', typedCell(row.split, typed)),
        }));
      }
      cells.append(textInput({
        value: row.count, placeholder: model.heads.count, label: model.heads.count, field: 'count', numeric: true,
        commit: (typed) => {
          const { text, floor } = readFloor(typed);
          const read2 = now();
          if (!read2?.form) return;
          const rows = shownRows(read2);
          if (!rows[index]) return;
          rows[index].count = text;
          if (rows[index].draft && filled(stripped(rows[index]))) {
            rows[index].draft = false;
            draft = null;
          }
          put(read2, { ...read2.model, floor: read2.model.floor || floor, rows: rows.filter((one) => !one.draft).map(stripped) });
        },
      }));
      if (form.colours) cells.append(swatch(read, plainText(row.category)));
      if (form.icons) cells.append(iconButton(read, plainText(row.category)));
    } else if (family === 'pictures') {
      const { model } = read;
      const listed = (input, list, className) => {
        if (list) input.setAttribute('list', list.id);
        input.classList.add(className);
        return input;
      };
      cells.append(pictureField(row, index), listed(textInput({
        value: shownCell(row.label), placeholder: model.heads.label, label: model.heads.label, field: 'label',
        commit: (typed) => setCell(index, 'label', typedCell(row.label, typed)),
      }), null, 'cf-wall-label'), textInput({
        value: shownCell(row.words), placeholder: model.heads.words, label: model.heads.words, field: 'words', wide: true,
        commit: (typed) => setCell(index, 'words', typedCell(row.words, typed)),
      }), listed(textInput({
        value: shownCell(row.group), placeholder: model.heads.group, label: model.heads.group, field: 'group',
        commit: (typed) => setCell(index, 'group', typedCell(row.group, typed)),
      }), groupList, 'cf-wall-group'), listed(textInput({
        value: shownCell(row.colour), placeholder: model.heads.colour, label: model.heads.colour, field: 'colour',
        commit: (typed) => setCell(index, 'colour', typedCell(row.colour, typed)),
      }), colourList, 'cf-wall-colour'));
    } else {
      if (read.model.days) {
        const precision = rowPrecision(row, index);
        cells.append(precisionSelect(index, precision),
          whenInput({ cell: row.x, precision, label: read.model.heads.x, field: 'x', commit: (value) => setCell(index, 'x', value) }));
      } else {
        cells.append(textInput({
          value: shownCell(row.x), placeholder: read.model.heads.x, label: read.model.heads.x, field: 'x', numeric: true,
          commit: (typed) => setCell(index, 'x', typedCell(row.x, typed)),
        }));
      }
      read.model.series.forEach((name, at) => {
        const called = read.model.series.length > 1 ? name : read.model.heads.value;
        cells.append(textInput({
          value: row.values[at] ?? '', placeholder: called, label: called, field: `value-${at}`, numeric: true,
          commit: (typed) => changeRows((rows) => {
            if (!rows[index]) return;
            rows[index].values = [...rows[index].values];
            rows[index].values[at] = typed;
          }),
        }));
      });
    }
    const remove = button('cf-remove', { label: `Take out ${label}`, iconName: 'x', alone: true, title: 'Take this row out' });
    pressable(remove, () => removeRow(index));
    line.append(grip, cells, remove);
    line.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      event.stopPropagation();
      const field = event.target.dataset?.field;
      commitFocused();
      const to = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (moveRow(index, to)) body.querySelector(`[data-row="${to}"] ${field ? `[data-field="${field}"]` : '.cf-grip'}`)?.focus();
    });
    return line;
  }

  /** A row's fields take the block's words in place, the one being typed in left alone. */
  function updateRow(read, line, row, index) {
    const active = document.activeElement;
    const family = read.form.family;
    line.classList.toggle('cf-draft', Boolean(row.draft));
    const label = rowLabel(family, row, index);
    line.querySelector('.cf-grip')?.setAttribute('aria-label', `Move ${label}`);
    line.querySelector('.cf-remove')?.setAttribute('aria-label', `Take out ${label}`);
    const set = (field, value) => {
      const input = line.querySelector(`input[data-field="${field}"]`);
      if (!input || input === active || input.value === value) return;
      input.value = value;
      input.dataset.was = value;
    };
    if (family === 'timeline') set('what', shownCell(row.what));
    if (family === 'figures') {
      set('figure', shownCell(row.figure));
      set('words', shownCell(row.words));
      const floor = line.querySelector('input[data-field="floor"]');
      if (floor && floor !== active) floor.checked = Boolean(row.floor);
    }
    if (family === 'categories') {
      set('category', shownCell(row.category));
      set('split', shownCell(row.split));
      set('count', row.count);
      // a colour or an icon just picked: its button is made again, and keeps the keyboard if it had it
      for (const [selector, make] of [['.cf-swatch', () => swatch(read, plainText(row.category))], ['.cf-icon', () => iconButton(read, plainText(row.category))]]) {
        const old = line.querySelector(selector);
        if (!old) continue;
        const made = make();
        old.replaceWith(made);
        if (old === active) made.focus({ preventScroll: true });
      }
    }
    if (family === 'pictures') {
      for (const key of ['label', 'words', 'group', 'colour']) set(key, shownCell(row[key]));
      if (!pickPicture) set('picture', row.picture);
      const old = line.querySelector('[data-field="picture"]');
      if (pickPicture && old && old.dataset.ref !== pictureRef(row.picture)) {
        const made = pictureField(row, index);
        old.replaceWith(made);
        if (old === active) made.focus({ preventScroll: true });
      }
    }
    if (family === 'line') {
      if (!read.model.days) set('x', shownCell(row.x));
      (row.values ?? []).forEach((value, at) => set(`value-${at}`, value));
    }
    // a day written elsewhere (Undo) shows as written
    for (const box of line.querySelectorAll('.cf-when')) {
      const input = box.querySelector('input[type="date"]');
      const key = input?.dataset.field;
      if (!input || input === active || !(key in row)) continue;
      const when = readWhen(row[key]);
      const value = when.empty || when.precision !== 'day' ? '' : isoDay(when);
      if (input.value !== value) input.value = value;
      box.dataset.was = when.empty ? '' : writeWhen(when);
    }
  }

  // -- a wall's pictures --

  /** The case's records read for a wall when the editor gives none, and the small pictures asked of them. */
  let caseEntities = null;
  let reading = null;
  let thumbs = new Map();

  function knownEntities() {
    const given = typeof entities === 'function' ? entities() : entities;
    if (Array.isArray(given)) return given;
    if (caseEntities === null && caseId && !reading) {
      reading = fetchAllEntities(caseId, { types: ['media', 'capture', 'proof'] }).then((found) => {
        caseEntities = found;
        if (!gone) render(true);
        return found;
      }, () => {
        caseEntities = [];
        return [];
      });
    }
    return caseEntities ?? [];
  }

  const entityOf = (ref) => (ref ? knownEntities().find((entity) => entity.id === ref) ?? null : null);

  /** Ask once for the small pictures of the records shown, then show them. */
  function askThumbs(list) {
    if (!caseId) return;
    const wanted = list.filter((entity) => entity?.attrs?.path && entity.type !== 'proof' && !thumbs.has(entity.attrs.path));
    if (!wanted.length) return;
    Promise.resolve(readThumbs(caseId, wanted)).then((known) => {
      if (gone || !known) return;
      thumbs = known;
      for (const node of panel.querySelectorAll('.cf-picture-thumb:empty')) {
        const entity = entityOf(node.dataset.ref);
        const src = entity ? thumbOf(caseId, entity, thumbs) : '';
        if (src) node.append(thumbImage(src));
      }
    });
  }

  function thumbImage(src) {
    const image = element('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = src;
    return image;
  }

  /** A row's picture: its small picture and its name, a press picking another; written as its id where nothing picks. */
  function pictureField(row, index) {
    const ref = pictureRef(row.picture);
    if (!pickPicture) {
      return textInput({
        value: row.picture, placeholder: 'e_… or [[media:…]]', label: 'Picture', field: 'picture',
        commit: (typed) => setCell(index, 'picture', typed),
      });
    }
    const entity = entityOf(ref);
    const known = knownEntities();
    const name = entity?.label || plainText(row.picture) || ref;
    const node = element('button', `cf-picture${ref ? '' : ' cf-picture-empty'}${ref && !entity && known.length ? ' cf-picture-gone' : ''}`);
    node.type = 'button';
    node.dataset.field = 'picture';
    node.dataset.ref = ref;
    node.setAttribute('aria-haspopup', 'dialog');
    node.setAttribute('aria-label', ref ? `Picture: ${name}. Press to pick another` : 'Pick a picture of the case');
    node.title = !ref ? 'Pick a picture of the case' : entity ? entity.label : 'This picture is no longer in the case';
    const thumb = element('span', 'cf-picture-thumb');
    thumb.dataset.ref = ref;
    const src = entity && caseId ? thumbOf(caseId, entity, thumbs) : '';
    if (src) thumb.append(thumbImage(src));
    else if (entity) askThumbs([entity]);
    node.append(thumb, element('span', 'cf-picture-name', ref ? name : 'Pick…'));
    return pressable(node, () => choosePicture(node, index));
  }

  function choosePicture(anchor, index) {
    pickPicture?.(anchor, (entity) => {
      if (!entity?.id) return;
      changeRows((rows) => {
        if (rows[index]) rows[index].picture = pictureCell(entity);
      });
      body.querySelector(`[data-row="${index}"] [data-field="label"]`)?.focus();
    });
  }

  /** The groups the rows hold and the grades, offered as each row's group and colour are typed. */
  function renderLists(read) {
    if (read.form.family !== 'pictures') return;
    const values = (key) => [...new Set(read.model.rows.map((row) => plainText(row[key]).trim()).filter(Boolean))];
    groupList.replaceChildren(...values('group').map((value) => choiceOf(value, value)));
    const colours = [...new Set([...GRADE_WORDS, ...values('colour')])];
    colourList.replaceChildren(...colours.map((value) => choiceOf(value, value)));
  }

  // -- colours and icons --

  function swatch(read, value) {
    const own = (read.model.colours ?? []).find(([name]) => name.toLowerCase() === value.toLowerCase())?.[1];
    const drawn = (read.drawn?.colours ?? []).find((one) => one.value.toLowerCase() === value.toLowerCase())?.colour;
    const node = element('button', `cf-swatch${own ? ' cf-own' : ''}`);
    node.type = 'button';
    node.dataset.field = 'colour';
    node.style.setProperty('--swatch', own ?? drawn ?? 'transparent');
    node.setAttribute('aria-label', value ? `Colour of ${value}` : 'Colour');
    node.title = own ? `Its own colour, ${own}` : 'Its colour: the case’s for this name, else the next of the chart’s';
    node.disabled = !value;
    node.setAttribute('aria-haspopup', 'dialog');
    return pressable(node, () => openSwatches(node, value, own ?? ''));
  }

  let swatches = null;
  function closeSwatches() {
    swatches?.();
    swatches = null;
  }

  function openSwatches(anchor, value, current) {
    closeSwatches();
    const box = element('div', 'cf-swatches');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `Colour of ${value}`);
    const choose = (colour) => {
      closeSwatches();
      setModel((model) => {
        const pairs = (model.colours ?? []).filter(([name]) => name.toLowerCase() !== value.toLowerCase());
        model.colours = colour ? [...pairs, [value, colour]] : pairs;
      });
    };
    const group = (name, list) => {
      if (!list.length) return;
      box.append(element('p', 'cf-swatches-head', name));
      const row = element('div', 'cf-swatches-row');
      for (const { colour, name: called } of list) {
        const chip = element('button', `cf-chip${colour === current ? ' cf-now' : ''}`);
        chip.type = 'button';
        chip.style.setProperty('--swatch', colour);
        chip.title = called ? `${called} · ${colour}` : colour;
        chip.setAttribute('aria-label', called ? `${called}, ${colour}` : colour);
        row.append(pressable(chip, () => choose(colour)));
      }
      box.append(row);
    };
    group('The case’s colours', (palette.colours ?? []).map((entry) => ({ colour: entry.colour, name: entry.name })));
    group('The chart’s', CHART_COLOURS.map((colour) => ({ colour, name: '' })));
    const auto = button('cf-link', { label: 'Automatic', title: 'The case’s colour for this name, else the next of the chart’s' });
    box.append(pressable(auto, () => choose('')));
    document.body.append(box);
    const place = anchor.getBoundingClientRect();
    box.style.left = `${Math.max(6, Math.min(place.left, window.innerWidth - box.offsetWidth - 6))}px`;
    box.style.top = `${place.bottom + 4 + box.offsetHeight > window.innerHeight ? Math.max(6, place.top - box.offsetHeight - 4) : place.bottom + 4}px`;
    const outside = (event) => {
      if (!box.contains(event.target) && event.target !== anchor) closeSwatches();
    };
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeSwatches();
      anchor.focus?.();
    });
    const timer = setTimeout(() => document.addEventListener('mousedown', outside, true));
    box.querySelector('button')?.focus();
    swatches = () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', outside, true);
      box.remove();
    };
  }

  function iconButton(read, value) {
    const word = (read.model.icons ?? []).find(([name]) => name.toLowerCase() === value.toLowerCase())?.[1] ?? '';
    const glyph = readGlyph(word);
    const node = element('button', `cf-icon${glyph ? '' : ' cf-icon-empty'}`);
    node.type = 'button';
    node.dataset.field = 'icon';
    node.disabled = !value;
    node.setAttribute('aria-haspopup', 'dialog');
    const name = glyph ? glyphLabel(glyph) : '';
    node.setAttribute('aria-label', value ? `Icon of ${value}: ${glyph ? name : 'the chart’s own'}` : 'Icon');
    node.title = glyph ? name : 'Pick an icon from your library or the app’s';
    node.append(glyph ? glyphNode(glyph) : icon('plus', 12));
    return pressable(node, () => openGlyphPicker(node, {
      title: `Icon of ${value}`,
      current: glyph,
      onPick: (picked) => setModel((model) => {
        const pairs = (model.icons ?? []).filter(([named]) => named.toLowerCase() !== value.toLowerCase());
        model.icons = picked ? [...pairs, [value, glyphWord(picked)]] : pairs;
      }),
    }));
  }

  /** A category renamed keeps its colour and its icon, when no other row holds the old name. */
  function renameCategory(index, after) {
    const read = now();
    if (!read?.form) return;
    const rows = shownRows(read);
    if (!rows[index]) return;
    const was = plainText(rows[index].category).toLowerCase();
    rows[index].category = after;
    const named = plainText(after);
    const shared = rows.some((row, at) => at !== index && plainText(row.category).toLowerCase() === was);
    const rename = (pairs) => pairs.map(([name, value]) => [was && !shared && name.toLowerCase() === was ? named : name, value]);
    if (rows[index].draft && filled(stripped(rows[index]))) {
      rows[index].draft = false;
      draft = null;
    }
    put(read, { ...read.model, rows: rows.filter((row) => !row.draft).map(stripped), colours: rename(read.model.colours ?? []), icons: rename(read.model.icons ?? []) });
  }

  // -- gestures on rows --

  function addRow(type, { pick = false } = {}) {
    const read = now();
    if (!read?.form) return;
    if (read.model.rows.length >= (read.form.most ?? Infinity)) return;
    draft = { family: read.form.family, type, row: blankRow(read.form.family, read.model.series?.length ?? 1) };
    render(true);
    const first = body.querySelector(`[data-row="${read.model.rows.length}"] [data-field]:not(.cf-precision):not([type="checkbox"])`);
    first?.focus();
    // a wall's new row is a picture first: its picker opens at once
    if (pick && read.form.family === 'pictures' && pickPicture && first) choosePicture(first, read.model.rows.length);
  }

  function removeRow(index) {
    const read = now();
    if (!read?.form) return;
    if (index >= read.model.rows.length) {
      draft = null;
      render(true);
      adds.querySelector('button')?.focus();
      return;
    }
    precisions = precisions.filter((_, at) => at !== index);
    periods = periods.filter((_, at) => at !== index);
    const rows = read.model.rows.filter((_, at) => at !== index);
    put(read, { ...read.model, rows });
    const left = body.querySelector(`[data-row="${Math.min(index, rows.length - 1)}"] .cf-remove`);
    (left ?? adds.querySelector('button'))?.focus();
  }

  function moveRow(from, to) {
    const read = now();
    if (!read?.form) return false;
    const count = read.model.rows.length;
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return false;
    const rows = [...read.model.rows];
    rows.splice(to, 0, ...rows.splice(from, 1));
    for (const list of [precisions, periods]) {
      while (list.length < count) list.push(undefined);
      list.splice(to, 0, ...list.splice(from, 1));
    }
    put(read, { ...read.model, rows });
    return true;
  }

  function startDrag(event, index) {
    if (event.button !== 0) return;
    const read = now();
    if (!read?.form || index >= read.model.rows.length) return;
    event.preventDefault();
    const rows = [...body.querySelectorAll('.cf-row')].slice(0, read.model.rows.length);
    const moving = { from: index, to: index };
    rows[index]?.classList.add('cf-dragged');
    const over = (move) => {
      let to = rows.length - 1;
      for (let at = 0; at < rows.length; at += 1) {
        const box = rows[at].getBoundingClientRect();
        if (move.clientY < box.top + box.height / 2) {
          to = at > moving.from ? at - 1 : at;
          break;
        }
      }
      moving.to = Math.max(0, Math.min(to, rows.length - 1));
      rows.forEach((row, at) => {
        row.classList.toggle('cf-over-above', at === moving.to && moving.to < moving.from);
        row.classList.toggle('cf-over-below', at === moving.to && moving.to > moving.from);
      });
    };
    const up = () => {
      document.removeEventListener('pointermove', over);
      document.removeEventListener('pointerup', up);
      rows.forEach((row) => row.classList.remove('cf-dragged', 'cf-over-above', 'cf-over-below'));
      if (moveRow(moving.from, moving.to)) body.querySelector(`[data-row="${moving.to}"] .cf-grip`)?.focus();
    };
    document.addEventListener('pointermove', over);
    document.addEventListener('pointerup', up);
  }

  // -- around the rows --

  function headingCells(read) {
    const { form, model } = read;
    const family = form.family;
    const cells = element('div', 'cf-cells');
    const named = (text, className = '') => element('span', `cf-col${className ? ` ${className}` : ''}`, text);
    const editable = (key, label, className = '', set = (next, typed) => { next.heads[key] = typed; }, value = model.heads[key]) => {
      const input = element('input', `cf-col-input${className ? ` ${className}` : ''}`);
      input.type = 'text';
      input.value = value;
      input.setAttribute('aria-label', label);
      input.title = 'The column’s name, as the chart and its table say it';
      input.dataset.head = key;
      input.dataset.commit = 'true';
      input.addEventListener('change', () => {
        const typed = input.value.replace(/\s+/g, ' ').trim();
        if (typed && typed !== value) setModel((next) => set(next, typed));
        else input.value = value;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return input;
    };
    if (family === 'timeline') {
      cells.append(named('', 'cf-col-tag'), named('Precision', 'cf-col-precision'), named(model.heads.when, 'cf-col-when'), named(model.heads.what, 'cf-wide'));
    } else if (family === 'figures') {
      cells.append(named('', 'cf-col-tick'), named(model.heads.figure, 'cf-col-figure'), named(model.heads.words, 'cf-wide'));
    } else if (family === 'pictures') {
      cells.append(editable('picture', 'Name of the pictures', 'cf-col-picture'), editable('label', 'Name of the labels', 'cf-wall-label'),
        editable('words', 'Name of the words', 'cf-wide'), editable('group', 'Name of the groups', 'cf-wall-group'),
        editable('colour', 'Name of the colours', 'cf-wall-colour'));
    } else if (family === 'categories') {
      cells.append(editable('category', 'Name of the categories', 'cf-wide'));
      if (form.split) cells.append(editable('split', 'Name of the split'));
      cells.append(editable('count', 'Name of the counts', 'cf-number'));
      if (form.colours && form.icons) cells.append(named('Colour, icon', 'cf-col-both'));
      else if (form.colours) cells.append(named('Colour', 'cf-col-swatch'));
      else if (form.icons) cells.append(named('Icon', 'cf-col-icon'));
    } else {
      if (model.days) cells.append(named('Precision', 'cf-col-precision'));
      cells.append(editable('x', 'Name of what runs along', model.days ? 'cf-col-when' : 'cf-number'));
      if (model.series.length === 1) cells.append(editable('value', 'Name of the values', 'cf-number'));
      else {
        model.series.forEach((name, at) => {
          const box = element('span', 'cf-series');
          box.append(editable(`series-${at}`, `Name of series ${at + 1}`, 'cf-number', (next, typed) => { next.series[at] = typed; }, name));
          const out = button('cf-series-out', { label: `Take out the series ${name}`, iconName: 'x', alone: true, title: 'Take this series out' });
          box.append(pressable(out, () => setModel((next) => {
            next.series.splice(at, 1);
            next.rows = next.rows.map((row) => ({ ...row, values: row.values.filter((_, one) => one !== at) }));
          })));
          cells.append(box);
        });
      }
    }
    return cells;
  }

  function renderExtra(read) {
    const parts = [];
    const { form, model } = read;
    if (form.family === 'categories') {
      const tick = element('label', 'cf-tick cf-floor');
      const box = element('input');
      box.type = 'checkbox';
      box.checked = Boolean(model.floor);
      box.dataset.extra = 'floor';
      box.addEventListener('change', () => setModel((next) => { next.floor = box.checked; }));
      tick.append(box, element('span', '', 'These counts are floors: “at least”'));
      tick.title = 'Their column says “at least”, and the title is asked to say it too';
      parts.push(tick);
    }
    if (form.family === 'line') {
      const along = element('div', 'cf-seg');
      along.setAttribute('role', 'radiogroup');
      along.setAttribute('aria-label', 'What runs along');
      for (const [value, label] of [[true, 'Days'], [false, 'Numbers']]) {
        const choice = element('button', 'cf-seg-btn', label);
        choice.type = 'button';
        choice.setAttribute('role', 'radio');
        choice.setAttribute('aria-checked', String(model.days === value));
        along.append(pressable(choice, () => {
          if (model.days === value) return;
          setModel((next) => {
            next.days = value;
            if (next.heads.x === (value ? 'Number' : 'Day')) next.heads.x = value ? 'Day' : 'Number';
          });
          render(true);
        }));
      }
      const row = element('div', 'cf-along');
      row.append(element('span', 'cf-hint', 'Along'), along);
      parts.push(row);
    }
    if (form.family === 'pictures') {
      const shapes = element('div', 'cf-seg');
      shapes.setAttribute('role', 'radiogroup');
      shapes.setAttribute('aria-label', 'Shape of the pictures');
      const now2 = model.shape || WALL_SHAPES[0];
      for (const value of WALL_SHAPES) {
        const choice = element('button', 'cf-seg-btn', value);
        choice.type = 'button';
        choice.setAttribute('role', 'radio');
        choice.setAttribute('aria-checked', String(now2 === value));
        choice.title = `Every picture cropped to ${value}`;
        shapes.append(pressable(choice, () => {
          if (now2 === value) return;
          setModel((next) => { next.shape = value; });
          render(true);
        }));
      }
      const row = element('div', 'cf-along');
      row.append(element('span', 'cf-hint', 'Shape'), shapes);
      parts.push(row);
    }
    if (form.whole) {
      const row = element('div', 'cf-whole');
      const whole = model.whole ?? { name: '', amount: '' };
      row.append(element('span', 'cf-hint', 'The whole'), textInput({
        value: shownCell(whole.name), placeholder: 'What the whole is', label: 'Name of the whole', field: 'whole-name', wide: true,
        commit: (typed) => setModel((next) => { next.whole = { ...next.whole, name: typedCell(whole.name, typed) }; }),
      }), textInput({
        value: whole.amount, placeholder: 'Its count', label: 'The whole', field: 'whole', numeric: true,
        commit: (typed) => setModel((next) => { next.whole = { ...next.whole, amount: readFloor(typed).text }; }),
      }));
      parts.push(row);
    }
    extra.replaceChildren(...parts);
    extra.hidden = !parts.length;
  }

  function renderAdds(read) {
    const { form } = read;
    const most = form.most ?? Infinity;
    const full = read.model.rows.length >= most;
    const buttons = ADDS[form.family].map((one) => {
      const node = button('cf-add', { label: `＋ ${one.label}`, title: full ? `${form.label} compare ${most} at most` : one.title });
      node.disabled = full;
      node.dataset.add = one.id;
      return pressable(node, () => addRow(one.id, { pick: true }));
    });
    if (form.family === 'line') {
      const series = button('cf-add', { label: '＋ Series', title: 'Another column of values, drawn as its own line' });
      series.dataset.add = 'series';
      buttons.push(pressable(series, () => setModel((model) => {
        if (model.series.length === 1) model.series[0] = model.series[0] || model.heads.value;
        model.series.push(`Series ${model.series.length + 1}`);
        model.rows = model.rows.map((row) => ({ ...row, values: [...row.values, ''] }));
      })));
    }
    const fill = button('cf-fill-open', { label: 'Fill from the case…', iconName: 'download', title: FILL_TITLES[form.family] });
    fill.setAttribute('aria-expanded', String(filling));
    fill.hidden = !caseId;
    pressable(fill, () => toggleFill());
    adds.replaceChildren(...buttons, element('span', 'cf-spring'), fill);
  }

  function renderAfter(read) {
    const row = element('label', 'cf-source');
    const written = setting(readChart(read.source), 'source');
    const input = textInput({
      value: written, placeholder: 'Where the figures come from, as the credit under the chart says it', label: 'Source', field: 'source', wide: true,
      commit: (typed) => write(withSettings(state().source, { source: typed })),
    });
    delete input.dataset.field;
    input.dataset.source = 'true';
    row.append(element('span', 'cf-hint', 'Source'), input);
    after.replaceChildren(row);
  }

  // -- drawing it --

  /** What makes the rows be made again: their number, their kind, their precision, the columns. */
  function signature(read) {
    if (!read?.form) return 'none';
    const rows = shownRows(read);
    return JSON.stringify([read.kind, read.form.family, rows.length, rows.map((row, index) => [isPeriod(row, index), 'when' in row || 'x' in row ? rowPrecision(row, index) : '']),
      read.model.series?.length ?? 0, read.model.days ?? null, Boolean(read.model.whole)]);
  }

  function render(force = false) {
    if (gone) return;
    const read = now();
    if (!read) return;
    kindName.textContent = FORMS[read.kind]?.label ?? 'Chart';
    needs.textContent = FORMS[read.kind]?.needs ?? '';
    title.render();
    if (!read.form) {
      shape = 'none';
      for (const part of [extra, grid, adds, after]) part.hidden = true;
      said.textContent = read.why ?? '';
      return;
    }
    grid.hidden = false;
    adds.hidden = false;
    after.hidden = false;
    said.textContent = '';
    const next = signature(read);
    const active = document.activeElement;
    const rows = shownRows(read);
    if (force || next !== shape) {
      const inside = panel.contains(active) ? { row: active.closest('[data-row]')?.dataset.row, field: active.dataset?.field, head: active.dataset?.head } : null;
      shape = next;
      heading.replaceChildren(element('span', 'cf-grip-room'), headingCells(read), element('span', 'cf-remove-room'));
      body.replaceChildren(...rows.map((row, index) => buildRow(read, row, index)));
      if (!rows.length) body.append(element('p', 'cf-empty', EMPTY_HINT[read.form.family]));
      renderExtra(read);
      renderAdds(read);
      renderAfter(read);
      renderLists(read);
      if (inside && !active.isConnected) {
        const found = inside.head ? heading.querySelector(`[data-head="${inside.head}"]`)
          : inside.row !== undefined ? body.querySelector(`[data-row="${inside.row}"] [data-field="${inside.field}"]`) : null;
        found?.focus();
      }
      return;
    }
    rows.forEach((row, index) => {
      const line = body.querySelector(`[data-row="${index}"]`);
      if (line) updateRow(read, line, row, index);
    });
    for (const input of heading.querySelectorAll('[data-head]')) {
      const key = input.dataset.head;
      const value = key.startsWith('series-') ? read.model.series[Number(key.slice(7))] ?? '' : read.model.heads[key] ?? '';
      if (input !== active && input.value !== value) input.value = value;
    }
    const floor = extra.querySelector('[data-extra="floor"]');
    if (floor && floor !== active) floor.checked = Boolean(read.model.floor);
    for (const [field, value] of [['whole-name', shownCell(read.model.whole?.name ?? '')], ['whole', read.model.whole?.amount ?? '']]) {
      const input = extra.querySelector(`[data-field="${field}"]`);
      if (input && input !== active && input.value !== value) {
        input.value = value;
        input.dataset.was = value;
      }
    }
    const most = read.form.most ?? Infinity;
    for (const add of adds.querySelectorAll('[data-add]')) if (add.dataset.add !== 'series') add.disabled = read.model.rows.length >= most;
    renderLists(read);
    const source = after.querySelector('[data-source]');
    const written = setting(readChart(read.source), 'source');
    if (source && source !== active && source.value !== written) {
      source.value = written;
      source.dataset.was = written;
    }
  }

  // -- Fill from the case --

  function toggleFill(open = !filling) {
    const read = now();
    if (!read?.form || !caseId) return;
    filling = open;
    fillBox.hidden = !open;
    adds.querySelector('.cf-fill-open')?.setAttribute('aria-expanded', String(open));
    if (!open) {
      fillBox.replaceChildren();
      return;
    }
    if (read.form.family === 'timeline') fillEvents();
    else if (read.form.family === 'pictures') fillPictures();
    else fillCounts(read);
  }

  function fillHead(family) {
    const top = element('div', 'cf-fill-head');
    top.append(element('strong', '', 'Fill from the case'), element('span', 'cf-hint', FILL_SAID[family]));
    return top;
  }

  function fillFoot(label, run) {
    const foot = element('div', 'cf-fill-foot');
    const go = button('cf-go', { label });
    const cancel = button('cf-link', { label: 'Cancel' });
    foot.append(pressable(go, run), pressable(cancel, () => {
      toggleFill(false);
      adds.querySelector('.cf-fill-open')?.focus();
    }));
    return { foot, go };
  }

  const said2 = (node, text) => {
    node.lastChild.textContent = text;
  };

  function dateInput(label) {
    const input = element('input', 'cf-input cf-date');
    input.type = 'date';
    input.setAttribute('aria-label', label);
    return input;
  }

  function fillEvents() {
    const period = element('div', 'cf-fill-period');
    const from = dateInput('From');
    const until = dateInput('Until');
    period.append(element('span', 'cf-hint', 'From'), from, element('span', 'cf-hint', 'until'), until);
    const status = element('p', 'cf-hint cf-fill-status', 'Reading the case…');
    status.setAttribute('role', 'status');
    const list = element('ul', 'cf-fill-list');
    list.setAttribute('aria-label', 'What it would add');
    let proposed = [];
    const { foot, go } = fillFoot('Add them', () => {
      const ticked = proposed.filter((one) => one.ticked).map((one) => one.row);
      if (!ticked.length) return;
      toggleFill(false);
      changeRows((rows) => {
        const at = rows.findIndex((row) => row.draft);
        rows.splice(at >= 0 ? at : rows.length, 0, ...ticked);
      });
      adds.querySelector('.cf-fill-open')?.focus();
    });
    const sayGo = () => {
      const count = proposed.filter((one) => one.ticked).length;
      said2(go, count ? `Add ${count} event${count === 1 ? '' : 's'}` : 'Add them');
      go.disabled = !count;
    };
    let asked = 0;
    const ask = (first) => {
      const ticket = ++asked;
      status.textContent = 'Reading the case…';
      Promise.resolve(caseEvents({ caseId, from: first ? '' : from.value, to: first ? '' : until.value, zone: axisZone(caseId) })).then((answer) => {
        if (ticket !== asked || !filling) return;
        if (answer.error) {
          status.textContent = `Not read: ${answer.error}`;
          return;
        }
        if (first) {
          from.value = answer.first ?? '';
          until.value = answer.last ?? '';
        }
        proposed = eventRows(answer.items, now()?.model?.rows ?? []);
        list.replaceChildren(...proposed.map((one, index) => {
          const item = element('li', 'cf-fill-item');
          const label = element('label', 'cf-fill-line');
          const tick = element('input');
          tick.type = 'checkbox';
          tick.checked = one.ticked;
          tick.addEventListener('change', () => {
            proposed[index].ticked = tick.checked;
            sayGo();
          });
          const day = element('span', 'cf-fill-day', one.row.until ? `${one.row.when} – ${one.row.until}` : one.row.when);
          if (one.event.approximate) day.title = 'The case gives this day as approximate';
          label.append(tick, day, element('span', 'cf-fill-words', plainText(one.row.what)), element('span', 'cf-fill-from', one.event.type === 'proof' ? 'Proof' : 'Event'));
          if (one.event.approximate) label.append(element('span', 'cf-fill-about', 'about'));
          if (one.said) label.append(element('span', 'cf-fill-said', one.said));
          item.append(label);
          return item;
        }));
        const parts = [answer.total ? `${answer.total} in this period` : 'Nothing dated in this period'];
        if (answer.total > answer.items.length) parts.push(`the first ${answer.items.length} listed`);
        if (answer.undated) parts.push(`${answer.undated} with no day left out`);
        status.textContent = `${parts.join(', ')}.`;
        sayGo();
      });
    };
    from.addEventListener('change', () => ask(false));
    until.addEventListener('change', () => ask(false));
    fillBox.replaceChildren(fillHead('timeline'), period, status, list, foot);
    sayGo();
    ask(true);
    from.focus();
  }

  /** A wall's Fill from the case: the case's pictures by folder, ticked, added a row each. */
  function fillPictures() {
    const where = element('label', 'cf-fill-field');
    const folder = element('select', 'cf-select');
    folder.setAttribute('aria-label', 'Folder');
    where.append(element('span', 'cf-hint', 'Folder'), folder);
    const fields = element('div', 'cf-fill-fields');
    fields.append(where);
    const status = element('p', 'cf-hint cf-fill-status', 'Reading the case…');
    status.setAttribute('role', 'status');
    const list = element('ul', 'cf-fill-list');
    list.setAttribute('aria-label', 'Pictures it would add');
    let proposed = [];
    const { foot, go } = fillFoot('Add them', () => {
      const ticked = proposed.filter((one) => one.ticked).map((one) => one.entity);
      if (!ticked.length) return;
      toggleFill(false);
      changeRows((rows, read) => {
        const at = rows.findIndex((row) => row.draft);
        rows.splice(at >= 0 ? at : rows.length, 0, ...pictureRows(ticked, read.model.rows));
      });
      adds.querySelector('.cf-fill-open')?.focus();
    });
    const sayGo = () => {
      const count = proposed.filter((one) => one.ticked).length;
      said2(go, count ? `Add ${count} picture${count === 1 ? '' : 's'}` : 'Add them');
      go.disabled = !count;
    };
    const every = () => casePictures(knownEntities(), '', { limit: 5000 })
      .sort((a, b) => String(a.attrs?.folder ?? '').localeCompare(String(b.attrs?.folder ?? ''))
        || String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
    const show = () => {
      const all = every();
      const held = new Set((now()?.model?.rows ?? []).map((row) => pictureRef(row.picture)).filter(Boolean));
      const chosen = folder.value;
      const shown = all.filter((entity) => chosen === '*' || (entity.attrs?.folder ?? '') === chosen);
      proposed = shown.map((entity) => ({ entity, ticked: chosen !== '*' && !held.has(entity.id), held: held.has(entity.id) }));
      list.replaceChildren(...proposed.map((one, index) => {
        const item = element('li', 'cf-fill-item');
        const label = element('label', 'cf-fill-line cf-fill-picture');
        const tick = element('input');
        tick.type = 'checkbox';
        tick.checked = one.ticked;
        tick.addEventListener('change', () => {
          proposed[index].ticked = tick.checked;
          sayGo();
        });
        const thumb = element('span', 'cf-picture-thumb');
        thumb.dataset.ref = one.entity.id;
        const src = caseId ? thumbOf(caseId, one.entity, thumbs) : '';
        if (src) thumb.append(thumbImage(src));
        label.append(tick, thumb, element('span', 'cf-fill-words', one.entity.label));
        if (one.held) label.append(element('span', 'cf-fill-said', 'already in the wall'));
        item.append(label);
        return item;
      }));
      askThumbs(shown.slice(0, 200));
      status.textContent = all.length
        ? `${shown.length} picture${shown.length === 1 ? '' : 's'}${chosen === '*' ? ' in the case: tick the ones to add' : ' in this folder'}.`
        : 'The case holds no picture yet.';
      sayGo();
    };
    const fill = () => {
      const all = every();
      const folders = [...new Set(all.map((entity) => entity.attrs?.folder ?? ''))];
      folder.replaceChildren(choiceOf('Every folder', '*'), ...folders.map((name) => choiceOf(name || 'No folder', name)));
      folder.value = folders.length === 1 ? folders[0] : '*';
      show();
    };
    folder.addEventListener('change', show);
    fillBox.replaceChildren(fillHead('pictures'), fields, status, list, foot);
    sayGo();
    if (!Array.isArray(typeof entities === 'function' ? entities() : entities) && caseEntities === null) {
      knownEntities();
      Promise.resolve(reading).then(() => {
        if (filling) fill();
      });
    } else fill();
    folder.focus();
  }

  function fillCounts(read) {
    const family = read.form.family;
    const pick = (label, options, value) => {
      const field = element('label', 'cf-fill-field');
      const choice = element('select', 'cf-select');
      choice.setAttribute('aria-label', label);
      for (const option of options) choice.append(choiceOf(option.label, option.value));
      choice.value = value;
      field.append(element('span', 'cf-hint', label), choice);
      return { field, choice };
    };
    const origin = pick('Rows from', [{ value: '', label: 'Reading the case…' }], '');
    const fields = element('div', 'cf-fill-fields');
    fields.append(origin.field);
    const columns = element('div', 'cf-fill-fields');
    const status = element('p', 'cf-hint cf-fill-status');
    status.setAttribute('role', 'status');
    const preview = element('div', 'cf-fill-preview');
    let counted = null;
    const { foot, go } = fillFoot('Write these rows', () => {
      if (!counted?.rows?.length) return;
      const answer = counted;
      toggleFill(false);
      draft = null;
      setModel((model, current) => {
        if (family === 'line') {
          const made = countedRows(answer, 'line');
          model.series = made.series;
          model.rows = made.rows;
          model.days = Boolean(answer.days);
        } else model.rows = countedRows(answer, family, { split: Boolean(current.form.split) });
        if (family === 'categories') model.floor = Boolean(answer.floor);
      });
      adds.querySelector('.cf-fill-open')?.focus();
    });
    go.disabled = true;
    fillBox.replaceChildren(fillHead(family), fields, columns, status, preview, foot);
    Promise.resolve(chartSources({ caseId, noteId: '' })).then((sources) => {
      if (!filling) return;
      if (sources.error) {
        status.textContent = `Not listed: ${sources.error}`;
        return;
      }
      const options = [
        ...sources.tables.map((table) => ({ value: table.origin, label: `${table.heading || 'A table'} · ${table.note}` })),
        ...sources.sheets.map((sheet) => ({ value: sheet.origin, label: `${sheet.title} · sheet` })),
      ];
      if (!options.length) {
        origin.choice.replaceChildren(choiceOf('No table or sheet in the case', ''));
        status.textContent = 'The case holds no note table and no sheet to count.';
        return;
      }
      origin.choice.replaceChildren(choiceOf('Pick a table or a sheet', ''), ...options.map((option) => choiceOf(option.label, option.value)));
      origin.choice.focus();
    });
    origin.choice.addEventListener('change', () => {
      const chosen = origin.choice.value;
      columns.replaceChildren();
      preview.replaceChildren();
      counted = null;
      go.disabled = true;
      if (!chosen) return;
      status.textContent = 'Reading its rows…';
      Promise.resolve(chartRows({ caseId, origin: chosen, fresh: true })).then((rows) => {
        if (!filling || origin.choice.value !== chosen) return;
        const table = rows.found ? parseTable(rows.text) : null;
        if (rows.error || !table) {
          status.textContent = rows.error ? `Not read: ${rows.error}` : rows.found ? 'No rows to count there.' : 'It is no longer in the case.';
          return;
        }
        const read2 = readColumns(table);
        const names = read2.map((column) => plainText(column.header) || `Column ${column.column + 1}`);
        const numbers = read2.filter((column) => column.numeric).map((column) => names[column.column]);
        const words = read2.filter((column) => !column.numeric).map((column) => names[column.column]);
        const dayLike = (column) => {
          const cells = table.rows.map((row) => row[column]).filter((cell) => plainText(cell));
          return cells.length > 0 && cells.filter((cell) => readWhen(cell).precision !== 'text').length * 2 >= cells.length;
        };
        const days = names.filter((_, at) => dayLike(at));
        const along = family === 'line' ? [...days, ...names.filter((name) => !days.includes(name))] : words.length ? words : names;
        const by = pick(family === 'line' ? 'Along' : 'Count by', along.map((name) => ({ value: name, label: name })), along[0] ?? '');
        const amount = pick(family === 'line' ? 'Value' : 'Counted as', [{ value: '', label: 'Rows, one each' }, ...numbers.map((name) => ({ value: name, label: `The sum of ${name}` }))], '');
        const parts = [by.field, amount.field];
        let split = null;
        if (read.form.split || family === 'line') {
          split = pick(family === 'line' ? 'A line for each' : 'Split by', [{ value: '', label: family === 'line' ? 'One line' : 'Pick a column' }, ...words.map((name) => ({ value: name, label: name }))], '');
          parts.push(split.field);
        }
        columns.replaceChildren(...parts);
        let ticket = 0;
        const count = () => {
          const asked = {
            caseId, origin: chosen, by: by.choice.value, split: split?.choice.value ?? '', amount: amount.choice.value,
            days: family === 'line' && days.includes(by.choice.value),
          };
          preview.replaceChildren();
          counted = null;
          go.disabled = true;
          if (!asked.by) return;
          if (read.form.split && !asked.split) {
            status.textContent = `${table.rows.length} rows. Pick what splits each bar.`;
            return;
          }
          status.textContent = 'Counting…';
          const mine = ++ticket;
          Promise.resolve(chartCounts(asked)).then((answer) => {
            if (!filling || mine !== ticket) return;
            if (answer.error) {
              status.textContent = `Not counted: ${answer.error}`;
              return;
            }
            counted = { ...answer, days: asked.days };
            const most = read.form.most ?? Infinity;
            if (counted.rows.length > most) counted.rows = counted.rows.slice(0, most);
            preview.replaceChildren(previewTable(counted, family, Boolean(asked.split), asked.amount));
            const total = family === 'line' ? countedRows(counted, 'line').rows.length : counted.rows.length;
            const held = now()?.model?.rows?.length ?? 0;
            said2(go, held ? `Replace the ${held} row${held === 1 ? '' : 's'} with these ${total}` : `Write these ${total} row${total === 1 ? '' : 's'}`);
            go.disabled = !total;
            const floor = counted.floor ? 'A number it adds is a floor, so the counts say “at least”.' : '';
            const cut = answer.rows.length > counted.rows.length ? `A ${read.form.label.toLowerCase()} chart takes ${most}: the first ${most} are kept.` : '';
            status.textContent = [`${total} row${total === 1 ? '' : 's'} from ${table.rows.length}.`, floor, cut, leftOutSaid(counted)].filter(Boolean).join(' ');
          });
        };
        for (const one of [by, amount, split]) one?.choice.addEventListener('change', count);
        count();
      });
    });
  }

  function previewTable(counted, family, split, amount) {
    const table = element('table', 'cf-fill-table');
    const head = element('tr');
    const counts = amount ? `Sum of ${amount}` : 'Rows';
    const columns = family === 'figures' ? ['Figure', 'What it says'] : split ? ['Value', 'Split', counts] : ['Value', counts];
    for (const name of columns) head.append(element('th', '', name));
    const thead = element('thead');
    thead.append(head);
    const tbody = element('tbody');
    for (const row of counted.rows.slice(0, 40)) {
      const line = element('tr');
      const floor = counted.floor ? 'at least ' : '';
      const cells = family === 'figures' ? [`${floor}${row.count}`, row.value] : split ? [row.value, row.split, row.count] : [row.value, row.count];
      for (const cell of cells) line.append(element('td', '', cell));
      tbody.append(line);
    }
    table.append(thead, tbody);
    if (counted.rows.length > 40) {
      const box = element('div');
      box.append(table, element('p', 'cf-hint', `And ${counted.rows.length - 40} more.`));
      return box;
    }
    return table;
  }

  render(true);
  return {
    node: panel,
    refresh: () => render(),
    commit: () => {
      commitFocused();
      title.commit();
    },
    focus() {
      const read = now();
      if (read?.form && !read.model.rows.length && !draft) {
        addRow(ADDS[read.form.family][0].id);
        return;
      }
      (body.querySelector('[data-field]:not(.cf-precision):not([type="checkbox"]):not(button)') ?? title.field).focus({ preventScroll: true });
    },
    destroy() {
      gone = true;
      closeSwatches();
      filling = false;
    },
  };
}
