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

/**
 * The teardrop the map draws on a saved point, in every overlay that draws one.
 *
 * It is a 24 px box with one sharp corner, turned 45° so that corner hangs
 * straight down — and the corner is the claim, the same way the pin's tip is.
 * A rotation moves it half a diagonal below the middle of the box, so that is
 * where the anchor goes; anchored on the middle, as it used to be, every mark
 * sat 17 px above what it pointed at, which is ten metres at zoom 18 and five
 * at zoom 19.
 *
 * `extension/mapdraw.js` draws the same shape on other people's maps and
 * repeats these numbers, because a classic script cannot import this one.
 */
const TEARDROP_BOX = 24;
const TEARDROP_TIP = (TEARDROP_BOX / 2) * Math.SQRT2;

export const TEARDROP = {
  size: [TEARDROP_BOX, TEARDROP_BOX],
  anchor: [TEARDROP_BOX / 2, TEARDROP_BOX / 2 + TEARDROP_TIP],
};

/** How far a mark's card hangs off the point, now that the body is all above
 *  it: the whole diagonal, or the card opens over the mark it belongs to. */
export const TEARDROP_CARD_OFFSET = Math.round(2 * TEARDROP_TIP);

/**
 * A place's mark, from the pin that follows the pointer to the place saved: a drop
 * whose tip is the point, in the place's colour, with a white heart. A stack of
 * several shows its count in the heart instead. A lead is the same drop in its
 * scene's colour with its number (`tools/satellite/state/drop.svelte.js`), so the
 * two read as one family.
 *
 * The HTML the map lays on the point and the painting a capture burns in are both
 * here, side by side, so the mark is redesigned in one place.
 * `extension/mapdraw.js` draws the same drop on other people's maps and repeats
 * these numbers, because a classic script cannot import this one.
 */
export const DROP = { size: [26, 36], anchor: [13, 35] };
export const DROP_PATH = 'M13 35 C13 35 24 21 24 12.5 A11 11 0 1 0 2 12.5 C2 21 13 35 13 35 Z';
/** How far a place's card hangs off the point: the whole drop, or it opens over the mark. */
export const DROP_CARD_OFFSET = 36;
/** A place with no colour of its own wears the app's pin red. */
export const PLACE_RED = '#e5484d';
/** The ink the drop is outlined and counted in. */
const DROP_INK = '#141414';

const HEX = /^#[0-9a-f]{6}$/i;

/** A place's colour as it is stored, `#rrggbb`, or the red one when it has none. */
export function placeColour(value) {
  return HEX.test(String(value ?? '')) ? String(value).toLowerCase() : PLACE_RED;
}

/** How many a drop's heart says, or 0 for the white heart of a lone mark. */
const stacked = (count) => (Number.isInteger(count) && count > 1 ? count : 0);

/** The drop as SVG: its shadow on the ground, the body, and the heart or the count. */
export function placeDropSvg({ colour, count = 1 } = {}) {
  const n = stacked(count);
  const heart = n
    ? `<text x="13" y="16.5" text-anchor="middle" font-size="${n >= 100 ? 8.5 : 11}" font-weight="700" fill="${DROP_INK}" font-family="system-ui, sans-serif">${n}</text>`
    : `<circle cx="13" cy="12.5" r="4.6" fill="#fff" stroke="${DROP_INK}" stroke-width="1"/>`;
  return `<svg width="26" height="36" viewBox="0 0 26 36" overflow="visible" aria-hidden="true">`
    + `<ellipse cx="13" cy="35" rx="4" ry="2" fill="rgba(0,0,0,0.45)"/>`
    + `<path d="${DROP_PATH}" fill="${placeColour(colour)}" stroke="${DROP_INK}" stroke-width="1.6"/>`
    + `${heart}</svg>`;
}

/**
 * A place's mark as the map lays it on the point: the same box, classes and
 * anchor for the pin under the pointer, the pin waiting for its name and the
 * place saved. `worked` puts the dot a proof leaves on its point; `className`
 * adds the caller's own (the pale pin's).
 */
export function placeMark({ colour, count = 1, worked = false, className = '' } = {}) {
  return {
    className: `saved-mark-wrap${className ? ` ${className}` : ''}`,
    html: `<span class="saved-place-drop">${placeDropSvg({ colour, count })}${worked ? '<i class="saved-place-drop-worked"></i>' : ''}</span>`,
    ...DROP,
  };
}

/**
 * A zone's mark. A zone is its area, drawn under it, so its point carries nothing
 * while the area is big enough to read: the mark is only where its card and its
 * name hang. Shrunk under `ZONE_SEEN` pixels by a zoom out, the area would vanish,
 * so a small square of the zone's colour with its outline stands in for it.
 */
export const ZONE_BOX = 18;
export const ZONE = { size: [ZONE_BOX, ZONE_BOX], anchor: [ZONE_BOX / 2, ZONE_BOX / 2] };
/** The smallest an area is drawn across before its square stands in for it, in pixels. */
export const ZONE_SEEN = 16;
/** How far a zone's card hangs off its point: off the square when it shows, else none. */
export const zoneCardOffset = (tiny) => (tiny ? ZONE_BOX / 2 + 4 : 0);

const ZONE_GLYPH = 'M5 7l7-4 7 4v8l-7 4-7-4z';

export function zoneMark({ colour, tiny = false, worked = false } = {}) {
  const dot = worked ? '<i class="saved-zone-worked"></i>' : '';
  return {
    className: `saved-mark-wrap saved-zone-wrap${tiny ? ' tiny' : ''}`,
    html: tiny
      ? `<span class="saved-zone-mark" style="--zone: ${placeColour(colour)}">`
        + `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="${ZONE_GLYPH}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>${dot}</span>`
      : '<span class="saved-zone-host"></span>',
    ...ZONE,
  };
}

/* -- the same marks, painted onto a capture --------------------------------------- */

/** The drop's own drawing, its tip at (0,0) of the current transform. */
function dropBody(ctx, { fill, stroke, strokeWidth }) {
  ctx.save();
  ctx.translate(-DROP.anchor[0], -DROP.anchor[1]);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = fill;
  const body = new Path2D(DROP_PATH);
  ctx.fill(body);
  ctx.restore();
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = stroke;
  ctx.stroke(body);
  return () => ctx.restore();
}

/** Text in the heart of a drop, centred where the white heart sits. */
function heartText(ctx, text, { colour, size }) {
  ctx.fillStyle = colour;
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 13, 16.5);
}

/**
 * A place's drop painted with its tip at (x, y), `scale` canvas pixels to a CSS
 * pixel: its ground shadow, the body in its colour, the heart or the count, and
 * the proof dot. What `placeMark` lays on the map, for a capture to carry.
 */
export function paintPlaceDrop(ctx, x, y, { colour, count = 1, worked = false, scale = 1 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  const done = dropBody(ctx, { fill: placeColour(colour), stroke: DROP_INK, strokeWidth: 1.6 });
  const n = stacked(count);
  if (n) heartText(ctx, String(n), { colour: DROP_INK, size: n >= 100 ? 8.5 : 11 });
  else {
    ctx.beginPath();
    ctx.arc(13, 12.5, 4.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = DROP_INK;
    ctx.stroke();
  }
  if (worked) {
    ctx.beginPath();
    ctx.arc(22, 4, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
  }
  done();
  ctx.restore();
}

/** A lead's drop painted with its tip at (x, y): its scene's colour and its number, in white. */
export function paintLeadDrop(ctx, x, y, { n, colour, scale = 1 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const done = dropBody(ctx, { fill: colour, stroke: 'rgba(0,0,0,0.55)', strokeWidth: 1.5 });
  if (Number.isInteger(n) && n > 0) heartText(ctx, String(n), { colour: '#fff', size: n >= 10 ? 9.5 : 11 });
  done();
  ctx.restore();
}

/**
 * The turned teardrop of any other saved mark (a file's), painted with its tip at
 * (x, y): its fill, its ring, its glyph (`glyph`, an icon's path on a 24-unit
 * grid) and the count of a stack.
 */
export function paintTeardrop(ctx, x, y, { fill, ring, ink, glyph = '', count = 1, scale = 1 } = {}) {
  const half = TEARDROP_BOX / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(0, -TEARDROP_TIP);
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  ctx.beginPath();
  ctx.roundRect(-half, -half, TEARDROP_BOX, TEARDROP_BOX, [half, half, half, 2]);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.restore();
  if (glyph) {
    ctx.save();
    ctx.scale(13 / 24, 13 / 24);
    ctx.translate(-12, -12);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(glyph));
    ctx.restore();
  }
  const n = stacked(count);
  if (n) {
    const text = String(n);
    ctx.font = '700 9px system-ui, sans-serif';
    const w = Math.max(15, ctx.measureText(text).width + 6);
    ctx.beginPath();
    ctx.roundRect(6, -half - 5, w, 15, 8);
    ctx.fillStyle = DROP_INK;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 6 + w / 2, -half + 2.5);
  }
  ctx.restore();
}

/** The analyst's own marker (`markerSvg`) painted on its point: the pin's tip, the crosshair's gap. */
export function paintMarker(ctx, x, y, style, { scale = 1 } = {}) {
  if (style !== 'pin' && style !== 'crosshair') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (style === 'pin') {
    ctx.translate(-15, -42);
    const body = new Path2D('M15 41 C15 41 27 24 27 14 A12 12 0 1 0 3 14 C3 24 15 41 15 41 Z');
    ctx.fillStyle = PLACE_RED;
    ctx.fill(body);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3c0c0e';
    ctx.stroke(body);
    ctx.beginPath();
    ctx.arc(15, 14, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    const arms = [[-22, 0, -7, 0], [7, 0, 22, 0], [0, -22, 0, -7], [0, 7, 0, 22]];
    for (const [width, colour, alpha] of [[4, '#000', 0.55], [2, '#fff', 1]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of arms) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A place's name under its mark, white on a dark halo, as the Names switch writes it. */
export function paintName(ctx, x, y, text, { scale = 1 } = {}) {
  if (!text) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, 0, NAME_GAP);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 0, NAME_GAP);
  ctx.restore();
}

/** How far under its point a place's name starts, clear of the drop's ground shadow. */
export const NAME_GAP = 5;
