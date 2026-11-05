/**
 * A map capture in a note opens the Map on the view it was taken in: its centre,
 * zoom, bearing and basemap, with the capture shown in the Saved panel.
 * Loaded with the note (`lib/notes/openersLoaded.js`), so it stays light.
 */
import { registerOpener } from '../../lib/notes/openers.js';
import { uiState } from '../../lib/state.svelte.js';

const recorded = (value) => (value === null || value === undefined || value === '' ? NaN : Number(value));

export const captureOpener = {
  label: 'Open in Map',
  accepts: (entity) => entity?.type === 'capture'
    && Number.isFinite(recorded(entity.attrs?.lat)) && Number.isFinite(recorded(entity.attrs?.lon)),
  open: (entity) => {
    const attrs = entity.attrs ?? {};
    uiState.gotoCoords = {
      lat: Number(attrs.lat),
      lon: Number(attrs.lon),
      zoom: recorded(attrs.zoom),
      bearing: recorded(attrs.bearing),
      provider: attrs.provider,
    };
    uiState.focusCapture = attrs.path ?? null;
    uiState.tool = 'satellite';
  },
};

registerOpener('satellite', captureOpener);
