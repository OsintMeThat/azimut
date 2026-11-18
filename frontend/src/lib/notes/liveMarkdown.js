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
  EditorState, StateEffect, StateField, Compartment, EditorSelection, Prec,
} from '@codemirror/state';
import {
  Decoration, EditorView, keymap, placeholder as placeholderText, drawSelection, dropCursor,
} from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap, startCompletion, acceptCompletion } from '@codemirror/autocomplete';

import { blockKinds, registerBlock } from './editor/blocks.js';
import './editor/kinds.js';
import { blockKeys, pickedClass, typeNextToBlock, typeOnPicked } from './editor/blockKeys.js';
import { drawn, rawField, rawHighlight, typeOverHints } from './editor/decorations.js';
import { drawHints, hintsMarked } from './editor/inline.js';
import { blocksIn } from './editor/ranges.js';
import {
  focused, noteCase, noteHandlers, openBlock, resolve, setFocused, setNoteCase, setOpenBlock, templateMode,
} from './editor/state.js';
import { highlight, look } from './editor/theme.js';
import {
  BlockWidget, blockWidget, sourceButton,
} from './editor/widgets.js';
import { entityReference, markdownHtml } from '../markdown.js';
import { paths as iconPaths } from '../../components/Icon.svelte';
import { coverChange } from './reportParts.js';
import {
  CAPTION_HELP, PICTURE_ALIGNS, PICTURE_SIZES, POSTED_HELP, SOURCE_HELP, blockAlignAt, captionField, pictureLine, picturesIn,
  rovingToolbar, sizeWidth, sizedLine, sourceField,
} from './pictureSize.js';
import {
  MAP_BLOCK, PLAYED_BLOCK, mentionMatches, slashInsert, slashMatches,
} from './syntax.js';

export { noteCase, setNoteCase, templateMode } from './editor/state.js';
export { hintLineAt, noteDecorations, typeOverHints } from './editor/decorations.js';
export { openBlockAt } from './editor/ranges.js';
export { insertInclude, removeInclude } from './editor/includeBlock.js';

// -- the widgets ---------------------------------------------------------------

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

/** A line holding nothing but one picture: `![…](…){…}` or `[[media:…]]{…}`. */
const PICTURE_LINE = /^\s*(?:!\[[^\]]*\]\([^)]*\)(?:\{[^}\n]*\})?|\[\[media:[A-Za-z0-9_-]+\|[^\]\n]+\]\](?:\{[^}\n]*\})?)\s*$/;
// -- the kinds of block, until each has a module of its own in editor/ ----------

/** A picture's bar, pressed: a size, a place, the caption field, its tool or its source. */
function pressPictureBar(target, box, view) {
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
    else view.state.facet(noteHandlers).opener?.(entity)?.open();
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
}

registerBlock({
  name: 'picture',
  // `![…](…)` alone on its line, or `[[media:…]]`, which the parser does not see
  node: 'Image',
  read: (node, { state }) => {
    const line = state.doc.lineAt(node.from);
    return PICTURE_LINE.test(line.text) ? { from: line.from, to: line.to } : null;
  },
  line: (line) => (PICTURE_LINE.test(line.text) && line.text.includes('[[media:') ? { from: line.from, to: line.to } : null),
  widget: (spec) => new BlockWidget('picture', spec.source, spec.info, spec.writable, spec.blockAlign, false, spec.picked),
  atomic: true,
  // the size and place buttons over a picture, which carry its </>, while the note can be written
  tools: (box, widget, view) => {
    if (!widget.writable) return null;
    const bar = sizeBar(box, widget.source, widget.info, view.state.facet(noteHandlers), widget.align);
    bar.append(sourceButton(view, box, 'cm-size-edit'));
    return bar;
  },
  bar: '[data-size-bar]',
  press: pressPictureBar,
  fields: '.picture-caption-field, .picture-source-field',
  // the mouse acts on the press, before focus moves; the keyboard's Enter and Space give a click
  listen: (box, _widget, view) => box.addEventListener('click', (event) => {
    const button = event.target.closest('[data-size-bar] button');
    if (event.detail !== 0 || !button || button.dataset.editSource) return;
    const from = view.state.doc.lineAt(view.posAtDOM(box)).from;
    if (button.dataset.open || button.dataset.source || button.dataset.posted) {
      pressPictureBar(button, box, view);
      return;
    }
    const same = button.dataset.share ? `[data-share="${button.dataset.share}"]`
      : button.dataset.align ? `[data-align="${button.dataset.align}"]` : '[data-caption]';
    pressPictureBar(button, box, view);
    // the picture was drawn again with its new size: the keyboard stays on the button it pressed
    if (box.isConnected) return;
    const again = [...view.contentDOM.querySelectorAll('.cm-block-picture')].find((node) => view.posAtDOM(node) === from);
    again?.querySelector(`[data-size-bar] ${same}`)?.focus({ preventScroll: true });
  }),
});

// `::: steps` and `::: story`, which an HTML page plays, drawn as their steps
for (const name of ['steps', 'story']) {
  registerBlock({
    name,
    fence: PLAYED_BLOCK,
    read: ({ match }) => (match[1] === name ? {} : null),
    widget: blockWidget,
    draw: (box, widget) => drawPlayed(box, widget.kind, widget.source, widget.info),
    atomic: true,
  });
}

registerBlock({
  name: 'map',
  fence: MAP_BLOCK,
  widget: blockWidget,
  draw: (box, widget) => drawMap(box, widget.source, widget.info),
  atomic: true,
});

// -- the two modes ----------------------------------------------------------------

/**
 * The page is drawn, or it is the raw Markdown. Everything that draws or acts on a
 * drawn block lives in one compartment, so switching reconfigures it: the text, the
 * cursor, the history and the case stay where they are.
 */
const drawing = new Compartment();

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
        // a press on a block of a kind that answers presses itself (a chapter's Open and Remove)
        for (const kind of blockKinds()) if (kind.mousedown?.(event, view, handlers)) return true;
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
