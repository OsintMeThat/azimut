/**
 * The Board's groups: the case read as who, what and where, with its material below.
 *
 * The Board used to open on one table of everything the case holds, and a case is
 * mostly files: frames, captures, Detect runs, Inspect work. The people, places and
 * things an investigation is about sat somewhere in that list. So the rows are
 * **grouped by family rather than hidden**: the groups an investigation is about open
 * first, the material folds underneath with a way to the tool that reads it, and
 * nothing leaves the answer. The question stays the one question Board and Graph
 * share, so a count, a total or a drawing never depends on which groups are open.
 *
 * Pure: the family of a type comes in as a resolver, so none of this waits on the
 * served registry to be testable.
 */

/** The groups, in reading order. `subject` groups open by default; `material` ones
 *  fold, unless the case holds no subject at all. */
export const BOARD_GROUPS = [
  { id: 'actor', label: 'People & organizations', families: ['actor'], kind: 'subject' },
  { id: 'identifier', label: 'Accounts & identifiers', families: ['identifier'], kind: 'subject' },
  { id: 'place', label: 'Places', families: ['place'], kind: 'subject' },
  { id: 'asset', label: 'Things', families: ['asset'], kind: 'subject' },
  { id: 'class', label: 'Equipment types', families: ['class'], kind: 'subject' },
  {
    id: 'claim',
    label: 'Events',
    families: ['claim'],
    kind: 'material',
    reads: { tool: 'timeline', label: 'Timeline' },
  },
  {
    id: 'collected',
    label: 'Files',
    families: ['collected'],
    kind: 'material',
    reads: { tool: 'media', label: 'Media Library' },
  },
  { id: 'document', label: 'Work', families: ['document'], kind: 'material' },
  // A free type the registry has never heard of has no family, and still belongs
  // somewhere: an answer that loses a row because its type is unknown is short.
  { id: 'other', label: 'Other', families: [null], kind: 'material' },
];

const BY_ID = new Map(BOARD_GROUPS.map((group) => [group.id, group]));

/** A group by id, or null. */
export function boardGroup(id) {
  return BY_ID.get(id) ?? null;
}

/** Which group a type falls in, from its family. */
export function groupOfType(type, familyOf) {
  const family = familyOf(type) ?? null;
  return BOARD_GROUPS.find((group) => group.families.includes(family)) ?? boardGroup('other');
}

/** The types of one group among the ones the case holds (`summary.by_type`). */
export function typesOfGroup(group, caseTypes, familyOf) {
  return caseTypes.filter((type) => groupOfType(type, familyOf).id === group.id).sort();
}

/**
 * The types a group's own page asks for: its types, narrowed by the ones the question
 * already picked. Empty means the group cannot hold an answer, so it sends nothing.
 */
export function groupRequestTypes(group, caseTypes, wantedTypes, familyOf) {
  const own = typesOfGroup(group, caseTypes, familyOf);
  if (!wantedTypes?.length) return own;
  return own.filter((type) => wantedTypes.includes(type));
}

/** How many of the answer each group holds, from a per-type count. */
export function groupCounts(byType, familyOf) {
  const counts = Object.fromEntries(BOARD_GROUPS.map((group) => [group.id, 0]));
  for (const [type, n] of Object.entries(byType ?? {})) {
    counts[groupOfType(type, familyOf).id] += Number(n) || 0;
  }
  return counts;
}

/** Whether the case holds anything an investigation is about. */
export function holdsSubjects(byType, familyOf) {
  const counts = groupCounts(byType, familyOf);
  return BOARD_GROUPS.some((group) => group.kind === 'subject' && counts[group.id] > 0);
}

/**
 * Whether a group shows its rows.
 *
 * The analyst's own fold wins. Without one, a subject group opens and a material
 * group folds, except in a case that holds no subject yet, where folding the material
 * would leave nothing on screen. Under a question the groups holding an answer open,
 * because a count of matches folded away is an answer nobody can read; a fold made
 * during that question still holds (`asked`, cleared when the question changes).
 */
export function groupOpen(group, { folds = {}, asked = {}, filtering = false, subjects = true }) {
  if (filtering) return asked[group.id] ?? true;
  if (group.id in folds) return folds[group.id];
  return group.kind === 'subject' || !subjects;
}

// ── the layout, kept per case on this machine ─────────────────────────────────
/**
 * How this analyst lays the Board out for a case: grouped or flat, the sort, and
 * which groups they folded. The same standing as the remembered question
 * (`lib/entityFilter.js`): how somebody looks at their material, not something the
 * case holds, so it stays in this browser and out of the settings backup.
 */
const LAYOUT_KEY = 'azimut:board-layout';

export const GROUPINGS = [
  { id: 'kind', label: 'By kind', hint: 'People, places and things first, the files below' },
  { id: 'none', label: 'None', hint: 'One table of everything, the way 0.3.1 showed it' },
];

/** The orders a grouped Board offers, each over the whole case. */
export const GROUP_SORTS = [
  { id: '-events', label: 'Most noted', hint: 'the subjects most events name first, the files newest first' },
  { id: 'label', label: 'Name', hint: 'alphabetical' },
  { id: '-created', label: 'Recently added', hint: 'newest filed first' },
];

export function defaultLayout() {
  return { group: 'kind', sort: '-events', folds: {} };
}

/** A stored layout, reshaped so an old or hand-edited value cannot break the Board. */
export function normalizeLayout(raw) {
  const base = defaultLayout();
  if (!raw || typeof raw !== 'object') return base;
  const group = GROUPINGS.some((entry) => entry.id === raw.group) ? raw.group : base.group;
  const sort = GROUP_SORTS.some((entry) => entry.id === raw.sort) ? raw.sort : base.sort;
  const folds = {};
  for (const [id, open] of Object.entries(raw.folds ?? {})) {
    if (BY_ID.has(id) && typeof open === 'boolean') folds[id] = open;
  }
  return { group, sort, folds };
}

export function loadLayout(caseId, storage = globalThis.localStorage) {
  if (!caseId) return defaultLayout();
  try {
    return normalizeLayout(JSON.parse(storage?.getItem(`${LAYOUT_KEY}:${caseId}`) ?? 'null'));
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(caseId, layout, storage = globalThis.localStorage) {
  if (!caseId) return;
  try {
    storage?.setItem(`${LAYOUT_KEY}:${caseId}`, JSON.stringify(normalizeLayout(layout)));
  } catch {
    /* a private window without storage keeps the layout for the session */
  }
}

/**
 * What a saved Board view says about the layout. A view saved before the groups
 * existed has no `group`, and it opens flat: a saved reading reads the way it did.
 */
export function viewLayout(board) {
  const group = board?.group === 'kind' ? 'kind' : 'none';
  const sort = GROUP_SORTS.some((entry) => entry.id === board?.groupSort)
    ? board.groupSort
    : defaultLayout().sort;
  return { group, sort };
}

// ── what a row says about its events ──────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The span a row's dated events cover, short enough for a table cell.
 *
 * `last` is the half-open end the store keeps, so a day-precision event ending at
 * the next midnight reads as the day it is, not as the day after it. UTC, like the
 * Board's fact-time chip.
 */
export function spanWords(first, last) {
  if (!first || !last) return '';
  const start = new Date(first);
  const end = new Date(Math.max(new Date(last).getTime() - 1, start.getTime()));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  const day = (at) => `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth && start.getUTCDate() === end.getUTCDate()) {
    return `${day(start)} ${start.getUTCFullYear()}`;
  }
  if (sameMonth) {
    return `${start.getUTCDate()}–${day(end)} ${end.getUTCFullYear()}`;
  }
  if (sameYear) return `${day(start)} – ${day(end)} ${end.getUTCFullYear()}`;
  const month = (at) => `${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
  return `${month(start)} – ${month(end)}`;
}

/** "1 event", "12 events": the count a row reads by. */
export function eventWords(n) {
  return `${n} event${n === 1 ? '' : 's'}`;
}

/** The questions the Board shows as waiting, priced from the summary. Only the ones
 *  with something to answer: a zero is not waiting. */
export const WAITING = [
  { id: 'review', read: (summary) => summary?.by_status?.suggested ?? 0, words: () => 'to review' },
  { id: 'loose', read: (summary) => summary?.unlinked ?? 0, words: () => 'linked to nothing' },
  {
    id: 'unsourced',
    read: (summary) => summary?.lacks?.source ?? 0,
    words: (n) => `${n === 1 ? 'event' : 'events'} without a source`,
  },
  {
    id: 'unassessed',
    read: (summary) => summary?.lacks?.assessment ?? 0,
    words: (n) => `${n === 1 ? 'event' : 'events'} not assessed`,
  },
];

export function waitingOf(summary) {
  return WAITING.map((entry) => {
    const count = entry.read(summary);
    return { id: entry.id, count, words: entry.words(count) };
  }).filter((entry) => entry.count > 0);
}
