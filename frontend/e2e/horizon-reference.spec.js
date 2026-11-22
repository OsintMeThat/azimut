import { expect, test } from '@playwright/test';
import { installAppFixture, PANEL_PATH } from './app.fixture.js';

/**
 * Reference windows over the Horizon view: the same scratch panes as the Map's,
 * in the one session list. The terrain itself is not served here; the windows
 * float over the view whether it has landed or not.
 */

const MEDIA = [
  {
    path: PANEL_PATH,
    filename: 'panel.svg',
    title: 'Gate',
    kind: 'image',
    source: { type: 'upload' },
    thumbnail: null,
    folder: '',
  },
];

async function openView(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installAppFixture(page, { media: MEDIA });
  await page.route('**/api/horizon/**', (route) => route.fulfill({ status: 404, json: { detail: 'No terrain in the browser fixture' } }));
  await page.goto('/#horizon?ll=46.5586,7.8353&hd=95&tl=0&fov=60&r=plain');
  await expect(page.locator('.horizon-view')).toBeVisible();
}

test('adds a reference over the Horizon view, and docks it beside the view, which narrows for it', async ({ page }) => {
  await openView(page);
  const add = page.getByRole('button', { name: 'Add reference' });
  await add.click();
  await page.getByRole('dialog', { name: 'Add reference' }).locator('.ref-pick[title="Gate"]').click();
  const pane = page.locator('.view-area .ref-viewer');
  await expect(pane).toHaveCount(1);
  await expect(add).toHaveAttribute('title', '1 reference window open · add another');

  const view = page.locator('.horizon-view');
  const wide = (await view.boundingBox()).width;
  await pane.getByRole('button', { name: 'Place' }).click();
  await pane.getByRole('button', { name: 'Column on the left' }).click();
  const dock = page.getByRole('complementary', { name: 'References docked on the left' });
  await expect(dock.locator('.ref-viewer.docked')).toHaveCount(1);
  await expect.poll(async () => (await view.boundingBox()).width).toBeLessThan(wide - 200);
});

test('keeps the windows of the session from one tab to the other, drawn only in the one on screen', async ({ page }) => {
  await openView(page);
  await page.getByRole('button', { name: 'Add reference' }).click();
  await page.getByRole('dialog', { name: 'Add reference' }).locator('.ref-pick[title="Gate"]').click();
  await expect(page.locator('.ref-viewer')).toHaveCount(1);

  await page.goto('/#satellite');
  // the Map draws it now, and Horizon no longer does: a clip never plays twice
  await expect(page.locator('.map-wrap .ref-viewer')).toHaveCount(1);
  await expect(page.locator('.ref-viewer')).toHaveCount(1);

  await page.goto('/#horizon?ll=46.5586,7.8353&hd=95&tl=0&fov=60&r=plain');
  await expect(page.locator('.view-area .ref-viewer')).toHaveCount(1);
  await expect(page.locator('.ref-viewer')).toHaveCount(1);
});
