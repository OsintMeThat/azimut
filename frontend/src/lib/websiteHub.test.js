import { describe, expect, it } from 'vitest';
import {
  bareAddress, chipsOf, countingOf, countsOf, formatBytes, hostOf, itemsFor, kindOf, levelOf, onSite, ownDomain, pathOf, percentOf, shareOf, siteName,
  siteReadOf, withoutFolder,
} from './websiteHub.js';
import { addProblem, carrying, categoriesFrom, categoryChoices, categoryRows, countryOf, numbersOf, numbersRows, withCategories } from './websiteHub.js';

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
      place: null, author: '', authorImage: '' });
    expect(read.categories).toEqual(ANSWER.categories);
  });

  it('keeps who a row is by and their picture, a picture only as a web address', () => {
    const row = (more) => siteReadOf({ items: [card('guest', more)] }).items[0];
    expect(row({ author: '  Jane   Guest ', author_image: 'https://news.example.org/guest/author.jpg' }))
      .toMatchObject({ author: 'Jane Guest', authorImage: 'https://news.example.org/guest/author.jpg' });
    expect(row({ author_image: 'javascript:alert(1)' }).authorImage).toBe('');
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

  it('says whose bar the articles carry: the site\'s own only when the server says so', () => {
    expect(siteReadOf({ ...ANSWER, bar: 'yours' }).bar).toBe('yours');
    for (const bar of ['azimut', undefined, 'mine', true]) expect(siteReadOf({ ...ANSWER, bar }).bar, String(bar)).toBe('azimut');
  });

  it('counts the pages still on an old address, nothing for what is not a count', () => {
    expect(siteReadOf({ ...ANSWER, old_address: 3 }).oldAddress).toBe(3);
    for (const given of [undefined, null, -1, 'many', true]) expect(siteReadOf({ ...ANSWER, old_address: given }).oldAddress, String(given)).toBe(0);
  });

  it('says whose footer the articles carry: the site\'s own only when the server says so, else none', () => {
    expect(siteReadOf({ ...ANSWER, footer: 'yours' }).footer).toBe('yours');
    for (const footer of ['none', undefined, 'azimut', true]) expect(siteReadOf({ ...ANSWER, footer }).footer, String(footer)).toBe('none');
  });

  it('reads what the server left out as nothing, never as an error', () => {
    const read = siteReadOf({ ok: true });
    expect(read).toMatchObject({ address: '', home: 'none', bar: 'azimut', footer: 'none', items: [], categories: [], marked: [], legal: '', privacy: '', last: null,
      oldAddress: 0, warnings: [] });
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
    // its last article gone, a category its page names stays, with none
    expect(withoutFolder(without, 'bab-map').categories).toEqual([{ name: 'Methods', count: 1, pages: [] },
      { name: 'Conflict Watch', count: 0, pages: ['conflict-watch/'] }]);
    expect(withoutFolder(read, '2026/01/05/old').categories.map((entry) => entry.name)).toEqual(['Conflict Watch']);
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

describe('the numbers', () => {
  const counts = (views, visits = views) => ({ views, visits });
  const page = (path, pageName, week, month) => ({ path, page: pageName, week: counts(week), month: counts(month) });
  const ANSWER_NUMBERS = {
    ok: true,
    address: 'https://news.example.org/',
    pages: [
      page('/bab/', 'bab/', 40, 120), page('/bab/map.html', 'bab/map.html', 2, 9), page('/', '', 8, 12),
      page('/2026/01/05/old/', '2026/01/05/old/', 0, 30), page('/2026/', '2026/', 1, 1), page('/lost/', 'lost/', 3, 4), page('/away/', null, 0, 2),
      { path: 'no slash', page: 'x', week: counts(1), month: counts(1) }, { page: 'x' },
    ],
    total: { week: counts(53, 39), month: counts(176, 128) },
    referrers: [{ host: '', views: 40, visits: 40 }, { host: 'news.ycombinator.com', views: 30, visits: 55 }, { host: 'quiet.example', views: 3, visits: 0 }],
    countries: [{ country: 'FR', views: 80, visits: 60 }],
    sampled: true,
  };

  it('reads what the server answers, what it left out as nothing', () => {
    const numbers = numbersOf(ANSWER_NUMBERS);
    expect(numbers.pages).toHaveLength(7);
    expect(numbers.total).toEqual({ week: counts(53, 39), month: counts(176, 128) });
    // ranked by the visits they sent, and one that sent none left out
    expect(numbers.referrers.map((one) => one.host)).toEqual(['news.ycombinator.com', '']);
    expect(numbers.countries).toEqual([{ country: 'FR', views: 80, visits: 60 }]);
    expect(numbers.sampled).toBe(true);
    expect(numbersOf(null)).toEqual({ address: '', pages: [], total: { week: counts(0), month: counts(0) }, referrers: [], countries: [], sampled: false });
    expect(numbersOf({ pages: [{ path: '/x/', page: 'x/', week: { views: -2, visits: 'a' }, month: { views: '7' } }] }).pages[0])
      .toEqual({ path: '/x/', page: 'x/', week: counts(0), month: { views: 7, visits: 0 } });
  });

  it('names each page by the article the read of the site holds it in, sums an article\'s pages, and ranks by 30 days', () => {
    const rows = numbersRows(numbersOf(ANSWER_NUMBERS), siteReadOf(ANSWER), 'https://news.example.org/');
    expect(rows.map((row) => [row.title, row.href, row.week.views, row.month.views, row.known])).toEqual([
      ['The Bab front', 'https://news.example.org/bab/', 42, 129, true],
      // a nested folder is its own article, not its parent's
      ['Old', 'https://news.example.org/2026/01/05/old/', 0, 30, true],
      ['Home page', 'https://news.example.org/', 8, 12, true],
      ['/lost/', 'https://news.example.org/lost/', 3, 4, false],
      ['/away/', 'https://news.example.org/away/', 0, 2, false],
      ['/2026/', 'https://news.example.org/2026/', 1, 1, false],
    ]);
  });

  it('falls back to each page\'s path with no read, and to no link with no address', () => {
    const rows = numbersRows(numbersOf({ ...ANSWER_NUMBERS, address: '' }), null, '');
    expect(rows[0]).toMatchObject({ title: '/bab/', href: '', known: false });
    expect(rows.find((row) => row.key === 'home')).toMatchObject({ title: 'Home page', href: '' });
    // the server's address serves when the panel has none
    expect(numbersRows(numbersOf(ANSWER_NUMBERS), null, '')[0].href).toBe('https://news.example.org/bab/');
    expect(numbersRows(null)).toEqual([]);
  });

  it('says a country by its name, and what is no code as it came', () => {
    expect(countryOf('FR')).toBe('France');
    expect(countryOf('us')).toBe('United States');
    expect(countryOf('')).toBe('Unknown');
    expect(countryOf('Somewhere')).toBe('Somewhere');
  });
});

describe('the categories, changed from the hub', () => {
  const read = siteReadOf(ANSWER);

  it('counts the listed articles of each, most first, then the ones a page names with none', () => {
    const items = [{ role: 'article', category: 'b' }, { role: 'article', category: 'A' }, { role: 'article', category: 'b' },
      { role: 'unlisted', category: 'Secret' }, { role: 'page', category: 'Pages' }, { role: 'article', category: '' }];
    expect(categoriesFrom(items, { Deep: ['deep/'], b: ['b/'], Gone: [] })).toEqual([
      { name: 'b', count: 2, pages: ['b/'] }, { name: 'A', count: 1, pages: [] }, { name: 'Deep', count: 0, pages: ['deep/'] }]);
    expect(categoriesFrom([], {})).toEqual([]);
  });

  it('follows a rename, a delete and one article moved, as the next read would', () => {
    const renamed = withCategories(read, { kind: 'rename', name: 'Methods', to: 'How-to' });
    // every card that carried it, the unlisted draft too, which counts nowhere
    expect(renamed.items.filter((item) => item.category === 'How-to').map((item) => item.folder)).toEqual(['2026/01/05/old', 'draft']);
    expect(renamed.categories).toEqual([{ name: 'Conflict Watch', count: 2, pages: ['conflict-watch/'] }, { name: 'How-to', count: 1, pages: [] }]);
    const deleted = withCategories(read, { kind: 'delete', name: 'Conflict Watch' });
    expect(deleted.items.filter((item) => item.category === 'Conflict Watch')).toEqual([]);
    // the page that names it still does
    expect(deleted.categories).toEqual([{ name: 'Methods', count: 1, pages: [] }, { name: 'Conflict Watch', count: 0, pages: ['conflict-watch/'] }]);
    const moved = withCategories(read, { kind: 'move', folder: 'bab', to: '  Methods ' });
    expect(moved.items.find((item) => item.folder === 'bab').category).toBe('Methods');
    expect(moved.categories.map((entry) => [entry.name, entry.count])).toEqual([['Methods', 2], ['Conflict Watch', 1]]);
    expect(withCategories(read, { kind: 'move', folder: 'bab', to: '' }).items[0].category).toBe('');
    expect(withCategories(null, { kind: 'delete', name: 'x' })).toBeNull();
    expect(withCategories(read, null)).toBe(read);
  });

  it('counts every card a rename or a delete changes, whatever its kind', () => {
    expect(carrying(read, 'Methods')).toBe(2);
    expect(carrying(read, 'Nowhere')).toBe(0);
    expect(carrying(null, 'Methods')).toBe(0);
  });

  it('lists the site\'s categories, then the ones added here that the site does not hold, case aside', () => {
    expect(categoryRows(read, ['Harbour', 'methods']).map((row) => [row.name, row.count, row.added])).toEqual([
      ['Conflict Watch', 2, false], ['Methods', 1, false], ['Harbour', 0, true]]);
    // no read, or one cut short: only the added ones
    expect(categoryRows(null, ['Harbour']).map((row) => row.name)).toEqual(['Harbour']);
    expect(categoryRows({ ...read, truncated: true }, []).length).toBe(0);
    expect(categoryChoices(read, ['Harbour'])).toEqual(['Conflict Watch', 'Methods', 'Harbour']);
  });

  it('says what a name typed to add is up against', () => {
    expect(addProblem('  ', read, [])).toBe('empty');
    expect(addProblem('conflict  WATCH', read, [])).toBe('site');
    expect(addProblem('harbour', read, ['Harbour'])).toBe('added');
    expect(addProblem('Bridges', read, ['Harbour'])).toBe('');
    expect(addProblem('Bridges', null)).toBe('');
  });
});
