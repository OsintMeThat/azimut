/**
 * Change detection over two registered frames of the same ground.
 *
 * Pure and synchronous, so it runs the same in the worker (`changeWorker.js`)
 * and under test. Every buffer is RGBA at one working size; the caller
 * downsamples the map canvases first. The pipeline:
 *
 * 1. **Register.** A small integer shift that best lays B over A absorbs the
 *    sub-tile offsets two renders can carry.
 * 2. **Match tone.** B's channels are moved onto A's, by mean or by histogram,
 *    so a hazier or brighter day is not read as change everywhere. Cloud is
 *    left out of that estimate, and Sentinel-2 skips it: two L2A passes are
 *    already corrected, so matching them can only erase real change.
 * 3. **Measure.** One signed difference per pixel: perceptual colour distance,
 *    lightness, edge strength, or a real spectral index when both are given.
 * 4. **Mask.** Pixels without data, and optionally cloud and its shadow, drop
 *    out. The sky is read from Sentinel-2's scene classification, exactly as
 *    Detect reads it (`skyMask`), never guessed from the picture.
 * 5. **Threshold.** Otsu's split of the difference histogram, or the analyst's
 *    own level, over a floor that keeps rendering noise out.
 * 6. **Clean.** A morphological opening removes speckle, a closing fills pinholes.
 * 7. **Group.** Connected regions become zones with an area on the ground,
 *    a dominant direction and a score; zones under the minimum area go.
 * 8. **Draw.** Classes, a continuous heat ramp or outlines, into a mask whose
 *    alpha carries the strength.
 */

import { CHANGE_PALETTES, changeSettings, indexThreshold } from './changeAssist.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// -- colour -------------------------------------------------------------------

const LINEAR = new Float32Array(256);
for (let value = 0; value < 256; value += 1) {
  const channel = value / 255;
  LINEAR[value] = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB bytes to CIE L*a*b* (D65), the space a colour distance means something in. */
export function toLab(red, green, blue, out = [0, 0, 0]) {
  const r = LINEAR[red];
  const g = LINEAR[green];
  const b = LINEAR[blue];
  const x = labF((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = labF(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = labF((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  out[0] = 116 * y - 16;
  out[1] = 500 * (x - y);
  out[2] = 200 * (y - z);
  return out;
}

// -- registration and tone ------------------------------------------------------

const luminanceAt = (pixels, index) =>
  pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;

/** The small integer translation that best registers B onto A. */
export function estimateAlignment(left, right, width, height, maximum = 4) {
  const limit = Math.min(
    Math.floor((Math.min(width, height) - 1) / 2),
    Math.round(clamp(Number(maximum) || 0, 0, 8)),
  );
  if (!limit) return { x: 0, y: 0, score: 0 };
  const step = Math.max(2, Math.floor(Math.min(width, height) / 160));
  let best = { x: 0, y: 0, score: Infinity };
  for (let dy = -limit; dy <= limit; dy += 1) {
    for (let dx = -limit; dx <= limit; dx += 1) {
      let score = 0;
      let samples = 0;
      for (let y = limit; y < height - limit; y += step) {
        for (let x = limit; x < width - limit; x += step) {
          const li = (y * width + x) * 4;
          const ri = ((y + dy) * width + x + dx) * 4;
          if (left[li + 3] < 200 || right[ri + 3] < 200) continue;
          score += Math.abs(luminanceAt(left, li) - luminanceAt(right, ri));
          samples += 1;
        }
      }
      const average = samples ? score / samples : Infinity;
      // ties keep the smaller shift, so a flat frame is never "registered" sideways
      if (average < best.score - 1e-9) best = { x: dx, y: dy, score: average };
    }
  }
  return best;
}

/** Shift B by the registration offset, leaving no-data where it has no pixels. */
function shifted(right, width, height, offset) {
  if (!offset.x && !offset.y) return right;
  const out = new Uint8ClampedArray(right.length);
  for (let y = 0; y < height; y += 1) {
    const sy = y + offset.y;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = x + offset.x;
      if (sx < 0 || sx >= width) continue;
      const to = (y * width + x) * 4;
      const from = (sy * width + sx) * 4;
      out[to] = right[from];
      out[to + 1] = right[from + 1];
      out[to + 2] = right[from + 2];
      out[to + 3] = right[from + 3];
    }
  }
  return out;
}

/**
 * B's three channels moved onto A's, by their means or by their whole histograms.
 *
 * `keep` leaves cloud out of the estimate: a third of a scene under cumulus
 * would otherwise drag the whole ground of the other date after it.
 */
export function matchTone(left, right, mode = 'histogram', keep = null) {
  if (mode !== 'mean' && mode !== 'histogram') return right;
  const out = new Uint8ClampedArray(right);
  for (let channel = 0; channel < 3; channel += 1) {
    const histA = new Float64Array(256);
    const histB = new Float64Array(256);
    let count = 0;
    for (let index = 0; index < left.length; index += 4) {
      if (left[index + 3] < 200 || right[index + 3] < 200) continue;
      if (keep && !keep[index / 4]) continue;
      histA[left[index + channel]] += 1;
      histB[right[index + channel]] += 1;
      count += 1;
    }
    if (!count) continue;
    const lookup = new Uint8ClampedArray(256);
    if (mode === 'mean') {
      let sumA = 0;
      let sumB = 0;
      for (let value = 0; value < 256; value += 1) {
        sumA += histA[value] * value;
        sumB += histB[value] * value;
      }
      const shift = clamp((sumA - sumB) / count, -80, 80);
      for (let value = 0; value < 256; value += 1) lookup[value] = value + shift;
    } else {
      let cumulativeA = 0;
      let cumulativeB = 0;
      let target = 0;
      for (let value = 0; value < 256; value += 1) {
        cumulativeB += histB[value];
        while (target < 255 && cumulativeA + histA[target] < cumulativeB) {
          cumulativeA += histA[target];
          target += 1;
        }
        lookup[value] = target;
      }
    }
    for (let index = 0; index < out.length; index += 4) {
      out[index + channel] = lookup[right[index + channel]];
    }
  }
  return out;
}

// -- measuring ------------------------------------------------------------------

function sobel(lightness, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        -lightness[i - width - 1] - 2 * lightness[i - 1] - lightness[i + width - 1] +
        lightness[i - width + 1] + 2 * lightness[i + 1] + lightness[i + width + 1];
      const gy =
        -lightness[i - width - 1] - 2 * lightness[i - width] - lightness[i - width + 1] +
        lightness[i + width - 1] + 2 * lightness[i + width] + lightness[i + width + 1];
      out[i] = Math.hypot(gx, gy) / 4;
    }
  }
  return out;
}

/**
 * Decode a Difference frame (`engine/sentinel.py`): R = index, G = the sky byte
 * Detect's products carry (scene class in the low four bits, a dark flag above
 * it), A = the data mask. `change-sky` frames carry the sky alone.
 */
export function decodeFrame(pixels) {
  const count = pixels.length / 4;
  const value = new Float32Array(count);
  const scene = new Uint8Array(count);
  const dark = new Uint8Array(count);
  const valid = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const index = pixel * 4;
    value[pixel] = pixels[index] / 127.5 - 1;
    scene[pixel] = pixels[index + 1] & 15;
    dark[pixel] = (pixels[index + 1] & 16) > 0 ? 1 : 0;
    valid[pixel] = pixels[index + 3] > 127 ? 1 : 0;
  }
  return { value, scene, dark, valid };
}

// Sentinel-2 L2A scene classes, and what Detect made of them on real scenes
// (`engine/analyzers.py` holds the same constants and the same reasoning).
const SCL_DEFECTIVE = 1;
const SCL_SHADOW = 3;
const SCL_WATER = 6;
const SCL_SNOW = 11;
const CLOUD_CORE = [8, 9, 10];
// "Unclassified or low-probability cloud": too timid to trust alone, but next
// to a real cloud it is that cloud's thin edge.
const CLOUD_EDGE = [7, 8, 9, 10];
// Sen2Cor calls white hulls and bright roofs cloud; no cumulus is under 5 ha.
const MIN_CLOUD_M2 = 50_000;
// A shadow sits under its cloud's outline, moved away from the sun by the
// cloud's height times the tangent of the sun's zenith.
const CLOUD_HEIGHTS = [200, 5000];
const MAX_SHADOW_M = 4000;
const MAX_MARGIN_PX = 60;

/** Connected regions (8-way) of a flag array, with each one's pixel count. */
export function label(flags, width, height) {
  const labels = new Int32Array(flags.length);
  const sizes = [0];
  const stack = [];
  for (let start = 0; start < flags.length; start += 1) {
    if (!flags[start] || labels[start]) continue;
    const id = sizes.length;
    let size = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const pixel = stack.pop();
      size += 1;
      const x = pixel % width;
      const y = (pixel - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const near = ny * width + nx;
          if (flags[near] && !labels[near]) {
            labels[near] = id;
            stack.push(near);
          }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Solar azimuth and zenith in degrees when Sentinel-2 flies over, from `analyzers.py`. */
export function sunPosition(day, lat) {
  const local = 10.5 + lat / 72;
  const when = new Date(`${day}T00:00:00Z`);
  const start = Date.UTC(when.getUTCFullYear(), 0, 1);
  const yearDay = Math.floor((when.getTime() - start) / 86_400_000);
  const g = ((2 * Math.PI) / 365) * (yearDay + (local - 12) / 24);
  const declination = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const minutes = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const hour = (((local * 60 + minutes) / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosine = Math.sin(phi) * Math.sin(declination)
    + Math.cos(phi) * Math.cos(declination) * Math.cos(hour);
  const zenith = (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
  const azimuth = (Math.atan2(
    Math.sin(hour),
    Math.cos(hour) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi),
  ) * 180) / Math.PI + 180;
  return { azimuth: ((azimuth % 360) + 360) % 360, zenith };
}

/** The mask moved by (dx, dy) × distance, leaving empty where it came from off-frame. */
function shift(mask, width, height, dx, dy) {
  const out = new Uint8Array(mask.length);
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  if (!ox && !oy) return mask.slice();
  for (let y = 0; y < height; y += 1) {
    const sy = y - oy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = x - ox;
      if (sx < 0 || sx >= width) continue;
      if (mask[sy * width + sx]) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * The mask laid down at every distance from `start` to `start + length` along
 * (dx, dy). Doubling: each pass ORs what is covered with itself moved by as
 * much again, so a reach of 400 pixels costs nine shifts rather than 400.
 */
export function smear(mask, width, height, dx, dy, start, length) {
  if (length <= 0) return new Uint8Array(mask.length);
  let covered = shift(mask, width, height, dx * start, dy * start);
  let span = 1;
  while (span < length) {
    const step = Math.min(span, length - span);
    const moved = shift(covered, width, height, dx * step, dy * step);
    for (let pixel = 0; pixel < covered.length; pixel += 1) {
      if (moved[pixel]) covered[pixel] = 1;
    }
    span += step;
  }
  return covered;
}

/**
 * Cloud and cloud shadow in one Sentinel-2 frame, as Detect reads them.
 *
 * Cloud starts from the classification's cloud classes, drops what is too small
 * to be one, and takes every unsure pixel touching what is left. Shadow is the
 * classified shadow plus the cloud's outline cast away from the sun, wherever
 * the ground under it is dark and not water — and dark water is only water when
 * the other date says so too, because Sen2Cor reads a deep shadow as water.
 *
 * @param {ReturnType<typeof decodeFrame>} frame
 * @param {ReturnType<typeof decodeFrame>|null} other  the pass on the other side
 * @param {{width: number, height: number, metresPerPixel: number, lat: number,
 *   bearing: number, day: string}} ground
 */
export function skyMask(frame, other, ground) {
  const { width, height, metresPerPixel, lat, bearing, day } = ground;
  const count = width * height;
  const core = new Uint8Array(count);
  const edge = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (!frame.valid[pixel]) continue;
    if (CLOUD_CORE.includes(frame.scene[pixel])) core[pixel] = 1;
    if (CLOUD_EDGE.includes(frame.scene[pixel])) edge[pixel] = 1;
  }
  const area = metresPerPixel > 0 ? metresPerPixel * metresPerPixel : 0;
  const cores = label(core, width, height);
  const seeded = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const id = cores.labels[pixel];
    if (id && (!area || cores.sizes[id] * area >= MIN_CLOUD_M2)) seeded[pixel] = 1;
  }
  const edges = label(edge, width, height);
  const grown = new Uint8Array(edges.sizes.length);
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (seeded[pixel]) grown[edges.labels[pixel]] = 1;
  }
  const cloud = new Uint8Array(count);
  const shadow = new Uint8Array(count);
  let clouded = false;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const scene = frame.scene[pixel];
    if ((edges.labels[pixel] && grown[edges.labels[pixel]])
      || scene === SCL_DEFECTIVE || scene === SCL_SNOW) {
      cloud[pixel] = 1;
      clouded = true;
    }
    if (scene === SCL_SHADOW) shadow[pixel] = 1;
  }
  if (!clouded || !metresPerPixel || !day) return { cloud, shadow };
  const { azimuth, zenith } = sunPosition(day, lat);
  const tangent = Math.tan((zenith * Math.PI) / 180);
  const start = Math.round((CLOUD_HEIGHTS[0] * tangent) / metresPerPixel);
  const length = Math.round(
    Math.min(CLOUD_HEIGHTS[1] * tangent, MAX_SHADOW_M) / metresPerPixel,
  ) - start;
  // The map may be turned, so the sun's compass angle is read in screen terms;
  // rows then run away from the top of the view rather than north.
  const turned = ((azimuth - (bearing || 0)) * Math.PI) / 180;
  const cast = smear(cloud, width, height, -Math.sin(turned), Math.cos(turned), start, length);
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (!cast[pixel] || cloud[pixel] || !frame.dark[pixel]) continue;
    const water = frame.scene[pixel] === SCL_WATER
      && (!other || other.scene[pixel] === SCL_WATER);
    if (!water) shadow[pixel] = 1;
  }
  return { cloud, shadow };
}

/**
 * Grow a flag array by `radius`, separably: a horizontal pass then a vertical
 * one, which is the same result as a square dilation for a fraction of the work.
 */
export function growMask(flags, width, height, radius) {
  if (!radius) return flags;
  const wide = new Uint8Array(flags.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!flags[row + x]) continue;
      const from = Math.max(0, x - radius);
      const to = Math.min(width - 1, x + radius);
      for (let near = from; near <= to; near += 1) wide[row + near] = 1;
    }
  }
  const grown = new Uint8Array(flags.length);
  for (let y = 0; y < height; y += 1) {
    const from = Math.max(0, y - radius);
    const to = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      if (!wide[y * width + x]) continue;
      for (let near = from; near <= to; near += 1) grown[near * width + x] = 1;
    }
  }
  return grown;
}

/** Cloud and shadow on either date, as the settings ask for them, grown by the margin. */
export function weatherMask(frames, ground, settings) {
  const count = ground.width * ground.height;
  const blocked = new Uint8Array(count);
  if (!frames || !(settings.ignore_clouds || settings.ignore_shadows)) return blocked;
  const sides = [frames.a, frames.b];
  sides.forEach((frame, side) => {
    const other = sides[1 - side] ?? null;
    const { cloud, shadow } = skyMask(frame, other, { ...ground, day: ground.days[side] });
    for (let pixel = 0; pixel < count; pixel += 1) {
      if ((settings.ignore_clouds && cloud[pixel]) || (settings.ignore_shadows && shadow[pixel])) {
        blocked[pixel] = 1;
      }
    }
  });
  const radius = Math.min(
    MAX_MARGIN_PX,
    Math.round(settings.cloud_margin / Math.max(ground.metresPerPixel, 0.01)),
  );
  return growMask(blocked, ground.width, ground.height, radius);
}

/**
 * One signed difference per pixel and the pixels it is valid for.
 * `magnitude` is on a 0…255 scale for every method, so one threshold rule fits.
 *
 * @param {Uint8ClampedArray} left  picture A
 * @param {Uint8ClampedArray} right picture B, registered and toned
 * @param {{a: object, b: object}|null} frames decoded band frames, for the index
 * @param {Uint8Array|null} blocked  cloud and shadow, already grown by the margin
 */
export function measure(left, right, width, height, settings, frames = null, blocked = null) {
  const count = width * height;
  const magnitude = new Float32Array(count);
  const direction = new Int8Array(count);
  const chroma = new Uint8Array(count);
  const valid = new Uint8Array(count);

  if (settings.method === 'index' && frames) {
    for (let pixel = 0; pixel < count; pixel += 1) {
      // Cloud on either date invalidates the pixel: a difference is a
      // measurement only when both sides of it are ground.
      if (!frames.a.valid[pixel] || !frames.b.valid[pixel] || blocked?.[pixel]) continue;
      const delta = frames.b.value[pixel] - frames.a.value[pixel];
      valid[pixel] = 1;
      // a full index swing of 1.0 reads as 255
      magnitude[pixel] = Math.min(255, Math.abs(delta) * 255);
      direction[pixel] = delta > 0 ? 1 : -1;
    }
    return { magnitude, direction, chroma, valid };
  }

  const lightA = new Float32Array(count);
  const lightB = new Float32Array(count);
  const labA = new Float32Array(count * 2);
  const labB = new Float32Array(count * 2);
  const labOfA = [0, 0, 0];
  const labOfB = [0, 0, 0];
  for (let pixel = 0; pixel < count; pixel += 1) {
    const i = pixel * 4;
    if (left[i + 3] < 200 || right[i + 3] < 200) continue;
    toLab(left[i], left[i + 1], left[i + 2], labOfA);
    toLab(right[i], right[i + 1], right[i + 2], labOfB);
    lightA[pixel] = labOfA[0];
    lightB[pixel] = labOfB[0];
    labA[pixel * 2] = labOfA[1];
    labA[pixel * 2 + 1] = labOfA[2];
    labB[pixel * 2] = labOfB[1];
    labB[pixel * 2 + 1] = labOfB[2];
    if (!blocked?.[pixel]) valid[pixel] = 1;
  }

  if (settings.method === 'structure') {
    const edgesA = sobel(lightA, width, height);
    const edgesB = sobel(lightB, width, height);
    for (let pixel = 0; pixel < count; pixel += 1) {
      if (!valid[pixel]) continue;
      const delta = edgesB[pixel] - edgesA[pixel];
      magnitude[pixel] = Math.min(255, Math.abs(delta) * 4);
      direction[pixel] = delta > 0 ? 1 : -1;
    }
    return { magnitude, direction, chroma, valid };
  }

  for (let pixel = 0; pixel < count; pixel += 1) {
    if (!valid[pixel]) continue;
    const dl = lightB[pixel] - lightA[pixel];
    if (settings.method === 'brightness') {
      magnitude[pixel] = Math.min(255, Math.abs(dl) * 2.55);
      direction[pixel] = dl > 0 ? 1 : -1;
      continue;
    }
    const da = labB[pixel * 2] - labA[pixel * 2];
    const db = labB[pixel * 2 + 1] - labA[pixel * 2 + 1];
    const distance = Math.hypot(dl, da, db);
    magnitude[pixel] = Math.min(255, distance * 2.55);
    // A change is directional when lightness carries most of it; a hue shift
    // at the same lightness (roof repainted, crop turned) is "changed".
    const chromatic = Math.hypot(da, db);
    if (Math.abs(dl) >= chromatic * 0.8) direction[pixel] = dl > 0 ? 1 : -1;
    else chroma[pixel] = 1;
  }
  return { magnitude, direction, chroma, valid };
}

// -- filtering and thresholds -----------------------------------------------------

/** Box blur of a float field, by a summed-area table so the radius costs nothing. */
export function boxBlur(field, width, height, radius, valid) {
  if (!radius) return field;
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  const counts = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    let rowCount = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (valid[pixel]) {
        row += field[pixel];
        rowCount += 1;
      }
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
      counts[(y + 1) * stride + x + 1] = counts[y * stride + x + 1] + rowCount;
    }
  }
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!valid[pixel]) continue;
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const total = sums[bottom * stride + right] - sums[top * stride + right]
        - sums[bottom * stride + left] + sums[top * stride + left];
      const n = counts[bottom * stride + right] - counts[top * stride + right]
        - counts[bottom * stride + left] + counts[top * stride + left];
      out[pixel] = n ? total / n : 0;
    }
  }
  return out;
}

/** Otsu's threshold over a 0…255 field: the split that best separates two populations. */
export function otsu(field, valid) {
  const histogram = new Float64Array(256);
  let total = 0;
  for (let pixel = 0; pixel < field.length; pixel += 1) {
    if (!valid[pixel]) continue;
    histogram[Math.min(255, Math.round(field[pixel]))] += 1;
    total += 1;
  }
  if (!total) return 0;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];
  let background = 0;
  let backgroundSum = 0;
  let best = 0;
  let threshold = 0;
  let plateauEnd = 0;
  for (let value = 0; value < 256; value += 1) {
    background += histogram[value];
    if (!background) continue;
    const foreground = total - background;
    if (!foreground) break;
    backgroundSum += value * histogram[value];
    const meanBackground = backgroundSum / background;
    const meanForeground = (sum - backgroundSum) / foreground;
    const between = background * foreground * (meanBackground - meanForeground) ** 2;
    if (between > best * (1 + 1e-9)) {
      best = between;
      threshold = value;
      plateauEnd = value;
    } else if (between >= best * (1 - 1e-9)) {
      plateauEnd = value;
    }
  }
  // Two clean populations leave a plateau of equally good splits between them;
  // its middle is the one that sits furthest from both.
  return (threshold + plateauEnd) / 2;
}

/** The level below which nothing counts: what a re-render of the same pixels leaves. */
const FLOORS = { colour: 18, brightness: 16, structure: 22 };

export function thresholdFor(field, valid, settings) {
  // An index is a measured quantity, so its line is a stated index change and
  // not a split of whatever this view happens to hold: the same line Detect
  // draws, so panning cannot move it.
  if (settings.method === 'index') return indexThreshold(settings.sensitivity) * 255;
  const floor = FLOORS[settings.method] ?? 18;
  const lean = (settings.sensitivity - 50) / 50; // -1 … 1
  if (settings.threshold === 'manual') {
    // 0 % asks for only the strongest changes, 100 % reaches down to the floor
    return floor + (1 - settings.sensitivity / 100) * (200 - floor);
  }
  const split = otsu(field, valid);
  return Math.max(floor * (1 - lean * 0.35), split * (1 - lean * 0.45));
}

/**
 * A square min (erode) or max (dilate) filter, run as a row pass then a column
 * pass: the same result as the full square at a fraction of the work.
 */
function squareFilter(mask, width, height, radius, keepIfAll) {
  const pass = (source, horizontal) => {
    const out = new Uint8Array(source.length);
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    for (let o = 0; o < outer; o += 1) {
      for (let i = 0; i < inner; i += 1) {
        let hit = keepIfAll ? 1 : 0;
        for (let k = i - radius; k <= i + radius; k += 1) {
          const inside = k >= 0 && k < inner;
          const value = inside ? source[horizontal ? o * width + k : k * width + o] : 0;
          if (keepIfAll && !value) { hit = 0; break; }
          if (!keepIfAll && value) { hit = 1; break; }
        }
        out[horizontal ? o * width + i : i * width + o] = hit;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

const erode = (mask, width, height, radius) => squareFilter(mask, width, height, radius, true);
const dilate = (mask, width, height, radius) => squareFilter(mask, width, height, radius, false);

/** Opening then closing: speckle smaller than the radius goes, pinholes fill. */
export function cleanMask(mask, width, height, radius) {
  if (!radius) return mask;
  const opened = dilate(erode(mask, width, height, radius), width, height, radius);
  return erode(dilate(opened, width, height, 1), width, height, 1);
}

// -- zones ------------------------------------------------------------------------

/** How far past its line a zone got, in the words Detect uses for a candidate. */
export const strengthOf = (margin) => (margin >= 3 ? 'strong' : margin >= 1.5 ? 'clear' : 'weak');

/**
 * Connected regions of the mask, each with its extent, its area on the ground,
 * its dominant direction and how far past the threshold it got. Returned in
 * frame fractions so a caller can place them on whichever map they belong to.
 */
export function findZones(mask, classes, strength, width, height, metresPerPixel,
                          minimumArea = 0, threshold = 0) {
  const labels = new Int32Array(mask.length);
  const zones = [];
  const stack = [];
  const cellArea = metresPerPixel > 0 ? metresPerPixel * metresPerPixel : 0;
  let next = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    next += 1;
    labels[start] = next;
    stack.push(start);
    const zone = {
      id: next, pixels: 0, gain: 0, loss: 0, changed: 0, strength: 0,
      minX: width, minY: height, maxX: 0, maxY: 0, sumX: 0, sumY: 0,
    };
    while (stack.length) {
      const pixel = stack.pop();
      const x = pixel % width;
      const y = (pixel - x) / width;
      zone.pixels += 1;
      zone.strength += strength[pixel];
      zone.sumX += x;
      zone.sumY += y;
      if (x < zone.minX) zone.minX = x;
      if (x > zone.maxX) zone.maxX = x;
      if (y < zone.minY) zone.minY = y;
      if (y > zone.maxY) zone.maxY = y;
      const group = classes[pixel];
      if (group === 1) zone.gain += 1;
      else if (group === 2) zone.loss += 1;
      else zone.changed += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbour = ny * width + nx;
          if (mask[neighbour] && !labels[neighbour]) {
            labels[neighbour] = next;
            stack.push(neighbour);
          }
        }
      }
    }
    zones.push(zone);
  }

  const kept = new Set();
  const out = [];
  for (const zone of zones) {
    const area = zone.pixels * cellArea;
    if (cellArea && area < minimumArea) continue;
    kept.add(zone.id);
    const kind = zone.gain >= zone.loss && zone.gain >= zone.changed
      ? 'gain'
      : zone.loss >= zone.changed ? 'loss' : 'changed';
    const average = zone.strength / zone.pixels;
    const intensity = average / 255;
    const margin = threshold > 0 ? average / threshold : 0;
    out.push({
      id: zone.id,
      kind,
      pixels: zone.pixels,
      area,
      intensity: Math.round(intensity * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      strength: strengthOf(margin),
      score: zone.pixels * intensity,
      box: {
        x1: zone.minX / width,
        y1: zone.minY / height,
        x2: (zone.maxX + 1) / width,
        y2: (zone.maxY + 1) / height,
      },
      centre: { x: (zone.sumX / zone.pixels + 0.5) / width, y: (zone.sumY / zone.pixels + 0.5) / height },
    });
  }
  out.sort((left, right) => right.score - left.score);
  return { zones: out, labels, kept };
}

// -- drawing ----------------------------------------------------------------------

/** A warm ramp from transparent violet to white-hot yellow, for the heat display. */
function heatColour(t) {
  const stops = [
    [0, [60, 16, 110]],
    [0.35, [180, 40, 120]],
    [0.65, [245, 110, 40]],
    [1, [255, 236, 120]],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const k = (t - p0) / (p1 - p0);
      return c0.map((value, channel) => Math.round(value + (c1[channel] - value) * k));
    }
  }
  return stops.at(-1)[1];
}

const CLASS_CODE = { gain: 1, loss: 2, changed: 3 };

/**
 * @param {object} input
 * @param {Uint8ClampedArray} input.a  RGBA frame of A
 * @param {Uint8ClampedArray} input.b  RGBA frame of B, same size
 * @param {number} input.width
 * @param {number} input.height
 * @param {object} input.settings      see `changeSettings`
 * @param {number} [input.metresPerPixel] ground size of one working pixel
 * @param {{a: Uint8ClampedArray, b: Uint8ClampedArray}} [input.frames] band frames
 * @param {{lat: number, bearing: number, days: string[]}} [input.ground] where and when
 * @param {string} [input.family]      sentinel2, esri or viirs
 */
export function detectChange({
  a, b, width, height, settings: raw, metresPerPixel = 0, frames = null,
  ground = null, family = '',
}) {
  if (!a || !b || a.length !== b.length || a.length !== width * height * 4) {
    throw new Error('change frames must have the same pixel geometry');
  }
  const settings = changeSettings(raw);
  if (settings.method === 'index' && (!frames?.a || !frames?.b)) {
    throw new Error('the spectral index frames are missing');
  }
  const count = width * height;
  const usesPixels = settings.method !== 'index';
  const offset = usesPixels
    ? estimateAlignment(a, b, width, height, settings.alignment)
    : { x: 0, y: 0, score: 0 };
  const registered = usesPixels ? shifted(b, width, height, offset) : b;
  const decoded = frames?.a && frames?.b
    ? { a: decodeFrame(frames.a), b: decodeFrame(shifted(frames.b, width, height, offset)) }
    : null;
  const place = { width, height, metresPerPixel, lat: ground?.lat ?? 0,
    bearing: ground?.bearing ?? 0, days: ground?.days ?? ['', ''] };
  const blocked = decoded ? weatherMask(decoded, place, settings) : null;
  // Two Sentinel-2 passes are already corrected to surface reflectance and
  // rendered by one formula, so there is no exposure left to match — only real
  // change, which a match would eat: a burn over most of a view moves the
  // histogram, and matching it puts the view back the way it was. Two radar
  // passes of one track are calibrated backscatter drawn by one formula too.
  const tone = settings.normalize !== 'auto'
    ? settings.normalize
    : (family === 'sentinel2' || family === 'sentinel1' ? 'none' : 'histogram');
  const keep = blocked ? blocked.map((flag) => (flag ? 0 : 1)) : null;
  const toned = usesPixels ? matchTone(a, registered, tone, keep) : registered;
  const measured = measure(a, toned, width, height, settings, decoded, blocked);
  const field = boxBlur(measured.magnitude, width, height, settings.smoothing, measured.valid);
  const threshold = thresholdFor(field, measured.valid, settings);

  const wanted = new Set(settings.classes.map((entry) => CLASS_CODE[entry]));
  const classes = new Uint8Array(count);
  const candidate = new Uint8Array(count);
  let validPixels = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (!measured.valid[pixel]) continue;
    validPixels += 1;
    if (field[pixel] < threshold) continue;
    const group = measured.chroma[pixel] ? 3 : measured.direction[pixel] > 0 ? 1 : 2;
    classes[pixel] = group;
    if (wanted.has(group)) candidate[pixel] = 1;
  }
  const mask = cleanMask(candidate, width, height, settings.cleanup);
  for (let pixel = 0; pixel < count; pixel += 1) {
    // a pinhole the closing filled takes the class of what surrounds it
    if (mask[pixel] && !classes[pixel]) {
      const x = pixel % width;
      const neighbour = [pixel - 1, pixel + 1, pixel - width, pixel + width]
        .find((near) => near >= 0 && near < count && classes[near] && Math.abs((near % width) - x) <= 1);
      classes[pixel] = neighbour == null ? 3 : classes[neighbour];
    }
  }

  const { zones, labels, kept } = findZones(
    mask, classes, field, width, height, metresPerPixel, settings.min_area, threshold
  );

  const palette = CHANGE_PALETTES[settings.palette] ?? CHANGE_PALETTES.directional;
  const colourOf = { 1: palette.gain, 2: palette.loss, 3: palette.changed };
  const pixels = new Uint8ClampedArray(count * 4);
  const counts = { gained: 0, lost: 0, changed: 0, quiet: 0 };
  const ceiling = Math.max(threshold + 1, 160);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const inZone = mask[pixel] && kept.has(labels[pixel]);
    if (!inZone) {
      if (measured.valid[pixel]) counts.quiet += 1;
      continue;
    }
    const group = classes[pixel];
    if (group === 1) counts.gained += 1;
    else if (group === 2) counts.lost += 1;
    else counts.changed += 1;
    const t = clamp((field[pixel] - threshold) / (ceiling - threshold), 0, 1);
    const i = pixel * 4;
    if (settings.display === 'outline') {
      const x = pixel % width;
      const edge =
        x === 0 || x === width - 1 || pixel < width || pixel >= count - width ||
        labels[pixel - 1] !== labels[pixel] || labels[pixel + 1] !== labels[pixel] ||
        labels[pixel - width] !== labels[pixel] || labels[pixel + width] !== labels[pixel];
      const colour = colourOf[group];
      pixels[i] = colour[0];
      pixels[i + 1] = colour[1];
      pixels[i + 2] = colour[2];
      pixels[i + 3] = edge ? 255 : 38;
    } else if (settings.display === 'heat') {
      const colour = heatColour(t);
      pixels[i] = colour[0];
      pixels[i + 1] = colour[1];
      pixels[i + 2] = colour[2];
      pixels[i + 3] = Math.round(90 + t * 165);
    } else {
      const colour = colourOf[group];
      pixels[i] = colour[0];
      pixels[i + 1] = colour[1];
      pixels[i + 2] = colour[2];
      pixels[i + 3] = Math.round(110 + t * 145);
    }
  }

  const changedPixels = counts.gained + counts.lost + counts.changed;
  return {
    pixels,
    width,
    height,
    counts,
    zones: zones.slice(0, 250),
    zoneCount: zones.length,
    threshold: Math.round(threshold * 10) / 10,
    offset: { x: offset.x, y: offset.y },
    share: validPixels ? changedPixels / validPixels : 0,
    coverage: count ? validPixels / count : 0,
    area: changedPixels * metresPerPixel * metresPerPixel,
    settings,
  };
}
