import { api as defaultApi } from '../api.js';

/** The plain colours a case offers until it names its own. */
export const PLAIN_COLOURS = [['#0072b2', 'Blue'], ['#d55e00', 'Orange'], ['#009e73', 'Green'], ['#cc79a7', 'Purple'], ['#f0e442', 'Yellow']];

/**
 * The case's named colours ("Side A", "Side B"), read once per case and shared by
 * the layer editor's palette and the legends that name what they count.
 */
export function createLayerPalette({ api = defaultApi } = {}) {
  let colours = $state([]);
  let owner = null;
  let asked = 0;
  return {
    get colours() { return colours; },
    /** The name a colour has in this case, or ''. */
    nameOf(colour) {
      const hex = String(colour ?? '').toLowerCase();
      return colours.find((entry) => entry.colour === hex)?.name ?? '';
    },
    load(caseId, again = false) {
      if (!caseId || (owner === caseId && !again)) return;
      owner = caseId;
      const ticket = ++asked;
      if (!again) colours = [];
      api.get(`/api/cases/${caseId}/layer-palette`)
        .then((body) => { if (ticket === asked) colours = body.colours ?? []; })
        .catch(() => {});
    },
    async save(caseId, list) {
      const body = await api.put(`/api/cases/${caseId}/layer-palette`, { colours: list });
      if (owner === caseId) colours = body.colours;
      return body.colours;
    },
  };
}

export const layerPalette = createLayerPalette();
