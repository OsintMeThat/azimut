import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture, restingCamera } from './app.fixture.js';

const recipe = { id: 'change', name: 'Surface change', method: 'surface', phenomenon: 'Surface change',
  colour: '#f6a81a', style: 'both', parameters: { sensitivity: 60, min_area: 0, max_area: 0,
    cleanup: 0, smoothing: 0, merge_metres: 0, index: 'ndvi', direction: 'both' } };
const area = { id: 'aaaaaaaaaaaa', name: 'North site', colour: '#38bdf8',
  geometry: { type: 'Polygon', coordinates: [[[2.29, 48.855], [2.3, 48.855], [2.3, 48.862], [2.29, 48.862], [2.29, 48.855]]] } };
const secondArea = { ...area, id: 'eeeeeeeeeeee', name: 'Second site', colour: '#22d3ee' };
const zone = { id: area.id, name: area.name, kind: 'polygon', points: area.geometry.coordinates[0].slice(0, -1) };
const source = (date) => ({ provider: 'sentinel2', date, layer: 'TRUE_COLOR', maxcc: 30 });
const size = (min_area, max_area, cleanup, smoothing, merge_metres) => ({ min_area, max_area, cleanup, smoothing, merge_metres });
const SIZES = { small: size(300, 0, 0, 0, 0), medium: size(2000, 0, 1, 0, 30), large: size(20000, 0, 1, 1, 100),
  all: size(0, 0, 0, 0, 0) };

async function openDetect(page, withRun = false, withRoutine = false, twoRuns = false, twoAreas = false) {
  await installAppFixture(page);
  const errors = [], calls = [], prefs = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const a = source('2026-09-01'), b = source('2026-09-10');
  const candidate = { id: 'candidate-1', origin: 'detector', area_id: area.id, area_name: area.name,
    phenomenon: 'Surface change', coordinates: [2.2945, 48.8584], geometry: area.geometry,
    bbox: [2.29, 48.855, 2.3, 48.862], review: 'new', strength: 'clear', measure: {},
    sources: { a, b }, area: 300 };
  const run = { id: 'bbbbbbbbbbbb', title: 'North site pass', status: 'ready', progress: 1, total: 1,
    colour: recipe.colour,
    count: 3, created_at: '2026-09-10T12:00:00Z', results: [candidate,
      { ...candidate, id: 'candidate-2', phenomenon: 'A longer candidate name wrapping across several lines in the review panel' },
      { ...candidate, id: 'candidate-3', phenomenon: 'Third candidate' }],
    input: { title: 'North site pass', recipe, zones: [zone], a, b },
    area_runs: [{ area_id: area.id, name: area.name, a, b, status: 'ready' }] };
  const secondRun = { ...run, id: 'cccccccccccc', title: 'Second site pass', colour: '#22d3ee',
    input: { ...run.input, title: 'Second site pass', recipe: { ...recipe, colour: '#22d3ee' } },
    results: [{ ...candidate, id: 'second-candidate' }] };
  const routine = { ...run.input, id: 'dddddddddddd', title: 'North site routine',
    date_rule: 'latest_previous' };
  if (withRoutine) { run.input.followup_id = routine.id; run.followup_id = routine.id; }
  await page.route('**/api/compare/analyzers', (route) => route.fulfill({ json: {
    builtins: [recipe, { ...recipe, id: 'boats', name: 'Vessels', method: 'vessels' }], custom: [],
    methods: [{ id: 'surface', single: false, sizes: SIZES }, { id: 'vessels', single: true, sizes: {} }],
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
    if (withRoutine && suffix === `followups/${routine.id}/colour` && method === 'PATCH') {
      routine.recipe = { ...routine.recipe, ...route.request().postDataJSON() };
      return route.fulfill({ json: routine });
    }
    if (suffix === `runs/${run.id}/colour` && method === 'PATCH') {
      run.display_colour = route.request().postDataJSON().colour;
      run.colour = run.display_colour;
      return route.fulfill({ json: run });
    }
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
      const data = suffix === 'areas' ? (twoAreas ? [area, secondArea] : [area])
        : suffix === 'runs' ? (withRun ? twoRuns ? [run, secondRun] : [run] : [])
        : suffix === 'followups' ? (withRoutine ? [{ id: routine.id, title: routine.title,
          colour: routine.recipe.colour, method: 'surface', areas: 1, zones: [zone],
          date_rule: routine.date_rule }] : [])
        : suffix === `followups/${routine.id}` ? routine
        : suffix === `runs/${run.id}` ? run : suffix === `runs/${secondRun.id}` ? secondRun : [];
      return route.fulfill({ json: data });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/#detect');
  await awaitMapReady(page);
  return { errors, calls, prefs };
}

async function typeWhenDay(page, button, field, value) {
  await page.getByRole('button', { name: button, exact: true }).click();
  const details = page.locator('.manual-date');
  if (!await details.evaluate((node) => node.open)) await details.locator('summary').click();
  await page.getByLabel(field).fill(value);
}

test('the Saved colour square recolours the routine and its map overlay', async ({ page }) => {
  const { errors } = await openDetect(page, true, true);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  const colour = page.getByLabel('Colour of North site routine');
  await expect(colour).toHaveValue('#f6a81a');
  await colour.fill('#eab308');
  await expect(colour).toHaveValue('#eab308');
  await expect(page.locator('.analysis-overlay > path').first()).toHaveAttribute('stroke', '#eab308');
  await expect(page.locator('.fold[aria-expanded="true"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a one pass has a compact colour square that recolours its saved overlay', async ({ page }) => {
  const { errors } = await openDetect(page, true);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  const colour = page.getByLabel('Colour of North site pass');
  const swatch = page.locator('.single .colour-control .swatch');
  expect(Math.round((await swatch.boundingBox()).width)).toBe(8);
  expect(Math.round((await swatch.boundingBox()).height)).toBe(8);
  await page.screenshot({ path: test.info().outputPath('detect-saved-colour.png') });
  await colour.fill('#eab308');
  await expect(colour).toHaveValue('#eab308');
  await expect(page.locator('.analysis-overlay > path').first()).toHaveAttribute('stroke', '#eab308');
  expect(errors).toEqual([]);
});

test('review isolates one result layer and restores the saved eye states on Back', async ({ page }) => {
  const { errors } = await openDetect(page, true, false, true);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  const orange = page.locator('.analysis-overlay > path[stroke="#f6a81a"]');
  const cyan = page.locator('.analysis-overlay > path[stroke="#22d3ee"]');
  await expect(orange.first()).toBeVisible();
  await expect(cyan.first()).toBeVisible();
  await page.getByRole('button', { name: 'Hide Second site pass on the map' }).click();
  await expect(cyan).toHaveCount(0);
  await page.locator('.single .past').filter({ hasText: 'Second site pass' }).click();
  await expect(cyan.first()).toBeVisible();
  await expect(orange).toHaveCount(0);
  await page.locator('.dock-content > header button[aria-label="Back"]').click();
  await expect(orange.first()).toBeVisible();
  await expect(cyan).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show Second site pass on the map' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('clicking a Detect date opens a calendar of passes and previews the chosen day', async ({ page }) => {
  const { errors } = await openDetect(page);
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const day = `${month}-15`;
  const requests = [];
  await page.route('**/api/satellite/sentinel/acquisitions', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: {
    dates: [{ date: day, cloud: 8, coverage: 1 }], truncated: false,
    } });
  });
  await page.getByRole('button', { name: 'New detection', exact: true }).click();
  await page.getByRole('button', { name: 'New one pass', exact: true }).click();
  await page.getByRole('button', { name: 'North site', exact: true }).click();
  await page.getByRole('button', { name: 'Next: What' }).click();
  await page.getByRole('button', { name: 'Next: When' }).click();
  await page.getByRole('button', { name: 'Date A', exact: true }).click();
  const calendar = page.getByRole('group', { name: 'A pass calendar' });
  await expect(calendar).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0].end <= new Date().toISOString().slice(0, 10)).toBe(true);
  await calendar.getByRole('button', { name: 'Previous month' }).click();
  await expect(calendar.getByRole('button', { name: `${month}-14: no pass` })).toBeDisabled();
  await calendar.getByRole('button', { name: `${day}: 8% cloud` }).click();
  await expect(page.getByRole('button', { name: 'Date A', exact: true })).toContainText(day);
  await expect(page.getByRole('button', { name: 'Leave pass imagery' })).toContainText('North site · A');
  await page.getByRole('button', { name: 'Date B', exact: true }).click();
  const bCalendar = page.getByRole('group', { name: 'B pass calendar' });
  await bCalendar.getByRole('button', { name: 'Previous month' }).click();
  await expect(bCalendar.getByRole('button', { name: `${day}: outside date order` })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('each area opens its own A and B calendars with its pass list below', async ({ page }) => {
  const { errors } = await openDetect(page, false, false, false, true);
  await page.getByRole('button', { name: 'New detection', exact: true }).click();
  await page.getByRole('button', { name: 'New one pass', exact: true }).click();
  await page.getByRole('button', { name: 'North site', exact: true }).click();
  await page.getByRole('button', { name: 'Second site', exact: true }).click();
  await page.getByRole('button', { name: 'Next: What' }).click();
  await page.getByRole('button', { name: 'Next: When' }).click();
  const first = page.getByRole('region', { name: 'Dates for North site' });
  const second = page.getByRole('region', { name: 'Dates for Second site' });
  await second.getByRole('button', { name: 'Date A for Second site' }).click();
  const calendar = second.getByRole('group', { name: 'Reference for Second site pass calendar' });
  await expect(calendar).toBeVisible();
  const month = await calendar.boundingBox();
  const footer = await page.locator('.cmp-dock-foot').boundingBox();
  expect(month.y + month.height).toBeLessThanOrEqual(footer.y + 1);
  await expect(first.locator('.pass-calendar')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('detect-area-calendar.png') });
  await second.getByRole('button', { name: 'Find passes for Second site' }).click();
  await expect(second.locator('.passes')).toBeVisible();
  await expect(first.locator('.passes')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dates…' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('detect-area-calendars.png') });
  expect(errors).toEqual([]);
});

test('landing, dock rail and the When step fit the existing map workspace', async ({ page }) => {
  const { errors, calls, prefs } = await openDetect(page);
  await expect(page.getByRole('button', { name: 'Imagery provider', exact: true })).toContainText('Esri World Imagery');
  await expect(page.locator('.detect-tool > header')).toHaveCount(0);
  // The ruler is stacked on the left between the search and the zoom buttons.
  const [search, ruler, zoom] = await Promise.all([page.locator('.detect-tool .search'),
    page.getByRole('button', { name: 'Measure', exact: true }), page.getByRole('button', { name: 'Zoom in' })]
    .map((element) => element.boundingBox()));
  expect(search.y + search.height).toBeLessThan(ruler.y);
  expect(ruler.y + ruler.height).toBeLessThan(zoom.y);
  expect(Math.abs(ruler.x - zoom.x)).toBeLessThan(8);
  // The closed Layers chip is as tall as the imagery chip over it.
  const [chip, picker] = await Promise.all(['.detect-tool .map-choices > :first-child', '.detect-tool .layer-picker']
    .map((selector) => page.locator(selector).boundingBox()));
  expect(Math.abs(picker.height - chip.height)).toBeLessThanOrEqual(1);
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
  await expect(page.getByRole('button', { name: 'Date A', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Date B', exact: true })).toContainText('Newest pass');
  await page.getByRole('button', { name: 'Date B', exact: true }).click();
  await expect(page.getByRole('group', { name: 'B pass calendar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find passes', exact: true })).toBeVisible();
  expect((await map.boundingBox()).height).toBe(before.height);
  expect(calls.every((url) => url.includes('/api/satellite/sentinel/acquisitions'))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('detect-dates.png') });
  expect(errors).toEqual([]);
});

test('Detect menus fit the dock at its minimum and maximum widths', async ({ page }) => {
  const { errors, prefs } = await openDetect(page, true);
  const dock = page.locator('.detect-tool .cmp-dock');
  const map = page.locator('.detect-tool .map');
  const handle = page.getByRole('button', { name: 'Resize Detect panel' });
  for (const [key, width] of [['Home', 300], ['End', 720]]) {
    await handle.focus();
    await page.keyboard.press(key);
    await expect.poll(async () => Math.round((await dock.boundingBox()).width)).toBe(width);
    expect((await map.boundingBox()).width).toBeGreaterThanOrEqual(320);
    for (const tab of ['Routines', 'Saved', 'Areas']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await expect.poll(() => dock.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(2);
    }
    await page.getByRole('button', { name: 'Saved', exact: true }).click();
    await page.getByRole('button', { name: /^North site pass/ }).click();
    await expect.poll(() => dock.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(2);
    await dock.locator('.dock-content > header button[aria-label="Back"]').click();
    await page.getByRole('button', { name: 'Analyzers', exact: true }).click();
    await expect(dock.locator('.dock-content > header strong')).toHaveText('Analyzers');
    await expect.poll(() => dock.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(2);
    await dock.locator('.dock-content > header button[aria-label="Back"]').click();
    await page.getByRole('button', { name: 'New detection', exact: true }).click();
    const menu = dock.getByRole('group', { name: 'New detection' });
    await expect(menu.getByRole('button', { name: 'New one pass' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'New routine' })).toBeVisible();
    const [dockBox, menuBox] = await Promise.all([dock.boundingBox(), menu.boundingBox()]);
    expect(menuBox.x).toBeGreaterThanOrEqual(dockBox.x);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(dockBox.x + dockBox.width);
    await page.screenshot({ path: test.info().outputPath(`detect-menu-${width}.png`) });
    await page.getByRole('button', { name: 'New one pass', exact: true }).click();
    await page.getByRole('button', { name: 'North site', exact: true }).click();
    for (const next of ['Next: What', 'Next: When']) {
      await expect.poll(() => dock.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(2);
      await page.getByRole('button', { name: next }).click();
    }
    await expect.poll(() => dock.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Date A', exact: true }).click();
    await expect(page.getByRole('group', { name: 'A pass calendar' })).toBeVisible();
    await expect.poll(() => dock.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Close calendar' }).click();
    await dock.locator('.dock-content > header button[aria-label="Back"]').click();
  }
  await expect.poll(() => prefs.some((value) => value.detect_view?.width === 720)).toBe(true);
  expect(errors).toEqual([]);
});

test('the size is asked before the analyzers, and a pair months apart warns about shadows', async ({ page }) => {
  const { errors, calls } = await openDetect(page);
  await page.getByRole('button', { name: 'New detection', exact: true }).click();
  await page.getByRole('button', { name: 'New one pass', exact: true }).click();
  await page.getByRole('button', { name: 'North site', exact: true }).click();
  await page.getByRole('button', { name: 'Next: What' }).click();
  const step = page.getByRole('region', { name: 'What to look for' });
  const sizes = step.getByRole('group', { name: 'Target size' });
  await expect(sizes).toHaveCount(1);
  await expect(sizes.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const [above, list] = [await sizes.boundingBox(), await step.getByRole('radiogroup', { name: 'Analyzer' }).boundingBox()];
  expect(above.y + above.height).toBeLessThanOrEqual(list.y);
  const cloud = step.getByLabel('Maximum cloud cover');
  const cloudBox = await cloud.boundingBox();
  expect(cloudBox.y).toBeGreaterThanOrEqual(above.y + above.height);
  expect(cloudBox.y + cloudBox.height).toBeLessThanOrEqual(list.y);
  await page.screenshot({ path: test.info().outputPath('detect-what.png') });
  await page.getByRole('button', { name: 'Next: When' }).click();
  await typeWhenDay(page, 'Date A', 'Day of A', '21/01/2026');
  await expect(page.getByRole('note')).toHaveCount(0);
  await typeWhenDay(page, 'Date B', 'Day of B', '25/09/2026');
  await expect(page.getByRole('note')).toContainText('most buildings will read as changed');
  await page.screenshot({ path: test.info().outputPath('detect-shadows.png') });
  await typeWhenDay(page, 'Date B', 'Day of B', '02/02/2026');
  await expect(page.getByRole('note')).toHaveCount(0);
  await typeWhenDay(page, 'Date B', 'Day of B', '20/01/2026');
  await expect(page.locator('.step .warn[role="alert"]')).toContainText('Date A must be before date B.');
  await expect(page.getByRole('button', { name: 'Next: Start' })).toBeDisabled();
  expect(calls.every((url) => url.includes('/api/satellite/sentinel/acquisitions'))).toBe(true);
  expect(calls.length).toBeGreaterThan(0);
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

test('an analyzer of your own is built over the map: its rules painted, a point read and marked in a check, then kept', async ({ page }) => {
  const { errors } = await openDetect(page);
  const R = 6378137;
  const mercator = (lon, lat) => [R * (lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
  // What the engine sends: one byte a pixel. 64 is measured ground, 195 a
  // kept pixel both rules passed (bits 0, 1, 6 and 7).
  const mask = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgb(64,64,64)'; context.fillRect(0, 0, 512, 512);
    context.fillStyle = 'rgb(195,195,195)'; context.fillRect(200, 200, 112, 112);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const saved = [], previews = [], checked = [];
  await page.route('**/api/compare/analyzers', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      saved.push(body);
      return route.fulfill({ json: { ...body, id: 'custom-aaaaaaaaaaaa' } });
    }
    return route.fulfill({ json: {
      builtins: [recipe], custom: [], grid: [13, 512], max_tiles: 4096, max_results: 2000,
      methods: [{ id: 'surface', single: false, sizes: {} }, { id: 'rules', single: false, clouds: true, sensor: 'sentinel2', frames: 4,
        sizes: { medium: { min_area: 0, max_area: 0, cleanup: 0, smoothing: 0, merge_metres: 0 } }, rules: true, measure: '' }],
      rules: { bands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], classes: ['vegetation', 'bare', 'water'],
        max_rules: 6, max_bands: 6, max_around: 300, max_checks: 12, max_marks: 20, preview_span: 3 }, examples: [] } });
  });
  await page.route('**/api/satellite/sentinel/acquisitions', (route) => route.fulfill({ json: {
    dates: [{ date: '2026-09-10', cloud: 4, coverage: 1 }, { date: '2026-09-01', cloud: 2, coverage: 1 }], truncated: false } }));
  await page.route('**/api/compare/analyzers/preview', (route) => {
    const body = route.request().postDataJSON();
    previews.push(body);
    const { west, south, east, north } = body.bounds;
    const [x0, y0] = mercator(west, south);
    const [x1, y1] = mercator(east, north);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = Math.min(x1 - x0, y1 - y0) / 2;
    const base = { tiles: [[1, 1]], clipped: false, size: [512, 512],
      box: { west: cx - half, east: cx + half, south: cy - half, north: cy + half } };
    if (!body.read && previews.filter((entry) => entry.read).length === 0) return route.fulfill({ json: { ...base, ready: false, missing: 2 } });
    const middle = [(west + east) / 2, (south + north) / 2];
    return route.fulfill({ json: { ...base, ready: true, missing: 0, mask, measured: 1,
      rules: body.recipe.rules.map(() => ({ share: 0.048, kept: 0.048 })), kept: 0.048, count: 1, note: '',
      candidates: [{ id: '0-1', coordinates: middle, bbox: [middle[0] - 0.001, middle[1] - 0.001, middle[0] + 0.001, middle[1] + 0.001],
        area: 12000, margin: 3.4, strength: 'strong', measure: { before: 0.8, after: 0.2, signed: -0.6 } }] } });
  });
  await page.route('**/api/satellite/sentinel/layers', (route) => route.fulfill({ json: { source: 'catalogue', layers: [
    { id: 'TRUE_COLOR', label: 'True colour' }, { id: 'FALSE_COLOR', label: 'False colour (infrared)' },
    { id: 'SWIR', label: 'SWIR (short-wave infrared)' }, { id: 'NDVI', label: 'NDVI (vegetation index)' }] } }));
  await page.route('**/api/compare/analyzers/probe', (route) => route.fulfill({ json: {
    ready: true, imaged: true, measured: true, kept: true,
    rules: [{ passes: true, value: -0.6, before: 0.8, after: 0.2 }, { passes: true, value: 0.8, before: null, after: null }] } }));
  await page.route('**/api/compare/analyzers/check', (route) => {
    const body = route.request().postDataJSON();
    checked.push(body);
    return route.fulfill({ json: { ready: true, missing: 0, count: 1, covered: body.check.marks.map(() => true) } });
  });

  await page.getByRole('button', { name: 'Analyzers', exact: true }).click();
  await page.getByRole('button', { name: 'New analyzer', exact: true }).click();
  await page.getByRole('button', { name: /^Build your own rules/ }).click();
  await expect(page.getByRole('heading', { name: 'Build an analyzer' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a rule', exact: true }).click();
  await page.getByRole('button', { name: 'Find passes', exact: true }).click();
  await page.getByLabel('Use 2026-09-01').getByRole('button', { name: 'A', exact: true }).click();
  await page.getByLabel('Use 2026-09-10').getByRole('button', { name: 'B', exact: true }).click();
  const read = page.getByRole('button', { name: 'Show the detections here', exact: true });
  await expect(read).toBeVisible();
  await read.click();
  await expect(page.getByText('1 candidate on the map')).toBeVisible();
  // B is on the map in the layer that reads rule ★, and any other is one pick away
  await expect(page.getByLabel('Copernicus layer')).toHaveValue('TRUE_COLOR');
  await page.getByRole('button', { name: /^Show it in NDVI/ }).click();
  await expect(page.getByLabel('Copernicus layer')).toHaveValue('NDVI');
  await expect(page.getByRole('button', { name: 'Imagery provider', exact: true })).toContainText('Copernicus Sentinel-2');

  // the rules are on the ground, each in its colour: the later one on top
  const layers = page.locator('canvas.rule-layers');
  await expect(layers).toBeVisible();
  // A canvas keeps its colours premultiplied, so a channel can read one off.
  const tint = (expected) => async () => {
    const read = await layers.evaluate((canvas) => [...canvas.getContext('2d').getImageData(256, 256, 1, 1).data]);
    return read.every((value, i) => Math.abs(value - expected[i]) <= 2);
  };
  await expect.poll(tint([56, 189, 248, 110])).toBe(true);
  await page.getByRole('button', { name: 'Hide rule 2 on the map', exact: true }).click();
  await expect.poll(tint([250, 204, 21, 110])).toBe(true);
  expect(await layers.evaluate((canvas) => canvas.getContext('2d').getImageData(10, 10, 1, 1).data[3])).toBe(0);

  // the detections alone, as a run would return them: no rule painted, the candidate still outlined
  const shows = page.getByRole('group', { name: 'What the map shows' });
  await shows.getByRole('button', { name: 'Detections', exact: true }).click();
  await expect.poll(tint([0, 0, 0, 0])).toBe(true);
  await expect(page.locator('svg.analysis-overlay [role="button"]')).toHaveCount(1);
  await shows.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect.poll(tint([250, 204, 21, 110])).toBe(true);

  const map = page.locator('.detect-tool .map');
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width / 2 - 40, y: box.height / 2 + 40 } });
  const reading = page.getByRole('dialog', { name: 'Rules at this point' });
  await expect(reading).toContainText('Kept');
  await expect(reading).toContainText('0.80 → 0.20 (−0.60)');
  await page.screenshot({ path: test.info().outputPath('detect-builder.png') });

  // the point becomes a check of this view, marked on the ground, read from the cache
  await expect(reading).toContainText('Mark it in a new check of this view');
  await reading.getByRole('button', { name: 'Should be found', exact: true }).click();
  await expect(reading).toHaveCount(0);
  await expect(page.locator('.mark.pin-found')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /^Checks/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('1 of 1 found')).toBeVisible();
  await expect(page.locator('.mark.pin-found.pass')).toHaveCount(1);
  expect(checked.every((body) => body.read === false)).toBe(true);
  await expect(page.locator('svg.ground polygon')).toHaveCount(1);        // the check's view, framed

  // an armed pin drops where the map is clicked, and the map says which one is armed
  await page.getByRole('button', { name: 'Should stay empty', exact: true }).click();
  await expect(page.getByText('Click where none should be')).toBeVisible();
  await map.click({ position: { x: box.width / 2 + 120, y: box.height / 2 - 80 } });
  await expect(page.locator('.mark.pin-empty')).toHaveCount(1);
  await page.getByRole('button', { name: 'Stop dropping pins', exact: true }).click();
  await expect(page.getByText('Click where none should be')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('detect-builder-checks.png') });

  // A, B or the two blinking, from the map itself
  const bar = page.getByRole('group', { name: 'Passes under the preview' });
  await bar.getByRole('button', { name: 'Blink', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Blink', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'B', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Blink', exact: true })).toHaveAttribute('aria-pressed', 'false');
  // the new pin is read with the rest: the stand-in engine puts a candidate on both
  await expect(page.getByText('1 of 1 found · 1 of 1 flagged')).toBeVisible();

  await page.getByLabel('Analyzer name').fill('Cleared ground');
  await page.getByRole('button', { name: 'Add to my analyzers', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ method: 'rules', name: 'Cleared ground', match: 'all' });
  expect(saved[0].rules).toHaveLength(2);
  expect(saved[0].checks).toEqual([expect.objectContaining({ name: 'Check 1',
    marks: [expect.objectContaining({ expect: 'found' }), expect.objectContaining({ expect: 'empty' })],
    result: expect.objectContaining({ covered: [true, true] }) })]);
  await expect(layers).toHaveCount(0);
  await expect(page.locator('.mark')).toHaveCount(0);
  expect(previews.every((entry) => entry.recipe.method === 'rules')).toBe(true);
  expect(errors).toEqual([]);
});

test('takes the whole screen with its panel, folds it there, and gives it up to Compare', async ({ page }) => {
  const { errors } = await openDetect(page);
  const held = () => page.evaluate(() => document.fullscreenElement?.classList.contains('detect-tool') ?? false);
  const map = page.locator('.detect-tool .map');
  const before = await map.boundingBox();
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect.poll(held).toBe(true);
  await expect.poll(async () => (await map.boundingBox()).height).toBeGreaterThan(before.height);
  await expect(page.getByRole('button', { name: 'New detection', exact: true })).toBeVisible();
  // the panel still folds away, leaving the map the whole width
  const panelled = await map.boundingBox();
  await page.keyboard.press(']');
  await expect(page.locator('.dock-tabs.rail')).toBeVisible();
  await expect.poll(async () => (await map.boundingBox()).width).toBeGreaterThan(panelled.width + 200);
  await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeVisible();
  await page.keyboard.press(']');

  // the ground and the zoom reached in full screen are the ones the window gets back
  const middle = await map.boundingBox();
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);
  await page.mouse.wheel(0, -120);
  await page.mouse.down();
  await page.mouse.move(middle.x + middle.width / 2 - 150, middle.y + middle.height / 2 - 60, { steps: 8 });
  await page.mouse.up();
  const there = await restingCamera(page, map);
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await expect.poll(held).toBe(false);
  const back = await restingCamera(page, map);
  expect(back.lat).toBeCloseTo(there.lat, 4);
  expect(back.lon).toBeCloseTo(there.lon, 4);
  expect(back.span / there.span).toBeCloseTo(1, 1);

  // Open in… Compare leaves the screen on the way
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect.poll(held).toBe(true);
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menu', { name: 'This point' }).getByRole('menuitem', { name: /^Open in/ }).click();
  await page.getByRole('menu', { name: 'Open this point in' }).getByRole('menuitem', { name: 'Compare', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await expect(page.locator('.tool-host:not(.hidden) h2')).toHaveText('Compare');
  expect(errors).toEqual([]);
});
