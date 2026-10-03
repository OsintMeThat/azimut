/**
 * The browser's Back and Forward, across the tools and inside the ones that have
 * somewhere to be.
 *
 * The address reads `#<tool>?<the tool's place>` (lib/hash.js). Changing tool adds
 * an entry, and so does a move a tool calls a navigation: a folder opened in Files, a
 * sheet opened from the Sheet home, a proof, a draft or a note opened. Every other
 * change of place rewrites the entry it is on (a save naming the document, a rename,
 * a case switch resetting the tool), so Back only walks through places the analyst
 * chose to go to.
 *
 * Going back never costs work. Tools stay mounted, so a tool reached by Back is as it
 * was left. A tool asked to leave a document with unsaved changes asks first and
 * answers whether it moved; when it stays, the address is put back on it. Back on an
 * open dialog closes that dialog, as Escape would, and goes nowhere else. And when Back
 * would leave Azimut altogether, the browser asks while a tool holds unsaved work.
 *
 * An entry remembers the case it was made in. Back into another case's entry changes
 * the tool and nothing inside it, since switching cases is not something Back does.
 */
import { caseState, uiState } from './state.svelte.js';
import { buildHash, splitHash } from './hash.js';
import { toolFromHash } from './workspaces.js';
import { closeTopOverlay } from './overlayStack.js';

/** tool → its place, as address parameters */
const places = new Map();
/** tool → (params) => boolean | Promise<boolean>: go there, and say whether it went */
const returns = new Map();
/** tool → () => boolean: whether it holds work a page unload would lose */
const holds = new Map();
/** tool → how many Back or Forward moves are being applied to it */
const restoring = new Map();
/** tool → the place a Back or Forward reached before that tool had loaded */
const waiting = new Map();
/** The tool a switch just opened an entry for, with nothing pressed since. The
 *  navigation that follows (a sidebar row opening a proof) is that same move. */
let fresh = null;
let pops = 0;
let toolIds = [];

const caseNow = () => caseState.current?.id ?? null;
const stamp = () => ({ azimut: 1, case: caseNow() });

/** Parameters with the empty ones dropped, as strings, in the order the tool wrote them. */
function written(params) {
  const entries = params instanceof URLSearchParams ? [...params] : Object.entries(params ?? {});
  return entries
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([name, value]) => [name, String(value)]);
}

const sameParams = (a, b) => {
  const sorted = (params) => JSON.stringify(written(params).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return sorted(a) === sorted(b);
};

const addressOf = (tool) => buildHash(tool, places.get(tool));

function showing(tool, params) {
  const here = splitHash(location.hash);
  return here.route === tool && sameParams(here.params, params);
}

/**
 * Where a tool is now. A tool calls it whenever its place changes, from an effect, and
 * again with `navigate` right where the analyst moves it somewhere (in the same
 * synchronous block as the change, before that effect runs). Only the navigation adds
 * an entry; anything else rewrites the current one.
 */
export function settlePlace(tool, params, { navigate = false } = {}) {
  places.set(tool, Object.fromEntries(written(params)));
  if (uiState.tool !== tool) return;
  // The switch to this tool has not written its entry yet; it will, from `places`.
  if (splitHash(location.hash).route !== tool) return;
  if (showing(tool, params)) return;
  // A move made while Back or Forward is being applied is that move, not a new one.
  const step = navigate && !restoring.get(tool);
  const sameCase = history.state?.azimut && history.state.case === caseNow();
  if (step && sameCase && fresh !== tool) history.pushState(stamp(), '', addressOf(tool));
  else history.replaceState(stamp(), '', addressOf(tool));
  if (step) fresh = null;
}

/**
 * The tool on screen changed. A switch is an entry, except the first one (the app
 * settling on where it opened) and in a tab that is one tool on its own. A Back or a
 * link that already names the tool leaves the address as it is.
 */
export function showTool(tool, { first = false, solo = false } = {}) {
  if (splitHash(location.hash).route === tool) return;
  if (first || solo) {
    history.replaceState(stamp(), '', addressOf(tool));
    return;
  }
  history.pushState(stamp(), '', addressOf(tool));
  fresh = tool;
}

/** A case opened, or the first one loaded: the entry on screen now belongs to it. */
export function caseShown() {
  history.replaceState(stamp(), '', location.href);
}

/** How a tool goes back to a place it was at. Returns the way to stop listening. */
export function onBackForward(tool, apply) {
  returns.set(tool, apply);
  if (waiting.has(tool)) {
    const params = waiting.get(tool);
    waiting.delete(tool);
    const pop = pops;
    // After the tool's own first effects, which would otherwise reset what this sets.
    queueMicrotask(async () => {
      const moved = await goBackTo(tool, apply, params);
      if (pop === pops) settleAddress(tool, moved);
    });
  }
  return () => {
    if (returns.get(tool) === apply) returns.delete(tool);
  };
}

/** Work a page unload would lose. Returns the way to stop declaring it. */
export function holdsUnsaved(tool, check) {
  holds.set(tool, check);
  return () => {
    if (holds.get(tool) === check) holds.delete(tool);
  };
}

export function anyUnsaved() {
  for (const check of holds.values()) {
    try {
      if (check()) return true;
    } catch {
      /* a tool that cannot answer holds nothing to ask about */
    }
  }
  return false;
}

async function goBackTo(tool, apply, params) {
  restoring.set(tool, (restoring.get(tool) ?? 0) + 1);
  try {
    return (await apply(params)) !== false;
  } catch {
    return true;
  } finally {
    const left = (restoring.get(tool) ?? 1) - 1;
    if (left) restoring.set(tool, left);
    else restoring.delete(tool);
  }
}

/** The address names where the tool really is. A tool that stayed (it held unsaved
 *  work and the analyst kept it) gets an entry of its own again, so the one Back left
 *  is still there to come back to. */
function settleAddress(tool, moved) {
  if (uiState.tool !== tool || !places.has(tool)) return;
  if (showing(tool, places.get(tool))) return;
  if (moved) history.replaceState(stamp(), '', addressOf(tool));
  else history.pushState(stamp(), '', addressOf(tool));
}

async function onPop(event) {
  fresh = null;
  const pop = ++pops;
  // Back on an open dialog closes it, as Escape would, and the tool stays where it
  // is: a dialog left open over the next tool would answer for the wrong one. The
  // entry Back reached stays behind this one, to go to once the dialog is gone. An
  // address typed or followed from a link (an entry Azimut did not write) closes the
  // dialog too, and then goes where it says.
  const ours = Boolean(event.state?.azimut);
  if (closeTopOverlay() && ours) {
    const here = places.has(uiState.tool) ? addressOf(uiState.tool) : buildHash(uiState.tool);
    history.pushState(stamp(), '', here);
    return;
  }
  const tool = toolFromHash(location.hash, toolIds);
  if (!tool) return;
  if (uiState.tool !== tool) uiState.tool = tool;
  const params = Object.fromEntries(splitHash(location.hash).params);
  const sameCase = ours && event.state.case === caseNow();
  let moved = true;
  if (sameCase) {
    const apply = returns.get(tool);
    if (!apply) {
      waiting.set(tool, params);
      return;
    }
    moved = await goBackTo(tool, apply, params);
  }
  if (pop === pops) settleAddress(tool, moved);
}

function onBeforeUnload(event) {
  if (!anyUnsaved()) return;
  event.preventDefault();
  // The older half of the same request, which some browsers still read.
  event.returnValue = '';
}

const pressed = () => {
  fresh = null;
};

/** Listen for Back, Forward and leaving the page. Returns the way to stop. */
export function installBackButton(ids) {
  toolIds = ids;
  window.addEventListener('popstate', onPop);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pointerdown', pressed, true);
  window.addEventListener('keydown', pressed, true);
  return () => {
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pointerdown', pressed, true);
    window.removeEventListener('keydown', pressed, true);
    places.clear();
    returns.clear();
    holds.clear();
    restoring.clear();
    waiting.clear();
    fresh = null;
  };
}
