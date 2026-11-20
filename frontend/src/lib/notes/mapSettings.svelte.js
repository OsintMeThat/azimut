/**
 * What a map's settings card asks of the case (`api/notemaps.py`): the map as it shows now,
 * read for the card to draw it and draw on it; the ground of another base or frame, filed on
 * the press that picks it; a map started from nothing; and the points, lines and areas drawn
 * on it, kept in a personal layer of the case the block names.
 *
 * What is drawn on a map is case data, not a line of the note, so the Page pane is told
 * (`mapsChanged`) and draws the page again at once, as it does when a picture's source is
 * stated; so is an infographic drawn in the note, whose map panels may show it (`onMapsTouched`).
 */
import { api } from '../api.js';

const base = (caseId) => `/api/cases/${encodeURIComponent(caseId)}/notes/maps`;

/** Bumped each time what a map draws changes outside its block: the Page pane reads it. */
export const mapsChanged = $state({ rev: 0 });

/** What hears a map's layer change outside a component: an infographic's page in the note. */
const hearing = new Set();

/** Hear each time what a map draws changes outside its block; answers how to stop. */
export function onMapsTouched(listener) {
  hearing.add(listener);
  return () => hearing.delete(listener);
}

/** Say a map's layer changed: what reads it, the Page pane and the cards, read it again. */
export function touchMaps() {
  mapsChanged.rev += 1;
  described.clear();
  for (const listener of hearing) listener();
}

/** The last answers, by case and text, kept while a card is drawn again (a pick, a scroll). */
const described = new Map();
const KEPT = 24;

/** The map as it shows now (`POST /notes/maps/describe`); answers `{ error }` when it cannot be read. */
export function describeMap({ caseId, text }, { post = api.post } = {}) {
  const key = `${caseId}\n${text}`;
  if (described.has(key)) return described.get(key);
  const asked = post(`${base(caseId)}/describe`, { text }).catch((error) => ({ error: error?.message || 'The map could not be read' }));
  described.set(key, asked);
  while (described.size > KEPT) described.delete(described.keys().next().value);
  asked.then((answer) => { if (answer?.error) described.delete(key); });
  return asked;
}

/** Forget what was read, for a case that changed under the cards. */
export function forgetMaps() {
  described.clear();
}

/** The ground of `base` filed for the map as framed now: `{ ground, details, view, filed, base }`. */
export function fileGround(caseId, { text, base: wanted, provider }, { post = api.post } = {}) {
  return post(`${base(caseId)}/ground`, { text, base: wanted, ...(provider ? { provider } : {}) });
}

/** A map from nothing: `{ title, west, south, east, north, base, provider }` → `{ text, filed, layer }`. */
export function startMap(caseId, request, { post = api.post } = {}) {
  return post(`${base(caseId)}/scratch`, request);
}

/** The personal layer a map's first drawing goes into, made for it: `{ name, title }`. */
export function makeOwnLayer(caseId, title, { post = api.post } = {}) {
  return post(`${base(caseId)}/layer`, { title });
}

/** A point, a line or an area drawn on a map's card, into the layer it names: `{ layer, key }`. */
export async function drawFeature(caseId, feature, { post = api.post } = {}) {
  const answer = await post(`${base(caseId)}/features`, feature);
  touchMaps();
  return answer;
}

/** A drawn feature renamed, recoloured, its days or its name on the map changed. */
export async function editFeature(caseId, key, changes, { patch = api.patch } = {}) {
  const answer = await patch(`${base(caseId)}/features/${encodeURIComponent(key)}`, changes);
  touchMaps();
  return answer;
}

/** A drawn feature taken out, and put back by its Undo. */
export async function removeFeature(caseId, layer, key, { del = api.del } = {}) {
  const answer = await del(`${base(caseId)}/features/${encodeURIComponent(key)}?layer=${encodeURIComponent(layer)}`);
  touchMaps();
  return answer;
}

export async function restoreFeature(caseId, layer, key, { post = api.post } = {}) {
  const answer = await post(`${base(caseId)}/features/${encodeURIComponent(key)}/restore?layer=${encodeURIComponent(layer)}`, {});
  touchMaps();
  return answer;
}
