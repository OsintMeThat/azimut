/**
 * How the plate editor is laid out round its page, kept between visits: the width
 * of the element list and of the inspector, whether each is shown, and the
 * inspector's folded sections. Focus is not kept: it is a moment, not a setting.
 */
import { panelWidth } from '../panelWidth.js';

export const listWidth = panelWidth({ key: 'azimut:plateListW', min: 170, max: 400, def: 212, fraction: 0.3 });
export const inspectorWidth = panelWidth({ key: 'azimut:plateInspectorW', min: 264, max: 720, def: 300, fraction: 0.5 });

const KEY = 'azimut:plateLayout';

/** A stored layout made safe: anything missing or wrong falls back to both panels shown and nothing folded. */
export function readLayout(raw) {
  let value = null;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { value = null; }
  const folded = Array.isArray(value?.folded)
    ? [...new Set(value.folded.filter((title) => typeof title === 'string' && title && title.length <= 60))].slice(0, 40) : [];
  return { list: value?.list !== false, inspector: value?.inspector !== false, folded };
}

function stored() {
  try { return readLayout(localStorage.getItem(KEY)); } catch { return readLayout(null); }
}

const screen = globalThis.innerWidth ?? Infinity;
export const layout = $state({ ...stored(), listW: listWidth.clampWidth(listWidth.loadWidth(), screen),
  inspectorW: inspectorWidth.clampWidth(inspectorWidth.loadWidth(), screen) });

export function saveLayout() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ list: layout.list, inspector: layout.inspector, folded: layout.folded }));
  } catch { /* a browser that keeps nothing still folds; it forgets on reload */ }
}

/** A section of the inspector folded or opened by its title, on every element at once. */
export function toggleFold(title) {
  layout.folded = layout.folded.includes(title) ? layout.folded.filter((item) => item !== title) : [...layout.folded, title];
  saveLayout();
}

/** The list or the inspector shown or put away. */
export function togglePanel(which) {
  layout[which] = !layout[which];
  saveLayout();
}
