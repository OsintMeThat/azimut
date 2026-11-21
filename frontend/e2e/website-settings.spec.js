import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Settings › Website as the site's hub, end to end in the browser: the hero over a bar of panels
 * (Overview, Identity, Hosting, Articles, Readers, Upkeep, Make it yours, WordPress) walked by click
 * and by keyboard, the site's name and logo with their preview, a read of the site and a delete
 * through its confirmation, a refused one, the limits, how readers are counted, Update the site, the
 * Legal notice and Privacy pages, and Unlisted in the publish dialog. The server and GitHub are stood
 * in for: what is checked is what the browser asks, and that nothing reaches GitHub before a press.
 *
 * `AZIMUT_SHOTS` names a folder the last test draws every panel into, dark and light, at 1280 wide.
 */

const SHOTS = process.env.AZIMUT_SHOTS ?? '';
const MB = 1024 * 1024;
const github = {
  account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
  token: { set: true, hint: '…wxyz' }, website: { title: 'octo', logo: false, logo_from: '', counting: '' }, categories: [],
};
const TOKEN = '0123456789abcdef0123456789abcdef';
// 1 × 1, a real PNG for the logo's file input
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const thumb = (colour) => `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="92"><rect width="168" height="92" fill="${colour}"/>`
  + '<path d="M0 70 40 36l30 22 40-34 58 46v22H0Z" fill="rgba(255,255,255,.25)"/></svg>';
const COLOURS = { bab: '#3d5f86', guide: '#6b5a8e', 'bab-map': '#3f6e52', '2026': '#7a5b3c' };
const item = (folder, more = {}) => ({
  folder, address: `https://octo.github.io/articles/${folder}/`, title: `Title of ${folder}`, summary: '', date: '2026-11-20', date_label: '20 November 2026',
  category: '', role: 'article', layout: 'article', image: '', bytes: MB, deletable: true, ...more,
});
const NESTED = '2026/01/05/lost-in-low-res-how-to-reconstruct-rare-military-patches';
const READ = {
  ok: true, address: 'https://octo.github.io/articles/', home: 'azimut',
  items: [
    item('bab-el-mandab-2026', { title: 'The fall of the Bab al-Mandab front, Sep-Nov 2026', category: 'Conflict Watch', layout: 'story',
      image: 'https://octo.github.io/articles/bab/cover.jpg', bytes: Math.round(4.2 * MB), place: { lat: 12.725004, lon: 43.5075, name: 'Bab al-Mandab, Yemen' } }),
    item('guide', { title: 'Installing Azimut: the complete guide', category: 'Methods & Tools', date: '2026-08-13', date_label: '13 August 2026',
      image: 'https://octo.github.io/articles/guide/cover.jpg', bytes: 12 * MB }),
    item('bab-map', { title: 'The Bab al-Mandab front on one map', layout: 'map', image: 'https://octo.github.io/articles/bab-map/cover.jpg', bytes: 290 * MB }),
    item('about', { title: 'About', role: 'page', date: '2026-01-02', date_label: '2 January 2026', bytes: 2048 }),
    item('draft', { title: 'A draft to show someone', role: 'unlisted', category: 'Methods & Tools', bytes: 900_000 }),
    item(NESTED, { title: 'Lost in Low-Res: How to Reconstruct Rare Military Patches using OSINT and AI', category: 'Methods & Tools',
      date: '2026-01-05', date_label: '5 January 2026', image: 'https://octo.github.io/articles/2026/cover.jpg', bytes: 3 * MB, deletable: false }),
  ],
  categories: [{ name: 'Conflict Watch', count: 1, pages: ['conflict-watch/'] }, { name: 'Methods & Tools', count: 2, pages: [] }],
  marked: ['', 'conflict-watch/'], legal: 'legal-notice/', privacy: '', last: { date: '2026-11-21T13:55:52Z', message: 'Update the site' },
  size: { site: 312 * MB, repository: Math.round(1.4 * 1024 * MB) }, warnings: [],
};

async function openWebsite(page, options = { github }) {
  const fixture = await installAppFixture(page, options);
  // the pictures of the site's cards are the site's own: stood in for here, as the server is
  await page.route('https://octo.github.io/**', (route) => {
    const url = route.request().url();
    const colour = Object.entries(COLOURS).find(([name]) => url.includes(`/${name}/`))?.[1] ?? '#3d5f86';
    return route.fulfill({ contentType: 'image/svg+xml', body: thumb(colour) });
  });
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Website' }).click();
  return fixture;
}

/** The server's side of the hub's presses, each recorded as it is asked. */
async function standIn(page, { read = READ, deleted = null } = {}) {
  const asked = [];
  await page.route('**/api/publishing/github/site/read', (route) => {
    asked.push(`${route.request().method()} read`);
    return route.fulfill({ json: read });
  });
  await page.route('**/api/publishing/github/site/delete', (route) => {
    const body = route.request().postDataJSON();
    asked.push(`${route.request().method()} delete ${body.folder}`);
    const answer = typeof deleted === 'function' ? deleted(body) : deleted;
    return route.fulfill(answer ?? { json: { ok: true, commit: 'c'.repeat(40), folder: body.folder, removed: 4,
      written: ['articles.json', 'feed.xml', 'sitemap.xml'], warnings: [] } });
  });
  return asked;
}

const tab = (page, name) => page.getByRole('tablist', { name: 'Website' }).getByRole('tab', { name: new RegExp(`^${name}`) });
const panel = (page, name) => page.getByRole('tabpanel', { name: new RegExp(`^${name}`) });
const hero = (page) => page.getByRole('region', { name: 'The site at a glance' });
const rows = (page) => panel(page, 'Articles').getByRole('list', { name: 'What the site holds' }).getByRole('listitem');

test.use({ viewport: { width: 1280, height: 1000 } });

test('the hub opens on its Overview, walks its tabs by click and by keyboard, and reaches nothing before a press', async ({ page }) => {
  const asked = [];
  const fixture = await openWebsite(page);
  for (const path of ['read', 'delete']) await page.route(`**/api/publishing/github/site/${path}`, (route) => { asked.push(path); return route.abort(); });

  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('octo');
  await expect(hero(page)).toContainText('GitHub Pages · octo/articles · main');
  await expect(hero(page)).toContainText('Not read yet');
  await expect(hero(page).getByRole('link', { name: /Open the site/ })).toHaveAttribute('href', 'https://octo.github.io/articles/');

  const bar = page.getByRole('tablist', { name: 'Website' });
  await expect(bar).toHaveAttribute('data-guide', 'settings.website-hub');
  await expect(bar.getByRole('tab')).toHaveText(['Overview', 'Identity', 'Hosting', 'Articles', 'Readers', 'Upkeep', 'Make it yours', 'WordPress']);
  await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'Overview')).toBeVisible();
  await expect(panel(page, 'Identity')).toBeHidden();
  await expect(panel(page, 'Overview').getByRole('heading', { name: 'How your site works' })).toBeVisible();
  await expect(panel(page, 'Overview')).toContainText('One folder per note in octo/articles.');

  // the checklist says what is set, what is left and what needs a read, and opens the panel where it is done
  const steps = panel(page, 'Overview').getByRole('region', { name: 'Your site, step by step' }).getByRole('listitem');
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(0)).toContainText('octo/articles on main');
  await expect(steps.nth(4)).toContainText('Read the site, in Articles, to tell.');
  await expect(panel(page, 'Overview')).toContainText('1 of 6 done. 2 need a read of the site.');
  await steps.nth(2).getByRole('button', { name: 'Identity' }).click();
  await expect(tab(page, 'Identity')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'Identity')).toBeVisible();
  await expect(panel(page, 'Overview')).toBeHidden();

  // a click opens a tab; the arrow keys, Home and End walk the bar, the focus with them
  await tab(page, 'Hosting').click();
  await expect(panel(page, 'Hosting')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Articles')).toBeFocused();
  await expect(tab(page, 'Articles')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'Articles')).toBeVisible();
  await page.keyboard.press('End');
  await expect(tab(page, 'WordPress')).toBeFocused();
  await expect(panel(page, 'WordPress')).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Overview')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'WordPress')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  // only the open tab is in the tab order: Tab leaves the bar for the panel
  await page.keyboard.press('Tab');
  await expect(panel(page, 'Overview')).toBeFocused();

  // nothing was asked of GitHub, nor of any address outside this computer
  expect(asked).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});

test('Identity follows the name and the line as they are typed, saves them once the field is left, and keeps the credit', async ({ page }) => {
  const fixture = await openWebsite(page, { github, settings: { signature: true, report_name: 'A. Analyst' } });
  await tab(page, 'Identity').click();
  const name = page.getByLabel('Site name');
  await expect(name).toHaveAttribute('placeholder', 'A. Analyst');
  await expect(panel(page, 'Identity')).toContainText('Empty, it takes your Publishing name, A. Analyst.');
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('A. Analyst');

  // typed, not yet left: the hero and the three previews already follow, and nothing is saved
  await name.fill('Open Desk');
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Open Desk');
  expect(fixture.settingsWrites).toEqual([]);
  // leaving the field for the next one saves it
  await page.getByLabel('Tagline').fill('Clarity is the tool.');
  await expect.poll(() => fixture.settingsWrites).toEqual([{ site_title: 'Open Desk' }]);
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Open Desk');
  await expect(hero(page)).toContainText('Clarity is the tool.');
  const paper = panel(page, 'Identity').locator('.paper');
  await expect(paper).toContainText('Open Desk');
  await panel(page, 'Identity').getByRole('button', { name: 'Home page' }).click();
  await expect(paper).toContainText('Open Desk');
  await expect(paper).toContainText('Clarity is the tool.');
  await expect(paper).toContainText('Made with Azimut');
  await panel(page, 'Identity').getByRole('button', { name: 'Feed' }).click();
  await expect(paper).toContainText('Clarity is the tool.');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_tagline: 'Clarity is the tool.' });
  const credit = page.getByRole('checkbox', { name: 'Made with Azimut' });
  await expect(credit).toBeChecked();
  await credit.uncheck();
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_credit_azimut: false });
  await panel(page, 'Identity').getByRole('button', { name: 'Home page' }).click();
  await expect(paper).not.toContainText('Made with Azimut');
  fixture.expectNoUnexpectedRequests();
});

test('the site logo is a PNG of its own, shown from the one address, and the Publishing logo comes back on a press', async ({ page }) => {
  const logos = [];
  const fixture = await openWebsite(page, { github, siteLogo: true, settings: { signature: true } });
  await page.route('**/api/settings/site-logo', (route) => {
    logos.push(route.request().method());
    return route.fulfill({ json: { site_logo: route.request().method() === 'POST' } });
  });
  await tab(page, 'Identity').click();
  const identity = panel(page, 'Identity');
  await expect(identity).toContainText('The Publishing logo, the one on your reports.');
  await expect(identity.getByRole('button', { name: 'Use the Publishing logo' })).toHaveCount(0);

  await identity.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => logos).toEqual(['POST']);
  await expect(identity).toContainText('The site\'s own picture, on each of its pages.');
  await expect(identity.locator('.well img')).toHaveAttribute('src', /\/api\/settings\/site-logo\.png\?v=/);
  await expect(hero(page).locator('.logo img')).toHaveAttribute('src', /\/api\/settings\/site-logo\.png\?v=/);

  await identity.getByRole('button', { name: 'Use the Publishing logo' }).click();
  await expect.poll(() => logos).toEqual(['POST', 'DELETE']);
  await expect(identity).toContainText('The Publishing logo, the one on your reports.');
  await expect(identity.getByRole('button', { name: 'Use the Publishing logo' })).toHaveCount(0);

  // a file that is no PNG is refused in the browser, before it is sent, and said under the logo
  await identity.locator('input[type="file"]').setInputFiles({ name: 'logo.jpg', mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]) });
  await expect(identity.getByRole('alert')).toHaveText('The logo must be a PNG picture.');
  expect(logos).toEqual(['POST', 'DELETE']);
  fixture.expectNoUnexpectedRequests();
});

test('Articles reads the site on a press only, lists what it holds, and deletes a folder through its confirmation', async ({ page }) => {
  const fixture = await openWebsite(page);
  const asked = await standIn(page);
  await tab(page, 'Articles').click();
  const articles = panel(page, 'Articles');
  await expect(articles).toContainText('Not read yet');
  expect(asked).toEqual([]);

  await articles.getByRole('button', { name: 'Read the site' }).click();
  await expect(articles.getByRole('status').first()).toContainText(/Read today at \d\d:\d\d/);
  expect(asked).toEqual(['POST read']);
  await expect(rows(page)).toHaveCount(6);
  const first = rows(page).first();
  await expect(first).toContainText('The fall of the Bab al-Mandab front, Sep-Nov 2026');
  await expect(first).toContainText('/articles/bab-el-mandab-2026/');
  await expect(first).toContainText('Conflict Watch');
  await expect(first).toContainText('4.2 MB');
  await expect(first).toContainText('20 Nov 2026');
  await expect(rows(page).nth(2)).toContainText('Map');
  await expect(rows(page).nth(2)).toContainText('290 MB');
  await expect(rows(page).nth(4)).toContainText('Unlisted');
  await expect(first.getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://octo.github.io/articles/bab-el-mandab-2026/');
  // an article that stands somewhere shows its pin, and one that does not shows none
  const pin = first.locator('.pin');
  await expect(pin).toHaveText('Bab al-Mandab, Yemen');
  await expect(pin).toHaveAttribute('title', 'Where this article stands on the site\'s map, 12.725004° N, 43.5075° E');
  await expect(pin.locator('svg')).toBeVisible();
  await expect(rows(page).nth(1).locator('.pin')).toHaveCount(0);
  await expect(tab(page, 'Articles')).toContainText('6');
  // a card made outside Azimut has no Delete, and says on hover where to delete it
  const nested = rows(page).nth(5);
  await expect(nested.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(nested).toHaveAttribute('title', 'Made outside Azimut: delete it on GitHub');
  // the hero and the categories carry the read too
  await expect(hero(page)).toContainText('3 articles · 1 map · 1 page · 1 unlisted · 312 MB');
  await expect(articles.getByRole('region', { name: 'Categories' }).getByRole('listitem')).toHaveCount(2);
  // a picture fills its frame without stretching, and a long title stays on its line, cut with an ellipsis
  expect(await first.locator('.th img').evaluate((node) => getComputedStyle(node).objectFit)).toBe('cover');
  const long = nested.locator('.t b');
  expect(await long.evaluate((node) => [node.scrollWidth > node.clientWidth, getComputedStyle(node).textOverflow, getComputedStyle(node).whiteSpace]))
    .toEqual([true, 'ellipsis', 'nowrap']);

  // a chip keeps what it names
  await articles.getByRole('button', { name: /^Maps/ }).click();
  await expect(rows(page)).toHaveCount(1);
  await articles.getByRole('button', { name: /^All/ }).click();
  await expect(rows(page)).toHaveCount(6);

  // Delete asks first, and Cancel asks GitHub nothing
  await first.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this article from the site?' });
  await expect(dialog).toContainText('Deletes bab-el-mandab-2026/ from octo/articles and takes it off the lists, the feed and the sitemap, in one commit.');
  await expect(dialog).toContainText('The note stays in your case: publish it again to put it back.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows(page)).toHaveCount(6);
  expect(asked).toEqual(['POST read']);

  await first.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete from the site' }).click();
  await expect(dialog).toHaveCount(0);
  expect(asked).toEqual(['POST read', 'POST delete bab-el-mandab-2026']);
  await expect(rows(page)).toHaveCount(5);
  await expect(articles).toContainText('Deleted bab-el-mandab-2026/: 3 files written.');
  await expect(tab(page, 'Articles')).toContainText('5');
  await expect(articles.getByRole('region', { name: 'Categories' }).getByRole('listitem')).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});

test('a delete the server refused keeps the row and says why', async ({ page }) => {
  await openWebsite(page);
  const asked = await standIn(page, { deleted: { status: 409,
    json: { detail: 'The branch changed on GitHub while Azimut was deleting: press Delete again.' } } });
  await tab(page, 'Articles').click();
  const articles = panel(page, 'Articles');
  await articles.getByRole('button', { name: 'Read the site' }).click();
  await expect(rows(page)).toHaveCount(6);
  await rows(page).nth(1).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete from the site' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(articles).toContainText('The branch changed on GitHub while Azimut was deleting: press Delete again.');
  await expect(rows(page)).toHaveCount(6);
  expect(asked).toEqual(['POST read', 'POST delete guide']);
});

test('Hosting says the site\'s limits, and draws how much of them it uses once the site is read', async ({ page }) => {
  await openWebsite(page);
  const asked = await standIn(page);
  await tab(page, 'Hosting').click();
  const limits = page.getByRole('region', { name: 'Limits' });
  await expect(limits).toContainText('Read the site to see its size.');
  await expect(limits.getByRole('listitem')).toHaveCount(7);
  await expect(limits.getByRole('link', { name: /GitHub's limits/ }))
    .toHaveAttribute('href', 'https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits');
  await expect(page.getByRole('region', { name: 'GitHub Pages' }).locator('h3')).toContainText('Set up');
  expect(asked).toEqual([]);
  await limits.getByRole('button', { name: 'Read the site' }).click();
  await expect(limits).toContainText('Site: 312 MB of 1 GB');
  await expect(limits).toContainText('Repository with its history: 1.4 GB of 1 GB recommended');
  await expect(limits.getByRole('meter', { name: 'Site' })).toHaveAttribute('data-level', 'ok');
  await expect(limits.getByRole('meter', { name: 'Site' })).toHaveAttribute('aria-valuenow', '30');
  await expect(limits.getByRole('meter', { name: 'Repository with its history' })).toHaveAttribute('data-level', 'danger');
  // the bars sit where the line before the read stood: the list under them does not move
  expect(asked).toEqual(['POST read']);
});

test('Hosting says a site too large to read has no known size, and draws no bar for it', async ({ page }) => {
  await openWebsite(page);
  await standIn(page, { read: { ...READ, items: [], categories: [], home: 'none', size: { site: null, repository: 200 * MB },
    warnings: ['The site holds too many files for Azimut to read: nothing is shown.'] } });
  await tab(page, 'Hosting').click();
  const limits = page.getByRole('region', { name: 'Limits' });
  await limits.getByRole('button', { name: 'Read the site' }).click();
  await expect(limits).toContainText('Size unknown: the site holds too many files to read.');
  await expect(limits.getByRole('meter', { name: 'Site' })).toHaveCount(0);
  await expect(limits.getByRole('meter', { name: 'Repository with its history' })).toHaveAttribute('data-level', 'ok');
  await tab(page, 'Articles').click();
  await expect(panel(page, 'Articles')).toContainText('The site holds too many files for Azimut to read: nothing is shown.');
});

test('readers are counted only when asked, with the setup said field by field', async ({ page }) => {
  const fixture = await openWebsite(page);
  await tab(page, 'Readers').click();
  const group = page.getByRole('radiogroup', { name: 'Count readers with' });
  await expect(group.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('GoatCounter site code')).toHaveCount(0);

  await group.getByRole('radio', { name: 'GoatCounter' }).click();
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats: 'goatcounter' });
  await expect(page.getByText('Paste the site code below for the count to start.')).toBeVisible();
  const steps = page.locator('details').filter({ hasText: 'How to make a GoatCounter site' });
  await expect(steps).toHaveAttribute('open', '');
  await page.getByLabel('GoatCounter site code').fill('Not A Code!');
  await page.getByLabel('GoatCounter site code').press('Tab');
  await expect(page.getByRole('alert').filter({ hasText: 'does not read as a GoatCounter code' })).toBeVisible();
  expect(fixture.settingsWrites.some((write) => 'site_stats_code' in write)).toBe(false);
  await page.getByLabel('GoatCounter site code').fill('https://desk-1.goatcounter.com/');
  await page.getByLabel('GoatCounter site code').press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats_code: 'desk-1' });

  await group.getByRole('radio', { name: 'Cloudflare Web Analytics' }).click();
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats: 'cloudflare' });
  await expect(page.getByText('Free. Loads one script from static.cloudflareinsights.com and counts with no cookie.')).toBeVisible();
  await expect(page.getByText('Make a free account at cloudflare.com.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cloudflare sign-up' })).toHaveAttribute('href', 'https://dash.cloudflare.com/sign-up');
  await expect(page.getByRole('link', { name: /Open Cloudflare's dashboard/ })).toHaveAttribute('href', 'https://dash.cloudflare.com/?to=/:account/web-analytics');
  await page.getByLabel('Cloudflare site token').fill(`<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${TOKEN}"}'></script>`);
  await page.getByLabel('Cloudflare site token').press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats_token: TOKEN });
  await expect(page.getByLabel('Cloudflare site token')).toHaveValue(TOKEN);
  await expect(hero(page)).toContainText('Readers counted by Cloudflare Web Analytics');

  await group.getByRole('radio', { name: 'Off' }).click();
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats: '' });
  await expect(page.getByLabel('Cloudflare site token')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open Cloudflare's dashboard/ })).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('Numbers are read from Cloudflare on a press only, each article by its title, the site tag found or typed, and a refusal said', async ({ page }) => {
  const counts = (views, visits = views) => ({ views, visits });
  const fixture = await openWebsite(page, {
    github,
    cloudflare: { token: { set: true, hint: '…kkkk' } },
    settings: { site_stats: 'cloudflare', site_stats_token: TOKEN, site_stats_account: '0123456789abcdef0123456789abcdef', site_stats_tag: '' },
  });
  await standIn(page);
  const TAG = 'fedcba9876543210fedcba9876543210';
  const asked = [];
  let refuse = '';
  await page.route('**/api/publishing/cloudflare/numbers', (route) => {
    asked.push(route.request().method());
    if (refuse === 'busy') {
      return route.fulfill({ status: 502, json: { detail: 'Cloudflare asks Azimut to wait: try again in 5 minutes.' } });
    }
    if (refuse === 'tag') {
      return route.fulfill({ json: { ok: false, needs: 'tag', detail: 'No Web Analytics site in this account has the site token set in Readers.' } });
    }
    return route.fulfill({ json: {
      ok: true, address: 'https://octo.github.io/articles/',
      pages: [
        { path: '/articles/bab-el-mandab-2026/', page: 'bab-el-mandab-2026/', week: counts(45, 31), month: counts(1302, 920) },
        { path: '/articles/guide/', page: 'guide/', week: counts(3), month: counts(30, 20) },
        { path: '/articles/', page: '', week: counts(8), month: counts(12) },
        { path: '/articles/old-page/', page: 'old-page/', week: counts(0), month: counts(2) },
      ],
      total: { week: counts(56, 42), month: counts(1346, 954) },
      referrers: [{ host: 'news.ycombinator.com', views: 30, visits: 30 }, { host: '', views: 40, visits: 40 }],
      countries: [{ country: 'FR', views: 800, visits: 600 }, { country: 'US', views: 500, visits: 300 }],
      sampled: true, read_at: '2026-11-21T12:00:00Z', days: [7, 30], tag: TAG, tag_found: true,
    } });
  });

  // the read of the site names the articles; Cloudflare is asked nothing until the press
  await tab(page, 'Articles').click();
  await panel(page, 'Articles').getByRole('button', { name: 'Read the site' }).click();
  await expect(rows(page)).toHaveCount(6);
  await tab(page, 'Readers').click();
  const numbers = page.getByRole('region', { name: 'Numbers' });
  await expect(numbers).toContainText('Press Read the numbers to see what is read, and from where.');
  await expect(numbers.getByLabel('Cloudflare API token')).toHaveAttribute('placeholder', '•••• kkkk');
  expect(asked).toEqual([]);

  await numbers.getByRole('button', { name: 'Read the numbers' }).click();
  await expect(numbers.locator('.press-line [role="status"]')).toContainText(/Read today at \d\d:\d\d/);
  expect(asked).toEqual(['POST']);
  await expect(numbers.getByRole('group', { name: 'Whole site' })).toContainText('1,346');
  const table = numbers.getByRole('table', { name: 'Page views by page' });
  await expect(table.locator('tbody tr')).toHaveText([/The fall of the Bab al-Mandab front, Sep-Nov 2026\s*45\s*1,302/,
    /Installing Azimut: the complete guide\s*3\s*30/, /Home page\s*8\s*12/, /\/articles\/old-page\/\s*0\s*2/]);
  await expect(table.getByRole('link', { name: 'The fall of the Bab al-Mandab front, Sep-Nov 2026' }))
    .toHaveAttribute('href', 'https://octo.github.io/articles/bab-el-mandab-2026/');
  await expect(numbers.getByRole('region', { name: 'Where visits came from' }).getByRole('listitem')).toHaveText([/No referrer\s*40/, /news\.ycombinator\.com\s*30/]);
  await expect(numbers.getByRole('region', { name: 'Countries' }).getByRole('listitem')).toHaveText([/France\s*800/, /United States\s*500/]);
  await expect(numbers).toContainText('so the 30-day counts are estimates');
  // the site tag the press found shows in its field, folded away
  const byHand = numbers.locator('details').filter({ hasText: 'Set the site tag by hand' });
  await expect(byHand).not.toHaveAttribute('open', '');
  await expect(numbers.getByLabel('Web Analytics site tag')).toHaveValue(TAG);

  // a refusal is said in its sentence, and the press stays
  refuse = 'busy';
  await numbers.getByRole('button', { name: 'Read again' }).click();
  await expect(numbers.locator('.press-line [role="status"]')).toHaveText('Cloudflare asks Azimut to wait: try again in 5 minutes.');
  await expect(numbers.getByRole('button', { name: 'Read again' })).toBeEnabled();
  // a tag the press could not find opens its field, and one typed there is saved
  refuse = 'tag';
  await numbers.getByRole('button', { name: 'Read again' }).click();
  await expect(numbers.locator('.press-line [role="status"]')).toHaveText('No Web Analytics site in this account has the site token set in Readers.');
  await expect(byHand).toHaveAttribute('open', '');
  await numbers.getByLabel('Web Analytics site tag').fill('0'.repeat(32));
  await numbers.getByLabel('Web Analytics site tag').press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats_tag: '0'.repeat(32) });
  expect(asked).toEqual(['POST', 'POST', 'POST']);
  fixture.expectNoUnexpectedRequests();
});

test('Readers gives the feed and the sitemap addresses to copy', async ({ page }) => {
  await openWebsite(page);
  await tab(page, 'Readers').click();
  const follow = page.getByRole('region', { name: 'Follow and find' });
  await expect(follow.locator('code')).toHaveText(['https://octo.github.io/articles/feed.xml', 'https://octo.github.io/articles/sitemap.xml']);
  await expect(follow.getByRole('button', { name: 'Copy' })).toHaveCount(2);
});

test('Update the site asks GitHub on its press only, from Upkeep or from the hero, and says what it did', async ({ page }) => {
  const asked = [];
  await installAppFixture(page, { github });
  await page.route('**/api/publishing/github/site', async (route) => {
    asked.push(route.request().method());
    await new Promise((resolve) => setTimeout(resolve, 600));
    return route.fulfill({ json: { ok: true, updated: true, commit: 'c'.repeat(40), written: ['articles.json', 'feed.xml'],
      warnings: ['feed.xml is yours: it was left as it is.'], categories: [] } });
  });
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Website' }).click();
  await tab(page, 'Upkeep').click();
  const section = page.getByRole('region', { name: 'Update the site' });
  const press = section.getByRole('button', { name: 'Update the site' });
  await expect(press).toBeEnabled();
  expect(asked).toEqual([]);
  await press.click();
  await expect(section).toContainText('Updating octo/articles…');
  await expect(hero(page)).toContainText('Updating octo/articles…');
  await expect(section).toContainText('The site is updated: 2 files written.');
  await expect(section.getByRole('list', { name: 'To mind' })).toContainText('feed.xml is yours');
  await expect(hero(page)).toContainText(/Updated today at \d\d:\d\d/);
  expect(asked).toEqual(['POST']);
  // the hero's press is the same press
  await hero(page).getByRole('button', { name: 'Update the site' }).click();
  await expect.poll(() => asked).toEqual(['POST', 'POST']);
});

test('Update the site waits for GitHub to be set up', async ({ page }) => {
  const nothing = { account: '', repo: 'articles', branch: 'main', site: '', base: '', token: { set: false, hint: '' } };
  await openWebsite(page, { github: nothing });
  await tab(page, 'Upkeep').click();
  const press = page.getByRole('region', { name: 'Update the site' }).getByRole('button', { name: 'Update the site' });
  await expect(press).toBeDisabled();
  await expect(press).toHaveAttribute('title', 'Set up GitHub Pages under Hosting first');
  await expect(hero(page).getByRole('button', { name: 'Update the site' })).toBeDisabled();
  await expect(hero(page)).toContainText('No address until GitHub Pages is set up');
});

test('Make it yours and WordPress have their panels', async ({ page }) => {
  await openWebsite(page);
  await tab(page, 'Make it yours').click();
  const own = panel(page, 'Make it yours');
  await expect(own.getByRole('heading', { name: 'Your own home page' })).toBeVisible();
  await expect(own.locator('code').first()).toContainText('index.html');
  const bar = own.getByRole('region', { name: 'Your own bar' });
  await expect(bar).toContainText('azimut-bar.html at the site\'s root: articles carry it in place of Azimut\'s bar, maps keep theirs');
  await expect(bar.locator('pre')).toContainText('<svg width="24" height="24">');
  await expect(own.getByRole('link', { name: /GitHub's guide/ }))
    .toHaveAttribute('href', 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site');
  await tab(page, 'WordPress').click();
  await expect(panel(page, 'WordPress').getByRole('heading', { name: 'Also send to WordPress' })).toBeVisible();
  await expect(panel(page, 'WordPress').getByRole('region', { name: 'WordPress' })).toBeVisible();
  await expect(page.getByLabel('Site address')).toBeVisible();
});

test('a read that finds the site\'s own bar shows it in the article bar preview, and Upkeep says the file is the analyst\'s', async ({ page }) => {
  const fixture = await openWebsite(page);
  const asked = await standIn(page, { read: { ...READ, bar: 'yours' } });
  await tab(page, 'Identity').click();
  const paper = panel(page, 'Identity').locator('.paper');
  await expect(paper.locator('[data-preview="own-bar"]')).toHaveCount(0);
  await expect(paper).toContainText('All articles');
  await tab(page, 'Articles').click();
  await panel(page, 'Articles').getByRole('button', { name: 'Read the site' }).click();
  await expect(rows(page)).toHaveCount(6);
  await tab(page, 'Identity').click();
  await expect(paper.locator('[data-preview="own-bar"]')).toHaveText('azimut-bar.htmlYour own bar, on every article');
  await expect(paper).not.toContainText('All articles');
  await tab(page, 'Upkeep').click();
  const owners = panel(page, 'Upkeep').getByRole('region', { name: 'Who writes what' });
  await expect(owners.getByRole('row', { name: /azimut-bar\.html/ })).toContainText('Copied into each article\'s bar.');
  expect(asked).toEqual(['POST read']);
  fixture.expectNoUnexpectedRequests();
});

test('the Legal notice and Privacy pages start in the open case, and cannot without one', async ({ page }) => {
  const asked = [];
  await installAppFixture(page, { github });
  for (const kind of ['legal-notice', 'privacy-notice']) {
    await page.route(`**/api/cases/${CASE_ID}/notes/${kind}`, (route) => {
      asked.push(`${route.request().method()} ${kind}`);
      return route.fulfill({ json: { id: 'n9', title: kind === 'legal-notice' ? 'Legal notice' : 'Privacy', created: true } });
    });
  }
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Website' }).click();
  await tab(page, 'Articles').click();
  const privacy = page.getByRole('button', { name: 'Start a Privacy page' });
  await expect(privacy).toBeEnabled();
  expect(asked).toEqual([]);
  await privacy.click();
  await expect.poll(() => asked).toEqual(['POST privacy-notice']);
  await expect(page).toHaveURL(/#notebook/);
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Website' }).click();
  await tab(page, 'Articles').click();
  await page.getByRole('button', { name: 'Start a Legal notice page' }).click();
  await expect.poll(() => asked).toEqual(['POST privacy-notice', 'POST legal-notice']);
});

test('with no case open the page presses say to open one first', async ({ page }) => {
  await openWebsite(page, { github, lastCase: null });
  await tab(page, 'Articles').click();
  for (const name of ['Start a Legal notice page', 'Start a Privacy page']) {
    await expect(page.getByRole('button', { name })).toBeDisabled();
    await expect(page.getByRole('button', { name })).toHaveAttribute('title', 'Open a case first: the page is a note of that case');
  }
});

/** A case with one note, its notebook and the publish dialog stood in for; what the dialog publishes is kept. */
async function openPublish(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Port strike', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog, github });
  const published = [];
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) => route.fulfill({ json: { items: catalog, next_cursor: null, total: 1 } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Port strike', folder: '', updated_at: at, excerpt: 'Smoke over the pier.', words: 4,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') return route.fulfill({ json: { notes: [{ note: 'n1', title: 'Port strike', internal: 0, weight: 1000, links: [], pov: [], earlier: 0, warnings: [] }] } });
    if (path === '/n1/github/check') return route.fulfill({ json: { checked: true, exists: false, edited: false, warning: '' } });
    if (path === '/n1/github') {
      published.push(request.postDataJSON());
      return route.fulfill({ json: { published: true, address: 'https://octo.github.io/articles/port-strike/', repository: 'octo/articles', branch: 'main',
        commit: 'c'.repeat(40), sha256: 'a'.repeat(64), at, uploaded: 3, reused: 0, removed: 0, edited: false, site: { written: [], warnings: [] }, warnings: [] } });
    }
    if (path === '/n1/editions') return route.fulfill({ json: { editions: [] } });
    if (path === '/n1/place') return route.fulfill({ json: { suggested: null } });
    if (path === '/n1/look') return route.fulfill({ json: { look: request.method() === 'PUT' ? request.postDataJSON() : { style: 'report' } } });
    if (path === '/n1') return route.fulfill({ json: request.method() === 'PUT' ? { status: 'saved' } : { text: 'Smoke over the pier.' } });
    return route.fallback();
  });
  await page.route('**/api/publishing/github/build', (route) => route.fulfill({ json: { state: 'built', detail: '' } }));
  await page.goto('/#notebook');
  await page.locator('button[title="Open Port strike"]').click();
  await page.locator('[data-guide="notebook.pdf"]').click();
  await page.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'Web folder' }).click();
  return { dialog: page.getByRole('dialog', { name: 'Export note as a web folder' }), published };
}

test('the publish dialog puts a note online Unlisted, in no list', async ({ page }) => {
  const { dialog, published } = await openPublish(page);
  const role = dialog.getByRole('radiogroup', { name: 'On the site' });
  await expect(role.getByRole('radio')).toHaveText(['Article', 'Page', 'Unlisted']);
  await expect(dialog).toContainText('Goes on octo\'s home page and in its feed.');
  await role.getByRole('radio', { name: 'Unlisted' }).click();
  await expect(role.getByRole('radio', { name: 'Unlisted' })).toHaveAttribute('aria-checked', 'true');
  await expect(role.getByRole('radio', { name: 'Unlisted' })).toHaveAttribute('title', 'Put it online without listing it anywhere');
  await expect(dialog).toContainText('Online at its address only, in no list, feed or sitemap.');
  await expect(dialog.getByRole('textbox', { name: 'Category' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect.poll(() => published.length).toBe(1);
  expect(published[0]).toMatchObject({ role: 'unlisted' });
});

test('the publish dialog says the site has no name yet, and opens the hub on Identity to name it', async ({ page }) => {
  const { dialog, published } = await openPublish(page);
  await expect(dialog).toContainText('Your site has no name yet: it shows as octo.');
  await dialog.getByRole('button', { name: 'Name the site' }).click();
  await expect(page).toHaveURL(/#settings/);
  await expect(tab(page, 'Identity')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Site name')).toBeVisible();
  expect(published).toEqual([]);
});

test('draws every panel, dark and light', async ({ page }) => {
  test.skip(!SHOTS, 'Pictures only when AZIMUT_SHOTS names a folder');
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  await openWebsite(page, { github, siteLogo: true, settings: { site_logo: true, signature: true, site_title: 'OSINT Me That',
    site_tagline: 'In a world of fragmented information and digital noise, clarity is the ultimate tool.', site_stats: 'cloudflare', site_stats_token: TOKEN } });
  await standIn(page);
  await page.route('**/api/publishing/github/site', (route) => route.fulfill({ json: { ok: true, updated: true, commit: 'c'.repeat(40),
    written: ['articles.json', 'feed.xml', 'sitemap.xml', 'index.html', 'conflict-watch/index.html', 'azimut-site/logo.png'], warnings: [], categories: [] } }));

  /** The page tall enough to hold the whole panel, then each theme. */
  async function shoot(name) {
    const height = await page.evaluate(() => {
      const pane = document.querySelector('.settings-pane');
      return pane.getBoundingClientRect().top + pane.scrollHeight + 8;
    });
    await page.setViewportSize({ width: 1280, height: Math.max(800, Math.ceil(height)) });
    await page.waitForTimeout(150);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  await shoot('overview-unread');
  await tab(page, 'Articles').click();
  await shoot('articles-unread');
  await panel(page, 'Articles').getByRole('button', { name: 'Read the site' }).click();
  await expect(rows(page)).toHaveCount(6);
  await page.waitForTimeout(300);
  await shoot('articles');
  await tab(page, 'Overview').click();
  await shoot('overview');
  await tab(page, 'Identity').click();
  await shoot('identity-bar');
  await panel(page, 'Identity').getByRole('button', { name: 'Home page' }).click();
  await shoot('identity-home');
  await panel(page, 'Identity').getByRole('button', { name: 'Feed' }).click();
  await shoot('identity-feed');
  await tab(page, 'Hosting').click();
  await shoot('hosting');
  await tab(page, 'Readers').click();
  await shoot('readers');
  await tab(page, 'Upkeep').click();
  await panel(page, 'Upkeep').getByRole('button', { name: 'Update the site' }).click();
  await expect(panel(page, 'Upkeep')).toContainText('6 files written');
  await shoot('upkeep');
  await tab(page, 'Make it yours').click();
  await shoot('yours');
  await tab(page, 'WordPress').click();
  await shoot('wordpress');
  // a delete asked, and the case sidebar shut: the hub at its widest
  await tab(page, 'Articles').click();
  await rows(page).first().getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(200);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/articles-delete-${theme}.png` });
  }
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.getByTitle(/^Toggle case sidebar/).click();
  await page.waitForTimeout(300);
  await shoot('articles-wide');
  await tab(page, 'Hosting').click();
  await shoot('hosting-wide');
  // and at 900 wide, the sidebar open again
  await page.getByTitle(/^Toggle case sidebar/).click();
  await page.setViewportSize({ width: 900, height: 1000 });
  await tab(page, 'Articles').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/articles-900-dark.png` });
  await tab(page, 'Overview').click();
  await page.screenshot({ path: `${SHOTS}/overview-900-dark.png` });
});
