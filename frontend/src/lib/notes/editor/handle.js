/**
 * The block handle: a small ⋮⋮ in the left margin of the block under the pointer, or
 * of the cursor's block (on a touch screen, only that one). Dragging it moves the
 * block, a line showing where it lands; a press opens its menu (`editor/blockMenu.js`),
 * as Ctrl+/ does at the cursor; Alt+↑ and Alt+↓ move the cursor's block. Every move is
 * one transaction (`editor/turnInto.js`), which one Undo takes back to the byte.
 *
 * The handle sits in the margin the page keeps left of its words, never over them,
 * and only on the drawn page: the raw Markdown has none.
 */
import { Prec } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';

import { paths as iconPaths } from '../../../components/Icon.svelte';
import { blockName, openBlockMenu } from './blockMenu.js';
import { blockRanges } from './ranges.js';
import { focused } from './state.js';
import { moveBlock, moveBy } from './turnInto.js';

/** How far a press may travel before it is a drag rather than a press. */
const DRAG_START = 4;
/** The handle's size, and the room it keeps from the words. */
export const HANDLE = { width: 18, height: 24, gap: 4 };

/**
 * Where the handle goes beside a block, in the scroller's coordinates: right of the
 * page's left edge and left of the block's words by `HANDLE.gap`, centred on its first
 * line. Narrower when the margin is narrow (the panel beside the tools), so it never
 * covers a word; null when there is no room for it at all.
 */
export function handlePlace({ pageLeft, wordsLeft, lineTop, lineHeight }) {
  const right = wordsLeft - HANDLE.gap;
  const width = Math.min(HANDLE.width, right - pageLeft);
  if (width < 10) return null;
  const height = Math.min(HANDLE.height, Math.max(18, lineHeight));
  return { left: right - width, top: lineTop + (lineHeight - height) / 2, width, height };
}

/** The element of the page a position is in: its line, or the drawn block standing for its lines. */
function topElement(view, pos) {
  const { node, offset } = view.domAtPos(pos);
  let element = node === view.contentDOM ? node.childNodes[offset] ?? node.childNodes[offset - 1] : node;
  while (element && element.parentNode !== view.contentDOM) element = element.parentNode;
  return element?.nodeType === 1 ? element : null;
}

/** The room the page keeps left of its words: a line's left padding. */
function gutterOf(view) {
  const line = view.contentDOM.querySelector(':scope > .cm-line');
  return line ? parseFloat(getComputedStyle(line).paddingLeft) || 0 : 32;
}

/**
 * The row of the page (a line, or a drawn block) at a height on screen: the one under
 * it, or in a gap between two the one above. Read off the page the pointer is over.
 */
function rowAt(view, clientY) {
  const { contentDOM } = view;
  const page = contentDOM.getBoundingClientRect();
  let row = document.elementFromPoint(Math.min(page.right - 1, page.left + gutterOf(view) + 2), clientY);
  if (!row || row === contentDOM || !contentDOM.contains(row)) row = null;
  while (row && row.parentNode !== contentDOM) row = row.parentNode;
  if (row) return row;
  let last = null;
  for (const child of contentDOM.children) {
    if (child.getBoundingClientRect().top > clientY) break;
    last = child;
  }
  return last;
}

/**
 * Where a row of the page is drawn on screen: its box, less the clear borders a drawn
 * block keeps its room above and below in (`editor/theme.js`), so its frame.
 */
function frameRect(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const above = parseFloat(style.borderTopWidth) || 0;
  const below = parseFloat(style.borderBottomWidth) || 0;
  return { top: rect.top + above, bottom: rect.bottom - below, left: rect.left, right: rect.right, height: rect.height - above - below };
}

/** Where a block stands on screen, `{ top, bottom }`: off its rows while they are drawn, off the height map else. */
function blockSpan(view, block) {
  const lastLine = view.state.doc.lineAt(block.to).from;
  const { from, to } = view.viewport;
  const first = block.from >= from && block.from <= to ? topElement(view, block.from) : null;
  // a drawn block is one row, its lines inside it
  const last = block.drawn ? first : lastLine >= from && lastLine <= to ? topElement(view, lastLine) : null;
  if (first && last) return { top: frameRect(first).top, bottom: frameRect(last).bottom };
  return { top: view.lineBlockAt(block.from).top + view.documentTop, bottom: view.lineBlockAt(block.to).bottom + view.documentTop };
}

/** The block of `blocks` drawn over position `pos`, or null. */
function blockAt(blocks, pos) {
  return blocks.find((block) => block.from <= pos && pos <= block.to) ?? null;
}

function grip() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', iconPaths.grip);
  svg.append(path);
  return svg;
}

class BlockHandle {
  constructor(view) {
    this.view = view;
    this.blocks = null;
    this.blocksOf = null;
    /** The block the pointer is over, held as a position so an edit maps it. */
    this.hover = null;
    this.pointer = null;
    this.target = null;
    this.menu = null;
    this.drag = null;

    this.dom = document.createElement('button');
    this.dom.type = 'button';
    this.dom.className = 'cm-handle';
    this.dom.tabIndex = -1;
    this.dom.title = 'Drag to move or press for the menu (Ctrl+/)';
    this.dom.setAttribute('aria-haspopup', 'menu');
    this.dom.setAttribute('aria-expanded', 'false');
    this.dom.append(grip());
    this.dom.hidden = true;

    this.mark = document.createElement('div');
    this.mark.className = 'cm-handle-mark';
    this.mark.hidden = true;
    this.line = document.createElement('div');
    this.line.className = 'cm-handle-drop';
    this.line.hidden = true;
    this.said = document.createElement('div');
    this.said.className = 'cm-handle-said';
    this.said.setAttribute('role', 'status');
    this.said.setAttribute('aria-live', 'polite');
    view.scrollDOM.append(this.mark, this.line, this.dom, this.said);

    this.onMove = (event) => {
      if (event.pointerType === 'touch' || this.drag) return;
      this.pointer = { x: event.clientX, y: event.clientY };
      this.hoverAt(event.clientY);
    };
    this.onLeave = (event) => {
      if (this.drag || this.menu || this.dom.contains(event.relatedTarget)) return;
      this.pointer = null;
      if (this.hover !== null) {
        this.hover = null;
        this.schedule();
      }
    };
    this.onScroll = () => {
      if (this.pointer && !this.drag) this.hoverAt(this.pointer.y);
      else this.schedule();
    };
    view.scrollDOM.addEventListener('pointermove', this.onMove);
    view.scrollDOM.addEventListener('pointerleave', this.onLeave);
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });

    this.dom.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.dom.addEventListener('pointerdown', (event) => this.press(event));
    this.dom.addEventListener('click', (event) => {
      // the keyboard's Enter and Space give a click with no press before it
      if (event.detail === 0 && this.target) this.openMenu(this.target, { keyboard: true });
    });
    this.schedule();
  }

  /** Every block of the note, read once per state. */
  ranges() {
    if (this.blocksOf !== this.view.state) {
      this.blocks = blockRanges(this.view.state);
      this.blocksOf = this.view.state;
    }
    return this.blocks;
  }

  /**
   * The block at a height on screen: the one whose lines it is over, or the last one
   * above it, so the gap between two keeps it. Read off the page itself.
   */
  blockAtY(clientY) {
    const { view } = this;
    const child = rowAt(view, clientY);
    if (!child) return null;
    const pos = view.posAtDOM(child, 0);
    const blocks = this.ranges();
    const at = blockAt(blocks, pos);
    if (at) return at;
    return view.state.doc.lineAt(pos).text.trim() ? null : blocks.filter((block) => block.to < pos).at(-1) ?? null;
  }

  hoverAt(clientY) {
    const block = this.blockAtY(clientY);
    const pos = block?.from ?? null;
    if (pos === this.hover) return;
    this.hover = pos;
    this.schedule();
  }

  /** The block the handle stands on: the hovered one, else the cursor's while the editor has focus. */
  current() {
    const { state } = this.view;
    const blocks = this.ranges();
    if (this.hover !== null) {
      const hovered = blockAt(blocks, this.hover);
      if (hovered) return hovered;
    }
    if (!state.field(focused, false)) return null;
    return blockAt(blocks, state.selection.main.head);
  }

  update(update) {
    if (update.docChanged && this.hover !== null) this.hover = update.changes.mapPos(this.hover, 1);
    if (update.docChanged && this.menu) this.menu.close({ refocus: false });
    if (update.docChanged || update.selectionSet || update.focusChanged || update.geometryChanged || update.viewportChanged
      || update.transactions.some((tr) => tr.effects.length)) this.schedule();
  }

  schedule() {
    this.view.requestMeasure({ key: this, read: () => this.measure(), write: (placed) => this.draw(placed) });
  }

  /** Where the handle goes, read from the page: the block's first line and where its words start. */
  measure() {
    const { view } = this;
    if (view.state.readOnly) return null;
    const block = this.menu?.block ?? this.current();
    if (!block) return null;
    const box = view.scrollDOM.getBoundingClientRect();
    const page = view.contentDOM.getBoundingClientRect();
    const origin = { x: box.left - view.scrollDOM.scrollLeft, y: box.top - view.scrollDOM.scrollTop };
    const first = view.state.doc.lineAt(block.from);
    let lineTop;
    let lineHeight;
    let wordsLeft;
    if (block.drawn) {
      // a drawn block's words start at the page's margin, inside its padding or its frame's margin alike
      const element = topElement(view, block.from);
      const rect = element ? frameRect(element) : null;
      if (!rect) return null;
      const style = getComputedStyle(element);
      const inset = Math.min(parseFloat(style.paddingTop) || 0, 8);
      if (rect.height < 40) {
        lineTop = rect.top;
        lineHeight = rect.height;
      } else {
        lineTop = rect.top + inset;
        lineHeight = view.defaultLineHeight;
      }
      wordsLeft = Math.min(rect.left + (parseFloat(style.paddingLeft) || 0), page.left + gutterOf(view));
      wordsLeft = Math.max(wordsLeft, rect.left);
    } else {
      const start = first.from + (/^\s*/.exec(first.text)?.[0].length ?? 0);
      const coords = view.coordsAtPos(start, 1) ?? view.coordsAtPos(first.from, 1);
      const lineElement = topElement(view, first.from);
      if (!coords || !lineElement) return null;
      const lineRect = lineElement.getBoundingClientRect();
      const style = getComputedStyle(lineElement);
      // a quote or a callout draws its rule left of its words: the handle stays left of the rule
      const ruled = parseFloat(style.borderLeftWidth) > 0;
      wordsLeft = ruled ? lineRect.left : Math.min(coords.left, lineRect.left + (parseFloat(style.paddingLeft) || 0));
      lineTop = coords.top;
      lineHeight = coords.bottom - coords.top;
    }
    const placed = handlePlace({ pageLeft: page.left, wordsLeft, lineTop, lineHeight });
    if (!placed) return null;
    return {
      block,
      left: placed.left - origin.x,
      top: placed.top - origin.y,
      width: placed.width,
      height: placed.height,
      caret: this.hover === null,
    };
  }

  draw(placed) {
    const { dom } = this;
    if (!placed) {
      dom.hidden = true;
      this.target = null;
      return;
    }
    dom.hidden = false;
    this.target = placed.block;
    Object.assign(dom.style, {
      left: `${placed.left}px`, top: `${placed.top}px`, width: `${placed.width}px`, height: `${placed.height}px`,
    });
    dom.classList.toggle('cm-handle-caret', placed.caret && !this.menu);
    dom.dataset.kind = placed.block.kind;
    dom.setAttribute('aria-label', `Block menu: ${blockName(this.view.state, placed.block)}`);
  }

  /** The rect of a block on screen, top to bottom over its lines, in the scroller's coordinates. */
  blockBox(block) {
    const { view } = this;
    const { top, bottom } = blockSpan(view, block);
    const box = view.scrollDOM.getBoundingClientRect();
    const page = view.contentDOM.getBoundingClientRect();
    const shift = view.scrollDOM.scrollTop - box.top;
    return { left: page.left - box.left + view.scrollDOM.scrollLeft, width: page.width, top: top + shift, bottom: bottom + shift };
  }

  /** Light the block a menu or a drag acts on. */
  light(block) {
    if (!block) {
      this.mark.hidden = true;
      return;
    }
    const box = this.blockBox(block);
    const gutter = gutterOf(this.view);
    Object.assign(this.mark.style, {
      left: `${box.left + Math.max(0, gutter - 8)}px`, width: `${box.width - 2 * Math.max(0, gutter - 8)}px`,
      top: `${box.top - 2}px`, height: `${box.bottom - box.top + 4}px`,
    });
    this.mark.hidden = false;
  }

  openMenu(block, { keyboard = false } = {}) {
    if (this.view.state.readOnly) return false;
    this.menu?.close({ refocus: false });
    this.hover = block.from;
    this.target = block;
    const name = blockName(this.view.state, block);
    // the handle stands where the menu opens from, drawn now so the menu can be placed by it
    this.draw(this.measure() ?? null);
    const anchor = (this.dom.hidden ? this.view.coordsAtPos(block.from) : this.dom.getBoundingClientRect())
      ?? this.view.contentDOM.getBoundingClientRect();
    this.dom.setAttribute('aria-expanded', 'true');
    this.dom.classList.add('cm-handle-active');
    this.light(block);
    const menu = openBlockMenu(this.view, block, {
      anchor,
      label: name,
      keyboard,
      copied: (text) => this.say(text ? 'Link copied' : 'The link could not be copied'),
      closed: () => {
        if (this.menu === menu) this.menu = null;
        this.dom.setAttribute('aria-expanded', 'false');
        this.dom.classList.remove('cm-handle-active');
        this.light(null);
        if (!this.pointer) this.hover = null;
        this.schedule();
      },
    });
    menu.block = block;
    this.menu = menu;
    return true;
  }

  /** A word for a moment beside the handle: what a copy did. */
  say(text) {
    this.said.textContent = text;
    this.said.style.left = this.dom.style.left;
    this.said.style.top = `${parseFloat(this.dom.style.top || '0') - 26}px`;
    this.said.classList.add('cm-handle-said-on');
    clearTimeout(this.saying);
    this.saying = setTimeout(() => this.said.classList.remove('cm-handle-said-on'), 1400);
  }

  // -- drag ------------------------------------------------------------------------

  press(event) {
    if (event.button !== 0 || !this.target || this.view.state.readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const block = this.target;
    const start = { x: event.clientX, y: event.clientY };
    const id = event.pointerId;
    try { this.dom.setPointerCapture(id); } catch { /* a synthetic press has no pointer to hold */ }
    let dragging = false;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== id) return;
      if (!dragging && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_START) return;
      if (!dragging) {
        dragging = true;
        this.startDrag(block);
      }
      this.dragTo(moveEvent.clientY, moveEvent.clientX);
    };
    const end = (endEvent) => {
      if (endEvent.pointerId !== id) return;
      this.dom.removeEventListener('pointermove', move);
      this.dom.removeEventListener('pointerup', end);
      this.dom.removeEventListener('pointercancel', end);
      try { this.dom.releasePointerCapture(id); } catch { /* already let go */ }
      if (dragging) this.endDrag(endEvent.type === 'pointerup');
      else if (endEvent.type === 'pointerup') this.openMenu(block);
    };
    this.dom.addEventListener('pointermove', move);
    this.dom.addEventListener('pointerup', end);
    this.dom.addEventListener('pointercancel', end);
  }

  startDrag(block) {
    this.menu?.close({ refocus: false });
    this.drag = { block, before: undefined, y: 0, scroll: 0 };
    this.view.dom.classList.add('cm-handle-dragging');
    this.light(block);
    // what is being moved, named beside the pointer
    this.ghost = document.createElement('div');
    this.ghost.className = 'cm-handle-ghost';
    this.ghost.setAttribute('aria-hidden', 'true');
    this.ghost.append(grip(), document.createTextNode(blockName(this.view.state, block)));
    this.view.dom.append(this.ghost);
    this.escape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.drag.cancelled = true;
      this.endDrag(false);
    };
    window.addEventListener('keydown', this.escape, true);
  }

  /**
   * The gap nearest a height on screen, among the blocks drawn now: before which block
   * the dragged one would land (null for the end), its place in the note, and the
   * height on screen to draw the line at.
   */
  gapAt(clientY) {
    const { view } = this;
    const blocks = this.ranges();
    const { from, to } = view.viewport;
    let best = null;
    const consider = (index, at) => {
      const distance = Math.abs(clientY - at);
      if (!best || distance < best.distance) best = { distance, before: blocks[index] ?? null, at, index };
    };
    let above = null;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block.to < from) continue;
      if (block.from > to) break;
      const span = blockSpan(view, block);
      consider(index, above ? (above.bottom + span.top) / 2 : span.top - 4);
      above = span;
      if (index === blocks.length - 1) consider(index + 1, span.bottom + 4);
    }
    return best;
  }

  dragTo(clientY, clientX = this.drag?.x ?? 0) {
    const { drag, view } = this;
    if (!drag) return;
    drag.y = clientY;
    drag.x = clientX;
    if (this.ghost) Object.assign(this.ghost.style, { left: `${clientX + 14}px`, top: `${clientY + 12}px` });
    const gap = this.gapAt(clientY);
    const blocks = this.ranges();
    const from = blocks.findIndex((one) => one.from === drag.block.from);
    const stays = !gap || gap.index === from || gap.index === from + 1;
    drag.before = stays ? undefined : gap.before;
    if (stays) this.line.hidden = true;
    else {
      const box = view.scrollDOM.getBoundingClientRect();
      const page = view.contentDOM.getBoundingClientRect();
      const gutter = gutterOf(view);
      const top = gap.at - box.top + view.scrollDOM.scrollTop;
      Object.assign(this.line.style, {
        left: `${page.left - box.left + gutter}px`, width: `${Math.max(40, page.width - 2 * gutter)}px`, top: `${top - 1}px`,
      });
      this.line.hidden = false;
    }
    // near the top or the bottom of the page, it scrolls
    const edge = 48;
    const box = view.scrollDOM.getBoundingClientRect();
    const speed = clientY < box.top + edge ? -(box.top + edge - clientY) : clientY > box.bottom - edge ? clientY - (box.bottom - edge) : 0;
    drag.scroll = Math.max(-24, Math.min(24, speed / 2));
    if (drag.scroll && !drag.frame) {
      const step = () => {
        if (!this.drag || !this.drag.scroll) {
          if (this.drag) this.drag.frame = 0;
          return;
        }
        view.scrollDOM.scrollTop += this.drag.scroll;
        this.dragTo(this.drag.y);
        this.drag.frame = requestAnimationFrame(step);
      };
      drag.frame = requestAnimationFrame(step);
    }
  }

  endDrag(drop) {
    const { drag, view } = this;
    if (!drag) return;
    this.drag = null;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    window.removeEventListener('keydown', this.escape, true);
    view.dom.classList.remove('cm-handle-dragging');
    this.ghost?.remove();
    this.ghost = null;
    this.line.hidden = true;
    this.light(null);
    if (drop && !drag.cancelled && drag.before !== undefined) {
      const spec = moveBlock(view.state, drag.block, drag.before, this.ranges());
      if (spec) {
        view.dispatch(spec);
        view.focus();
      }
    }
    this.schedule();
  }

  destroy() {
    this.menu?.close({ refocus: false });
    if (this.drag) this.endDrag(false);
    clearTimeout(this.saying);
    this.view.scrollDOM.removeEventListener('pointermove', this.onMove);
    this.view.scrollDOM.removeEventListener('pointerleave', this.onLeave);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.dom.remove();
    this.mark.remove();
    this.line.remove();
    this.said.remove();
  }
}

export const blockHandle = ViewPlugin.fromClass(BlockHandle);

/** The cursor's block, as `blockRanges` reads it, or null on a blank line. */
function caretBlock(state) {
  return blockAt(blockRanges(state), state.selection.main.head);
}

/** Alt+↑ and Alt+↓: the cursor's block moves past the one next to it, the cursor with it. Kept from the line moves of the raw Markdown. */
function moveCaretBlock(step) {
  return (view) => {
    if (view.state.readOnly) return true;
    const block = caretBlock(view.state);
    const spec = block ? moveBy(view.state, block, step) : null;
    if (spec) view.dispatch(spec);
    return true;
  };
}

/** Ctrl+/: the menu of the cursor's block, the keyboard in it. */
function menuAtCaret(view) {
  const handle = view.plugin(blockHandle);
  if (!handle) return false;
  const block = caretBlock(view.state);
  // on a blank line there is no block: the key does nothing rather than write a comment
  if (!block) return true;
  handle.pointer = null;
  handle.openMenu(block, { keyboard: true });
  return true;
}

export const handleKeys = Prec.high(keymap.of([
  { key: 'Alt-ArrowUp', run: moveCaretBlock(-1) },
  { key: 'Alt-ArrowDown', run: moveCaretBlock(1) },
  { key: 'Mod-/', run: menuAtCaret },
]));

/** How the handle, its menu and the drop line look, in the app's dark and light themes. */
export const handleTheme = EditorView.theme({
  // beside the hovered block a small raised square, as the page's other buttons; beside the cursor's only, a quiet one
  '.cm-handle': {
    position: 'absolute', zIndex: '3', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0',
    border: 'none', borderRadius: '4px', background: 'var(--bg-2)', boxShadow: 'inset 0 0 0 1px var(--border)',
    color: 'var(--text-2)', cursor: 'grab', touchAction: 'none', transition: 'background-color .12s, color .12s, opacity .12s',
  },
  '.cm-handle[hidden]': { display: 'none' },
  '.cm-handle:hover, .cm-handle-active': { background: 'var(--bg-3)', color: 'var(--text-1)', boxShadow: 'inset 0 0 0 1px var(--border-strong)' },
  '.cm-handle:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-handle-caret:not(:hover)': { background: 'transparent', boxShadow: 'none', color: 'var(--text-3)' },
  '&.cm-handle-dragging, &.cm-handle-dragging *': { cursor: 'grabbing !important' },
  '.cm-handle-mark': {
    position: 'absolute', zIndex: '1', pointerEvents: 'none', boxSizing: 'border-box', borderRadius: '6px',
    border: '1px dashed var(--border-strong)', background: 'color-mix(in srgb, var(--text-1) 3%, transparent)',
  },
  '&.cm-handle-dragging .cm-handle-mark': { background: 'color-mix(in srgb, var(--text-1) 6%, transparent)' },
  '.cm-handle-mark[hidden], .cm-handle-drop[hidden]': { display: 'none' },
  '.cm-handle-drop': {
    position: 'absolute', zIndex: '4', height: '2px', pointerEvents: 'none', borderRadius: '1px', background: 'var(--accent)',
  },
  '.cm-handle-drop::before': {
    content: '""', position: 'absolute', left: '-4px', top: '-3px', width: '8px', height: '8px', borderRadius: '50%',
    background: 'var(--accent)',
  },
  '.cm-handle-said': {
    position: 'absolute', zIndex: '5', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-3)', color: 'var(--text-1)',
    fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'none', opacity: '0', transition: 'opacity .15s',
  },
  '.cm-handle-said-on': { opacity: '1' },
  '.cm-handle-ghost': {
    position: 'fixed', zIndex: '1250', display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 9px 3px 5px',
    borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-1)',
    color: 'var(--text-1)', fontFamily: 'var(--font-sans)', fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'none',
  },
  '.cm-handle-ghost svg': { color: 'var(--text-3)' },
  '.cm-handle-menu': {
    position: 'fixed', zIndex: '1250', minWidth: '232px', maxWidth: '300px', padding: '5px', boxSizing: 'border-box',
    background: 'var(--bg-1)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm, 6px)',
    boxShadow: 'var(--shadow-2)', color: 'var(--text-1)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm, 13px)',
    lineHeight: '1.3', outline: 'none',
  },
  '.cm-handle-sub': { minWidth: '208px' },
  '.cm-handle-item': {
    display: 'flex', alignItems: 'center', gap: '9px', width: '100%', minHeight: '30px', padding: '5px 8px', border: 'none',
    borderRadius: '4px', background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
  },
  '.cm-handle-item:focus': { outline: 'none' },
  '.cm-handle-item:hover, .cm-handle-open, .cm-handle-keys > .cm-handle-item:focus': { background: 'var(--bg-3)' },
  '.cm-handle-item[aria-disabled="true"]': { color: 'var(--text-3)', cursor: 'default', background: 'none' },
  '.cm-handle-icon': {
    flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px',
    color: 'var(--text-3)',
  },
  '.cm-handle-glyph': { fontSize: '10.5px', fontWeight: '700', letterSpacing: '-.02em', color: 'var(--text-2)' },
  '.cm-handle-tick': { color: 'var(--accent)' },
  '.cm-handle-swatch': { width: '10px', height: '10px', borderRadius: '3px' },
  '.cm-handle-words': { flex: '1', minWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-handle-hint': { flex: 'none', marginLeft: '12px', color: 'var(--text-3)', fontSize: '11px' },
  '.cm-handle-more': { flex: 'none', color: 'var(--text-3)', marginRight: '-2px' },
  '.cm-handle-internal .cm-handle-icon': { color: 'var(--internal)' },
  '.cm-handle-danger, .cm-handle-danger .cm-handle-icon': { color: 'var(--danger)' },
  '.cm-handle-sep': { height: '1px', margin: '4px 2px', background: 'var(--border)' },
});

/** The handle, its keys and its look: what the drawn page adds for it. */
export const handleExtensions = [blockHandle, handleKeys, handleTheme];
