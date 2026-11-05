/**
 * A pinned candidate's evidence in a note opens Detect on its run, at that
 * candidate. It reads the run and the candidate the picture's record carries
 * (written by the pin); an evidence picture pinned before then offers no way back.
 * Loaded with the note (`lib/notes/openersLoaded.js`), so it stays light.
 */
import { registerOpener } from '../../lib/notes/openers.js';
import { uiState } from '../../lib/state.svelte.js';
import { holdCandidate } from './handoff.js';

const RUN = /^[a-f0-9]{12}$/;

export const pinOpener = {
  accepts: (entity) => entity?.type === 'media' && RUN.test(String(entity.attrs?.analysis_run ?? ''))
    && Boolean(entity.attrs?.candidate_id),
  open: (entity) => {
    holdCandidate(entity.attrs.analysis_run, entity.attrs.candidate_id);
    uiState.openAnalyzer = `runs-${entity.attrs.analysis_run}`;
    uiState.tool = 'detect';
  },
};

registerOpener('detect', pinOpener);
