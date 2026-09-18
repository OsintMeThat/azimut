import { test, expect } from '@playwright/test';
import { PANEL_PATH, awaitMapReady, installAppFixture, showSaved } from './app.fixture.js';

/**
 * Located files on the map, and the player they open.
 *
 * The gesture is holding footage next to the imagery it is being matched
 * against, so the file plays in the panel and the map stays whole. Whether a
 * mark answers its own click, what the arrows walk and what Escape puts back are
 * all browser facts, which is why they are proved here.
 */

const point = {
  lat: 48.8584,
  lon: 2.2945,
  geo: { state: 'ok', country_code: 'fr', country: 'France' },
  continent: 'Europe',
  country_en: 'France',
};

/** Two files on one spot: the marks collapse, and the stack is what opens. */
const mediaIndex = [
  {
    id: 'media-1',
    key: 'media-1@48.8584,2.2945',
    kind: 'media',
    media_kind: 'image',
    title: 'roadside photo',
    path: PANEL_PATH,
    thumbnail: null,
    fetched_at: '2026-07-24T09:00:00Z',
    status: 'confirmed',
    roads: [{ type: 'located-at', status: 'confirmed' }],
    linked_proofs: [],
    ...point,
  },
  {
    id: 'media-2',
    key: 'media-2@48.8584,2.2945',
    kind: 'media',
    media_kind: 'image',
    title: 'rooftop still',
    path: PANEL_PATH,
    thumbnail: null,
    fetched_at: '2026-07-24T08:00:00Z',
    status: 'suggested',
    roads: [{ type: 'proof', id: 'proof-1', title: 'Roofline', status: 'confirmed' }],
    linked_proofs: [{ id: 'proof-1', name: 'Roofline', title: 'Roofline' }],
    ...point,
  },
];

const panel = (page) => page.locator('.captures');

test('opens on the case’s located files, with the layer already drawing them', async ({ page }) => {
  const fixture = await installAppFixture(page, { mediaIndex });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  // the layer is on before the panel is looked at, and Saved opens on Media
  await expect(page.locator('.saved-mark')).toHaveCount(1);
  await page.getByRole('tablist', { name: 'Map panel' }).getByRole('tab', { name: 'Saved' }).click();
  await expect(panel(page).getByText('roadside photo')).toBeVisible();
  await expect(panel(page).getByText('Recorded here')).toBeVisible();
  await expect(page.locator('.saved-mark')).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});

test('plays the whole stack under one mark, and puts the list back', async ({ page }) => {
  await installAppFixture(page, { mediaIndex });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.locator('.saved-mark').click();
  // the file plays in the panel; the map is not covered by a window over it
  await expect(page.locator('.saved-popup')).toHaveCount(0);
  await expect(panel(page).locator('.viewer img')).toBeVisible();
  await expect(panel(page).getByText('1 / 2')).toBeVisible();
  await expect(panel(page).getByText('roadside photo')).toBeVisible();

  // the arrows walk the stack without a click into the panel first
  await page.keyboard.press('ArrowRight');
  await expect(panel(page).getByText('2 / 2')).toBeVisible();
  await expect(panel(page).getByText('rooftop still')).toBeVisible();
  // why it stands here, and that only a tool has claimed it so far
  await expect(panel(page).getByText('Via Roofline')).toBeVisible();
  await expect(panel(page).getByText('suggested')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel(page).getByText('Layers')).toBeVisible();
});

test('opens the proof a file was placed by', async ({ page }) => {
  await installAppFixture(page, { mediaIndex });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.locator('.saved-mark').click();
  await page.keyboard.press('ArrowRight');
  await panel(page).getByRole('button', { name: 'Roofline' }).click();
  await expect(page.getByRole('heading', { name: 'Geo Proof' })).toBeVisible();
  await expect(page).toHaveURL(/#proof/);
});

test('keeps the card for saved work, which is read rather than watched', async ({ page }) => {
  await installAppFixture(page, {
    mediaIndex,
    savedIndex: [{ id: 'place-1', key: 'place-1', kind: 'place', title: 'checkpoint north', ...point }],
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await showSaved(page, 'Places');

  await page.locator('.saved-mark').click();
  await expect(page.locator('.saved-popup')).toBeVisible();
  await expect(panel(page).locator('.viewer')).toHaveCount(0);
});
