/**
 * The case item one of the analyst's markers follows, opened where it is worked
 * on: a proof in Geo Proof, a file in Media. The marker only holds the item's
 * id, so the item is read whole first, its own tool deciding how it opens.
 */
import { api } from '../api.js';
import { caseState, toast } from '../state.svelte.js';
import { openEntity } from '../navigate.js';

export async function openFollowed(caseId, id) {
  try {
    const chain = await api.get(`/api/cases/${caseId}/entities/${id}/chain`);
    if (caseState.current?.id === caseId) openEntity(chain.entity, true);
  } catch (error) { toast(error.message, 'danger'); }
}
