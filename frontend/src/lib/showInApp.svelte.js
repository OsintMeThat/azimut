/**
 * "Show me in the app", from a step of a guide journey: the guide closes, the step's
 * tool opens, and the control it names is ringed and named where it stands
 * (components/Coachmark.svelte `ring`, mounted once by App.svelte). A pointer, not a
 * coach: nothing is pressed for the reader and nothing waits on them.
 *
 * The control is found by its guide anchor, the `data-guide` the guide's pictures are
 * measured by. When it is not on screen (behind a tab or a panel that is closed), what
 * the step says to press is said in a toast instead.
 */
import { toast, uiState } from './state.svelte.js';
import { anyOverlayOpen } from './overlayStack.js';

/** How long a tool gets to load and draw the control, and how often it is looked for. */
const WAIT = 3000;
const LOOK_EVERY = 100;
/** Long enough to read a sentence. */
const NOTE_FOR = 6000;

// Raw: it holds an element, which a deep proxy has no business wrapping.
let lit = $state.raw(null);
let asks = 0;

/** What App.svelte's pointer reads: `{ element, label }`, or null while nothing is lit. */
export const pointing = {
  get at() {
    return lit;
  },
};

/** The pointer's way out, once a press, a key or its time takes it down. */
export function stopPointing() {
  lit = null;
}

/** Drawn, and not hidden by itself or a parent. */
function shown(element) {
  const box = element.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const { visibility } = getComputedStyle(element);
  return visibility !== 'hidden' && visibility !== 'collapse';
}

/** The control on screen under this anchor; a tool kept out of sight keeps its own copy. */
function find(anchor) {
  if (anyOverlayOpen()) return null; // a dialog over the app hides what it would ring
  for (const element of document.querySelectorAll('[data-guide]')) {
    if (element.getAttribute('data-guide') === anchor && shown(element)) return element;
  }
  return null;
}

/** On one axis: whole inside the view when it fits there, at least in it when it does not. */
function seenOn(from, to, viewFrom, viewTo) {
  return to - from <= viewTo - viewFrom ? from >= viewFrom && to <= viewTo : from < viewTo && to > viewFrom;
}

/** Scrolled to only when the window or a scrolling panel holding it cuts it off. */
function bringIntoView(element) {
  const box = element.getBoundingClientRect();
  const views = [{ top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }];
  for (let up = element.parentElement; up; up = up.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(up);
    if (/auto|scroll/.test(`${overflowX} ${overflowY}`)) views.push(up.getBoundingClientRect());
  }
  const seen = views.every(
    (view) => seenOn(box.left, box.right, view.left, view.right) && seenOn(box.top, box.bottom, view.top, view.bottom)
  );
  if (seen) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: still ? 'auto' : 'smooth' });
}

const sameBox = (a, b) => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/**
 * Close the guide, open `tool` (null for a control the app always shows, in its top
 * bar or rail) and light the control under `anchor`, named `label`. A control in the
 * case panel names its view (`sidebar`, as the To-do), and the panel opens on it; one
 * in Settings names its section (`settings`, as the website), and Settings opens there. Answers the
 * element lit, or null when it was not: then `press` went out as a toast, or the
 * reader had already gone to another tool, or a later ask took over.
 *
 * The control is lit once it has held still between two looks, so a tool still laying
 * itself out does not leave the ring where the control was.
 */
export function showInApp({ tool = null, anchor, label = '', press = '', sidebar = null, settings = null }) {
  const ask = ++asks;
  lit = null;
  uiState.guide = null;
  // a control in Settings is found on its section, which Settings opens on when asked
  if (tool === 'settings' && settings) uiState.settingsTab = settings;
  if (tool) uiState.tool = tool;
  // shown, not chosen: the view the reader keeps for next time is left as it was
  if (sidebar) Object.assign(uiState, { sidebarOpen: true, sidebarView: sidebar });
  return new Promise((resolve) => {
    let seen = null;
    let looks = 0;
    const look = () => {
      if (ask !== asks || (tool && uiState.tool !== tool)) return resolve(null);
      const element = find(anchor);
      const box = element?.getBoundingClientRect();
      if (element && seen?.element === element && sameBox(seen.box, box)) {
        bringIntoView(element);
        lit = { element, label: label || press };
        return resolve(element);
      }
      seen = element ? { element, box } : null;
      if (++looks * LOOK_EVERY < WAIT) return void setTimeout(look, LOOK_EVERY);
      if (press) toast(press, 'info', NOTE_FOR);
      resolve(null);
    };
    // asked from a detached guide while this tab is behind it: looked for once it is in front
    const start = () => setTimeout(look, LOOK_EVERY);
    if (document.visibilityState === 'hidden') document.addEventListener('visibilitychange', start, { once: true });
    else start();
  });
}
