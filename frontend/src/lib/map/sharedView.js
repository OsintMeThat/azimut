/**
 * One camera for the map tabs of a window.
 *
 * Satellite, Compare and Detect each keep a map of their own, and each stays
 * mounted, hidden, while another tab shows. With the preference on (Settings →
 * General, on out of the box) they look at the same ground: a map writes the
 * window's camera each time it comes to rest, and a map tab that shows again
 * takes that camera before anything else happens on it.
 *
 * A hidden map never moves. That is what keeps this quiet. Nothing copies a
 * camera frame by frame (that is `cameraLink.js`, for the two maps Compare
 * shows at once), a hidden map loads no tiles for ground nobody is looking
 * at, and nothing a map reads on a move, a Sentinel date or a list of passes,
 * goes out for a tab nobody opened. A map can still come to rest while
 * hidden: a pan's glide outlasts a quick switch of tab, and a framing handed
 * over from the Timeline lands once its places are read. That rest is where
 * the analyst left it, so it is written, and the tab on screen follows it.
 *
 * The camera says which tab wrote it. A tab never takes back its own: nobody
 * moved since, so it is already there, and a tab re-reading what it has just
 * written in the middle of its own settling would fight it.
 *
 * **A map lands as deep as it goes.** Satellite at z20 on a provider that has
 * the pixels, Detect on imagery that stops at z18: Detect lands short, and
 * that landing is not news. Writing it back would pull Satellite out to 18 on
 * the way back. So a settle on the shared spot at this map's own ceiling
 * leaves the camera alone; a zoom the analyst makes there is still theirs.
 *
 * The chain in Satellite (`link.js`) carries this camera to other windows and
 * to the extension's map panels while the preference is on, so every tab of
 * the window follows them, not only Satellite.
 */
import { readable, samePlace, sameView } from './link.js';

/**
 * @param {string} tool this tab's id: 'satellite' | 'compare' | 'detect'
 * @param {{ state: { tool: string, mapView: object | null }, enabled: () => boolean }} options
 *   `state` holds the window's camera (`uiState.mapView`) and which tab is on
 *   screen; `enabled` reads the preference.
 */
export function shareView(tool, { state, enabled }) {
  /**
   * This tab's map came to rest: that is where the window looks now, unless
   * it is the shared camera as deep as this map goes.
   *
   * Kept with the preference off as well, so switching it on lines the tabs
   * up on the last ground looked at rather than on an old one.
   */
  function settled(camera, ceiling = Infinity) {
    if (!readable(camera)) return;
    const shared = state.mapView;
    if (
      readable(shared) &&
      samePlace(camera, shared) &&
      Math.round(camera.zoom) === Math.round(Math.min(shared.zoom, ceiling))
    ) {
      return;
    }
    state.mapView = {
      lat: camera.lat,
      lon: camera.lon,
      zoom: camera.zoom,
      bearing: camera.bearing ?? 0,
      by: tool,
    };
  }

  return {
    settled,

    /**
     * Where this tab should go now that it shows: the window's camera, when
     * another map or the chain put it somewhere this one is not. Null to stay.
     *
     * A window with no camera yet takes this tab's. A map opened from its
     * address or on the home view has not moved, so nothing has settled, and
     * the next tab would otherwise open somewhere this one is not.
     */
    pending(camera) {
      if (state.tool !== tool) return null;
      const shared = state.mapView;
      if (!readable(shared)) {
        settled(camera);
        return null;
      }
      if (!enabled() || shared.by === tool) return null;
      if (camera && sameView(camera, shared)) return null;
      return shared;
    },

    /** Where a map built now opens: the window's camera, or null for its own. */
    opening() {
      return enabled() && readable(state.mapView) ? state.mapView : null;
    },

    /**
     * Whether another map tab, or the chain, left the window's camera. A tab
     * arriving then follows it rather than framing ground of its own.
     */
    ledElsewhere() {
      const shared = state.mapView;
      return enabled() && readable(shared) && shared.by !== tool;
    },
  };
}
