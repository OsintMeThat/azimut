/**
 * A block of steps (`::: steps`) or a story (`::: story`), which an HTML page plays:
 * each line holding a picture opens a step, and the lines after it are its words.
 * Drawn small, the steps numbered in order. Open, its two fence lines are greyed.
 *
 * While the note can be written it is a strip of its steps, worked without braces:
 * a step is added from the case's pictures or by dropping one on it, dragged by its
 * number to another place (or moved with its arrows), its words (a story's) or its
 * caption (a step's) written in place, a story's zoom framed by dragging a box on its
 * picture, and a step removed. Each writes the block's own lines (`editor/stepEdits.js`),
 * one change one Undo takes back.
 */
import { MEDIA_DRAG, carriesMedia, droppedMedia } from '../../drag.js';
import { markdownHtml } from '../../markdown.js';
import { HINT_LINE } from '../look.js';
import { captionField, picturesIn, storyZoom } from '../pictureSize.js';
import { PLAYED_BLOCK } from '../syntax.js';
import { registerBlock } from './blocks.js';
import { openCasePicker } from './casePicker.js';
import { drawHints, hintsMarked } from './inline.js';
import { iconSvg } from './icons.js';
import { blocksIn } from './ranges.js';
import { noteCase, resolve, templateMode } from './state.js';
import {
  addSteps, blockSteps, moveStep, removeStep, setStepPicture, setStepWords, stepChange,
} from './stepEdits.js';
import { blockWidget, pickBlock } from './widgets.js';

export { storyZoom };

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

/** What the strip says, on its buttons and in its empty state. */
export const STRIP_HELP = {
  add: 'Add a step',
  addHint: 'or drop a picture here',
  addTitle: 'A picture of the case, as the next step',
  grip: 'Drag to move this step',
  remove: 'Remove this step',
  earlier: 'Move this step earlier',
  later: 'Move this step later',
  words: 'Press to write what this step says',
  noWords: 'Words read beside the picture…',
  caption: 'Press to write this step’s caption',
  noCaption: 'Add a caption…',
  zoom: 'Drag on the picture to frame what this step moves in on',
  unzoom: 'Show the whole picture',
  empty: 'No step yet: each picture you add is one.',
};

/** The smallest share of a picture a framed zoom takes, across and down: a slip of the pointer frames nothing. */
const ZOOM_MIN = 0.03;

function button(className, title, icon, words = '') {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.title = title;
  node.setAttribute('aria-label', title);
  if (icon) node.append(iconSvg(icon));
  if (words) node.append(document.createTextNode(words));
  return node;
}

/** A step's picture: the first one on its line, drawn as the preview draws it. */
function stepFigure(step, index, kind, info, writable) {
  const figure = document.createElement('div');
  figure.className = 'cm-played-figure';
  figure.dataset.step = String(index + 1);
  // trimmed: a line break left after the picture would hold a blank line under it
  figure.innerHTML = markdownHtml(step.picture ?? step.line, info).trim();
  const picture = figure.querySelector('img, video');
  // a story moves in on part of each picture: framed by a drag while the note can be written
  if (picture && kind === 'story' && (step.zoom || writable)) {
    const frame = document.createElement('span');
    frame.className = 'cm-zoom-frame';
    picture.replaceWith(frame);
    frame.append(picture);
    if (writable) {
      frame.dataset.zoomArea = 'true';
      // said on the picture while the pointer is on it
      frame.dataset.hint = STRIP_HELP.zoom;
      // a drag on it frames a zoom, never carries the picture off
      picture.draggable = false;
    }
    if (step.zoom) {
      const zoom = document.createElement('span');
      zoom.className = 'cm-zoom-box';
      zoom.title = 'The part this step moves in on';
      Object.assign(zoom.style, {
        left: `${step.zoom.x * 100}%`, top: `${step.zoom.y * 100}%`, width: `${step.zoom.w * 100}%`, height: `${step.zoom.h * 100}%`,
      });
      frame.append(zoom);
      if (writable) {
        const clear = button('cm-zoom-clear', STRIP_HELP.unzoom, 'x');
        clear.dataset.unzoom = String(index);
        Object.assign(clear.style, { left: `${(step.zoom.x + step.zoom.w) * 100}%`, top: `${step.zoom.y * 100}%` });
        frame.append(clear);
      }
    }
  }
  // a step's caption is written in place under it (`stepText`)
  if (writable && kind === 'steps') figure.querySelector('.markdown-caption')?.remove();
  if (writable) {
    // the step's number is what it is dragged by
    const grip = document.createElement('span');
    grip.className = 'cm-step-grip';
    grip.textContent = String(index + 1);
    grip.title = STRIP_HELP.grip;
    grip.setAttribute('aria-hidden', 'true');
    const tools = document.createElement('span');
    tools.className = 'cm-step-tools';
    tools.dataset.stepTools = 'true';
    const across = kind === 'steps';
    const earlier = button('cm-step-move', STRIP_HELP.earlier, across ? 'chevronLeft' : 'chevronUp');
    earlier.dataset.move = '-1';
    const later = button('cm-step-move', STRIP_HELP.later, across ? 'chevronRight' : 'chevronDown');
    later.dataset.move = '1';
    const remove = button('cm-step-remove', STRIP_HELP.remove, 'x');
    remove.dataset.remove = 'true';
    tools.append(earlier, later, remove);
    figure.append(grip, tools);
  }
  return figure;
}

/** What a step says, pressed to be written: a story's words, a step's caption. */
function stepText(step, kind, info, writable) {
  const out = [];
  if (kind === 'steps' && writable) {
    // a step's caption is what its dot says: written in place, under the picture
    const caption = document.createElement('div');
    caption.className = `cm-step-caption${step.caption ? '' : ' cm-step-empty'}`;
    caption.dataset.stepEdit = 'caption';
    caption.textContent = step.caption || STRIP_HELP.noCaption;
    caption.title = STRIP_HELP.caption;
    out.push(caption);
  }
  if (step.words || (kind === 'story' && writable)) {
    const words = document.createElement('div');
    words.className = `cm-played-words${step.words ? '' : ' cm-step-empty'}`;
    if (step.words) words.innerHTML = markdownHtml(step.words, info);
    else words.textContent = STRIP_HELP.noWords;
    if (kind === 'story' && writable) {
      words.dataset.stepEdit = 'words';
      words.title = STRIP_HELP.words;
    }
    out.push(words);
  }
  return out;
}

/**
 * A block of steps or a story, drawn small the way the HTML page plays it: its steps
 * in order, numbered, each picture with its words; a story's beside it, and the part
 * a step moves in on outlined. The PDF prints them one after the other. While the note
 * can be written, each step carries its tools and the strip ends on Add a step.
 */
function drawPlayed(box, kind, source, info, writable, template = false) {
  const { text, hints } = hintsMarked(source);
  const { steps, lines, lead: [first, end] } = blockSteps(source);
  // a note's guidance is the strip's own empty state while it can be written; a template's is its text
  const own = writable && !template;
  const lead = own ? lines.slice(first, end + 1).filter((line) => !HINT_LINE.test(line)).join('\n').trim() : playedSteps(text).lead;
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
    item.dataset.stepIndex = String(index);
    item.append(stepFigure(step, index, kind, info, writable), ...stepText(step, kind, info, writable));
    list.append(item);
  });
  box.append(list);
  if (writable) {
    if (!steps.length) {
      const empty = document.createElement('p');
      empty.className = 'cm-step-none';
      empty.textContent = STRIP_HELP.empty;
      list.append(empty);
    }
    const add = button('cm-step-add', STRIP_HELP.addTitle, 'plus');
    add.dataset.addStep = 'true';
    const words = document.createElement('span');
    words.className = 'cm-step-add-words';
    const name = document.createElement('b');
    name.textContent = STRIP_HELP.add;
    const hint = document.createElement('small');
    hint.textContent = STRIP_HELP.addHint;
    words.append(name, hint);
    add.append(words);
    if (kind === 'steps') list.append(add);
    else box.append(add);
    const marker = document.createElement('div');
    marker.className = 'cm-step-drop';
    marker.hidden = true;
    list.append(marker);
  }
  if (!own) drawHints(box, hints);
}

// -- the gestures -------------------------------------------------------------------

/** The block drawn in `box` as it reads now, `{ from, to, source }`, or null once it is gone. */
function blockOf(view, box) {
  if (!box.isConnected) return null;
  const from = view.posAtDOM(box);
  const block = blocksIn(view.state, from).find((item) => item.from === from);
  return block ? { ...block, source: view.state.doc.sliceString(block.from, block.to) } : null;
}

/** The block drawn again at `from` after a change, of kind `kind`. */
function drawnAt(view, kind, from) {
  return [...view.contentDOM.querySelectorAll(`.cm-block-${kind}`)].find((node) => view.posAtDOM(node) === from) ?? null;
}

/**
 * Write what `edit(source)` makes of the block drawn in `box`, as one change. The note
 * then has the keyboard, so Ctrl+Z takes it back, unless `focus` names what it goes back
 * to once the block is drawn again, or a field let go wrote it (`refocus` false).
 */
function writeBlock(view, box, edit, { focus = null, refocus = true } = {}) {
  if (view.state.readOnly) return false;
  const block = blockOf(view, box);
  if (!block) return false;
  const change = stepChange(block.from, block.source, edit(block.source));
  if (!change) return false;
  if (refocus) pickBlock(view, box, { focus: !focus });
  view.dispatch({ changes: change, userEvent: 'input' });
  if (focus) drawnAt(view, block.kind, block.from)?.querySelector(focus)?.focus({ preventScroll: true });
  return true;
}

/** The index of the step drawn around `node`, or -1. */
function indexOf(node) {
  return Number(node.closest('[data-step-index]')?.dataset.stepIndex ?? -1);
}

/** Open the field a step's words or caption are written in, in their place. */
function openStepText(view, box, target) {
  const index = indexOf(target);
  const block = blockOf(view, box);
  const step = block ? blockSteps(block.source).steps[index] : null;
  if (!step || view.state.readOnly) return;
  // written from the note, the cursor comes to the block first (`pickBlock`)
  if (view.hasFocus) pickBlock(view, box);
  const shown = target.closest('[data-step-edit]');
  const which = shown.dataset.stepEdit;
  const item = shown.closest('.cm-played-step');
  if (item.querySelector('.cm-step-field, .picture-caption-field')) return;
  let field;
  const done = (by) => {
    shown.hidden = false;
    field.remove();
    if (by === 'keyboard') view.focus();
  };
  if (which === 'caption') {
    field = captionField({
      caption: step.caption,
      write: (caption) => writeBlock(view, box, (source) => setStepPicture(source, index, { caption }), { refocus: false }),
      done,
    });
  } else {
    field = document.createElement('textarea');
    field.className = 'cm-step-field';
    field.value = step.words;
    field.rows = Math.max(2, step.words.split('\n').length);
    field.placeholder = STRIP_HELP.noWords;
    field.title = 'Enter writes them, Shift+Enter starts a line, Escape leaves them as they were';
    field.setAttribute('aria-label', `Words of step ${index + 1}`);
    let over = false;
    const finish = (keep, by) => {
      if (over) return;
      over = true;
      if (keep) writeBlock(view, box, (source) => setStepWords(source, index, field.value), { refocus: false });
      done(by);
    };
    const grow = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + 2}px`;
    };
    field.addEventListener('input', grow);
    field.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        finish(event.key === 'Enter', 'keyboard');
      }
    });
    field.addEventListener('blur', () => finish(true, 'blur'));
    queueMicrotask(grow);
  }
  shown.hidden = true;
  shown.after(field);
  field.focus({ preventScroll: true });
  field.select?.();
}

/** A press on a step's tool, its text, a zoom's clear or Add a step: what it writes, or what it opens. */
function pressStrip(target, box, view, event = null) {
  if (view.state.readOnly) return;
  if (target.closest('.cm-step-grip, [data-zoom-area]') && !target.closest('[data-unzoom]')) return;
  const add = target.closest('[data-add-step]');
  if (add) {
    openCasePicker(view, add, {
      title: STRIP_HELP.add,
      pick: (entity) => writeBlock(view, box, (source) => addSteps(source, [entity], Infinity, { template: view.state.facet(templateMode) })),
    });
    return;
  }
  const edit = target.closest('[data-step-edit]');
  if (edit) {
    const open = box.querySelector('.cm-step-field, .picture-caption-field');
    if (!open) {
      openStepText(view, box, edit);
      return;
    }
    // the field open is written first, which draws the strip again: the one pressed opens in it
    const [index, which, from, kind] = [indexOf(edit), edit.dataset.stepEdit, view.posAtDOM(box), box.dataset.block];
    open.blur();
    const again = box.isConnected ? box : drawnAt(view, kind, from);
    const shown = again?.querySelector(`[data-step-index="${index}"] [data-step-edit="${which}"]`);
    if (shown) openStepText(view, again, shown);
    return;
  }
  const index = indexOf(target);
  if (index < 0) return;
  const move = target.closest('[data-move]');
  if (move) {
    const to = index + Number(move.dataset.move);
    const keys = event?.detail === 0;
    writeBlock(view, box, (source) => moveStep(source, index, to), { focus: keys ? `[data-step-index="${to}"] [data-move="${move.dataset.move}"]` : null });
    return;
  }
  if (target.closest('[data-remove]')) {
    writeBlock(view, box, (source) => removeStep(source, index));
    return;
  }
  if (target.closest('[data-unzoom]')) writeBlock(view, box, (source) => setStepPicture(source, index, { zoom: null }));
}

/** Where a step dragged or dropped at `point` would stand: its place among `items` (the dragged one left out). */
function placeAt(items, point, across) {
  let place = 0;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    const middle = across ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2;
    if ((across ? point.x : point.y) > middle) place += 1;
  }
  return place;
}

/** The line drawn where a step would land: before `items[place]`, or after the last. */
function showDrop(list, items, place, across) {
  const marker = list.querySelector('.cm-step-drop');
  if (!marker) return;
  const frame = list.getBoundingClientRect();
  const before = items[place];
  const after = items[place - 1];
  let at;
  if (before && after) {
    const [a, b] = [after.getBoundingClientRect(), before.getBoundingClientRect()];
    at = across ? (a.right + b.left) / 2 : (a.bottom + b.top) / 2;
  } else if (before) {
    const rect = before.getBoundingClientRect();
    at = (across ? rect.left : rect.top) - 5;
  } else if (after) {
    const rect = after.getBoundingClientRect();
    at = (across ? rect.right : rect.bottom) + 5;
  } else at = across ? frame.left + 4 : frame.top + 4;
  marker.hidden = false;
  marker.classList.toggle('cm-step-drop-across', across);
  if (across) Object.assign(marker.style, { left: `${at - frame.left + list.scrollLeft - 1}px`, top: '0', width: '2px', height: `${frame.height}px` });
  else Object.assign(marker.style, { left: '0', top: `${at - frame.top - 1}px`, width: `${frame.width}px`, height: '2px' });
}

function hideDrop(list) {
  const marker = list?.querySelector('.cm-step-drop');
  if (marker) marker.hidden = true;
}

/**
 * A step dragged by its number: it lifts, a line shows where it lands, and let go it
 * is moved there in one change. Escape leaves it where it was.
 */
function dragStep(event, box, view, kind) {
  const grip = event.target.closest('.cm-step-grip');
  if (!grip || event.button !== 0 || view.state.readOnly) return;
  event.preventDefault();
  event.stopPropagation();
  const item = grip.closest('.cm-played-step');
  const list = item.parentNode;
  const from = indexOf(item);
  const across = kind === 'steps';
  const others = [...list.querySelectorAll(':scope > .cm-played-step')].filter((one) => one !== item);
  const start = { x: event.clientX, y: event.clientY };
  const id = event.pointerId;
  try { grip.setPointerCapture(id); } catch { /* a synthetic press has no pointer to hold */ }
  let dragging = false;
  let place = from;
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== id) return;
    if (!dragging && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 4) return;
    if (!dragging) {
      dragging = true;
      item.classList.add('cm-step-lifted');
      box.classList.add('cm-step-dragging');
    }
    place = placeAt(others, { x: moveEvent.clientX, y: moveEvent.clientY }, across);
    if (place === from) hideDrop(list);
    else showDrop(list, others, place, across);
  };
  const finish = (keep) => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escape, true);
    try { grip.releasePointerCapture(id); } catch { /* already let go */ }
    item.classList.remove('cm-step-lifted');
    box.classList.remove('cm-step-dragging');
    hideDrop(list);
    if (keep && dragging && place !== from) writeBlock(view, box, (source) => moveStep(source, from, place));
  };
  const up = (upEvent) => {
    if (upEvent.pointerId === id) finish(true);
  };
  const cancel = (cancelEvent) => {
    if (cancelEvent.pointerId === id) finish(false);
  };
  const escape = (keyEvent) => {
    if (keyEvent.key !== 'Escape') return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    finish(false);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', escape, true);
}

/**
 * A box dragged on a story's picture: the part its step moves in on, drawn as the
 * pointer goes and written let go (`zoom=x,y,w,h`), one change. A press that frames
 * almost nothing, or Escape, leaves it as it was.
 */
function frameZoom(event, box, view) {
  const area = event.target.closest('[data-zoom-area]');
  if (!area || event.button !== 0 || view.state.readOnly || event.target.closest('[data-unzoom]')) return;
  const picture = area.querySelector('img, video');
  if (!picture) return;
  event.preventDefault();
  event.stopPropagation();
  const index = indexOf(area);
  const rect = picture.getBoundingClientRect();
  const at = (point) => ({
    x: Math.min(1, Math.max(0, (point.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (point.clientY - rect.top) / rect.height)),
  });
  const start = at(event);
  const drawn = document.createElement('span');
  drawn.className = 'cm-zoom-box cm-zoom-drawing';
  area.append(drawn);
  area.classList.add('cm-zooming');
  const id = event.pointerId;
  try { area.setPointerCapture(id); } catch { /* a synthetic press has no pointer to hold */ }
  let zoom = null;
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== id) return;
    const now = at(moveEvent);
    zoom = { x: Math.min(start.x, now.x), y: Math.min(start.y, now.y), w: Math.abs(now.x - start.x), h: Math.abs(now.y - start.y) };
    Object.assign(drawn.style, { left: `${zoom.x * 100}%`, top: `${zoom.y * 100}%`, width: `${zoom.w * 100}%`, height: `${zoom.h * 100}%` });
  };
  const finish = (keep) => {
    area.removeEventListener('pointermove', move);
    area.removeEventListener('pointerup', up);
    area.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escape, true);
    try { area.releasePointerCapture(id); } catch { /* already let go */ }
    area.classList.remove('cm-zooming');
    drawn.remove();
    if (keep && zoom && zoom.w >= ZOOM_MIN && zoom.h >= ZOOM_MIN) writeBlock(view, box, (source) => setStepPicture(source, index, { zoom }));
  };
  const up = (upEvent) => {
    if (upEvent.pointerId === id) finish(true);
  };
  const cancel = (cancelEvent) => {
    if (cancelEvent.pointerId === id) finish(false);
  };
  const escape = (keyEvent) => {
    if (keyEvent.key !== 'Escape') return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    finish(false);
  };
  area.addEventListener('pointermove', move);
  area.addEventListener('pointerup', up);
  area.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', escape, true);
}

/** Whether a drag carries case pictures the strip takes: from the Media library, or records from the case's lists. */
function carriesPictures(event) {
  const types = [...(event.dataTransfer?.types ?? [])];
  return carriesMedia(event) || (types.includes('text/plain') && !types.includes('text/html') && !types.includes('Files'));
}

/** The case pictures a drop carries: Media library files by their path, or records by their ids. */
export function droppedPictures(event, info) {
  const pictures = (entity) => entity && ['media', 'capture', 'proof'].includes(entity.type) && entity.attrs?.path && entity.attrs?.kind !== 'video';
  if ([...(event.dataTransfer?.types ?? [])].includes(MEDIA_DRAG)) {
    const byPath = new Map(info.entities.filter((entity) => entity.attrs?.path).map((entity) => [entity.attrs.path, entity]));
    return droppedMedia(event).map((item) => byPath.get(item.attrs.path)).filter(pictures);
  }
  const ids = String(event.dataTransfer?.getData('text/plain') ?? '').split(/[\s,]+/).filter(Boolean);
  if (!ids.length || ids.length > 50) return [];
  const found = ids.map((id) => (/^[A-Za-z0-9_-]+$/.test(id) ? resolve(info, id) : null));
  return found.every(pictures) ? found : [];
}

/** Pictures dragged over the strip: a line shows where they land as steps, and let go they are added there. */
function listenDrops(box, view, kind) {
  const across = kind === 'steps';
  const items = () => [...box.querySelectorAll('.cm-played-list > .cm-played-step')];
  box.addEventListener('dragover', (event) => {
    if (view.state.readOnly || !carriesPictures(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    box.classList.add('cm-step-dropping');
    showDrop(box.querySelector('.cm-played-list'), items(), placeAt(items(), { x: event.clientX, y: event.clientY }, across), across);
  });
  box.addEventListener('dragleave', (event) => {
    if (box.contains(event.relatedTarget)) return;
    box.classList.remove('cm-step-dropping');
    hideDrop(box.querySelector('.cm-played-list'));
  });
  box.addEventListener('drop', (event) => {
    box.classList.remove('cm-step-dropping');
    hideDrop(box.querySelector('.cm-played-list'));
    if (view.state.readOnly || !carriesPictures(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const found = droppedPictures(event, view.state.field(noteCase));
    if (!found.length) return;
    const place = placeAt(items(), { x: event.clientX, y: event.clientY }, across);
    writeBlock(view, box, (source) => addSteps(source, found, place, { template: view.state.facet(templateMode) }));
  });
}

/** How the strip looks, in the app's dark and light themes. */
const STRIP_THEME = {
  '.cm-played-figure:has(> .cm-step-grip)::before': { content: 'none' },
  '.cm-step-grip': {
    position: 'absolute', top: '6px', left: '6px', zIndex: '2', minWidth: '20px', height: '20px', borderRadius: '10px', padding: '0 5px',
    boxSizing: 'border-box', background: 'var(--accent)', color: '#fff', fontSize: '11px', fontWeight: '650', lineHeight: '20px',
    textAlign: 'center', cursor: 'grab', touchAction: 'none', boxShadow: '0 1px 3px rgba(0, 0, 0, .35)',
  },
  '.cm-step-grip:hover': { boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent)' },
  '.cm-step-tools': {
    position: 'absolute', top: '6px', right: '6px', zIndex: '2', display: 'flex', gap: '1px', padding: '2px', borderRadius: '6px',
    background: 'var(--bg-1)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-2)', opacity: '0',
    transition: 'opacity .12s',
  },
  '.cm-played-step:hover .cm-step-tools, .cm-step-tools:focus-within': { opacity: '1' },
  '.cm-step-tools button': {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', padding: '0', border: 'none',
    borderRadius: '4px', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer',
  },
  '.cm-step-tools button:hover': { background: 'var(--bg-3)', color: 'var(--text-1)' },
  '.cm-step-tools button.cm-step-remove:hover': { color: 'var(--danger)' },
  '.cm-played-step:first-child [data-move="-1"], .cm-played-step:nth-last-child(1 of .cm-played-step) [data-move="1"]': { display: 'none' },
  '.cm-step-tools button:focus-visible, .cm-step-add:focus-visible, .cm-zoom-clear:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-played-step': { position: 'relative' },
  '.cm-step-lifted': { opacity: '.35' },
  '.cm-step-dragging, .cm-step-dragging *': { cursor: 'grabbing !important' },
  '.cm-played-list': { position: 'relative' },
  '.cm-step-drop': { position: 'absolute', zIndex: '3', borderRadius: '1px', background: 'var(--accent)', pointerEvents: 'none' },
  '.cm-step-drop[hidden]': { display: 'none' },
  '.cm-step-dropping': { boxShadow: 'inset 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent) !important' },
  '.cm-step-caption, .cm-played-words[data-step-edit]': { cursor: 'text', borderRadius: '4px', padding: '2px 4px', margin: '2px -4px 0' },
  '.cm-step-caption': { color: 'var(--text-2)', fontFamily: 'var(--font-sans)', fontSize: '0.84em', lineHeight: '1.4', marginTop: '4px' },
  '.cm-step-caption:hover, .cm-played-words[data-step-edit]:hover': { background: 'color-mix(in srgb, var(--text-1) 6%, transparent)' },
  '.cm-step-empty': { color: 'var(--text-3)', fontStyle: 'italic' },
  '.cm-step-caption[hidden], .cm-played-words[hidden]': { display: 'none' },
  '.cm-step-field': {
    display: 'block', boxSizing: 'border-box', width: '100%', margin: '0', padding: '4px 8px', border: '1px solid var(--accent)',
    borderRadius: '4px', background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', fontSize: '0.94em', lineHeight: '1.5',
    outline: 'none', resize: 'none', overflow: 'hidden',
  },
  '.cm-played-steps .picture-caption-field': { marginTop: '4px' },
  '.cm-step-none': { margin: '0', color: 'var(--text-3)', fontSize: '0.88em', alignSelf: 'center' },
  '.cm-played-steps .cm-step-none': { flex: '1 1 auto', maxWidth: '360px' },
  '.cm-step-add': {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxSizing: 'border-box', padding: '10px 14px',
    border: '1px dashed var(--border-strong)', borderRadius: '6px', background: 'transparent', color: 'var(--text-2)', font: 'inherit',
    fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'left', transition: 'border-color .12s, color .12s, background-color .12s',
  },
  '.cm-step-add:hover, .cm-step-dropping .cm-step-add': {
    borderColor: 'var(--accent)', color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
  },
  '.cm-step-add svg': { flex: 'none', width: '16px', height: '16px' },
  '.cm-step-add-words': { display: 'flex', flexDirection: 'column', gap: '1px' },
  '.cm-step-add-words b': { fontWeight: '600', fontSize: '0.86em' },
  '.cm-step-add-words small': { color: 'var(--text-3)', fontSize: '0.74em' },
  '.cm-played-steps > .cm-step-add': { flex: '0 0 min(160px, 40%)', flexDirection: 'column', minHeight: '96px', textAlign: 'center' },
  '.cm-played-steps > .cm-step-add .cm-step-add-words': { alignItems: 'center' },
  '.cm-block-story > .cm-step-add': { width: '100%', marginTop: '10px' },
  '[data-zoom-area]': { cursor: 'crosshair', touchAction: 'none', userSelect: 'none' },
  '[data-zoom-area]::after': {
    content: 'attr(data-hint)', position: 'absolute', left: '8px', right: '8px', bottom: '8px', padding: '4px 8px', borderRadius: '4px',
    background: 'rgba(12, 13, 15, .8)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: '11px', lineHeight: '1.3',
    textAlign: 'center', pointerEvents: 'none', opacity: '0', transition: 'opacity .12s',
  },
  '[data-zoom-area]:hover::after': { opacity: '1' },
  '.cm-zooming::after, .cm-zooming .cm-zoom-box:not(.cm-zoom-drawing), .cm-zooming .cm-zoom-clear': { opacity: '0 !important' },
  '.cm-zoom-box.cm-zoom-drawing': {
    border: '2px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)', outline: '1px solid rgba(0, 0, 0, .45)',
  },
  '.cm-zoom-clear': {
    position: 'absolute', zIndex: '2', transform: 'translate(-60%, -40%)', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', width: '20px', height: '20px', padding: '0', border: 'none', borderRadius: '50%', background: 'rgba(12, 13, 15, .85)',
    color: '#fff', cursor: 'pointer', opacity: '0', transition: 'opacity .12s',
  },
  '.cm-played-step:hover .cm-zoom-clear, .cm-zoom-clear:focus-visible': { opacity: '1' },
};

// `::: steps` and `::: story`, which an HTML page plays, drawn as their steps
for (const name of ['steps', 'story']) {
  registerBlock({
    name,
    fence: PLAYED_BLOCK,
    read: ({ match }) => (match[1] === name ? {} : null),
    widget: blockWidget,
    draw: (box, widget, view) => drawPlayed(box, widget.kind, widget.source, widget.info, widget.writable, view.state.facet(templateMode)),
    atomic: true,
    // a step's tools, its number, its words and a story's picture answer a press themselves rather than picking the block
    bar: '.cm-step-tools, .cm-step-grip, .cm-step-add, [data-step-edit], [data-zoom-area], [data-unzoom]',
    press: pressStrip,
    fields: '.cm-step-field, .picture-caption-field',
    listen: (box, widget, view) => {
      if (!widget.writable) return;
      box.addEventListener('pointerdown', (event) => {
        dragStep(event, box, view, widget.kind);
        if (!event.defaultPrevented) frameZoom(event, box, view);
      });
      // the keyboard's Enter and Space give a click with no press before it
      box.addEventListener('click', (event) => {
        const target = event.target.closest('button, [data-step-edit]');
        if (event.detail === 0 && target) pressStrip(target, box, view, event);
      });
      listenDrops(box, view, widget.kind);
    },
    // the strip's look, given to the editor once
    theme: name === 'steps' ? STRIP_THEME : undefined,
  });
}
