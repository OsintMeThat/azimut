// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';

/**
 * Stand in for the Maps JS API: a google.maps.Map that either renders
 * (`tilesloaded`) or gets rejected (`gm_authFailure`), on the next microtask so
 * probeKey has installed its handlers first.
 */
function stubGoogleMaps({ reject = false } = {}) {
  const built = [];
  const once = [];
  window.google = {
    maps: {
      event: {
        addListenerOnce: (map, name, handler) => once.push([map, name, handler]),
        trigger: (map, name) => (map.triggered = name),
      },
      Map: class {
        constructor(node, options) {
          this.node = node;
          this.options = options;
          this.cameras = [];
          this._listeners = {};
          built.push(this);
          queueMicrotask(() => {
            if (reject) window.gm_authFailure?.();
            else this._listeners.tilesloaded?.();
          });
        }
        moveCamera(camera) {
          this.cameras.push(camera);
        }
        addListener(event, cb) {
          this._listeners[event] = cb;
        }
      },
    },
  };
  return { built, once };
}

/** The façade and its map, as far as the glass reaches into them. */
function stubEngine({ zoom = 15, bearing = 0 } = {}) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  const handlers = {};
  return {
    container,
    handlers,
    impl: {
      getCenter: () => ({ lat: 48.8584, lng: 2.2945 }),
      getZoom: () => zoom,
      getBearing: () => bearing,
      on: (name, handler) => (handlers[name] = handler),
      off: (name) => delete handlers[name],
    },
  };
}

describe('gmaps module', () => {
  afterEach(() => {
    delete window.google;
    delete window.gm_authFailure;
  });

  it('renders Google’s own map under ours, and never takes the pointer', async () => {
    // Google's terms forbid taking those pixels out of its map, so its map is
    // put underneath ours instead of feeding tiles into it
    const { createGoogleGlass } = await import('./gmaps.js');
    const { built } = stubGoogleMaps();
    const engine = stubEngine();
    createGoogleGlass(engine, { maxZoom: 21 });

    const glass = engine.container.querySelector('.map-glass');
    expect(glass).not.toBeNull();
    expect(built).toHaveLength(1); // one billed dynamic map load, and only one
    expect(built[0].node.className).toBe('map-glass-map');
    expect(built[0].options).toMatchObject({
      mapTypeId: 'satellite',
      maxZoom: 21,
      disableDefaultUI: true,
      gestureHandling: 'none',
      isFractionalZoomEnabled: true,
      tilt: 0,
    });
  });

  it('states Google’s credit before any imagery is up, and lets Google’s own take over', async () => {
    const { createGoogleGlass } = await import('./gmaps.js');
    const { built, once } = stubGoogleMaps();
    const engine = stubEngine();
    createGoogleGlass(engine, { attribution: 'Map data © Google' });

    const credit = engine.container.querySelector('.map-glass-credit');
    expect(credit.textContent).toContain('Map data © Google');
    expect(credit.querySelector('a').href).toContain('terms_maps');

    // Google renders its own line inside the map div, which is turned and
    // oversized — so it is moved into this upright holder
    const own = document.createElement('div');
    own.className = 'gm-style-cc';
    own.textContent = 'Map data ©2026 Google';
    built[0].node.append(own);
    const [, name, homeCredit] = once[0];
    expect(name).toBe('tilesloaded');
    homeCredit();
    expect([...credit.children]).toEqual([own]);
  });

  it('keeps the stated credit when Google offers no line to move', async () => {
    // never Google's imagery with no credit at all
    const { createGoogleGlass } = await import('./gmaps.js');
    const { once } = stubGoogleMaps();
    const engine = stubEngine();
    createGoogleGlass(engine, { attribution: 'Map data © Google' });
    once[0][2]();
    expect(engine.container.querySelector('.map-glass-credit').textContent).toContain(
      'Map data © Google'
    );
  });

  it('covers the container at every bearing, centred on it', async () => {
    // a rotated W×H rectangle always fits inside the circle of its own
    // diagonal, so a square of that diagonal needs no redraw per bearing. If
    // this regresses, rotation still "works" and silently eats the corners.
    const { createGoogleGlass } = await import('./gmaps.js');
    stubGoogleMaps();
    const engine = stubEngine();
    createGoogleGlass(engine).show();

    const turn = engine.container.querySelector('.map-glass-turn');
    const side = Math.ceil(Math.hypot(800, 600)); // 1000
    expect(turn.style.width).toBe(`${side}px`);
    expect(turn.style.height).toBe(`${side}px`);
    expect(turn.style.left).toBe(`${(800 - side) / 2}px`);
    expect(turn.style.top).toBe(`${(600 - side) / 2}px`);
    expect(side).toBeGreaterThanOrEqual(Math.hypot(800, 600));
  });

  it('puts Google’s camera where ours is, between whole levels', async () => {
    // the camera it follows is continuous, and snapping would drift the two
    // maps out of register mid-gesture
    const { createGoogleGlass } = await import('./gmaps.js');
    const { built } = stubGoogleMaps();
    createGoogleGlass(stubEngine({ zoom: 15.4 })).show();
    expect(built[0].cameras.at(-1)).toEqual({
      center: { lat: 48.8584, lng: 2.2945 },
      zoom: 16.4, // the app counts one level deeper than the engine
    });
  });

  it('turns Google’s map the way the app turns ours', async () => {
    // the app's bearing turns the map clockwise and so does CSS rotate(); the
    // engine counts the same turn the other way
    const { createGoogleGlass } = await import('./gmaps.js');
    stubGoogleMaps();
    const engine = stubEngine({ bearing: -90 }); // the app's 90
    createGoogleGlass(engine).show();
    expect(engine.container.querySelector('.map-glass-turn').style.transform).toBe('rotate(90deg)');
  });

  it('follows the camera only while it is showing', async () => {
    const { createGoogleGlass } = await import('./gmaps.js');
    const { built } = stubGoogleMaps();
    const engine = stubEngine();
    const glass = createGoogleGlass(engine);
    expect(engine.container.querySelector('.map-glass').hidden).toBe(true);
    expect(Object.keys(engine.handlers)).toEqual([]);

    glass.show();
    expect(Object.keys(engine.handlers).sort()).toEqual(['move', 'resize']);
    engine.handlers.move();
    const followed = built[0].cameras.length;

    glass.hide();
    expect(engine.container.querySelector('.map-glass').hidden).toBe(true);
    expect(Object.keys(engine.handlers)).toEqual([]);
    expect(built[0].cameras).toHaveLength(followed);
  });

  it('is hidden rather than rebuilt, because rebuilding it is billed', async () => {
    const { createGoogleGlass } = await import('./gmaps.js');
    const { built } = stubGoogleMaps();
    const glass = createGoogleGlass(stubEngine());
    glass.show();
    glass.hide();
    glass.show();
    glass.show();
    expect(built).toHaveLength(1);
  });

  it('takes its own DOM with it when the map goes', async () => {
    const { createGoogleGlass, googleMapsLoadedKey } = await import('./gmaps.js');
    stubGoogleMaps();
    const engine = stubEngine();
    const glass = createGoogleGlass(engine);
    glass.show();
    glass.destroy();
    expect(engine.container.querySelector('.map-glass')).toBeNull();
    expect(Object.keys(engine.handlers)).toEqual([]);
    expect(googleMapsLoadedKey()).toBe(null); // nothing loaded in tests
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
