import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The citation card: hovering a chip shows what the case knows of its item, and Copy
 * reference copies its entry as the list of sources prints it; a written link the case
 * lacks says so, and Bookmark it files the page, the note left as it was; the cursor
 * resting in a link shows the card too, Tab reaching its actions. The server is stood
 * in for, and nothing reaches past it.
 */

const POST = 'https://x.com/portwatch/status/1899200000000000001';
const PAGE = 'https://example.org/port/closure';
const SHA = 'e1e32f4fcf40a0bcde7d2a638076d1a2995b8c96ccb0b53f198838f246cee09b';
const VIDEO = { id: 'v1', type: 'media', label: 'Strike on the port', attrs: { path: 'media/strike.mp4', kind: 'video', source_url: POST, sha256: SHA, folder: '' } };
const REFERENCE = `Strike on the port · Video · x.com · by Port Watch · posted 12 March 2026 · collected 13 March 2026. ${POST} SHA-256 ${SHA}`;
const START = `# Lead\n\nThe strike was filmed [[entity:v1|the video]]. The port closed ([Port notice, 13 Mar](${PAGE})).\n`;

async function notebook(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [
    { id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } },
    { ...VIDEO, provenance: { by: 'download', at, status: 'confirmed' } },
  ];
  await installAppFixture(page, { catalog });
  const state = { written: [], items: [], lookups: [], filed: [], outside: [] };
  let text = START;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.protocol.startsWith('http')) state.outside.push(url.href);
  });
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/sources/item**`, (route) => {
    const id = new URL(route.request().url()).searchParams.get('id');
    state.items.push(id);
    return route.fulfill({ json: {
      known: { id: 'v1', type: 'media', label: VIDEO.label, noun: 'Video', address: POST, author: 'Port Watch', published: '2026-03-12', archive: '',
        archived_at: '', seen: '2026-03-13', arrival: 'collected', sha256: SHA, thumb: '' },
      reference: REFERENCE,
    } });
  });
  await page.route(`**/api/cases/${CASE_ID}/sources/lookup**`, (route) => {
    const query = new URL(route.request().url()).searchParams;
    const url = query.get('url');
    state.lookups.push([url, query.get('words')]);
    const filed = state.filed.length > 0;
    return route.fulfill({ json: {
      url, title: 'example.org/port/closure', found: [],
      known: filed ? { id: 'b9', type: 'bookmark', label: 'example.org/port/closure', noun: 'Web page', address: url, author: '', published: '',
        archive: '', archived_at: '', seen: '2026-11-19', arrival: 'collected', sha256: '', thumb: '' } : null,
      reference: `${filed ? 'example.org/port/closure' : query.get('words')} · Web page · example.org. ${url}`,
    } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const payload = route.request().postDataJSON();
    state.filed.push(payload);
    const created = { id: 'b9', ...payload, provenance: { by: 'user', at: '2026-11-19T10:00:00Z', status: 'confirmed' } };
    catalog.push(created);
    return route.fulfill({ json: created });
  });
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: 'The strike was filmed.', words: 12,
        tasks: { open: 0, done: 0 }, mentions: 1, pictures: 0, look: null, includes: 0 }] } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: null } });
    if (path === '/n1') {
      if (request.method() === 'PUT') {
        text = request.postDataJSON().text;
        state.written.push(text);
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text } });
    }
    return route.fallback();
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('The port closed');
  return state;
}

/** The box of `words` as the page draws them. */
function wordsBox(page, words) {
  return page.locator('.cm-content').evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      return range.getClientRects()[0].toJSON();
    }
    return null;
  }, words);
}

test('hover a chip: its card says what the case knows, and Copy reference copies its entry', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const state = await notebook(page);
  const chip = page.locator('.cm-content [data-chip][data-entity-id="v1"]');
  await chip.hover();
  const card = page.getByRole('dialog', { name: 'About Strike on the port' });
  await expect(card).toBeVisible();
  await expect(card.locator('.cm-cite-kicker')).toHaveText('Video · x.com');
  await expect(card.locator('dt')).toHaveText(['Posted', 'By', 'Seen', 'Archived', 'SHA-256', 'In this note']);
  await expect(card.locator('dd')).toHaveText(['12 March 2026', 'Port Watch', '13 March 2026', 'Not archived', 'e1e32f4f…46cee09b', 'Cited once']);
  await expect(card.getByRole('link', { name: 'Open page' })).toHaveAttribute('href', POST);
  await card.getByRole('button', { name: 'Copy reference' }).click();
  await expect(card.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REFERENCE);
  expect(state.items).toEqual(['v1']);
  // the pointer gone, so is the card
  await page.mouse.move(5, 5);
  await expect(card).toHaveCount(0);
  expect(state.outside).toEqual([]);
});

test('a written link the case lacks: Bookmark it files the page, the card then says the day it was seen, the note keeps its text', async ({ page }) => {
  const state = await notebook(page);
  const box = await wordsBox(page, 'Port notice');
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  const card = page.getByRole('dialog', { name: 'About Port notice, 13 Mar' });
  await expect(card).toBeVisible();
  expect(state.lookups).toEqual([[PAGE, 'Port notice, 13 Mar']]);
  await expect(card.locator('dd')).toHaveText(['Not in the case', 'Not archived', 'Cited once']);
  await card.getByRole('button', { name: 'Bookmark it' }).click();
  const filed = page.getByRole('dialog', { name: 'About example.org/port/closure' });
  await expect(filed).toBeVisible();
  await expect(filed.locator('dt')).toContainText(['Seen']);
  await expect(filed.locator('dd').nth(2)).toHaveText('19 November 2026');
  expect(state.filed).toEqual([{ type: 'bookmark', label: 'example.org/port/closure', attrs: { url: PAGE, notes: '', folder: '' } }]);
  // the case reloaded, its new bookmark opens from the card
  await expect(filed.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  expect(state.written).toEqual([]);
  expect(state.outside).toEqual([]);
});

test('the cursor resting in a link shows its card; Tab reaches its actions, Escape gives the keys back', async ({ page }) => {
  const state = await notebook(page);
  const box = await wordsBox(page, 'The port closed');
  await page.mouse.click(box.x + box.width + 2, box.y + box.height / 2);
  await page.mouse.move(5, 5);
  // the cursor walked into the link's words with the keys
  for (let step = 0; step < 6; step += 1) await page.keyboard.press('ArrowRight');
  const card = page.getByRole('dialog', { name: 'About Port notice, 13 Mar' });
  await expect(card).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: 'Bookmark it' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(card.getByRole('link', { name: 'Open page' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeFocused();
  expect(state.filed).toEqual([]);
  expect(state.outside).toEqual([]);
});
