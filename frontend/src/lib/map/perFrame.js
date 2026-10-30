/**
 * `run` at most once a frame, with the newest value it was called with: the
 * first at once, so a press answers without waiting, and the ones after it at
 * the next frame, the last never dropped. What a mouse reports faster than the
 * screen draws is only worked out as often as it can be seen.
 *
 * `flush()` runs what waits now, as a pointer let go must; `cancel()` drops it.
 */
export function perFrame(run) {
  let queued = null, waiting = 0;
  const call = (value) => {
    if (waiting) { queued = value; return; }
    run(value);
    waiting = requestAnimationFrame(() => {
      waiting = 0;
      if (queued === null) return;
      const next = queued;
      queued = null;
      call(next);
    });
  };
  call.flush = () => {
    if (queued === null) return;
    const next = queued;
    queued = null;
    run(next);
  };
  call.cancel = () => {
    cancelAnimationFrame(waiting);
    waiting = 0;
    queued = null;
  };
  return call;
}
