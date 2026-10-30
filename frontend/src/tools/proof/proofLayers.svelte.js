/**
 * A proof's points in the analyst's layers (`itemLayers.svelte.js`), the proof
 * named by the name it was saved under.
 *
 * A marker added from a proof follows it, so it is added from the proof as
 * saved, never from what the composer holds unsaved; the composer saves first.
 * A proof standing in several places has one marker per point, and a marker
 * belongs to the point it stands nearest to (`placesOf`).
 */
import { specPath } from '../../lib/naming.js';
import { createItemLayers } from '../satellite/itemLayers.svelte.js';

export { orderedTargets, placesOf } from '../satellite/itemLayers.svelte.js';

export function createProofLayers({ lookup, ...rest }) {
  return createItemLayers({
    ...rest,
    missing: 'This proof is no longer in the case',
    resolve: async (caseId, savedName) => (await lookup(caseId, 'spec', specPath('proof', savedName)))?.id ?? null,
  });
}
