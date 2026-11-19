import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Writing without Markdown: words selected bring up the bubble, whose Bold is one
 * Undo step; Ctrl+K finds the page's bookmark in the case and cites it; the + of an
 * empty line opens the insert menu, whose Callout lands a callout; `/tab` still finds
 * Table. The server is stood in for; nothing reaches past it.
 */

const BOOKMARK = { id: 'b1', type: 'bookmark', label: 'Port report, 14 Sep', attrs: { url: 'https://example.org/port/report', folder: '' } };

async function notebook(page, start = '# Lead\n\nSeen at the quay on day two.\n') {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [
    { id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } },
    { ...BOOKMARK, provenance: { by: 'user', at, status: 'confirmed' } },
  ];
  await installAppFixture(page, { catalog });
  const state = { written: [], lookups: [], outside: [] };
  let text = start;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.protocol.startsWith('http')) state.outside.push(url.href);
  });
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/sources/lookup**`, (route) => {
    const url = new URL(route.request().url()).searchParams.get('url');
    state.lookups.push(url);
    const found = url === BOOKMARK.attrs.url ? [BOOKMARK] : [];
    return route.fulfill({ json: { url, title: 'example.org/port/report', found } });
  });
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: 'Seen at the quay.', words: 7,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
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
  await expect(page.locator('.cm-content')).toContainText('Seen at the quay');
  return state;
}

/** Double-press a word of the note, as one selects it. */
async function pressWord(page, word) {
  const box = await page.locator('.cm-content').evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      return range.getBoundingClientRect().toJSON();
    }
    return null;
  }, word);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

test('select a word, Bold it from the bubble, and one Undo takes it back', async ({ page }) => {
  const state = await notebook(page);
  await pressWord(page, 'quay');
  const bubble = page.getByRole('toolbar', { name: 'Format the words selected' });
  await expect(bubble).toBeVisible();
  await expect(bubble.getByRole('button', { name: 'Bold' })).toHaveAttribute('title', 'Bold (Ctrl+B)');
  await bubble.getByRole('button', { name: 'Bold' }).click();
  await expect.poll(() => state.written.at(-1)).toBe('# Lead\n\nSeen at the **quay** on day two.\n');
  // the line stays drawn: the marks are not shown around the words
  await expect(page.locator('.cm-content')).not.toContainText('**');
  await expect(bubble.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+z');
  await expect.poll(() => state.written.at(-1)).toBe('# Lead\n\nSeen at the quay on day two.\n');
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);
});

test('Ctrl+K finds the page among the case\'s bookmarks, nothing fetched, and cites it', async ({ page }) => {
  const state = await notebook(page);
  await pressWord(page, 'quay');
  await expect(page.getByRole('toolbar', { name: 'Format the words selected' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const field = page.getByRole('textbox', { name: 'Link address, or a case item to cite' });
  await expect(field).toBeFocused();
  // Go to stays shut: the key was the editor's
  await expect(page.getByRole('dialog', { name: 'Go to', exact: true })).toHaveCount(0);
  await field.fill(BOOKMARK.attrs.url);
  await expect(page.locator('.cm-link-head')).toHaveText('In the case: Port report, 14 Sep');
  await page.getByRole('button', { name: 'Cite it' }).click();
  await expect.poll(() => state.written.at(-1)).toBe('# Lead\n\nSeen at the [[entity:b1|Port report, 14 Sep]] on day two.\n');
  expect(state.lookups).toEqual([BOOKMARK.attrs.url]);
  expect(state.outside.filter((url) => url.startsWith('https://example.org'))).toEqual([]);
});

test('the + of an empty line opens the insert menu, and Callout lands a callout', async ({ page }) => {
  const state = await notebook(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  const plus = page.locator('.cm-content').getByRole('button', { name: 'Insert a block' });
  await expect(plus).toBeVisible();
  await plus.click();
  const menu = page.locator('.cm-tooltip-autocomplete.cm-insert-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('completion-section')).toHaveText(['Text', 'Media', 'From the case', 'Layout', 'Figures']);
  // the preview of the entry lit stands beside the list
  await expect(menu.locator('.cm-completionInfo .cm-ip-name')).toHaveText('Heading 1');
  await menu.getByRole('option', { name: /^Callout/ }).click();
  await expect(menu.locator('completion-section')).toHaveText(['Callout']);
  await menu.getByRole('option', { name: /^Confirmed/ }).click();
  await page.keyboard.type('Seen twice.');
  await expect.poll(() => state.written.at(-1)).toBe('# Lead\n\nSeen at the quay on day two.\n\n> [!confirmed] Seen twice.');
});

test('/tab still finds Table, and Enter writes it', async ({ page }) => {
  const state = await notebook(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('/tab');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Table');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  // a table, its rows written as Markdown reads them; the slash and what was typed gone
  await expect.poll(() => state.written.at(-1) ?? '').toMatch(/^# Lead\n\nSeen at the quay on day two\.\n+\|.*\|\n\| --- \|/);
  expect(state.written.at(-1)).not.toContain('/tab');
});
