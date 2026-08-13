/**
 * The two marks the map can put on a point, as plain SVG.
 *
 * A capture is a document: whatever the analyst saw on screen is what the PNG
 * has to show, so these strings are the same ones the server draws into a
 * capture. Kept out of the tool because a marker is a picture with a claim in it
 * — the pin's tip is the location, the crosshair's centre is — and an anchor
 * that disagrees with the drawing puts the mark somewhere the point is not.
 */

/** Size and anchor per style, in CSS pixels. The anchor is the point itself. */
export const MARKER_GEOMETRY = {
  // The tip at the bottom of the teardrop is what points at the location.
  pin: { size: [30, 42], anchor: [15, 42] },
  // Centred: the gap between the four arms is the point.
  crosshair: { size: [46, 46], anchor: [23, 23] },
};

const PIN = `<svg width="30" height="42" viewBox="0 0 30 42">
          <path d="M15 41 C15 41 27 24 27 14 A12 12 0 1 0 3 14 C3 24 15 41 15 41 Z"
            fill="#e5484d" stroke="#3c0c0e" stroke-width="1.5"/>
          <circle cx="15" cy="14" r="4.5" fill="#fff" stroke="#3c0c0e" stroke-width="1"/>
        </svg>`;

// Drawn twice: a heavy dark pass under a light one, so the arms stay legible on
// bright sand and on dark water without a halo box around them.
const CROSSHAIR = `<svg width="46" height="46" viewBox="0 0 46 46">
        <g stroke="#000" stroke-width="4" opacity="0.55">
          <line x1="1" y1="23" x2="16" y2="23"/><line x1="30" y1="23" x2="45" y2="23"/>
          <line x1="23" y1="1" x2="23" y2="16"/><line x1="23" y1="30" x2="23" y2="45"/>
        </g>
        <g stroke="#fff" stroke-width="2">
          <line x1="1" y1="23" x2="16" y2="23"/><line x1="30" y1="23" x2="45" y2="23"/>
          <line x1="23" y1="1" x2="23" y2="16"/><line x1="23" y1="30" x2="23" y2="45"/>
          <circle cx="23" cy="23" r="2.5" fill="none"/>
        </g>
      </svg>`;

/** The marker SVG for a style. Anything but `pin` draws the crosshair. */
export function markerSvg(style) {
  return style === 'pin' ? PIN : CROSSHAIR;
}

/** Size and anchor for a style, matching what `markerSvg` returns. */
export function markerGeometry(style) {
  return style === 'pin' ? MARKER_GEOMETRY.pin : MARKER_GEOMETRY.crosshair;
}
