/**
 * What to ask NASA GIBS for when the night lights layer is on.
 *
 * The Day/Night Band of VIIRS photographs the ground at night, once a night
 * around 01:30 local time, and GIBS serves each night as its own tiles. A night
 * is the question an analyst brings: whether a city was dark after a strike,
 * whether a depot was lit. The 2016 composite is the other question, a
 * cloud-free baseline to hold a night against.
 *
 * Key-less and public domain, so the browser asks GIBS directly. Each sensor's
 * record starts on a different day (read off GIBS's capabilities, 2026-09), and
 * the calendar is bounded by it rather than failing on a date already picked.
 */

export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const SENSORS = [
  {
    id: 'noaa20',
    label: 'NOAA-20',
    layer: 'VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance',
    first: '2024-03-25',
  },
  {
    id: 'snpp',
    label: 'Suomi NPP',
    layer: 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance',
    first: '2020-11-18',
  },
];

/** A year of cloud-free nights, as one picture. Not a sensor: a baseline. */
export const COMPOSITE = {
  id: 'composite',
  label: '2016',
  layer: 'VIIRS_Black_Marble',
  day: '2016-01-01',
};

/** `YYYY-MM-DD` or ''. */
function asDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
}

/**
 * The last night GIBS can be expected to hold. Today's pass is still being
 * processed for much of the day, and a blank night reads as an outage.
 */
export function lastNight(now = new Date()) {
  const day = new Date(now.getTime());
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** The first night a source can answer, or '' for the composite. */
export function firstNight(source) {
  return SENSORS.find((sensor) => sensor.id === source)?.first ?? '';
}

/** Is this choice one GIBS can answer? A sensor needs a night inside its record. */
export function askable({ source, day } = {}, now = new Date()) {
  if (source === COMPOSITE.id) return true;
  const sensor = SENSORS.find((entry) => entry.id === source);
  const night = asDay(day);
  if (!sensor || !night) return false;
  return night >= sensor.first && night <= lastNight(now);
}

/** The question the tiles are built from. The composite has one date only. */
export function tileParams({ source, day } = {}) {
  if (source === COMPOSITE.id) return { source };
  return { source, day: asDay(day) };
}

/** The XYZ template GIBS serves one night, or the composite, from. */
export function tileTemplate({ source, day } = {}) {
  const composite = source === COMPOSITE.id;
  const layer = composite ? COMPOSITE.layer : SENSORS.find((entry) => entry.id === source)?.layer;
  const night = composite ? COMPOSITE.day : asDay(day);
  if (!layer || !night) return '';
  return `${GIBS}/${layer}/default/${night}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`;
}

/** How the row says what it is showing. */
export function summary({ source, day } = {}) {
  if (source === COMPOSITE.id) return 'composite · 2016';
  const label = SENSORS.find((entry) => entry.id === source)?.label ?? '';
  return [label, asDay(day) || 'pick a night'].filter(Boolean).join(' · ');
}
