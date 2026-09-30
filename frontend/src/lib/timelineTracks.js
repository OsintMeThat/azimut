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
/** The files a file lane draws: the sources' pictures and videos, or the imagery the
 *  app pictured from above (satellite, map screenshots, Compare, Detect). */
const FILE_LANES = new Set(['sources', 'imagery']);
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
      // The Media Library's working-files switch: frames, captures, collages and
      // renders the case made itself stay off the track. Absent reads as off, which
      // is what every track saved before it meant.
      ...(query.collected_only === true ? { collected_only: true } : {}),
      // A lane that draws each of its events as the file it dates (`fileLane`).
      ...(FILE_LANES.has(query.as_files) ? { as_files: query.as_files } : {}),
    },
    color: TRACK_COLORS.includes(raw.color) ? raw.color : '',
    collapsed: raw.collapsed === true,
    hidden: unique(raw.hidden),
    pinned: unique(raw.pinned),
  };
}

/** The kinds of file an event can put at its date. */
const SITUATED = ['media', 'capture'];

/**
 * The Media lane: the sources' pictures and videos where the analyst dated them, and
 * nowhere else.
 *
 * A file's date is the one an analyst gives it: the date typed on a proof (stated for
 * the footage it rests on), a correction, an event about the file or citing it ("seen
 * in" a video). Each of those is a Claim, so the lane holds the Claims tied to a file
 * and draws each one as that file, with its name and its picture. What a file says
 * about itself (the post's date, the camera's clock) is a clue and not a finding: it
 * stays on the File dates track, added on purpose, and one press away when an event is
 * added from the file. What the app pictured from above is not a source's footage, so
 * it has a lane of its own (`imageryLane`).
 */
export function mediaLane() {
  return timelineTrack({
    id: 'files', label: 'Media', categories: ['statement'], query: { as_files: 'sources' },
  });
}

/** The Imagery lane: satellite captures, map screenshots, Compare renders and the
 *  pictures Detect keeps, where an event dates them. Added from the track list. */
export function imageryLane() {
  return timelineTrack({
    id: 'imagery', label: 'Imagery', categories: ['statement'], query: { as_files: 'imagery' },
  });
}

/** Whether a track draws its events as the files they date. */
export function drawsFiles(track) {
  return FILE_LANES.has(track?.query?.as_files);
}

/**
 * The file an event puts at its date: the one the server named (`file`, with its
 * preview), or else the first file it is about, then the first it cites.
 */
export function situatedFile(item) {
  if (item?.file?.id) return item.file;
  for (const key of ['subject_entities', 'source_entities']) {
    const entry = (item?.[key] ?? []).find((entity) => SITUATED.includes(entity?.type));
    if (entry) return { id: entry.id, label: entry.label, type: entry.type };
  }
  return null;
}

/**
 * What a fresh reading opens on: the files where the analyst dated them, over the
 * events. A saved view keeps the tracks it was saved with.
 */
export function defaultTimelineTracks() {
  return [
    mediaLane(),
    timelineTrack({ id: 'events', label: 'Events', categories: ['statement'] }),
  ];
}

/** The File dates preset. `collectedOnly` holds back the working files. */
export function mediaTrack(tracks = [], { collectedOnly = true } = {}) {
  const used = new Set(tracks.map((track) => track.id));
  let id = 'media';
  for (let n = 2; used.has(id); n += 1) id = `media-${n}`;
  return timelineTrack({
    id, label: 'File dates', categories: ['media'],
    query: collectedOnly ? { collected_only: true } : {},
  });
}

/** Whether a track leaves the case's working files out. */
export function holdsBackWorkingFiles(track) {
  return track?.categories?.includes('media') && track.query?.collected_only === true;
}

/** The same track with its working files let in. */
export function withWorkingFiles(track) {
  const { collected_only: _held, ...query } = track.query ?? {};
  return { ...track, query };
}

export function normalizeTimelineTracks(value) {
  const raw = Array.isArray(value) ? value.slice(0, 20) : [];
  const tracks = raw.length ? raw.map(timelineTrack) : defaultTimelineTracks();
  const seen = new Set();
  return tracks.map((track, index) => {
    // The suffix counts up. A fixed one is loop-invariant, so a saved view whose
    // ids already hold the deduped spelling (['t-3', 't', 't']) spun here
    // forever and froze the tab.
    let id = track.id;
    for (let n = index + 1; seen.has(id); n += 1) id = `${track.id}-${n}`;
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
    { ...mediaLane(), id: 'preset-files' },
    { ...imageryLane(), id: 'preset-imagery' },
    ofType('person'),
    ofType('place', 'place'),
    timelineTrack({
      id: 'preset-media', label: 'File dates', categories: ['media'], query: { collected_only: true },
    }),
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
    // view made where the zone exists does not lose it on a stricter box. `case` is
    // the zone the case's places stand in, found again wherever the view is opened.
    // A view saved before there was a choice read UTC, and still does.
    zoneChoice: typeof raw.zone_choice === 'string'
      && /^(utc|case|machine|place:[^\s]{1,64}|zone:[A-Za-z0-9+\-_/]{1,64})$/.test(raw.zone_choice)
      ? raw.zone_choice : 'utc',
    viewMode: raw.view_mode === 'list' ? 'list' : 'plot',
    groupBy: ['subject', 'type', 'place', 'source', 'role'].includes(raw.group_by)
      ? raw.group_by : 'none',
    tracks,
    categories: unique(tracks.flatMap((track) => track.categories), CATEGORIES, 3),
    entity: raw.entity?.id ? { id: raw.entity.id, label: raw.entity.label || raw.entity.id } : null,
  };
}
