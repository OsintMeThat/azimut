import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { awaitMapReady, CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The 3D map, driven in a real browser.
 *
 * The 3D view is the app's own globe (`lib/globe`); the map engine's former 3D
 * stays one press away (Classic) and keeps its own tests here, since its
 * gestures reach into the engine's camera (`lib/map/relief.js`), which is why
 * the engine's version is pinned: this file is what proves a new one. Both
 * stand on a flat plateau the fixture serves itself, in the app's own tile
 * batches, and the tests ask only what an analyst can see and what the backend
 * was told.
 */

/** A PNG of one colour, written by hand: the fixture needs no image library. */
function solidPng(size, [r, g, b]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([r, g, b]))]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// terrarium: height = R × 256 + G + B / 256 − 32768, so 128, 200, 0 is 200 m
const PLATEAU = solidPng(512, [128, 200, 0]);
const IMAGERY = solidPng(256, [52, 92, 48]);

/** The app's tile batches (`api/tile_batch.py`): index, status, length, then the tile. */
function batch(keys, tile) {
  return Buffer.concat(keys.map((_, index) => {
    const head = Buffer.alloc(8);
    head.writeUInt16LE(index, 0);
    head.writeUInt16LE(200, 2);
    head.writeUInt32LE(tile.length, 4);
    return Buffer.concat([head, tile]);
  }));
}

/** Answer the relief, the imagery in batches and the read-ahead, as the app would. */
async function serveRelief(page) {
  const keys = (route) => new URL(route.request().url()).searchParams.get('t').split(',');
  await page.route('**/api/terrain/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/terrain/sources') {
      return route.fulfill({ json: {
        tiles: '/api/terrain/tiles/{z}/{x}/{y}',
        tile_size: 512,
        max_zoom: 12,
        encoding: 'terrarium',
        sources: [{ id: 'mapterhorn', label: 'Mapterhorn', attribution: '© Mapterhorn', link: '' }],
      } });
    }
    if (path === '/api/terrain/batch') {
      return route.fulfill({ contentType: 'application/octet-stream', body: batch(keys(route), PLATEAU) });
    }
    if (path === '/api/terrain/elevation') return route.fulfill({ json: { elevation: 200 } });
    return route.fulfill({ contentType: 'image/png', body: PLATEAU });
  });
  await page.route('**/api/tiles/batch/**', (route) =>
    route.fulfill({ contentType: 'application/octet-stream', body: batch(keys(route), IMAGERY) })
  );
  await page.route('**/api/tiles/warm', (route) => route.fulfill({ json: { queued: 0 } }));
}

/** The view's address, as its parameters. */
const address = (page) => new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? '');
const tilt = (page) => page.locator('.relief-ctl .tilt');
/** The view leans once every relief tile is in, which a cold dev server takes a while to serve. */
const LEANS = { timeout: 15_000 };
const gridSeat = (page) => page.getByRole('button', { name: 'Grid Search', exact: true });

/** The map engine's former 3D rather than the globe, as the Classic button keeps it in this browser. */
const CLASSIC = (page) => page.addInitScript(() => localStorage.setItem('azimut.relief.classic', '1'));
/** The globe, drawn and placed (GlobeView keeps it unseen until then). */
const globe = (page) => page.locator('.globe:not(.waiting) canvas:not(.marks)');

async function openMap(page, hash = '#satellite', options = {}) {
  const fixture = await installAppFixture(page, options);
  await serveRelief(page);
  if (options.classic) await CLASSIC(page);
  await page.goto(`/${hash}`);
  await awaitMapReady(page);
  return fixture;
}

test('the 3D switch stands the map on its relief and leans it to read it', async ({ page }) => {
  await openMap(page);
  await expect(gridSeat(page)).toBeEnabled();
  await page.getByRole('button', { name: '3D', exact: true }).click();

  // relief seen straight down looks like the flat map, so the switch leans it
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);
  await expect.poll(() => address(page).get('t')).toBe('20');
  // the globe draws it, over the flat map and its scale; a grid has no straight-down cells to sweep
  await expect(globe(page)).toBeVisible();
  await expect(page.locator('.map')).toHaveClass(/\bunder-globe\b/);
  await expect(gridSeat(page)).toBeDisabled();

  // Page Up and Down lean it further and back, as in Horizon
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('PageUp');
  await expect(tilt(page)).toHaveText(/Tilt 30°/);
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await expect(tilt(page)).toHaveText(/Tilt 10°/);

  // and off again: the flat map, its scale bar and its grid
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.globe')).toHaveCount(0);
  await expect(page.locator('.map')).not.toHaveClass(/\bunder-globe\b/);
  await expect(page.locator('.map')).not.toHaveClass(/\btilted\b/);
  await expect(gridSeat(page)).toBeEnabled();
  await expect.poll(() => address(page).has('t')).toBe(false);
});

test('in the previous 3D view the map itself leans, with no one scale to show', async ({ page }) => {
  await openMap(page, '#satellite', { classic: true });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);
  await expect(page.locator('.globe')).toHaveCount(0);
  await expect(page.locator('.map')).toHaveClass(/\btilted\b/);
  await expect(page.locator('.relief-ctl .classic')).toHaveAttribute('aria-pressed', 'true');
});

test('the globe takes the camera where the flat map holds it and gives it back there', async ({ page }) => {
  await openMap(page, '#satellite?ll=46.6,7.9&z=13&b=30&p=esri-world-imagery');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);
  await expect(globe(page)).toBeVisible();
  // leaning swings the view round its centre: the centre, the zoom and the turn stay
  await expect.poll(() => ['ll', 'z', 'b'].map((key) => address(page).get(key))).toEqual(['46.6,7.9', '13', '30']);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.globe')).toHaveCount(0);
  await expect.poll(() => ['ll', 'z', 'b'].map((key) => address(page).get(key))).toEqual(['46.6,7.9', '13', '30']);
});

test('a drag on the globe turns the Earth under the hand, and nothing moves once it lets go', async ({ page }) => {
  await openMap(page, '#satellite?ll=46.6,7.9&z=13&t=40&e=200&p=esri-world-imagery');
  await expect(tilt(page)).toHaveText(/Tilt 40°/, LEANS);
  await expect(globe(page)).toBeVisible();
  const box = await globe(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 200, y, { steps: 10 });
  // held still before letting go: no fling
  await page.waitForTimeout(200);
  await page.mouse.up();
  // the ground moved left under the hand, so the view now looks further east
  await expect.poll(() => Number(address(page).get('ll')?.split(',')[1])).toBeGreaterThan(7.9);
  const settled = address(page).toString();
  await page.waitForTimeout(1500);
  expect(address(page).toString()).toBe(settled);
  // the turn and the tilt were the hand's to change, and it changed neither
  expect(address(page).get('t')).toBe('40');
});

test('a double click held turns the map, flat and in 3D, and one that stays put still zooms in', async ({ page }) => {
  await openMap(page, '#satellite?ll=46.6,7.9&z=13&p=esri-world-imagery');
  const map = await page.locator('.map').boundingBox();
  const x = map.x + map.width / 2, y = map.y + map.height / 2;
  /** Click, then press again on the same spot and drag through `points` before letting go. */
  const heldTurn = async (points) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down({ clickCount: 2 });
    for (const [px, py] of points) await page.mouse.move(px, py, { steps: 6 });
    await page.mouse.up({ clickCount: 2 });
  };

  // flat: a quarter of the way round the press turns the map, and zooms nothing
  await heldTurn([[x + 150, y], [x + 106, y + 106], [x, y + 150]]);
  await expect.poll(() => Number(address(page).get('b') ?? 0)).toBeGreaterThan(0);
  expect(address(page).get('z')).toBe('13');
  await page.mouse.dblclick(x, y);
  await expect.poll(() => address(page).get('z')).toBe('14');

  // on the globe: sideways turns round the ground pressed, and a still double click comes a level closer
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);
  await expect(globe(page)).toBeVisible();
  const turn = address(page).get('b');
  await heldTurn([[x + 160, y]]);
  await expect.poll(() => address(page).get('b')).not.toBe(turn);
  const zoom = Number(address(page).get('z'));
  await page.mouse.dblclick(x, y);
  await expect.poll(() => Number(address(page).get('z'))).toBeGreaterThan(zoom + 0.5);
});

test('Classic swaps the globe for the previous 3D view and back, the view kept', async ({ page }) => {
  await openMap(page, '#satellite?ll=46.6,7.9&z=13&p=esri-world-imagery');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(globe(page)).toBeVisible(LEANS);
  const classic = page.locator('.relief-ctl .classic');
  await classic.click();
  await expect(page.locator('.globe')).toHaveCount(0);
  await expect(classic).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => address(page).get('ll')).toBe('46.6,7.9');
  await classic.click();
  await expect(globe(page)).toBeVisible(LEANS);
  await expect.poll(() => address(page).get('ll')).toBe('46.6,7.9');
});

test('the 3D switch leans only once the relief under the view is in', async ({ page }) => {
  await openMap(page);
  // the relief held back: leaning now would tilt over sea level, and the whole
  // view would jump by the height of the ground when it landed
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/api/terrain/batch**', async (route) => {
    await held;
    await route.fallback();
  });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(tilt(page)).toHaveText(/Tilt 0°/);
  await page.waitForTimeout(1000);
  await expect(tilt(page)).toHaveText(/Tilt 0°/);
  release();
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);
});

test('the borders are OpenFreeMap’s lines, flat and on the globe, and Esri’s reference picture is never asked', async ({ page }) => {
  const { referenceTiles, placeNameTiles } = await openMap(page, '#satellite?ll=46.6,7.9&z=11&p=esri-world-imagery');
  await expect.poll(() => placeNameTiles.some((url) => url.endsWith('.pbf'))).toBe(true);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);
  await expect(globe(page)).toBeVisible();
  // the globe reads the same tiles for its ground, at its own address
  const lines = placeNameTiles.length;
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => placeNameTiles.length).toBeGreaterThan(lines);
  expect(referenceTiles.filter((url) => url.includes('World_Boundaries'))).toEqual([]);
});

/** Whether anything is drawn on the canvas the globe stands names and marks on. */
const marksDrawn = (page) => page.locator('.globe canvas.marks').evaluate((canvas) => {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
  return false;
});

test('the place names stand on the globe, and go with their switch', async ({ page }) => {
  await openMap(page, '#satellite?ll=46.6,7.9&z=12&t=30&e=200&p=esri-world-imagery', { placeNames: 'Qushayhi' });
  await expect(tilt(page)).toHaveText(/Tilt 30°/, LEANS);
  await expect(globe(page)).toBeVisible();
  await expect.poll(() => marksDrawn(page), { timeout: 15_000 }).toBe(true);
  await page.getByLabel('Place names', { exact: true }).click();
  await expect.poll(() => marksDrawn(page)).toBe(false);
});

test('an address with a tilt opens that view, its zoom to the hundredth and its centre’s height', async ({ page }) => {
  await openMap(page, '#satellite?ll=46.6,7.9&z=13.63&b=30&t=55&e=200&p=esri-world-imagery');
  await expect(tilt(page)).toHaveText(/Tilt 55°/, LEANS);
  // the view settles where it was asked, so its own address names it again
  await expect.poll(() => ['z', 'b', 't', 'e'].map((key) => address(page).get(key)))
    .toEqual(['13.63', '30', '55', '200']);
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a tilted capture files the picture with its tilt and exact zoom', async ({ page }) => {
  // reading the drawn picture waits for every tile, slow on a software renderer
  test.slow();
  // the default 1200 × 675 frame has to fit the map, or it is refused with the reason
  await page.setViewportSize({ width: 1600, height: 1000 });
  const filed = [];
  await openMap(page, '#satellite?ll=46.6,7.9&z=13.37&t=60&p=esri-world-imagery');
  await page.route('**/api/cases/*/satellite/oblique', (route) => {
    filed.push(route.request().postDataBuffer().toString('latin1'));
    return route.fulfill({ json: { path: 'media/tilted.png', title: 'Tilted', provider: 'esri-world-imagery' } });
  });
  await expect(tilt(page)).toHaveText(/Tilt 60°/, LEANS);
  await expect.poll(() => address(page).get('z')).toBe('13.37');

  await page.getByRole('button', { name: 'Capture options' }).click();
  // no deeper zoom to take and no one scale to mark on a tilted view
  await expect(page.getByText('A tilted view is filed as the map draws it on screen')).toBeVisible();
  await expect(page.getByText('Scale bar & north arrow')).toHaveCount(0);
  await page.getByRole('button', { name: 'Capture options' }).click();

  await page.locator('.capture-main').click();
  await expect.poll(() => filed.length, { timeout: 30_000 }).toBe(1);
  const field = (name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(filed[0])?.[1];
  expect(field('pitch')).toBe('60');
  expect(field('zoom')).toBe('13.37');
  expect(field('provider')).toBe('esri-world-imagery');
  expect(field('relief_fallback')).toBeUndefined();
  // the frame is centred on the view, so the centre's height goes with it
  expect(Number(field('elevation'))).toBeGreaterThan(0);
});

test('a tilted capture opens leaning as it was taken, a flat one straight down', async ({ page }) => {
  const row = (id, title, extra) => ({
    id, key: id, kind: 'capture', title, folder: '', notes: '', path: `media/${id}.png`, thumbnail: null,
    lat: 46.6, lon: 7.9, zoom: 14, bearing: 0, pitch: null, exaggeration: null, elevation: null, provider: 'Esri World Imagery',
    fetched_at: '2026-10-01T10:00:00Z', imagery_date: null, geo: null, continent: null, country_en: null,
    proofs: 0, relations: 0, status: 'confirmed', ...extra,
  });
  await openMap(page, '#satellite', {
    savedIndex: [
      row('cap-tilted', 'Tilted ridge', { zoom: 13.42, bearing: 120, pitch: 55, exaggeration: 1, elevation: 200 }),
      row('cap-flat', 'Flat quarry', { lat: 46.61, fetched_at: '2026-10-01T09:00:00Z' }),
    ],
  });
  const bar = page.getByRole('combobox', { name: 'Search a place or coordinates' });

  await bar.fill('tilted');
  await page.getByRole('option', { name: /Tilted ridge/ }).click();
  await expect(tilt(page)).toHaveText(/Tilt 55°/, LEANS);
  await expect.poll(() => ['z', 'b', 't', 'e'].map((key) => address(page).get(key)))
    .toEqual(['13.42', '120', '55', '200']);

  await bar.fill('quarry');
  await page.getByRole('option', { name: /Flat quarry/ }).click();
  await expect(tilt(page)).toHaveText(/Tilt 0°/);
  await expect.poll(() => address(page).get('t')).toBe('0');
});

test('a pan over relief across a layer\'s area opens no card, and a click on it still does', async ({ page }) => {
  const area = { type: 'Feature', id: 0, geometry: { type: 'Polygon',
    coordinates: [[[-170, -80], [170, -80], [170, 80], [-170, 80], [-170, -80]]] },
    properties: { name: 'Front line area', colour: '#d55e00', category: 'Areas', index: 0 } };
  const row = { name: 'areas', title: 'Areas map', source: { kind: 'file', name: 'areas.kmz' },
    features: 1, categories: [], icons: 0, sha256: 'b'.repeat(64), refresh: {}, hidden: [] };
  await installAppFixture(page);
  await serveRelief(page);
  // the analyst's layers are drawn on the globe, and a click on one reaches its card
  await page.route(`**/api/cases/${CASE_ID}/map-layers`, (route) => route.fulfill({ json: [row] }));
  await page.route(`**/api/cases/${CASE_ID}/map-layers/areas/data**`,
    (route) => route.fulfill({ json: { type: 'FeatureCollection', features: [area] } }));
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);
  await page.getByRole('button', { name: 'Areas map', exact: true }).click();
  await expect(globe(page)).toBeVisible();
  const map = await page.locator('.map').boundingBox();
  const x = map.x + map.width / 2, y = map.y + map.height / 2;
  const card = page.locator('.layer-card');

  // our own ground pan moves the camera, which made the engine forget the press
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(card).toHaveCount(0);

  await page.mouse.click(x, y);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Front line area');
});

for (const engine of ['globe', 'classic']) test(`the orbit stops at a massif behind the eye rather than climbing over it (${engine})`, async ({ page }) => {
  test.slow();
  // 3000 m: 35768 = 139 × 256 + 184
  const MASSIF = solidPng(512, [139, 184, 0]);
  // every tile wholly south of 46.6° is the massif, the view's own ground north of it the plateau
  const northEdge = (z, y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z)))) * (180 / Math.PI);
  const tileOf = (key) => {
    const [z, , y] = key.split('/').map(Number);
    return northEdge(z, y) <= 46.6 ? MASSIF : PLATEAU;
  };
  await installAppFixture(page);
  await serveRelief(page);
  if (engine === 'classic') await CLASSIC(page);
  await page.route('**/api/terrain/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/terrain/batch') {
      const keys = new URL(route.request().url()).searchParams.get('t').split(',');
      return route.fulfill({ contentType: 'application/octet-stream',
        body: Buffer.concat(keys.map((key, index) => batch([key], tileOf(key)).fill(index, 0, 1).fill(0, 1, 2))) });
    }
    const tile = path.match(/\/tiles\/(\d+\/\d+\/\d+)/);
    if (tile) return route.fulfill({ contentType: 'image/png', body: tileOf(tile[1]) });
    return route.fallback();
  });
  await page.goto('/#satellite?ll=46.66,7.9&z=13&t=20&e=200&p=esri-world-imagery');
  await awaitMapReady(page);
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);
  const map = await page.locator('.map').boundingBox();
  const x = map.x + map.width / 2, y = map.y + map.height / 2;
  // up leans the view toward the horizon, which lowers the eye onto the massif behind it
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  for (let step = 1; step <= 20; step += 1) await page.mouse.move(x, y - step * 14);
  await page.mouse.up({ button: 'middle' });
  await expect.poll(() => Number(address(page).get('t'))).toBeGreaterThan(30);
  // lifting the eye clear instead tilted on to 85°, slid the zoom and threw the
  // centre some 8 km south onto the massif
  expect(Number(address(page).get('t'))).toBeLessThan(85);
  expect(address(page).get('z')).toBe('13');
  if (engine === 'classic') expect(address(page).get('ll')).toBe('46.66,7.9');
  else {
    // the globe reads its centre where the middle of the screen meets the ground, which at
    // this tilt moves by metres as the heights there sharpen
    const [lat, lon] = address(page).get('ll').split(',').map(Number);
    expect(Math.abs(lat - 46.66)).toBeLessThan(1e-4);
    expect(Math.abs(lon - 7.9)).toBeLessThan(1e-4);
  }
});
