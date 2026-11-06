/**
 * The note editor: Markdown written in place, drawn as it will read.
 *
 * The file stays the Markdown the PDF and `lib/markdown.js` read. What changes is
 * the page: a heading is set large with its `#` put away, a case reference is a
 * chip, a picture, a table and a diagram are drawn, a task is a box to tick, and a
 * callout is a coloured block. The marks come back on the line being edited, so
 * nothing is hidden from the person writing it.
 *
 * Built on CodeMirror 6. Everything the page draws is worked out from the editor
 * state alone (`noteDecorations`), so it is tested without a browser.
 */
import {
  EditorState, StateEffect, StateField, Compartment, EditorSelection, Facet, Prec, Transaction,
} from '@codemirror/state';
import {
  Decoration, EditorView, WidgetType, keymap, placeholder as placeholderText, drawSelection, dropCursor,
} from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap, startCompletion, acceptCompletion } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

import { entityReference, markdownHtml } from '../markdown.js';
import { renderMermaidSvg } from '../mermaid.js';
import { CALLOUT_LINE, calloutOf } from './callouts.js';
import { paths as iconPaths } from '../../components/Icon.svelte';
import { HINT_LINE, INCLUDE_LINE, PAGE_BREAK_LINE, includeLine } from './look.js';
import {
  COVER_LINE, NO_IDENTITY, PLACEHOLDERS, coverChange, findPlaceholders, placeholderValue,
} from './reportParts.js';
import {
  CAPTION_HELP, PICTURE_ALIGNS, PICTURE_SIZES, POSTED_HELP, SOURCE_HELP, blockAlignAt, captionField, pictureLine, picturesIn, rovingToolbar, sizeWidth,
  sizedLine, sourceField,
} from './pictureSize.js';
import {
  findCoordinates, findReferences, mentionMatches, slashInsert, slashMatches,
} from './syntax.js';

// -- what the case says about the references ----------------------------------

/**
 * The case the note belongs to and its records, which the chips and pictures are
 * drawn from, and its notes as the home lists them (`notes/index` rows), which a
 * chapter is drawn from. `identity` is who signs, as Settings › Publishing keeps
 * it (`lib/notes/reportParts.js`): what `{name}` shows, and whether the logo and
 * the signature are set.
 */
export const setNoteCase = StateEffect.define();

export const noteCase = StateField.define({
  create: () => ({ caseId: '', entities: [], byId: new Map(), redirects: {}, notes: new Map(), identity: NO_IDENTITY }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setNoteCase)) {
        const entities = effect.value.entities ?? [];
        return {
          caseId: effect.value.caseId ?? '',
          entities,
          byId: new Map(entities.map((entity) => [entity.id, entity])),
          redirects: effect.value.redirects ?? {},
          notes: new Map((effect.value.notes ?? []).map((row) => [row.id, row])),
          identity: effect.value.identity ?? NO_IDENTITY,
        };
      }
    }
    return value;
  },
});

/**
 * Whether the editor writes a template rather than a note. A template's guidance
 * is its own text, edited like any line; in a note it is a prompt that typing
 * replaces.
 */
export const templateMode = Facet.define({ combine: (values) => values.some(Boolean) });

/**
 * The editor's outside, for what the page draws: a picture's bar asks it which tool
 * reopens the picture (`opener(entity)`), whether its source is the analyst's to state
 * (`sourceable(entity)`, a promise) and to state it (`stateSource(entity, url)`), and
 * where a proof was posted (`statePosted(entity, url)`, absent where it cannot be kept).
 */
const noteHandlers = Facet.define({ combine: (values) => values[0] ?? {} });

/** Whether the editor has focus, which is when the line being edited shows its marks. */
const setFocused = StateEffect.define();
const focused = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setFocused)) return effect.value;
    return value;
  },
});

function resolve(info, id) {
  const to = info.redirects?.[id]?.id ?? id;
  return info.byId.get(to) ?? null;
}

// -- the widgets ---------------------------------------------------------------

const ICONS = {
  place: '◉', person: '●', media: '▣', capture: '▣', note: '¶', proof: '✓', bookmark: '↗', post: '✎',
};

class ChipWidget extends WidgetType {
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

class CoordinatesWidget extends WidgetType {
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

class TaskWidget extends WidgetType {
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

class BulletWidget extends WidgetType {
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

class CalloutLabelWidget extends WidgetType {
  constructor(callout) {
    super();
    this.callout = callout;
  }

  eq(other) {
    return other.callout.kind === this.callout.kind;
  }

  toDOM() {
    const label = document.createElement('span');
    label.className = 'cm-callout-label';
    label.textContent = this.callout.label;
    // the one kind that changes what prints says so on hover
    if (this.callout.kind === 'internal') label.title = this.callout.hint;
    return label;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const rule = document.createElement('hr');
    rule.className = 'cm-rule';
    return rule;
  }
}

/** Guidance a template left: grey words in place, never printed. */
class HintWidget extends WidgetType {
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

/** The note a report includes as a chapter: its number, name and first words. */
class IncludeWidget extends WidgetType {
  constructor(id, number, note) {
    super();
    this.id = id;
    this.number = number;
    this.note = note;
  }

  eq(other) {
    return other.id === this.id && other.number === this.number && other.note?.title === this.note?.title
      && other.note?.excerpt === this.note?.excerpt;
  }

  toDOM() {
    const box = document.createElement('div');
    box.className = `cm-include${this.note ? '' : ' cm-include-missing'}`;
    box.dataset.include = this.id;
    box.title = 'Click to edit the line';
    const head = document.createElement('div');
    head.className = 'cm-include-head';
    const number = document.createElement('span');
    number.className = 'cm-include-number';
    number.textContent = `Chapter ${this.number}`;
    const actions = document.createElement('span');
    actions.className = 'cm-include-actions';
    if (this.note) actions.append(includeButton('Open', 'cm-include-open', `Open ${this.note.title}`));
    actions.append(includeButton('Remove', 'cm-include-remove', 'Take this chapter out of the report'));
    head.append(number, actions);
    const title = document.createElement('div');
    title.className = 'cm-include-title';
    title.textContent = this.note?.title ?? 'A note no longer in the case';
    box.append(head, title);
    if (this.note) {
      const excerpt = document.createElement('div');
      excerpt.className = 'cm-include-excerpt';
      excerpt.textContent = this.note.excerpt || 'Nothing written yet.';
      box.append(excerpt);
    } else {
      const said = document.createElement('div');
      said.className = 'cm-include-excerpt';
      said.textContent = 'The PDF prints a short line in its place.';
      box.append(said);
    }
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 92;
  }
}

function includeButton(text, className, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.title = title;
  return button;
}

/** Where the PDF starts a new page: a dashed rule, named. Pressing it opens its line. */
class PageBreakWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = 'cm-pagebreak';
    box.dataset.pagebreak = 'true';
    box.title = 'The PDF starts a new page here. Click to edit the line';
    const label = document.createElement('span');
    label.textContent = 'Page break';
    box.append(label);
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(box) } });
      view.focus();
    });
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 30;
  }
}

/** Where the analyst's own first page ends: a rule, named. Pressing it opens its line. */
class CoverRuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = 'cm-pagebreak cm-cover-rule';
    box.dataset.coverRule = 'true';
    box.title = 'Above this line is page 1 when Look › Cover is Your own page. Click to edit the line';
    const label = document.createElement('span');
    label.textContent = 'End of the cover page';
    box.append(label);
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(box) } });
      view.focus();
    });
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 30;
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

class PlaceholderWidget extends WidgetType {
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
function drawPlaceholders(box, identity) {
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

function hintsMarked(source) {
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
function drawHints(box, hints) {
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

const ALIGN_LABELS = { left: ['alignLeft', 'Left'], center: ['alignCentreH', 'Centre'], right: ['alignRight', 'Right'] };

function iconSvg(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', iconPaths[name]);
  svg.append(path);
  return svg;
}

/** How much taller than wide the picture drawn in `box` is, or 0 before it has loaded. */
function pictureRatio(box) {
  const image = box.querySelector('img');
  return image?.naturalWidth ? image.naturalHeight / image.naturalWidth : 0;
}

/** The case record a picture line shows, or null for an image read from an address. */
function pictureEntity(info, picture) {
  const id = /^media:([A-Za-z0-9_-]+)$/.exec(picture?.ref ?? '')?.[1];
  return id ? resolve(info, id) : null;
}

/**
 * The size and place buttons over a picture, and its caption: what the PDF prints it
 * at. Then the way back to the tool it was made in, and a source to state when only
 * the analyst knows it. Neither of those two is ever printed.
 */
function sizeBar(box, source, info, handlers = {}, blockAlign = '') {
  const [picture] = picturesIn(source);
  const bar = document.createElement('div');
  bar.className = 'cm-size-bar';
  bar.dataset.sizeBar = 'true';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Picture');
  if (!picture) return bar;
  const sizes = PICTURE_SIZES.map((size) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = size.label;
    button.dataset.share = String(size.share);
    button.title = size.title;
    bar.append(button);
    return button;
  });
  // which size it is now can only be told once the picture says how tall it is
  const mark = () => {
    const ratio = pictureRatio(box);
    for (const button of sizes) button.setAttribute('aria-pressed', String(picture.width === sizeWidth(Number(button.dataset.share), ratio)));
  };
  mark();
  box.querySelector('img')?.addEventListener('load', mark, { once: true });
  // a picture whose line writes no place takes its block's, as the PDF prints it
  const current = picture.align || blockAlign || 'left';
  for (const align of PICTURE_ALIGNS) {
    const [icon, label] = ALIGN_LABELS[align];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-size-align';
    button.dataset.align = align;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(current === align));
    button.append(iconSvg(icon));
    bar.append(button);
  }
  const caption = document.createElement('button');
  caption.type = 'button';
  caption.className = 'cm-size-caption';
  caption.dataset.caption = 'true';
  caption.textContent = 'Caption';
  caption.title = CAPTION_HELP.button;
  bar.append(caption);
  const entity = pictureEntity(info, picture);
  const opener = entity ? handlers.opener?.(entity) : null;
  if (opener) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'cm-size-open';
    open.dataset.open = 'true';
    open.textContent = opener.label;
    open.title = `${opener.label}, where this picture was made`;
    bar.append(open);
  }
  if (entity?.type === 'proof' && handlers.statePosted) {
    const kept = entity.attrs?.posted_url ?? '';
    const posted = document.createElement('button');
    posted.type = 'button';
    posted.className = 'cm-size-posted';
    posted.classList.toggle('kept', Boolean(kept));
    posted.dataset.posted = 'true';
    posted.textContent = kept ? 'Posted ✓' : 'Posted…';
    posted.title = kept ? `${POSTED_HELP.button}. Now: ${kept}` : POSTED_HELP.button;
    bar.insertBefore(posted, bar.querySelector('[data-open]'));
  }
  rovingToolbar(bar);
  // whether the analyst may state a source is read off the file, so it is asked once the bar is drawn
  if (entity && !entity.attrs?.source_url && handlers.sourceable) {
    Promise.resolve(handlers.sourceable(entity)).then((yes) => {
      if (!yes || !box.isConnected || bar.querySelector('[data-source]')) return;
      const said = document.createElement('button');
      said.type = 'button';
      said.className = 'cm-size-source';
      said.dataset.source = 'true';
      said.textContent = 'Source…';
      said.title = SOURCE_HELP.button;
      said.tabIndex = -1;
      bar.insertBefore(said, bar.querySelector('[data-open]'));
    }).catch(() => {});
  }
  return bar;
}

/** Open the field where proof `entity` was posted, under the picture drawn in `box`, holding the address kept. */
function openPosted(view, box, entity) {
  if (box.querySelector('.picture-source-field')) return;
  const handlers = view.state.facet(noteHandlers);
  if (!handlers.statePosted) return;
  box.classList.add('cm-captioning');
  const field = sourceField({
    help: POSTED_HELP,
    value: entity.attrs?.posted_url ?? '',
    write: (url) => handlers.statePosted(entity, url),
    done: (by) => {
      box.classList.remove('cm-captioning');
      field.remove();
      if (by === 'keyboard') view.focus();
    },
  });
  box.append(field);
  field.focus();
  field.select();
}

/** Open the field a picture's source is stated in, under the picture drawn in `box`. */
function openSource(view, box, entity) {
  if (box.querySelector('.picture-source-field')) return;
  const handlers = view.state.facet(noteHandlers);
  if (!handlers.stateSource) return;
  box.classList.add('cm-captioning');
  const field = sourceField({
    write: (url) => handlers.stateSource(entity, url),
    done: (by) => {
      box.classList.remove('cm-captioning');
      field.remove();
      if (by === 'keyboard') view.focus();
    },
  });
  box.append(field);
  field.focus();
}

/**
 * Open the caption field under the picture drawn in `box`, in place of the caption
 * shown there. `returnTo` is where Enter and Escape give the keyboard back, the
 * note itself when it is not given.
 */
function openCaption(view, box, returnTo = null) {
  if (box.querySelector('.picture-caption-field')) return;
  const line = view.state.doc.lineAt(view.posAtDOM(box));
  const [picture] = picturesIn(line.text);
  if (!picture) return;
  box.classList.add('cm-captioning');
  const field = captionField({
    caption: picture.caption,
    title: picture.title,
    write: (caption) => {
      const now = view.state.doc.lineAt(view.posAtDOM(box));
      resizePicture(view, now.number - 1, picture.ref, { caption });
    },
    done: (by) => {
      box.classList.remove('cm-captioning');
      field.remove();
      // Enter and Escape hand the keyboard back to the note; a press elsewhere keeps its own focus
      if (by !== 'keyboard') return;
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
      else view.focus();
    },
  });
  box.append(field);
  field.focus({ preventScroll: true });
  field.select();
}

/** A drawn block (a picture, a table, a diagram): pressing it puts the cursor back in its source. */
class BlockWidget extends WidgetType {
  /**
   * `writable`: whether the note can be changed, which is when a picture offers its bar.
   * `align`: the place of the `::: center` or `::: right` block a picture stands in.
   */
  constructor(kind, source, info, writable = false, align = '') {
    super();
    this.kind = kind;
    this.source = source;
    this.info = info;
    this.writable = writable;
    this.align = align;
  }

  eq(other) {
    if (other.kind !== this.kind || other.source !== this.source || other.info.caseId !== this.info.caseId
      || other.writable !== this.writable || other.align !== this.align || !sameIdentity(other.info.identity, this.info.identity)) return false;
    // A tool that files something reads the case again: the same records come back as a
    // new list. The block is drawn again only when what it shows changed, so a picture
    // keeps its open caption field and does not blink.
    return other.info.entities === this.info.entities || other.caseKey() === this.caseKey();
  }

  /** What the block draws from the case: the records and notes its source names, as they read now. */
  caseKey() {
    this.key ??= JSON.stringify([...this.source.matchAll(/\[\[(?:media|entity|include):([A-Za-z0-9_-]+)/g)].map(([, id]) => {
      const entity = resolve(this.info, id);
      const note = this.info.notes?.get?.(id);
      return [id, entity ? [entity.id, entity.type, entity.label, entity.attrs] : null, note ? [note.title, note.excerpt] : null];
    }));
    return this.key;
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = `cm-block cm-block-${this.kind}${this.align ? ` cm-in-align-${this.align}` : ''}`;
    box.dataset.block = this.kind;
    box.title = 'Click to edit';
    if (this.kind === 'diagram') drawDiagram(box, this.source);
    else {
      const { text, hints } = hintsMarked(this.source);
      box.innerHTML = markdownHtml(text, this.info);
      drawHints(box, hints);
      drawPlaceholders(box, this.info.identity);
    }
    const handlers = view.state.facet(noteHandlers);
    if (this.kind === 'picture' && this.writable) box.append(sizeBar(box, this.source, this.info, handlers, this.align));
    /** A button of the picture bar, pressed: a size, a place, the caption field, its tool or its source. */
    const press = (target) => {
      if (target.closest('[data-caption]')) {
        openCaption(view, box);
        return;
      }
      if (target.closest('[data-open], [data-source], [data-posted]')) {
        const [shown] = picturesIn(view.state.doc.lineAt(view.posAtDOM(box)).text);
        const entity = pictureEntity(view.state.field(noteCase), shown);
        if (!entity) return;
        if (target.closest('[data-source]')) openSource(view, box, entity);
        else if (target.closest('[data-posted]')) openPosted(view, box, entity);
        else handlers.opener?.(entity)?.open();
        return;
      }
      const pick = target.closest('[data-share], [data-align]');
      if (!pick) return;
      const line = view.state.doc.lineAt(view.posAtDOM(box));
      const [picture] = picturesIn(line.text);
      if (!picture) return;
      const change = pick.dataset.share
        ? { width: sizeWidth(Number(pick.dataset.share), pictureRatio(box)) }
        : { align: pick.dataset.align };
      resizePicture(view, line.number - 1, picture.ref, change);
    };
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('a, video, [data-entity-id], .picture-caption-field, .picture-source-field')) return;
      event.preventDefault();
      if (event.target.closest('[data-size-bar]')) {
        press(event.target);
        return;
      }
      const at = view.posAtDOM(box);
      view.dispatch({ selection: { anchor: at } });
      view.focus();
    });
    // the mouse acts on the press, before focus moves; the keyboard's Enter and Space give a click
    box.addEventListener('click', (event) => {
      const button = event.target.closest('[data-size-bar] button');
      if (event.detail !== 0 || !button) return;
      const from = view.state.doc.lineAt(view.posAtDOM(box)).from;
      if (button.dataset.open || button.dataset.source || button.dataset.posted) {
        press(button);
        return;
      }
      const same = button.dataset.share ? `[data-share="${button.dataset.share}"]`
        : button.dataset.align ? `[data-align="${button.dataset.align}"]` : '[data-caption]';
      press(button);
      // the picture was drawn again with its new size: the keyboard stays on the button it pressed
      if (box.isConnected) return;
      const again = [...view.contentDOM.querySelectorAll('.cm-block-picture')].find((node) => view.posAtDOM(node) === from);
      again?.querySelector(`[data-size-bar] ${same}`)?.focus({ preventScroll: true });
    });
    return box;
  }

  ignoreEvent(event) {
    // the caption and source fields are the browser's: the editor leaves their keys and presses alone
    return event.type !== 'mousedown' || Boolean(event.target?.closest?.('.picture-caption-field, .picture-source-field'));
  }

  get estimatedHeight() {
    return this.kind === 'diagram' ? 220 : 160;
  }
}

/** Whether two identities draw the same: a block holding `{name}` or a logo is drawn again when they differ. */
function sameIdentity(a = NO_IDENTITY, b = NO_IDENTITY) {
  return Object.keys(NO_IDENTITY).every((key) => a?.[key] === b?.[key]);
}

const diagrams = new Map();

/** A diagram drawn once per source and kept, so typing elsewhere does not redraw it. */
function drawDiagram(box, fence) {
  const source = fence.replace(/^\s*(```|~~~)[^\n]*\n/, '').replace(/\n\s*(```|~~~)\s*$/, '');
  const known = diagrams.get(source);
  const show = (result) => {
    if (result.svg) box.innerHTML = result.svg;
    else {
      box.classList.add('cm-block-failed');
      box.textContent = `Diagram not drawn: ${result.error}`;
    }
  };
  if (known && !(known instanceof Promise)) {
    show(known);
    return;
  }
  box.textContent = 'Drawing the diagram…';
  const pending = known ?? renderMermaidSvg(source)
    .then(({ svg }) => ({ svg }))
    .catch((error) => ({ error: String(error?.message ?? error).split('\n')[0] }))
    .then((result) => {
      diagrams.set(source, result);
      if (diagrams.size > 60) diagrams.delete(diagrams.keys().next().value);
      return result;
    });
  diagrams.set(source, pending);
  pending.then(show);
}

// -- what the page draws -------------------------------------------------------

const hidden = Decoration.replace({});

function lineClass(name, attributes) {
  return Decoration.line({ class: name, attributes });
}

/** The lines the cursor or a selection is on, when the editor has focus. */
function editedLines(state) {
  const lines = new Set();
  if (!state.field(focused, false)) return lines;
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) lines.add(line);
  }
  return lines;
}

function touches(lines, state, from, to) {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(Math.max(from, to)).number;
  for (let line = first; line <= last; line += 1) if (lines.has(line)) return true;
  return false;
}

/** A line holding nothing but one picture: `![…](…){…}` or `[[media:…]]{…}`. */
const PICTURE_LINE = /^\s*(?:!\[[^\]]*\]\([^)]*\)(?:\{[^}\n]*\})?|\[\[media:[A-Za-z0-9_-]+\|[^\]\n]+\]\](?:\{[^}\n]*\})?)\s*$/;

/** Whether the comment `from`–`to` is one line of guidance (`<!--? … -->`). */
function hintOn(state, from, to) {
  const line = state.doc.lineAt(from);
  return to <= line.to && HINT_LINE.test(line.text);
}

/** Whether the comment `from`–`to` is a page break (`<!-- pagebreak -->`) alone on its line. */
function pageBreakOn(state, from, to) {
  const line = state.doc.lineAt(from);
  return to <= line.to && PAGE_BREAK_LINE.test(line.text);
}

/** Whether the comment `from`–`to` is the end of the cover page (`<!-- cover -->`) alone on its line. */
function coverRuleOn(state, from, to) {
  const line = state.doc.lineAt(from);
  return to <= line.to && COVER_LINE.test(line.text);
}

/** What a chapter line shows: the note as the home lists it, its record else, null when gone. */
function includedNote(info, id) {
  const row = info.notes.get(id);
  if (row) return { title: row.title, excerpt: row.excerpt ?? '' };
  if (id === 'case') return { title: 'Case notes', excerpt: '' };
  const entity = resolve(info, id);
  return entity?.type === 'note' ? { title: entity.label, excerpt: '' } : null;
}

/** The guidance line at `pos`, outside code, or null. */
export function hintLineAt(state, pos) {
  const line = state.doc.lineAt(pos);
  if (!HINT_LINE.test(line.text)) return null;
  const tree = ensureSyntaxTree(state, line.to, 50) ?? syntaxTree(state);
  const start = line.from + /^[ \t]*/.exec(line.text)[0].length;
  for (let node = tree.resolveInner(start, 1); node; node = node.parent) {
    if (node.name === 'CommentBlock') return line;
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return null;
  }
  return null;
}

/**
 * Everything the page draws for this state, as one set. Exported so the drawing is
 * tested on a state with no view.
 */
export function noteDecorations(state) {
  const info = state.field(noteCase);
  const lines = editedLines(state);
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const ranges = [];
  const covered = []; // [from, to] of blocks drawn whole; nothing else goes inside them
  const inside = (pos) => covered.some(([from, to]) => pos >= from && pos <= to);
  const code = []; // [from, to] of code, where references and coordinates stay text
  const template = state.facet(templateMode);
  let chapters = 0;

  // the place of the aligned block each line stands in, by line number, for a picture there
  const blockAligns = new Map();
  const block = (kind, from, to) => {
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to);
    covered.push([first.from, last.to]);
    const align = kind === 'picture' ? blockAligns.get(first.number) ?? '' : '';
    ranges.push(Decoration.replace({ widget: new BlockWidget(kind, state.doc.sliceString(first.from, last.to), info, !state.readOnly, align), block: true })
      .range(first.from, last.to));
  };

  // `::: center` … `:::`, the old Notebook's aligned text: drawn as it reads unless it is being edited
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const open = /^:::[ \t]*(left|center|right)[ \t]*$/.exec(state.doc.line(number).text);
    if (!open) continue;
    let end = number + 1;
    while (end <= state.doc.lines && !/^:::[ \t]*$/.test(state.doc.line(end).text)) end += 1;
    if (end > state.doc.lines) break;
    const from = state.doc.line(number).from;
    const to = state.doc.line(end).to;
    if (open[1] !== 'left') for (let inner = number + 1; inner < end; inner += 1) blockAligns.set(inner, open[1]);
    if (touches(lines, state, from, to)) {
      ranges.push(lineClass('cm-fence-line').range(from));
      ranges.push(lineClass('cm-fence-line').range(state.doc.line(end).from));
    } else block('aligned', from, to);
    number = end;
  }

  tree?.iterate({
    enter(node) {
      const { name, from, to } = node;
      // the document itself starts where a block drawn whole may: only what is in it is skipped
      if (name !== 'Document' && inside(from)) return false;
      const editing = touches(lines, state, from, to);
      if (name === 'FencedCode') {
        code.push([from, to]);
        const opening = state.doc.sliceString(from, Math.min(to, state.doc.lineAt(from).to));
        if (/^\s*(```|~~~)\s*mermaid\b/.test(opening) && !editing && state.doc.lineAt(to).text.trim().match(/^(```|~~~)$/)) {
          block('diagram', from, to);
          return false;
        }
        for (let line = state.doc.lineAt(from).number; line <= state.doc.lineAt(to).number; line += 1) {
          ranges.push(lineClass('cm-code-line').range(state.doc.line(line).from));
        }
        return false;
      }
      if (name === 'InlineCode') {
        code.push([from, to]);
        ranges.push(Decoration.mark({ class: 'cm-inline-code' }).range(from, to));
        if (!editing) {
          node.node.getChildren('CodeMark').forEach((mark) => ranges.push(hidden.range(mark.from, mark.to)));
        }
        return false;
      }
      if (name === 'Table') {
        if (!editing) {
          block('table', from, to);
          return false;
        }
        for (let line = state.doc.lineAt(from).number; line <= state.doc.lineAt(to).number; line += 1) {
          ranges.push(lineClass('cm-table-line').range(state.doc.line(line).from));
        }
        return false;
      }
      if (name === 'CommentBlock' && hintOn(state, from, to)) {
        const line = state.doc.lineAt(from);
        // a template's guidance is edited as text; a note's stays drawn, and typing replaces it
        if (template && editing) ranges.push(lineClass('cm-hint-line').range(line.from));
        else ranges.push(Decoration.replace({ widget: new HintWidget(HINT_LINE.exec(line.text)[1], template) }).range(line.from, line.to));
        return false;
      }
      if (name === 'CommentBlock' && pageBreakOn(state, from, to)) {
        const line = state.doc.lineAt(from);
        if (editing) ranges.push(lineClass('cm-pagebreak-line').range(line.from));
        else ranges.push(Decoration.replace({ widget: new PageBreakWidget(), block: true }).range(line.from, line.to));
        return false;
      }
      if (name === 'CommentBlock' && coverRuleOn(state, from, to)) {
        const line = state.doc.lineAt(from);
        if (editing) ranges.push(lineClass('cm-pagebreak-line').range(line.from));
        else ranges.push(Decoration.replace({ widget: new CoverRuleWidget(), block: true }).range(line.from, line.to));
        return false;
      }
      if (name === 'HTMLBlock' || name === 'CommentBlock') {
        if (!editing) block('html', from, to);
        else ranges.push(lineClass('cm-code-line').range(state.doc.lineAt(from).from));
        return false;
      }
      if (name === 'SetextHeading1' || name === 'SetextHeading2') {
        const level = name.endsWith('1') ? 1 : 2;
        ranges.push(lineClass(`cm-heading cm-h${level}`).range(state.doc.lineAt(from).from));
        const mark = node.node.getChild('HeaderMark');
        if (mark && !editing) ranges.push(lineClass('cm-setext-rule').range(state.doc.lineAt(mark.from).from));
        return undefined;
      }
      if (/^ATXHeading[1-6]$/.test(name)) {
        const level = name.slice(-1);
        ranges.push(lineClass(`cm-heading cm-h${level}`).range(state.doc.lineAt(from).from));
        if (!editing) {
          const mark = node.node.getChild('HeaderMark');
          if (mark) ranges.push(hidden.range(mark.from, Math.min(to, mark.to + 1)));
        }
        return undefined;
      }
      if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough') {
        const kind = name === 'StrongEmphasis' ? 'cm-strong' : name === 'Emphasis' ? 'cm-em' : 'cm-strike';
        ranges.push(Decoration.mark({ class: kind }).range(from, to));
        if (!editing) {
          const markName = name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark';
          node.node.getChildren(markName).forEach((mark) => ranges.push(hidden.range(mark.from, mark.to)));
        }
        return undefined;
      }
      if (name === 'Link') {
        // `[[entity:…|…]]` holds a bracket pair the parser reads as a link; it is a reference
        if (state.doc.sliceString(from, from + 2) === '[[' || state.doc.sliceString(from - 1, from) === '[') return false;
        ranges.push(Decoration.mark({ class: 'cm-link' }).range(from, to));
        if (!editing) {
          const marks = node.node.getChildren('LinkMark');
          const url = node.node.getChild('URL');
          if (marks.length >= 2) {
            ranges.push(hidden.range(marks[0].from, marks[0].to));
            ranges.push(hidden.range(marks[1].from, url ? to : marks[1].to));
          }
        }
        return false;
      }
      if (name === 'Image') {
        const line = state.doc.lineAt(from);
        if (!editing && PICTURE_LINE.test(line.text)) {
          block('picture', line.from, line.to);
          return false;
        }
        ranges.push(Decoration.mark({ class: 'cm-link' }).range(from, to));
        return false;
      }
      if (name === 'Blockquote') {
        const firstLine = state.doc.lineAt(from);
        const callout = calloutOf(firstLine.text);
        for (let number = firstLine.number; number <= state.doc.lineAt(to).number; number += 1) {
          const line = state.doc.line(number);
          ranges.push(lineClass(callout ? `cm-callout cm-callout-${callout.kind}` : 'cm-quote',
            callout ? { style: `--callout: ${callout.colour}` } : undefined).range(line.from));
          if (!lines.has(number)) {
            const mark = /^\s*>\s?/.exec(line.text);
            if (mark) ranges.push(hidden.range(line.from, line.from + mark[0].length));
          }
        }
        if (callout && !lines.has(firstLine.number)) {
          const marker = CALLOUT_LINE.exec(firstLine.text);
          const quote = /^\s*>\s?/.exec(firstLine.text)[0].length;
          ranges.push(Decoration.replace({ widget: new CalloutLabelWidget(callout) })
            .range(firstLine.from + quote, firstLine.from + marker[0].length));
        }
        return undefined;
      }
      if (name === 'QuoteMark') return false;
      if (name === 'HorizontalRule') {
        if (!editing) ranges.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to));
        return false;
      }
      if (name === 'ListItem') {
        const mark = node.node.getChild('ListMark');
        const task = node.node.getChild('Task')?.getChild('TaskMarker');
        const lineNumber = state.doc.lineAt(from).number;
        if (task) {
          const done = /x/i.test(state.doc.sliceString(task.from, task.to));
          if (done) ranges.push(lineClass('cm-task-done').range(state.doc.lineAt(from).from));
          if (!lines.has(lineNumber) && mark && state.doc.sliceString(mark.from, mark.to).match(/^[-*+]$/)) {
            ranges.push(hidden.range(mark.from, task.from));
          }
          ranges.push(Decoration.replace({ widget: new TaskWidget(done, task.from) }).range(task.from, task.to));
        } else if (mark && !lines.has(lineNumber) && /^[-*+]$/.test(state.doc.sliceString(mark.from, mark.to))) {
          ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(mark.from, mark.to));
        }
        return undefined;
      }
      return undefined;
    },
  });

  // References, coordinates and chapters are not Markdown: found line by line, outside code.
  const inCode = (pos) => code.some(([from, to]) => pos >= from && pos < to);
  // an editor with no map around it says so with a null `point` (the extension's panel)
  const mapless = state.facet(noteHandlers).point === null;
  const chips = [];
  const chapterLines = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (inside(line.from) || !line.text) continue;
    const editing = lines.has(number);
    const include = !inCode(line.from) && INCLUDE_LINE.exec(line.text);
    if (include) {
      // a chapter is its line, as the PDF reads it: whatever is around it
      chapters += 1;
      chapterLines.push(line);
      if (editing) ranges.push(Decoration.mark({ class: 'cm-ref-source' }).range(line.from, line.to));
      else {
        ranges.push(Decoration.replace({ widget: new IncludeWidget(include[1], chapters, includedNote(info, include[1])), block: true })
          .range(line.from, line.to));
      }
      continue;
    }
    const pictureLine = !editing && PICTURE_LINE.test(line.text) && line.text.includes('[[media:');
    if (pictureLine) {
      covered.push([line.from, line.to]);
      ranges.push(Decoration.replace({ widget: new BlockWidget('picture', line.text, info, !state.readOnly, blockAligns.get(number) ?? ''), block: true })
        .range(line.from, line.to));
      continue;
    }
    const refs = findReferences(line.text, line.from).filter((ref) => !inCode(ref.from));
    for (const ref of refs) {
      const entity = resolve(info, ref.id);
      if (editing) ranges.push(Decoration.mark({ class: 'cm-ref-source' }).range(ref.from, ref.to));
      else {
        chips.push(ref);
        ranges.push(Decoration.replace({ widget: new ChipWidget(ref, entity) }).range(ref.from, ref.to));
      }
    }
    for (const point of findCoordinates(line.text, line.from)) {
      if (inCode(point.from) || refs.some((ref) => point.from < ref.to && point.to > ref.from)) continue;
      ranges.push(Decoration.mark({ class: 'cm-coords' }).range(point.from, point.to));
      if (!mapless) ranges.push(Decoration.widget({ widget: new CoordinatesWidget(point.lat, point.lon), side: 1 }).range(point.to));
    }
    // the words the PDF fills in: grey on the line being written, drawn as they print elsewhere
    const placeholders = HINT_LINE.test(line.text) ? [] : findPlaceholders(line.text, line.from);
    for (const word of placeholders) {
      if (inCode(word.from) || refs.some((ref) => word.from < ref.to && word.to > ref.from)) continue;
      if (editing) ranges.push(Decoration.mark({ class: 'cm-placeholder-source' }).range(word.from, word.to));
      else ranges.push(Decoration.replace({ widget: new PlaceholderWidget(word.id, info.identity) }).range(word.from, word.to));
    }
  }
  // a chip stands for its whole reference, and a chapter for its line: a mark the parser found inside is not drawn
  const whole = [...chips, ...chapterLines];
  const kept = whole.length
    ? ranges.filter((range) => !whole.some((item) => range.from >= item.from && range.to <= item.to
      && !(range.from === item.from && range.to === item.to)))
    : ranges;
  return Decoration.set(kept, true);
}

const drawn = StateField.define({
  create: (state) => noteDecorations(state),
  update(value, transaction) {
    const refocused = transaction.effects.some((effect) => effect.is(setFocused) || effect.is(setNoteCase));
    // a note read while it was locked gets its pictures' bars once it can be written
    const unlocked = transaction.startState.readOnly !== transaction.state.readOnly;
    if (transaction.docChanged || transaction.selection || refocused || unlocked) return noteDecorations(transaction.state);
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // in a note, a line of guidance is one piece: the cursor steps over it and a delete takes it whole
    EditorView.atomicRanges.of((view) => (view.state.facet(templateMode)
      ? Decoration.none
      : view.state.field(field).update({ filter: (_from, _to, value) => value.spec.widget instanceof HintWidget }))),
  ],
});

/**
 * In a note, what is typed on a line of guidance takes its place: the grey words
 * are a prompt, not text to write after. Enter still opens a line beside it.
 */
export const typeOverHints = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || !transaction.isUserEvent('input') || transaction.startState.facet(templateMode)) return transaction;
  const inserts = [];
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => inserts.push({ fromA, toA, text: inserted.toString() }));
  if (inserts.length !== 1) return transaction;
  const [{ fromA, toA, text }] = inserts;
  if (fromA !== toA || /^\n*$/.test(text)) return transaction;
  const line = hintLineAt(transaction.startState, fromA);
  if (!line) return transaction;
  return {
    changes: { from: line.from, to: line.to, insert: text },
    selection: { anchor: line.from + text.length },
    scrollIntoView: true,
    annotations: Transaction.userEvent.of(transaction.annotation(Transaction.userEvent) ?? 'input.type'),
  };
});

// -- writing ------------------------------------------------------------------

/** Wrap the selection in a mark (`**` for bold), or take the mark away if it is there. */
export function toggleWrap(view, mark) {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const before = state.sliceDoc(range.from - mark.length, range.from);
    const after = state.sliceDoc(range.to, range.to + mark.length);
    if (before === mark && after === mark) {
      return {
        changes: [{ from: range.from - mark.length, to: range.from }, { from: range.to, to: range.to + mark.length }],
        range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
      };
    }
    return {
      changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
      range: EditorSelection.range(range.from + mark.length, range.to + mark.length + (text ? 0 : 0)),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
  return true;
}

/** Start the line the cursor is on with `prefix` (`## `, `- [ ] `), replacing a heading or list mark it had. */
export function setLinePrefix(view, prefix) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const current = /^(\s*)(#{1,6}\s+|>\s*(\[![A-Za-z]+\]\s*)?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)?/.exec(line.text);
  const indent = current[1].length;
  const existing = current[2] ?? '';
  const next = existing === prefix ? '' : prefix;
  view.dispatch({
    changes: { from: line.from + indent, to: line.from + indent + existing.length, insert: next },
    selection: { anchor: line.from + indent + next.length + (line.length - indent - existing.length) },
    userEvent: 'input',
  });
  view.focus();
  return true;
}

/** Put text at the cursor, replacing the selection, with spaces around a chip so it stands alone. */
export function insertAtCursor(view, text, { block = false } = {}) {
  const { state } = view;
  const range = state.selection.main;
  let insert = text;
  if (block) {
    const line = state.doc.lineAt(range.from);
    const lead = line.text.trim() ? (range.from === line.to ? '\n\n' : '\n') : '';
    insert = `${lead}${text}\n`;
  } else {
    const before = state.sliceDoc(range.from - 1, range.from);
    const after = state.sliceDoc(range.to, range.to + 1);
    if (before && !/\s/.test(before)) insert = ` ${insert}`;
    if (!after || !/\s/.test(after)) insert = `${insert} `;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/**
 * Give the picture `ref` a new size, place or caption (`{ width }`, `{ align }`, `{ caption }`), on the
 * line (0-based) the server placed it from or the nearest one holding it. False
 * when the note no longer holds it, or already says that.
 */
export function resizePicture(view, line, ref, changes) {
  if (view.state.readOnly) return false;
  const { doc } = view.state;
  const lines = [];
  for (let number = 1; number <= doc.lines; number += 1) lines.push(doc.line(number).text);
  const at = pictureLine(lines, Number(line) || 0, ref);
  if (at < 0) return false;
  const target = doc.line(at + 1);
  const text = sizedLine(target.text, ref, changes, { blockAlign: blockAlignAt(lines, at) });
  if (text === null || text === target.text) return false;
  view.dispatch({ changes: { from: target.from, to: target.to, insert: text }, userEvent: 'input' });
  return true;
}

/**
 * Put the cursor at the start of a line (0-based), and bring it into view. A line
 * holding a picture is brought into view and lit rather than opened, so the picture
 * stays drawn with its bar, which is where a picture is sized, captioned and sourced.
 */
export function jumpToLine(view, line) {
  const number = Math.min(view.state.doc.lines, Math.max(1, Number(line) + 1));
  const target = view.state.doc.line(number);
  if (PICTURE_LINE.test(target.text)) {
    lightLines(view, target.from, target.to);
    return;
  }
  view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) });
  view.focus();
}

// -- what a tool puts in the note ----------------------------------------------

/**
 * Places in the note held while something is being made for them: a position a put
 * will land at, or the stretch it landed as. Each follows the typing around it, so a
 * picture that takes a while still lands where it was asked for, and Undo finds it.
 */
const holdSpot = StateEffect.define();
const dropSpot = StateEffect.define();
let spotSeq = 0;

const spots = StateField.define({
  create: () => new Map(),
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged && value.size) {
      next = new Map();
      for (const [id, spot] of value) {
        // what is typed at a held position goes before it, as at the start of a stretch; at its end, after it
        const from = transaction.changes.mapPos(spot.from, 1);
        next.set(id, { from, to: spot.to === spot.from ? from : Math.max(from, transaction.changes.mapPos(spot.to, -1)) });
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(holdSpot)) {
        if (next === value) next = new Map(value);
        next.set(effect.value.id, { from: effect.value.from, to: effect.value.to });
      } else if (effect.is(dropSpot) && next.has(effect.value)) {
        if (next === value) next = new Map(value);
        next.delete(effect.value);
      }
    }
    return next;
  },
});

/** Hold `from`–`to` (a position when they are one) as the note changes; answers its id. */
export function holdRange(view, from, to = from) {
  spotSeq += 1;
  view.dispatch({ effects: holdSpot.of({ id: spotSeq, from, to }) });
  return spotSeq;
}

/** Where a held place is now, `{ from, to }`, or null once let go. */
export function heldRange(view, id) {
  return view.state.field(spots, false)?.get(id) ?? null;
}

export function releaseRange(view, id) {
  if (view.state.field(spots, false)?.has(id)) view.dispatch({ effects: dropSpot.of(id) });
}

/** A picture line's braces, which the bar and the caption field change, read as one. */
function unsized(text) {
  return String(text ?? '').replace(/(\]\]|\))\{[^}\n]*\}/g, '$1');
}

/**
 * The text that puts `text` at `pos` on lines of its own: a blank line from words
 * before it and after it, so a table or a picture is read as one. `inline` puts it
 * in the line at `pos` instead, with a space either side, as a citation is written.
 * Answers `{ insert, start, end }`, the text and where `text` sits in it.
 */
export function blockAt(state, pos, text, { inline = false } = {}) {
  const at = Math.max(0, Math.min(pos, state.doc.length));
  if (inline) {
    const before = state.sliceDoc(at - 1, at);
    const after = state.sliceDoc(at, at + 1);
    const lead = before && !/\s/.test(before) ? ' ' : '';
    const trail = !after || !/\s/.test(after) ? ' ' : '';
    return { insert: `${lead}${text}${trail}`, start: lead.length, end: lead.length + text.length };
  }
  const line = state.doc.lineAt(at);
  const head = line.text.slice(0, at - line.from);
  const tail = line.text.slice(at - line.from);
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text : '';
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : null;
  // words before it on this line take a blank line; an empty line under words, one more break
  const lead = head.trim() ? '\n\n' : !head && previous.trim() ? '\n' : '';
  // the line's own break follows it unless it is the last: words after it take a blank line
  const trail = tail.trim() ? '\n\n' : next === null ? '\n' : next.trim() ? '\n' : '';
  const insert = `${lead}${text}${trail}`;
  return { insert, start: lead.length, end: lead.length + text.length };
}

/**
 * Put `text` at `pos` (a held place's position when it is the id of one), as
 * `blockAt` writes it. Answers the id of the stretch it now holds in the note, which
 * `takeBackRange` reads. The note's own cursor moves past it only when it was there.
 */
export function placeText(view, pos, text, options = {}) {
  if (view.state.readOnly) return null;
  const { insert, start, end } = blockAt(view.state, pos, text, options);
  const from = Math.max(0, Math.min(pos, view.state.doc.length));
  const head = view.state.selection.main.head;
  view.dispatch({
    changes: { from, insert },
    ...(head === from ? { selection: { anchor: from + insert.length } } : {}),
    userEvent: 'input',
  });
  const id = holdRange(view, from, from + insert.length);
  lightLines(view, from + start, from + end);
  return { id, text: insert };
}

/**
 * Take back what `placeText` put in, if the note still holds it as it was: a
 * picture's size and caption may have been set since, nothing else. False when it
 * changed, or is no longer there.
 */
export function takeBackRange(view, landed) {
  const held = landed ? heldRange(view, landed.id) : null;
  if (!held || view.state.readOnly) return false;
  const now = view.state.sliceDoc(held.from, held.to);
  if (unsized(now) !== unsized(landed.text)) return false;
  view.dispatch({ changes: { from: held.from, to: held.to }, effects: dropSpot.of(landed.id), userEvent: 'delete' });
  return true;
}

/** Light the lines `from`–`to` for a moment and bring them into view: where a put landed. */
const lightOn = StateEffect.define();
const lightOff = StateEffect.define();
const landedLine = Decoration.line({ class: 'cm-landed' });

const landed = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(lightOff)) next = Decoration.none;
      if (effect.is(lightOn)) {
        const { from, to } = effect.value;
        const lines = [];
        const doc = transaction.state.doc;
        for (let number = doc.lineAt(from).number; number <= doc.lineAt(Math.max(from, to)).number; number += 1) {
          lines.push(landedLine.range(doc.line(number).from));
        }
        next = Decoration.set(lines);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** How long the lines a put landed as stay lit. */
export const LIGHT_MS = 1800;

export function lightLines(view, from, to = from) {
  const at = Math.max(0, Math.min(from, view.state.doc.length));
  const end = Math.max(at, Math.min(to, view.state.doc.length));
  view.dispatch({ effects: [lightOn.of({ from: at, to: end }), EditorView.scrollIntoView(at, { y: 'center' })] });
  // a picture or a table is drawn in place of its lines, so it is lit itself
  const first = view.state.doc.lineAt(at).number;
  const last = view.state.doc.lineAt(end).number;
  const markBlocks = () => {
    for (const node of view.contentDOM.querySelectorAll('.cm-block')) {
      let number = 0;
      try { number = view.state.doc.lineAt(view.posAtDOM(node)).number; } catch { continue; }
      if (number >= first && number <= last) node.classList.add('cm-block-landed');
    }
  };
  markBlocks();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(markBlocks);
  clearTimeout(view.lightTimer);
  view.lightTimer = setTimeout(() => {
    if (!view.dom.isConnected) return;
    view.dispatch({ effects: lightOff.of(null) });
    for (const node of view.contentDOM.querySelectorAll('.cm-block-landed')) node.classList.remove('cm-block-landed');
  }, LIGHT_MS);
}

/**
 * Open the caption field of the picture on the line at `pos`, once the page has
 * drawn it. `returnTo` gets the keyboard back after Enter or Escape. Answers whether
 * it opened, after a few frames at most.
 */
export function captionAt(view, pos, { returnTo = null, frames = 6 } = {}) {
  return new Promise((done) => {
    const tryOpen = (left) => {
      const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
      const box = [...view.contentDOM.querySelectorAll('.cm-block-picture')]
        .find((node) => { try { return view.state.doc.lineAt(view.posAtDOM(node)).number === line.number; } catch { return false; } });
      if (box) {
        openCaption(view, box, returnTo);
        done(true);
        return;
      }
      if (left <= 0) {
        done(false);
        return;
      }
      requestAnimationFrame(() => tryOpen(left - 1));
    };
    tryOpen(frames);
  });
}

/**
 * Write the cover page at the top of the note, unless it has one, and put the
 * cursor on its first line to write. Answers whether it wrote one. Without
 * `focus` (Look › Cover was changed) the keyboard stays where it is.
 */
export function insertCover(view, { focus = true } = {}) {
  if (view.state.readOnly) return false;
  const change = coverChange(view.state.doc.toString());
  if (!change) {
    if (!focus) return false;
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    view.focus();
    return false;
  }
  const changes = { from: change.from, to: change.to, insert: change.insert };
  if (!focus) {
    view.dispatch({ changes, userEvent: 'input' });
    return true;
  }
  // drawn as focused at once, so the page opens around the cursor rather than over it
  view.dispatch({ changes, selection: { anchor: change.cursor }, effects: setFocused.of(true), scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/**
 * Put a chapter line where the cursor is, as a paragraph of its own: on the empty
 * line it is typed on, or after the line holding words.
 */
export function insertInclude(view, noteId) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : null;
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text : '';
  const words = Boolean(line.text.trim());
  const from = words ? line.to : line.from;
  const lead = words ? '\n\n' : previous.trim() ? '\n' : '';
  // a blank line after it, and the cursor on the line past the chapter
  const blankAfter = next !== null && !next.trim();
  const insert = `${lead}${includeLine(noteId)}${blankAfter ? '' : '\n'}`;
  view.dispatch({
    changes: { from, to: line.to, insert },
    selection: { anchor: from + insert.length + (blankAfter ? 1 : 0) },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/** Take the chapter line at `pos` out, and the blank line it leaves doubled. */
export function removeInclude(view, pos) {
  const { state } = view;
  const line = state.doc.lineAt(pos);
  if (!INCLUDE_LINE.test(line.text)) return false;
  let to = line.number < state.doc.lines ? state.doc.line(line.number + 1).from : line.to;
  const after = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  const before = line.number > 1 ? state.doc.line(line.number - 1) : null;
  if (after && !after.text.trim() && (!before || !before.text.trim())) to = after.number < state.doc.lines ? state.doc.line(after.number + 1).from : after.to;
  view.dispatch({ changes: { from: line.from, to }, selection: { anchor: line.from }, userEvent: 'delete' });
  return true;
}

/**
 * Enter on a list item with nothing in it leaves the list, a task as well as a bullet:
 * Markdown's own Enter counts `[ ]` as the item's text and would start another one.
 */
export function leaveEmptyItem(view) {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to || !/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*$/.test(line.text)) return false;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from }, userEvent: 'delete' });
  return true;
}

/** Tick a task box: the `[ ]` at `at` becomes `[x]`, or back. */
function tickTask(view, at) {
  const marker = view.state.sliceDoc(at, at + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return;
  view.dispatch({ changes: { from: at + 1, to: at + 2, insert: marker[1] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
}

// -- what `@` and `/` offer ----------------------------------------------------

export function mentionSource(context) {
  const typed = context.matchBefore(/@[^\s@[\]()]{0,40}$/);
  if (!typed) return null;
  const before = context.state.sliceDoc(typed.from - 1, typed.from);
  if (before && /[\w.]/.test(before)) return null; // an address, not a mention
  const info = context.state.field(noteCase);
  const query = typed.text.slice(1);
  if (!query && !context.explicit && !info.entities.length) return null;
  return {
    from: typed.from,
    filter: false,
    options: mentionMatches(info.entities, query).map((entity) => ({
      label: entity.label,
      detail: [entity.type, entity.attrs?.folder].filter(Boolean).join(' · '),
      type: 'mention',
      apply: (view, _completion, from, to) => {
        // a mention names a record; a picture is put in with / or the Picture button
        const text = entityReference(entity);
        const after = view.state.sliceDoc(to, to + 1);
        const insert = after && /\s/.test(after) ? text : `${text} `;
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.complete' });
      },
    })),
  };
}

export function slashSource(handlers, { template = false } = {}) {
  return (context) => {
    const typed = context.matchBefore(/(?:^|\s)\/[\w-]{0,20}$/);
    if (!typed) return null;
    const slash = typed.text.indexOf('/');
    const from = typed.from + slash;
    const line = context.state.doc.lineAt(from);
    if (context.state.sliceDoc(line.from, from).includes('`')) return null;
    const query = context.state.sliceDoc(from + 1, context.pos);
    const before = context.state.sliceDoc(line.from, from);
    return {
      from,
      filter: false,
      options: slashMatches(query, { template }).map((command) => ({
        label: command.label,
        detail: command.hint ?? '',
        type: command.action ? 'action' : 'block',
        apply: (view, _completion, start, end) => {
          if (command.action === 'cite') {
            view.dispatch({ changes: { from: start, to: end, insert: '@' }, selection: { anchor: start + 1 } });
            startCompletion(view);
            return;
          }
          if (command.action) {
            view.dispatch({ changes: { from: start, to: end, insert: '' }, selection: { anchor: start } });
            handlers[command.action]?.();
            return;
          }
          const made = slashInsert(command, { before });
          if (command.line) {
            // a line command restyles the line it is typed on
            view.dispatch({ changes: { from: start, to: end, insert: '' }, selection: { anchor: start } });
            if (!before.trim()) {
              view.dispatch({ changes: { from: line.from, to: start, insert: command.line }, selection: { anchor: line.from + command.line.length } });
            } else {
              view.dispatch({ changes: { from: start, insert: made.text }, selection: { anchor: start + made.cursor } });
            }
            return;
          }
          view.dispatch({ changes: { from: start, to: end, insert: made.text }, selection: { anchor: start + made.cursor }, userEvent: 'input.complete' });
        },
      })),
    };
  };
}

// -- the look --------------------------------------------------------------------

const highlight = HighlightStyle.define([
  { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
  { tag: tags.url, color: 'var(--text-3)' },
  { tag: tags.processingInstruction, color: 'var(--text-3)' },
  { tag: tags.meta, color: 'var(--text-3)' },
  { tag: tags.contentSeparator, color: 'var(--text-3)' },
]);

const look = EditorView.theme({
  '&': { color: 'var(--text-1)', backgroundColor: 'transparent', fontSize: 'var(--note-size, 15px)', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.65', overflow: 'auto' },
  '.cm-content': { padding: 'var(--note-pad, 28px 0 40vh)', maxWidth: 'var(--note-width, 760px)', margin: '0 auto', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 var(--note-gutter, 32px)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-placeholder': { color: 'var(--text-3)' },
  '.cm-heading': { fontWeight: '650', color: 'var(--text-1)' },
  '.cm-h1': { fontSize: '1.75em', lineHeight: '1.3', paddingTop: '0.5em' },
  '.cm-h2': { fontSize: '1.35em', lineHeight: '1.35', paddingTop: '0.6em' },
  '.cm-h3': { fontSize: '1.12em', paddingTop: '0.5em' },
  '.cm-h4, .cm-h5, .cm-h6': { fontSize: '1em', color: 'var(--text-2)' },
  '.cm-strong': { fontWeight: '650' },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-strike': { textDecoration: 'line-through', color: 'var(--text-2)' },
  '.cm-inline-code': { fontFamily: 'var(--font-mono)', fontSize: '0.88em', background: 'var(--bg-2)', borderRadius: '3px', padding: '1px 3px' },
  '.cm-code-line': { fontFamily: 'var(--font-mono)', fontSize: '0.86em', background: 'var(--bg-2)' },
  '.cm-table-line': { fontFamily: 'var(--font-mono)', fontSize: '0.86em' },
  '.cm-fence-line': { color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: '0.86em' },
  '.cm-setext-rule': { color: 'var(--text-3)', fontSize: '0.7em' },
  '.cm-block .markdown-align.align-center': { textAlign: 'center' },
  '.cm-block .markdown-align.align-right': { textAlign: 'right' },
  '.cm-block .markdown-align h1, .cm-block .markdown-align h2, .cm-block .markdown-align h3': { margin: '0.3em 0', fontWeight: '650' },
  '.cm-block p': { margin: '0.2em 0' },
  '.cm-link': { color: 'var(--info)' },
  '.cm-quote': { borderLeft: '2px solid var(--border-strong)', color: 'var(--text-2)', marginLeft: 'var(--note-gutter, 32px)', paddingLeft: '12px !important' },
  '.cm-callout': {
    borderLeft: '3px solid var(--callout)', marginLeft: 'var(--note-gutter, 32px)', marginRight: 'var(--note-gutter, 32px)',
    paddingLeft: '12px !important', background: 'color-mix(in srgb, var(--callout) 9%, transparent)',
  },
  '.cm-callout-label': {
    color: 'var(--callout)', fontWeight: '650', fontSize: '0.74em', letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: '8px',
  },
  '.cm-bullet': { color: 'var(--accent)', display: 'inline-block', width: '0.9em' },
  '.cm-task': { margin: '0 6px 0 0', verticalAlign: '-2px', accentColor: 'var(--accent)', cursor: 'pointer' },
  '.cm-task-done': { color: 'var(--text-3)', textDecoration: 'line-through' },
  '.cm-rule': { border: 'none', borderTop: '1px solid var(--border-strong)', margin: '0.6em 0' },
  '.cm-chip': {
    display: 'inline-flex', alignItems: 'baseline', gap: '4px', padding: '0 6px', margin: '0 1px', borderRadius: '4px',
    background: 'var(--bg-3)', color: 'var(--text-1)', cursor: 'pointer', fontSize: '0.94em', border: '1px solid var(--border)',
  },
  '.cm-chip:hover': { borderColor: 'var(--accent)' },
  '.cm-chip-mark': { color: 'var(--accent)', fontSize: '0.8em' },
  '.cm-chip-broken': { color: 'var(--text-3)', textDecoration: 'line-through', cursor: 'default' },
  '.cm-ref-source': { color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
  '.cm-coords': { fontFamily: 'var(--font-mono)', fontSize: '0.92em', borderBottom: '1px dotted var(--accent)' },
  '.cm-coords-go': {
    border: 'none', background: 'none', color: 'var(--accent)', cursor: 'pointer', padding: '0 2px', font: 'inherit', lineHeight: '1',
  },
  '.cm-block': { padding: '6px var(--note-gutter, 32px)', cursor: 'text' },
  '.cm-block img, .cm-block video': { maxWidth: '100%', borderRadius: '4px', display: 'block' },
  '.cm-block img.align-center, .cm-block video.align-center': { marginLeft: 'auto', marginRight: 'auto' },
  '.cm-block img.align-right, .cm-block video.align-right': { marginLeft: 'auto' },
  // a picture whose line writes no place takes its block's, as the PDF prints it
  '.cm-block .markdown-align.align-center [data-unaligned], .cm-in-align-center [data-unaligned]': { marginLeft: 'auto', marginRight: 'auto' },
  '.cm-block .markdown-align.align-right [data-unaligned], .cm-in-align-right [data-unaligned]': { marginLeft: 'auto' },
  '.cm-in-align-center [data-unaligned] + .markdown-caption': { textAlign: 'center' },
  '.cm-in-align-right [data-unaligned] + .markdown-caption': { textAlign: 'right' },
  '.cm-block table': { borderCollapse: 'collapse', fontSize: '0.92em' },
  '.cm-block th, .cm-block td': { border: '1px solid var(--border-strong)', padding: '4px 10px', textAlign: 'left' },
  '.cm-block th': { background: 'var(--bg-2)' },
  '.cm-block-diagram': { background: '#fff', borderRadius: '4px', padding: '10px', margin: '4px var(--note-gutter, 32px)', overflowX: 'auto', color: '#202124' },
  '.cm-block-diagram svg': { maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' },
  '.cm-block-failed': { color: 'var(--danger)', background: 'var(--danger-soft)', fontSize: '0.9em' },
  '.cm-hint': {
    display: 'inline-block', maxWidth: '100%', boxSizing: 'border-box', verticalAlign: 'top', color: 'var(--text-3)', fontStyle: 'italic',
    borderLeft: '2px solid var(--border-strong)', paddingLeft: '8px', cursor: 'text',
  },
  '.cm-hint-line': { color: 'var(--text-3)', fontStyle: 'italic' },
  '.cm-include': {
    margin: '6px var(--note-gutter, 32px)', padding: '8px 12px 10px', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)',
    borderRadius: '6px', background: 'var(--bg-2)', cursor: 'text', fontSize: '0.93em', lineHeight: '1.45',
  },
  '.cm-include:hover': { borderColor: 'var(--border-strong)', borderLeftColor: 'var(--accent)' },
  '.cm-include-missing': { borderLeftColor: 'var(--text-3)' },
  '.cm-include-head': { display: 'flex', alignItems: 'center', gap: '8px' },
  '.cm-include-number': {
    flex: '1', color: 'var(--accent)', fontSize: '0.72em', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase',
  },
  '.cm-include-missing .cm-include-number': { color: 'var(--text-3)' },
  '.cm-include-actions': { display: 'inline-flex', gap: '4px' },
  '.cm-include-actions button': {
    border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-2)', borderRadius: '4px', padding: '1px 8px',
    font: 'inherit', fontSize: '0.8em', cursor: 'pointer',
  },
  '.cm-include-actions button:hover': { color: 'var(--text-1)', borderColor: 'var(--accent)' },
  '.cm-include-title': { fontWeight: '650', color: 'var(--text-1)', marginTop: '2px' },
  '.cm-include-missing .cm-include-title': { color: 'var(--text-3)', textDecoration: 'line-through' },
  '.cm-include-excerpt': {
    color: 'var(--text-2)', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  '.cm-pagebreak': {
    display: 'flex', alignItems: 'center', gap: '10px', margin: '10px var(--note-gutter, 32px)', cursor: 'text',
    color: 'var(--text-3)', fontFamily: 'var(--font-sans)', fontSize: '0.72em', letterSpacing: '0.06em', textTransform: 'uppercase',
  },
  '.cm-pagebreak::before, .cm-pagebreak::after': { content: '""', flex: '1', borderTop: '1px dashed var(--border-strong)' },
  '.cm-pagebreak:hover': { color: 'var(--text-2)' },
  '.cm-pagebreak-line': { color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  '.cm-cover-rule': { color: 'var(--accent)', margin: '14px var(--note-gutter, 32px)' },
  '.cm-cover-rule::before, .cm-cover-rule::after': { borderTop: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)' },
  '.cm-placeholder': {
    color: 'var(--text-3)', fontStyle: 'italic', background: 'var(--bg-2)', borderRadius: '3px', padding: '0 4px',
    boxShadow: 'inset 0 0 0 1px var(--border)',
  },
  '.cm-placeholder-set': { color: 'inherit', fontStyle: 'normal', background: 'none', boxShadow: 'none', padding: '0', borderBottom: '1px dotted var(--text-3)' },
  '.cm-placeholder-source': { color: 'var(--text-3)' },
  '.cm-block .builtin-unset': {
    display: 'inline-block', padding: '10px 14px', border: '1px dashed var(--border-strong)', borderRadius: '4px', color: 'var(--text-3)',
    fontFamily: 'var(--font-sans)', fontSize: '0.84em',
  },
  '.cm-block-picture': { position: 'relative' },
  // hidden until the picture is hovered, yet there for Tab, which shows it
  // in a narrow note it wraps onto a second row rather than run off the page
  '.cm-size-bar': {
    position: 'absolute', top: '10px', right: 'calc(var(--note-gutter, 32px) + 4px)', display: 'flex', gap: '2px', padding: '3px',
    flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 'calc(100% - 2 * var(--note-gutter, 32px) - 8px)', boxSizing: 'border-box',
    background: 'var(--bg-1)', border: '1px solid var(--border-strong)', borderRadius: '6px', boxShadow: 'var(--shadow-2)',
    fontFamily: 'var(--font-sans)', fontSize: '11px', lineHeight: '1', opacity: '0', pointerEvents: 'none',
  },
  '.cm-block-picture:hover .cm-size-bar, .cm-size-bar:focus-within': { opacity: '1', pointerEvents: 'auto' },
  '.cm-size-bar button': {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '30px', height: '22px', padding: '0 6px',
    border: 'none', borderRadius: '4px', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', font: 'inherit',
    whiteSpace: 'nowrap',
  },
  '.cm-size-bar button.cm-size-align': { minWidth: '24px', padding: '0' },
  '.cm-size-bar button.cm-size-align:first-of-type': { marginLeft: '4px' },
  '.cm-size-bar button:hover': { background: 'var(--bg-3, var(--bg-2))', color: 'var(--text-1)' },
  '.cm-size-bar button[aria-pressed="true"]': { background: 'var(--accent-soft, var(--bg-2))', color: 'var(--accent)' },
  '.cm-size-bar button.cm-size-caption': { marginLeft: '4px', padding: '0 8px' },
  '.cm-size-bar button.cm-size-source, .cm-size-bar button.cm-size-open, .cm-size-bar button.cm-size-posted': { padding: '0 8px', whiteSpace: 'nowrap' },
  '.cm-size-bar button.cm-size-posted.kept': { color: 'var(--accent)' },
  '.cm-size-bar button.cm-size-open': { color: 'var(--accent)' },
  '.cm-landed': { background: 'color-mix(in srgb, var(--accent) 16%, transparent)', transition: 'background-color 0.6s ease-out' },
  '.cm-block.cm-block-landed': { background: 'color-mix(in srgb, var(--accent) 16%, transparent)', borderRadius: '4px', boxShadow: '0 0 0 4px color-mix(in srgb, var(--accent) 16%, transparent)' },
  '.cm-size-bar button:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-block .markdown-caption': {
    display: 'block', marginTop: '6px', color: 'var(--text-2)', fontFamily: 'var(--font-sans)', fontSize: '0.84em', lineHeight: '1.4',
  },
  '.cm-block .markdown-caption.align-center': { textAlign: 'center' },
  '.cm-block .markdown-caption.align-right': { textAlign: 'right' },
  '.cm-captioning .markdown-caption': { display: 'none' },
  '.picture-caption-field': {
    display: 'block', boxSizing: 'border-box', width: '100%', marginTop: '6px', padding: '4px 8px', border: '1px solid var(--accent)',
    borderRadius: '4px', background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', fontFamily: 'var(--font-sans)',
    fontSize: '0.84em', outline: 'none', cursor: 'text',
  },
  '.picture-source-field': {
    display: 'block', boxSizing: 'border-box', width: '100%', marginTop: '6px', padding: '4px 8px', border: '1px solid var(--accent)',
    borderRadius: '4px', background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', fontFamily: 'var(--font-sans)',
    fontSize: '0.84em', outline: 'none', cursor: 'text',
  },
  '.picture-source-field[aria-invalid="true"]': { borderColor: 'var(--danger)' },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: 'var(--bg-2)', border: '1px solid var(--border-strong)', borderRadius: '6px', boxShadow: 'var(--shadow-2)', overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-sans)', maxHeight: '18em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', color: 'var(--text-1)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent-soft)', color: 'var(--text-1)' },
  '.cm-completionDetail': { color: 'var(--text-3)', fontStyle: 'normal', marginLeft: '10px', fontSize: '0.85em' },
  '.cm-completionIcon': { display: 'none' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)' },
});

// -- the editor ----------------------------------------------------------------

/**
 * The extensions a note editor is made of. `handlers` are the editor's outside:
 * `open(entity)`, `note(id)`, `point(lat, lon)`, `picture()`, `upload()`,
 * `include()`, `image(file)`, `url(url, from, to)`, `media(paths, at)` and
 * `change(text)`. `template` writes a template rather than a note.
 */
export function noteExtensions({ handlers = {}, placeholder = '', readOnly = false, editable, template = false } = {}) {
  return [
    noteCase,
    focused,
    templateMode.of(template),
    noteHandlers.of(handlers),
    spots,
    landed,
    drawn,
    typeOverHints,
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, addKeymap: true }),
    syntaxHighlighting(highlight),
    autocompletion({ override: [mentionSource, slashSource(handlers, { template })], icons: false, activateOnTyping: true, closeOnBlur: true }),
    // above Markdown's own Enter, which continues a list: an open menu takes Enter first
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }, ...completionKeymap, { key: 'Enter', run: leaveEmptyItem }])),
    keymap.of([
      { key: 'Mod-b', run: (view) => toggleWrap(view, '**') },
      { key: 'Mod-i', run: (view) => toggleWrap(view, '*') },
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    placeholder ? placeholderText(placeholder) : [],
    (editable ?? new Compartment()).of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    look,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.change?.(update.state.doc.toString());
      if (update.focusChanged) {
        const now = update.view.hasFocus;
        queueMicrotask(() => {
          if (update.view.state.field(focused) !== now) update.view.dispatch({ effects: setFocused.of(now) });
        });
      }
    }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const chip = event.target.closest?.('[data-chip]');
        if (chip && event.button === 0) {
          event.preventDefault();
          const entity = resolve(view.state.field(noteCase), chip.dataset.entityId);
          if (entity) handlers.open?.(entity);
          return true;
        }
        const go = event.target.closest?.('.cm-coords-go');
        if (go && event.button === 0) {
          event.preventDefault();
          handlers.point?.(Number(go.dataset.lat), Number(go.dataset.lon));
          return true;
        }
        const box = event.target.closest?.('.cm-task');
        if (box && event.button === 0) {
          event.preventDefault();
          if (!view.state.readOnly) tickTask(view, Number(box.dataset.taskAt));
          return true;
        }
        const chapter = event.target.closest?.('[data-include]');
        if (chapter && event.button === 0) {
          event.preventDefault();
          const at = view.posAtDOM(chapter);
          if (event.target.closest('.cm-include-open')) {
            const id = chapter.dataset.include;
            if (handlers.note) handlers.note(id);
            else {
              const entity = resolve(view.state.field(noteCase), id);
              if (entity) handlers.open?.(entity);
            }
          } else if (event.target.closest('.cm-include-remove')) {
            if (!view.state.readOnly) removeInclude(view, at);
          } else {
            view.dispatch({ selection: { anchor: at } });
            view.focus();
          }
          return true;
        }
        return false;
      },
      paste(event, view) {
        const items = [...(event.clipboardData?.items ?? [])];
        const image = items.find((item) => item.type.startsWith('image/'));
        if (image && handlers.image) {
          event.preventDefault();
          handlers.image(image.getAsFile());
          return true;
        }
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (handlers.url && /^\s*https?:\/\/\S+\s*$/i.test(text)) {
          const from = view.state.selection.main.from;
          const url = text.trim();
          queueMicrotask(() => handlers.url(url, from, from + url.length));
        }
        return false;
      },
      drop(event, view) {
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        if (handlers.media?.(event, at)) {
          event.preventDefault();
          return true;
        }
        const image = [...(event.dataTransfer?.files ?? [])].find((file) => file.type.startsWith('image/'));
        if (image && handlers.image) {
          event.preventDefault();
          view.dispatch({ selection: { anchor: at } });
          handlers.image(image);
          return true;
        }
        return false;
      },
    }),
  ];
}

/** A note's editor state: its text, and the case its references are read in. */
export function noteState(text, { caseInfo, ...options } = {}) {
  const state = EditorState.create({ doc: text, extensions: noteExtensions(options) });
  return caseInfo ? state.update({ effects: setNoteCase.of(caseInfo) }).state : state;
}

/** Mark a state as being edited, for tests of what the line being edited shows. */
export function focusedState(state) {
  return state.update({ effects: setFocused.of(true) }).state;
}
