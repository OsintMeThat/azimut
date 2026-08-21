/**
 * End a gesture Konva still believes is running. Its Transformer closes a
 * corner-resize on a window `mouseup` and on nothing else, so a release the
 * page never sees — the button let go outside the window, the tab alt-tabbed
 * away — leaves the resize live. The shape then keeps resizing under a bare
 * pointer with no button held, and the new size is never committed, so what is
 * drawn, the frame around it and the numbers beside it all stop agreeing.
 * Ending it by hand fires the same transformend/dragend the commit path
 * already listens to, so the release still lands.
 *
 * A gesture that ended normally has cleared both flags before this runs, so
 * nothing here touches it.
 */
export function closeStrandedGesture({ transformer, stage, isDragging }) {
  let closed = false;
  if (transformer?.isTransforming()) {
    transformer.stopTransform();
    closed = true;
  }
  // stopTransform releases the anchor it was dragging, so what the sweep finds
  // is a stranded node drag — a panel moved in the composer's free layout, a
  // signature dragged across the template preview.
  if (isDragging()) {
    for (const node of stage.find((n) => n.isDragging())) {
      node.stopDrag();
      closed = true;
    }
  }
  return closed;
}
