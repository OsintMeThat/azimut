/**
 * What the page draws inside a line: a case reference as a chip, a footnote as its
 * letter, coordinates with their ⌖, a task's box, a bullet, a list's number, a callout's
 * name, a template's guidance and the words the PDF fills in. Also the two helpers a drawn block uses to show
 * guidance and those words the way a line shows them.
 */
import { WidgetType } from '@codemirror/view';

import { footnoteText } from '../footnotes.js';
import { HINT_LINE } from '../look.js';
import { PLACEHOLDERS, findPlaceholders, placeholderValue } from '../reportParts.js';

const ICONS = {
  place: '◉', person: '●', media: '▣', capture: '▣', note: '¶', proof: '✓', bookmark: '↗', post: '✎',
};

export class ChipWidget extends WidgetType {
  constructor(ref, entity) {
    super();
    this.ref = ref;
    this.entity = entity;
  }

  eq(other) {
    return other.ref.id === this.ref.id && other.ref.label === this.ref.label
      && other.entity?.label === this.entity?.label && other.entity?.type === this.entity?.type;
  }

  toDOM() {
    const chip = document.createElement('span');
    chip.className = `cm-chip${this.entity ? '' : ' cm-chip-broken'}`;
    chip.dataset.entityId = this.ref.id;
    chip.dataset.chip = 'true';
    const mark = document.createElement('span');
    mark.className = 'cm-chip-mark';
    mark.textContent = ICONS[this.entity?.type] ?? '◆';
    const label = document.createElement('span');
    label.textContent = this.entity?.label ?? this.ref.label;
    chip.append(mark, label);
    chip.title = this.entity
      ? `${this.entity.label} · ${this.entity.type}${this.entity.attrs?.folder ? ` · ${this.entity.attrs.folder}` : ''}. Click to open`
      : 'No longer in the case';
    return chip;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * A footnote (`^[words]`) as its small raised letter, its words on hover; a press opens them
 * in the Footnote field (`editor/bubble.js`). `at` is where it starts in the note.
 */
export class FootnoteWidget extends WidgetType {
  constructor(letter, words, at) {
    super();
    this.letter = letter;
    this.words = words;
    this.at = at;
  }

  eq(other) {
    return other.letter === this.letter && other.words === this.words && other.at === this.at;
  }

  toDOM() {
    const mark = document.createElement('sup');
    mark.className = 'cm-footnote';
    mark.dataset.footnote = String(this.at);
    mark.textContent = this.letter;
    mark.title = `Footnote ${this.letter}: ${footnoteText(this.words)}`;
    mark.setAttribute('aria-label', `Footnote ${this.letter}`);
    return mark;
  }

  ignoreEvent() {
    return false;
  }
}

export class CoordinatesWidget extends WidgetType {
  constructor(lat, lon) {
    super();
    this.lat = lat;
    this.lon = lon;
  }

  eq(other) {
    return other.lat === this.lat && other.lon === this.lon;
  }

  toDOM() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-coords-go';
    button.dataset.lat = String(this.lat);
    button.dataset.lon = String(this.lon);
    button.title = 'Show on the map';
    button.setAttribute('aria-label', `Show ${this.lat}, ${this.lon} on the map`);
    button.textContent = '⌖';
    return button;
  }

  ignoreEvent() {
    return false;
  }
}

export class TaskWidget extends WidgetType {
  constructor(done, at) {
    super();
    this.done = done;
    this.at = at;
  }

  eq(other) {
    return other.done === this.done && other.at === this.at;
  }

  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task';
    box.checked = this.done;
    box.dataset.taskAt = String(this.at);
    box.setAttribute('aria-label', this.done ? 'Done; click to reopen' : 'To do; click when done');
    return box;
  }

  ignoreEvent() {
    return false;
  }
}

export class BulletWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const dot = document.createElement('span');
    dot.className = 'cm-bullet';
    dot.textContent = '•';
    return dot;
  }
}

/** A numbered item's number, as the list prints it: its first item's, then one more each. */
export class NumberWidget extends WidgetType {
  constructor(label) {
    super();
    this.label = label;
  }

  eq(other) {
    return other.label === this.label;
  }

  toDOM() {
    const number = document.createElement('span');
    number.className = 'cm-number';
    number.textContent = this.label;
    return number;
  }
}

/**
 * A callout's name, at the head of its first line in place of `> [!kind]`. A press on it
 * offers the other kinds, a plain quote and text (`editor/caret.js`); `at` is where its
 * line starts.
 */
export class CalloutLabelWidget extends WidgetType {
  constructor(callout, at) {
    super();
    this.callout = callout;
    this.at = at;
  }

  eq(other) {
    return other.callout.kind === this.callout.kind && other.at === this.at;
  }

  toDOM() {
    const label = document.createElement('span');
    label.className = 'cm-callout-label';
    label.textContent = this.callout.label;
    label.dataset.calloutAt = String(this.at);
    // the one kind that changes what prints says so on hover
    label.title = this.callout.kind === 'internal' ? `${this.callout.hint}. Click for its menu` : 'Click to change the kind';
    return label;
  }

  ignoreEvent() {
    return false;
  }
}

/** Guidance a template left: grey words in place, never printed. */
export class HintWidget extends WidgetType {
  constructor(text, template) {
    super();
    this.text = text;
    this.template = template;
  }

  eq(other) {
    return other.text === this.text && other.template === this.template;
  }

  toDOM() {
    const hint = document.createElement('span');
    hint.className = 'cm-hint';
    hint.dataset.hint = 'true';
    hint.textContent = this.text || 'Guidance';
    hint.title = this.template ? 'Guidance: shown in grey, never printed' : 'Guidance from the template: type over it';
    return hint;
  }

  ignoreEvent() {
    return false;
  }
}

/** A word the PDF fills in: what Settings holds for it, or its name in grey. */
function placeholderNode(id, identity) {
  const item = PLACEHOLDERS.find((one) => one.id === id);
  const value = placeholderValue(id, identity);
  const node = document.createElement('span');
  node.className = value ? 'cm-placeholder cm-placeholder-set' : 'cm-placeholder';
  node.dataset.placeholder = id;
  node.textContent = value || item.word;
  node.title = value ? item.said : item.setting ? `${item.said}, not set yet` : item.said;
  return node;
}

export class PlaceholderWidget extends WidgetType {
  constructor(id, identity) {
    super();
    this.id = id;
    this.value = placeholderValue(id, identity);
    this.identity = identity;
  }

  eq(other) {
    return other.id === this.id && other.value === this.value;
  }

  toDOM() {
    return placeholderNode(this.id, this.identity);
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * The words a drawn block holds that the PDF fills in, drawn as the editor draws
 * them on a line of their own. Text in code stays as written.
 */
export function drawPlaceholders(box, identity) {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('code, pre')) continue;
    if (findPlaceholders(node.data).length) found.push(node);
  }
  for (const node of found) {
    const parts = document.createDocumentFragment();
    let at = 0;
    for (const word of findPlaceholders(node.data)) {
      if (word.from > at) parts.append(node.data.slice(at, word.from));
      parts.append(placeholderNode(word.id, identity));
      at = word.to;
    }
    if (at < node.data.length) parts.append(node.data.slice(at));
    node.replaceWith(parts);
  }
}

/** A block's source with each guidance line kept as a marker the sanitiser leaves alone. */
const HINT_MARK = 'AZIMUTGUIDANCE';

export function hintsMarked(source) {
  const hints = [];
  const text = source.split('\n').map((line) => {
    const hint = HINT_LINE.exec(line);
    if (!hint) return line;
    hints.push(hint[1]);
    return `${HINT_MARK}${hints.length - 1}`;
  }).join('\n');
  return { text, hints };
}

/** Guidance inside a drawn block, put back as the grey words the editor draws it as. */
export function drawHints(box, hints) {
  if (!hints.length) return;
  const mark = new RegExp(`${HINT_MARK}(\\d+)`, 'g');
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.includes(HINT_MARK)) found.push(node);
  for (const node of found) {
    const parts = document.createDocumentFragment();
    let at = 0;
    for (const match of node.data.matchAll(mark)) {
      if (match.index > at) parts.append(node.data.slice(at, match.index));
      const hint = document.createElement('span');
      hint.className = 'cm-hint';
      hint.dataset.hint = 'true';
      hint.textContent = hints[Number(match[1])] || 'Guidance';
      parts.append(hint);
      at = match.index + match[0].length;
    }
    if (at < node.data.length) parts.append(node.data.slice(at));
    node.replaceWith(parts);
  }
}
