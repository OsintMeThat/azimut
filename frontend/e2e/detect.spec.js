import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

const recipe = { id: 'change', name: 'Surface change', method: 'surface', phenomenon: 'Surface change',
  colour: '#f6a81a', style: 'both', parameters: { sensitivity: 60, min_area: 0, max_area: 0,
    cleanup: 0, smoothing: 0, merge_metres: 0, index: 'ndvi', direction: 'both' } };
const area = { id: 'aaaaaaaaaaaa', name: 'North site', colour: '#38bdf8',
  geometry: { type: 'Polygon', coordinates: [[[2.29, 48.855], [2.3, 48.855], [2.3, 48.862], [2.29, 48.862], [2.29, 48.855]]] } };
const zone = { id: area.id, name: area.name, kind: 'polygon', points: area.geometry.coordinates[0].slice(0, -1) };
const source = (date) => ({ provider: 'sentinel2', date, layer: 'TRUE_COLOR', maxcc: 30 });

async function openDetect(page, withRun = false) {
  await installAppFixture(page);
  const errors = [], calls = [], prefs = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const a = source('2026-09-01'), b = source('2026-09-10');
  const candidate = { id: 'candidate-1', origin: 'detector', area_id: area.id, area_name: area.name,
    phenomenon: 'Surface change', coordinates: [2.2945, 48.8584], geometry: area.geometry,
    bbox: [2.29, 48.855, 2.3, 48.862], review: 'new', strength: 'clear', measure: {},
    sources: { a, b }, area: 300, width: 20, height: 15 };
  const run = { id: 'bbbbbbbbbbbb', title: 'North site pass', status: 'ready', progress: 1, total: 1,
    count: 3, created_at: '2026-09-10T12:00:00Z', results: [candidate,
      { ...candidate, id: 'candidate-2', phenomenon: 'A longer candidate name wrapping across several lines in the review panel', width: 12345 },
      { ...candidate, id: 'candidate-3', phenomenon: 'Third candidate' }],
    input: { title: 'North site pass', recipe, zones: [zone], a, b },
    area_runs: [{ area_id: area.id, name: area.name, a, b, status: 'ready' }] };
  await page.route('**/api/compare/analyzers', (route) => route.fulfill({ json: {
    builtins: [recipe, { ...recipe, id: 'boats', name: 'Vessels', method: 'vessels' }], custom: [],
    methods: [{ id: 'surface', single: false, sizes: {} }, { id: 'vessels', single: true, sizes: {} }],
    grid: [13, 512], max_tiles: 4096, max_results: 2000,
  } }));
  await page.route('**/api/settings/prefs', (route) => {
    prefs.push(route.request().postDataJSON()); return route.fulfill({ json: {} });
  });
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'esri-world-imagery', label: 'Esri World Imagery', url: 'https://tiles.invalid/{z}/{x}/{y}.png',
      imagery: true, max_zoom: 19, tile_size: 256, attribution: 'Browser fixture' },
    { id: 'sentinel2', label: 'Copernicus Sentinel-2', url: 'https://tiles.invalid/{z}/{x}/{y}.png',
      imagery: true, max_zoom: 19, tile_size: 256, attribution: 'Copernicus Sentinel data' },
  ] }));
  await page.route('**/api/satellite/sentinel/**', (route) => {
    calls.push(route.request().url()); return route.fulfill({ json: { dates: [] } });
  });
  await page.route('**/api/cases/*/analysis/**', async (route) => {
    const suffix = route.request().url().split('/analysis/')[1];
    const method = route.request().method();
    if (suffix.endsWith('/preview')) return route.fulfill({ contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${suffix.includes('candidate-2') ? 80 : 600}" height="160"><rect width="100%" height="100%" fill="#30352b"/></svg>` });
    if (method === 'PATCH') {
      const found = run.results.find((row) => suffix.endsWith('/' + row.id));
      Object.assign(found, route.request().postDataJSON());
      if (found.review === 'dismissed') run.results = run.results.filter((row) => row.id !== found.id);
      return route.fulfill({ json: found });
    }
    if (suffix === `runs/${run.id}/results` && method === 'POST') {
      const body = route.request().postDataJSON();
      const manual = { ...candidate, id: 'manual-1', origin: 'manual', geometry: body.geometry };
      run.results.push(manual); run.count++;
      return route.fulfill({ json: manual });
    }
    if (method === 'GET') {
      const data = suffix === 'areas' ? [area] : suffix === 'runs' ? (withRun ? [run] : [])
        : suffix === `runs/${run.id}` ? run : [];
      return route.fulfill({ json: data });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/#detect');
  await awaitMapReady(page);
  return { errors, calls, prefs };
}

test('landing, dock rail and the When step fit the existing map workspace', async ({ page }) => {
  const { errors, calls, prefs } = await openDetect(page);
  await expect(page.getByRole('button', { name: 'Imagery provider', exact: true })).toContainText('Esri World Imagery');
  await expect(page.locator('.detect-tool > header')).toHaveCount(0);
  const map = page.locator('.detect-tool .map');
  const before = await map.boundingBox();
  await page.getByRole('button', { name: 'Collapse Detect panel', exact: true }).click();
  await expect(page.locator('.dock-tabs.rail')).toBeVisible();
  await expect.poll(async () => (await map.boundingBox()).width).toBeGreaterThan(before.width + 200);
  await expect.poll(() => prefs.some((p) => p.detect_view?.collapsed)).toBe(true);
  await page.getByRole('button', { name: 'Areas', exact: true }).click();
  await expect(page.getByRole('button', { name: /^North site/ })).toBeVisible();
  await page.getByRole('button', { name: 'Edit North site', exact: true }).click();
  await expect(page.getByLabel('Rename North site')).toBeVisible();
  await page.keyboard.press(']');
  await expect(page.locator('.dock-tabs.rail')).toBeVisible();
  await page.keyboard.press(']');
  await page.getByRole('button', { name: 'New detection', exact: true }).click();
  await page.getByRole('button', { name: 'New one pass', exact: true }).click();
  await page.getByRole('button', { name: 'North site', exact: true }).click();
  await page.getByRole('button', { name: 'Next: What' }).click();
  await page.getByRole('button', { name: 'Next: When' }).click();
  // A and B are asked in the step itself, B the newest pass until a day is chosen
  await expect(page.getByRole('heading', { name: 'Which two images' })).toBeVisible();
  await expect(page.getByLabel('Day of A')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Newest pass' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'A day I choose' }).click();
  await expect(page.getByLabel('Day of B')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find passes', exact: true })).toBeVisible();
  expect((await map.boundingBox()).height).toBe(before.height);
  expect(calls).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('detect-dates.png') });
  expect(errors).toEqual([]);
});

test('review adds a manual point and uses the standard pin dialog', async ({ page }) => {
  const { errors } = await openDetect(page, true);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.getByRole('button', { name: /^North site pass/ }).click();
  const keep = page.getByRole('button', { name: 'Keep', exact: true });
  const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
  const actionBox = await keep.boundingBox();
  const previewBox = await page.locator('.candidate .preview').boundingBox();
  await keep.click();
  await expect(page.locator('.candidate > strong')).toContainText('A longer candidate name');
  expect(await keep.boundingBox()).toEqual(actionBox);
  // Firefox reports this box a ten-thousandth of a pixel off its own earlier reading.
  expect((await page.locator('.candidate .preview').boundingBox()).height).toBeCloseTo(previewBox.height, 2);
  await dismiss.click();
  await expect(page.locator('.candidate > strong')).toContainText('Third candidate');
  expect(await keep.boundingBox()).toEqual(actionBox);
  await page.locator('.review-body').evaluate((node) => { node.scrollTop = node.scrollHeight; });
  expect(await keep.boundingBox()).toEqual(actionBox);
  await page.screenshot({ path: test.info().outputPath('detect-review.png') });
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  const pin = page.getByRole('dialog', { name: 'Pin candidate' });
  await expect(pin.getByLabel('After image only')).not.toBeChecked();
  await expect(pin.getByLabel('Area', { exact: true })).toBeChecked();
  await pin.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add candidate', exact: true }).click();
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.locator('.detect-tool .map').click({ position: { x: 300, y: 300 } });
  await expect(page.locator('.candidate > strong')).toContainText('Manual');
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(pin.getByLabel('Point', { exact: true })).toBeChecked();
  await expect(pin.getByLabel('Area', { exact: true })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('detect-pin.png') });
  await pin.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Routines', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Imagery provider', exact: true })).toContainText('Esri World Imagery');
  expect(errors).toEqual([]);
});
