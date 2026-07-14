/**
 * Satellite capture sizing: clamp a requested px size to what the backend
 * accepts, and scale a base (view-zoom) crop up to a chosen output
 * resolution (1×, 2×, "max") by capturing deeper zoom levels.
 */

export const SIZE_MIN = 256;
export const SIZE_MAX = 4096;

export function clampSize(v) {
  return Math.min(Math.max(Math.round(Number(v) || 0), SIZE_MIN), SIZE_MAX);
}

/**
 * Scale a base (view-zoom) crop to the chosen output resolution: capture `k`
 * zoom levels deeper and multiply the pixel size by 2^k so the same ground
 * footprint comes out sharper. `k` is walked back down (never below 0) until
 * the scaled size fits SIZE_MAX — with SIZE_MAX sized generously enough that
 * every built-in preset still gets a real multiplier at 2×/max, rather than
 * being clamped straight back down to 1×.
 */
export function scaledCapture(baseW, baseH, resolution, viewZoom, providerMaxZoom) {
  let k =
    resolution === 'max' ? Math.max(0, providerMaxZoom - viewZoom) : Math.log2(resolution);
  while (k > 0 && (baseW * 2 ** k > SIZE_MAX || baseH * 2 ** k > SIZE_MAX)) k -= 1;
  const mult = 2 ** k;
  return {
    zoom: Math.min(viewZoom + k, providerMaxZoom),
    width: clampSize(baseW * mult),
    height: clampSize(baseH * mult),
    mult,
  };
}
