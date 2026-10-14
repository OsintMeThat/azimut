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
