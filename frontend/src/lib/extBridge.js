/**
 * App side of the capture-extension bridge (extension/bridge.js).
 *
 * The Google (Maps JS) widget basemap has no tiles to stitch and its DOM
 * imagery is off-limits (IMAGERY_PROVIDERS.md), so its Capture button needs
 * screen pixels. The extension supplies them through one tabs.captureVisibleTab
 * behind the user's click — no share prompt, no sharing bar, fullscreen kept —
 * and this module is the only place the app talks to it.
 *
 * Detection is synchronous: the extension's content script stamps
 * `data-azimut-capture-extension` on <html> at document_start, before the app
 * mounts. Installing the extension with the app already open therefore needs
 * one tab reload — Settings says so next to the install button.
 */

const CHANNEL = 'azimut-capture-ext';

/** The installed extension's version, or null. */
export function extensionVersion(doc = document) {
  return doc.documentElement.dataset.azimutCaptureExtension || null;
}

let seq = 0;

/**
 * One frame of this tab (a PNG data URL), via the extension.
 * Rejects when the extension is absent, silent (timeout) or refused by the
 * browser — the caller owns the user-facing explanation.
 */
export function captureTab({ timeoutMs = 4000, win = window } = {}) {
  return new Promise((resolve, reject) => {
    const id = `cap-${++seq}`;
    const timer = setTimeout(() => {
      win.removeEventListener('message', onMessage);
      reject(new Error('the capture extension did not answer'));
    }, timeoutMs);
    function onMessage(event) {
      // origin is the boundary that matters: the reply must come from our own
      // page (where only our bridge content script posts on this channel).
      // No event.source check — the app hosts no same-origin iframes, and
      // happy-dom (tests) never sets source to the window like browsers do.
      if (event.origin !== win.location.origin) return;
      const msg = event.data;
      if (!msg || msg.channel !== CHANNEL || msg.type !== 'capture-result' || msg.id !== id) return;
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      if (msg.ok && msg.dataUrl) {
        resolve(msg.dataUrl);
      } else {
        const err = new Error(msg.error || 'the capture extension refused');
        // browsers refuse tab screenshots until the extension has been invoked
        // once on the tab (activeTab) — a distinct, one-time, fixable case
        err.needsActivation = !!msg.needsActivation;
        reject(err);
      }
    }
    win.addEventListener('message', onMessage);
    win.postMessage({ channel: CHANNEL, type: 'capture', id }, win.location.origin);
  });
}

/**
 * Subscribe to the extension's "activated" signal: the user just clicked the
 * extension on this tab (granting activeTab), so a previously refused capture
 * can now be retried. Returns an unsubscribe function.
 */
export function onActivated(cb, win = window) {
  const onMessage = (event) => {
    if (event.origin !== win.location.origin) return;
    const msg = event.data;
    if (msg && msg.channel === CHANNEL && msg.type === 'activated') cb();
  };
  win.addEventListener('message', onMessage);
  return () => win.removeEventListener('message', onMessage);
}
