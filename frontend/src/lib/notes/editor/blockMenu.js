/**
 * The block menu: what a press on a block's handle offers (`editor/handle.js`), or
 * Ctrl+/ at the cursor. `blockActions` says what the block can be made, as a list a
 * test reads; `openBlockMenu` draws it as a menu walked with the arrows, each choice
 * one transaction (`editor/turnInto.js`), so one Undo takes it back.
 */
import { paths as iconPaths } from '../../../components/Icon.svelte';
import { CALLOUTS } from '../callouts.js';
import { CORNERS } from '../pictureSize.js';
import { blockRanges } from './ranges.js';
import {
  INTERNAL_KINDS, SHAPES, TEXT_KINDS, alignBlock, alignOf, breakAbove, canBreakBefore, cornerBlock, cornerOf,
  deleteBlock, duplicateBlock, headingLink, isInternal, makePublic, markInternal, moveBy, onCover, pageBreakBefore,
  shapeOf, turnInto,
} from './turnInto.js';

/** What a block is called, on its handle and atop its menu. */
const KIND_NAMES = {
  paragraph: 'Paragraph', heading: 'Heading', list: 'List', quote: 'Quote', callout: 'Callout', code: 'Code', table: 'Table',
  rule: 'Divider', html: 'HTML', picture: 'Picture', diagram: 'Diagram', aligned: 'Aligned block', steps: 'Steps',
  story: 'Story', map: 'Map', pagebreak: 'Page break', cover: 'End of the cover', include: 'Chapter',
};
const SHAPE_NAMES = { h1: 'Heading', h2: 'Subheading', h3: 'Small heading', bullet: 'Bulleted list', numbered: 'Numbered list', task: 'To-do list' };

/** A block's name: `Paragraph`, `Subheading`, `Confirmed callout`, `Picture`… */
export function blockName(state, block) {
  const shape = shapeOf(state, block);
  const callout = /^callout:(.+)$/.exec(shape ?? '')?.[1];
  if (callout === 'internal') return 'Internal passage';
  if (callout) return `${CALLOUTS.find((one) => one.kind === callout)?.label ?? 'Note'} callout`;
  if (block.kind === 'aligned') return `${cornerOf(state, block) ? 'Corner' : 'Aligned'} block`;
  return SHAPE_NAMES[shape] ?? KIND_NAMES[block.kind] ?? block.kind.replace(/^./, (letter) => letter.toUpperCase());
}

const ALIGNS = [
  { id: 'left', label: 'Left', icon: 'alignLeft' },
  { id: 'center', label: 'Centre', icon: 'alignCentreH' },
  { id: 'right', label: 'Right', icon: 'alignRight' },
];
const CORNER_ICONS = { 'top-left': 'cornerTL', 'top-right': 'cornerTR', 'bottom-left': 'cornerBL', 'bottom-right': 'cornerBR' };

/**
 * What the menu of `block` offers in `state`, top to bottom: each entry `{ id, label,
 * icon | glyph | swatch, hint, checked, disabled, danger }` with `run(state)` answering
 * the transaction it writes, `items` for a submenu, or `copy(state)` for the text it
 * puts on the clipboard; `{ separator: true }` between groups. Only what applies to the
 * block is offered.
 */
export function blockActions(state, block, blocks = blockRanges(state)) {
  const entries = [];
  const internal = isInternal(state, block);
  const shape = shapeOf(state, block);
  // an internal passage is a wrapper: Make public takes it off, and what was inside is turned then
  if (TEXT_KINDS.has(block.kind) && !internal) {
    // the kinds of words, then each callout the app has (Internal is its own entry below)
    entries.push({
      id: 'turn', label: 'Turn into', icon: 'edit',
      items: [
        ...SHAPES.map((one) => ({
          id: `turn-${one.id}`, label: one.label, icon: one.icon, glyph: one.glyph, checked: shape === one.id,
          run: (now) => turnInto(now, block, one.id),
        })),
        { separator: true },
        ...CALLOUTS.filter((one) => one.kind !== 'internal').map((one) => ({
          id: `callout-${one.kind}`, label: `${one.label} callout`, swatch: one.colour, hint: one.hint,
          checked: shape === `callout:${one.kind}`, run: (now) => turnInto(now, block, `callout:${one.kind}`),
        })),
      ],
    });
  }
  if (internal) {
    entries.push({ id: 'public', label: 'Make public', icon: 'unlock', hint: 'back in Public', run: (now) => makePublic(now, block) });
  } else if (INTERNAL_KINDS.has(block.kind)) {
    entries.push({ id: 'internal', label: 'Mark internal', icon: 'lock', hint: 'not in Public', internal: true, run: (now) => markInternal(now, block) });
  }
  const side = alignOf(state, block);
  if (side) {
    entries.push({
      id: 'align', label: 'Align', icon: { left: 'alignLeft', center: 'alignCentreH', right: 'alignRight' }[side],
      items: ALIGNS.map((one) => ({
        id: `align-${one.id}`, label: one.label, icon: one.icon, checked: side === one.id, run: (now) => alignBlock(now, block, one.id),
      })),
    });
  }
  if (onCover(state, block)) {
    const corner = cornerOf(state, block);
    entries.push({
      id: 'corner', label: 'Pin to a cover corner', icon: corner ? CORNER_ICONS[corner] : 'cornerTR',
      items: [
        ...CORNERS.map((one) => ({
          id: `corner-${one}`, label: one.replace('-', ' ').replace(/^./, (letter) => letter.toUpperCase()), icon: CORNER_ICONS[one],
          checked: corner === one, run: (now) => cornerBlock(now, block, one),
        })),
        ...(corner ? [{ id: 'corner-none', label: 'Not in a corner', icon: 'x', run: (now) => cornerBlock(now, block, null) }] : []),
      ],
    });
  }
  entries.push({ separator: true });
  const index = blocks.findIndex((one) => one.from === block.from && one.to === block.to);
  entries.push({ id: 'up', label: 'Move up', icon: 'chevronUp', hint: 'Alt+↑', disabled: index <= 0, run: (now) => moveBy(now, block, -1) });
  entries.push({ id: 'down', label: 'Move down', icon: 'chevronDown', hint: 'Alt+↓', disabled: index < 0 || index >= blocks.length - 1, run: (now) => moveBy(now, block, 1) });
  if (block.kind !== 'cover') entries.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy', run: (now) => duplicateBlock(now, block) });
  if (breakAbove(state, block, blocks)) {
    entries.push({ id: 'page', label: 'Remove the page break above', icon: 'file', run: (now) => pageBreakBefore(now, block) });
  } else if (canBreakBefore(state, block, blocks)) {
    entries.push({ id: 'page', label: 'Start a new page here', icon: 'file', hint: 'PDF', run: (now) => pageBreakBefore(now, block) });
  }
  if (block.kind === 'heading') {
    entries.push({ id: 'link', label: 'Copy link to this heading', icon: 'link', hint: 'HTML page', copy: (now) => headingLink(now, block)?.markdown ?? '' });
  }
  entries.push({ separator: true });
  entries.push({ id: 'delete', label: 'Delete', icon: 'trash', hint: 'Del', danger: true, run: (now) => deleteBlock(now, block) });
  return entries;
}

// -- the menu on screen -------------------------------------------------------------

function iconSvg(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', iconPaths[name] ?? '');
  svg.append(path);
  return svg;
}

/** A small drawing for an entry: its icon, a glyph (`H2`), a colour swatch, or a tick when it is what the block is. */
function mark(entry) {
  const box = document.createElement('span');
  box.className = 'cm-handle-icon';
  box.setAttribute('aria-hidden', 'true');
  if (entry.checked) {
    box.classList.add('cm-handle-tick');
    box.append(iconSvg('check'));
  } else if (entry.swatch) {
    const swatch = document.createElement('span');
    swatch.className = 'cm-handle-swatch';
    swatch.style.background = entry.swatch;
    box.append(swatch);
  } else if (entry.glyph) {
    box.classList.add('cm-handle-glyph');
    box.textContent = entry.glyph;
  } else if (entry.icon) box.append(iconSvg(entry.icon));
  return box;
}

/** Place a fixed box near `anchor` (a rect), below it or above when there is no room, inside the window. */
function place(box, anchor, { side = false } = {}) {
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  const room = { w: window.innerWidth, h: window.innerHeight };
  let left = side ? anchor.right - 2 : anchor.left;
  let top = side ? anchor.top - 5 : anchor.bottom + 4;
  if (side && left + width > room.w - 8) left = anchor.left - width + 2;
  if (!side && top + height > room.h - 8) top = Math.max(8, anchor.top - height - 4);
  if (side && top + height > room.h - 8) top = Math.max(8, room.h - 8 - height);
  left = Math.max(8, Math.min(left, room.w - width - 8));
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  // a transformed parent makes `fixed` its own: measured, and moved back by what it shifted
  const drawn = box.getBoundingClientRect();
  if (Math.abs(drawn.left - left) > 0.5 || Math.abs(drawn.top - top) > 0.5) {
    box.style.left = `${2 * left - drawn.left}px`;
    box.style.top = `${2 * top - drawn.top}px`;
  }
}

/** One list of entries as a `role="menu"`, its items walked with the arrows. */
function menuList(entries, label) {
  const list = document.createElement('div');
  list.className = 'cm-handle-menu';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', label);
  list.tabIndex = -1;
  for (const entry of entries) {
    if (entry.separator) {
      const rule = document.createElement('div');
      rule.className = 'cm-handle-sep';
      rule.setAttribute('role', 'separator');
      list.append(rule);
      continue;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `cm-handle-item${entry.danger ? ' cm-handle-danger' : ''}${entry.internal ? ' cm-handle-internal' : ''}`;
    item.tabIndex = -1;
    item.dataset.action = entry.id;
    const checkable = entry.checked !== undefined;
    item.setAttribute('role', checkable ? 'menuitemradio' : 'menuitem');
    if (checkable) item.setAttribute('aria-checked', String(Boolean(entry.checked)));
    if (entry.items) {
      item.setAttribute('aria-haspopup', 'menu');
      item.setAttribute('aria-expanded', 'false');
    }
    if (entry.disabled) item.setAttribute('aria-disabled', 'true');
    const words = document.createElement('span');
    words.className = 'cm-handle-words';
    words.textContent = entry.label;
    item.append(mark(entry), words);
    if (entry.hint && !entry.swatch) {
      const hint = document.createElement('span');
      hint.className = 'cm-handle-hint';
      hint.textContent = entry.hint;
      item.append(hint);
    }
    if (entry.swatch && entry.hint) item.title = entry.hint;
    if (entry.items) {
      const more = iconSvg('chevronRight');
      more.classList.add('cm-handle-more');
      item.append(more);
    }
    item.entry = entry;
    list.append(item);
  }
  return list;
}

const itemsOf = (list) => [...list.querySelectorAll(':scope > .cm-handle-item')];

/**
 * Open the menu of `block` beside `anchor` (the handle's rect). A choice dispatches
 * its one transaction and gives the keyboard back to the editor, as Escape and a
 * press outside do. `copied(text)` is told what a copy put on the clipboard; `close()`
 * is called once the menu is gone. Answers the menu's `close`.
 */
export function openBlockMenu(view, block, { anchor, label = 'Block menu', copied = () => {}, closed = () => {}, keyboard = false } = {}) {
  const entries = blockActions(view.state, block);
  const root = menuList(entries, label);
  root.classList.add('cm-handle-root');
  view.dom.append(root);
  place(root, anchor);
  let sub = null;
  let over = false;

  /** Whether the keyboard walks the menu, which then lights the entry it is on (a pointer lights the one under it). */
  const keys = (on) => {
    root.classList.toggle('cm-handle-keys', on);
    sub?.list.classList.toggle('cm-handle-keys', on);
  };
  const focusItem = (list, item) => {
    for (const one of itemsOf(list)) one.tabIndex = one === item ? 0 : -1;
    item?.focus({ preventScroll: true });
  };
  const closeSub = () => {
    if (!sub) return;
    sub.owner.setAttribute('aria-expanded', 'false');
    sub.owner.classList.remove('cm-handle-open');
    sub.list.remove();
    sub = null;
  };
  const openSub = (item, focus) => {
    if (sub?.owner === item) {
      if (focus) focusItem(sub.list, itemsOf(sub.list).find((one) => one.getAttribute('aria-checked') === 'true') ?? itemsOf(sub.list)[0]);
      return;
    }
    closeSub();
    const list = menuList(item.entry.items, item.entry.label);
    list.classList.add('cm-handle-sub');
    view.dom.append(list);
    place(list, item.getBoundingClientRect(), { side: true });
    item.setAttribute('aria-expanded', 'true');
    item.classList.add('cm-handle-open');
    sub = { owner: item, list };
    list.classList.toggle('cm-handle-keys', root.classList.contains('cm-handle-keys'));
    wire(list);
    if (focus) focusItem(list, itemsOf(list).find((one) => one.getAttribute('aria-checked') === 'true') ?? itemsOf(list)[0]);
  };
  const close = ({ refocus = true } = {}) => {
    if (over) return;
    over = true;
    closeSub();
    root.remove();
    document.removeEventListener('pointerdown', outside, true);
    view.scrollDOM.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (refocus) view.focus();
    closed();
  };
  const choose = async (item) => {
    const { entry } = item;
    if (entry.disabled) return;
    if (entry.items) {
      openSub(item, true);
      return;
    }
    if (entry.copy) {
      const text = entry.copy(view.state);
      close();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        copied(text);
      } catch {
        copied('');
      }
      return;
    }
    const spec = view.state.readOnly ? null : entry.run(view.state);
    close();
    if (spec) view.dispatch(spec);
  };
  function wire(list) {
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const item = event.target.closest('.cm-handle-item');
      if (item && list.contains(item)) choose(item);
    });
    list.addEventListener('pointermove', (event) => {
      keys(false);
      const item = event.target.closest('.cm-handle-item');
      if (!item || !list.contains(item)) return;
      if (list === root) {
        if (item.entry.items && !item.entry.disabled) openSub(item, false);
        else closeSub();
      }
      if (document.activeElement !== item) focusItem(list, item);
    });
    list.addEventListener('keydown', (event) => {
      keys(true);
      const items = itemsOf(list).filter((one) => !one.entry.disabled);
      const at = items.indexOf(document.activeElement);
      const key = event.key;
      let handled = true;
      if (key === 'ArrowDown') focusItem(list, items[(at + 1) % items.length]);
      else if (key === 'ArrowUp') focusItem(list, items[(at - 1 + items.length) % items.length]);
      else if (key === 'Home') focusItem(list, items[0]);
      else if (key === 'End') focusItem(list, items.at(-1));
      else if (key === 'ArrowRight' && list === root && items[at]?.entry.items) openSub(items[at], true);
      else if ((key === 'ArrowLeft' || key === 'Escape') && list !== root) {
        const owner = sub.owner;
        closeSub();
        focusItem(root, owner);
      } else if (key === 'Escape' || key === 'Tab') close();
      else if ((key === 'Enter' || key === ' ') && items[at]) choose(items[at]);
      else if ((key === 'Delete' || key === 'Backspace') && list === root) {
        const remove = itemsOf(root).find((one) => one.entry.id === 'delete');
        if (remove) choose(remove);
      } else if (key.length === 1 && /\S/.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // a letter goes to the next entry starting with it
        const letter = key.toLowerCase();
        const order = [...items.slice(at + 1), ...items.slice(0, at + 1)];
        const next = order.find((one) => one.entry.label.toLowerCase().startsWith(letter));
        if (next) focusItem(list, next);
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }
  function outside(event) {
    if (root.contains(event.target) || sub?.list.contains(event.target)) return;
    close({ refocus: !event.target.closest?.('input, textarea, select, button, a, [contenteditable="true"]') || view.dom.contains(event.target) });
  }
  function onScroll() {
    close({ refocus: false });
  }
  wire(root);
  document.addEventListener('pointerdown', outside, true);
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  const first = itemsOf(root).find((one) => !one.entry.disabled);
  keys(keyboard);
  focusItem(root, first);
  return { close, element: root };
}
