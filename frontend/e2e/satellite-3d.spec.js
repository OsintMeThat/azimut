import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * The 3D map, driven in a real browser.
 *
 * The relief's gestures reach into the engine's own camera (`lib/map/relief.js`),
 * which is why the engine's version is pinned: this file is what proves a new
 * one. It stands the map on a flat plateau the fixture serves itself, in the
 * app's own tile batches, and asks only what an analyst can see and what the
 * backend was told.
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

async function openMap(page, hash = '#satellite', options = {}) {
  const fixture = await installAppFixture(page, options);
  await serveRelief(page);
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
  // a tilted view has no one scale, and a grid has no straight-down cells to sweep
  await expect(page.locator('.map')).toHaveClass(/\btilted\b/);
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
  await expect(page.locator('.map')).not.toHaveClass(/\btilted\b/);
  await expect(gridSeat(page)).toBeEnabled();
  await expect.poll(() => address(page).has('t')).toBe(false);
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

test('over relief the borders are lines, not Esri’s picture with its printed names', async ({ page }) => {
  const { referenceTiles, placeNameTiles } = await openMap(page);
  await expect.poll(() => referenceTiles.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(tilt(page)).toHaveText(/Tilt 20°/, LEANS);

  // new ground asks OpenFreeMap for its lines and Esri for nothing
  const pictures = referenceTiles.length;
  const lines = placeNameTiles.length;
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect.poll(() => placeNameTiles.length).toBeGreaterThan(lines);
  expect(referenceTiles.length).toBe(pictures);

  // flat again, Esri's picture is back
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect.poll(() => referenceTiles.length).toBeGreaterThan(pictures);
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
