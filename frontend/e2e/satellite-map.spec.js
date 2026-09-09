import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * What the map itself does, driven in a real browser.
 *
 * Two things here are not features but *conventions*, and both are written into
 * files on the analyst's disk: a whole zoom level is what every route takes and
 * every capture records, and a bearing turns the map clockwise — which is what
 * `engine/tiles.py` rotates a crop by, so a saved place or capture restores
 * mirrored if it ever flips. Nothing in this file names the engine; it asks
 * only what an analyst can see and what the backend was told.
 */

const hud = (page) => page.locator('.hud-coords').first();

async function openMap(page) {
  const fixture = await installAppFixture(page);
  const asked = [];
  page.on('request', (request) => {
    const at = /\/api\/tiles\/[^/]+\/(\d+)\//.exec(request.url());
    if (at) asked.push(Number(at[1]));
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);
  return { fixture, asked };
}

/** Read one screen point's coordinates back, through a grid polygon vertex. */
async function vertexAt(page, fixture, dx, dy) {
  const box = await page.locator('.map').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.getByRole('button', { name: 'Polygon' }).click();
  await page.mouse.click(cx + dx, cy + dy);
  await page.mouse.click(cx + dx + 60, cy + dy + 60);
  await page.mouse.click(cx + dx - 60, cy + dy + 60);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => fixture.gridWrites.length).toBeGreaterThan(0);
  return fixture.gridWrites.at(-1).spec.aoi.vertices[0];
}

test('one notch of the wheel is one whole zoom level', async ({ page }) => {
  // The camera is continuous and the app is not. Left to itself the engine
  // moves about a fifth of a level per notch, which rounds back to the level
  // it started on: the map twitches and the wheel does nothing at all.
  const { asked } = await openMap(page);
  await expect(hud(page)).toContainText('z16');
  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await page.mouse.wheel(0, -120);
  await expect(hud(page)).toContainText('z17');
  await page.mouse.wheel(0, -120);
  await expect(hud(page)).toContainText('z18');
  await page.mouse.wheel(0, 120);
  await expect(hud(page)).toContainText('z17');

  // and the level the analyst is reading is the level the proxy was asked for
  await expect.poll(() => asked.includes(18)).toBe(true);
  expect(asked.every((zoom) => Number.isInteger(zoom))).toBe(true);
});

test('the zoom buttons walk the same levels', async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(hud(page)).toContainText('z17');
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(hud(page)).toContainText('z16');
});

test('a bearing turns the map clockwise, and the compass points at north', async ({ page }) => {
  const { fixture } = await openMap(page);
  // the readout is the map centre, and a turn is about the centre
  const [lat, lon] = (await hud(page).innerText()).split('\n')[0].split(',').map(Number);

  await page.getByRole('button', { name: /^0°$/ }).click();
  await page.getByLabel('Set bearing in degrees').fill('90');
  await page.getByLabel('Set bearing in degrees').press('Enter');
  await expect(page.getByRole('button', { name: /90°/ })).toBeVisible();

  await page.getByRole('button', { name: 'Grid Search' }).click();
  await expect(page.getByRole('button', { name: 'Polygon' })).toBeVisible();
  // north has swung to the right, so what is up the screen is now due west
  const up = await vertexAt(page, fixture, 0, -160);
  expect(up[1]).toBeLessThan(lon);
  expect(Math.abs(up[0] - lat)).toBeLessThan(0.001);

  // …and the needle followed north there, rather than to the opposite side
  const needle = await page.evaluate(
    () => getComputedStyle(document.querySelector('.compass svg')).transform
  );
  // a clockwise quarter turn: matrix(cos, sin, -sin, cos) at +90°
  expect(needle).toBe('matrix(0, 1, -1, 0, 0, 0)');
});

test('north is up again when the rose is pressed', async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: /^0°$/ }).click();
  await page.getByLabel('Set bearing in degrees').fill('215');
  await page.getByLabel('Set bearing in degrees').press('Enter');
  await expect(page.getByRole('button', { name: /215°/ })).toBeVisible();
  await page.getByRole('button', { name: 'Reset to north' }).click();
  await expect(page.getByRole('button', { name: /^0°$/ })).toBeVisible();
});
