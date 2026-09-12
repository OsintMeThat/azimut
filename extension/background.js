/**
 * Background worker: the only place pixels are grabbed.
 *
 * Chrome runs this as an MV3 service worker, Firefox as an event page (the
 * manifest declares both) — so it is a classic script with no imports, no DOM,
 * and no in-memory state that matters: anything that must survive a worker
 * restart lives in storage.session.
 *
 * Every capture is one captureVisibleTab behind one explicit user action
 * (repo legal rails): the popup's buttons, or the Azimut app's own Capture
 * button relayed by bridge.js. Nothing here is schedulable or repeatable
 * without a fresh user gesture.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const APP_ORIGINS = ["http://127.0.0.1", "http://localhost"];
const isAppUrl = (url) => APP_ORIGINS.some((o) => url === o || url?.startsWith(o + ":") || url?.startsWith(o + "/"));

function settings() {
  return api.storage.local
    .get({ backendUrl: "http://127.0.0.1:8477", token: "", lastCaseId: "" })
    .then((s) => ({ ...s, backendUrl: s.backendUrl.replace(/\/+$/, "") }));
}

function captureActiveTab(windowId) {
  // promise-form works on both browsers in MV3
  return api.tabs.captureVisibleTab(windowId, { format: "png" });
}

/** Crop a captured frame (dataURL) to a viewport-CSS-px rect. The scale is
 * measured (image width / viewport width), not assumed from devicePixelRatio,
 * so browser zoom can't silently shift the crop — same rule as the app. */
async function cropDataUrl(dataUrl, rect, viewportW) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = bmp.width / viewportW;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(bmp.width - sx, Math.round(rect.w * scale));
  const sh = Math.min(bmp.height - sy, Math.round(rect.h * scale));
  if (sw < 8 || sh < 8) throw new Error("selection too small");
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.convertToBlob({ type: "image/png" });
}

/** File one screenshot with the backend (POST /api/ingest/screenshot). */
async function ingest(blob, meta) {
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("not paired. Open the extension options and paste the token from Azimut Settings");
  // Thin on purpose: image + URL is a complete capture — the app parses the
  // URL itself (site, coordinates, title, imagery date). Everything else here
  // is either the user's popup corrections or plain context.
  const form = new FormData();
  form.append("image", blob, "screenshot.png");
  form.append("url", meta.url);
  form.append("case_id", meta.caseId || "");
  if (meta.title) form.append("title", meta.title);
  for (const k of ["lat", "lon", "zoom", "bearing"]) {
    if (meta[k] !== null && meta[k] !== undefined && meta[k] !== "") form.append(k, String(meta[k]));
  }
  form.append("captured_at", new Date().toISOString());
  form.append("extension", api.runtime.getManifest().version);
  let r;
  try {
    r = await fetch(`${backendUrl}/api/ingest/screenshot`, {
      method: "POST",
      headers: { "X-Azimut-Token": token },
      body: form,
    });
  } catch {
    throw new Error(`Azimut is not reachable at ${backendUrl}. Is the app running?`);
  }
  if (r.status === 401) throw new Error("pairing token rejected. Pair again in the extension options");
  if (!r.ok) throw new Error(`Azimut refused the capture (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const body = await r.json();
  // Remember where this capture landed — including a freshly minted scratch
  // (body.case_id), so repeated captures reuse it instead of minting one each.
  if (body.case_id || meta.caseId) {
    api.storage.local.set({ lastCaseId: body.case_id || meta.caseId });
  }
  return body;
}

// --- post hand-off: fill a composer the app prepared ----------------------------
//
// The app never posts, and neither does this: the thread is typed into the site's
// own composer and left there. Everything below is a layer over the path that
// already worked (the app opens the intent page, the thread is on the clipboard),
// so every failure returns rather than throws a user into a dead end.
//
// There is one switch and it lives in Azimut (Settings → Publishing): the app
// asks or it does not, and this side has no opinion to add. A second box here
// would be two answers to one question, and the pair that disagrees is the one
// nobody can find.

/** One handed-over file, fetched from the app and carried as base64: what
 *  crosses into the page is a string, and the page turns it back into a file.
 *  Base64 rather than a `data:` URL because the page rebuilds it with `atob` —
 *  a fetch over there answers to the site's CSP, and X refuses that one. */
async function fetchAttachment(backendUrl, token, caseId, path) {
  const url = fileUrl(backendUrl, caseId, path);
  const r = await fetch(url, { headers: { "X-Azimut-Token": token } });
  // Gone, too big, refused: the file is skipped and counted, never fatal. It is
  // in the case, and attaching it by hand is what the analyst did before.
  if (!r.ok) return null;
  const blob = await r.blob();
  return {
    name: path.split("/").pop(),
    type: blob.type || "application/octet-stream",
    data: await base64(blob),
  };
}

/** One case attachment, addressed. */
function fileUrl(backendUrl, caseId, path) {
  return (
    `${backendUrl}/api/ingest/file?case_id=${encodeURIComponent(caseId)}` +
    `&path=${encodeURIComponent(path)}`
  );
}

/** A blob as base64. What crosses into a page is a string: a message carries no
 *  blob, and both sides rebuild the file from this. */
async function base64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000; // fromCharCode takes an argument list: chunk it or blow the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Resolve once the tab has finished loading, so the injection lands on a page. */
function tabLoaded(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = () => {
      api.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    // Not an error path: the composer is an app that keeps loading after the
    // document does, and the injected script waits for it anyway.
    const timer = setTimeout(done, timeoutMs);
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") done();
    }
    api.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * Say yes or no, now, and do the work afterwards.
 *
 * The app is holding a click while it waits for this, and a browser only lets a
 * page open a tab for a few seconds after one. So the answer here has to be about
 * whether the hand-off is *taken* — one cheap check — and never about how it
 * went: opening a tab, waiting for a composer to mount and attaching six files is
 * tens of seconds, and waiting that long to say no would spend the click on
 * nothing and leave the analyst pressing a dead button.
 *
 * Everything after the answer reports itself through notifications.
 */
async function handOff(payload) {
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("not paired");
  fillComposer(payload, backendUrl, token).catch((e) =>
    notify("Azimut hand-off", `${e.message} The thread is on your clipboard.`)
  );
  return { ok: true, accepted: true };
}

async function fillComposer(payload, backendUrl, token) {
  let skipped = 0;
  const posts = [];
  for (const post of payload.posts ?? []) {
    const files = [];
    for (const path of post.files ?? []) {
      const file = await fetchAttachment(backendUrl, token, payload.caseId, path);
      if (file) files.push(file);
      else skipped += 1;
    }
    posts.push({ text: post.text ?? "", files });
  }
  if (skipped) {
    notify(
      "Azimut hand-off",
      `${skipped} file${skipped > 1 ? "s" : ""} could not be handed over. Attach ${skipped > 1 ? "them" : "it"} from the case.`
    );
  }

  const tab = await api.tabs.create({ url: payload.url, active: true });
  await tabLoaded(tab.id);
  // Both injections run in the page's own world, which is the only place a
  // composer accepts what we make (see handoff.js). Nothing over there can call
  // an extension API, so the thread goes in on a global and the report comes back
  // as the script's return value.
  const target = { tabId: tab.id };
  await api.scripting.executeScript({
    target,
    world: "MAIN",
    func: (thread) => {
      window.__AZIMUT_HANDOFF__ = thread;
    },
    args: [{ posts }],
  });
  const [done] = await api.scripting.executeScript({
    target,
    world: "MAIN",
    files: ["handoff.js"],
  });
  if (done?.result?.error) {
    notify("Azimut hand-off", `${done.result.error} The thread is on your clipboard.`);
  }
}

// --- reverse hand-off: give one prepared image to a reverse-image engine --------
//
// Reverse Search's engine buttons, when the app asks. The same shape as the
// composer above — the app is answered at once and the work reports itself
// through notifications — with one difference that is worth saying out loud:
// **these pages search as soon as they hold a picture.** The composer is filled
// and left; an engine is asked. Both are one press of one button in the app, and
// neither happens without it.
//
// The bytes arrive from the app rather than being fetched from it: what Reverse
// Search hands over is a frame off a canvas — a video still, adjustments baked
// in — which exists nowhere on disk to be read back.

/** The largest image this will carry into a page, in base64 characters.
 *
 *  A ceiling the app applies first (lib/reverseSearch.js) and this one re-checks,
 *  because a message that big is a worker holding tens of megabytes to no end:
 *  every one of these engines refuses the upload long before this. */
const MAX_REVERSE_DATA = 28 * 1024 * 1024;

async function handOffReverse(payload) {
  const image = payload.image ?? {};
  if (!image.data) throw new Error("no image");
  if (image.data.length > MAX_REVERSE_DATA) throw new Error("that image is too large to hand over");
  if (!payload.url) throw new Error("no engine");
  fillEngine(payload.url, image).catch((e) => {
    if (!LEFT.test(e.message || "")) trouble(e.message);
  });
  return { ok: true, accepted: true };
}

/**
 * Say what went wrong in a sentence the analyst can act on.
 *
 * A browser grants the hosts a manifest declares **when it loads the copy**, and
 * an extension cannot ask for one later. So a copy loaded before this feature
 * existed refuses the injection with a sentence about manifests, which reads
 * like a bug in the app and is fixed by one reload. Everything else is passed
 * through as it came.
 */
function trouble(message) {
  const stale = /permission|access contents of the page/i.test(message);
  notify(
    "Azimut reverse search",
    stale
      ? "This extension was loaded before Azimut knew these engines. Reload it in your browser, then press the engine again. The image is on your clipboard."
      : `${message} The image is on your clipboard.`
  );
}

/** A page that left rather than a page that refused.
 *
 *  An engine that takes the picture searches with it, and the injected script
 *  goes with the document it was running in — so "the frame is gone" is what
 *  success looks like from here, and it arrives as an error. Reporting it would
 *  put a failure notice on top of the results the analyst asked for. */
const LEFT = /frame|no longer exists|destroyed|navigat|context invalidated/i;

async function fillEngine(url, image) {
  const tab = await api.tabs.create({ url, active: true });
  await tabLoaded(tab.id);
  // Both injections run in the page's own world, which is the only place an
  // uploader takes what we make (see reverse.js). Nothing over there can call an
  // extension API, so the image goes in on a global and the report comes back as
  // the script's return value.
  const target = { tabId: tab.id };
  await api.scripting.executeScript({
    target,
    world: "MAIN",
    func: (handed) => {
      window.__AZIMUT_REVERSE__ = handed;
    },
    args: [{ image }],
  });
  const [done] = await api.scripting.executeScript({
    target,
    world: "MAIN",
    files: ["reverse.js"],
  });
  if (done?.result?.error) trouble(done.result.error);
}

// --- the folder this copy was loaded from ---------------------------------------
//
// The app owns that folder (engine/extinstall.py) and stamps install.json into
// it, so the question "is the extension this browser loaded the copy I control"
// has an answer. Read from the background rather than the content script: in
// Chrome a content-script fetch answers to the *page's* origin, so reading an own
// resource that isn't web-accessible would be refused. It is deliberately not
// web-accessible — no page has business reading it.

/** The stamp as it was when this extension last loaded.
 *
 * Cached in storage.session on purpose, and that is the whole design: a fresh
 * read of install.json reports the *folder*, which the app has already rewritten
 * by the time it asks, so it would answer "up to date" whether or not this code
 * ever restarted. storage.session survives a worker eviction and is cleared when
 * the extension unloads, so what it holds is what the running code was installed
 * from — the one claim worth verifying an update against.
 *
 * The manifest version can't play that role: within a development cycle it is
 * already the app's own version and never moves when the bytes do.
 */
let loadedStampPromise = null;

function loadedStamp() {
  if (!loadedStampPromise) loadedStampPromise = readLoadedStamp();
  return loadedStampPromise;
}

async function readLoadedStamp() {
  const seeded = await api.storage.session.get("loadedStamp");
  if (seeded.loadedStamp !== undefined) return seeded.loadedStamp;
  let stamp = null;
  try {
    const r = await fetch(api.runtime.getURL("install.json"));
    if (r.ok) stamp = await r.json();
  } catch {
    // No stamp: loaded from a folder the app doesn't own, which is a state the
    // app reports rather than an error.
  }
  // `null` is a real answer and has to be stored as one, or every later call
  // re-reads a file that isn't there.
  await api.storage.session.set({ loadedStamp: stamp });
  return stamp;
}

/** How the browser installed this copy: "development" for a folder or a
 * temporary add-on, "normal" for a packaged one it manages itself.
 *
 * Firefox refuses an unsigned extension outside the developer channels, so a
 * permanent Firefox install is a signed XPI — sealed, with no install.json and
 * nothing the app could rewrite. Without this, such a copy looks exactly like an
 * old manual unzip, and Settings would tell the analyst to remove the only
 * install their browser will keep.
 *
 * `management.getSelf` needs no permission. Null where it is unavailable, which
 * reads as "cannot tell" rather than as a claim.
 */
async function installType() {
  try {
    return (await api.management.getSelf()).installType ?? null;
  } catch {
    return null;
  }
}

/** Re-attach the bridge to the app's own tabs.
 *
 * Neither browser re-injects content scripts after an extension reloads, so
 * without this the app's tab keeps an orphaned bridge and the analyst is told to
 * reload the page — a manual step in the feature whose point is removing one.
 * Runs on every worker start; injecting twice is handled on the bridge side.
 */
async function reattachBridge() {
  try {
    const tabs = await api.tabs.query({ url: APP_ORIGINS.map((o) => `${o}/*`) });
    for (const tab of tabs) {
      api.scripting
        .executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] })
        .catch(() => {});
    }
  } catch {
    // A tab we may not inject is the pre-existing "reload this tab" case.
  }
}

function notify(title, message) {
  // fire-and-forget: a failed toast must never fail a filed capture
  try {
    api.notifications.create({
      type: "basic",
      iconUrl: api.runtime.getURL("icons/icon128.png"),
      title,
      message: String(message).slice(0, 300),
    });
  } catch {
    /* notifications are best-effort */
  }
}

// --- the map tools -------------------------------------------------------------
//
// The panel runs as a content script on someone else's map, so its own fetch
// would carry that site's origin — which the app refuses, exactly as it should
// (`server.py`, the local guard). Every call it makes is relayed here instead
// and goes out as the extension.
//
// The allowlist is the point. This worker holds the pairing token, and a relay
// that forwarded any path would hand the whole ingest surface to whatever ends
// up running in a map tab. These are the routes the four tools need and nothing
// else. The nudge stream is not among them and never should be: it is one answer
// that never ends, and it is read below rather than relayed.
const MAP_ROUTES = new Set([
  "/api/ingest/ping",
  "/api/ingest/cases",
  "/api/ingest/parse",
  "/api/ingest/saved",
  "/api/ingest/sky",
  "/api/ingest/grids",
  "/api/ingest/grid",
  "/api/ingest/grid/marks",
  "/api/ingest/place",
  "/api/ingest/media",
]);

//. Injected in this order: each one reads the globals the ones before it left.
const MAP_FILES = [
  "mapmath.js",
  "maptheme.js",
  "maptools.js",
  "mapdraw.js",
  "mapref.js",
  "mapoverlay.js",
];

async function mapApi(msg) {
  if (!MAP_ROUTES.has(msg.path)) throw new Error(`the map tools may not call ${msg.path}`);
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("not paired. Open the extension options and paste the token from Azimut Settings");

  const url = new URL(backendUrl + msg.path);
  for (const [key, value] of Object.entries(msg.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  const init = { method: msg.method || "GET", headers: { "X-Azimut-Token": token } };
  if (msg.body && msg.form) {
    const form = new FormData();
    for (const [key, value] of Object.entries(msg.body)) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }
    init.body = form;
  } else if (msg.body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(msg.body);
  }

  let r;
  try {
    r = await fetch(url, init);
  } catch {
    throw new Error("Azimut is not answering. Is the app running?");
  }
  if (r.status === 401) throw new Error("pairing token rejected. Pair again in the extension options");
  const text = await r.text();
  if (!r.ok) {
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {
      // a proxy or a crash can answer with something that is not JSON
    }
    throw new Error(typeof detail === "string" ? detail : `the app refused: ${r.status}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * One of the case's files, for a reference window (`extension/mapref.js`).
 *
 * Not `mapApi`: that one parses what comes back as JSON, and this is bytes. The
 * route is written in rather than allowlisted — the panel may ask for a file
 * from the case it has open and for nothing else, and the app's own fence
 * (`api/ingest.py`, ``handoff_file``) is what says which files those are.
 */
async function mapFile(caseId, path) {
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("not paired. Open the extension options and paste the token from Azimut Settings");
  if (!caseId) throw new Error("no case open");
  let r;
  try {
    r = await fetch(fileUrl(backendUrl, caseId, path), { headers: { "X-Azimut-Token": token } });
  } catch {
    throw new Error("Azimut is not answering. Is the app running?");
  }
  if (!r.ok) throw new Error(await refusal(r));
  const blob = await r.blob();
  return { type: blob.type || "application/octet-stream", data: await base64(blob) };
}

/** Why the app would not hand a file over, in its own words where it gave any —
 *  the size ceiling is stated there, and a second copy of the number here is a
 *  number that goes stale. */
async function refusal(r) {
  if (r.status === 401) return "pairing token rejected. Pair again in the extension options";
  let detail = "";
  try {
    detail = JSON.parse(await r.text()).detail;
  } catch {
    // a proxy or a crash can answer with something that is not JSON
  }
  return typeof detail === "string" && detail ? detail : `the app refused that file (${r.status})`;
}

/** How long the panel is given to say it has left the frame. */
const PANEL_ANSWER_MS = 500;

/**
 * Take the panel out of the frame, grab, put it back.
 *
 * `captureVisibleTab` photographs the page as it is composited, and the map
 * tools panel — reference windows and all — is on it. A tab with no panel
 * open does not answer, which is not an error, and the panel is shown again
 * whatever the grab did.
 */
async function withoutPanel(tabId, grab) {
  const tell = async (hide) => {
    try {
      // The panel applies it on receipt and only *answers* a frame later, so a
      // wait that runs out costs a frame of certainty and never a hidden panel.
      // Unbounded, it would be a Capture button that spins for good.
      await Promise.race([
        api.tabs.sendMessage(tabId, { type: "map-chrome", hide }),
        new Promise((resolve) => setTimeout(resolve, PANEL_ANSWER_MS)),
      ]);
    } catch {
      // no panel on this tab to answer, which is the usual case
    }
  };
  await tell(true);
  try {
    return await grab();
  } finally {
    await tell(false);
  }
}

// --- the nudge stream ----------------------------------------------------------
//
// A panel draws a case it is also being worked from elsewhere: the app's own map
// on one screen, this panel over a site's map on another, a second panel on a
// third. Every one of them writes to the same files, and before this each only
// ever saw what it had asked for — a point filed in the app appeared on a panel
// the next time it was opened, which is a page reload in a feature whose point is
// not needing one.
//
// So the app's own nudge channel is read here (`api/events.py`) and handed to the
// panels. Here rather than in each panel, for three reasons: a content script's
// fetch carries the map site's origin, which the app's local guard refuses; it
// could not hold the pairing token if it wanted to; and ten tabs on one map would
// otherwise be ten streams for one bus.
//
// Not through `mapApi`: that relay parses what comes back as one JSON answer, and
// this response never ends.

const SYNC_PORT = "map-sync";
/** How long to wait before re-opening a stream that dropped, and the ceiling it
 *  backs off to. The app being restarted is the ordinary case, so the first
 *  retry is quick and a long outage costs one attempt a minute. */
const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 60000;

/** The panels listening, one port each. A port dies with its tab, which is what
 *  makes this the count of panels actually open. */
const panels = new Set();
let streamRun = 0; // generation: a retry from a stream that was stopped stands down
let streamAbort = null;
let pumping = false;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One SSE frame as an event, or null.
 *
 * The bus writes `: ping` comments as keepalive and one `data:` line per event
 * (`api/events.py`). Anything else — a comment, a frame that is not our JSON — is
 * a nudge that never happened, and a missed nudge costs a refresh.
 */
function frameEvent(frame) {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function fanOut(event) {
  for (const port of panels) {
    try {
      port.postMessage({ type: "app-event", event });
    } catch {
      // the tab went while this was in hand; its disconnect is already queued
    }
  }
}

/** Hold the stream open, handing every event to the panels, until it ends. */
async function readEvents(run) {
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("not paired");
  const controller = new AbortController();
  streamAbort = controller;
  const r = await fetch(`${backendUrl}/api/ingest/events`, {
    headers: { "X-Azimut-Token": token },
    signal: controller.signal,
  });
  if (r.status === 401) throw new Error("pairing token rejected");
  if (!r.ok || !r.body) throw new Error(`the app refused the event stream (${r.status})`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (run === streamRun) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    // frames are separated by a blank line, and a chunk can hold part of one
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const event = frameEvent(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      if (event) fanOut(event);
      cut = buffer.indexOf("\n\n");
    }
  }
}

/**
 * Keep a stream open while any panel is listening.
 *
 * Every failure here is the same failure — the app is not running, or not
 * running yet — and the answer to it is to try again later rather than to tell
 * anybody: the panel already says what it cannot reach, on the errand it was
 * asked to run. What it must not do is spin: hence the backoff, and the
 * generation check that stops a retry belonging to a stream nobody wants.
 */
async function pumpEvents() {
  if (pumping) return;
  pumping = true;
  const run = streamRun;
  let wait = FIRST_RETRY_MS;
  try {
    while (run === streamRun && panels.size) {
      try {
        await readEvents(run);
        wait = FIRST_RETRY_MS; // it was open once, so the app is there
      } catch {
        // not reachable, not paired, or refused — the retry is the whole answer
      }
      if (run !== streamRun || !panels.size) return;
      await pause(wait);
      wait = Math.min(MAX_RETRY_MS, wait * 2);
    }
  } finally {
    if (run === streamRun) pumping = false;
  }
}

/** Nothing left listening: let the stream go rather than hold a request open
 *  against an app nobody is watching. */
function stopEvents() {
  streamRun += 1;
  pumping = false;
  try {
    streamAbort?.abort();
  } catch {
    /* already gone */
  }
  streamAbort = null;
}

api.runtime.onConnect.addListener((port) => {
  if (port.name !== SYNC_PORT) return;
  panels.add(port);
  // The panel says so every so often (`mapoverlay.js`). Two things ride on it:
  // this worker is kept from being evicted mid-sweep, and a stream that died
  // with an eviction is opened again without anyone touching the panel.
  port.onMessage.addListener(() => pumpEvents());
  port.onDisconnect.addListener(() => {
    panels.delete(port);
    if (!panels.size) stopEvents();
  });
  pumpEvents();
});

// --- message routes ------------------------------------------------------------

async function handle(msg, sender) {
  // The Azimut app's own Capture button (bridge.js relay): return the raw
  // frame — the app does its own registration, cropping and filing. Only the
  // app's localhost origin may ask for it.
  if (msg.type === "capture-tab") {
    if (!sender.tab || !isAppUrl(sender.tab.url)) return { ok: false, error: "not the Azimut app" };
    try {
      const dataUrl = await withoutPanel(sender.tab.id, () => captureActiveTab(sender.tab.windowId));
      return { ok: true, dataUrl };
    } catch (e) {
      // captureVisibleTab needs activeTab (or <all_urls>, which this extension
      // deliberately never asks for) — a page-initiated capture is refused
      // until the user has invoked the extension once on this tab. Tell the
      // app which case this is, so it can explain the one-time step.
      const needsActivation = /activeTab|all_urls|permission/i.test(e.message || "");
      return { ok: false, needsActivation, error: e.message };
    }
  }

  // Popup: arm an area selection on the page. The popup closes right after,
  // so the meta waits in storage.session for the overlay's rect.
  if (msg.type === "start-area-select") {
    try {
      await api.storage.session.set({ [`pending:${msg.tabId}`]: msg.meta });
      await api.scripting.executeScript({ target: { tabId: msg.tabId }, files: ["overlay.js"] });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Overlay: the user finished (or cancelled) the drag.
  if (msg.type === "area-selected" || msg.type === "area-cancelled") {
    const key = `pending:${sender.tab.id}`;
    const meta = (await api.storage.session.get(key))[key];
    await api.storage.session.remove(key);
    if (msg.type === "area-cancelled" || !meta) return { ok: true };
    try {
      const dataUrl = await withoutPanel(sender.tab.id, () => captureActiveTab(sender.tab.windowId));
      const blob = await cropDataUrl(dataUrl, msg.rect, msg.viewportW);
      const body = await ingest(blob, meta);
      notify("Capture filed into Azimut", body.title);
      return { ok: true };
    } catch (e) {
      notify("Azimut capture failed", e.message);
      return { ok: false, error: e.message };
    }
  }

  // The app's Publish button, relayed by bridge.js: open the composer and fill
  // the thread. Same origin check as the capture route — only the app may ask.
  if (msg.type === "post-handoff") {
    if (!sender.tab || !isAppUrl(sender.tab.url)) return { ok: false, error: "not the Azimut app" };
    try {
      return await handOff(msg.payload ?? {});
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // The app's Reverse Search buttons, relayed by bridge.js: open the engine and
  // give it the image. Same origin check as every other app route.
  if (msg.type === "reverse-handoff") {
    if (!sender.tab || !isAppUrl(sender.tab.url)) return { ok: false, error: "not the Azimut app" };
    try {
      return await handOffReverse(msg.payload ?? {});
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Popup: draw the map tools over this tab. Injecting the panel a second time
  // closes it, which is what makes one button both open and close.
  if (msg.type === "map-tools") {
    try {
      await api.scripting.executeScript({ target: { tabId: msg.tabId }, files: MAP_FILES });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // The panel, asking the app something. Content scripts cannot call it
  // themselves; see the relay above.
  if (msg.type === "map-api") {
    try {
      return { ok: true, data: await mapApi(msg) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // The panel, asking for one of the case's files — bytes rather than JSON.
  if (msg.type === "map-file") {
    try {
      return { ok: true, file: await mapFile(msg.caseId, msg.path) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Settings asking what this copy is: the version the browser parsed, and the
  // folder stamp this code was loaded from. Only the app's own origin may ask —
  // same rule as every other route relayed by the bridge.
  if (msg.type === "ext-state") {
    if (!sender.tab || !isAppUrl(sender.tab.url)) return { ok: false, error: "not the Azimut app" };
    return {
      ok: true,
      version: api.runtime.getManifest().version,
      // Not `id`: the bridge spreads this answer next to the message's own
      // correlation id, and a collision there would break the pairing silently.
      extensionId: api.runtime.id,
      loaded: await loadedStamp(),
      installType: await installType(),
    };
  }

  // Settings' Update button, after the app has rewritten the folder: restart so
  // the browser re-reads it.
  //
  // Answering *before* reloading is not a nicety. reload() kills this worker at
  // once, so a handler that reloads first never replies and the app is left
  // holding a rejected port. And the reply is only "taken", never "worked": what
  // proves the code moved is the stamp read back afterwards.
  if (msg.type === "ext-reload") {
    if (!sender.tab || !isAppUrl(sender.tab.url)) return { ok: false, error: "not the Azimut app" };
    const stamp = await loadedStamp();
    // Two copies of this extension can be loaded at once on Chrome, which
    // derives the extension id from the folder path (see the app's Settings
    // copy). The message names the install the app means; the other copy must
    // keep its hands down, because restarting the wrong one is silent and looks
    // exactly like a failed update.
    if (msg.installId && msg.installId !== stamp?.install_id) {
      return { ok: false, error: "another copy of the extension" };
    }
    setTimeout(() => api.runtime.reload(), 50);
    return { ok: true, reloading: true };
  }

  return { ok: false, error: `unknown message '${msg.type}'` };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true; // async response
});

// Worker start — including the one right after ext-reload, which is the point.
reattachBridge();
