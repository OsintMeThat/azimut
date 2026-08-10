/**
 * Naming rules shared by everything the analyst saves under a name: inspect
 * sessions, proofs and post drafts.
 *
 * The rule is one line: **the name is the filename stem**. The human-readable
 * text in the header becomes the file stem, with only cross-platform forbidden
 * characters replaced. Renaming moves the file (the backend does the move —
 * see `api/naming.py`, which mirrors `slugify` exactly). That is why collision
 * checks here matter: the frontend can tell before it posts whether a name is
 * free.
 */

// Long enough to stay readable, short enough that the case's longest path stays
// inside Windows' 260-character limit. Mirrors MAX_SLUG in azimut/layout.py,
// which owns the whole path budget.
export const MAX_SLUG = 68;

/** What a fresh item of each kind is called until the analyst renames it. */
export const NAME_PREFIX = { session: 'Inspect', proof: 'Proof', draft: 'Post', note: 'Note' };

/** Human-readable cross-platform filename stem — mirror of backend `slugify`. */
export function slugify(text, fallback) {
  let name = String(text ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/^[ .]+|[ .]+$/g, '')
    .replace(/\.{2,}/g, '_')
    .slice(0, MAX_SLUG)
    .replace(/[ .]+$/g, '');
  if (!name) name = String(fallback ?? 'file').slice(0, MAX_SLUG).replace(/[ .]+$/g, '') || 'file';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    name = `_${name}`.slice(0, MAX_SLUG).replace(/[ .]+$/g, '');
  }
  return name;
}

/**
 * A name that doesn't collide with `taken`: `base` when free, else `base 2`,
 * `base 3`, … `taken` is a Set or array of names already in the case.
 */
export function uniqueName(base, taken) {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/**
 * Name for a fresh item of `kind`: "Inspect 1", "Proof 1", … taking the lowest
 * free number so the case doesn't count past the gaps deletions leave behind.
 */
export function nextName(kind, taken) {
  const set = taken instanceof Set ? taken : new Set(taken);
  const prefix = NAME_PREFIX[kind];
  let n = 1;
  while (set.has(`${prefix} ${n}`)) n += 1;
  return `${prefix} ${n}`;
}

/**
 * Whether `name` is one this app assigned rather than one the analyst typed.
 * A default name says nothing about the work, so it must not be carried into
 * places that want a description (the Post Composer pulls a proof's title into
 * its text, and "Proof 3" is not text worth posting).
 */
export function isDefaultName(name, kind) {
  return new RegExp(`^${NAME_PREFIX[kind]} \\d+$`).test((name ?? '').trim());
}

// Where each kind's spec lives, and the entity attribute that points at it.
// These mirror `layout.session_rel` / `proof_spec_rel` / `draft_rel` — the
// specs are hidden inside the case folder, so a spec path is not the visible
// path of the work it describes (a proof's own file is `proofs/<name>.png`).
const SPEC_ATTR = {
  session: { dir: '.inspect/', attr: 'spec' },
  proof: { dir: 'proofs/.meta/', attr: 'spec' },
  draft: { dir: '.drafts/', attr: 'draft' },
};

/** The entity attribute holding a kind's spec path: `spec`, or `draft` for posts. */
export function specAttr(kind) {
  return SPEC_ATTR[kind].attr;
}

/**
 * Case-relative spec path of the item of `kind` saved under `slug` — the exact
 * value its entity carries. Tools ask the catalog for this before deciding a
 * saved item was deleted out from under them, so a hand-written literal goes
 * stale the day the layout moves: sessions lived under `inspect/` and drafts
 * under `exports/` before they were hidden, and a path that matches nothing
 * reads as "deleted" on every save.
 */
export function specPath(kind, slug) {
  return `${SPEC_ATTR[kind].dir}${slug}.json`;
}

/** The filed entities of `kind`, read off a case's entity list. */
export function savedEntities(entities, kind) {
  const { dir, attr } = SPEC_ATTR[kind];
  return (entities ?? []).filter((e) => {
    const spec = e.attrs?.[attr];
    return typeof spec === 'string' && spec.startsWith(dir) && spec.endsWith('.json');
  });
}

/** The name one filed entity is saved under, or '' if it carries no spec.
 *  This is the name the tools reopen by, so it has to follow the spec's folder
 *  wherever the case layout moves it. */
export function specStem(entity, kind) {
  const { dir, attr } = SPEC_ATTR[kind];
  const spec = entity?.attrs?.[attr];
  if (typeof spec !== 'string' || !spec.startsWith(dir) || !spec.endsWith('.json')) return '';
  return spec.slice(dir.length, -5);
}

/** Slugs of everything of `kind` already saved — the collision set. */
export function savedSlugs(entities, kind) {
  const { dir, attr } = SPEC_ATTR[kind];
  return new Set(savedEntities(entities, kind).map((e) => e.attrs[attr].slice(dir.length, -5)));
}

/** Names of everything of `kind` already saved, so a fresh one reads apart. */
export function savedTitles(entities, kind) {
  return new Set(savedEntities(entities, kind).map((e) => e.label ?? ''));
}

/** Name of the saved item of `kind` with slug `slug`, for the overwrite prompt. */
export function savedTitle(entities, kind, slug) {
  const { dir, attr } = SPEC_ATTR[kind];
  const found = savedEntities(entities, kind).find((e) => e.attrs[attr] === `${dir}${slug}.json`);
  return found?.label ?? slug;
}
