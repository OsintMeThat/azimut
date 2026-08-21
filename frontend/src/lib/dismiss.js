/**
 * Close a popover when the pointer goes down anywhere outside it.
 *
 * `pointerdown` rather than `click`: a menu that only closes on a completed click
 * stays open while the press lands on a map or a canvas that swallows the click, and
 * the same press then means two things. Returns the teardown, so the whole use is
 * `$effect(() => open ? closeOnOutsidePointer(element, () => (open = false)) : undefined)`.
 *
 * Several elements may be given, and that is not a nicety: a popover drawn away from
 * the control that opens it — one hung off a heading inside a scroller, say, and
 * rendered outside it so the scroller cannot clip it — has a trigger the press must
 * not count as *outside*, or the click closes and reopens it in one gesture.
 */
export function closeOnOutsidePointer(element, close) {
  if (typeof document === 'undefined') return undefined;
  const parts = (Array.isArray(element) ? element : [element]).filter(Boolean);
  const outside = (event) => {
    if (!parts.some((part) => part.contains(event.target))) close();
  };
  document.addEventListener('pointerdown', outside);
  return () => document.removeEventListener('pointerdown', outside);
}
