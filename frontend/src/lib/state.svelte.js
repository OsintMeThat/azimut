/**
 * Global app state (Svelte 5 runes).
 *
 * `caseState.current` is the open case (or null). Tools read it to know where
 * to file their outputs; one-shot mode transparently creates a scratch case
 * on first write (see ensureCase).
 */
import { api } from './api.js';
import { formatCoords as renderCoords } from './coords.js';
import { loadWidth, saveWidth, clampWidth } from './sidebar.js';
import { loadTheme, saveTheme, applyTheme } from './theme.js';
import { shouldShowUpdate } from './appUpdate.js';
import { extensionVersion } from './extBridge.js';
import { loadRelationTypes } from './relations.svelte.js';

/**
 * App-wide display preferences (Settings → General), mirrored from
 * settings.json. Presentation only — every tool keeps filing decimal degrees
 * and metres, so changing these never rewrites what's on disk.
 */
export const prefs = $state({
  coordFormat: 'dd', // 'dd' | 'dms' | 'mgrs'
  units: 'metric', // 'metric' | 'imperial'
  homeView: { lat: 48.8584, lon: 2.2945, zoom: 16 }, // where Satellite opens
  postMention: '@GeoConfirmed', // handle a fresh post draft is addressed to
  postTarget: 'x', // social composer a fresh post draft starts with
  signatureHandle: '', // account handle stamped onto proofs that opt into it
  updateCheckOnStart: true, // ask GitHub for a newer release when the page loads
  updateDismissedVersion: '', // the release tag muted with "don't show again"
});

/**
 * The startup update pop-up (App.svelte). `show` is flipped on once a check
 * comes back with a newer, non-muted release; the modal reads the rest.
 */
export const updateState = $state({
  show: false,
  latest: '', // the newer release tag, e.g. "v0.2.0"
  url: '', // where to download it
  notes: '', // the release body, Markdown
});

/**
 * What the startup checks found behind, feeding the dots on the Settings icon,
 * on its tabs and on the buttons that do something about it (lib/staleness.js).
 *
 * Filled once, on load — nothing here polls. Settings writes back to it when a
 * manual check or an update changes the answer, so clearing a badge doesn't
 * wait for a reload.
 */
export const updatesState = $state({
  app: null, // the /api/settings/update?check=true payload, or null
  scrapers: null, // checked downloader entries, or null while never checked
  extensionInstalled: null, // version stamped on <html> by the installed extension
  extensionBundled: '', // version this build ships (GET /api/settings)
});

/** Render a lat/lon the way the user asked for it. The tools' one entry point. */
export function fmtCoords(lat, lon) {
  return renderCoords(lat, lon, prefs.coordFormat);
}

// Tools mount before initSession's fetch comes back (a deep link straight to
// #satellite mounts the map on the app's first frame), so anything reading a
// preference *once* at startup — the Satellite home view — must await this
// instead of racing it. Resolves even if the settings read fails: the built-in
// defaults are a fine answer, a tool hanging forever is not.
let markPrefsReady;
export const prefsReady = new Promise((resolve) => {
  markPrefsReady = resolve;
});

export async function loadPrefs() {
  try {
    applyPrefs(await api.get('/api/settings'));
  } finally {
    markPrefsReady();
  }
}

/** Adopt a settings payload (GET /api/settings or PUT /api/settings/prefs). */
export function applyPrefs(s) {
  if (s.coord_format) prefs.coordFormat = s.coord_format;
  if (s.units) prefs.units = s.units;
  if (s.home_view) prefs.homeView = s.home_view;
  if (s.post_mention !== undefined) prefs.postMention = s.post_mention; // '' = none
  if (s.post_target !== undefined) prefs.postTarget = s.post_target;
  if (s.signature_handle !== undefined) prefs.signatureHandle = s.signature_handle; // '' = none
  if (s.update_check_on_start !== undefined) prefs.updateCheckOnStart = s.update_check_on_start;
  if (s.update_dismissed_version !== undefined)
    prefs.updateDismissedVersion = s.update_dismissed_version;
  if (s.extension_version !== undefined) updatesState.extensionBundled = s.extension_version;
}

/**
 * On page load, work out what is behind: a newer Azimut release, a newer
 * downloader, a newer capture extension. Runs once — nothing here polls, and
 * nothing re-checks when Settings opens.
 *
 * The extension half is a local comparison (the installed one stamps its
 * version on <html> at document_start), so it happens either way. The two
 * network calls are gated together on `updateCheckOnStart`: with it off,
 * opening the app still phones nowhere. Never throws — offline is the normal
 * case here, and a check that fails just leaves the badge unlit.
 */
export async function checkForUpdatesOnStart() {
  updatesState.extensionInstalled = extensionVersion();
  if (!prefs.updateCheckOnStart) return;
  const [app, scrapers] = await Promise.allSettled([
    api.get('/api/settings/update?check=true'),
    api.get('/api/settings/scrapers?check=true'),
  ]);
  if (app.status === 'fulfilled') {
    updatesState.app = app.value;
    if (shouldShowUpdate(app.value, prefs.updateDismissedVersion)) {
      updateState.latest = app.value.latest;
      updateState.url = app.value.url;
      updateState.notes = app.value.notes ?? '';
      updateState.show = true;
    }
  }
  if (scrapers.status === 'fulfilled') updatesState.scrapers = scrapers.value.scrapers ?? [];
}

/** Close the update pop-up. `mute` remembers the tag so it won't show again. */
export async function dismissUpdate(mute = false) {
  updateState.show = false;
  if (mute && updateState.latest) {
    try {
      applyPrefs(await api.put('/api/settings/prefs', { update_dismissed_version: updateState.latest }));
    } catch {
      /* the mute is a nicety; failing to persist it just means it re-shows */
    }
  }
}

export const caseState = $state({
  current: null, // { id, name, scratch, entities, links, ... }
  list: [],
  folders: [], // workspace folders that are not cases yet: { name, state }
  loading: false,
  rev: 0, // bumped on every reload so tools can re-fetch their own artifacts
});

/**
 * Reusable house-style presets (Settings → Templates), app-wide like the
 * signature. Two families: `proof` (a proof's layout/colours/legend) and
 * `post` (a thread skeleton). Loaded once at startup and refreshed whenever
 * Settings edits one, so the composers' "start from a template" menus stay
 * current without re-fetching. Each entry: { id, name, updated_at, data }.
 */
export const templatesState = $state({ proof: [], post: [] });

export async function loadTemplates() {
  try {
    const t = await api.get('/api/templates');
    templatesState.proof = Array.isArray(t.proof) ? t.proof : [];
    templatesState.post = Array.isArray(t.post) ? t.post : [];
  } catch {
    /* templates are a convenience; an empty store is a fine fallback */
  }
}

/** Create or update a preset (id present → update), then refresh the store. */
export async function saveTemplate(kind, { id, name, data }) {
  const rec = await api.post(`/api/templates/${kind}`, { id, name, data });
  await loadTemplates();
  return rec;
}

export async function deleteTemplate(kind, id) {
  await api.del(`/api/templates/${kind}/${id}`);
  await loadTemplates();
}

export const uiState = $state({
  tool: 'media', // 'media' | 'inspect' | 'satellite' | 'proof' | 'post' | 'settings'
  theme: loadTheme(), // 'dark' | 'light'; index.html stamps it before first paint
  sidebarOpen: true,
  sidebarW: loadWidth(), // px, drag-resizable and remembered across reloads
  toasts: [],
  settingsTab: null, // settings section id to open when switching to Settings
  // cross-tool handoffs (the workbench glue):
  composeQueue: [], // media paths queued for the Proof Composer
  postProof: null, // proof spec handed to the Post Composer
  openProof: null, // proof name to load in the Proof Composer
  openDraft: null, // draft name to load in the Post Composer
  openNotebook: null, // { noteId: string|null }; null noteId opens case notes.md
  inspectPath: null, // media path to open in the Inspect tool
  focusMedia: null, // media path to highlight & scroll to in the Media Library
  openInspect: null, // inspect-session name to reopen in the Inspect tool
  // Entity id the Board should open Details on. The graph-only types — a person,
  // an account, a claim — have no tool of their own to be reopened in, so the
  // board is where following a relation to one of them lands.
  openBoardEntity: null,
  /**
   * A question worked out in the Board, handed to the graph to be drawn.
   *
   * `{ terms, label }` — the catalog filter as request parameters, and the sentence
   * it reads as. The **filter** travels rather than the ids it matched, which is what
   * makes this work at any size: the graph asks the case the same question the table
   * asked, so nothing is capped, no URL carries five hundred ids, and the drawing
   * stays live as the case changes under it. Both surfaces resolve it through one
   * predicate, so they cannot disagree about what it means.
   */
  drawInGraph: null,
  /** One entity the graph should draw and select, wherever it came from. The mirror
   *  of `openBoardEntity`: a node has to be reachable from the row as much as a row
   *  from the node. */
  openGraphEntity: null,
  gotoCoords: null, // { lat, lon } to fly to in the Satellite tool
  // A point, a date and a time handed over by Coords & Sky: the Satellite tab
  // opens its Sun & moon mode there. Session-only, and never part of a capture
  // or a proof.
  skyAt: null, // { lat, lon, date, time }
  focusCapture: null, // case-relative capture path selected from another workspace
  // Satellite reference viewers: floating scratch windows holding a media image
  // over the map to eyeball against the imagery. Session-only — never captured
  // or saved, and dropped when the open case changes (they point at its media).
  refViewers: [],
});

/** Switch light/dark, mirror it to <html>, and remember it across reloads. */
export function setTheme(theme) {
  uiState.theme = theme === 'light' ? 'light' : 'dark';
  applyTheme(uiState.theme);
  saveTheme(uiState.theme);
}

/** Flip to the other theme. Wired to the rail toggle. */
export function toggleTheme() {
  setTheme(uiState.theme === 'light' ? 'dark' : 'light');
}

/**
 * Resize the case sidebar (px). Clamped against the live window, so a width
 * dragged out on a big screen can't wedge the canvas shut on a small one.
 * Kept out of localStorage until the drag ends — see persistSidebarWidth.
 */
export function setSidebarWidth(w) {
  uiState.sidebarW = clampWidth(w, window.innerWidth);
}

/** Remember the current sidebar width for the next session. */
export function persistSidebarWidth() {
  saveWidth(uiState.sidebarW);
}

let toastSeq = 0;

export function toast(message, kind = 'info', timeout = 3800, action = null) {
  const id = ++toastSeq;
  uiState.toasts.push({ id, message, kind, action });
  setTimeout(() => {
    const i = uiState.toasts.findIndex((t) => t.id === id);
    if (i !== -1) uiState.toasts.splice(i, 1);
  }, timeout);
}

export async function refreshCaseList({ q } = {}) {
  const query = q?.trim();
  caseState.list = await api.get(`/api/cases${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  // Folders the analyst made in the workspace and Azimut has not been told
  // about yet. Not a case list, so it takes no query; the switcher filters it.
  try {
    caseState.folders = await api.get('/api/workspace/folders');
  } catch {
    caseState.folders = []; // never keep the switcher from listing real cases
  }
}

/**
 * Make a case out of a workspace folder, in place. Nothing inside it moves:
 * the files stay in the analyst's half of the case folder.
 */
export async function adoptFolder(name) {
  const adopted = await api.post('/api/workspace/folders/adopt', { name });
  await refreshCaseList();
  await openCase(adopted.id);
  return adopted;
}

/** Write back the manifest of a folder holding a case that lost it. */
export async function recoverFolder(name) {
  const recovered = await api.post('/api/workspace/folders/recover', { name });
  await refreshCaseList();
  return recovered;
}

// Remember the last open case across page reloads so work is never "lost".
const LAST_CASE_KEY = 'azimut:lastCase';

function rememberCase(id) {
  try {
    if (id) localStorage.setItem(LAST_CASE_KEY, id);
    else localStorage.removeItem(LAST_CASE_KEY);
  } catch {
    /* localStorage unavailable (private mode) — non-fatal */
  }
}

let openingCase = 0;

export async function openCase(id) {
  const run = ++openingCase;
  caseState.loading = true;
  try {
    // reference viewers point at the previous case's media — drop them
    if (caseState.current?.id !== id) {
      uiState.refViewers = [];
      uiState.openNotebook = null;
      uiState.focusCapture = null;
    }
    const opened = await api.get(`/api/cases/${id}`);
    // Case reads can finish out of order. Only the latest choice may become current,
    // or a slow first click can put its case back after a faster second one opened.
    if (run !== openingCase) return;
    caseState.current = opened;
    rememberCase(id);
  } finally {
    if (run === openingCase) caseState.loading = false;
  }
}

/**
 * Startup: load the case list and reopen the last-used case (if it still
 * exists on disk). Called once from App on mount.
 */
export async function initSession() {
  // preferences must land before the tools render, or coordinates would flash
  // in the wrong format; a settings read failure is never fatal to a session
  await loadPrefs().catch(() => {});
  await loadTemplates().catch(() => {});
  // The relation vocabulary is code, not case data, and several surfaces name an
  // edge with it on their first paint. Reading it here means no relation row ever
  // renders a type slug it would replace a moment later.
  await loadRelationTypes().catch(() => {});
  await refreshCaseList();
  let lastId = null;
  try {
    lastId = localStorage.getItem(LAST_CASE_KEY);
  } catch {
    /* ignore */
  }
  if (lastId) {
    try {
      await openCase(lastId);
    } catch {
      rememberCase(null); // it was deleted — forget it
    }
  }
}

let reloadingCase = 0;

export async function reloadCase() {
  const id = caseState.current?.id;
  if (!id) return;
  const selection = openingCase;
  const run = ++reloadingCase;
  const reloaded = await api.get(`/api/cases/${id}`);
  // A write may finish while another case is being opened. Its refresh belongs to
  // the case it started in and must never put that case back under the analyst.
  if (
    run !== reloadingCase ||
    selection !== openingCase ||
    caseState.current?.id !== id
  ) return;
  caseState.current = reloaded;
  caseState.rev++;
}

export async function createCase(name) {
  const created = await api.post('/api/cases', { name });
  await refreshCaseList();
  await openCase(created.id);
  return created;
}

/**
 * One-shot mode: make sure some case exists to receive tool output.
 * Creates a scratch case silently if none is open (spec §3.3).
 */
export async function ensureCase() {
  if (caseState.current) return caseState.current;
  const scratch = await api.post('/api/cases/scratch');
  await refreshCaseList();
  await openCase(scratch.id);
  toast('Scratch session started. Use “Keep as case…” to save it', 'info');
  return caseState.current;
}

/**
 * Rename a case in place (keeps the same id/folder — only the display name
 * changes). Refreshes the list, and the open case if it is the one renamed.
 */
export async function renameCase(id, name) {
  await api.patch(`/api/cases/${id}`, { name });
  await refreshCaseList();
  if (caseState.current?.id === id) await openCase(id);
}

export async function promoteCase(name) {
  if (!caseState.current?.scratch) return;
  const promoted = await api.post(`/api/cases/${caseState.current.id}/promote`, { name });
  await refreshCaseList();
  await openCase(promoted.id);
  toast(`Promoted to case “${name}”`, 'ok');
}

/**
 * Close the open case (dropping back to one-shot mode). Also clears every
 * cross-tool handoff — otherwise a queued handoff meant for the closed case
 * (e.g. "open this proof") could get consumed against whatever case comes
 * next, since the consuming effects only check that *some* case is open.
 */
export function closeCase() {
  // Invalidate an open or refresh still in flight before dropping the current case.
  openingCase++;
  caseState.current = null;
  rememberCase(null);
  uiState.composeQueue = [];
  uiState.postProof = null;
  uiState.openProof = null;
  uiState.openDraft = null;
  uiState.inspectPath = null;
  uiState.focusMedia = null;
  uiState.openInspect = null;
  uiState.gotoCoords = null;
  uiState.skyAt = null;
  uiState.refViewers = [];
}

/**
 * Permanently delete a case and everything it contains (the whole folder on
 * disk — media, satellite, proofs, exports). Irreversible; the caller is
 * responsible for the "type DELETE" confirmation. If the deleted case is the
 * one open, we drop back to one-shot mode.
 */
export async function deleteCase(id) {
  await api.del(`/api/cases/${id}`);
  if (caseState.current?.id === id) closeCase();
  await refreshCaseList();
}
