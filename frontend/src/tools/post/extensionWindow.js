/**
 * Whether Post's extension window was put away in this browser.
 *
 * The window says once why the capture extension is worth installing for Post, and
 * Not now puts it away for good here (the header keeps a quiet line while it is
 * missing). Kept in this browser alone, read and written in a try: a private window or
 * blocked storage only means the window shows again next time, never that Post breaks.
 */
export const EXTENSION_WINDOW_KEY = 'azimut:post-extension';

export function extensionWindowPutAway(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(EXTENSION_WINDOW_KEY) === 'not-now';
  } catch {
    return false;
  }
}

export function putExtensionWindowAway(storage = globalThis.localStorage) {
  try {
    storage?.setItem(EXTENSION_WINDOW_KEY, 'not-now');
  } catch {
    /* storage refused: the window shows again on the next visit, which is all it costs */
  }
}
