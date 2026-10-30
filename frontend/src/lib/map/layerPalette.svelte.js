import { api as defaultApi } from '../api.js';

/** The plain colours a case offers until it names its own. */
export const PLAIN_COLOURS = [['#0072b2', 'Blue'], ['#d55e00', 'Orange'], ['#009e73', 'Green'], ['#cc79a7', 'Purple'], ['#f0e442', 'Yellow']];

/**
 * What the case's colours and icons mean ("Side A", "Strike"), read once per case
 * and shared by the layer editor's palette, its key and the legends that name
 * what they count. An icon is named by its key: an app badge's id, or an own
 * icon's.
 */
export function createLayerPalette({ api = defaultApi } = {}) {
  let colours = $state([]);
  let icons = $state([]);
  let owner = null;
  let asked = 0;
  return {
    get colours() { return colours; },
    get icons() { return icons; },
    /** The name a colour has in this case, or ''. */
    nameOf(colour) {
      const hex = String(colour ?? '').toLowerCase();
      return colours.find((entry) => entry.colour === hex)?.name ?? '';
    },
    /** The name an icon has in this case, or ''. */
    iconNameOf(key) {
      return icons.find((entry) => entry.key === key)?.name ?? '';
    },
    load(caseId, again = false) {
      if (!caseId || (owner === caseId && !again)) return;
      owner = caseId;
      const ticket = ++asked;
      if (!again) { colours = []; icons = []; }
      api.get(`/api/cases/${caseId}/layer-palette`)
        .then((body) => { if (ticket === asked) { colours = body.colours ?? []; icons = body.icons ?? []; } })
        .catch(() => {});
    },
    /** Saves the colours, and the icons when given; left out, they keep their names. */
    async save(caseId, list, named = undefined) {
      const body = await api.put(`/api/cases/${caseId}/layer-palette`, named === undefined ? { colours: list } : { colours: list, icons: named });
      if (owner === caseId) { colours = body.colours; icons = body.icons ?? icons; }
      return body.colours;
    },
  };
}

export const layerPalette = createLayerPalette();
