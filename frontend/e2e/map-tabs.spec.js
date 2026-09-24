import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * One camera for the map tabs, on the real engine (`lib/map/sharedView.js`).
 *
 * The unit tests drive fakes; what only a browser can say is whether a real
 * map, hidden while another tab shows, comes back on the ground the window
 * moved to, and whether a jump the engine makes on showing settles once.
 *
 * The fixture's home view is 48.8584, 2.2945 at z16, and Satellite opens
 * somewhere else from its address, so a map that opened on its own home view
 * would show z16.
 */

const readout = (page) => page.locator('.hud-coords');

/** The app on Satellite, away from home, with what Compare's opening pair reads. */
async function openSatellite(page) {
  await installAppFixture(page);
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'esri-world-imagery', label: 'Esri World Imagery', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
    { id: 'esri-wayback', label: 'Esri Wayback', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
  ] }));
  await page.route('**/api/satellite/wayback/releases', (route) => route.fulfill({ json: { releases: [{ release: 2, date: '2099-01-01' }, { release: 1, date: '2020-01-01' }] } }));
  await page.goto('/#satellite?ll=50.4501,30.5234&z=13');
  await awaitMapReady(page);
}

async function openTab(page, name) {
  await page.locator('.tabstrip').getByRole('button', { name, exact: true }).click();
}

/** Every map built so far is up. Hidden ones stay built, so they count too. */
async function mapsReady(page, count) {
  await expect(page.locator('.map[data-map-ready="true"]')).toHaveCount(count);
}

test('Compare opens where Satellite was, and Satellite follows a pan made in Compare', async ({ page }) => {
  await openSatellite(page);

  await openTab(page, 'Compare');
  await mapsReady(page, 3);
  await expect(page.locator('.camera-readout')).toHaveText('z13.0');

  // a drag across A, as Compare's own specs pan: some 3 km east to west at z13
  const box = await page.locator('.compare-stage').boundingBox();
  await page.mouse.move(box.x + 420, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 120, { steps: 10 });
  await page.mouse.up();

  await openTab(page, 'Satellite');
  await expect(readout(page)).not.toContainText('30.523');
  await expect(readout(page)).toContainText('z13');
});

test('Detect opens where Satellite was on its first visit, rather than on the watched ground', async ({ page }) => {
  await openSatellite(page);
  // the case watches ground in Paris; Satellite is in Kyiv
  const northSite = { id: 'aaaaaaaaaaaa', name: 'North site', colour: '#38bdf8',
    geometry: { type: 'Polygon', coordinates: [[[2.29, 48.855], [2.3, 48.855], [2.3, 48.862], [2.29, 48.862], [2.29, 48.855]]] } };
  await page.route('**/api/cases/*/analysis/**', (route) => route.fulfill({
    json: new URL(route.request().url()).pathname.endsWith('/analysis/areas') ? [northSite] : [],
  }));

  await openTab(page, 'Detect');
  await mapsReady(page, 2);
  // the areas are in, so the case's landing has had its chance
  await expect(page.locator('.detect-areas polygon').first()).toBeAttached();

  // a Detect that had framed Paris would have taken Satellite there too
  await openTab(page, 'Satellite');
  await expect(readout(page)).toContainText('50.450100, 30.523400');
});

test('with the switch off in Settings, each map tab keeps its own camera', async ({ page }) => {
  await openSatellite(page);

  // the title carries a badge's words when something is out of date
  await page.getByTitle(/^Settings/).click();
  const share = page.getByRole('checkbox', { name: 'Share one view across the map tabs' });
  await expect(share).toBeChecked();
  await share.uncheck();
  await expect(share).not.toBeChecked();

  await page.getByTitle('Map', { exact: true }).click();
  await openTab(page, 'Compare');
  await mapsReady(page, 3);
  await expect(page.locator('.camera-readout')).toHaveText('z16.0');
});
