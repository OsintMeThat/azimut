/**
 * The welcome a version opens with: its number, and the `?` that opens the guide
 * (components/Welcome.svelte).
 *
 * It shows each time the app starts on a version until "Don't show this again" is
 * ticked, which mutes it until the next version. Closed without the tick, it waits for
 * the next start rather than the next reload: a tab reloaded is not the app opened, and
 * the launcher opens a new tab each time. Both are this browser's own conveniences, so
 * they live in its storage, and a storage that refuses (a private window) only means the
 * welcome shows again.
 */
const MUTED = 'azimut:welcomeMuted';
const CLOSED = 'azimut:welcomeClosed';

function read(store, key) {
  try {
    return store().getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(store, key, value) {
  try {
    store().setItem(key, value);
  } catch {
    /* it shows again, which is all a refused storage costs */
  }
}

/** Whether this start of `version` opens with the welcome. */
export function shouldWelcome(version) {
  if (!version) return false;
  return read(() => localStorage, MUTED) !== version && read(() => sessionStorage, CLOSED) !== version;
}

/** The welcome closed on `version`; `mute` keeps it shut until the next one. */
export function closeWelcome(version, mute) {
  write(() => sessionStorage, CLOSED, version);
  if (mute) write(() => localStorage, MUTED, version);
}
