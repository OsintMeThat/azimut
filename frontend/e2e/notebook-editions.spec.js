import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * A note's two editions, end to end in the browser: an internal passage written
 * from `/`, drawn as an Internal callout, the Page pane switched to Public, the
 * export dialog starting on the same choice, and the note's Editions listing the
 * file written, checked against the disk. The server is stood in for, as in
 * `notebook-report.spec.js`; what is checked is what the browser asks of it.
 */

const at = '2026-10-01T10:00:00Z';
const note = (id, label) => ({
  id, type: 'note', label, attrs: { path: `notes/${id}.md`, folder: '' }, provenance: { by: 'user', at, status: 'confirmed' },
});
const passages = (text) => (String(text ?? '').match(/^\s*>\s*\[!internal\]/gim) ?? []).length;

async function notebook(page) {
  const catalog = [note('n1', 'Lead')];
  await installAppFixture(page, { catalog });
  const state = { text: 'Public words.\n', previews: [], checks: [], exported: [], editions: [], checked: [] };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    const method = request.method();
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      const row = (id, title, text) => ({
        id, title, folder: '', updated_at: at, excerpt: text.split('\n')[0], words: 2, tasks: { open: 0, done: 0 },
        mentions: 0, pictures: 0, look: null, includes: 0,
      });
      return route.fulfill({ json: { items: [row('case', 'Case notes', ''), row('n1', 'Lead', state.text)] } });
    }
    if (path === '/preview') {
      const body = request.postDataJSON();
      state.previews.push(body);
      return pdfAnswer(route, [0], { 'X-Note-Internal': String(passages(body.text)) });
    }
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      state.checks.push(body);
      const count = passages(state.text);
      const left = body.edition === 'public' && count
        ? [{ text: `${count} internal passage${count > 1 ? 's' : ''} left out.`, line: null, kind: 'internal' }] : [];
      return route.fulfill({ json: { notes: body.notes.map((id) => ({ note: id, title: 'Lead', internal: count, warnings: left })) } });
    }
    if (path === '/pdf') {
      const body = request.postDataJSON();
      state.exported.push(body);
      const file = `Lead - ${body.edition} - 2026-11-05.pdf`;
      state.editions.unshift({ at: '2026-11-05T10:00:00Z', edition: body.edition, file, folder: 'exports', pages: 2,
        pdf_sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64) });
      return route.fulfill({ json: { written: [{ note: 'n1', title: 'Lead', file, edition: body.edition }], warnings: [], path: '' } });
    }
    if (path === '/n1/editions') return route.fulfill({ json: { editions: state.editions } });
    if (path === '/n1/editions/check') {
      state.checked.push(request.postDataJSON());
      return route.fulfill({ json: { state: 'unchanged' } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    if (path === '/n1') {
      if (method === 'PUT') { state.text = request.postDataJSON().text; return route.fulfill({ json: { status: 'saved' } }); }
      return route.fulfill({ json: { text: state.text } });
    }
    return route.fallback();
  });
  return state;
}

test('an internal passage is written from /, its public pages are seen, written, and listed among the note\'s editions', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('Public words.');

  // `/` offers Internal, and the line becomes an Internal callout
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/internal');
  await page.getByRole('option', { name: /Internal/ }).click();
  await page.keyboard.type('Who told us, and how to reach them.');
  await page.keyboard.press('ArrowUp');
  const callout = page.locator('.cm-callout-internal');
  await expect(callout).toHaveCount(1);
  await expect(callout.locator('.cm-callout-label')).toHaveText('Internal');
  await expect.poll(() => state.text).toContain('> [!internal] Who told us, and how to reach them.');

  // the Page pane offers both editions, Internal first, and draws the public one when asked
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  const pane = page.locator('.page-pane');
  const paneSwitch = pane.getByRole('group', { name: 'Edition' });
  await expect(paneSwitch.getByRole('button', { name: 'Internal' })).toHaveAttribute('aria-pressed', 'true');
  await paneSwitch.getByRole('button', { name: 'Public' }).click();
  await expect.poll(() => state.previews.at(-1)?.edition).toBe('public');
  await expect(paneSwitch.getByRole('button', { name: 'Public' })).toHaveAttribute('aria-pressed', 'true');

  // the export starts on the same choice, says what it leaves out, and writes the public edition
  await page.locator('[data-guide="notebook.pdf"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  await expect(dialog.getByRole('group', { name: 'Edition' }).getByRole('button', { name: 'Public' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toContainText('1 internal passage left out.');
  await expect(dialog).not.toContainText('Before you export');
  expect(state.checks.at(-1)).toEqual({ notes: ['n1'], edition: 'public' });
  await dialog.getByRole('button', { name: 'Export PDF' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.exported.at(-1)).toMatchObject({ notes: ['n1'], edition: 'public' });
  await expect(page.getByText('1 public PDF written')).toBeVisible();

  // the note's ⋯ lists what was written, and Check reads the file again
  await page.locator('button[aria-label="More"]').click();
  await page.getByRole('button', { name: 'Editions' }).click();
  const editions = page.getByRole('dialog', { name: 'Editions' });
  const row = editions.getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Public');
  await expect(row).toContainText('2 pages');
  await expect(row).toContainText('Lead - public - 2026-11-05.pdf');
  await row.getByRole('button', { name: 'Check' }).click();
  await expect(row).toContainText('Unchanged since it was written');
  expect(state.checked).toEqual([{ at: '2026-11-05T10:00:00Z', file: 'Lead - public - 2026-11-05.pdf', folder: 'exports' }]);
});
