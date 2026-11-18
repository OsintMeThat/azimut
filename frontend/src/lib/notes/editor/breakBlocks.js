/**
 * The two rules a note draws across the page: where the PDF starts a new page
 * (`<!-- pagebreak -->`) and where the analyst's own cover page ends (`<!-- cover -->`),
 * each a comment alone on its line. Open, the line is shown as written.
 */
import { WidgetType } from '@codemirror/view';

import { PAGE_BREAK_LINE } from '../look.js';
import { COVER_LINE } from '../reportParts.js';
import { registerBlock } from './blocks.js';
import { blockMouse, markPicked } from './widgets.js';

/** Where the PDF starts a new page: a dashed rule, named. Pressing it picks it, a double press opens its line. */
class PageBreakWidget extends WidgetType {
  constructor(picked = false) {
    super();
    this.picked = picked;
  }

  /** The kind of block this draws, as `editor/blocks.js` names it. */
  get blockKind() {
    return 'pagebreak';
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
    box.className = 'cm-pagebreak';
    box.dataset.pagebreak = 'true';
    box.title = 'The PDF starts a new page here. Double-click to edit the line';
    const label = document.createElement('span');
    label.textContent = 'Page break';
    box.append(label);
    blockMouse(view, box, this.picked);
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 30;
  }
}

/** Where the analyst's own first page ends: a rule, named. Pressing it picks it, a double press opens its line. */
class CoverRuleWidget extends WidgetType {
  constructor(picked = false) {
    super();
    this.picked = picked;
  }

  /** The kind of block this draws, as `editor/blocks.js` names it. */
  get blockKind() {
    return 'cover';
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
    box.className = 'cm-pagebreak cm-cover-rule';
    box.dataset.coverRule = 'true';
    box.title = 'Above this line is page 1 when Look › Cover is Your own page. Double-click to edit the line';
    const label = document.createElement('span');
    label.textContent = 'End of the cover page';
    box.append(label);
    blockMouse(view, box, this.picked);
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 30;
  }
}

/** Whether the comment `from`–`to` is a page break (`<!-- pagebreak -->`) alone on its line. */
function pageBreakOn(state, from, to) {
  const line = state.doc.lineAt(from);
  return to <= line.to && PAGE_BREAK_LINE.test(line.text);
}

/** Whether the comment `from`–`to` is the end of the cover page (`<!-- cover -->`) alone on its line. */
function coverRuleOn(state, from, to) {
  const line = state.doc.lineAt(from);
  return to <= line.to && COVER_LINE.test(line.text);
}

/** One comment line read as a block of its own when `test` says it is one. */
function commentLine(test) {
  return (node, { state }) => {
    const line = state.doc.lineAt(node.from);
    return test(state, node.from, node.to) ? { from: line.from, to: line.to } : null;
  };
}

const pageBreakSource = (ctx, found) => {
  ctx.line(found.from, 'cm-pagebreak-line');
  return true;
};

registerBlock({
  name: 'pagebreak',
  node: 'CommentBlock',
  read: commentLine(pageBreakOn),
  widget: (spec) => new PageBreakWidget(spec.picked),
  atomic: true,
  source: pageBreakSource,
});

registerBlock({
  name: 'cover',
  node: 'CommentBlock',
  read: commentLine(coverRuleOn),
  widget: (spec) => new CoverRuleWidget(spec.picked),
  atomic: true,
  source: pageBreakSource,
});
