/**
 * The map engine's boundary.
 *
 * Tools talk to the map through this façade and never to the engine, so
 * replacing the engine is a rewrite of `engine.js` rather than of the tools
 * above it. Two rules keep that promise:
 *
 * - **Nothing engine-shaped crosses the boundary.** A screen point is
 *   `{ x, y }`, a position is `{ lat, lon }`, an extent is
 *   `{ north, south, east, west }`. No LngLat, no Point, no layer.
 * - **Events are named for what happened to the view**, not for what the
 *   engine calls it. `view-settled` is "the camera came to rest", whichever
 *   engine event that turns out to be.
 *
 * Three translations are the whole reason this file exists, and each one is a
 * number that would otherwise be wrong in a request or on disk:
 *
 * - **Zoom.** MapLibre counts zoom on 512 px tiles and counts it continuously.
 *   The app speaks the XYZ view zoom — one level deeper — in whole levels:
 *   `zoom: int` on every route, one level of pixels per raster basemap, one
 *   number recorded on a capture.
 * - **Bearing.** The app's bearing turns the map *clockwise*. MapLibre's is the
 *   compass direction that is up, which is the same turn counted the other way.
 * - **Longitude.** An engine keeps counting past ±180° when the analyst pans
 *   across the date line, every route bounds it to ±180, and an unwrapped
 *   centre answered 422 over the Pacific.
 *
 * Nothing in this file imports the engine, so the translations are exercised
 * against a stub map instead of a browser (`facade.test.js`).
 */
import { wrapLon } from '../coords.js';
import { haversine } from '../measure.js';
import { HAND, PLACED, reseatKeepingEye } from './groundHold.js';

/** What happened to the view → the engine events that say so. */
const EVENTS = {
  // MapLibre fires move events for any camera change, a zoom included, so one
  // name covers what used to take two.
  'view-settled': ['moveend'],
  // Every frame of a movement, for what is drawn over the map in the page
  // rather than in the engine and has to be placed again as the ground moves.
  'view-move': ['move'],
  rotate: ['rotate'],
  // a tilt, which only a map with relief on can take
  pitch: ['pitch'],
  click: ['click'],
  // the pointer over the map, for a line that follows it while it is drawn
  'pointer-move': ['mousemove'],
  // The engine only fires it for a right-click that did not drag, and stops
  // the browser's own menu once anything listens for it.
  contextmenu: ['contextmenu'],
};

/**
 * How much deeper the app's zoom counts than the engine's.
 *
 * MapLibre's zoom is defined on 512 px tiles, XYZ zoom on 256 px ones, so the
 * same view is one number apart. Everything the app says about zoom — provider
 * ceilings, tile URLs, capture provenance, a saved place's view — is XYZ.
 */
const ZOOM_OFFSET = 1;

/**
 * The engine's zoom as the app says it: whole levels.
 *
 * The engine settles on a level (`engine.js`) so this rounds nothing the
 * analyst can see; what it protects against is a read taken mid-gesture
 * reaching a route as 16.37.
 */
export function viewZoom(engineZoom) {
  return Math.round(engineZoom + ZOOM_OFFSET);
}

/** …and back, for anything handed to the camera. */
export function engineZoom(zoom) {
  return zoom - ZOOM_OFFSET;
}

/**
 * The same reading unrounded, for whatever has to follow the camera itself
 * rather than say a number about it — the Google widget basemap under the map,
 * which would visibly jump a whole level otherwise.
 */
export function exactViewZoom(zoom) {
  return zoom + ZOOM_OFFSET;
}

/** 0–360, whatever the caller typed, dragged or read off a saved row. */
export function normalizeBearing(deg) {
  const value = Number(deg);
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

/**
 * The engine events one neutral name stands for.
 *
 * Throws on anything else: a typo that silently stopped delivering would read
 * as a map that quietly went dead.
 */
export function engineEvents(name) {
  const events = EVENTS[name];
  if (!events) throw new Error(`unknown map event: ${name}`);
  return events;
}

/** The smallest box holding every point, or null if there is nothing to hold. */
export function pointsExtent(points) {
  const usable = (points ?? []).filter(
    (point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
  );
  if (!usable.length) return null;
  const lats = usable.map((point) => point.lat);
  const lons = usable.map((point) => point.lon);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lons),
    west: Math.min(...lons),
  };
}

/**
 * Frame padding as the engine wants it, from the `[x, y]` pair callers write.
 *
 * A number is the same on all four sides; a pair is horizontal then vertical,
 * which is how a caller thinks about leaving room beside a box.
 */
export function framePadding(padding) {
  if (padding == null) return 0;
  if (typeof padding === 'number') return padding;
  const [x, y] = padding;
  return { left: x, right: x, top: y, bottom: y };
}

/** The engine events that open a movement, and those that close it, in the order it closes one. */
const MOVE_OPENS = new Set(['movestart', 'zoomstart', 'rotatestart', 'pitchstart', 'rollstart']);
const MOVE_CLOSES = ['zoomend', 'rotateend', 'pitchend', 'rollend', 'moveend'];

/**
 * Fold the jumps of a gesture into one movement of the map's.
 *
 * A gesture over relief moves the camera by jumps, several per move of the
 * hand, and the engine reports each jump as a whole movement, start to end.
 * Whatever waits for a movement to end then ran at every jump: the app's
 * settled view, and each of the engine's markers, which reads the depth of the
 * drawn ground back off the graphics card when a movement ends. Chrome holds
 * the page until the card has drawn everything queued before each such read,
 * and thousands of them a second stalled the map for a tenth of a second at a
 * time. Folded, the gesture opens once, moves at every jump, and ends once when
 * the last fold is let go, as the engine's own gestures do.
 *
 * Folds may overlap (a wheel burst still settling as a drag starts), in any
 * order: the map's events stay folded until every one is let go.
 *
 * @param {object} map the engine's own map
 * @returns {() => () => void} opens a fold and hands back its release
 */
export function createMoveFold(map) {
  let open = 0;
  let opened = new Set();
  let closes = new Map();
  let fire = null;
  let ownFire = false;

  function folded(event, properties) {
    const type = typeof event === 'string' ? event : event?.type;
    if (MOVE_OPENS.has(type)) {
      if (opened.has(type)) return this;
      opened.add(type);
    } else if (MOVE_CLOSES.includes(type)) {
      closes.set(type, [event, properties]);
      return this;
    }
    return fire.call(this, event, properties);
  }

  function unfold() {
    const held = closes;
    if (ownFire) map.fire = fire;
    else delete map.fire;
    fire = null;
    opened = new Set();
    closes = new Map();
    for (const type of MOVE_CLOSES) {
      const close = held.get(type);
      if (close) map.fire(...close);
    }
  }

  return () => {
    if (typeof map?.fire !== 'function') return () => {};
    if (open === 0) {
      ownFire = Object.prototype.hasOwnProperty.call(map, 'fire');
      fire = map.fire;
      map.fire = folded;
    }
    open += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      open -= 1;
      if (open === 0) unfold();
    };
  };
}

/**
 * Wrap a built map in the façade.
 *
 * @param {object} map the engine's own map object
 * @param {HTMLElement} [container] the element the map was built in
 * @param {string} [mapId] this map's name to the billed-tile guard (`quotaGuard.js`)
 */
export function mapFacade(map, container, mapId = '') {
  // Set while another map's frame is being copied onto this one (`follow`).
  let following = false;
  // The centre's height above the sea, held through a gesture over relief
  // (`holdElevation`), or null to let the engine set it.
  let heldElevation = null;
  const held = () => (heldElevation == null ? {} : { elevation: heldElevation });
  const settledHandlers = new Set();
  const foldMoves = createMoveFold(map);

  /**
   * Layers that answer their own click.
   *
   * A click on a shape is not also a click on the map underneath: a cell of a
   * search grid cycles its own status, and the map's click handler — which
   * drops a polygon vertex or plants the sky anchor — must not fire behind it.
   * The engine delivers both, so the map's own relay asks first whether a
   * claiming layer was hit. Which layers claim is asked here rather than left
   * to listener order, so the answer does not depend on who registered first.
   */
  const claimed = new Set();

  function shapeUnder(point) {
    for (const claim of claimed) {
      const layers = claim.layers.filter((id) => map.getLayer(id));
      if (!layers.length) continue;
      if (map.queryRenderedFeatures(point, { layers, filter: claim.filter }).length) return true;
    }
    return false;
  }

  /** Where the camera is, in the terms the rest of the app uses. */
  function camera() {
    const centre = map.getCenter();
    return {
      lat: centre.lat,
      lon: wrapLon(centre.lng),
      zoom: viewZoom(map.getZoom()),
      bearing: normalizeBearing(-map.getBearing()),
      // 0 on a flat map: only relief lets the camera tilt (`relief.js`)
      pitch: Math.round(map.getPitch()),
    };
  }

  function fitBounds({ north, south, east, west }, options = {}) {
    const ceiling = options.maxZoom == null ? map.getMaxZoom() : engineZoom(options.maxZoom);
    const fitted = map.cameraForBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: framePadding(options.padding), maxZoom: ceiling }
    );
    if (!fitted) return;
    // The shallower whole level, not the nearest: the box has to still fit
    // inside the frame, and a raster basemap only has whole levels of pixels.
    // A box with no extent at all (one point) fits at any zoom, so clamp — the
    // engine's own ceiling is the answer there, never Infinity.
    const zoom = Math.min(ceiling, Math.floor(fitted.zoom));
    map.easeTo(
      {
        center: fitted.center,
        zoom: Math.max(map.getMinZoom(), zoom),
        duration: options.animate ? 420 : 0,
      },
      PLACED
    );
  }

  /** Frame every point handed over. False when none of them was usable. */
  function fitPoints(points, options) {
    const extent = pointsExtent(points);
    if (!extent) return false;
    fitBounds(extent, options);
    return true;
  }

  return {
    camera,
    getZoom: () => viewZoom(map.getZoom()),

    /** The app putting the camera somewhere (`groundHold.js` PLACED). */
    setView: ({ lat, lon }, zoom) => map.jumpTo({ center: [lon, lat], zoom: engineZoom(zoom) }, PLACED),
    /**
     * A whole camera in one jump, turn included: one move and one settle, where
     * `setView` then `setBearing` would settle once on the old heading first.
     * A camera that names no tilt keeps the one the map has; a flat map holds
     * any tilt it is handed at zero.
     */
    setCamera: ({ lat, lon, zoom, bearing = 0, pitch }) =>
      map.jumpTo(
        {
          center: [lon, lat],
          zoom: engineZoom(zoom),
          bearing: -normalizeBearing(bearing),
          ...(Number.isFinite(pitch) ? { pitch } : {}),
        },
        PLACED
      ),
    setZoom: (zoom) =>
      heldElevation == null
        ? map.setZoom(engineZoom(zoom))
        : map.jumpTo({ zoom: engineZoom(zoom), ...held() }, HAND),
    /** The app zoom unrounded, for a gesture that eases the zoom (`gestures.js`). */
    exactZoom: () => exactViewZoom(map.getZoom()),
    /**
     * Move the eye straight toward a point on the ground, by as much as `levels`
     * of zoom would bring it (one level halves the way), turn and tilt kept; a
     * negative count backs away from it. The point stays where it is drawn,
     * since the line from the eye to it does not turn. False on an engine that
     * cannot say where its eye is. A move of the hand's (`groundHold.js`).
     */
    dollyToward({ lat, lon }, levels) {
      const tr = map._camera?.transform;
      if (!tr?.getCameraLngLat || !map.calculateCameraOptionsFromCameraLngLatAltRotation) return false;
      const eye = tr.getCameraLngLat();
      const altitude = tr.getCameraAltitude();
      const ground = map.queryTerrainElevation?.([lon, lat]) ?? 0;
      const share = 1 - 2 ** -levels;
      const placed = map.calculateCameraOptionsFromCameraLngLatAltRotation(
        [eye.lng + (lon - eye.lng) * share, eye.lat + (lat - eye.lat) * share],
        altitude + (ground - altitude) * share,
        map.getBearing(),
        map.getPitch()
      );
      map.jumpTo({ center: placed.center, zoom: placed.zoom, elevation: placed.elevation }, HAND);
      return true;
    },
    setBearing: (deg) =>
      heldElevation == null
        ? map.setBearing(-normalizeBearing(deg))
        : map.jumpTo({ bearing: -normalizeBearing(deg), ...held() }, HAND),
    /** Tilt from straight down, in degrees; held at zero unless relief is on. */
    setPitch: (deg) =>
      heldElevation == null
        ? map.setPitch(Math.max(0, Number(deg) || 0))
        : map.jumpTo({ pitch: Math.max(0, Number(deg) || 0), ...held() }, HAND),
    /**
     * Keep the centre's height where it is until the returned release is called.
     *
     * Over relief the engine puts the centre back on the ground under it at
     * every jump, without moving anything to make up for it: on a steep slope a
     * shift of a few metres moves the camera by hundreds, and a gesture that
     * turns, tilts and shifts at every move of the hand comes apart. Holding
     * the height keeps each jump exactly the move that was asked for.
     *
     * The hold is also one movement: the jumps made meanwhile end once, when
     * it is let go (`createMoveFold`).
     */
    holdElevation() {
      // The engine re-seats the centre on the ground at every frame and every
      // relief tile that lands, without moving anything to make up for it, so a
      // gesture of ours over relief jumps each time a tile arrives. Its own
      // gestures avoid that with a freeze it lifts at the end, re-seating the
      // centre while keeping the camera where it is (handler_manager.ts). There
      // is no public handle on it, so this reaches for the same one, and does
      // without where an engine has none. The moves made meanwhile say they are
      // the hand's, so the eye stays where the gesture leaves it (`groundHold.js`).
      const camera = map._camera;
      if (camera) camera.elevationFreeze = true;
      heldElevation = map.getCenterElevation?.() ?? null;
      const unfold = foldMoves();
      return () => {
        heldElevation = null;
        if (camera) {
          camera.elevationFreeze = false;
          reseatKeepingEye(map);
        }
        // after the re-seat, so the one settled view says where the centre landed
        unfold();
      };
    },
    /** How deep this map goes right now, in app zoom: its basemap's ceiling. */
    maxZoom: () => viewZoom(map.getMaxZoom()),
    /** Never animated: a rotation pans the map once per pointer move. */
    panBy: (dx, dy) => map.panBy([dx, dy], { duration: 0 }),
    /**
     * Move the camera over the ground by this many degrees, turn, tilt and zoom
     * kept. A pan in pixels is read off a flat plane, which over tall relief and
     * a steep tilt lands far from where it was aimed; a shift in degrees does not.
     */
    shiftBy: ({ lat, lon }) => {
      const centre = map.getCenter();
      map.jumpTo({ center: [centre.lng + lon, centre.lat + lat], ...held() }, heldElevation == null ? undefined : HAND);
    },
    /**
     * Where a ground point would be drawn were the camera shifted by `shift`
     * degrees (`shiftBy`), worked out on a copy of the camera: a gesture aims
     * its shift with this and moves the real one once. Null on an engine whose
     * camera cannot be copied.
     */
    pointAfterShift({ lat, lon }, shift) {
      const tr = map._camera?.transform;
      if (!tr?.clone) return null;
      const next = tr.clone();
      // the engine's own position objects, which its camera expects
      const centre = map.getCenter();
      centre.lng += shift.lon;
      centre.lat += shift.lat;
      next.setCenter(centre);
      const terrain = (map.style && map.terrain) || undefined;
      if (heldElevation != null) next.setElevation(heldElevation);
      else if (terrain) next.setElevation(terrain.getElevationForLngLat(centre, next));
      const at = map.getCenter();
      at.lng = lon;
      at.lat = lat;
      const point = next.locationToScreenPoint(at, terrain);
      return { x: point.x, y: point.y };
    },
    fitBounds,
    fitPoints,

    containerPointToLatLng({ x, y }) {
      const position = map.unproject([x, y]);
      return { lat: position.lat, lon: wrapLon(position.lng) };
    },

    latLngToContainerPoint({ lat, lon }) {
      const point = map.project([lon, lat]);
      return { x: point.x, y: point.y };
    },

    /**
     * How far the view reaches on the ground, along each of its own sides.
     * What sizes anything drawn in metres — the sky arc is a circle around its
     * anchor, so a radius taken off the diagonal runs off a wide window.
     */
    viewSpanMeters() {
      const bounds = map.getBounds();
      const north = bounds.getNorth();
      const west = bounds.getWest();
      return {
        across: haversine({ lat: north, lon: west }, { lat: north, lon: bounds.getEast() }),
        down: haversine({ lat: north, lon: west }, { lat: bounds.getSouth(), lon: west }),
      };
    },

    /**
     * The ground rectangle the camera is looking at. A turned map reports the
     * box that encloses its corners, which is what a rectangle drawn from the
     * view has to be anyway.
     */
    viewBounds() {
      const bounds = map.getBounds();
      return {
        west: wrapLon(bounds.getWest()),
        south: bounds.getSouth(),
        east: wrapLon(bounds.getEast()),
        north: bounds.getNorth(),
      };
    },

    /** The container changed size; re-read it. */
    resize: () => map.resize(),

    /** Whether a press landed on the drawn map itself, not on a marker or a control over it. */
    onSurface: (target) => Boolean(target) && target === map.getCanvas?.(),

    /** Give the map the keyboard, as a press on it would. */
    focus: () => map.getCanvas?.()?.focus?.({ preventScroll: true }),

    /**
     * The camera exactly as the engine holds it, fractional zoom included. Only
     * a second map copying this one reads it (`cameraLink.js`): anything that
     * states a view uses `camera()`, which speaks whole app zoom levels.
     */
    frame() {
      const centre = map.getCenter();
      return {
        lng: centre.lng,
        lat: centre.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
    },

    /**
     * Take another map's frame. While the jump runs this map is only a copy:
     * it does not settle on a level of its own, and it does not report a
     * settled view for each intermediate frame. `settled` marks the leader's
     * last frame, and that one is reported once the jump is done.
     */
    follow(next, { settled = false } = {}) {
      following = true;
      try {
        map.jumpTo(
          {
            center: [next.lng, next.lat],
            zoom: next.zoom,
            bearing: next.bearing,
            ...(Number.isFinite(next.pitch) ? { pitch: next.pitch } : {}),
          },
          PLACED
        );
      } finally {
        following = false;
      }
      if (settled) for (const handler of settledHandlers) handler(camera());
    },

    /** True while `follow` is moving this map. */
    following: () => following,

    /** True while the view moves or has tiles in flight, so a capture now would be partial. */
    tilesLoading: () => map.isMoving() || !map.areTilesLoaded(),

    /**
     * Resolves once the map is at rest with every tile in, relief included.
     * What a camera that leans over the relief waits for: tilted before the
     * ground under it has arrived, the engine seats the centre at sea level,
     * under the mountains it is looking at.
     */
    idle: () =>
      new Promise((resolve) => {
        if (!map.isMoving() && map.areTilesLoaded()) resolve();
        else map.once('idle', () => resolve());
      }),

    /**
     * The drawn pixels, once every visible tile is in.
     *
     * WebGL clears its buffer after each frame reaches the screen, so a canvas
     * read at any other moment is transparent. The copy is taken inside the
     * engine's own `render` event, which runs in the same frame as the draw.
     * `complete` is false when the wait gave up with tiles still loading.
     */
    async snapshot({ timeout = 12000 } = {}) {
      const complete = await new Promise((resolve) => {
        if (!map.isMoving() && map.areTilesLoaded()) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => {
          map.off('idle', idle);
          resolve(false);
        }, timeout);
        const idle = () => {
          clearTimeout(timer);
          resolve(true);
        };
        map.once('idle', idle);
      });
      const canvas = await new Promise((resolve, reject) => {
        map.once('render', () => {
          try {
            const source = map.getCanvas();
            const copy = document.createElement('canvas');
            copy.width = source.width;
            copy.height = source.height;
            const context = copy.getContext('2d');
            if (!context) throw new Error('this browser cannot capture the map');
            context.drawImage(source, 0, 0);
            resolve(copy);
          } catch (error) {
            reject(error);
          }
        });
        map.triggerRepaint();
      });
      return { canvas, complete };
    },

    /**
     * Listen for something happening to the view. Returns the unsubscribe, so
     * a caller cannot hold one half of the pair.
     */
    on(name, handler) {
      const events = engineEvents(name);
      // A pointer event hands over the point; a right-click also where it was
      // pressed, since a menu opens there. A shape that answers its own click
      // answers its own right-click too: a flagged grid cell is not also a menu.
      const relay =
        name === 'pointer-move'
          ? (event) => handler({ lat: event.lngLat.lat, lon: wrapLon(event.lngLat.lng) })
          : name === 'click' || name === 'contextmenu'
          ? (event) => {
              if (shapeUnder(event.point)) return;
              const at = { lat: event.lngLat.lat, lon: wrapLon(event.lngLat.lng) };
              handler(name === 'click' ? at : { ...at, x: event.point.x, y: event.point.y });
            }
          : name === 'view-settled'
            ? () => {
                if (!following) handler(camera());
              }
            : () => handler(camera());
      if (name === 'view-settled') settledHandlers.add(handler);
      for (const event of events) map.on(event, relay);
      return () => {
        settledHandlers.delete(handler);
        for (const event of events) map.off(event, relay);
      };
    },

    /**
     * These layers answer their own clicks; keep the map's relay off them.
     * The filter narrows that to the features that really do — a shape drawn
     * under a mark to say how loosely it is placed answers nothing, and must
     * not swallow the click meant for the map. Returns the release, for a
     * surface that is torn down.
     */
    claimClicks(layers, filter) {
      const claim = { layers: [...layers], filter };
      claimed.add(claim);
      return () => claimed.delete(claim);
    },

    destroy() {
      if (container) delete container.dataset.mapReady;
      map.remove();
    },

    /**
     * The element the map fills. Every engine has one, and the gestures measure
     * and read it, so it crosses the boundary as itself.
     */
    container,

    /** This map's name to the billed-tile guard, which reads its view per tile. */
    mapId,

    /**
     * The engine's own map.
     *
     * The modules in `lib/map` are the engine, plainly: layers, sources and
     * markers are its vocabulary and there is no neutral way to say them.
     * Nothing above the façade may reach for this.
     */
    impl: map,
  };
}
