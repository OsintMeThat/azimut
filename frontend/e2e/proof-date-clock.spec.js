import { test, expect } from '@playwright/test';
import { PANEL_PATH, installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * The clock a proof's date is read on. A day is the day of the place the footage
 * shows, so the composer reads it on the first point's zone, and a save sends the
 * analyst's pick only when they made one.
 */

const framed = {
  path: PANEL_PATH,
  provider_label: 'Esri',
  lat: 48.8584,
  lon: 2.2945,
  center_lat: 48.8584,
  center_lon: 2.2945,
  zoom: 17,
  fetched_at: '2026-09-01T10:00:00Z',
};

test('reads the date on the point’s clock, and sends another only once picked', async ({ page }) => {
  const fixture = await installAppFixture(page, { satCaptures: [framed] });
  await openProofWithPanel(page);

  const clock = page.locator('.when-zone .clock-trigger');
  await expect(clock).toHaveCount(0);
  const when = page.locator('#proof-when');
  await when.fill('12/03/2024');
  await when.blur();
  await expect(clock).toHaveAttribute('aria-label', 'Clock: the point UTC+01:00');
  await expect(page.getByText('12 Mar 2024 (Europe/Paris)')).toBeVisible();

  await clock.click();
  const menu = page.locator('.clock-menu');
  await expect(menu.getByRole('button', { name: /^Local at the point/ })).toBeVisible();
  await menu.getByRole('button', { name: /^UTC/ }).click();
  await expect(clock).toHaveAttribute('aria-label', 'Clock: UTC');
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await page.getByRole('dialog', { name: 'Check the point' }).getByRole('button', { name: 'Use this point' }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  expect(fixture.proofSaves[0].spec).toMatchObject({ when: '2024-03-12', whenZone: 'UTC' });

  // Any zone in the world, by search.
  await clock.click();
  await menu.getByRole('textbox').fill('tokyo');
  await menu.getByRole('button', { name: /^Tokyo/ }).click();
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  expect(fixture.proofSaves[1].spec.whenZone).toBe('Asia/Tokyo');

  // Back to the point: the save leaves the zone to it.
  await clock.click();
  await menu.getByRole('button', { name: /^Local at the point/ }).click();
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(3);
  expect(fixture.proofSaves[2].spec.whenZone).toBe(null);
});
