import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Settings › Website as the site's hub, end to end in the browser: the hero over a bar of panels
 * (Overview, Identity, Hosting, Articles, Readers, Upkeep, Make it yours, WordPress), the site's name
 * and logo with their preview, a read of the site and a delete through its confirmation, the limits,
 * how readers are counted, Update the site and the Legal notice and Privacy pages. The server and GitHub
 * are stood in for: what is checked is what the browser asks, and that nothing reaches GitHub before a
 * press.
 *
 * `AZIMUT_SHOTS` names a folder the run also draws the views into.
 */

const SHOTS = process.env.AZIMUT_SHOTS ?? '';

async function shoot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const MB = 1024 * 1024;
const github = {
  account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
  token: { set: true, hint: '…wxyz' }, website: { title: 'Octo Desk', logo: false, counting: '' }, categories: [],
};
const TOKEN = '0123456789abcdef0123456789abcdef';
// 1 × 1, a real PNG for the logo's file input
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const thumb = (colour) => `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="92"><rect width="168" height="92" fill="${colour}"/>`
  + '<path d="M0 70 40 36l30 22 40-34 58 46v22H0Z" fill="rgba(255,255,255,.25)"/></svg>';
const item = (folder, more = {}) => ({
  folder, address: `https://octo.github.io/articles/${folder}/`, title: `Title of ${folder}`, summary: '', date: '2026-11-20', date_label: '20 November 2026',
  category: '', role: 'article', layout: 'article', image: '', bytes: MB, ...more,
});
const READ = {
  ok: true, address: 'https://octo.github.io/articles/', home: 'azimut',
  items: [
    item('bab-el-mandab-2026', { title: 'The fall of the Bab al-Mandab front, Sep-Nov 2026', category: 'Conflict Watch', layout: 'story',
      image: 'https://octo.github.io/articles/bab-el-mandab-2026/cover.jpg', bytes: Math.round(4.2 * MB) }),
    item('guide', { title: 'Installing Azimut: the complete guide', category: 'Methods & Tools', date_label: '13 August 2026',
      image: 'https://octo.github.io/articles/guide/cover.jpg', bytes: 12 * MB }),
    item('bab-map', { title: 'The Bab al-Mandab front on one map', layout: 'map', image: 'https://octo.github.io/articles/bab-map/cover.jpg', bytes: 290 * MB }),
    item('about', { title: 'About', role: 'page', date_label: '2 January 2026', bytes: 2048 }),
    item('draft', { title: 'A draft to show someone', role: 'unlisted', category: 'Methods & Tools', bytes: 900_000 }),
  ],
  categories: [{ name: 'Conflict Watch', count: 1, pages: ['conflict-watch/'] }, { name: 'Methods & Tools', count: 1, pages: [] }],
  marked: ['', 'conflict-watch/'], legal: '', privacy: '', last: { date: '2026-11-21T13:55:52Z', message: 'Update the site' },
  size: { site: 312 * MB, repository: Math.round(1.4 * 1024 * MB) }, warnings: [],
};

async function openWebsite(page, options = { github }) {
  const fixture = await installAppFixture(page, options);
  // the pictures of the site's cards are the site's own: stood in for here, as the server is
  await page.route('https://octo.github.io/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: thumb(
    route.request().url().includes('bab-map') ? '#3f6e52' : route.request().url().includes('guide') ? '#6b5a8e' : '#3d5f86') }));
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
    return route.fulfill(deleted ?? { json: { ok: true, commit: 'c'.repeat(40), folder: body.folder, removed: 4,
      written: ['articles.json', 'feed.xml', 'sitemap.xml'], warnings: [] } });
  });
  return asked;
}

const tab = (page, name) => page.getByRole('tab', { name, exact: false });
const panel = (page, id) => page.locator(`#hub-panel-${id}`);

test.use({ viewport: { width: 1280, height: 1000 } });

test('the hub opens on its Overview, with the site over a bar of panels, and reaches nothing before a press', async ({ page }) => {
  const asked = [];
  const fixture = await openWebsite(page);
  for (const path of ['read', 'delete']) await page.route(`**/api/publishing/github/site/${path}`, (route) => { asked.push(path); return route.abort(); });

  const hero = page.getByRole('region', { name: 'The site at a glance' });
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('octo');
  await expect(hero).toContainText('GitHub Pages · octo/articles · main');
  await expect(hero).toContainText('Site not read yet');
  await expect(hero.getByRole('link', { name: /Open the site/ })).toHaveAttribute('href', 'https://octo.github.io/articles/');

  const bar = page.getByRole('tablist', { name: 'Website' });
  await expect(bar.getByRole('tab')).toHaveText(['Overview', 'Identity', 'Hosting', 'Articles', 'Readers', 'Upkeep', 'Make it yours', 'WordPress']);
  await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  // one panel at a time
  await expect(panel(page, 'overview')).toBeVisible();
  await expect(panel(page, 'identity')).toBeHidden();
  await expect(panel(page, 'overview').getByRole('heading', { name: 'How your site works' })).toBeVisible();
  await expect(panel(page, 'overview').locator('.flow .step')).toHaveCount(4);
  await expect(panel(page, 'overview')).toContainText('One folder per note in octo/articles.');

  // the checklist says what is set, what is left and what needs a read, and opens the panel where it is done
  const steps = panel(page, 'overview').locator('.check li');
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(0)).toContainText('octo/articles on main');
  await expect(steps.nth(4)).toContainText('Read the site, in Articles, to tell.');
  await expect(panel(page, 'overview')).toContainText('1 of 6 done. 2 need a read of the site.');
  await shoot(page, 'hub-overview');
  await steps.nth(2).getByRole('button', { name: 'Identity ›' }).click();
  await expect(panel(page, 'identity')).toBeVisible();
  await expect(tab(page, 'Identity')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'overview')).toBeHidden();
  await tab(page, 'Overview').click();
  await steps.nth(5).getByRole('button', { name: 'Articles ›' }).click();
  await expect(panel(page, 'articles')).toBeVisible();

  // the arrow keys walk the bar
  await tab(page, 'Articles').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Readers')).toHaveAttribute('aria-selected', 'true');

  // nothing was asked of GitHub, nor of any address outside this computer
  expect(asked).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});

test('Identity follows the name and the line as they are typed, saves them once the field is left, and keeps the credit', async ({ page }) => {
  const fixture = await openWebsite(page, { github, settings: { signature: true, report_name: 'A. Analyst' } });
  await tab(page, 'Identity').click();
  const name = page.getByLabel('Site name');
  await expect(name).toHaveAttribute('placeholder', 'A. Analyst');
  await expect(panel(page, 'identity')).toContainText('Empty, it takes your Publishing name, A. Analyst.');
  const hero = page.getByRole('region', { name: 'The site at a glance' });
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('A. Analyst');

  // typed, not yet left: the hero and the three previews already follow, and nothing is saved
  await name.fill('Open Desk');
  await page.getByLabel('Tagline').fill('Clarity is the tool.');
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Open Desk');
  await expect(hero).toContainText('Clarity is the tool.');
  const paper = panel(page, 'identity').locator('.paper');
  await expect(paper).toContainText('Open Desk');
  await panel(page, 'identity').getByRole('button', { name: 'Home page' }).click();
  await expect(paper).toContainText('Open Desk');
  await expect(paper).toContainText('Clarity is the tool.');
  await expect(paper).toContainText('Made with Azimut');
  await panel(page, 'identity').getByRole('button', { name: 'Feed' }).click();
  await expect(paper).toContainText('Clarity is the tool.');
  expect(fixture.settingsWrites).toEqual([]);
  await shoot(page, 'hub-identity');

  await name.press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_title: 'Open Desk' });
  await page.getByLabel('Tagline').press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_tagline: 'Clarity is the tool.' });
  const credit = page.getByRole('checkbox', { name: 'Made with Azimut' });
  await expect(credit).toBeChecked();
  await credit.uncheck();
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_credit_azimut: false });
  await panel(page, 'identity').getByRole('button', { name: 'Home page' }).click();
  await expect(paper).not.toContainText('Made with Azimut');
  fixture.expectNoUnexpectedRequests();
});

test('the site logo is a PNG of its own, shown from the one address, and the Publishing logo comes back on a press', async ({ page }) => {
  const logos = [];
  const fixture = await openWebsite(page, { github, settings: { signature: true } });
  await page.route('**/api/settings/site-logo', (route) => {
    logos.push(route.request().method());
    return route.fulfill({ json: { site_logo: route.request().method() === 'POST' } });
  });
  await tab(page, 'Identity').click();
  await expect(panel(page, 'identity')).toContainText('The Publishing logo, the one on your reports.');
  await expect(page.getByRole('button', { name: 'Use the Publishing logo' })).toHaveCount(0);

  await panel(page, 'identity').locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => logos).toEqual(['POST']);
  await expect(panel(page, 'identity')).toContainText('A picture of its own, on every page of the site.');
  await expect(panel(page, 'identity').locator('img.well')).toHaveAttribute('src', /\/api\/settings\/site-logo\.png\?v=/);
  await expect(page.getByRole('region', { name: 'The site at a glance' }).locator('img.logo')).toBeVisible();

  await page.getByRole('button', { name: 'Use the Publishing logo' }).click();
  await expect.poll(() => logos).toEqual(['POST', 'DELETE']);
  await expect(panel(page, 'identity')).toContainText('The Publishing logo, the one on your reports.');
  await expect(page.getByRole('button', { name: 'Use the Publishing logo' })).toHaveCount(0);

  // a file that is no PNG is refused in the browser, before it is sent
  await panel(page, 'identity').locator('input[type="file"]').setInputFiles({ name: 'logo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]) });
  await expect(page.getByText('The logo must be a PNG picture')).toBeVisible();
  expect(logos).toEqual(['POST', 'DELETE']);
  fixture.expectNoUnexpectedRequests();
});

test('Articles reads the site on a press only, lists what it holds, and deletes a folder through its confirmation', async ({ page }) => {
  const fixture = await openWebsite(page);
  const asked = await standIn(page);
  await tab(page, 'Articles').click();
  await expect(panel(page, 'articles')).toContainText('The site is not read yet.');
  expect(asked).toEqual([]);

  await panel(page, 'articles').getByRole('button', { name: 'Read the site' }).click();
  await expect(panel(page, 'articles')).toContainText('Read today at');
  expect(asked).toEqual(['POST read']);
  const rows = panel(page, 'articles').locator('.rows .item:not(.head)');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('The fall of the Bab al-Mandab front, Sep-Nov 2026');
  await expect(rows.first()).toContainText('/articles/bab-el-mandab-2026/');
  await expect(rows.first()).toContainText('Conflict Watch');
  await expect(rows.first()).toContainText('4.2 MB');
  await expect(rows.nth(2)).toContainText('Map');
  await expect(rows.nth(2)).toContainText('290 MB');
  await expect(rows.nth(4)).toContainText('Unlisted');
  await expect(rows.first().getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://octo.github.io/articles/bab-el-mandab-2026/');
  await expect(tab(page, 'Articles')).toContainText('5');
  // the hero and the categories carry the read too
  await expect(page.getByRole('region', { name: 'The site at a glance' })).toContainText('2 articles · 1 map · 1 page · 1 unlisted · 312 MB');
  await expect(panel(page, 'articles').locator('.cats li')).toHaveCount(2);
  await shoot(page, 'hub-articles');

  // a chip keeps what it names
  await panel(page, 'articles').getByRole('button', { name: /^Maps/ }).click();
  await expect(rows).toHaveCount(1);
  await panel(page, 'articles').getByRole('button', { name: /^All/ }).click();
  await expect(rows).toHaveCount(5);

  // Delete asks first, and Cancel asks GitHub nothing
  await rows.first().getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this article from the site?' });
  await expect(dialog).toContainText('Deletes bab-el-mandab-2026/ from octo/articles and takes it off the lists, the feed and the sitemap, in one commit.');
  await expect(dialog).toContainText('The note stays in your case: publish it again to put it back.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows).toHaveCount(5);
  expect(asked).toEqual(['POST read']);

  await rows.first().getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete from the site' }).click();
  await expect(dialog).toHaveCount(0);
  expect(asked).toEqual(['POST read', 'POST delete bab-el-mandab-2026']);
  await expect(rows).toHaveCount(4);
  await expect(panel(page, 'articles')).toContainText('Deleted bab-el-mandab-2026/: 3 files written.');
  await expect(tab(page, 'Articles')).toContainText('4');
  await expect(panel(page, 'articles').locator('.cats li')).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});

test('a delete GitHub refused keeps the row and says why', async ({ page }) => {
  await openWebsite(page);
  await standIn(page, { deleted: { status: 409, json: { detail: 'The branch moved on GitHub meanwhile: press Delete again.' } } });
  await tab(page, 'Articles').click();
  await panel(page, 'articles').getByRole('button', { name: 'Read the site' }).click();
  const rows = panel(page, 'articles').locator('.rows .item:not(.head)');
  await expect(rows).toHaveCount(5);
  await rows.nth(3).getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Delete from the site' }).click();
  await expect(dialog).toContainText('press Delete again');
  await expect(rows).toHaveCount(5);
});

test('Hosting says the site\'s limits, and draws how much of them it uses once the site is read', async ({ page }) => {
  await openWebsite(page);
  await standIn(page);
  await tab(page, 'Hosting').click();
  const limits = page.getByRole('region', { name: 'Limits' });
  await expect(limits).toContainText('Read the site to see its size.');
  await expect(limits.locator('.limits li')).toHaveCount(7);
  await expect(limits.getByRole('link', { name: /GitHub's limits/ })).toHaveAttribute('href', 'https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits');
  await expect(page.getByRole('region', { name: 'GitHub Pages' })).toContainText('Set up');
  await limits.getByRole('button', { name: 'Read the site' }).click();
  await expect(limits).toContainText('Site: 312 MB of 1 GB');
  await expect(limits).toContainText('Repository with its history: 1.4 GB of 1 GB recommended');
  await expect(limits.getByRole('meter', { name: 'Site' })).toHaveAttribute('data-level', 'ok');
  await expect(limits.getByRole('meter', { name: 'Repository with its history' })).toHaveAttribute('data-level', 'danger');
  await shoot(page, 'hub-hosting');
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
  const steps = page.locator('details.how').filter({ hasText: 'GoatCounter site' });
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
  await page.getByLabel('Cloudflare token').fill(`<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${TOKEN}"}'></script>`);
  await page.getByLabel('Cloudflare token').press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats_token: TOKEN });
  await expect(page.getByLabel('Cloudflare token')).toHaveValue(TOKEN);
  await shoot(page, 'hub-readers');

  await group.getByRole('radio', { name: 'Off' }).click();
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats: '' });
  await expect(page.getByLabel('Cloudflare token')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open Cloudflare's dashboard/ })).toHaveCount(0);
});

test('Readers gives the feed and the sitemap addresses to copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await openWebsite(page);
  await tab(page, 'Readers').click();
  const follow = page.getByRole('region').filter({ hasText: 'Follow and find' }).last();
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
  await expect(page.getByRole('region', { name: 'The site at a glance' })).toContainText('Updating octo/articles…');
  await expect(section).toContainText('The site is updated: 2 files written.');
  await expect(section.getByRole('list', { name: 'To mind' })).toContainText('feed.xml is yours');
  expect(asked).toEqual(['POST']);
  await shoot(page, 'hub-upkeep');
  // the hero's press is the same press
  await page.getByRole('region', { name: 'The site at a glance' }).getByRole('button', { name: 'Update the site' }).click();
  await expect.poll(() => asked).toEqual(['POST', 'POST']);
});

test('Update the site waits for GitHub to be set up', async ({ page }) => {
  const nothing = { account: '', repo: 'articles', branch: 'main', site: '', base: '', token: { set: false, hint: '' } };
  await openWebsite(page, { github: nothing });
  await tab(page, 'Upkeep').click();
  const press = page.getByRole('region', { name: 'Update the site' }).getByRole('button', { name: 'Update the site' });
  await expect(press).toBeDisabled();
  await expect(press).toHaveAttribute('title', 'Set up GitHub Pages under Hosting first');
  await expect(page.getByRole('region', { name: 'The site at a glance' }).getByRole('button', { name: 'Update the site' })).toBeDisabled();
});

test('Make it yours and WordPress have their panels', async ({ page }) => {
  await openWebsite(page);
  await tab(page, 'Make it yours').click();
  const own = panel(page, 'yours');
  await expect(own.getByRole('heading', { name: 'Your own home page' })).toBeVisible();
  await expect(own.locator('code').first()).toContainText('index.html');
  await expect(own.getByRole('link', { name: /GitHub's guide/ }))
    .toHaveAttribute('href', 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site');
  await tab(page, 'WordPress').click();
  await expect(panel(page, 'wordpress').getByRole('heading', { name: 'Also send to WordPress' })).toBeVisible();
  await expect(panel(page, 'wordpress').getByRole('region', { name: 'WordPress' })).toBeVisible();
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
