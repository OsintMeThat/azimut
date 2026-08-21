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

/**
 * The two edges the app files by itself, and the words they read as.
 *
 * They are not in the registry because nobody may state them: an artifact is
 * recorded as made from its source at save time (`engine/links.py`). The wording
 * still has to live somewhere shared, since any surface drawing an edge has to
 * name it, and `derived-from` is a type rather than a sentence.
 */
export const CHAIN_TYPES = ['derived-from', 'depends-on'];
const CHAIN_VERBS = { 'derived-from': 'made from', 'depends-on': 'needs' };
/**
 * The same two edges read from the other end.
 *
 * A derivation is the one kind of edge an analyst walks in both directions as a
 * matter of course — a proof is made from a collage made from a video, and the
 * question is as often "what came out of this" as "what is this made from". Without
 * these, reading one backwards fell through to the raw type and a panel said
 * `derived-from` where every other edge said a sentence.
 */
const CHAIN_INVERSE = { 'derived-from': 'is the source of', 'depends-on': 'is needed by' };

/** How a link type reads in words, or the raw type until the registry lands. */
export function relationVerb(type) {
  return registry.types.find((entry) => entry.type === type)?.label ?? CHAIN_VERBS[type] ?? type;
}

/** How a relation reads from the entity being viewed. */
export function relationReading(type, direction = 'out') {
  const entry = registry.types.find((row) => row.type === type);
  // The two chain types are deliberately absent from the registry — nobody may
  // state them — so their wording is the fallback rather than the raw type.
  if (!entry) {
    const words = direction === 'in' ? CHAIN_INVERSE[type] : CHAIN_VERBS[type];
    return words ?? type;
  }
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

/** How a free note on this verb is labelled, or '' when it takes none.
 *
 *  It belongs to the verb and not to the edge, so a surface draws the field because
 *  the registry declares it — never because some edge happens to carry a value. Same
 *  shape as `isRatable`, and read the same way. */
export function relationQualifier(type) {
  return registry.types.find((entry) => entry.type === type)?.qualifier ?? '';
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

/**
 * Whether a verb reads the same word in both directions.
 *
 * `in-network` does not — a parent *contains* a child while the child *is in* the
 * parent — so its two readings are two findings. `associated-with` does: two people
 * are associated with each other, and there is no second sentence to tell apart. So
 * it is offered once, and asking which way a stored one runs is a question with no
 * answer.
 *
 * The inverse has to be **declared** and equal, never merely missing. The route
 * always sends one, so the two cases never coincide against a real registry — but
 * read as symmetric, a verb that simply never spelled its inverse would stop having
 * its direction checked at all, which is the one thing this decides.
 */
function symmetric(entry) {
  return Boolean(entry?.inverse_label) && entry.inverse_label === entry.label;
}

export function isSymmetric(type) {
  return symmetric(registry.types.find((row) => row.type === type));
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
    //
    // Unless the two readings are the same word: `associated-with` is symmetric, so
    // offering it twice puts one sentence in the menu twice and asks the analyst to
    // choose between two identical lines.
    if (inward && !(outward && symmetric(entry))) {
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

/**
 * Whether a stored row still fits the current endpoint contract.
 *
 * The direction has to match, because the two readings of an asymmetric verb are two
 * different findings and only one of them may still be legal. **A symmetric verb is
 * the exception**: it is offered once, so the entity on the far end of one would
 * find no inward reading to match and every such row read as an older connection —
 * marked as out-of-matrix and stripped of its controls on exactly one of the two
 * panels that show it.
 */
export function isCurrentConnection(subject, relation) {
  return relationOptions(subject, relation.entity, relationAction(relation.link.type)).some(
    (option) =>
      option.type === relation.link.type &&
      (option.direction === relation.direction || isSymmetric(option.type))
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

/**
 * What to ask before an edge is taken back, or `null` when nothing needs asking.
 *
 * Two acts wear one button today, and only one of them is irreversible.
 *
 * **Dismissing a proposal** is the review gesture these panels exist for. A tool suggested
 * it, nobody stated it, and refusing it costs the analyst nothing — so it stays one click.
 *
 * **Removing a stated relation** is the case retracting its own claim. `remove_relation`
 * drops the row outright: no Trash holds it, no toast can undo it, and re-filing one later
 * mints a new id, a new date and a new author (docs/UI.md §Graph). It was the only
 * permanent write in the app that asked nothing, sitting next to *Confirm* and the rating
 * in a panel opened to **read** an edge.
 *
 * Worded here rather than in each panel so the three surfaces that offer the act — the
 * Details relations, a Claim's connectors, the Graph's edge — cannot word it three ways.
 */
export function retractionWarning(link, action = 'relation') {
  if (link?.provenance?.status === 'suggested') return null;
  const noun = action === 'mention' ? 'mention' : 'relation';
  return {
    title: `Remove this ${noun}?`,
    message: 'The case stops stating it.',
    detail:
      'Nothing holds a removed edge. Filing it again later is a new statement, with a new date and a new author.',
    confirmLabel: 'Remove',
  };
}
