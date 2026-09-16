/**
 * What Change assist is allowed to read, and the settings it reads with.
 *
 * A pixel difference is only worth showing when both pictures come from one
 * rendering chain: a highlighted provider or style difference would otherwise
 * pass for a change on the ground. `changeCompatibility` answers that before
 * anything is computed, and grades a fair pair as `matched` (one product, one
 * render) or `indicative` (one chain, but something the analyst should keep in
 * mind). `api/compare.py` refuses the same pairs on save.
 *
 * The detection itself lives in `changeDetect.js` and runs in a worker.
 */

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const CHANGE_METHODS = Object.freeze([
  { id: 'colour', label: 'Colour', hint: 'Perceptual colour distance. The general reading.' },
  { id: 'structure', label: 'Structure', hint: 'Edges that appear or vanish. Steadier across seasons and sensors.' },
  { id: 'brightness', label: 'Brightness', hint: 'Lighter or darker only. Suits night lights and burn scars.' },
  { id: 'index', label: 'Spectral index', hint: 'Real Sentinel-2 bands for both dates, fetched on demand.' },
]);

export const CHANGE_INDICES = Object.freeze([
  { id: 'ndvi', label: 'NDVI', hint: 'Vegetation', gain: 'Greener', loss: 'Vegetation lost' },
  { id: 'ndwi', label: 'NDWI', hint: 'Water', gain: 'Wetter', loss: 'Water receded' },
  { id: 'nbr', label: 'NBR', hint: 'Burn scars', gain: 'Recovered', loss: 'Burnt' },
  { id: 'ndbi', label: 'NDBI', hint: 'Built-up', gain: 'Built or cleared', loss: 'Less built-up' },
]);

export const CHANGE_DISPLAYS = Object.freeze([
  { id: 'classes', label: 'Classes' },
  { id: 'heat', label: 'Heat' },
  { id: 'outline', label: 'Outline' },
]);

export const CHANGE_PALETTES = Object.freeze({
  directional: Object.freeze({
    gain: [34, 197, 94],
    loss: [239, 68, 68],
    changed: [250, 204, 21],
  }),
  // Okabe-Ito hues: distinguishable under the common red/green deficiencies.
  colourblind: Object.freeze({
    gain: [0, 114, 178],
    loss: [230, 159, 0],
    changed: [204, 121, 167],
  }),
  // Direction still reads through hue, but the three sit on one warm ramp so a
  // heat display stays legible over green vegetation and blue water.
  thermal: Object.freeze({
    gain: [255, 214, 10],
    loss: [120, 40, 200],
    changed: [255, 120, 30],
  }),
});

export const CHANGE_CLASSES = Object.freeze(['gain', 'loss', 'changed']);

/**
 * What the highlighted pixels are laid over. One image answers "where did it
 * change"; the pair answers "change from what into what", which is the question
 * a single base cannot show at all — so it is offered beside the other two
 * rather than buried as a background setting.
 */
export const CHANGE_BASES = Object.freeze([
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'side', label: 'Both' },
]);

export const CHANGE_DEFAULTS = Object.freeze({
  method: 'colour',
  index: 'ndvi',
  threshold: 'auto',
  sensitivity: 55,
  normalize: 'histogram',
  smoothing: 1,
  alignment: 4,
  cleanup: 1,
  min_area: 0,
  ignore_clouds: false,
  ignore_shadows: false,
  // A cloud fades out at its edges and its shadow has no edge at all, so both
  // masks stop short of where a reader would put the cloud. Growing them takes
  // the fringe that otherwise survives as a ring of highlights around the mask.
  cloud_margin: 2,
  classes: ['gain', 'loss', 'changed'],
  display: 'classes',
  palette: 'directional',
  zones: true,
  opacity: 70,
  base: 'b',
  visible: true,
  live: true,
});

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const whole = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/** Every setting inside its range, whatever a saved session or a slider held. */
export function changeSettings(raw = {}) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const classes = Array.isArray(value.classes)
    ? CHANGE_CLASSES.filter((entry) => value.classes.includes(entry))
    : [...CHANGE_DEFAULTS.classes];
  const area = Number(value.min_area);
  return {
    method: pick(value.method, CHANGE_METHODS.map((entry) => entry.id), CHANGE_DEFAULTS.method),
    index: pick(value.index, CHANGE_INDICES.map((entry) => entry.id), CHANGE_DEFAULTS.index),
    threshold: pick(value.threshold, ['auto', 'manual'], CHANGE_DEFAULTS.threshold),
    sensitivity: whole(value.sensitivity, 0, 100, CHANGE_DEFAULTS.sensitivity),
    normalize: pick(value.normalize, ['none', 'mean', 'histogram'], CHANGE_DEFAULTS.normalize),
    smoothing: whole(value.smoothing, 0, 4, CHANGE_DEFAULTS.smoothing),
    alignment: whole(value.alignment, 0, 8, CHANGE_DEFAULTS.alignment),
    cleanup: whole(value.cleanup, 0, 3, CHANGE_DEFAULTS.cleanup),
    min_area: Number.isFinite(area) ? Math.min(1_000_000, Math.max(0, area)) : 0,
    ignore_clouds: value.ignore_clouds ?? CHANGE_DEFAULTS.ignore_clouds,
    ignore_shadows: value.ignore_shadows ?? CHANGE_DEFAULTS.ignore_shadows,
    cloud_margin: whole(value.cloud_margin, 0, 10, CHANGE_DEFAULTS.cloud_margin),
    classes,
    display: pick(value.display, CHANGE_DISPLAYS.map((entry) => entry.id), CHANGE_DEFAULTS.display),
    palette: pick(value.palette, Object.keys(CHANGE_PALETTES), CHANGE_DEFAULTS.palette),
    zones: value.zones ?? CHANGE_DEFAULTS.zones,
    opacity: whole(value.opacity, 0, 100, CHANGE_DEFAULTS.opacity),
    base: pick(value.base, CHANGE_BASES.map((entry) => entry.id), CHANGE_DEFAULTS.base),
    visible: value.visible !== false,
    live: value.live !== false,
  };
}

function layerReading(side, skipped) {
  return (side?.overlays ?? [])
    .filter((id) => id !== skipped)
    .map((id) => {
      if (id === 'firms') return [id, side.firms];
      if (id === 'nightlights') return [id, side.nightlights];
      return [id];
    });
}

const refuse = (reason) => ({ ok: false, reason, methods: [] });
const PIXEL_METHODS = ['colour', 'structure', 'brightness'];
const ESRI = new Set(['esri-world-imagery', 'esri-wayback']);

/**
 * Whether a pixel reading of this pair is honest, and how much to trust it.
 *
 * @returns {{ ok: boolean, reason?: string, grade?: 'matched'|'indicative',
 *   label?: string, from?: string, to?: string, notes?: string[], methods: string[] }}
 */
export function changeCompatibility(a, b) {
  if (!a?.present || !b?.present) return refuse('Add imagery A and B first.');
  if (a.widget || b.widget) {
    return refuse('Change assist needs app-rendered pixels, not a web map widget.');
  }

  if (a.provider === 'sentinel2' && b.provider === 'sentinel2') {
    const dateA = a.sentinel?.effectiveDate || a.sentinel?.date;
    const dateB = b.sentinel?.effectiveDate || b.sentinel?.date;
    if (!dateA || !dateB || dateA === dateB) {
      return refuse('Choose two different dated Sentinel-2 passes.');
    }
    const notes = [];
    const methods = ['index'];
    if (a.sentinel?.layer === b.sentinel?.layer && same(layerReading(a), layerReading(b))) {
      methods.unshift(...PIXEL_METHODS);
    } else {
      notes.push('Pixel methods need the same layer and reference layers on A and B.');
    }
    if (a.sentinel?.maxcc !== b.sentinel?.maxcc) {
      notes.push('The two sides use different cloud ceilings.');
    }
    return {
      ok: true,
      grade: notes.length ? 'indicative' : 'matched',
      label: `Sentinel-2 · ${String(a.sentinel.layer).replace(/_/g, ' ')}`,
      from: dateA,
      to: dateB,
      notes,
      methods,
    };
  }

  if (ESRI.has(a.provider) && ESRI.has(b.provider)) {
    const releaseA = a.provider === 'esri-wayback' ? a.waybackRelease : 'current';
    const releaseB = b.provider === 'esri-wayback' ? b.waybackRelease : 'current';
    if (a.provider === b.provider && releaseA === releaseB) {
      return refuse('Choose two different Esri releases.');
    }
    if (!same(layerReading(a), layerReading(b))) {
      return refuse('Match the reference layers on A and B before comparing pixels.');
    }
    const mixed = a.provider !== b.provider;
    return {
      ok: true,
      grade: mixed ? 'indicative' : 'matched',
      label: mixed ? 'Esri World Imagery and Wayback' : 'Esri Wayback',
      from: releaseA == null ? 'latest' : String(releaseA),
      to: releaseB == null ? 'latest' : String(releaseB),
      notes: [
        ...(mixed ? ['World Imagery is the live mosaic, so its date varies from place to place.'] : []),
        'Releases often share pixels, so an unchanged spot is not proof of no change.',
      ],
      methods: PIXEL_METHODS,
    };
  }

  const nightA = (a.overlays ?? []).includes('nightlights');
  const nightB = (b.overlays ?? []).includes('nightlights');
  if (nightA && nightB) {
    if (a.provider !== b.provider) {
      return refuse('Night lights need the same background imagery on A and B.');
    }
    if (a.nightlights?.source !== b.nightlights?.source) {
      return refuse('Night lights need the same VIIRS product on A and B.');
    }
    if (a.nightlights?.source === 'composite') {
      return refuse('The night-light composite has one date only.');
    }
    if (!a.nightlights?.day || !b.nightlights?.day || a.nightlights.day === b.nightlights.day) {
      return refuse('Choose two different nights from the same VIIRS sensor.');
    }
    if (!same(a.sentinel, b.sentinel) || a.waybackRelease !== b.waybackRelease) {
      return refuse('Match the background imagery on A and B before comparing night lights.');
    }
    if (!same(layerReading(a, 'nightlights'), layerReading(b, 'nightlights'))) {
      return refuse('Match every other layer on A and B before comparing night lights.');
    }
    return {
      ok: true,
      grade: 'matched',
      label: `VIIRS · ${a.nightlights.source === 'noaa20' ? 'NOAA-20' : 'Suomi NPP'}`,
      from: a.nightlights.day,
      to: b.nightlights.day,
      notes: ['Moonlight and cloud change a single night. Compare several before concluding.'],
      methods: ['brightness', 'colour'],
    };
  }

  return refuse('Change assist reads Sentinel-2 passes, Esri releases or VIIRS night lights.');
}
