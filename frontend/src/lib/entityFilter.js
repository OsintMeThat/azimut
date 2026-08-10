/**
 * The question the Board is asking of the case, as a value.
 *
 * A filter used to be six `$state` variables and six selects, each appearing and
 * disappearing as the others were set. That shape had two faults and they were the
 * same fault twice: a term that was set looked exactly like a term that was not, and
 * a control that vanished took its own way back with it. So the question is one
 * object here, every term is a **chip** on screen, and the bar itself never changes
 * shape — what changes is the sentence written across it.
 *
 * Nothing in this file touches the network, the registry or Svelte. It turns a
 * question into request parameters and into the words that describe it, which is
 * exactly what can be tested without a browser.
 *
 * **Every term is chosen, never typed** (SPEC anti-goals): the menus behind these
 * keys are built from what the case holds. The one free-text term is `q`, and it is
 * the search box rather than a term of the sentence.
 */

/**
 * The axes, in the order the "+ Filter" menu offers them.
 *
 * `kind` is what the menu has to draw, not what the server does with it:
 * - `picks` — several values at once, since *accounts and people* is one question
 * - `pick` — one value
 * - `folder` — one path, plus "unfiled" and "include subfolders", which are the two
 *   halves the catalog already spells apart
 * - `field` — a stored field **and** one of its values: two steps, one term
 * - `toggle` — no value to choose, so picking it from the menu is the whole act
 */
export const AXES = [
  {
    key: 'field',
    label: 'Field',
    kind: 'field',
    hint: 'a value the case stored, such as kind = video',
  },
  { key: 'type', label: 'Type', kind: 'picks', hint: 'exactly what the case calls it' },
  { key: 'family', label: 'Family', kind: 'picks', hint: 'the broad reading: who, what, where' },
  { key: 'folder', label: 'Folder', kind: 'folder', hint: 'one of your own buckets' },
  { key: 'status', label: 'Status', kind: 'pick', hint: 'confirmed, or proposed by a tool' },
  { key: 'linked', label: 'Linked to', kind: 'pick', hint: 'it touches something of this type' },
  {
    key: 'connections',
    label: 'Nothing linked',
    kind: 'toggle',
    hint: 'filed, and joined to nothing at all',
  },
  { key: 'added', label: 'Added', kind: 'added', hint: 'when it was filed into the case' },
  { key: 'by', label: 'Filed by', kind: 'picks', hint: 'which tool filed it, or by hand' },
];

/** How recently a row was filed, as the menu offers it. Relative on purpose: a
 *  preset re-resolves against today on every request, where a date typed by hand is
 *  an absolute range and stays where it was put. */
export const ADDED = [
  { value: 'today', label: 'Today', days: 0 },
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
];

/** The two review states, worded as the rest of the app words them. */
export const STATUSES = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'suggested', label: 'Suggested' },
];

/**
 * The questions the menu opens on, before any axis is picked.
 *
 * Not a saved search and deliberately not stored: these are the four questions
 * every case is asked, so they are code rather than state the analyst has to build
 * and the backup has to carry. Picking one drops its terms into the bar as ordinary
 * chips, which is also how the filter language gets taught — the answer arrives and
 * the sentence that produced it is sitting there to be edited.
 */
export const QUESTIONS = [
  {
    id: 'review',
    label: 'To review',
    hint: 'a tool proposed it and nobody has confirmed it',
    terms: { status: 'suggested' },
  },
  {
    id: 'loose',
    label: 'Nothing linked yet',
    hint: 'in the case, connected to nothing — the unexploited material',
    terms: { connections: 'none' },
  },
  {
    id: 'week',
    label: 'Added this week',
    hint: 'filed in the last seven days',
    terms: { added: '7d' },
  },
  {
    id: 'unfiled',
    label: 'Unfiled',
    hint: 'in none of your folders',
    terms: { unfiled: true },
  },
];

/** A question with no term set. Every field is present, so nothing downstream has to
 *  tell an absent key from an empty one. */
export function emptyFilter() {
  return {
    q: '',
    families: [],
    types: [],
    status: '',
    folder: '',
    unfiled: false,
    recursive: false,
    attrKey: '',
    attrValue: '',
    linked: '',
    connections: '', // '' | 'none'
    added: '', // one of ADDED, or '' when since/until say it in dates
    since: '',
    until: '',
    by: [],
  };
}

/** Bring a remembered or imported question back inside the current vocabulary.
 * Unknown keys are dropped and every value gets the shape the request builders
 * expect, so a view file made by another version cannot break either surface. */
export function normalizeFilter(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const strings = (items) =>
    Array.isArray(items)
      ? [...new Set(items.filter((item) => typeof item === 'string').map((item) => item.slice(0, 300)))]
      : [];
  const text = (item, limit = 1000) =>
    typeof item === 'string' ? item.slice(0, limit) : '';
  return {
    q: text(raw.q),
    families: strings(raw.families),
    types: strings(raw.types),
    status: ['confirmed', 'suggested'].includes(raw.status) ? raw.status : '',
    folder: text(raw.folder, 300),
    unfiled: raw.unfiled === true,
    recursive: raw.recursive === true,
    attrKey: text(raw.attrKey, 64),
    attrValue: text(raw.attrValue),
    linked: text(raw.linked, 40),
    connections: raw.connections === 'none' ? 'none' : '',
    added: ADDED.some((entry) => entry.value === raw.added) ? raw.added : '',
    since: text(raw.since, 10),
    until: text(raw.until, 10),
    by: strings(raw.by),
  };
}

/** Whether anything at all is being asked. What decides the count beside the search
 *  and whether "Clear all" is offered. */
export function isFiltering(filter) {
  return activeAxes(filter).length > 0 || Boolean(filter.q.trim());
}

/** Which axes carry a term right now, in AXES order. */
export function activeAxes(filter) {
  return AXES.filter((axis) => hasTerm(filter, axis.key)).map((axis) => axis.key);
}

/** Whether one axis is set. The field axis is only half an act until its value is
 *  chosen, and a folder axis is set by "unfiled" as much as by a path. */
export function hasTerm(filter, axis) {
  switch (axis) {
    case 'family':
      return filter.families.length > 0;
    case 'type':
      return filter.types.length > 0;
    case 'folder':
      return filter.unfiled || Boolean(filter.folder);
    case 'status':
      return Boolean(filter.status);
    case 'field':
      return Boolean(filter.attrKey);
    case 'linked':
      return Boolean(filter.linked);
    case 'connections':
      return filter.connections === 'none';
    case 'added':
      return Boolean(filter.added || filter.since || filter.until);
    case 'by':
      return filter.by.length > 0;
    default:
      return false;
  }
}

/** Drop one axis, leaving the rest of the question alone. What a chip's `×` does. */
export function clearAxis(filter, axis) {
  switch (axis) {
    case 'family':
      return { ...filter, families: [] };
    case 'type':
      return { ...filter, types: [] };
    case 'folder':
      return { ...filter, folder: '', unfiled: false, recursive: false };
    case 'status':
      return { ...filter, status: '' };
    // The value goes with the field: half a term is not a shorter question, it is
    // the analyst having picked what they were about to ask about.
    case 'field':
      return { ...filter, attrKey: '', attrValue: '' };
    case 'linked':
      return { ...filter, linked: '' };
    case 'connections':
      return { ...filter, connections: '' };
    case 'added':
      return { ...filter, added: '', since: '', until: '' };
    case 'by':
      return { ...filter, by: [] };
    default:
      return filter;
  }
}

/** Ask one of the standing questions, over whatever is already set. */
export function askQuestion(filter, id) {
  const question = QUESTIONS.find((entry) => entry.id === id);
  return question ? { ...filter, ...question.terms } : filter;
}

/** Add or drop one value of a multi-value axis. */
export function toggleValue(list, value) {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** The date a relative range starts on, as the `YYYY-MM-DD` the catalog compares
 *  against. ISO-8601 sorts lexicographically, so a bare date is a real bound. */
export function sinceFor(added, now = Date.now()) {
  const range = ADDED.find((entry) => entry.value === added);
  if (!range) return '';
  const at = new Date(now);
  at.setDate(at.getDate() - range.days);
  return at.toISOString().slice(0, 10);
}

/**
 * The question as catalog request parameters.
 *
 * `types` is handed in rather than resolved here: the family layer is server
 * vocabulary and the registry lives in a Svelte module, so the caller resolves
 * families to types exactly as it always has and this stays pure.
 *
 * A field with no value chosen is **not sent**, which is the invariant the catalog
 * route states in its own docstring: asked as a term it would empty the table between
 * two clicks of one act.
 */
export function toQuery(filter, { types = [], now = Date.now() } = {}) {
  const relative = filter.added ? sinceFor(filter.added, now) : '';
  return {
    types,
    status: filter.status || undefined,
    query: filter.q.trim() || undefined,
    folder: filter.unfiled ? undefined : filter.folder || undefined,
    unfiled: filter.unfiled || undefined,
    recursive: (!filter.unfiled && filter.recursive) || undefined,
    attr: filter.attrKey || undefined,
    value: filter.attrKey && filter.attrValue ? filter.attrValue : undefined,
    linked: filter.linked || undefined,
    unlinked: filter.connections === 'none' || undefined,
    since: relative || filter.since || undefined,
    until: (!filter.added && filter.until) || undefined,
    by: filter.by.length ? filter.by : undefined,
  };
}

/**
 * The same question, spelled the way the graph route asks for it.
 *
 * Two endpoints answer this filter and they name three of its terms differently — a
 * type set, a text term, and every flag as a string. One function knows both
 * spellings, so handing a question from the table to the drawing cannot quietly drop
 * a term on the way: what the drawing holds is what the table counted.
 */
export function toGraphQuery(filter, { types = [], now = Date.now() } = {}) {
  const asked = toQuery(filter, { types, now });
  const params = {};
  if (asked.types?.length) params.type = asked.types.join(',');
  if (asked.status) params.status = asked.status;
  if (asked.query) params.q = asked.query;
  if (asked.folder) params.folder = asked.folder;
  if (asked.unfiled) params.unfiled = 'true';
  if (asked.recursive) params.recursive = 'true';
  if (asked.attr && asked.value) {
    params.attr = asked.attr;
    params.value = asked.value;
  }
  if (asked.linked) params.linked = asked.linked;
  if (asked.unlinked) params.unlinked = 'true';
  if (asked.since) params.since = asked.since;
  if (asked.until) params.until = asked.until;
  if (asked.by?.length) params.by = asked.by.join(',');
  return params;
}

/**
 * The question in words, one chip per term.
 *
 * `names` translates the case's own slugs — a type, a family, a filer — into what
 * the registry calls them. It defaults to the slug, so a free type the vocabulary has
 * never heard of still reads as itself rather than as nothing.
 */
export function chipsOf(filter, names = {}) {
  const typeName = names.type ?? ((value) => value);
  const familyName = names.family ?? ((value) => value);
  const chips = [];
  if (filter.families.length) {
    chips.push({ axis: 'family', text: `Family: ${filter.families.map(familyName).join(', ')}` });
  }
  if (filter.types.length) {
    chips.push({ axis: 'type', text: `Type: ${filter.types.map(typeName).join(', ')}` });
  }
  if (filter.unfiled) {
    chips.push({ axis: 'folder', text: 'Unfiled' });
  } else if (filter.folder) {
    const reach = filter.recursive ? ' and under' : '';
    chips.push({ axis: 'folder', text: `Folder: ${filter.folder}${reach}` });
  }
  if (filter.status) {
    const status = STATUSES.find((entry) => entry.value === filter.status);
    chips.push({ axis: 'status', text: `Status: ${status?.label ?? filter.status}` });
  }
  if (filter.attrKey) {
    // A field with no value yet is a term still being built, and it says so rather
    // than reading as a filter that matches everything.
    const value = filter.attrValue ? ` = ${filter.attrValue}` : ' — pick a value';
    chips.push({ axis: 'field', text: `${filter.attrKey}${value}` });
  }
  if (filter.linked) {
    chips.push({ axis: 'linked', text: `Linked to a ${typeName(filter.linked).toLowerCase()}` });
  }
  if (filter.connections === 'none') {
    chips.push({ axis: 'connections', text: 'Nothing linked' });
  }
  if (filter.added) {
    const range = ADDED.find((entry) => entry.value === filter.added);
    chips.push({ axis: 'added', text: `Added: ${(range?.label ?? filter.added).toLowerCase()}` });
  } else if (filter.since || filter.until) {
    chips.push({ axis: 'added', text: `Added: ${filter.since || '…'} → ${filter.until || '…'}` });
  }
  if (filter.by.length) {
    chips.push({ axis: 'by', text: `Filed by: ${filter.by.join(', ')}` });
  }
  return chips;
}

/**
 * How the whole filtered set is sorted, and which of those the server can do.
 *
 * Two of the table's headings name a column the store can order the **case** by;
 * the rest are sorted over the rows already loaded. That difference is the whole
 * reason this table is worth anything on a large case — "newest first" over a
 * hundred of eight hundred rows is not the newest of anything — so the two are told
 * apart here rather than being one gesture that quietly means two things.
 */
export const SERVER_SORTS = { label: 'label', created: 'created' };

/** The `order` parameter for a heading and a direction, or '' for the case's own
 *  cursor order. */
export function orderFor(key, descending) {
  const column = SERVER_SORTS[key];
  if (!column) return '';
  return descending ? `-${column}` : column;
}

const STORE_KEY = 'azimut:board-filter';

/**
 * Remember the question, per case, in the browser.
 *
 * Not in the case, and the distinction is the one the backup contract cares about: a
 * filter is how somebody was looking at their material this afternoon, not something
 * the case holds. Storing it would make it a new key to carry into a bundle and
 * restore on another machine, for a value that is stale by then anyway.
 */
export function loadFilter(caseId) {
  if (!caseId) return emptyFilter();
  try {
    const stored = JSON.parse(localStorage.getItem(`${STORE_KEY}:${caseId}`) ?? 'null');
    // Merged over a fresh one, so a filter written by an older build cannot arrive
    // missing a key every reader assumes is there.
    return normalizeFilter(stored);
  } catch {
    return emptyFilter(); // unavailable or unparseable storage is not a failure
  }
}

export function saveFilter(caseId, filter) {
  if (!caseId) return;
  try {
    if (isFiltering(filter)) {
      localStorage.setItem(`${STORE_KEY}:${caseId}`, JSON.stringify(filter));
    } else {
      localStorage.removeItem(`${STORE_KEY}:${caseId}`);
    }
  } catch {
    /* ignore */
  }
}
