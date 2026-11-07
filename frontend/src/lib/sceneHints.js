/**
 * Two nudges toward scenes in Inspect, each remembered in this browser only.
 *
 * A video with nothing marked in it yet asks, in its empty frame strip, whether it
 * holds several places; Not now keeps that file quiet. The first scene ever kept
 * points once at where it waits, the case sidebar's To-do (`todoHintAt`).
 *
 * Storage may be missing or refuse (a private window, blocked site data): each nudge
 * then keeps its word for the session and asks again on the next one.
 */
const DECLINED_KEY = 'azimut:sceneInviteDeclined';
const HINT_KEY = 'azimut:sceneTodoHint';
/** The most files kept as declined, the oldest forgotten first. */
export const DECLINED_MAX = 300;

const session = { declined: new Set(), hinted: false };

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

/** One file of one case: two cases may hold the same path. */
const fileKey = (caseId, path) => `${caseId}\n${path}`;

function declined() {
  try {
    const list = JSON.parse(read(DECLINED_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether Not now was pressed on this file's invitation. */
export function inviteDeclined(caseId, path) {
  const key = fileKey(caseId, path);
  return session.declined.has(key) || declined().includes(key);
}

/** Not now: this file's strip no longer asks. */
export function declineInvite(caseId, path) {
  const key = fileKey(caseId, path);
  session.declined.add(key);
  const kept = declined().filter((one) => one !== key);
  kept.push(key);
  write(DECLINED_KEY, JSON.stringify(kept.slice(-DECLINED_MAX)));
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
