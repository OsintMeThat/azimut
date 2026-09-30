import { test, expect } from '@playwright/test';
import { PANEL_PATH, installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * The clock a proof's date is read on. A day is the day of the place the footage
 * shows, so the composer names the first point's zone under the date, and a save
 * sends the analyst's pick only when they made one.
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

test('names the point’s zone under the date, and sends UTC only once picked', async ({ page }) => {
  const fixture = await installAppFixture(page, { satCaptures: [framed] });
  await openProofWithPanel(page);

  const clock = page.locator('#proof-when-zone');
  await expect(clock).toHaveCount(0);
  const when = page.locator('#proof-when');
  await when.fill('12/03/2024');
  await when.blur();
  await expect(clock.locator('option').first()).toHaveText('At the point · Europe/Paris');
  await expect(page.locator('.when-zone-note')).toHaveText('UTC+01:00 on that day.');
  await expect(page.getByText('12 Mar 2024 (Europe/Paris)')).toBeVisible();

  await clock.selectOption('UTC');
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await page.getByRole('dialog', { name: 'Check the point' }).getByRole('button', { name: 'Use this point' }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  expect(fixture.proofSaves[0].spec).toMatchObject({ when: '2024-03-12', whenZone: 'UTC' });

  // Back to the point: the save leaves the zone to it.
  await clock.selectOption('');
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  expect(fixture.proofSaves[1].spec.whenZone).toBe(null);
});
