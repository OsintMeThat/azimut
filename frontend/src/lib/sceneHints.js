/**
 * A nudge toward scenes in Inspect, remembered in this browser only: the first scene
 * ever kept points once at where it waits, the case sidebar's To-do (`todoHintAt`).
 *
 * Storage may be missing or refuse (a private window, blocked site data): the nudge
 * then keeps its word for the session and asks again on the next one.
 */
const HINT_KEY = 'azimut:sceneTodoHint';

const session = { hinted: false };

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* kept for the session */
  }
}

/** Whether the next scene kept is the first ever here, which says where it waits. */
export function todoHintDue() {
  return !session.hinted && read(HINT_KEY) == null;
}

/**
 * What the first scene kept points at: the sidebar's toggle while the sidebar is
 * closed, its To-do tab while it shows another view. Nothing while the To-do is on
 * screen, where the scene shows up by itself, so the hint waits for a later scene.
 */
export function todoHintAt(sidebarOpen, sidebarView) {
  if (!sidebarOpen) return 'toggle';
  return sidebarView === 'todo' ? null : 'tab';
}

/** The To-do was named once: never again in this browser. */
export function todoHintGiven() {
  session.hinted = true;
  write(HINT_KEY, '1');
}
