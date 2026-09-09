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

/**
 * Is `bundled` a newer extension than `installed`? Numeric per-part compare, so
 * 0.1.10 beats 0.1.9 and a `v` prefix or pre-release suffix doesn't fool it.
 * False when either side is missing — nothing to update to, or nothing to
 * update. Mirrors the app-side check in engine/updates.py.
 */
export function extensionOutdated(installed, bundled) {
  if (!installed || !bundled) return false;
  const parse = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(bundled), parse(installed)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
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
 * Hand a prepared thread to the extension, which opens the composer and fills it.
 *
 * Resolves when the extension **takes** it, not when it has finished: filling is
 * tens of seconds — a tab, a composer mounting, a file at a time — and the answer
 * needed here is only whether the app should stand down. What the fill managed is
 * reported by the extension's own notifications.
 *
 * A rejection is not a failure to report: it means the app still owns the
 * hand-off and opens the intent page itself, exactly as it does with no extension
 * installed. Absent, switched off, not permitted on that site, silent: one
 * answer, one fallback.
 *
 * Hence the short timeout. It is a question with three cheap checks behind it,
 * and the caller is holding a click — a browser only lets a page open a tab for a
 * few seconds after one, so a slow no would spend the click and open nothing. An
 * old extension that has never heard of this message answers by staying silent,
 * which is exactly the case the timeout is short for.
 *
 * Nothing but paths crosses this channel. The extension fetches the bytes from
 * the local app with its own pairing token, so no case file is ever posted into
 * the page, and the token never reaches the app's DOM.
 */
export function handOffPost(payload, { timeoutMs = 2000, win = window } = {}) {
  return new Promise((resolve, reject) => {
    const id = `post-${++seq}`;
    const timer = setTimeout(() => {
      win.removeEventListener('message', onMessage);
      reject(new Error('the capture extension did not answer'));
    }, timeoutMs);
    function onMessage(event) {
      if (event.origin !== win.location.origin) return;
      const msg = event.data;
      if (!msg || msg.channel !== CHANNEL || msg.type !== 'post-handoff-result' || msg.id !== id) return;
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      if (msg.ok) resolve(true);
      else reject(new Error(msg.error || 'the capture extension refused'));
    }
    win.addEventListener('message', onMessage);
    win.postMessage({ channel: CHANNEL, type: 'post-handoff', id, payload }, win.location.origin);
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
