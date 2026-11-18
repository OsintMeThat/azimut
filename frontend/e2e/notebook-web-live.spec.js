import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { vendorFiles } from '../src/lib/notes/maplibreVendor.js';

/**
 * A web folder's map read online: the folder served by a small site of its own, as GitHub
 * Pages would serve it (a site rather than a route, since a route does not see what MapLibre's
 * worker asks the folder for), under the policy the engine gives a page with a live map
 * (`liveFolder.fixture.json`, held to `engine/notes_web.py` by `tests/test_notes_live.py`),
 * MapLibre loaded from the folder as the build copies it. OpenFreeMap is routed to fixtures,
 * a small style and plain tiles, and every other host refused. The drawing shows first; the
 * live map takes its place once it has drawn, and the timeline filters it by day. The page's
 * policy refuses nothing.
 */

const ASSETS = new URL('../../src/azimut/engine/notes_html_assets/', import.meta.url);
const read = (name) => readFileSync(new URL(name, ASSETS), 'utf8');
const READER = read('reader.js').replace('  /* az:map */\n', read('reader.map.js'));
const CSS = read('reader.css') + read('reader.map.css') + read('reader.live.css');
const LIVE = JSON.parse(readFileSync(new URL('../src/lib/notes/liveFolder.fixture.json', import.meta.url), 'utf8'));
const FIGURE = readFileSync(new URL('../src/lib/notes/mapFigure.fixture.html', import.meta.url), 'utf8');
const MAPLIBRE = dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json'));
const VENDOR = vendorFiles((path) => readFileSync(join(MAPLIBRE, path), 'utf8'));
const BASE = `assets/maplibre-${VENDOR.VERSION.trim()}`;
const FOLDER = '/articles/front/';

/** The figure as a folder holds it: its ground a file beside the page, not a data address. */
const GROUND = /src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(FIGURE);
const FOLDER_FIGURE = FIGURE.replace(GROUND[0], 'src="assets/ground.png"');
const PNG = Buffer.from(GROUND[1], 'base64');

function folderPage(style) {
  return `<!doctype html>
<html lang="en" dir="auto" data-look="report" data-font="" data-edition="public">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${LIVE.csp}">
<title>The front</title>
<script type="application/json" id="az-gl">${JSON.stringify({ module: 'assets/reader-live.js', maplibre: `${BASE}/maplibre-gl.js`, css: `${BASE}/maplibre-gl.css`, style })}</script>
<link rel="stylesheet" id="az-reader" href="assets/reader.css"></head>
<body><header class="az-cover" data-cover="none"><h1 class="az-title">The front</h1></header>
<div class="az-page"><main class="az-body" id="main"><p>The line moved twice.</p>
${FOLDER_FIGURE}
<figure class="az-figure" data-kind="proof" id="fig-1"><figcaption>Heights</figcaption></figure></main></div>
<script src="assets/reader.js"></script></body></html>`;
}

let site;
let origin;
const asked = [];

test.beforeAll(async () => {
  site = createServer((request, response) => {
    const path = new URL(request.url, 'http://x').pathname;
    asked.push(path);
    const files = {
      '': ['text/html; charset=utf-8', folderPage(LIVE.style)],
      'assets/reader.js': ['text/javascript', READER],
      'assets/reader.css': ['text/css', CSS],
      'assets/reader-live.js': ['text/javascript', read('reader.live.js')],
      'assets/ground.png': ['image/png', PNG],
      ...Object.fromEntries(Object.entries(VENDOR).map(([name, text]) => [`${BASE}/${name}`, [name.endsWith('.css') ? 'text/css' : 'text/javascript', text]])),
    };
    const file = path.startsWith(FOLDER) ? files[path.slice(FOLDER.length)] : null;
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': file[0] }).end(file[1]);
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${site.address().port}`;
});

test.afterAll(() => new Promise((resolve) => site.close(resolve)));

/** OpenFreeMap as the test answers it: a land colour, plain shaded tiles under it; any other host refused. */
async function routeTiles(page, routed) {
  const style = {
    version: 8,
    sources: { shade: { type: 'raster', tiles: [`${LIVE.host}/natural_earth/ne2sr/{z}/{x}/{y}.png`], tileSize: 256, maxzoom: 6 } },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ece6da' } },
      { id: 'shade', type: 'raster', source: 'shade', paint: { 'raster-opacity': 0.4 } }],
  };
  const open = { 'Access-Control-Allow-Origin': '*' };
  await page.route((url) => url.origin !== origin, (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== LIVE.host) return route.abort();
    if (url.pathname === '/styles/liberty') return route.fulfill({ status: 200, contentType: 'application/json', headers: open, body: JSON.stringify(style) });
    if (url.pathname.endsWith('.png')) {
      routed.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'image/png', headers: open, body: PNG });
    }
    return route.fulfill({ status: 404, headers: open, body: '' });
  });
}

test('a web folder’s map goes live online, over the base map, and its timeline filters it by day', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser draws WebGL on every runner');
  const refused = [];
  page.on('console', (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text()); });
  const hosts = new Set();
  page.on('request', (request) => hosts.add(new URL(request.url()).origin));
  const tiles = [];
  await routeTiles(page, tiles);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${origin}${FOLDER}`);
  const figure = page.locator('figure.az-map');
  // the drawing first, then the live map in its place
  await expect(figure.locator('.az-map-stage svg.az-map-svg')).toBeVisible();
  await expect(figure.locator('.az-gl.az-on')).toBeVisible({ timeout: 20_000 });
  await expect(figure).toHaveClass(/az-gl-on/);
  const drawn = (layers) => page.evaluate((ids) => {
    const { map } = document.querySelector('figure.az-map').azLive;
    return [...new Set(map.queryRenderedFeatures({ layers: ids }).map((one) => `${one.layer.id}:${one.properties.id}`))].sort();
  }, layers);
  const lines = () => drawn(['az-line', 'az-line-halo', 'az-past-line']);
  // the map's own day: the line gone but faint where it last stood, the proof, and the two
  // vehicles a few metres apart spread over the map with a leader to each
  await expect.poll(lines).toEqual(['az-past-line:l0f0s1']);
  await expect.poll(() => drawn(['az-points'])).toContain('az-points:p0');
  await expect(figure.locator('.az-gl-over .az-f')).toHaveCount(2);
  // 14 October: the moved line where it stood then, its first place faint, no mark yet
  const slider = figure.locator('.az-map-time input[type="range"]');
  await slider.fill('1');
  await expect(figure.locator('.az-map-now-day')).toHaveText('14 Oct 2026');
  await expect.poll(lines).toEqual(['az-line-halo:l0f0s1', 'az-line:l0f0s1', 'az-past-line:l0f0']);
  await expect.poll(() => drawn(['az-points'])).toEqual([]);
  await expect(figure.locator('.az-gl-over .az-f')).toHaveCount(0);
  // a press on the line opens the reader's own card (the page scrolls smoothly: the map is held still first)
  const at = await page.evaluate(() => {
    document.querySelector('figure.az-map').scrollIntoView({ block: 'start', behavior: 'instant' });
    const { map } = document.querySelector('figure.az-map').azLive;
    const point = map.project([43.51, 12.74]);
    const box = map.getCanvas().getBoundingClientRect();
    return { x: box.left + point.x, y: box.top + point.y };
  });
  await page.mouse.click(at.x, at.y);
  await expect(figure.locator('.az-map-card .az-map-card-title')).toHaveText('Forward line');
  // MapLibre and its worker came from the folder, the base map from OpenFreeMap, and nothing else
  expect([...hosts].filter((one) => one !== 'null').sort()).toEqual([origin, LIVE.host].sort());
  for (const name of ['maplibre-gl.js', 'maplibre-gl-shared.js', 'maplibre-gl-worker.js', 'maplibre-gl.css']) expect(asked).toContain(`${FOLDER}${BASE}/${name}`);
  expect(tiles.length).toBeGreaterThan(0);
  expect(refused).toEqual([]);
});
