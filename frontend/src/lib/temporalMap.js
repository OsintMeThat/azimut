/** Pure helpers for the session-only Timeline layer on the map. */

export function temporalMapQuery(caseId, from, to, categories = []) {
  const params = new URLSearchParams({ from, to });
  // The layer answers the categories the Timeline was reading, so a window of
  // photographs does not arrive at the map as an empty one.
  for (const category of categories) params.append('category', category);
  return `/api/cases/${caseId}/timeline/map?${params}`;
}

export function groupTemporalMapItems(items) {
  const groups = new Map();
  for (const item of items ?? []) {
    for (const place of item.place_entities ?? []) {
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
      const key = place.id || `${place.lat}:${place.lon}`;
      const group = groups.get(key) ?? { ...place, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}
