import { describe, expect, it } from 'vitest';
import {
  bareAddress, chipsOf, countingOf, countsOf, formatBytes, hostOf, itemsFor, kindOf, levelOf, onSite, ownDomain, pathOf, percentOf, shareOf, siteName,
  siteReadOf, withoutFolder,
} from './websiteHub.js';

const MB = 1024 * 1024;
const BAB = Math.round(4.2 * MB);
const REPOSITORY = Math.round(1.4 * 1024 * MB);
const card = (folder, more = {}) => ({ folder, address: `https://news.example.org/${folder}/`, title: folder, date: '2026-01-01', role: 'article', layout: 'article',
  image: '', bytes: 100, deletable: true, ...more });
const ANSWER = {
  ok: true,
  address: 'https://news.example.org/',
  home: 'yours',
  items: [
    card('bab', { title: 'The Bab front', summary: 'S', date: '2026-11-20', date_label: '20 November 2026', category: 'Conflict Watch', layout: 'story',
      image: 'https://news.example.org/bab/cover.jpg', bytes: BAB }),
    card('bab-map', { title: 'On one map', layout: 'map', bytes: 3 * MB, category: 'Conflict Watch' }),
    card('2026/01/05/old', { title: 'Old', category: 'Methods', deletable: false }),
    card('about', { title: 'About', role: 'page', bytes: 2048 }),
    card('draft', { title: 'Draft', category: 'Methods', role: 'unlisted', bytes: 50 }),
    card('legal-notice', { title: 'Legal notice', role: 'page', bytes: 10 }),
  ],
  categories: [{ name: 'Conflict Watch', count: 2, pages: ['conflict-watch/'] }, { name: 'Methods', count: 1, pages: [] }],
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
    expect(read).toMatchObject({ address: 'https://news.example.org/', home: 'yours', truncated: false, marked: ['', 'conflict-watch/'], legal: 'legal-notice/',
      privacy: '', last: { date: '2026-11-21T13:55:52Z', message: 'Update the site' }, size: { site: 300 * MB, repository: REPOSITORY },
      warnings: ['One thing to mind.'] });
    expect(read.items).toHaveLength(6);
    expect(read.items[0]).toEqual({ folder: 'bab', deletable: true, address: 'https://news.example.org/bab/', title: 'The Bab front', date: '2026-11-20',
      dateLabel: '20 November 2026', category: 'Conflict Watch', role: 'article', layout: 'story', image: 'https://news.example.org/bab/cover.jpg', bytes: BAB,
      place: null });
    expect(read.categories).toEqual(ANSWER.categories);
  });

  it('keeps a row\'s place on the site\'s map when it reads as one, and none otherwise', () => {
    const placed = (place) => siteReadOf({ items: [card('bab', { place })] }).items[0].place;
    expect(placed({ lat: 12.7250041, lon: 43.5075, name: '  Bab al-Mandab,  Yemen ' })).toEqual({ lat: 12.725004, lon: 43.5075, name: 'Bab al-Mandab, Yemen' });
    expect(placed({ lat: -33.9, lon: 18.42 })).toEqual({ lat: -33.9, lon: 18.42, name: '' });
    for (const bad of [undefined, null, '12.7, 43.5', { lat: '12.7', lon: 43.5 }, { lat: 88, lon: 1 }, { lat: 1, lon: 181 }, { lat: Number.NaN, lon: 1 }]) {
      expect(placed(bad)).toBeNull();
    }
  });

  it('keeps a folder nested as a WordPress export lays it out, and whether the server would delete it', () => {
    const read = siteReadOf(ANSWER);
    expect(read.items[2]).toMatchObject({ folder: '2026/01/05/old', deletable: false });
    // only a plain true deletes: anything else the server did not say
    expect(siteReadOf({ items: [{ folder: 'x', deletable: 'yes' }, { folder: 'y' }] }).items.map((item) => item.deletable)).toEqual([false, false]);
  });

  it('reads what the server left out as nothing, never as an error', () => {
    const read = siteReadOf({ ok: true });
    expect(read).toMatchObject({ address: '', home: 'none', items: [], categories: [], marked: [], legal: '', privacy: '', last: null, warnings: [] });
    // a weight that is not given is not a weight of zero, and not a site cut short either
    expect(read.size).toEqual({ site: null, repository: null });
    expect(read.truncated).toBe(false);
    expect(siteReadOf(null).items).toEqual([]);
    expect(siteReadOf({ size: { site: 0, repository: null } }).size).toEqual({ site: 0, repository: null });
  });

  it('knows a read GitHub cut short by its size, which is null then', () => {
    const read = siteReadOf({ ok: true, home: 'none', items: [], size: { site: null, repository: 2048 }, warnings: ['Too many files.'] });
    expect(read.truncated).toBe(true);
    expect(read.size).toEqual({ site: null, repository: 2048 });
    expect(read.warnings).toEqual(['Too many files.']);
  });

  it('drops an entry with no folder, refuses an address that is no web link, and defaults an unknown kind', () => {
    const read = siteReadOf({ items: [
      { folder: '' }, { folder: '/' }, null,
      { folder: 'x', address: 'javascript:alert(1)', image: 'data:image/png;base64,AA', role: 'secret', layout: 'wide', title: '', bytes: -1 },
    ] });
    expect(read.items).toHaveLength(1);
    expect(read.items[0]).toMatchObject({ folder: 'x', address: '', image: '', role: 'article', layout: 'article', title: 'x', bytes: null });
  });

  it('takes a folder out of the read: its row, the category it was alone in, the page it was, and its weight', () => {
    const read = siteReadOf(ANSWER);
    const without = withoutFolder(read, 'bab');
    expect(without.items.map((item) => item.folder)).not.toContain('bab');
    // Conflict Watch keeps its map, counted again
    expect(without.categories).toEqual([{ name: 'Conflict Watch', count: 1, pages: ['conflict-watch/'] }, { name: 'Methods', count: 1, pages: [] }]);
    expect(without.size.site).toBe(300 * MB - BAB);
    expect(withoutFolder(without, 'bab-map').categories.map((entry) => entry.name)).toEqual(['Methods']);
    expect(withoutFolder(read, 'legal-notice').legal).toBe('');
    // an unlisted draft was never counted in a category
    expect(withoutFolder(read, 'draft').categories).toEqual(read.categories);
    // a folder the read does not hold changes nothing
    expect(withoutFolder(read, 'nowhere')).toBe(read);
    expect(withoutFolder(null, 'x')).toBeNull();
  });
});

describe('kinds, chips and counts', () => {
  const read = siteReadOf(ANSWER);

  it('calls a card what it is: unlisted and page win over a map, a map over an article', () => {
    expect(read.items.map(kindOf)).toEqual(['article', 'map', 'article', 'page', 'unlisted', 'page']);
    expect(kindOf({ role: 'unlisted', layout: 'map' })).toBe('unlisted');
    expect(kindOf({ role: 'page', layout: 'map' })).toBe('page');
    expect(countsOf(read.items)).toEqual({ article: 2, map: 1, page: 2, unlisted: 1 });
  });

  it('offers All, each category, then Maps, Pages and Unlisted only when there are some, each counting its rows', () => {
    expect(chipsOf(read)).toEqual([
      { id: 'all', label: 'All', count: 6 },
      { id: 'category:Conflict Watch', label: 'Conflict Watch', count: 2 },
      { id: 'category:Methods', label: 'Methods', count: 1 },
      { id: 'map', label: 'Maps', count: 1 },
      { id: 'page', label: 'Pages', count: 2 },
      { id: 'unlisted', label: 'Unlisted', count: 1 },
    ]);
    expect(chipsOf(siteReadOf({ items: [card('a')] })).map((chip) => chip.id)).toEqual(['all']);
    // no chips before a read, for a site that lists nothing, or for one GitHub cut short
    expect(chipsOf(null)).toEqual([]);
    expect(chipsOf(siteReadOf({ items: [] }))).toEqual([]);
    expect(chipsOf(siteReadOf({ size: { site: null } }))).toEqual([]);
  });

  it('keeps what a chip names: a category its listed articles and maps, never an unlisted one', () => {
    expect(itemsFor(read, 'all')).toHaveLength(6);
    expect(itemsFor(read, undefined)).toHaveLength(6);
    expect(itemsFor(read, 'category:Methods').map((item) => item.folder)).toEqual(['2026/01/05/old']);
    expect(itemsFor(read, 'category:Conflict Watch').map((item) => item.folder)).toEqual(['bab', 'bab-map']);
    expect(itemsFor(read, 'map').map((item) => item.folder)).toEqual(['bab-map']);
    expect(itemsFor(read, 'unlisted').map((item) => item.folder)).toEqual(['draft']);
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
    for (const none of [null, undefined, -1, Number.NaN]) expect(formatBytes(none)).toBe('');
  });

  it('turns amber from 80 % and red from 95 % of the gigabyte', () => {
    const GB = 1024 * MB;
    expect(levelOf(shareOf(312 * MB))).toBe('ok');
    expect(levelOf(shareOf(0.79 * GB))).toBe('ok');
    expect(levelOf(shareOf(0.8 * GB))).toBe('warn');
    expect(levelOf(shareOf(0.95 * GB))).toBe('danger');
    expect(levelOf(shareOf(1.4 * GB))).toBe('danger');
    expect(shareOf(null)).toBe(0);
    expect(percentOf(shareOf(312 * MB))).toBe(30);
    expect(percentOf(shareOf(1000))).toBe(1);
    expect(percentOf(0)).toBe(0);
    expect(percentOf(shareOf(1.4 * GB))).toBe(140);
  });
});

describe('the name, the address and the counter', () => {
  it('takes the typed name, else the Publishing name, else the account', () => {
    expect(siteName({ title: '  Open  Desk ', report: 'A. Analyst', account: 'octo' })).toBe('Open Desk');
    expect(siteName({ title: '', report: 'A. Analyst', account: 'octo' })).toBe('A. Analyst');
    expect(siteName({ account: 'octo' })).toBe('octo');
    expect(siteName()).toBe('');
  });

  it('works a host, a path and an address on the site out of what it is given', () => {
    expect(hostOf('https://octo.github.io/articles/')).toBe('octo.github.io');
    expect(hostOf('')).toBe('');
    expect(bareAddress('https://octo.github.io/articles/')).toBe('octo.github.io/articles');
    expect(pathOf({ address: 'https://octo.github.io/articles/bab/', folder: 'bab' })).toBe('/articles/bab/');
    expect(pathOf({ address: '', folder: 'bab' })).toBe('/bab/');
    expect(onSite('https://octo.github.io/articles/', 'feed.xml')).toBe('https://octo.github.io/articles/feed.xml');
    expect(onSite('', 'feed.xml')).toBe('');
    expect(ownDomain('https://osintmethat.com/')).toBe(true);
    expect(ownDomain('https://octo.github.io/articles/')).toBe(false);
    expect(ownDomain('')).toBe(false);
  });

  it('counts readers only when the choice has its code or token', () => {
    expect(countingOf({ siteStats: '', siteStatsCode: 'desk', siteStatsToken: '' })).toBe('');
    expect(countingOf({ siteStats: 'goatcounter', siteStatsCode: '', siteStatsToken: 'x' })).toBe('');
    expect(countingOf({ siteStats: 'goatcounter', siteStatsCode: 'desk', siteStatsToken: '' })).toBe('goatcounter');
    expect(countingOf({ siteStats: 'cloudflare', siteStatsCode: '', siteStatsToken: 'abcd1234' })).toBe('cloudflare');
  });
});
