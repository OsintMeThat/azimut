/**
 * The scene the open case is geolocating, and the queue of scenes still to prove, for
 * every surface that shows them: Inspect's Scenes tab, the pill over the tools, the
 * To-do's "To geolocate" group and the count on the sidebar's To-do tab
 * (`engine/geolocate.py`).
 *
 * The server holds which scene is being geolocated, one per case and for the session
 * only, and attaches every capture filed meanwhile to it, the extension's included.
 * So this copy is only what the app shows: read from the server, and never the thing
 * that decides where a capture goes. When the server says it changed (the
 * `geolocating` nudge, `api/events.py`), what the nudge says is shown at once (the
 * capture just attached and how many the scene holds, or that it ended) and the
 * server is read again behind it, an answer asked before the nudge landed dropped.
 */
import { api } from './api.js';
import { onEvent } from './events.js';
import { gatheredScene, openScenes, sceneCount } from './sceneQueue.js';
import { uiState } from './state.svelte.js';

/** `scene` is the queue's row for it (`video`, `id`, `start`, `end`, `label`, `state`,
 *  `captures`, `abandoned`, `since`), or null. */
export const geolocating = $state({ caseId: null, scene: null, error: '' });

/** The queue: `files` of `{video, title, scenes}`, or null until read. */
export const sceneQueue = $state({ caseId: null, files: null, busy: false, error: '' });

const base = (caseId) => `/api/cases/${encodeURIComponent(caseId)}`;

function hold(caseId, scene) {
  geolocating.caseId = caseId;
  geolocating.scene = scene ?? null;
  geolocating.error = '';
}

// Which word about the scene being geolocated is the newest. A read takes a ticket as
// it sets out; what is said here first (a nudge applied, a start or a stop answered)
// takes the next one. An answer whose ticket is older than the last held was asked
// before that, and says less than what is shown: it is dropped.
let tickets = 0;
let applied = 0;

/** Hold what an answer says, unless something newer was held since it was asked. */
function holdNewer(caseId, scene, asked) {
  if (asked < applied) return false;
  applied = asked;
  hold(caseId, scene);
  return true;
}

/** Hold what was just said here: newer than any answer still on its way. */
function holdNow(caseId, scene) {
  applied = ++tickets;
  hold(caseId, scene);
}

/** Read which scene the case is geolocating. */
export async function readGeolocating(caseId) {
  if (!caseId) return null;
  const asked = ++tickets;
  try {
    const { geolocating: scene } = await api.get(`${base(caseId)}/geolocating`);
    holdNewer(caseId, scene, asked);
    return scene;
  } catch (e) {
    if (geolocating.caseId === caseId && asked >= applied) geolocating.error = e.message;
    return null;
  }
}

/** Geolocate one scene to prove: from now on every capture filed is attached to it. */
export async function startGeolocating(caseId, video, draft) {
  const { geolocating: scene } = await api.put(`${base(caseId)}/geolocating`, { video, draft });
  holdNow(caseId, scene);
  return scene;
}

/**
 * Geolocate a scene and go to the map, its video open as a reference window with the
 * scene marked on its bar in its colour (`uiState.geolocateRef`, which Satellite takes
 * up; `order` is its place among its video's scenes, `lib/scenes.sceneColorAt`). A
 * picture's scene opens the picture instead (`kind`), with no bar to mark. The one
 * entry point of every Geolocate press: Inspect's Scenes tab, the To-do, the extension's panel,
 * the Collage tool. `scene` is a queue row or a row of that tab: `{video, id}` at least.
 * `picture` is one more picture to open beside the video: a collage cut from it.
 */
export async function geolocateScene(caseId, scene, { picture = null } = {}) {
  const held = await startGeolocating(caseId, scene.video, scene.id);
  uiState.geolocateRef = {
    video: held.video, draft: held.id, start: held.start, end: held.end, label: held.label, order: held.order,
    kind: (held.file_kind ?? scene.file_kind) === 'image' ? 'image' : 'video',
    ...(picture && picture !== held.video ? { picture } : {}),
  };
  uiState.tool = 'satellite';
  return held;
}

/** Stop geolocating. True when there was one to stop. */
export async function stopGeolocating(caseId) {
  const { ended } = await api.del(`${base(caseId)}/geolocating`);
  holdNow(caseId, null);
  return ended;
}

// Whether the queue held may be behind what the server has: a capture gathered or a
// scene renamed while only its number was shown (`holdSceneCount`), and the read in
// flight, which a second surface opening at the same moment shares.
let stale = false;
let reading = null;

/** Read the scenes still to prove, by file. */
export function readSceneQueue(caseId) {
  if (!caseId) return Promise.resolve(null);
  if (sceneQueue.caseId !== caseId) {
    sceneQueue.caseId = caseId;
    sceneQueue.files = null;
  }
  sceneQueue.busy = true;
  sceneQueue.error = '';
  stale = false;
  const asked = ++tickets;
  const read = (async () => {
    try {
      const answer = await api.get(`${base(caseId)}/scenes/queue`);
      // a later read answers for this one, whichever lands first
      if (sceneQueue.caseId !== caseId || reading?.read !== read) return null;
      sceneQueue.files = answer.files;
      // a nudge landed since it was asked: its scene's row says what the pill says
      if (!holdNewer(caseId, answer.geolocating, asked)) mirror(geolocating.caseId === caseId ? geolocating.scene : null);
      return answer;
    } catch (e) {
      if (sceneQueue.caseId === caseId && reading?.read === read) sceneQueue.error = e.message;
      return null;
    } finally {
      if (reading?.read === read) reading = null;
      if (sceneQueue.caseId === caseId && !reading) sceneQueue.busy = false;
    }
  })();
  reading = { caseId, read };
  return read;
}

/** Read the queue unless the one held for this case is up to date, or being read. */
export function ensureSceneQueue(caseId) {
  if (!caseId) return Promise.resolve(null);
  if (reading?.caseId === caseId) return reading.read;
  const kept = queueHolders > 0 || countHolders > 0;
  if (kept && sceneQueue.caseId === caseId && sceneQueue.files && !stale) return Promise.resolve(null);
  return readSceneQueue(caseId);
}

/** How many scenes of the case wait to be geolocated, the abandoned left out; null
 *  until its queue is read. */
export function scenesWaiting(caseId) {
  if (!caseId || sceneQueue.caseId !== caseId || !sceneQueue.files) return null;
  return sceneCount(openScenes(sceneQueue.files));
}

/**
 * Mark a picture or a video to geolocate, from outside Inspect: its scene about the
 * whole file, or with `start` (and `end` for a passage) a moment of a video, or the
 * scene already there (`POST /scenes/mark`). A collage cut from one video marks that
 * video. The server refuses a map capture, a frame Inspect cut from a video, and a
 * time on a picture. Answers with the scene's row.
 */
export async function markToGeolocate(caseId, path, label = '', { start = null, end = null } = {}) {
  const at = Number.isFinite(start) ? { start, ...(Number.isFinite(end) && end > start ? { end } : {}) } : {};
  const { scene } = await api.post(`${base(caseId)}/scenes/mark`, { path, label, ...at });
  edited(caseId, scene?.video ?? path);
  await refreshQueue(caseId);
  return scene;
}

/**
 * The last scene given up or taken up again from this tab, `{caseId, video, n}`: Inspect
 * reads its list again when the video it shows is that one, abandoned from the To-do
 * beside it. Another tab or the extension hear the server's `scenes` nudge instead.
 */
export const sceneEdit = $state({ caseId: null, video: null, n: 0 });

function edited(caseId, video) {
  sceneEdit.caseId = caseId;
  sceneEdit.video = video;
  sceneEdit.n += 1;
}

/** Give up on a scene, with a word if there is one. Answers with its row. */
export async function abandonScene(caseId, video, draft, reason = '') {
  const { scene } = await api.put(`${base(caseId)}/scenes/${encodeURIComponent(draft)}/abandon`, { video, reason });
  if (geolocating.caseId === caseId && geolocating.scene?.id === draft) holdNow(caseId, null);
  edited(caseId, video);
  await refreshQueue(caseId);
  return scene;
}

/** Take an abandoned scene up again. Answers with its row. */
export async function restoreScene(caseId, video, draft) {
  const query = new URLSearchParams({ video });
  const { scene } = await api.del(`${base(caseId)}/scenes/${encodeURIComponent(draft)}/abandon?${query}`);
  edited(caseId, video);
  await refreshQueue(caseId);
  return scene;
}

/** Read the queue again if a surface holds it for this case. */
function refreshQueue(caseId) {
  return sceneQueue.caseId === caseId && sceneQueue.files ? readSceneQueue(caseId) : null;
}

// The queue is read again only while a surface shows it. Its rows (the To-do's group,
// `holdSceneQueue`) are read again on every nudge. Its number alone (the sidebar's
// To-do tab, Go to, `holdSceneCount`) is read again only once it may have moved: the
// queue walks every worked file, and Inspect saves its work, and says so, at every
// change, a slider's included. So a nudge naming a file asks that file's scenes alone
// (`GET /scenes?video=`, a few milliseconds), and the queue is read again only when the
// scenes still open there are not the ones held. Once nothing shows it, a nudge reads
// the scene being geolocated alone.
let queueHolders = 0;
let countHolders = 0;
const queueHeld = () => queueHolders > 0;
const countHeld = () => countHolders > 0;

function holder(add) {
  add(1);
  let on = true;
  return () => {
    if (!on) return;
    on = false;
    add(-1);
    if (!queueHolders && !countHolders) {
      // nothing keeps it in step from here: whoever shows it next reads it again
      stale = true;
      clearTimeout(requeuing);
      clearTimeout(rechecking);
      checking.clear();
    }
  };
}

/** A surface showing the queue: it is kept in step until the release this returns. */
export const holdSceneQueue = () => holder((n) => (queueHolders += n));

/** A surface showing how many scenes wait: the number is kept right until the release
 *  this returns, the queue read for it only when it may have moved. */
export const holdSceneCount = () => holder((n) => (countHolders += n));

const held = (caseId) => caseId === sceneQueue.caseId && Boolean(sceneQueue.files);

// A file's scenes saved or a proof's time stated (`scenes`), or something deleted or
// restored (`saved`), which can give a scene back or take one up: a queue held for the
// case is read again, once for a burst, and later when only its number is shown.
const REQUEUE_MS = 300;
const RECOUNT_MS = 1000;
let requeuing = null;
function requeue(caseId, wait = REQUEUE_MS) {
  if (!held(caseId)) return;
  clearTimeout(requeuing);
  requeuing = setTimeout(() => {
    requeuing = null;
    readSceneQueue(caseId);
  }, wait);
}

/** The ids of the scenes still open among these rows, as a key to compare. */
const openKey = (rows) => rows
  .filter((scene) => scene.state !== 'abandoned')
  .map((scene) => scene.id)
  .sort()
  .join('\n');

// The files a nudge named while only the number is shown, asked about once for a burst.
const checking = new Set();
let rechecking = null;
function recheck(caseId, video) {
  checking.add(video);
  clearTimeout(rechecking);
  rechecking = setTimeout(async () => {
    rechecking = null;
    const videos = [...checking];
    checking.clear();
    for (const one of videos) {
      if (!held(caseId) || requeuing) return;
      let now;
      try {
        const { scenes } = await api.get(`${base(caseId)}/scenes?${new URLSearchParams({ video: one })}`);
        // a proof's own row is a scene proved, never one still to prove
        now = openKey((scenes ?? []).filter((scene) => scene.kind === 'draft'));
      } catch {
        now = null; // the file left the case, or cannot be read: the queue says what is left
      }
      if (!held(caseId)) return;
      const file = sceneQueue.files.find((entry) => entry.video === one);
      if (now === openKey(file?.scenes ?? [])) continue;
      requeue(caseId, 0);
      return;
    }
  }, REQUEUE_MS);
}

function nudged(event, video) {
  if (queueHeld()) return requeue(event.case_id);
  if (!countHeld() || !held(event.case_id)) return;
  stale = true;
  if (video) recheck(event.case_id, video);
  else requeue(event.case_id, RECOUNT_MS);
}
onEvent('scenes', (event) => nudged(event, event.video));
onEvent('saved', (event) => nudged(event, null));

/** The queue's row for this scene, if the queue held lists it. */
function rowOf(caseId, video, id) {
  if (!held(caseId)) return null;
  return sceneQueue.files.find((file) => file.video === video)?.scenes?.find((scene) => scene.id === id) ?? null;
}

/** The queue's row for the scene held, told what the pill was told. */
function mirror(scene) {
  const row = scene ? rowOf(geolocating.caseId, scene.video, scene.id) : null;
  if (!row) return;
  row.captures = [...(scene.captures ?? [])];
  row.state = scene.state;
  if (Number.isInteger(scene.captureCount)) row.captureCount = scene.captureCount;
  else delete row.captureCount;
}

/**
 * A nudge applied before the server is read again: an end drops the scene, a capture
 * attached to the scene held is counted, and a scene the queue lists is held from its
 * row. False when it says too little to show, and only the read can say.
 */
function applyNudge(event) {
  const caseId = event.case_id;
  if (event.draft == null) {
    holdNow(caseId, null);
    return true;
  }
  const now = geolocating.caseId === caseId ? geolocating.scene : null;
  const same = now && now.video === event.video && now.id === event.draft;
  const from = same ? now : rowOf(caseId, event.video, event.draft);
  if (!from) return false;
  const scene = gatheredScene(from, event);
  holdNow(caseId, scene);
  mirror(scene);
  return true;
}

// The read a nudge asks for, one at a time: nudges landing while it is out ask for one
// more, which sets out once it is back, after all of them. A read that never comes
// back holds nothing up for long.
const STUCK_MS = 5000;
let refreshing = 0; // when the read out set out, or 0
let refreshAgain = null;
async function refresh(caseId) {
  if (refreshing && Date.now() - refreshing < STUCK_MS) {
    refreshAgain = caseId;
    return;
  }
  const mine = (refreshing = Date.now());
  try {
    if (queueHeld() && held(caseId)) await readSceneQueue(caseId);
    else await readGeolocating(caseId);
  } finally {
    if (refreshing === mine) {
      refreshing = 0;
      const next = refreshAgain;
      refreshAgain = null;
      if (next) refresh(next);
    }
  }
}

// Started, ended, or a capture attached, from this tab, another, or the extension:
// shown at once, then read. The number of scenes waiting stays the same, so a queue
// held for its number is only marked behind on the captures it counts.
onEvent('geolocating', (event) => {
  if (event.case_id !== geolocating.caseId && event.case_id !== sceneQueue.caseId) return;
  applyNudge(event);
  if (!queueHeld() && held(event.case_id)) stale = true;
  refresh(event.case_id);
});
