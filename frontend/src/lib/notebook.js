export const NOTEBOOK_MIN_PANE = 280;
export const NOTEBOOK_MIN_SPLIT = 30;
export const NOTEBOOK_MAX_SPLIT = 70;
export const NOTEBOOK_DEFAULT_SPLIT = 50;
export const NOTEBOOK_HELP_MARGIN = 12;

const KEY = 'azimut:notebookSplit';

/** Load one note without letting a response land after the active key changed. */
export async function loadNotebookText(requestedKey, endpoint, { get, currentKey }) {
  const result = await get(endpoint);
  return {
    accepted: currentKey() === requestedKey,
    text: result.text,
  };
}

export function clampNotebookSplit(value, containerWidth = Infinity) {
  if (!Number.isFinite(value)) return NOTEBOOK_DEFAULT_SPLIT;
  const paneFloor = Number.isFinite(containerWidth) && containerWidth > 0
    ? Math.min(50, (NOTEBOOK_MIN_PANE / containerWidth) * 100)
    : 0;
  const min = Math.max(NOTEBOOK_MIN_SPLIT, paneFloor);
  const max = Math.min(NOTEBOOK_MAX_SPLIT, 100 - paneFloor);
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

export function clampNotebookHelpPosition(x, y, panelWidth, panelHeight, containerWidth, containerHeight) {
  const maxX = Math.max(NOTEBOOK_HELP_MARGIN, containerWidth - panelWidth - NOTEBOOK_HELP_MARGIN);
  const maxY = Math.max(NOTEBOOK_HELP_MARGIN, containerHeight - panelHeight - NOTEBOOK_HELP_MARGIN);
  return {
    x: Math.round(Math.min(maxX, Math.max(NOTEBOOK_HELP_MARGIN, x))),
    y: Math.round(Math.min(maxY, Math.max(NOTEBOOK_HELP_MARGIN, y))),
  };
}

export function loadNotebookSplit() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? NOTEBOOK_DEFAULT_SPLIT : clampNotebookSplit(Number(stored));
  } catch {
    return NOTEBOOK_DEFAULT_SPLIT;
  }
}

export function saveNotebookSplit(split) {
  try {
    localStorage.setItem(KEY, String(clampNotebookSplit(split)));
  } catch {
    /* localStorage may be unavailable. */
  }
}
