/**
 * Bridge content script — runs only on the Azimut app's own localhost pages
 * (manifest matches) and does exactly two things:
 *
 *  1. announces the extension to the app (a dataset marker, set at
 *     document_start so it is there before the app mounts, plus a ping
 *     answer for later checks);
 *  2. relays the app's Capture requests to the background worker and hands
 *     the captured frame back.
 *
 * The app keeps all judgment: registration, cropping, filing. The bridge
 * never touches the backend and never sees the pairing token — the app files
 * same-origin, so this path needs no pairing at all.
 */

(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const VERSION = api.runtime.getManifest().version;
  const CHANNEL = "azimut-capture-ext";

  document.documentElement.dataset.azimutCaptureExtension = VERSION;

  // The popup announces itself when opened on this tab: that click granted
  // activeTab, so the app's Capture button works from now on. Relay it so the
  // app can say "you're set — press Capture again".
  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "app-activated") {
      window.postMessage({ channel: CHANNEL, type: "activated" }, location.origin);
    }
  });

  window.addEventListener("message", async (event) => {
    // same page, same origin, our channel — nothing else is listened to
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL) return;

    if (msg.type === "ping") {
      window.postMessage(
        { channel: CHANNEL, type: "pong", id: msg.id, version: VERSION },
        location.origin
      );
      return;
    }

    if (msg.type === "capture") {
      let result;
      try {
        result = await api.runtime.sendMessage({ type: "capture-tab" });
      } catch (e) {
        result = { ok: false, error: e.message };
      }
      window.postMessage(
        { channel: CHANNEL, type: "capture-result", id: msg.id, ...result },
        location.origin
      );
    }
  });
})();
