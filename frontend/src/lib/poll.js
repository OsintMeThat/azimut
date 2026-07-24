/**
 * Call `tick` every `ms` while `active()` holds, then stop; returns a stop fn.
 *
 * Why not a `setTimeout` scheduled inside an `$effect`: an `$effect` re-runs
 * only when a value it reads changes. A poll keyed on a `$derived` boolean
 * (e.g. "thumbnails still pending") that stays `true` across a refresh never
 * re-triggers the effect, so a one-shot timer there fires exactly once and the
 * thumbnail stays stuck until a full page reload. A self-repeating interval
 * keeps polling on its own until the condition clears. Timers are injectable so
 * the loop is unit-testable with fake timers.
 */
export function pollWhile(
  active,
  tick,
  ms,
  { setInterval: si = setInterval, clearInterval: ci = clearInterval } = {}
) {
  if (!active()) return () => {};
  const handle = si(() => {
    if (active()) tick();
    else ci(handle);
  }, ms);
  return () => ci(handle);
}
