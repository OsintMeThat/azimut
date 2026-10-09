/**
 * Where the eye stays while the ground under it arrives (the 3D map, SPEC v3).
 *
 * The engine keeps its camera at a distance from the ground under the middle
 * of the view, and out of the box it seats that ground again at every frame
 * and every relief tile that lands, without moving anything to make up for
 * it. A finer tile of a mountainside under the centre lifts or drops the whole
 * camera by the difference: hundreds of metres in one frame, with nobody
 * touching the map. Tilted toward the horizon that reads as a teleport.
 *
 * So the seating depends on who put the camera where it is:
 *
 * - **The app** (opening on an address, a search, a saved place, a linked
 *   map): the eye sits over the ground it was sent to and rises with it while
 *   that ground arrives, which is the engine's own seating, until the map is
 *   idle. A saved view then looks the way it was saved.
 * - **The hand** (a drag, the wheel, the keys, the orbit): the eye stays
 *   exactly where the hand left it. When a move ends, and when relief lands
 *   under a view at rest, the centre is seated on the ground under the middle
 *   of the view with the eye kept, the way the engine ends its own gestures.
 *
 * A move tells which it is. The façade marks the app's placements (`PLACED`)
 * and the moves of the app's own gestures (`HAND`); the engine's gestures
 * carry the input event that drove them. A move with neither (the glide after
 * a drag, a wheel notch, which the engine sends without their input event, or
 * a turn right after a placement) changes nothing: it is the hand's when the
 * hand already had the camera, and part of the placement while one settles.
 *
 * This reaches past the engine's public surface, as its own gesture code does
 * (`handler_manager.ts`); an engine without those handles is left alone.
 */

/** Event data the façade passes with a move the hand is making. */
export const HAND = Object.freeze({ byHand: true });
/** …and with a camera the app puts somewhere. */
export const PLACED = Object.freeze({ placed: true });

/**
 * Seat the centre on the ground under the middle of the view, the eye kept
 * where it is. Nothing happens while a gesture holds the height, or when none
 * of the ground under the middle of the view has arrived: the pivot then stays
 * where it is rather than slide off along the line of sight.
 *
 * @param {object} map the engine's own map
 * @returns {boolean} whether the centre was seated
 */
export function reseatKeepingEye(map) {
  const camera = map?._camera;
  const terrain = map?.terrain;
  const tr = camera?.transform;
  if (!terrain || !tr?.recalculateZoomAndCenter || camera.elevationFreeze) return false;
  if (tr.screenTerrainPointToMercatorCoordinate && tr.centerPoint) {
    if (!tr.screenTerrainPointToMercatorCoordinate(tr.centerPoint, terrain)) return false;
  }
  tr.recalculateZoomAndCenter(terrain);
  if (typeof map._update === 'function') map._update();
  else map.triggerRepaint?.();
  return true;
}

/**
 * The seating rule on one map, from `start` (relief on) to `stop` (relief off).
 *
 * @param {object} map the engine's own map
 * @param {object} [opts]
 * @param {string} [opts.relief] the relief source id, whose tiles re-seat a view at rest
 * @param {(run: () => void) => unknown} [opts.nextFrame] how a re-seat waits for the
 *   next frame, so a burst of tiles costs one
 */
export function createGroundHold(map, { relief = '', nextFrame } = {}) {
  const later =
    nextFrame ??
    ((run) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(run) : setTimeout(run, 16)));
  let active = false;
  let byHand = false;
  let waiting = false;

  const clamp = (on) => map.setCenterClampedToGround?.(on);

  function follow() {
    byHand = false;
    clamp(true);
  }

  function hold() {
    if (byHand) return;
    byHand = true;
    clamp(false);
  }

  const onMoveStart = (event) => {
    if (!active) return;
    if (event?.placed) follow();
    else if (event?.originalEvent || event?.byHand) hold();
  };
  // the ground the app sent the camera to has arrived: from here on the eye stays put
  const onIdle = () => {
    if (active) hold();
  };
  const onMoveEnd = () => {
    if (active && byHand) reseatKeepingEye(map);
  };
  const onData = (event) => {
    if (!active || !byHand || waiting || !event?.tile || event.sourceId !== relief) return;
    waiting = true;
    later(() => {
      waiting = false;
      if (active && byHand && !map.isMoving?.()) reseatKeepingEye(map);
    });
  };

  map.on('movestart', onMoveStart);
  map.on('moveend', onMoveEnd);
  map.on('idle', onIdle);
  map.on('sourcedata', onData);

  return {
    /** Relief is on, or its exaggeration changed: the app has placed the ground. */
    start() {
      active = true;
      follow();
    },
    /** Relief is off: a flat map seats its centre at sea level again. */
    stop() {
      active = false;
      follow();
    },
    /** True once the hand owns the camera. */
    get byHand() {
      return active && byHand;
    },
    dispose() {
      active = false;
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      map.off('idle', onIdle);
      map.off('sourcedata', onData);
    },
  };
}
