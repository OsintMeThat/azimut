import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Export for review, end to end in the browser: from a note's card, Export offers For review as
 * its fifth format, which says what leaves and what stays, starts the author from the note, writes
 * the file, downloads it and shows its folder, and is not what the next Export opens on. The
 * server is stood in for, as in `notebook-editions.spec.js`; what is checked is what the browser
 * asks of it.
 */

const at = '2026-10-01T10:00:00Z';
const note = (id, label) => ({
  id, type: 'note', label, attrs: { path: `notes/${id}.md`, folder: '' }, provenance: { by: 'user', at, status: 'confirmed' },
});
const FILE = 'Harbour article (for review).azimut.zip';
const SHOWN = {
  title: 'Harbour article', file: FILE, size: 5 * 1024 * 1024, internal: 1, map_count: 1, maps: ['Situation'],
  author: 'Guest Writer', picture: 'logo', pictures: [{ value: 'logo', label: 'Your logo' }],
  groups: [
    { key: 'note', label: 'Note', count: 1, names: ['Harbour article'] },
    { key: 'pictures', label: 'Pictures', count: 3, names: ['Quay', 'Gate proof', 'Your logo'] },
    { key: 'layers', label: 'Map layers', count: 1, names: ['Checkpoints'] },
    { key: 'sources', label: 'Sources', count: 1, names: ['@harbourwatch'] },
  ],
};

async function notebook(page) {
  const catalog = [note('n1', 'Harbour article')];
  const fixture = await installAppFixture(page, { catalog });
  const state = { read: [], exported: [], checks: [], jobs: 0, revealed: 0, downloads: 0 };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/bundle/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/bundle/jobs/review-job')) {
      state.jobs += 1;
      return route.fulfill({ json: { id: 'review-job', kind: 'review-export', state: 'ready', error: null, file: FILE } });
    }
    if (path.endsWith('/bundle/jobs/review-job/download')) {
      state.downloads += 1;
      return route.fulfill({
        body: 'PK', contentType: 'application/octet-stream',
        headers: { 'Content-Disposition': `attachment; filename*=utf-8''${encodeURIComponent(FILE)}` },
      });
    }
    if (path.endsWith('/bundle/reveal') && route.request().method() === 'POST') {
      state.revealed += 1;
      return route.fulfill({ json: { status: 'revealed' } });
    }
    return route.fallback();
  });
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      const row = (id, title) => ({
        id, title, folder: '', updated_at: at, excerpt: '', words: 2, tasks: { open: 0, done: 0 },
        mentions: 0, pictures: 0, look: null, includes: 0,
      });
      return route.fulfill({ json: { items: [row('case', 'Case notes'), row('n1', 'Harbour article')] } });
    }
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      state.checks.push(body.format ?? 'pdf');
      return route.fulfill({ json: { notes: body.notes.map((id) => ({ note: id, title: 'Harbour article', internal: 1, warnings: [] })) } });
    }
    if (/^\/(n1|case)\/editions$/.test(path)) return route.fulfill({ json: { editions: [] } });
    if (path === '/n1/review' && request.method() === 'GET') {
      state.read.push(url.search);
      return route.fulfill({ json: SHOWN });
    }
    if (path === '/n1/review' && request.method() === 'POST') {
      state.exported.push(request.postDataJSON());
      return route.fulfill({ json: { case_id: CASE_ID, job_id: 'review-job', state: 'queued', file: FILE } });
    }
    return route.fallback();
  });
  return { state, fixture };
}

test('Export offers For review for one note, which says what leaves and what stays, then where its file went', async ({ page }) => {
  const { state, fixture } = await notebook(page);
  await page.goto('/#notebook');
  const formats = (dialog) => dialog.getByRole('group', { name: 'Format' }).getByRole('button');

  // the case notes are no article to send: the four usual formats only, and nothing in the menu
  await page.locator('button[aria-label="Actions for the case notes"]').click();
  await expect(page.getByRole('button', { name: 'Export for review…' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const caseNotes = page.getByRole('dialog', { name: 'Export note as PDF' });
  await expect(formats(caseNotes)).toHaveText(['PDF', 'HTML page', 'Web folder', 'WordPress draft']);
  await caseNotes.getByRole('button', { name: 'Cancel' }).click();

  await page.locator('button[aria-label="Actions for Harbour article"]').click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const opened = page.getByRole('dialog', { name: 'Export note as PDF' });
  await expect(formats(opened)).toHaveText(['PDF', 'HTML page', 'Web folder', 'WordPress draft', 'For review']);
  await expect(formats(opened).last()).toHaveAttribute('title', 'Only what its page needs, as an Azimut file to send for review');
  await formats(opened).last().click();
  const dialog = page.getByRole('dialog', { name: 'Export note for review' });
  await expect(dialog.locator('.review-groups li')).toHaveText([
    'Note (1) Harbour article',
    'Pictures (3) Quay, Gate proof, Your logo',
    'Map layers (1) Checkpoints',
    'Sources (1) @harbourwatch',
    'Maps (1) Situation',
  ]);
  await expect(dialog.locator('.review-head').first()).toHaveText('What leaves 5 MB');
  await expect(dialog.locator('.review-stays')).toHaveText('1 internal passage, left out of the text, and the rest of the case.');
  await expect(dialog.getByRole('link', { name: 'osintmethat.com/contribute' })).toHaveAttribute('href', 'https://osintmethat.com/contribute');
  // nothing was written by choosing it
  expect(state.exported).toEqual([]);

  await expect(dialog.locator('.review input.input')).toHaveValue('Guest Writer');
  await dialog.locator('.review input.input').fill('Guest Analyst');
  await expect(dialog.locator('.review select')).toHaveValue('logo');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog.locator('.review-done')).toHaveText(`Written: ${FILE}`);
  expect(state.exported).toEqual([{ author: 'Guest Analyst', picture: 'logo', videos: true }]);

  // Download is the main press: the browser saves the file where an upload page will look for it
  const saved = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  expect((await saved).suggestedFilename()).toBe(FILE);
  expect(state.downloads).toBe(1);
  await dialog.getByRole('button', { name: 'Show in folder' }).click();
  await expect.poll(() => state.revealed).toBe(1);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.read).toEqual(['']);

  // the next Export opens on the format before it, never on For review
  await page.locator('button[aria-label="Actions for Harbour article"]').click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export note as PDF' })).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});
