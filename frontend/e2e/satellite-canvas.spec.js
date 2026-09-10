import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

test('opens Map with the case sidebar collapsed and lets the user reopen it', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await expect(page.locator('.sidebar')).toHaveCount(0);
  await page.getByTitle('Toggle case sidebar').click();
  await expect(page.locator('.sidebar')).toBeVisible();

  await page.getByRole('button', { name: 'Examine', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByTitle('Toggle case sidebar').click();
  await expect(page.locator('.sidebar')).toHaveCount(0);

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByTitle('Toggle case sidebar').click();
  await expect(page.locator('.sidebar')).toHaveCount(0);

  await page.getByRole('button', { name: 'Examine', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await page.getByTitle('Toggle case sidebar').click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.reload();
  await awaitMapReady(page);
  await expect(page.locator('.sidebar')).toHaveCount(0);

  fixture.expectNoUnexpectedRequests();
});

test('rotates the real map with a middle-button gesture', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  const map = page.locator('.map');
  const box = await map.boundingBox();
  expect(box).not.toBeNull();

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 100, y + 55, { steps: 8 });
  await page.mouse.up({ button: 'middle' });

  await expect(page.locator('.deg')).not.toHaveText('0°');
  fixture.expectNoUnexpectedRequests();
});

test('captures a marquee drawn on the real map surface', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  const map = page.locator('.map');

  await page.getByRole('button', { name: 'Capture options' }).click();
  await page.getByRole('button', { name: 'Select area', exact: true }).click();
  await page.locator('.capture-main').click();

  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + 120, box.y + 110);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 250, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => fixture.captures.length).toBe(1);
  expect(fixture.captures[0].width).toBeGreaterThan(150);
  expect(fixture.captures[0].height).toBeGreaterThan(100);
  fixture.expectNoUnexpectedRequests();
});

test('says the map needs WebGL rather than drawing an empty panel without it', async ({ page }) => {
  // A browser can refuse WebGL: an old driver, a machine with no GPU, a profile
  // hardened to turn it off. The engine throws on the way up, and the tool used
  // to swallow it and leave the panel blank for good.
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      return String(kind).startsWith('webgl') ? null : real.call(this, kind, ...rest);
    };
  });
  await installAppFixture(page);
  await page.goto('/#satellite');

  await expect(page.getByText('The map needs WebGL, which this browser does not have.')).toBeVisible();
  await expect(page.locator('.map[data-map-ready="true"]')).toHaveCount(0);
});

test('says it on a browser that has no WebGL of its own, not a stubbed one', async ({ page }) => {
  // The case above builds the refusal by taking `getContext` away. This one does
  // not build anything: the CI runner's Firefox is a real browser with no GL
  // driver under it, which is an environment we cannot fake and no longer have
  // to. Where WebGL exists — every developer's machine, and Chromium anywhere —
  // there is nothing here to see and the stubbed case above stands for it.
  await installAppFixture(page);
  await page.goto('/#satellite');

  const usable = await page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
  test.skip(usable, 'this browser has WebGL; the stubbed case covers the message');

  await expect(page.getByText('The map needs WebGL, which this browser does not have.')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});
