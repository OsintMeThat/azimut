/**
 * A picture alone on its line, `![…](…)` or a case picture `[[media:…]]`, drawn with
 * its bar while the note can be written: the sizes and places the PDF prints it at,
 * its caption, the tool it was made in, and a source or a posted address to state.
 * Open, its line is shown as written.
 */
import {
  CAPTION_HELP, PICTURE_ALIGNS, PICTURE_SIZES, POSTED_HELP, SOURCE_HELP, blockAlignAt, captionField, pictureLine, picturesIn,
  rovingToolbar, sizeWidth, sizedLine, sourceField,
} from '../pictureSize.js';
import { registerBlock } from './blocks.js';
import { iconSvg } from './icon.js';
import { noteCase, noteHandlers, resolve } from './state.js';
import { BlockWidget, sourceButton } from './widgets.js';

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
