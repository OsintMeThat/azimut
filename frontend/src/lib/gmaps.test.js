// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';

/**
 * Stand in for the Maps JS API: a google.maps.Map that either renders
 * (`tilesloaded`) or gets rejected (`gm_authFailure`), on the next microtask so
 * probeKey has installed its handlers first.
 */
function stubGoogleMaps({ reject = false } = {}) {
  window.google = {
    maps: {
      Map: class {
        constructor() {
          this._listeners = {};
          queueMicrotask(() => {
            if (reject) window.gm_authFailure?.();
            else this._listeners.tilesloaded?.();
          });
        }
        addListener(event, cb) {
          this._listeners[event] = cb;
        }
      },
    },
  };
}

describe('gmaps module', () => {
  it('imports cleanly and constructs a real GridLayer mutant', async () => {
    // Regression guards for the plugin's two broken integration surfaces
    // (each one shipped a real bug): the "browser" IIFE entry crashes the
    // whole bundle at load (`this.L`, `this` undefined in strict ESM), and
    // its `L.gridLayer.googleMutant` factory binds to a global L it never
    // imports ("GoogleMutant is not a constructor" at layer creation). We
    // construct the exported class directly — this test fails if the import
    // path or the constructor ever regresses.
    const { createSatelliteMutant, googleMapsLoadedKey } = await import('./gmaps.js');
    const L = (await import('leaflet')).default;
    const layer = createSatelliteMutant(21, 'Map data © Google');
    expect(layer instanceof L.GridLayer).toBe(true);
    expect(layer.options.maxZoom).toBe(21);
    expect(layer.options.attribution).toBe('Map data © Google');
    expect(googleMapsLoadedKey()).toBe(null); // nothing loaded in tests
  });

  it('sizes the hidden mutant map to the container diagonal, centred', async () => {
    // What makes the Google basemap rotatable. The mutant clones tiles out of a
    // hidden google.maps.Map sized to the Leaflet container, so a rotated view
    // (leaflet-rotate asks the grid for the rotated bounding box) wants corner
    // tiles Google never rendered — blank corners. A square of the diagonal,
    // centred, covers every bearing at once. If this regresses, rotation still
    // "works" but silently eats the corners of the map.
    const { createSatelliteMutant } = await import('./gmaps.js');
    const layer = createSatelliteMutant();
    const container = document.createElement('div');
    layer._mutantContainer = container;
    layer._map = { getSize: () => ({ x: 800, y: 600 }) };

    layer._fitMutantToDiagonal();

    const side = Math.ceil(Math.sqrt(800 ** 2 + 600 ** 2)); // 1000
    expect(container.style.width).toBe(`${side}px`);
    expect(container.style.height).toBe(`${side}px`);
    // pulled back by half the overflow, so it stays concentric with the map
    expect(container.style.marginLeft).toBe(`${(800 - side) / 2}px`);
    expect(container.style.marginTop).toBe(`${(600 - side) / 2}px`);
    // the square must cover the container's own diagonal, whatever the bearing
    expect(side).toBeGreaterThanOrEqual(Math.hypot(800, 600));
  });

  describe('probeKey billing', () => {
    afterEach(() => {
      delete window.google;
      delete window.gm_authFailure;
    });

    it('flags the map load it costs when Google accepts the key', async () => {
      // The probe builds a real google.maps.Map, which Google bills as a dynamic
      // map load. It happens in the browser, so the backend tile proxy cannot
      // see it — only this flag makes Settings report it. If it regresses,
      // testing a key silently drifts the counter under Google's real number.
      const { probeKey } = await import('./gmaps.js');
      stubGoogleMaps();

      const verdict = await probeKey('https://maps.googleapis.com/maps/api/js?key=good');

      expect(verdict.ok).toBe(true);
      expect(verdict.billed).toBe(true);
    });

    it('bills nothing for a key Google rejects', async () => {
      // A rejected key renders no map and has no valid project to bill, so
      // counting it would push the counter above Google's real number.
      const { probeKey } = await import('./gmaps.js');
      stubGoogleMaps({ reject: true });

      const verdict = await probeKey('https://maps.googleapis.com/maps/api/js?key=bad');

      expect(verdict.ok).toBe(false);
      expect(verdict.billed).toBe(false);
    });
  });
});
