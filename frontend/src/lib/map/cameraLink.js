/**
 * Several maps on one page, held on one camera.
 *
 * Compare puts two maps over the same ground. Whichever one the hand is on
 * leads, and every other map copies its frame synchronously inside the same
 * engine event, fractional zoom and bearing included. The copy is a jump, and
 * a jump fires its own move events while it runs: `follow` marks the map as a
 * copy for exactly that long, so those events are recognised and never sent
 * back. Nothing is compared after the fact, which is where the previous
 * approach (matching echoes by position) drifted apart after a resize.
 *
 * Only the leader settles on a whole zoom level (`engine.js`). Its settling
 * animation is itself a run of move events, so the copies follow it too and
 * come to rest on the same level in the same frame.
 *
 * Engine events are read here rather than through `on()`: this module is on
 * the engine's side of the façade, and it needs every intermediate frame.
 */

/**
 * @param {object[]} engines map façades (`facade.js`), in display order
 * @returns {{ align: (from?: number) => void, dispose: () => void }}
 */
export function linkCameras(engines) {
  const maps = engines.filter(Boolean);

  function mirror(leader, settled) {
    if (leader.following()) return;
    const frame = leader.frame();
    for (const peer of maps) {
      if (peer !== leader) peer.follow(frame, { settled });
    }
  }

  const releases = maps.map((engine) => {
    const move = () => mirror(engine, false);
    const end = () => mirror(engine, true);
    engine.impl.on('move', move);
    engine.impl.on('moveend', end);
    return () => {
      engine.impl.off('move', move);
      engine.impl.off('moveend', end);
    };
  });

  return {
    /** Put every map back on one map's camera, after a layout change. */
    align(from = 0) {
      const leader = maps[from];
      if (leader) mirror(leader, true);
    },
    dispose() {
      for (const release of releases) release();
      releases.length = 0;
    },
  };
}
