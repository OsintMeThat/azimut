/**
 * How the plate editor is laid out round its page, kept between visits: the width
 * of the element list and of the inspector, whether each is shown, the list's tab
 * (what the page holds, or its maps' layers), and the inspector's folded sections. Focus is not kept: it is a moment, not a setting.
 *
 * The inspector opens simple: the sections few plates need (`FOLDED_FIRST`) start folded
 * and are kept as `opened` once the analyst opens one, every other section starts open and
 * is kept as `folded` once folded. Either list is the analyst's from then on.
 */
import { panelWidth } from '../panelWidth.js';

export const listWidth = panelWidth({ key: 'azimut:plateListW', min: 170, max: 400, def: 212, fraction: 0.3 });
export const inspectorWidth = panelWidth({ key: 'azimut:plateInspectorW', min: 264, max: 720, def: 300, fraction: 0.5 });

const KEY = 'azimut:plateLayout';

/** The inspector's sections that start folded: how a map is drawn in detail, and what few elements need. */
export const FOLDED_FIRST = ['3D', 'Grid', 'The imagery', 'The plain ground', 'Video transitions', 'Size', 'More'];

const titles = (list) => (Array.isArray(list)
  ? [...new Set(list.filter((title) => typeof title === 'string' && title && title.length <= 60))].slice(0, 40) : []);

/** A stored layout made safe: anything missing or wrong falls back to both panels shown and nothing folded. */
export function readLayout(raw) {
  let value = null;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { value = null; }
  return { list: value?.list !== false, inspector: value?.inspector !== false, folded: titles(value?.folded), opened: titles(value?.opened),
    tab: value?.tab === 'layers' ? 'layers' : 'page' };
}

function stored() {
  try { return readLayout(localStorage.getItem(KEY)); } catch { return readLayout(null); }
}

const screen = globalThis.innerWidth ?? Infinity;
export const layout = $state({ ...stored(), listW: listWidth.clampWidth(listWidth.loadWidth(), screen),
  inspectorW: inspectorWidth.clampWidth(inspectorWidth.loadWidth(), screen) });

export function saveLayout() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ list: layout.list, inspector: layout.inspector, folded: layout.folded, opened: layout.opened, tab: layout.tab }));
  } catch { /* a browser that keeps nothing still folds; it forgets on reload */ }
}

/** Whether a section of the inspector is open: one that starts folded once opened, any other until folded. */
export const isOpen = (title, state = layout) => (FOLDED_FIRST.includes(title) ? state.opened.includes(title) : !state.folded.includes(title));

/** A section of the inspector folded or opened by its title, on every element at once. */
export function toggleFold(title) {
  const list = FOLDED_FIRST.includes(title) ? 'opened' : 'folded';
  layout[list] = layout[list].includes(title) ? layout[list].filter((item) => item !== title) : [...layout[list], title];
  saveLayout();
}

/** The list or the inspector shown or put away. */
export function togglePanel(which) {
  layout[which] = !layout[which];
  saveLayout();
}
