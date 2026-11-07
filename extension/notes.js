/**
 * The notes panel: Chrome's side panel and Firefox's sidebar, one page for both.
 *
 * It is the app's own note in a frame, not a second editor: the frame is the
 * app's solo note view in panel mode, from the paired address, so there is one
 * copy of the note and the app's rules for it apply as they are. This page adds
 * a line over it for what is going on, and nothing else.
 *
 * The note's Add (+) asks what the tab in front can give (`note-tab-ask`), and
 * this page answers with the tab's address, title and the words selected there
 * (`note-tab`). Picking one (`note-tab-run`) has the worker read the page as a
 * right-click would, and what it found goes back as facts (an address, a title,
 * the words selected, the id of a capture just filed), with `window.postMessage`
 * to the app's exact origin. The app writes the Markdown and puts it in, then
 * answers.
 *
 * A press in a side panel opens no tab to the extension, so Add reads pages
 * with the one permission the extension asks for at run time: every site, asked
 * the first time Add needs a page, and taken back in the options. The browser
 * may refuse the ask from inside the note (Firefox does); the line here then
 * offers Allow, which is a press on this page. Without it, the right-click items
 * (`background.js`) and Alt+Shift+S work everywhere. Whatever the browser still
 * refuses is shown as what to do instead, never in its own words.
 *
 * A capture draws the popup's area selection on the page; the picture comes back
 * over the port once the rectangle is dragged, and Escape, here or on the page,
 * puts nothing.
 *
 * Save this page, over the note, files the page in front into the note's case as
 * a bookmark: a saved link, nothing downloaded. It reads the tab as Add does, so a
 * tab the browser keeps from the extension asks for the same permission.
 *
 * The case is the extension's `lastCaseId`, both ways: a case chosen in the map
 * panel opens its note here, and a case chosen in the note is stored for the map
 * panel, Capture and the right-click items.
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
  busy: false,
  /** What Add asked for while the permission was being asked, run once it is given. */
  waiting: null,
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
  $("bar").hidden = $("allowing").hidden && $("status").hidden;
}

/** The one permission Add needs: every site, read only when the analyst adds from one. */
const EVERY_PAGE = { origins: ["<all_urls>"] };

async function allowed() {
  try {
    return Boolean(await api.permissions.contains(EVERY_PAGE));
  } catch {
    return false;
  }
}

/** The window's front tab, or null. */
async function frontTab() {
  try {
    const [tab] = await api.tabs.query({ active: true, windowId: state.windowId });
    return tab ?? null;
  } catch {
    // a window closing under us: nothing to read
    return null;
  }
}

/** The words selected on the tab's page, line breaks kept, or "" when none or unreadable. */
async function selectionOf(tabId) {
  try {
    const [hit] = await api.scripting.executeScript({
      target: { tabId },
      func: () => String(globalThis.getSelection?.() ?? ""),
    });
    return String(hit?.result ?? "");
  } catch {
    return "";
  }
}

/** What the tab in front can give the note's Add: `{ access, url, title, selection }`. */
async function tabFacts() {
  if (!(await allowed())) return { access: "closed" };
  const tab = await frontTab();
  const url = tab?.url || "";
  if (!N.isWeb(url) || N.isApp(url, state.origin)) return { access: "none" };
  const [selection, map] = await Promise.all([selectionOf(tab.id), isMap(url)]);
  return { access: "open", url, title: tab.title || "", selection, map };
}

/** Whether the app knows `url` for a map it can capture, as the worker asks it. */
async function isMap(url) {
  try {
    const answer = await api.runtime.sendMessage({ type: "notes-map", url });
    return answer?.map === true;
  } catch {
    return false;
  }
}

/** Answer the note's Add with what the tab in front holds now. */
async function answerTab() {
  let facts;
  try {
    facts = await tabFacts();
  } catch {
    facts = { access: "closed" };
  }
  const frame = $("note").contentWindow;
  if (frame && state.origin) frame.postMessage(N.buildTab(facts), state.origin);
}

/**
 * One of Add's picks for the tab in front. The permission comes first, asked at
 * once while the press in the note still counts as one; a browser that will not
 * take that as a press gets Allow on this page's line instead.
 */
async function runTab(action) {
  if (action !== "allow" && (await allowed())) {
    await act(action);
    return;
  }
  state.waiting = action === "allow" ? null : action;
  let granted;
  try {
    granted = Boolean(await api.permissions.request(EVERY_PAGE));
  } catch {
    $("allowing").hidden = false;
    fold();
    return;
  }
  await allowedNow(granted);
}

/** Allow on this page's line, pressed. */
async function pressAllow() {
  let granted;
  try {
    granted = Boolean(await api.permissions.request(EVERY_PAGE));
  } catch (e) {
    say(N.plain(e));
    return;
  }
  await allowedNow(granted);
}

async function allowedNow(granted) {
  $("allowing").hidden = true;
  const then = state.waiting;
  state.waiting = null;
  fold();
  if (!granted) {
    say(N.INSTEAD.any, "info");
    return;
  }
  await answerTab();
  if (then === "bookmark") await saveBookmark();
  else if (then) await act(then);
}

/**
 * Save this page: the window's front tab, filed into the note's case as a bookmark.
 * A tab the browser keeps from the extension asks for the permission Add asks for,
 * on this page's line, and is saved once it is given.
 */
async function saveBookmark() {
  if (state.busy) return;
  state.busy = true;
  $("bookmark").disabled = true;
  say("");
  try {
    let answer;
    try {
      answer = await api.runtime.sendMessage({
        type: "notes-bookmark",
        windowId: state.windowId,
        caseId: state.caseId || state.lastCaseId,
      });
    } catch {
      answer = { ok: false, error: "The extension did not answer. Try again." };
    }
    if (answer?.ok) {
      say(`Saved “${answer.title}” as a bookmark.`, "ok");
      return;
    }
    if (answer?.closed) {
      state.waiting = "bookmark";
      $("allowing").hidden = false;
      fold();
      return;
    }
    say(N.plain(answer?.error) || "The extension did not answer. Try again.");
  } finally {
    state.busy = false;
    $("bookmark").disabled = false;
  }
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
      const notice = typeof msg.notice === "string" ? msg.notice.slice(0, 200) : "";
      // the scene being geolocated, which the app attached the capture to
      const attached = typeof msg.attached === "string" ? msg.attached.slice(0, 160) : "";
      // a word about what was just filed (Street View's rules), once it is in the note
      put(msg.put).then((ok) => {
        if (ok && notice) say([notice, attached].filter(Boolean).join(" "), "warn");
        else if (ok && attached) say(attached, "ok");
      });
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

/** One of Add's picks: the worker reads the page, this page hands it over. */
async function act(action) {
  if (state.busy || !state.ready) return;
  state.busy = true;
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
  if (said.kind === "tab-ask") {
    void answerTab();
    return;
  }
  if (said.kind === "tab-run") {
    void runTab(said.action);
    return;
  }
  state.heard = true;
  clearTimeout(loadTimer);
  $("down").hidden = true;
  state.ready = said.ready;
  state.caseId = said.ready ? said.caseId : "";
  if (state.caseId) keepCase(state.caseId);
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

  $("allow").addEventListener("click", pressAllow);
  $("bookmark").addEventListener("click", saveBookmark);
  $("retry").addEventListener("click", load);
  window.addEventListener("message", onFrame);
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
  load();
}

init().catch((e) => say(e.message));
