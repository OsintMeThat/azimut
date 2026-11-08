/**
 * The slides of a video, as Geo Proof's strip shows them under the canvas.
 *
 * A slide is a proof resting on the video, or a scene of it still to prove. The strip
 * is a view built from the read Inspect's Scenes tab makes
 * (`GET /cases/{id}/scenes?video=`), so nothing here adds a field to a proof or to the
 * Inspect work: the tiles come in clip order and in the colour Inspect's bar gives each
 * scene (`lib/scenes.sceneList`), the abandoned ones last.
 *
 * Moving from one slide to the next saves the one left, through the save Save proof
 * runs. `switchPlan` says when that save is owed, and `slideStyle` is what a new slide
 * keeps of the one before it: the look, never the content.
 */
import { templateFromProof } from './composer.js';
import { isAbandoned, sceneColorAt, sceneList, sceneMoments, sceneTime, sceneTitle, unplaced } from './scenes.js';

/** What each tile says it is, in the order a scene goes through them. */
export const PROVED = 'proved';
export const NO_PICTURE = 'nopicture';
export const NEW = 'new';
export const TODO = 'todo';
export const PROGRESS = 'progress';
export const GEOLOCATING = 'geolocating';
export const ABANDONED = 'abandoned';

/** A tile's second row, by state. */
const WORDS = {
  [NO_PICTURE]: 'No picture yet',
  unplaced: 'No place yet',
  [NEW]: 'Not saved',
  [TODO]: 'To geolocate',
  [GEOLOCATING]: 'Geolocating',
  [ABANDONED]: 'Abandoned',
};

const captureWords = (n) => (n === 1 ? '1 capture' : `${n} captures`);

/**
 * The tile of a proof the server listed. One that states no place yet is `unplaced`,
 * a slide still being geolocated, and can be abandoned like a scene; abandoned, it goes
 * greyed to the end with the scenes given up on.
 */
function proofTile(row) {
  const picture = Boolean(row.png);
  const state = isAbandoned(row) ? ABANDONED : picture ? PROVED : NO_PICTURE;
  const open = state !== ABANDONED && unplaced(row);
  return {
    key: row.key,
    kind: 'proof',
    name: row.proof,
    state,
    unplaced: open,
    title: sceneTitle(row),
    time: sceneTime(row),
    words: state === ABANDONED ? WORDS[ABANDONED] : !picture ? WORDS[NO_PICTURE] : open ? WORDS.unplaced : sceneTime(row),
    thumb: row.thumb || null,
    color: row.color,
    reason: row.abandoned?.reason ?? '',
    row,
  };
}

/** The tile of a scene still to prove: its label, else its time, and where it stands. */
function draftTile(row, geolocating, thumbOf) {
  const captures = row.captures ?? [];
  const state = isAbandoned(row) ? ABANDONED : row.id === geolocating ? GEOLOCATING : captures.length ? PROGRESS : TODO;
  const time = sceneTime(row);
  const first = captures[0] ? thumbOf?.(captures[0]) ?? null : null;
  return {
    key: row.key,
    kind: 'draft',
    id: row.id,
    state,
    title: row.label || time,
    time,
    words: state === PROGRESS ? captureWords(captures.length) : WORDS[state],
    thumb: state === ABANDONED ? null : first,
    color: row.color,
    reason: row.abandoned?.reason ?? '',
    row,
  };
}

/**
 * The tiles of a video's strip, in strip order: its scenes in clip order, the slide
 * open here when the server does not list it yet, then the abandoned ones.
 *
 * `answer` is what `/scenes` answered, or null. `open` is the slide on screen:
 * `{ started, name, title, draft, thumb, page }`, `name` the saved proof's (null before
 * its first save), `draft` the scene a proof never saved was made from, which it takes
 * the place of, and `page` the scene whose page is shown in place of a proof.
 * `thumbOf(path)` is a case file's thumbnail, for a scene's first capture.
 *
 * Each tile: `{ key, kind, state, title, time, words, thumb, color, number, current }`,
 * `kind` a `proof`, a `draft` or the `new` slide not saved yet.
 */
export function slideTiles(answer, open = {}, { thumbOf = null } = {}) {
  const listed = (answer?.scenes ?? []).filter((s) => s && (s.kind === 'proof' || s.kind === 'draft'));
  const ordered = sceneList(listed, listed.filter((s) => s.kind === 'draft'), answer?.taken ?? []);
  const geolocating = answer?.geolocating ?? null;
  const unsaved = open.started && !open.name;
  let placed = false;
  const tiles = ordered.map((row) => {
    if (row.kind === 'proof') {
      const tile = proofTile(row);
      if (open.started && open.name && row.proof === open.name) {
        placed = true;
        return { ...tile, current: true, thumb: open.thumb || tile.thumb, title: open.title || tile.title };
      }
      return { ...tile, current: false };
    }
    // a proof not saved yet, made from this scene, stands where the scene did
    if (unsaved && open.draft && row.id === open.draft) {
      placed = true;
      return newTile(open, row.color, 'new');
    }
    return { ...draftTile(row, geolocating, thumbOf), current: !open.started && open.page === row.id };
  });
  const live = tiles.filter((t) => t.state !== ABANDONED);
  const left = tiles.filter((t) => t.state === ABANDONED);
  if (open.started && !placed) {
    // a slide the strip has not heard of yet: never saved, or saved a moment ago
    const color = sceneColorAt(ordered.length);
    live.push(open.name
      ? { key: `proof:${open.name}`, kind: 'proof', name: open.name, state: PROVED, title: open.title || open.name, time: '',
          words: '', thumb: open.thumb || null, color, current: true }
      : newTile(open, color, 'new'));
  }
  return [...live, ...left].map((tile, i) => ({ ...tile, number: i + 1 }));
}

function newTile(open, color, key) {
  return { key, kind: 'new', state: NEW, title: open.title || 'New slide', time: '', words: WORDS[NEW], thumb: null, color, current: true };
}

/** The slide `step` tiles from `key`, or null past either end. With no slide shown, the first or the last. */
export function neighbour(tiles, key, step) {
  const list = tiles ?? [];
  const at = list.findIndex((t) => t.key === key);
  if (at < 0) return (step > 0 ? list[0] : list.at(-1)) ?? null;
  return list[at + step] ?? null;
}

/** The tiles a search in the list keeps: by title, label, time or state. */
export function findTiles(tiles, query) {
  const words = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tiles ?? [];
  return (tiles ?? []).filter((t) => {
    const text = [t.title, t.row?.label, t.time, t.words, t.reason].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/**
 * Where the player opens for a new scene: after the last moment proved, where the next
 * place is likely to show. Null when nothing is proved yet.
 */
export function resumeAt(tiles) {
  let last = null;
  for (const tile of tiles ?? []) {
    if (tile.kind !== 'proof' || !tile.row) continue;
    const moments = sceneMoments(tile.row);
    const ends = moments.length ? moments.map((m) => m.end ?? m.start) : tile.row.at ?? [];
    for (const t of ends) if (Number.isFinite(t) && (last === null || t > last)) last = t;
  }
  return last;
}

// -- a new slide keeps the look ---------------------------------------------------------

/**
 * Every field of the composer's proof, sorted into what a new slide keeps (its look)
 * and what it starts without (its content). `proofSlides.test.js` reads the composer's
 * document and fails on a field in neither list, so a new field is classed on purpose.
 */
export const SLIDE_LOOK = [
  'templateId', 'bg', 'space', 'layout', 'panelDirection', 'captionSize', 'legendSize', 'footerSize',
  'footer', 'footerEnabled', 'footerText', 'footerCoords', 'footerCredits', 'footerColor', 'footerAlign',
  'captionColor', 'captionsEnabled', 'sceneBadge', 'font', 'fontBold', 'signature', 'signatureText', 'azimutMark',
  'palette',
];
export const SLIDE_CONTENT = [
  'title', 'panels', 'pastes', 'shapes', 'notes', 'legendOrder', 'points', 'sources', 'material',
  'when', 'whenZone', 'description',
];

/**
 * What a new slide takes from the one before it: the house style, the text and footer
 * settings, the signature and the palette. Never its panels, its marks, its legend's
 * words or its facts.
 */
export function slideStyle(proof) {
  return {
    ...templateFromProof(proof),
    footerCredits: proof?.footerCredits === true,
    sceneBadge: proof?.sceneBadge === true,
    templateId: typeof proof?.templateId === 'string' ? proof.templateId : null,
  };
}

// -- moving to another slide ------------------------------------------------------------

/**
 * What moving to another slide does with the one on screen:
 *
 * - `open`: nothing to keep, the other slide opens at once;
 * - `drop`: a slide never saved and never started (no panel, no overlay, nothing typed)
 *   goes without a word;
 * - `ask`: nothing a save could keep (a save needs a panel), but something typed: the
 *   leave question asks first;
 * - `save`: the slide is saved first, and the other opens once the save landed.
 */
export function switchPlan({ started = false, dirty = false, saved = false, panels = 0, pastes = 0, facts = false } = {}) {
  if (!started || !dirty) return 'open';
  if (panels > 0) return 'save';
  return saved || pastes > 0 || facts ? 'ask' : 'drop';
}
