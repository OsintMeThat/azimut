import { emptyFilter, normalizeFilter } from './entityFilter.js';

const CATEGORIES = new Set(['statement', 'media', 'case_activity']);
/**
 * The colours a track may be given, by name.
 *
 * A track is a question the analyst wrote, and on a busy axis its colour is how the
 * answer is read at a glance. Left unset the lane keeps the **category** colours —
 * statement, media, activity — which is what the legend explains; a chosen colour
 * says the analyst wants this reading told apart from the others instead, and it wins
 * for that track only. Names rather than hex so the palette stays the app's own
 * (`--anno-*`) and a saved view cannot carry an unreadable colour.
 */
export const TRACK_COLORS = ['red', 'blue', 'amber', 'green', 'magenta', 'orange'];

/** The colour as CSS, or nothing at all — an unset track must inherit the category
 *  colours rather than a grey stand-in. Ordered with the palette above. */
export function trackTint(color) {
  const index = TRACK_COLORS.indexOf(color);
  return index < 0 ? undefined : `var(--anno-${index + 1})`;
}
const RELATIONS = new Set(['any', 'owner', 'about', 'place', 'source']);
const ROLES = new Set(['occurred', 'observed', 'valid', 'unset']);

const unique = (values, allowed = null, limit = 500) => [
  ...new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => typeof value === 'string' && value && (!allowed || allowed.has(value)))
      .slice(0, limit)
  ),
];

export function timelineTrack(value, index = 0) {
  const raw = value && typeof value === 'object' ? value : {};
  const query = raw.query && typeof raw.query === 'object' ? raw.query : {};
  const categories = unique(raw.categories, CATEGORIES, 3);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : `track-${index + 1}`,
    label: typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim().slice(0, 80)
      : `Track ${index + 1}`,
    categories: categories.length ? categories : ['statement'],
    query: {
      filter: normalizeFilter(query.filter ?? emptyFilter()),
      terms: query.terms && typeof query.terms === 'object' ? query.terms : {},
      label: typeof query.label === 'string' ? query.label.slice(0, 300) : '',
      relation: RELATIONS.has(query.relation) ? query.relation : 'any',
      roles: unique(query.roles, ROLES, 4),
    },
    color: TRACK_COLORS.includes(raw.color) ? raw.color : '',
    collapsed: raw.collapsed === true,
    hidden: unique(raw.hidden),
    pinned: unique(raw.pinned),
  };
}

export function defaultTimelineTracks() {
  return [
    timelineTrack({ id: 'events', label: 'Events', categories: ['statement'] }),
    timelineTrack({ id: 'media', label: 'Media', categories: ['media'] }, 1),
  ];
}

export function normalizeTimelineTracks(value) {
  const raw = Array.isArray(value) ? value.slice(0, 20) : [];
  const tracks = raw.length ? raw.map(timelineTrack) : defaultTimelineTracks();
  const seen = new Set();
  return tracks.map((track, index) => {
    let id = track.id;
    while (seen.has(id)) id = `${track.id}-${index + 1}`;
    seen.add(id);
    return { ...track, id };
  });
}

export function trackPresets(types = []) {
  const ofType = (type, relation = 'about') => timelineTrack({
    id: `preset-${type}`,
    label: types.find((entry) => entry.type === type)?.label ?? type,
    categories: ['statement'],
    query: { relation, terms: { type }, filter: { ...emptyFilter(), types: [type] } },
  });
  return [
    timelineTrack({ id: 'preset-events', label: 'Events', categories: ['statement'] }),
    ofType('person'),
    ofType('place', 'place'),
    timelineTrack({ id: 'preset-media', label: 'Media', categories: ['media'] }),
    timelineTrack({
      id: 'preset-sources', label: 'Sources', categories: ['statement'],
      query: { relation: 'source' },
    }),
    timelineTrack({ id: 'preset-activity', label: 'Case activity', categories: ['case_activity'] }),
  ];
}

export function copyTimelineTrack(track, tracks) {
  const used = new Set(tracks.map((entry) => entry.label.toLocaleLowerCase()));
  const stem = `${track.label} copy`;
  let label = stem;
  let index = 2;
  while (used.has(label.toLocaleLowerCase())) label = `${stem} ${index++}`;
  return {
    ...timelineTrack(track),
    id: `track-${globalThis.crypto?.randomUUID?.() ?? Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    collapsed: false,
  };
}

export function moveTimelineTrack(tracks, from, to) {
  if (from === to || from < 0 || to < 0 || from >= tracks.length || to >= tracks.length) return tracks;
  const next = [...tracks];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function timelineTrackQuery(track) {
  return JSON.stringify({
    ...track.query,
    hidden: track.hidden,
  });
}

function groupKeys(item, groupBy, typeName) {
  if (groupBy === 'subject') {
    return item.subject_entities?.length
      ? item.subject_entities : [{ id: 'none', label: 'No subject' }];
  }
  if (groupBy === 'place') {
    return item.place_entities?.length
      ? item.place_entities : [{ id: 'none', label: 'No place' }];
  }
  if (groupBy === 'source') {
    return item.source_entities?.length
      ? item.source_entities : [{ id: 'none', label: 'No evidence' }];
  }
  if (groupBy === 'type') {
    const types = [...new Set((item.subject_entities ?? []).map((entry) => entry.type).filter(Boolean))];
    if (!types.length && item.owner_type) types.push(item.owner_type);
    if (!types.length) return [{ id: 'none', label: 'Unknown type' }];
    return types.map((type) => ({ id: type, label: typeName(type), type }));
  }
  if (groupBy === 'role') {
    const role = item.time_role || 'Not set';
    return [{ id: role, label: role }];
  }
  return [];
}

export function groupedTimelineTracks(tracks, itemSets, groupBy = 'none', typeName = (type) => type) {
  if (groupBy === 'none') return tracks.map((track) => ({ ...track, items: itemSets[track.id] ?? [] }));
  const result = [];
  for (const track of tracks) {
    const groups = new Map();
    for (const item of itemSets[track.id] ?? []) {
      for (const key of groupKeys(item, groupBy, typeName)) {
        const id = String(key.id || key.label || 'other');
        const group = groups.get(id) ?? { id, label: key.label || id, items: [] };
        group.items.push(item);
        groups.set(id, group);
      }
    }
    if (!groups.size) result.push({ ...track, items: [], groupLabel: 'No matches' });
    else for (const group of groups.values()) {
      result.push({
        ...track,
        id: `${track.id}:group:${group.id}`,
        parentId: track.id,
        label: group.label,
        groupLabel: track.label,
        items: group.items,
      });
    }
  }
  return result;
}

export function timelineViewState(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const tracks = normalizeTimelineTracks(raw.tracks);
  return {
    from: typeof raw.from === 'string' ? raw.from : '',
    to: typeof raw.to === 'string' ? raw.to : '',
    timezone: typeof raw.timezone === 'string' && raw.timezone
      ? raw.timezone.slice(0, 80) : 'UTC',
    // `zone:<IANA name>` is the fourth reading, for an investigation at the other end
    // of the world that the case has no saved point in yet. Validated by shape only:
    // whether this machine can load the name is asked when the axis is drawn, so a
    // view made where the zone exists does not lose it on a stricter box.
    zoneChoice: typeof raw.zone_choice === 'string'
      && /^(utc|machine|place:[^\s]{1,64}|zone:[A-Za-z0-9+\-_/]{1,64})$/.test(raw.zone_choice)
      ? raw.zone_choice : 'utc',
    viewMode: raw.view_mode === 'list' ? 'list' : 'plot',
    groupBy: ['subject', 'type', 'place', 'source', 'role'].includes(raw.group_by)
      ? raw.group_by : 'none',
    tracks,
    categories: unique(tracks.flatMap((track) => track.categories), CATEGORIES, 3),
    entity: raw.entity?.id ? { id: raw.entity.id, label: raw.entity.label || raw.entity.id } : null,
  };
}
