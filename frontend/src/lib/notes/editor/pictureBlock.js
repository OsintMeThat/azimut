/**
 * A picture alone on its line, `![…](…)` or a case picture `[[media:…]]`, drawn with
 * its bar while the note can be written: the sizes and places the PDF prints it at
 * (a size shows on the picture while the pointer is on it, and a corner dragged snaps
 * to the sizes), its caption (pressed, it is written in place), whether it is graphic,
 * another picture in its place, the tool it was made in, and a source or a posted
 * address to state. Each writes its braces, `{width=… align=… caption="…" graphic}`, in
 * one change one Undo takes back. Open, its line is shown as written.
 */
import {
  CAPTION_HELP, GRAPHIC_HELP, PICTURE_ALIGNS, PICTURE_SIZES, POSTED_HELP, SOURCE_HELP, blockAlignAt, captionField, isGraphic,
  nearestSize, pictureLine, picturesIn, postedAddress, replacedLine, rovingToolbar, sizeWidth, sizedLine, sourceField,
} from '../pictureSize.js';
import { registerBlock } from './blocks.js';
import { openCasePicker, pickerTheme } from './casePicker.js';
import { iconSvg } from './icon.js';
import { noteCase, noteHandlers, resolve } from './state.js';
import { BlockWidget, drawMarkdown, pickBlock, sourceButton } from './widgets.js';

const ALIGN_LABELS = { left: ['alignLeft', 'Left'], center: ['alignCentreH', 'Centre'], right: ['alignRight', 'Right'] };

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
  const graphic = document.createElement('button');
  graphic.type = 'button';
  graphic.className = 'cm-size-graphic';
  graphic.dataset.graphic = 'true';
  graphic.title = GRAPHIC_HELP.button;
  graphic.setAttribute('aria-pressed', String(isGraphic(picture.rest)));
  graphic.append(iconSvg('eyeOff'), document.createTextNode(GRAPHIC_HELP.label));
  const replace = document.createElement('button');
  replace.type = 'button';
  replace.className = 'cm-size-replace';
  replace.dataset.replace = 'true';
  replace.title = 'Replace: another picture of the case in its place, its size and caption kept';
  replace.setAttribute('aria-label', 'Replace…');
  replace.append(iconSvg('swap'));
  bar.append(caption, graphic, replace);
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
    const kept = postedAddress(entity);
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
    value: postedAddress(entity),
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
function openSourceField(view, box, entity) {
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
export function openCaption(view, box, returnTo = null) {
  if (box.querySelector('.picture-caption-field')) return;
  // written from the note, the cursor comes to the picture first (`pickBlock`)
  if (view.hasFocus) pickBlock(view, box);
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

/** A line holding nothing but one picture: `![…](…){…}` or `[[media:…]]{…}`. */
export const PICTURE_LINE = /^\s*(?:!\[[^\]]*\]\([^)]*\)(?:\{[^}\n]*\})?|\[\[media:[A-Za-z0-9_-]+\|[^\]\n]+\]\](?:\{[^}\n]*\})?)\s*$/;

/** Show another picture of the case in place of the one drawn in `box`, its braces kept. */
function replacePicture(view, box, entity) {
  if (view.state.readOnly || !box.isConnected) return false;
  const line = view.state.doc.lineAt(view.posAtDOM(box));
  const [picture] = picturesIn(line.text);
  const text = picture ? replacedLine(line.text, picture.ref, entity) : null;
  if (text === null || text === line.text) return false;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, userEvent: 'input' });
  return true;
}

/** A picture's bar, pressed: a size, a place, the caption field, its veil, another picture, its tool or its source. */
function pressPictureBar(target, box, view) {
  if (target.closest('[data-caption], [data-caption-edit]')) {
    if (!view.state.readOnly) openCaption(view, box);
    return;
  }
  if (target.closest('.cm-picture-corner')) return;
  if (target.closest('[data-replace]')) {
    const button = target.closest('[data-replace]');
    openCasePicker(view, button, {
      title: 'Replace the picture',
      pick: (entity) => {
        pickBlock(view, box, { focus: true });
        replacePicture(view, box, entity);
      },
    });
    return;
  }
  if (target.closest('[data-graphic]')) {
    const line = view.state.doc.lineAt(view.posAtDOM(box));
    const [picture] = picturesIn(line.text);
    if (!picture) return;
    pickBlock(view, box, { focus: true });
    resizePicture(view, line.number - 1, picture.ref, { graphic: !isGraphic(picture.rest) });
    return;
  }
  if (target.closest('[data-open], [data-source], [data-posted]')) {
    const [shown] = picturesIn(view.state.doc.lineAt(view.posAtDOM(box)).text);
    const entity = pictureEntity(view.state.field(noteCase), shown);
    if (!entity) return;
    if (target.closest('[data-source]')) openSourceField(view, box, entity);
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
  pickBlock(view, box, { focus: true });
  resizePicture(view, line.number - 1, picture.ref, change);
}

// -- the picture drawn: its frame, its veil and its corner -----------------------------

/**
 * The picture's frame: it takes the width and the place the line writes, and the picture
 * fills it, so a corner, a veil and a size shown while the pointer is on its button sit
 * on the picture itself. Null when nothing is drawn (a record no longer in the case).
 */
function framePicture(box) {
  const media = box.querySelector('img, video');
  if (!media) return null;
  const frame = document.createElement('span');
  frame.className = 'cm-picture-frame';
  for (const name of ['align-left', 'align-center', 'align-right']) if (media.classList.contains(name)) frame.classList.add(name);
  // a picture whose line writes no place takes its block's, as the PDF prints it
  if (media.hasAttribute('data-unaligned')) frame.dataset.unaligned = 'true';
  if (media.style.width) {
    frame.style.width = media.style.width;
    media.style.width = '100%';
  }
  media.replaceWith(frame);
  frame.append(media);
  return frame;
}

/** A graphic picture is drawn blurred, saying so, as the web page shows it until pressed; the pointer on it blurs it less. */
function veil(frame) {
  frame.classList.add('cm-veiled');
  const said = document.createElement('span');
  said.className = 'cm-veil-said';
  said.setAttribute('aria-hidden', 'true');
  const name = document.createElement('b');
  name.textContent = GRAPHIC_HELP.veil;
  const how = document.createElement('span');
  how.textContent = GRAPHIC_HELP.said;
  said.append(name, how);
  frame.append(said);
}

/** The side of the picture its corner is dragged from: the one away from where it stands. */
function cornerSide(frame) {
  return frame.classList.contains('align-right') || (frame.dataset.unaligned && frame.closest('.cm-in-align-right')) ? 'left' : 'right';
}

function drawPicture(box, widget) {
  drawMarkdown(box, widget);
  const frame = framePicture(box);
  if (!frame) return;
  const [picture] = picturesIn(widget.source);
  if (picture && isGraphic(picture.rest)) veil(frame);
  if (!widget.writable || !picture) return;
  const caption = box.querySelector('.markdown-caption');
  if (caption) {
    caption.dataset.captionEdit = 'true';
    caption.title = 'Press to write the caption';
  }
  const corner = document.createElement('span');
  corner.className = 'cm-picture-corner';
  corner.dataset.side = cornerSide(frame);
  corner.title = 'Drag to resize: it snaps to XXS, XS, S, M, L and Full';
  corner.setAttribute('aria-hidden', 'true');
  frame.append(corner);
}

/** The width of the page a picture's share is of: its box, inside its gutters. */
function pageWidth(box) {
  const style = getComputedStyle(box);
  return box.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

/** The size a frame shows while the pointer is on a size's button, or a corner is dragged: `[XXS · 10%]` by it. */
function showSize(frame, size, width) {
  let tag = frame.querySelector('.cm-picture-size');
  if (!tag) {
    tag = document.createElement('span');
    tag.className = 'cm-picture-size';
    frame.append(tag);
  }
  tag.textContent = `${size.label} · ${width}`;
}

/**
 * Show `width` on the picture drawn in `box` for as long as the pointer is on a size's
 * button: nothing is written. Answers the undoing.
 */
function previewSize(box, button) {
  const frame = box.querySelector('.cm-picture-frame');
  const media = frame?.querySelector('img, video');
  if (!frame || !media) return () => {};
  const was = { frame: frame.style.width, media: media.style.width };
  const size = PICTURE_SIZES.find((one) => String(one.share) === button.dataset.share);
  const width = sizeWidth(Number(button.dataset.share), pictureRatio(box));
  frame.style.width = width;
  media.style.width = '100%';
  frame.classList.add('cm-sizing');
  showSize(frame, size, width);
  return () => {
    frame.style.width = was.frame;
    media.style.width = was.media;
    frame.classList.remove('cm-sizing');
    frame.querySelector('.cm-picture-size')?.remove();
  };
}

/**
 * A picture's corner dragged: its width follows the pointer and snaps to the nearest
 * size, said on it; let go, that size is written, one change. Escape leaves it as it was.
 */
function dragCorner(event, box, view) {
  const corner = event.target.closest('.cm-picture-corner');
  const frame = corner?.closest('.cm-picture-frame');
  const media = frame?.querySelector('img, video');
  if (!frame || !media || event.button !== 0 || view.state.readOnly) return;
  event.preventDefault();
  event.stopPropagation();
  const id = event.pointerId;
  try { corner.setPointerCapture(id); } catch { /* a synthetic press has no pointer to hold */ }
  const was = { frame: frame.style.width, media: media.style.width };
  const ratio = pictureRatio(box);
  const room = pageWidth(box);
  const start = frame.getBoundingClientRect();
  const side = corner.dataset.side;
  const centred = frame.classList.contains('align-center') || (frame.dataset.unaligned && frame.closest('.cm-in-align-center'));
  let chosen = null;
  frame.classList.add('cm-sizing');
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== id) return;
    const across = centred ? 2 * Math.abs(moveEvent.clientX - (start.left + start.right) / 2)
      : side === 'left' ? start.right - moveEvent.clientX : moveEvent.clientX - start.left;
    chosen = nearestSize(Math.max(0, across) / room, ratio);
    frame.style.width = chosen.width;
    media.style.width = '100%';
    showSize(frame, chosen.size, chosen.width);
  };
  const finish = (keep) => {
    corner.removeEventListener('pointermove', move);
    corner.removeEventListener('pointerup', up);
    corner.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escape, true);
    try { corner.releasePointerCapture(id); } catch { /* already let go */ }
    frame.classList.remove('cm-sizing');
    frame.querySelector('.cm-picture-size')?.remove();
    frame.style.width = was.frame;
    media.style.width = was.media;
    if (!keep || !chosen) return;
    const line = view.state.doc.lineAt(view.posAtDOM(box));
    const [picture] = picturesIn(line.text);
    if (!picture) return;
    pickBlock(view, box, { focus: true });
    resizePicture(view, line.number - 1, picture.ref, { width: chosen.width });
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
  corner.addEventListener('pointermove', move);
  corner.addEventListener('pointerup', up);
  corner.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', escape, true);
}

/** The keys a picture's bar answers once pressed: the mouse acts on the press, the keyboard's Enter and Space give a click. */
function clickPictureBar(event, box, view) {
  const button = event.target.closest('[data-size-bar] button');
  if (event.detail !== 0 || !button || button.dataset.editSource) return;
  const from = view.state.doc.lineAt(view.posAtDOM(box)).from;
  if (button.dataset.open || button.dataset.source || button.dataset.posted || button.dataset.replace) {
    pressPictureBar(button, box, view);
    return;
  }
  const same = button.dataset.share ? `[data-share="${button.dataset.share}"]`
    : button.dataset.align ? `[data-align="${button.dataset.align}"]`
      : button.dataset.graphic ? '[data-graphic]' : '[data-caption]';
  pressPictureBar(button, box, view);
  // the picture was drawn again with its new size: the keyboard stays on the button it pressed
  if (box.isConnected) return;
  const again = [...view.contentDOM.querySelectorAll('.cm-block-picture')].find((node) => view.posAtDOM(node) === from);
  again?.querySelector(`[data-size-bar] ${same}`)?.focus({ preventScroll: true });
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
  draw: drawPicture,
  // the size and place buttons over a picture, which carry its </>, while the note can be written
  tools: (box, widget, view) => {
    if (!widget.writable) return null;
    const bar = sizeBar(box, widget.source, widget.info, view.state.facet(noteHandlers), widget.align);
    bar.append(sourceButton(view, box, 'cm-size-edit'));
    return bar;
  },
  // the bar, the corner and the caption answer a press themselves rather than picking the picture
  bar: '[data-size-bar], .cm-picture-corner, [data-caption-edit]',
  press: pressPictureBar,
  fields: '.picture-caption-field, .picture-source-field',
  listen: (box, widget, view) => {
    box.addEventListener('click', (event) => clickPictureBar(event, box, view));
    if (!widget.writable) return;
    box.addEventListener('pointerdown', (event) => dragCorner(event, box, view));
    // a size shows on the picture while the pointer is on its button
    let undo = null;
    box.addEventListener('pointerover', (event) => {
      const button = event.target.closest?.('[data-share]');
      if (!button || undo) return;
      undo = previewSize(box, button);
      const leave = (leaveEvent) => {
        if (button.contains(leaveEvent.relatedTarget)) return;
        button.removeEventListener('pointerout', leave);
        undo?.();
        undo = null;
      };
      button.addEventListener('pointerout', leave);
    });
  },
  theme: {
    ...pickerTheme,
    '.cm-picture-frame': { position: 'relative', display: 'block', width: 'fit-content', maxWidth: '100%', borderRadius: '4px' },
    '.cm-picture-frame.align-center': { marginLeft: 'auto', marginRight: 'auto' },
    '.cm-picture-frame.align-right': { marginLeft: 'auto' },
    '.cm-picture-frame > img, .cm-picture-frame > video': { marginLeft: '0', marginRight: '0' },
    // a veil, not a redaction: blurred inside its own edges, less while the pointer is on it, and always saying so
    '.cm-veiled > img, .cm-veiled > video': {
      filter: 'blur(18px) saturate(.5)', clipPath: 'inset(0 round 4px)', transition: 'filter .18s ease-out',
    },
    '.cm-block-picture:hover .cm-veiled > img, .cm-block-picture:hover .cm-veiled > video': { filter: 'blur(7px) saturate(.7)' },
    '.cm-veil-said': {
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: '2px', maxWidth: 'calc(100% - 24px)', padding: '8px 14px', borderRadius: '999px', boxSizing: 'border-box',
      background: 'rgba(12, 13, 15, .8)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: '12px', lineHeight: '1.25',
      textAlign: 'center', pointerEvents: 'none', transition: 'opacity .18s ease-out',
    },
    '.cm-veil-said b': { fontWeight: '650', fontSize: '13px' },
    '.cm-veil-said span': { color: 'rgba(255, 255, 255, .78)' },
    '.cm-size-bar button.cm-size-graphic': { gap: '4px', padding: '0 8px 0 6px' },
    '.cm-size-bar button.cm-size-replace': { minWidth: '26px', padding: '0' },
    // dragged from its corner, a picture snaps to the sizes, the one it takes said on it
    '.cm-picture-corner': {
      position: 'absolute', bottom: '-5px', width: '14px', height: '14px', boxSizing: 'border-box', borderRadius: '3px',
      background: 'var(--bg-1)', border: '2px solid var(--accent)', boxShadow: 'var(--shadow-1)', opacity: '0', touchAction: 'none',
      transition: 'opacity .12s',
    },
    '.cm-picture-corner[data-side="right"]': { right: '-5px', cursor: 'nwse-resize' },
    '.cm-picture-corner[data-side="left"]': { left: '-5px', cursor: 'nesw-resize' },
    '.cm-block-picture:hover .cm-picture-corner, .cm-picked .cm-picture-corner, .cm-sizing .cm-picture-corner': { opacity: '1' },
    '.cm-sizing': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
    '.cm-picture-size': {
      position: 'absolute', right: '8px', bottom: '8px', padding: '3px 8px', borderRadius: '4px', background: 'rgba(12, 13, 15, .82)',
      color: '#fff', fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: '650', lineHeight: '1.2', pointerEvents: 'none',
      whiteSpace: 'nowrap',
    },
    '.cm-picture-corner[data-side="left"] ~ .cm-picture-size': { right: 'auto', left: '8px' },
    '.cm-block .markdown-caption[data-caption-edit]': { cursor: 'text', borderRadius: '3px' },
    '.cm-block .markdown-caption[data-caption-edit]:hover': { background: 'var(--bg-2)', boxShadow: '0 0 0 3px var(--bg-2)' },
  },
});

/**
 * Give the picture `ref` a new size, place, caption or veil (`{ width }`, `{ align }`,
 * `{ caption }`, `{ graphic }`), on the line (0-based) the server placed it from or the
 * nearest one holding it. False when the note no longer holds it, or already says that.
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
