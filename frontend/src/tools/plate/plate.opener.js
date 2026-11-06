/**
 * A page of a Map plate in a note (its page, or its days side by side) opens the
 * plate it was filed from, on the day and the step it shows. Loaded with the note
 * (`lib/notes/openersLoaded.js`), so it stays light.
 */
import { registerOpener } from '../../lib/notes/openers.js';
import { uiState } from '../../lib/state.svelte.js';

/** The saved plate's name, the last segment of its spec path less `.json`. */
export function plateName(entity) {
  const spec = entity?.attrs?.plate_spec;
  return typeof spec === 'string' ? spec.split('/').pop().replace(/\.json$/, '') : '';
}

export const plateOpener = {
  accepts: (entity) => entity?.type === 'media' && Boolean(plateName(entity)),
  open: (entity) => {
    const { plate_day: day, plate_step: step } = entity.attrs ?? {};
    uiState.openPlateAt = day || step ? { day: day ?? '', step: step ?? '' } : null;
    uiState.openPlate = plateName(entity);
    uiState.tool = 'plate';
  },
};

registerOpener('plate', plateOpener);
