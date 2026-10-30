/**
 * The questions the fire and night layers ask, as the rows a layers list draws.
 *
 * Satellite asked them in its panel and Compare in a sheet of its own, each from
 * its own copy. Every map now builds them here, so a sensor added or a window
 * renamed reads the same wherever the layer is switched on. The shape is the one
 * `LayerControls.svelte` draws.
 *
 * `follow` is the label of the choice that tracks the picture on screen ("Picture's
 * day"), offered only by a map that knows its picture's date. `pictureDay` is that
 * date, so leaving the followed choice for a picked one starts on the day that was
 * showing rather than jumping to today.
 */
import { DATED, lastDayOf, PICTURE, today, WINDOWS } from './firms.js';
import { COMPOSITE, firstNight, lastNight, SENSORS } from './nightlights.js';

/**
 * @param {{ sensor: string, window: string, first: string, last: string }} choice
 * @param {Array<{ id: string, label: string }>} sensors from `/api/firms/sensors`
 * @param {(patch: object) => void} set
 */
export function fireControls(choice, sensors, set, { follow = '', pictureDay = '' } = {}) {
  return [
    {
      label: 'Sensor',
      options: sensors.map((entry) => ({
        id: entry.id,
        // "VIIRS (S-NPP, NOAA-20, NOAA-21)" does not fit a panel this wide, and the
        // instrument is the part being chosen between
        label: entry.label.replace(/\s*\(.*\)\s*$/, ''),
        title:
          entry.id === 'modis'
            ? `${entry.label} · 1 km, back to 2000`
            : `${entry.label} · 375 m, back to 2012`,
      })),
      value: choice.sensor,
      pick: (id) => set({ sensor: id }),
    },
    {
      label: 'Showing',
      options: [
        ...(follow ? [{ id: PICTURE, label: follow, title: 'Detections from the day the picture was taken' }] : []),
        ...WINDOWS.map((entry) => ({
          ...entry,
          title: `Detections from the last ${entry.label.toLowerCase()}`,
        })),
        { id: DATED, label: 'Dates', title: 'Detections from a past day or range' },
      ],
      value: choice.window,
      pick: (id) => {
        if (id !== DATED || choice.first) return set({ window: id });
        const start = (choice.window === PICTURE && pictureDay) || today();
        return set({ window: id, first: start, last: '' });
      },
      dates:
        choice.window === DATED
          ? {
              first: choice.first,
              last: choice.last,
              today: today(),
              // FIRMS refuses a longer range, so the input says so rather than
              // the map failing on a date that was already typed
              max: lastDayOf(choice.first),
              setFirst: (value) => set({ first: value }),
              setLast: (value) => set({ last: value }),
            }
          : null,
    },
  ];
}

/**
 * @param {{ source: string, day: string, follow?: boolean }} choice
 * @param {(patch: object) => void} set
 */
export function nightControls(choice, set, { follow = '', pictureDay = '' } = {}) {
  const composite = choice.source === COMPOSITE.id;
  const day = {
    label: 'Night of',
    title: 'Night of the pass, around 01:30 local time',
    value: choice.day,
    min: firstNight(choice.source),
    max: lastNight(),
    set: (value) => set({ day: value }),
  };
  const showing = {
    label: 'Showing',
    options: [
      ...SENSORS.map((sensor) => ({
        id: sensor.id,
        label: sensor.label,
        title: `${sensor.label} · one night, back to ${sensor.first}`,
      })),
      { id: COMPOSITE.id, label: COMPOSITE.label, title: 'Cloud-free composite of 2016' },
    ],
    value: choice.source,
    pick: (id) => set({ source: id }),
    day: composite || follow ? null : day,
  };
  if (!follow || composite) return [showing];
  return [
    showing,
    {
      label: 'Night',
      options: [
        { id: PICTURE, label: follow, title: 'The night of the day the picture was taken' },
        { id: 'day', label: 'Pick a night', title: 'One night of your choosing' },
      ],
      value: choice.follow ? PICTURE : 'day',
      pick: (id) =>
        set(
          id === PICTURE
            ? { follow: true }
            : { follow: false, day: (choice.follow && pictureDay) || choice.day || lastNight() }
        ),
      day: choice.follow ? null : day,
    },
  ];
}
