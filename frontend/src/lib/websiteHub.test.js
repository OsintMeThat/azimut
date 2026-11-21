import { describe, expect, it } from 'vitest';
import {
  checklist, chipsOf, countingOf, countsLine, countsOf, formatBytes, hostOf, itemsFor, kindOf, levelOf, onSite, ownDomain, ownersOf, pathOf, percentOf,
  progressOf, shareOf, siteName, siteReadOf, whenLabel, withoutFolder,
} from './websiteHub.js';

const MB = 1024 * 1024;
const BAB = Math.round(4.2 * MB);
const REPOSITORY = Math.round(1.4 * 1024 * MB);
const ANSWER = {
  ok: true,
  address: 'https://news.example.org/',
  home: 'yours',
  items: [
    { folder: 'bab', address: 'https://news.example.org/bab/', title: 'The Bab front', summary: 'S', date: '2026-11-20', date_label: '20 November 2026',
      category: 'Conflict Watch', role: 'article', layout: 'story', image: 'https://news.example.org/bab/cover.jpg', bytes: BAB },
    { folder: 'bab-map', address: 'https://news.example.org/bab-map/', title: 'On one map', date: '2026-11-20', category: '', role: 'article', layout: 'map', image: '', bytes: 3 * MB },
    { folder: 'old', address: 'https://news.example.org/old/', title: 'Old', date: '2026-01-05', category: 'Methods', role: 'article', layout: 'article', image: '', bytes: 100 },
    { folder: 'about', address: 'https://news.example.org/about/', title: 'About', date: '2026-01-01', role: 'page', layout: 'article', image: '', bytes: 2048 },
    { folder: 'draft', address: 'https://news.example.org/draft/', title: 'Draft', date: '2026-02-01', category: 'Methods', role: 'unlisted', layout: 'article', image: '', bytes: 50 },
    { folder: 'legal-notice', address: 'https://news.example.org/legal-notice/', title: 'Legal notice', date: '2026-01-02', role: 'page', layout: 'article', image: '', bytes: 10 },
  ],
  categories: [{ name: 'Conflict Watch', count: 1, pages: ['conflict-watch/'] }, { name: 'Methods', count: 1, pages: [] }],
  marked: ['', 'conflict-watch/'],
  legal: 'legal-notice/',
  privacy: '',
  last: { date: '2026-11-21T13:55:52Z', message: 'Update the site' },
  size: { site: 300 * MB, repository: REPOSITORY },
  warnings: ['One thing to mind.'],
};

describe('the read, as the hub holds it', () => {
  it('keeps every field a panel shows, bounded and typed', () => {
    const read = siteReadOf(ANSWER);
    expect(read.address).toBe('https://news.example.org/');
    expect(read.home).toBe('yours');
    expect(read.items).toHaveLength(6);
    expect(read.items[0]).toMatchObject({ folder: 'bab', title: 'The Bab front', dateLabel: '20 November 2026', category: 'Conflict Watch', role: 'article',
      layout: 'story', image: 'https://news.example.org/bab/cover.jpg' });
    expect(read.categories).toEqual(ANSWER.categories);
    expect(read.marked).toEqual(['', 'conflict-watch/']);
    expect(read.legal).toBe('legal-notice/');
    expect(read.last).toEqual({ date: '2026-11-21T13:55:52Z', message: 'Update the site' });
    expect(read.size).toEqual({ site: 300 * MB, repository: REPOSITORY });
    expect(read.warnings).toEqual(['One thing to mind.']);
  });

  it('reads what the server left out as nothing, never as an error', () => {
    const read = siteReadOf({ ok: true });
    expect(read).toMatchObject({ address: '', home: 'none', items: [], categories: [], marked: [], legal: '', privacy: '', last: null, warnings: [] });
    // a weight that is not given is not a weight of zero
    expect(read.size).toEqual({ site: null, repository: null });
    expect(siteReadOf(null).items).toEqual([]);
    expect(siteReadOf({ size: { site: 0, repository: null } }).size).toEqual({ site: 0, repository: null });
  });

  it('drops an entry with no folder or a path, refuses an address that is no web link, and defaults an unknown kind', () => {
    const read = siteReadOf({ items: [
      { folder: '' }, { folder: 'a/b', title: 'Nested' }, null,
      { folder: 'x', address: 'javascript:alert(1)', image: 'data:image/png;base64,AA', role: 'secret', layout: 'wide', title: '' },
    ] });
    expect(read.items).toHaveLength(1);
    expect(read.items[0]).toMatchObject({ folder: 'x', address: '', image: '', role: 'article', layout: 'article', title: 'x', bytes: null });
  });

  it('takes a folder out of the read: its row, the category it was alone in, the page it was, and its weight', () => {
    const read = siteReadOf(ANSWER);
    const without = withoutFolder(read, 'bab');
    expect(without.items.map((item) => item.folder)).not.toContain('bab');
    // Conflict Watch had nothing else listed
    expect(without.categories.map((entry) => entry.name)).toEqual(['Methods']);
    expect(without.size.site).toBe(300 * MB - BAB);
    const noLegal = withoutFolder(read, 'legal-notice');
    expect(noLegal.legal).toBe('');
    // an unlisted draft was never counted in a category
    expect(withoutFolder(read, 'draft').categories).toEqual(read.categories);
    expect(withoutFolder(null, 'x')).toBeNull();
  });
});

describe('kinds, chips and counts', () => {
  const read = siteReadOf(ANSWER);

  it('calls a card what it is: unlisted and page win over a map, a map over an article', () => {
    expect(read.items.map(kindOf)).toEqual(['article', 'map', 'article', 'page', 'unlisted', 'page']);
    expect(countsOf(read.items)).toEqual({ article: 2, map: 1, page: 2, unlisted: 1 });
    expect(countsLine(read.items)).toBe('2 articles · 1 map · 2 pages · 1 unlisted');
    expect(countsLine(read.items.slice(0, 1))).toBe('1 article');
    expect(countsLine([])).toBe('Nothing listed yet');
  });

  it('offers All, each category, then Maps, Pages and Unlisted only when there are some', () => {
    expect(chipsOf(read).map((chip) => [chip.id, chip.count])).toEqual([
      ['all', 6], ['category:Conflict Watch', 1], ['category:Methods', 1], ['map', 1], ['page', 2], ['unlisted', 1]]);
    const plain = siteReadOf({ items: [{ folder: 'a', category: 'X', role: 'article' }], categories: [{ name: 'X', count: 1, pages: [] }] });
    expect(chipsOf(plain).map((chip) => chip.id)).toEqual(['all', 'category:X']);
    expect(chipsOf(null)).toEqual([]);
  });

  it('keeps what a chip names: a category lists its listed articles only, never an unlisted one', () => {
    expect(itemsFor(read, 'all')).toHaveLength(6);
    expect(itemsFor(read, 'category:Methods').map((item) => item.folder)).toEqual(['old']);
    expect(itemsFor(read, 'map').map((item) => item.folder)).toEqual(['bab-map']);
    expect(itemsFor(read, 'page').map((item) => item.folder)).toEqual(['about', 'legal-notice']);
    expect(itemsFor(read, 'unlisted').map((item) => item.folder)).toEqual(['draft']);
    expect(itemsFor(read, 'gone')).toEqual([]);
    expect(itemsFor(null, 'all')).toEqual([]);
  });
});

describe('weights', () => {
  it('writes a size as GitHub counts it, one decimal under ten', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(BAB)).toBe('4.2 MB');
    expect(formatBytes(312 * MB)).toBe('312 MB');
    expect(formatBytes(REPOSITORY)).toBe('1.4 GB');
    expect(formatBytes(1024 * MB)).toBe('1 GB');
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(undefined)).toBe('');
  });

  it('turns amber from 80 % and red from 95 % of the gigabyte', () => {
    const gb = 1024 * MB;
    const at = (share) => levelOf(shareOf(Math.ceil(share * gb)));
    expect(at(0.79)).toBe('ok');
    expect(at(0.8)).toBe('warn');
    expect(at(0.94)).toBe('warn');
    expect(at(0.95)).toBe('danger');
    expect(at(1.4)).toBe('danger');
    expect(shareOf(null)).toBe(0);
    expect(percentOf(shareOf(312 * MB))).toBe(30);
    expect(percentOf(0.001)).toBe(1);
    expect(percentOf(0)).toBe(0);
  });
});

describe('dates', () => {
  const now = new Date(2026, 10, 21, 14, 2);

  it('says today, yesterday, a day this year and a day of another year', () => {
    expect(whenLabel(new Date(2026, 10, 21, 13, 5), now)).toBe('today at 13:05');
    expect(whenLabel(new Date(2026, 10, 20, 9, 0), now)).toBe('yesterday at 09:00');
    expect(whenLabel(new Date(2026, 2, 12, 18, 30), now)).toBe('12 Mar at 18:30');
    expect(whenLabel(new Date(2025, 2, 12, 18, 30), now)).toBe('12 Mar 2025');
    expect(whenLabel('not a date', now)).toBe('');
    expect(whenLabel('', now)).toBe('');
  });
});

describe('the name and the address', () => {
  it('takes the typed name, else the Publishing name, else the account', () => {
    expect(siteName({ title: '  Open   Desk ', report: 'A. Analyst', account: 'octo' })).toBe('Open Desk');
    expect(siteName({ report: 'A. Analyst', account: 'octo' })).toBe('A. Analyst');
    expect(siteName({ account: 'octo' })).toBe('octo');
    expect(siteName()).toBe('');
  });

  it('works a host, a path and an address on the site out of what it is given', () => {
    expect(hostOf('https://news.example.org/x/')).toBe('news.example.org');
    expect(hostOf('')).toBe('');
    expect(pathOf({ address: 'https://news.example.org/2026/08/x/', folder: 'x' })).toBe('/2026/08/x/');
    expect(pathOf({ address: '', folder: 'x' })).toBe('/x/');
    expect(onSite('https://news.example.org/', 'feed.xml')).toBe('https://news.example.org/feed.xml');
    expect(onSite('https://octo.github.io/articles', 'sitemap.xml')).toBe('https://octo.github.io/articles/sitemap.xml');
    expect(onSite('', 'feed.xml')).toBe('');
    expect(ownDomain('https://news.example.org/')).toBe(true);
    expect(ownDomain('https://octo.github.io/articles/')).toBe(false);
    expect(ownDomain('')).toBe(false);
  });
});

describe('the checklist', () => {
  const github = { account: 'octo', repo: 'articles', branch: 'main' };
  const base = { ready: true, github, title: 'Octo Desk', fallback: 'octo', siteLogo: false, logoFrom: 'publishing', counting: '', stats: '', read: null };
  const byId = (steps) => Object.fromEntries(steps.map((step) => [step.id, step]));

  it('says each state and where it is set, and asks for a read of what it cannot tell', () => {
    const steps = byId(checklist(base));
    expect(steps.hosting).toMatchObject({ state: 'done', said: 'octo/articles on main', go: 'hosting' });
    expect(steps.name).toMatchObject({ state: 'done', said: 'Octo Desk', go: 'identity' });
    expect(steps.logo).toMatchObject({ state: 'todo', said: 'Uses your Publishing logo for now.', go: 'identity' });
    expect(steps.readers).toMatchObject({ state: 'todo', optional: true, said: 'Nobody is counted.', go: 'readers' });
    expect(steps.legal).toMatchObject({ state: 'unknown', optional: true, needsRead: true, go: 'articles' });
    expect(steps.first).toMatchObject({ state: 'unknown', needsRead: true, go: 'articles' });
    expect(progressOf(checklist(base))).toEqual({ done: 2, total: 6, unknown: 2 });
  });

  it('says what is left to do while nothing is set', () => {
    const steps = byId(checklist({ ...base, ready: false, title: '', logoFrom: '', stats: 'cloudflare' }));
    expect(steps.hosting).toMatchObject({ state: 'todo', said: 'Add the account, the repository and the token.' });
    expect(steps.name).toMatchObject({ state: 'todo', said: 'It shows as octo for now.' });
    expect(steps.logo.said).toBe('No logo yet.');
    expect(steps.readers.said).toBe('Cloudflare Web Analytics is picked: paste its token.');
    expect(checklist({ ...base, title: '', fallback: '' }).find((step) => step.id === 'name').said).toBe('It has no name yet.');
  });

  it('is done once the site is read and holds the page and an article, and a logo of its own is set', () => {
    const read = siteReadOf(ANSWER);
    const steps = byId(checklist({ ...base, siteLogo: true, logoFrom: 'site', counting: 'goatcounter', stats: 'goatcounter', read }));
    expect(steps.logo).toMatchObject({ state: 'done', said: 'A logo of its own.' });
    expect(steps.readers).toMatchObject({ state: 'done', said: 'GoatCounter' });
    expect(steps.legal).toMatchObject({ state: 'done', said: 'legal-notice/ is on the site' });
    expect(steps.first).toMatchObject({ state: 'done', said: '3 articles on the site' });
    expect(progressOf(Object.values(steps))).toEqual({ done: 6, total: 6, unknown: 0 });
    // a read with nothing on the site: still to do, and said so
    const empty = byId(checklist({ ...base, read: siteReadOf({ ok: true }) }));
    expect(empty.legal).toMatchObject({ state: 'todo', said: 'No legal notice page on the site yet.' });
    expect(empty.first).toMatchObject({ state: 'todo', said: 'Nothing is listed on the site yet.' });
  });

  it('counts readers only when the choice has its code or token', () => {
    expect(countingOf({ siteStats: 'goatcounter', siteStatsCode: 'desk', siteStatsToken: '' })).toBe('goatcounter');
    expect(countingOf({ siteStats: 'goatcounter', siteStatsCode: '', siteStatsToken: 'abcd1234' })).toBe('');
    expect(countingOf({ siteStats: 'cloudflare', siteStatsCode: '', siteStatsToken: 'abcd1234' })).toBe('cloudflare');
    expect(countingOf({ siteStats: '', siteStatsCode: 'desk', siteStatsToken: 'abcd1234' })).toBe('');
  });
});

describe('who writes what', () => {
  it('shows the default home as Azimut\'s until the analyst writes one, and lists the pages the read found marked', () => {
    const unread = ownersOf(null);
    expect(unread.find((row) => row.files[0] === 'index.html')).toMatchObject({ who: 'Azimut' });
    expect(unread.some((row) => row.files.includes('conflict-watch/'))).toBe(false);
    const read = ownersOf(siteReadOf(ANSWER));
    expect(read.find((row) => row.files[0] === 'index.html')).toMatchObject({ who: 'You', text: 'Fills the list between its markers, nothing else.' });
    expect(read.find((row) => row.files.includes('conflict-watch/'))).toMatchObject({ files: ['conflict-watch/'], who: 'You' });
    expect(read.at(-1)).toMatchObject({ files: ['everything else'], who: 'You', text: 'Never touches it.' });
    expect(read[0].files).toEqual(['each article\'s folder']);
  });
});
