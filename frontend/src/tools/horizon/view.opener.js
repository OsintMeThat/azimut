/**
 * A picture kept from a saved Horizon view (the photo above the terrain, a capture
 * taken under it) opens that view in Horizon. Loaded with the note
 * (`lib/notes/openersLoaded.js`), so it stays light.
 */
import { registerOpener } from '../../lib/notes/openers.js';
import { uiState } from '../../lib/state.svelte.js';

/** The saved view's name, the last segment of its spec path less `.json`. */
export function viewName(entity) {
  const spec = entity?.attrs?.horizon_view;
  return typeof spec === 'string' ? spec.split('/').pop().replace(/\.json$/, '') : '';
}

export const viewOpener = {
  accepts: (entity) => entity?.type === 'media' && Boolean(viewName(entity)),
  open: (entity) => {
    uiState.openHorizonView = viewName(entity);
    uiState.tool = 'horizon';
  },
};

registerOpener('horizon', viewOpener);
