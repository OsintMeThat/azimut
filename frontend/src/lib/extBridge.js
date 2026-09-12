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
 * Hand a prepared image to the extension, which opens the engine and gives it
 * the picture.
 *
 * Same contract as the thread above, and the same reason for the short timeout:
 * the app is holding a click, and a slow no would spend it and open nothing.
 * Resolving means the extension **took** it, never that the engine liked it — it
 * has not opened the tab yet. A rejection means the app still owns the hand-off
 * and does what it always did: open the page, with the image on the clipboard or
 * saved to disk.
 *
 * Unlike the thread, the bytes go through here. What Reverse Search prepares is
 * a frame off a canvas — a video still, adjustments baked in — so there is no
 * path for the extension to read it back from.
 */
export function handOffReverse(payload, { timeoutMs = 2000, win = window } = {}) {
  return new Promise((resolve, reject) => {
    const id = `rev-${++seq}`;
    const timer = setTimeout(() => {
      win.removeEventListener('message', onMessage);
      reject(new Error('the capture extension did not answer'));
    }, timeoutMs);
    function onMessage(event) {
      if (event.origin !== win.location.origin) return;
      const msg = event.data;
      if (!msg || msg.channel !== CHANNEL || msg.type !== 'reverse-handoff-result' || msg.id !== id) return;
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      if (msg.ok) resolve(true);
      else reject(new Error(msg.error || 'the capture extension refused'));
    }
    win.addEventListener('message', onMessage);
    win.postMessage({ channel: CHANNEL, type: 'reverse-handoff', id, payload }, win.location.origin);
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

/**
 * Subscribe to a bridge announcing itself: the manifest injected it at
 * document_start, or the background re-injected it after an update. Either way
 * the version it carries is the one now running. Returns an unsubscribe function.
 */
export function onBridgeHello(cb, win = window) {
  const onMessage = (event) => {
    if (event.origin !== win.location.origin) return;
    const msg = event.data;
    if (msg && msg.channel === CHANNEL && msg.type === 'bridge-hello') cb(msg.version || null);
  };
  win.addEventListener('message', onMessage);
  return () => win.removeEventListener('message', onMessage);
}

/**
 * Every live bridge on this tab, as `[{version}]`.
 *
 * `ping` is the one message every version of the extension has ever answered,
 * which is exactly why detection hangs off it rather than off `ext-state`: a
 * copy installed before the update button existed cannot answer the newer
 * message, and asking only that would report an extension the analyst is plainly
 * running as "not detected".
 *
 * Counting is the other half of its job. Two copies can be loaded at once (see
 * `extensionState`), and a copy too old to identify itself still answers here —
 * so the number of pongs is the honest answer to "how many extensions are on
 * this channel", where the number of `ext-state` replies is only "how many can
 * the app manage".
 *
 * Never rejects: silence means nothing is installed, which is an answer.
 */
export function pingExtensions({ timeoutMs = 700, win = window } = {}) {
  return new Promise((resolve) => {
    const id = `ping-${++seq}`;
    const found = [];
    function onMessage(event) {
      if (event.origin !== win.location.origin) return;
      const msg = event.data;
      if (!msg || msg.channel !== CHANNEL || msg.type !== 'pong' || msg.id !== id) return;
      found.push({ version: msg.version || null });
    }
    win.addEventListener('message', onMessage);
    setTimeout(() => {
      win.removeEventListener('message', onMessage);
      resolve(found);
    }, timeoutMs);
    win.postMessage({ channel: CHANNEL, type: 'ping', id }, win.location.origin);
  });
}

/**
 * Every copy of the extension loaded on this tab that can identify itself, each
 * with the version the browser parsed, its extension id, and the install stamp
 * the *running* code was loaded from (`engine/extinstall.py` writes it; null
 * means a folder the app doesn't own).
 *
 * A copy older than this message answers nothing here. That is not "absent" —
 * `pingExtensions` is what says whether anything is loaded at all.
 *
 * Collects for the whole window instead of resolving on the first answer, which
 * is the one thing this cannot do. Chrome derives the extension id from the
 * folder path, so someone who loads the app-owned copy without removing their old
 * unzip is running two extensions: same name, same channel, same message id, two
 * replies. Resolving on the first would report a coin toss, and the caller needs
 * to know there are two so it can say which to remove.
 *
 * Resolves to `[]` when nothing answers — not installed, or too old to know this
 * message. Never rejects: "no extension" is an answer, not a failure.
 */
export function extensionState({ timeoutMs = 700, win = window } = {}) {
  return new Promise((resolve) => {
    const id = `state-${++seq}`;
    const found = [];
    function onMessage(event) {
      if (event.origin !== win.location.origin) return;
      const msg = event.data;
      if (!msg || msg.channel !== CHANNEL || msg.type !== 'ext-state-result' || msg.id !== id) return;
      if (msg.ok) {
        found.push({
          version: msg.version || null,
          extensionId: msg.extensionId || null,
          loaded: msg.loaded ?? null,
          // "development" for a folder or a temporary add-on, "normal" for a
          // packaged copy the browser manages. Null from a copy predating it.
          installType: msg.installType ?? null,
        });
      }
    }
    win.addEventListener('message', onMessage);
    setTimeout(() => {
      win.removeEventListener('message', onMessage);
      resolve(found);
    }, timeoutMs);
    win.postMessage({ channel: CHANNEL, type: 'ext-state', id }, win.location.origin);
  });
}

/**
 * Ask the copy installed at `installId` to restart, so the browser re-reads the
 * folder the app just rewrote.
 *
 * The `installId` is not decoration: with two copies loaded, an unaddressed
 * reload restarts whichever answers first, which is silent and looks exactly
 * like an update that didn't take. A copy that isn't the one named ignores it.
 *
 * Resolving means the message was *taken*, never that the new code is running —
 * the extension dies mid-reply by design. What proves the update landed is
 * reading the stamp back afterwards, so a timeout here is inconclusive rather
 * than fatal and the caller verifies either way.
 */
export function reloadExtension(installId, { timeoutMs = 2000, win = window } = {}) {
  return new Promise((resolve, reject) => {
    const id = `reload-${++seq}`;
    const timer = setTimeout(() => {
      win.removeEventListener('message', onMessage);
      reject(new Error('the capture extension did not answer'));
    }, timeoutMs);
    function onMessage(event) {
      if (event.origin !== win.location.origin) return;
      const msg = event.data;
      if (!msg || msg.channel !== CHANNEL || msg.type !== 'ext-reload-result' || msg.id !== id) return;
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      if (msg.ok) resolve(true);
      else reject(new Error(msg.error || 'the capture extension refused'));
    }
    win.addEventListener('message', onMessage);
    win.postMessage({ channel: CHANNEL, type: 'ext-reload', id, installId }, win.location.origin);
  });
}
