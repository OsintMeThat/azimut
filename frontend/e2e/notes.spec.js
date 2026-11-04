import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The Notebook as it is written in: @ cites, / inserts, a note goes beside the tools
 * and into a tab of its own, and what is typed reaches the note's route.
 */

const at = '2026-10-01T10:00:00Z';
const CATALOG = [
  { id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/Lead.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } },
  { id: 'p1', type: 'place', label: 'Quay', attrs: { lat: 1, lon: 2 }, provenance: { by: 'user', at, status: 'confirmed' } },
];

async function withNote(page, text = 'First line.') {
  const fixture = await installAppFixture(page, { catalog: CATALOG });
  const written = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  return { fixture, written };
}

/** Enter on an open menu, once it has held still: CodeMirror ignores an Enter in its first 75 ms. */
async function pick(page, label) {
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText(label);
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
}

async function openLead(page) {
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Lead');
  await expect(page.locator('.cm-content')).toContainText('First line.');
}

test('@ cites a case item as a chip, and the note is written with its reference', async ({ page }) => {
  const { written } = await withNote(page);
  await openLead(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Seen at @Qu');
  await pick(page, 'Quay');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-chip')).toContainText('Quay');
  await expect.poll(() => written.at(-1) ?? '').toContain('Seen at [[entity:p1|Quay]]');
});

test('/ turns a line into a task, a heading or a callout', async ({ page }) => {
  const { written } = await withNote(page);
  await openLead(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/todo');
  await pick(page, 'To-do');
  await page.keyboard.type('Archive the post');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/confirmed');
  await pick(page, 'Confirmed');
  await page.keyboard.type('The mast matches.');
  await expect.poll(() => written.at(-1) ?? '').toBe('First line.\n- [ ] Archive the post\n> [!confirmed] The mast matches.');
  await page.locator('[data-guide="notebook.home"]').click();
  await expect(page.locator('[data-guide="notebook.case"]')).toBeVisible();
});

test('a note kept beside the tools stays open on another tool, and is the same note', async ({ page }) => {
  const { written } = await withNote(page);
  await openLead(page);
  await page.locator('[data-guide="notebook.dock"]').click();
  await page.locator('.rail').getByRole('button', { name: 'Sources' }).click();
  const dock = page.locator('[data-guide="notes.dock"]');
  await expect(dock).toBeVisible();
  await expect(dock.locator('.which')).toContainText('Lead');
  await dock.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Typed beside.');
  await expect.poll(() => written.at(-1) ?? '').toBe('First line. Typed beside.');
  // the top bar's note button closes it, and opens it again on the same note
  await page.locator('[data-guide="start.note"]').click();
  await expect(dock).toHaveCount(0);
  await page.locator('[data-guide="start.note"]').click();
  await expect(dock.locator('.cm-content')).toContainText('Typed beside.');
});

test('a note opens in a tab of its own, without the app around it', async ({ page, context }) => {
  await withNote(page);
  // the new tab has none of this page's routes: nothing of it may reach a real server
  await context.route('**/api/**', (route) => route.abort());
  await openLead(page);
  const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('[data-guide="notebook.tab"]').click()]);
  // the tab opens blank at the press, as browsers allow, and is pointed at the note once it is written
  await tab.waitForURL(/#notebook\?/);
  expect(tab.url()).toContain('note=n1');
  expect(tab.url()).toContain('solo=1');
  // this tab goes back to the notes
  await expect(page.locator('[data-guide="notebook.case"]')).toBeVisible();
});

test('a tab opened on a note alone shows that note, and none of the app around it', async ({ page }) => {
  await withNote(page);
  await page.goto(`/#notebook?case=${CASE_ID}&note=n1&solo=1`);
  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Lead');
  await expect(page.locator('.cm-content')).toContainText('First line.');
  await expect(page.locator('.rail')).toHaveCount(0);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('[data-guide="notebook.tab"]')).toHaveCount(0);
});
