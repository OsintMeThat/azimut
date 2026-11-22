// @vitest-environment happy-dom
/**
 * Settings › Website › Readers › Numbers, mounted: nothing is asked of Cloudflare until Read the numbers
 * is pressed; the account ID and the API token set field by field, each checked before it is sent, the
 * token never shown again but its last characters; the site tag found by the press and shown, or typed by
 * hand under its fold, which opens when the press could not find it; the press reading (disabled, a
 * spinner, Reading…), then the whole site, each article named by the session's read of the site and
 * linked, the referrers and the countries; an empty answer, a refusal, and GoatCounter sending its reader
 * elsewhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post, put, del } }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams: vi.fn(), asSvg: (svg) => svg }));
const toast = vi.fn();
vi.mock('../../lib/state.svelte.js', async (original) => ({ ...(await original()), toast }));
const { applyPrefs, caseState, prefs, uiState } = await import('../../lib/state.svelte.js');
const { forgetRead, siteRead } = await import('../../lib/siteRead.svelte.js');
const { forgetNumbers, siteNumbers } = await import('../../lib/siteNumbers.svelte.js');
const { siteReadOf } = await import('../../lib/websiteHub.js');
const { default: WebsiteTab } = await import('./WebsiteTab.svelte');
const { NUMBERS_NONE, NUMBERS_NOT_SET, NUMBERS_SAMPLED, NUMBERS_GOATCOUNTER, TAG_FOUND_HINT } = await import('../../lib/websiteSetup.js');

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TAG = 'fedcba9876543210fedcba9876543210';
const API_TOKEN = 'Cf_' + 'k'.repeat(37);
const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
  token: { set: true, hint: '…wxyz' }, website: { title: 'octo', logo: false, logo_from: '', counting: 'cloudflare' }, categories: [] };
const item = (folder, title) => ({ folder, address: `https://octo.github.io/articles/${folder}/`, title, summary: '', date: '2026-11-20',
  date_label: '20 November 2026', category: '', role: 'article', layout: 'article', image: '', bytes: 1000, deletable: true });
const READ = { ok: true, address: 'https://octo.github.io/articles/', home: 'azimut', items: [item('bab', 'The Bab front'), item('guide', 'Installing Azimut')],
  categories: [], marked: [], legal: '', privacy: '', last: null, size: { site: 5000, repository: 9000 }, warnings: [] };
const counts = (views, visits = views) => ({ views, visits });
const NUMBERS = {
  ok: true, address: 'https://octo.github.io/articles/',
  pages: [
    { path: '/articles/bab/', page: 'bab/', week: counts(45, 31), month: counts(1302, 920) },
    { path: '/articles/guide/', page: 'guide/', week: counts(0), month: counts(30, 20) },
    { path: '/articles/', page: '', week: counts(8), month: counts(12) },
    { path: '/articles/lost/', page: 'lost/', week: counts(1), month: counts(3) },
  ],
  total: { week: counts(54, 40), month: counts(1347, 955) },
  referrers: [{ host: 'news.ycombinator.com', views: 30, visits: 30 }, { host: '', views: 40, visits: 40 }],
  countries: [{ country: 'FR', views: 800, visits: 600 }, { country: 'US', views: 500, visits: 300 }],
  sampled: true, read_at: '2026-11-21T12:00:00Z', days: [7, 30], tag: TAG, tag_found: true,
};
const NO_SITE = 'No Web Analytics site in this account has the site token set in Readers.';
/** What the api says of a refusal: the server's detail, and its status. */
const refused = (status, detail) => Object.assign(new Error(detail), { status });

let live;
let target;
let saved;
let kept;
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); flushSync(); };
const card = () => target.querySelector('section[aria-label="Numbers"]');
const press = () => [...card().querySelectorAll('button')].find((node) => /^Read (the numbers|again)/.test(node.textContent.trim()));
const status = () => card().querySelector('.press-line [role="status"]');
const field = (label) => card().querySelector(`input[aria-label="${label}"]`);
/** A fold of the card, by the words of its summary. */
const fold = (words) => [...card().querySelectorAll('details')].find((node) => node.querySelector('summary').textContent.includes(words));
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((node) => node.textContent.trim().startsWith(name));
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

/** What Settings.svelte hands the tab, the server's answer adopted: a tag typed by hand is no found one. */
function savePrefs(patch) {
  const answer = { ...saved, ...patch, ...('site_stats_tag' in patch ? { site_stats_tag_found: false } : {}) };
  saved = answer;
  applyPrefs(answer);
  return Promise.resolve(answer);
}

async function show(more = {}) {
  saved = { ...saved, ...more };
  applyPrefs(saved);
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github: SET, wordpress: { site: '', user: '', password: { set: false, hint: '' } }, cloudflare: { token: kept } };
    return {};
  });
  const props = { prefs, savePrefs: vi.fn(savePrefs) };
  live = mount(WebsiteTab, { target, props });
  await settle();
  tab('Readers').click();
  await settle();
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetRead();
  forgetNumbers();
  kept = { set: false, hint: '' };
  saved = { site_title: '', site_tagline: '', site_credit_azimut: true, site_stats: 'cloudflare', site_stats_code: '', site_stats_token: 'abcd1234',
    site_stats_account: '', site_stats_tag: '', site_stats_tag_found: false, report_name: '', signature: false, site_logo: false };
  caseState.current = null;
  uiState.tool = 'settings';
  target = document.createElement('div');
  target.className = 'settings-pane';
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
  forgetRead();
  forgetNumbers();
});

describe('setting it up', () => {
  it('waits for its three fields, with the steps open, free, and asks nothing of Cloudflare on mount', async () => {
    await show();
    expect(card().getAttribute('data-guide')).toBe('settings.numbers');
    expect(card().querySelector('h3').textContent).toContain('Not set up');
    expect(press().disabled).toBe(true);
    expect(press().getAttribute('title')).toBe(NUMBERS_NOT_SET);
    const steps = fold('How to let Azimut read the numbers');
    expect(steps.open).toBe(true);
    for (const words of ['Copy account ID', 'Account API tokens', 'Create a token', 'azimut-reader-numbers', 'Start from scratch (Custom)',
      'Account Analytics: Read', 'Account Settings: Read', 'shows it once', 'free and only read', 'never in a backup']) {
      expect(steps.textContent, words).toContain(words);
    }
    // the site tag is found by the press: its field waits folded, saying so
    const hand = fold('Set the site tag by hand');
    expect(hand.open).toBe(false);
    expect(hand.querySelector('summary').getAttribute('title')).toBe('Type the site tag yourself, for when Azimut cannot find it');
    expect(hand.textContent).toContain('Left empty, Azimut finds it from the site token.');
    expect(hand.textContent).toContain('siteTag~in=');
    expect(steps.querySelector('a').getAttribute('href')).toBe('https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/');
    // every field says what it is on hover
    for (const label of ['Cloudflare account ID', 'Web Analytics site tag', 'Cloudflare API token']) expect(field(label).getAttribute('title'), label).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(get.mock.calls.every(([path]) => path === '/api/publishing')).toBe(true);
  });

  it('checks the account ID and a site tag typed by hand before saving them, read from the dashboard\'s address too', async () => {
    const { savePrefs: save } = await show();
    type(field('Cloudflare account ID'), 'not an id');
    await settle();
    expect(save).not.toHaveBeenCalledWith(expect.objectContaining({ site_stats_account: expect.anything() }));
    expect(field('Cloudflare account ID').getAttribute('aria-invalid')).toBe('true');
    expect(card().querySelector('[role="alert"]').textContent).toContain('does not read as an account ID');
    type(field('Cloudflare account ID'), ` ${ACCOUNT.toUpperCase()} `);
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats_account: ACCOUNT });
    expect(field('Cloudflare account ID').value).toBe(ACCOUNT);
    expect(card().querySelector('[role="alert"]')).toBeNull();
    type(field('Web Analytics site tag'), `https://dash.cloudflare.com/${ACCOUNT}/web-analytics/overview?siteTag~in=${TAG}`);
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats_tag: TAG });
    expect(field('Web Analytics site tag').value).toBe(TAG);
    // a tag typed by hand stays in sight
    expect(fold('Set the site tag by hand').open).toBe(true);
  });

  it('keeps the API token on this computer, never showing it again but its end, and forgets it on a press', async () => {
    await show({ site_stats_account: ACCOUNT });
    put.mockImplementation(async () => ({ token: { set: true, hint: '…kkkk' } }));
    type(field('Cloudflare API token'), 'too short');
    await settle();
    expect(put).not.toHaveBeenCalled();
    expect(card().querySelector('[role="alert"]').textContent).toContain('does not read as a Cloudflare API token');
    type(field('Cloudflare API token'), ` ${API_TOKEN} `);
    await settle();
    expect(put).toHaveBeenCalledWith('/api/publishing/cloudflare', { token: API_TOKEN });
    expect(field('Cloudflare API token').value).toBe('');
    expect(field('Cloudflare API token').getAttribute('type')).toBe('password');
    expect(card().textContent).toContain('Kept on this computer, ending kkkk.');
    expect(card().textContent).not.toContain(API_TOKEN);
    expect(toast).toHaveBeenCalledWith('API token kept on this computer', 'ok');
    // set up now: the press is ready and the steps fold away
    expect(press().disabled).toBe(false);
    expect(card().querySelector('h3').textContent).toContain('Set up');
    expect(fold('How to let Azimut read the numbers').open).toBe(false);
    del.mockImplementation(async () => ({ token: { set: false, hint: '' } }));
    const forget = [...card().querySelectorAll('button')].find((node) => node.textContent.trim() === 'Forget');
    expect(forget.getAttribute('title')).toBe('Forget the API token on this computer');
    forget.click();
    await settle();
    expect(del).toHaveBeenCalledWith('/api/publishing/cloudflare');
    expect(press().disabled).toBe(true);
  });
});

describe('reading the numbers', () => {
  beforeEach(() => {
    kept = { set: true, hint: '…kkkk' };
  });

  it('reads on the press only: disabled with a spinner while reading, then the site, its articles by title, its referrers and countries', async () => {
    await show({ site_stats_account: ACCOUNT });
    siteRead.data = siteReadOf(READ);
    await settle();
    expect(post).not.toHaveBeenCalled();
    expect(card().textContent).toContain('Press Read the numbers to see what is read, and from where.');
    let answer;
    post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    press().click();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/publishing/cloudflare/numbers');
    expect(press().disabled).toBe(true);
    expect(press().getAttribute('aria-busy')).toBe('true');
    expect(status().getAttribute('data-state')).toBe('busy');
    expect(status().textContent.trim()).toBe('Reading…');
    expect(status().querySelector('.hub-spinner')).not.toBeNull();
    // a second press while reading asks nothing more
    press().click();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    answer(NUMBERS);
    await settle();

    expect(press().disabled).toBe(false);
    expect(press().textContent.trim()).toBe('Read again');
    expect(status().textContent).toMatch(/^Read today at \d\d:\d\d$/);
    const tiles = [...card().querySelectorAll('[aria-label="Whole site"] .tile')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
    expect(tiles).toEqual(['Whole site, 7 days 54 page views · 40 visits', 'Whole site, 30 days 1,347 page views · 955 visits']);
    const table = card().querySelector('table[aria-label="Page views by page"]');
    expect([...table.querySelectorAll('thead th')].map((node) => [node.textContent.trim(), node.getAttribute('title')])).toEqual([
      ['Page', null], ['7 days', 'Page views over the last 7 days'], ['30 days', 'Page views over the last 30 days']]);
    const lines = [...table.querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent.trim()));
    expect(lines).toEqual([['The Bab front', '45', '1,302'], ['Installing Azimut', '0', '30'], ['Home page', '8', '12'], ['/articles/lost/', '1', '3']]);
    const links = [...table.querySelectorAll('tbody a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://octo.github.io/articles/bab/', 'https://octo.github.io/articles/guide/',
      'https://octo.github.io/articles/', 'https://octo.github.io/articles/lost/']);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('title')).toBe('Open this page on the site');
    }
    expect(table.querySelector('tbody tr:last-child').classList.contains('unknown')).toBe(true);
    expect(card().textContent).toContain(NUMBERS_SAMPLED);
    const referrers = card().querySelector('section[aria-label="Where visits came from"]');
    const ranked = (section) => [...section.querySelectorAll('li')].map((node) => [...node.children].map((cell) => cell.textContent.trim()));
    expect(ranked(referrers)).toEqual([['No referrer', '40'], ['news.ycombinator.com', '30']]);
    expect(referrers.querySelector('li .rank-name').classList.contains('quiet-name')).toBe(true);
    const countries = card().querySelector('section[aria-label="Countries"]');
    expect(ranked(countries)).toEqual([['France', '800'], ['United States', '500']]);
    // the tag the server found shows in its field, folded, and the numbers stay
    expect(field('Web Analytics site tag').value).toBe(TAG);
    expect(fold('Set the site tag by hand').open).toBe(false);
    expect(fold('Set the site tag by hand').textContent).toContain(TAG_FOUND_HINT);
    expect(prefs.siteStatsTagFound).toBe(true);
    expect(card().querySelector('table')).not.toBeNull();
  });

  it('opens the site tag field when the press could not find the tag, and takes one typed there', async () => {
    const { savePrefs: save } = await show({ site_stats_account: ACCOUNT });
    post.mockImplementation(async () => ({ ok: false, needs: 'tag', detail: NO_SITE }));
    press().click();
    await settle();
    expect(status().getAttribute('data-state')).toBe('error');
    expect(status().textContent.trim()).toBe(NO_SITE);
    expect(fold('Set the site tag by hand').open).toBe(true);
    expect(card().querySelector('table')).toBeNull();
    type(field('Web Analytics site tag'), TAG);
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats_tag: TAG });
    expect(prefs.siteStatsTagFound).toBe(false);
    post.mockImplementation(async () => ({ ...NUMBERS, tag_found: false }));
    press().click();
    await settle();
    expect(card().querySelector('table')).not.toBeNull();
    expect(fold('Set the site tag by hand').open).toBe(true);
  });

  it('says so when Cloudflare counted nothing, and names what to check', async () => {
    await show({ site_stats_account: ACCOUNT, site_stats_tag: TAG });
    post.mockImplementation(async () => ({ ...NUMBERS, pages: [], total: { week: counts(0), month: counts(0) }, referrers: [], countries: [], sampled: false }));
    press().click();
    await settle();
    expect(card().textContent).toContain(NUMBERS_NONE);
    expect(card().querySelector('table')).toBeNull();
  });

  it('says in the server\'s words what went wrong, and keeps the press', async () => {
    await show({ site_stats_account: ACCOUNT, site_stats_tag: TAG });
    const said = 'Cloudflare refused the API token: it may be mistyped, expired or deleted. Make a new one and paste it here.';
    post.mockImplementation(async () => { throw refused(502, said); });
    press().click();
    await settle();
    expect(status().getAttribute('data-state')).toBe('error');
    expect(status().textContent.trim()).toBe(said);
    expect(press().disabled).toBe(false);
    expect(card().querySelector('table')).toBeNull();
  });

  it('drops the numbers once the site tag changes, as they are another site\'s', async () => {
    await show({ site_stats_account: ACCOUNT, site_stats_tag: TAG });
    post.mockImplementation(async () => NUMBERS);
    press().click();
    await settle();
    expect(card().querySelector('table')).not.toBeNull();
    type(field('Web Analytics site tag'), 'a'.repeat(32));
    await settle();
    expect(card().querySelector('table')).toBeNull();
    expect(siteNumbers.data).toBeNull();
  });
});

describe('the other choices', () => {
  it('sends GoatCounter\'s reader to its own page, with no Numbers to read', async () => {
    await show({ site_stats: 'goatcounter', site_stats_code: 'desk-1' });
    expect(card()).toBeNull();
    const stats = target.querySelector('section[aria-label="Statistics"]');
    expect(stats.textContent).toContain(NUMBERS_GOATCOUNTER);
    const own = [...stats.querySelectorAll('a')].find((node) => node.textContent.includes('desk-1.goatcounter.com'));
    expect(own.getAttribute('href')).toBe('https://desk-1.goatcounter.com/');
    expect(own.getAttribute('title')).toBe('Open your GoatCounter site, where its numbers are');
    // the sign-up link stays
    expect([...stats.querySelectorAll('a')].some((node) => node.getAttribute('href') === 'https://www.goatcounter.com/signup')).toBe(true);
  });

  it('shows no Numbers while nobody is counted', async () => {
    await show({ site_stats: '' });
    expect(card()).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
