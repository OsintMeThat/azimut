/**
 * What Settings › Website works out of what it was given, kept out of the components so that it is
 * tested without drawing: the site as the last read found it, its kinds, chips and weights, the name
 * the site shows and its addresses. The words are `lib/websiteSetup.js`'s.
 *
 * The read is `POST /api/publishing/github/site/read` (`lib/githubPages.js`), pressed and never
 * asked on mount; `siteReadOf` takes its answer down to what the hub shows, so a field the server
 * leaves out reads as empty rather than break a panel.
 */
import { ALL_CHIP, KIND_CHIP, LIMITS_AMBER, LIMITS_RED, SITE_LIMIT_BYTES, placeOf } from './websiteSetup.js';
import { webLink } from './wordpressSetup.js';

// -- the read ---------------------------------------------------------------------------------------

const ROLES = ['article', 'page', 'unlisted'];
const LAYOUTS = ['article', 'story', 'map'];
const HOMES = ['azimut', 'yours', 'none'];

const line = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const count = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);
/** A weight in bytes, or null when the server gave none: nothing is not zero. */
const bytesOf = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * One card of the site, as a row shows it; null for an entry with no folder. A folder may be nested
 * (`2026/01/05/slug`, as a WordPress export lays them out), and only one the server says it would
 * delete (`deletable`) gets a Delete press.
 */
function itemOf(raw) {
  const folder = line(raw?.folder, 200).replace(/^\/+|\/+$/g, '');
  if (!folder) return null;
  return {
    folder,
    deletable: raw?.deletable === true,
    address: webLink(raw?.address),
    title: line(raw?.title) || folder,
    date: line(raw?.date, 20),
    dateLabel: line(raw?.date_label, 40),
    category: line(raw?.category, 60),
    role: ROLES.includes(raw?.role) ? raw.role : 'article',
    layout: LAYOUTS.includes(raw?.layout) ? raw.layout : 'article',
    image: webLink(raw?.image),
    bytes: bytesOf(raw?.bytes),
    // where it stands on the site's map, null for nowhere
    place: placeOf(raw?.place),
  };
}

/**
 * The site as the last read found it, whatever the server left out filled with nothing. `truncated` is
 * a read GitHub cut short (`size.site` null): it lists nothing, and says nothing of the site's home.
 */
export function siteReadOf(answer) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const last = answer?.last && typeof answer.last === 'object' ? answer.last : null;
  const size = answer?.size && typeof answer.size === 'object' ? answer.size : {};
  return {
    address: webLink(answer?.address),
    home: HOMES.includes(answer?.home) ? answer.home : 'none',
    items: list(answer?.items).map(itemOf).filter(Boolean),
    truncated: size.site === null,
    categories: list(answer?.categories).map((entry) => ({
      name: line(entry?.name, 60),
      count: count(entry?.count),
      pages: list(entry?.pages).map((page) => line(page, 120)).filter(Boolean),
    })).filter((entry) => entry.name),
    marked: list(answer?.marked).map((page) => line(page, 120)),
    legal: line(answer?.legal, 120),
    privacy: line(answer?.privacy, 120),
    last: last && line(last.date, 40) ? { date: line(last.date, 40), message: line(last.message, 120) } : null,
    size: { site: bytesOf(size.site), repository: bytesOf(size.repository) },
    warnings: list(answer?.warnings).map((warning) => line(warning, 400)).filter(Boolean),
  };
}

/** The read without one folder, as the next read would find it: its row gone, the categories counted again, its weight off. */
export function withoutFolder(read, folder) {
  if (!read) return read;
  const gone = read.items.find((item) => item.folder === folder);
  if (!gone) return read;
  const items = read.items.filter((item) => item !== gone);
  const listed = new Map();
  for (const item of items) if (item.role === 'article' && item.category) listed.set(item.category, (listed.get(item.category) ?? 0) + 1);
  const named = `${folder}/`;
  return {
    ...read,
    items,
    categories: read.categories.filter((entry) => listed.has(entry.name)).map((entry) => ({ ...entry, count: listed.get(entry.name) })),
    legal: read.legal === named ? '' : read.legal,
    privacy: read.privacy === named ? '' : read.privacy,
    size: { ...read.size, site: read.size.site !== null && gone.bytes !== null ? Math.max(0, read.size.site - gone.bytes) : read.size.site },
  };
}

// -- kinds, chips and counts ------------------------------------------------------------------------

/** What a row is: unlisted and page win over what the card is laid out as. */
export function kindOf(item) {
  if (item.role === 'unlisted') return 'unlisted';
  if (item.role === 'page') return 'page';
  return item.layout === 'map' ? 'map' : 'article';
}

/** How many of each kind the site holds. */
export function countsOf(items) {
  const found = { article: 0, map: 0, page: 0, unlisted: 0 };
  for (const item of items) found[kindOf(item)] += 1;
  return found;
}

/** The items a chip keeps: a category its listed articles and maps, a kind its own, All every one. */
export function itemsFor(read, filter) {
  const items = read?.items ?? [];
  if (!filter || filter === 'all') return items;
  if (filter.startsWith('category:')) {
    const name = filter.slice('category:'.length);
    return items.filter((item) => item.role === 'article' && item.category === name);
  }
  return items.filter((item) => kindOf(item) === filter);
}

/**
 * The chips over the list: All, each category the site uses, then Maps, Pages and Unlisted when there
 * are some, each counting the rows it keeps.
 */
export function chipsOf(read) {
  if (!read || read.truncated || !read.items.length) return [];
  const chip = (id, label) => ({ id, label, count: itemsFor(read, id).length });
  return [
    chip('all', ALL_CHIP),
    ...read.categories.map((entry) => chip(`category:${entry.name}`, entry.name)),
    ...Object.entries(KIND_CHIP).map(([kind, label]) => chip(kind, label)),
  ].filter((entry) => entry.id === 'all' || entry.count > 0);
}

// -- weights ----------------------------------------------------------------------------------------

/** `4.2 MB`, `312 MB`, `1.4 GB`: binary units, one decimal under ten, the way GitHub counts its limits. */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let at = 0;
  while (value >= 1024 && at < units.length - 1) {
    value /= 1024;
    at += 1;
  }
  const text = value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${units[at]}`;
}

/** How much of the gigabyte a weight is, 0 upward (it can pass 1). */
export function shareOf(bytes, limit = SITE_LIMIT_BYTES) {
  return bytes === null || bytes === undefined ? 0 : bytes / limit;
}

/** The colour of a bar: amber from 80 %, red from 95 %. */
export function levelOf(share) {
  if (share >= LIMITS_RED) return 'danger';
  if (share >= LIMITS_AMBER) return 'warn';
  return 'ok';
}

/** A whole number of percent, never zero for a weight that is not nothing. */
export function percentOf(share) {
  return share > 0 && share < 0.01 ? 1 : Math.round(share * 100);
}

// -- the site's name, address and counter -----------------------------------------------------------

/** The name the site shows: the one typed, else the Publishing name, else the GitHub account (`site.from_settings`). */
export function siteName({ title = '', report = '', account = '' } = {}) {
  return line(title, 120) || line(report, 80) || line(account, 80);
}

/** The host of an address, `osintmethat.com`; '' for none. */
export function hostOf(address) {
  try {
    return new URL(address).host;
  } catch {
    return '';
  }
}

/** The address of a site without its scheme and last slash, `octo.github.io/articles`. */
export function bareAddress(address) {
  return String(address ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** The path a row shows under its title: the address's own, else the folder. */
export function pathOf(item) {
  try {
    return new URL(item.address).pathname;
  } catch {
    return `/${item.folder}/`;
  }
}

/** One address on the site: its base, one slash, the name. */
export function onSite(base, name) {
  return base ? `${String(base).replace(/\/+$/, '')}/${name}` : '';
}

/** Whether the address is the analyst's own domain rather than GitHub's `github.io`. */
export function ownDomain(base) {
  const host = hostOf(base);
  return Boolean(host) && !host.endsWith('.github.io');
}

/** Which counter really counts: the choice is made and its code or token is there. A choice with nothing to count with counts nobody. */
export function countingOf(prefs) {
  if (prefs.siteStats === 'goatcounter' && prefs.siteStatsCode) return 'goatcounter';
  if (prefs.siteStats === 'cloudflare' && prefs.siteStatsToken) return 'cloudflare';
  return '';
}
