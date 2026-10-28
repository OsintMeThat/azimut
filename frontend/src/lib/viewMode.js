/**
 * The grid or list a Sources tool was last left on, kept in the browser per tool.
 * It is a way of working rather than a property of a case or a folder, so one
 * choice holds everywhere until it is changed.
 */
export const VIEW_MODES = ['small', 'large', 'list'];

const key = (tool) => `azimut:view:${tool}`;

export function loadViewMode(tool, fallback) {
  try {
    const stored = localStorage.getItem(key(tool));
    return VIEW_MODES.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function saveViewMode(tool, view) {
  try {
    localStorage.setItem(key(tool), view);
  } catch {
    /* a browser that keeps nothing still switches; it just forgets on reload */
  }
}
