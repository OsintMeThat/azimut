/**
 * Inspect's pictures in a note open where they were made: a frame on its video
 * at the instant it was cut, a collage's export in Collage. Both read what the
 * picture's record says (`frame_of` and `frame_time`, `collage`), written when it
 * was saved; a picture saved before then has no way back and offers none.
 * Loaded with the note (`lib/notes/openersLoaded.js`), so it stays light.
 */
import { registerOpener } from '../../lib/notes/openers.js';
import { uiState } from '../../lib/state.svelte.js';
import { holdSeek } from './handoff.js';

export const frameOpener = {
  accepts: (entity) => entity?.type === 'media' && typeof entity.attrs?.frame_of === 'string' && Boolean(entity.attrs.frame_of),
  open: (entity) => {
    holdSeek(entity.attrs.frame_of, entity.attrs.frame_time);
    uiState.inspectPath = entity.attrs.frame_of;
    uiState.tool = 'inspect';
  },
};

export const collageOpener = {
  accepts: (entity) => entity?.type === 'media' && typeof entity.attrs?.collage === 'string' && Boolean(entity.attrs.collage),
  open: (entity) => {
    uiState.openCollage = entity.attrs.collage;
    uiState.tool = 'collage';
  },
};

registerOpener('inspect', frameOpener);
registerOpener('collage', collageOpener);
