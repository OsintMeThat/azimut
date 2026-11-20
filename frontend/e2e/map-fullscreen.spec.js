import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A map on the whole screen. In an exported page, opened from the disk: the map's button takes
 * the screen for its figure, its timeline and steps with it, the map laid again on its size,
 * and Esc gives the page back where it was. In the note: the map's card in Draw takes the
 * screen, its tabs and tools with it; Esc gives the screen back first, the line being drawn
 * keeping its corner, and a second Esc gives the line up. The server is stood in for.
 */

const ASSETS = new URL('../../src/azimut/engine/notes_html_assets/', import.meta.url);
const read = (name) => readFileSync(new URL(name, ASSETS), 'utf8');
const READER = read('reader.js').replace('  /* az:map */\n', read('reader.map.js'));
const CSS = read('reader.css') + read('reader.map.css');
const FIGURE = readFileSync(new URL('../src/lib/notes/mapFigure.fixture.html', import.meta.url), 'utf8');

function mapPage() {
  const words = '<p>What the footage does not show is outside this report.</p>\n'.repeat(18);
  return `<!doctype html>
<html lang="en" dir="auto" data-look="report" data-font="" data-edition="public">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Lead</title><style id="az-reader">${CSS}</style></head>
<body><header class="az-cover" data-cover="none"><h1 class="az-title">Lead</h1></header>
<div class="az-page"><main class="az-body" id="main">${words}
${FIGURE}
${words}<figure class="az-figure" data-kind="proof" id="fig-1"><figcaption>Heights</figcaption></figure></main></div>
<script>${READER.replace(/<\//g, '<\\/')}</script></body></html>`;
}

test('a map of an exported page takes the whole screen and gives the page back where it was', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the page');
  const refused = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue();
    refused.push(url);
    return route.abort();
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const file = testInfo.outputPath('report.html');
  writeFileSync(file, mapPage());
  await page.goto(`file://${file}`);
  const figure = page.locator('figure.az-map');
  await figure.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  const stage = figure.locator('.az-map-stage');
  const before = await stage.boundingBox();

  const button = figure.getByRole('button', { name: 'Full screen' });
  await expect(button).toHaveAttribute('title', 'The map on the whole screen');
  await button.click();
  await expect(figure).toHaveClass(/az-full/);
  expect(await page.evaluate(() => document.fullscreenElement?.id)).toBe('map-1');
  // the figure fills the screen, its map larger than on the page, its timeline and steps with it
  await expect.poll(async () => figure.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  // the map as tall as the screen, its timeline, steps and legend in a panel beside it
  const after = await stage.boundingBox();
  expect(after.height).toBeCloseTo(720 - 24, 0);
  expect(after.height).toBeGreaterThan(before.height);
  const side = figure.locator('.az-map-side');
  for (const part of ['.az-map-time', '.az-map-steps-row', '.az-map-legend']) await expect(side.locator(part)).toBeVisible();
  expect((await side.boundingBox()).x).toBeGreaterThan(after.x + after.width);
  // the drawing is laid again on its size: the whole map in the middle of the stage
  const world = await figure.locator('.az-map-world').boundingBox();
  expect(Math.abs((world.x + world.width / 2) - (after.x + after.width / 2))).toBeLessThan(2);
  expect(Math.abs((world.y + world.height / 2) - (after.y + after.height / 2))).toBeLessThan(2);
  await expect(figure.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('title', 'Back to the page (Esc)');

  await page.keyboard.press('Escape');
  await expect(figure).not.toHaveClass(/az-full/);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
  await expect.poll(async () => (await stage.boundingBox()).width).toBeCloseTo(before.width, 0);
  // what went with the map is back under it, in the page's order
  expect(await figure.evaluate((node) => [...node.children].map((child) => child.className || child.localName)))
    .toEqual(['az-map-frame', 'az-map-day', 'az-map-time', 'az-map-steps-row', 'az-map-step-said', 'az-map-legend', 'figcaption', 'az-map-data']);
  expect(refused).toEqual([]);
});

const BLOCK = ['::: map', 'title: The front', 'layer: Front line', 'ground: e_g1', 'view: 12.73976, 43.51350, 12.05', ':::'].join('\n');
const SVG = '<svg class="az-map-svg" viewBox="0 0 1600 1000" preserveAspectRatio="none"><g class="az-lines"><g class="az-f az-line"><path class="az-stroke" d="M300 600L900 560L1300 700" stroke="#1e88e5" stroke-width="3"/></g></g></svg>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const DESCRIBED = {
  title: 'The front', base: 'satellite', bounds: [43.4, 12.68, 43.6, 12.8], frame: [1600, 1000], extent: [43.45, 12.69, 43.57, 12.79],
  view: { center: [43.5, 12.74], zoom: 12, bearing: 0 },
  ground: { id: 'e_g1', path: 'media/ground.png', bounds: [43.4, 12.68, 43.6, 12.8] }, svg: SVG,
  layers: [{ name: 'Front line', title: 'Front line', from: 'line', on: true, colour: '', colours: ['#1e88e5'], features: 1, editable: true, own: false, missing: false }],
  others: [], drawings: [], proofs: { count: 0, first: '', last: '' }, days: ['2026-11-16'], day: '2026-11-16',
  steps: [], own_steps: false, palette: [], providers: [], warnings: [],
};

async function notebook(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { features: [] };
  const text = `# Lead\n\nSeen at the quay.\n\n${BLOCK}\n\nAfter.\n`;
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) => route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
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
    if (path === '/maps/describe') return route.fulfill({ json: DESCRIBED });
    if (path === '/maps/features') {
      state.features.push(request.postDataJSON());
      return route.fulfill({ json: { layer: 'Front line', key: 'k1' } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    if (path === '/n1') return route.fulfill({ json: request.method() === 'PUT' ? { status: 'saved' } : { text } });
    return route.fallback();
  });
  return state;
}

test('the map’s card in Draw takes the whole screen, and Esc gives it back before it gives up a line', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the card');
  await page.setViewportSize({ width: 1280, height: 720 });
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  const map = page.locator('.cm-map-block');
  await expect(map.locator('.cm-map-drawing svg')).toBeVisible();
  await map.getByRole('button', { name: 'Draw' }).click();
  const settings = map.getByRole('group', { name: 'Map settings' }).first();
  await expect(settings.getByRole('tab', { name: 'Draw' })).toHaveAttribute('aria-selected', 'true');
  const stage = map.locator('.cm-map-stage');
  const before = await stage.boundingBox();

  await map.getByRole('button', { name: 'Full screen' }).click();
  const card = map.locator('.cm-map-card');
  await expect(card).toHaveClass(/cm-map-full/);
  await expect.poll(async () => card.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  // its tabs, its tools and the line that says how to use them come along, the map taking the rest
  await expect(settings.getByRole('tab', { name: 'Draw' })).toBeVisible();
  await expect(map.locator('.cm-map-hint')).toBeVisible();
  await expect(map.locator('.cm-map-zoom')).toBeVisible();
  const after = await stage.boundingBox();
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.height).toBeGreaterThan(before.height * 1.2);

  // a line begun on the whole screen: its corner where it was pressed
  await settings.getByRole('button', { name: 'Line' }).click();
  await page.mouse.click(after.x + after.width * 0.3, after.y + after.height * 0.4);
  await expect(map.locator('.cm-map-corner')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(card).not.toHaveClass(/cm-map-full/);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(map.locator('.cm-map-corner'), 'the first Esc leaves the line as it was').toHaveCount(1);
  await expect(stage).toHaveAttribute('data-tool', 'line');
  await page.keyboard.press('Escape');
  await expect(map.locator('.cm-map-corner')).toHaveCount(0);
  await expect(stage).not.toHaveAttribute('data-tool', 'line');
  expect(state.features).toEqual([]);
});
