/**
 * The insert menu: one menu for everything a note can hold, opened by `/` or by the
 * + in the left margin of the empty line being written (`editor/slashMenu.js` says
 * what it lists and writes). It is CodeMirror's completion list, drawn here as the
 * menu: the five parts by name, an icon for each entry, its line under its name,
 * and a preview of the entry picked beside the list.
 *
 * The + opens the menu where the cursor is without writing a `/`: what is typed
 * next finds an entry, and Escape leaves the line as it was. An empty note says,
 * once, what the + and `/` are for (`editor/insertHint.js`).
 */
import { autocompletion, completionStatus, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';

import { iconSvg } from './icon.js';
import { insertHintPending, insertHintUsed } from './insertHint.js';
import { previewLook } from './insertPreview.js';
import { blocksIn } from './ranges.js';
import { focused } from './state.js';

// -- where the + opened the menu ----------------------------------------------------

/** Open the menu at a position (the + was pressed), or null once it closed. */
export const openPlus = StateEffect.define();

/**
 * Where the + opened the menu, while it is open: the words typed from there find an
 * entry, as they do after a `/`. Gone once the cursor leaves the line or goes back
 * past it.
 */
export const plusAt = StateField.define({
  create: () => null,
  update(value, transaction) {
    let next = value;
    if (next != null && transaction.docChanged) next = transaction.changes.mapPos(next, -1);
    for (const effect of transaction.effects) if (effect.is(openPlus)) next = effect.value;
    if (next != null) {
      const { head } = transaction.newSelection.main;
      if (head < next || transaction.newDoc.lineAt(head).from > next) next = null;
    }
    return next;
  },
});

/** Open the insert menu at the cursor, as the + does: nothing is written until an entry is picked. */
export function openInsertMenu(view) {
  if (view.state.readOnly) return false;
  const { head } = view.state.selection.main;
  view.dispatch({ selection: { anchor: head }, effects: openPlus.of(head) });
  insertHintUsed();
  view.focus();
  startCompletion(view);
  return true;
}

/** The + lets go of its place once the menu it opened has closed. */
const plusCloses = ViewPlugin.fromClass(class {
  update(update) {
    if (update.state.field(plusAt) == null || !completionStatus(update.startState) || completionStatus(update.state)) return;
    const { view } = update;
    queueMicrotask(() => {
      if (view.state.field(plusAt, false) != null && !completionStatus(view.state)) view.dispatch({ effects: openPlus.of(null) });
    });
  }
});

// -- the menu's look ----------------------------------------------------------------

/** Whether the completion open now is the insert menu, not the `@` list. */
function insertOpen(state) {
  return Boolean(currentCompletions(state)[0]?.insertEntry);
}

/** An entry's icon: a heading's level, a callout's colour, else its icon. */
function optionIcon(completion) {
  const command = completion.insertEntry;
  if (!command) return null;
  const box = document.createElement('span');
  box.className = 'cm-insert-icon';
  box.setAttribute('aria-hidden', 'true');
  if (command.glyph) {
    box.classList.add('cm-insert-glyph');
    box.textContent = command.glyph;
  } else box.append(iconSvg(command.icon ?? 'plus', 15));
  if (command.colour) box.style.setProperty('--swatch', command.colour);
  if (command.colour) box.classList.add('cm-insert-swatch');
  return box;
}

/** A › after an entry that opens a group of its own. */
function optionMore(completion) {
  if (!completion.insertEntry?.menu) return null;
  const more = document.createElement('span');
  more.className = 'cm-insert-more';
  more.append(iconSvg('chevronRight', 13));
  return more;
}

/** The preview stands beside the list, from its top, where there is room for it; nowhere else. */
function placePreview(_view, list, _option, info, space) {
  const width = info.right - info.left;
  if (space.right - list.right >= width) return { style: 'top: 0px', class: 'cm-completionInfo-right' };
  if (list.left - space.left >= width) return { style: 'top: 0px', class: 'cm-completionInfo-left' };
  return { style: 'display: none', class: '' };
}

/** What was typed for the menu, for its head line. */
const queryShown = ViewPlugin.fromClass(class {
  update(update) {
    if (!completionStatus(update.state)) return;
    update.view.requestMeasure({
      read: (view) => view.dom.querySelector('.cm-insert-menu'),
      write: (menu, view) => {
        if (!menu) return;
        const plus = view.state.field(plusAt, false);
        const { head } = view.state.selection.main;
        const line = view.state.doc.lineAt(head);
        const before = view.state.sliceDoc(line.from, head);
        const typed = plus != null && plus >= line.from ? view.state.sliceDoc(plus, head) : before;
        menu.dataset.query = /\/?([\w-]*)$/.exec(typed)?.[1] ?? '';
      },
    });
  }
});

// -- the + in the margin ------------------------------------------------------------

class PlusWidget extends WidgetType {
  eq() { return true; }

  toDOM(view) {
    const anchor = document.createElement('span');
    anchor.className = 'cm-insert-plus-anchor';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-insert-plus';
    button.tabIndex = -1;
    button.title = 'Insert a heading, a picture, a table, a map… (/)';
    button.setAttribute('aria-label', 'Insert a block');
    button.append(iconSvg('plus', 14));
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      openInsertMenu(view);
    });
    anchor.append(button);
    return anchor;
  }

  ignoreEvent() { return true; }
}

/** The once-only hint of an empty note. */
class HintWidget extends WidgetType {
  eq() { return true; }

  toDOM() {
    const hint = document.createElement('span');
    hint.className = 'cm-insert-hint';
    const key = (text) => {
      const kbd = document.createElement('kbd');
      kbd.textContent = text;
      return kbd;
    };
    hint.append('Type ', key('/'), ' or press ', key('+'), ' to add anything');
    return hint;
  }

  ignoreEvent() { return false; }
}

/** The nodes inside which an empty line is part of something, not a place to add a block. */
const NO_PLUS = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'Table']);

/**
 * The line the + stands on, or null: the empty line being written. It takes the slot
 * the block handle (`editor/handle.js`) takes beside a block, and an empty line is no
 * block: once words are typed on it the handle stands there instead, never both.
 */
export function plusLine(state) {
  if (state.readOnly || !state.field(focused, false)) return null;
  const range = state.selection.main;
  if (!range.empty) return null;
  const line = state.doc.lineAt(range.head);
  if (line.text.trim()) return null;
  if (blocksIn(state, line.from, line.to).length) return null;
  for (let node = syntaxTree(state).resolveInner(line.from, 1); node; node = node.parent) if (NO_PLUS.has(node.name)) return null;
  return line;
}

const plusMarks = StateField.define({
  create: () => Decoration.none,
  update(_value, transaction) {
    const { state } = transaction;
    const ranges = [];
    if (!state.doc.length && insertHintPending()) ranges.push(Decoration.widget({ widget: new HintWidget(), side: 2 }).range(0));
    const line = plusLine(state);
    if (line) ranges.push(Decoration.widget({ widget: new PlusWidget(), side: -1 }).range(line.from));
    return Decoration.set(ranges, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const look = EditorView.theme({
  // the menu, drawn as one panel with its preview beside it
  '.cm-tooltip.cm-tooltip-autocomplete.cm-insert-menu': {
    overflow: 'visible', width: '318px', padding: '0', borderRadius: '8px', background: 'var(--bg-2)',
  },
  '.cm-tooltip.cm-insert-menu::before': {
    content: '"Type to find: table, map, callout, page…"', display: 'block', padding: '9px 12px 8px', color: 'var(--text-3)',
    fontFamily: 'var(--font-sans)', fontSize: '12px', borderBottom: '1px solid var(--border)',
  },
  '.cm-tooltip.cm-insert-menu[data-query]:not([data-query=""])::before': { content: '"Found for “" attr(data-query) "”"', color: 'var(--text-2)' },
  '.cm-tooltip.cm-insert-menu::after': {
    content: '"↑↓ move     Enter insert     Esc close"', display: 'block', padding: '7px 12px', whiteSpace: 'pre', color: 'var(--text-3)',
    fontFamily: 'var(--font-sans)', fontSize: '11px', borderTop: '1px solid var(--border)',
  },
  // short enough to open under the line from the middle of the page, as a menu should
  '.cm-tooltip.cm-tooltip-autocomplete.cm-insert-menu > ul': {
    maxHeight: 'min(300px, calc(50vh - 110px))', minHeight: '120px', padding: '2px 6px 6px', minWidth: '0', boxSizing: 'border-box',
  },
  '.cm-tooltip.cm-tooltip-autocomplete.cm-insert-menu > ul > completion-section': {
    display: 'block', padding: '10px 8px 4px', margin: '0', border: 'none', color: 'var(--text-3)', opacity: '1',
    fontSize: '10.5px', fontWeight: '650', letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  '.cm-tooltip.cm-tooltip-autocomplete.cm-insert-menu > ul > li': {
    display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr) auto', gridTemplateRows: 'auto auto', columnGap: '10px', alignItems: 'center',
    padding: '5px 8px', borderRadius: '6px', lineHeight: '1.25', whiteSpace: 'normal',
  },
  '.cm-insert-menu li .cm-insert-icon': {
    gridRow: '1 / 3', width: '30px', height: '30px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-3)', color: 'var(--text-2)', border: '1px solid var(--border)', boxSizing: 'border-box',
  },
  '.cm-insert-menu li .cm-insert-glyph': { fontSize: '11px', fontWeight: '700', letterSpacing: '0.02em' },
  '.cm-insert-menu li .cm-insert-swatch': { color: 'var(--swatch)', borderLeft: '3px solid var(--swatch)' },
  '.cm-insert-menu li .cm-completionLabel': { gridColumn: '2', gridRow: '1', fontSize: '13px', color: 'var(--text-1)' },
  '.cm-insert-menu li .cm-completionDetail': {
    gridColumn: '2', gridRow: '2', margin: '0', fontSize: '11.5px', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-insert-menu li .cm-insert-more': { gridColumn: '3', gridRow: '1 / 3', color: 'var(--text-3)', display: 'flex' },
  '.cm-tooltip.cm-tooltip-autocomplete.cm-insert-menu > ul > li[aria-selected]': { background: 'var(--accent-soft)' },
  '.cm-insert-menu li[aria-selected] .cm-insert-icon': { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'transparent' },
  '.cm-insert-menu li[aria-selected] .cm-insert-swatch': { background: 'var(--swatch)', color: 'var(--bg-1)' },
  '.cm-insert-menu li[aria-selected] .cm-completionDetail': { color: 'var(--text-2)' },
  // the preview, flush beside the list
  '.cm-tooltip.cm-insert-menu > .cm-completionInfo': {
    top: '0', minHeight: '100%', width: '292px', maxWidth: 'none', boxSizing: 'border-box', padding: '14px',
    background: 'var(--bg-2)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-2)', fontFamily: 'var(--font-sans)',
  },
  '.cm-tooltip.cm-insert-menu > .cm-completionInfo.cm-completionInfo-right': { marginLeft: '-1px', borderRadius: '0 8px 8px 0', borderLeftColor: 'var(--border)' },
  '.cm-tooltip.cm-insert-menu > .cm-completionInfo.cm-completionInfo-left': { marginRight: '-1px', borderRadius: '8px 0 0 8px', borderRightColor: 'var(--border)' },
  // the + in the margin of the empty line being written, in the block handle's slot
  '.cm-insert-plus-anchor': { position: 'relative', display: 'inline-block', width: '0', height: '1em', verticalAlign: 'baseline' },
  '.cm-insert-plus': {
    position: 'absolute', left: '-26px', top: '50%', transform: 'translateY(-55%)', width: '22px', height: '22px',
    padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid transparent', borderRadius: '5px',
    background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
  },
  '.cm-insert-plus:hover': { color: 'var(--text-1)', background: 'var(--bg-3)', borderColor: 'var(--border)' },
  // an empty note's own words, which share a class name with the print fields' pill and are not one
  '.cm-placeholder:not([data-placeholder])': { background: 'none', boxShadow: 'none', padding: '0', borderRadius: '0' },
  // the hint of an empty note, under its placeholder
  '.cm-insert-hint': {
    display: 'block', marginTop: '10px', color: 'var(--text-3)', fontSize: '0.86em', fontStyle: 'normal', pointerEvents: 'none', userSelect: 'none',
  },
  '.cm-insert-hint kbd': {
    display: 'inline-block', minWidth: '18px', padding: '0 5px', margin: '0 2px', border: '1px solid var(--border-strong)', borderRadius: '4px',
    background: 'var(--bg-2)', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.92em', textAlign: 'center', lineHeight: '1.5',
  },
});

/** What the insert menu needs in either mode: the + place, the look of the list and its preview. */
export const insertMenu = [
  plusAt,
  plusCloses,
  queryShown,
  autocompletion({ addToOptions: [{ render: optionIcon, position: 20 }, { render: optionMore, position: 90 }],
    tooltipClass: (state) => (insertOpen(state) ? 'cm-insert-menu' : ''), positionInfo: placePreview }),
  look,
  previewLook,
];

/** What the drawn page adds: the + in the margin and the hint of an empty note. */
export const insertPlus = [plusMarks];
