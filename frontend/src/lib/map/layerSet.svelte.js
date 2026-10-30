/**
 * One map's own layers: which of the catalogue's are on, and what the fire and
 * night layers are asked for.
 *
 * Detect and Horizon each hold one, so a layer switched on in one map is not
 * drawn in the other. The catalogue says what each layer is
 * (`layerCatalog.js`); this says what this map does with it: the chips its menu
 * lists, and the overlays its surface draws.
 *
 * A map that knows when its picture was taken passes `follow`, and the fire and
 * night layers then start on that day: the fires the picture can show, the night
 * after it. The analyst can still pick any window or night.
 *
 * Nothing is asked of NASA until the fire or night layer is on. A tool keeps its
 * switches per case (`layerMemory.js`), all but the fire and night layers, which
 * would reach out on their own after a reload and show another day.
 *
 * @param {object} deps
 * @param {ReturnType<import('./fireKey.svelte.js').createFireKey>} deps.fireKey
 * @param {string[]} [deps.initial] the layers on from the start
 * @param {string} [deps.follow] the label of the choice that follows the picture,
 *   or '' for a map with no dated picture
 * @param {() => string} [deps.pictureDay] the date of the picture on screen, or ''
 * @param {() => boolean} [deps.imagery] whether the basemap is a picture of the ground
 * @param {() => void} [deps.onsettings] where a FIRMS key is entered
 */
import { fireControls, nightControls } from './eventControls.js';
import {
  askable as firmsAskable,
  firmsNote,
  keyState,
  onDay,
  PICTURE,
  summary as firmsSummary,
  tileParams as firmsTileParams,
} from './firms.js';
import { layerInfo, LAYERS, knownLayers } from './layerCatalog.js';
import { keptLayers } from './layerMemory.js';
import {
  askable as nightAskable,
  COMPOSITE,
  lastNight,
  onNight,
  SENSORS as NIGHT_SENSORS,
  summary as nightSummary,
  tileParams as nightTileParams,
} from './nightlights.js';

export function createLayerSet({
  fireKey,
  initial = [],
  follow = '',
  pictureDay = () => '',
  imagery = () => true,
  onsettings = () => {},
}) {
  let on = $state(knownLayers(initial));
  const fires = $state({ sensor: 'viirs', window: follow ? PICTURE : '24h', first: '', last: '' });
  const night = $state({ source: 'noaa20', day: lastNight(), follow: Boolean(follow) });

  const firesAsked = () => onDay(fires, pictureDay());
  const nightAsked = () => onNight(night, pictureDay());
  const usable = (id) => imagery() || !layerInfo(id)?.imageryOnly;

  function nightNote() {
    if (night.source === COMPOSITE.id || nightAskable(nightAsked())) return '';
    const sensor = NIGHT_SENSORS.find((entry) => entry.id === night.source)?.label ?? 'this sensor';
    return night.follow ? `The picture's day is outside ${sensor}'s record.` : 'Pick a night inside this sensor’s record.';
  }

  /**
   * The fire row as the Map draws it: what it shows on the right, its questions
   * under it once it is on. A switch that cannot be pressed says why and where to
   * go, on the row itself rather than only on a greyed-out eye nobody hovers.
   */
  function fireRow(shown) {
    const key = keyState(fireKey);
    if (!key.usable) {
      return {
        disabled: true,
        detail: key.detail,
        title: key.title,
        actions: [{ label: key.action, quiet: true, run: onsettings }],
      };
    }
    return {
      detail: firmsSummary(firesAsked(), fireKey.sensors),
      controls: shown
        ? fireControls(fires, fireKey.sensors, (patch) => Object.assign(fires, patch), { follow, pictureDay: pictureDay() })
        : null,
      note: shown ? firmsNote(firesAsked(), fireKey.paused) : '',
    };
  }

  function toggle(id) {
    on = on.includes(id) ? on.filter((entry) => entry !== id) : knownLayers([...on, id]);
  }

  function nightRow(shown) {
    if (!shown) return {};
    return {
      detail: nightSummary(nightAsked()),
      controls: nightControls(night, (patch) => Object.assign(night, patch), { follow, pictureDay: pictureDay() }),
      note: nightNote(),
    };
  }

  return {
    /** The ids switched on, in the catalogue's order. */
    get ids() {
      return on;
    },
    /** Put back what a tool kept; an unknown or retired id is dropped, and so
     *  are the fire and night layers, which are never kept. */
    restore(ids) {
      on = keptLayers(ids);
    },
    has(id) {
      return on.includes(id);
    },
    toggle,

    /** What the surface lays over the picture (`lib/map/basemap.js`). The case's
     *  saved work is the tool's to draw, so it is never among them. */
    get overlays() {
      return on
        .filter((id) => id !== 'saved' && usable(id))
        .map((id) => {
          if (id === 'firms') {
            const asked = firesAsked();
            return fireKey.keyed && firmsAskable(asked) ? { id, params: firmsTileParams(asked) } : null;
          }
          if (id === 'nightlights') {
            const asked = nightAsked();
            return nightAskable(asked) ? { id, params: nightTileParams(asked) } : null;
          }
          return id;
        })
        .filter(Boolean);
    },

    /**
     * The rows the menu lists, one per catalogue layer. `patch` merges a tool's
     * own facts into a row by id: how many saved items there are, say.
     */
    rows(patch = {}) {
      return LAYERS.map((layer) => {
        const row = {
          id: layer.id,
          label: layer.label,
          group: layer.group,
          title: layer.title,
          on: on.includes(layer.id),
          toggle: () => toggle(layer.id),
        };
        if (!usable(layer.id)) Object.assign(row, { disabled: true, title: 'Only useful over satellite imagery' });
        if (layer.id === 'firms') Object.assign(row, fireRow(row.on));
        if (layer.id === 'nightlights') Object.assign(row, nightRow(row.on));
        return { ...row, ...patch[layer.id] };
      });
    },
  };
}
