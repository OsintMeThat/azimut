/**
 * Where a floating menu goes: under what opened it, or at the pointer for a
 * right-click, and always whole inside the window. A menu too tall for the
 * room under or over its opener goes beside it, on the side with more room.
 *
 * A menu that opens inside a scrolling panel is cut by it, however it is
 * aligned, so these menus float over the page and are placed here instead.
 */

/** How far a menu keeps from the window's edge, and from what opened it. */
export const MARGIN = 8;
export const GAP = 4;
/** The least room under its opener a panel kept there (`below`) scrolls in before it goes elsewhere. */
export const MIN_BELOW = 240;

/**
 * `anchor`: the opener's box, `{ left, top, right, bottom }`; `at`: a pointer's
 * `{ x, y }` instead. `size` is the menu's `{ width, height }`, `viewport` the
 * window's `{ width, height }`. `align: 'end'` lines the menu's right edge up
 * with the opener's, for an opener near a panel's right side. `below` keeps a panel
 * under its opener, as tall as the room there and scrolled inside, never beside it: the
 * Look beside the note's Page pane, which has to stay in view while it is changed.
 * `clear` is the left edge of what it must leave in view on its right (that Page pane):
 * the panel moves left of it as far as the window lets it.
 */
export function placeFloating({ anchor = null, at = null, size, viewport, align = 'start', below = false, clear = null }) {
  const width = Math.min(size.width, viewport.width - 2 * MARGIN);
  const room = viewport.height - 2 * MARGIN;
  const height = Math.min(size.height, room);
  const clampLeft = (value) => Math.round(Math.max(MARGIN, Math.min(value, viewport.width - MARGIN - width)));
  if (below && anchor && !at && viewport.height - MARGIN - (anchor.bottom + GAP) >= MIN_BELOW) {
    const top = anchor.bottom + GAP;
    let left = align === 'end' ? anchor.right - width : anchor.left;
    if (Number.isFinite(clear) && left + width > clear - GAP) left = clear - GAP - width;
    return { left: clampLeft(left), top: Math.round(top),
      maxHeight: Math.round(viewport.height - MARGIN - top) };
  }
  let left, top;
  if (at) {
    left = at.x;
    top = at.y + height > viewport.height - MARGIN ? at.y - height : at.y;
  } else if (anchor) {
    const below = viewport.height - MARGIN - (anchor.bottom + GAP);
    const above = anchor.top - GAP - MARGIN;
    const before = anchor.left - GAP - MARGIN;
    const after = viewport.width - MARGIN - (anchor.right + GAP);
    if (height > below && height > above && Math.max(before, after) >= width) {
      // Beside, level with the opener as far as the window lets it, so neither is covered.
      left = before >= after ? anchor.left - GAP - width : anchor.right + GAP;
      top = (anchor.top + anchor.bottom - height) / 2;
    } else {
      left = align === 'end' ? anchor.right - width : anchor.left;
      // Downward unless the menu would not fit there and fits better above.
      top = height <= below || below >= above ? anchor.bottom + GAP : anchor.top - GAP - height;
    }
  } else {
    left = (viewport.width - width) / 2;
    top = (viewport.height - height) / 2;
  }
  return {
    left: clampLeft(left),
    top: Math.round(Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - height))),
    maxHeight: Math.round(room),
  };
}
