import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A note published to GitHub Pages in one press, end to end in the browser: the export
 * dialog's Web folder branch giving the page's address on the site with a short name,
 * Publish, GitHub building the page, then Live at its address with Open and Copy link;
 * the note's Editions listing the page. A repository with Pages off is set up from the
 * dialog by its own press. The server and GitHub are stood in for: what is checked is
 * what the browser asks, and that nothing goes to GitHub before a press.
 *
 * `AZIMUT_SHOTS` names a folder the run also draws the views into, at 1440x900.
 */

const SHOTS = process.env.AZIMUT_SHOTS ?? '';
const at = '2026-10-01T10:00:00Z';
const ADDRESS = 'https://octo.github.io/articles/port-strike/';
const COMMIT = '3f1c9a2'.padEnd(40, '0');
const note = (id, label) => ({
  id, type: 'note', label, attrs: { path: `notes/${id}.md`, folder: '' }, provenance: { by: 'user', at, status: 'confirmed' },
});
const picture = (id, label) => ({
  id, type: 'media', label, attrs: { path: `media/${id}.jpg` }, provenance: { by: 'user', at, status: 'confirmed' },
});

async function shoot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function stand(page, { pages = true, categories = [], edited = false, look = { style: 'report' }, editions = [], settings = {}, offer = null } = {}) {
  const catalog = [note('n1', 'Port strike'), picture('e_pier', 'Pier at dawn'), picture('e_harbour', 'Harbour')];
  const github = { account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
    token: { set: true, hint: '…wxyz' }, categories };
  await installAppFixture(page, { catalog, github, settings });
  const state = {
    text: '## What we saw\n\nSmoke over the pier at dawn.\n\n> [!internal]\n> Who told us.\n',
    pages, published: [], builds: 0, presses: [], editions, look, looks: [], lookReads: 0, checks: 0, offers: 0,
  };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith('/api/publishing/github'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    state.presses.push(path);
    if (path.endsWith('/pages')) {
      state.pages = true;
      return route.fulfill({ json: { ok: true, base: 'https://octo.github.io/articles/', pages: { url: 'https://octo.github.io/articles/' } } });
    }
    if (path.endsWith('/categories')) {
      return route.fulfill({ json: { ok: true, categories: ['Investigations', 'Conflict Watch'], warnings: [] } });
    }
    if (path.endsWith('/build')) {
      state.builds += 1;
      // the first answer takes a moment, so the dialog is seen while GitHub builds
      if (state.builds === 1) await new Promise((resolve) => setTimeout(resolve, 900));
      return route.fulfill({ json: { state: 'built', detail: '' } });
    }
    return route.fallback();
  });
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    const method = request.method();
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      const row = (id, title, text) => ({
        id, title, folder: '', updated_at: at, excerpt: text.split('\n')[0], words: 6, tasks: { open: 0, done: 0 },
        mentions: 0, pictures: 0, look: null, includes: 0,
      });
      return route.fulfill({ json: { items: [row('case', 'Case notes', ''), row('n1', 'Port strike', state.text)] } });
    }
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      return route.fulfill({ json: { notes: body.notes.map((id) => ({ note: id, title: 'Port strike', internal: 1, weight: 2_400_000,
        links: [], pov: [], earlier: 0, warnings: [{ text: '1 internal passage left out.', line: null, kind: 'internal' }] })) } });
    }
    if (path === '/n1/github/check') {
      state.checks += 1;
      return route.fulfill({ json: { checked: true, exists: true, edited,
        warning: edited ? 'This folder was changed on GitHub since you published it: publishing replaces it.' : '' } });
    }
    if (path === '/n1/github') {
      const body = request.postDataJSON();
      if (!state.pages) {
        return route.fulfill({ json: { published: false, needs: 'pages', repository: 'octo/articles', detail: 'Pages is off for octo/articles.' } });
      }
      state.published.push(body);
      state.editions = [{ at: '2026-11-18T19:00:00Z', edition: 'public', format: 'github', file: body.short_name,
        address: `https://octo.github.io/articles/${body.short_name}/`, repository: 'octo/articles', branch: 'main',
        path: body.short_name, commit: COMMIT, sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64) }];
      return route.fulfill({ json: { published: true, address: `https://octo.github.io/articles/${body.short_name}/`,
        repository: 'octo/articles', branch: 'main', commit: COMMIT, sha256: 'a'.repeat(64), at: '2026-11-18T19:00:00Z',
        uploaded: 9, reused: 0, removed: 0, edited, site: { written: ['articles.json'], warnings: state.siteWarnings ?? [] }, warnings: [] } });
    }
    if (path === '/n1/editions') return route.fulfill({ json: { editions: state.editions } });
    if (path === '/n1/place') {
      state.offers += 1;
      return route.fulfill({ json: { suggested: offer } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) {
      if (method === 'PUT') {
        state.look = request.postDataJSON();
        state.looks.push(state.look);
        return route.fulfill({ json: { look: state.look } });
      }
      state.lookReads += 1;
      return route.fulfill({ json: { look: state.look } });
    }
    if (path === '/n1') {
      if (method === 'PUT') { state.text = request.postDataJSON().text; return route.fulfill({ json: { status: 'saved' } }); }
      return route.fulfill({ json: { text: state.text } });
    }
    return route.fallback();
  });
  return state;
}

async function openWebFolder(page) {
  await page.goto('/#notebook');
  await page.locator('button[title="Open Port strike"]').click();
  await expect(page.locator('.cm-content')).toContainText('Smoke over the pier');
  await page.locator('[data-guide="notebook.pdf"]').click();
  await page.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'Web folder' }).click();
  return page.getByRole('dialog', { name: 'Export note as a web folder' });
}

test.use({ viewport: { width: 1440, height: 900 } });

test('a note goes live on GitHub Pages on one press, and its editions list the page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const state = await stand(page);
  const dialog = await openWebFolder(page);
  // the address is the site's own and a short name made from the title
  await expect(dialog.locator('.base')).toHaveText('https://octo.github.io/articles/');
  await expect(dialog.getByRole('textbox', { name: 'Short name' })).toHaveValue('port-strike');
  await expect(dialog.getByRole('button', { name: 'Publish to GitHub Pages' })).toHaveClass(/btn-primary/);
  await expect(dialog.getByRole('button', { name: 'Export web folder' })).toBeEnabled();
  await shoot(page, 'dialog-github');
  expect(state.presses).toEqual([]);
  expect(state.published).toEqual([]);

  // a short name that is no address part is said, and holds both back
  const short = dialog.getByRole('textbox', { name: 'Short name' });
  await short.fill('Port Strike');
  await expect(dialog.locator('#export-short-said')).toContainText('A short name holds lower-case letters');
  await expect(dialog.getByRole('button', { name: 'Publish to GitHub Pages' })).toBeDisabled();
  await short.fill('port-strike');

  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog).toContainText('GitHub is building the page…');
  await shoot(page, 'dialog-github-building');
  const live = dialog.locator('.line.done');
  await expect(live).toContainText(`Live at ${ADDRESS}`);
  await expect(live.getByRole('link')).toHaveAttribute('href', ADDRESS);
  const open = dialog.getByRole('link', { name: 'Open', exact: true });
  await expect(open).toHaveAttribute('href', ADDRESS);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  // its maps go live online unless the dialog's Keep its maps offline is ticked
  expect(state.published).toEqual([{ short_name: 'port-strike', diagrams: {}, round_pov: false, changes: '', offline_maps: false,
    category: '', role: 'article', place: null }]);
  await shoot(page, 'dialog-github-live');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.locator('button[aria-label="More"]').click();
  await page.getByRole('button', { name: 'Editions' }).click();
  const row = page.getByRole('dialog', { name: 'Editions' }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('GitHub');
  await expect(row).toContainText(ADDRESS);
  await expect(row).toContainText('octo/articles · 3f1c9a2');
  await expect(row.getByRole('link', { name: 'Open' })).toHaveAttribute('href', ADDRESS);
  await expect(row.getByRole('button', { name: 'Check' })).toBeVisible();
  await shoot(page, 'editions-github');
});

test('Pages turned off is turned on from the dialog by its own press', async ({ page }) => {
  const state = await stand(page, { pages: false });
  const dialog = await openWebFolder(page);
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog).toContainText('Pages is off for octo/articles.');
  await expect(dialog).toContainText('Serves the branch from its root. The site is public.');
  expect(state.published).toEqual([]);
  await shoot(page, 'dialog-github-pages-off');
  await dialog.getByRole('button', { name: 'Turn on Pages' }).click();
  await expect(dialog).toContainText('Pages is on. Press Publish to GitHub Pages.');
  expect(state.presses).toEqual(['/api/publishing/github/pages']);
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog.locator('.line.done')).toContainText(`Live at ${ADDRESS}`);
});

test('the dialog says what the note is on the site: its category, Article or Page and its list picture', async ({ page }) => {
  const state = await stand(page, { look: { style: 'report', category: 'Harbour' }, categories: ['Conflict Watch'] });
  const dialog = await openWebFolder(page);
  // started from the note's look, suggesting what the site and the note hold, reaching nothing
  const category = dialog.locator('#export-category');
  await expect(category).toHaveValue('Harbour');
  await expect(dialog.locator('#export-categories option')).toHaveCount(2);
  const role = dialog.getByRole('radiogroup', { name: 'On the site' });
  await expect(role.getByRole('radio', { name: 'Article' })).toHaveAttribute('aria-checked', 'true');
  // no title in Settings › Website: the site is called by its account, and the line says so, with a way to name it
  await expect(dialog).toContainText('Goes on octo\'s home page and in its feed.');
  await expect(dialog).toContainText('Your site has no name yet: it shows as octo.');
  await expect(dialog.getByRole('button', { name: 'Name the site' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'The cover picture' })).toBeVisible();
  expect(state.presses).toEqual([]);
  await shoot(page, 'dialog-github-site');

  // the site's own categories are read on a press of their own
  await dialog.getByRole('button', { name: 'Read the site' }).click();
  await expect(dialog).toContainText('2 categories on the site.');
  await expect(dialog.locator('#export-categories option')).toHaveCount(3);
  expect(state.presses).toEqual(['/api/publishing/github/categories']);

  // a new category typed, a picture of the list picked and kept in the look as it is picked
  await category.fill('Port news');
  const reads = state.lookReads;
  await dialog.getByRole('button', { name: 'The cover picture' }).click();
  await dialog.getByPlaceholder('Find a picture…').fill('pier');
  await dialog.getByRole('button', { name: 'Pier at dawn' }).click();
  await expect(dialog.getByRole('button', { name: 'Pier at dawn' })).toBeVisible();
  await expect.poll(() => state.looks.length).toBe(1);
  expect(state.looks[0]).toMatchObject({ style: 'report', list_image: 'e_pier' });
  // the look was read as it stood before it was written, and again for the Notebook, which holds the note's look
  await expect.poll(() => state.lookReads).toBeGreaterThanOrEqual(reads + 2);

  // a page is off the list: no category or picture to give, and an unlisted one is in no list at all
  await role.getByRole('radio', { name: 'Page' }).click();
  await expect(dialog).toContainText('Off the list, linked from the site\'s header.');
  await expect(category).toHaveCount(0);
  await role.getByRole('radio', { name: 'Unlisted' }).click();
  await expect(dialog).toContainText('Online at its address only, in no list, feed or sitemap.');
  await expect(category).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Pier at dawn' })).toHaveCount(0);
  await role.getByRole('radio', { name: 'Article' }).click();
  await expect(category).toHaveValue('Port news');
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog.locator('.line.done')).toContainText(`Live at ${ADDRESS}`);
  expect(state.published).toHaveLength(1);
  expect(state.published[0]).toMatchObject({ short_name: 'port-strike', category: 'Port news', role: 'article' });
  // a note published for the first time is never checked against a folder
  expect(state.checks).toBe(0);
});

test('a guest\'s name and picture are kept with the note as they are left, for every role', async ({ page }) => {
  const state = await stand(page, { look: { style: 'report' } });
  const dialog = await openWebFolder(page);
  const author = dialog.locator('#export-author');
  await expect(author).toHaveValue('');
  await author.fill('Jane Guest');
  await author.press('Tab');
  await expect.poll(() => state.looks.length).toBe(1);
  expect(state.looks[0]).toMatchObject({ style: 'report', author: 'Jane Guest' });
  await dialog.getByRole('button', { name: 'No picture' }).click();
  await dialog.getByPlaceholder('Find a picture…').fill('pier');
  await dialog.getByRole('button', { name: 'Pier at dawn' }).click();
  await expect.poll(() => state.looks.length).toBe(2);
  expect(state.looks[1]).toMatchObject({ author: 'Jane Guest', author_image: 'e_pier' });
  const role = dialog.getByRole('radiogroup', { name: 'On the site' });
  for (const name of ['Page', 'Unlisted']) {
    await role.getByRole('radio', { name }).click();
    await expect(author).toHaveValue('Jane Guest');
  }
  await shoot(page, 'dialog-github-author');
});

test('an article is placed on the site\'s map by hand or by the note\'s offer, never filled without a press', async ({ page }) => {
  const offer = { lat: 12.7250041, lon: 43.5075, name: 'Bab al-Mandab', from: 'place', label: 'Bab al-Mandab' };
  const state = await stand(page, { offer });
  const dialog = await openWebFolder(page);
  const place = dialog.getByRole('group', { name: 'Place on the site\'s map' });
  const coords = place.getByRole('textbox', { name: 'Coordinates' });
  const name = place.getByRole('textbox', { name: 'Place name' });
  const said = place.getByRole('status');
  // empty, and the note's one place offered as a press with its rule, filled by nothing
  await expect(coords).toHaveValue('');
  await expect(name).toHaveValue('');
  await expect(said).toHaveText('Optional. Left empty, the article has no pin on the site\'s map.');
  const use = place.getByRole('button', { name: 'Use 12.7250, 43.5075 · Bab al-Mandab' });
  await expect(use).toBeVisible();
  await expect(use).toHaveAttribute('title', 'Fill the place with the point this note names');
  await expect(place).toContainText('The one place the note names.');
  await expect(coords).toHaveAttribute('title', 'Where this article stands on the site\'s map, pasted as lat, lon');
  await expect(name).toHaveAttribute('title', 'The name of the place, shown on its pin');
  expect(state.offers).toBe(1);
  expect(state.presses).toEqual([]);
  await shoot(page, 'dialog-github-place');

  // what is typed is read in place, and what is no place holds Publish back
  await coords.fill('the strait');
  await expect(said).toHaveText('That does not read as a point: paste it as lat, lon, such as 12.725, 43.5075.');
  await expect(coords).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('button', { name: 'Publish to GitHub Pages' })).toBeDisabled();
  await coords.fill('86, 43.5');
  await expect(said).toHaveText('The latitude must be between -85 and 85, where web maps stop.');
  await coords.fill('');
  await expect(dialog.getByRole('button', { name: 'Publish to GitHub Pages' })).toBeEnabled();

  // taken on its press only: the point, and its name
  await use.click();
  await expect(coords).toHaveValue('12.725004, 43.5075');
  await expect(name).toHaveValue('Bab al-Mandab');
  await expect(said).toHaveText('Reads as 12.725004° N, 43.5075° E.');
  await expect(use).toHaveCount(0);
  await name.fill('Bab al-Mandab, Yemen');
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog.locator('.line.done')).toContainText(`Live at ${ADDRESS}`);
  expect(state.published[0]).toMatchObject({ place: { lat: 12.725004, lon: 43.5075, name: 'Bab al-Mandab, Yemen' } });
});

test('a place the note keeps opens in the dialog, and emptied it goes up as none', async ({ page }) => {
  const kept = { lat: -33.9, lon: 18.42, name: 'Cape Town' };
  const state = await stand(page, { look: { style: 'report', place: kept }, offer: { lat: 1, lon: 2, name: 'Elsewhere', from: 'map', label: 'A map' } });
  const dialog = await openWebFolder(page);
  const place = dialog.getByRole('group', { name: 'Place on the site\'s map' });
  await expect(place.getByRole('textbox', { name: 'Coordinates' })).toHaveValue('-33.9, 18.42');
  await expect(place.getByRole('textbox', { name: 'Place name' })).toHaveValue('Cape Town');
  await expect(place.getByRole('status')).toHaveText('Reads as 33.9° S, 18.42° E.');
  // the note's own place stands: nothing is offered over it
  await expect(place.getByRole('button', { name: /^Use / })).toHaveCount(0);
  await place.getByRole('textbox', { name: 'Coordinates' }).fill('');
  await place.getByRole('textbox', { name: 'Place name' }).fill('');
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog.locator('.line.done')).toContainText(`Live at ${ADDRESS}`);
  expect(state.published[0].place).toBeNull();
});

test('the dialog names the site by its title, and says nothing of a name it has', async ({ page }) => {
  await stand(page, { settings: { site_title: 'Octo Desk' } });
  const dialog = await openWebFolder(page);
  await expect(dialog).toContainText('Goes on Octo Desk\'s home page and in its feed.');
  await expect(dialog).not.toContainText('has no name yet');
  await expect(dialog.getByRole('button', { name: 'Name the site' })).toHaveCount(0);
});

test('the dialog says the site has no name yet, and opens Settings on Identity to name it', async ({ page }) => {
  await stand(page);
  const dialog = await openWebFolder(page);
  await expect(dialog).toContainText('Your site has no name yet: it shows as octo.');
  await dialog.getByRole('button', { name: 'Name the site' }).click();
  await expect(page).toHaveURL(/#settings/);
  await expect(page.getByRole('tab', { name: 'Identity' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Site name')).toBeVisible();
});

test('a folder changed on GitHub is said before it is replaced, and replaced on one more press', async ({ page }) => {
  const published = { at: '2026-11-18T19:00:00Z', edition: 'public', format: 'github', file: 'port-strike', address: ADDRESS,
    repository: 'octo/articles', branch: 'main', path: 'port-strike', commit: COMMIT, sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64) };
  const state = await stand(page, { edited: true, editions: [published] });
  const dialog = await openWebFolder(page);
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  const warning = dialog.getByRole('alert').filter({ hasText: 'This folder was changed on GitHub since you published it' });
  await expect(warning).toContainText('publishing replaces it.');
  await expect(dialog.getByRole('button', { name: 'Publish anyway' })).toBeVisible();
  await shoot(page, 'dialog-github-edited');
  expect(state.checks).toBe(1);
  expect(state.published).toEqual([]);

  // stopping leaves everything as it was
  await warning.getByRole('button', { name: "Don't publish" }).click();
  await expect(warning).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Publish to GitHub Pages' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog.getByRole('button', { name: 'Publish anyway' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish anyway' }).click();
  await expect(dialog.locator('.line.done')).toContainText(`Live at ${ADDRESS}`);
  expect(state.published).toHaveLength(1);
  // asked once per warning: the second press went straight through
  expect(state.checks).toBe(2);
});

test('what the site had to say of itself is listed under the page once published', async ({ page }) => {
  const state = await stand(page);
  state.siteWarnings = ['The site holds too many files for Azimut to read: its home, list, feed and sitemap were left as they were.'];
  const dialog = await openWebFolder(page);
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog.locator('.line.done')).toContainText(`Live at ${ADDRESS}`);
  await expect(dialog.getByRole('list', { name: 'To mind' })).toContainText('The site holds too many files for Azimut to read');
});
