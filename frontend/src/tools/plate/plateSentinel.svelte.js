/**
 * Satellite's Sentinel-2 choices (`satellite/state/sentinel.svelte.js`) for the one map
 * of a plate whose pass is picked: the map picked alone. Its layer, its cloud ceiling and
 * its pass are read from that map when it is picked, and written into it as they are set.
 *
 * The plate keeps one of these, so the inspector's Ground section and the map's bar show
 * the same calendar: neither undoes what the other picked, and no month's passes are
 * asked for twice.
 *
 * The newest pass under the ceiling is looked for only for a map on Sentinel-2 with no
 * pass yet, picked alone or just set on it, or set back to "Most recent": a request or two
 * of the analyst's Copernicus quota, which choosing that ground asks for. A map already on
 * a pass is read as it is, and nothing is asked before a map is picked.
 *
 * Called while a component is set up: its effects live as long as that component.
 *
 * @param {object} deps
 * @param {() => object|null} deps.target the map picked alone, or null
 * @param {(map: object) => {lat: number, lon: number}} deps.place where that map looks
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {object} deps.api the app's fetch wrapper
 */
import { untrack } from 'svelte';
import { DEFAULT_LAYER } from '../../lib/sentinel.js';
import { PLATE_MAXCC, SENTINEL_ID } from '../../lib/plate/sentinelPass.js';
import { createSentinelState } from '../satellite/state/sentinel.svelte.js';

export function createPlateSentinel({ target, place, notify, api }) {
  // where the last map picked looked: a getter read after it is let go still has a place
  let last = { lat: 0, lon: 0 };
  const s2 = createSentinelState({
    place: () => {
      const map = target();
      if (map?.view) last = place(map);
      return last;
    },
    onBilled: () => {},
    notify,
    api,
  });
  /** The map the choices were last read from, by id: '' until one on Sentinel-2 is picked. */
  let bound = $state('');

  // a map on Sentinel-2 picked: the choices read from it, its pass pinned as the day it holds
  $effect(() => {
    const map = target();
    if (map?.basemap !== SENTINEL_ID || untrack(() => bound) === map.id) return;
    bound = map.id;
    untrack(() => {
      s2.layer = map.product || DEFAULT_LAYER;
      s2.setMaxcc(map.maxcc ?? PLATE_MAXCC);
      s2.date = map.acquired ?? '';
    });
  });
  // "Most recent", or a map set on Sentinel-2 with no pass yet: the newest pass under the ceiling is looked for
  $effect(() => {
    const map = target();
    const [date, maxcc] = [s2.date, s2.maxcc];
    if (map?.basemap !== SENTINEL_ID || bound !== map.id || date) return;
    void maxcc;
    untrack(() => s2.resolveLatest());
  });
  // a map on another ground, or none: the next one picked on Sentinel-2 is read again
  $effect(() => { if (target()?.basemap !== SENTINEL_ID) bound = ''; });
  // what is picked on the calendar is the map's: one day, its layer, its ceiling; the newest pass
  // only once it is known for this map, never the one found for the map picked before it
  $effect(() => {
    const map = target();
    const [day, layer, maxcc, known] = [s2.day, s2.layer, s2.maxcc, s2.resolved];
    if (map?.basemap !== SENTINEL_ID || bound !== map.id) return;
    untrack(() => {
      if (day && known && map.acquired !== day) map.acquired = day;
      const product = layer === DEFAULT_LAYER ? '' : layer;
      if ((map.product ?? '') !== product) map.product = product;
      if ((map.maxcc ?? null) !== maxcc) map.maxcc = maxcc;
    });
  });

  return {
    s2,
    /** The id of the map the choices are read from and written to, '' when none is. */
    get map() { return bound; },
  };
}
