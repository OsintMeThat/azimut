/**
 * Naming rules shared by everything the analyst saves under a name: inspect
 * sessions, proofs and post drafts.
 *
 * The rule is one line: **the name is the filename**. What the header shows is
 * slugified into the file that holds it, so renaming moves the file (the
 * backend does the move — see `api/naming.py`, which mirrors `slugify` exactly).
 * That is why the collision checks here matter: the frontend can tell before it
 * posts whether a name is free.
 */

// Long enough to stay readable, short enough that the path survives Windows'
// 260-character limit under a deep workspace root. Mirrors api/naming.py.
export const MAX_SLUG = 80;

/** What a fresh item of each kind is called until the analyst renames it. */
export const NAME_PREFIX = { session: 'Inspect', proof: 'Proof', draft: 'Post' };

/** URL- and filesystem-safe stem from free text — mirror of the backend `slugify`. */
export function slugify(text, fallback) {
  const slug = (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, MAX_SLUG) || fallback;
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
const SPEC_ATTR = {
  session: { dir: 'inspect/', attr: 'spec' },
  proof: { dir: 'proofs/', attr: 'spec' },
  draft: { dir: 'exports/', attr: 'draft' },
};

/** The filed entities of `kind`, read off a case's entity list. */
export function savedEntities(entities, kind) {
  const { dir, attr } = SPEC_ATTR[kind];
  return (entities ?? []).filter((e) => {
    const spec = e.attrs?.[attr];
    return typeof spec === 'string' && spec.startsWith(dir) && spec.endsWith('.json');
  });
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
