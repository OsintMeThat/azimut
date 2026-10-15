import { test, expect } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A case opens again on the layers it was left on, in a real browser: the
 * switches are kept in its storage, the page is reloaded, and the map has to come
 * back on them. The guard is proved the same way: a layer the last session was
 * still drawing when it stopped stays off, and the page says which.
 */

const LAYER = {
  name: 'checkpoints',
  title: 'Checkpoints map',
  source: { kind: 'file', format: 'geojson', filename: 'checkpoints.geojson' },
  hidden: [],
  period: null,
  refresh: {},
  features: 1,
  categories: [{ name: 'checkpoints', count: 1, colour: '#e04040' }],
  bbox: [2.35, 48.85, 2.35, 48.85],
  format: 'geojson',
  icons: 0,
  sha256: 'a'.repeat(64),
  bytes: 256,
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
  ],
};

async function withLayer(page, options) {
  const fixture = await installAppFixture(page, options);
  await page.route(`**/api/cases/*/map-layers`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: route.request().url().includes(`/cases/${CASE_ID}/`) ? [LAYER] : [] })
      : route.fallback()
  );
  await page.route(`**/api/cases/${CASE_ID}/map-layers/${LAYER.name}/data`, (route) => route.fulfill({ json: FEATURES }));
  return fixture;
}

const eye = (page, label) => page.locator(`button.eye[aria-label="${label}"]`).first();

test('a case opens again on the layers it was left on, the fires left off', async ({ page }) => {
  const fixture = await withLayer(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await eye(page, 'Railways').click();
  await eye(page, 'Borders').click();
  await eye(page, LAYER.title).click();
  await expect(eye(page, LAYER.title)).toHaveAttribute('aria-pressed', 'true');
  // drawn, so nothing is marked as being drawn any more
  await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem(`azimut:map-layers:${id}`)).drawing, CASE_ID))
    .toEqual([]);

  const laid = fixture.railTiles.length;
  await page.reload();
  await awaitMapReady(page);

  await expect(eye(page, 'Railways')).toHaveAttribute('aria-pressed', 'true');
  await expect(eye(page, 'Borders')).toHaveAttribute('aria-pressed', 'false');
  await expect(eye(page, 'Place names')).toHaveAttribute('aria-pressed', 'true');
  await expect(eye(page, LAYER.title)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => fixture.railTiles.length).toBeGreaterThan(laid);
});

test('a layer the last session stopped while drawing stays off, and the page says which', async ({ page }) => {
  await withLayer(page);
  // what a tab that died mid-draw leaves behind
  await page.addInitScript((id) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(`azimut:map-layers:${id}`, JSON.stringify({
      added: { satellite: ['checkpoints'] },
      drawing: ['checkpoints'],
    }));
  }, CASE_ID);
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await expect(page.getByText('Checkpoints map was left off: the last session stopped while drawing it')).toBeVisible();
  await expect(eye(page, LAYER.title)).toHaveAttribute('aria-pressed', 'false');

  // switched back on by hand, it draws, and the next session keeps it
  await eye(page, LAYER.title).click();
  await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem(`azimut:map-layers:${id}`)), CASE_ID))
    .toMatchObject({ added: { satellite: ['checkpoints'] }, drawing: [] });
  await page.reload();
  await awaitMapReady(page);
  await expect(eye(page, LAYER.title)).toHaveAttribute('aria-pressed', 'true');
});

test('another case opens on the defaults, whatever the first was left on', async ({ page }) => {
  const second = 'browser-test-b';
  await withLayer(page, {
    cases: [
      { id: CASE_ID, name: 'Case A', scratch: false, folders: [] },
      { id: second, name: 'Case B', scratch: false, folders: [] },
    ],
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await eye(page, 'Railways').click();
  await eye(page, 'Borders').click();

  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case B' }).click();

  await expect(eye(page, 'Railways')).toHaveAttribute('aria-pressed', 'false');
  await expect(eye(page, 'Borders')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case A' }).click();
  await expect(eye(page, 'Railways')).toHaveAttribute('aria-pressed', 'true');
  await expect(eye(page, 'Borders')).toHaveAttribute('aria-pressed', 'false');
});
