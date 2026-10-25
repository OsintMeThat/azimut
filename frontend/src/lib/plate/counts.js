/**
 * What a plate's `{count}` words count: the features a map shows in its frame on the
 * plate's day, all of them, those of one state (`destroyed`, `damaged`), or those of
 * one group, by its name as the legend says it.
 */
const STATES = new Set(['destroyed', 'damaged']);

/** How many of `features` answer `key`: every one for none, a state's, or a group's, the case of its name aside. */
export function countFeatures(features, key = '') {
  const asked = String(key ?? '').trim().toLowerCase();
  if (!asked) return features.length;
  if (STATES.has(asked)) return features.filter((feature) => feature.properties?.status === asked).length;
  return features.filter((feature) => String(feature.properties?.category ?? '').toLowerCase() === asked).length;
}
