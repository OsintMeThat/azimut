/**
 * The `@` menu inside a table's cell: the same records as in the text
 * (`mentionChoices`), drawn as the editor's own menu, and picking one writes its
 * chip in the cell. A cell is a plain text field, not the editor, so the menu is
 * its own element with the editor's look.
 */
import { entityReference } from '../../markdown.js';
import { mentionChoices } from './mentionMenu.js';

/** `@` and what follows it before the caret, as the text's menu reads it. */
const TYPED = /@[^\s@[\]()]{0,40}$/;

/**
 * The `@` typed before the caret of `text`, `{ from, query }`, or null: an `@` inside
 * a word or an address is not one.
 */
export function typedMention(text, caret) {
  const before = String(text ?? '').slice(0, caret);
  const typed = TYPED.exec(before);
  if (!typed) return null;
  const from = caret - typed[0].length;
  if (from > 0 && /[\w.]/.test(before[from - 1])) return null;
  return { from, query: typed[0].slice(1) };
}

/**
 * The menu for the cell field `input`, inside the editor `view` (whose look it
 * takes). `entities()` reads the case's records when it opens. Answers
 * `{ read(), key(event), close(), open }`: `read` after each keystroke, `key` before
 * the cell's own keys (true when the menu took it).
 */
export function cellMention(input, { view, entities }) {
  let menu = null;
  let choices = [];
  let index = 0;
  let typed = null;

  function close() {
    menu?.remove();
    menu = null;
    typed = null;
  }

  function pick(choice) {
    if (!typed || !choice) return;
    const caret = input.selectionStart;
    const chip = entityReference(choice.entity);
    const after = input.value.slice(caret, caret + 1);
    input.setRangeText(after && /\s/.test(after) ? chip : `${chip} `, typed.from, caret, 'end');
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  function draw() {
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'cm-tooltip cm-tooltip-autocomplete cm-grid-mention cm-grid-ui';
      // a press on the menu keeps the caret in the cell
      menu.addEventListener('mousedown', (event) => event.preventDefault());
      view.dom.append(menu);
    }
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Case items');
    choices.forEach((choice, at) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      if (at === index) item.setAttribute('aria-selected', 'true');
      const label = document.createElement('span');
      label.className = 'cm-completionLabel';
      label.textContent = choice.label;
      const detail = document.createElement('span');
      detail.className = 'cm-completionDetail';
      detail.textContent = choice.detail;
      item.append(label, detail);
      item.addEventListener('click', () => pick(choice));
      list.append(item);
    });
    menu.replaceChildren(list);
    const box = input.getBoundingClientRect();
    const below = box.bottom + 4;
    menu.style.position = 'fixed';
    menu.style.maxWidth = 'min(440px, 90vw)';
    menu.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = below + 220 > window.innerHeight ? 'auto' : `${below}px`;
    menu.style.bottom = below + 220 > window.innerHeight ? `${window.innerHeight - box.top + 4}px` : 'auto';
    list.children[index]?.scrollIntoView?.({ block: 'nearest' });
  }

  function read() {
    const caret = input.selectionStart;
    typed = input.selectionEnd === caret ? typedMention(input.value, caret) : null;
    if (!typed) {
      close();
      return;
    }
    const was = typed;
    choices = mentionChoices(entities() ?? [], typed.query);
    if (!choices.length) {
      close();
      return;
    }
    typed = was;
    index = 0;
    draw();
  }

  function key(event) {
    if (!menu || event.isComposing) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      index = (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      draw();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      pick(choices[index]);
    } else if (event.key === 'Escape') {
      close();
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  return {
    read,
    key,
    close,
    get open() {
      return Boolean(menu);
    },
  };
}
