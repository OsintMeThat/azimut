/**
 * Whether one entity answers a typed term, matching the server's own index.
 *
 * A bounded list searches in memory while the case fits one page and asks the
 * server past it (`lib/pagedList.svelte.js`). Two predicates for one box means the
 * same term answers differently either side of that threshold, which is what
 * happened here: the board compared the label alone, so a plate, an IMO or a
 * claim's wording was findable in a large case and invisible in a small one — the
 * exact fields the vocabulary went to the trouble of declaring.
 *
 * So this mirrors `sqlite_backend._entity_search_text`: the label, the type, the
 * folder, the notes, and the declared fields whose kind is worth matching text
 * against. Numbers, geometries and stored grade letters stay out on both sides —
 * "500" against every radius in a case buries the rows that actually say 500.
 */
import { entityFields } from './entityTypes.svelte.js';
import { folderOf } from './folderTree.js';

/** Declared kinds a value is worth finding an entity by. Mirrors
 *  `entities.SEARCHABLE_KINDS`. */
const SEARCHABLE_KINDS = new Set(['text', 'longtext', 'url']);

/** Everything a term is compared against, lowercased, in one string. */
export function entitySearchText(entity) {
  if (!entity) return '';
  const declared = entityFields(entity.type)
    .filter((field) => SEARCHABLE_KINDS.has(field.kind ?? 'text'))
    .map((field) => entity.attrs?.[field.key]);
  return [entity.label, entity.type, folderOf(entity), entity.attrs?.notes, ...declared]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join('\n')
    .toLowerCase();
}

/** True when the entity answers the term. An empty term matches everything, so a
 *  caller can hand the box straight through without a guard of its own. */
export function matchesEntity(entity, query) {
  const term = String(query ?? '').trim().toLowerCase();
  return !term || entitySearchText(entity).includes(term);
}
