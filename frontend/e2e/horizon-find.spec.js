import { expect, test } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture, PANEL_PATH, repainted } from './app.fixture.js';

// Find where it was taken: Horizon's third mode, three columns, the area drawn
// and an alignment made by its four clicks, then the search, its places and a
// look from one; the mode and the work come back after a reload. The terrain is not served here and the search's
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

/** The mode switch on screen: the tab's header, or Find's own over it. */
const modes = (page) => page.getByRole('group', { name: 'Horizon mode' }).last();

async function openFind(page, { settings } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await installAppFixture(page, settings ? { settings } : {});
  const asked = [];
  await page.route('**/api/horizon/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/horizon/finds/estimate')) return route.fulfill({ json: { points: 64, coarse: 64, spacing: 250, step: 0.5 } });
    if (url.endsWith('/api/horizon/finds/preview')) {
      // a grid of 64 points, the top row on summits and one on water
      const stands = route.request().postDataJSON().stands ?? [];
      const points = Array.from({ length: 64 }, (_, i) => {
        const kind = i === 63 ? 'water' : i < 8 ? 'summit' : 'slope';
        const kept = kind !== 'water' && (!stands.length || stands.includes(kind));
        return [46.55 + Math.floor(i / 8) * 0.0025, 7.82 + (i % 8) * 0.004, kind, kept];
      });
      const kinds = { summit: 8, slope: 55, valley: 0, plain: 0, water: 1 };
      return route.fulfill({ json: { spacing: 250, total: 64, kept: points.filter((p) => p[3]).length, kinds, points } });
    }
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
  // Overlay asks for the photo when none is laid
  await modes(page).getByRole('button', { name: 'Overlay' }).click();
  await page.getByText('panel.svg').first().click();
  await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  await modes(page).getByRole('button', { name: 'Find' }).click();
  const find = page.getByRole('region', { name: 'Find where it was taken' });
  await expect(find).toBeVisible();
  return { fixture, find, asked };
}

test('Find opens on its beta notice until it is read, and its Beta pill brings it back', async ({ page }) => {
  const { fixture, find } = await openFind(page, { settings: { find_beta_seen: false } });
  const notice = page.getByRole('dialog', { name: 'Find is in beta' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Got it' }).click();
  await expect(notice).toBeHidden();
  expect(fixture.settingsWrites.at(-1)).toEqual({ find_beta_seen: true });

  // read: leaving Find and coming back does not show it again
  await modes(page).getByRole('button', { name: 'View' }).click();
  await modes(page).getByRole('button', { name: 'Find' }).click();
  await expect(find).toBeVisible();
  await expect(notice).toBeHidden();

  // the pill by Find's title says it again, and leads to the guide on Find's own screen
  await find.getByRole('button', { name: 'Beta' }).click();
  await notice.getByRole('button', { name: 'Read the guide' }).click();
  const guide = page.getByRole('dialog', { name: 'Guide' });
  await expect(guide.getByText('Find ranks the places whose relief fits the skyline of the photo.', { exact: false })).toBeVisible();
  await expect(guide.getByRole('link', { name: 'The full guide to Find' })).toHaveAttribute('href', /docs\/FIND\.md$/);
});

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

test('leaving Find and coming back finds its map as it stood, nothing laid again', async ({ page }) => {
  const { find } = await openFind(page);
  await awaitMapReady(page, 2);
  await find.locator('canvas.maplibregl-canvas').first().evaluate((canvas) => (canvas.dataset.kept = 'yes'));
  await modes(page).getByRole('button', { name: 'View' }).click();
  await expect(find).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Horizon mode' })).toHaveCount(1);
  await modes(page).getByRole('button', { name: 'Find' }).click();
  await expect(find).toBeVisible();
  await expect(find.locator('canvas.maplibregl-canvas').first()).toHaveAttribute('data-kept', 'yes');
});

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
    await find.getByRole('group', { name: 'Horizon mode' }).getByRole('button', { name: 'Overlay' }).click();
    await expect(find).toHaveCount(0);
    await expect(page.locator('.hz-main')).not.toHaveAttribute('inert', '');
    await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  });

  test('the map has Horizon’s Layers menu, its switches shared with the small map', async ({ page }) => {
    const { find } = await openFind(page);
    await awaitMapReady(page, 2);
    const map = find.getByRole('region', { name: 'Map and the area' });
    await map.getByRole('button', { name: 'Map layers' }).click();
    const menu = map.getByRole('dialog', { name: 'Base map and layers' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('group', { name: 'Base map' }).getByRole('button', { name: 'Satellite' })).toHaveAttribute('aria-pressed', 'true');
    const borders = menu.getByRole('button', { name: 'Borders', exact: true });
    await expect(borders).toHaveAttribute('aria-pressed', 'true');
    await borders.click();
    await expect(borders).toHaveAttribute('aria-pressed', 'false');
    // Escape closes the menu, and only the menu
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(find).toBeVisible();
    // the switch holds on the small map
    await find.getByRole('group', { name: 'Horizon mode' }).getByRole('button', { name: 'Overlay' }).click();
    await page.locator('.hz-map').getByRole('button', { name: 'Map layers' }).click();
    const small = page.locator('#hz-map-layers');
    await expect(small.getByRole('button', { name: 'Borders', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('starts a new search beside Open: asks first while the trace is no search’s, then lets the photo go', async ({ page }) => {
    const { find } = await openFind(page);
    await trace(page, find);
    await expect(find.getByText(/1 line traced/)).toBeVisible();
    await find.getByRole('button', { name: 'New search' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Start a new search?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(find.getByText(/1 line traced/)).toBeVisible();
    await find.getByRole('button', { name: 'New search' }).click();
    await ask.getByRole('button', { name: 'Start a new one' }).click();
    // the next photo is asked for, the setup empty under it
    const pick = page.getByRole('dialog', { name: 'Add a photo or video' });
    await expect(pick).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pick).toBeHidden();
    await expect(find.getByRole('complementary', { name: 'Steps' }).getByText('Add the photo first.').first()).toBeVisible();
    await expect(find.getByRole('button', { name: 'New search' })).toBeDisabled();
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
    await expect(find.getByText('64 points.', { exact: false })).toBeVisible();

    // an alignment, under Help the search: the near thing and the far one on the photo, then on the map
    const help = find.getByRole('region', { name: 'Help the search' });
    await expect(help.getByRole('button', { name: 'Add an alignment' })).toBeHidden();
    await help.locator('summary', { hasText: 'Alignments' }).click();
    const before = await find.locator('.fp').boundingBox();
    await find.getByRole('button', { name: 'Add an alignment' }).click();
    const photo = await find.locator('.fp').boundingBox();
    // the guide is said in the column that waits for the click: nothing moves aside
    expect(photo).toEqual(before);
    const photoColumn = find.getByRole('region', { name: 'Photo and its skyline' });
    const mapColumn = find.getByRole('region', { name: 'Map and the area' });
    await expect(photoColumn.getByText('1 of 4 · On the photo, click something near')).toBeVisible();
    await page.mouse.click(photo.x + photo.width * 0.5, photo.y + photo.height * 0.6);
    await page.mouse.click(photo.x + photo.width * 0.5, photo.y + photo.height * 0.45);
    // both points show on the photo before the map is asked
    await expect(find.locator('.fp-dot')).toHaveCount(2);
    await expect(mapColumn.getByText('3 of 4 · On the map, click the near one')).toBeVisible();
    await expect(photoColumn.getByText(/of 4 ·/)).toHaveCount(0);
    await page.mouse.click(...at(0.5, 0.45));
    await page.mouse.click(...at(0.52, 0.2));
    await expect(find.getByText('Lined up')).toBeVisible();

    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(find.getByText('One place stands out')).toBeVisible({ timeout: 10_000 });
    // the result has the side to itself, and says what it was asked with
    await expect(find.getByRole('region', { name: 'The search on show' })).toContainText(/km² · any lens/);
    await expect(find.locator('.fs-steps')).toHaveCount(0);
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

  test('ticks the directions, several zooms and the ground when unsure, searches with them and says how far to trust the place', async ({ page }) => {
    const { find, asked } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]]) await page.mouse.click(...at(fx, fy));
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();

    const help = find.getByRole('region', { name: 'Help the search' });
    await help.locator('summary', { hasText: 'What you know' }).click();
    const compass = help.locator('.fs-compass');
    await expect(compass.getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'true');
    await compass.getByRole('button', { name: 'NE', exact: true }).click();
    await compass.getByRole('button', { name: 'E', exact: true }).click();
    await expect(compass.getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'false');
    await expect(help.getByText('Only headings NE to E are searched, drawn on the map.')).toBeVisible();
    await help.getByRole('button', { name: '×0.5', exact: true }).click();
    await help.getByRole('button', { name: '×1', exact: true }).click();
    await expect(help.getByText('Fit tries 50° to 120° across.')).toBeVisible();
    await expect(find.getByText(/With zoom ×0.5 or ×1 · facing NE to E/)).toBeVisible();
    // the ground the eye stands on: the grid read before the search says what it keeps
    await expect(help.getByText('1 on water left out.')).toBeVisible();
    await help.getByRole('button', { name: 'Summit or ridge' }).click();
    await expect(help.getByText('Keeps 8 of 64 points (13%), 1 on water left out.')).toBeVisible();

    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(find.getByText('One place stands out')).toBeVisible({ timeout: 10_000 });
    expect(asked[0].facing).toEqual(['ne', 'e']);
    expect(asked[0].stands).toEqual(['summit']);
    expect(asked[0].trace.within).toEqual([50, 120]);
    await expect(find.locator('.fs-trust.solid')).toContainText('Solid: nothing speaks against the best place');
  });

  test('says how far a line stands, how the camera looks and a selfie, and sends it all to the search', async ({ page }) => {
    const { find, asked } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    // the Distance tool: pick how far, then click the line
    await find.getByRole('button', { name: 'Say how far a line stands' }).click();
    const chips = find.getByRole('group', { name: 'How far the line stands' });
    await expect(chips).toBeVisible();
    // 1–3 km is picked to start with: one more press widens it to 10 km
    await expect(chips.getByRole('button', { name: '1–3 km' })).toHaveAttribute('aria-pressed', 'true');
    await chips.getByRole('button', { name: '3–10 km' }).click();
    // a point of the line as drawn on the photo
    const spots = await find.locator('.fp-trace').first().evaluate((line) => line.getAttribute('points'));
    const [x, y] = spots.split(' ')[4].split(',').map(Number);
    const photo = await find.locator('.fp-marks').boundingBox();
    await page.mouse.click(photo.x + x, photo.y + y);
    await expect(find.locator('.fp-far text')).toHaveText('1–10 km');
    await page.keyboard.press('Escape');

    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]]) await page.mouse.click(...at(fx, fy));
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    const help = find.getByRole('region', { name: 'Help the search' });
    await help.locator('summary', { hasText: 'What you know' }).click();
    const camera = help.getByRole('group', { name: 'Camera' });
    await camera.getByRole('button', { name: 'Looking down' }).click();
    await camera.getByRole('button', { name: 'Selfie' }).click();
    await expect(find.getByText(/lines 1–10 km away · on foot · looking down · mirrored too/).first()).toBeVisible();

    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(find.getByText('One place stands out')).toBeVisible({ timeout: 10_000 });
    expect(asked[0].trace.far).toEqual([[0, 1000, 10000]]);
    expect(asked[0].trace.line.every((one) => one === 0)).toBe(true);
    expect(asked[0]).toMatchObject({ view: ['down'], mirror: true });
    expect(asked[0].photo.marks.far).toEqual([{ line: 0, bands: ['b1', 'b3'] }]);
  });

  test('marks a ridge in front of the skyline, pairs them, cuts the collage and sends it all to the search', async ({ page }) => {
    const { find, asked, fixture } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const photo = await find.locator('.fp').boundingBox();
    const on = (fu, fv) => [photo.x + photo.width * fu, photo.y + photo.height * fv];
    // a ridge in front, under the skyline's middle, drawn freely with its own pen
    await find.getByRole('button', { name: 'Trace a ridge' }).click();
    await expect(find.getByText(/Draw along a ridge seen against farther land/)).toBeVisible();
    const magnet = find.getByRole('button', { name: 'Snap to edges' });
    await expect(magnet).toHaveAttribute('aria-pressed', 'true');
    await magnet.click();
    await expect(magnet).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.move(...on(0.35, 0.62));
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(...on(0.35 + i * 0.04, 0.62 - 0.01 * i), { steps: 2 });
    await page.mouse.up();
    await expect(find.locator('.fp-trace.ridge')).toHaveCount(1);
    await expect(find.getByText(/2 lines traced: 1 ridge/)).toBeVisible();
    // the ridge in front of the skyline: a letter on each
    await find.getByRole('button', { name: 'Pair a line in front with one behind' }).click();
    await expect(find.getByText(/Click the line in front/)).toBeVisible();
    await page.mouse.click(...on(0.51, 0.58));
    await expect(find.getByText(/Now click the line behind it/)).toBeVisible();
    const sky = await find.locator('.fp-trace:not(.ridge):not(.picked)').first().evaluate((line) => line.getAttribute('points').split(' ')[6].split(',').map(Number));
    const box = await find.locator('.fp').boundingBox();
    await page.mouse.click(box.x + sky[0], box.y + sky[1]);
    await expect(find.locator('.fp-pair')).toHaveCount(2);
    await expect(find.getByText(/1 ridge · 1 pair/)).toBeVisible();
    // a cut down the collage
    await find.getByRole('button', { name: 'Cut the collage' }).click();
    await page.mouse.click(...on(0.5, 0.2));
    await expect(find.locator('.fp-cut')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(find.getByText(/2 lines traced: 1 ridge · 1 pair · 2 pieces/)).toBeVisible();

    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65]]) await page.mouse.click(map.x + map.width * fx, map.y + map.height * fy);
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => asked.length).toBe(1);
    const sent = asked[0].trace;
    expect(sent.ridge_x.length).toBeGreaterThan(3);
    expect(sent.pairs).toEqual([[1, 0]]);
    expect(new Set(sent.piece)).toEqual(new Set([0, 1]));
    expect(asked[0].photo.marks.inner).toHaveLength(1);
    // and the marks are kept with the work in the case
    await expect.poll(() => fixture.workWrites.at(-1)?.photo?.marks?.cuts?.length ?? 0, { timeout: 5000 }).toBe(1);
  });

  test('straightens the photo from its lens’s curve, the trace kept on it, and searches with the curve', async ({ page }) => {
    const { find, asked, fixture } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const line = find.locator('.fp-trace').first();
    const before = await line.getAttribute('points');
    const lens = find.getByRole('button', { name: 'Lens curve' });
    await lens.click();
    await expect(lens).toHaveAttribute('aria-expanded', 'true');
    const slider = find.getByRole('slider', { name: 'Lens distortion' });
    await expect(slider).toHaveAttribute('aria-valuetext', 'None');
    await slider.evaluate((input) => {
      input.value = '-0.15';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(slider).toHaveAttribute('aria-valuetext', 'Barrel 0.15');
    await expect(lens).toContainText('Barrel 0.15');
    // the stroke follows the photo as it straightens; it is kept on the photo's own pixels
    await expect.poll(() => line.getAttribute('points')).not.toBe(before);
    const kept = () => fixture.workWrites.at(-1)?.photo;
    await expect.poll(() => kept()?.bend, { timeout: 15000 }).toBe(-0.15);
    const strokes = kept().strokes;
    // None puts it back, the stroke where it was
    await find.getByRole('button', { name: 'None', exact: true }).click();
    await expect(slider).toHaveAttribute('aria-valuetext', 'None');
    await expect.poll(() => line.getAttribute('points')).toBe(before);
    await expect.poll(() => kept()?.bend, { timeout: 15000 }).toBe(0);
    expect(kept().strokes).toEqual(strokes);
    await slider.evaluate((input) => {
      input.value = '0.1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.keyboard.press('Escape');
    await expect(find.locator('#fp-curve')).toHaveCount(0);

    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65]]) await page.mouse.click(map.x + map.width * fx, map.y + map.height * fy);
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0].photo.bend).toBe(0.1);
    expect(asked[0].photo.strokes).toEqual(strokes);
  });

  test('the mode is in the address; a reload opens on the map and Resume brings back the photo, its trace and the area', async ({ page }) => {
    const { find, fixture } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65]]) await page.mouse.click(map.x + map.width * fx, map.y + map.height * fy);
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await expect(page).toHaveURL(/md=find/);
    // the bench is written a moment after the last change
    await expect.poll(() => fixture.workWrites.at(-1)?.find?.area?.length ?? 0, { timeout: 5000 }).toBe(3);
    expect(fixture.workWrites.at(-1).photo.strokes.length).toBe(1);

    expect(fixture.workWrites.at(-1)).toMatchObject({ mode: 'find', saved: false });

    await page.reload();
    const again = page.getByRole('region', { name: 'Find where it was taken' });
    await expect(page.getByRole('heading', { name: 'Pick a viewpoint' })).toBeVisible();
    await expect(again).toHaveCount(0);
    await expect(page).not.toHaveURL(/md=find/);
    const offer = page.getByRole('region', { name: 'Unsaved work' });
    await expect(offer).toContainText('1 line traced');
    await expect(offer).toContainText('an area drawn in Find');
    await offer.getByRole('button', { name: 'Resume' }).click();
    await expect(again).toBeVisible();
    await expect(offer).toHaveCount(0);
    await expect(again.getByText(/1 line traced/)).toBeVisible();
    await expect(again.getByText(/km²/)).toBeVisible();
    await expect(page).toHaveURL(/md=find/);
    // and Back leaves Find
    await page.goBack();
    await expect(again).toHaveCount(0);
  });

  test('arriving without a photo, the dialog offers the searches the case keeps, one opened by a click', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installAppFixture(page);
    await page.route('**/api/horizon/**', (route) => route.fulfill({ status: 404, json: { detail: 'No terrain in the browser fixture' } }));
    await page.route(`**/api/cases/${CASE_ID}/horizon/finds**`, (route) => {
      if (route.request().url().endsWith('/horizon/finds')) {
        return route.fulfill({ json: [{ name: 'panel search', title: 'Ridge search', status: 'done', created_at: '2026-10-18T09:30:00', best: { explained: 0.86 } }] });
      }
      return route.fulfill({ json: DONE });
    });
    await page.goto('/#horizon?ll=46.5586,7.8353&hd=95&tl=0&fov=60&r=plain');
    await modes(page).getByRole('button', { name: 'Find' }).click();
    const pick = page.getByRole('dialog', { name: 'Open a search or add a photo' });
    await expect(pick).toBeVisible();
    await pick.getByRole('button', { name: /Ridge search/ }).click();
    await expect(pick).toBeHidden();
    const find = page.getByRole('region', { name: 'Find where it was taken' });
    await expect(find.locator('.fs-place').first()).toContainText('explains 86%');
  });

  test('says how much faster each choice is, never a time, asks what the photo shows and checks the view', async ({ page }) => {
    const { find } = await openFind(page);
    await awaitMapReady(page, 2);
    const estimates = [];
    const previews = [];
    await page.route('**/api/horizon/finds/estimate', (route) => {
      estimates.push(route.request().postDataJSON());
      const efforts = { quick: { points: 300, most: 300, spacing: 500, coarse: 250 }, normal: { points: 1000, most: 1000, spacing: 250, coarse: 900 }, thorough: { points: 3000, most: 3000, spacing: 145, coarse: 2900 } };
      return route.fulfill({ json: { points: 1000, coarse: 900, spacing: 250, efforts, lane_min: 200, speeds: { fastest: { lanes: 8, gain: 3.1 }, fast: { lanes: 4, gain: 2.5 }, gentle: { lanes: 1, gain: 1 } } } });
    });
    // the water in sight: unchecked until the Mesh step's check ran, then the last 24 points hidden
    let checked = false;
    await page.route('**/api/horizon/finds/preview', (route) => {
      const body = route.request().postDataJSON();
      previews.push(body);
      const why = (i) => (body.over === 'above' && i < 16 ? 'low' : body.water && checked && i >= 40 ? 'waterhidden' : '');
      const points = Array.from({ length: 64 }, (_, i) => [46.55 + Math.floor(i / 8) * 0.0025, 7.82 + (i % 8) * 0.004, why(i) || 'slope', !why(i)]);
      const ruled = { ...(body.over === 'above' ? { low: 16 } : {}), ...(body.water && checked ? { waterhidden: 24 } : {}) };
      const pending = body.water && !checked ? 48 : 0;
      return route.fulfill({ json: { spacing: 250, total: 64, kept: points.filter((p) => p[3]).length, kinds: { slope: 64 }, points, ruled, sight: { pending, seconds: pending * 0.025 } } });
    });
    await page.route('**/api/horizon/finds/sight', (route) => route.fulfill({ json: { id: 'c1', status: 'running', done: 0, total: 48 } }));
    await page.route('**/api/horizon/finds/sight/c1', (route) => {
      checked = true;
      return route.fulfill({ json: { id: 'c1', status: 'done', done: 48, total: 48 } });
    });
    await trace(page, find);
    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]]) await page.mouse.click(...at(fx, fy));
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    // the speeds say what they gain here, and the time is left to the search itself
    await expect(find.getByRole('group', { name: 'How hard the computer works' }).getByRole('button', { name: 'Fast · ×2.5', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(find.getByText(/The time left shows once it runs/)).toBeVisible();
    await expect(find.getByText(/\d+ min on this computer/)).toHaveCount(0);
    const efforts = find.getByRole('group', { name: 'How thorough the search is' });
    await efforts.getByRole('button', { name: /^Thorough/ }).click();
    await expect.poll(() => estimates.at(-1)?.effort).toBe('thorough');
    // what the photo shows rules points out before the search, and the side says how many
    const help = find.getByRole('region', { name: 'Help the search' });
    await help.locator('summary', { hasText: 'What you know' }).click();
    await help.getByRole('button', { name: 'Above the land round' }).click();
    await help.getByRole('button', { name: 'Sea, lake or river' }).click();
    await expect.poll(() => previews.at(-1)?.water).toBe(true);
    expect(previews.at(-1).over).toBe('above');
    await expect(find.getByText('Lower than the land round it: 16 points left out (25%).')).toBeVisible();
    // the Mesh step checks which points see the water, and the grid greys the ones the land hides it from
    await expect(find.getByText('Water lies within reach of 48 points. Check which see it, about 5 s.')).toBeVisible();
    await find.getByRole('button', { name: 'Check the view' }).click();
    await expect(find.getByText('Water hidden by the land: 24 points left out (38%).')).toBeVisible();
    await expect(find.getByRole('button', { name: 'Check the view' })).toHaveCount(0);
    // taken back from its line, the hint goes
    await find.getByRole('button', { name: 'Take back: Water hidden by the land' }).click();
    await expect.poll(() => previews.at(-1)?.water).toBe(false);
  });

  test('draws another area and paints points out with the brush, the map holding still, a stroke taken back', async ({ page }) => {
    const { find } = await openFind(page);
    await awaitMapReady(page, 2);
    const previews = [];
    await page.route('**/api/horizon/finds/preview', (route) => {
      const body = route.request().postDataJSON();
      previews.push(body);
      const painted = (body.strokes ?? []).some((stroke) => stroke.out);
      const points = Array.from({ length: 64 }, (_, i) => [46.55 + Math.floor(i / 8) * 0.0025, 7.82 + (i % 8) * 0.004, painted && i < 8 ? 'painted' : 'slope', !(painted && i < 8)]);
      return route.fulfill({ json: { spacing: 250, total: 64, kept: points.filter((p) => p[3]).length, kinds: { slope: 64 }, points } });
    });
    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.3, 0.3], [0.5, 0.3], [0.5, 0.5], [0.3, 0.5]]) await page.mouse.click(...at(fx, fy));
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();

    // another area, searched with the first
    await find.getByRole('button', { name: 'Another area' }).click();
    for (const [fx, fy] of [[0.6, 0.6], [0.75, 0.6], [0.75, 0.75]]) await page.mouse.click(...at(fx, fy));
    await page.keyboard.press('Enter');
    await expect(find.locator('.fs-zone.more')).toContainText('Area 2');
    await expect.poll(() => previews.at(-1)?.areas?.length ?? 0).toBe(1);

    // the brush paints while the map holds still
    await find.getByRole('button', { name: 'Brush', exact: true }).click();
    await expect(find.getByText('Brush over points to turn them off.', { exact: false }).first()).toBeVisible();
    // a corner of the area stays where it was on screen: the map did not pan under the stroke
    const centre = () => find.locator('.find-corner').first().boundingBox();
    const still = await centre();
    await page.mouse.move(...at(0.32, 0.35));
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(...at(0.32 + i * 0.015, 0.35), { steps: 2 });
    await page.mouse.up();
    expect(await centre()).toEqual(still);
    await expect(find.getByText('1 stroke of the brush')).toBeVisible();
    await expect.poll(() => previews.at(-1)?.strokes?.length ?? 0).toBe(1);
    const stroke = previews.at(-1).strokes[0];
    expect(stroke.out).toBe(true);
    expect(stroke.path.length).toBeGreaterThan(2);
    // Ctrl+Z takes it back, Escape puts the brush down
    await page.keyboard.press('Control+z');
    await expect(find.getByText('1 stroke of the brush')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(find.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('the brush turns points off and paints ground in on the map at once, before the app reads the stroke', async ({ page }) => {
    const { find } = await openFind(page);
    await awaitMapReady(page, 2);
    // a dense grid over the area drawn; once a stroke is asked about, the app answers late
    let answered = 0;
    await page.route('**/api/horizon/finds/preview', async (route) => {
      const body = route.request().postDataJSON();
      const lats = body.area.map((p) => p.lat);
      const lons = body.area.map((p) => p.lon);
      const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
      const points = [];
      for (let i = 0; i <= 24; i += 1) for (let j = 0; j <= 24; j += 1) points.push([south + ((north - south) * i) / 24, west + ((east - west) * j) / 24, 'slope', true]);
      if (body.strokes?.length) await new Promise((resolve) => setTimeout(resolve, 4000));
      answered += body.strokes?.length ? 1 : 0;
      return route.fulfill({ json: { spacing: 250, total: points.length, kept: points.length, kinds: { slope: points.length }, points } });
    });
    const region = find.getByRole('region', { name: 'Map and the area' });
    const map = await region.boundingBox();
    const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.3, 0.3], [0.6, 0.3], [0.6, 0.6], [0.3, 0.6]]) await page.mouse.click(...at(fx, fy));
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await page.waitForTimeout(1500);
    await find.getByRole('button', { name: 'Brush', exact: true }).click();
    const picture = async () => {
      // the ring under the hand is put away first, so only the points differ
      await page.mouse.move(map.x + map.width + 40, map.y + 10);
      await page.waitForTimeout(250);
      return region.locator('.map[data-map-ready="true"]').screenshot();
    };
    const before = await picture();
    // Off across the grid: the points it passes over are grey at once
    await page.mouse.move(...at(0.32, 0.45));
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(...at(0.32 + i * 0.025, 0.45), { steps: 2 });
    await page.mouse.up();
    const greyed = await picture();
    expect(answered).toBe(0);
    expect(repainted(before, greyed)).toBe(true);
    // On (Alt) past the area: the ground painted in shows its points at once too
    await page.keyboard.down('Alt');
    await page.mouse.move(...at(0.65, 0.75));
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(...at(0.65 + i * 0.02, 0.75), { steps: 2 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const paintedIn = await picture();
    expect(answered).toBe(0);
    expect(repainted(greyed, paintedIn)).toBe(true);
    await expect(find.getByText('2 strokes of the brush')).toBeVisible();
  });

  test('fills the map in as it runs; a point tried, looked from and confirmed is kept and stops the search', async ({ page }) => {
    const { find } = await openFind(page);
    await awaitMapReady(page, 2);
    const scored = [
      { lat: 46.5586, lon: 7.8353, explained: 0.81, spacing: 250, gap: 0.1 },
      { lat: 46.5402, lon: 7.8601, explained: 0.4, spacing: 250, gap: 0.3 },
    ];
    const tried = { lat: 46.5586, lon: 7.8353, explained: 0.83, heading: 95.4, fov: 58, tilt: 1.2, roll: 0, reach: 20000, height: 1.7 };
    let record = { name: 'panel search', status: 'running', progress: { done: 30, total: 64 }, ask: DONE.ask, result: null };
    const found = [];
    await page.route(`**/api/cases/${CASE_ID}/horizon/finds**`, (route) => {
      const request = route.request();
      const url = request.url();
      if (request.method() === 'POST' && url.endsWith('/horizon/finds')) return route.fulfill({ json: { name: 'panel search', status: 'queued', progress: { done: 0, total: 0 } } });
      if (url.endsWith('/horizon/finds')) return route.fulfill({ json: [] });
      if (url.includes('/points')) return route.fulfill({ json: { started: 5, since: 0, points: url.includes('since=0') ? scored : [] } });
      if (url.endsWith('/finds/try')) return route.fulfill({ json: { place: tried, frames: null } });
      if (url.endsWith('/found')) {
        found.push(request.postDataJSON());
        record = { ...record, status: 'stopping', found: found[0] };
        return route.fulfill({ json: record });
      }
      const now = record;
      // stopping, it ends with what it had found
      if (record.status === 'stopping') record = { ...record, status: 'cancelled', result: { partial: true, verdict: 'match', places: [tried], points: scored } };
      return route.fulfill({ json: now });
    });
    await page.route(`**/api/cases/${CASE_ID}/horizon/views**`, (route) => {
      const request = route.request();
      if (request.method() === 'POST') return route.fulfill({ json: { name: 'Panel found', title: 'Panel found', spec_path: '.horizon/Panel found.json', thumb: null } });
      if (request.method() === 'PUT') return route.fulfill({ json: {} });
      return route.fulfill({ json: found.length ? [{ name: 'Panel found', title: 'Panel found' }] : [] });
    });
    await trace(page, find);
    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]]) await page.mouse.click(...at(fx, fy));
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await find.getByRole('button', { name: 'Search', exact: true }).click();

    // the best points so far, as it runs: a press tries one in full
    const result = find.getByRole('region', { name: 'The search on show' });
    await expect(result.getByText('Best so far')).toBeVisible({ timeout: 10_000 });
    await result.locator('.fs-place').first().click();
    await expect(result.getByText('Tried here, in full: explains 83%')).toBeVisible();
    await result.getByRole('button', { name: 'Look from here' }).click();
    await expect(find).toHaveCount(0);

    // looked from it, the place is confirmed: the view kept, the search told
    const offer = page.getByRole('group', { name: 'A place from the search' });
    await expect(offer).toContainText('Is it the place?');
    await offer.getByRole('button', { name: 'This is the place' }).click();
    await expect(offer).toContainText('Place confirmed, kept as the view Panel found');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ lat: 46.5586, lon: 7.8353, view: 'Panel found', explained: 0.83 });

    // back in Find, the search stopped with what it had found, the place confirmed first
    await offer.getByRole('button', { name: 'Back to Find' }).click();
    await expect(result.getByText('Place confirmed')).toBeVisible({ timeout: 10_000 });
    await expect(result.getByText('Stopped after 30 of 64 points')).toBeVisible();
  });
});
