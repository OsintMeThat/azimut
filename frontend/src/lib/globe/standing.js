/**
 * What stands on the globe facing the eye: names, icons and dots.
 *
 * Laid on the ground, a name would lie on the slopes and swell toward the
 * camera; a dot would stretch with the distance. So the flat map's circle and
 * symbol layers are drawn over the globe on the screen, at the point where
 * their ground is, the size their style says whatever the distance, upright.
 * Their style is read at the zoom their own ground is seen at, so a far
 * village's name gives way as it would on a flat map zoomed out, and a near
 * one is drawn as on a map zoomed in.
 *
 * Symbols are placed the way the flat map places them: the layer on top
 * first, then by sort key, and one that would cover a symbol already placed
 * is left out (unless its style lets it overlap). Dots are always drawn.
 *
 * Pure: the projection, the picture of a name or an icon, and the canvas are
 * handed in, so a test places marks without a screen.
 */
import { evaluable } from './style.js';

/** Collision cells, CSS pixels a side. */
const CELL = 64;
/** Zoom steps a mark's style is read at, so a slow zoom does not re-read it every frame. */
const ZOOM_STEP = 0.25;
/** Kept off the screen's edge before a mark counts as out of view, pixels. */
const MARGIN = 64;

/** Where an anchored box's centre sits from its point, for a box `w` by `h`. */
export function anchorShift(anchor, w, h) {
  const a = anchor ?? 'center';
  const dx = a.includes('left') ? w / 2 : a.includes('right') ? -w / 2 : 0;
  const dy = a.startsWith('top') ? h / 2 : a.startsWith('bottom') ? -h / 2 : 0;
  return [dx, dy];
}

/** A grid of placed boxes, asked whether a new one would cover any. */
export function createCollisions() {
  const cells = new Map();
  const cellsOf = (box, visit) => {
    for (let gx = Math.floor(box.x0 / CELL); gx <= Math.floor(box.x1 / CELL); gx += 1) {
      for (let gy = Math.floor(box.y0 / CELL); gy <= Math.floor(box.y1 / CELL); gy += 1) {
        if (visit(`${gx},${gy}`) === false) return false;
      }
    }
    return true;
  };
  const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  return {
    free(box) {
      return cellsOf(box, (key) => !(cells.get(key) ?? []).some((other) => meets(box, other)));
    },
    add(box) {
      cellsOf(box, (key) => {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(box);
      });
    },
  };
}

const boxAround = (cx, cy, w, h, pad = 0) => ({ x0: cx - w / 2 - pad, y0: cy - h / 2 - pad, x1: cx + w / 2 + pad, y1: cy + h / 2 + pad });

/** A circle layer's look for one feature. */
function circleLook(layer, zoom, feature) {
  return {
    radius: Number(layer.paint('circle-radius', zoom, feature) ?? 5),
    colour: layer.paint('circle-color', zoom, feature) ?? '#000',
    opacity: Number(layer.paint('circle-opacity', zoom, feature) ?? 1),
    strokeWidth: Number(layer.paint('circle-stroke-width', zoom, feature) ?? 0),
    strokeColour: layer.paint('circle-stroke-color', zoom, feature) ?? '#000',
    strokeOpacity: Number(layer.paint('circle-stroke-opacity', zoom, feature) ?? 1),
  };
}

/** A symbol layer's icon and text for one feature, either null where it has none. */
function symbolLook(layer, zoom, feature) {
  const iconName = layer.layout('icon-image', zoom, feature);
  const size = Number(layer.layout('icon-size', zoom, feature) ?? 1);
  const icon = iconName
    ? {
        name: String(iconName),
        size,
        anchor: layer.layout('icon-anchor', zoom, feature) ?? 'center',
        offset: (layer.layout('icon-offset', zoom, feature) ?? [0, 0]).map((v) => v * size),
        rotate: Number(layer.layout('icon-rotate', zoom, feature) ?? 0),
        onMap: layer.layout('icon-rotation-alignment', zoom, feature) === 'map',
        opacity: Number(layer.paint('icon-opacity', zoom, feature) ?? 1),
        colour: layer.paint('icon-color', zoom, feature) ?? '#000',
        halo: layer.paint('icon-halo-color', zoom, feature) ?? 'rgba(0,0,0,0)',
        haloWidth: Number(layer.paint('icon-halo-width', zoom, feature) ?? 0),
        overlap: Boolean(layer.layout('icon-allow-overlap', zoom, feature)),
        ignore: Boolean(layer.layout('icon-ignore-placement', zoom, feature)),
      }
    : null;
  const raw = layer.layout('text-field', zoom, feature);
  const transform = layer.layout('text-transform', zoom, feature);
  let text = raw == null ? '' : String(raw);
  if (transform === 'uppercase') text = text.toUpperCase();
  else if (transform === 'lowercase') text = text.toLowerCase();
  // to the pixel: a size read off the distance changes every frame, and each size is a picture
  const textSize = Math.max(1, Math.round(Number(layer.layout('text-size', zoom, feature) ?? 16)));
  const label = text.trim()
    ? {
        text,
        size: textSize,
        font: layer.layout('text-font', zoom, feature) ?? [],
        anchor: layer.layout('text-anchor', zoom, feature) ?? 'center',
        offset: (layer.layout('text-offset', zoom, feature) ?? [0, 0]).map((v) => v * textSize),
        maxWidth: Number(layer.layout('text-max-width', zoom, feature) ?? 10) * textSize,
        spacing: Number(layer.layout('text-letter-spacing', zoom, feature) ?? 0) * textSize,
        padding: Number(layer.layout('text-padding', zoom, feature) ?? 2),
        colour: layer.paint('text-color', zoom, feature) ?? '#000',
        opacity: Number(layer.paint('text-opacity', zoom, feature) ?? 1),
        halo: layer.paint('text-halo-color', zoom, feature) ?? 'rgba(0,0,0,0)',
        haloWidth: Number(layer.paint('text-halo-width', zoom, feature) ?? 0),
        overlap: Boolean(layer.layout('text-allow-overlap', zoom, feature)),
        ignore: Boolean(layer.layout('text-ignore-placement', zoom, feature)),
        optional: Boolean(layer.layout('text-optional', zoom, feature)),
      }
    : null;
  const sortKey = Number(layer.layout('symbol-sort-key', zoom, feature));
  return { icon, label, sortKey: Number.isFinite(sortKey) ? sortKey : 0 };
}

/** One mark's look at a zoom, read again only when its zoom moves a step. */
function lookOf(candidate, zoom) {
  const step = Math.round(zoom / ZOOM_STEP) * ZOOM_STEP;
  if (candidate.look && candidate.lookAt === step) return candidate.look;
  const { layer } = candidate;
  const feature = candidate.read ?? (candidate.read = evaluable(candidate.type, candidate.properties, candidate.id));
  let look = null;
  if (layer.inRange(step) && layer.accepts(step, feature)) {
    look = layer.type === 'circle' ? { circle: circleLook(layer, step, feature) } : symbolLook(layer, step, feature);
  }
  candidate.look = look;
  candidate.lookAt = step;
  return look;
}

/**
 * Place the marks of one frame.
 *
 * @param {object[]} candidates `{ layer, order, lat, lon, type, properties, id }`,
 *   `order` the layer's place in the style (higher is drawn over)
 * @param {object} view
 * @param {(lat: number, lon: number, memo: object) => ({ x: number, y: number, distance: number } | null)} view.project
 *   a point's place on screen, or null where it is out of sight; `memo` is the
 *   candidate itself, which the projection may keep what it worked out on
 * @param {(lat: number, distance: number) => number} view.zoomAt the engine zoom ground is seen at
 * @param {number} view.width
 * @param {number} view.height
 * @param {number} [view.bearing] the view's turn, for an icon turned with the ground
 * @param {object} assets
 * @param {(label: object) => ({ image: any, width: number, height: number } | null)} assets.label
 *   a name's picture, or null when it cannot be written this frame: the mark
 *   is then left out and the list says `waiting`
 * @param {(icon: object) => ({ image: any, width: number, height: number } | null)} assets.icon
 * @returns the marks placed, each `{ candidate, x, y, circle?, icon?, label?, boxes }`, top first
 */
export function placeStanding(candidates, view, assets) {
  const seen = [];
  for (const candidate of candidates) {
    const at = view.project(candidate.lat, candidate.lon, candidate);
    if (!at) continue;
    if (at.x < -MARGIN || at.y < -MARGIN || at.x > view.width + MARGIN || at.y > view.height + MARGIN) continue;
    const look = lookOf(candidate, view.zoomAt(candidate.lat, at.distance));
    if (!look) continue;
    seen.push({ candidate, look, x: at.x, y: at.y, distance: at.distance });
  }
  seen.sort(
    (a, b) =>
      b.candidate.order - a.candidate.order ||
      (a.look.sortKey ?? 0) - (b.look.sortKey ?? 0) ||
      a.distance - b.distance
  );

  const collisions = createCollisions();
  const placed = [];
  placed.waiting = false;
  for (const { candidate, look, x, y } of seen) {
    if (look.circle) {
      const c = look.circle;
      const reach = c.radius + c.strokeWidth / 2;
      placed.push({ candidate, x, y, circle: c, boxes: [boxAround(x, y, 2 * reach, 2 * reach)], round: reach });
      continue;
    }
    let icon = null;
    let iconBox = null;
    if (look.icon) {
      const picture = assets.icon(look.icon);
      if (picture) {
        const w = picture.width * look.icon.size;
        const h = picture.height * look.icon.size;
        const [dx, dy] = anchorShift(look.icon.anchor, w, h);
        const cx = x + dx + look.icon.offset[0];
        const cy = y + dy + look.icon.offset[1];
        const turn = look.icon.rotate - (look.icon.onMap ? view.bearing ?? 0 : 0);
        icon = { ...look.icon, picture, cx, cy, w, h, turn };
        iconBox = boxAround(cx, cy, w, h);
      }
    }
    let label = null;
    let labelBox = null;
    if (look.label) {
      const picture = assets.label(look.label);
      if (!picture) {
        placed.waiting = true;
        continue;
      }
      const [dx, dy] = anchorShift(look.label.anchor, picture.width, picture.height);
      const cx = x + dx + look.label.offset[0];
      const cy = y + dy + look.label.offset[1];
      label = { ...look.label, picture, cx, cy, w: picture.width, h: picture.height };
      labelBox = boxAround(cx, cy, picture.width, picture.height, look.label.padding);
    }
    if (!icon && !label) continue;
    const iconFits = !icon || icon.overlap || collisions.free(iconBox);
    const labelFits = !label || label.overlap || collisions.free(labelBox);
    if (!iconFits) continue;
    if (!labelFits) {
      // a name that does not fit leaves its icon alone only where it says it may
      if (!icon || !label.optional) continue;
      label = null;
    }
    if (icon && !icon.ignore) collisions.add(iconBox);
    if (label && !label.ignore) collisions.add(labelBox);
    placed.push({ candidate, x, y, icon, label, boxes: [iconBox, label && labelBox].filter(Boolean) });
  }
  return placed;
}

/**
 * The marks placed, moved to where their ground is seen now, without placing
 * them again: what a moving view draws between two placements, as the flat
 * map holds its labels still while it moves. A mark gone out of sight is left
 * out.
 */
export function shiftStanding(placed, project) {
  const out = [];
  out.waiting = placed.waiting;
  for (const mark of placed) {
    const c = mark.candidate;
    const at = project(c.lat, c.lon, c);
    if (!at) continue;
    const dx = at.x - mark.x;
    const dy = at.y - mark.y;
    const move = (box) => ({ x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy });
    out.push({
      ...mark,
      x: at.x,
      y: at.y,
      icon: mark.icon && { ...mark.icon, cx: mark.icon.cx + dx, cy: mark.icon.cy + dy },
      label: mark.label && { ...mark.label, cx: mark.label.cx + dx, cy: mark.label.cy + dy },
      boxes: mark.boxes.map(move),
    });
  }
  return out;
}

/** Draw the marks placed, the lowest layer first so the top one lands over it. */
export function drawStanding(ctx, placed) {
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const mark = placed[i];
    if (mark.circle) {
      const c = mark.circle;
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, Math.max(0, c.radius), 0, 2 * Math.PI);
      if (c.opacity > 0) {
        ctx.globalAlpha = c.opacity;
        ctx.fillStyle = c.colour;
        ctx.fill();
      }
      if (c.strokeWidth > 0 && c.strokeOpacity > 0) {
        ctx.globalAlpha = c.strokeOpacity;
        ctx.strokeStyle = c.strokeColour;
        ctx.lineWidth = c.strokeWidth;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      continue;
    }
    if (mark.icon && mark.icon.opacity > 0) {
      const { picture, cx, cy, w, h, turn, opacity } = mark.icon;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.translate(cx, cy);
      if (turn) ctx.rotate((turn * Math.PI) / 180);
      ctx.drawImage(picture.image, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    // a name on an atlas wiped since it was placed waits for the next placement
    if (mark.label && mark.label.opacity > 0 && mark.label.picture.page?.live !== false) {
      const { picture, cx, cy, w, h, opacity } = mark.label;
      ctx.globalAlpha = opacity;
      if (picture.sx != null) ctx.drawImage(picture.image, picture.sx, picture.sy, picture.sw, picture.sh, cx - w / 2, cy - h / 2, w, h);
      else ctx.drawImage(picture.image, cx - w / 2, cy - h / 2, w, h);
      ctx.globalAlpha = 1;
    }
  }
}

/**
 * The marks under a point or within a box of the screen, top first: what a
 * click on the globe landed on. `layers` narrows it to those layers' marks.
 */
export function markedAt(placed, { x0, y0, x1, y1 }, layers = null) {
  const hits = [];
  for (const mark of placed) {
    if (layers && !layers.has(mark.candidate.layer.id)) continue;
    const hit = mark.round != null
      ? Math.hypot(Math.max(x0 - mark.x, 0, mark.x - x1), Math.max(y0 - mark.y, 0, mark.y - y1)) <= mark.round
      : mark.boxes.some((b) => b.x0 <= x1 && x0 <= b.x1 && b.y0 <= y1 && y0 <= b.y1);
    if (hit) hits.push(mark);
  }
  return hits;
}
