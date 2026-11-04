/**
 * Whether a plate plays its layers hour by hour or day by day.
 *
 * Layers dated to the minute change at moments (`2026-11-02T14:30`). A plate plays
 * them day by day unless it is told otherwise (`time.hours`): each day is one beat,
 * and it shows its layers as the day ends, every change of the day in. Hour by hour,
 * each moment is a beat of its own, with its own steps, seconds and framing.
 *
 * Switching keeps the work. Day by day, the steps made on an hour are played after
 * the day's own, in the order of their hours, each remembering its hour (`hour`) to
 * go back to it; the seconds and framings kept under an hour wait there unused.
 */
import { PAGE, MAX_STEPS } from './page.js';
import { playDays } from './clip.js';

/** Whether a key of the plate (a moment, a day, or the page) carries a time of day. */
export const timed = (key) => typeof key === 'string' && key.length > 10 && key !== PAGE;

/** The day of a moment; a day, or the page, as it is. */
export const dayPart = (key) => (timed(key) ? key.slice(0, 10) : key);

/** Whether any moment carries a time of day: only then does a plate have the choice. */
export const hasHours = (moments) => (moments ?? []).some(timed);

/** Whether the plate keeps something under an hour: steps, held seconds, a framing, a day played or skipped. */
export function keptByHour(spec) {
  return Object.entries(spec?.steps ?? {}).some(([key, list]) => timed(key) && list?.length)
    || Object.keys(spec?.holds ?? {}).some(timed) || Object.keys(spec?.framing ?? {}).some(timed)
    || (spec?.days ?? []).some(timed) || (spec?.skipped ?? []).some(timed);
}

/** Whether the plate plays hour by hour: as it was told, else as its work was kept, made before the choice. */
export const byHour = (spec) => spec?.time?.hours ?? keptByHour(spec);

/** The moments a plate's layers change at, as it plays them: each one hour by hour, each day once day by day. */
export const momentsAs = (moments, hours) => (hours ? moments : [...new Set(moments.map(dayPart))]);

/**
 * The days a played plate goes through (`clip.playDays`), as it plays them. Day by
 * day, a moment played hour by hour is no day of its own.
 */
export function daysPlayed(spec, moments, hours) {
  if (hours) return playDays(spec, moments);
  return playDays({ ...spec, days: (spec?.days ?? []).filter((day) => !timed(day)), steps: Object.fromEntries(
    Object.entries(spec?.steps ?? {}).filter(([day]) => !timed(day))) }, moments);
}

const daily = new WeakMap();

/**
 * A layer as a plate played day by day reads it: the states a feature takes on one
 * day as the last of them, dated to the day, so the day shows how it ended; a plain
 * feature's first and last days without their time. The collection itself when
 * nothing in it carries a time, and always the same reading of one collection.
 */
export function byDay(collection) {
  if (!collection || typeof collection !== 'object') return collection;
  const known = daily.get(collection);
  if (known) return known;
  let changed = false;
  const features = (collection.features ?? []).map((feature) => {
    const properties = feature?.properties ?? {};
    if (Array.isArray(properties.states) && properties.states.length) {
      if (!properties.states.some((state) => timed(state.at))) return feature;
      const states = [];
      for (const state of properties.states) {
        const day = dayPart(String(state.at ?? ''));
        if (states.at(-1)?.at === day) states[states.length - 1] = { ...state, at: day };
        else states.push({ ...state, at: day });
      }
      changed = true;
      return { ...feature, properties: { ...properties, states } };
    }
    if (!timed(properties.date) && !timed(properties.date_end)) return feature;
    changed = true;
    return { ...feature, properties: { ...properties,
      ...(timed(properties.date) ? { date: dayPart(properties.date) } : {}),
      ...(timed(properties.date_end) ? { date_end: dayPart(properties.date_end) } : {}) } };
  });
  const out = changed ? { ...collection, features } : collection;
  daily.set(collection, out);
  return out;
}

/**
 * The plate switched to hour by hour (`on`) or to day by day, as the fields that change,
 * or `{ full }` naming the day that would hold more steps than a day can.
 *
 * Day by day, each hour's steps follow the day's own in the order of the hours, each
 * keeping its hour. Hour by hour, they go back to it, and the plate stands on the hour
 * of the step it shows, else on the last moment of its day it played (`played`, the
 * days it plays hour by hour), the closest to the end of the day it showed.
 */
export function withHours(spec, on, played = []) {
  const steps = {};
  const keys = Object.keys(spec?.steps ?? {}).sort();
  for (const key of keys) {
    for (const step of spec.steps[key]) {
      if (on) {
        const { hour, ...rest } = step;
        const to = hour && !timed(key) && key !== PAGE ? `${key}T${hour}` : key;
        (steps[to] ??= []).push(rest);
      } else {
        (steps[dayPart(key)] ??= []).push(timed(key) ? { ...step, hour: key.slice(11) } : step);
      }
    }
  }
  const full = Object.keys(steps).find((key) => steps[key].length > MAX_STEPS);
  if (full) return { full };
  const at = spec?.time?.at ?? null;
  let next = at;
  if (!on) next = dayPart(at);
  else if (at && !timed(at) && at !== PAGE) {
    const shown = spec.time?.step ? Object.keys(steps).find((key) => steps[key].some((step) => step.id === spec.time.step)) : null;
    next = shown ?? played.filter((key) => dayPart(key) === at && timed(key)).at(-1) ?? at;
  }
  return { steps, time: { ...(spec?.time ?? {}), hours: on, at: next } };
}
