/**
 * Where the open case stands on the guide's geolocation journey: the node it has
 * reached ("you are here"), the ones behind it, and a few short facts for the band
 * above the map.
 *
 * `gatherFacts` reads what the app already holds, with GET routes only, and
 * `hereOn` turns that into the map's state. The app records nothing of a reverse
 * search, a Horizon view, a Compare or another map site, so those optional nodes are
 * never done.
 */
import { api } from './api.js';
import {
  ensureSceneQueue, geolocating, heldInGeoProof, readGeolocating, sceneQueue, scenesWaiting,
} from './geolocating.svelte.js';
import { buildMediaQuery } from './mediaQuery.js';
import { proofLabel } from './proofList.js';
import { fileStem } from './proofScene.js';
import { captureCount, openScenes, queueShortTime, waitingWords, withProofs } from './sceneQueue.js';

/** The nodes every geolocation passes through after its photo or video, in order. */
const PATH = ['where', 'mark', 'geolocate', 'satellite', 'sure', 'spot', 'how', 'capture', 'proof', 'camera', 'save', 'post'];

/** What follows each node a case can stand on. */
const NEXT = {
  where: ['reverse', 'mark'],
  geolocate: ['satellite'],
  satellite: ['sure'],
  how: ['capture', 'elsewhere'],
  proof: ['camera'],
  camera: ['save'],
  save: ['post'],
  post: [],
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fact = (text, ok) => ({ text, ok });
const some = (n) => Number.isFinite(n) && n > 0;

/** Where the case stands, before any scene is marked: what was filed asks where it may be. */
function beforeScene(media) {
  const photos = media?.photos ?? 0;
  const videos = media?.videos ?? 0;
  const empty = { kind: null, scene: null, done: [], here: null, next: ['photo', 'video'] };
  // unread: say nothing rather than "nothing filed"
  if (!media) return { ...empty, facts: [] };
  if (!photos && !videos) return { ...empty, facts: [fact('nothing filed yet', false)] };
  const filed = [photos && plural(photos, 'photo'), videos && plural(videos, 'video')].filter(Boolean).join(' and ');
  return {
    ...empty,
    done: [...(photos ? ['photo'] : []), ...(videos ? ['video'] : [])],
    here: 'where',
    next: NEXT.where,
    facts: [fact(`${filed} filed`, true), fact('no scene marked yet', false)],
  };
}

/** The node a scene has reached. Leads and captures are only ever gathered while a
 *  scene is geolocated, so holding some means Geolocate was pressed, this session or not. */
function reached(scene) {
  if (scene.post === 'posted') return null;
  // a proof on its point that says nothing of the camera still has that step to take
  if (scene.proof === 'proved') return scene.camera === false ? 'camera' : 'post';
  if (scene.proof === 'saved') return 'save';
  if (scene.proof === 'open' || some(scene.captures)) return 'proof';
  if (some(scene.leads)) return 'how';
  return scene.live ? 'satellite' : 'geolocate';
}

const PROOF_WORDS = {
  open: 'proof open, not saved yet',
  saved: 'proof saved, no point yet',
};
const POST_WORDS = {
  drafted: 'post drafted, not posted yet',
  none: 'no post yet',
};

/** The band's lines at each node: what the scene holds, then what it lacks. */
function linesAt(here, scene, waiting) {
  switch (here) {
    case 'geolocate':
      return [fact(some(waiting) ? waitingWords(waiting) : 'scene marked', true), fact('not being geolocated', false)];
    case 'satellite':
      return [fact('being geolocated', true), fact('no lead yet', false)];
    case 'how':
      return [
        fact(plural(scene.leads, 'lead'), true),
        // captures attach to the scene held only: one left from another session needs Geolocate again
        ...(scene.live ? [] : [fact('not being geolocated', false)]),
        fact('no capture yet', false),
      ];
    case 'proof':
      return [
        ...(some(scene.captures) ? [fact(plural(scene.captures, 'capture'), true)] : []),
        fact(PROOF_WORDS[scene.proof] ?? 'no proof yet', false),
      ];
    case 'save':
      return [fact(PROOF_WORDS.saved, false)];
    case 'camera':
      return [fact('proof saved', true), fact('no camera point yet', false)];
    case 'post':
      // a post state that could not be read says nothing
      return [fact('proof saved', true), ...(POST_WORDS[scene.post] ? [fact(POST_WORDS[scene.post], false)] : [])];
    default:
      return [fact('proof saved', true), fact('posted', true)];
  }
}

/**
 * Where the case stands on the geolocation journey, from what `gatherFacts` read:
 * `{ kind, scene, done, here, next, facts }`. `kind` is the scene's file, `photo` or
 * `video`; `scene` its name; `facts` the band's lines, `{ text, ok }`. Every node before
 * the one reached is done, the optional ones aside: leads are erased once a proof
 * states its place, so a later node is the only sign they were dropped.
 */
export function hereOn(facts) {
  const scene = facts?.scene;
  if (!scene) return beforeScene(facts?.media);
  const kind = scene.kind === 'photo' || scene.kind === 'video' ? scene.kind : null;
  const here = reached(scene);
  const passed = here ? PATH.slice(0, PATH.indexOf(here)) : PATH;
  return {
    kind,
    scene: scene.name || null,
    done: [...(kind ? [kind] : []), ...passed],
    here,
    next: here ? NEXT[here] : [],
    facts: linesAt(here, scene, facts.waiting),
  };
}

// -- reading the case ----------------------------------------------------------------

const base = (caseId) => `/api/cases/${encodeURIComponent(caseId)}`;

/** A read that failed is a fact unknown, never a stop. */
const read = (path) => api.get(path).catch(() => null);

/** What a scene row is called: its file, then its label, else its moment in a video. */
function sceneName(row, file, kind) {
  const moment = kind === 'video' && Number.isFinite(row.start) ? queueShortTime(row) : '';
  return [file || fileStem(row.video), row.label || moment].filter(Boolean).join(' · ');
}

/**
 * How far the scene's proof went: `saved` (with no point yet, or the scene would be
 * proved and gone), `open` in Geo Proof and never saved, or `none`. A proof taking up a
 * video's scene says so on its row; one laying out a picture is only listed among the
 * picture's scenes (`GET /scenes`).
 */
async function proofOf(caseId, row, kind) {
  if (row.kind === 'proof' || row.proof) return 'saved';
  if (kind === 'photo') {
    const listed = await read(`${base(caseId)}/scenes?${new URLSearchParams({ video: row.video })}`);
    if ((listed?.scenes ?? []).some((one) => one.kind === 'proof' && one.state !== 'abandoned')) return 'saved';
  }
  return heldInGeoProof(row, caseId) ? 'open' : 'none';
}

/** A scene still to prove, being geolocated (`live`) or waiting. A proof's row in the
 *  queue carries neither leads nor captures, which stay unknown. */
async function sceneFacts(caseId, row, { file = '', kind, live }) {
  const asProof = row.kind === 'proof';
  return {
    name: sceneName(row, file, kind),
    kind,
    live,
    leads: asProof ? null : (row.leads?.length ?? 0),
    captures: asProof ? null : captureCount(row),
    proof: await proofOf(caseId, row, kind),
    post: null,
  };
}

/** The first scene waiting in the queue, with its file. */
function firstWaiting(caseId) {
  if (sceneQueue.caseId !== caseId) return null;
  const file = openScenes(withProofs(sceneQueue.files))[0];
  return file ? { file, row: file.scenes[0] } : null;
}

/** A proof states its place once one of its points was checked rather than proposed. */
const checkedPoint = (proof) => (proof?.points ?? []).find((one) => one?.proposed !== true
  && Number.isFinite(one?.lat) && Number.isFinite(one?.lon)) ?? null;

/** The checked point a proof marks as its point of view: where the camera stood. */
const cameraPoint = (proof) => (proof?.points ?? []).find((one) => one?.pov === true && one?.proposed !== true
  && Number.isFinite(one?.lat) && Number.isFinite(one?.lon)) ?? null;

/**
 * Whether a proof went out: a post naming its picture, or a thread of its video, marked
 * posted (`posted` or `changed`, `GET /drafts`), only drafted, or neither. Null unread.
 */
function postOf(proof, drafts) {
  if (!Array.isArray(drafts)) return null;
  const about = drafts.filter((one) => (proof.png && one.proof === proof.png)
    || (one.kind === 'video' && proof.video && one.video === proof.video));
  if (about.some((one) => one.state === 'posted' || one.state === 'changed')) return 'posted';
  return about.length ? 'drafted' : 'none';
}

/**
 * What the open case holds of the geolocation journey, for `hereOn`: `{ media, waiting,
 * scene, point }`. The scene described is the one being geolocated, else the first
 * waiting in the queue, else the last proof saved with its point, whose point is
 * `{ lat, lon }`: its point of view when it marks one, where the camera stood, else
 * its conclusion. `media` counts the photos and videos the case collected, read only
 * when there is no scene. Reads only: the queue and the scene held as the app keeps
 * them, then `GET /proofs`, `/drafts`, `/scenes` and `/media/page` as needed.
 */
export async function gatherFacts(caseId) {
  const facts = { media: null, waiting: null, scene: null, point: null };
  if (!caseId) return facts;
  await ensureSceneQueue(caseId);
  // the queue's read answers with the scene held too
  const live = geolocating.caseId === caseId ? geolocating.scene : await readGeolocating(caseId);
  facts.waiting = scenesWaiting(caseId);
  if (live) {
    const kind = live.file_kind === 'image' ? 'photo' : 'video';
    facts.scene = await sceneFacts(caseId, live, { file: live.file_title, kind, live: true });
    return facts;
  }
  const first = firstWaiting(caseId);
  if (first) {
    const kind = (first.row.file_kind ?? first.file.kind) === 'image' ? 'photo' : 'video';
    facts.scene = await sceneFacts(caseId, first.row, { file: first.file.title, kind, live: false });
    return facts;
  }
  const proofs = await read(`${base(caseId)}/proofs`);
  // newest first: the last one saved with its point
  const proved = (Array.isArray(proofs) ? proofs : []).find(checkedPoint);
  if (proved) {
    // where the photo was taken is the point of view when the proof names one
    const point = cameraPoint(proved) ?? checkedPoint(proved);
    facts.point = { lat: point.lat, lon: point.lon };
    facts.scene = {
      name: proofLabel(proved),
      kind: typeof proved.video === 'string' && proved.video ? 'video' : 'photo',
      live: false,
      // erased or never counted once proved
      leads: null,
      captures: null,
      proof: 'proved',
      camera: Boolean(cameraPoint(proved)),
      post: postOf(proved, await read(`${base(caseId)}/drafts`)),
    };
    return facts;
  }
  const page = await read(buildMediaQuery(caseId, { collectedOnly: true, limit: 1 }));
  const counts = page?.facets?.category_counts;
  if (counts) facts.media = { photos: counts.image ?? 0, videos: counts.video ?? 0 };
  return facts;
}
