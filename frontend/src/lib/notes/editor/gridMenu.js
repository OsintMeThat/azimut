/**
 * The small menus and the icons of a table's grid: a column's, a row's, the bar's
 * ⋯. Drawn inside the editor, so they take its look, and walked with the keys: the
 * arrows move, Enter or Space presses, Escape closes and gives the keyboard back.
 */
import { paths as iconPaths } from '../../../components/Icon.svelte';

/** The grid's own few icons, drawn as the app's set is (24×24, stroke-based). */
const OWN = {
  sortUp: 'M5 7h7M5 12h10M5 17h13M19 9l-3-3-3 3M16 6v12',
  sortDown: 'M5 7h13M5 12h10M5 17h7M19 15l-3 3-3-3M16 18V6',
  fillDown: 'M12 4v12m-5-5 5 5 5-5M5 20h14',
};

/** An icon of the app's set, as an element. */
export function icon(name, size = 14) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', OWN[name] ?? iconPaths[name] ?? '');
  svg.append(path);
  return svg;
}

/** A button with an icon and words, or the icon alone with its words as its name. */
export function button(className, { label, iconName, title, alone = false }) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  if (iconName) node.append(icon(iconName));
  if (alone) node.setAttribute('aria-label', label);
  else {
    const words = document.createElement('span');
    words.textContent = label;
    node.append(words);
  }
  if (title) node.title = title;
  return node;
}

let shown = null;

/** Close the menu or panel open now, if any. */
export function closeMenu() {
  shown?.close(false);
}

/**
 * Show `node` (a menu, a small panel) under `anchor`, or over it when there is no
 * room below, inside the editor `view`. It closes on Escape, a press outside or a
 * scroll of the note; `back` (the anchor by default) gets the keyboard back when
 * Escape closes it. Answers its `close(giveBack)`.
 */
export function openPopover(view, anchor, node, { back = null, onClose = null } = {}) {
  closeMenu();
  const outside = (event) => {
    if (!node.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) close(false);
  };
  const place = () => {
    const box = anchor.getBoundingClientRect();
    const height = node.offsetHeight;
    const width = node.offsetWidth;
    node.style.left = `${Math.max(6, Math.min(box.left, window.innerWidth - width - 6))}px`;
    node.style.top = `${box.bottom + 4 + height > window.innerHeight - 6 ? Math.max(6, box.top - height - 4) : box.bottom + 4}px`;
    return box;
  };
  // the note scrolls under it: it follows its anchor, and goes once the anchor is out of sight
  const scrolled = () => {
    const box = place();
    const page = view.scrollDOM.getBoundingClientRect();
    if (box.bottom < page.top || box.top > page.bottom) close(false);
  };
  const escape = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  function close(giveBack) {
    if (shown?.node !== node) return;
    shown = null;
    node.remove();
    document.removeEventListener('mousedown', outside, true);
    view.scrollDOM.removeEventListener('scroll', scrolled);
    node.removeEventListener('keydown', escape);
    anchor.setAttribute('aria-expanded', 'false');
    onClose?.();
    if (giveBack) (back ?? anchor)?.focus?.({ preventScroll: true });
  }
  node.classList.add('cm-grid-ui');
  node.addEventListener('keydown', escape);
  view.dom.append(node);
  place();
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('mousedown', outside, true);
  view.scrollDOM.addEventListener('scroll', scrolled);
  shown = { node, close };
  return close;
}

/**
 * Open a menu under `anchor`, inside the editor `view`. `items` are
 * `{ label, iconName?, hint?, run, disabled?, danger?, checked? }`, `'-'` for a
 * line between groups. `back` gets the keyboard once Escape closes it.
 */
export function openMenu(view, anchor, items, { label = 'Menu', back = null } = {}) {
  const menu = document.createElement('div');
  menu.className = 'cm-grid-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  const buttons = [];
  let close = () => {};
  for (const item of items) {
    if (item === '-') {
      const line = document.createElement('div');
      line.className = 'cm-grid-menu-line';
      line.setAttribute('role', 'separator');
      menu.append(line);
      continue;
    }
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
    if (item.checked !== undefined) entry.setAttribute('aria-checked', String(Boolean(item.checked)));
    entry.className = `cm-grid-menu-item${item.danger ? ' danger' : ''}`;
    entry.tabIndex = -1;
    entry.disabled = Boolean(item.disabled);
    entry.append(item.iconName ? icon(item.iconName) : document.createElement('span'));
    const words = document.createElement('span');
    words.className = 'cm-grid-menu-words';
    words.textContent = item.label;
    entry.append(words);
    if (item.hint) {
      const hint = document.createElement('small');
      hint.textContent = item.hint;
      entry.append(hint);
    }
    // a press keeps the keyboard where it is until the item has run
    entry.addEventListener('mousedown', (event) => event.preventDefault());
    entry.addEventListener('click', () => {
      close(false);
      item.run();
    });
    menu.append(entry);
    buttons.push(entry);
  }
  const live = () => buttons.filter((entry) => !entry.disabled);
  menu.addEventListener('keydown', (event) => {
    const list = live();
    const at = list.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      list[(at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (event.key === 'Home') list[0]?.focus();
    else if (event.key === 'End') list[list.length - 1]?.focus();
    else if (event.key === 'Tab') close(true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  close = openPopover(view, anchor, menu, { back });
  live()[0]?.focus({ preventScroll: true });
  return menu;
}
