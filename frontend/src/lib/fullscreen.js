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

/**
 * `element`, a part of a page rather than a whole tool, on the whole screen and back: the
 * browser's own full screen where it gives one to an element, else `element` covering the
 * window itself, wearing `covered` (its class says how). Esc, the browser's own exit and
 * `toggle(false)` each give it back, Esc before anything else hears it: a page whose Esc
 * already means something keeps it for a second press. `onchange(on)` hears each change.
 * Answers `{ full, toggle(on), destroy }`; `toggle` settles once the screen has changed.
 */
export function holdScreen(element, onchange, { covered = 'is-covering', doc = document } = {}) {
  const win = doc.defaultView ?? globalThis;
  let full = false;
  /** Where the page was while `element` covers the window itself. */
  let cover = null;
  const escape = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    void toggle(false);
  };
  function changed(on) {
    full = on;
    win[on ? 'addEventListener' : 'removeEventListener']('keydown', escape, true);
    onchange(on);
  }
  const follow = () => {
    const on = doc.fullscreenElement === element;
    if (on !== full && !cover) changed(on);
  };
  doc.addEventListener('fullscreenchange', follow);
  function coverWindow() {
    if (full) return;
    cover = { x: win.scrollX ?? 0, y: win.scrollY ?? 0 };
    element.classList.add(covered);
    changed(true);
  }
  function uncover() {
    const { x, y } = cover;
    cover = null;
    element.classList.remove(covered);
    changed(false);
    win.scrollTo?.(x, y);
  }
  function toggle(on = !full) {
    if (on === full) return Promise.resolve();
    if (!on) {
      if (cover) uncover();
      return doc.fullscreenElement === element ? doc.exitFullscreen().catch(() => {}) : Promise.resolve();
    }
    if (typeof element.requestFullscreen === 'function' && doc.fullscreenEnabled !== false) {
      return element.requestFullscreen().catch(coverWindow);
    }
    coverWindow();
    return Promise.resolve();
  }
  return {
    get full() {
      return full;
    },
    toggle,
    destroy() {
      if (cover) uncover();
      else if (doc.fullscreenElement === element) void doc.exitFullscreen().catch(() => {});
      doc.removeEventListener('fullscreenchange', follow);
      win.removeEventListener('keydown', escape, true);
    },
  };
}
