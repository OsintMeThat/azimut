/**
 * The pictures of what stands on the globe: a name, written once with its
 * halo, and an icon the flat map holds, coloured as its style says.
 *
 * Each is made once and kept by what it looks like, so a frame only copies
 * pictures. A name is written by the browser in the app's own faces, as the
 * flat map writes it (no glyphs are fetched), onto one big shared picture (an
 * atlas, packed in shelves): a canvas a name would cost more to make than the
 * name itself. When the atlas is full it is wiped and filled again from what
 * the next frames ask, and the names written on the old one say so (`live`).
 * A frame writes a few new names at most; the rest wait for the next. An icon the flat map was given as
 * a distance field (an SDF, the app's pin shapes) is coloured and outlined
 * here as the engine's shader would.
 */

/** Pictures kept, the oldest made let go first. */
const KEEP = 600;
/** Where a distance field's edge is (the engine's own). */
const SDF_EDGE = 0.75;
/** Half the width of a distance field's soft edge. */
const SDF_SOFT = 0.07;
/** The engine's distance field: this many pixels of the field to a unit. */
const SDF_PX = 8;
/** The names' shared picture, device pixels a side. */
export const ATLAS = 2048;
/** New names written in one frame, at most. */
export const NEW_PER_FRAME = 40;

/** A CSS font for a style's font stack and size. */
export function cssFont(stack, size) {
  const names = Array.isArray(stack) ? stack : stack ? [stack] : [];
  const bold = names.some((name) => /bold|black|heavy/i.test(name));
  const families = names.map((name) => (/[\s,]/.test(name) && !/^["']/.test(name) ? `"${name}"` : name));
  if (!families.includes('sans-serif')) families.push('sans-serif');
  return `${bold ? 'bold ' : ''}${size}px ${families.join(', ')}`;
}

/** Words into lines no wider than `max`, measured by `width(text)`. */
export function wrapWords(text, max, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const smooth = (edge, d) => Math.min(1, Math.max(0, (d - (edge - SDF_SOFT)) / (2 * SDF_SOFT)));

/**
 * A distance field coloured: the shape in `fill`, its outline in `halo`
 * `haloWidth` pixels wide at the size it is drawn, as straight RGBA.
 */
export function colourField(alpha, fill, halo, haloWidth, size) {
  const out = new Uint8ClampedArray(alpha.length * 4);
  const haloEdge = haloWidth > 0 ? Math.max(0.05, (6 - haloWidth / Math.max(size, 0.01)) / SDF_PX) : 1.01;
  for (let i = 0; i < alpha.length; i += 1) {
    const d = alpha[i] / 255;
    const inside = smooth(SDF_EDGE, d);
    const outline = (1 - inside) * smooth(haloEdge, d) * halo[3];
    const a = inside * fill[3] + outline;
    out[i * 4] = Math.round((fill[0] * inside * fill[3] + halo[0] * outline) / Math.max(a, 1e-6));
    out[i * 4 + 1] = Math.round((fill[1] * inside * fill[3] + halo[1] * outline) / Math.max(a, 1e-6));
    out[i * 4 + 2] = Math.round((fill[2] * inside * fill[3] + halo[2] * outline) / Math.max(a, 1e-6));
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/**
 * @param {object} o
 * @param {(name: string) => ({ data: { width: number, height: number, data: Uint8Array }, pixelRatio?: number, sdf?: boolean } | null)} o.image
 *   an icon the flat map holds, as the engine keeps it
 * @param {(width: number, height: number) => HTMLCanvasElement | OffscreenCanvas} [o.canvas]
 * @param {() => number} [o.ratio] device pixels per CSS pixel
 */
export function createGlyphs({ image, canvas = makeCanvas, ratio = () => globalThis.devicePixelRatio || 1 }) {
  const kept = new Map();
  let probe = null;
  // the names' atlas: its canvas, the shelf being filled, and the page the names on it belong to
  let atlas = null;
  let shelf = { x: 0, y: 0, height: 0 };
  let page = { live: true };
  let written = 0;

  /** Room for a `w` by `h` picture on the atlas, wiping it when none is left. */
  function room(w, h) {
    atlas ??= canvas(ATLAS, ATLAS);
    if (shelf.x + w > ATLAS) shelf = { x: 0, y: shelf.y + shelf.height + 1, height: 0 };
    if (shelf.y + h > ATLAS) {
      page.live = false;
      page = { live: true };
      for (const [key, value] of kept) if (value?.page) kept.delete(key);
      atlas.getContext('2d').clearRect(0, 0, ATLAS, ATLAS);
      shelf = { x: 0, y: 0, height: 0 };
    }
    const at = { x: shelf.x, y: shelf.y };
    shelf.x += w + 1;
    shelf.height = Math.max(shelf.height, h);
    return at;
  }

  function keep(key, make) {
    let value = kept.get(key);
    if (value !== undefined) return value;
    value = make();
    kept.set(key, value);
    if (kept.size > KEEP) kept.delete(kept.keys().next().value);
    return value;
  }

  function measure(font, spacing) {
    probe ??= canvas(1, 1).getContext('2d');
    probe.font = font;
    if ('letterSpacing' in probe) probe.letterSpacing = `${spacing}px`;
    return (text) => probe.measureText(text).width;
  }

  /** The RGBA of a colour string, 0–255, alpha 0–1. */
  function rgba(colour) {
    probe ??= canvas(1, 1).getContext('2d');
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = colour;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  }

  return {
    /** A new frame: it may write its share of new names. */
    begin() {
      written = 0;
    },
    /**
     * A name's picture: `{ image, sx, sy, sw, sh, width, height, page }`, the
     * part of the atlas it is on and its size in CSS pixels; null when this
     * frame has written its share of new names already.
     */
    label(spec) {
      const key = JSON.stringify(['t', spec.text, spec.size, spec.font, spec.colour, spec.halo, spec.haloWidth, spec.spacing, spec.maxWidth]);
      const held = kept.get(key);
      if (held) return held;
      if (written >= NEW_PER_FRAME) return null;
      written += 1;
      return keep(key, () => {
        const scale = Math.min(2, ratio());
        const font = cssFont(spec.font, spec.size);
        const width = measure(font, spec.spacing);
        const lines = wrapWords(spec.text, spec.maxWidth, width);
        const halo = Math.max(0, spec.haloWidth);
        const lineHeight = spec.size * 1.2;
        const w = Math.ceil(Math.max(...lines.map(width), 1) + 2 * halo + 2);
        const h = Math.ceil(lines.length * lineHeight + 2 * halo);
        const sw = Math.min(ATLAS, Math.ceil(w * scale));
        const sh = Math.min(ATLAS, Math.ceil(h * scale));
        const at = room(sw, sh);
        const ctx = atlas.getContext('2d');
        ctx.save();
        ctx.beginPath();
        ctx.rect(at.x, at.y, sw, sh);
        ctx.clip();
        ctx.translate(at.x, at.y);
        ctx.scale(scale, scale);
        ctx.font = font;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${spec.spacing}px`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        lines.forEach((line, i) => {
          const y = halo + lineHeight * (i + 0.5);
          if (halo > 0) {
            ctx.strokeStyle = spec.halo;
            ctx.lineWidth = halo * 2;
            ctx.strokeText(line, w / 2, y);
          }
          ctx.fillStyle = spec.colour;
          ctx.fillText(line, w / 2, y);
        });
        ctx.restore();
        return { image: atlas, sx: at.x, sy: at.y, sw, sh, width: w, height: h, page };
      });
    },

    /** An icon's picture, or null for one the flat map does not hold (yet). */
    icon(spec) {
      const held = image(spec.name);
      if (!held?.data) return null;
      const { width, height, data } = held.data;
      const pixelRatio = held.pixelRatio || 1;
      // a coloured field's outline depends on the size it is drawn at, a step at a time
      const size = held.sdf ? Math.round(spec.size * 4) / 4 : 0;
      const key = JSON.stringify(['i', spec.name, held.version ?? 0, held.sdf ? [spec.colour, spec.halo, spec.haloWidth, size] : 0]);
      const made = keep(key, () => {
        const picture = canvas(width, height);
        const ctx = picture.getContext('2d');
        let pixels;
        if (held.sdf) {
          const alpha = new Uint8Array(width * height);
          for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
          pixels = colourField(alpha, rgba(spec.colour), rgba(spec.halo), spec.haloWidth, size || 1);
        } else pixels = new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + width * height * 4));
        ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        return { image: picture, width: width / pixelRatio, height: height / pixelRatio };
      });
      return made;
    },
  };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const element = document.createElement('canvas');
  element.width = Math.max(1, width);
  element.height = Math.max(1, height);
  return element;
}
