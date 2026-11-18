/**
 * The note editor: Markdown written in place, drawn as it will read.
 *
 * The file stays the Markdown the PDF and `lib/markdown.js` read. What changes is
 * the page: a heading is set large with its `#` put away, a case reference is a
 * chip, a picture, a table and a diagram are drawn, a task is a box to tick, and a
 * callout is a coloured block. The marks come back on the line being edited, so
 * nothing is hidden from the person writing it.
 *
 * A block (a picture, a table, a diagram, an aligned block, a block of steps or a
 * story, a page break, a chapter)
 * stays drawn when it is clicked: the press picks it, and its source shows only once
 * it is opened (a double press, Enter, or its </> button), until the cursor leaves.
 * The page can also be switched off for the raw Markdown (`setNoteMode`).
 *
 * Built on CodeMirror 6. Everything the page draws is worked out from the editor
 * state alone (`noteDecorations`), so it is tested without a browser.
 */
import {
  EditorState, StateEffect, StateField, Compartment, EditorSelection, Prec, Transaction,
} from '@codemirror/state';
import {
  Decoration, EditorView, WidgetType, keymap, placeholder as placeholderText, drawSelection, dropCursor,
} from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap, startCompletion, acceptCompletion } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

import {
  BulletWidget, CalloutLabelWidget, ChipWidget, CoordinatesWidget, HintWidget, PlaceholderWidget, RuleWidget, TaskWidget,
  drawHints, drawPlaceholders, hintsMarked,
} from './editor/inline.js';
import {
  focused, noteCase, noteHandlers, openBlock, resolve, setFocused, setNoteCase, setOpenBlock, templateMode,
} from './editor/state.js';
import { highlight, look } from './editor/theme.js';
import { entityReference, markdownHtml } from '../markdown.js';
import { renderMermaidSvg } from '../mermaid.js';
import { CALLOUT_LINE, calloutOf } from './callouts.js';
import { paths as iconPaths } from '../../components/Icon.svelte';
import { HINT_LINE, INCLUDE_LINE, PAGE_BREAK_LINE, includeLine } from './look.js';
import {
  COVER_LINE, NO_IDENTITY, coverChange, coverLineIndex, findPlaceholders,
} from './reportParts.js';
import {
  BLOCK_OPEN, CAPTION_HELP, PICTURE_ALIGNS, PICTURE_SIZES, POSTED_HELP, SOURCE_HELP, blockAlignAt, blockSide, captionField, pictureLine, picturesIn,
  rovingToolbar, sizeWidth, sizedLine, sourceField,
} from './pictureSize.js';
import {
  MAP_BLOCK, PLAYED_BLOCK, findCoordinates, findReferences, mentionMatches, slashInsert, slashMatches,
} from './syntax.js';

export { noteCase, setNoteCase, templateMode } from './editor/state.js';

// -- the widgets ---------------------------------------------------------------

/** The note a report includes as a chapter: its number, name and first words. */
class IncludeWidget extends WidgetType {
  constructor(id, number, note, picked = false) {
    super();
    this.id = id;
    this.number = number;
    this.note = note;
    this.picked = picked;
  }

  same(other) {
    return other.id === this.id && other.number === this.number && other.note?.title === this.note?.title
      && other.note?.excerpt === this.note?.excerpt;
  }

  eq(other) {
    return this.same(other) && other.picked === this.picked;
  }

  /** Picked or not is the only change that keeps the card where it is. */
  updateDOM(dom, _view, previous) {
    if (!previous?.same(this)) return false;
    markPicked(dom, this.picked);
    return true;
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = `cm-include${this.note ? '' : ' cm-include-missing'}`;
    box.dataset.include = this.id;
    box.title = 'Double-click to edit the line';
    markPicked(box, this.picked);
    box.addEventListener('dblclick', (event) => {
      if (event.target.closest('button')) return;
      event.preventDefault();
      openBlockAt(view, box);
    });
    const head = document.createElement('div');
    head.className = 'cm-include-head';
    const number = document.createElement('span');
    number.className = 'cm-include-number';
    number.textContent = `Chapter ${this.number}`;
    const actions = document.createElement('span');
    actions.className = 'cm-include-actions';
    if (this.note) actions.append(includeButton('Open', 'cm-include-open', `Open ${this.note.title}`));
    actions.append(includeButton('Remove', 'cm-include-remove', 'Take this chapter out of the report'));
    actions.append(sourceButton(view, box, 'cm-include-source'));
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

/** A block that is picked wears an outline; the class is all a widget changes when it is, so it is not drawn again. */
function markPicked(dom, picked) {
  dom.classList.toggle('cm-picked', Boolean(picked));
}

/**
 * The `</>` button a drawn block wears, which opens its source. `node` is the
 * block's own element. The press acts at once, as the rest of the block does; the
 * keyboard's Enter and Space give a click without one.
 */
function sourceButton(view, node, className = 'cm-source-edit') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.editSource = 'true';
  // the glyph is drawn by the style, so a block's text stays the words it shows
  button.title = 'Edit the source';
  button.setAttribute('aria-label', 'Edit the source');
  button.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    openBlockAt(view, node);
  });
  button.addEventListener('click', (event) => {
    if (event.detail === 0) openBlockAt(view, node);
  });
  return button;
}

/** What a small drawn rule does with the mouse: a press picks it, a double press or its </> button opens its line. */
function blockMouse(view, box, picked) {
  markPicked(box, picked);
  box.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    view.dispatch({ selection: { anchor: view.posAtDOM(box) } });
    view.focus();
  });
  box.addEventListener('dblclick', (event) => {
    event.preventDefault();
    openBlockAt(view, box);
  });
  box.append(sourceButton(view, box));
}

/** Where the PDF starts a new page: a dashed rule, named. Pressing it picks it, a double press opens its line. */
class PageBreakWidget extends WidgetType {
  constructor(picked = false) {
    super();
    this.picked = picked;
  }

  eq(other) {
    return other.picked === this.picked;
  }

  updateDOM(dom, _view, previous) {
    if (!previous) return false;
    markPicked(dom, this.picked);
    return true;
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = 'cm-pagebreak';
    box.dataset.pagebreak = 'true';
    box.title = 'The PDF starts a new page here. Double-click to edit the line';
    const label = document.createElement('span');
    label.textContent = 'Page break';
    box.append(label);
    blockMouse(view, box, this.picked);
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 30;
  }
}

/** Where the analyst's own first page ends: a rule, named. Pressing it picks it, a double press opens its line. */
class CoverRuleWidget extends WidgetType {
  constructor(picked = false) {
    super();
    this.picked = picked;
  }

  eq(other) {
    return other.picked === this.picked;
  }

  updateDOM(dom, _view, previous) {
    if (!previous) return false;
    markPicked(dom, this.picked);
    return true;
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = 'cm-pagebreak cm-cover-rule';
    box.dataset.coverRule = 'true';
    box.title = 'Above this line is page 1 when Look › Cover is Your own page. Double-click to edit the line';
    const label = document.createElement('span');
    label.textContent = 'End of the cover page';
    box.append(label);
    blockMouse(view, box, this.picked);
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 30;
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
      bar.insertBefore(said, bar.querySelector('[data-open], [data-edit-source]'));
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

/** `zoom=x,y,w,h` in a picture's braces: the part of it a story moves in on, as fractions, or null. */
export function storyZoom(rest) {
  const match = /\bzoom\s*=\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(String(rest ?? ''));
  if (!match) return null;
  const [x, y, w, h] = match.slice(1).map(Number);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
}

/**
 * The steps of a `::: steps` or `::: story` block, from its source: each line holding
 * a picture opens a step, and the lines after it are that step's words. Words before
 * the first picture are the block's lead.
 */
export function playedSteps(source) {
  const lines = String(source ?? '').split('\n').slice(1, -1);
  const lead = [];
  const steps = [];
  for (const line of lines) {
    const [picture] = picturesIn(line);
    if (picture) steps.push({ picture: line, zoom: storyZoom(picture.rest), words: [] });
    else if (steps.length) steps.at(-1).words.push(line);
    else lead.push(line);
  }
  return { lead: lead.join('\n').trim(), steps: steps.map((step) => ({ ...step, words: step.words.join('\n').trim() })) };
}

/** A map's block, read: its title, what it shows and its ground (`engine/notes_maps.py`). */
export function mapBlock(source) {
  const read = { title: '', layers: [], plate: '', proofs: '', ground: '', details: 0 };
  for (const line of String(source ?? '').split('\n').slice(1)) {
    const found = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (!found) continue;
    const [, key, value] = found;
    const name = key.toLowerCase();
    if ((name === 'layer' || name === 'layers') && value) read.layers.push(value);
    else if (name === 'detail' && value) read.details += 1;
    else if (name in read && typeof read[name] === 'string' && !read[name]) read[name] = value;
  }
  return read;
}

/**
 * A map, drawn small as what it shows: its title, its layers or plate and its proofs,
 * over its ground. The HTML page moves it and plays its days; the PDF prints its picture.
 */
function drawMap(box, source, info) {
  const map = mapBlock(source);
  const head = document.createElement('div');
  head.className = 'cm-played-head';
  head.textContent = 'Map · interactive in HTML, a picture in the PDF';
  const frame = document.createElement('div');
  frame.className = 'cm-map-frame';
  if (map.ground) {
    frame.innerHTML = markdownHtml(`[[media:${map.ground}|Ground]]`, info);
    if (!frame.querySelector('img')) frame.replaceChildren();
  }
  if (!frame.childNodes.length) frame.classList.add('cm-map-plain');
  const said = document.createElement('div');
  said.className = 'cm-map-said';
  const title = document.createElement('strong');
  title.textContent = map.title || 'Map';
  said.append(title);
  const parts = [
    map.plate ? `Plate: ${map.plate}` : '',
    map.layers.length ? `${map.layers.length === 1 ? 'Layer' : 'Layers'}: ${map.layers.join(', ')}` : '',
    map.proofs ? `Proofs: ${map.proofs === 'all' ? 'all' : map.proofs.replace('..', ' to ')}` : '',
    map.ground ? '' : 'No ground: drawn on a plain background',
  ].filter(Boolean);
  for (const part of parts) {
    const line = document.createElement('span');
    line.textContent = part;
    said.append(line);
  }
  frame.append(said);
  box.append(head, frame);
}

/**
 * A block of steps or a story, drawn small the way the HTML page plays it: its steps
 * in order, numbered, each picture with its words; a story's beside it, and the part
 * a step moves in on outlined. The PDF prints them one after the other.
 */
function drawPlayed(box, kind, source, info) {
  const { text, hints } = hintsMarked(source);
  const { lead, steps } = playedSteps(text);
  const head = document.createElement('div');
  head.className = 'cm-played-head';
  const count = steps.length;
  head.textContent = kind === 'steps'
    ? `Steps · ${count} picture${count === 1 ? '' : 's'}, one at a time in HTML`
    : `Story · ${count} step${count === 1 ? '' : 's'}, the words scroll beside the pictures in HTML`;
  box.append(head);
  if (lead) {
    const words = document.createElement('div');
    words.className = 'cm-played-lead';
    words.innerHTML = markdownHtml(lead, info);
    box.append(words);
  }
  const list = document.createElement('ol');
  list.className = `cm-played-list cm-played-${kind}`;
  steps.forEach((step, index) => {
    const item = document.createElement('li');
    item.className = 'cm-played-step';
    const figure = document.createElement('div');
    figure.className = 'cm-played-figure';
    figure.dataset.step = String(index + 1);
    figure.innerHTML = markdownHtml(step.picture, info);
    const picture = figure.querySelector('img, video');
    if (picture && step.zoom && kind === 'story') {
      const frame = document.createElement('span');
      frame.className = 'cm-zoom-frame';
      picture.replaceWith(frame);
      frame.append(picture);
      const zoom = document.createElement('span');
      zoom.className = 'cm-zoom-box';
      zoom.title = 'The part this step moves in on';
      Object.assign(zoom.style, {
        left: `${step.zoom.x * 100}%`, top: `${step.zoom.y * 100}%`, width: `${step.zoom.w * 100}%`, height: `${step.zoom.h * 100}%`,
      });
      frame.append(zoom);
    }
    item.append(figure);
    if (step.words) {
      const words = document.createElement('div');
      words.className = 'cm-played-words';
      words.innerHTML = markdownHtml(step.words, info);
      item.append(words);
    }
    list.append(item);
  });
  box.append(list);
  drawHints(box, hints);
}

/** The small label a corner block of the cover wears, so the analyst sees it is pinned to the page. */
function cornerTag(name) {
  const tag = document.createElement('div');
  tag.className = `cm-corner-tag cm-corner-${blockSide(name ?? '')}`;
  tag.textContent = `${(name ?? '').replace('-', ' ').replace(/^./, (letter) => letter.toUpperCase())} corner`;
  tag.title = 'Pinned to this corner of page 1 when Look › Cover is Your own page';
  return tag;
}

/**
 * A drawn block (a picture, a table, a diagram): pressing it picks it, and a double
 * press, Enter or its </> button opens its source.
 */
class BlockWidget extends WidgetType {
  /**
   * `writable`: whether the note can be changed, which is when a picture offers its bar.
   * `align`: the place of the `::: center` or `::: right` block a picture stands in.
   * `pinned`: whether this aligned block is a corner of the cover, which it says.
   * `picked`: whether the cursor stands at its start, which outlines it.
   */
  constructor(kind, source, info, writable = false, align = '', pinned = false, picked = false) {
    super();
    this.kind = kind;
    this.source = source;
    this.info = info;
    this.writable = writable;
    this.align = align;
    this.pinned = pinned;
    this.picked = picked;
  }

  /** Whether `other` draws the same, picked or not: a block that only gets picked keeps its element. */
  same(other) {
    if (other.kind !== this.kind || other.source !== this.source || other.info.caseId !== this.info.caseId
      || other.writable !== this.writable || other.align !== this.align || other.pinned !== this.pinned
      || !sameIdentity(other.info.identity, this.info.identity)) return false;
    // A tool that files something reads the case again: the same records come back as a
    // new list. The block is drawn again only when what it shows changed, so a picture
    // keeps its open caption field and does not blink.
    return other.info.entities === this.info.entities || other.caseKey() === this.caseKey();
  }

  eq(other) {
    return this.same(other) && other.picked === this.picked;
  }

  /** Picking and unpicking only moves the outline: the element, and what is open in it, stay. */
  updateDOM(dom, _view, previous) {
    if (!(previous instanceof BlockWidget) || !previous.same(this)) return false;
    markPicked(dom, this.picked);
    return true;
  }

  /** What the block draws from the case: the records and notes its source names, as they read now. */
  caseKey() {
    this.key ??= JSON.stringify([...this.source.matchAll(/(?:\[\[(?:media|entity|include):|^ground:[ \t]*)([A-Za-z0-9_-]+)/gm)].map(([, id]) => {
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
    box.title = 'Double-click to edit the source';
    markPicked(box, this.picked);
    if (this.kind === 'diagram') drawDiagram(box, this.source);
    else if (this.kind === 'steps' || this.kind === 'story') drawPlayed(box, this.kind, this.source, this.info);
    else if (this.kind === 'map') drawMap(box, this.source, this.info);
    else {
      const { text, hints } = hintsMarked(this.source);
      box.innerHTML = markdownHtml(text, this.info);
      drawHints(box, hints);
      drawPlaceholders(box, this.info.identity);
      if (this.pinned) box.prepend(cornerTag(BLOCK_OPEN.exec(this.source.split('\n', 1)[0])?.[1]));
    }
    const handlers = view.state.facet(noteHandlers);
    if (this.kind === 'picture' && this.writable) {
      const bar = sizeBar(box, this.source, this.info, handlers, this.align);
      bar.append(sourceButton(view, box, 'cm-size-edit'));
      box.append(bar);
    } else box.append(sourceButton(view, box));
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
      // a press picks the block, which stays drawn: its source opens on a double press, Enter or </>
      const at = view.posAtDOM(box);
      view.dispatch({ selection: { anchor: at } });
      view.focus();
    });
    box.addEventListener('dblclick', (event) => {
      if (event.target.closest('a, video, [data-entity-id], [data-size-bar], .picture-caption-field, .picture-source-field')) return;
      event.preventDefault();
      openBlockAt(view, box);
    });
    // the mouse acts on the press, before focus moves; the keyboard's Enter and Space give a click
    box.addEventListener('click', (event) => {
      const button = event.target.closest('[data-size-bar] button');
      if (event.detail !== 0 || !button || button.dataset.editSource) return;
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
    // the drawing replaces what the box held, but not the button that opens its source
    const edit = box.querySelector('[data-edit-source]');
    if (result.svg) box.innerHTML = result.svg;
    else {
      box.classList.add('cm-block-failed');
      box.textContent = `Diagram not drawn: ${result.error}`;
    }
    if (edit) box.append(edit);
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

// -- blocks: closed, picked, open ----------------------------------------------


/** What kind of drawn block a widget is, or null for anything else. */
function blockKind(widget) {
  if (widget instanceof BlockWidget) return widget.kind;
  if (widget instanceof IncludeWidget) return 'include';
  if (widget instanceof PageBreakWidget) return 'pagebreak';
  if (widget instanceof CoverRuleWidget) return 'cover';
  return null;
}

/** The blocks drawn now that touch `from`–`to`, as `{ from, to, kind }`: the ones whose source is closed. */
function blocksIn(state, from, to = from) {
  const found = [];
  state.field(drawn, false)?.between(Math.max(0, from), Math.min(state.doc.length, to), (start, end, value) => {
    const kind = blockKind(value.spec.widget);
    if (kind) found.push({ from: start, to: end, kind });
  });
  return found;
}

/** The block the cursor stands at the start of, which is picked, or null. */
function pickedBlock(state) {
  const range = state.selection.main;
  return range.empty ? blocksIn(state, range.head).find((block) => block.from === range.head) ?? null : null;
}

/** A cursor at a block's start, inside it or at its end goes to its start, where it is picked. */
function settle(state, pos) {
  return blocksIn(state, pos).find((block) => block.from <= pos && pos <= block.to)?.from ?? pos;
}

/** Open the source of the block drawn at `at` (a position, or its element), the cursor at its start. */
export function openBlockAt(view, at) {
  const pos = typeof at === 'number' ? at : view.posAtDOM(at);
  const block = blocksIn(view.state, pos).find((item) => item.from <= pos && pos <= item.to);
  if (!block) return false;
  view.dispatch({ selection: { anchor: block.from }, effects: setOpenBlock.of({ from: block.from, to: block.to }), scrollIntoView: true });
  view.focus();
  return true;
}

/** Take a drawn block out of the note, with the line break it stands on and a blank line it would leave doubled. */
function removeBlock(view, block) {
  const { doc } = view.state;
  const first = doc.lineAt(block.from);
  const last = doc.lineAt(block.to);
  const before = first.number > 1 ? doc.line(first.number - 1) : null;
  const after = last.number < doc.lines ? doc.line(last.number + 1) : null;
  let from = first.from;
  let to = last.to;
  if (after) {
    to = after.from;
    if (!after.text.trim() && (!before || !before.text.trim())) to = after.number < doc.lines ? doc.line(after.number + 1).from : after.to;
  } else if (before) from = before.to;
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, scrollIntoView: true, userEvent: 'delete' });
}

/** Enter on a picked block opens its source. */
function openPicked(view) {
  const block = pickedBlock(view.state);
  return block ? openBlockAt(view, block.from) : false;
}

/**
 * Tab on a picked block never indents its source: on a picture it goes to its bar, which
 * is where it is sized and captioned, and on any other block it does nothing. (After
 * Escape the editor lets Tab leave it, as it does everywhere.)
 */
function tabOnPicked(view) {
  if (!pickedBlock(view.state)) return false;
  view.dom.querySelector('.cm-picked [data-size-bar] button')?.focus({ preventScroll: true });
  return true;
}

/** Escape inside an open block closes it, and picks it. */
function closeOpen(view) {
  const open = view.state.field(openBlock, false);
  if (!open) return false;
  view.dispatch({ selection: { anchor: open.from }, effects: setOpenBlock.of(null), scrollIntoView: true });
  return true;
}

/**
 * Backspace and Delete at a drawn block take the whole of it out in one step, which
 * Undo brings back. Next to it, on a line of words, they pick it first: the words
 * would otherwise be joined onto the block's source.
 */
function removeAtBlock(forward) {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty || state.readOnly) return false;
    const block = blocksIn(state, range.head).find((item) => item.from === range.head || item.to === range.head);
    if (block) {
      removeBlock(view, block);
      return true;
    }
    const line = state.doc.lineAt(range.head);
    let next = null;
    if (forward && range.head === line.to && line.text) next = blocksIn(state, range.head + 1).find((item) => item.from === range.head + 1);
    if (!forward && range.head === line.from && line.text && line.number > 1) next = blocksIn(state, range.head - 1).find((item) => item.to === range.head - 1);
    if (!next) return false;
    view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
    return true;
  };
}

/**
 * Where the cursor goes to leave `block` forward or back: the start of the line after it, the end of the line before it,
 * or, at the end of the note or its start, where it is.
 */
function past(state, block, forward) {
  if (forward) return block.to < state.doc.length ? settle(state, block.to + 1) : block.to;
  return block.from > 0 ? settle(state, block.from - 1) : block.from;
}

/** Left and Right step over a block as one unit: from the next line or the previous, onto it; off it, past it. */
function stepAcross(forward) {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty) return false;
    const picked = pickedBlock(state);
    let target = null;
    if (picked) target = past(state, picked, forward);
    else if (!forward) {
      const line = state.doc.lineAt(range.head);
      if (range.head === line.from && line.number > 1) target = blocksIn(state, range.head - 1).find((item) => item.to === range.head - 1)?.from ?? null;
    }
    if (target === null) return false;
    view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/**
 * Up and Down step over a block as one unit too: off a picked block, to the line
 * past it; onto one, wherever the vertical move would have put the cursor in it.
 */
function stepAlong(down) {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty) return false;
    const picked = pickedBlock(state);
    let target;
    if (picked) {
      target = past(state, picked, down);
    } else {
      try { target = view.moveVertically(range, down).head; } catch { return false; }
      if (target === range.head) return false;
      // a browser's vertical move goes over a drawn block whole: the first one crossed is picked
      const line = state.doc.lineAt(range.head);
      const crossed = blocksIn(state, Math.min(range.head, target), Math.max(range.head, target))
        .filter((block) => (down ? block.from > line.to : block.to < line.from))
        .sort((a, b) => (down ? a.from - b.from : b.from - a.from))[0];
      if (crossed) target = crossed.from;
      else if (settle(state, target) === target) return false;
      else target = settle(state, target);
    }
    view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/**
 * Typing at a drawn block starts a line after it and types there: the block's own
 * line is never typed into, so a picture keeps its line whole.
 */
/** Type `text` on a paragraph of its own after `block`, a blank line either side. */
function typeAfter(view, block, text) {
  const { state } = view;
  const last = state.doc.lineAt(block.to);
  const following = last.number < state.doc.lines ? state.doc.line(last.number + 1) : null;
  const insert = `\n\n${text}${following?.text.trim() ? '\n' : ''}`;
  view.dispatch({
    changes: { from: block.to, insert },
    selection: { anchor: block.to + 2 + text.length },
    scrollIntoView: true,
    userEvent: 'input.type',
  });
}

const typeNextToBlock = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || from !== to || !text || !range.empty || range.head !== from) return false;
  const block = blocksIn(state, from).find((item) => item.from === from || item.to === from);
  if (!block) return false;
  if (!text.trim()) return true;
  typeAfter(view, block, text);
  return true;
});

/**
 * A key typed while a block is picked, read before the browser types it: the caret
 * the browser keeps is not at the block (it cannot stand inside a drawn one), so
 * the text it would type lands on the line after, glued to the block's own.
 */
const typeOnPicked = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return false;
    if (view.state.readOnly || !view.state.field(focused, false)) return false;
    const block = pickedBlock(view.state);
    if (!block) return false;
    event.preventDefault();
    if (event.key.trim()) typeAfter(view, block, event.key);
    return true;
  },
});

const blockKeys = Prec.high(keymap.of([
  { key: 'Enter', run: openPicked },
  { key: 'Tab', run: tabOnPicked, shift: tabOnPicked },
  { key: 'Escape', run: closeOpen },
  { key: 'Backspace', run: removeAtBlock(false) },
  { key: 'Delete', run: removeAtBlock(true) },
  { key: 'ArrowRight', run: stepAcross(true) },
  { key: 'ArrowLeft', run: stepAcross(false) },
  { key: 'ArrowDown', run: stepAlong(true) },
  { key: 'ArrowUp', run: stepAlong(false) },
]));

/**
 * Everything the page draws for this state, as one set. Exported so the drawing is
 * tested on a state with no view.
 */
export function noteDecorations(state) {
  const info = state.field(noteCase);
  const lines = editedLines(state);
  const open = state.field(openBlock, false);
  const heads = state.selection.ranges.map((range) => range.head);
  /** Whether the lines `from`–`to` are in the block that was opened. */
  const inOpen = (from, to) => Boolean(open && open.from <= state.doc.lineAt(Math.max(from, to)).to && state.doc.lineAt(from).from <= open.to);
  /** Whether the block over `from`–`to` shows its source: it was opened, or the cursor is inside it (a jump, an Undo). */
  const isOpen = (from, to) => {
    const start = state.doc.lineAt(from).from;
    const end = state.doc.lineAt(Math.max(from, to)).to;
    return inOpen(from, to) || heads.some((head) => head > start && head < end);
  };
  const range = state.selection.main;
  const pick = state.field(focused, false) && range.empty ? range.head : -1;
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const ranges = [];
  const covered = []; // [from, to] of blocks drawn whole; nothing else goes inside them
  const inside = (pos) => covered.some(([from, to]) => pos >= from && pos <= to);
  const code = []; // [from, to] of code, where references and coordinates stay text
  const template = state.facet(templateMode);
  let chapters = 0;

  // the place of the aligned block each line stands in, by line number, for a picture there
  const blockAligns = new Map();
  const block = (kind, from, to, pinned = false) => {
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to);
    covered.push([first.from, last.to]);
    const align = kind === 'picture' ? blockAligns.get(first.number) ?? '' : '';
    ranges.push(Decoration.replace({
      widget: new BlockWidget(kind, state.doc.sliceString(first.from, last.to), info, !state.readOnly, align, pinned, first.from === pick), block: true,
    }).range(first.from, last.to));
  };

  // `::: center` … `:::`, the old Notebook's aligned text: drawn as it reads unless it is open.
  // A corner (`::: top-right`) reads as its side, and says so when it is in the note's own cover.
  let coverEnd; // the 1-based line of the cover rule, 0 without one: found when a corner asks
  // `::: steps` and `::: story`, which an HTML page plays, are drawn as their steps the same way
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number).text;
    const open = BLOCK_OPEN.exec(line);
    const played = open ? null : PLAYED_BLOCK.exec(line) ?? (MAP_BLOCK.test(line) ? [line, 'map'] : null);
    if (!open && !played) continue;
    let end = number + 1;
    while (end <= state.doc.lines && !/^:::[ \t]*$/.test(state.doc.line(end).text)) end += 1;
    if (end > state.doc.lines) break;
    const from = state.doc.line(number).from;
    const to = state.doc.line(end).to;
    if (played) {
      if (isOpen(from, to)) {
        ranges.push(lineClass('cm-fence-line').range(from));
        ranges.push(lineClass('cm-fence-line').range(state.doc.line(end).from));
      } else block(played[1], from, to);
      number = end;
      continue;
    }
    const side = blockSide(open[1]);
    if (side !== 'left') for (let inner = number + 1; inner < end; inner += 1) blockAligns.set(inner, side);
    if (isOpen(from, to)) {
      ranges.push(lineClass('cm-fence-line').range(from));
      ranges.push(lineClass('cm-fence-line').range(state.doc.line(end).from));
    } else {
      const corner = open[1] !== side;
      if (corner) coverEnd ??= coverLineIndex(state.doc.toString()) + 1;
      block('aligned', from, to, corner && end < coverEnd);
    }
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
        if (/^\s*(```|~~~)\s*mermaid\b/.test(opening) && !isOpen(from, to) && state.doc.lineAt(to).text.trim().match(/^(```|~~~)$/)) {
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
        if (!isOpen(from, to)) {
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
        if (isOpen(line.from, line.to)) ranges.push(lineClass('cm-pagebreak-line').range(line.from));
        else ranges.push(Decoration.replace({ widget: new PageBreakWidget(line.from === pick), block: true }).range(line.from, line.to));
        return false;
      }
      if (name === 'CommentBlock' && coverRuleOn(state, from, to)) {
        const line = state.doc.lineAt(from);
        if (isOpen(line.from, line.to)) ranges.push(lineClass('cm-pagebreak-line').range(line.from));
        else ranges.push(Decoration.replace({ widget: new CoverRuleWidget(line.from === pick), block: true }).range(line.from, line.to));
        return false;
      }
      if (name === 'HTMLBlock' || name === 'CommentBlock') {
        if (!isOpen(from, to)) block('html', from, to);
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
        if (!isOpen(line.from, line.to) && PICTURE_LINE.test(line.text)) {
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
    // the line being written in, or one of an open block, shows what it is made of
    const editing = lines.has(number) || inOpen(line.from, line.to);
    const include = !inCode(line.from) && INCLUDE_LINE.exec(line.text);
    if (include) {
      // a chapter is its line, as the PDF reads it: whatever is around it
      chapters += 1;
      chapterLines.push(line);
      if (isOpen(line.from, line.to)) ranges.push(Decoration.mark({ class: 'cm-ref-source' }).range(line.from, line.to));
      else {
        ranges.push(Decoration.replace({ widget: new IncludeWidget(include[1], chapters, includedNote(info, include[1]), line.from === pick), block: true })
          .range(line.from, line.to));
      }
      continue;
    }
    const pictureLine = !isOpen(line.from, line.to) && PICTURE_LINE.test(line.text) && line.text.includes('[[media:');
    if (pictureLine) {
      covered.push([line.from, line.to]);
      ranges.push(Decoration.replace({
        widget: new BlockWidget('picture', line.text, info, !state.readOnly, blockAligns.get(number) ?? '', false, line.from === pick), block: true,
      }).range(line.from, line.to));
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
    // a block opened or closed is drawn as source or as itself
    const reopened = transaction.startState.field(openBlock, false) !== transaction.state.field(openBlock, false);
    if (transaction.docChanged || transaction.selection || refocused || unlocked || reopened) return noteDecorations(transaction.state);
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // a drawn block is one piece, so the cursor steps over it; in a note so is a line of guidance, and a delete takes it whole
    EditorView.atomicRanges.of((view) => view.state.field(field).update({
      filter: (_from, _to, value) => blockKind(value.spec.widget) !== null
        || (!view.state.facet(templateMode) && value.spec.widget instanceof HintWidget),
    })),
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

// -- the two modes ----------------------------------------------------------------

/**
 * The page is drawn, or it is the raw Markdown. Everything that draws or acts on a
 * drawn block lives in one compartment, so switching reconfigures it: the text, the
 * cursor, the history and the case stay where they are.
 */
const drawing = new Compartment();

/** What the raw Markdown keeps of the page: headings, code, tables and guidance lines in their own type, nothing hidden or replaced. */
function rawLines(state) {
  const ranges = [];
  const code = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const eachLine = (from, to, className) => {
    for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number += 1) {
      ranges.push(lineClass(className).range(state.doc.line(number).from));
    }
  };
  tree?.iterate({
    enter(node) {
      const { name, from, to } = node;
      if (name === 'FencedCode' || name === 'CodeBlock') {
        code.push([from, to]);
        eachLine(from, to, 'cm-code-line');
        return false;
      }
      if (name === 'Table') {
        eachLine(from, to, 'cm-table-line');
        return false;
      }
      if (/^ATXHeading[1-6]$/.test(name)) eachLine(from, from, `cm-heading cm-h${name.slice(-1)}`);
      else if (name === 'SetextHeading1' || name === 'SetextHeading2') eachLine(from, from, `cm-heading cm-h${name.slice(-1)}`);
      return undefined;
    },
  });
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (!line.text || code.some(([from, to]) => line.from >= from && line.from < to)) continue;
    if (HINT_LINE.test(line.text)) ranges.push(lineClass('cm-hint-line').range(line.from));
    else if (PAGE_BREAK_LINE.test(line.text) || COVER_LINE.test(line.text)) ranges.push(lineClass('cm-pagebreak-line').range(line.from));
  }
  return Decoration.set(ranges, true);
}

const rawField = StateField.define({
  create: (state) => rawLines(state),
  update: (value, transaction) => (transaction.docChanged ? rawLines(transaction.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

const rawHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--info)' },
]);

/** While a block is picked the editor wears a class, which puts the cursor away: the outline says where it is. */
const pickedClass = EditorView.editorAttributes.compute(['selection', focused, openBlock, drawn], (state) => (
  state.field(focused, false) && pickedBlock(state) ? { class: 'cm-block-picking' } : {}
));

const drawnMode = [openBlock, drawn, typeOverHints, typeNextToBlock, Prec.high(typeOnPicked), pickedClass, blockKeys];
const rawMode = [rawField, syntaxHighlighting(rawHighlight)];

/** `drawn` or `markdown`: how the page is shown now. */
export function noteMode(state) {
  return state.field(drawn, false) ? 'drawn' : 'markdown';
}

/**
 * Show the page drawn or as raw Markdown. The cursor and the selection are the
 * document's, so they stay; the scroll is held to the line at the top of the page.
 * Answers whether it changed.
 */
export function setNoteMode(view, mode) {
  const next = mode === 'markdown' ? 'markdown' : 'drawn';
  if (noteMode(view.state) === next) return false;
  view.dispatch({ effects: [drawing.reconfigure(next === 'markdown' ? rawMode : drawnMode), view.scrollSnapshot()] });
  return true;
}

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
 * holding a picture is picked, brought into view and lit rather than opened, so the
 * picture stays drawn with its bar, which is where a picture is sized, captioned and
 * sourced. A line inside another drawn block (a table row, a line of an aligned
 * block) opens that block there.
 */
export function jumpToLine(view, line) {
  const number = Math.min(view.state.doc.lines, Math.max(1, Number(line) + 1));
  const target = view.state.doc.line(number);
  const block = blocksIn(view.state, target.from, target.to).find((item) => item.from <= target.from && target.to <= item.to);
  const picture = PICTURE_LINE.test(target.text);
  if (block && picture) {
    view.dispatch({ selection: { anchor: block.from } });
    lightLines(view, target.from, target.to);
    view.focus();
    return;
  }
  const effects = [EditorView.scrollIntoView(target.from, { y: 'center' })];
  if (block) effects.push(setOpenBlock.of({ from: block.from, to: block.to }));
  view.dispatch({ selection: { anchor: target.from }, effects });
  // a picture's line, shown as text, is lit as a picture is
  if (picture) lightLines(view, target.from, target.to);
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
          if (command.menu) {
            // a group: type its name, and its commands come up together
            const typed = `/${command.menu}`;
            view.dispatch({ changes: { from: start, to: end, insert: typed }, selection: { anchor: start + typed.length } });
            startCompletion(view);
            return;
          }
          if (command.wrap) {
            // the whole line goes in the block, what was typed before the / and what follows the cursor
            const made = slashInsert(command, { before: `${before}${view.state.sliceDoc(end, line.to)}` });
            view.dispatch({ changes: { from: line.from, to: line.to, insert: made.text }, selection: { anchor: line.from + made.cursor }, userEvent: 'input.complete' });
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

// -- the editor ----------------------------------------------------------------

/**
 * The extensions a note editor is made of. `handlers` are the editor's outside:
 * `open(entity)`, `note(id)`, `point(lat, lon)`, `picture()`, `upload()`,
 * `include()`, `image(file)`, `url(url, from, to)`, `media(paths, at)` and
 * `change(text)`. `template` writes a template rather than a note. `mode` is
 * `drawn` or `markdown` (`setNoteMode` switches it later).
 */
export function noteExtensions({ handlers = {}, placeholder = '', readOnly = false, editable, template = false, mode = 'drawn' } = {}) {
  return [
    noteCase,
    focused,
    templateMode.of(template),
    noteHandlers.of(handlers),
    spots,
    landed,
    drawing.of(mode === 'markdown' ? rawMode : drawnMode),
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

/** The state with the block drawn at `pos` open, the cursor at its start, for tests of what an open block shows. */
export function openedState(state, pos) {
  const block = blocksIn(state, pos).find((item) => item.from <= pos && pos <= item.to);
  if (!block) return focusedState(state);
  return state.update({ selection: { anchor: block.from }, effects: [setFocused.of(true), setOpenBlock.of({ from: block.from, to: block.to })] }).state;
}
