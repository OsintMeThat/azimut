/**
 * Any other HTML block or comment, drawn as the preview reads it. Open, its first
 * line is shown as code. It is read after every other kind of comment (and a line
 * of guidance is the page's own), so a page break or a cover rule is never taken
 * for one.
 */
import { registerBlock } from './blocks.js';
import { blockWidget } from './widgets.js';

registerBlock({
  name: 'html',
  // any other HTML or comment: read after every other kind of comment
  node: ['HTMLBlock', 'CommentBlock'],
  fallback: true,
  read: (node) => ({ from: node.from, to: node.to }),
  widget: blockWidget,
  atomic: true,
  source: (ctx, found) => {
    ctx.line(ctx.state.doc.lineAt(found.from).from, 'cm-code-line');
    return true;
  },
});
