import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A note exported as a web folder from the Notebook's export dialog, the server stood
 * in for: the public edition, the address it will live at, and the dialog staying on
 * what it wrote with the folder and the steps to put it online a press away.
 */

test('a note goes out as a web folder, to the address typed, and the dialog says where it is', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the dialog');
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { checks: [], exported: [], shown: [] };
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
    if (path === '/n1') return route.fulfill({ json: { text: '# Lead\n\nSeen at the quay.\n' } });
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    if (path === '/n1/editions') return route.fulfill({ json: { editions: [] } });
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      state.checks.push(body);
      const web = body.format === 'web';
      return route.fulfill({ json: { notes: body.notes.map((id) => ({
        note: id, title: 'Lead', internal: 0, earlier: 0, links: [], pov: [], weight: 1_800_000,
        warnings: web ? [{ text: 'No address given: X shows the link without its picture card.', line: null, kind: 'address' }] : [],
      })) } });
    }
    if (path === '/web') {
      const body = request.postDataJSON();
      state.exported.push(body);
      return route.fulfill({ json: { written: [{ note: 'n1', title: 'Lead', file: 'quay', edition: 'public', bytes: 1_800_000,
        at: '2026-11-18T10:00:00Z', folder: 'exports', address: body.base_url ?? '' }], warnings: [], folder: 'exports', path: '/cases/harbour/exports/web' } });
    }
    if (path === '/n1/editions/reveal') {
      state.shown.push(request.postDataJSON());
      return route.fulfill({ json: { path: '/cases/harbour/exports/web/quay' } });
    }
    return route.fallback();
  });

  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('Seen at the quay.');
  await page.locator('[data-guide="notebook.pdf"]').click();
  const formats = page.getByRole('dialog').getByRole('group', { name: 'Format' });
  await expect(formats.getByRole('button')).toHaveText(['PDF', 'HTML page', 'Web folder', 'WordPress draft']);
  await formats.getByRole('button', { name: 'Web folder' }).click();

  const dialog = page.getByRole('dialog', { name: 'Export note as a web folder' });
  await expect(dialog).toContainText('About 1.7 MB.');
  await expect(dialog).toContainText('No address given: X shows the link without its picture card.');
  expect(state.checks.filter((body) => !body.ready).at(-1)).toEqual({ notes: ['n1'], edition: 'public', format: 'web' });
  const field = dialog.getByLabel('Address it will live at');
  await field.fill('http://desk.github.io/articles/quay/');
  await expect(dialog).toContainText('The address must start with https://.');
  await expect(dialog.getByRole('button', { name: 'Export web folder' })).toBeDisabled();
  await field.fill('https://desk.github.io/articles/quay/');
  await expect(dialog).not.toContainText('No address given');
  await dialog.getByRole('button', { name: 'Export web folder' }).click();

  // the dialog stays on what it wrote
  await expect(dialog.getByRole('status').filter({ hasText: 'Folder written: web/quay' })).toBeVisible();
  await expect(dialog).toContainText('Made for https://desk.github.io/articles/quay/');
  expect(state.exported.at(-1)).toEqual({ notes: ['n1'], diagrams: {}, edition: 'public', round_pov: false, changes: '',
    base_url: 'https://desk.github.io/articles/quay/' });
  await dialog.getByRole('button', { name: 'How to publish' }).click();
  const steps = dialog.getByRole('region', { name: 'How to publish' });
  await expect(steps).toContainText('Settings › Pages');
  await expect(steps.getByRole('listitem')).toHaveCount(7);
  await dialog.getByRole('button', { name: 'Open the folder' }).click();
  await expect.poll(() => state.shown.length).toBe(1);
  expect(state.shown[0]).toEqual({ at: '2026-11-18T10:00:00Z', file: 'quay', folder: 'exports' });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
});
