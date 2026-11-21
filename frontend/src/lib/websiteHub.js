/**
 * What Settings › Website works out of what it was given, kept out of the components so that it is
 * tested without drawing: the site as the last read found it, its kinds, filters and weights, the
 * checklist of the Overview, the name the site shows and the dates it says.
 *
 * The read is `POST /api/publishing/github/site/read` (`lib/githubPages.js`), pressed and never
 * asked on mount; `siteReadOf` takes its answer down to what the hub shows, so a field the server
 * leaves out reads as empty rather than break a panel.
 */
import { LIMITS_AMBER, LIMITS_RED, NEEDS_READ, SITE_LIMIT_BYTES, TOO_MANY } from './websiteSetup.js';
import { webLink } from './wordpressSetup.js';

// -- the read ---------------------------------------------------------------------------------------

const ROLES = ['article', 'page', 'unlisted'];
const LAYOUTS = ['article', 'story', 'map'];
const HOMES = ['azimut', 'yours', 'none'];

const line = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const count = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);
/** A weight in bytes, or null when the server gave none: nothing is not zero. */
const bytesOf = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * One card of the site, as a row shows it; `null` for an entry with no folder. A folder may be nested
 * (`2026/01/05/slug`, as a WordPress export lays them out), and only one the server says it would delete
 * (`deletable`) gets a Delete press.
 */
function itemOf(raw) {
  const folder = line(raw?.folder, 200);
  if (!folder) return null;
  return {
    folder,
    deletable: raw?.deletable === true,
    address: webLink(raw?.address),
    title: line(raw?.title) || folder,
    summary: line(raw?.summary, 600),
    date: line(raw?.date, 20),
    dateLabel: line(raw?.date_label, 40),
    category: line(raw?.category, 60),
    role: ROLES.includes(raw?.role) ? raw.role : 'article',
    layout: LAYOUTS.includes(raw?.layout) ? raw.layout : 'article',
    image: webLink(raw?.image),
    bytes: bytesOf(raw?.bytes),
  };
}

/** The site as the last read found it, whatever the server left out filled with nothing. */
export function siteReadOf(answer) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const last = answer?.last && typeof answer.last === 'object' ? answer.last : null;
  const size = answer?.size && typeof answer.size === 'object' ? answer.size : {};
  const items = list(answer?.items).map(itemOf).filter(Boolean);
  const weight = bytesOf(size.site);
  return {
    address: webLink(answer?.address),
    home: HOMES.includes(answer?.home) ? answer.home : 'none',
    items,
    // GitHub cut the tree short: nothing was listed, so the site's size and its home page are unknown, not zero and none
    truncated: weight === null && items.length === 0,
    categories: list(answer?.categories).map((entry) => ({
      name: line(entry?.name, 60),
      count: count(entry?.count),
      pages: list(entry?.pages).map((page) => line(page, 120)).filter(Boolean),
    })).filter((entry) => entry.name),
    marked: list(answer?.marked).map((page) => line(page, 120)),
    legal: line(answer?.legal, 120),
    privacy: line(answer?.privacy, 120),
    last: last && line(last.date, 40) ? { date: line(last.date, 40), message: line(last.message, 120) } : null,
    size: { site: weight, repository: bytesOf(size.repository) },
    warnings: list(answer?.warnings).map((warning) => line(warning, 400)).filter(Boolean),
  };
}

/** The read without one folder: its item gone, the categories counted again, the pages it was no longer named. */
export function withoutFolder(read, folder) {
  if (!read) return read;
  const items = read.items.filter((item) => item.folder !== folder);
  const removed = read.items.find((item) => item.folder === folder);
  const listed = new Map();
  for (const item of items) if (item.role === 'article' && item.category) listed.set(item.category, (listed.get(item.category) ?? 0) + 1);
  const named = `${folder}/`;
  const size = read.size.site !== null && removed?.bytes != null ? Math.max(0, read.size.site - removed.bytes) : read.size.site;
  return {
    ...read,
    items,
    categories: read.categories.filter((entry) => listed.has(entry.name)).map((entry) => ({ ...entry, count: listed.get(entry.name) })),
    marked: read.marked.filter((page) => page !== named),
    legal: read.legal === named ? '' : read.legal,
    privacy: read.privacy === named ? '' : read.privacy,
    size: { ...read.size, site: size },
  };
}

// -- kinds, filters and counts ----------------------------------------------------------------------

export const KIND_LABEL = Object.freeze({ article: 'Article', map: 'Map', page: 'Page', unlisted: 'Unlisted' });

/** What a row is called: unlisted and page win over what the card is laid out as. */
export function kindOf(item) {
  if (item.role === 'unlisted') return 'unlisted';
  if (item.role === 'page') return 'page';
  return item.layout === 'map' ? 'map' : 'article';
}

/** How many of each kind the site lists. */
export function countsOf(items) {
  const found = { article: 0, map: 0, page: 0, unlisted: 0 };
  for (const item of items) found[kindOf(item)] += 1;
  return found;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `5 articles · 2 maps`, the kinds the site has and no other. */
export function countsLine(items) {
  const found = countsOf(items);
  const parts = [
    found.article && plural(found.article, 'article'),
    found.map && plural(found.map, 'map'),
    found.page && plural(found.page, 'page'),
    found.unlisted && `${found.unlisted} unlisted`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing listed yet';
}

/** The chips over the list: All, each category the site uses, then Maps, Pages and Unlisted when there are some. */
export function chipsOf(read) {
  if (!read) return [];
  const found = countsOf(read.items);
  return [
    { id: 'all', label: 'All', count: read.items.length },
    ...read.categories.map((entry) => ({ id: `category:${entry.name}`, label: entry.name, count: entry.count })),
    ...(found.map ? [{ id: 'map', label: 'Maps', count: found.map }] : []),
    ...(found.page ? [{ id: 'page', label: 'Pages', count: found.page }] : []),
    ...(found.unlisted ? [{ id: 'unlisted', label: 'Unlisted', count: found.unlisted }] : []),
  ];
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

/** How much of the limit a weight is, 0 upward (it can pass 1). */
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

// -- dates ------------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

/** `today at 13:55`, `yesterday at 13:55`, `20 Nov at 13:55`, or `20 Nov 2025` a year or more back; '' for no date. */
export function whenLabel(value, now = new Date()) {
  const at = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(at.getTime())) return '';
  const day = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}`;
  if (days === 0) return `today at ${clock}`;
  if (days === 1) return `yesterday at ${clock}`;
  if (at.getFullYear() === now.getFullYear()) return `${at.getDate()} ${MONTHS[at.getMonth()]} at ${clock}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

// -- the site's name and address --------------------------------------------------------------------

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

/** The path a row shows under a title: the address's own, else the folder. */
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

// -- the checklist ----------------------------------------------------------------------------------

/**
 * Which counter is really counting: the choice is made and its code or token is there.
 * A choice with nothing to count with counts nobody.
 */
export function countingOf(prefs) {
  if (prefs.siteStats === 'goatcounter' && prefs.siteStatsCode) return 'goatcounter';
  if (prefs.siteStats === 'cloudflare' && prefs.siteStatsToken) return 'cloudflare';
  return '';
}

export const COUNTER_NAME = Object.freeze({ goatcounter: 'GoatCounter', cloudflare: 'Cloudflare Web Analytics' });

/**
 * The six things that make a site, each `done`, `todo` or `unknown` (it needs a read of the site),
 * with what it says and the panel it opens. `optional` ones are marked, and still counted.
 */
export function checklist({ ready, github, title, fallback, siteLogo, logoFrom, counting, stats, read }) {
  const articles = read ? read.items.filter((item) => item.role === 'article').length : 0;
  // what a read could not tell is as unknown as no read: a site too big to read lists nothing, which is no verdict
  const unread = !read || read.truncated;
  const why = !read ? NEEDS_READ : TOO_MANY;
  return [
    {
      id: 'hosting', label: 'Connect GitHub Pages', go: 'hosting',
      state: ready ? 'done' : 'todo',
      said: ready ? `${github.account}/${github.repo} on ${github.branch}` : 'Add the account, the repository and the token.',
    },
    {
      id: 'name', label: 'Name the site', go: 'identity',
      state: title ? 'done' : 'todo',
      said: title || (fallback ? `It shows as ${fallback} for now.` : 'It has no name yet.'),
    },
    {
      id: 'logo', label: 'Pick the site\'s logo', go: 'identity',
      state: siteLogo ? 'done' : 'todo',
      said: siteLogo ? 'A logo of its own.' : logoFrom === 'publishing' ? 'Uses your Publishing logo for now.' : 'No logo yet.',
    },
    {
      id: 'readers', label: 'Count readers', optional: true, go: 'readers',
      state: counting ? 'done' : 'todo',
      said: counting ? COUNTER_NAME[counting] : stats ? `${COUNTER_NAME[stats]} is picked: paste its ${stats === 'goatcounter' ? 'code' : 'token'}.` : 'Nobody is counted.',
    },
    {
      id: 'legal', label: 'A legal notice', optional: true, go: 'articles', needsRead: true,
      state: unread ? 'unknown' : read.legal ? 'done' : 'todo',
      said: unread ? why : read.legal ? `${read.legal} is on the site` : 'No legal notice page on the site yet.',
    },
    {
      id: 'first', label: 'Publish a first article', go: 'articles', needsRead: true,
      state: unread ? 'unknown' : articles ? 'done' : 'todo',
      said: unread ? why : articles ? plural(articles, 'article') + ' on the site' : 'Nothing is listed on the site yet.',
    },
  ];
}

/** `5 of 6 done`, and how many still wait for a read (`unread`) or could not be told by one (`unknown`). */
export function progressOf(steps) {
  const done = steps.filter((step) => step.state === 'done').length;
  const unknown = steps.filter((step) => step.state === 'unknown');
  return { done, total: steps.length, unknown: unknown.length, unread: unknown.filter((step) => step.said === NEEDS_READ).length };
}

// -- who writes what --------------------------------------------------------------------------------

/**
 * The files of the site and whose they are. `home` is what the last read found of the root page
 * (`azimut`, `yours` or `none`), nothing before a read; `marked` the pages that carry Azimut's markers.
 */
export function ownersOf(read) {
  // a read that was cut short found no page, and no home page, which says nothing of the site
  const known = read && !read.truncated ? read : null;
  const yours = known?.home === 'yours';
  const pages = (known?.marked ?? []).filter((page) => page !== '');
  return [
    { files: ['each article\'s folder'], who: 'Azimut', text: 'Replaces it when you publish that note again, and asks first if it changed on GitHub.' },
    { files: ['articles.json', 'feed.xml', 'sitemap.xml'], who: 'Azimut', text: 'Rewrites them at each publish and update.' },
    yours
      ? { files: ['index.html'], who: 'You', text: 'Fills the list between its markers, nothing else.' }
      : { files: ['index.html'], who: 'Azimut', text: 'Writes the default home page, until you write your own.' },
    ...(pages.length ? [{ files: pages, who: 'You', text: 'Fills the list between their markers, nothing else.' }] : []),
    { files: ['everything else'], who: 'You', text: 'Never touches it.' },
  ];
}
