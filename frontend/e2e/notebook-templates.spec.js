import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * A Notebook template started from a ready one, from Settings' New template menu:
 * it opens in the Notebook with a first page of its own above the end-of-cover
 * line, drawn as it will read (the app's logo, the title and the day as words,
 * the guidance in grey), and the Page pane's first page is that cover.
 *
 * The server's PDF is stood in for: page 1 says the cover's title when the look
 * asks for the analyst's own page, so PDF.js draws a real first page here.
 */

const at = '2026-10-01T10:00:00Z';
const LOGO = new URL('../../src/azimut/assets/brand/azimut.svg', import.meta.url).pathname;

async function setUp(page) {
  await installAppFixture(page, { catalog: [] });
  const state = { templates: [], saved: [], previews: [] };
  await page.route('**/api/notes/fonts', (route) => route.fulfill({ json: { fonts: [] } }));
  await page.route('**/api/notes/pictures/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'logo') return route.fulfill({ path: LOGO, contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-cache' } });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: [], next_cursor: null, total: 0 } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), (route) => {
    const path = new URL(route.request().url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '/index') return route.fulfill({ json: { items: [] } });
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    return route.fallback();
  });
  await page.route('**/api/templates**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/templates/note/preview') {
      const body = request.postDataJSON();
      state.previews.push(body);
      const own = body.look?.cover?.on && body.look?.cover?.mode === 'own';
      return pdfAnswer(route, [0, 12], {}, own ? [`Cover: ${body.title}`, 'Page 2'] : []);
    }
    if (path === '/api/templates' && request.method() === 'GET') {
      return route.fulfill({ json: { proof: [], post: [], map: [], note: state.templates } });
    }
    if (path === '/api/templates/note' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.saved.push(body);
      const record = { id: body.id ?? `t${state.templates.length + 1}`, name: body.name, data: body.data, updated_at: at };
      state.templates = [...state.templates.filter((item) => item.id !== record.id), record];
      return route.fulfill({ json: record });
    }
    return route.fallback();
  });
  return state;
}

test('a template from a ready one opens with its own first page, drawn in the editor and first in its pages', async ({ page }) => {
  const state = await setUp(page);
  await page.goto('/#settings');
  await page.locator('.settings-nav, nav').getByRole('button', { name: 'Templates' }).first().click();
  const section = page.locator('[data-guide="settings.note-templates"]');

  await section.getByRole('button', { name: /New template/ }).click();
  const menu = page.locator('.float-menu[aria-label="New template"]');
  await expect(menu.locator('.fm-item')).toHaveText(['Blank', 'From a ready one', 'From one of yours', 'From a note of this case']);
  await menu.getByRole('button', { name: 'From a ready one' }).click();
  await menu.locator('.ready-item', { hasText: 'Geolocation report' }).click();

  // saved with the analyst's own page, then opened in the Notebook as Edit does
  await expect.poll(() => state.saved[0]?.data?.look?.cover).toMatchObject({ on: true, mode: 'own' });
  expect(state.saved[0].data.body.startsWith('::: top-right\n![Azimut](azimut:logo){width=25% align=right}\n:::\n')).toBe(true);
  await expect(page.locator('input[aria-label="Template name"]')).toHaveValue('Geolocation report');

  // the editor draws the page as it will read
  const corner = page.locator('.cm-block-aligned').first();
  await expect(corner.locator('.cm-corner-tag')).toHaveText('Top right corner');
  await expect(corner.locator('img.builtin-logo')).toHaveAttribute('src', '/api/notes/pictures/logo');
  await expect.poll(() => corner.locator('img.builtin-logo').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  const cover = page.locator('.cm-block-aligned').nth(1);
  await expect(cover.locator('[data-placeholder]')).toHaveText(['Title', 'Date']);
  await expect(cover.locator('.cm-hint')).toHaveText('A line under the title: what this report is');
  await expect(page.locator('[data-cover-rule]')).toHaveText('End of the cover page');

  // the Look says so
  await page.locator('[data-guide="notebook.look"]').click();
  await expect(page.locator('[aria-label="Cover page"] [aria-checked="true"]')).toHaveText('Your own page');
  await expect(page.getByRole('switch', { name: 'Centred down the page' })).toBeChecked();
  await page.keyboard.press('Escape');

  // and the Page pane's first page is the cover
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  await expect.poll(() => state.previews.at(-1)?.look?.cover?.mode).toBe('own');
  expect(state.previews.at(-1).text.split('\n').indexOf('<!-- cover -->')).toBe(11);
  const sheets = page.locator('.page-pane .sheet');
  await expect(sheets).toHaveCount(2);
  await expect.poll(() => sheets.first().locator('canvas').evaluate((canvas) => canvas.width)).toBeGreaterThan(0);
});
