// A tool on the whole screen, and the overlays that have to follow it there.
//
// The Fullscreen API paints *only* the fullscreen element's subtree, so an
// overlay parked on <body> (modals, confirms, toasts) is simply invisible while
// a tool is fullscreen — the click lands, nothing shows. Reparenting the
// overlay under the current fullscreen element keeps it on screen, and moving
// it back on exit keeps the non-fullscreen case unchanged.

/** The element a viewport-level overlay must be parented to, to be visible. */
export function overlayHost(doc = document) {
  return doc.fullscreenElement ?? doc.body;
}

/**
 * Svelte action: keep `node` parented to the current overlay host, following
 * the browser in and out of fullscreen for as long as the node lives.
 */
export function portal(node, doc = document) {
  let host = null;

  function place() {
    const next = overlayHost(doc);
    if (next && next !== host) {
      host = next;
      host.appendChild(node);
    }
  }

  place();
  doc.addEventListener('fullscreenchange', place);

  return {
    destroy() {
      doc.removeEventListener('fullscreenchange', place);
      node.remove();
    },
  };
}

/**
 * Hand `element` the whole screen, or give it back. Rejects when the browser
 * refuses, so the tool can say so.
 */
export async function toggleFullscreen(element, doc = document) {
  if (doc.fullscreenElement) await doc.exitFullscreen().catch(() => {});
  else await element.requestFullscreen();
}

/**
 * Tell `onchange` whether `element` holds the screen, each time that changes.
 * Esc leaves fullscreen without asking the page, so a tool reads its state back
 * from here rather than flipping a flag itself. Returns the unsubscribe.
 */
export function followFullscreen(element, onchange, doc = document) {
  const changed = () => onchange(doc.fullscreenElement === element);
  doc.addEventListener('fullscreenchange', changed);
  return () => doc.removeEventListener('fullscreenchange', changed);
}

/** Give the screen back, if anything holds it. */
export function leaveFullscreen(doc = document) {
  if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
}
