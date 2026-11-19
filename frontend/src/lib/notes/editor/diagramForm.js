/**
 * A diagram made from scratch: a form made for its kind (`editor/diagramText.js` says the
 * six), on the diagram in the note, its drawing beside it as each choice is written.
 *
 * - **Boxes**: *＋ Box*, each with its words, a shape (a box, round, a diamond for a
 *   decision, a cylinder, a person) and a category; an organisation's and a mind map's box
 *   says the box it stands under, a timeline's event its day and its phase.
 * - **Links**: *＋ Link*, from one box to another picked from the list, with words on it,
 *   solid or dashed, an arrow or not. A sequence's messages, in the order they are sent.
 * - **Direction**, left to right or top down, and **Style**, Report, Book or Dark, a press each.
 * - **Colours**: each category's, from the case's palette when it names one, else the charts'
 *   own order; under the drawing, a legend; *Keep these colours for the case* names them there.
 *
 * Rows move with their ▲ ▼ (or Alt+↑ ↓) and go with their ×. **Each gesture is one
 * `write(model)`, one Undo step**: a field once committed (Enter, Tab or leaving it), a
 * choice, a row added, moved or taken out, a colour. The form's own Undo, and Ctrl+Z on
 * anything but a field being typed in, take the last one back.
 *
 * The rows are made again only when the boxes, the links or the events change in number,
 * order or kind; otherwise each field takes the model's words in place, the one being typed
 * in left alone, so the keyboard stays put.
 *
 * Here too: the kind gallery `/` › Diagram opens (`openDiagramGallery`), and the two panels
 * that make a diagram from the case (`openNetworkPanel`, `openTimelinePanel`), each listing
 * what it will take before it writes.
 */
import { renderMermaidSvg } from '../../mermaid.js';
import { button, icon, openPopover } from './gridMenu.js';
import { caseEvents, graphReading, graphView, graphViews, networkModel, timelineModel } from './diagramCase.js';
import {
  CATEGORISED, DIAGRAM_COLOURS, DIAGRAM_KINDS, DIAGRAM_STYLE_NAMES, DIAGRAM_STYLES, DIRECTED, KIND_SHAPES, SHAPE_HINTS,
  SHAPE_NAMES, addBox, addEvent, addLink, canStandUnder, categoriesOf, categoryChoices, changeBox, changeEvent, changeLink, colourFor,
  convertModel, hasTitle, isTree, moveItem, removeBox, removeEvent, removeLink, starterModel, withColours, writeDiagram,
} from './diagramText.js';
import './diagramForm.css';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** What a kind's lists are called, and what their *＋* adds. */
const WORDS = {
  boxes: { flow: 'Boxes', network: 'Boxes', org: 'Boxes', mindmap: 'Ideas', sequence: 'People', timeline: 'Events' },
  add: { flow: 'Box', network: 'Box', org: 'Box', mindmap: 'Idea', sequence: 'Person', timeline: 'Event' },
  links: { flow: 'Links', network: 'Links', sequence: 'Messages' },
  addLink: { flow: 'Link', network: 'Link', sequence: 'Message' },
  category: { flow: 'Category', network: 'Category', org: 'Category', sequence: 'Group' },
};

/** A box as a list names it: its first line of words, or its place. */
export function boxName(box, at) {
  const first = String(box?.text ?? '').split('\n')[0].trim();
  return first || `Box ${at + 1}`;
}

/** The colours a category is offered: the case's, then the charts' order. */
export function colourChoices(palette = []) {
  const named = palette.filter((entry) => /^#[0-9a-f]{6}$/i.test(entry.colour ?? '')).map((entry) => ({ colour: entry.colour.toLowerCase(), name: entry.name }));
  const own = DIAGRAM_COLOURS.filter((colour) => !named.some((entry) => entry.colour === colour)).map((colour) => ({ colour, name: '' }));
  return [...named, ...own];
}

/** A press that leaves the keyboard where it is: a menu's choice, a swatch. */
function steady(node) {
  node.addEventListener('mousedown', (event) => event.preventDefault());
  return node;
}

function segmented(label, options, value, onChange) {
  const row = element('div', 'dg-field dg-seg-field');
  row.append(element('span', 'dg-field-name', label));
  const group = element('div', 'dg-seg');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const choice = element('button', 'dg-seg-btn', option.label);
    choice.type = 'button';
    choice.setAttribute('role', 'radio');
    choice.setAttribute('aria-checked', String(option.value === value));
    choice.addEventListener('click', () => {
      if (option.value !== value) onChange(option.value);
    });
    group.append(choice);
  }
  row.append(group);
  return row;
}

/** A field of words that grows with them: Enter commits, Shift+Enter starts a line where `lines` allows it. */
function wordsField(className, { label, placeholder, lines = false }) {
  const field = element(lines ? 'textarea' : 'input', `dg-input ${className}`);
  if (lines) field.rows = 1;
  else field.type = 'text';
  field.setAttribute('aria-label', label);
  field.placeholder = placeholder;
  field.spellcheck = true;
  return field;
}

function grow(field) {
  if (field.tagName !== 'TEXTAREA') return;
  field.style.height = 'auto';
  field.style.height = `${Math.max(28, field.scrollHeight + 2)}px`;
}

function select(className, label, options, value) {
  const field = element('select', `dg-select ${className}`);
  field.setAttribute('aria-label', label);
  for (const option of options) {
    const item = element('option', '', option.label);
    item.value = option.value;
    if (option.disabled) item.disabled = true;
    field.append(item);
  }
  field.value = value;
  return field;
}

function small(className, { label, iconName, text }) {
  const node = element('button', `dg-small ${className}`);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  if (iconName) node.append(icon(iconName, 13));
  if (text) node.append(element('span', '', text));
  return node;
}

/**
 * The form, drawn in `panel` of the editor `view`. `state()` answers the model read from the block now;
 * `write(model)` writes it, one Undo step; `undo()` and `canUndo()` are the note's;
 * `palette()` the case's colours (`[{ name, colour }]`); `keep(values)`, given, names
 * colours in the case; `fromCase(which, anchor)`, given, opens the Graph's or the Timeline's
 * panel; `kind(anchor)` the gallery to draw it as another kind; `close()` closes the form.
 * Answers `{ refresh, focus, destroy }`.
 */
export function diagramForm(panel, {
  view, state, write, undo = null, canUndo = () => false, palette = () => [], keep = null, fromCase = null, kind = null, close = null,
}) {
  panel.classList.add('dg-form');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Diagram');
  let shape = '';
  let model = state();

  const head = element('div', 'dg-head');
  const kindName = element('strong', 'dg-kind');
  const needs = element('span', 'dg-needs');
  const spring = element('span', 'dg-spring');
  const caseButton = small('dg-from-case', { label: 'From the case', iconName: 'graph', text: 'From the case…' });
  caseButton.addEventListener('click', () => fromCase?.(model.kind === 'timeline' ? 'timeline' : 'graph', caseButton));
  const kindButton = small('dg-change-kind', { label: 'Draw it as another kind', iconName: 'swap', text: 'Kind…' });
  kindButton.addEventListener('click', () => kind?.(kindButton));
  const undoButton = small('dg-undo', { label: 'Undo', iconName: 'undo', text: 'Undo' });
  undoButton.addEventListener('click', () => {
    // the keyboard on the press, so the field the step gives back shows it
    undoButton.focus({ preventScroll: true });
    undo?.();
  });
  const closeButton = small('dg-close', { label: 'Close the form', iconName: 'x' });
  closeButton.addEventListener('click', () => close?.());
  head.append(kindName, needs, spring, caseButton, kindButton, undoButton, closeButton);

  const titleRow = element('label', 'dg-field dg-title-row');
  titleRow.append(element('span', 'dg-field-name', 'Title'));
  const titleField = wordsField('dg-title', { label: 'Title', placeholder: 'Over the drawing, if it needs one' });
  titleField.dataset.key = 'title';
  titleRow.append(titleField);

  const boxesSection = element('section', 'dg-section');
  const boxesHead = element('div', 'dg-section-head');
  const boxesRows = element('div', 'dg-rows');
  const addBoxButton = small('dg-add dg-add-box', { label: 'Add a box', iconName: 'plus', text: 'Box' });
  boxesSection.append(boxesHead, boxesRows, addBoxButton);

  const linksSection = element('section', 'dg-section');
  const linksHead = element('div', 'dg-section-head');
  const linksRows = element('div', 'dg-rows');
  const addLinkButton = small('dg-add dg-add-link', { label: 'Add a link', iconName: 'plus', text: 'Link' });
  linksSection.append(linksHead, linksRows, addLinkButton);

  const looks = element('div', 'dg-looks');
  const colours = element('div', 'dg-colours');
  panel.replaceChildren(head, titleRow, boxesSection, linksSection, looks, colours);

  // -- writing --

  /** Write `next` (the colours its categories take included), unless it changes nothing. */
  function apply(next) {
    const coloured = withColours(next, palette());
    if (writeDiagram(coloured) === writeDiagram(model)) return false;
    return write(coloured);
  }

  /** The words typed in a field and not yet written: written first, as their own step. */
  function commitTyped() {
    const field = document.activeElement;
    if (!panel.contains(field) || !field.matches?.('textarea, input[type="text"]') || field.value === field.dataset.written) return;
    field.dispatchEvent(new Event('change'));
  }

  /** A gesture: what is typed first, then `change(model)`, one step each. */
  function gesture(change) {
    commitTyped();
    model = state();
    const next = change(model);
    if (next) apply(next);
  }

  addBoxButton.addEventListener('click', () => {
    commitTyped();
    model = state();
    const made = model.kind === 'timeline' ? addEvent(model) : addBox(model);
    if (!apply(made.model)) return;
    // the new row's words take the keyboard
    queueMicrotask(() => panel.querySelector(`[data-key="${model.kind === 'timeline' ? 'events' : 'boxes'}:${made.id}:${model.kind === 'timeline' ? 'when' : 'text'}"]`)?.focus());
  });
  addLinkButton.addEventListener('click', () => {
    commitTyped();
    model = state();
    const made = addLink(model);
    if (made.index < 0 || !apply(made.model)) return;
    queueMicrotask(() => panel.querySelector(`[data-key="links:${made.index}:from"]`)?.focus());
  });

  titleField.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    titleField.dispatchEvent(new Event('change'));
  });
  titleField.addEventListener('change', () => {
    titleField.dataset.written = titleField.value;
    model = state();
    const typed = titleField.value.replace(/\s+/g, ' ').trim();
    if (typed !== model.title) apply({ ...model, title: typed });
  });

  // Ctrl+Z on anything but words being typed: the note's Undo, which the form follows
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return;
    const typing = event.target.matches?.('input[type="text"], textarea') && event.target.value !== event.target.dataset.written;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z' && !event.shiftKey && !typing && undo) {
      event.preventDefault();
      event.stopPropagation();
      undo();
    }
  });

  // -- a row's fields --

  /** A field of words in a row: written on Enter (Shift+Enter a new line where it allows one), Tab or leaving it. */
  function rowWords(key, value, { label, placeholder, lines = false, onWrite }) {
    const field = wordsField(`dg-${key.split(':')[2]}`, { label, placeholder, lines });
    field.dataset.key = key;
    field.value = value;
    field.dataset.written = value;
    field.addEventListener('input', () => grow(field));
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !(lines && event.shiftKey)) {
        event.preventDefault();
        field.dispatchEvent(new Event('change'));
      }
    });
    field.addEventListener('change', () => {
      if (field.value === field.dataset.written) return;
      field.dataset.written = field.value;
      model = state();
      onWrite(field.value);
    });
    return field;
  }

  /**
   * ▲ ▼ and × for the row at `at` of `list`, `id` its box's or event's (a link has none);
   * Alt+↑ ↓ in the row move it too. The press, or the field, keeps the keyboard as its row moves.
   */
  function rowTools(row, list, at, count, { id = null, remove, name }) {
    const keyOf = (index, field) => `${list}:${id ?? index}:${field}`;
    const up = small('dg-move dg-up', { label: `Move ${name} up`, iconName: 'chevronUp' });
    const down = small('dg-move dg-down', { label: `Move ${name} down`, iconName: 'chevronDown' });
    up.dataset.key = keyOf(at, 'up');
    down.dataset.key = keyOf(at, 'down');
    up.disabled = at === 0;
    down.disabled = at === count - 1;
    const move = (by, field) => {
      gesture((current) => moveItem(current, list, at, by));
      const target = panel.querySelector(`[data-key="${keyOf(Math.max(0, Math.min(count - 1, at + by)), field)}"]`);
      (target && !target.disabled ? target : panel.querySelector(`[data-key="${keyOf(Math.max(0, Math.min(count - 1, at + by)), 'remove')}"]`))?.focus({ preventScroll: true });
    };
    up.addEventListener('click', () => move(-1, 'up'));
    down.addEventListener('click', () => move(1, 'down'));
    const out = small('dg-remove', { label: `Remove ${name}`, iconName: 'x' });
    out.dataset.key = keyOf(at, 'remove');
    out.addEventListener('click', () => {
      gesture(remove);
      // the keyboard goes to the row that took its place, or to the list's +
      const next = panel.querySelectorAll(`.dg-rows [data-key^="${list}:"][data-key$=":remove"]`)[Math.min(at, count - 2)];
      (next ?? (list === 'links' ? addLinkButton : addBoxButton)).focus({ preventScroll: true });
    });
    row.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      event.stopPropagation();
      const field = event.target.dataset?.key?.split(':')[2];
      if (field) move(event.key === 'ArrowUp' ? -1 : 1, field);
    });
    const moves = element('span', 'dg-moves');
    moves.append(up, down);
    row.prepend(moves);
    row.append(out);
  }

  function boxRow(box, at) {
    const row = element('div', 'dg-row');
    row.dataset.row = `boxes:${box.id}`;
    const name = `box ${at + 1}`;
    const cells = element('div', 'dg-cells');
    const text = rowWords(`boxes:${box.id}:text`, box.text, {
      label: `${WORDS.add[model.kind]} ${at + 1}`, placeholder: model.kind === 'sequence' ? 'Who' : 'Words in the box', lines: true,
      onWrite: (value) => apply(changeBox(model, box.id, { text: value })),
    });
    cells.append(text);
    if (isTree(model.kind)) {
      const root = model.kind === 'mindmap' && !box.parent;
      const options = [
        ...(model.kind === 'org' || root ? [{ value: '', label: model.kind === 'org' ? 'At the top' : 'The middle' }] : []),
        ...model.boxes.map((other, index) => ({ value: other.id, label: `Under ${boxName(other, index)}`, disabled: other.id === box.id || !canStandUnder(model, box.id, other.id) }))
          .filter((option) => !(root && option.value)),
      ];
      const under = select('dg-under', `Where ${name} stands`, options, box.parent);
      under.dataset.key = `boxes:${box.id}:parent`;
      under.disabled = root;
      under.addEventListener('change', () => gesture((current) => changeBox(current, box.id, { parent: under.value })));
      cells.append(under);
    }
    const shapes = KIND_SHAPES[model.kind] ?? [];
    if (shapes.length > 1) {
      const pick = select('dg-shape', `Shape of ${name}`, shapes.map((value) => ({ value, label: SHAPE_NAMES[value] })), box.shape);
      pick.title = shapes.filter((value) => SHAPE_HINTS[value]).map((value) => `${SHAPE_NAMES[value]}: ${SHAPE_HINTS[value]}`).join('. ');
      pick.dataset.key = `boxes:${box.id}:shape`;
      pick.addEventListener('change', () => gesture((current) => changeBox(current, box.id, { shape: pick.value })));
      cells.append(pick);
    }
    if (CATEGORISED.has(model.kind)) {
      const category = rowWords(`boxes:${box.id}:category`, box.category, {
        label: `${WORDS.category[model.kind]} of ${name}`, placeholder: WORDS.category[model.kind],
        onWrite: (value) => apply(changeBox(model, box.id, { category: spelled(value) })),
      });
      category.setAttribute('list', listId);
      cells.append(category);
    }
    row.append(cells);
    rowTools(row, 'boxes', at, model.boxes.length, { id: box.id, remove: (current) => removeBox(current, box.id), name });
    return row;
  }

  function eventRow(item, at, inherited) {
    const row = element('div', 'dg-row');
    row.dataset.row = `events:${item.id}`;
    const name = `event ${at + 1}`;
    const cells = element('div', 'dg-cells');
    cells.append(
      rowWords(`events:${item.id}:when`, item.when, {
        label: `When, ${name}`, placeholder: 'When: 5 Oct 2026',
        onWrite: (value) => apply(changeEvent(model, item.id, { when: value })),
      }),
      rowWords(`events:${item.id}:text`, item.text, {
        label: `What happened, ${name}`, placeholder: 'What happened', lines: true,
        onWrite: (value) => apply(changeEvent(model, item.id, { text: value })),
      }),
    );
    const phase = rowWords(`events:${item.id}:category`, item.category, {
      label: `Phase of ${name}`, placeholder: inherited || 'Phase',
      onWrite: (value) => apply(changeEvent(model, item.id, { category: spelled(value) })),
    });
    phase.setAttribute('list', listId);
    if (inherited && !item.category) phase.title = `In the phase above, ${inherited}: type another to start one`;
    cells.append(phase);
    row.append(cells);
    rowTools(row, 'events', at, model.events.length, { id: item.id, remove: (current) => removeEvent(current, item.id), name });
    return row;
  }

  function linkRow(item, at) {
    const row = element('div', 'dg-row dg-link-row');
    row.dataset.row = `links:${at}`;
    const name = model.kind === 'sequence' ? `message ${at + 1}` : `link ${at + 1}`;
    const cells = element('div', 'dg-cells');
    const options = model.boxes.map((one, index) => ({ value: one.id, label: boxName(one, index) }));
    const from = select('dg-from', `From, ${name}`, options, item.from);
    from.dataset.key = `links:${at}:from`;
    from.addEventListener('change', () => gesture((current) => changeLink(current, at, { from: from.value })));
    const to = select('dg-to', `To, ${name}`, options, item.to);
    to.dataset.key = `links:${at}:to`;
    to.addEventListener('change', () => gesture((current) => changeLink(current, at, { to: to.value })));
    const arrowSign = element('span', 'dg-arrow-sign', '→');
    arrowSign.setAttribute('aria-hidden', 'true');
    const words = rowWords(`links:${at}:text`, item.text, {
      label: `Words on ${name}`, placeholder: model.kind === 'sequence' ? 'What is sent' : 'Words on the link',
      onWrite: (value) => apply(changeLink(model, at, { text: value })),
    });
    const dashed = small('dg-toggle dg-dashed', { label: `Dashed, ${name}`, text: model.kind === 'sequence' ? 'Reply' : 'Dashed' });
    dashed.dataset.key = `links:${at}:dashed`;
    dashed.setAttribute('aria-pressed', String(item.dashed));
    dashed.title = model.kind === 'sequence' ? 'A dashed line, as an answer' : 'A dashed line';
    dashed.addEventListener('click', () => gesture((current) => changeLink(current, at, { dashed: !item.dashed })));
    const arrow = small('dg-toggle dg-arrow', { label: `Arrow, ${name}`, text: 'Arrow' });
    arrow.dataset.key = `links:${at}:arrow`;
    arrow.setAttribute('aria-pressed', String(item.arrow));
    arrow.title = 'An arrowhead at its end';
    arrow.addEventListener('click', () => gesture((current) => changeLink(current, at, { arrow: !item.arrow })));
    // the two ends on a line, the words and the line's look under them
    const ends = element('div', 'dg-link-ends');
    ends.append(from, arrowSign, to);
    const look = element('div', 'dg-link-look');
    look.append(words, dashed, arrow);
    cells.append(ends, look);
    row.append(cells);
    rowTools(row, 'links', at, model.links.length, { remove: (current) => removeLink(current, at), name });
    return row;
  }

  /** A category typed as one the diagram or the case already names, whatever its case, takes that name's spelling. */
  function spelled(value) {
    const typed = value.replace(/\s+/g, ' ').trim();
    return categoryChoices(model, palette()).find((name) => name.toLowerCase() === typed.toLowerCase()) ?? typed;
  }

  // -- the look and the colours --

  function renderLooks() {
    const parts = [];
    if (DIRECTED[model.kind]) {
      parts.push(segmented('Direction', [{ value: 'LR', label: '→ Left to right' }, { value: 'TD', label: '↓ Top down' }], model.direction,
        (value) => gesture((current) => ({ ...current, direction: value }))));
    }
    parts.push(segmented('Style', DIAGRAM_STYLES.map((value) => ({ value, label: DIAGRAM_STYLE_NAMES[value] })), model.style,
      (value) => gesture((current) => ({ ...current, style: value }))));
    looks.replaceChildren(...parts);
  }

  /** A swatch's choices: the case's colours and the charts', and a code to paste. */
  function openColours(anchor, name) {
    const box = element('div', 'dg-colour-menu');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `Colour of ${name}`);
    const grid = element('div', 'dg-colour-grid');
    let close = () => {};
    const choose = (colour) => {
      close(false);
      gesture((current) => ({ ...current, colours: { ...current.colours, [nameKey(current, name)]: colour } }));
    };
    for (const choice of colourChoices(palette())) {
      const swatch = steady(element('button', 'dg-colour-choice'));
      swatch.type = 'button';
      swatch.style.setProperty('--swatch', choice.colour);
      swatch.setAttribute('aria-label', choice.name ? `${choice.name}, ${choice.colour}` : choice.colour);
      swatch.title = choice.name ? `${choice.name} (the case's)` : choice.colour;
      swatch.addEventListener('click', () => choose(choice.colour));
      grid.append(swatch);
    }
    const code = element('input', 'dg-input dg-colour-code');
    code.type = 'text';
    code.placeholder = '#2a78d6';
    code.setAttribute('aria-label', 'Colour code');
    code.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const typed = code.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1');
      if (/^#[0-9a-f]{6}$/i.test(typed)) choose(typed.toLowerCase());
      else code.setAttribute('aria-invalid', 'true');
    });
    const said = element('label', 'dg-colour-said');
    said.append(element('span', '', 'Colour code'), code);
    box.append(grid, said);
    close = openPopover(view, anchor, box);
    grid.querySelector('button')?.focus({ preventScroll: true });
  }

  function renderColours() {
    const names = categoriesOf(model);
    const showable = model.kind !== 'timeline' || names.length;
    if (!names.length && model.kind !== 'timeline') {
      colours.hidden = true;
      colours.replaceChildren();
      return;
    }
    colours.hidden = !showable;
    const list = element('div', 'dg-swatches');
    const shown = names.length ? names : [''];
    const casePaint = palette();
    for (const name of shown) {
      const colour = colourFor(model, name, casePaint);
      const chip = element('button', 'dg-swatch');
      chip.type = 'button';
      chip.style.setProperty('--swatch', colour);
      chip.append(element('span', 'dg-swatch-dot'), element('span', 'dg-swatch-name', name || 'Every event'));
      chip.setAttribute('aria-label', `Colour of ${name || 'every event'}: ${colour}`);
      chip.title = 'Pick its colour';
      chip.addEventListener('click', () => openColours(chip, name));
      list.append(chip);
    }
    const parts = [element('span', 'dg-field-name', model.kind === 'timeline' && names.length ? 'Phases' : model.kind === 'mindmap' ? 'Branches' : 'Colours'), list];
    const tools = element('div', 'dg-colour-tools');
    if (['flow', 'network', 'org'].includes(model.kind) && names.length) {
      const legend = element('label', 'dg-tick');
      const box = element('input');
      box.type = 'checkbox';
      box.checked = model.legend;
      box.dataset.key = 'legend';
      box.addEventListener('change', () => gesture((current) => ({ ...current, legend: box.checked })));
      legend.append(box, element('span', '', 'Legend under the drawing'));
      tools.append(legend);
    }
    // the case names some of these another colour: one press takes the case's
    const differing = names.filter((name) => {
      const fromCase = casePaint.find((entry) => entry.name?.toLowerCase() === name.toLowerCase());
      return fromCase && fromCase.colour?.toLowerCase() !== colourFor(model, name, casePaint);
    });
    if (differing.length) {
      const use = small('dg-link-button dg-use-case', { label: 'Use the case’s colours', text: 'Use the case’s colours' });
      use.title = `The case colours ${differing.join(', ')} otherwise`;
      use.addEventListener('click', () => gesture((current) => {
        const next = { ...current.colours };
        for (const name of differing) {
          const key = nameKey(current, name);
          next[key] = casePaint.find((entry) => entry.name.toLowerCase() === name.toLowerCase()).colour.toLowerCase();
        }
        return { ...current, colours: next };
      }));
      tools.append(use);
    }
    const unnamed = names.filter((name) => !casePaint.some((entry) => entry.name?.toLowerCase() === name.toLowerCase()));
    if (keep && unnamed.length) {
      const press = small('dg-link-button dg-keep', { label: 'Keep these colours for the case', text: 'Keep these colours for the case' });
      press.title = 'Name these colours in the case, so every chart, map, layer and diagram paints them the same';
      press.addEventListener('click', () => keep(unnamed.map((name) => ({ value: name, colour: colourFor(model, name, casePaint) }))));
      tools.append(press);
    }
    colours.replaceChildren(...parts, tools);
  }

  // -- drawing it all --

  const listId = `dg-categories-${Math.random().toString(36).slice(2, 9)}`;
  const datalist = element('datalist');
  datalist.id = listId;
  panel.append(datalist);

  /** What the rows are made of: made again only when it changes. */
  function shapeOf(current) {
    return JSON.stringify([current.kind, current.boxes.map((one) => one.id), current.links.length, current.events.map((one) => one.id)]);
  }

  /** The lists that name boxes (a link's ends, the box one stands under), each choice named again and the boxes it may not take greyed. */
  function renameChoices() {
    const names = new Map(model.boxes.map((one, at) => [one.id, boxName(one, at)]));
    for (const field of panel.querySelectorAll('select.dg-from, select.dg-to, select.dg-under')) {
      const own = field.dataset.key.split(':')[1];
      for (const option of field.options) {
        if (!names.has(option.value)) continue;
        option.textContent = field.matches('.dg-under') ? `Under ${names.get(option.value)}` : names.get(option.value);
        if (field.matches('.dg-under')) option.disabled = option.value === own || !canStandUnder(model, own, option.value);
      }
    }
  }

  function render() {
    model = state();
    if (!model) return;
    const meta = DIAGRAM_KINDS.find((one) => one.kind === model.kind);
    kindName.textContent = meta?.label ?? 'Diagram';
    needs.textContent = meta?.needs ?? '';
    caseButton.hidden = !fromCase || !['network', 'timeline'].includes(model.kind);
    caseButton.lastChild.textContent = model.kind === 'timeline' ? 'From the Timeline…' : 'From the Graph…';
    caseButton.title = model.kind === 'timeline' ? 'The case’s dated events in a period' : 'Entities of the case and the links between them';
    kindButton.hidden = !kind || model.kind === 'timeline';
    undoButton.disabled = !canUndo();
    titleRow.hidden = !hasTitle(model.kind);
    // a field being typed in keeps its words; one that was only standing there takes the model's (after an Undo)
    if (document.activeElement !== titleField || titleField.value === titleField.dataset.written) {
      titleField.value = model.title;
      titleField.dataset.written = model.title;
    }
    datalist.replaceChildren(...categoryChoices(model, palette()).map((name) => {
      const option = element('option');
      option.value = name;
      return option;
    }));
    const now = shapeOf(model);
    if (now !== shape) {
      const focused = panel.contains(document.activeElement) ? document.activeElement.dataset?.key ?? null : null;
      shape = now;
      boxesHead.replaceChildren(element('span', '', WORDS.boxes[model.kind]), element('small', '', String(model.kind === 'timeline' ? model.events.length : model.boxes.length)));
      addBoxButton.lastChild.textContent = WORDS.add[model.kind];
      addBoxButton.setAttribute('aria-label', `Add ${model.kind === 'timeline' ? 'an event' : `a ${WORDS.add[model.kind].toLowerCase()}`}`);
      if (model.kind === 'timeline') {
        let phase = '';
        boxesRows.replaceChildren(...model.events.map((one, at) => {
          const row = eventRow(one, at, one.category ? '' : phase);
          if (one.category) phase = one.category;
          return row;
        }));
      } else boxesRows.replaceChildren(...model.boxes.map(boxRow));
      const linked = Boolean(WORDS.links[model.kind]);
      linksSection.hidden = !linked;
      if (linked) {
        linksHead.replaceChildren(element('span', '', WORDS.links[model.kind]), element('small', '', String(model.links.length)));
        addLinkButton.lastChild.textContent = WORDS.addLink[model.kind];
        addLinkButton.setAttribute('aria-label', `Add a ${WORDS.addLink[model.kind].toLowerCase()}`);
        addLinkButton.disabled = model.boxes.length < 1;
        linksRows.replaceChildren(...model.links.map(linkRow));
      }
      if (focused) panel.querySelector(`[data-key="${focused}"]`)?.focus({ preventScroll: true });
      if (focused && !panel.contains(document.activeElement)) (model.kind === 'timeline' ? addBoxButton : closeButton).focus({ preventScroll: true });
    } else {
      // the same rows: each field takes the model's words where it stands, the one typed in left alone
      for (const field of panel.querySelectorAll('[data-key]')) {
        const typing = field === document.activeElement && 'written' in field.dataset && field.value !== field.dataset.written;
        if (typing || field === titleField) continue;
        const value = valueAt(model, field.dataset.key);
        if (value === undefined) continue;
        if (field.matches('button')) {
          if (field.hasAttribute('aria-pressed')) field.setAttribute('aria-pressed', String(Boolean(value)));
        }
        else if (field.type === 'checkbox') field.checked = Boolean(value);
        else if (field.value !== value) {
          field.value = value;
          if ('written' in field.dataset) field.dataset.written = value;
        }
      }
    }
    renameChoices();
    for (const field of panel.querySelectorAll('textarea')) grow(field);
    renderLooks();
    renderColours();
  }

  render();
  return {
    refresh: render,
    /** The form was laid out again (beside the drawing, or above it): its fields of words grow to their words again. */
    relayout: () => {
      for (const field of panel.querySelectorAll('textarea')) grow(field);
    },
    focus: () => (panel.querySelector('[data-key$=":text"], [data-key$=":when"]') ?? closeButton).focus({ preventScroll: true }),
    commit: commitTyped,
    // the panel is the block's again once the form goes
    destroy: () => {
      panel.classList.remove('dg-form');
      panel.removeAttribute('role');
      panel.removeAttribute('aria-label');
    },
  };
}

/** The value a field shows, by its key (`boxes:n3:text`, `links:2:dashed`, `legend`). */
function valueAt(model, key) {
  if (key === 'legend') return model.legend;
  if (key === 'title') return model.title;
  const [list, id, field] = key.split(':');
  const item = list === 'links' ? model.links[Number(id)] : model[list]?.find((one) => one.id === id);
  return item ? item[field] ?? '' : undefined;
}

/** The key a category's colour is kept under: the name as the model already holds it, whatever its case. */
function nameKey(model, name) {
  return Object.keys(model.colours).find((key) => key.toLowerCase() === name.toLowerCase()) ?? name;
}

// -- the gallery ---------------------------------------------------------------------------------

const drawings = new Map();

/** A kind drawn small, as its starter: drawn once and kept. */
function drawKind(kind, draw = renderMermaidSvg) {
  if (!drawings.has(kind)) {
    drawings.set(kind, draw(writeDiagram(starterModel(kind))).then(({ svg }) => svg, () => ''));
  }
  return drawings.get(kind);
}

/**
 * The gallery under `anchor`: the six kinds, each drawn small with what it needs, and, given a
 * case, the two made from it. `onPick(kind)` gets the kind picked; `onCase('graph' |
 * 'timeline')` the panel asked for; `onSource()`, given, writes Mermaid by hand. With a
 * `model` (Kind… on a diagram), the kinds it cannot be drawn as are greyed and the one it is
 * says so. Answers its close.
 */
export function openDiagramGallery(view, anchor, { model = null, caseId = '', onPick, onCase = null, onSource = null, draw = renderMermaidSvg }) {
  const panel = element('div', 'dg-gallery');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', model ? 'Kind of diagram' : 'Pick a diagram');
  const head = element('div', 'dg-gallery-head');
  head.append(element('strong', '', model ? 'Draw it as' : 'Pick a diagram'), element('span', 'dg-gallery-said', model ? 'Its boxes and links stay.' : 'Each is a form to fill; the drawing follows.'));
  const grid = element('div', 'dg-gallery-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Kinds of diagram');
  let close = () => {};
  for (const { kind, label, needs } of DIAGRAM_KINDS) {
    const card = element('button', `dg-pick${model?.kind === kind ? ' dg-pick-now' : ''}`);
    card.type = 'button';
    card.dataset.kind = kind;
    const unfit = model && model.kind !== kind && !convertModel(model, kind);
    card.disabled = Boolean(unfit);
    card.setAttribute('aria-label', `${label}: ${needs}${model?.kind === kind ? ', the kind it is now' : ''}`);
    if (unfit) card.title = 'A timeline holds dated events, which this kind does not';
    const thumb = element('span', 'dg-pick-thumb');
    drawKind(kind, draw).then((svg) => {
      // Mermaid's own drawing, its words escaped there
      thumb.innerHTML = svg;
    });
    const name = element('span', 'dg-pick-name', label);
    if (model?.kind === kind) name.append(element('small', '', 'now'));
    card.append(thumb, name, element('span', 'dg-pick-needs', needs));
    card.addEventListener('click', () => {
      close(false);
      onPick?.(kind);
    });
    grid.append(card);
  }
  panel.append(head, grid);
  if (!model && caseId && onCase) {
    const fromCase = element('div', 'dg-gallery-case');
    fromCase.append(element('span', 'dg-gallery-case-name', 'From the case'));
    for (const [which, label, hint, iconName] of [
      ['graph', 'Network from the Graph', 'Entities you pick, and the links between them', 'graph'],
      ['timeline', 'Timeline from the Timeline', 'The case’s dated events in a period', 'clock'],
    ]) {
      const press = button(`dg-gallery-case-btn dg-case-${which}`, { label, iconName, title: hint });
      press.append(element('small', '', hint));
      press.addEventListener('click', () => {
        close(false);
        onCase(which);
      });
      fromCase.append(press);
    }
    panel.append(fromCase);
  }
  if (!model && onSource) {
    const foot = element('p', 'dg-gallery-foot', 'Know Mermaid? ');
    const raw = element('button', 'dg-link-button dg-write-source', 'Write it yourself');
    raw.type = 'button';
    raw.addEventListener('click', () => {
      close(false);
      onSource();
    });
    foot.append(raw);
    panel.append(foot);
  }
  close = openPopover(view, anchor, panel);
  panel.addEventListener('keydown', (event) => {
    const picks = [...grid.querySelectorAll('button:not(:disabled)')];
    const at = picks.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[event.key];
    if (at < 0 || step === undefined) return;
    event.preventDefault();
    picks[Math.max(0, Math.min(picks.length - 1, at + step))]?.focus();
  });
  (grid.querySelector('.dg-pick-now') ?? grid.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
  return close;
}

// -- from the case -------------------------------------------------------------------------------

/** A panel over the note grew or shrank: it stands where it fits again, as the note's scroll places it. */
function placeAgain(view) {
  view.scrollDOM.dispatchEvent(new Event('scroll'));
}

/** "3 boxes", "1 link". */
function counted(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The foot of a panel from the case: what it will write, listed, and the press that writes it. */
function writeFoot(onWrite) {
  const foot = element('div', 'dg-case-foot');
  const said = element('div', 'dg-case-said');
  const list = element('ul', 'dg-case-list');
  list.setAttribute('aria-label', 'What it will write');
  const press = element('button', 'dg-case-write', 'Write it');
  press.type = 'button';
  press.addEventListener('click', () => onWrite());
  foot.append(said, list, press);
  return { foot, said, list, press };
}

/**
 * Network from the Graph, under `anchor`: the entities the Graph draws (or a saved view
 * draws), grouped by type, to tick; the links between them come with them, and with
 * *Links through what is left out*, the ones that pass through the rest. The foot lists the
 * boxes and the links it will write before *Write it* writes them (`onWrite(model)`).
 * `label(type)` names a type, `verb(type)` a link's.
 */
export function openNetworkPanel(view, anchor, { caseId, onWrite, label = (type) => type, verb = (type) => type, ask = undefined }) {
  const panel = element('div', 'dg-case');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Network from the Graph');
  const head = element('div', 'dg-case-head');
  head.append(element('strong', '', 'Network from the Graph'), element('span', 'dg-case-hint', 'Tick what goes in: the links between them come with them, coloured by type.'));
  const controls = element('div', 'dg-case-controls');
  const viewPick = select('dg-case-view', 'Saved Graph view', [{ value: '', label: 'The whole case' }], '');
  const search = element('input', 'dg-input dg-case-search');
  search.type = 'search';
  search.placeholder = 'Find an entity';
  search.setAttribute('aria-label', 'Find an entity');
  controls.append(viewPick, search);
  const types = element('div', 'dg-case-types');
  const rows = element('div', 'dg-case-rows');
  rows.setAttribute('role', 'group');
  rows.setAttribute('aria-label', 'Entities');
  const through = element('label', 'dg-tick dg-case-through');
  const throughBox = element('input');
  throughBox.type = 'checkbox';
  throughBox.checked = true;
  through.append(throughBox, element('span', '', 'Links through what is left out, dashed'));
  const note = element('p', 'dg-case-note');
  let reading = null;
  let picked = new Set();
  let built = null;
  const parts = writeFoot(() => {
    if (!built?.boxes.length) return;
    close(false);
    onWrite(built);
  });
  panel.append(head, controls, types, rows, through, note, parts.foot);
  const close = openPopover(view, anchor, panel);
  const options = ask ? { ask } : {};

  function refreshFoot() {
    built = reading ? networkModel(reading, [...picked], { through: throughBox.checked, label, verb }) : null;
    const boxes = built?.boxes ?? [];
    const links = built?.links ?? [];
    parts.said.textContent = boxes.length ? `Will write ${counted(boxes.length, 'box').replace('boxs', 'boxes')} and ${counted(links.length, 'link')}:` : 'Tick at least one entity.';
    const name = new Map(boxes.map((one) => [one.id, one.text]));
    parts.list.replaceChildren(
      ...boxes.map((one) => element('li', 'dg-case-box', `${one.text} · ${one.category}`)),
      ...links.map((one) => element('li', `dg-case-link${one.dashed ? ' dg-case-via' : ''}`, `${name.get(one.from)} ${one.arrow ? '→' : '—'} ${name.get(one.to)}${one.text ? `: ${one.text}` : ''}`)),
    );
    parts.press.disabled = !boxes.length;
  }

  function renderRows() {
    const wanted = search.value.trim().toLowerCase();
    const byType = new Map();
    for (const node of reading?.nodes ?? []) {
      if (!byType.has(node.type)) byType.set(node.type, []);
      byType.get(node.type).push(node);
    }
    types.replaceChildren(...[...byType].map(([type, nodes]) => {
      const all = nodes.every((node) => picked.has(node.id));
      const chip = element('button', 'dg-case-type');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(all));
      chip.append(element('span', '', label(type) || type), element('small', '', String(nodes.length)));
      chip.title = all ? 'Untick them all' : 'Tick them all';
      chip.addEventListener('click', () => {
        for (const node of nodes) {
          if (all) picked.delete(node.id);
          else picked.add(node.id);
        }
        renderRows();
      });
      return chip;
    }));
    const shown = (reading?.nodes ?? []).filter((node) => !wanted || `${node.caption ?? ''} ${node.label}`.toLowerCase().includes(wanted));
    rows.replaceChildren(...shown.map((node) => {
      const row = element('label', 'dg-case-row');
      const box = element('input');
      box.type = 'checkbox';
      box.checked = picked.has(node.id);
      box.addEventListener('change', () => {
        if (box.checked) picked.add(node.id);
        else picked.delete(node.id);
        renderRows();
      });
      row.append(box, element('span', 'dg-case-row-name', node.caption || node.label), element('small', '', `${label(node.type) || node.type} · ${counted(node.degree ?? 0, 'link')}`));
      return row;
    }));
    if (!shown.length) rows.append(element('p', 'dg-case-note', reading ? 'Nothing matches.' : 'Reading the Graph…'));
    refreshFoot();
  }

  async function read(viewId = '') {
    reading = null;
    renderRows();
    try {
      const chosen = viewId ? await graphView({ caseId, id: viewId, ...options }) : null;
      reading = await graphReading({ caseId, view: chosen, ...options });
      // a saved view picks what it draws; the whole case starts with nothing ticked
      picked = new Set(chosen ? reading.nodes.map((node) => node.id) : []);
      note.textContent = reading.truncated
        ? `The Graph draws ${reading.nodes.length} of the case’s ${reading.total} entities, the most linked: links through the others are not counted.`
        : '';
      note.hidden = !note.textContent;
    } catch (error) {
      note.textContent = `The Graph could not be read: ${error?.message ?? error}`;
      note.hidden = false;
      reading = { nodes: [], links: [], total: 0, truncated: false };
    }
    renderRows();
    placeAgain(view);
  }

  graphViews({ caseId, ...options }).then((views) => {
    for (const one of views) {
      const option = element('option', '', `${one.name}${one.mode === 'snapshot' ? ' (frozen)' : ''}`);
      option.value = one.id;
      viewPick.append(option);
    }
    viewPick.hidden = !views.length;
  }, () => { viewPick.hidden = true; });
  viewPick.hidden = true;
  viewPick.addEventListener('change', () => read(viewPick.value));
  search.addEventListener('input', renderRows);
  throughBox.addEventListener('change', refreshFoot);
  read();
  search.focus({ preventScroll: true });
  return close;
}

/**
 * Timeline from the Timeline, under `anchor`: the case's dated events in a period (the
 * whole case at first), each to tick, all ticked. The foot says how many it will write and
 * lists them before *Write it* writes them (`onWrite(model)`).
 */
export function openTimelinePanel(view, anchor, { caseId, onWrite, ask = undefined }) {
  const panel = element('div', 'dg-case');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Timeline from the Timeline');
  const head = element('div', 'dg-case-head');
  head.append(element('strong', '', 'Timeline from the Timeline'), element('span', 'dg-case-hint', 'The case’s dated events, on the day the case states.'));
  const controls = element('div', 'dg-case-controls');
  const from = element('input', 'dg-input dg-case-from');
  from.type = 'date';
  from.setAttribute('aria-label', 'From');
  const to = element('input', 'dg-input dg-case-to');
  to.type = 'date';
  to.setAttribute('aria-label', 'To');
  const period = element('span', 'dg-case-period');
  period.append(element('span', 'dg-field-name', 'From'), from, element('span', 'dg-field-name', 'to'), to);
  controls.append(period);
  const rows = element('div', 'dg-case-rows');
  rows.setAttribute('role', 'group');
  rows.setAttribute('aria-label', 'Events');
  const note = element('p', 'dg-case-note');
  let events = [];
  let picked = new Set();
  const parts = writeFoot(() => {
    const model = timelineModel(events, [...picked]);
    if (!model.events.length) return;
    close(false);
    onWrite(model);
  });
  panel.append(head, controls, rows, note, parts.foot);
  const close = openPopover(view, anchor, panel);
  const options = ask ? { ask } : {};

  function refreshFoot() {
    const chosen = events.filter((one) => picked.has(one.id));
    parts.said.textContent = chosen.length ? `Will write ${counted(chosen.length, 'event')}:` : 'Tick at least one event.';
    parts.list.replaceChildren(...chosen.map((one) => element('li', 'dg-case-box', `${one.day}: ${one.text}`)));
    parts.press.disabled = !chosen.length;
  }

  function renderRows() {
    rows.replaceChildren(...events.map((one) => {
      const row = element('label', 'dg-case-row');
      const box = element('input');
      box.type = 'checkbox';
      box.checked = picked.has(one.id);
      box.addEventListener('change', () => {
        if (box.checked) picked.add(one.id);
        else picked.delete(one.id);
        refreshFoot();
      });
      row.append(box, element('span', 'dg-case-day', one.day), element('span', 'dg-case-row-name', one.text));
      return row;
    }));
    if (!events.length) rows.append(element('p', 'dg-case-note', 'No dated event in this period.'));
    refreshFoot();
  }

  let asked = 0;
  async function read(first = false) {
    const ticket = ++asked;
    try {
      const answer = await caseEvents({ caseId, from: from.value, to: to.value, ...options });
      if (ticket !== asked) return;
      events = answer.events;
      picked = new Set(events.map((one) => one.id));
      if (first && answer.extent.from) {
        from.value = answer.extent.from;
        to.value = answer.extent.to;
      }
      note.textContent = answer.more ? `The first ${events.length} of ${answer.total} events: narrow the period to take the others.` : '';
      note.hidden = !note.textContent;
    } catch (error) {
      if (ticket !== asked) return;
      events = [];
      note.textContent = `The Timeline could not be read: ${error?.message ?? error}`;
      note.hidden = false;
    }
    renderRows();
    placeAgain(view);
  }
  for (const field of [from, to]) field.addEventListener('change', () => read());
  read(true);
  from.focus({ preventScroll: true });
  return close;
}

