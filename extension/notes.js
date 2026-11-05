/**
 * The notes panel: Chrome's side panel and Firefox's sidebar, one page for both.
 *
 * It is the app's own note in a frame, not a second editor: the frame is the
 * app's solo note view in panel mode, from the paired address, so there is one
 * copy of the note and the app's rules for it apply as they are. This page adds a
 * bar of three actions over it and nothing else.
 *
 * What this page sends the frame is facts (an address, a title, the words
 * selected, the id of a capture just filed), with `window.postMessage` to the
 * app's exact origin. The app writes the Markdown and puts it in, then answers.
 *
 * The browser decides what the actions may read. A click in a side panel opens
 * no tab to the extension, so the buttons work on a page the extension already
 * holds: one it was right-clicked on or opened on, and the posting sites it
 * holds anyway. On any other page the bar says to right-click it instead, and
 * the right-click items (`background.js`) work everywhere. Whatever the browser
 * still refuses is shown as what to do instead, never in its own words.
 *
 * Capture draws the popup's area selection on the page; the picture comes back
 * over the port once the rectangle is dragged, and Escape, here or on the page,
 * puts nothing.
 *
 * The case is the extension's `lastCaseId`, both ways: a case chosen in the popup
 * opens its note here, and a case chosen in the note is stored for the popup,
 * Capture and the right-click items.
 */

const api = typeof browser !== "undefined" ? browser : chrome;
const N = AzimutNotes;
const $ = (id) => document.getElementById(id);

const PORT = "notes-panel";
/** How long a put waits for the note's answer. Nothing it does leaves the machine. */
const ANSWER_MS = 15000;
/** How long the frame has to say anything before the panel says the app is not there. */
const LOAD_MS = 12000;
/** How long before a port that died (an evicted worker, a reloaded extension) is opened again. */
const RETRY_MS = 2000;
/** How often the panel speaks on its port, which keeps the worker from being evicted. */
const WATCH_MS = 20000;
/** How long a sentence in the status line stays. */
const STATUS_MS = 8000;

const state = {
  windowId: null,
  backendUrl: "",
  origin: null,
  url: null,
  heard: false,
  ready: false,
  caseId: "",
  /** The extension's `lastCaseId`, as last read or written. */
  lastCaseId: "",
  /** The case the frame shows, or was last asked to show. */
  frameCase: "",
  /** "web" a page the actions can take, "unknown" one the browser keeps from us, "other" the rest. */
  page: "unknown",
  busy: false,
  /** Whether the frame was ever pointed at the app. */
  framed: false,
  /** The tab an area selection for the note is drawn on, or null. */
  selecting: null,
};

const pending = new Map();
let port = null;
let seq = 0;
let statusTimer = null;
let loadTimer = null;

function say(text, kind = "error") {
  const el = $("status");
  clearTimeout(statusTimer);
  el.hidden = !text;
  el.textContent = text || "";
  el.className = `status ${kind}`;
  if (text && kind !== "info") statusTimer = setTimeout(() => say(""), STATUS_MS);
  fold();
}

/** No bar at all when it has nothing to show: the note is the panel. */
function fold() {
  $("bar").hidden = $("actions").hidden && $("hint").hidden && $("status").hidden;
}

function paint() {
  $("actions").hidden = !(state.ready && state.page === "web");
  $("hint").hidden = !(state.ready && state.page === "unknown");
  for (const id of ["cite", "quote", "capture"]) $(id).disabled = state.busy;
  fold();
}

/**
 * What the window's front tab is, as far as the browser lets this page see.
 *
 * No address means the extension was never pointed at that tab, which the
 * browser says by leaving it out.
 */
async function readTab() {
  let tab = null;
  try {
    [tab] = await api.tabs.query({ active: true, windowId: state.windowId });
  } catch {
    // a window closing under us: nothing to read
  }
  const url = tab?.url || "";
  state.page = !url ? "unknown" : N.isWeb(url) && !N.isApp(url, state.origin) ? "web" : "other";
  $("cite").textContent = N.citeButton(url);
  $("cite").title = `${N.citeLabel(url)} in the note`;
  paint();
}

/** Tell the worker what this panel holds, so the right-click items follow it. */
function tell() {
  try {
    port?.postMessage({
      type: "state",
      windowId: state.windowId,
      ready: state.ready,
      caseId: state.caseId,
    });
  } catch {
    // the port died between the check and the send; its disconnect reopens it
  }
}

function connect() {
  try {
    port = api.runtime.connect({ name: PORT });
  } catch {
    port = null;
    setTimeout(connect, RETRY_MS);
    return;
  }
  port.onMessage.addListener((msg) => {
    if (msg?.type === "put") {
      state.selecting = null;
      readTab();
      put(msg.put);
    } else if (msg?.type === "selecting") {
      selecting(msg.tabId);
    } else if (msg?.type === "idle") {
      state.selecting = null;
      say("");
    } else if (msg?.type === "working") {
      say(String(msg.text || ""), "info");
    } else if (msg?.type === "trouble") {
      state.selecting = null;
      say(N.plain(msg.error) || "That did not work.");
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, RETRY_MS);
  });
  tell();
}

/**
 * Hand one set of facts to the note and wait for its answer.
 *
 * Success says nothing here: the note shows its own toast and lights what
 * landed. A refusal is the note's own sentence.
 */
function put(facts) {
  const id = `put-${(seq += 1)}-${Date.now()}`;
  let message;
  try {
    message = N.buildPut(id, facts);
  } catch (e) {
    say(e.message);
    return Promise.resolve(false);
  }
  const frame = $("note").contentWindow;
  if (!frame || !state.ready) {
    say("Open a note in the panel first.");
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      say("The note did not answer. Try again.");
      resolve(false);
    }, ANSWER_MS);
    pending.set(id, (answer) => {
      clearTimeout(timer);
      if (answer.ok) say("");
      else say(answer.error || "The note did not take it.");
      resolve(answer.ok);
    });
    frame.postMessage(message, state.origin);
  });
}

/** An area selection is drawn on a tab: say how to finish it, and keep Escape for it. */
function selecting(tabId) {
  state.selecting = Number.isInteger(tabId) ? tabId : null;
  say("Drag over the map to capture it. Esc cancels.", "info");
}

/**
 * Escape in the panel takes the selection down. A press on Capture leaves the
 * keyboard here, so the page's own Escape would not hear it.
 */
function cancelSelecting(event) {
  if (event.key !== "Escape" || state.selecting === null) return;
  const tabId = state.selecting;
  const gone = () => {
    // the tab moved on and took the selection with it
    state.selecting = null;
    say("");
  };
  try {
    Promise.resolve(api.tabs.sendMessage(tabId, { type: "area-cancel" })).catch(gone);
  } catch {
    gone();
  }
}

/** One of the bar's buttons: the worker reads the page, this page hands it over. */
async function act(action) {
  if (state.busy || !state.ready) return;
  state.busy = true;
  paint();
  say("");
  try {
    let answer;
    try {
      answer = await api.runtime.sendMessage({
        type: "notes-facts",
        action,
        windowId: state.windowId,
        caseId: state.caseId,
      });
    } catch {
      answer = { ok: false, error: "The extension did not answer. Try again." };
    }
    if (!answer?.ok) {
      say(N.plain(answer?.error, action) || "The extension did not answer. Try again.");
      return;
    }
    if (answer.selecting !== undefined) {
      selecting(answer.selecting);
      return;
    }
    await put(answer.put);
  } finally {
    state.busy = false;
    readTab();
  }
}

function onFrame(event) {
  const said = N.readFrame(event, $("note").contentWindow, state.origin);
  if (!said) return;
  if (said.kind === "done") {
    const answer = pending.get(said.id);
    pending.delete(said.id);
    answer?.(said);
    return;
  }
  state.heard = true;
  clearTimeout(loadTimer);
  $("down").hidden = true;
  state.ready = said.ready;
  state.caseId = said.ready ? said.caseId : "";
  if (state.caseId) keepCase(state.caseId);
  paint();
  tell();
}

/**
 * The case the note shows becomes the extension's case, for the popup, Capture
 * and the right-click items. The frame shows it already, so the change this
 * write fires is no reason to load it again.
 */
function keepCase(caseId) {
  state.frameCase = caseId;
  if (caseId === state.lastCaseId) return;
  state.lastCaseId = caseId;
  Promise.resolve(api.storage.local.set({ lastCaseId: caseId })).catch(() => {});
}

/**
 * The extension's case changed elsewhere (the popup's picker, a capture filed
 * from the popup): open that case's note. The app saves what was typed in the
 * note it leaves as the frame unloads.
 */
function followCase(caseId) {
  state.lastCaseId = caseId;
  if (!caseId || caseId === state.frameCase) return;
  state.frameCase = caseId;
  state.url = N.panelUrl(state.backendUrl, { caseId });
  load();
}

/** Open the note, and say so plainly when nothing answers. */
function load() {
  state.heard = false;
  state.ready = false;
  paint();
  tell();
  $("down").hidden = true;
  $("note").hidden = false;
  if (!state.url) {
    down("The Azimut address in the extension options is not a web address.");
    return;
  }
  openFrame(state.url);
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (!state.heard) down(`No note from Azimut at ${state.origin}. Is the app running and up to date?`);
  }, LOAD_MS);
}

/**
 * Point the note's frame at an address.
 *
 * Each address the panel opens differs from the last in its hash alone, which a
 * browser takes as a move within the page it has: nothing loads, and the note
 * left behind is never told to save. So after the first, each is a fresh frame;
 * the old one unloads, and the app saves what was typed in it as it goes.
 */
function openFrame(url) {
  const frame = $("note");
  if (!state.framed) {
    state.framed = true;
    frame.src = url;
    return;
  }
  const fresh = frame.cloneNode(false);
  fresh.src = url;
  frame.replaceWith(fresh);
}

function down(text) {
  $("down-text").textContent = text;
  $("down").hidden = false;
  $("note").hidden = true;
}

async function init() {
  const stored = await api.storage.local.get({ backendUrl: "http://127.0.0.1:8477", lastCaseId: "" });
  state.backendUrl = String(stored.backendUrl).replace(/\/+$/, "");
  state.lastCaseId = String(stored.lastCaseId || "");
  state.frameCase = state.lastCaseId;
  state.origin = N.appOrigin(state.backendUrl);
  state.url = N.panelUrl(state.backendUrl, { caseId: state.lastCaseId });
  state.windowId = (await api.windows.getCurrent()).id;

  for (const action of ["cite", "quote", "capture"]) $(action).addEventListener("click", () => act(action));
  $("retry").addEventListener("click", load);
  window.addEventListener("message", onFrame);

  // The front tab changes under the panel; so does what the browser lets us read
  // of it, after a right-click there, which no event reports. The pointer coming
  // back to the panel is the moment before a press, so it is read then too.
  api.tabs.onActivated.addListener((info) => {
    if (info.windowId === state.windowId) readTab();
  });
  api.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (tab?.active && tab.windowId === state.windowId) readTab();
  });
  document.documentElement.addEventListener("pointerenter", () => readTab());
  document.documentElement.addEventListener("keydown", cancelSelecting);

  // A new address in the options is a different app: open the note from there.
  // A case chosen elsewhere opens that case's note.
  api.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.backendUrl) {
      state.backendUrl = String(changes.backendUrl.newValue || "").replace(/\/+$/, "");
      state.origin = N.appOrigin(state.backendUrl);
      state.url = N.panelUrl(state.backendUrl, {});
      state.frameCase = "";
      if (changes.lastCaseId) state.lastCaseId = String(changes.lastCaseId.newValue || "");
      load();
    } else if (changes.lastCaseId) {
      followCase(String(changes.lastCaseId.newValue || ""));
    }
  });

  connect();
  setInterval(() => {
    try {
      port?.postMessage({ type: "watch" });
    } catch {
      // disconnected between the check and the send; the listener reopens it
    }
  }, WATCH_MS);
  readTab();
  load();
}

init().catch((e) => say(e.message));
