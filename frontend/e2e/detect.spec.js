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
  return { errors, calls, prefs, run };
}

/** What starts with nothing picked and every category folded: open the first, take its first analyzer. */
async function pickAnalyzer(page) {
  const step = page.getByRole('region', { name: 'What to look for' });
  await step.locator('.fold').first().click();
  await step.getByRole('radio').first().click();
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

test('Results can hide markers while keeping selectable outlines and restore the display after the eye', async ({ page }) => {
  const { errors, run } = await openDetect(page, true);
  run.results[2].geometry = { type: 'Polygon', coordinates: [
    [[2.296, 48.859], [2.299, 48.859], [2.299, 48.861], [2.296, 48.861], [2.296, 48.859]],
  ] };
  const writes = [];
  page.on('request', (request) => {
    if (request.url().includes('/analysis/') && request.method() !== 'GET') writes.push(request.url());
  });
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.getByRole('button', { name: /^North site pass/ }).click();
  const overlay = page.locator('.analysis-overlay');
  await expect(overlay.locator('.outline')).toHaveCount(3);
  await expect(overlay.locator('g')).toHaveCount(1);
  await expect(overlay.locator('text')).toHaveText('3');
  await page.getByRole('button', { name: 'Which overlays', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Overlay display' });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(2);
  // Review shortcuts must not write a verdict while the display menu owns the keyboard.
  await page.keyboard.press('d');
  await expect(overlay.locator('.outline')).toHaveCount(3);
  await menu.getByRole('menuitemcheckbox', { name: 'Markers', exact: true }).click();
  await expect(overlay.locator('circle, g, text')).toHaveCount(0);
  await expect(overlay.locator('.outline')).toHaveCount(3);
  await expect(overlay.locator('.outline.selected')).toHaveCount(1);
  await menu.getByRole('menuitemcheckbox', { name: 'Outlines', exact: true }).click();
  await expect(overlay.locator('.outline')).toHaveCount(0);
  await menu.getByRole('menuitemcheckbox', { name: 'Outlines', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // A contour selects its candidate while its interior leaves room to pan the map.
  const outline = overlay.locator('.outline').last();
  const edge = await outline.evaluate((node) => {
    const point = node.getPointAtLength(node.getTotalLength() / 8).matrixTransform(node.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(edge.x, edge.y);
  await expect(page.locator('.review-body').getByText('Third candidate', { exact: true })).toBeVisible();
  await expect(overlay.locator('.outline.selected')).toHaveAttribute('stroke-width', '3');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.review-body').getByText(/^A longer candidate name/)).toBeVisible();
  await page.getByRole('button', { name: 'Hide the candidates and areas', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await page.keyboard.press('h');
  await expect(overlay.locator('.outline')).toHaveCount(3);
  await expect(overlay.locator('g')).toHaveCount(0);
  await page.getByRole('button', { name: 'Which overlays', exact: true }).click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Markers', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: test.info().outputPath('results-outlines-only.png') });
  expect(writes).toEqual([]);
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
  await pickAnalyzer(page);
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
  await pickAnalyzer(page);
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
  await pickAnalyzer(page);
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
      if (next === 'Next: When') await pickAnalyzer(page);
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

test('the size is asked once an analyzer is picked, and a pair months apart warns about shadows', async ({ page }) => {
  const { errors, calls } = await openDetect(page);
  await page.getByRole('button', { name: 'New detection', exact: true }).click();
  await page.getByRole('button', { name: 'New one pass', exact: true }).click();
  await page.getByRole('button', { name: 'North site', exact: true }).click();
  await page.getByRole('button', { name: 'Next: What' }).click();
  const step = page.getByRole('region', { name: 'What to look for' });
  const sizes = step.getByRole('group', { name: 'Target size' });
  await expect(sizes).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next: When' })).toBeDisabled();
  await pickAnalyzer(page);
  await expect(sizes).toHaveCount(1);
  await expect(sizes.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const [list, below] = [await step.getByRole('radiogroup', { name: 'Analyzer' }).boundingBox(), await sizes.boundingBox()];
  expect(list.y + list.height).toBeLessThanOrEqual(below.y);
  const cloudBox = await step.getByLabel('Maximum cloud cover').boundingBox();
  expect(cloudBox.y).toBeGreaterThanOrEqual(below.y + below.height);
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

const R = 6378137;
const WORLD = 2 * Math.PI * R;
const mercator = (lon, lat) => [R * (lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
/** The grid tile (level 13) a point is on, and where in it the point falls, 0 to 1. */
function tileOf(lon, lat) {
  const [mx, my] = mercator(lon, lat);
  const count = 2 ** 13;
  const gx = ((mx + WORLD / 2) / WORLD) * count;
  const gy = ((WORLD / 2 - my) / WORLD) * count;
  return { x: Math.floor(gx), y: Math.floor(gy), fx: gx - Math.floor(gx), fy: gy - Math.floor(gy) };
}
const tileBox = ({ x, y }) => {
  const count = 2 ** 13;
  return { west: (x / count) * WORLD - WORLD / 2, east: ((x + 1) / count) * WORLD - WORLD / 2,
    north: WORLD / 2 - (y / count) * WORLD, south: WORLD / 2 - ((y + 1) / count) * WORLD };
};
const rulesCatalogue = {
  builtins: [recipe], custom: [], grid: [13, 512], max_tiles: 4096, max_results: 2000, copernicus_key: true, radar_layer: '',
  methods: [{ id: 'surface', single: false, sizes: {} }, { id: 'rules', single: false, clouds: true, sensor: 'sentinel2', frames: 4,
    sizes: { all: size(0, 0, 0, 0, 0), medium: size(2000, 0, 1, 0, 30) }, rules: true, measure: '' }],
  rules: { bands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], classes: ['vegetation', 'bare', 'water'],
    max_rules: 6, max_bands: 6, max_around: 300, max_checks: 12, max_marks: 60, max_check_tiles: 20 },
  examples: [],
};

/** The engine's side of a builder session: passes, what a test costs, what it finds, what a point reads. */
async function answerBuilder(page) {
  const log = { saved: [], plans: [], tests: [], probes: [], lookups: [], center: null, hole: null };
  await page.route('**/api/compare/analyzers', (route) => {
    if (route.request().method() === 'POST') {
      log.saved.push(route.request().postDataJSON());
      return route.fulfill({ json: { ...route.request().postDataJSON(), id: 'custom-aaaaaaaaaaaa' } });
    }
    return route.fulfill({ json: rulesCatalogue });
  });
  await page.route('**/api/satellite/sentinel/acquisitions', (route) => {
    log.lookups.push(route.request().postDataJSON());
    return route.fulfill({ json: { dates: [{ date: '2026-09-10', cloud: 4, coverage: 1 }, { date: '2026-09-01', cloud: 2, coverage: 1 }], truncated: false } });
  });
  await page.route('**/api/satellite/sentinel/layers**', (route) => route.fulfill({ json: {
    source: new URL(route.request().url()).searchParams.get('check') === 'true' ? 'instance' : 'catalogue', layers: [
    { id: 'TRUE_COLOR', label: 'True colour' }, { id: 'FALSE_COLOR', label: 'False colour (infrared)' },
    { id: 'SWIR', label: 'SWIR (short-wave infrared)' }, { id: 'NDVI', label: 'NDVI (vegetation index)' }] } }));
  await page.route('**/api/compare/analyzers/check/plan', (route) => {
    log.plans.push(route.request().postDataJSON());
    return route.fulfill({ json: { tiles: 1, missing: 4 } });
  });
  await page.route('**/api/compare/analyzers/check', async (route) => {
    const body = route.request().postDataJSON();
    log.tests.push(body);
    const [lon, lat] = body.check.marks[0].point;
    const tile = tileOf(lon, lat);
    log.center = { x: Math.round(tile.fx * 512), y: Math.round(tile.fy * 512) };
    // the cloud sits in the corner of the tile farthest from the pin
    log.hole = { x: log.center.x < 256 ? 412 : 0, y: log.center.y < 256 ? 432 : 0 };
    // What the engine sends: one byte a pixel. 64 is measured ground, and the low bits are the rules that passed;
    // rule 1 and 2 pass round the first pin, rule 2 alone further out, and a corner is cloud.
    const mask = await page.evaluate(([cx, cy, hx, hy]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 512;
      const context = canvas.getContext('2d');
      const image = context.createImageData(512, 512);
      for (let j = 0; j < 512; j++) {
        for (let i = 0; i < 512; i++) {
          let value = i >= hx && i < hx + 100 && j >= hy && j < hy + 80 ? 0 : 64;
          const distance = Math.hypot(i - cx, j - cy);
          if (value && distance < 150) value |= 2;
          if (value && distance < 80) value |= 1 | 128;
          const at = (j * 512 + i) * 4;
          image.data[at] = image.data[at + 1] = image.data[at + 2] = value;
          image.data[at + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    }, [log.center.x, log.center.y, log.hole.x, log.hole.y]);
    const marks = body.check.marks;
    // the plot dropped by 0.6, so a line set at a drop of 0.5 or less takes it, and the empty pin is never taken
    const covered = marks.map((mark) => mark.expect === 'found' && body.recipe.rules[0].value >= -0.5);
    return route.fulfill({ json: { ready: true, missing: 0, count: covered.filter(Boolean).length, covered, size: 512, measured: 0.93,
      tiles: [{ x: tile.x, y: tile.y, box: tileBox(tile), mask }],
      rules: body.recipe.rules.map((_, i) => ({ share: 0.18 - i * 0.04, kept: 0.06 })), kept: 0.04,
      candidates: [{ id: '0-1', coordinates: [lon, lat], bbox: [lon - 0.001, lat - 0.001, lon + 0.001, lat + 0.001], area: 12000,
        margin: 3.4, strength: 'strong', measure: { before: 0.8, after: 0.2, signed: -0.6 }, geometry: null }],
      readings: marks.map((mark) => ({ imaged: true, measured: true, kept: mark.expect === 'found',
        rules: body.recipe.rules.map(() => ({ passes: true, value: mark.expect === 'found' ? -0.6 : -0.1, before: 0.8, after: 0.3 })) })) } });
  });
  await page.route('**/api/compare/analyzers/probe', (route) => {
    log.probes.push(route.request().postDataJSON());
    return route.fulfill({ json: { ready: true, imaged: true, measured: true, kept: true,
      rules: [{ passes: true, value: -0.6, before: 0.8, after: 0.2 }, { passes: true, value: 0.8, before: null, after: null }] } });
  });
  return log;
}

/** A pixel of the canvas a part of the test layers painted, by the tile's own pixel. */
const painted = (page, part, [x, y]) => page.locator(`.rule-layers .part.${part} canvas.rule-tile`).first().evaluate(
  (canvas, at) => [...canvas.getContext('2d').getImageData(at[0], at[1], 1, 1).data], [x, y]);
const near = (expected, tolerance = 6) => (read) => read.every((value, i) => Math.abs(value - expected[i]) <= tolerance);

test('an analyzer of your own is proved on a check made on the map: two passes, pins, a test, the rules painted, then kept', async ({ page }) => {
  const { errors } = await openDetect(page);
  const log = await answerBuilder(page);
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'esri-world-imagery', label: 'Esri World Imagery', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, attribution: 'Browser fixture' },
    { id: 'sentinel2', label: 'Copernicus Sentinel-2', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, attribution: 'Copernicus' },
  ] }));

  // what a new one reads is asked first, and stays
  await page.getByRole('button', { name: 'Analyzers', exact: true }).click();
  await page.getByRole('button', { name: 'New analyzer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New analyzer' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Satellite' }).getByRole('button', { name: /^Sentinel-2/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Dates' }).getByRole('button', { name: 'Two dates' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: test.info().outputPath('detect-builder-new.png') });
  await page.getByRole('button', { name: /^Blank/ }).click();
  await expect(page.getByRole('heading', { name: 'Build an analyzer' })).toBeVisible();
  await expect(page.locator('.reads')).toHaveText('Sentinel-2 · two dates');
  await expect(page.getByLabel('Rule 1 measures')).toHaveValue('brightness');
  await page.getByLabel('Rule 1 measures').selectOption('index');
  await page.getByRole('button', { name: 'Add a rule', exact: true }).click();
  await expect(page.getByLabel('Rule 2 says')).toHaveText('NDVI before is at least 0.40');
  // nothing has been asked of Copernicus, and there is no check to test on
  expect(log.lookups.length + log.plans.length + log.tests.length).toBe(0);
  const deck = page.locator('.console');
  await expect(deck.getByText('Pick a check to try the rules on it.')).toBeVisible();
  await expect(page.locator('.strip').getByRole('button', { name: 'Test', exact: true })).toBeDisabled();

  // a check is made on the map: its passes first, in the drawer
  await deck.getByRole('button', { name: 'New check' }).click();
  await expect(page.getByRole('region', { name: 'Passes of the new check' })).toBeVisible();
  await expect(page.locator('.panel')).toHaveClass(/locked/);
  await expect(page.getByText('Making a check on the map')).toBeVisible();
  await deck.getByRole('button', { name: 'Find passes', exact: true }).click();
  expect(log.lookups).toHaveLength(1);
  expect(log.lookups[0]).toMatchObject({ collection: 'sentinel2' });
  await page.getByLabel('Use 2026-09-01').getByRole('button', { name: 'Before', exact: true }).click();
  await page.getByLabel('Use 2026-09-10').getByRole('button', { name: 'After', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('detect-builder-passes.png') });

  // or from the calendar, as a routine picks its dates
  await deck.getByRole('button', { name: 'Dates', exact: true }).click();
  await deck.getByRole('button', { name: 'Before pass' }).click();
  await expect(page.getByRole('group', { name: 'Before pass calendar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^2026-09-01:/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^2026-09-10:/ })).toBeDisabled();      // not before the after pass
  await page.getByRole('button', { name: /^2026-09-01:/ }).click();
  await deck.getByRole('button', { name: 'Place the pins' }).click();

  // the map is split between the two passes, one surface over the other
  await expect(page.locator('.detect-tool .map')).toHaveCount(2);
  const line = page.getByRole('slider', { name: 'Split between the before and after passes' });
  await expect(line).toHaveAttribute('aria-valuenow', '50');
  await line.focus();
  await page.keyboard.press('ArrowRight');
  await expect(line).toHaveAttribute('aria-valuenow', '52');
  await deck.getByRole('button', { name: /^After/ }).click();
  await expect(line).toHaveAttribute('aria-valuenow', '0');
  await deck.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(line).toHaveAttribute('aria-valuenow', '50');

  // pins: a click on the ground drops the armed one, on either half
  const map = page.locator('.detect-tool .map').first();
  const box = await map.boundingBox();
  await expect(deck.getByRole('button', { name: 'Should be found' })).toHaveAttribute('aria-pressed', 'true');
  // dead centre, which is where the line of the split runs: with a pin armed it lets the click through
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await expect(page.locator('.mark.pin-found')).toHaveCount(1);
  await expect(line).toHaveAttribute('aria-valuenow', '50');
  await deck.getByRole('button', { name: 'Should stay empty' }).click();
  await expect(page.getByText('Click the ground where none should be')).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3);
  await expect(page.locator('.mark.pin-found')).toHaveCount(1);
  await expect(page.locator('.mark.pin-empty')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Click the ground where none should be')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('detect-builder-pins.png') });
  await deck.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('.panel')).not.toHaveClass(/locked/);
  await expect(page.getByRole('tab', { name: /^Checks/ })).toContainText('1');

  // what testing costs is asked once the pins are down, and said before anything is read
  const test_ = deck.getByRole('button', { name: 'Test · 4 requests' });
  await expect(test_).toBeEnabled();
  expect(log.plans.length).toBeGreaterThan(0);
  expect(log.plans.at(-1).check.marks).toHaveLength(2);
  expect(log.tests).toHaveLength(0);
  await test_.click();
  await expect(deck.getByText('1 of 1 found · stayed empty · 1 candidate')).toBeVisible();
  await expect(deck.getByRole('button', { name: /Tested$/ })).toBeDisabled();
  expect(log.tests[0]).toMatchObject({ read: true, detail: true });
  await expect(page.locator('.mark.pass')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('detect-builder-tested.png') });

  // Display choices leave the test, its pins and its imagery alone.
  const testsBeforeDisplay = log.tests.length;
  const overlay = page.locator('.analysis-overlay');
  await deck.getByRole('button', { name: 'Which overlays', exact: true }).click();
  const display = deck.getByRole('menu', { name: 'Overlay display' });
  await display.getByRole('menuitemcheckbox', { name: 'Markers', exact: true }).click();
  await expect(overlay.locator('g')).toHaveCount(0);
  await expect(overlay.locator('.outline')).toHaveCount(1);
  await expect(page.locator('.mark.pass')).toHaveCount(2);
  await display.getByRole('menuitemcheckbox', { name: 'Check pins', exact: true }).click();
  await expect(page.locator('.mark')).toHaveCount(0);
  await expect(overlay.locator('.outline')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('builder-outlines-only.png') });
  await display.getByRole('menuitemcheckbox', { name: 'Outlines', exact: true }).click();
  await expect(overlay.locator('.outline')).toHaveCount(0);
  await display.getByRole('menuitemcheckbox', { name: 'Outlines', exact: true }).click();
  await page.keyboard.press('Escape');
  await deck.getByRole('button', { name: 'Should be found', exact: true }).click();
  await expect(overlay.locator('.outline')).toHaveCSS('pointer-events', 'none');
  await page.keyboard.press('Escape');
  await expect(overlay.locator('.outline')).toHaveCSS('pointer-events', 'stroke');
  await deck.getByRole('button', { name: 'Hide the check overlays', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.rule-layers')).toHaveCount(0);
  await expect(page.locator('.detect-tool .map')).toHaveCount(2);
  await deck.getByRole('button', { name: 'Hide the check overlays', exact: true }).click();
  await expect(overlay.locator('.outline')).toHaveCount(1);
  await expect(overlay.locator('g')).toHaveCount(0);
  await expect(page.locator('.mark')).toHaveCount(0);
  await deck.getByRole('button', { name: 'Which overlays', exact: true }).click();
  await display.getByRole('menuitemcheckbox', { name: 'Markers', exact: true }).click();
  await display.getByRole('menuitemcheckbox', { name: 'Check pins', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mark.pass')).toHaveCount(2);
  expect(log.tests).toHaveLength(testsBeforeDisplay);

  // the rules are on the ground: a change across both halves, a before-state on the before half, the tested ground tinted
  await expect(page.locator('.rule-layers .part')).toHaveCount(3);
  await expect.poll(async () => near([250, 204, 21, 110])(await painted(page, 'shared', [log.center.x, log.center.y]))).toBe(true);
  await expect.poll(async () => near([56, 189, 248, 110])(await painted(page, 'before', [log.center.x, log.center.y]))).toBe(true);
  await expect.poll(async () => near([0, 0, 0, 0])(await painted(page, 'after', [log.center.x, log.center.y]))).toBe(true);
  // further out only the before-state passes; ground no rule kept carries the tint, and a corner of cloud nothing
  const far = [log.center.x + 200 < 512 ? log.center.x + 200 : log.center.x - 200, log.center.y];
  await expect.poll(async () => near([56, 189, 248, 110])(await painted(page, 'before', far))).toBe(false);
  await expect.poll(async () => near([120, 170, 255, 30], 8)(await painted(page, 'shared', far))).toBe(true);
  await expect.poll(async () => near([0, 0, 0, 0])(await painted(page, 'shared', [log.hole.x + 10, log.hole.y + 10]))).toBe(true);

  // a chip hides a rule's pixels, and its row in the column says the same
  await deck.getByRole('group', { name: 'Rules on the map' }).getByRole('button', { name: /NDVI change/ }).click();
  await expect.poll(async () => near([120, 170, 255, 30], 8)(await painted(page, 'shared', [log.center.x, log.center.y]))).toBe(true);
  await expect(page.getByRole('button', { name: 'Show rule 1 on the map', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await deck.getByRole('group', { name: 'Rules on the map' }).getByRole('button', { name: /NDVI change/ }).click();
  // the pointer is on its chip, which shows that rule alone and brighter
  await expect.poll(async () => near([250, 204, 21, 190])(await painted(page, 'shared', [log.center.x, log.center.y]))).toBe(true);
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await expect.poll(async () => near([250, 204, 21, 110])(await painted(page, 'shared', [log.center.x, log.center.y]))).toBe(true);

  // a pin reads the rules under it, and can be turned or taken away
  await page.getByRole('button', { name: /^Pin 1:/ }).click();
  const reading = page.getByRole('dialog', { name: 'Rules at this point' });
  await expect(reading).toContainText('Kept');
  await expect(reading).toContainText('0.80 → 0.20 (−0.60)');
  await expect(reading).toContainText('Pin 1: should be found');
  await page.screenshot({ path: test.info().outputPath('detect-builder-pin.png') });
  await reading.getByRole('button', { name: 'Close the reading' }).click();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
  await expect(reading).toContainText('Drop a pin here');
  // the card keeps clear of the console, whichever way it opens
  const card = await reading.boundingBox();
  const deckBox = await deck.boundingBox();
  expect(card.y + card.height).toBeLessThanOrEqual(deckBox.y + 1);
  await page.screenshot({ path: test.info().outputPath('detect-builder-point.png') });
  await page.keyboard.press('Escape');
  await expect(reading).toHaveCount(0);

  // a stricter line moves nothing until Test is pressed again, and then the pin is lost
  await page.getByLabel('Rule 1 value').fill('0.8');
  await page.getByLabel('Rule 1 value').press('Tab');
  await expect(deck.getByText('The rules or pins changed since this test.')).toBeVisible();
  const before = log.tests.length;
  await page.waitForTimeout(400);
  expect(log.tests).toHaveLength(before);
  await page.screenshot({ path: test.info().outputPath('detect-builder-stale.png') });
  await deck.getByRole('button', { name: /^Test again/ }).click();
  await expect.poll(() => log.tests.length).toBe(before + 1);
  expect(log.tests.at(-1).recipe.rules[0].value).toBe(-0.8);
  await expect(page.locator('.mark.fail')).toHaveCount(1);
  await expect(deck.getByText('0 of 1 found · stayed empty · 0 candidates')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('detect-builder-lost.png') });
  // a looser one takes it back
  await page.getByLabel('Rule 1 value').fill('0.3');
  await page.getByLabel('Rule 1 value').press('Tab');
  await deck.getByRole('button', { name: /^Test again/ }).click();
  await expect(page.locator('.mark.pass')).toHaveCount(2);

  // at its narrowest the dock still holds the rules and the checks without a sideways scroll
  const dockBody = page.locator('.cmp-dock-body');
  await page.getByRole('button', { name: 'Resize Detect panel' }).focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => Math.round((await page.locator('.cmp-dock').boundingBox()).width)).toBe(300);
  await expect.poll(() => dockBody.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: /^Checks/ }).click();
  await expect.poll(() => dockBody.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: /^Rules/ }).click();
  await page.screenshot({ path: test.info().outputPath('detect-builder-narrow.png') });

  // kept for every case, with the check that proves it
  await page.getByLabel('Analyzer name').fill('Cleared ground');
  await page.getByRole('button', { name: 'Add to my analyzers', exact: true }).click();
  await expect.poll(() => log.saved.length).toBe(1);
  expect(log.saved[0]).toMatchObject({ method: 'rules', name: 'Cleared ground', match: 'all', sensor: 'sentinel2', dates: 'two' });
  expect(log.saved[0].rules).toHaveLength(2);
  expect(log.saved[0].checks).toEqual([expect.objectContaining({ name: 'Check 1',
    a: expect.objectContaining({ date: '2026-09-01' }), b: expect.objectContaining({ date: '2026-09-10' }),
    marks: [expect.objectContaining({ expect: 'found' }), expect.objectContaining({ expect: 'empty' })],
    result: expect.objectContaining({ covered: [true, false] }) })]);
  expect(log.saved[0].rules[0]).toMatchObject({ op: 'le', value: -0.3 });
  expect(log.saved[0].checks[0]).not.toHaveProperty('bounds');
  await expect(page.locator('.console')).toHaveCount(0);
  await expect(page.locator('.rule-layers')).toHaveCount(0);
  await expect(page.locator('.detect-tool .map')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('an analyzer of one date is tried on one map, with no split and no before or after to choose', async ({ page }) => {
  const { errors } = await openDetect(page);
  const log = await answerBuilder(page);
  await page.getByRole('button', { name: 'Analyzers', exact: true }).click();
  await page.getByRole('button', { name: 'New analyzer', exact: true }).click();
  await page.getByRole('group', { name: 'Dates' }).getByRole('button', { name: 'One date' }).click();
  await page.getByRole('button', { name: /^Blank/ }).click();
  await expect(page.locator('.reads')).toHaveText('Sentinel-2 · one date');
  await expect(page.getByLabel('Rule 1 measures')).toHaveValue('brightness');
  await expect(page.getByLabel('Rule 1 says')).toContainText('brightness is at least');
  await expect(page.getByLabel('Rule 1 reads')).toHaveCount(0);

  const deck = page.locator('.console');
  await deck.getByRole('button', { name: 'New check' }).click();
  await deck.getByRole('button', { name: 'Find passes', exact: true }).click();
  await page.getByLabel('Use 2026-09-10').getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Place the pins' })).toBeEnabled();
  await page.getByRole('button', { name: 'Place the pins' }).click();
  await expect(page.locator('.detect-tool .map')).toHaveCount(1);
  await expect(page.getByRole('slider', { name: 'Split between the before and after passes' })).toHaveCount(0);
  await expect(deck.getByRole('group', { name: 'Which pass to look at' })).toHaveCount(0);
  expect(log.lookups).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a check holds sixty pins and shows a tile overflow while pins are still being placed', async ({ page }) => {
  test.setTimeout(60_000);
  const { errors } = await openDetect(page);
  const log = await answerBuilder(page);
  const overflow = 'these pins reach 21 tiles and a check reads at most 20: keep the pins of one place in a check and start another for ground further away';
  await page.route('**/api/compare/analyzers/check/plan', (route) => {
    const body = route.request().postDataJSON();
    log.plans.push(body);
    return body.check.marks.length === 60
      ? route.fulfill({ status: 422, json: { detail: overflow } })
      : route.fulfill({ json: { tiles: 20, missing: 40 } });
  });
  await page.getByRole('button', { name: 'Analyzers', exact: true }).click();
  await page.getByRole('button', { name: 'New analyzer', exact: true }).click();
  await page.getByRole('group', { name: 'Dates' }).getByRole('button', { name: 'One date' }).click();
  await page.getByRole('button', { name: /^Blank/ }).click();
  const deck = page.locator('.console');
  await deck.getByRole('button', { name: 'New check' }).click();
  await deck.getByRole('button', { name: 'Find passes', exact: true }).click();
  await page.getByLabel('Use 2026-09-10').getByRole('button', { name: 'Use', exact: true }).click();
  await deck.getByRole('button', { name: 'Place the pins' }).click();
  const box = await page.locator('.detect-tool .map').boundingBox();
  for (let i = 0; i < 60; i++) {
    await page.mouse.click(box.x + box.width * (0.3 + (i % 10) * 0.03), box.y + box.height * (0.2 + Math.floor(i / 10) * 0.03));
  }
  await expect(deck.locator('.count')).toHaveText('60 pins');
  await expect(deck.getByRole('button', { name: 'Should be found' })).toHaveAttribute('aria-pressed', 'true');
  await expect(deck.locator('.note.warn')).toHaveText(overflow);
  await expect(deck.locator('.test')).toBeDisabled();
  expect(log.plans.at(-1).check.marks).toHaveLength(60);
  expect(log.tests).toHaveLength(0);
  await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.25);
  await expect(page.getByText('A check holds at most 60 pins.', { exact: true })).toBeVisible();
  await expect(deck.locator('.count')).toHaveText('60 pins');
  await page.screenshot({ path: test.info().outputPath('detect-check-limit.png') });
  expect(errors).toEqual([]);
});

test('check displays use verified configuration layers and grey missing products with setup help', async ({ page }) => {
  const { errors } = await openDetect(page);
  await answerBuilder(page);
  const checks = [], tiles = [];
  await page.route('**/api/satellite/sentinel/layers**', (route) => {
    const checked = new URL(route.request().url()).searchParams.get('check') === 'true';
    if (checked) checks.push(route.request().url());
    return route.fulfill({ json: { source: checked ? 'instance' : 'catalogue', layers: checked
      ? [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'VEGETATION_INDEX', label: 'Vegetation Index - NDVI' }]
      : [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'NDVI', label: 'NDVI' }] } });
  });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/tiles/sentinel2')) tiles.push(path);
  });
  await page.getByRole('button', { name: 'Analyzers', exact: true }).click();
  await page.getByRole('button', { name: 'New analyzer', exact: true }).click();
  await page.getByRole('button', { name: /^Blank/ }).click();
  await expect(page.getByLabel('Rule 1 measures')).toHaveValue('brightness');
  await expect(page.getByLabel('Rule 1 data')).toHaveText('Sentinel-2 bands · B02 · B03 · B04');
  expect(checks).toHaveLength(0);
  expect(tiles).toHaveLength(0);
  const deck = page.getByRole('region', { name: 'Checks on the map' });
  await deck.getByRole('button', { name: 'New check' }).click();
  await expect.poll(() => checks.length).toBe(1);
  await deck.getByRole('button', { name: 'Find passes', exact: true }).click();
  await page.getByLabel('Use 2026-09-01').getByRole('button', { name: 'Before', exact: true }).click();
  await page.getByLabel('Use 2026-09-10').getByRole('button', { name: 'After', exact: true }).click();
  await deck.getByRole('button', { name: 'Place the pins' }).click();
  await expect.poll(() => tiles.some((path) => path.includes('~TRUE_COLOR~2026-09-01'))).toBe(true);
  await expect.poll(() => tiles.some((path) => path.includes('~TRUE_COLOR~2026-09-10'))).toBe(true);
  await deck.getByRole('button', { name: 'Copernicus layer', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Copernicus layer' });
  const swir = menu.getByRole('menuitemradio', { name: /^SWIR/ });
  await expect(swir).toBeDisabled();
  await expect(swir).toContainText('Not in your Copernicus configuration.');
  await menu.getByText('Set up Copernicus layers', { exact: true }).click();
  await expect(menu.getByRole('link', { name: 'Configuration Utility', exact: true })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: /VEGETATION_INDEX/ }).click();
  await expect.poll(() => tiles.some((path) => path.includes('~VEGETATION_INDEX~'))).toBe(true);
  expect(tiles.some((path) => path.includes('~NDVI~'))).toBe(false);
  await expect(page.getByLabel('Rule 1 measures')).toHaveValue('brightness');
  await deck.getByRole('button', { name: 'Copernicus layer', exact: true }).click();
  await page.getByRole('menu', { name: 'Copernicus layer' }).getByRole('button', { name: 'Refresh layers', exact: true }).click();
  await expect.poll(() => checks.length).toBe(2);
  for (const width of ['Home', 'End']) {
    await page.getByRole('button', { name: 'Resize Detect panel' }).focus();
    await page.keyboard.press(width);
    await expect.poll(async () => {
      const menuBox = await menu.boundingBox();
      const mapBox = await page.locator('.detect-tool .map').first().boundingBox();
      return menuBox.x >= mapBox.x && menuBox.x + menuBox.width <= mapBox.x + mapBox.width;
    }).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('verified-check-layers.png') });
  expect(errors).toEqual([]);
});

test('a failed layer check keeps the basemap and explains how to recover', async ({ page }) => {
  const { errors } = await openDetect(page);
  await answerBuilder(page);
  await page.route('**/api/satellite/sentinel/layers**', (route) => route.fulfill({ json: {
    source: 'catalogue', layers: [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'NDVI', label: 'NDVI' }],
  } }));
  const tiles = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/tiles/sentinel2')) tiles.push(path);
  });
  await page.getByRole('button', { name: 'Analyzers', exact: true }).click();
  await page.getByRole('button', { name: 'New analyzer', exact: true }).click();
  await page.getByRole('button', { name: /^Blank/ }).click();
  const deck = page.getByRole('region', { name: 'Checks on the map' });
  await deck.getByRole('button', { name: 'New check' }).click();
  await deck.getByRole('button', { name: 'Find passes', exact: true }).click();
  await page.getByLabel('Use 2026-09-01').getByRole('button', { name: 'Before', exact: true }).click();
  await page.getByLabel('Use 2026-09-10').getByRole('button', { name: 'After', exact: true }).click();
  await deck.getByRole('button', { name: 'Place the pins' }).click();
  await expect(deck.getByText('Could not check your Copernicus layers; the basemap stays on.')).toBeVisible();
  await expect(page.locator('.detect-tool .map')).toHaveCount(1);
  await expect(deck.getByRole('button', { name: 'Copernicus layer', exact: true })).toContainText('Choose a layer');
  await expect(deck.getByRole('button', { name: 'Refresh layers', exact: true })).toBeEnabled();
  expect(tiles).toEqual([]);
  expect(errors).toEqual([]);
});

test('failed check imagery says why on both maps and can be retried or replaced by the basemap', async ({ page }) => {
  const { errors } = await openDetect(page);
  await answerBuilder(page);
  let failing = true;
  await page.route('**/api/tiles/sentinel2*/**', (route) => failing
    ? route.fulfill({ status: 400, contentType: 'text/plain', body: 'Layer not found' })
    : route.fallback());
  await page.getByRole('button', { name: 'Analyzers', exact: true }).click();
  await page.getByRole('button', { name: 'New analyzer', exact: true }).click();
  await page.getByRole('button', { name: /^Blank/ }).click();
  const deck = page.getByRole('region', { name: 'Checks on the map' });
  await deck.getByRole('button', { name: 'New check' }).click();
  await deck.getByRole('button', { name: 'Find passes', exact: true }).click();
  await page.getByLabel('Use 2026-09-01').getByRole('button', { name: 'Before', exact: true }).click();
  await page.getByLabel('Use 2026-09-10').getByRole('button', { name: 'After', exact: true }).click();
  await deck.getByRole('button', { name: 'Place the pins' }).click();
  const notices = page.getByRole('status', { name: 'Imagery loading error' });
  await expect(notices).toHaveCount(2);
  await expect(notices.first()).toContainText('Layer not found');
  await expect(notices.first()).toContainText('TRUE_COLOR');
  await expect(notices.first()).toContainText('2026-09-01');
  await expect(notices.last()).toContainText('2026-09-10');
  await page.screenshot({ path: test.info().outputPath('check-imagery-error.png') });
  failing = false;
  await notices.first().getByRole('button', { name: 'Retry imagery' }).click();
  await expect(notices).toHaveCount(1);
  await notices.first().getByRole('button', { name: 'Use basemap' }).click();
  await expect(notices).toHaveCount(0);
  await expect(page.locator('.detect-tool .map')).toHaveCount(1);
  await expect(deck.getByRole('button', { name: 'Passes on the map' })).toHaveAttribute('aria-pressed', 'false');
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
