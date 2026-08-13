/**
 * Close a popover when the pointer goes down anywhere outside it.
 *
 * `pointerdown` rather than `click`: a menu that only closes on a completed click
 * stays open while the press lands on a map or a canvas that swallows the click, and
 * the same press then means two things. Returns the teardown, so the whole use is
 * `$effect(() => open ? closeOnOutsidePointer(element, () => (open = false)) : undefined)`.
 */
export function closeOnOutsidePointer(element, close) {
  if (typeof document === 'undefined') return undefined;
  const outside = (event) => {
    if (!element?.contains(event.target)) close();
  };
  document.addEventListener('pointerdown', outside);
  return () => document.removeEventListener('pointerdown', outside);
}
