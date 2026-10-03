// Which overlay answers the Escape key.
//
// Escape is heard on the window, so without a shared order every open overlay answers one
// press: a confirmation opened from inside a modal — removing a relation without losing the
// entity window that sent you there — would close both and take the work with it. Only the
// last one opened acts, which is what Escape means to whoever pressed it.
//
// Modals and confirmations share this one stack rather than keeping their own, because they
// nest in both directions and a per-component stack cannot see the other kind.
//
// A plain array and not `$state`: it is read when a key is pressed, never while rendering,
// and a reactive array that an effect both pushes to and depends on is an effect that
// re-runs itself for good.
const stack = [];

/** Each overlay's way out, the one Escape takes. */
const closers = new WeakMap();

/**
 * Join the stack, and leave it when the caller is torn down.
 *
 * `self` is any stable object identity; the caller keeps it and passes it back to
 * `isTopOverlay`. `close` is what Escape does to it, so the browser's Back can do the
 * same (lib/backButton.js). Returns the cleanup, so it reads as the body of an `$effect`.
 */
export function joinOverlays(self, close = null) {
  stack.push(self);
  if (close) closers.set(self, close);
  return () => {
    const at = stack.indexOf(self);
    if (at !== -1) stack.splice(at, 1);
  };
}

/** True when `self` is the overlay a key press belongs to. */
export function isTopOverlay(self) {
  return stack.at(-1) === self;
}

/**
 * Close the overlay on top, as Escape would. Answers whether one was open: one that
 * cannot be closed this way still holds the screen, and is left as it is.
 */
export function closeTopOverlay() {
  const top = stack.at(-1);
  if (!top) return false;
  closers.get(top)?.();
  return true;
}
