/**
 * Bridge content script — runs only on the Azimut app's own localhost pages
 * (manifest matches) and does exactly two things:
 *
 *  1. announces the extension to the app (a dataset marker, set at
 *     document_start so it is there before the app mounts, plus a ping
 *     answer for later checks);
 *  2. relays the app's requests to the background worker and hands its answer
 *     back — capture, publish, reverse search, and the two the update
 *     button needs — and the ones the worker hands the app: a map panel's
 *     Make the proof, and what a hand-off to X or Bluesky caught or where it
 *     stopped.
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

  // A press on the toolbar button on this tab granted activeTab, so the app's
  // Capture button works from now on. Relay it so the app can say "you're set,
  // press Capture again". The pairing popup's "Open it" asks the app for the
  // Settings tab that holds the token.
  api.runtime.onMessage.addListener((msg) => {
    if (!current()) return;
    if (msg?.type === "app-activated") post({ type: "activated" });
    if (msg?.type === "app-pairing") post({ type: "open-pairing" });
  });

  // A map panel's Make the proof, handed over by the worker (`background.js`,
  // `scene-proof`): the scene goes to the page, and the page's answer back. It comes
  // from the worker only, never from the page, which is why it is not a relay below.
  // A page still loading says nothing, and the worker asks again.
  const ANSWER_MS = 1500;
  const answers = new Map(); // what each scene handed over waits to hear back
  let handed = 0;
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "scene-proof" || !current()) return false;
    const id = `scene-${generation}-${++handed}`;
    const timer = setTimeout(() => reply({ ok: false, error: "Azimut did not answer" }), ANSWER_MS);
    function reply(answer) {
      clearTimeout(timer);
      answers.delete(id);
      sendResponse(answer);
    }
    answers.set(id, reply);
    post({ type: "scene-proof", id, scene: msg.scene });
    return true; // answered once the page has
  });

  // What a hand-off to X or Bluesky tells the app afterwards (`background.js`, "what
  // was sent"): the link of the post just sent, for the app to offer, and where a
  // hand-off stopped. From the worker only, like a scene above, and never relayed
  // from the page. Only the named fields cross, and the page answers nothing.
  const TOLD = {
    "post-link-caught": ["caseId", "draft", "url", "site", "at"],
    "post-handoff-report": ["caseId", "draft", "error", "report"],
  };
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const fields = TOLD[msg?.type];
    if (!fields || !current()) return false;
    post({ type: msg.type, ...Object.fromEntries(fields.map((name) => [name, msg[name] ?? null])) });
    sendResponse({ ok: true });
    return false;
  });

  // What the app may ask for, and what the answer is called coming back. The
  // worker decides every one of them; nothing here has an opinion.
  const RELAYS = {
    // screen pixels for the Google basemap's Capture button
    capture: { send: () => ({ type: "capture-tab" }), reply: "capture-result" },
    // Post's Publish and Reply under the source: the thread, as paths and text, and
    // for a reply the source post's address. The worker reads the
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

  // A map tab's end of the linked views (`background.js`, "linked views"). The
  // app opens it while its map is mounted: panels on other sites hand their
  // cameras over it, and hear this tab's. A port rather than one message per
  // camera, because the worker counts who is on the link by who is connected.
  let link = null;
  let linkWanted = false;
  const LINK_RETRY_MS = 2000;

  function openLink() {
    if (link || !linkWanted || !current()) return;
    try {
      link = api.runtime.connect({ name: "map-link" });
    } catch {
      link = null;
      return;
    }
    link.onMessage.addListener((msg) => {
      if (!current()) return;
      if (msg?.type === "view") post({ type: "map-link-event", kind: "view", view: msg.view });
      if (msg?.type === "link-peers") post({ type: "map-link-event", kind: "peers", count: msg.count });
    });
    // an evicted worker takes the port with it; the next one is a retry away
    link.onDisconnect.addListener(() => {
      link = null;
      if (linkWanted) setTimeout(openLink, LINK_RETRY_MS);
    });
  }

  function onLink(msg) {
    if (msg.kind === "open") {
      linkWanted = true;
      openLink();
    } else if (msg.kind === "close") {
      linkWanted = false;
      try {
        link?.disconnect();
      } catch {
        /* already gone */
      }
      link = null;
    } else if (msg.kind === "view" && link) {
      try {
        link.postMessage({ type: "view", view: msg.view });
      } catch {
        // the port died between the check and the send; the retry reopens it
      }
    }
  }

  window.addEventListener("message", async (event) => {
    // same page, same origin, our channel — nothing else is listened to
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || !current()) return;

    if (msg.type === "ping") {
      post({ type: "pong", id: msg.id, version: VERSION });
      return;
    }
    if (msg.type === "map-link") {
      onLink(msg);
      return;
    }
    if (msg.type === "scene-proof-result") {
      const taken = msg.ok === true;
      answers.get(msg.id)?.(
        taken ? { ok: true } : { ok: false, refused: msg.refused === true, error: String(msg.error || "Azimut refused") }
      );
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
