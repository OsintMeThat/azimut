import { test, expect } from '@playwright/test';
import { awaitMapReady, fakeGoogleMaps, installAppFixture, mapPicture } from './app.fixture.js';

/**
 * The one basemap that is not our tiles.
 *
 * Google's terms forbid taking those pixels out of its own map, so its map is
 * put *under* ours and the two cameras are kept in step (`lib/map/gmaps.js`).
 * The whole path is driven here against a stand-in Maps API — no key, no
 * network, no billed map load — because the parts that can go wrong are ours:
 * whether it shows through at all, whether it follows, whether it is credited,
 * and whether it is ever built twice.
 */

/**
 * Pick a basemap from the surface's own chip.
 *
 * It is a chip and a list rather than a `<select>`: the provider belongs to the
 * surface, not to the tool, and two compared surfaces each carry their own.
 */
async function pickProvider(page, label) {
  await page.getByRole('button', { name: 'Imagery provider' }).click();
  await page.getByRole('option', { name: label }).click();
}

async function openWidget(page) {
  await fakeGoogleMaps(page);
  const fixture = await installAppFixture(page, { widget: true });
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await pickProvider(page, 'Google Satellite (Maps JS)');
  await expect(page.locator('.map-glass')).toBeAttached();
  return fixture;
}

const maps = (page) => page.evaluate(() => window.__googleMaps.length);
const camera = (page) => page.evaluate(() => window.__googleMaps[0].cameras.at(-1));

test('shows through our own canvas rather than under it', async ({ page }) => {
  // The engine's canvas is transparent where nothing is drawn. If our map's own
  // background ever paints over the layer instead, the basemap is simply blank
  // and nothing else in the tool says so.
  await openWidget(page);
  const shot = await mapPicture(page);
  const magenta = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] > 200 && data[at + 1] < 60 && data[at + 2] > 200) lit += 1;
    }
    return lit;
  }, [...shot]);
  expect(magenta).toBeGreaterThan(10_000);
});

test('follows our camera, and covers the view at every bearing', async ({ page }) => {
  await openWidget(page);
  const opened = await camera(page);
  expect(opened.zoom).toBe(16); // the app's zoom, not the engine's

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(16.9);

  // a rotated rectangle fits inside the circle of its own diagonal, so the
  // element is a square of that diagonal — otherwise a turn eats the corners
  const turn = page.locator('.map-glass-turn');
  const side = await page.evaluate(() => {
    const el = document.querySelector('.map');
    return Math.ceil(Math.hypot(el.clientWidth, el.clientHeight));
  });
  await expect(turn).toHaveCSS('width', `${side}px`);
  await expect(turn).toHaveCSS('height', `${side}px`);

  await page.getByRole('button', { name: /^0°$/ }).click();
  await page.getByLabel('Set bearing in degrees').fill('90');
  await page.getByLabel('Set bearing in degrees').press('Enter');
  await expect(page.getByRole('button', { name: /90°/ })).toBeVisible();
  // turned the same way the map turned: clockwise
  await expect(turn).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
});

test('never takes the pointer, so every gesture is still ours', async ({ page }) => {
  await openWidget(page);
  await expect(page.locator('.map-glass')).toHaveCSS('pointer-events', 'none');
  // …except the credit, whose terms link has to stay reachable
  await expect(page.locator('.map-glass-credit')).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator('.map-glass-credit')).toContainText('Map data © Google');
  await expect(page.locator('.map-glass-credit a')).toHaveAttribute('href', /terms_maps/);
});

test('keeps Google’s credit and logo in plain sight, their links within reach', async ({ page }) => {
  await openWidget(page);
  await page.evaluate(() => {
    const map = window.__googleMaps[0];
    const logo = document.createElement('a');
    logo.href = 'https://maps.google.com/maps?ll=48.85,2.35&z=16';
    logo.innerHTML = '<div style="width: 66px; height: 26px"></div>';
    map.node.append(logo);
  });
  await expect(page.locator('.map-glass-logo a')).toBeVisible();

  // nothing lies over either of them: not the canvas, not the map's attribution
  const topmost = (selector) => page.evaluate((wanted) => {
    const box = document.querySelector(wanted).getBoundingClientRect();
    return Boolean(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(wanted));
  }, selector);
  expect(await topmost('.map-glass-credit a')).toBe(true);
  expect(await topmost('.map-glass-logo a')).toBe(true);

  const logo = await page.locator('.map-glass-logo').boundingBox();
  expect(logo.height).toBeCloseTo(26 * 0.8, 0); // a mark at the floor of Google's 16 to 19 px
  const scale = await page.locator('.maplibregl-ctrl-scale').boundingBox();
  expect(logo.x).toBeGreaterThanOrEqual(scale.x + scale.width);
});

/** Google's marks as its real map adds them: a credit too long for a narrow view, and the logo. */
async function googleMarks(page, at = 0) {
  await page.evaluate((index) => {
    const map = window.__googleMaps[index];
    const line = document.createElement('div');
    line.className = 'gm-style-cc';
    line.innerHTML = '<div>Imagery ©2026 Airbus, CNES / Airbus, Landsat / Copernicus, Maxar Technologies</div>';
    const logo = document.createElement('a');
    logo.href = 'https://maps.google.com/maps?ll=48.85,2.35&z=16';
    logo.innerHTML = '<div style="width: 66px; height: 26px"></div>';
    map.node.append(line, logo);
  }, at);
}

const onTop = (page, selector) => page.evaluate((wanted) => {
  const box = document.querySelector(wanted).getBoundingClientRect();
  return [0.1, 0.5, 0.9].every((share) =>
    document.elementFromPoint(box.x + box.width * share, box.y + box.height / 2)?.closest(wanted)
  );
}, selector);

test('a narrow map keeps the credit, the logo and the capture bar clear of each other', async ({ page }) => {
  await openWidget(page);
  await googleMarks(page);
  await expect(page.locator('.map-glass-logo a')).toBeVisible();
  for (const width of [1100, 900, 800]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(async () => {
      const credit = await page.locator('.map-glass-credit').boundingBox();
      const bar = await page.locator('.status .acts').boundingBox();
      return bar.y + bar.height <= credit.y;
    }).toBe(true);
    expect(await onTop(page, '.map-glass-credit'), `credit at ${width}`).toBe(true);
    expect(await onTop(page, '.map-glass-logo'), `logo at ${width}`).toBe(true);
  }
});

async function compareWidget(page, a, b) {
  await fakeGoogleMaps(page);
  await installAppFixture(page, { widget: true });
  await page.route('**/api/satellite/wayback/releases', (route) => route.fulfill({ json: { releases: [] } }));
  await page.route('**/api/cases/*/compare/sessions', (route) => route.fulfill({ json: [] }));
  await page.goto('/#compare');
  await expect(page.locator('.empty-slot')).toHaveCount(2);
  for (const [letter, label] of [['A', a], ['B', b]]) {
    await page.locator('.empty-slot').filter({ has: page.locator('.slot-letter', { hasText: letter }) }).click();
    await page.locator('.provider-card').filter({ hasText: label }).click();
  }
  await awaitMapReady(page, 2);
  await expect(page.locator('.map-glass')).toBeAttached();
  await googleMarks(page);
  await expect(page.locator('.map-glass-logo a')).toBeVisible();
  await page.getByRole('button', { name: 'Swipe', exact: true }).click();
  const box = await page.locator('.swipe-line').boundingBox();
  return box.x + box.width / 2;
}

const GOOGLE = 'Google Satellite (Maps JS)';

test('a swipe leaves Google on the left with its credit, left of the line', async ({ page }) => {
  const line = await compareWidget(page, GOOGLE, 'Esri World Imagery');
  await expect.poll(async () => {
    const credit = await page.locator('.map-glass-credit').boundingBox();
    return credit.x + credit.width <= line;
  }).toBe(true);
  expect(await onTop(page, '.map-glass-credit')).toBe(true);
  expect(await onTop(page, '.map-glass-logo')).toBe(true);
});

test('a swipe leaves Google on the right with its logo, right of the line', async ({ page }) => {
  const line = await compareWidget(page, 'Esri World Imagery', GOOGLE);
  await expect.poll(async () => (await page.locator('.map-glass-logo').boundingBox()).x >= line).toBe(true);
  expect(await onTop(page, '.map-glass-credit')).toBe(true);
  expect(await onTop(page, '.map-glass-logo')).toBe(true);
});

test('Detect counts a map load and hears a refusal, as any tool offering Google does', async ({ page }) => {
  await fakeGoogleMaps(page);
  const fixture = await installAppFixture(page, { widget: true });
  const verdicts = [];
  await page.route('**/api/settings/keys/google_js/status', (route) => {
    verdicts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: false } });
  });
  await page.route('**/api/compare/analyzers', (route) => route.fulfill({ json: {
    builtins: [], custom: [], methods: [], grid: [13, 512], max_tiles: 4096, max_results: 2000,
  } }));
  await page.route('**/api/cases/*/analysis/**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#detect');
  await awaitMapReady(page);
  await pickProvider(page, GOOGLE);
  await expect(page.locator('.map-glass')).toBeAttached();
  await expect.poll(() => fixture.widgetLoads).toEqual(['google_js']);

  await page.evaluate(() => window.gm_authFailure());
  await expect(page.locator('.toast')).toContainText('Google basemap turned off');
  await expect(page.locator('.map-glass')).toHaveAttribute('hidden', '');
  expect(verdicts).toEqual([expect.objectContaining({ ok: false })]);
});

test('is built once and counted once, however often it is shown', async ({ page }) => {
  // every google.maps.Map instantiation is a billed dynamic map load
  const fixture = await openWidget(page);
  expect(await maps(page)).toBe(1);
  await expect.poll(() => fixture.widgetLoads).toEqual(['google_js']);

  await pickProvider(page, 'Esri World Imagery');
  await expect(page.locator('.map-glass')).toHaveAttribute('hidden', '');
  await pickProvider(page, 'Google Satellite (Maps JS)');
  await expect(page.locator('.map-glass')).not.toHaveAttribute('hidden', '');

  expect(await maps(page)).toBe(1);
  expect(fixture.widgetLoads).toEqual(['google_js']);
});

test('leaves nothing of our own tiles between the analyst and the imagery', async ({ page }) => {
  await openWidget(page);
  const asked = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/tiles/')) asked.push(request.url());
  });
  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(asked).toEqual([]);
});
