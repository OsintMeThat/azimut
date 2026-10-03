import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';
import { foldTerms, foldText } from '../src/lib/textFold.js';

const SECOND_CASE = 'browser-airfield';
const CASES = [
  { id: CASE_ID, name: 'Harbour', scratch: false, folders: [] },
  { id: SECOND_CASE, name: 'Airfield', scratch: false, folders: [] },
];

async function start(page, options = {}, tool = 'media') {
  const fixture = await installAppFixture(page, options);
  await page.route('**/api/cases/entity-types', (route) => route.fulfill({ json: [
    { type: 'proof', label: 'Proof', family: 'document', icon: 'proof', attrs: [] },
    { type: 'sheet', label: 'Sheet', family: 'document', icon: 'table', attrs: [] },
    { type: 'note', label: 'Note', family: 'document', icon: 'note', attrs: [] },
    { type: 'media', label: 'Media', family: 'collected', icon: 'media', attrs: [] },
  ] }));
  await page.route(`**/api/cases/${SECOND_CASE}/media/page*`, (route) => route.fulfill({
    json: { items: [], total: 0, next_cursor: null, facets: {} },
  }));
  await page.route('**/api/cases?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const terms = foldTerms(params.get('q') ?? '');
    const cases = options.cases ?? [{ id: CASE_ID, name: 'Browser Test', scratch: false }];
    return route.fulfill({ json: cases.filter((item) => terms.every((term) => foldText(item.name).includes(term))).slice(0, 8) });
  });
  await page.goto(`/#${tool}`);
  if (tool === 'media') {
    await expect(page.getByPlaceholder('Paste a link (X, Telegram, YouTube…)')).toBeVisible({ timeout: 15_000 });
  }
  return fixture;
}

const dialog = (page) => page.getByRole('dialog', { name: 'Go to', exact: true });
const search = (page) => dialog(page).getByRole('combobox');

async function find(page, term) {
  await page.keyboard.press('Control+k');
  await expect(search(page)).toBeFocused();
  await search(page).fill(term);
}

test('Ctrl+K reads only on opening and reaches a tool with the keyboard', async ({ page }) => {
  const calls = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cases' && url.searchParams.get('limit') === '8') calls.push(url);
  });
  const fixture = await start(page);
  expect(calls).toHaveLength(0);
  await find(page, 'Reverse Search');
  await expect(dialog(page).getByRole('option', { name: /Reverse Search/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tabstrip').getByRole('button', { name: 'Reverse Search' })).toHaveAttribute('aria-current', 'page');
  await expect(dialog(page)).toBeHidden();
  expect(calls.length).toBeGreaterThan(0);
  fixture.expectNoUnexpectedRequests();
});

test('Command+K works in a field, and Escape preserves it and returns focus', async ({ page }) => {
  const fixture = await start(page);
  const field = page.getByPlaceholder('Paste a link (X, Telegram, YouTube…)');
  await field.fill('https://example.test/unfinished');
  await page.keyboard.press('Meta+k');
  await expect(search(page)).toBeFocused();
  await search(page).fill('some query');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('https://example.test/unfinished');
  await page.getByRole('button', { name: 'Go to', exact: true }).click();
  await expect(search(page)).toHaveValue('');
  await page.keyboard.press('Escape');
  fixture.expectNoUnexpectedRequests();
});

test('a document result opens its sheet and participates in browser history', async ({ page }) => {
  const fixture = await start(page, {
    sheets: [['Geolocation index', ['Subject', 'Status'], [['Quay', 'To check']]]],
    catalog: [{ id: 'sheet-1', type: 'sheet', label: 'Geolocation index', attrs: { path: 'sheets/index.csv' } }],
  });
  await find(page, 'Geolocation index');
  await dialog(page).getByRole('option', { name: /Geolocation index/ }).click();
  await expect(page.getByRole('grid', { name: 'Sheet rows' })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/#sheet\?sheet=sheet-1$/);
  await page.goBack();
  await expect(page.locator('.tabstrip').getByRole('button', { name: 'Media', exact: true })).toHaveAttribute('aria-current', 'page');
  fixture.expectNoUnexpectedRequests();
});

test('a case result changes the case and opens its overview', async ({ page }) => {
  const fixture = await start(page, { cases: CASES });
  await page.route(`**/api/cases/${SECOND_CASE}/notes`, (route) => route.fulfill({ json: { text: '' } }));
  await find(page, 'Airfield');
  await dialog(page).getByRole('option', { name: /Airfield/ }).click();
  await expect(page.getByTitle('Switch case')).toContainText('Airfield');
  await expect(page).toHaveURL(/#overview$/);
  fixture.expectNoUnexpectedRequests();
});

async function proofCase(page) {
  const proofs = { 'proof-a': 'Proof A', 'proof-b': 'Proof B' };
  const catalog = Object.entries(proofs).map(([name, label]) => ({
    id: `${name}-entity`, type: 'proof', label, attrs: { spec: `proofs/.meta/${name}.json` },
  }));
  const fixture = await start(page, {
    cases: CASES, catalog,
    lookupEntities: Object.fromEntries(catalog.map((entity) => [entity.attrs.spec, entity])),
  });
  await page.route(`**/api/cases/${CASE_ID}/proofs/*`, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    if (route.request().method() !== 'GET' || !proofs[name]) return route.fallback();
    return route.fulfill({ json: { title: proofs[name], panels: [], pastes: [], shapes: [] } });
  });
  await find(page, 'Proof A');
  await dialog(page).getByRole('option', { name: /Proof A/ }).click();
  const title = page.getByRole('textbox', { name: 'Proof name' });
  await expect(title).toHaveValue('Proof A', { timeout: 15_000 });
  await title.fill('Proof A revised');
  await expect(page.locator('.tool-header .badge', { hasText: 'unsaved' })).toBeVisible();
  return { fixture, title };
}

test('opening another proof retains its existing unsaved-work confirmation', async ({ page }) => {
  const { fixture, title } = await proofCase(page);
  await find(page, 'Proof B');
  await dialog(page).getByRole('option', { name: /Proof B/ }).click();
  const ask = page.getByRole('alertdialog', { name: 'Leave this proof?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(title).toHaveValue('Proof A revised');
  fixture.expectNoUnexpectedRequests();
});

test('changing case asks before discarding a proof, with cancellation keeping the work', async ({ page }) => {
  const { fixture, title } = await proofCase(page);
  await find(page, 'Airfield');
  await dialog(page).getByRole('option', { name: /Airfield/ }).click();
  const ask = page.getByRole('alertdialog', { name: 'Change case?' });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(ask).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ask).toBeHidden();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(title).toHaveValue('Proof A revised');
  await expect(page.getByTitle('Switch case')).toContainText('Harbour');
  fixture.expectNoUnexpectedRequests();
});

test('the topbar case switcher uses the same unsaved-work guard', async ({ page }) => {
  const { fixture, title } = await proofCase(page);
  await page.getByTitle('Switch case').click();
  await page.locator('.switcher .list').getByRole('button', { name: /Airfield/ }).click();
  const ask = page.getByRole('alertdialog', { name: 'Change case?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(title).toHaveValue('Proof A revised');
  await expect(page.getByTitle('Switch case')).toContainText('Harbour');
  fixture.expectNoUnexpectedRequests();
});

test('accented case searches work in the palette and in the case switcher', async ({ page }) => {
  const cases = [...CASES, { id: 'study', name: 'Étude du port', scratch: false },
    ...['One', 'Two', 'Three', 'Four'].map((name) => ({ id: name.toLowerCase(), name, scratch: false }))];
  const fixture = await start(page, { cases });
  await find(page, 'port etude');
  await expect(dialog(page).getByRole('option', { name: /Étude du port/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTitle('Switch case').click();
  await page.getByPlaceholder('Find a case…').fill('port etude');
  await expect(page.locator('.switcher .list').getByRole('button', { name: /Étude du port/ })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('the palette fits a narrow window and keeps Tab inside', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const fixture = await start(page);
  await find(page, 'reverse');
  await expect(dialog(page).getByRole('option', { name: /Reverse Search/ })).toBeVisible();
  await expect(dialog(page).getByRole('option')).toHaveCount(1);
  const bounds = await dialog(page).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
  await search(page).press('Shift+Tab');
  await expect(dialog(page).getByRole('option', { name: /Reverse Search/ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(search(page)).toBeFocused();
  await page.screenshot({ path: `/tmp/azimut-palette-narrow-${test.info().project.name}.png` });
  fixture.expectNoUnexpectedRequests();
});
