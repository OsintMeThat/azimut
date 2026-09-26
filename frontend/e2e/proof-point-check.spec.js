import { test, expect } from '@playwright/test';
import { PANEL_PATH, awaitMapReady, installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * A point taken from a capture, checked before it leaves the composer.
 *
 * A capture's point is the middle of its frame unless its pin was moved onto the
 * target, and a save files it on the case map while a post publishes it. So both
 * walk it through the map first. Driven in a real browser because the question is
 * whether the save waits for the analyst, which no unit below the page can see.
 */

// The fixture's one image, filed as a capture framed on its own middle.
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
const row = (page) => page.locator('.point-row').first();

test('a save stops on the capture point until it is checked', async ({ page }) => {
  const fixture = await installAppFixture(page, { satCaptures: [framed] });
  await openProofWithPanel(page);

  await expect(row(page).locator('.meta-input')).toHaveValue('48.858400, 2.294500');
  await expect(row(page).locator('.coords-field')).toHaveClass(/proposed/);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  const check = page.getByRole('dialog', { name: 'Check the point' });
  await expect(check).toBeVisible();
  await awaitMapReady(page);
  expect(fixture.proofSaves).toHaveLength(0);

  // right as proposed: kept where it is, and the save goes through
  await check.getByRole('button', { name: 'Use this point' }).click();
  await expect(check).toHaveCount(0);
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const [{ spec }] = fixture.proofSaves;
  expect(spec.points).toEqual([{ coords: '48.858400, 2.294500' }]);
  await expect(row(page).locator('.coords-field')).not.toHaveClass(/proposed/);

  // checked once is checked: the next save asks nothing
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  await expect(page.getByRole('dialog', { name: 'Check the point' })).toHaveCount(0);
});

test('Later saves the proof and keeps the point unchecked', async ({ page }) => {
  const fixture = await installAppFixture(page, { satCaptures: [framed] });
  await openProofWithPanel(page);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await page.getByRole('dialog', { name: 'Check the point' }).getByRole('button', { name: 'Later' }).click();

  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const [{ spec }] = fixture.proofSaves;
  expect(spec.coords).toEqual({ lat: 48.8584, lon: 2.2945, proposed: true });
  await expect(page.getByText('Unchecked points stay off the case map until you check them.')).toBeVisible();
  await expect(row(page).locator('.coords-field')).toHaveClass(/proposed/);
});

test('To Post offers no Later, and Cancel sends nothing', async ({ page }) => {
  // at 1280px the header runs under the case panel, which covers To Post
  await page.setViewportSize({ width: 1600, height: 900 });
  const fixture = await installAppFixture(page, { satCaptures: [framed] });
  await openProofWithPanel(page);

  await page.getByRole('button', { name: 'To Post' }).click();
  const check = page.getByRole('dialog', { name: 'Check the point' });
  await expect(check).toBeVisible();
  await expect(check.getByRole('button', { name: 'Later' })).toHaveCount(0);

  await check.getByRole('button', { name: 'Cancel' }).click();
  await expect(check).toHaveCount(0);
  expect(fixture.proofSaves).toHaveLength(0);
});

test('a capture aimed with the pin is saved without a question', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    satCaptures: [{ ...framed, center_lat: 48.8591, center_lon: 2.2931 }],
  });
  await openProofWithPanel(page);

  await expect(row(page).locator('.coords-field')).not.toHaveClass(/proposed/);
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  expect(fixture.proofSaves[0].spec.coords).toEqual({ lat: 48.8584, lon: 2.2945 });
});
