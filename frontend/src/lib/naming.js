/**
 * Naming rules shared by everything the analyst saves under a name: collages,
 * proofs and post drafts.
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
export const NAME_PREFIX = { collage: 'Collage', proof: 'Proof', draft: 'Post', note: 'Note' };

// The invisible characters a pasted name brings along, and a joiner that joins nothing:
// mirrors `_INVISIBLE` and `_LOOSE_JOINER` in azimut/layout.py.
const INVISIBLE = /[­؜᠎​‎‏‪-‮⁠-⁤⁦-⁯﻿]/g;
const LOOSE_JOINER = /(?<!\S)[‌‍]+|[‌‍]+(?!\S)/g;

/** Human-readable cross-platform filename stem for a name being given — mirror of backend `slugify`. */
export function slugify(text, fallback) {
  let name = String(text ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(LOOSE_JOINER, '')
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
 * Name for a fresh item of `kind`: "Collage 1", "Proof 1", … taking the lowest
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

/**
 * A name as the header's field shows it: the analyst's own, or '' for one the app gave.
 * "Post 41" and "Proof 3" are the files' names, technical, never shown as the item's:
 * the item reads as its label instead (`itemLabel`).
 */
export const ownName = (name, kind) => (isDefaultName(name, kind) ? '' : String(name ?? '').trim());

/** What an item says for a label when it has no name, no place and no point. */
export const UNTITLED = { proof: 'Untitled proof', draft: 'Untitled post' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A day as a label says it, *9 Nov*, the year added outside this one, or '' for none.
 * A date written out (`2025-11-09 06:40 UTC+3`, a post's `#date`) is its own day as
 * written; an instant (`2026-11-09T21:40:00Z`, when a file was made) is this machine's day.
 */
export function labelDay(value, now = new Date()) {
  const text = String(value ?? '').trim();
  const written = /^(\d{4})-(\d{2})-(\d{2})(?![\dT])/.exec(text);
  let year;
  let month;
  let day;
  if (written) {
    [year, month, day] = [Number(written[1]), Number(written[2]) - 1, Number(written[3])];
  } else {
    const at = /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(text) : null;
    if (!at || Number.isNaN(at.getTime())) return '';
    [year, month, day] = [at.getFullYear(), at.getMonth(), at.getDate()];
  }
  if (!(month >= 0 && month < 12) || !(day >= 1 && day <= 31)) return '';
  return year === now.getFullYear() ? `${day} ${MONTHS[month]}` : `${day} ${MONTHS[month]} ${year}`;
}

/** A point as a label says it: `15.4712, 45.3221`, about ten metres. '' for none. */
export function labelCoords(point) {
  const [lat, lon] = Array.isArray(point) ? point : [point?.lat, point?.lon];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * What a proof or a post is called wherever it is listed: the name the analyst gave it;
 * else where it is and its day, `Al Jawf, Yemen · 9 Nov`; else its point and its day;
 * else Untitled. `when` is the dates to read the day from, the first that says one
 * winning (the event's, then a post's day out, then when it was made).
 */
export function itemLabel(kind, name, { place = '', when = [], coords = null } = {}, now = new Date()) {
  const own = ownName(name, kind);
  if (own) return own;
  const day = (Array.isArray(when) ? when : [when]).map((one) => labelDay(one, now)).find(Boolean) ?? '';
  const where = String(place ?? '').trim() || labelCoords(coords);
  if (!where) return UNTITLED[kind];
  return day ? `${where} · ${day}` : where;
}

// Where each kind's spec lives, and the entity attribute that points at it.
// These mirror `layout.collage_rel` / `proof_spec_rel` / `draft_rel` — the
// specs are hidden inside the case folder, so a spec path is not the visible
// path of the work it describes (a proof's own file is `proofs/<name>.png`).
const SPEC_ATTR = {
  collage: { dir: '.collages/', attr: 'spec' },
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
