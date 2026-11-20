import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A map's settings on its card in the drawn note: the base filed on its press, the day the
 * timeline opens on and Play's pace, each one line of the block and one Undo step, and an area
 * outlined on the map into a layer of the map's own. Then a map from nothing: a place framed
 * on the app's map, put in the note, a point put on its card. Then the Draw tab's map moved:
 * zoomed in, a point put where it is pressed, its whole frame again, and nothing of the view
 * written. The server is stood in for.
 */

const BLOCK = ['::: map', 'title: The front', 'layer: Front line', 'proofs: 2026-10-19..2026-11-02', 'ground: e_g1',
  'view: 12.73976, 43.51350, 12.05', ':::'].join('\n');
const SVG = '<svg class="az-map-svg" viewBox="0 0 1600 1000" preserveAspectRatio="none"><g class="az-lines"><g class="az-f az-line"><path class="az-stroke" d="M300 600L900 560L1300 700" stroke="#1e88e5" stroke-width="3"/></g></g></svg>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function described(text) {
  const own = /layer: Drawn on the quay/.test(text);
  return {
    title: own ? 'Drawn on the quay' : 'The front', base: /base: map/.test(text) ? 'map' : 'satellite',
    imagery: /imagery: (\w+)/.exec(text)?.[1] ?? '',
    bounds: [43.4, 12.68, 43.6, 12.8], frame: [1600, 1000], extent: [43.45, 12.69, 43.57, 12.79],
    view: { center: [43.5, 12.74], zoom: 12, bearing: 0 },
    ground: { id: 'e_g1', path: 'media/ground.png', bounds: [43.4, 12.68, 43.6, 12.8] }, svg: SVG,
    layers: own
      ? [{ name: 'Drawn on the quay', title: 'Drawn on the quay', from: 'line', on: true, colour: '', colours: [], features: 0, editable: true, own: true, missing: false }]
      : [{ name: 'Front line', title: 'Front line', from: 'line', on: true, colour: '', colours: ['#1e88e5'], features: 1, editable: true, own: false, missing: false }],
    others: [], drawings: [], proofs: { count: 3, first: '2026-10-19', last: '2026-11-02' },
    days: ['2026-10-06', '2026-10-14', '2026-10-21', '2026-11-16'], day: '2026-11-16',
    steps: [], own_steps: false, palette: [], providers: [{ id: 'esri-world-imagery', label: 'Esri World Imagery' }], warnings: [],
  };
}

async function notebook(page, start = '# Lead\n\nSeen at the quay.\n') {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { written: [], grounds: [], features: [], scratch: [], layers: [] };
  let text = start;
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/files/${CASE_ID}/media/ground.png`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: 'Seen at the quay.', words: 4,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/maps/sources') {
      return route.fulfill({ json: { layers: [{ name: 'Front line', title: 'Front line', features: 1, tracked: true, bbox: [43.45, 12.69, 43.57, 12.79] }],
        plates: [], proofs: { count: 3, first: '2026-10-19', last: '2026-11-02' },
        providers: [{ id: 'esri-world-imagery', label: 'Esri World Imagery' }], provider: 'esri-world-imagery' } });
    }
    if (path === '/maps/describe') return route.fulfill({ json: described(request.postDataJSON().text) });
    if (path === '/maps/ground') {
      state.grounds.push(request.postDataJSON());
      // a satellite ground is filed from the imagery the block names; another base, from its own map
      const satellite = request.postDataJSON().base === 'satellite';
      return route.fulfill({ json: { ground: satellite ? 'e_s2' : 'e_osm', details: [], view: '12.73976, 43.51350, 12.05', filed: [satellite ? 'e_s2' : 'e_osm'], base: satellite ? '' : 'map' } });
    }
    if (path === '/maps/layer') {
      state.layers.push(request.postDataJSON());
      return route.fulfill({ json: { name: 'The front, drawn', title: 'The front, drawn' } });
    }
    if (path === '/maps/features') {
      state.features.push(request.postDataJSON());
      return route.fulfill({ json: { layer: request.postDataJSON().layer, key: `k${state.features.length}` } });
    }
    if (path === '/maps/scratch') {
      state.scratch.push(request.postDataJSON());
      return route.fulfill({ json: { text: '::: map\ntitle: Drawn on the quay\nlayer: Drawn on the quay\nground: e_g1\nview: 12.74000, 43.50000, 12\n:::',
        filed: ['e_g1', 'e_layer1'], layer: 'Drawn on the quay', warnings: [] } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    if (path === '/n1') {
      if (request.method() === 'PUT') {
        text = request.postDataJSON().text;
        state.written.push(text);
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text } });
    }
    return route.fallback();
  });
  return state;
}

const blockOf = (text) => text.slice(text.indexOf('::: map'), text.indexOf(':::', text.indexOf('::: map') + 7) + 3);

test('a map’s settings change its base and its timeline, each one line, and an area is drawn on its card', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the card');
  const state = await notebook(page, `# Lead\n\nSeen at the quay.\n\n${BLOCK}\n\nAfter.\n`);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  const map = page.locator('.cm-map-block');
  await expect(map.locator('.cm-map-drawing svg')).toBeVisible();
  await map.getByRole('button', { name: 'Settings' }).click();
  const settings = map.getByRole('group', { name: 'Map settings' }).first();
  await expect(settings.getByRole('tab', { name: 'Look' })).toHaveAttribute('aria-selected', 'true');

  // the base: its picture filed on the press, then one step of three lines
  await settings.getByRole('radio', { name: 'Map', exact: true }).click();
  await expect(settings.getByRole('radio', { name: 'Map', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(state.grounds).toEqual([{ text: BLOCK, base: 'map' }]);
  await expect.poll(() => blockOf(state.written.at(-1) ?? '')).toBe(BLOCK.replace('ground: e_g1', 'ground: e_osm').replace('\n:::', '\nbase: map\n:::'));

  // the timeline: the day it opens on, then Play's pace
  await settings.getByRole('tab', { name: 'Time' }).click();
  await settings.getByLabel('Opens on').fill('2026-10-21');
  await settings.getByLabel('Opens on').dispatchEvent('change');
  await settings.getByRole('radio', { name: 'Slow' }).click();
  await expect.poll(() => blockOf(state.written.at(-1) ?? '').split('\n').slice(-4))
    .toEqual(['base: map', 'opens on: 2026-10-21', 'speed: slow', ':::']);
  // one Undo takes the pace back, and only it
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => blockOf(state.written.at(-1) ?? '').split('\n').slice(-3)).toEqual(['base: map', 'opens on: 2026-10-21', ':::']);

  // an area outlined on the map, its size said, in a layer made for the map
  await settings.getByRole('tab', { name: 'Draw' }).click();
  await settings.getByRole('button', { name: 'Area to highlight' }).click();
  await expect(map.locator('.cm-map-hint-words')).toHaveText('Press each corner round the area to highlight, then the first one again or Enter. '
    + 'Space+drag or the middle button moves the map.');
  const box = await map.locator('.cm-map-stage').boundingBox();
  for (const [x, y] of [[0.3, 0.3], [0.5, 0.3], [0.5, 0.55], [0.3, 0.55]]) await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect.poll(() => state.features.length).toBe(1);
  expect(state.layers).toEqual([{ title: 'The front, drawn' }]);
  expect(state.features[0]).toMatchObject({ layer: 'The front, drawn', kind: 'area', highlight: true, label: true });
  expect(state.features[0].name).toMatch(/^about [\d.,]+ km²$/);
  expect(state.features[0].coords).toHaveLength(4);
  await expect.poll(() => blockOf(state.written.at(-1) ?? '')).toContain('layer: The front, drawn');
  await expect(page.getByText('Area highlighted in the layer of this map')).toBeVisible();
});

test('a map’s imagery: Sentinel-2 files its ground and writes its line, Esri says its terms once, never in a dialog', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the card');
  const state = await notebook(page, `# Lead\n\nSeen at the quay.\n\n${BLOCK}\n\nAfter.\n`);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  const map = page.locator('.cm-map-block');
  await expect(map.locator('.cm-map-drawing svg')).toBeVisible();
  await map.getByRole('button', { name: 'Settings' }).click();
  const settings = map.getByRole('group', { name: 'Map settings' }).first();
  const imagery = settings.getByRole('radiogroup', { name: 'Imagery' });
  await expect(imagery.getByRole('radio')).toHaveText(['Sentinel-2 · free', 'Esri · sharper']);

  await imagery.getByRole('radio', { name: 'Sentinel-2 · free' }).click();
  await expect(imagery.getByRole('radio', { name: 'Sentinel-2 · free' })).toHaveAttribute('aria-checked', 'true');
  expect(state.grounds).toEqual([{ text: BLOCK.replace('\n:::', '\nimagery: sentinel\n:::'), base: 'satellite' }]);
  await expect.poll(() => blockOf(state.written.at(-1) ?? '')).toBe(BLOCK.replace('ground: e_g1', 'ground: e_s2').replace('\n:::', '\nimagery: sentinel\n:::'));
  await expect(settings.getByText('Esri’s terms limit reuse, so publishing it is your responsibility.')).toHaveCount(0);

  await imagery.getByRole('radio', { name: 'Esri · sharper' }).click();
  await expect.poll(() => blockOf(state.written.at(-1) ?? '')).toContain('imagery: esri');
  await expect(settings.getByText('Esri’s terms limit reuse, so publishing it is your responsibility.')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a map from nothing frames a place, lands in the note on its Draw tab, and takes a point', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the card');
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('Seen at the quay.');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/interactive');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Interactive map');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Interactive map' });
  await picker.getByRole('button', { name: 'Start an empty map' }).click();
  await picker.getByPlaceholder('The bridgehead, 1 to 15 October').fill('Drawn on the quay');
  await expect(picker.getByRole('button', { name: 'Start the map' })).toBeEnabled({ timeout: 20000 });
  await picker.getByRole('button', { name: 'Start the map' }).click();
  await expect(picker).toHaveCount(0);
  await expect.poll(() => state.scratch.length).toBe(1);
  expect(state.scratch[0]).toMatchObject({ title: 'Drawn on the quay', base: 'satellite' });
  expect(state.scratch[0].west).toBeLessThan(state.scratch[0].east);
  expect(state.scratch[0].south).toBeLessThan(state.scratch[0].north);
  await expect.poll(() => state.written.at(-1) ?? '').toContain('layer: Drawn on the quay');

  const map = page.locator('.cm-map-block');
  await expect(map.getByRole('tab', { name: 'Draw' })).toHaveAttribute('aria-selected', 'true');
  await expect(map.getByText('Nothing drawn on this map yet.')).toBeVisible();
  await map.getByRole('button', { name: 'Point', exact: true }).click();
  const box = await map.locator('.cm-map-stage').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => state.features.length).toBe(1);
  expect(state.features[0]).toMatchObject({ layer: 'Drawn on the quay', kind: 'point' });
  expect(state.features[0].coords[0]).toBeCloseTo(43.5, 2);
});

test('in Draw the map moves: zoomed in, a point lands where it is pressed, then its whole frame, nothing of the view written', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the card');
  const outside = [];
  page.on('request', (request) => {
    const { hostname } = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(hostname)) outside.push(request.url());
  });
  const state = await notebook(page, `# Lead\n\nSeen at the quay.\n\n${BLOCK}\n\nAfter.\n`);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  const map = page.locator('.cm-map-block');
  await expect(map.locator('.cm-map-drawing svg')).toBeVisible();
  await map.getByRole('button', { name: 'Draw' }).click();
  const stage = map.locator('.cm-map-stage');
  await expect(stage).toHaveClass(/cm-map-nav/);
  await expect(map.locator('.cm-map-hint-words')).toHaveText('Scroll or pinch to zoom, drag to move the map, 0 for the whole map.');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  // the whole map: the frame (1600 by 1000 of its units) fitted whole in the middle of the stage
  const scale = Math.min(box.width / 1600, box.height / 1000);
  const whole = [800 - box.width / scale / 2, 500 - box.height / scale / 2, box.width / scale, box.height / scale];
  const viewBox = async () => (await map.locator('.cm-map-drawing svg').getAttribute('viewBox')).split(' ').map(Number);
  const isWhole = async () => (await viewBox()).every((value, index) => Math.abs(value - whole[index]) < 0.05);
  expect(await isWhole()).toBe(true);

  // the wheel zooms about the pointer, which stays over the same place of the map
  const aim = [box.width * 0.25, box.height * 0.3];
  const under = [800 + (aim[0] - box.width / 2) / scale, 500 + (aim[1] - box.height / 2) / scale];
  await page.mouse.move(box.x + aim[0], box.y + aim[1]);
  for (let turn = 0; turn < 5; turn += 1) await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await stage.getAttribute('data-zoom'))).toBeGreaterThan(2.5);
  await expect(map.getByRole('button', { name: 'File the ground for this view' })).toBeVisible();

  // a point put there lands on that place, in longitude and latitude
  await map.getByRole('button', { name: 'Point', exact: true }).click();
  await expect(map.locator('.cm-map-hint-words')).toHaveText('Press where the point goes. Esc cancels. Space+drag or the middle button moves the map.');
  const now = await stage.boundingBox();
  await page.mouse.click(now.x + aim[0], now.y + aim[1]);
  await expect.poll(() => state.features.length).toBe(1);
  const [lon, lat] = state.features[0].coords;
  const mercY = (value) => 0.5 - Math.log((1 + Math.sin((value * Math.PI) / 180)) / (1 - Math.sin((value * Math.PI) / 180))) / (4 * Math.PI);
  const unmercY = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  // within a pixel at this zoom: a few metres
  expect(Math.abs(lon - (43.4 + (0.2 * under[0]) / 1600))).toBeLessThan(2e-4);
  expect(Math.abs(lat - unmercY(mercY(12.8) + ((mercY(12.68) - mercY(12.8)) * under[1]) / 1000))).toBeLessThan(2e-4);
  // drawn again with the point, the map stays where it looked
  await expect.poll(() => blockOf(state.written.at(-1) ?? '')).toContain('layer: The front, drawn');
  expect(Number(await stage.getAttribute('data-zoom'))).toBeGreaterThan(2.5);

  // Whole map shows the block's own frame again
  await map.getByRole('button', { name: 'Whole map' }).click();
  await expect.poll(isWhole).toBe(true);
  await expect(map.getByRole('button', { name: 'Whole map' })).toBeDisabled();

  // leaving Draw holds the map still; the block gained the drawing's layer and nothing else
  await page.mouse.move(now.x + aim[0], now.y + aim[1]);
  await page.mouse.wheel(0, -200);
  await expect.poll(isWhole).toBe(false);
  await map.getByRole('tab', { name: 'Look' }).click();
  await expect(stage).not.toHaveClass(/cm-map-nav/);
  expect(await viewBox()).toEqual([0, 0, 1600, 1000]);
  expect(blockOf(state.written.at(-1))).toBe(BLOCK.replace('layer: Front line', 'layer: Front line\nlayer: The front, drawn'));
  expect(outside, 'Draw reaches nothing outside the app').toEqual([]);
});
