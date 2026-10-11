/**
 * Compare's layers: one list over both sides, and fire and night layers that read
 * each side's own date.
 *
 * Each side used to keep a list of its own, set in a sheet that hid both maps. A
 * layer on one side only reads as a change between them, though, so a pair now
 * shares one list, and what differs between A and B is the day: the fires and the
 * night lights follow each side's picture, or the days picked for each.
 *
 * A saved comparison keeps the two sides as it always did (`overlays`, `firms`,
 * `nightlights` on each), with the days each side was showing, so it reopens as
 * it was saved.
 */
import { DATED, askable as firesAskable, firmsNote, onDay, PICTURE, summary as firesSummary, today } from './firms.js';
import { fireControls } from './eventControls.js';
import { knownLayers } from './layerCatalog.js';
import {
  askable as nightAskable,
  COMPOSITE,
  firstNight,
  lastNight,
  onNight,
  SENSORS as NIGHT_SENSORS,
  summary as nightSummary,
} from './nightlights.js';

const SIDES = ['a', 'b'];
const letter = (which) => which.toUpperCase();
const pickedDay = (day = '') => ({ window: DATED, first: day, last: '' });

/** A new pair's fires: each side's own day. */
export function freshFires() {
  return { sensor: 'viirs', follow: true, a: pickedDay(), b: pickedDay() };
}

/** A new pair's night lights: each side's own night. */
export function freshNight(now = new Date()) {
  const day = lastNight(now);
  return { source: 'noaa20', follow: true, a: day, b: day };
}

/** One side's fire question: its picture's day while following, else the days picked for it. */
export function sideFires(fires, which, pictureDay = '') {
  if (fires.follow) return onDay({ sensor: fires.sensor, window: PICTURE, first: '', last: '' }, pictureDay);
  return { sensor: fires.sensor, ...fires[which] };
}

/** One side's night: the night of its picture while following, else the night picked for it. */
export function sideNight(night, which, pictureDay = '') {
  if (night.follow) return onNight({ source: night.source, follow: true }, pictureDay);
  return { source: night.source, day: night[which] };
}

/**
 * The layers of a saved comparison or a handed-over pair, read back.
 *
 * A session saved while each side had a list of its own may hold a layer on one
 * side only; it comes back on both. Fire and night days come back as each side
 * held them, picked rather than followed, so the pair shows what was saved.
 */
export function restoredLayers(left = {}, right = {}) {
  const layers = knownLayers([...(left?.overlays ?? []), ...(right?.overlays ?? [])]);
  const fires = layers.includes('firms')
    ? {
        sensor: left?.firms?.sensor || right?.firms?.sensor || 'viirs',
        follow: false,
        a: firesDays(left?.firms),
        b: firesDays(right?.firms),
      }
    : freshFires();
  const night = layers.includes('nightlights')
    ? {
        source: left?.nightlights?.source || right?.nightlights?.source || 'noaa20',
        follow: false,
        a: left?.nightlights?.day || lastNight(),
        b: right?.nightlights?.day || lastNight(),
      }
    : freshNight();
  return { layers, fires, night };
}

function firesDays(firms = {}) {
  return { window: firms?.window || DATED, first: firms?.first || '', last: firms?.last || '' };
}

/** A and B traded places: the days picked for each go with them. */
export function swappedDays(choice) {
  return { ...choice, a: choice.b, b: choice.a };
}

/**
 * The fire layer's questions: which instrument, and whether each side follows its
 * picture or shows a day of its own.
 *
 * @param {{ a: string, b: string }} pictureDays the date of each side's picture
 */
export function compareFireControls(fires, sensors, set, pictureDays) {
  const [sensor] = fireControls(fires, sensors, set);
  return [
    sensor,
    {
      label: 'Days',
      options: [
        { id: PICTURE, label: "Each side's day", title: 'Detections from the day each side was taken' },
        { id: DATED, label: 'Pick days', title: 'A day of your choosing on each side' },
      ],
      value: fires.follow ? PICTURE : DATED,
      pick: (id) => {
        if (id === PICTURE) return set({ follow: true });
        if (!fires.follow) return undefined;
        // start on the days that were showing, so nothing moves until one is changed
        const start = (which) => pickedDay(pictureDays[which] || today());
        return set({ follow: false, a: start('a'), b: start('b') });
      },
      days: fires.follow
        ? null
        : SIDES.map((which) => ({
            label: letter(which),
            title: `Day of the detections drawn on ${letter(which)}`,
            value: fires[which].window === DATED ? fires[which].first : '',
            max: today(),
            set: (day) => set({ [which]: pickedDay(day) }),
          })),
    },
  ];
}

/** The night layer's questions: which product, and each side's night. */
export function compareNightControls(night, set, pictureDays) {
  const showing = {
    label: 'Showing',
    options: [
      ...NIGHT_SENSORS.map((sensor) => ({
        id: sensor.id,
        label: sensor.label,
        title: `${sensor.label} · one night, back to ${sensor.first}`,
      })),
      { id: COMPOSITE.id, label: COMPOSITE.label, title: 'Cloud-free composite of 2016' },
    ],
    value: night.source,
    pick: (id) => set({ source: id }),
  };
  if (night.source === COMPOSITE.id) return [showing];
  return [
    showing,
    {
      label: 'Nights',
      options: [
        { id: PICTURE, label: "Each side's night", title: 'The night of the day each side was taken' },
        { id: 'day', label: 'Pick nights', title: 'A night of your choosing on each side' },
      ],
      value: night.follow ? PICTURE : 'day',
      pick: (id) => {
        if (id === PICTURE) return set({ follow: true });
        if (!night.follow) return undefined;
        const start = (which) => sideNight(night, which, pictureDays[which]).day;
        return set({ follow: false, a: start('a'), b: start('b') });
      },
      days: night.follow
        ? null
        : SIDES.map((which) => ({
            label: letter(which),
            title: `Night shown on ${letter(which)}, around 01:30 local time`,
            value: night[which],
            min: firstNight(night.source),
            max: lastNight(),
            set: (day) => set({ [which]: day }),
          })),
    },
  ];
}

/** The fire layer's line in the menu: the instrument, then what each side draws. */
export function compareFireWords(fires, sensors, pictureDays) {
  const name = sensors.find((entry) => entry.id === fires.sensor)?.label ?? fires.sensor;
  const side = (which) => firesSummary({ ...sideFires(fires, which, pictureDays[which]), sensor: '' });
  return `${name.replace(/\s*\(.*\)\s*$/, '')} · A ${side('a')} · B ${side('b')}`;
}

/** The night layer's line in the menu. */
export function compareNightWords(night, pictureDays) {
  if (night.source === COMPOSITE.id) return nightSummary({ source: night.source });
  const label = NIGHT_SENSORS.find((entry) => entry.id === night.source)?.label ?? night.source;
  const side = (which) => sideNight(night, which, pictureDays[which]).day || 'pick a night';
  return `${label} · A ${side('a')} · B ${side('b')}`;
}

/** Why the fire layer draws nothing on a side, or how its colours read; '' when there is nothing to say. */
export function compareFireNote(fires, pictureDays, paused = null) {
  const asked = SIDES.map((which) => sideFires(fires, which, pictureDays[which]));
  if (paused) return firmsNote(asked[0], paused);
  if (asked.some((choice) => !firesAskable(choice))) return 'Pick a day on each side to draw the detections.';
  return firmsNote(asked.find((choice) => choice.window !== DATED) ?? asked[0]);
}

/** Why the night layer draws nothing on a side, or ''. */
export function compareNightNote(night, pictureDays) {
  if (night.source === COMPOSITE.id) return '';
  const outside = SIDES.filter((which) => !nightAskable(sideNight(night, which, pictureDays[which])));
  if (!outside.length) return '';
  const sensor = NIGHT_SENSORS.find((entry) => entry.id === night.source)?.label ?? 'this sensor';
  if (!night.follow) return 'Pick nights inside this sensor’s record.';
  return `${outside.map(letter).join(' and ')}: the picture's day is outside ${sensor}'s record.`;
}
