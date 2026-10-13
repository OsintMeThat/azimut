import { expect, test } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture, PANEL_PATH } from './app.fixture.js';

// Find where it was taken: its own screen over Horizon, three columns, the
// area drawn and an alignment made by its four clicks, then the search, its
// places and a look from one. The terrain is not served here and the search's
// routes answer from the spec, so what is checked is the screen and its flow.

const PHOTO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAbCAIAAAC1C5slAAAAWklEQVR42mNwy1swqBDDqINGHTTqoFEHjToIzUHTKgKAiEjVEMU0Vc8A14NfG7IymqpnIEYPVtNppJ4BvzY8RtNIPQORRtANjTpo1EGjDhp10KiDRh001B0EACZm1btZqPSgAAAAAElFTkSuQmCC',
  'base64'
);

const DONE = {
  name: 'panel search',
  status: 'done',
  progress: { done: 64, total: 64 },
  ask: { area: [[46.55, 7.82], [46.55, 7.85], [46.57, 7.85], [46.57, 7.82]], who: { mode: 'ground', low: 1.7, high: 1.7 } },
  result: {
    verdict: 'match',
    places: [
      { lat: 46.5586, lon: 7.8353, explained: 0.86, heading: 95.4, fov: 58, tilt: 1.2, roll: 0, reach: 20000, height: 1.7 },
      { lat: 46.5402, lon: 7.8601, explained: 0.52, heading: 101, fov: 60, tilt: 0.4, roll: 0, reach: 20000, height: 1.7 },
    ],
    points: [
      { lat: 46.5586, lon: 7.8353, explained: 0.86, spacing: 250 },
      { lat: 46.5402, lon: 7.8601, explained: 0.52, spacing: 250 },
    ],
  },
};

async function openFind(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await installAppFixture(page);
  const asked = [];
  await page.route('**/api/horizon/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/horizon/finds/estimate')) return route.fulfill({ json: { points: 64, coarse: 64, spacing: 250, step: 0.5 } });
    return route.fulfill({ status: 404, json: { detail: 'No terrain in the browser fixture' } });
  });
  let reads = 0;
  await page.route(`**/api/cases/${CASE_ID}/horizon/finds**`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.url().endsWith('/horizon/finds')) {
      asked.push(request.postDataJSON());
      return route.fulfill({ json: { name: 'panel search', status: 'queued', progress: { done: 0, total: 0 } } });
    }
    if (request.url().endsWith('/horizon/finds')) return route.fulfill({ json: [] });
    reads += 1;
    return route.fulfill({ json: reads > 1 ? DONE : { ...DONE, status: 'running', progress: { done: 30, total: 64 }, result: null } });
  });
  await page.route(`**/files/${CASE_ID}/${PANEL_PATH}*`, (route) => route.fulfill({ contentType: 'image/png', body: PHOTO_PNG }));
  await page.goto('/#horizon?ll=46.5586,7.8353&hd=95&tl=0&fov=60&r=plain');
  await page.getByRole('button', { name: 'Add a photo or video' }).click();
  await page.getByText('panel.svg').first().click();
  await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  await page.getByRole('button', { name: 'Find where it was taken' }).click();
  const find = page.getByRole('region', { name: 'Find where it was taken' });
  await expect(find).toBeVisible();
  return { fixture, find, asked };
}

/** A stroke along the photo's ridge, drawn freely (Alt). */
async function trace(page, find) {
  await find.getByRole('button', { name: 'Trace skyline' }).click();
  const box = await find.locator('.fp').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.48);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + box.width * (0.15 + i * 0.05), box.y + box.height * (0.48 - 0.02 * Math.sin(i)), { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await find.getByRole('button', { name: 'Trace skyline' }).click();
}

test.describe('Find where it was taken', () => {
  test('opens over Horizon in three columns, each enlarged and given back, the tab under it out of reach', async ({ page }) => {
    const { find } = await openFind(page);
    await expect(find.getByRole('region', { name: 'Photo and its skyline' })).toBeVisible();
    await expect(find.getByRole('region', { name: 'Map and the area' })).toBeVisible();
    await expect(find.getByRole('complementary', { name: 'Steps' })).toBeVisible();
    // the tab under it takes no focus and no click while Find is open
    await expect(page.locator('.hz-main')).toHaveAttribute('inert', '');
    await expect(page.locator('.hz-inspector')).toHaveAttribute('inert', '');
    await find.getByRole('button', { name: 'Enlarge the photo' }).click();
    await expect(find.getByRole('region', { name: 'Map and the area' })).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(find.getByRole('region', { name: 'Map and the area' })).toBeVisible();
    await find.getByRole('button', { name: 'Hide the steps' }).click();
    await expect(find.getByRole('complementary', { name: 'Steps' })).toHaveCount(0);
    await find.getByRole('button', { name: 'Show the steps' }).click();
    await find.getByRole('button', { name: 'Back to the view' }).click();
    await expect(find).toHaveCount(0);
    await expect(page.locator('.hz-main')).not.toHaveAttribute('inert', '');
    await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  });

  test('takes the trace on the photo and holds the search until the area is drawn', async ({ page }) => {
    const { find } = await openFind(page);
    await expect(find.getByText('Trace the skyline on the photo, or press Detect.')).toBeVisible();
    await trace(page, find);
    await expect(find.getByText(/1 line traced/)).toBeVisible();
    await expect(find.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
    await expect(find.getByText('Draw the area on the map.')).toBeVisible();
  });

  test('draws the area, makes an alignment by its four clicks, searches and looks from the best place', async ({ page }) => {
    const { find, asked } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
    await find.getByRole('button', { name: 'Draw the area' }).click();
    await expect(page.getByText('Click each corner of the area on the map.', { exact: false }).first()).toBeVisible();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]]) await page.mouse.click(...at(fx, fy));
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await expect(find.getByText(/km²/)).toBeVisible();
    await expect(find.getByText('64 points, about a minute.')).toBeVisible();

    // an alignment: the near thing and the far one on the photo, then on the map
    await find.getByRole('button', { name: 'Add an alignment' }).click();
    const photo = await find.locator('.fp').boundingBox();
    await expect(find.getByText('1 of 4 · On the photo, click something near').first()).toBeVisible();
    await page.mouse.click(photo.x + photo.width * 0.5, photo.y + photo.height * 0.6);
    await page.mouse.click(photo.x + photo.width * 0.5, photo.y + photo.height * 0.45);
    await expect(find.getByText('3 of 4 · On the map, click the near one').first()).toBeVisible();
    await page.mouse.click(...at(0.5, 0.45));
    await page.mouse.click(...at(0.52, 0.2));
    await expect(find.getByText('Lined up')).toBeVisible();

    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(find.getByText('One place stands out')).toBeVisible({ timeout: 10_000 });
    expect(asked).toHaveLength(1);
    expect(asked[0].area).toHaveLength(4);
    expect(asked[0].alignments).toHaveLength(1);
    expect(asked[0].trace.x.length).toBeGreaterThan(5);
    const places = find.locator('.fs-place');
    await expect(places).toHaveCount(2);
    await expect(places.first()).toContainText('explains 86%');
    await places.first().click();
    await expect(find).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  });
});
