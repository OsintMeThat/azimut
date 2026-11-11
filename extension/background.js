/**
 * Background worker: the only place pixels are grabbed.
 *
 * Chrome runs this as an MV3 service worker, Firefox as an event page (the
 * manifest declares both) — so it is a classic script with no imports, no DOM,
 * and no in-memory state that matters: anything that must survive a worker
 * restart lives in storage.session.
 *
 * Every capture is one captureVisibleTab behind one explicit user action
 * (repo legal rails): the map panel's Capture, the notes panel's Capture (which
 * first tries one it throws away, to learn whether the browser allows it), or
 * the Azimut app's own Capture button relayed by bridge.js. Nothing here is
 * schedulable or repeatable without a fresh user gesture.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

// The notes panel's helpers (`notesmsg.js`), the map hosts (`mapsites.js`) and the
// checks on a sent post's link (`postlink.js`). Firefox's event page has them already,
// listed before this file in the manifest; Chrome's worker loads them here.
if (typeof importScripts === "function") {
  if (typeof AzimutNotes === "undefined") importScripts("notesmsg.js");
  if (typeof AzimutMapSites === "undefined") importScripts("mapsites.js");
  if (typeof AzimutPostLink === "undefined") importScripts("postlink.js");
}

const APP_ORIGINS = ["http://127.0.0.1", "http://localhost"];
const isAppUrl = (url) => APP_ORIGINS.some((o) => url === o || url?.startsWith(o + ":") || url?.startsWith(o + "/"));

/**
 * Whether a tab is the paired Azimut, not merely something on localhost.
 *
 * The bridge runs on every loopback port, so a dev server or any other local page
 * can post to it. The routes that open tabs, capture the screen or stream case files
 * answer only the page served from the port this extension is paired with.
 * `localhost` and `127.0.0.1` are the same machine, so either name passes.
 */
async function isPairedApp(url) {
  if (!isAppUrl(url)) return false;
  const { backendUrl } = await settings();
  try {
    const tab = new URL(url);
    const app = new URL(backendUrl);
    return isAppUrl(app.origin) && tab.port === app.port && tab.protocol === app.protocol;
  } catch {
    return false;
  }
}

/**
 * Why a tab may not use the routes only the app may ask for, or null when it may.
 *
 * A loopback page on another port is most often this same Azimut, started while
 * another program held its port and moved to the next free one. "Not the app" would
 * leave the analyst nowhere, so the answer says what to change.
 */
async function notTheApp(tab) {
  if (!tab || !isAppUrl(tab.url)) return "not the Azimut app";
  if (await isPairedApp(tab.url)) return null;
  return `this extension is paired with another address. In its options, set the Azimut URL to ${new URL(tab.url).origin}`;
}

// Where the app's hand-offs may take a tab: the posting sites and the reverse image
// engines it offers. Anything else in a hand-off is refused, whoever asked.
const HANDOFF_HOSTS = new Set(["x.com", "bsky.app", "lens.google.com", "yandex.com", "www.bing.com", "tineye.com"]);
// A post's own page on a posting site, the one a reply under it opens: an X status
// or a Bluesky post, as the app writes their address (lib/post.js `replyTarget`).
const REPLY_PAGE =
  /^https:\/\/(?:x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}|bsky\.app\/profile\/[^/?#\s]{1,253}\/post\/[A-Za-z0-9]{1,64})$/;
const handOffAllowed = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && HANDOFF_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

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
 * so browser zoom can't silently shift the crop — same rule as the app.
 *
 * Returns the crop *and* that scale: the crop keeps the frame's own pixels, so
 * the file holds `scale` of them per CSS pixel, and a zoom describes CSS
 * pixels. Anything the app draws with a distance on it needs the ratio, or a
 * scale bar on a 2× screen states twice the ground it covers. */
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
  return { blob: await canvas.convertToBlob({ type: "image/png" }), scale };
}

/**
 * What a filed capture says about the scene the case is geolocating, if any.
 *
 * While a scene is being geolocated the app attaches every capture filed in the
 * case to it, and its answer names the scene (`api/ingest.py`). Said where the
 * capture is reported, so a capture never lands somewhere the analyst was not told.
 */
function attachedTo(body) {
  const scene = body?.scene;
  if (!scene || typeof scene !== "object") return "";
  const label = typeof scene.label === "string" ? scene.label.trim().slice(0, 120) : "";
  return label ? `Attached to “${label}”.` : "Attached to the scene being geolocated.";
}

/** One capture's report: its title, then whatever the app had to say about it. */
function filedLine(body) {
  const notice = typeof body?.notice === "string" && body.notice ? body.notice : "";
  const head = notice ? `${body.title}. ${notice}` : body?.title ?? "";
  const attached = attachedTo(body);
  if (!attached) return head;
  return head ? `${head}${/[.!?…]$/.test(head) ? "" : "."} ${attached}` : attached;
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
  if (meta.marks) {
    form.append("scale_north", "true");
    form.append("device_scale", String(meta.deviceScale || 1));
  }
  form.append("captured_at", new Date().toISOString());
  form.append("extension", api.runtime.getManifest().version);
  // the map's own credit line, read off the page: the selection rarely holds it
  if (typeof meta.screenCredit === "string" && meta.screenCredit.trim()) {
    form.append("screen_credit", meta.screenCredit.trim().slice(0, 400));
  }
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

/**
 * Draw the area selection (`overlay.js`) on a tab. What to file the rectangle as
 * waits in storage.session, since whoever asked may be gone by the time the drag
 * ends in "area-selected".
 *
 * The selection's own bar offers the scale bar and north arrow, and the bearing
 * the arrow needs: they belong to the capture being drawn, so they are asked
 * there rather than before it. The bar starts from the tick as it was last left
 * and from the bearing the address gave, handed over before the overlay runs.
 */
async function armAreaSelect(tabId, meta) {
  const { captureMarks } = await api.storage.local.get({ captureMarks: false });
  const asked = { ...meta, marks: typeof meta.marks === "boolean" ? meta.marks : Boolean(captureMarks) };
  await api.storage.session.set({ [`pending:${tabId}`]: asked });
  await api.scripting.executeScript({
    target: { tabId },
    func: (options) => {
      window.__azimutAreaOptions = options;
    },
    args: [{ marks: asked.marks, bearing: Number.isFinite(asked.bearing) ? asked.bearing : null }],
  });
  await api.scripting.executeScript({ target: { tabId }, files: ["overlay.js"] });
}

/**
 * What the selection's bar said, over what the capture was armed with: the tick,
 * and the bearing typed or cleared. A bar that was not drawn says nothing, and a
 * bearing outside a turn is no bearing.
 */
function toldByBar(meta, msg) {
  const told = { ...meta };
  if (typeof msg.marks === "boolean") told.marks = msg.marks;
  if (msg.bearing === null) told.bearing = null;
  else if (Number.isFinite(msg.bearing) && msg.bearing >= 0 && msg.bearing < 360) told.bearing = msg.bearing;
  return told;
}

/** File the page in front as a bookmark: a saved link, nothing downloaded. */
async function fileBookmark(url, title, caseId) {
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("Not paired yet. Press the Azimut button to pair it");
  const form = new FormData();
  form.append("url", url);
  form.append("case_id", caseId || "");
  if (title) form.append("title", title.slice(0, 200));
  let r;
  try {
    r = await fetch(`${backendUrl}/api/ingest/bookmark`, {
      method: "POST",
      headers: { "X-Azimut-Token": token },
      body: form,
    });
  } catch {
    throw new Error(`Azimut is not reachable at ${backendUrl}. Is the app running?`);
  }
  if (!r.ok) throw new Error(await refusal(r, "the bookmark"));
  return r.json();
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

/**
 * Put one case attachment into the composer page a slice at a time.
 *
 * `executeScript` still needs a serializable string, but the string is now one
 * 4 MB slice rather than the whole video. The page decodes each slice at once
 * and keeps only byte arrays for the final `File`, so a long clip answers to the
 * app's 512 MB hand-off ceiling rather than an extension-only 48 MB ceiling.
 * The page itself never fetches the local URL, which keeps this path independent
 * of X's and Bluesky's content-security policies.
 */
async function streamAttachment(target, backendUrl, token, caseId, path, id) {
  let offset = 0;
  while (true) {
    const part = await fileChunk(backendUrl, token, caseId, path, offset);
    await api.scripting.executeScript({
      target,
      world: "MAIN",
      func: (fileId, type, data) => {
        const thread = window.__AZIMUT_HANDOFF__;
        const file = thread?.posts
          ?.flatMap((post) => post.files ?? [])
          .find((candidate) => candidate.id === fileId);
        if (!file) throw new Error("handed-over file disappeared");
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        file.type = type || file.type;
        file.parts.push(bytes);
      },
      args: [id, part.type, part.data],
    });
    if (part.next === null) return;
    if (part.next <= offset) throw new Error("Azimut returned an empty file slice");
    offset = part.next;
  }
}

/** Leave no partial file in the page when one of its slices was refused. */
async function discardAttachment(target, id) {
  await api.scripting.executeScript({
    target,
    world: "MAIN",
    func: (fileId) => {
      const thread = window.__AZIMUT_HANDOFF__;
      for (const post of thread?.posts ?? []) {
        post.files = (post.files ?? []).filter((file) => file.id !== fileId);
      }
    },
    args: [id],
  });
}

/** One case attachment, addressed. */
function fileUrl(backendUrl, caseId, path) {
  return (
    `${backendUrl}/api/ingest/file?case_id=${encodeURIComponent(caseId)}` +
    `&path=${encodeURIComponent(path)}`
  );
}

/** Bytes as base64, in bounded pieces that can cross an injection boundary. */
function encode(bytes) {
  let binary = "";
  const CHUNK = 0x8000; // fromCharCode takes an argument list: chunk it or blow the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** A small blob as base64. Large files go through `fileChunk` instead. */
async function base64(blob) {
  return encode(new Uint8Array(await blob.arrayBuffer()));
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
  // A reply under the source opens that post's own page rather than a new post, and
  // presses its reply there (handoff.js). A message without one is the thread it
  // always was, opened where it always opened.
  let target = payload;
  if (payload.reply_to !== undefined) {
    if (typeof payload.reply_to !== "string" || !REPLY_PAGE.test(payload.reply_to)) {
      throw new Error("not a post Azimut replies under");
    }
    target = { ...payload, url: payload.reply_to, reply: true };
  }
  // The draft the thread came from, handed back with whatever this hand-off tells
  // the app (a link caught, a report), so the app knows which post it is about.
  const draft = payload.draft ?? null;
  if (draft !== null && !(typeof draft === "string" && draft.length > 0 && draft.length <= 200)) {
    throw new Error("not a draft Azimut knows");
  }
  if (!handOffAllowed(target.url)) throw new Error("not a site Azimut posts to");
  fillComposer({ ...target, draft }, backendUrl, token).catch((e) =>
    notify("Azimut hand-off", `${e?.message} The thread is on your clipboard.`)
  );
  return { ok: true, accepted: true };
}

/**
 * Open the composer and fill it. Never throws: every way this ends is told to the
 * analyst in a notification and, when it stops short, to the app in a report.
 *
 * A thread goes into the composer in one go. A reply in several posts asks first
 * whether the reply box offers a next post: with one, the rest follows in the same
 * box; without one (X's reply box has none), the rest goes out one reply at a time
 * (`nextReply`). Either way the tab is then followed for the link of what was sent
 * (`postlink.js`), which the app is offered once.
 */
async function fillComposer(payload, backendUrl, token) {
  const site = globalThis.AzimutPostLink?.siteOf(payload.url) ?? null;
  const hand = {
    id: crypto.randomUUID(),
    tabId: null,
    site,
    host: hostOf(payload.url),
    caseId: typeof payload.caseId === "string" ? payload.caseId : null,
    draft: payload.draft ?? null,
    posts: (payload.posts ?? []).map((post) => ({
      text: String(post?.text ?? ""),
      files: Array.isArray(post?.files) ? post.files.filter((path) => typeof path === "string") : [],
    })),
    reply: payload.reply === true,
    chain: false, // the posts go out one reply at a time
    done: 0, // posts filled so far
    phase: "filling", // "filling", "waiting" for the analyst's press, or "opening" the next
    seen: [], // record keys already used: the source, then each reply
    sent: false, // the link went to the app
    reading: false, // postlink.js runs on the page
  };
  let step = "open-tab";
  try {
    const tab = await api.tabs.create({ url: payload.url, active: true });
    hand.tabId = tab.id;
    await tabLoaded(tab.id);
    if (site) {
      const source = hand.reply ? AzimutPostLink.keyOf(site, payload.url) : null;
      if (source) hand.seen.push(source);
      (await watchBook()).set(tab.id, hand);
      armWatch(hand);
      await follow(hand);
    }
    // A reply of several posts fills its first, then says whether the box offers
    // a next post; the files of the rest are not carried until it is known where.
    const ask = hand.reply && hand.posts.length > 1;
    step = "inject";
    const thread = hand.reply ? (ask ? { reply: true, ask: true } : { reply: true }) : {};
    const first = await fillPosts(hand, ask ? hand.posts.slice(0, 1) : hand.posts, thread, backendUrl, token);
    if (first.error) {
      return failHandOff(hand, { step, ...first, keep: !ask && first.filled > 0 });
    }
    if (ask && !(first.filled >= 1)) {
      return failHandOff(hand, { step: "fill-1", error: "The reply box did not answer." });
    }
    if (!ask) {
      hand.done = hand.posts.length;
      return await inLine(() => waitForLink(hand));
    }
    if (first.add) {
      const rest = await fillPosts(
        hand,
        hand.posts.slice(1),
        { more: true, number: 2, carried: hand.posts[0].files.length > 0 },
        backendUrl,
        token
      );
      if (rest.error) return failHandOff(hand, { step, ...rest, keep: true });
      hand.done = hand.posts.length;
      return await inLine(() => waitForLink(hand));
    }
    return await inLine(() => startChain(hand));
  } catch (e) {
    const gone = hand.tabId !== null && (await tabGone(hand.tabId));
    return failHandOff(hand, {
      step,
      error: gone ? "The tab was closed before the thread was in." : e?.message || "The composer refused the thread.",
      gone,
    });
  }
}

/**
 * Hand these posts to the page and run the filler on them; its report comes back.
 *
 * Both injections run in the page's own world, which is the only place a composer
 * accepts what we make (see handoff.js). Nothing over there can call an extension
 * API, so the posts go in on a global, their file parts follow, and the report
 * comes back as the script's return value.
 */
async function fillPosts(hand, posts, thread, backendUrl, token) {
  const target = { tabId: hand.tabId };
  const plans = [];
  const handed = posts.map((post, postIndex) => ({
    text: post.text ?? "",
    files: (post.files ?? []).map((path, fileIndex) => {
      const id = `${postIndex}:${fileIndex}`;
      plans.push({ id, path });
      return {
        id,
        name: path.split("/").pop(),
        type: "application/octet-stream",
        parts: [],
      };
    }),
  }));
  await api.scripting.executeScript({
    target,
    world: "MAIN",
    func: (given) => {
      window.__AZIMUT_HANDOFF__ = given;
    },
    args: [{ posts: handed, ...thread }],
  });

  let skipped = 0;
  for (const plan of plans) {
    try {
      await streamAttachment(target, backendUrl, token, hand.caseId, plan.path, plan.id);
    } catch {
      skipped += 1;
      await discardAttachment(target, plan.id).catch(() => {});
    }
  }
  if (skipped) {
    notify(
      "Azimut hand-off",
      `${skipped} file${skipped > 1 ? "s" : ""} could not be handed over. Attach ${skipped > 1 ? "them" : "it"} from the case.`
    );
  }

  const [done] = await api.scripting.executeScript({
    target,
    world: "MAIN",
    files: ["handoff.js"],
  });
  return done?.result ?? {};
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Whether the browser no longer has this tab. */
async function tabGone(tabId) {
  try {
    await api.tabs.get(tabId);
    return false;
  } catch {
    return true;
  }
}

// --- what was sent: the post's link, and a reply in several posts --------------
//
// Once the composer is filled the analyst presses Post (or Reply), and the site
// says so in a toast that links to the post. `postlink.js` reads that link on the
// tab this hand-off opened, and nowhere else; the app is offered it once, for the
// post's Link field, and decides nothing until the analyst does.
//
// A reply in several posts needs that link to go on. X's reply box has no "+", so
// the rest of the thread cannot wait in it: each post goes out under the one before,
// one press each. The analyst presses Reply; the link of what they sent opens that
// reply's page; its reply button opens the next box, and the next post goes in. The
// extension presses nothing that sends, and nothing at all to find a link.
//
// A hand-off being followed is kept in storage.session, since the worker may be
// put to sleep while the analyst reads what they are about to send. It ends with
// the thread, after ten minutes without a post, or with the tab.

const WATCH_KEY = "postWatches";
const WATCH_MS = 10 * 60 * 1000;
/** The steps a report may name. */
const REPORT_STEP = /^(?:open-tab|inject|open-reply|open-composer|catch-link|(?:fill|add)-\d{1,3})$/;
/** A test id the report may carry: one plain word, never an avatar's with a handle in it. */
const REPORT_TEST_ID = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;

let watchMemo = null; // tabId → hand-off, mirrored in storage.session
const watchTimers = new Map();
let watchLine = Promise.resolve();

/** One thing at a time: a press, a closed tab and a timeout can arrive together. */
function inLine(work) {
  const run = watchLine.then(work, work);
  watchLine = run.catch(() => {});
  return run;
}

async function watchBook() {
  if (!watchMemo) {
    let stored = null;
    try {
      stored = (await api.storage.session.get({ [WATCH_KEY]: null }))?.[WATCH_KEY];
    } catch {
      // nothing kept: nothing to follow
    }
    watchMemo ??= new Map(Object.entries(stored ?? {}).map(([tabId, hand]) => [Number(tabId), hand]));
  }
  return watchMemo;
}

function keepWatches() {
  try {
    Promise.resolve(api.storage.session.set({ [WATCH_KEY]: Object.fromEntries(watchMemo ?? []) })).catch(() => {});
  } catch {
    // the hand-off goes on in memory; a restart in the middle loses it
  }
}

/** Start the ten minutes of a step over: a fresh post is looked for from now. */
function armWatch(hand) {
  hand.since = Date.now();
  hand.deadline = hand.since + WATCH_MS;
  clearTimeout(watchTimers.get(hand.tabId));
  const timer = setTimeout(() => inLine(() => expireWatch(hand.tabId, hand.id)), WATCH_MS);
  timer?.unref?.();
  watchTimers.set(hand.tabId, timer);
  keepWatches();
}

/** Put the link reader on the page the hand-off is on. */
async function follow(hand) {
  const target = { tabId: hand.tabId };
  try {
    await api.scripting.executeScript({ target, files: ["postlink.js"] });
    await api.scripting.executeScript({
      target,
      func: (config) => globalThis.AzimutPostLink?.watch(config) ?? false,
      args: [{ watch: hand.id, site: hand.site, since: hand.since, seen: hand.seen, deadline: hand.deadline }],
    });
    hand.reading = true;
  } catch {
    // no reader: the composer is filled all the same, and the link is the analyst's to paste
    hand.reading = false;
  }
  keepWatches();
}

/** Ask the reader on the page something: `ping`, `probe` or `stop`. Null when it is gone. */
async function askReader(hand, ask) {
  try {
    const answer = await api.tabs.sendMessage(hand.tabId, { type: "post-watch", watch: hand.id, ask });
    return answer?.alive === true ? answer : null;
  } catch {
    return null;
  }
}

/** The hand-off is over: stop following it. */
function endWatch(hand, { gone = false } = {}) {
  if (watchMemo?.get(hand.tabId)?.id === hand.id) watchMemo.delete(hand.tabId);
  clearTimeout(watchTimers.get(hand.tabId));
  watchTimers.delete(hand.tabId);
  keepWatches();
  if (!gone && hand.reading) askReader(hand, "stop");
}

/** Everything is in the composer: wait for the analyst's press and its link. */
async function waitForLink(hand) {
  // a tab closed while it was being filled was let go then; this is the step that hears of it
  if (!hand.reading || (await tabGone(hand.tabId))) return endWatch(hand, { gone: true });
  hand.phase = "waiting";
  keepWatches();
}

/** The reply box offers no next post: fill the rest one reply at a time. */
async function startChain(hand) {
  const total = hand.posts.length;
  if (await tabGone(hand.tabId)) {
    return failHandOff(hand, {
      step: "catch-link",
      stopped: "closed",
      error: `The tab was closed, so Azimut stopped after post 1 of ${total}.`,
      gone: true,
    });
  }
  if (!hand.reading) {
    return failHandOff(hand, {
      step: "catch-link",
      error: `Azimut could not follow this page, so it stopped after post 1 of ${total}.`,
    });
  }
  hand.chain = true;
  hand.done = 1;
  hand.phase = "waiting";
  keepWatches();
  notify("Azimut hand-off", `Post 1 of ${total} is ready. Press Reply, then Azimut opens the next under it.`);
  // The analyst was quicker than the question about a next post.
  if (hand.pending) {
    const url = hand.pending;
    delete hand.pending;
    await nextReply(hand, url);
  }
}

/**
 * The reader saw a post of the analyst's. The app hears of the first one; a reply
 * in several posts goes on under each.
 */
async function linkSeen(tabId, id, url) {
  const hand = (await watchBook()).get(tabId);
  if (!hand || hand.id !== id || !handOffAllowed(url)) return;
  const at = AzimutPostLink.sentAt(hand.site, url);
  const key = AzimutPostLink.keyOf(hand.site, url);
  const now = Date.now();
  const fresh =
    at !== null && Math.abs(at - now) <= AzimutPostLink.FRESH_MS && at >= hand.since - AzimutPostLink.SKEW_MS;
  if (!fresh || hand.seen.includes(key)) return;
  if (!hand.sent) {
    hand.sent = true;
    keepWatches();
    tellApp({
      type: "post-link-caught",
      caseId: hand.caseId,
      draft: hand.draft,
      url,
      site: hand.site,
      at: new Date(at).toISOString(),
    });
  }
  if (hand.phase === "filling") {
    hand.pending ??= url;
    keepWatches();
    return;
  }
  if (!hand.chain || hand.done >= hand.posts.length) return endWatch(hand);
  if (hand.phase === "waiting") await nextReply(hand, url);
}

/** Resolve once the tab has loaded the page it was sent to (or after a while). */
function pageLoaded(tabId, url, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let left = false;
    const done = () => {
      api.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    // A page that pushes its own address says "complete" too: only the load of
    // the page asked for counts.
    function onUpdated(id, info, tab) {
      if (id !== tabId) return;
      if (info?.status === "loading") left = true;
      if (info?.status === "complete" && (left || !tab || tab.url === url)) done();
    }
    api.tabs.onUpdated.addListener(onUpdated);
  });
}

/** Open the reply the analyst just sent, and fill the next post under it. */
async function nextReply(hand, url) {
  const number = hand.done + 1;
  const total = hand.posts.length;
  hand.phase = "opening";
  hand.seen.push(AzimutPostLink.keyOf(hand.site, url));
  keepWatches();
  const { backendUrl, token } = await settings();
  let step = "open-reply";
  try {
    const loaded = pageLoaded(hand.tabId, url);
    await api.tabs.update(hand.tabId, { url });
    await loaded;
    armWatch(hand);
    await follow(hand);
    step = `fill-${number}`;
    const done = await fillPosts(hand, [hand.posts[number - 1]], { reply: true, number }, backendUrl, token);
    if (done.error) return failHandOff(hand, done);
  } catch (e) {
    const gone = await tabGone(hand.tabId);
    return failHandOff(hand, {
      step,
      error: gone ? `The tab was closed, so Azimut stopped after post ${hand.done} of ${total}.` : e?.message,
      gone,
    });
  }
  hand.done = number;
  notify("Azimut hand-off", `Post ${number} of ${total} is ready under your reply.`);
  if (number >= total) return endWatch(hand);
  hand.phase = "waiting";
  keepWatches();
}

/** Ten minutes without a post: a thread stops following, a reply in several posts stops. */
async function expireWatch(tabId, id) {
  const hand = (await watchBook()).get(tabId);
  if (!hand || hand.id !== id || hand.phase !== "waiting") return;
  if (Date.now() < hand.deadline - 1000) return; // a reader from an earlier step
  if (!hand.chain) return endWatch(hand);
  const link = (await askReader(hand, "probe"))?.counts ?? null;
  const probe = await probePage(hand.tabId);
  return failHandOff(hand, {
    step: "catch-link",
    stopped: "timeout",
    error: `No reply was seen within 10 minutes, so Azimut stopped after post ${hand.done} of ${hand.posts.length}.`,
    probe,
    link,
  });
}

/** The tab closed, reloaded or left the site while a hand-off followed it. */
async function watchMoved(tabId, info, tab) {
  const hand = (await watchBook()).get(tabId);
  if (!hand) return;
  // A step still running hears of a closed tab on its own and says so; one cut off
  // by a restart of the worker has nobody left to say it.
  if (info?.removed && hand.phase !== "waiting") return endWatch(hand, { gone: true });
  if (hand.phase !== "waiting") return;
  const url = info?.url ?? (info?.status === "complete" ? tab?.url : undefined);
  const where = hand.site === "bluesky" ? "Bluesky" : "X";
  const after = `so Azimut stopped after post ${hand.done} of ${hand.posts.length}`;
  let stopped = null;
  let error = null;
  if (info?.removed) {
    stopped = "closed";
    error = `The tab was closed, ${after}.`;
  } else if (url && AzimutPostLink.siteOf(url) !== hand.site) {
    stopped = "left";
    error = `The tab left ${where}, ${after}.`;
  } else if (info?.status === "complete" && !(await askReader(hand, "ping"))) {
    // A page that swapped its address keeps the reader; a page that loaded anew
    // has lost it, and the filled box with it.
    stopped = "reloaded";
    error = `The page loaded again, ${after}.`;
  }
  if (!stopped) return;
  if (!hand.chain) return endWatch(hand, { gone: true });
  return failHandOff(hand, { step: "catch-link", stopped, error, gone: true });
}

api.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info?.url && info?.status !== "complete") return;
  if (!(await watchBook()).has(tabId)) return;
  inLine(() => watchMoved(tabId, info, tab));
});

api.tabs.onRemoved?.addListener(async (tabId) => {
  if (!(await watchBook()).has(tabId)) return;
  inLine(() => watchMoved(tabId, { removed: true }));
});

/** What the page held, for a report, read by the filler that knows the site. */
async function probePage(tabId) {
  try {
    const target = { tabId };
    await api.scripting.executeScript({
      target,
      world: "MAIN",
      func: () => {
        window.__AZIMUT_HANDOFF__ = { probe: true };
      },
    });
    const [done] = await api.scripting.executeScript({ target, world: "MAIN", files: ["handoff.js"] });
    return done?.result?.probe ?? null;
  } catch {
    return null;
  }
}

/** Put the posts not yet sent on the clipboard, from the tab. False when refused. */
async function copyRest(tabId, text) {
  try {
    const [done] = await api.scripting.executeScript({
      target: { tabId },
      func: async (value) => {
        try {
          await navigator.clipboard.writeText(value);
          return true;
        } catch {
          return false;
        }
      },
      args: [text],
    });
    return done?.result === true;
  } catch {
    return false;
  }
}

/** One sentence for the app: no address beyond its host, no line breaks. */
function plainError(error) {
  return String(error || "The hand-off stopped.")
    .replace(/\bhttps?:\/\/[^\s]+/g, (url) => hostOf(url) || "a page")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * What to copy back when a hand-off stopped: where, and what the page held there.
 *
 * Counts and test ids only, each checked here, since the page's world wrote them.
 * Never a word of the page, a handle, a post or an address beyond the host.
 */
function handOffReport(hand, { step, stopped, probe, link }) {
  const count = (value) => (Number.isInteger(value) && value >= -1 && value < 100000 ? value : 0);
  const lines = [`Azimut Capture ${api.runtime.getManifest().version} on ${hand.host || "an unknown host"}`];
  lines.push(`Step: ${REPORT_STEP.test(String(step)) ? step : "unknown"}`);
  if (stopped) lines.push(`Stopped: ${stopped}`);
  const selectors = probe?.selectors;
  if (selectors && typeof selectors === "object") {
    const roles = ["editors", "add", "files", "reply"].map((role) => {
      const counts = Array.isArray(selectors[role]) ? selectors[role].slice(0, 8).map(count) : [];
      return `${role} ${counts.length ? counts.join("+") : "none"}`;
    });
    lines.push(`Selectors: ${roles.join(", ")}`);
    const ids = (Array.isArray(probe.buttons) ? probe.buttons : [])
      .filter((id) => typeof id === "string" && REPORT_TEST_ID.test(id))
      .slice(0, 40);
    const unnamed = count(probe.unnamed);
    const scope = probe.scope === "dialog" ? "dialog" : "page";
    lines.push(`Buttons in the ${scope}: ${ids.join(", ") || "none"}${unnamed ? ` (+${unnamed} unnamed)` : ""}`);
  } else {
    lines.push("Selectors: the page could not be read");
  }
  if (link && typeof link === "object") {
    lines.push(
      `Link: toasts ${count(link.toasts)}, post links ${count(link.links)}, refused ${count(link.refused)}, ` +
        `account ${link.account ? "found" : "not found"}`
    );
  }
  return lines.join("\n");
}

/**
 * Say where the hand-off stopped: a notification for the analyst and a report for
 * the app. A reply in several posts puts the posts not yet sent on the clipboard
 * when the browser lets it; the whole thread is there anyway, since the app copied
 * it before opening anything.
 *
 * `keep` goes on following the tab: a thread filled in part may still be sent.
 */
async function failHandOff(hand, { step, error, probe = null, link = null, stopped = null, gone = false, keep = false }) {
  const sentence = plainError(error);
  if (!keep) endWatch(hand, { gone });
  else await waitForLink(hand);
  let clip = "The thread is on your clipboard.";
  const first = hand.done + 1;
  const last = hand.posts.length;
  const rest = hand.posts.slice(hand.done).map((post) => post.text).filter(Boolean);
  if (hand.chain && rest.length && !gone && hand.tabId !== null && (await copyRest(hand.tabId, rest.join("\n\n")))) {
    clip = first === last ? `Post ${last} is on your clipboard.` : `Posts ${first} to ${last} are on your clipboard.`;
  }
  notify("Azimut hand-off", `${sentence} ${clip}`);
  const report = handOffReport(hand, { step, stopped, probe, link });
  // Also where about:debugging's Inspect shows it, for an app that does not show reports.
  console.info(`Azimut hand-off stopped: ${sentence}\n${report}`);
  await tellApp({ type: "post-handoff-report", caseId: hand.caseId, draft: hand.draft, error: sentence, report });
}

/**
 * Tell the app's own tabs something about a hand-off, by the bridge, as a map
 * panel's Make the proof is told (`sceneProof`). The paired address only, never a
 * map window. A bridge left behind by an update is replaced and asked again.
 */
async function tellApp(message) {
  let tabs = [];
  try {
    tabs = await appTabs();
  } catch {
    return; // the notification has said it already
  }
  for (const tab of tabs) {
    let told = false;
    try {
      told = (await api.tabs.sendMessage(tab.id, message))?.ok === true;
    } catch {
      // no bridge yet, or one from before an update
    }
    if (told) continue;
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] }).catch(() => {});
    try {
      await api.tabs.sendMessage(tab.id, message);
    } catch {
      // a tab still loading: the analyst still has the notification
    }
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
  if (!handOffAllowed(payload.url)) throw new Error("not an engine Azimut searches with");
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

// --- Make the proof, from a map panel ------------------------------------------
//
// The panel over another site's map holds the scene being geolocated, and its pill
// offers Make the proof. That is the app's to make: its tab comes to the front on
// Inspect's chooser for the scene, which opens the case first if it must, through the
// app's own guards (`lib/extSceneProof.js`). Nothing is written on the way, and the
// scene goes to no tab but the paired app's.
//
// The bridge takes it to the page and brings the page's answer back (`bridge.js`).
// A tab still loading has no one to answer yet, so it is asked again a moment later.
// With no app tab open, one is opened at the paired address and handed the scene once
// it answers; the panel hears at once that it was taken, and a notification says if
// the tab never answered.

/** How long to wait before each ask: a tab that just opened answers within seconds. */
const SCENE_WAITS = [0, 400, 800, 1600, 3200];
/** A detached map window of the app, which is not where a proof is made. */
const MAP_WINDOW = /[#?&]solo=1(?:&|$)/;

/** The scene a panel hands over, or null when it is not one. */
function sceneHandoff(scene) {
  const text = (value, max) => (typeof value === "string" && value && value.length <= max ? value : null);
  const caseId = text(scene?.caseId, 200);
  const video = text(scene?.video, 1024);
  const draft = text(scene?.draft, 200);
  return caseId && video && draft ? { caseId, video, draft } : null;
}

/** The paired app's own tabs, the one used last first, its map windows left out. */
async function appTabs() {
  let tabs;
  try {
    tabs = await api.tabs.query({ url: APP_ORIGINS.map((o) => `${o}/*`) });
  } catch {
    return [];
  }
  const main = [];
  for (const tab of tabs ?? []) {
    if (!(await isPairedApp(tab.url))) continue;
    let hash = "";
    try {
      hash = new URL(tab.url).hash;
    } catch {
      continue;
    }
    if (!MAP_WINDOW.test(hash)) main.push(tab);
  }
  return main.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

/** A tab and its window in front. */
async function bringForward(tab) {
  await api.tabs.update(tab.id, { active: true });
  try {
    await api.windows?.update(tab.windowId, { focused: true });
  } catch {
    // a window the system keeps behind still shows the tab once it is looked at
  }
}

/** The scene handed to an app tab's bridge, asked again while nobody answers. */
async function deliverScene(tabId, scene, waits = SCENE_WAITS) {
  let error = "Azimut did not answer";
  for (const wait of waits) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    let answer = null;
    try {
      answer = await api.tabs.sendMessage(tabId, { type: "scene-proof", scene });
    } catch {
      // no bridge on it yet: the page is still loading
    }
    if (answer?.ok) return { ok: true };
    if (answer?.refused) return { ok: false, refused: true, error: answer.error || "Azimut refused" };
    if (answer?.error) error = answer.error;
  }
  return { ok: false, error };
}

async function sceneProof(msg) {
  const scene = sceneHandoff(msg.scene);
  if (!scene) return { ok: false, error: "not a scene to prove" };
  const { backendUrl } = await settings();
  if (!isAppUrl(backendUrl)) return { ok: false, error: "the Azimut address in the options is not on this machine" };
  // one hand-off, however many times it is asked for: the app opens it once
  const handed = { ...scene, id: crypto.randomUUID() };
  const [tab] = await appTabs();
  if (tab) {
    await bringForward(tab);
    let answer = await deliverScene(tab.id, handed, [0, 300]);
    if (!answer.ok && !answer.refused) {
      // a bridge left behind by an update of this extension: a fresh one, then again
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] }).catch(() => {});
      answer = await deliverScene(tab.id, handed, [0, 400, 800]);
    }
    if (!answer.ok) notify("Azimut", `${answer.error}. Reload its tab, then press Make the proof again.`);
    return answer.ok ? { ok: true } : { ok: false, error: answer.error };
  }
  const opened = await api.tabs.create({ url: `${backendUrl}/#inspect`, active: true });
  try {
    await api.windows?.update(opened.windowId, { focused: true });
  } catch {
    // the tab is in front of its window all the same
  }
  tabLoaded(opened.id)
    .then(() => deliverScene(opened.id, handed))
    .then((answer) => {
      if (!answer.ok) notify("Azimut", `${answer.error}. Press Make the proof again once it has loaded.`);
    });
  return { ok: true, opened: true };
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
  "/api/ingest/probe",
  "/api/ingest/firms/sensors",
  // the scenes to geolocate, and saying which one this map is for (POST for both
  // starting and stopping: the extension's origins are allowed GET and POST only)
  "/api/ingest/scenes",
  "/api/ingest/geolocating",
]);

// …and the ones that answer with bytes. Separate because the relay above parses
// what comes back as JSON, and because a route that hands over a picture is
// worth listing where it can be seen rather than inferred from a content type.
const MAP_IMAGE_ROUTES = new Set(["/api/ingest/firms"]);

//. Injected in this order: each one reads the globals the ones before it left.
const MAP_FILES = [
  "mapmath.js",
  "maptheme.js",
  "maptools.js",
  "mapdraw.js",
  "mapref.js",
  "maplink.js",
  "mapoverlay.js",
];

/** An error the map panel answers with its whole body rather than one line: no
 *  token (`unpaired`), a token the app turned down (`rejected`), no app (`down`). */
const mapTrouble = (message, code) => Object.assign(new Error(message), { code });

async function mapApi(msg) {
  if (!MAP_ROUTES.has(msg.path)) throw new Error(`the map tools may not call ${msg.path}`);
  const { backendUrl, token } = await settings();
  if (!token) throw mapTrouble("not paired. Open the extension options and paste the token from Azimut Settings", "unpaired");

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
    throw mapTrouble("Azimut is not answering. Is the app running?", "down");
  }
  if (r.status === 401) throw mapTrouble("pairing token rejected. Pair again in the extension options", "rejected");
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
 * A picture the app draws for the panel — today, NASA FIRMS over the view.
 *
 * Two reasons it is not `mapApi`: what comes back is bytes rather than JSON,
 * and it is handed over as a data URL because a content script cannot hold the
 * app's blob URL. The refusal is still read as the app's own sentence, since
 * FIRMS says exactly what is wrong with a key and that is worth repeating.
 */
async function mapImage(msg) {
  if (!MAP_IMAGE_ROUTES.has(msg.path)) throw new Error(`the map tools may not call ${msg.path}`);
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("not paired. Open the extension options and paste the token from Azimut Settings");

  const url = new URL(backendUrl + msg.path);
  for (const [key, value] of Object.entries(msg.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  let r;
  try {
    r = await fetch(url, { headers: { "X-Azimut-Token": token } });
  } catch {
    throw new Error("Azimut is not answering. Is the app running?");
  }
  if (!r.ok) throw new Error(await refusal(r));
  const blob = await r.blob();
  return `data:${blob.type || "image/png"};base64,${await base64(blob)}`;
}

/** How much of a file crosses in one message.
 *
 *  The whole point of the number: base64 of *this* is the biggest string either
 *  side ever holds, whatever the file weighs. A phone's clip of a street is
 *  hundreds of megabytes; both the composer and a map reference need the file
 *  without making the file itself the unit. */
const FILE_CHUNK_BYTES = 4 * 1024 * 1024;

/** The end and the total of a `Content-Range`, or null when the app answered with
 *  the whole file — an unranged 200, which is what a small file gets. */
function ranged(header) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(header || ""));
  return m ? { end: Number(m[2]), total: Number(m[3]) } : null;
}

/**
 * One slice of one of the case's files, for a composer or reference window.
 *
 * Not `mapApi`: that one parses what comes back as JSON, and this is bytes. The
 * route is written in rather than allowlisted — the panel may ask for a file
 * from the case it has open and for nothing else, and the app's own fence
 * (`api/ingest.py`, ``handoff_file``) is what says which files those are.
 *
 * `Range` is what `FileResponse` already serves, so nothing over there had to be
 * built for this: the consumer asks again from `next` until `next` is null and
 * glues the pieces into one file. A slice short of the chunk size is not the
 * signal — a file whose length divides evenly would end on a 416 — so the total
 * in `Content-Range` is.
 */
async function fileChunk(backendUrl, token, caseId, path, offset = 0) {
  const start = Number(offset) || 0;
  let r;
  try {
    r = await fetch(fileUrl(backendUrl, caseId, path), {
      headers: {
        "X-Azimut-Token": token,
        Range: `bytes=${start}-${start + FILE_CHUNK_BYTES - 1}`,
      },
    });
  } catch {
    throw new Error("Azimut is not answering. Is the app running?");
  }
  if (!r.ok) throw new Error(await refusal(r));
  const blob = await r.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const read = start + bytes.length;
  // No `Content-Range` means the app ignored the ask and sent everything, which
  // is a whole file in one message rather than a broken one.
  const total = ranged(r.headers?.get?.("Content-Range"))?.total ?? read;
  return {
    type: blob.type || "application/octet-stream",
    data: encode(bytes),
    next: read < total ? read : null,
    total,
  };
}

async function mapFile(caseId, path, offset = 0) {
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("not paired. Open the extension options and paste the token from Azimut Settings");
  if (!caseId) throw new Error("no case open");
  return fileChunk(backendUrl, token, caseId, path, offset);
}

/** Why the app would not hand a file over, in its own words where it gave any —
 *  the size ceiling is stated there, and a second copy of the number here is a
 *  number that goes stale. */
async function refusal(r, what = "that file") {
  if (r.status === 401) return "pairing token rejected. Pair again in the extension options";
  let detail = "";
  try {
    detail = JSON.parse(await r.text()).detail;
  } catch {
    // a proxy or a crash can answer with something that is not JSON
  }
  return typeof detail === "string" && detail ? detail : `the app refused ${what} (${r.status})`;
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

// --- linked views --------------------------------------------------------------
//
// The app's Link button puts two of its map tabs on one camera over a
// BroadcastChannel (`frontend/src/lib/map/link.js`). A panel on a site's map
// cannot join that channel — it is another origin — so the worker is the hub for
// everything the channel cannot reach: panel to panel, and panel to app, whose
// bridge opens a port here for each map tab (`bridge.js`).
//
// A panel follows a view by writing it into its own address bar
// (`maplink.js`), and most sites reload for that. A reload takes the panel with
// it, so two facts have to outlive the page and live here: which tabs are linked,
// and which one is on its way to a view it was sent. The second is what puts the
// tools back once the page has loaded (`resumeFollow`), and what keeps a tab
// counted as a peer while it reloads: without it the tab leading would see its
// only peer vanish mid-follow and switch its own link off.
//
// Nothing here is written down beyond the session, and nothing reaches the
// network: a camera is not case state.

const LINK_PORT = "map-link";
/** How long a tab that left to follow a view is waited for. Earth takes a
 *  dozen seconds to load on a machine without a GPU. */
const FOLLOW_GRACE_MS = 30000;

/** Every port on the link: `{ tabId, app }`, where `app` is one of the app's
 *  own map tabs rather than a panel. */
const linkPorts = new Map();
/** `{ linked: tabId[], following: { [tabId]: { at, view, pending } } }`,
 *  mirrored to storage.session because the worker may be evicted between two
 *  gestures. `pending` is a camera sent while that tab was away reloading. */
let linkMemo = null;
/** Tabs whose tools are being put back, so a page that reports "complete" twice
 *  is not injected twice — a second injection closes the panel. */
const resuming = new Set();

async function linkMemory() {
  if (!linkMemo) {
    const stored = (await api.storage.session.get({ mapLink: null }))?.mapLink;
    linkMemo = { linked: stored?.linked ?? [], following: stored?.following ?? {} };
  }
  return linkMemo;
}

function rememberLinks() {
  api.storage.session.set({ mapLink: linkMemo });
}

/** Tabs still waited for, the stale ones dropped on the way. */
function waitedFor(memo) {
  const now = Date.now();
  for (const [tabId, follow] of Object.entries(memo.following)) {
    if (now - follow.at >= FOLLOW_GRACE_MS) delete memo.following[tabId];
  }
  return memo.following;
}

/** Only the four numbers of a camera cross the hub, and only real ones. */
function linkView(view) {
  const ok =
    view &&
    Number.isFinite(view.lat) &&
    Number.isFinite(view.lon) &&
    Number.isFinite(view.zoom) &&
    Math.abs(view.lat) <= 90 &&
    Math.abs(view.lon) <= 180;
  if (!ok) return null;
  return { lat: view.lat, lon: view.lon, zoom: view.zoom, bearing: Number.isFinite(view.bearing) ? view.bearing : 0 };
}

function linkPost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // the tab went while this was in hand; its disconnect is already queued
  }
}

/**
 * Tell every port how many others it could link to.
 *
 * A panel counts everything else on the link. An app tab counts only panels,
 * because it already counts the app's other tabs on its own channel. A tab
 * reloading on its way to a view counts for both, for as long as it is waited
 * for.
 */
function linkPeers() {
  const panels = [...linkPorts.values()].filter((who) => !who.app);
  const present = new Set(panels.map((who) => who.tabId));
  const returning = linkMemo
    ? Object.keys(waitedFor(linkMemo)).filter((tabId) => !present.has(Number(tabId))).length
    : 0;
  for (const [port, who] of linkPorts) {
    const count = who.app ? panels.length + returning : linkPorts.size - 1 + returning;
    linkPost(port, { type: "link-peers", count });
  }
}

/**
 * Keep a camera for every linked tab that is away reloading.
 *
 * A panel that left to follow one view is not connected while its page loads,
 * and the analyst does not wait for it: the map being led goes on moving. Each
 * of those cameras used to be dropped, and the tab landed on the first and stayed
 * there. Only the last one matters, and the tab is handed it when it is back.
 */
function holdForReturning(memo, view, fromTabId) {
  const present = new Set([...linkPorts.values()].filter((who) => !who.app).map((who) => who.tabId));
  let held = false;
  for (const [tabId, follow] of Object.entries(waitedFor(memo))) {
    const id = Number(tabId);
    if (id === fromTabId || present.has(id) || !memo.linked.includes(id)) continue;
    follow.pending = view;
    held = true;
  }
  if (held) rememberLinks();
}

async function onLinkMessage(port, msg) {
  const who = linkPorts.get(port);
  if (!who || !msg) return;
  const memo = await linkMemory();
  if (who.app) {
    // An app tab only ever speaks a camera, and only to the panels: the app's
    // other tabs heard it on their own channel.
    const view = msg.type === "view" ? linkView(msg.view) : null;
    if (!view) return;
    for (const [other, them] of linkPorts) {
      if (!them.app && memo.linked.includes(them.tabId)) linkPost(other, { type: "view", view });
    }
    holdForReturning(memo, view, null);
    return;
  }
  if (msg.type === "link") {
    memo.linked = memo.linked.filter((id) => id !== who.tabId);
    if (msg.on) memo.linked.push(who.tabId);
    else delete memo.following[who.tabId];
    rememberLinks();
    linkPost(port, { type: "link-state", linked: !!msg.on, asked: null });
    return;
  }
  if (msg.type === "follow") {
    memo.following[who.tabId] = { at: Date.now(), view: linkView(msg.view) };
    rememberLinks();
    // the count drops back once the wait is over, whether or not the tab came
    setTimeout(linkPeers, FOLLOW_GRACE_MS + 50);
    return;
  }
  if (msg.type === "landed") {
    // a hash the site took without reloading: the panel never left
    delete memo.following[who.tabId];
    rememberLinks();
    return;
  }
  if (msg.type === "view") {
    const view = linkView(msg.view);
    if (!view || !memo.linked.includes(who.tabId)) return;
    for (const [other, them] of linkPorts) {
      if (other === port) continue;
      if (them.app || memo.linked.includes(them.tabId)) linkPost(other, { type: "view", view });
    }
    holdForReturning(memo, view, who.tabId);
  }
}

async function openLink(port) {
  const tab = port.sender?.tab;
  if (!tab?.id && tab?.id !== 0) {
    port.disconnect();
    return;
  }
  const who = { tabId: tab.id, app: isAppUrl(tab.url) };
  linkPorts.set(port, who);
  // before anything is awaited, so nothing the port says first is missed
  port.onMessage.addListener((msg) => onLinkMessage(port, msg));
  port.onDisconnect.addListener(() => {
    linkPorts.delete(port);
    linkPeers();
  });
  const memo = await linkMemory();
  if (!who.app) {
    // A panel arriving where it was sent: it hears that it is linked, the view
    // it was sent to (so it can say how close this map came), and whatever the
    // map it follows did while it was loading. The wait itself stands until it
    // runs out: a site may load a second document, and the tools go back on that
    // one too.
    const follow = waitedFor(memo)[tab.id];
    const linked = memo.linked.includes(tab.id);
    linkPost(port, { type: "link-state", linked, asked: follow?.view ?? null });
    if (follow?.pending && linked) {
      linkPost(port, { type: "view", view: follow.pending });
      delete follow.pending;
      rememberLinks();
    }
  }
  linkPeers();
}

api.runtime.onConnect.addListener((port) => {
  if (port.name === LINK_PORT) openLink(port);
});

/**
 * Put the tools back on a tab that reloaded to follow a view.
 *
 * Only a tab that said it was leaving for one, and only while it is waited for:
 * a linked tab the analyst reloads, or navigates somewhere else, loses its panel
 * the way any tab does. The panel is looked for first because a site that takes
 * the view in its hash reports "complete" without ever unloading it, and
 * injecting an open panel again is what closes it.
 *
 * A browser may refuse, and that is the one real cost of following by address:
 * where the extension holds no host permission, the tools were only ever allowed
 * on the page that was open when the button was pressed. The other linked panels
 * say so rather than leaving a tab that silently stopped following.
 */
/** How often, and how far apart, a refused injection is tried again. A page
 *  that reports "complete" can still be swapping its document, and the first
 *  refusal is often only that. */
const RESUME_TRIES = 3;
const RESUME_RETRY_MS = 1000;

async function resumeFollow(tabId, attempt = 1) {
  const memo = await linkMemory();
  const follow = waitedFor(memo)[tabId];
  if (!follow || resuming.has(tabId)) return;
  resuming.add(tabId);
  try {
    const [probe] = await api.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__AZIMUT_MAP_TOOLS__),
    });
    if (!probe?.result) await api.scripting.executeScript({ target: { tabId }, files: MAP_FILES });
  } catch {
    if (attempt < RESUME_TRIES) {
      setTimeout(() => resumeFollow(tabId, attempt + 1), RESUME_RETRY_MS);
      return;
    }
    delete memo.following[tabId];
    memo.linked = memo.linked.filter((id) => id !== tabId);
    rememberLinks();
    for (const [port, who] of linkPorts) {
      if (!who.app) {
        linkPost(port, { type: "link-note", note: "A linked tab reloaded and the browser kept its tools off. Open them there again" });
      }
    }
    linkPeers();
  } finally {
    resuming.delete(tabId);
  }
}

api.tabs.onUpdated.addListener((tabId, info) => {
  if (info?.status === "complete") resumeFollow(tabId);
});

api.tabs.onRemoved?.addListener(async (tabId) => {
  const memo = await linkMemory();
  if (!memo.linked.includes(tabId) && !memo.following[tabId]) return;
  memo.linked = memo.linked.filter((id) => id !== tabId);
  delete memo.following[tabId];
  rememberLinks();
});

// --- the notes panel -----------------------------------------------------------
//
// The panel (`notes.html`) holds the app's own note in a frame. Three things can be
// put in it from any page: a citation of the page, the words selected on it, and a
// capture of an area of a map. This side reads the page, draws the selection and
// files the capture; the panel hands the facts to the note, and the app writes
// them in.
//
// The right-click items are the road that always works: a click on one is what
// opens the tab to the extension, in both browsers. They exist only while a panel
// holds a note, which the panel says over its port; a panel that closes takes its
// port, and the items, with it. Whatever the browser refuses reaches the panel as
// what to do instead (`AzimutNotes.plain`), never in the browser's own words.
//
// The worker speaks to a panel over its port: "put" (facts for the note),
// "selecting" (an area selection is drawn on a tab), "working" (a line to show),
// "idle" (the selection was cancelled) and "trouble" (why something did not work).

const NOTES_PORT = "notes-panel";
const NOTE_MENU = { cite: "azimut-note-cite", quote: "azimut-note-quote", capture: "azimut-note-capture" };
const NOTE_ACTIONS = Object.fromEntries(Object.entries(NOTE_MENU).map(([action, id]) => [id, action]));
const NOTE_CONTEXTS = ["page", "frame", "selection", "link", "image", "video", "audio"];
const WEB_PAGES = ["http://*/*", "https://*/*"];

/** Every open panel, by its port: `{ windowId, ready, caseId, at }`. */
const notePanels = new Map();
const noteMenus = () => api.contextMenus ?? api.menus;
/** Whether the items are up: null until this worker has set them either way. */
let notesShown = null;
let notesCiteTitle = "";
let notesQueue = Promise.resolve();

/** Whether a page is the extension's own panel, the only one these routes answer. */
const fromNotesPanel = (sender) =>
  !sender?.tab && String(sender?.url || "").startsWith(api.runtime.getURL("notes.html"));

/**
 * One call on the menus API, as a promise, whatever the browser.
 *
 * Firefox's `browser.*` answers with promises and refuses a callback it was not
 * asked for; Chrome's `chrome.*` takes a callback everywhere, and reports through
 * `lastError` what would otherwise be logged as unchecked.
 */
function menuCall(method, ...args) {
  const menus = noteMenus();
  if (!menus?.[method]) return Promise.resolve();
  if (typeof browser !== "undefined") return Promise.resolve(menus[method](...args)).catch(() => {});
  return new Promise((resolve) => {
    menus[method](...args, () => {
      void api.runtime.lastError;
      resolve();
    });
  });
}

/** The address of the tab in front, when the browser lets the extension see it. */
async function frontUrl() {
  try {
    const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.url || "";
  } catch {
    return "";
  }
}

/**
 * Put the items up or take them down, and name the citation for the page in front.
 *
 * Calls are queued: two panels speaking at once would otherwise create the same
 * item twice. The label reads "Cite this post" wherever the front tab's address
 * can be read and is a post; elsewhere it reads "Cite this page".
 */
function syncNoteMenus() {
  notesQueue = notesQueue.then(drawNoteMenus, drawNoteMenus);
  return notesQueue;
}

async function drawNoteMenus() {
  if (!noteMenus()) return;
  const show = [...notePanels.values()].some((panel) => panel.ready);
  if (!show) {
    if (notesShown !== false) await menuCall("removeAll");
    notesShown = false;
    return;
  }
  const title = AzimutNotes.citeLabel(await frontUrl());
  if (notesShown) {
    if (title !== notesCiteTitle) await menuCall("update", NOTE_MENU.cite, { title });
    notesCiteTitle = title;
    return;
  }
  await menuCall("removeAll");
  const items = [
    { id: NOTE_MENU.cite, title, contexts: NOTE_CONTEXTS },
    { id: NOTE_MENU.quote, title: "Quote the selection", contexts: ["selection"] },
    { id: NOTE_MENU.capture, title: "Capture into the note", contexts: NOTE_CONTEXTS },
  ];
  for (const item of items) await menuCall("create", { ...item, documentUrlPatterns: WEB_PAGES });
  notesShown = true;
  notesCiteTitle = title;
}

/**
 * The panel a right-click puts into: the one in that window, else the one that
 * spoke last. A note on a second screen, beside the window being read, is the
 * usual way to work.
 */
function notePanelFor(windowId) {
  const ready = [...notePanels.entries()].filter(([, panel]) => panel.ready);
  return ready.find(([, panel]) => panel.windowId === windowId) ?? ready.sort((a, b) => b[1].at - a[1].at)[0] ?? null;
}

function tellPanel(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // the panel closed while this was in hand
  }
}

/**
 * The words selected in the frame that was right-clicked, line breaks kept.
 *
 * Throws where the browser keeps the frame from the extension: a frame from
 * another site, which the click opened nothing to, or a page no click opened.
 */
async function selectionIn(tabId, frameId) {
  const [hit] = await api.scripting.executeScript({
    target: { tabId, frameIds: [Number.isInteger(frameId) ? frameId : 0] },
    func: () => String(globalThis.getSelection?.() ?? ""),
  });
  return typeof hit?.result === "string" ? hit.result.slice(0, AzimutNotes.LIMITS.text + 1000) : "";
}

/** The tab's viewport in CSS pixels, or null where the page refuses the question. */
async function viewportOf(tabId) {
  try {
    const [hit] = await api.scripting.executeScript({
      target: { tabId },
      func: () => ({ w: window.innerWidth, h: window.innerHeight }),
    });
    const { w, h } = hit?.result ?? {};
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

/** How long Chrome's limit of two captures a second is waited out, once. */
const CAPTURE_QUOTA_MS = 1000;

/**
 * A capture, tried once more a second later when Chrome's limit of two a second
 * refused it. A press on Capture tries one before the drag, so a quick second
 * press would otherwise meet the limit.
 */
async function inQuota(grab) {
  try {
    return await grab();
  } catch (e) {
    if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(e?.message))) throw e;
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_QUOTA_MS));
    return grab();
  }
}

/**
 * Draw the popup's own area selection for a capture into the note.
 *
 * Captures are for maps only, as everywhere in Azimut, so the app is asked first
 * and anything else is refused before a pixel is taken. Then the user drags a
 * rectangle over the map, and only that rectangle is filed into the panel's case,
 * the way the popup files one ("area-selected", `finishNoteCapture`), with the
 * scale bar and north arrow the popup's tick last asked for. Escape files nothing.
 *
 * A right-click is what opens the page to the extension. A press in the panel is
 * not, and on the sites the extension holds anyway (Google, Bing and Yandex maps
 * among them) the page reads as open while the browser still refuses the capture.
 * So a press tries one first, a frame thrown away at once, and a refusal says to
 * right-click instead of drawing a selection that would come to nothing.
 */
async function armNoteCapture(tab, caseId, { menu = false } = {}) {
  if (!caseId) throw new Error("Open a note in the notes panel first.");
  const view = await viewportOf(tab.id);
  const parsed = await mapApi({ path: "/api/ingest/parse", query: { url: tab.url, height: view?.h } });
  if (!parsed?.site) throw new Error("Captures are for map sites. Cite this page instead.");
  if (!menu) {
    try {
      await inQuota(() => api.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 1 }));
    } catch (e) {
      throw new Error(AzimutNotes.plain(e, "capture"));
    }
  }
  const { captureMarks } = await api.storage.local.get({ captureMarks: false });
  const meta = {
    url: tab.url,
    caseId,
    lat: parsed.lat,
    lon: parsed.lon,
    zoom: parsed.zoom,
    bearing: parsed.bearing,
    marks: Boolean(captureMarks),
    note: { title: tab.title || "" },
  };
  try {
    await armAreaSelect(tab.id, meta);
  } catch (e) {
    await api.storage.session.remove(`pending:${tab.id}`);
    throw new Error(AzimutNotes.plain(e, "capture"));
  }
}

/**
 * The end of a selection drawn for the note: file the rectangle, put it in.
 *
 * The picture goes to the panel a right-click on that tab would put into, and is
 * filed into the case that panel shows now, so its note can hold it. A cancelled
 * drag files nothing and only clears the panel's line.
 */
async function finishNoteCapture(msg, tab, meta) {
  const found = notePanelFor(tab.windowId);
  if (msg.type === "area-cancelled") {
    if (found) tellPanel(found[0], { type: "idle" });
    return { ok: true };
  }
  if (!found) {
    notify("Azimut notes", "Open a note in the notes panel first.");
    return { ok: false, error: "no note open" };
  }
  const [port, panel] = found;
  tellPanel(port, { type: "working", text: "Capturing…" });
  try {
    const dataUrl = await withoutPanel(tab.id, () => inQuota(() => captureActiveTab(tab.windowId)));
    const { blob, scale } = await cropDataUrl(dataUrl, msg.rect, msg.viewportW);
    const { note, ...filed } = meta;
    const body = await ingest(blob, { ...filed, caseId: panel.caseId || meta.caseId, deviceScale: scale, screenCredit: msg.credit });
    tellPanel(port, {
      type: "put",
      put: { action: "picture", url: meta.url, title: note.title, entityId: body.entity_id },
      ...(typeof body.notice === "string" && body.notice ? { notice: body.notice } : {}),
      ...(attachedTo(body) ? { attached: attachedTo(body) } : {}),
    });
    return { ok: true };
  } catch (e) {
    const error = AzimutNotes.plain(e, "capture");
    tellPanel(port, { type: "trouble", error });
    return { ok: false, error };
  }
}

/**
 * The facts one action puts in the note, read off the page; an Error says why not.
 * A capture has none yet: it draws the selection and answers null, and the
 * picture follows the drag.
 *
 * `hints` is what a right-click hands over: the page's address and the selection
 * as the browser saw them, and which frame was clicked. A panel button has none,
 * and an address the browser leaves out means the tab was never opened to us.
 */
async function noteFacts(action, tab, hints, caseId) {
  const url = tab?.url || hints.pageUrl || "";
  if (!url) throw new Error(AzimutNotes.INSTEAD.any);
  if (!AzimutNotes.isWeb(url)) throw new Error("Open a web page to cite it.");
  if (await isPairedApp(url)) throw new Error("This is Azimut itself, not a source.");
  const title = tab?.title || "";
  if (action === "cite") return { action, url, title };
  if (action === "quote") {
    let text = "";
    try {
      text = await selectionIn(tab.id, hints.frameId);
    } catch (e) {
      // the browser's own copy of a right-clicked selection loses its line breaks, but it is the words
      if (!hints.selection) throw new Error(AzimutNotes.plain(e, "quote"));
    }
    text = text || hints.selection || "";
    if (!text.trim()) throw new Error("Select the words to quote first.");
    return { action, url, title, text };
  }
  if (action === "capture") {
    await armNoteCapture(tab, caseId, hints);
    return null;
  }
  throw new Error(`no such note action: ${action}`);
}

async function onNoteMenu(info, tab) {
  const action = NOTE_ACTIONS[info?.menuItemId];
  if (!action) return;
  const found = notePanelFor(tab?.windowId);
  // No tab is a click inside the panel itself: the items show over the note too,
  // since a browser matches them by the frame's address and has no "except".
  if (found && !tab) {
    tellPanel(found[0], { type: "trouble", error: "This is Azimut itself, not a source." });
    return;
  }
  if (!found) {
    notify("Azimut notes", "Open a note in the notes panel first.");
    return;
  }
  const [port, panel] = found;
  try {
    const put = await noteFacts(
      action,
      tab,
      { menu: true, pageUrl: info.pageUrl, frameId: info.frameId, selection: info.selectionText },
      panel.caseId
    );
    tellPanel(port, put ? { type: "put", put } : { type: "selecting", tabId: tab.id });
  } catch (e) {
    tellPanel(port, { type: "trouble", error: AzimutNotes.plain(e, action) });
  }
}

function openNotesPanel(port) {
  if (!fromNotesPanel(port.sender)) {
    port.disconnect();
    return;
  }
  const panel = { windowId: null, ready: false, caseId: "", at: 0 };
  notePanels.set(port, panel);
  port.onMessage.addListener((msg) => {
    // "watch" carries nothing: speaking at all is what keeps this worker up
    if (msg?.type !== "state") return;
    panel.windowId = Number.isInteger(msg.windowId) ? msg.windowId : null;
    panel.ready = msg.ready === true;
    panel.caseId = typeof msg.caseId === "string" ? msg.caseId : "";
    panel.at = Date.now();
    syncNoteMenus();
  });
  port.onDisconnect.addListener(() => {
    notePanels.delete(port);
    syncNoteMenus();
  });
}

api.runtime.onConnect.addListener((port) => {
  if (port.name === NOTES_PORT) openNotesPanel(port);
});
noteMenus()?.onClicked?.addListener((info, tab) => {
  onNoteMenu(info, tab);
});

/**
 * Alt+Shift+S: the map in front captured into the panel's note. A shortcut opens
 * the tab to the extension as a right-click does, so it works on any map without
 * the permission the panel's Add asks for.
 */
async function onNoteCommand(command, tab) {
  if (command !== "capture-note") return;
  let front = tab;
  if (!front?.id) {
    try {
      [front] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    } catch {
      front = null;
    }
  }
  const found = notePanelFor(front?.windowId);
  if (!found) {
    notify("Azimut notes", "Open a note in the notes panel first.");
    return;
  }
  const [port, panel] = found;
  try {
    await armNoteCapture(front, panel.caseId, { menu: true });
    tellPanel(port, { type: "selecting", tabId: front.id });
  } catch (e) {
    tellPanel(port, { type: "trouble", error: AzimutNotes.plain(e, "capture") });
  }
}
api.commands?.onCommand?.addListener((command, tab) => {
  // inside the press, before anything is awaited: a side panel opens only there
  if (command === "open-note") {
    openNote(tab?.windowId).catch((e) => notify("Azimut notes", `The note could not open: ${e?.message || e}`));
    return;
  }
  onNoteCommand(command, tab);
});
// The citation's label follows the tab in front, but only while a panel is open.
api.tabs.onActivated?.addListener(() => {
  if (notePanels.size) syncNoteMenus();
});
api.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (notePanels.size && tab?.active && (info?.url || info?.status === "complete")) syncNoteMenus();
});
api.windows?.onFocusChanged?.addListener(() => {
  if (notePanels.size) syncNoteMenus();
});

// --- the toolbar button ----------------------------------------------------------
//
// One press, and the page gets what it is for: the tools over a map, the case's
// note beside any other page, and on Azimut's own tab the one thing the press is
// there for, the browser's leave to capture that tab (`activeTab`), which the app's
// Capture is told about at once and says so in its own words.
//
// Which of the three is decided before anything is awaited. A side panel opens
// only inside the press, and Firefox stops counting it as one at the first thing
// awaited (MDN, "User actions"), so the hosts are the extension's own copy of the
// app's table (`mapsites.js`) rather than a question to the app.
//
// Until the extension is paired the button opens the pairing popup instead
// (`popup.html`): the token is typed into a page of the extension's own, never
// into a panel drawn over somebody else's site, whose scripts hear every key.

const toolbar = api.action ?? api.browserAction;

/** The pairing popup while there is no token, nothing once there is one. */
async function syncToolbar() {
  if (!toolbar?.setPopup) return;
  const { token } = await settings();
  try {
    await toolbar.setPopup({ popup: token ? "" : "popup.html" });
  } catch {
    // a browser that refuses keeps the last popup it was given
  }
}

/** Firefox's sidebar, or Chrome's side panel for this window. Called inside a press. */
function openNote(windowId) {
  try {
    if (api.sidebarAction?.open) return Promise.resolve(api.sidebarAction.open());
    if (api.sidePanel?.open) return Promise.resolve(api.sidePanel.open({ windowId }));
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.reject(new Error("this browser has no side panel for extensions"));
}

/** A tick on the button for a moment, on that tab only. */
const DONE_MS = 2500;
function flashDone(tabId) {
  const quiet = (call) => Promise.resolve(call).catch(() => {});
  try {
    if (!toolbar?.setBadgeText) return;
    if (toolbar.setBadgeBackgroundColor) quiet(toolbar.setBadgeBackgroundColor({ tabId, color: "#66b578" }));
    quiet(toolbar.setBadgeText({ tabId, text: "✓" }));
    setTimeout(() => quiet(toolbar.setBadgeText({ tabId, text: "" })), DONE_MS);
  } catch {
    // a badge is a courtesy
  }
}

function onToolbar(tab) {
  const url = tab?.url || "";
  if (isAppUrl(url)) {
    // the press is the leave: the app's Capture is told it may go on (bridge.js)
    Promise.resolve(api.tabs.sendMessage(tab.id, { type: "app-activated" })).catch(() => {});
    flashDone(tab.id);
  } else if (Number.isInteger(tab?.id) && globalThis.AzimutMapSites?.siteOf(url)) {
    // injecting the tools again is what closes them, so the same press does both
    Promise.resolve(api.scripting.executeScript({ target: { tabId: tab.id }, files: MAP_FILES })).catch((e) =>
      notify("Azimut", `The tools could not open on this page: ${e?.message || e}`)
    );
  } else {
    openNote(tab?.windowId).catch((e) => notify("Azimut notes", `The note could not open: ${e?.message || e}`));
  }
  // a browser that forgot the pairing popup gets it back for the next press
  syncToolbar();
}

toolbar?.onClicked?.addListener(onToolbar);
api.runtime.onInstalled?.addListener(() => syncToolbar());
api.runtime.onStartup?.addListener(() => syncToolbar());
api.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && (changes.token || changes.backendUrl)) syncToolbar();
});

/** The keys that open the note, as the browser has them now, or "". */
async function noteShortcut() {
  try {
    const all = await api.commands.getAll();
    return all.find((one) => one.name === "open-note")?.shortcut || "";
  } catch {
    return "";
  }
}

// --- message routes ------------------------------------------------------------

async function handle(msg, sender) {
  // A map panel's note button. First, and opened before anything is awaited: Chrome
  // counts a click in a page as the press that may open a side panel, as long as
  // nothing came between. Firefox never does (MDN, "User actions"), and the panel
  // then says how its sidebar opens instead.
  if (msg.type === "open-note") {
    if (!sender.tab) return { ok: false, error: "only a map panel may ask" };
    try {
      await openNote(sender.tab.windowId);
      return { ok: true };
    } catch {
      const keys = await noteShortcut();
      return {
        ok: false,
        error: keys
          ? `This browser opens the note from its own sidebar, or with ${keys}.`
          : "This browser opens the note from its own sidebar.",
      };
    }
  }

  // The Azimut app's own Capture button (bridge.js relay): return the raw
  // frame — the app does its own registration, cropping and filing. Only the
  // app's localhost origin may ask for it.
  if (msg.type === "capture-tab") {
    const refused = await notTheApp(sender.tab);
    if (refused) return { ok: false, error: refused };
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

  // The notes panel: whether the page in front is a map the app can capture, for its
  // Add to offer "This map". Asked of the app's own list, with the pairing.
  if (msg.type === "notes-map") {
    if (!fromNotesPanel(sender)) return { map: false };
    try {
      const parsed = await mapApi({ path: "/api/ingest/parse", query: { url: String(msg.url || "") } });
      return { map: Boolean(parsed?.site) };
    } catch {
      return { map: false };
    }
  }

  // A map panel's Capture: arm an area selection on its own tab. The meta waits in
  // storage.session for the overlay's rect.
  if (msg.type === "start-area-select") {
    const tab = sender.tab;
    if (!Number.isInteger(tab?.id) || isAppUrl(tab.url)) return { ok: false, error: "only a map panel may ask" };
    try {
      await armAreaSelect(tab.id, { ...(msg.meta || {}), url: tab.url || msg.meta?.url });
      return { ok: true };
    } catch (e) {
      await api.storage.session.remove(`pending:${tab.id}`);
      // the browser took the tab back from the extension: a press on the button gives it again
      const refused = /activeTab|<all_urls>|Cannot access|must request permission|Missing host permission/i;
      return {
        ok: false,
        error: refused.test(e?.message || "")
          ? "The browser took this tab back. Open the tools again from the Azimut button."
          : e.message,
      };
    }
  }

  // A map panel that cannot reach the app as paired: the options, where the pairing is.
  if (msg.type === "open-options") {
    if (!sender.tab) return { ok: false, error: "only a map panel may ask" };
    try {
      await api.runtime.openOptionsPage();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Overlay: the user finished (or cancelled) the drag.
  if (msg.type === "area-selected" || msg.type === "area-cancelled") {
    const key = `pending:${sender.tab.id}`;
    const armed = (await api.storage.session.get(key))[key];
    await api.storage.session.remove(key);
    const meta = armed ? toldByBar(armed, msg) : armed;
    if (meta?.note) return finishNoteCapture(msg, sender.tab, meta);
    if (msg.type === "area-cancelled" || !meta) return { ok: true };
    try {
      const dataUrl = await withoutPanel(sender.tab.id, () => captureActiveTab(sender.tab.windowId));
      const { blob, scale } = await cropDataUrl(dataUrl, msg.rect, msg.viewportW);
      const body = await ingest(blob, { ...meta, deviceScale: scale, screenCredit: msg.credit });
      notify("Capture filed into Azimut", filedLine(body));
      return { ok: true };
    } catch (e) {
      notify("Azimut capture failed", e.message);
      return { ok: false, error: e.message };
    }
  }

  // The app's Publish button, relayed by bridge.js: open the composer and fill
  // the thread. Same origin check as the capture route — only the app may ask.
  if (msg.type === "post-handoff") {
    const refused = await notTheApp(sender.tab);
    if (refused) return { ok: false, error: refused };
    try {
      return await handOff(msg.payload ?? {});
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // The link reader on a composer tab this extension opened (`postlink.js`): a post
  // of the analyst's was sent, or ten minutes went by without one. Taken only from
  // that tab, for the hand-off it was started for; anything else is nobody's.
  if (msg.type === "post-link-seen" || msg.type === "post-link-timeout") {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || typeof msg.watch !== "string" || isAppUrl(sender.tab.url)) {
      return { ok: false, error: "not a hand-off this extension follows" };
    }
    if (msg.type === "post-link-timeout") inLine(() => expireWatch(tabId, msg.watch));
    else inLine(() => linkSeen(tabId, msg.watch, String(msg.url ?? "")));
    return { ok: true };
  }

  // The app's Reverse Search buttons, relayed by bridge.js: open the engine and
  // give it the image. Same origin check as every other app route.
  if (msg.type === "reverse-handoff") {
    const refused = await notTheApp(sender.tab);
    if (refused) return { ok: false, error: refused };
    try {
      return await handOffReverse(msg.payload ?? {});
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // A map panel's Make the proof: the app's tab, in front, on Inspect's chooser for
  // the scene. Asked by the panel, never by a page: the bridge relays nothing of it.
  if (msg.type === "scene-proof") {
    if (!sender.tab || isAppUrl(sender.tab.url)) return { ok: false, error: "only a map panel may ask" };
    try {
      return await sceneProof(msg);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // The pairing popup, once paired on a map: draw the map tools over this tab.
  // Injecting the panel a second time closes it, which is what makes the toolbar
  // button both open and close it.
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
      return { ok: false, error: e.message, ...(e.code ? { code: e.code } : {}) };
    }
  }

  // The panel, asking for a picture to lay over the map.
  if (msg.type === "map-image") {
    try {
      return { ok: true, src: await mapImage(msg) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // The panel, asking for a slice of one of the case's files — bytes rather than
  // JSON, and one chunk per message so a long video is not one huge string.
  if (msg.type === "map-file") {
    try {
      return { ok: true, file: await mapFile(msg.caseId, msg.path, msg.offset) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // The notes panel's Save this page: the window's front tab, filed into the note's
  // case as a bookmark. `closed` is a tab the browser keeps from the extension,
  // which the panel answers by asking for the permission its Add asks for.
  if (msg.type === "notes-bookmark") {
    if (!fromNotesPanel(sender)) return { ok: false, error: "only the notes panel may ask" };
    if (!Number.isInteger(msg.windowId)) return { ok: false, error: "no window to read" };
    try {
      const [tab] = await api.tabs.query({ active: true, windowId: msg.windowId });
      const url = tab?.url || "";
      if (!url) return { ok: false, closed: true, error: "This page is kept from the extension until you allow it." };
      if (!AzimutNotes.isWeb(url)) return { ok: false, error: "Open a web page to save it." };
      if (await isPairedApp(url)) return { ok: false, error: "This is Azimut itself, not a source." };
      const body = await fileBookmark(url, tab.title || "", String(msg.caseId || ""));
      return { ok: true, title: body?.title || tab.title || url };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // A button in the notes panel: read the window's front tab for one action. Only
  // the panel may ask, since a capture is filed from here.
  if (msg.type === "notes-facts") {
    if (!fromNotesPanel(sender)) return { ok: false, error: "only the notes panel may ask" };
    if (!Number.isInteger(msg.windowId)) return { ok: false, error: "no window to read" };
    try {
      const [tab] = await api.tabs.query({ active: true, windowId: msg.windowId });
      const put = await noteFacts(msg.action, tab, {}, String(msg.caseId || ""));
      return put ? { ok: true, put } : { ok: true, selecting: tab.id };
    } catch (e) {
      return { ok: false, error: AzimutNotes.plain(e, msg.action) };
    }
  }

  // Settings asking what this copy is: the version the browser parsed, the folder
  // stamp this code was loaded from, and whether the asking tab is the address this
  // copy is paired with. Identification only, so any loopback page may ask: an app
  // that moved to a free port must still find its extension, and be told why it
  // refuses to act for it.
  if (msg.type === "ext-state") {
    if (!sender.tab || !isAppUrl(sender.tab.url)) return { ok: false, error: "not the Azimut app" };
    return {
      ok: true,
      paired: await isPairedApp(sender.tab.url),
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
    const refused = await notTheApp(sender.tab);
    if (refused) return { ok: false, error: refused };
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
// The button as the pairing says it should be, whatever a browser restart kept of it.
syncToolbar();
// Items a previous worker left up belong to panels that will say so again.
syncNoteMenus();
