import { api } from '../api.js';
import { caseState, reloadCase, toast } from '../state.svelte.js';
import { addedLayers } from './addedLayersState.svelte.js';
import { createMyLayersState } from '../../tools/satellite/state/myLayers.svelte.js';
import { createPlaceDeletionState } from '../../tools/satellite/state/placeDeletion.svelte.js';
import { deletedToast } from '../trash.js';

/** One editing session follows the analyst across all four map workspaces. */
export const personalLayers = createMyLayersState({ api, layers: addedLayers,
  caseId: () => caseState.current?.id, notify: toast, reloadCase });
export const personalPlaceDeletion = createPlaceDeletionState({ api,
  caseId: () => caseState.current?.id, notify: toast, reloadCase, ondeleted: deletedToast,
  refresh: () => personalLayers.editor ? personalLayers.refresh() : Promise.resolve() });
