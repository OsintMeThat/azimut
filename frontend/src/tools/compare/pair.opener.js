/**
 * A Compare picture in a note (a kept pair, a session's preview) opens its saved
 * comparison in Compare. Loaded with the note (`lib/notes/openersLoaded.js`).
 */
import { registerOpener } from '../../lib/notes/openers.js';
import { uiState } from '../../lib/state.svelte.js';

/** The saved comparison's name, the last segment of its spec path less `.json`. */
export function sessionName(entity) {
  const spec = entity?.attrs?.compare_session;
  return typeof spec === 'string' ? spec.split('/').pop().replace(/\.json$/, '') : '';
}

export const pairOpener = {
  accepts: (entity) => entity?.type === 'media' && Boolean(sessionName(entity)),
  open: (entity) => {
    uiState.openCompare = sessionName(entity);
    uiState.tool = 'compare';
  },
};

registerOpener('compare', pairOpener);
