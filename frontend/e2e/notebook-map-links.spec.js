import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A link to a map, end to end in the browser: the Link field lists the case's web maps and links the
 * words to one, drawn as a link to the map; the publish dialog names a linked map the site does not
 * hold yet, and Publish the map first puts the map on the site before the article. The server and
 * GitHub are stood in for: what is checked is what the browser asks, in which order.
 *
 * `AZIMUT_SHOTS` names a folder the run also draws the views into, at 1440x900.
 */

const SHOTS = process.env.AZIMUT_SHOTS ?? '';
const at = '2026-10-01T10:00:00Z';
const SITE = 'https://octo.github.io/articles/';
const COMMIT = '3f1c9a2'.padEnd(40, '0');
const MAP_LOOK = { style: 'article', web: 'map' };
const entity = (id, label, attrs = {}) => ({
  id, type: 'note', label, attrs: { path: `notes/${id}.md`, folder: '', ...attrs }, provenance: { by: 'user', at, status: 'confirmed' },
});

async function shoot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** The case: an article and a web map of the road, the map on no site yet; GitHub stood in for. */
async function stand(page, { text = '## What we saw\n\nSmoke over the pier, along [[entity:n_road|the road]].\n' } = {}) {
  const catalog = [entity('n1', 'Port strike'), entity('n_road', 'Road map', { look: MAP_LOOK })];
  const github = { account: 'octo', repo: 'articles', branch: 'main', site: '', base: SITE, token: { set: true, hint: '…wxyz' }, categories: [] };
  await installAppFixture(page, { catalog, github });
  const state = { text, published: [], checks: [], outside: [], editions: { n1: [], n_road: [] } };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.protocol.startsWith('http')) state.outside.push(url.href);
  });
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith('/api/publishing/github/build'),
    (route) => route.fulfill({ json: { state: 'built', detail: '' } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    const method = request.method();
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      const row = (id, title, look = null) => ({
        id, title, folder: '', updated_at: at, excerpt: '', words: 6, tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look, includes: 0,
        ...(look ? { map: { picture: '', address: state.editions[id]?.[0]?.address ?? '' } } : {}),
      });
      return route.fulfill({ json: { items: [row('case', 'Case notes'), row('n1', 'Port strike'), row('n_road', 'Road map', MAP_LOOK)] } });
    }
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      return route.fulfill({ json: { notes: body.notes.map((id) => ({ note: id, title: 'Port strike', internal: 0, weight: 1_200_000,
        links: [], pov: [], earlier: 0, warnings: [] })) } });
    }
    if (path === '/n1/github/maps') {
      const address = state.editions.n_road[0]?.address ?? '';
      return route.fulfill({ json: { maps: state.text.includes('[[entity:n_road|') ? [{ id: 'n_road', title: 'Road map', address, short: '', mentioned: true }] : [] } });
    }
    const check = /^\/(n1|n_road)\/github\/check$/.exec(path);
    if (check) {
      state.checks.push({ note: check[1], short: request.postDataJSON().short_name });
      return route.fulfill({ json: { checked: true, exists: false, edited: false, warning: '', taken: null, free: '' } });
    }
    const publish = /^\/(n1|n_road)\/github$/.exec(path);
    if (publish) {
      const body = request.postDataJSON();
      const address = `${SITE}${body.short_name}/`;
      state.published.push({ note: publish[1], body });
      state.editions[publish[1]] = [{ at: '2026-11-22T10:00:00Z', edition: 'public', format: 'github', file: body.short_name, address,
        repository: 'octo/articles', branch: 'main', path: body.short_name, commit: COMMIT, sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64) }];
      return route.fulfill({ json: { published: true, address, repository: 'octo/articles', branch: 'main', commit: COMMIT, sha256: 'a'.repeat(64),
        at: '2026-11-22T10:00:00Z', uploaded: 9, reused: 0, removed: 0, edited: false, site: { written: ['articles.json'], warnings: [] }, warnings: [] } });
    }
    const editions = /^\/(n1|n_road)\/editions$/.exec(path);
    if (editions) return route.fulfill({ json: { editions: state.editions[editions[1]] } });
    if (/^\/[\w-]+\/place$/.test(path)) return route.fulfill({ json: { suggested: null } });
    if (/^\/[\w-]+\/look$/.test(path)) {
      if (method === 'PUT') return route.fulfill({ json: { look: request.postDataJSON() } });
      return route.fulfill({ json: { look: path.startsWith('/n_road') ? MAP_LOOK : { style: 'report' } } });
    }
    if (path === '/n1') {
      if (method === 'PUT') {
        state.text = request.postDataJSON().text;
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text: state.text } });
    }
    return route.fallback();
  });
  return state;
}

async function openArticle(page) {
  await page.goto('/#notebook');
  await page.locator('button[title="Open Port strike"]').click();
  await expect(page.locator('.cm-content')).toContainText('What we saw');
}

/** Select words of the note as a drag over them selects them. */
async function selectWords(page, words) {
  const box = await page.locator('.cm-content').evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const found = node.data.indexOf(wanted);
      if (found < 0) continue;
      const range = document.createRange();
      range.setStart(node, found);
      range.setEnd(node, found + wanted.length);
      return range.getBoundingClientRect().toJSON();
    }
    return null;
  }, words);
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

test.use({ viewport: { width: 1440, height: 900 } });

test('the Link field lists the case\'s web maps and links the words to one, drawn as a link to the map', async ({ page }) => {
  const state = await stand(page, { text: '## What we saw\n\nSmoke over the pier, along the road at dawn.\n' });
  await openArticle(page);
  await selectWords(page, 'the road');
  const bubble = page.getByRole('toolbar', { name: 'Format the words selected' });
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: 'Link' }).click();
  const maps = page.getByRole('listbox', { name: 'Maps of the case' });
  await expect(page.locator('.cm-link-caption')).toHaveText('Link to a map');
  await expect(maps.getByRole('option')).toHaveCount(1);
  await expect(maps.getByRole('option')).toContainText('Road map');
  await shoot(page, 'link-to-a-map');
  await maps.getByRole('option', { name: /Road map/ }).click();
  await expect(page.locator('.cm-chip-map')).toHaveText('the road');
  await expect(page.locator('.cm-chip-map')).toHaveAttribute('title', 'Link to the map Road map. Click to open');
  await expect.poll(() => state.text).toContain('along [[entity:n_road|the road]] at dawn.');
  await page.mouse.click(700, 700);
  await shoot(page, 'map-link-chip');
  expect(state.outside).toEqual([]);
});

test('a map the site does not hold is named before the press, and Publish the map first puts it up before the article', async ({ page }) => {
  const state = await stand(page);
  await openArticle(page);
  await page.locator('[data-guide="notebook.pdf"]').click();
  await page.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'Web folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export note as a web folder' });
  const maps = dialog.getByRole('group', { name: 'Maps not on this site' });
  await expect(maps).toContainText('The map “Road map” is not on this site yet.');
  await expect(maps).toContainText('Published without it, the link to it reads as plain text.');
  const press = maps.getByRole('button', { name: 'Publish the map first' });
  await expect(press).toHaveAttribute('title', 'Publish each map to this site, then this article');
  await shoot(page, 'dialog-map-first');
  // nothing published before the press
  expect(state.published).toEqual([]);

  await press.click();
  await expect(dialog.locator('.line.done')).toContainText(`Live at ${SITE}port-strike/`);
  // the map went up first, under a name made from its title, then the article; a first publish of both, unlisted
  expect(state.published.map((one) => one.note)).toEqual(['n_road', 'n1']);
  expect(state.published[0].body).toMatchObject({ short_name: 'road-map', role: 'unlisted' });
  expect(state.published[1].body).toMatchObject({ short_name: 'port-strike', role: 'unlisted' });
  expect(state.checks.find((one) => one.note === 'n_road')).toEqual({ note: 'n_road', short: 'road-map' });
  await shoot(page, 'dialog-map-first-live');
  expect(state.outside).toEqual([]);
});
