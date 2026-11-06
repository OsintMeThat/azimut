/**
 * "Add a scene here", offered on a frame captured in no scene of its clip: the
 * Scenes button is easy to miss when Azimut is new, and the capture is the moment
 * a place is being looked at.
 *
 * One toast at most. A capture while it is up rewrites it in place and points its
 * action at that frame, so quick captures never stack. It goes by on its own, and it
 * keeps quiet a while after it went by unused or after a scene was kept, whichever
 * way. Gone by unused three times on one file, it stops offering for that file.
 */
import { dismissToast, toast, uiState } from './state.svelte.js';

/** How long the offer stays up after its latest capture, in milliseconds. */
export const OFFER_SHOWN = 6000;
/** How long it keeps quiet after going by unused, or after a scene was kept. */
export const OFFER_QUIET = 20000;
/** Gone by unused this many times on one file, it is not offered again there. */
export const OFFER_UNUSED = 3;

export function createSceneOffer({
  show = toast,
  dismiss = dismissToast,
  shown = () => uiState.toasts,
  now = () => Date.now(),
} = {}) {
  let id = null;
  let timer = null;
  let quietUntil = 0;
  let unused = 0;

  const held = () => (id == null ? null : (shown() ?? []).find((t) => t.id === id) ?? null);

  function stop() {
    clearTimeout(timer);
    timer = null;
    if (id != null) dismiss(id);
    id = null;
  }

  function wentBy() {
    stop();
    unused += 1;
    quietUntil = now() + OFFER_QUIET;
  }

  return {
    /**
     * Offer `label` beside `message`, `pick` run when it is pressed. Answers whether
     * it is up.
     */
    offer(message, label, pick) {
      const up = held();
      if (!up && (unused >= OFFER_UNUSED || now() < quietUntil)) return false;
      const action = {
        label,
        onClick: () => {
          clearTimeout(timer);
          timer = null;
          id = null;
          quietUntil = now() + OFFER_QUIET;
          pick();
        },
      };
      if (up) Object.assign(up, { message, action });
      else id = show(message, 'info', 0, action);
      clearTimeout(timer);
      timer = setTimeout(wentBy, OFFER_SHOWN);
      return true;
    },
    /** A scene was kept: the offer goes, and keeps quiet a while. */
    quiet() {
      stop();
      quietUntil = now() + OFFER_QUIET;
    },
    /** Take it down, leaving when it may come back as it was (the tool left). */
    withdraw: stop,
    /** Another file: take it down and start over. */
    reset() {
      stop();
      quietUntil = 0;
      unused = 0;
    },
  };
}
