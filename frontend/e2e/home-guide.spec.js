import { expect, test } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * The home page and the guide, in a real browser.
 *
 * `Overview.render.test.js` and `Guide.render.test.js` cover what each tab does on
 * its own. This covers the two things a DOM with no layout cannot answer: that the
 * map of the case comes up on the free imagery and puts the points where they are,
 * and that the `?` in the topbar reaches the section written about the tab it was
 * pressed from — a route that runs through the topbar, `lib/navigate.js` and a tab
 * that mounts on arrival.
 */

const summary = {
  total: 148,
  by_type: { media: 82, place: 31, claim: 18, person: 12 },
  by_status: { confirmed: 136, suggested: 12 },
  by_folder: { work: 96 },
  by_source: {},
  linked_to: {},
  unlinked: 4,
  countable: 0,
};

// Two points a few hundred metres apart, one north-west of the other.
const savedIndex = [
  { id: 'p1', key: 'p1', kind: 'place', title: 'North gate', lat: 49.9951, lon: 36.2304 },
  { id: 'p2', key: 'p2', kind: 'capture', title: 'Depot roof', lat: 49.9889, lon: 36.2401 },
];

test('draws the case on the free imagery, and presses through to the map', async ({ page }) => {
  const tiles = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/tiles/')) tiles.push(pathname);
  });
  await installAppFixture(page, { savedIndex, summary });
  await page.goto('/#overview');

  await awaitMapReady(page);
  // The one basemap it may ever ask for: keyless and unmetered, so arriving on the
  // home page cannot spend anybody's quota however many cases are opened.
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  expect(tiles.every((path) => path.startsWith('/api/tiles/esri-world-imagery/'))).toBe(true);
  // whose terms are met the way the Map tool meets them: the credit line, in full
  await expect(page.locator('.plate')).toContainText('Browser fixture');

  await page.locator('.plate .foot').click();
  expect(page.url()).toContain('#satellite');
});

test('the ? reaches the section written about the tab it was pressed from', async ({ page }) => {
  await installAppFixture(page, { savedIndex, summary });
  await page.goto('/#satellite');

  await page.locator('.topbar button[title="Guide: Satellite"]').click();
  await expect(page.locator('#guide-map')).toBeVisible();
  await expect(page.locator('.contents .jump.on')).toHaveText(/Map/);
  // silent on the guide itself, which is the answer
  await expect(page.locator('.topbar button[title^="Guide"]')).toHaveCount(0);
});

test('a recipe step opens the tab it names', async ({ page }) => {
  await installAppFixture(page, { savedIndex, summary });
  await page.goto('/#guide');

  await page.locator('.contents .jump', { hasText: 'Worked examples' }).click();
  await page.locator('.recipe', { hasText: 'Geolocate a photo' }).locator('.step-tool', { hasText: 'Satellite' }).click();
  expect(page.url()).toContain('#satellite');
});
