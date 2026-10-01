/**
 * Case sidebar width — the shared panel helpers (lib/panelWidth.js) bound to
 * the sidebar's own key and range. The pointer glue lives in CaseSidebar.svelte.
 */
import { panelWidth } from './panelWidth.js';

export const MIN_W = 240;
export const MAX_W = 640;
export const DEFAULT_W = 320;

export const { maxWidth, clampWidth, loadWidth, saveWidth } = panelWidth({
  key: 'azimut:sidebarW',
  min: MIN_W,
  max: MAX_W,
  def: DEFAULT_W,
});

/** What the sidebar body shows. Folders first: it is what it showed before. */
export const SIDEBAR_VIEWS = ['folders', 'todo', 'recent'];
const VIEW_KEY = 'azimut:sidebarView';

export function loadSidebarView() {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    return SIDEBAR_VIEWS.includes(stored) ? stored : 'folders';
  } catch {
    return 'folders';
  }
}

export function saveSidebarView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* a browser that keeps nothing still switches; it just forgets on reload */
  }
}
