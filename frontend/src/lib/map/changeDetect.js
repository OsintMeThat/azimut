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
 *    so a hazier or brighter day is not read as change everywhere.
 * 3. **Measure.** One signed difference per pixel: perceptual colour distance,
 *    lightness, edge strength, or a real spectral index when both are given.
 * 4. **Mask.** Pixels without data, and optionally cloud and shadow, drop out.
 * 5. **Threshold.** Otsu's split of the difference histogram, or the analyst's
 *    own level, over a floor that keeps rendering noise out.
 * 6. **Clean.** A morphological opening removes speckle, a closing fills pinholes.
 * 7. **Group.** Connected regions become zones with an area on the ground,
 *    a dominant direction and a score; zones under the minimum area go.
 * 8. **Draw.** Classes, a continuous heat ramp or outlines, into a mask whose
 *    alpha carries the strength.
 */

import { CHANGE_PALETTES, changeSettings } from './changeAssist.js';

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

/** B's three channels moved onto A's, by their means or by their whole histograms. */
export function matchTone(left, right, mode = 'histogram') {
  if (mode !== 'mean' && mode !== 'histogram') return right;
  const out = new Uint8ClampedArray(right);
  for (let channel = 0; channel < 3; channel += 1) {
    const histA = new Float64Array(256);
    const histB = new Float64Array(256);
    let count = 0;
    for (let index = 0; index < left.length; index += 4) {
      if (left[index + 3] < 200 || right[index + 3] < 200) continue;
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

/** Decode an index frame (`engine/sentinel.py`): R = index, G = scene class, A = data. */
export function decodeIndex(pixels) {
  const count = pixels.length / 4;
  const value = new Float32Array(count);
  const scene = new Uint8Array(count);
  const valid = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const index = pixel * 4;
    value[pixel] = pixels[index] / 127.5 - 1;
    scene[pixel] = pixels[index + 1];
    valid[pixel] = pixels[index + 3] > 127 ? 1 : 0;
  }
  return { value, scene, valid };
}

// Sentinel-2 L2A scene classes: 3 cloud shadow, 8–10 cloud and cirrus, 11 snow.
const SHADOW_CLASSES = new Set([3]);
const CLOUD_CLASSES = new Set([8, 9, 10]);

/**
 * Grow a flag array by `radius`, separably: a horizontal pass then a vertical
 * one, which is the same result as a square dilation for a fraction of the work.
 *
 * Both cloud masks stop short of where a reader would put the cloud's edge —
 * a classification calls the soft rim ground, and a brightness test loses the
 * rim where it fades. That rim is where the ring of highlights around every
 * mask comes from, so the mask is grown rather than trusted as drawn.
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

/**
 * One signed difference per pixel and the pixels it is valid for.
 * `magnitude` is on a 0…255 scale for every method, so one threshold rule fits.
 */
export function measure(left, right, width, height, settings, index = null) {
  const count = width * height;
  const magnitude = new Float32Array(count);
  const direction = new Int8Array(count);
  const chroma = new Uint8Array(count);
  const valid = new Uint8Array(count);

  const masking = settings.ignore_clouds || settings.ignore_shadows;

  if (settings.method === 'index' && index) {
    const a = decodeIndex(index.a);
    const b = decodeIndex(index.b);
    // Cloud on either date invalidates the pixel: a difference is a measurement
    // only when both sides of it are ground.
    let blocked = new Uint8Array(count);
    if (masking) {
      for (let pixel = 0; pixel < count; pixel += 1) {
        const clouded = CLOUD_CLASSES.has(a.scene[pixel]) || CLOUD_CLASSES.has(b.scene[pixel]);
        const shaded = SHADOW_CLASSES.has(a.scene[pixel]) || SHADOW_CLASSES.has(b.scene[pixel]);
        if ((settings.ignore_clouds && clouded) || (settings.ignore_shadows && shaded)) {
          blocked[pixel] = 1;
        }
      }
      blocked = growMask(blocked, width, height, settings.cloud_margin);
    }
    for (let pixel = 0; pixel < count; pixel += 1) {
      if (!a.valid[pixel] || !b.valid[pixel] || blocked[pixel]) continue;
      const delta = b.value[pixel] - a.value[pixel];
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
  // Cloud reads as near-white with no colour, shadow as near-black. There is no
  // scene classification behind a rendered picture, so this is a guess — it is
  // offered as an option, and the panel says as much, for exactly that reason.
  const cloudy = (lab) => lab[0] > 86 && Math.hypot(lab[1], lab[2]) < 12;
  const shaded = (lab) => lab[0] < 10;
  let blocked = new Uint8Array(count);
  const inFrame = new Uint8Array(count);
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
    inFrame[pixel] = 1;
    if (settings.ignore_clouds && (cloudy(labOfA) || cloudy(labOfB))) blocked[pixel] = 1;
    else if (settings.ignore_shadows && (shaded(labOfA) || shaded(labOfB))) blocked[pixel] = 1;
  }
  if (masking) blocked = growMask(blocked, width, height, settings.cloud_margin);
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (inFrame[pixel] && !blocked[pixel]) valid[pixel] = 1;
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
const FLOORS = { colour: 18, brightness: 16, structure: 22, index: 38 };

export function thresholdFor(field, valid, settings) {
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

/**
 * Connected regions of the mask, each with its extent, its area on the ground
 * and its dominant direction. Returned in frame fractions so a caller can place
 * them on whichever map they belong to.
 */
export function findZones(mask, classes, strength, width, height, metresPerPixel, minimumArea = 0) {
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
    const intensity = zone.strength / zone.pixels / 255;
    out.push({
      id: zone.id,
      kind,
      pixels: zone.pixels,
      area,
      intensity: Math.round(intensity * 100) / 100,
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
 * @param {{a: Uint8ClampedArray, b: Uint8ClampedArray}} [input.index] index frames
 */
export function detectChange({ a, b, width, height, settings: raw, metresPerPixel = 0, index = null }) {
  if (!a || !b || a.length !== b.length || a.length !== width * height * 4) {
    throw new Error('change frames must have the same pixel geometry');
  }
  const settings = changeSettings(raw);
  if (settings.method === 'index' && (!index?.a || !index?.b)) {
    throw new Error('the spectral index frames are missing');
  }
  const count = width * height;
  const usesPixels = settings.method !== 'index';
  const offset = usesPixels
    ? estimateAlignment(a, b, width, height, settings.alignment)
    : { x: 0, y: 0, score: 0 };
  const registered = usesPixels ? shifted(b, width, height, offset) : b;
  const toned = usesPixels ? matchTone(a, registered, settings.normalize) : registered;
  const measured = measure(a, toned, width, height, settings, index);
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
    mask, classes, field, width, height, metresPerPixel, settings.min_area
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
