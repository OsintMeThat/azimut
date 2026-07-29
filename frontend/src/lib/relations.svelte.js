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

const registry = $state({ types: [] });
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
  pending ??= api
    .get('/api/cases/relation-types')
    .then((types) => {
      registry.types = Array.isArray(types) ? types : [];
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

/**
 * The relations an analyst may state between a subject and another entity.
 *
 * The vocabulary is directed — a photo is shot at a place, never the reverse — so
 * each option records which end the subject sits on: `out` when the subject is
 * the `from`, `in` when it is the `to`. Callers never guess the order.
 */
export function relationOptions(subjectType, otherType) {
  const options = [];
  for (const entry of registry.types) {
    if (!entry.manual) continue;
    if (entry.from_types.includes(subjectType) && entry.to_types.includes(otherType)) {
      options.push({ type: entry.type, label: entry.label, direction: 'out' });
    } else if (entry.from_types.includes(otherType) && entry.to_types.includes(subjectType)) {
      options.push({ type: entry.type, label: entry.label, direction: 'in' });
    }
  }
  return options;
}

/** Entity types that can sit at the other end of a manual relation with this one. */
export function relatableTypes(subjectType) {
  const types = new Set();
  for (const entry of registry.types) {
    if (!entry.manual) continue;
    if (entry.from_types.includes(subjectType)) entry.to_types.forEach((t) => types.add(t));
    if (entry.to_types.includes(subjectType)) entry.from_types.forEach((t) => types.add(t));
  }
  return [...types];
}

/**
 * File one collected choice against a subject that now exists.
 *
 * Split from the picker because a relation is often chosen before its subject is
 * saved: the Satellite save gate lets the analyst say "this photo was shot here"
 * while filling in a place the case does not hold yet.
 */
export function saveRelation(caseId, subjectId, choice) {
  const [from_id, to_id] =
    choice.direction === 'out' ? [subjectId, choice.entityId] : [choice.entityId, subjectId];
  return api.post(`/api/cases/${caseId}/links`, { from_id, to_id, type: choice.type });
}
