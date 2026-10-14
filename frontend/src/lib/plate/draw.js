/**
 * Everything on a map plate that is not a map, drawn on one canvas.
 *
 * The editor draws it over its live maps at the screen's resolution, and the export
 * draws it again over the maps' print-resolution pictures: one function, so what is
 * on the screen is what is on the paper. Boxes are in millimetres and `scale` says how
 * many canvas pixels a millimetre is; a point of the ground is placed through the map
 * it stands on (`geo.js`), from the view that map reports.
 */
import { FONTS, MM_PER_PT, PX_PER_MM, fillTokens } from './page.js';
import { corners, degreeLabel, graticule, project, scaleBar } from './geo.js';

/** How a legend row is drawn: a marker, a line, an area, or the past. */
export const SWATCHES = ['point', 'line', 'area', 'trail', 'gained', 'lost', 'new'];

const HALO = 'rgba(255,255,255,0.92)';

function family(theme) {
  return (FONTS[theme?.font] ?? FONTS.inter).family;
}

function font(theme, sizePt, weight, scale) {
  return `${weight} ${Math.max(1, sizePt * MM_PER_PT * scale)}px ${family(theme)}, sans-serif`;
}

/** Lines of text that fit `width` canvas pixels, the given breaks kept. */
export function wrap(ctx, text, width) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function boxPx(element, scale) {
  const [x, y, w, h] = element.box;
  return { x: x * scale, y: y * scale, w: w * scale, h: h * scale };
}

/** The map an element reads, as its frame on the canvas and the view it shows. */
function frameOf(element, context) {
  const map = context.spec.elements.find((item) => item.id === element.of);
  const live = map && context.views?.[map.id];
  if (!map || !live) return null;
  const box = boxPx(map, context.scale);
  const ratio = context.scale / PX_PER_MM;
  return { box, view: live.view, frame: live.frame,
    at: (point) => {
      const [px, py] = project(live.view, live.frame, point);
      return [box.x + px * ratio, box.y + py * ratio];
    } };
}

function writeBox(ctx, element, context, text) {
  const { scale, spec } = context;
  const theme = spec.theme;
  const box = boxPx(element, scale);
  const pad = (element.fill || element.border ? 1.6 : 0) * scale;
  if (element.fill) { ctx.fillStyle = element.fill; ctx.fillRect(box.x, box.y, box.w, box.h); }
  if (element.border) {
    ctx.strokeStyle = theme.ink; ctx.lineWidth = Math.max(1, 0.25 * scale);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.font = font(theme, element.size ?? 10, element.weight ?? 400, scale);
  ctx.fillStyle = element.colour || theme.ink;
  ctx.textBaseline = 'top';
  const lineHeight = (element.size ?? 10) * MM_PER_PT * scale * 1.25;
  const lines = wrap(ctx, text, box.w - 2 * pad);
  lines.forEach((line, index) => {
    const y = box.y + pad + index * lineHeight;
    const width = ctx.measureText(line).width;
    const x = element.align === 'center' ? box.x + (box.w - width) / 2
      : element.align === 'right' ? box.x + box.w - pad - width : box.x + pad;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

function drawFrame(ctx, element, context) {
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  const live = context.views?.[element.id];
  if (element.kind === 'map' && element.grid === 'latlon' && live) {
    const ratio = scale / PX_PER_MM;
    const { step, lines } = graticule(live.view, live.frame);
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    ctx.strokeStyle = 'rgba(21,24,30,0.35)'; ctx.lineWidth = Math.max(0.5, 0.15 * scale);
    ctx.font = font(spec.theme, 6, 600, scale);
    for (const line of lines) {
      ctx.beginPath();
      line.points.forEach(([px, py], index) => {
        const x = box.x + px * ratio;
        const y = box.y + py * ratio;
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
      // the label where the line meets the frame's top or left edge
      const label = degreeLabel(line.value, line.axis, step);
      const edge = line.points.find(([px, py]) => (line.axis === 'lon' ? py >= 0 : px >= 0) && px >= 0 && py >= 0
        && px <= live.frame.width && py <= live.frame.height);
      if (!edge) continue;
      const x = line.axis === 'lon' ? box.x + edge[0] * ratio + 2 : box.x + 2;
      const y = line.axis === 'lon' ? box.y + 2 : box.y + edge[1] * ratio + 2;
      ctx.lineWidth = Math.max(1, 0.5 * scale); ctx.strokeStyle = HALO; ctx.textBaseline = 'top';
      ctx.strokeText(label, x, y); ctx.fillStyle = spec.theme.ink; ctx.fillText(label, x, y);
      ctx.strokeStyle = 'rgba(21,24,30,0.35)'; ctx.lineWidth = Math.max(0.5, 0.15 * scale);
    }
    ctx.restore();
  }
  if (element.kind === 'inset') {
    const main = frameOf(element, context);
    if (main && live) {
      const ratio = scale / PX_PER_MM;
      const ring = corners(main.view, main.frame).map((point) => project(live.view, live.frame, point));
      ctx.save();
      ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      ctx.beginPath();
      ring.forEach(([px, py], index) => {
        const x = box.x + px * ratio;
        const y = box.y + py * ratio;
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = `${spec.theme.accent}33`; ctx.fill();
      ctx.strokeStyle = spec.theme.accent; ctx.lineWidth = Math.max(1, 0.4 * scale); ctx.stroke();
      ctx.restore();
    }
  }
  if (element.kind === 'map' || element.border !== false) {
    ctx.strokeStyle = spec.theme.ink; ctx.lineWidth = Math.max(1, 0.3 * scale);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
}

function drawSwatch(ctx, entry, x, y, size, context) {
  const { scale } = context;
  ctx.save();
  if (entry.kind === 'point') {
    const picture = context.markerImage?.(entry.symbol || 'pin', entry.colour, { status: entry.status ?? '' });
    if (picture) ctx.drawImage(picture, x, y, size, size);
    else { ctx.fillStyle = entry.colour; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 3, 0, Math.PI * 2); ctx.fill(); }
  } else if (entry.kind === 'new') {
    ctx.strokeStyle = entry.colour; ctx.lineWidth = Math.max(1.5, 0.45 * scale);
    ctx.fillStyle = 'rgba(255, 212, 0, 0.2)';
    ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * 0.36, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (entry.kind === 'line' || entry.kind === 'trail') {
    ctx.strokeStyle = entry.colour; ctx.lineWidth = Math.max(1, 0.6 * scale); ctx.lineCap = 'round';
    if (entry.kind === 'trail') { ctx.setLineDash([size / 6, size / 6]); ctx.globalAlpha = 0.6; }
    ctx.beginPath(); ctx.moveTo(x + 1, y + size * 0.65); ctx.lineTo(x + size - 1, y + size * 0.35); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.rect(x + 1, y + size * 0.15, size - 2, size * 0.7);
    ctx.save(); ctx.clip();
    if (entry.kind === 'area') {
      ctx.fillStyle = entry.colour; ctx.globalAlpha = 0.25; ctx.fillRect(x, y, size, size);
    } else {
      // gains in close stripes one way, losses in sparser ones the other, as on the map
      ctx.strokeStyle = entry.colour; ctx.lineWidth = Math.max(1, (entry.kind === 'gained' ? 0.35 : 0.25) * scale);
      ctx.globalAlpha = entry.kind === 'gained' ? 0.85 : 0.5;
      const gap = size / (entry.kind === 'gained' ? 5 : 3.5);
      for (let offset = -size; offset < size * 2; offset += gap) {
        ctx.beginPath();
        if (entry.kind === 'gained') { ctx.moveTo(x + offset, y + size); ctx.lineTo(x + offset + size, y); }
        else { ctx.moveTo(x + offset, y); ctx.lineTo(x + offset + size, y + size); }
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = entry.colour; ctx.lineWidth = Math.max(1, 0.25 * scale);
    if (entry.kind === 'lost') ctx.setLineDash([size / 8, size / 10]);
    ctx.strokeRect(x + 1, y + size * 0.15, size - 2, size * 0.7);
  }
  ctx.restore();
}

function drawLegend(ctx, element, context) {
  const { scale, spec } = context;
  const theme = spec.theme;
  const box = boxPx(element, scale);
  const entries = context.legend?.[element.of] ?? [];
  if (element.fill) { ctx.fillStyle = element.fill; ctx.fillRect(box.x, box.y, box.w, box.h); }
  if (element.border) { ctx.strokeStyle = theme.ink; ctx.lineWidth = Math.max(1, 0.25 * scale); ctx.strokeRect(box.x, box.y, box.w, box.h); }
  const size = element.size ?? 8;
  const pad = 2 * scale;
  const line = size * MM_PER_PT * scale * 1.55;
  const swatch = size * MM_PER_PT * scale * 1.35;
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = element.colour || theme.ink;
  ctx.font = font(theme, size * 1.15, 700, scale);
  ctx.fillText(element.text || 'Legend', box.x + pad, box.y + pad + line / 2);
  const columns = element.columns ?? 1;
  const columnWidth = (box.w - 2 * pad) / columns;
  const perColumn = Math.max(1, Math.ceil(entries.length / columns));
  ctx.font = font(theme, size, 400, scale);
  entries.forEach((entry, index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = box.x + pad + column * columnWidth;
    const y = box.y + pad + line * (row + 1.25);
    drawSwatch(ctx, entry, x, y + (line - swatch) / 2, swatch, context);
    ctx.fillStyle = element.colour || theme.ink;
    const label = element.names?.[entry.key] || entry.label;
    const room = columnWidth - swatch - 2 * scale;
    let text = label;
    while (text.length > 1 && ctx.measureText(text).width > room) text = text.slice(0, -2);
    ctx.fillText(text === label ? text : `${text}…`, x + swatch + 1.5 * scale, y + line / 2);
  });
  if (!entries.length) {
    ctx.fillStyle = theme.ink; ctx.globalAlpha = 0.5;
    ctx.fillText('Layers shown on the map are listed here', box.x + pad, box.y + pad + line * 1.75);
  }
  ctx.restore();
}

function drawScale(ctx, element, context) {
  const { scale, spec } = context;
  const map = frameOf(element, context);
  if (!map) return;
  const box = boxPx(element, scale);
  const theme = spec.theme;
  if (element.fill) { ctx.fillStyle = element.fill; ctx.globalAlpha = 0.85; ctx.fillRect(box.x, box.y, box.w, box.h); ctx.globalAlpha = 1; }
  const ratio = scale / PX_PER_MM;
  const pad = 1.2 * scale;
  const bar = scaleBar(map.view, (box.w - 2 * pad) / ratio * 0.72, context.imperial);
  const length = bar.pixels * ratio;
  const height = Math.max(2, Math.min(box.h * 0.32, 1.3 * scale));
  const top = box.y + pad;
  for (let index = 0; index < bar.segments; index += 1) {
    ctx.fillStyle = index % 2 ? (theme.paper ?? '#fff') : theme.ink;
    ctx.fillRect(box.x + pad + (length / bar.segments) * index, top, length / bar.segments, height);
  }
  ctx.strokeStyle = theme.ink; ctx.lineWidth = Math.max(1, 0.2 * scale);
  ctx.strokeRect(box.x + pad, top, length, height);
  ctx.fillStyle = theme.ink; ctx.textBaseline = 'top';
  ctx.font = font(theme, element.size && element.size !== 10 ? element.size : 7, 600, scale);
  ctx.fillText('0', box.x + pad - 0.5 * scale, top + height + 0.6 * scale);
  const width = ctx.measureText(bar.label).width;
  ctx.fillText(bar.label, box.x + pad + length - width / 2, top + height + 0.6 * scale);
}

function drawNorth(ctx, element, context) {
  const { scale, spec } = context;
  const map = frameOf(element, context);
  const box = boxPx(element, scale);
  const theme = spec.theme;
  const turn = -((map?.view.bearing ?? 0) * Math.PI) / 180;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h * 0.6;
  const length = Math.min(box.w * 1.1, box.h * 0.75);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(turn);
  const half = length * 0.32;
  ctx.lineWidth = Math.max(1, 0.2 * scale); ctx.strokeStyle = theme.ink;
  ctx.beginPath(); ctx.moveTo(0, -length / 2); ctx.lineTo(half, length / 2); ctx.lineTo(0, length * 0.3); ctx.closePath();
  ctx.fillStyle = theme.paper ?? '#fff'; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -length / 2); ctx.lineTo(-half, length / 2); ctx.lineTo(0, length * 0.3); ctx.closePath();
  ctx.fillStyle = theme.ink; ctx.fill(); ctx.stroke();
  ctx.font = font(theme, Math.max(6, length / scale / MM_PER_PT * 0.42), 700, scale);
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('N', 0, -length / 2 - 0.3 * scale);
  ctx.restore();
}

function drawImage(ctx, element, context) {
  const box = boxPx(element, context.scale);
  const picture = context.images?.get?.(element.src);
  if (!picture) {
    ctx.save();
    ctx.strokeStyle = context.spec.theme.ink; ctx.globalAlpha = 0.35; ctx.setLineDash([4, 3]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
    return;
  }
  const width = picture.width ?? picture.naturalWidth;
  const height = picture.height ?? picture.naturalHeight;
  const fit = Math.min(box.w / width, box.h / height);
  ctx.drawImage(picture, box.x + (box.w - width * fit) / 2, box.y + (box.h - height * fit) / 2, width * fit, height * fit);
  if (element.border) {
    ctx.strokeStyle = context.spec.theme.ink; ctx.lineWidth = Math.max(1, 0.25 * context.scale);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
}

/** The point on a box's edge facing `to`, where a leader leaves it. */
function edgeToward(box, [tx, ty]) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const fit = Math.min(Math.abs((box.w / 2) / (dx || 1e-9)), Math.abs((box.h / 2) / (dy || 1e-9)));
  return [cx + dx * Math.min(1, fit), cy + dy * Math.min(1, fit)];
}

function drawLabel(ctx, element, context) {
  const { scale, spec } = context;
  const map = frameOf(element, context);
  const theme = spec.theme;
  const box = boxPx(element, scale);
  const point = map ? map.at(element.at) : null;
  const inside = point && point[0] >= box.x && point[0] <= box.x + box.w && point[1] >= box.y && point[1] <= box.y + box.h;
  const colour = element.colour || theme.ink;
  ctx.save();
  if (point && !inside) {
    // the leader, from the label to the ground it names
    const [ex, ey] = edgeToward(box, point);
    ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1, 0.25 * scale);
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(point[0], point[1]); ctx.stroke();
    ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(point[0], point[1], Math.max(1.5, 0.6 * scale), 0, Math.PI * 2); ctx.fill();
  }
  if (element.style !== 'plain') {
    ctx.fillStyle = element.fill || theme.paper || '#fff';
    ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1, 0.25 * scale);
    const radius = element.style === 'bubble' ? Math.min(box.h / 2, 2 * scale) : 0;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(box.x, box.y, box.w, box.h, radius) : ctx.rect(box.x, box.y, box.w, box.h);
    ctx.fill(); ctx.stroke();
  }
  ctx.font = font(theme, element.size ?? 9, element.weight ?? 600, scale);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrap(ctx, element.text || '', box.w);
  const lineHeight = (element.size ?? 9) * MM_PER_PT * scale * 1.2;
  lines.forEach((line, index) => {
    const y = box.y + box.h / 2 + (index - (lines.length - 1) / 2) * lineHeight;
    if (element.style === 'plain') {
      ctx.strokeStyle = element.fill || HALO; ctx.lineWidth = Math.max(2, 0.8 * scale); ctx.lineJoin = 'round';
      ctx.strokeText(line, box.x + box.w / 2, y);
    }
    ctx.fillStyle = colour; ctx.fillText(line, box.x + box.w / 2, y);
  });
  ctx.restore();
}

function drawArrow(ctx, element, context) {
  const { scale, spec } = context;
  const map = frameOf(element, context);
  if (!map) return;
  const [x1, y1] = map.at(element.at);
  const [x2, y2] = map.at(element.to);
  const width = Math.max(1, (element.width ?? 1) * scale);
  const head = Math.max(width * 3.2, 2.5 * scale);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip();
  ctx.strokeStyle = element.colour || spec.theme.accent; ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(angle) * head * 0.7, y2 - Math.sin(angle) * head * 0.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(angle - 0.42) * head, y2 - Math.sin(angle - 0.42) * head);
  ctx.lineTo(x2 - Math.cos(angle + 0.42) * head, y2 - Math.sin(angle + 0.42) * head);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/**
 * Draw a plate's page.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} spec the plate
 * @param {object} context `scale` (canvas pixels a millimetre), `views` (`{ id: { view, frame } }`
 *   of each map), `legend` (`{ mapId: entries }`), `credits` (`{ mapId: text }`), `images`
 *   (a Map of the pictures by path), `markerImage(symbol, colour, marks)`, `tokens`
 *   (`fillTokens`' words), and for an export `paper` (fill the page) and `maps`
 *   (`{ id: canvas }`, each map's picture at this scale).
 */
export function drawPage(ctx, spec, context) {
  const full = { ...context, spec };
  const { scale } = context;
  if (context.paper) {
    ctx.fillStyle = spec.theme.paper; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  for (const element of spec.elements) {
    if (context.maps && (element.kind === 'map' || element.kind === 'inset') && context.maps[element.id]) {
      const box = boxPx(element, scale);
      ctx.drawImage(context.maps[element.id], box.x, box.y, box.w, box.h);
    }
  }
  for (const element of spec.elements) {
    ctx.save();
    switch (element.kind) {
      case 'map':
      case 'inset': drawFrame(ctx, element, full); break;
      case 'text': writeBox(ctx, element, full, fillTokens(element.text, context.tokens)); break;
      case 'credits': writeBox(ctx, { ...element, colour: element.colour || spec.theme.ink },
        full, context.credits?.[element.of] || 'Map data credits'); break;
      case 'legend': drawLegend(ctx, element, full); break;
      case 'scale': drawScale(ctx, element, full); break;
      case 'north': drawNorth(ctx, element, full); break;
      case 'image': drawImage(ctx, element, full); break;
      case 'label': drawLabel(ctx, element, full); break;
      case 'arrow': drawArrow(ctx, element, full); break;
      default: break;
    }
    ctx.restore();
  }
}
