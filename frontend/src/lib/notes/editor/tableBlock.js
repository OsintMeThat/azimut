/**
 * A table, drawn whole as the preview reads it. Open, its lines are the pipes in a
 * fixed type.
 */
import { registerBlock } from './blocks.js';
import { blockWidget } from './widgets.js';

registerBlock({
  name: 'table',
  node: 'Table',
  read: (node) => ({ from: node.from, to: node.to }),
  widget: blockWidget,
  atomic: true,
  source: (ctx, found) => {
    ctx.lines(found.from, found.to, 'cm-table-line');
    return true;
  },
});
