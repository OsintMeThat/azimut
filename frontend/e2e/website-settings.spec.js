import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Settings › Website, end to end in the browser: the tab after Publishing holding the site's
 * title and line, where a note goes, how readers are counted, Update the site and the Legal
 * notice page. The server and GitHub are stood in for: what is checked is what the browser
 * asks, and that nothing reaches GitHub before a press.
 *
 * `AZIMUT_SHOTS` names a folder the run also draws the views into.
 */

const SHOTS = process.env.AZIMUT_SHOTS ?? '';

async function shoot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const github = {
  account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
  token: { set: true, hint: '…wxyz' }, website: { title: 'Octo Desk', logo: false, counting: '' }, categories: [],
};
const TOKEN = '0123456789abcdef0123456789abcdef';

async function openWebsite(page, options = { github }) {
  const fixture = await installAppFixture(page, options);
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Website' }).click();
  return fixture;
}

test.use({ viewport: { width: 1280, height: 1000 } });

test('the tab holds the site, both places a note goes, the counting, the update and the legal notice', async ({ page }) => {
  const fixture = await openWebsite(page);
  await shoot(page, 'settings-website');
  for (const name of ['Website', 'Site', 'GitHub Pages', 'WordPress', 'Statistics', 'Update the site', 'Legal notice']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText('Publish your notes as a simple website on GitHub Pages')).toBeVisible();
  await expect(page.getByText('The site stays yours to change, and Azimut only ever rewrites the files it made.')).toBeVisible();
  await expect(page.getByText('Depending on your country, a website may need a legal notice.')).toBeVisible();

  // Make it yours is folded until opened
  const own = page.locator('details.own');
  await expect(own).not.toHaveAttribute('open', '');
  await own.getByText('Make it yours', { exact: true }).click();
  await expect(own.getByText('Your own home page')).toBeVisible();
  await expect(own.locator('code').first()).toHaveText('index.html');
  await expect(own.getByRole('link', { name: "GitHub's guide" }))
    .toHaveAttribute('href', 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site');

  // the title saves when the field is left, and says what it falls back to while empty
  const title = page.getByPlaceholder('Octo Desk');
  await title.fill('Open Desk');
  await title.press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_title: 'Open Desk' });
  await page.getByPlaceholder('What the site is about').fill('Clarity is the tool.');
  await page.getByPlaceholder('What the site is about').press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_tagline: 'Clarity is the tool.' });
  const credit = page.getByRole('checkbox', { name: 'Made with Azimut' });
  await expect(credit).toBeChecked();
  await credit.uncheck();
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_credit_azimut: false });
  fixture.expectNoUnexpectedRequests();
});

test('readers are counted only when asked, with the setup said field by field', async ({ page }) => {
  const fixture = await openWebsite(page);
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
  await page.getByLabel('Cloudflare token').fill(`<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${TOKEN}"}'></script>`);
  await page.getByLabel('Cloudflare token').press('Tab');
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats_token: TOKEN });
  await expect(page.getByLabel('Cloudflare token')).toHaveValue(TOKEN);
  await shoot(page, 'settings-website-counting');

  await group.getByRole('radio', { name: 'Off' }).click();
  await expect.poll(() => fixture.settingsWrites).toContainEqual({ site_stats: '' });
  await expect(page.getByLabel('Cloudflare token')).toHaveCount(0);
});

test('Update the site asks GitHub on its press only, and says what it did', async ({ page }) => {
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
  const section = page.getByRole('region', { name: 'Update the site' });
  const press = section.getByRole('button', { name: 'Update the site' });
  await expect(press).toBeEnabled();
  expect(asked).toEqual([]);
  await press.click();
  await expect(section).toContainText('Updating octo/articles…');
  await expect(section).toContainText('The site is updated: 2 files written.');
  await expect(section.getByRole('list', { name: 'To mind' })).toContainText('feed.xml is yours');
  expect(asked).toEqual(['POST']);
});

test('Update the site waits for GitHub to be set up', async ({ page }) => {
  const nothing = { account: '', repo: 'articles', branch: 'main', site: '', base: '', token: { set: false, hint: '' } };
  await openWebsite(page, { github: nothing });
  const press = page.getByRole('region', { name: 'Update the site' }).getByRole('button', { name: 'Update the site' });
  await expect(press).toBeDisabled();
  await expect(press).toHaveAttribute('title', 'Set up GitHub Pages above first');
});

test('the Legal notice page starts in the open case, and cannot without one', async ({ page }) => {
  const asked = [];
  await installAppFixture(page, { github });
  await page.route(`**/api/cases/${CASE_ID}/notes/legal-notice`, (route) => {
    asked.push(route.request().method());
    return route.fulfill({ json: { id: 'n9', title: 'Legal notice', created: true } });
  });
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Website' }).click();
  const press = page.getByRole('button', { name: 'Start a Legal notice page' });
  await expect(press).toBeEnabled();
  await press.click();
  await expect.poll(() => asked).toEqual(['POST']);
  await expect(page).toHaveURL(/#notebook/);
});

test('with no case open the Legal notice press says to open one first', async ({ page }) => {
  await openWebsite(page, { github, lastCase: null });
  const press = page.getByRole('button', { name: 'Start a Legal notice page' });
  await expect(press).toBeDisabled();
  await expect(press).toHaveAttribute('title', 'Open a case first: the page is a note of that case');
});
