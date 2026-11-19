/**
 * The drawn block every kind shares: a box the kind fills, outlined while it is
 * picked, with its `</>` button. A press picks it, a double press, Enter or the
 * button opens it (`openBlockAt`), and its source closes again once the cursor
 * leaves. What a kind adds (a bar, inputs, more listeners) it says in its
 * registration (`editor/blocks.js`).
 */
import { WidgetType } from '@codemirror/view';

import { markdownHtml } from '../../markdown.js';
import { NO_IDENTITY } from '../reportParts.js';
import { blockKind } from './blocks.js';
import { heldHeight, holdHeight, moveHeight, releaseHeight } from './heights.js';
import { drawHints, drawPlaceholders, hintsMarked } from './inline.js';
import { openBlockAt } from './ranges.js';
import { resolve } from './state.js';

/** A block that is picked wears an outline; the class is all a widget changes when it is, so it is not drawn again. */
export function markPicked(dom, picked) {
  dom.classList.toggle('cm-picked', Boolean(picked));
}

/**
 * The `</>` button a drawn block wears, which opens its source. `node` is the
 * block's own element. The press acts at once, as the rest of the block does; the
 * keyboard's Enter and Space give a click without one.
 */
export function sourceButton(view, node, className = 'cm-source-edit') {
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

/**
 * Pick the block drawn in `box`, the cursor at its start, before a field opens in it or a
 * gesture writes it: the editor keeps the cursor's line drawn, so a cursor left far off
 * would have the page drawn again, the field with it, once the note lets go of the
 * keyboard. `focus` gives the note the keyboard, so Ctrl+Z reaches what is written; picked
 * first, the Undo puts the cursor back here rather than far off.
 */
export function pickBlock(view, box, { focus = false } = {}) {
  if (!box.isConnected) return;
  const from = view.posAtDOM(box);
  const range = view.state.selection.main;
  if (!range.empty || range.head !== from) view.dispatch({ selection: { anchor: from } });
  if (focus) view.focus();
}

/** What a small drawn rule does with the mouse: a press picks it, a double press or its </> button opens its line. */
export function blockMouse(view, box, picked) {
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

/** Whether two identities draw the same: a block holding `{name}` or a logo is drawn again when they differ. */
function sameIdentity(a = NO_IDENTITY, b = NO_IDENTITY) {
  return Object.keys(NO_IDENTITY).every((key) => a?.[key] === b?.[key]);
}

/** A block's Markdown, drawn as the preview reads it, with its guidance and the words the PDF fills in. */
export function drawMarkdown(box, widget) {
  const { text, hints } = hintsMarked(widget.source);
  box.innerHTML = markdownHtml(text, widget.info);
  drawHints(box, hints);
  drawPlaceholders(box, widget.info.identity);
}

/**
 * A drawn block (a picture, a table, a diagram): pressing it picks it, and a double
 * press, Enter or its </> button opens its source.
 */
export class BlockWidget extends WidgetType {
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

  /** The kind of block this draws, as `editor/blocks.js` names it. */
  get blockKind() {
    return this.kind;
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
    moveHeight(dom, this);
    return true;
  }

  /** What its drawn height is kept by: what `same` compares (`holdHeight`). */
  heightKey() {
    this.heldKey ??= JSON.stringify([this.kind, this.source, this.info.caseId ?? '', this.writable, this.align, this.pinned,
      Object.keys(NO_IDENTITY).map((key) => this.info.identity?.[key] ?? null), this.caseKey()]);
    return this.heldKey;
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
    const kind = blockKind(this.kind);
    const box = document.createElement('div');
    box.className = `cm-block cm-block-${this.kind}${this.align ? ` cm-in-align-${this.align}` : ''}`;
    box.dataset.block = this.kind;
    box.title = 'Double-click to edit the source';
    markPicked(box, this.picked);
    (kind?.draw ?? drawMarkdown)(box, this, view);
    // a kind with a bar of its own puts the </> in it
    box.append(kind?.tools?.(box, this, view) ?? sourceButton(view, box));
    // a link, a clip and a chip act as themselves; the inputs a block holds are the browser's
    const own = ['a, video, [data-entity-id]', kind?.fields].filter(Boolean).join(', ');
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest(own)) return;
      event.preventDefault();
      if (kind?.bar && event.target.closest(kind.bar)) {
        kind.press?.(event.target, box, view);
        return;
      }
      // a press picks the block, which stays drawn: its source opens on a double press, Enter or </>
      const at = view.posAtDOM(box);
      view.dispatch({ selection: { anchor: at } });
      view.focus();
    });
    box.addEventListener('dblclick', (event) => {
      if (event.target.closest([own, kind?.bar].filter(Boolean).join(', '))) return;
      event.preventDefault();
      openBlockAt(view, box);
    });
    kind?.listen?.(box, this, view);
    holdHeight(box, this);
    return box;
  }

  destroy(dom) {
    releaseHeight(dom);
  }

  ignoreEvent(event) {
    // the inputs a block holds (a picture's caption and source fields) are the browser's: the editor leaves their keys and presses alone
    const fields = blockKind(this.kind)?.fields;
    return event.type !== 'mousedown' || Boolean(fields && event.target?.closest?.(fields));
  }

  /** The height it was last drawn at, else its kind's estimate. */
  get estimatedHeight() {
    return heldHeight(this) ?? blockKind(this.kind)?.height ?? 160;
  }
}

/** The widget most kinds are drawn with: the shared block, filled by the kind's `draw`. */
export function blockWidget(spec) {
  return new BlockWidget(spec.kind, spec.source, spec.info, spec.writable, '', spec.pinned, spec.picked);
}
