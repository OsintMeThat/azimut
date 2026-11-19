import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * Ready to publish?, end to end in the browser: the note's header says how many lines
 * the check has to look at, the badge opens the panel, *Say “at least”* writes the words
 * before a count as one Undo step, and the panel and the badge count one fewer. The
 * server is stood in for, as in `notebook-editions.spec.js`: it counts the bare counts
 * of the note as saved, the way the check does, and answers what the panel reads.
 */

const at = '2026-10-01T10:00:00Z';
const note = (id, label) => ({
  id, type: 'note', label, attrs: { path: `notes/${id}.md`, folder: '' }, provenance: { by: 'user', at, status: 'confirmed' },
});
const BARE = /(?<!at least )\b(\d+) (trucks|boats)\b/g;

/** What the stood-in check says of `text`: one line for its exact counts, each count under it. */
function checked(text, body) {
  const lines = text.split('\n');
  const items = lines.flatMap((line, index) => [...line.matchAll(BARE)].map((match) => ({ text: match[0], url: '', line: index })));
  const warnings = items.length ? [{
    text: `${items.length} count${items.length > 1 ? 's read' : ' reads'} as exact: ${items.map((item) => `"${item.text}"`).join(', ')}. Say "at least" or give a range.`,
    line: items[0].line, kind: 'count', items, ...(body.ready ? { group: 'words' } : {}),
  }] : [];
  const ready = { format: body.format ?? 'pdf', edition: body.edition, style: 'plain', tlp: '', pictures: [], claims: [], gone: [], unarchived: [], unseen: [] };
  return { note: 'n1', title: 'Lead', internal: 0, warnings, ...(body.ready ? { ready } : {}) };
}

async function notebook(page) {
  const catalog = [note('n1', 'Lead')];
  await installAppFixture(page, { catalog });
  const state = { text: 'We saw 12 trucks and 7 boats on the road.\n', checks: [] };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      const row = (id, title, text) => ({
        id, title, folder: '', updated_at: at, excerpt: text.split('\n')[0], words: 2, tasks: { open: 0, done: 0 },
        mentions: 0, pictures: 0, look: null, includes: 0,
      });
      return route.fulfill({ json: { items: [row('case', 'Case notes', ''), row('n1', 'Lead', state.text)] } });
    }
    if (path === '/preview') return pdfAnswer(route, [0]);
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      state.checks.push(body);
      return route.fulfill({ json: { notes: body.notes.map(() => checked(state.text, body)) } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'plain' } } });
    if (path === '/n1') {
      if (request.method() === 'PUT') { state.text = request.postDataJSON().text; return route.fulfill({ json: { status: 'saved' } }); }
      return route.fulfill({ json: { text: state.text } });
    }
    return route.fallback();
  });
  return state;
}

test('the badge opens Ready to publish?, and Say “at least” writes it as one Undo step and the count drops', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('We saw 12 trucks');

  // read once the note is open, as the export would write it, with what the panel reads
  const badge = page.locator('.ready-badge');
  await expect(badge).toHaveText('2 to look at');
  expect(state.checks.at(-1)).toMatchObject({ notes: ['n1'], format: 'pdf', edition: 'internal', ready: true });

  await badge.click();
  const panel = page.getByRole('dialog', { name: 'Ready to publish?' });
  await expect(panel.getByRole('status')).toContainText('2 to look at.');
  const words = panel.getByRole('list', { name: 'Words' });
  await expect(words.getByRole('listitem')).toHaveText([/“12 trucks” reads as exact\./, /“7 boats” reads as exact\./]);
  // the other groups say there is nothing to look at, the edition says what it is
  await expect(panel.locator('[data-group="sources"]')).toContainText('Nothing to look at.');
  await expect(panel.locator('[data-group="edition"]')).toContainText('No TLP marking.');

  // nothing was written by reading it
  expect(state.text).toBe('We saw 12 trucks and 7 boats on the road.\n');
  const checks = state.checks.length;
  await words.getByRole('listitem').first().getByRole('button', { name: 'Say “at least”' }).click();
  await expect(page.locator('.cm-content')).toContainText('We saw at least 12 trucks and 7 boats');
  // saved, checked again, one count fewer
  await expect.poll(() => state.text).toBe('We saw at least 12 trucks and 7 boats on the road.\n');
  await expect(words.getByRole('listitem')).toHaveText([/“7 boats” reads as exact\./]);
  await expect(panel.getByRole('status')).toContainText('1 to look at.');
  expect(state.checks.length).toBeGreaterThan(checks);

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(badge).toHaveText('1 to look at');

  // one Undo takes the words back
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.cm-content')).toContainText('We saw 12 trucks and 7 boats');
  await expect(page.locator('.cm-content')).not.toContainText('at least');
});

test('the export dialog of one note opens the panel at its top, and the panel goes back to it', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.ready-badge')).toHaveText('2 to look at');
  await page.locator('[data-guide="notebook.pdf"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  // the dialog's own check counts the same two, on one line
  await expect(dialog).toContainText('2 counts read as exact');
  await dialog.getByRole('button', { name: /Ready to publish\?/ }).click();
  const panel = page.getByRole('dialog', { name: 'Ready to publish?' });
  await expect(panel.getByRole('list', { name: 'Words' }).getByRole('listitem')).toHaveCount(2);
  expect(state.checks.at(-1)).toMatchObject({ format: 'pdf', ready: true });
  await panel.getByRole('button', { name: 'Back to the export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export note as PDF' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Ready to publish?' })).toHaveCount(0);
});
