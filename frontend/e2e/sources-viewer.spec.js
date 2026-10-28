import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Sources open a file where it is listed: a press on a Media card, a double press
 * or Space in Files. Both keep the view they were left on across a reload.
 */
const PICTURE = `
  <svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
    <rect width="320" height="200" fill="#4f8f67"/>
  </svg>`;

const quai = {
  path: 'media/quai.jpg',
  filename: 'quai.jpg',
  title: 'Quay at dawn',
  kind: 'image',
  size: 128,
  sha256: '0'.repeat(64),
  source: { type: 'upload' },
  thumbnail: null,
  thumb_state: 'none',
  enrich_state: 'ready',
  folder: '',
  notes: '',
};
const clip = { ...quai, path: 'media/clip.mp4', filename: 'clip.mp4', title: 'Departure', kind: 'video', sha256: '1'.repeat(64) };

const entity = (id, label, kind, path) => ({
  id,
  type: 'media',
  label,
  attrs: { kind, path, folder: 'Harbor' },
  provenance: { by: 'user', at: '2026-09-30T10:00:00Z', status: 'confirmed' },
});
const CATALOG = [
  entity('m-quai', 'Quay at dawn', 'image', quai.path),
  entity('m-clip', 'Departure', 'video', clip.path),
  entity('m-plan', 'Berth plan', 'file', 'media/plan.pdf'),
];

async function sources(page) {
  const fixture = await installAppFixture(page, {
    cases: [{ id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders: ['Harbor'] }],
    media: [quai, clip],
    catalog: CATALOG,
  });
  await page.route(`**/files/${CASE_ID}/${quai.path}`, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: PICTURE })
  );
  // No video decoder is needed to prove the viewer opened: the file it cannot read
  // says so, which is the other half worth seeing in a real browser.
  await page.route(`**/files/${CASE_ID}/${clip.path}`, (route) => route.fulfill({ status: 404, body: '' }));
  await page.route(`**/api/cases/${CASE_ID}/media/metadata`, (route) => route.fulfill({ json: [quai, clip] }));
  await page.route(`**/api/cases/${CASE_ID}/todos`, (route) =>
    route.fulfill({ json: { revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] } })
  );
  return fixture;
}

const viewer = (page) => page.locator('.viewer');

test('a press on a Media card opens a video as it opens a picture, and the arrows walk them', async ({ page }) => {
  const fixture = await sources(page);
  await page.goto('/#media');

  await page.locator('.media-card[data-path="media/clip.mp4"] .thumb').click();
  await expect(viewer(page).locator('.caption')).toHaveText('Departure · 1/2');
  await expect(viewer(page).getByText('This browser cannot show this file.')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(viewer(page).locator('.caption')).toHaveText('Quay at dawn · 2/2');
  await expect(viewer(page).locator('img')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(viewer(page)).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('Media opens again on the view it was left on', async ({ page }) => {
  const fixture = await sources(page);
  await page.goto('/#media');
  await page.locator('.view-btn', { hasText: 'List' }).click();
  await page.reload();
  await expect(page.locator('.view-btn.active')).toHaveText(/List/);
  fixture.expectNoUnexpectedRequests();
});

test('Files opens a file on a double press or Space, and the selection follows the viewer', async ({ page }) => {
  const fixture = await sources(page);
  await page.goto('/#files');
  const grid = page.locator('.grid-pane');
  const tile = (label) => grid.locator('.tile.entity', { hasText: label });
  await grid.locator('.tile.folder', { hasText: 'Harbor' }).dblclick();

  await tile('Quay at dawn').dblclick();
  await expect(viewer(page).locator('img')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(viewer(page).locator('.caption')).toContainText('Departure');
  await page.keyboard.press('Escape');
  await expect(viewer(page)).toHaveCount(0);
  await expect(tile('Departure')).toHaveClass(/selected/);

  await page.keyboard.press(' ');
  await expect(viewer(page).locator('.caption')).toContainText('Departure');
  await page.keyboard.press(' ');
  await expect(viewer(page)).toHaveCount(0);

  // a document has nothing to show: Space leaves it be
  await tile('Berth plan').click();
  await page.keyboard.press(' ');
  await expect(viewer(page)).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('Files opens again on the view it was left on', async ({ page }) => {
  const fixture = await sources(page);
  await page.goto('/#files');
  await page.locator('.view-btn', { hasText: 'Large' }).click();
  await page.reload();
  await expect(page.locator('.view-btn.active')).toHaveText(/Large/);
  fixture.expectNoUnexpectedRequests();
});
