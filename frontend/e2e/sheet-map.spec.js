import { test, expect } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A sheet on a map, in a real browser: Show on a map in the Sheet tool proposes its columns,
 * says what goes on the map and what stays off it, and one press makes a layer the Map opens
 * on. Then the same from a note's map card, Layers › From a sheet…, whose map draws the
 * points. The server is stood in for; the reading of the places is the engine's own and is
 * tested there (`tests/test_sheet_map.py`).
 */

const REGISTER = ['Vehicle register', ['Identification', 'Grade', 'Position'], [
  ['Streit Cougar', 'confirmed', '12.74625, 43.49463 (±30 m)'],
  ['BATT UMG', 'confirmed', '~12.7590, 43.4950 (±450 m)'],
  ['Oshkosh M-ATV', 'set aside', 'location unknown'],
  ['Al-Wahsh MRAP', 'almost sure', '12.73586, 43.49302 (±30 m)'],
  ['Harrow Tygor', 'confirmed', '12.73568, 43.49312 (±30 m)'],
]];
const POINTS = [[43.49463, 12.74625], [43.495, 12.759], [43.49302, 12.73586], [43.49312, 12.73568]];
const PLAN = {
  title: 'Vehicle register', rows: 5, placed: 4, unplaced_count: 1,
  unplaced: [{ row: 'r3', number: 3, name: 'Oshkosh M-ATV', text: 'location unknown', reason: 'unread', said: 'not a place the map can read' }],
  groups: [{ value: 'confirmed', colour: '#184f95', count: 3 }, { value: 'almost sure', colour: '#3987e5', count: 1 }],
  hows: { coordinates: 4 }, dated: 0, undated: 0, first: '', last: '', bbox: [43.49302, 12.73568, 43.495, 12.759], layers: [],
};
const LAYER = {
  name: 'Vehicle register', title: 'Vehicle register', description: 'From the sheet “Vehicle register”.', editable: true,
  source: { kind: 'editable', name: 'working.geojson', format: 'geojson' }, origin: { source: { kind: 'sheet', name: 'Vehicle register' } },
  hidden: [], period: null, refresh: {}, features: 4, icons: 0, sha256: 'v1', bbox: PLAN.bbox, format: 'geojson',
  categories: [{ name: 'confirmed', count: 3, colour: '#184f95', kinds: ['point'] }, { name: 'almost sure', count: 1, colour: '#3987e5', kinds: ['point'] }],
  colours: { '#184f95': 3, '#3987e5': 1 }, symbols: { circle: 4 }, track: null, mymaps: '', stale: false,
  sheet: { id: 'sheet-1', title: 'Vehicle register', gone: false, changed: false },
  made: { points: 4, unplaced: 1, dated: 0, undated: 0 },
};
const COLLECTION = {
  type: 'FeatureCollection',
  features: POINTS.map(([lon, lat], index) => ({
    type: 'Feature', id: index, geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { name: REGISTER[2][[0, 1, 3, 4][index]][0], category: index === 2 ? 'almost sure' : 'confirmed', colour: '#184f95', symbol: 'circle', icon: '', index },
  })),
};

/** The sheet's map routes, and the layers list the Map reads once the layer is made. */
async function sheetMapRoutes(page) {
  const state = { previews: [], made: [], layers: [] };
  await page.route(`**/api/cases/${CASE_ID}/sheets/sheet-1/map/preview`, (route) => {
    state.previews.push(route.request().postDataJSON());
    return route.fulfill({ json: PLAN });
  });
  await page.route(`**/api/cases/${CASE_ID}/sheets/sheet-1/map`, (route) => {
    state.made.push(route.request().postDataJSON());
    state.layers = [LAYER];
    return route.fulfill({ json: LAYER });
  });
  await page.route(`**/api/cases/${CASE_ID}/map-layers`, (route) => route.fulfill({ json: state.layers }));
  await page.route(`**/api/cases/${CASE_ID}/map-layers/Vehicle%20register/data`, (route) => route.fulfill({ json: COLLECTION }));
  // what My layers reads beside an editable layer: the case's named colours and the items it could follow
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  return state;
}

test('Show on a map makes a layer of the sheet’s rows with a place, and the Map opens on it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the dialog');
  const fixture = await installAppFixture(page, { sheets: [REGISTER] });
  const state = await sheetMapRoutes(page);
  await page.goto('/#sheet');
  await page.locator('.home .sheet').first().click();
  await expect(page.getByRole('grid', { name: 'Sheet rows' })).toBeVisible();

  await page.getByRole('button', { name: 'Show on a map' }).click();
  const dialog = page.getByRole('dialog', { name: 'Show “Vehicle register” on a map' });
  await expect(dialog.getByLabel('Place column')).toHaveValue('Position');
  await expect(dialog.getByLabel('Name column')).toHaveValue('Identification');
  await expect(dialog.getByText('4 of 5 rows go on the map.')).toBeVisible();
  await dialog.getByRole('button', { name: /1 row has no place/ }).click();
  await expect(dialog.getByRole('list', { name: 'Rows off the map' })).toContainText('location unknown');
  expect(state.made).toEqual([]);

  await dialog.getByRole('button', { name: 'Make the layer (4 points)' }).click();
  await expect(dialog).toBeHidden();
  expect(state.made).toHaveLength(1);
  expect(state.made[0].choice).toMatchObject({ place: 'Position', name: 'Identification' });

  // the Map, its layers open on the new layer, drawn
  await awaitMapReady(page);
  const mine = page.getByRole('region', { name: 'My layers' });
  await expect(mine.getByRole('button', { name: 'Vehicle register', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(mine).toContainText('From the sheet “Vehicle register”');
  await fixture.expectNoUnexpectedRequests();
});

const BLOCK = ['::: map', 'title: The front', 'layer: Front line', 'ground: e_g1', 'view: 12.74000, 43.49500, 13', ':::'].join('\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** What the engine draws for a map's block: the sheet's points, once it names their layer. */
function described(text) {
  const withSheet = /layer: Vehicle register/.test(text);
  const dots = withSheet ? POINTS.map(([lon, lat], index) =>
    `<g class="az-f az-point" data-id="l1f${index}"><circle cx="${Math.round((lon - 43.48) * 40000)}" cy="${Math.round((12.77 - lat) * 25000)}" r="9" fill="#184f95"/></g>`).join('') : '';
  return {
    title: 'The front', base: 'satellite', bounds: [43.47, 12.72, 43.52, 12.77], frame: [1600, 1000], extent: [43.49, 12.73, 43.5, 12.76],
    view: { center: [43.495, 12.74], zoom: 13, bearing: 0 },
    ground: { id: 'e_g1', path: 'media/ground.png', bounds: [43.47, 12.72, 43.52, 12.77] },
    svg: `<svg class="az-map-svg" viewBox="0 0 1600 1000" preserveAspectRatio="none"><g class="az-points">${dots}</g></svg>`,
    layers: [
      { name: 'Front line', title: 'Front line', from: 'line', on: true, colour: '', colours: ['#1e88e5'], features: 1, editable: true, own: false, missing: false },
      ...(withSheet ? [{ name: 'Vehicle register', title: 'Vehicle register', from: 'line', on: true, colour: '', colours: ['#184f95', '#3987e5'], features: 4, editable: true, own: false, missing: false }] : []),
    ],
    others: [], drawings: [], proofs: { count: 0, first: '', last: '' }, days: [], day: '', steps: [], own_steps: false,
    palette: [], providers: [], warnings: [],
  };
}

test('a note’s map takes a layer made from a sheet, and draws its points', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the card');
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog, sheets: [REGISTER] });
  const state = await sheetMapRoutes(page);
  let text = `# Lead\n\n${BLOCK}\n\nAfter.\n`;
  const written = [];
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) => route.fulfill({ json: { items: catalog, next_cursor: null, total: 1 } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/files/${CASE_ID}/media/ground.png`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: '', words: 1,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/maps/describe') return route.fulfill({ json: described(request.postDataJSON().text) });
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    if (path === '/n1') {
      if (request.method() === 'PUT') {
        text = request.postDataJSON().text;
        written.push(text);
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text } });
    }
    return route.fallback();
  });

  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  const map = page.locator('.cm-map-block');
  await expect(map.locator('.cm-map-drawing svg')).toBeVisible();
  await expect(map.locator('.az-point')).toHaveCount(0);
  await map.getByRole('button', { name: 'Settings' }).click();
  const settings = map.getByRole('group', { name: 'Map settings' }).first();
  await settings.getByRole('tab', { name: 'Layers' }).click();
  await settings.getByRole('button', { name: '＋ From a sheet…' }).click();

  const dialog = page.getByRole('dialog', { name: /on a map/ });
  await dialog.getByRole('button', { name: /Vehicle register/ }).click();
  await expect(dialog.getByLabel('Place column')).toHaveValue('Position');
  await expect(dialog.getByText('4 of 5 rows go on the map.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Make the layer (4 points)' }).click();
  await expect(dialog).toBeHidden();
  expect(state.made).toHaveLength(1);

  // one line in the block, and the map draws the sheet's points
  await expect.poll(() => written.at(-1) ?? '').toContain('layer: Front line\nlayer: Vehicle register\n');
  await expect(map.locator('.az-point')).toHaveCount(4);
  await expect(page.getByText('Layer “Vehicle register” made from its sheet: 4 points')).toBeVisible();
});
