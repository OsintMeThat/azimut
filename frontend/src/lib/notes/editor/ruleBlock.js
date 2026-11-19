/**
 * A divider (`---`, `***`), drawn as the line across the page it prints as. It is a
 * block like a page break: a press picks it, Backspace or Delete takes it out whole,
 * the arrows step over it and what is typed at it starts a paragraph after it, so its
 * three marks never show and are never typed into. Open, its line is shown as written.
 */
import { WidgetType } from '@codemirror/view';

import { registerBlock } from './blocks.js';
import { blockMouse, markPicked } from './widgets.js';

class RuleBlockWidget extends WidgetType {
  constructor(picked = false) {
    super();
    this.picked = picked;
  }

  /** The kind of block this draws, as `editor/blocks.js` names it. */
  get blockKind() {
    return 'rule';
  }

  eq(other) {
    return other.picked === this.picked;
  }

  updateDOM(dom, _view, previous) {
    if (!previous) return false;
    markPicked(dom, this.picked);
    return true;
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = 'cm-rule-block';
    box.dataset.rule = 'true';
    box.title = 'A line across the page. Double-click to edit it';
    box.append(Object.assign(document.createElement('hr'), { className: 'cm-rule' }));
    blockMouse(view, box, this.picked);
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 24;
  }
}

registerBlock({
  name: 'rule',
  node: 'HorizontalRule',
  // a divider alone on its line, or alone in a quote's
  read: (node, { state }) => {
    const line = state.doc.lineAt(node.from);
    return /^[\s>]*$/.test(state.sliceDoc(line.from, node.from)) && !state.sliceDoc(node.to, line.to).trim() ? { from: line.from, to: line.to } : null;
  },
  widget: (spec) => new RuleBlockWidget(spec.picked),
  atomic: true,
  source: (ctx, found) => {
    ctx.line(found.from, 'cm-pagebreak-line');
    return true;
  },
  theme: {
    '.cm-rule-block': { position: 'relative', padding: '8px var(--note-gutter, 32px)', cursor: 'text' },
    '.cm-rule-block .cm-rule': { border: 'none', borderTop: '1px solid var(--border-strong)', margin: '0' },
    '.cm-rule-block > .cm-source-edit': { top: '-4px' },
    '.cm-rule-block:hover > .cm-source-edit, .cm-rule-block.cm-picked > .cm-source-edit': { opacity: '1', pointerEvents: 'auto' },
  },
});
