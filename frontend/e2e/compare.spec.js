import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

async function openCompare(page, providerB = 'Esri World Imagery') {
  const fixture = await installAppFixture(page);
  const errors = [];
  const saved = [];
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'esri-world-imagery', label: 'Esri World Imagery', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
    { id: 'esri-wayback', label: 'Esri Wayback', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
  ] }));
  await page.route('**/api/satellite/wayback/releases', (route) => route.fulfill({ json: { releases: [{ release: 2, date: '2021-01-01' }, { release: 1, date: '2020-01-01' }] } }));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/cases/*/compare/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      saved.push(route.request().postDataJSON());
      await route.fulfill({ json: { name: 'Comparison', title: 'Comparison' } });
    } else await route.fulfill({ json: [] });
  });
  await page.route('**/compare/sessions/*/preview', (route) => route.fulfill({ json: { path: 'media/Comparison.png' } }));
  await page.goto('/#compare');
  await expect(page.locator('.empty-slot')).toHaveCount(2);
  for (const letter of ['A', 'B']) {
    await page.locator('.empty-slot').filter({ has: page.locator('.slot-letter', { hasText: letter }) }).click();
    await page.locator('.provider-card').filter({ hasText: letter === 'A' ? 'Esri World Imagery' : providerB }).click();
  }
  await awaitMapReady(page, 2);
  return { fixture, errors, saved };
}

test('linked maps keep annotations on the ground through pan, modes and save', async ({ page }) => {
  const { errors, saved } = await openCompare(page);
  const canvas = page.getByLabel('Annotations on imagery A', { exact: true });
  const box = await canvas.boundingBox();
  await page.getByTitle('Arrow (A)', { exact: true }).click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.annotation-canvas .mark')).toHaveCount(2);
  const before = await canvas.locator('path').getAttribute('d');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140, { steps: 8 });
  await page.mouse.up();
  await expect(canvas.locator('path')).not.toHaveAttribute('d', before);
  await expect.poll(async () => {
    const paths = await page.locator('.annotation-canvas .mark path').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')));
    const numbers = paths.map((path) => path.match(/-?\d+(?:\.\d+)?/g).map(Number));
    return Math.max(...numbers[0].map((n, i) => Math.abs(n - numbers[1][i])));
  }).toBeLessThan(1);
  await page.getByRole('button', { name: 'Swipe', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Swipe divider on imagery' })).toBeVisible();
  await page.getByRole('button', { name: 'Fade', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'B opacity' })).toBeVisible();
  await page.getByRole('button', { name: 'Blink', exact: true }).click();
  await page.getByRole('button', { name: 'Slow', exact: true }).click();
  await page.getByRole('button', { name: 'Save comparison', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save comparison', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].spec.version).toBe(2);
  expect(saved[0].spec.blink.interval).toBe(1600);
  expect(saved[0].spec.annotations[0].points[0][0]).toBeCloseTo(2.2945, 2);
  expect(saved[0].spec.annotations[0].points[0][1]).toBeCloseTo(48.8584, 2);
  await expect(page.getByText('Comparison and animated preview saved to My work', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('compare.png') });
  expect(errors).toEqual([]);
});

test('spectral frames are requested only by Run, including after reopening and moving', async ({ page }) => {
  await installAppFixture(page);
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'sentinel2', label: 'Sentinel-2', url: 'https://tiles.invalid/{z}/{x}/{y}.png',
      imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
  ] }));
  await page.route('**/api/satellite/sentinel/**', (route) => route.fulfill({ json:
    route.request().url().includes('/layers') ? { layers: [{ id: 'TRUE_COLOR', title: 'True colour' }] } : { days: [] },
  }));
  const side = (day) => ({ present: true, provider: 'sentinel2', overlays: [],
    sentinel: { layer: 'TRUE_COLOR', date: day, maxcc: 100 } });
  await page.route('**/api/cases/*/compare/sessions', (route) => route.fulfill({ json: [{ name: 'Spectral', title: 'Spectral', mode: 'change' }] }));
  await page.route('**/api/cases/*/compare/sessions/Spectral', (route) => route.fulfill({ json: {
    title: 'Spectral', spec: { version: 2, camera: { lat: 48.8584, lon: 2.2945, zoom: 16, bearing: 35 },
      mode: 'change', change_assist: { method: 'index' }, a: side('2026-08-01'), b: side('2026-09-01') },
  } }));
  await page.route('**/api/compare/sentinel-frame', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const png = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgb(128,4,0)';
      ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL().split(',')[1];
    }, body);
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
  });
  await page.goto('/#compare');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('.session-open').click();
  await awaitMapReady(page, 2);
  // Reopening in Difference mode brings its column with it; nothing to click.
  await expect(page.getByLabel('Difference', { exact: true })).toBeVisible();
  await expect(page.locator('button[aria-label="Reset to north"] + button')).toHaveText('35°');
  await expect(page.getByLabel('Method', { exact: true })).toHaveValue('index');
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Read this view', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeVisible({ timeout: 20000 });
  expect(requests.map((request) => request.day)).toEqual(['2026-08-01', '2026-09-01']);
  const box = await page.locator('.compare-stage').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 130, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.secondary .change-map')).not.toHaveCSS('transform', 'none');
  await expect(page.getByLabel('Difference', { exact: true })).toContainText('Run again to match this view');
  await expect(page.getByRole('button', { name: 'Read this view', exact: true })).toBeEnabled();
  expect(requests).toHaveLength(2);
  // The cloud filter reads Sentinel-2's own classification, so switching it on
  // over a picture method asks for the sky then and there, rather than leaving
  // an unfiltered reading up behind an "on" switch.
  await page.getByLabel('Method', { exact: true }).selectOption('colour');
  await page.getByRole('button', { name: /Clouds & shadows/ }).click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests.slice(2).map((request) => request.product)).toEqual(['sky', 'sky']);
  expect(errors).toEqual([]);
});

test('changes run in the worker and export a composed PNG', async ({ page }) => {
  const { errors } = await openCompare(page, 'Esri Wayback');
  const exports = [];
  await page.route('**/api/cases/*/plates', async (route) => {
    exports.push(route.request().postDataJSON());
    await route.fulfill({ json: { file: 'comparison.png', path: '' } });
  });
  await page.getByRole('button', { name: 'Difference', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel('Difference', { exact: true })).toContainText('highlighted');
  // Highlights that come and go are easier to catch over busy imagery.
  await page.getByRole('button', { name: 'Blink the highlights', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeHidden();
  await expect(page.locator('.secondary .change-map')).toBeVisible();
  await page.getByRole('button', { name: 'Stop blinking the highlights', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeVisible();
  await page.getByLabel('Method', { exact: true }).selectOption('structure');
  await expect(page.getByLabel('Difference', { exact: true })).toContainText('coverage');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export copy', exact: true }).click();
  await expect.poll(() => exports.length).toBe(1);
  expect(Buffer.from(exports[0].png, 'base64').subarray(1, 4).toString()).toBe('PNG');
  expect(errors).toEqual([]);
});

test('analyzer areas run explicitly, and candidates are reviewed one at a time', async ({ page }) => {
  const { errors } = await openCompare(page, 'Esri Wayback');
  const requests = [];
  const sizes = {
    small: { min_area: 300, max_area: 0, cleanup: 0, smoothing: 0, merge_metres: 0 },
    medium: { min_area: 2000, max_area: 0, cleanup: 1, smoothing: 0, merge_metres: 30 },
    large: { min_area: 20000, max_area: 0, cleanup: 1, smoothing: 1, merge_metres: 100 },
  };
  const recipe = { id: 'large-change', name: 'Any surface change', description: 'Reflectance that moved',
    phenomenon: 'Surface change', method: 'surface', zones: [], colour: '#f6a81a', style: 'both',
    parameters: { sensitivity: 67, ...sizes.medium, index: 'ndvi', direction: 'both',
      ignore_clouds: true, ignore_shadows: true, cloud_margin: 5 } };
  await page.route('**/api/compare/analyzers', (route) => route.fulfill({ json: {
    builtins: [recipe], custom: [], max_tiles: 4096, max_results: 2000, grid: [13, 512],
    methods: [{ id: 'surface', label: 'Any reflectance change', single: false, clouds: true, sizes,
      measure: 'Reflectance moved by {value}%' }],
  } }));
  await page.route('**/api/satellite/sentinel/acquisitions', (route) => route.fulfill({ json: {
    dates: [{ date: '2026-05-11', cloud: 2, granules: 1, coverage: 1 },
      { date: '2026-05-04', cloud: 4, granules: 1, coverage: 1 }], truncated: false } }));
  let saved;
  await page.route('**/api/cases/*/analysis/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST' && path.endsWith('/runs')) {
      const input = route.request().postDataJSON(); requests.push(input);
      const [[w, n], [e, s]] = input.zones[0].points;
      const row = { id: '0-1', coordinates: [(w + e) / 2, (n + s) / 2],
        bbox: [Math.min(w, e), Math.min(n, s), Math.max(w, e), Math.max(n, s)],
        area: 90, width: 15, height: 6, margin: 3.4, strength: 'strong', measure: { value: 18.2 },
        phenomenon: 'Surface change', review: 'new', parts: [{ frames: ['a', 'b'], box: [0, 0, 1, 1] }] };
      saved = { id: '123456789abc', title: input.title, input, status: 'ready', progress: 1, total: 1,
        count: 1, results: [row], engine_version: 2, created_at: '2026-09-16T00:00:00Z' };
      await route.fulfill({ json: { ...saved, status: 'queued', results: [], count: 0 } });
    } else if (route.request().method() === 'PATCH' && path.includes('/results/')) {
      saved.results[0].review = route.request().postDataJSON().review;
      await route.fulfill({ json: saved.results[0] });
    } else if (path.endsWith('/runs/123456789abc')) await route.fulfill({ json: saved });
    else if (path.endsWith('/preview')) await route.fulfill({ contentType: 'image/png', body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    else await route.fulfill({ json: path.endsWith('/runs') && saved ? [saved] : [] });
  });
  await page.getByRole('button', { name: 'Detect', exact: true }).click();
  // One column, one place: Difference's settings were in the same slot.
  await expect(page.getByLabel('Detect', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Analyzer', { exact: true })).toHaveValue('large-change');
  await expect(page.getByRole('button', { name: /^Run on/ })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const canvas = page.getByLabel('Annotations on imagery A', { exact: true });
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 80, box.y + 100);
  await page.mouse.down(); await page.mouse.move(box.x + 190, box.y + 190, { steps: 6 }); await page.mouse.up();
  await expect(page.getByLabel('Area name', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Detect', { exact: true })).toContainText('1 tile');
  // Wayback on the maps is nothing Detect can read, so it asks for Sentinel-2 dates.
  await expect(page.getByLabel('Detect', { exact: true })).toContainText('Detect reads Sentinel-2');
  await page.getByRole('button', { name: 'Change dates or the rule…' }).click();
  await page.getByRole('button', { name: 'Find passes', exact: true }).click();
  await page.getByLabel('Use 2026-05-04').getByRole('button', { name: 'A', exact: true }).click();
  await page.getByLabel('Use 2026-05-11').getByRole('button', { name: 'B', exact: true }).click();
  await page.getByLabel('Analysis name', { exact: true }).fill('Harbour sweep');
  await page.getByRole('group', { name: 'Target size' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('analyzers-setup.png') });
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Run on 1 area', exact: true }).click();
  await expect(page.getByText('Strong · Reflectance moved by 18.2%', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].zones).toHaveLength(1);
  const pins = page.locator('.analysis-overlay [role="button"]');
  await expect(pins).toHaveCount(2);              // the same candidate on both maps
  await page.getByRole('button', { name: 'Toggle Harbour sweep', exact: true }).click();
  await expect(pins).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle Harbour sweep', exact: true }).click();
  await expect(pins).toHaveCount(2);
  await page.mouse.move(box.x + 80, box.y + 250); await page.mouse.wheel(0, -300);
  await expect(pins).toHaveCount(2);
  expect(requests).toHaveLength(1);
  // Dismissing is a verdict on one candidate, and it takes it off the map.
  await expect(page.getByText('1 still to review · 0 kept, 0 dismissed')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByText('All 1 reviewed · 0 kept, 1 dismissed')).toBeVisible();
  await expect(pins).toHaveCount(0);
  // Detect's own drawing belongs to Detect; the reading modes stay clean.
  await page.getByRole('button', { name: 'Side by side', exact: true }).click();
  await expect(page.getByLabel('Detect', { exact: true })).toHaveCount(0);
  await expect(page.locator('.analysis-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Detect', exact: true }).click();
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.locator('.cmp-dock .link').filter({ hasText: 'Harbour sweep' }).first().click();
  await expect(page.getByText('Strong · Reflectance moved by 18.2%', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].a).toMatchObject({ provider: 'sentinel2', date: '2026-05-04' });
  expect(requests[0].b).toMatchObject({ provider: 'sentinel2', date: '2026-05-11' });
  await page.screenshot({ path: test.info().outputPath('analyzers.png') });
  expect(errors).toEqual([]);
});
