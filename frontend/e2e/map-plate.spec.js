import { expect, test } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The plate routes, kept in memory over the shared fixture: what was saved, what
 * was exported, and the templates kept.
 */
async function plateFixture(page) {
  await installAppFixture(page);
  const store = { plates: new Map(), saves: [], exports: [], templates: [] };
  await page.route('**/api/templates', (route) => route.fulfill({ json: { proof: [], post: [], map: store.templates } }));
  await page.route('**/api/templates/map', async (route) => {
    const body = route.request().postDataJSON();
    const record = { id: body.id ?? `t${store.templates.length + 1}`, name: body.name, data: body.data };
    store.templates = [...store.templates.filter((item) => item.id !== record.id), record];
    await route.fulfill({ json: record });
  });
  await page.route(`**/api/cases/${CASE_ID}/map-plates**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const tail = path.split('/map-plates')[1];
    if (tail === '/export') {
      store.exports.push(request.postDataBuffer()?.toString('latin1') ?? '');
      return route.fulfill({ json: { file: 'Map plate.png', path: '/tmp/views', format: 'png' } });
    }
    if (tail === '' && request.method() === 'GET') {
      return route.fulfill({ json: [...store.plates.values()].map((saved) => ({ name: saved.title, title: saved.title, maps: 1, thumb: null })) });
    }
    if (tail === '' && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.rename_from) store.plates.delete(body.rename_from);
      store.plates.set(body.title, { title: body.title, spec: body.spec });
      store.saves.push(body);
      return route.fulfill({ json: { name: body.title, title: body.title, spec_path: `.mapplates/${body.title}.json`, thumb: null } });
    }
    if (tail.endsWith('/thumb')) return route.fulfill({ json: { thumb: null } });
    const saved = store.plates.get(decodeURIComponent(tail.slice(1)));
    return saved ? route.fulfill({ json: { name: saved.title, ...saved } }) : route.fulfill({ status: 404, json: { detail: 'plate not found' } });
  });
  return store;
}

const lastSave = (store) => store.saves.at(-1);

test('a new plate opens on the house layout and saves itself', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await expect(page.getByRole('heading', { name: 'Map plates' })).toBeVisible();
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  await expect.poll(() => store.saves.length).toBeGreaterThan(0);
  const kinds = lastSave(store).spec.elements.map((element) => element.kind);
  expect(kinds).toEqual(expect.arrayContaining(['map', 'legend', 'inset', 'scale', 'north', 'credits', 'text']));
  // a text added and written in the inspector is on the next save
  await page.locator('.adds button', { hasText: 'Text' }).click();
  await page.getByLabel('Text', { exact: true }).fill('Situation, as reported');
  await expect.poll(() => lastSave(store).spec.elements.some((element) => element.text === 'Situation, as reported')).toBe(true);
  // renamed in the header, it is saved under its new name
  const title = page.getByLabel('Plate name', { exact: true });
  await title.fill('Front, October');
  await title.press('Enter');
  await expect.poll(() => lastSave(store).title).toBe('Front, October');
});

test('the page zooms round the wheel, moves by a drag, and Fit brings it back', async ({ page }) => {
  await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  const paper = page.locator('.page');
  await expect(page.locator('.plate-map')).toHaveCount(2);
  const fitted = await paper.boundingBox();
  const viewport = await page.locator('.viewport').boundingBox();
  // a drag round the page moves it
  await page.mouse.move(viewport.x + 6, viewport.y + 6);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 66, viewport.y + 46, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await paper.boundingBox()).x).toBeCloseTo(fitted.x + 60, 0);
  // the wheel zooms round the pointer
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await paper.boundingBox()).width).toBeGreaterThan(fitted.width * 1.3);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect.poll(async () => (await paper.boundingBox()).width).toBeCloseTo(fitted.width, 0);
  await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeDisabled();
});

test('a framed map goes as far as the hand drags it', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect.poll(() => store.saves.length).toBeGreaterThan(0);
  const map = page.locator('.plate-map').first();
  const box = await map.boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.plate-map.live')).toHaveCount(1);
  const mainOf = (spec) => spec.elements.find((element) => element.kind === 'map').view;
  const before = mainOf(lastSave(store).spec);
  const scale = parseInt(await page.locator('.zoom-value').textContent(), 10) / 100;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 15 });
  await page.mouse.up();
  // 150 screen pixels are 150 / scale pixels of the map: the ground follows the whole drag
  const expected = ((150 / scale) * 360) / (512 * 2 ** before.zoom);
  await expect.poll(() => mainOf(lastSave(store).spec).lon - before.lon).toBeGreaterThan(expected * 0.8);
});

test('an element moves by the keyboard, goes with Delete, and Undo brings it back', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await page.locator('.list button', { hasText: 'Legend' }).click();
  await expect(page.getByRole('heading', { name: 'Legend', exact: true })).toBeVisible();
  const before = await page.locator('.hit.selected').boundingBox();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await page.locator('.hit.selected').boundingBox()).x).toBeGreaterThan(before.x);
  await page.keyboard.press('Delete');
  await expect(page.locator('.list button', { hasText: 'Legend' })).toHaveCount(0);
  await expect.poll(() => lastSave(store)?.spec.elements.some((element) => element.kind === 'legend')).toBe(false);
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect(page.locator('.list button', { hasText: 'Legend' })).toHaveCount(1);
});

test('the credits stay on the page, and the export writes the page', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await page.locator('.list button', { hasText: 'Credits' }).click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // a plate with no layer followed over time has no days to play
  await expect(dialog.getByText('Needs a layer followed over time on the plate.').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Screen · 150 dpi' }).click();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => store.exports.length, { timeout: 30_000 }).toBe(1);
  expect(store.exports[0]).toContain('name="format"\r\n\r\npng');
  await expect(page.getByText('Map plate.png written')).toBeVisible();
});

test('a plate kept as a template starts the next one', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await page.getByLabel('Paper', { exact: true }).selectOption('screen');
  await page.getByRole('button', { name: 'Keep as template' }).click();
  await page.getByLabel('Template name').fill('Slide');
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect.poll(() => store.templates.length).toBe(1);
  const kept = store.templates[0].data;
  expect(kept.page.paper).toBe('screen');
  // no case's data in it
  expect(kept.elements.find((element) => element.kind === 'map').view).toBeUndefined();
  await page.getByRole('button', { name: 'Back to the plates' }).click();
  await page.locator('.tile.template', { hasText: 'Slide' }).click();
  await expect.poll(() => lastSave(store)?.spec.page.paper).toBe('screen');
});

test('a day plays its steps, and a step plays a video of the case', async ({ page }) => {
  const store = await plateFixture(page);
  const strike = { path: 'media/strike.mp4', title: 'Strike', kind: 'video', thumbnail: null,
    source: { type: 'download', uploader: 'GeoWatch', webpage_url: 'https://x.com/geo/status/1', upload_date: '20261012' } };
  await page.route(`**/api/cases/${CASE_ID}/media/page**`, (route) => route.fulfill({ json: { items: [strike], next_cursor: null, total: 1, facets: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/media/item**`, (route) => route.fulfill({ json: strike }));
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  // a plate with no layer followed over time still takes steps
  await page.locator('.add-step').click();
  const tiles = page.locator('.steps [role="option"]');
  await expect(tiles).toHaveCount(2);
  await expect(page.locator('.on-step')).toHaveText('Step 1: what you add belongs to it');
  await page.locator('.adds button', { hasText: 'Text' }).click();
  await page.getByLabel('Text', { exact: true }).fill('First strike');
  await expect.poll(() => {
    const spec = lastSave(store)?.spec;
    return !!spec && spec.elements.find((element) => element.text === 'First strike')?.step === spec.steps?.now?.[0]?.id;
  }).toBe(true);
  await expect(page.locator('.list .tag.step')).toHaveCount(1);
  // the day itself leaves the step's text out
  await tiles.first().click();
  await expect(page.locator('.on-step')).toHaveCount(0);
  await expect(page.locator('.list .row', { hasText: 'First strike' })).toHaveCount(0);
  // a video goes on a step of its own, after the last, and says where it comes from
  await page.locator('.adds button', { hasText: 'Video' }).click();
  await expect(tiles).toHaveCount(3);
  await page.getByRole('button', { name: 'Choose a video' }).click();
  await page.locator('.float-menu button[title="Strike"]').click();
  await expect(page.getByLabel('Source line', { exact: true })).toHaveValue('GeoWatch · x.com · 12 October 2026');
  await expect.poll(() => {
    const spec = lastSave(store)?.spec;
    const video = spec?.elements.find((element) => element.kind === 'video');
    return video && [video.src, video.step === spec.steps.now[1].id, video.clip];
  }).toEqual(['media/strike.mp4', true, [0, 10]]);
  // the MP4 is the page, then each step, the video running over its own
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[value="mp4"]').check();
  await expect(dialog.getByText(/Runs 0:1\d/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => store.exports.length, { timeout: 60_000 }).toBe(1);
  expect(store.exports[0]).toContain('name="beats"');
  expect(store.exports[0]).toContain('"src":"media/strike.mp4"');
  expect(store.exports[0]).toContain('name="overs"');
});
