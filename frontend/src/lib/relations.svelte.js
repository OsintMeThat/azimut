/**
 * The relation vocabulary (ONTOLOGY §3), fetched once and shared.
 *
 * The backend owns it: which non-chain edges exist, how each one reads in words,
 * what entity types either end accepts, and whether an analyst may state it at
 * all. Every surface that shows or creates a relation reads this registry, so
 * adding a type is one edit in `engine/links.py` rather than one per screen.
 *
 * Loaded lazily on the first surface that needs it and kept for the session —
 * the vocabulary is code, not case data, so it never changes under an open tab.
 */
import { api } from './api.js';

const registry = $state({ types: [], levels: [] });
let pending = null;

/**
 * Fetch the vocabulary once. Safe to call from every component that needs it —
 * the session loads it at startup and each surface asks again on mount, which is
 * what makes a failed read recoverable: it is dropped rather than cached, so the
 * next surface retries instead of inheriting an empty vocabulary for good. Until
 * one succeeds, rows name an edge by its type and the picker stays empty: a
 * degraded label, never a broken panel.
 */
export function loadRelationTypes() {
  pending ??= Promise.all([
    api.get('/api/cases/relation-types'),
    api.get('/api/cases/confidence-levels'),
  ])
    .then(([types, levels]) => {
      registry.types = Array.isArray(types) ? types : [];
      registry.levels = Array.isArray(levels) ? levels : [];
    })
    .catch(() => {
      pending = null;
    });
  return pending;
}

/** How a link type reads in words, or the raw type until the registry lands. */
export function relationVerb(type) {
  return registry.types.find((entry) => entry.type === type)?.label ?? type;
}

/** How a relation reads from the entity being viewed. */
export function relationReading(type, direction = 'out') {
  const entry = registry.types.find((row) => row.type === type);
  if (!entry) return type;
  return direction === 'in' ? (entry.inverse_label ?? entry.label) : entry.label;
}

/**
 * The levels an edge may be rated, coarsest word last.
 *
 * Served rather than written here for the reason the radius rungs are: one list, so
 * the picker cannot offer a value the API would refuse. **Not assessed is not in it**
 * — it is the absence of a rating, so a surface offers it as "clear", never as a
 * fifth choice.
 */
export function confidenceLevels() {
  return registry.levels;
}

/** How one rating reads in words, or '' when the edge has none. */
export function confidenceLabel(value) {
  if (value == null) return '';
  return registry.levels.find((level) => level.value === value)?.label ?? String(value);
}

/** One clause saying what a verb means, where the words alone are ambiguous: "is part
 *  of" against "owns" is the distinction an order of battle turns on. */
export function relationHint(type) {
  return registry.types.find((entry) => entry.type === type)?.hint ?? '';
}

/** The heading a verb sits under, or '' when it sits with the rest. A pointer — a
 *  note naming a place it was not made from — reads as a finding when it shares a
 *  list with one, so the registry says where it belongs and every surface obeys. */
export function relationGroup(type) {
  return registry.types.find((entry) => entry.type === type)?.group ?? '';
}

/** Which user gesture files this verb. Mentions are pointers and use their own
 * button; every older registry row safely remains a regular relation. */
export function relationAction(type) {
  return registry.types.find((entry) => entry.type === type)?.action ?? 'relation';
}

/** One clause placing a rating on the scale, for the control that offers it. */
export function confidenceHint(value) {
  if (value == null) return '';
  return registry.levels.find((level) => level.value === value)?.hint ?? '';
}

/** Whether this link type may carry a rating at all: a derivation may not. */
export function isRatable(type) {
  return registry.types.find((entry) => entry.type === type)?.ratable ?? false;
}

/**
 * The relations an analyst may state between a subject and another entity.
 *
 * The vocabulary is directed — a photo is recorded at a place, never the reverse — so
 * each option records which end the subject sits on: `out` when the subject is
 * the `from`, `in` when it is the `to`. Callers never guess the order.
 */
function endpoint(value) {
  if (typeof value === 'string') return { type: value, kind: null };
  return {
    type: value?.type ?? null,
    kind: value?.attrs?.kind ?? value?.kind ?? null,
  };
}

function mediaKindAllowed(end, allowed) {
  if (end.type !== 'media' || !allowed?.length || end.kind == null) return true;
  return allowed.includes(end.kind);
}

export function relationOptions(subject, other, action = 'all') {
  const subjectEnd = endpoint(subject);
  const otherEnd = endpoint(other);
  const options = [];
  for (const entry of registry.types) {
    if (!entry.manual) continue;
    if (action !== 'all' && (entry.action ?? 'relation') !== action) continue;
    const group = entry.group ?? '';
    const outward =
      entry.from_types.includes(subjectEnd.type) &&
      entry.to_types.includes(otherEnd.type) &&
      mediaKindAllowed(subjectEnd, entry.from_media_kinds) &&
      mediaKindAllowed(otherEnd, entry.to_media_kinds);
    const inward =
      entry.from_types.includes(otherEnd.type) &&
      entry.to_types.includes(subjectEnd.type) &&
      mediaKindAllowed(otherEnd, entry.from_media_kinds) &&
      mediaKindAllowed(subjectEnd, entry.to_media_kinds);
    if (outward) {
      options.push({ type: entry.type, label: entry.label, group, direction: 'out' });
    }
    // Equal endpoint types can support both readings. A parent network contains a
    // child network, while that child is in the parent; collapsing this to the
    // first match made one direction impossible from half of the Details panels.
    if (inward) {
      options.push({
        type: entry.type,
        label: entry.inverse_label ?? entry.label,
        group,
        direction: 'in',
      });
    }
  }
  // Headed verbs last, registry order kept inside each. Callers take the first as
  // the default reading, and a pointer is never the strongest thing a pair can say
  // — where "was recorded at" is available, "mentions" must not win by declaration order.
  return options.sort((a, b) => Number(Boolean(a.group)) - Number(Boolean(b.group)));
}

/** Whether a stored row still fits the current endpoint contract. */
export function isCurrentConnection(subject, relation) {
  return relationOptions(subject, relation.entity, relationAction(relation.link.type)).some(
    (option) => option.type === relation.link.type && option.direction === relation.direction
  );
}

/** Entity types that can sit at the other end of a manual relation with this one. */
export function relatableTypes(subject, action = 'all') {
  const subjectEnd = endpoint(subject);
  const types = new Set();
  for (const entry of registry.types) {
    if (!entry.manual) continue;
    if (action !== 'all' && (entry.action ?? 'relation') !== action) continue;
    if (
      entry.from_types.includes(subjectEnd.type) &&
      mediaKindAllowed(subjectEnd, entry.from_media_kinds)
    ) {
      entry.to_types.forEach((type) => types.add(type));
    }
    if (
      entry.to_types.includes(subjectEnd.type) &&
      mediaKindAllowed(subjectEnd, entry.to_media_kinds)
    ) {
      entry.from_types.forEach((type) => types.add(type));
    }
  }
  return [...types];
}

/**
 * File one collected choice against a subject that now exists.
 *
 * Split from the picker because a relation is often chosen before its subject is
 * saved: the Satellite save gate lets the analyst say "this photo was recorded here"
 * while filling in a place the case does not hold yet.
 */
export function saveRelation(caseId, subjectId, choice) {
  const [from_id, to_id] =
    choice.direction === 'out' ? [subjectId, choice.entityId] : [choice.entityId, subjectId];
  return api.post(`/api/cases/${caseId}/links`, { from_id, to_id, type: choice.type });
}
