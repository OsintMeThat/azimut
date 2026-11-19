import { api as defaultApi } from '../api.js';

/** How many colours a case names, and how long a name may be (`layerediting.MAX_PALETTE`, `PaletteEntryIn`). */
export const MAX_PALETTE = 12;
export const MAX_COLOUR_NAME = 40;

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
  let read = null;
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
        .then((body) => { if (ticket === asked) { colours = body.colours ?? []; icons = body.icons ?? []; read = caseId; } })
        .catch(() => {});
    },
    /** Saves the colours, and the icons when given; left out, they keep their names. */
    async save(caseId, list, named = undefined) {
      const body = await api.put(`/api/cases/${caseId}/layer-palette`, named === undefined ? { colours: list } : { colours: list, icons: named });
      if (owner === caseId) { colours = body.colours; icons = body.icons ?? icons; }
      return body.colours;
    },
    /**
     * "Keep these colours for the case": the values a chart or a page coloured on its own,
     * `[{ value, colour }]`, named in the case's palette after the names it holds, a name it
     * already holds keeping its colour. Every chart, map and layer of the case then paints them
     * the same. The palette is read first when it is not this case's yet, so another's is never
     * written over it. A colour the case already names, a name past `MAX_COLOUR_NAME` letters,
     * or one past the `MAX_PALETTE` colours a case names, is left out: a colour has one name.
     * Answers `{ colours, before, left }`: what the case keeps now, what it kept, for an Undo,
     * and the names left out.
     */
    async keep(caseId, values) {
      const before = read === caseId ? [...colours] : (await api.get(`/api/cases/${caseId}/layer-palette`)).colours ?? [];
      const kept = [...before];
      const left = [];
      for (const { value, colour } of values) {
        const name = String(value ?? '').trim();
        const hex = String(colour).toLowerCase();
        if (!name || kept.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) continue;
        if (name.length > MAX_COLOUR_NAME || kept.length >= MAX_PALETTE || kept.some((entry) => entry.colour === hex)) left.push(name);
        else kept.push({ name, colour: hex });
      }
      return { colours: await this.save(caseId, kept), before, left };
    },
  };
}

export const layerPalette = createLayerPalette();
