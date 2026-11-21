import { test, expect } from '@playwright/test';
import { CASE_ID, expectChoicesWhole, installAppFixture } from './app.fixture.js';

/**
 * An infographic's map panel, set in the builder: a press on the map panel of the page drawn in
 * the note opens the builder with the map's own settings card under its row, its map drawn. A
 * layer turned off, then another base filed on its press, are each written in the panel's lines
 * inside the page, and one Undo takes each back. The server is stood in for.
 */

const FIGURES = ['::: chart', 'kind: key figures', '| Figure | Words |', '| --- | --- |', '| 51 of 54 | placed |', ':::'].join('\n');
const MAP = ['::: map', 'title: Where they lie', 'layer: Front line', 'layer: Vehicles', 'ground: e_g1', 'frame: 43.45, 12.68, 43.56, 12.77',
  'north: on', ':::'].join('\n');
const BLOCK = `:::: infographic\ntitle: At least 60 vehicles lost\n\n${FIGURES}\n\n${MAP}\n::::`;
const TEXT = `# Lead\n\nSeen at the quay.\n\n${BLOCK}\n\nAfter.\n`;
const SVG = '<svg class="az-map-svg" viewBox="0 0 1600 1000" preserveAspectRatio="none"><g class="az-lines"><g class="az-f az-line"><path class="az-stroke" d="M300 600L900 560L1300 700" stroke="#1e88e5" stroke-width="3"/></g></g></svg>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** The page the route draws: key figures across, the map under them, a box each. */
function drawing() {
  return {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900"><rect width="1200" height="900" fill="#fff"/></svg>',
    width: 1200, height: 900, title: 'At least 60 vehicles lost', look: 'report', legend: { column: '', values: [] }, credit: 'our register',
    alt: '', warnings: [],
    panels: [
      { index: 0, kind: 'chart', chart: 'key figures', title: '', width: 'wide', x: 48, y: 120, w: 1104, h: 160 },
      { index: 1, kind: 'map', chart: '', title: 'Where they lie', width: 'half', x: 48, y: 320, w: 540, h: 480 },
    ],
  };
}

function described(text) {
  const hidden = /hide: Front line/.test(text);
  return {
    title: 'Where they lie', base: /base: map/.test(text) ? 'map' : 'satellite',
    bounds: [43.45, 12.68, 43.56, 12.77], frame: [1600, 1000], extent: [43.46, 12.69, 43.55, 12.76],
    view: { center: [43.5, 12.73], zoom: 12, bearing: 0 },
    ground: { id: 'e_g1', path: 'media/ground.png', bounds: [43.4, 12.6, 43.6, 12.8] }, svg: hidden ? SVG.replace(/<g class="az-lines">.*<\/g><\/g>/, '') : SVG,
    layers: [
      { name: 'Front line', title: 'Front line', from: 'line', on: !hidden, colour: '', colours: ['#1e88e5'], features: 1, editable: true, own: false, missing: false },
      { name: 'Vehicles', title: 'Vehicles', from: 'line', on: true, colour: '', colours: ['#e53935'], features: 54, editable: true, own: false, missing: false },
    ],
    others: [], drawings: [], proofs: { count: 0, first: '', last: '' }, days: ['2026-11-16'], day: '2026-11-16',
    steps: [], own_steps: false, palette: [], providers: [], warnings: [],
  };
}

async function notebook(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { written: [], grounds: [], described: [] };
  let text = TEXT;
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  await page.route(`**/files/${CASE_ID}/media/ground.png`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: 'Seen at the quay.', words: 4,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/infographic') return route.fulfill({ json: drawing() });
    if (path === '/maps/describe') {
      state.described.push(request.postDataJSON().text);
      return route.fulfill({ json: described(request.postDataJSON().text) });
    }
    if (path === '/maps/ground') {
      state.grounds.push(request.postDataJSON());
      return route.fulfill({ json: { ground: 'e_osm', details: [], view: '12.72500, 43.50500, 12.4', filed: ['e_osm'], base: 'map' } });
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

/** The map panel's lines, inside the infographic, as last saved. */
function panelOf(written) {
  const page = /^:::: infographic\n[\s\S]*?\n::::$/m.exec(String(written ?? ''))?.[0] ?? '';
  return /^::: map\n[\s\S]*?\n:::$/m.exec(page)?.[0] ?? '';
}

test('a press on an infographic’s map panel opens the map’s own card, each choice written in the panel as one Undo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the card');
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  const hit = page.locator('.cm-block-infographic .cm-ig-hit[data-ig-panel="1"]');
  await expect(hit).toHaveAttribute('aria-label', 'Where they lie · Map · Half · press to edit');

  // the press opens the builder, the map's card under its row, its map drawn from the panel's own lines
  await hit.click();
  const builder = page.getByRole('complementary', { name: 'Infographic builder' });
  await expect(builder.getByRole('button', { name: /^Where they lie/ })).toHaveAttribute('aria-expanded', 'true');
  const card = builder.getByRole('group', { name: 'Map settings' });
  await expect(card.getByRole('tab', { name: 'Look' })).toHaveAttribute('aria-selected', 'true');
  await expect(builder.locator('.ib-map .cm-map-drawing svg')).toBeVisible();
  expect(state.described[0]).toBe(MAP);
  await expect(card.getByText('Set on its row above: Half or Wide.')).toBeVisible();
  await expect(card.getByRole('radiogroup', { name: 'Size' })).toHaveCount(0);
  // the builder's column is narrow: a row of choices too wide for it wraps, none is cut
  await expectChoicesWhole(card);

  // a layer off: its line in the panel, the note's other lines as they were, one Undo
  await card.getByRole('tab', { name: 'Layers' }).click();
  await card.getByRole('checkbox', { name: 'Show Front line' }).uncheck();
  const hidden = MAP.replace('ground: e_g1', 'ground: e_g1\nhide: Front line');
  await expect.poll(() => panelOf(state.written.at(-1))).toBe(hidden);
  expect(state.written.at(-1)).toBe(TEXT.replace(MAP, hidden));
  await expect(card.getByRole('checkbox', { name: 'Show Front line' })).not.toBeChecked();
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => panelOf(state.written.at(-1))).toBe(MAP);
  await expect(card.getByRole('checkbox', { name: 'Show Front line' })).toBeChecked();

  // another base: filed on its press from the panel's lines, then written as one step, one Undo
  await card.getByRole('tab', { name: 'Look' }).click();
  await card.getByRole('radio', { name: 'Map', exact: true }).click();
  await expect.poll(() => state.grounds.length).toBe(1);
  expect(state.grounds[0]).toEqual({ text: MAP, base: 'map' });
  const based = MAP.replace('ground: e_g1', 'ground: e_osm\nview: 12.72500, 43.50500, 12.4\nbase: map');
  await expect.poll(() => panelOf(state.written.at(-1))).toBe(based);
  await expect(card.getByRole('radio', { name: 'Map', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => panelOf(state.written.at(-1))).toBe(MAP);
  expect(state.written.at(-1)).toBe(TEXT);
});
