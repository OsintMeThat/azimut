/**
 * What a press on the drawn words does besides placing the caret: a link pressed with
 * Ctrl (⌘ on a Mac) opens its page, or goes to the heading it names; a callout's name
 * offers the other kinds, a plain quote and text, and an internal passage's its way
 * back to the public edition. A plain press on a link puts the caret in its words, and
 * Ctrl+K edits it (`editor/linkField.js`): the address never shows on the page.
 */
import { EditorView } from '@codemirror/view';

import { CALLOUTS, calloutOf } from '../callouts.js';
import { openBlockMenu } from './blockMenu.js';
import { caretAt } from './caret.js';
import { drawn } from './decorations.js';
import { blockRanges } from './ranges.js';
import { headingWords, makePublic, markInternal, shapeOf, slugOf, turnInto } from './turnInto.js';

/** The line of the heading a `#slug` link names, or null. */
export function headingNamed(state, slug) {
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (/^ {0,3}#{1,6}\s/.test(line.text) && slugOf(headingWords(line.text)) === slug) return line;
  }
  return null;
}

/** Open what a link names: its page in a tab of its own, or the heading of this note it points to. */
export function followLink(view, href) {
  const address = String(href ?? '').trim();
  if (address.startsWith('#')) {
    const line = headingNamed(view.state, decodeURIComponent(address.slice(1)));
    if (!line) return false;
    view.dispatch({ selection: { anchor: caretAt(view.state, line.to) }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }) });
    view.focus();
    return true;
  }
  if (!/^(https?:|mailto:)/i.test(address)) return false;
  window.open(address, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * What a callout's name offers: each kind (the one it is ticked), then a plain quote,
 * text, and Internal; an internal passage offers Make public.
 */
export function calloutEntries(state, block) {
  const now = /^callout:(.+)$/.exec(shapeOf(state, block) ?? '')?.[1];
  if (now === 'internal') {
    return [{ id: 'public', label: 'Make public', icon: 'unlock', hint: 'back in Public', run: (state2) => makePublic(state2, block) }];
  }
  return [
    ...CALLOUTS.filter((one) => one.kind !== 'internal').map((one) => ({
      id: `callout-${one.kind}`, label: one.label, swatch: one.colour, hint: one.hint, checked: now === one.kind,
      run: (state2) => turnInto(state2, block, `callout:${one.kind}`),
    })),
    { separator: true },
    { id: 'turn-quote', label: 'Plain quote', icon: 'quote', run: (state2) => turnInto(state2, block, 'quote') },
    { id: 'turn-paragraph', label: 'Text', icon: 'text', run: (state2) => turnInto(state2, block, 'paragraph') },
    { id: 'internal', label: 'Mark internal', icon: 'lock', hint: 'not in Public', internal: true, run: (state2) => markInternal(state2, block) },
  ];
}

/** Open the menu of the callout whose first line starts at `at`, beside its name. */
export function openCalloutMenu(view, at, anchor) {
  const line = view.state.doc.lineAt(at);
  if (!calloutOf(line.text)) return false;
  const block = blockRanges(view.state).find((one) => one.kind === 'callout' && one.from <= line.from && line.from <= one.to);
  if (!block) return false;
  openBlockMenu(view, block, { anchor: anchor.getBoundingClientRect(), label: 'Callout', entries: calloutEntries(view.state, block) });
  return true;
}

export const pagePresses = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !view.state.field(drawn, false)) return false;
    const label = event.target.closest?.('.cm-callout-label[data-callout-at]');
    if (label) {
      event.preventDefault();
      if (!view.state.readOnly) openCalloutMenu(view, Number(label.dataset.calloutAt), label);
      return true;
    }
    const link = (event.ctrlKey || event.metaKey) ? event.target.closest?.('.cm-link[data-href]') : null;
    if (link) {
      event.preventDefault();
      followLink(view, link.dataset.href);
      return true;
    }
    return false;
  },
});
