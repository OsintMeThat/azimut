import { expect, test } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

async function openHorizon(page, standing = true) {
  await installAppFixture(page);
  const queries = [];
  await page.route('**/api/horizon/**', (route) => route.fulfill({ status: 404, json: { detail: 'No terrain in the browser fixture' } }));
  await page.route('**/api/geo/parse', (route) => {
    const text = route.request().postDataJSON().text;
    const coords = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
    return route.fulfill(coords
      ? { json: { lat: Number(coords[1]), lon: Number(coords[2]) } }
      : { status: 422, json: { detail: 'Not coordinates' } });
  });
  await page.route('**/api/geo/geocode?*', (route) => {
    queries.push(new URL(route.request().url()).searchParams.get('q'));
    return route.fulfill({ json: { lat: 50.4501, lon: 30.5234 } });
  });
  await page.goto(standing ? '/#horizon?ll=46.5586,7.8353&hd=95&tl=0&fov=60&r=plain' : '/#horizon');
  await awaitMapReady(page);
  return queries;
}

async function turn(map, page) {
  await map.getByRole('button', { name: /^0°$/ }).click();
  await map.getByLabel('Set bearing in degrees').fill('90');
  await map.getByLabel('Set bearing in degrees').press('Enter');
  await expect(map.getByRole('button', { name: /^90°$/ })).toBeVisible();
  await expect(map.locator('.compass svg')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
  await map.getByRole('button', { name: 'Reset to north' }).click();

  const box = await map.locator('.map[data-map-ready="true"]').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await expect(map.locator('.turn-guide')).toBeVisible();
  for (let deg = 0; deg <= 90; deg += 5) {
    const a = deg * Math.PI / 180;
    await page.mouse.move(x + 90 * Math.cos(a), y + 90 * Math.sin(a));
  }
  await page.mouse.up({ button: 'middle' });
  await expect(map.getByRole('button', { name: /^90°$/ })).toBeVisible();
  await expect(map.locator('.turn-guide')).toHaveCount(0);
  await page.mouse.click(x, y, { button: 'middle' });
  await expect(map.getByRole('button', { name: /^0°$/ })).toBeVisible();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(map.getByRole('button', { name: /^15°$/ })).toBeVisible();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(map.getByRole('button', { name: /^0°$/ })).toBeVisible();
}

async function search(map, page, queries) {
  const input = map.getByRole('combobox', { name: 'Search a place or coordinates' });
  await input.fill('Kyiv centre');
  await input.press('Enter');
  await expect.poll(() => queries).toEqual(['Kyiv centre']);
  const box = await map.locator('.map[data-map-ready="true"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  const menu = map.getByRole('menu', { name: 'This point' });
  await expect(menu).toContainText('50.4501');
  await expect(menu).toContainText('30.5234');
  await page.keyboard.press('Escape');
}

test('offers navigation on the large Horizon map and leaves the compact map alone', async ({ page }) => {
  const queries = await openHorizon(page);
  const map = page.locator('.hz-map');
  await expect(map.getByRole('combobox')).toHaveCount(0);
  await expect(map.getByRole('button', { name: 'Reset to north' })).toHaveCount(0);
  const box = await map.locator('.map[data-map-ready="true"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await expect(map.locator('.turn-guide')).toHaveCount(0);
  await page.mouse.up({ button: 'middle' });

  await map.getByRole('button', { name: 'Enlarge the map', exact: true }).click();
  await turn(map, page);
  await search(map, page, queries);
  // Searching moves the map while the viewpoint stays put.
  expect(new URLSearchParams(page.url().split('?')[1]).get('ll')).toBe('46.5586,7.8353');
  await map.getByRole('button', { name: 'Back to the view', exact: true }).click();
  await expect(map.getByRole('combobox')).toHaveCount(0);
  await expect(map.getByRole('button', { name: 'Reset to north' })).toHaveCount(0);
});

test('offers navigation in Find, both in three columns and with its map enlarged', async ({ page }) => {
  const queries = await openHorizon(page, false);
  await page.getByRole('button', { name: 'Find where a photo was taken', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a photo or video' }).getByRole('button', { name: 'Close', exact: true }).click();
  const finder = page.getByRole('region', { name: 'Find where it was taken', exact: true });
  const map = finder.getByRole('region', { name: 'Map and the area', exact: true });
  await expect(map.locator('.map[data-map-ready="true"]')).toBeVisible();
  await turn(map, page);
  await finder.getByRole('button', { name: 'Draw the area', exact: true }).click();
  const input = map.getByRole('combobox', { name: 'Search a place or coordinates' });
  await input.fill('Kyiv centre');
  await input.press('Enter');
  await expect.poll(() => queries).toEqual(['Kyiv centre']);
  await expect(map.locator('.fm')).toHaveClass(/drawing/);
  // Selecting coordinates from the shared suggestions keeps Find open.
  await input.fill('50.4501, 30.5234');
  await expect(map.getByRole('option', { name: /50\.45010, 30\.52340/ })).toBeVisible();
  await map.getByRole('option', { name: /50\.45010, 30\.52340/ }).click();
  await expect(finder).toBeVisible();
  await finder.getByRole('button', { name: 'Enlarge the map', exact: true }).click();
  await expect(map.getByRole('button', { name: 'Reset to north' })).toBeVisible();
  await expect(input).toBeVisible();
  await turn(map, page);
  await finder.getByRole('button', { name: 'Back to the three columns', exact: true }).click();
  await expect(input).toBeVisible();
});
