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
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible();
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

test('puts a file in a layer from the player, a step at a time, the menu whole in the window', async ({ page }) => {
  const layers = [
    { name: 'front', title: 'Front', markers: [], styles: [{ symbol: 'flag', colour: '#d55e00' }], groups: [
      { id: 'g1', name: 'Positions', mode: 'individual', colour: '#0072b2', symbol: 'pin' },
      { id: 'g2', name: 'Sightings', mode: 'uniform', colour: '#009e73', symbol: 'badge-video' }] },
  ];
  const asked = [];
  await installAppFixture(page, { mediaIndex });
  await page.route('**/api/cases/*/layer-targets**', (route) => route.fulfill({ json: layers }));
  await page.route('**/api/cases/*/map-layers/front/links', (route) => {
    asked.push(route.request().postDataJSON());
    return route.fulfill({ json: { layer: { name: 'front', title: 'Front', editable: true }, added: 1 } });
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.locator('.saved-mark').click();
  // the picture laid out first, so the button stays where the menu opens from
  await expect(panel(page).locator('.viewer img')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Add to a layer', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Add to a layer', exact: true });
  await menu.getByRole('button', { name: 'Front', exact: true }).click();
  await expect(menu.locator('.fm-item')).toHaveText(['Positions', 'Sightings']);
  await menu.getByRole('button', { name: 'Positions', exact: true }).click();
  await menu.getByRole('button', { name: 'Point icon Tank icon', exact: true }).click();
  const add = menu.getByRole('button', { name: 'Add to Positions', exact: true });
  await expect(add).toBeInViewport();
  // where the menu stands stays in sight above the icons
  await expect(menu.locator('.step-back')).toBeInViewport();
  const box = await menu.boundingBox(), viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: test.info().outputPath('media-layer-menu.png') });
  await add.click();
  await expect(menu).toHaveCount(0);
  expect(asked).toEqual([{ items: [{ id: 'media-1', lat: 48.8584, lon: 2.2945 }], group: 'g1', symbol: 'badge-tank', colour: '#0072b2' }]);
  await expect(page.getByText('Added to Front')).toBeVisible();
});

