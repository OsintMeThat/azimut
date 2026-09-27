import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * The imagery card in the map's top-right corner: provider, date and the window
 * buttons in one frame, with the date pill and the compass under it. Its blur
 * makes a stacking context, so what opens from it is only on top if the card
 * itself is, and that is a question only a browser answers.
 */

const SENTINEL = [
  { id: 'esri-world-imagery', label: 'Esri World Imagery', url: 'https://tiles.invalid/{z}/{x}/{y}.png',
    imagery: true, max_zoom: 19, tile_size: 256, attribution: 'Browser fixture' },
  { id: 'sentinel2', label: 'Sentinel-2 (Copernicus)', url: 'https://tiles.invalid/{z}/{x}/{y}.png',
    meter: 'sentinelhub', imagery: true, max_zoom: 19, tile_size: 256, attribution: 'Copernicus Sentinel data' },
];

/** Whether `top` is what the eye sees at a point it shares with `under`. */
async function paintedOver(page, top, under) {
  const a = await top.boundingBox();
  const b = await under.boundingBox();
  const x = Math.max(a.x, b.x) + 4;
  const y = Math.max(a.y, b.y) + 4;
  expect(x).toBeLessThan(Math.min(a.x + a.width, b.x + b.width));
  expect(y).toBeLessThan(Math.min(a.y + a.height, b.y + b.height));
  const handle = await top.elementHandle();
  return page.evaluate(([el, px, py]) => el.contains(document.elementFromPoint(px, py)), [handle, x, y]);
}

test('opens the provider list over the date pill under the card', async ({ page }) => {
  await installAppFixture(page);
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: SENTINEL }));
  await page.route('**/api/satellite/sentinel/**', (route) => route.fulfill({ json: { dates: [] } }));
  await page.goto('/#satellite');
  await awaitMapReady(page);

  const chip = page.getByRole('button', { name: 'Imagery provider' });
  await chip.click();
  await page.getByRole('option', { name: 'Sentinel-2 (Copernicus)' }).click();
  const pill = page.locator('.surface-ctl .date-pill');
  await expect(pill).toBeVisible();

  await chip.click();
  const list = page.getByRole('listbox', { name: 'Imagery provider' });
  await expect(list).toBeVisible();
  expect(await paintedOver(page, list, pill)).toBe(true);
});
