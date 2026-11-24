import { test, expect } from '@playwright/test';
import { PANEL_PATH, awaitMapReady, installAppFixture, showSaved } from './app.fixture.js';

/**
 * Located files on the map, and the players they open.
 *
 * A file's mark opens its card like every mark, and the file plays there, a stack
 * one at a time. Held next to the imagery it is matched against, it goes to the
 * panel beside the map. What the card walks, what the panel takes over and what
 * Escape puts back are browser facts, which is why they are proved here.
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

const card = (page) => page.locator('.saved-popup');

/** A file's mark pressed, then the file on screen taken to the panel beside the map. */
async function playBeside(page) {
  await page.locator('.saved-mark').click();
  await card(page).getByRole('button', { name: 'Play beside the map' }).click();
  await expect(card(page)).toHaveCount(0);
}

test('plays the stack under one mark in its card, one file at a time', async ({ page }) => {
  await installAppFixture(page, { mediaIndex });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.locator('.saved-mark').click();
  await expect(card(page).locator('.stage img')).toBeVisible();
  await expect(card(page).locator('.stage')).toHaveCount(1);
  await expect(card(page).getByText('1 / 2')).toBeVisible();
  await expect(card(page).getByText('roadside photo')).toBeVisible();
  await expect(card(page).getByText('Recorded here')).toBeVisible();
  // the panel keeps its list: the card is where the file is read first
  await expect(panel(page).locator('.viewer')).toHaveCount(0);

  await card(page).getByRole('button', { name: 'Next file' }).click();
  await expect(card(page).getByText('2 / 2')).toBeVisible();
  await expect(card(page).getByText('rooftop still')).toBeVisible();
  // why it stands here, and that only a tool has claimed it so far
  await expect(card(page).getByText('Via Roofline')).toBeVisible();
  await expect(card(page).getByText('suggested')).toBeVisible();
});

test('takes the file on screen beside the map, and puts the list back', async ({ page }) => {
  await installAppFixture(page, { mediaIndex });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.locator('.saved-mark').click();
  await card(page).getByRole('button', { name: 'Next file' }).click();
  await card(page).getByRole('button', { name: 'Play beside the map' }).click();
  await expect(card(page)).toHaveCount(0);
  // the file the card was on, with the rest of the stack a press of the arrows away
  await expect(panel(page).locator('.viewer img')).toBeVisible();
  await expect(panel(page).getByText('2 / 2')).toBeVisible();
  await expect(panel(page).getByText('rooftop still')).toBeVisible();

  // the arrows walk the stack without a click into the panel first
  await page.keyboard.press('ArrowRight');
  await expect(panel(page).getByText('1 / 2')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel(page).getByText('Layers')).toBeVisible();
});

test('plays a file under the work filed on its point, in the one card', async ({ page }) => {
  await installAppFixture(page, {
    mediaIndex: [mediaIndex[0]],
    savedIndex: [{ id: 'place-1', key: 'place-1', kind: 'place', title: 'checkpoint north', ...point }],
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.locator('.saved-mark-wrap').click();
  await expect(card(page).locator('.stage img')).toBeVisible();
  await expect(card(page).getByText('roadside photo')).toBeVisible();
  await expect(card(page).getByText('checkpoint north')).toBeVisible();
  const file = await card(page).locator('.file').boundingBox();
  const place = await card(page).getByText('checkpoint north').boundingBox();
  expect(file.y).toBeLessThan(place.y);
});

test('opens the proof a file was placed by', async ({ page }) => {
  await installAppFixture(page, { mediaIndex });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await playBeside(page);
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

  await page.locator('.saved-mark-wrap').click();
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

  await playBeside(page);
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
  expect(asked).toEqual([{ items: [{ id: 'media-1', lat: 48.8584, lon: 2.2945 }], group: 'g1', symbol: 'badge-tank', colour: '#0072b2', icon: '' }]);
  await expect(page.getByText('Added to Front')).toBeVisible();
});


test('stands a tall file up whole in its card, and keeps the card on the map', async ({ page }) => {
  const tall = { ...mediaIndex[0], id: 'media-tall', key: 'media-tall@48.8584,2.2945', title: 'phone clip', path: 'media/tall.svg' };
  await installAppFixture(page, { mediaIndex: [tall] });
  // a phone's shape, nine by sixteen
  await page.route('**/files/*/media/tall.svg', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#36c"/></svg>',
  }));
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.locator('.saved-mark').click();
  const stage = card(page).locator('.stage');
  await expect(stage).toHaveCSS('height', '320px');
  // the card grew once the shape was known, and the map slid to show it whole
  const map = await page.locator('.map').first().boundingBox();
  await expect.poll(async () => {
    const whole = await card(page).boundingBox();
    return whole.y >= map.y && whole.y + whole.height <= map.y + map.height - 70;
  }).toBe(true);
  // the picture is the stage's own box, letterboxed in it, never wider or taller
  const [box, picture] = await stage.evaluate((element) =>
    [element, element.querySelector('img')].map((one) => {
      const { x, y, width, height } = one.getBoundingClientRect();
      return { x, y, width, height };
    })
  );
  expect(picture).toEqual(box);
});
