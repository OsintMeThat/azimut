/**
 * The entity vocabulary (ONTOLOGY §2), fetched once and shared.
 *
 * The backend owns it: which types a case may hold, the family each sits in, the
 * icon that stands for it, and the fields an analyst may fill. Reading it here is
 * what lets one form serve every type — adding `vessel` is an edit in
 * `engine/entities.py`, not a new panel.
 *
 * Same lazy shape as the relation registry next door: loaded on the first surface
 * that needs it, dropped rather than cached on failure so the next surface retries
 * instead of inheriting an empty vocabulary for good. Until one succeeds a type
 * reads as its own slug and declares no fields — degraded, never broken.
 */
import { api } from './api.js';

const registry = $state({ types: [] });
let pending = null;

export function loadEntityTypes() {
  pending ??= api
    .get('/api/cases/entity-types')
    .then((types) => {
      registry.types = Array.isArray(types) ? types : [];
    })
    .catch(() => {
      pending = null;
    });
  return pending;
}

const entryFor = (type) => registry.types.find((entry) => entry.type === type) ?? null;

/** How a type reads in words, or the raw slug until the registry lands. */
export function entityLabel(type) {
  return entryFor(type)?.label ?? type;
}

/** Which family a type sits in, or null for a free type the registry has never
 *  heard of. Free types stay storable; they just have no verbs. */
export function entityFamily(type) {
  return entryFor(type)?.family ?? null;
}

/** One clause saying what a type is, or '' until the registry lands. The vocabulary
 *  is terse on purpose — `capture`, `claim`, `collected` — and a terse word nobody can
 *  look up is jargon, so every menu that offers a type can explain it. */
export function entityHint(type) {
  return entryFor(type)?.hint ?? '';
}

/** What the primary value is called in a form. It is stored as ``entity.label``;
 * the type-specific reading avoids a second IP/handle/name field that could drift. */
export function entityIdentityLabel(type) {
  return entryFor(type)?.identity_label ?? 'Title';
}

/** Example or short prompt for the primary value. */
export function entityIdentityPlaceholder(type) {
  return entryFor(type)?.identity_placeholder ?? 'What to call it';
}

/** One clause saying what a family is. Families are the load-bearing idea and the
 *  one part an analyst never types, so a filter naming them has to say what they are.
 *  Read off any type in the family: the reading travels with the registry rows. */
export function familyReads(family) {
  return registry.types.find((entry) => entry.family === family)?.family_reads ?? '';
}

/** The icon that stands for a type, or null until the registry lands.
 *
 *  The registry is where this lives, so adding a type is still one entry in
 *  `engine/entities.py`. Before this, four screens each kept their own map and
 *  every one of them had drifted: two still listed types retired at the design
 *  stage, none of them knew about a claim. `lib/entityIcon.js` is the one caller.
 */
export function typeIcon(type) {
  return entryFor(type)?.icon ?? null;
}

/**
 * The declared fields for a type, in registry order.
 *
 * "Declared" means *a field an analyst may fill*, never *everything this type
 * holds*: a place's `lat`, `geo` and `notes` belong to the save that made the
 * point and are not listed here, which is why rendering these cannot disturb them.
 */
export function entityFields(type) {
  return entryFor(type)?.attrs ?? [];
}

/**
 * Mark the field that opens each heading, over the fields actually being rendered.
 *
 * The registry heads a *field*, not a type, because one type can hold several
 * subjects: a Claim says what it states, when it applies and why it is believed,
 * where a place's four fields all answer how tightly the point is pinned. A heading
 * is emitted where the group changes, so the registry's order is left exactly as it
 * is — a form that regrouped its own fields would stop being the order the vocabulary
 * declares.
 *
 * Takes the shown fields rather than the type, because a field can be hidden — an
 * untraced footprint, an empty legacy value — and a heading resolved before that
 * filter could survive every field it was heading.
 */
export function withHeadings(fields) {
  let last = '';
  return fields.map((field) => {
    const group = field.group ?? '';
    const heads = group && group !== last ? group : '';
    last = group;
    return { ...field, heads };
  });
}

/** Every type the vocabulary knows, in menu order. Empty until the registry lands. */
export function entityTypes() {
  return registry.types;
}

/** The families, in the order the registry lists their types. What the board
 *  filters by first: a handful of readings is a menu, every type is a list. */
export function entityFamilies() {
  return [...new Set(registry.types.map((entry) => entry.family))];
}

/** The types an analyst creates by hand, for a create menu. A `media` is born
 *  from an import, so it is not one of them. */
export function creatableTypes() {
  return registry.types.filter((entry) => entry.manual);
}

/** Whether this type is entered as a graph record rather than born from a tool. */
export function isManualEntityType(type) {
  return Boolean(entryFor(type)?.manual);
}

/** Whether Details may attach presentation photos to this type. */
export function hasImageGallery(type) {
  return Boolean(entryFor(type)?.image_gallery);
}

/** Where a source's Admiralty grade is stored. The key is a contract, like `url` or
 *  `path`; the scale behind it is registry data, so nothing here spells the letters. */
export const RELIABILITY = 'reliability';

/**
 * How reliable this entity says it is, as `{ grade, label }`, or null.
 *
 * Null covers all three ways there is nothing to show: the type is not a source, the
 * source has not been graded, or a stored value the scale has never heard of. All
 * three render as nothing — a source with no grade is the normal case, and flagging
 * it would turn an optional field into a standing chore.
 *
 * It belongs to the entity and is read wherever that entity appears. It is never
 * folded into the edge's own rating: reliability is what the source is worth,
 * credibility is what this one statement is worth, and the Admiralty scheme exists
 * precisely so the two are not multiplied together (ONTOLOGY §3).
 */
export function reliabilityOf(entity) {
  const grade = entity?.attrs?.[RELIABILITY];
  if (!grade) return null;
  const field = entityFields(entity.type).find((f) => f.key === RELIABILITY);
  const option = (field?.options ?? []).find((o) => o.value === grade);
  return option ? { grade, label: option.label } : null;
}
