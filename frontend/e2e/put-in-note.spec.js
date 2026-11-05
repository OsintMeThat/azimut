import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A note pinned to the side takes what the tool on screen shows in one press: the
 * Sheet's rows as a table, a web source as a chip. The toast names the note, and
 * Undo takes the text back with what was filed for it.
 */

const SHEETS = [
  ['Candidates', ['Subject', 'Status'], [
    ['Quai sud', 'To check'],
    ['Pont nord', 'Seen'],
  ]],
];

async function withCaseNotes(page, options = {}) {
  const fixture = await installAppFixture(page, { sheets: SHEETS, ...options });
  const written = [];
  let text = '';
  await page.route(`**/api/cases/${CASE_ID}/notes`, async (route) => {
    if (route.request().method() === 'PUT') {
      text = route.request().postDataJSON().text;
      written.push(text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text } });
  });
  return { fixture, written };
}

/** Pin the case notes to the side, from the top bar. */
async function pinCaseNotes(page) {
  await page.locator('[data-guide="start.note"]').click();
  const dock = page.locator('[data-guide="notes.dock"]');
  await expect(dock.locator('.which')).toContainText('Case notes');
  return dock;
}

test('the Sheet puts its rows in the pinned note as a table, and Undo takes it back', async ({ page }) => {
  const { written } = await withCaseNotes(page);
  await page.goto('/#sheet');
  await page.locator('.home .sheet').first().click();
  await expect(page.getByRole('grid', { name: 'Sheet rows' })).toBeVisible();
  const dock = await pinCaseNotes(page);

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Put in “Case notes”' }).click();

  await expect(dock.locator('.cm-block-table')).toContainText('Pont nord');
  await expect.poll(() => written.at(-1) ?? '').toContain('| id | Subject | Status |\n| --- | --- | --- |\n| r1 | Quai sud | To check |');
  expect(written.at(-1)).toMatch(/^> Browser Test · Candidates — 2 of 2 rows\n> \d{4}-\d\d-\d\d \d\d:\d\d\n\n\| id/);

  const toast = page.locator('.toast', { hasText: 'Put in “Case notes”' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(dock.locator('.cm-block-table')).toHaveCount(0);
  await expect.poll(() => written.at(-1)).toBe('');
});

test('A source… keeps a new link as a bookmark named from its address, and cites it', async ({ page }) => {
  const asked = [];
  const { fixture } = await withCaseNotes(page, { newEntityId: 'b_new' });
  await page.route(`**/api/cases/${CASE_ID}/sources/lookup?**`, (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('url'));
    return route.fulfill({ json: { url: asked.at(-1), title: 'Telegram, portnews #412', found: [] } });
  });
  await page.goto('/#files');
  const dock = await pinCaseNotes(page);

  await dock.getByRole('button', { name: 'Add' }).click();
  const menu = page.getByRole('menu', { name: 'Add to this note' });
  // nothing on screen to put: the one row left is the source
  await expect(menu.getByRole('menuitem')).toHaveText(['A source…']);
  await menu.getByRole('menuitem', { name: 'A source…' }).click();

  const panel = page.getByRole('dialog', { name: 'A source' });
  await panel.getByLabel('Link to cite').fill('https://t.me/s/portnews/412');
  await expect(panel).toContainText('Telegram, portnews #412');
  await panel.getByRole('button', { name: /Bookmark/ }).click();

  await expect(dock.locator('.cm-chip')).toContainText('Telegram, portnews #412');
  expect(asked).toEqual(['https://t.me/s/portnews/412']);
  // a bookmark is a link and a name: nothing was fetched to make it
  expect(fixture.entityWrites).toContainEqual({
    type: 'bookmark', label: 'Telegram, portnews #412', attrs: { url: 'https://t.me/s/portnews/412', notes: '', folder: '' },
  });
  fixture.expectNoUnexpectedRequests();

  const deleted = page.waitForRequest((request) => request.method() === 'DELETE' && request.url().endsWith('/entities/b_new'));
  await page.locator('.toast', { hasText: 'Put in “Case notes”' }).getByRole('button', { name: 'Undo' }).click();
  await deleted;
  await expect(dock.locator('.cm-chip')).toHaveCount(0);
});
