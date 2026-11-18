import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A map in a note: `/` › Interactive map puts one of the case's layers in the note, the
 * editor draws it as a card, and the Page pane's HTML view shows the map a reader moves:
 * a mark opens its card, the timeline walks the days. The server is stood in for; the
 * page is the reader with its map part, around the figure the engine writes
 * (`src/lib/notes/mapFigure.fixture.html`, held to the engine by `tests/test_notes_maps.py`).
 */

const ASSETS = new URL('../../src/azimut/engine/notes_html_assets/', import.meta.url);
const read = (name) => readFileSync(new URL(name, ASSETS), 'utf8');
const READER = read('reader.js').replace('  /* az:map */\n', read('reader.map.js'));
const CSS = read('reader.css') + read('reader.map.css');
const FIGURE = readFileSync(new URL('../src/lib/notes/mapFigure.fixture.html', import.meta.url), 'utf8');
const BLOCK = '::: map\ntitle: The line\nlayer: Front, north\nground: e_ground1\nview: 12.75000, 43.50000, 10\n:::';

function mapPage() {
  return `<!doctype html>
<html lang="en" dir="auto" data-look="report" data-font="" data-edition="internal">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Lead</title><style id="az-reader">${CSS}</style></head>
<body><header class="az-cover" data-cover="none"><h1 class="az-title">Lead</h1></header>
<div class="az-page"><main class="az-body" id="main"><p>Seen at the quay.</p>
${FIGURE}
<figure class="az-figure" data-kind="proof" id="fig-1"><figcaption>Heights</figcaption></figure></main></div>
<script>${READER.replace(/<\//g, '<\\/')}</script></body></html>`;
}

async function notebook(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { written: [], asked: [], previews: 0 };
  let text = '# Lead\n\nSeen at the quay.\n';
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: 'Seen at the quay.', words: 4,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/maps/sources') {
      return route.fulfill({ json: { layers: [{ name: 'Front, north', title: 'Front, north', features: 5, tracked: true }],
        plates: [], proofs: { count: 1, first: '2026-10-20', last: '2026-10-20' },
        providers: [{ id: 'esri-world-imagery', label: 'Esri World Imagery' }], provider: 'esri-world-imagery' } });
    }
    if (path === '/maps') {
      state.asked.push(request.postDataJSON());
      return route.fulfill({ json: { text: BLOCK, ground: { id: 'e_ground1' }, fresh: true, filed: ['e_ground1'], warnings: [] } });
    }
    if (path === '/html/preview') {
      state.previews += 1;
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mapPage(),
        headers: { 'X-Note-Warnings': '[]', 'X-Note-Warning-Kinds': '[]', 'X-Note-Diagrams': '[]' } });
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

test('a layer put as a map is drawn in the note, and moved and played in the Page pane’s HTML view', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the frame');
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('Seen at the quay.');

  // `/` › Interactive map, one layer picked, put at the cursor
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/interactive');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Interactive map');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Interactive map' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Put the map' })).toBeDisabled();
  await picker.getByRole('checkbox', { name: /Front, north/ }).check();
  await picker.getByRole('button', { name: 'Put the map' }).click();
  await expect(picker).toHaveCount(0);
  expect(state.asked.at(-1)).toEqual({ title: 'Front, north', layers: ['Front, north'], provider: 'esri-world-imagery' });
  await expect(page.getByText(/Put in “/)).toBeVisible();
  await expect(page.locator('.cm-block-map')).toContainText('The line');
  await expect(page.locator('.cm-block-map')).toContainText('Layer: Front, north');
  await expect.poll(() => state.written.at(-1) ?? '').toContain(BLOCK);

  // the Page pane's HTML view: the map in its sandboxed frame
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  const pane = page.locator('.page-pane');
  await pane.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'HTML' }).click();
  await expect.poll(() => state.previews).toBeGreaterThan(0);
  const frame = page.frameLocator('.html-page iframe:not([inert])');
  const map = frame.locator('figure.az-map');
  await expect(map.locator('.az-map-tools')).toBeVisible();
  await map.scrollIntoViewIfNeeded();

  // a press on a mark opens its card
  await map.locator('.az-f[data-id="l1f0"]').click();
  const card = map.locator('.az-map-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.az-map-card-title')).toHaveText('#1');
  await expect(card.getByRole('link', { name: 'Source: x.com ↗' })).toHaveAttribute('href', 'https://x.com/desk/status/1');
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toBeHidden();

  // the timeline walks back to the first day: the line in its first place, the vehicles not there yet
  const slider = map.getByRole('slider', { name: 'Day shown on the map' });
  await expect(map.locator('.az-map-now-day')).toHaveText('16 Nov 2026');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(map.locator('.az-map-now-day')).toHaveText('6 Oct 2026');
  await expect(map.locator('.az-f[data-id="l0f0"]')).not.toHaveClass(/az-off/);
  await expect(map.locator('.az-f[data-id="l1f0"]')).toHaveClass(/az-off/);
  await page.keyboard.press('ArrowRight');
  await expect(map.locator('.az-map-now-day')).toHaveText('14 Oct 2026');
  await expect(map.locator('.az-f[data-id="l0f0"]')).toHaveClass(/az-past/);
  expect(await frame.locator('html').evaluate(() => location.href)).toBe('about:srcdoc');
});
