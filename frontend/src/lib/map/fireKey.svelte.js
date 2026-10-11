/**
 * Whether the fire layer can be used: the FIRMS sensors on offer, whether a key
 * is saved, and a spent allowance's pause while it lasts.
 *
 * Our own backend, reading a catalogue and a settings file: no network, so a map
 * asks on mount. Failing quietly leaves the layer locked with its reason, which
 * is the same state as no key, and the truth either way. Nothing is asked of
 * NASA until the layer is switched on.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 */
export function createFireKey({ api }) {
  let sensors = $state([]);
  let keyed = $state(false);
  /** Why it is not usable when it is not: 'missing' | 'off' | 'refused'. */
  let state = $state('missing');
  /** A spent allowance's pause, `{ until, used, of }`, while it lasts. */
  let paused = $state(null);
  let pauseTimer = null;
  let troubleTimer = null;

  async function load() {
    try {
      const answer = await api.get('/api/firms/sensors');
      sensors = answer.sensors ?? [];
      keyed = Boolean(answer.keyed);
      state = answer.state ?? 'missing';
      paused = answer.paused ?? null;
    } catch {
      keyed = false;
      paused = null;
    }
    // A pause ends on its own; the layer hears it then rather than on the next
    // failed tile. Our own backend, once, so nothing is polled.
    clearTimeout(pauseTimer);
    if (paused) {
      const left = Date.parse(paused.until) - Date.now();
      pauseTimer = setTimeout(load, Math.max(1000, left + 500));
    }
  }

  return {
    get sensors() {
      return sensors;
    },
    get keyed() {
      return keyed;
    },
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    load,
    /** A FIRMS tile failed: ask our backend why, once for the burst a screen makes. */
    trouble() {
      clearTimeout(troubleTimer);
      troubleTimer = setTimeout(load, 800);
    },
    destroy() {
      clearTimeout(pauseTimer);
      clearTimeout(troubleTimer);
    },
  };
}
