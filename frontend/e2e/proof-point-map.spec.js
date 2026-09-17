import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * A proof's point, moved on the ground rather than typed.
 *
 * Driven in a real browser because that is the only place the map exists: the
 * unit tests pin what the dialog asks the engine for, and nothing below the
 * engine can say that a click on the imagery lands in the coordinate row.
 */

const row = (page) => page.locator('.point-row').first();

test('a click on the map fills the coordinate row it was opened from', async ({ page }) => {
  await installAppFixture(page);
  await openProofWithPanel(page);

  await expect(row(page).locator('.meta-input')).toHaveValue('');
  await row(page).getByTitle('Move this point on the map').click();
  await expect(page.getByRole('dialog', { name: 'Move the point' })).toBeVisible();
  await awaitMapReady(page);
  await expect(page.getByText('Click the map to move the pin.')).toBeVisible();

  const box = await page.locator('.stage .map').boundingBox();
  await page.mouse.click(box.x + box.width / 2 - 70, box.y + box.height / 2 - 40);
  const picked = await page.locator('.reading').textContent();
  // six decimals: the point is a claim about a tenth of a metre
  expect(picked.trim()).toMatch(/^-?\d+\.\d{6}, -?\d+\.\d{6}$/);

  await page.getByRole('button', { name: 'Use this point' }).click();
  await expect(page.getByRole('dialog', { name: 'Move the point' })).toHaveCount(0);
  await expect(row(page).locator('.meta-input')).toHaveValue(picked.trim());
});

test('cancelling leaves the row exactly as it was', async ({ page }) => {
  await installAppFixture(page);
  await openProofWithPanel(page);

  const field = row(page).locator('.meta-input');
  await field.fill('48.858400, 2.294500');
  await row(page).getByTitle('Move this point on the map').click();
  await awaitMapReady(page);

  // opened on what the row already says, which is where the pin starts
  await expect(page.locator('.reading')).toHaveText('48.858400, 2.294500');
  const box = await page.locator('.stage .map').boundingBox();
  await page.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('dialog', { name: 'Move the point' })).toHaveCount(0);
  await expect(field).toHaveValue('48.858400, 2.294500');
});

test('a row added under a point opens beside it, not on the empty ocean', async ({ page }) => {
  await installAppFixture(page);
  await openProofWithPanel(page);

  await row(page).locator('.meta-input').fill('48.858400, 2.294500');
  await page.getByTitle('Add a point').click();
  const second = page.locator('.point-row').nth(1);
  await expect(second.locator('.meta-input')).toHaveValue('');

  await second.getByTitle('Move this point on the map').click();
  await awaitMapReady(page);
  // the pin starts on the point above, so the analyst places the new one from
  // the same rooftop rather than from zoom 3 over the Atlantic
  await expect(page.locator('.reading')).toHaveText('48.858400, 2.294500');
});
