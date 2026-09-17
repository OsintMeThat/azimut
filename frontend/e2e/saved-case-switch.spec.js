import { test, expect } from '@playwright/test';
import { CASE_ID, awaitMapReady, installAppFixture, showSaved } from './app.fixture.js';

// Opening a second case must not leave the first one's rows on screen while the
// new index is still on its way — the panel would be reading one case under the
// name of another.

const point = {
  lat: 48.8584,
  lon: 2.2945,
  geo: { state: 'ok', country_code: 'fr', country: 'France' },
  continent: 'Europe',
  country_en: 'France',
};

test('clears capture rows before a different case index arrives', async ({ page }) => {
  const secondId = 'browser-test-b';
  const fixture = await installAppFixture(page, {
    cases: [
      { id: CASE_ID, name: 'Case A', scratch: false, folders: [] },
      { id: secondId, name: 'Case B', scratch: false, folders: [] },
    ],
    savedIndexes: {
      [CASE_ID]: [{ id: 'capture-a', key: 'capture-a', kind: 'capture', title: 'Capture A', ...point }],
      [secondId]: [{ id: 'capture-b', key: 'capture-b', kind: 'capture', title: 'Capture B', ...point }],
    },
    savedIndexDelays: { [secondId]: 1200 },
  });

  await page.goto('/#satellite');
  await awaitMapReady(page); // the rows are read beside a map, and one mark is on it
  const savedPanel = page.locator('.captures');
  await showSaved(page, 'Captures');
  await expect(savedPanel.getByText('Capture A', { exact: true })).toBeVisible();
  await expect(page.locator('.saved-mark-capture')).toHaveCount(1);
  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case B' }).click();

  await expect(savedPanel.getByText('Capture A', { exact: true })).toBeHidden({ timeout: 500 });
  await expect(page.locator('.saved-mark-capture')).toBeHidden({ timeout: 500 });
  await expect(savedPanel.getByText('Capture B', { exact: true })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});
