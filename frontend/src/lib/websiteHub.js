/**
 * What Settings › Website works out of what it was given, kept out of the components so that it is
 * tested without drawing: the site as the last read found it, its kinds, chips and weights, the name
 * the site shows and its addresses. The words are `lib/websiteSetup.js`'s.
 *
 * The read is `POST /api/publishing/github/site/read` (`lib/githubPages.js`), pressed and never
 * asked on mount; `siteReadOf` takes its answer down to what the hub shows, so a field the server
 * leaves out reads as empty rather than break a panel.
 */
import { ALL_CHIP, KIND_CHIP, LIMITS_AMBER, LIMITS_RED, NUMBERS_HOME, SITE_LIMIT_BYTES, placeOf } from './websiteSetup.js';
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
    // who it is by, and their picture: the site's own name for an article of the analyst's
    author: line(raw?.author, 120),
    authorImage: webLink(raw?.author_image),
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
    // whose bar the articles carry: the site's own azimut-bar.html, else Azimut's; and whose footer
    bar: answer?.bar === 'yours' ? 'yours' : 'azimut',
    footer: answer?.footer === 'yours' ? 'yours' : 'none',
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
    // the pages still giving an address the site had before it moved, which Update the site refreshes
    oldAddress: Number.isInteger(answer?.old_address) && answer.old_address > 0 ? answer.old_address : 0,
    warnings: list(answer?.warnings).map((warning) => line(warning, 400)).filter(Boolean),
  };
}

/**
 * The categories of a read worked out again from its items, as the server counts them: each with the listed
 * articles that carry it, most first, then those a marked page names with no article yet. `pages` is the
 * read's own list of the pages that name each, by name.
 */
export function categoriesFrom(items, pages = {}) {
  const counts = new Map();
  for (const item of items) if (item.role === 'article' && item.category) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  for (const [name, named] of Object.entries(pages)) if (named.length && !counts.has(name)) counts.set(name, 0);
  const fold = (name) => name.toLowerCase();
  return [...counts].map(([name, count]) => ({ name, count, pages: pages[name] ?? [] }))
    .sort((a, b) => b.count - a.count || (fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : 0));
}

/** The pages that name each category of a read, by its name. */
const pagesOf = (read) => Object.fromEntries(read.categories.map((entry) => [entry.name, entry.pages]));

/** The read without one folder, as the next read would find it: its row gone, the categories counted again, its weight off. */
export function withoutFolder(read, folder) {
  if (!read) return read;
  const gone = read.items.find((item) => item.folder === folder);
  if (!gone) return read;
  const items = read.items.filter((item) => item !== gone);
  const named = `${folder}/`;
  return {
    ...read,
    items,
    categories: categoriesFrom(items, pagesOf(read)),
    legal: read.legal === named ? '' : read.legal,
    privacy: read.privacy === named ? '' : read.privacy,
    size: { ...read.size, site: read.size.site !== null && gone.bytes !== null ? Math.max(0, read.size.site - gone.bytes) : read.size.site },
  };
}

/**
 * The read once a change of categories is on GitHub, as the next read would find it: `rename` gives every card
 * of `name` the name `to`, `delete` takes `name` off them, `move` gives the card of `folder` the category `to`
 * ('' for none). The categories are counted again; the pages keep naming what they named.
 */
export function withCategories(read, change) {
  if (!read || !change) return read;
  const touches = (item) => (change.kind === 'move' ? item.folder === change.folder : item.category === change.name);
  const to = change.kind === 'delete' ? '' : line(change.to, 60);
  const items = read.items.map((item) => (touches(item) ? { ...item, category: to } : item));
  return { ...read, items, categories: categoriesFrom(items, pagesOf(read)) };
}

/** How many cards of the read a rename or a delete of `name` changes: every card that carries it, whatever its kind. */
export function carrying(read, name) {
  return (read?.items ?? []).filter((item) => item.category === name).length;
}

/**
 * The rows of the Categories panel: each category of the read (`count` its listed articles, `pages` those that
 * name it), then each one added here that the read does not hold, `added`, with no article yet.
 */
export function categoryRows(read, added = []) {
  const found = read && !read.truncated ? read.categories : [];
  const known = new Set(found.map((entry) => entry.name.toLowerCase()));
  return [...found.map((entry) => ({ ...entry, added: false })),
    ...added.filter((name) => !known.has(name.toLowerCase())).map((name) => ({ name, count: 0, pages: [], added: true }))];
}

/** What a category typed to add is up against: '' when it may be added, `site` when the site has it, `added` when it was added here. */
export function addProblem(name, read, added = []) {
  const wanted = line(name, 60).toLowerCase();
  if (!wanted) return 'empty';
  if ((read?.categories ?? []).some((entry) => entry.name.toLowerCase() === wanted)) return 'site';
  if (added.some((one) => one.toLowerCase() === wanted)) return 'added';
  return '';
}

/** The categories an article's line offers: the site's, then the ones added here, each once. */
export function categoryChoices(read, added = []) {
  return categoryRows(read, added).map((row) => row.name);
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

// -- the numbers -----------------------------------------------------------------------------------

/** Most rows the panel keeps of an answer, as the server bounds it (`sitestats.MAX_PAGES`, `MAX_RANKED`). */
const MAX_PAGES = 500;
const MAX_RANKED = 10;

const windowOf = (value) => ({ views: count(value?.views), visits: count(value?.visits) });

/**
 * The numbers as `POST /api/publishing/cloudflare/numbers` answers them (`engine/sitestats.py`), what the
 * server left out read as nothing: `pages` (each `{ path, page, week, month }`, `page` the path within the
 * site's folder, '' its home, null outside it), `total`, `referrers` ranked by the visits they sent,
 * `countries`, whether the 30 days were `sampled`, and the `address` the server read the site at.
 */
export function numbersOf(answer) {
  const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);
  const pages = list(answer?.pages, MAX_PAGES)
    .filter((one) => typeof one?.path === 'string' && one.path.startsWith('/'))
    .map((one) => ({ path: line(one.path, 512), page: typeof one.page === 'string' ? line(one.page, 512) : null, week: windowOf(one.week), month: windowOf(one.month) }));
  const referrers = list(answer?.referrers, MAX_RANKED)
    .map((one) => ({ host: line(one?.host, 253), ...windowOf(one) }))
    .filter((one) => one.visits > 0)
    .sort((a, b) => b.visits - a.visits);
  const countries = list(answer?.countries, MAX_RANKED).map((one) => ({ country: line(one?.country, 64), ...windowOf(one) }));
  return {
    address: webLink(answer?.address),
    pages,
    total: { week: windowOf(answer?.total?.week), month: windowOf(answer?.total?.month) },
    referrers,
    countries,
    sampled: answer?.sampled === true,
  };
}

/**
 * The rows of the numbers' table: each page of the site as the read of the site names it (the article
 * whose folder holds it, with its title and its address; pages within one article summed), the home,
 * then what the read does not know, by its path. `read` is the session's read or null; `address` is
 * where the site is served, for the links. Ranked by their 30 days, then their 7.
 */
export function numbersRows(numbers, read = null, address = '') {
  if (!numbers) return [];
  const base = webLink(address) || numbers.address;
  const origin = (() => {
    try {
      return new URL(base).origin;
    } catch {
      return '';
    }
  })();
  // the longest folder first, so a nested one wins over its parent
  const folders = [...(read?.items ?? [])].sort((a, b) => b.folder.length - a.folder.length);
  const rows = new Map();
  for (const one of numbers.pages) {
    const item = one.page ? folders.find((entry) => one.page === `${entry.folder}/` || one.page.startsWith(`${entry.folder}/`)) : null;
    const row = item
      ? { key: `item:${item.folder}`, title: item.title, href: item.address || onSite(base, `${item.folder}/`), known: true }
      : one.page === ''
        ? { key: 'home', title: NUMBERS_HOME, href: base, known: true }
        : { key: `path:${one.path}`, title: one.path, href: origin ? `${origin}${one.path}` : '', known: false };
    const kept = rows.get(row.key);
    if (kept) {
      kept.week = { views: kept.week.views + one.week.views, visits: kept.week.visits + one.week.visits };
      kept.month = { views: kept.month.views + one.month.views, visits: kept.month.visits + one.month.visits };
    } else {
      rows.set(row.key, { ...row, week: { ...one.week }, month: { ...one.month } });
    }
  }
  return [...rows.values()].sort((a, b) => b.month.views - a.month.views || b.week.views - a.week.views || a.title.localeCompare(b.title));
}

/** A country as Cloudflare names it, an ISO code such as `FR`, said in English; the code itself when it is no known region. */
export function countryOf(code) {
  const value = line(code, 64);
  if (!value) return 'Unknown';
  if (!/^[A-Za-z]{2}$/.test(value)) return value;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(value.toUpperCase()) || value;
  } catch {
    return value;
  }
}
