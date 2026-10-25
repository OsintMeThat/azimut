import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * A proof's point joining one of the analyst's layers, from the point's menu.
 *
 * Driven in a real browser for what only layout can show: the side panel is
 * narrow and scrolls, and a menu opened inside it used to be cut on the left.
 */

const LAYERS = [
  { name: 'front', title: 'Front', markers: [], styles: [{ symbol: 'flag', colour: '#d55e00' }, { symbol: 'star', colour: '#009e73' }], groups: [
    { id: 'g1', name: 'Positions', mode: 'individual', colour: '#0072b2', symbol: 'pin' },
    { id: 'g2', name: 'Checkpoints', mode: 'uniform', colour: '#009e73', symbol: 'star' }] },
  { name: 'strikes', title: 'Strikes', markers: [], styles: [], groups: [{ id: 's', name: 'Markers', mode: 'individual', colour: '#d55e00', symbol: 'pin' }] },
];

/** The menu, whole inside the window. */
async function inside(page, menu) {
  const box = await menu.boundingBox(), viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test('a point’s menu goes from the layer to its group to the marker’s icon, whole inside the window', async ({ page }) => {
  await installAppFixture(page);
  await page.route(`**/api/cases/${CASE_ID}/layer-targets**`, (route) => route.fulfill({ json: LAYERS }));
  await openProofWithPanel(page);
  const row = page.locator('.point-row').first();
  await row.locator('.meta-input').fill('48.858400, 2.294500');
  await page.getByTitle('Add a point').click();
  await page.locator('.point-row').nth(1).locator('.meta-input').fill('48.859000, 2.295000');

  for (const index of [1, 2]) {
    await page.getByRole('button', { name: `Point ${index} actions`, exact: true }).click();
    const menu = page.getByRole('menu', { name: `Point ${index} actions`, exact: true });
    await expect(menu.locator('.targets .fm-item')).toHaveText(['Front', 'Strikes']);
    await inside(page, menu);
    await expect(menu.getByRole('button', { name: 'Make it the conclusion', exact: true })).toHaveCount(index === 1 ? 0 : 1);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Point 2 actions', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Point 2 actions', exact: true });
  await menu.getByRole('button', { name: 'Front', exact: true }).click();
  await expect(menu.locator('.fm-item')).toHaveText(['Positions', 'Checkpoints']);
  await page.screenshot({ path: test.info().outputPath('point-menu-groups.png') });
  await menu.getByRole('button', { name: 'Positions', exact: true }).click();
  await expect(menu.locator('.step-back')).toHaveText('Front › Positions');
  await menu.getByRole('button', { name: 'Point icon Tank icon', exact: true }).click();
  await menu.getByRole('button', { name: 'More colours', exact: true }).click();
  await menu.getByRole('button', { name: 'Point icon orange', exact: true }).click();
  const add = menu.getByRole('button', { name: 'Add to Positions', exact: true });
  await expect(add).toBeInViewport();
  await inside(page, menu);
  await page.screenshot({ path: test.info().outputPath('point-menu-icon.png') });
  await menu.locator('.step-back').click();
  await expect(menu.locator('.fm-item')).toHaveText(['Positions', 'Checkpoints']);
  await page.keyboard.press('Escape');

  // the coordinate keeps its width: no button squeezed into its field any more
  const field = await row.locator('.coords-field').boundingBox();
  expect(field.width).toBeGreaterThan(120);
});
