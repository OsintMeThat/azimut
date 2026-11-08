/**
 * Every icon the app can draw, under one id each, so one name means one thing on a
 * proof, a layer and a plate.
 *
 * Three kinds, drawn three ways:
 * - `stamp`: the proof's own eleven (`point`, `tank`…), filled silhouettes.
 * - `glyph`: a layer badge's flat pictogram (`badge-fire`…), from `markerGlyphs.js`.
 *   Anything without a heading is a glyph: a fire has no front.
 * - `model`: a vehicle model (`model-tank`…) that turns and tilts, from `models.js`,
 *   which loads on demand. Ids never clash: `tank`, `badge-tank` and `model-tank`
 *   are three drawings.
 * The four plain layer markers (`pin`, `circle`, `star`, `flag`) are listed as
 * `plain` and belong to layers alone.
 *
 * `group` is where a proof's picker files the icon (Marks, Vehicles, Events, Places,
 * People), or null for one the picker leaves out: a source badge says where a
 * file came from, and a vehicle badge is drawn better by its model.
 */
import symbols from '../map/layerSymbols.json';
import { MODEL_FAMILIES, MODEL_META } from './modelMeta.js';
import { STAMPS } from './stamps.js';

export const PROOF_GROUPS = ['Marks', 'Vehicles', 'Events', 'Places', 'People'];

const STAMP_GROUP = {
  point: 'Marks', nord: 'Marks', camera: 'Marks', impact: 'Events',
  vehicle: 'Vehicles', truck: 'Vehicles', tank: 'Vehicles', drone: 'Vehicles',
  person: 'People', building: 'Places', antenna: 'Places',
};
const STAMP_KEYWORDS = {
  point: ['pin', 'marker', 'location'], nord: ['north', 'compass', 'orientation'], camera: ['photo', 'viewpoint', 'position'],
  impact: ['strike', 'hit', 'blast'], vehicle: ['car', 'side view'], truck: ['lorry', 'side view'], tank: ['armour', 'side view'],
  drone: ['quadcopter', 'uav'], person: ['individual', 'human'], building: ['structure', 'block'], antenna: ['mast', 'tower', 'radio'],
};

/** A badge's place in a proof's picker, by its layer group, with the exceptions named. */
const BADGE_GROUP = { Markers: 'Marks', Events: 'Events', Places: 'Places' };
const BADGE_EXCEPTIONS = {
  'badge-soldier': 'People', 'badge-shield': 'People', 'badge-group': 'People', 'badge-person-above': 'People',
  'badge-missile': 'Events', 'badge-bomb': 'Events',
  // the stamps of the same name are the proof's person and building
  'badge-user': null, 'badge-building': null,
};

const stampEntries = STAMPS.map((s) => ({
  id: s.name, label: s.label, kind: 'stamp', group: STAMP_GROUP[s.name], keywords: STAMP_KEYWORDS[s.name] ?? [],
}));
const layerEntries = symbols.map((s) => {
  const glyph = s.id.startsWith('badge-');
  return {
    id: s.id, label: s.label, kind: glyph ? 'glyph' : 'plain', layerGroup: s.group, keywords: s.keywords ?? [],
    group: glyph ? (s.id in BADGE_EXCEPTIONS ? BADGE_EXCEPTIONS[s.id] : BADGE_GROUP[s.group] ?? null) : null,
  };
});
const modelEntries = MODEL_META.map((m) => ({
  id: m.id, label: m.label, kind: 'model', group: 'Vehicles', family: m.family, keywords: m.keywords,
}));

export const CATALOG = [...stampEntries, ...layerEntries, ...modelEntries];

const BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

/** The entry for an id, or null for one this build does not know. */
export const catalogEntry = (id) => BY_ID.get(id) ?? null;

export const isModel = (id) => BY_ID.get(id)?.kind === 'model';

/** Whether a proof can stamp this id: a stamp, a glyph or a model, whether or not its picker offers it. */
export const isStampable = (id) => ['stamp', 'glyph', 'model'].includes(BY_ID.get(id)?.kind);

/**
 * The proof picker's groups in order, each with its icons. Vehicles lists the
 * flat stamps first, then the models family by family.
 */
export function proofPicker() {
  const familyRank = (e) => (e.kind === 'model' ? 1 + MODEL_FAMILIES.indexOf(e.family) : 0);
  return PROOF_GROUPS.map((group) => {
    const items = CATALOG.filter((e) => e.group === group);
    if (group === 'Vehicles') items.sort((a, b) => familyRank(a) - familyRank(b));
    else items.sort((a, b) => (a.kind === 'stamp' ? 0 : 1) - (b.kind === 'stamp' ? 0 : 1));
    return { group, items };
  });
}

/** Icons whose name or keywords hold every word of `query`, in catalogue order. */
export function searchCatalog(query, list = CATALOG) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((e) => {
    const hay = [e.label, e.id, ...(e.keywords ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
