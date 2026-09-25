import { test, expect } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture, mapPicture, repainted } from './app.fixture.js';

/**
 * A feature of an added layer, pressed on the real engine.
 *
 * The features claim their clicks, and the map's right-click relay honoured
 * that claim too: a right-click on a pin, or anywhere inside an area, opened
 * nothing. Only a browser can say what the pointer actually lands on, since
 * a pin is pressed on its head, well above the point it names.
 */

const LAYER = {
  name: 'checkpoints',
  title: 'Checkpoints map',
  source: { kind: 'file', format: 'geojson', filename: 'checkpoints.geojson' },
  hidden: [],
  period: null,
  refresh: {},
  features: 2,
  categories: [{ name: 'checkpoints', count: 2, colour: '#e04040' }],
  bbox: [2.345, 48.848, 2.35, 48.852],
  format: 'geojson',
  icons: 0,
  sha256: 'a'.repeat(64),
  bytes: 512,
  fetched_at: '2026-09-20T10:00:00Z',
  checked_at: '2026-09-20T10:00:00Z',
  stale: false,
  created_at: '2026-09-20T10:00:00Z',
  updated_at: '2026-09-20T10:00:00Z',
  spec: '.layers/checkpoints/layer.json',
};

const FEATURES = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.35, 48.85] },
      properties: { name: 'North gate', category: 'checkpoints', colour: '#e04040', index: 0 },
    },
    {
      type: 'Feature',
      // west of the pin, far enough that a press inside it is not on the pin
      geometry: {
        type: 'Polygon',
        coordinates: [[[2.345, 48.848], [2.348, 48.848], [2.348, 48.852], [2.345, 48.852], [2.345, 48.848]]],
      },
      properties: { name: 'Depot', category: 'checkpoints', colour: '#e04040', index: 1 },
    },
  ],
};

/** Satellite centred on the pin, with the layer drawn. */
async function openOnThePin(page) {
  await installAppFixture(page);
  await page.route(`**/api/cases/${CASE_ID}/map-layers`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: [LAYER] }) : route.fallback()
  );
  await page.route(`**/api/cases/${CASE_ID}/map-layers/${LAYER.name}/data`, (route) =>
    route.fulfill({ json: FEATURES })
  );
  await page.goto('/#satellite?ll=48.85,2.35&z=16');
  await awaitMapReady(page);
  const bare = await mapPicture(page);
  await page.getByRole('button', { name: LAYER.title, exact: true }).click();
  // painted a frame after it is declared, so nothing is under the pointer before
  await expect.poll(async () => repainted(bare, await mapPicture(page))).toBe(true);
  const box = await page.locator('.map').boundingBox();
  // the pin stands on the centre and is pressed on its head
  return { box, head: { x: box.x + box.width / 2, y: box.y + box.height / 2 - 14 } };
}

const menu = (page) => page.getByRole('menu', { name: 'This point' });

test("a right-click on a pin opens the point menu on the pin's own point", async ({ page }) => {
  const { head } = await openOnThePin(page);

  await page.mouse.click(head.x, head.y, { button: 'right' });

  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator('.snap')).toContainText('North gate');
  await expect(menu(page).locator('.snap')).toContainText(LAYER.title);
  // the file's point to the digit, not the ground under the pin's head
  await expect(menu(page).getByRole('menuitem', { name: /^DD/ })).toContainText('48.850000, 2.350000');
  await expect(menu(page).getByRole('menuitem', { name: 'Save place here…' })).toBeVisible();
});

test('a right-click inside an area opens the point menu on the ground there', async ({ page }) => {
  const { box } = await openOnThePin(page);

  await page.mouse.click(box.x + box.width / 2 - 150, box.y + box.height / 2, { button: 'right' });

  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator('.snap')).toHaveCount(0);
  await expect(menu(page).getByRole('menuitem', { name: /^DD/ })).not.toContainText('2.350000');
});

test("the pin's card states its point and copies it", async ({ page, context, browserName }) => {
  const { head } = await openOnThePin(page);

  await page.mouse.click(head.x, head.y);

  const where = page.locator('.layer-card-where');
  await expect(where).toHaveText('48.850000, 2.350000');
  test.skip(browserName !== 'chromium', 'only Chromium lets a test grant the clipboard');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await where.click();
  await expect(page.getByText('Coordinates copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('48.850000, 2.350000');
});
