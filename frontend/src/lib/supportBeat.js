/**
 * When the Support heart at the foot of the rail beats: once every
 * `SUPPORT_BEAT_MINUTES` the page is in sight. Time spent in another tab or
 * window does not count, so coming back never sets it off at once. App.svelte
 * stops it for the session once Support has been opened, and never starts it
 * under reduced motion or with Settings › General's switch off.
 */

export const SUPPORT_BEAT_MINUTES = 10;

/**
 * Calls `beat` after every `every` milliseconds of the document being visible.
 * Returns the function that stops it.
 */
export function startSupportBeat({
  beat,
  every = SUPPORT_BEAT_MINUTES * 60_000,
  doc = globalThis.document,
  now = () => Date.now(),
}) {
  let left = every;
  let since = 0;
  let timer = null;

  const shown = () => doc?.visibilityState !== 'hidden';

  function run() {
    if (timer !== null || !shown()) return;
    since = now();
    timer = setTimeout(() => {
      timer = null;
      left = every;
      beat();
      run();
    }, left);
  }

  function pause() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    left = Math.max(0, left - (now() - since));
  }

  function onVisibility() {
    if (shown()) run();
    else pause();
  }

  doc?.addEventListener?.('visibilitychange', onVisibility);
  run();

  return () => {
    pause();
    doc?.removeEventListener?.('visibilitychange', onVisibility);
  };
}
