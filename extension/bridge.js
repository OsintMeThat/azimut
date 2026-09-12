/**
 * Bridge content script — runs only on the Azimut app's own localhost pages
 * (manifest matches) and does exactly two things:
 *
 *  1. announces the extension to the app (a dataset marker, set at
 *     document_start so it is there before the app mounts, plus a ping
 *     answer for later checks);
 *  2. relays the app's requests to the background worker and hands its answer
 *     back — capture, publish, reverse search, and the two the update
 *     button needs.
 *
 * The app keeps all judgment: registration, cropping, filing. The bridge
 * never touches the backend and never sees the pairing token — the app files
 * same-origin, so this path needs no pairing at all.
 *
 * It is injected twice over: once by the manifest at document_start, and again
 * by the background worker after an update, so an extension that just restarted
 * re-attaches without anyone reloading the page. Hence the generation counter —
 * the newest instance answers and every older one stands down.
 */

(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const VERSION = api.runtime.getManifest().version;
  const CHANNEL = "azimut-capture-ext";

  // Isolated-world global: a re-injection sees the previous instance's number
  // and outranks it. A fresh world starts at 1, which is the same rule.
  const generation = (window.__azimutBridgeGeneration || 0) + 1;
  window.__azimutBridgeGeneration = generation;

  /** Whether this instance is still the one that should answer.
   *
   * Two ways to stop being it: a newer injection took over, or the extension
   * reloaded and left this context invalidated — `runtime.id` is gone at that
   * point, and every relay from here would throw. Standing down silently is the
   * right move either way; the live instance is already answering. */
  const current = () => generation === window.__azimutBridgeGeneration && Boolean(api.runtime?.id);

  const post = (message) => window.postMessage({ channel: CHANNEL, ...message }, location.origin);

  document.documentElement.dataset.azimutCaptureExtension = VERSION;
  // Injected after a reload, the app is already mounted and holding a stale
  // version: say so rather than waiting to be asked.
  post({ type: "bridge-hello", version: VERSION });

  // The popup announces itself when opened on this tab: that click granted
  // activeTab, so the app's Capture button works from now on. Relay it so the
  // app can say "you're set — press Capture again".
  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "app-activated" && current()) post({ type: "activated" });
  });

  // What the app may ask for, and what the answer is called coming back. The
  // worker decides every one of them; nothing here has an opinion.
  const RELAYS = {
    // screen pixels for the Google basemap's Capture button
    capture: { send: () => ({ type: "capture-tab" }), reply: "capture-result" },
    // Geo Report's Publish: the thread, as paths and text. The worker reads the
    // files from the app itself, so nothing of the case and nothing of the
    // pairing token passes through here.
    "post-handoff": {
      send: (msg) => ({ type: "post-handoff", payload: msg.payload }),
      reply: "post-handoff-result",
    },
    // Reverse Search's engine buttons: the prepared image, and the engine page
    // to open with it. The frame comes off a canvas in the app, so unlike the
    // thread above it travels as bytes rather than as a path.
    "reverse-handoff": {
      send: (msg) => ({ type: "reverse-handoff", payload: msg.payload }),
      reply: "reverse-handoff-result",
    },
    // Settings: which copy is this, and which folder was it loaded from
    "ext-state": { send: () => ({ type: "ext-state" }), reply: "ext-state-result" },
    // Settings' Update button, once the app has rewritten the folder
    "ext-reload": {
      send: (msg) => ({ type: "ext-reload", installId: msg.installId }),
      reply: "ext-reload-result",
    },
  };

  window.addEventListener("message", async (event) => {
    // same page, same origin, our channel — nothing else is listened to
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || !current()) return;

    if (msg.type === "ping") {
      post({ type: "pong", id: msg.id, version: VERSION });
      return;
    }

    const relay = RELAYS[msg.type];
    if (!relay) return;
    let result;
    try {
      result = await api.runtime.sendMessage(relay.send(msg));
    } catch (e) {
      result = { ok: false, error: e.message };
    }
    post({ type: relay.reply, id: msg.id, ...result });
  });
})();
