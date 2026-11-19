/**
 * The selection bubble: words selected on the drawn page bring up a small bar above
 * them, Bold, Italic, Link, Heading, a list, Quote, Code, Internal and Clear. Each
 * press writes the Markdown an expert would type (`editor/marks.js`), as one Undo
 * step. Link (Ctrl+K) opens the Link field under the bar (`editor/linkField.js`).
 *
 * The bar never covers the words: it stands above them, or under them when the top of
 * the page is too near. It goes while the mouse is still selecting, when a block is
 * picked, once typing replaces the words, on Escape, and when the editor is left.
 */
import { EditorSelection, Prec, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, showTooltip } from '@codemirror/view';

import { rovingToolbar } from '../pictureSize.js';
import { iconSvg } from './icon.js';
import { linkField } from './linkField.js';
import {
  activeFormats, clearInline, linkTarget, removeLink, runFormat, toggleInline, toggleInternal, toggleLines, toggleQuote, writeCitation, writeLink,
} from './marks.js';
import { blocksIn, pickedBlock } from './ranges.js';
import { cursorLines, noteHandlers, selecting, setSelecting } from './state.js';

/** Hide the bubble until the selection moves (true), or show it again (false). */
export const hideBubble = StateEffect.define();
/** Open the Link field on a target (`linkTarget`), or close it (null). */
export const openLink = StateEffect.define({
  map: (value, changes) => (value ? { ...value, from: changes.mapPos(value.from, 1), to: changes.mapPos(value.to, -1) } : value),
});

/** The stretch the bubble stands for, or null when it does not show. */
function bubbleSpan(state, hidden, link) {
  if (link) return { from: link.from, to: link.to };
  if (hidden || state.readOnly || state.field(selecting, false)) return null;
  const range = state.selection.main;
  if (range.empty || pickedBlock(state)) return null;
  // a selection that is one drawn block, or inside one, is the block's: its own bar serves it
  if (blocksIn(state, range.from, range.to).some((block) => block.from <= range.from && block.to >= range.to)) return null;
  return { from: range.from, to: range.to };
}

const bubbleState = StateField.define({
  create: () => ({ hidden: false, link: null, span: null, tooltip: null }),
  update(value, transaction) {
    let { hidden, link } = value;
    const moved = transaction.selection && !transaction.startState.selection.eq(transaction.state.selection);
    if (moved) {
      hidden = false;
      link = null;
    } else if (link && transaction.docChanged) {
      link = { ...link, from: transaction.changes.mapPos(link.from, 1), to: transaction.changes.mapPos(link.to, -1) };
    }
    for (const effect of transaction.effects) {
      if (effect.is(hideBubble)) hidden = effect.value;
      if (effect.is(openLink)) link = effect.value;
    }
    const span = bubbleSpan(transaction.state, hidden, link);
    let { tooltip } = value;
    // the same tooltip while the words start at the same place, so the bar is not drawn again as a selection grows
    if (!span) tooltip = null;
    else if (!tooltip || tooltip.pos !== span.from) {
      tooltip = { pos: span.from, above: true, strictSide: true, create: (view) => new BubbleView(view) };
    }
    return { hidden, link, span, tooltip };
  },
  provide: (field) => showTooltip.from(field, (value) => value.tooltip),
});

/** Whether the bubble shows now. */
export function bubbleShown(state) {
  return Boolean(state.field(bubbleState, false)?.tooltip);
}

/** Open the Link field on the words selected, the link the cursor is in, or the word under it. False when there is none of them. */
export function openLinkField(view) {
  const { state } = view;
  if (state.readOnly || !state.field(bubbleState, false)) return false;
  let range = state.selection.main;
  if (range.empty) {
    const target = linkTarget(state, range);
    if (!target.existing) {
      const word = state.wordAt(range.head);
      if (!word) return false;
      range = EditorSelection.range(word.from, word.to);
    }
  }
  if (state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to).number) return false;
  const target = linkTarget(state, range);
  view.dispatch({ selection: range.empty ? undefined : EditorSelection.single(range.anchor, range.head), effects: openLink.of(target) });
  return true;
}

/** What the Link field picked, written in place of its words. */
async function linkPicked(view, choice) {
  const state = view.state.field(bubbleState);
  const target = state.link;
  const close = () => {
    if (view.state.field(bubbleState).link) view.dispatch({ effects: openLink.of(null) });
    view.focus();
  };
  if (!target || choice.close) return close();
  if (choice.remove) runFormat(view, removeLink(target));
  else if (choice.link) runFormat(view, writeLink(target, choice.link, { title: choice.title }));
  else if (choice.cite) runFormat(view, writeCitation(target, choice.cite));
  else if (choice.bookmark) {
    const filed = await view.state.facet(noteHandlers).bookmark?.(choice.bookmark, choice.title);
    const now = view.state.field(bubbleState, false)?.link;
    if (filed?.id && now) runFormat(view, writeCitation(now, filed));
  }
  return close();
}

/** The bubble's buttons: what each is called, the key that does the same, and what it writes. */
export const BUBBLE_BUTTONS = [
  { id: 'bold', label: 'Bold', keys: 'Ctrl+B', glyph: 'B', run: (view) => runFormat(view, toggleInline(view.state, 'bold')) },
  { id: 'italic', label: 'Italic', keys: 'Ctrl+I', glyph: 'I', run: (view) => runFormat(view, toggleInline(view.state, 'italic')) },
  { id: 'link', label: 'Link', keys: 'Ctrl+K', icon: 'link', text: 'Link', run: (view) => openLinkField(view) },
  null,
  { id: 'heading', label: 'Heading', glyph: 'H', run: (view) => runFormat(view, toggleLines(view.state, 'heading')) },
  { id: 'bullet', label: 'Bulleted list', icon: 'list', run: (view) => runFormat(view, toggleLines(view.state, 'bullet')) },
  { id: 'quote', label: 'Quote', icon: 'quote', run: (view) => runFormat(view, toggleQuote(view.state)) },
  { id: 'code', label: 'Code', keys: 'Ctrl+E', glyph: '</>', run: (view) => runFormat(view, toggleInline(view.state, 'code')) },
  null,
  { id: 'internal', label: 'Internal', said: 'Internal: left out of the public edition', icon: 'lock', text: 'Internal', run: (view) => runFormat(view, toggleInternal(view.state)) },
  { id: 'clear', label: 'Clear formatting', said: 'Clear bold, italic and code', icon: 'eraser', run: (view) => runFormat(view, clearInline(view.state)) },
];

/** A button's hover title: what it does, and its key. */
export function buttonTitle(item) {
  const said = item.said ?? item.label;
  return item.keys ? `${said} (${item.keys})` : said;
}

class BubbleView {
  constructor(view) {
    this.view = view;
    this.dom = document.createElement('div');
    this.dom.className = 'cm-bubble';
    this.bar = document.createElement('div');
    this.bar.className = 'cm-bubble-bar';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Format the words selected');
    this.buttons = new Map();
    for (const item of BUBBLE_BUTTONS) {
      if (!item) {
        const rule = document.createElement('span');
        rule.className = 'cm-bubble-rule';
        rule.setAttribute('role', 'presentation');
        this.bar.append(rule);
        continue;
      }
      const press = document.createElement('button');
      press.type = 'button';
      press.className = `cm-bubble-button cm-bubble-${item.id}`;
      press.dataset.action = item.id;
      press.title = buttonTitle(item);
      press.setAttribute('aria-label', item.label);
      if (item.icon) press.append(iconSvg(item.icon, 14));
      if (item.glyph) press.append(Object.assign(document.createElement('span'), { className: 'cm-bubble-glyph', textContent: item.glyph }));
      if (item.text) press.append(Object.assign(document.createElement('span'), { className: 'cm-bubble-text', textContent: item.text }));
      press.addEventListener('click', () => {
        item.run(this.view);
        if (item.id !== 'link') this.view.focus();
      });
      this.buttons.set(item.id, press);
      this.bar.append(press);
    }
    this.dom.append(this.bar);
    // a press on the bar keeps the words selected and the editor focused; the field takes the keys
    this.dom.addEventListener('mousedown', (event) => {
      if (!event.target.closest('input')) event.preventDefault();
    });
    this.dom.addEventListener('focusout', (event) => {
      const to = event.relatedTarget;
      if (to && (this.dom.contains(to) || this.view.dom.contains(to))) return;
      queueMicrotask(() => {
        if (this.view.state.field(bubbleState, false)?.tooltip) this.view.dispatch({ effects: [hideBubble.of(true), openLink.of(null)] });
      });
    });
    this.stopRoving = rovingToolbar(this.bar);
    this.field = null;
    this.refresh(view.state);
  }

  /** Light the buttons the words already carry, and open or close the Link field. */
  refresh(state) {
    const active = activeFormats(state, state.selection.main);
    for (const [id, press] of this.buttons) {
      if (id === 'clear') continue;
      press.setAttribute('aria-pressed', String(active.has(id)));
    }
    const link = state.field(bubbleState).link;
    const { from, to } = state.selection.main;
    this.buttons.get('link').classList.toggle('cm-bubble-open', Boolean(link));
    // a link holds words on one line
    this.buttons.get('link').disabled = !link && state.doc.lineAt(from).number !== state.doc.lineAt(to).number;
    if (link && !this.field) {
      this.field = linkField(this.view, link, (choice) => linkPicked(this.view, choice));
      this.dom.append(this.field.dom);
      this.dom.classList.add('cm-bubble-linking');
      // once this update is over, before the next key: what is typed next goes in the field
      const field = this.field;
      queueMicrotask(() => field === this.field && field.focus());
    } else if (!link && this.field) {
      this.field.destroy();
      this.field.dom.remove();
      this.field = null;
      this.dom.classList.remove('cm-bubble-linking');
    }
  }

  update(update) {
    if (update.docChanged || update.selectionSet || update.transactions.some((transaction) => transaction.effects.length)) this.refresh(update.state);
  }

  /**
   * Where the bar goes: above the first line of the words, centred on them when they
   * are on one line; under their last line when the top of the page is too near, and
   * with the Link field open, which reads down from the words as a menu does; at the
   * top of the page when the words fill it. Said as the place of a tooltip shown
   * above, which is how it is declared.
   */
  getCoords(pos) {
    const { view } = this;
    const value = view.state.field(bubbleState, false);
    const span = value?.span;
    const first = span && view.coordsAtPos(span.from, 1);
    const last = span && view.coordsAtPos(span.to, -1);
    if (!first || !last) return view.coordsAtPos(pos);
    const page = view.scrollDOM.getBoundingClientRect();
    const width = this.dom.offsetWidth;
    const height = this.dom.offsetHeight;
    const gap = 8;
    const oneLine = Math.abs(first.top - last.top) < 4;
    const centre = oneLine ? (first.left + last.right) / 2 : first.left + width / 2;
    const left = Math.max(page.left + 4, Math.min(centre - width / 2, page.right - width - 4));
    const above = first.top - height - gap >= page.top;
    const below = last.bottom + gap + height <= page.bottom;
    let top;
    if (above && !(value?.link && below)) top = first.top - height - gap;
    else if (below) top = last.bottom + gap;
    else top = page.top + gap;
    this.dom.classList.toggle('cm-bubble-under', top > first.top);
    return { left, right: left + width, top: top + height, bottom: top + height };
  }

  destroy() {
    this.stopRoving?.();
    this.field?.destroy();
  }
}

/** How long a click holds its line still, so that a second press can still pick a word in it. */
export const DOUBLE_PRESS_MS = 400;
const letGo = new WeakMap();

/**
 * A press holds the lines still until the mouse is let go: a drag, then its bubble; a
 * click, its line's marks shown once a double press can no longer follow.
 */
const pointer = EditorView.domEventHandlers({
  mousedown(event, view) {
    // a press on words; a block, a chip or a button inside the page answers its own
    if (event.button !== 0 || !event.target.closest?.('.cm-line') || event.target.closest('button, input, [data-chip]')) return false;
    clearTimeout(letGo.get(view));
    const held = view.state.field(selecting, false);
    view.dispatch({ effects: setSelecting.of({ lines: held ? held.lines : [...cursorLines(view.state)] }) });
    const release = () => {
      if (view.state.field(selecting, false)) view.dispatch({ effects: setSelecting.of(false) });
    };
    // let go over the page, or anywhere once the window loses the mouse
    const up = () => {
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('blur', up);
      if (view.state.selection.main.empty) letGo.set(view, setTimeout(release, DOUBLE_PRESS_MS));
      else release();
    };
    window.addEventListener('mouseup', up, true);
    window.addEventListener('blur', up);
    return false;
  },
  focus(_event, view) {
    if (view.state.field(bubbleState, false)?.hidden) view.dispatch({ effects: hideBubble.of(false) });
    return false;
  },
  blur(event, view) {
    const to = event.relatedTarget;
    if (to && view.dom.contains(to)) return false;
    if (view.state.field(bubbleState, false)?.tooltip) view.dispatch({ effects: [hideBubble.of(true), openLink.of(null)] });
    return false;
  },
});

const keys = Prec.high(keymap.of([
  { key: 'Mod-k', run: openLinkField },
  { key: 'Mod-e', run: (view) => runFormat(view, toggleInline(view.state, 'code')) },
  {
    key: 'Escape',
    run: (view) => {
      const value = view.state.field(bubbleState, false);
      if (!value?.tooltip) return false;
      view.dispatch({ effects: value.link ? openLink.of(null) : hideBubble.of(true) });
      return true;
    },
  },
]));

const look = EditorView.theme({
  '.cm-tooltip.cm-bubble': {
    background: 'var(--bg-2)', border: '1px solid var(--border-strong)', borderRadius: '8px', boxShadow: 'var(--shadow-2)', padding: '0',
    fontFamily: 'var(--font-sans)', zIndex: '120',
  },
  // a narrow note (the panel beside the tools) folds the bar onto a second row rather than past its edge
  '.cm-bubble-bar': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1px', padding: '3px', maxWidth: 'calc(100vw - 24px)' },
  '.cm-bubble-button': {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', minWidth: '28px', height: '28px', padding: '0 6px',
    border: 'none', borderRadius: '5px', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', font: 'inherit', fontSize: '12.5px',
  },
  '.cm-bubble-button:hover': { background: 'var(--bg-3)', color: 'var(--text-1)' },
  '.cm-bubble-button:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-bubble-button[aria-pressed="true"], .cm-bubble-button.cm-bubble-open': { color: 'var(--accent)', background: 'var(--accent-soft)' },
  '.cm-bubble-glyph': { fontSize: '13px', lineHeight: '1' },
  '.cm-bubble-bold .cm-bubble-glyph': { fontWeight: '800' },
  '.cm-bubble-italic .cm-bubble-glyph': { fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: '14px' },
  '.cm-bubble-heading .cm-bubble-glyph': { fontWeight: '700' },
  '.cm-bubble-code .cm-bubble-glyph': { fontFamily: 'var(--font-mono)', fontSize: '11px' },
  '.cm-bubble-internal': { color: 'var(--internal)' },
  '.cm-bubble-internal[aria-pressed="true"]': { color: 'var(--internal)', background: 'color-mix(in srgb, var(--internal) 18%, transparent)' },
  '.cm-bubble-rule': { width: '1px', height: '18px', margin: '0 4px', background: 'var(--border-strong)', flex: 'none' },
  // the Link field, under the bar
  '.cm-link-field': { width: '500px', maxWidth: '78vw', padding: '2px 8px 8px', boxSizing: 'border-box', borderTop: '1px solid var(--border)' },
  '.cm-link-row': {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px 0 10px', height: '34px', marginTop: '6px', borderRadius: '6px',
    border: '1px solid var(--accent)', background: 'var(--bg-1)',
  },
  '.cm-link-icon': { display: 'flex', color: 'var(--text-3)' },
  '.cm-link-input': {
    flex: '1', minWidth: '0', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
    fontSize: '12.5px',
  },
  '.cm-link-input::placeholder': { color: 'var(--text-3)', fontFamily: 'var(--font-sans)' },
  '.cm-link-answer:not(:empty)': { marginTop: '8px' },
  '.cm-link-card': {
    display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) auto', gap: '10px', alignItems: 'center', padding: '10px 10px 10px 12px',
    borderRadius: '6px', background: 'var(--bg-1)', border: '1px solid var(--border)',
  },
  '.cm-link-found': { borderColor: 'color-mix(in srgb, var(--ok) 35%, var(--border))' },
  '.cm-link-mark': { display: 'flex', color: 'var(--ok)' },
  '.cm-link-none': { color: 'var(--text-3)' },
  '.cm-link-head': { color: 'var(--text-2)', fontSize: '12.5px', lineHeight: '1.35' },
  '.cm-link-head strong': { color: 'var(--text-1)', fontWeight: '650' },
  '.cm-link-facts': { color: 'var(--text-3)', fontSize: '11.5px', lineHeight: '1.4', marginTop: '2px', overflowWrap: 'anywhere' },
  '.cm-link-actions': { display: 'flex', gap: '6px' },
  '.cm-link-button': {
    display: 'inline-flex', alignItems: 'center', gap: '5px', height: '26px', padding: '0 10px', borderRadius: '5px', whiteSpace: 'nowrap',
    border: '1px solid var(--border-strong)', background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer', font: 'inherit', fontSize: '12px',
  },
  '.cm-link-button:hover': { borderColor: 'var(--accent)' },
  '.cm-link-primary': { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-text)', fontWeight: '650' },
  '.cm-link-primary:hover': { background: 'var(--accent-hover)' },
  '.cm-link-remove': { height: '24px', padding: '0 8px', background: 'transparent', color: 'var(--text-2)' },
  '.cm-link-caption': {
    padding: '0 4px 4px', color: 'var(--text-3)', fontSize: '10.5px', fontWeight: '650', letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  '.cm-link-items': { display: 'flex', flexDirection: 'column', gap: '1px', maxHeight: '216px', overflowY: 'auto' },
  '.cm-link-item': {
    display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', gap: '8px', alignItems: 'center', padding: '6px 8px', border: 'none',
    borderRadius: '5px', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', font: 'inherit', fontSize: '12.5px', textAlign: 'left',
  },
  '.cm-link-item[aria-selected="true"], .cm-link-item:hover': { background: 'var(--accent-soft)' },
  '.cm-link-item-icon': { display: 'flex', color: 'var(--text-3)' },
  '.cm-link-item-name': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-link-item-kind': { color: 'var(--text-3)', fontSize: '11px' },
  '.cm-link-empty': { padding: '6px 4px', color: 'var(--text-3)', fontSize: '12px' },
  '.cm-link-foot': { marginTop: '7px', padding: '0 4px', color: 'var(--text-3)', fontSize: '11px' },
});

/** The selection bubble, for the drawn page. */
export const selectionBubble = [selecting, bubbleState, pointer, keys, look];
