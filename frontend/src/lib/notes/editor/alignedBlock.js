/**
 * An aligned block: `::: center`, `::: right` or a corner of the cover (`::: top-right`)
 * around lines of text, drawn as it reads. A picture inside takes its place (the
 * page reads `ctx.aligns`). Open, its two fence lines are greyed.
 */
import { BLOCK_OPEN, blockSide } from '../pictureSize.js';
import { registerBlock } from './blocks.js';
import { blockWidget, drawMarkdown } from './widgets.js';

/** The small label a corner block of the cover wears, so the analyst sees it is pinned to the page. */
function cornerTag(name) {
  const tag = document.createElement('div');
  tag.className = `cm-corner-tag cm-corner-${blockSide(name ?? '')}`;
  tag.textContent = `${(name ?? '').replace('-', ' ').replace(/^./, (letter) => letter.toUpperCase())} corner`;
  tag.title = 'Pinned to this corner of page 1 when Look › Cover is Your own page';
  return tag;
}

/**
 * `::: center` … `:::`, the old Notebook's aligned text, drawn as it reads unless it is
 * open. A corner (`::: top-right`) reads as its side, and says so when it is in the
 * note's own cover.
 */
registerBlock({
  name: 'aligned',
  fence: BLOCK_OPEN,
  read: ({ match, first, last }, ctx) => {
    const side = blockSide(match[1]);
    if (side !== 'left') for (let inner = first + 1; inner < last; inner += 1) ctx.aligns.set(inner, side);
    const corner = match[1] !== side;
    return { pinned: corner && last < ctx.coverEnd() };
  },
  widget: blockWidget,
  draw: (box, widget) => {
    drawMarkdown(box, widget);
    if (widget.pinned) box.prepend(cornerTag(BLOCK_OPEN.exec(widget.source.split('\n', 1)[0])?.[1]));
  },
  atomic: true,
});
