/**
 * Screen-crop geometry for widget basemaps (Google Maps JS).
 *
 * Widget basemaps have no tiles to stitch — Google's terms allow nothing
 * programmatic out of the widget — so their captures are cropped out of a
 * frame of the tab supplied by the capture extension (lib/extBridge.js).
 * That makes the crop only as trustworthy as the mapping from CSS px to
 * captured px, which is what lives here: a single scale factor, valid only
 * while the frame really is this tab's viewport.
 */

/** Fractional aspect-ratio slack allowed when checking a frame is the surface
 * we expect. Generous enough for rounding and odd pixel sizes, tight enough
 * that a foreign or stale frame can't pass. */
export const REGISTRATION_TOLERANCE = 0.02;

/**
 * Is this frame really the surface we're about to map onto?
 *
 * The crop math is a single scale factor, so it fails silently — cropping
 * real pixels off the wrong surface — if the frame isn't what we assumed
 * (browser zoom changed mid-flight, a stale frame from before a resize).
 * Aspect ratio is the one property we can check without trusting anyone's
 * labelling, so a mismatch is the caller's cue to refuse.
 */
export function isRegistered(videoW, videoH, expectedW, expectedH, tol = REGISTRATION_TOLERANCE) {
  if (!videoW || !videoH || !expectedW || !expectedH) return false;
  const expected = expectedW / expectedH;
  const got = videoW / videoH;
  return Math.abs(got - expected) <= tol * expected;
}

/**
 * Map `rect` (map-container CSS px) onto a captured viewport frame's pixels.
 * The map element's own position (`mapRect`) is the offset into the viewport;
 * the scale is measured from the frame itself, so device pixel ratio never
 * has to be guessed.
 *
 * Returns null when the mapped rect would fall outside the frame: better no
 * capture than one padded with whatever happened to be at the edge.
 */
export function sourceRect(rect, { mapRect, viewportWidth, videoWidth, videoHeight }) {
  const scale = videoWidth / viewportWidth;
  const sx = Math.round((mapRect.left + rect.x) * scale);
  const sy = Math.round((mapRect.top + rect.y) * scale);
  const sw = Math.round(rect.w * scale);
  const sh = Math.round(rect.h * scale);
  if (sx < 0 || sy < 0 || sw <= 0 || sh <= 0) return null;
  if (sx + sw > videoWidth || sy + sh > videoHeight) return null;
  return { sx, sy, sw, sh };
}

/**
 * Screen pixels are the ceiling here: a frame bigger than the map view has no
 * pixels to come from. Tile basemaps have no such limit — they just fetch more
 * tiles — which is why this check is widget-only.
 */
export function frameFitsView(rect, mapRect) {
  return rect.w <= mapRect.width && rect.h <= mapRect.height;
}
