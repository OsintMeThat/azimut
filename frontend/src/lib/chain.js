/**
 * Derivation chain: walking the case graph's links around one entity.
 *
 * The backend emits `derived-from` (an artifact and the sources it was made
 * from) and `depends-on` (a session and the subject it is worthless without)
 * at save time; this reads them back in both directions, so an entity can show
 * both what it came from and what was built on it.
 *
 * Entities carry `attrs.lost_sources` for sources deleted out from under them —
 * a source that is gone still shows in the chain, as a tombstone rather than a
 * link, so the trail never just ends.
 */

export const DERIVED_FROM = 'derived-from';
export const DEPENDS_ON = 'depends-on';

const CHAIN_TYPES = [DERIVED_FROM, DEPENDS_ON];

const byId = (entities) => new Map(entities.map((e) => [e.id, e]));

/** Entities this one was made from or points at (outgoing links). */
export function sourcesOf(entities, links, id) {
  const index = byId(entities);
  return links
    .filter((l) => l.from === id && CHAIN_TYPES.includes(l.type))
    .map((l) => ({ entity: index.get(l.to), type: l.type }))
    .filter((r) => r.entity);
}

/** Entities made from this one, or that could not exist without it (incoming). */
export function dependentsOf(entities, links, id) {
  const index = byId(entities);
  return links
    .filter((l) => l.to === id && CHAIN_TYPES.includes(l.type))
    .map((l) => ({ entity: index.get(l.from), type: l.type }))
    .filter((r) => r.entity);
}

/** Sources that were deleted: kept as tombstones on the entity itself. */
export function lostSourcesOf(entity) {
  return entity?.attrs?.lost_sources ?? [];
}

/**
 * Walk `derived-from`/`depends-on` upstream to the original — a proof's chain
 * back through its frame and its video to the download. Breadth-first, so the
 * closest source comes first; `depth` starts at 1 for a direct source.
 *
 * A cycle cannot happen through a save (an artifact is filed after its sources)
 * but the visited set makes the walk total regardless — a hand-edited case.json
 * must not hang the sidebar.
 */
export function walkUp(entities, links, id, { maxDepth = 12 } = {}) {
  const out = [];
  const seen = new Set([id]);
  let frontier = [id];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const current of frontier) {
      for (const { entity, type } of sourcesOf(entities, links, current)) {
        if (seen.has(entity.id)) continue;
        seen.add(entity.id);
        out.push({ entity, type, depth });
        next.push(entity.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** The mirror of `walkUp`: everything built on this entity, however indirectly. */
export function walkDown(entities, links, id, { maxDepth = 12 } = {}) {
  const out = [];
  const seen = new Set([id]);
  let frontier = [id];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const current of frontier) {
      for (const { entity, type } of dependentsOf(entities, links, current)) {
        if (seen.has(entity.id)) continue;
        seen.add(entity.id);
        out.push({ entity, type, depth });
        next.push(entity.id);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Everything the Details panel needs for one entity: its direct sources (live
 * and lost), what depends on it, and whether there is any chain at all — the
 * panel hides the section entirely rather than showing an empty shell.
 */
export function chainOf(entities, links, id) {
  const entity = entities.find((e) => e.id === id) ?? null;
  const sources = sourcesOf(entities, links, id);
  const lost = lostSourcesOf(entity);
  const dependents = dependentsOf(entities, links, id);
  return {
    entity,
    sources,
    lost,
    dependents,
    empty: !sources.length && !lost.length && !dependents.length,
  };
}

/**
 * What deleting this entity would do, computed the same way the backend does
 * (engine/links.py) — `depends-on` cascades transitively, `derived-from` never
 * does. The dialog still asks the backend for the authoritative plan; this
 * mirror is what lets the sidebar warn without a round-trip.
 */
export function deletePlan(entities, links, id) {
  const index = byId(entities);
  const doomed = [id];
  const frontier = [id];
  while (frontier.length) {
    const current = frontier.pop();
    for (const l of links) {
      if (l.to === current && l.type === DEPENDS_ON && !doomed.includes(l.from) && index.has(l.from)) {
        doomed.push(l.from);
        frontier.push(l.from);
      }
    }
  }
  const scarred = [];
  for (const l of links) {
    if (
      doomed.includes(l.to) &&
      l.type === DERIVED_FROM &&
      !doomed.includes(l.from) &&
      !scarred.includes(l.from) &&
      index.has(l.from)
    ) {
      scarred.push(l.from);
    }
  }
  return {
    cascade: doomed.slice(1).map((i) => index.get(i)),
    tombstone: scarred.map((i) => index.get(i)),
  };
}
