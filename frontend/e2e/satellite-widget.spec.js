import { test, expect } from '@playwright/test';
import { awaitMapReady, fakeGoogleMaps, installAppFixture, mapPicture } from './app.fixture.js';

/**
 * The one basemap that is not our tiles.
 *
 * Google's terms forbid taking those pixels out of its own map, so its map is
 * put *under* ours and the two cameras are kept in step (`lib/map/gmaps.js`).
 * The whole path is driven here against a stand-in Maps API — no key, no
 * network, no billed map load — because the parts that can go wrong are ours:
 * whether it shows through at all, whether it follows, whether it is credited,
 * and whether it is ever built twice.
 */

async function openWidget(page) {
  await fakeGoogleMaps(page);
  const fixture = await installAppFixture(page, { widget: true });
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await page.getByTitle('Imagery provider').selectOption('google-js');
  await expect(page.locator('.map-glass')).toBeAttached();
  return fixture;
}

const maps = (page) => page.evaluate(() => window.__googleMaps.length);
const camera = (page) => page.evaluate(() => window.__googleMaps[0].cameras.at(-1));

test('shows through our own canvas rather than under it', async ({ page }) => {
  // The engine's canvas is transparent where nothing is drawn. If our map's own
  // background ever paints over the layer instead, the basemap is simply blank
  // and nothing else in the tool says so.
  await openWidget(page);
  const shot = await mapPicture(page);
  const magenta = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] > 200 && data[at + 1] < 60 && data[at + 2] > 200) lit += 1;
    }
    return lit;
  }, [...shot]);
  expect(magenta).toBeGreaterThan(10_000);
});

test('follows our camera, and covers the view at every bearing', async ({ page }) => {
  await openWidget(page);
  const opened = await camera(page);
  expect(opened.zoom).toBe(16); // the app's zoom, not the engine's

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(16.9);

  // a rotated rectangle fits inside the circle of its own diagonal, so the
  // element is a square of that diagonal — otherwise a turn eats the corners
  const turn = page.locator('.map-glass-turn');
  const side = await page.evaluate(() => {
    const el = document.querySelector('.map');
    return Math.ceil(Math.hypot(el.clientWidth, el.clientHeight));
  });
  await expect(turn).toHaveCSS('width', `${side}px`);
  await expect(turn).toHaveCSS('height', `${side}px`);

  await page.getByRole('button', { name: /^0°$/ }).click();
  await page.getByLabel('Set bearing in degrees').fill('90');
  await page.getByLabel('Set bearing in degrees').press('Enter');
  await expect(page.getByRole('button', { name: /90°/ })).toBeVisible();
  // turned the same way the map turned: clockwise
  await expect(turn).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
});

test('never takes the pointer, so every gesture is still ours', async ({ page }) => {
  await openWidget(page);
  await expect(page.locator('.map-glass')).toHaveCSS('pointer-events', 'none');
  // …except the credit, whose terms link has to stay reachable
  await expect(page.locator('.map-glass-credit')).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator('.map-glass-credit')).toContainText('Map data © Google');
  await expect(page.locator('.map-glass-credit a')).toHaveAttribute('href', /terms_maps/);
});

test('is built once and counted once, however often it is shown', async ({ page }) => {
  // every google.maps.Map instantiation is a billed dynamic map load
  const fixture = await openWidget(page);
  expect(await maps(page)).toBe(1);
  await expect.poll(() => fixture.widgetLoads).toEqual(['google_js']);

  await page.getByTitle('Imagery provider').selectOption('esri-world-imagery');
  await expect(page.locator('.map-glass')).toHaveAttribute('hidden', '');
  await page.getByTitle('Imagery provider').selectOption('google-js');
  await expect(page.locator('.map-glass')).not.toHaveAttribute('hidden', '');

  expect(await maps(page)).toBe(1);
  expect(fixture.widgetLoads).toEqual(['google_js']);
});

test('leaves nothing of our own tiles between the analyst and the imagery', async ({ page }) => {
  await openWidget(page);
  const asked = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/tiles/')) asked.push(request.url());
  });
  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(asked).toEqual([]);
});
