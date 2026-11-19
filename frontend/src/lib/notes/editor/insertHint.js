/**
 * The one-time hint an empty note shows: "Type / or press + to add anything". It
 * goes for good, in this browser, once the menu it points at has been used.
 */
export const INSERT_HINT_KEY = 'azimut:notes:insertMenuUsed';

/** Whether the hint is still to show. */
export function insertHintPending() {
  try {
    return globalThis.localStorage?.getItem(INSERT_HINT_KEY) !== '1';
  } catch {
    return false;
  }
}

/** The menu was used: the hint never shows again in this browser. */
export function insertHintUsed() {
  try {
    globalThis.localStorage?.setItem(INSERT_HINT_KEY, '1');
  } catch { /* a browser that keeps nothing shows the hint again, which is harmless */ }
}
