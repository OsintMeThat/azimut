import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * What changed between two editions, end to end in the browser: a note exported as a
 * public HTML page, corrected, exported again as a PDF; its Editions then compare the two
 * texts it kept, show each figure in a sentence and the words that moved, draft the
 * correction, and open the export on an HTML page with that line in What changed, which
 * goes out with the next page and only then. The server is stood in for, as in
 * `notebook-editions.spec.js`: the comparison itself is the server's (`engine/notediff.py`).
 */

const at = '2026-10-01T10:00:00Z';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const COMPARED = {
  same: false,
  sentences: [
    { kind: 'chart', figure: 'chart:5', said: 'The chart “At least 41 armoured vehicles…” now counts at least 42, not 41.' },
    { kind: 'picture', figure: 'picture:3', said: '“Figure 1” shows another picture: “tygor” in place of “m-atv”.',
      short: '“Figure 1” shows another picture.' },
  ],
  paragraphs: [
    { state: 'changed', under: 'Summary', heading: false, parts: [['=', 'Two videos show at least'], ['-', '41'], ['+', '42'], ['=', 'armoured vehicles.']] },
  ],
  unchanged: 9,
  more: 0,
};

async function notebook(page) {
  const catalog = [{ id: 'n1', type: 'note', label: 'Front', attrs: { path: 'notes/Front.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { text: '## Summary\n\nTwo videos show at least 41 armoured vehicles.\n', exported: [], editions: [], kept: [], compared: [] };
  const record = (format, sha, body) => {
    state.editions.unshift({
      at: `2026-11-1${state.editions.length + 8}T10:00:00Z`, edition: 'public', format, folder: 'exports',
      file: `Front - 2026-11-1${state.editions.length + 8}.${format === 'html' ? 'html' : 'pdf'}`,
      ...(format === 'html' ? { sha256: 'c'.repeat(64) } : { pages: 2, pdf_sha256: 'c'.repeat(64) }),
      text_sha256: sha, ...(body.changes ? { changes: body.changes } : {}),
    });
    state.kept = [sha, ...state.kept.filter((kept) => kept !== sha)];
  };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Front', folder: '', updated_at: at, excerpt: 'Two videos', words: 8,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/preview') return pdfAnswer(route, [0]);
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      const earlier = state.editions.filter((edition) => edition.edition === 'public').length;
      return route.fulfill({ json: { notes: body.notes.map((id) => ({
        note: id, title: 'Front', internal: 0, warnings: [],
        ...(body.format === 'html' ? { weight: 400_000, earlier, links: [], pov: [] } : {}),
      })) } });
    }
    if (path === '/html' || path === '/pdf') {
      const body = request.postDataJSON();
      const format = path.slice(1);
      state.exported.push({ format, ...body });
      record(format, state.editions.length ? B : A, body);
      return route.fulfill({ json: { written: [{ note: 'n1', title: 'Front', file: state.editions[0].file, edition: 'public', bytes: 400_000 }],
        warnings: [], path: '' } });
    }
    if (path === '/n1/editions') return route.fulfill({ json: { editions: state.editions, kept: state.kept } });
    if (path === '/n1/editions/compare') {
      state.compared.push(request.postDataJSON());
      return route.fulfill({ json: COMPARED });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    if (path === '/n1') {
      if (request.method() === 'PUT') { state.text = request.postDataJSON().text; return route.fulfill({ json: { status: 'saved' } }); }
      return route.fulfill({ json: { text: state.text } });
    }
    return route.fallback();
  });
  return state;
}

test('two editions compared: each figure in a sentence, the words that moved, and the correction drafted into the next export', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Front"]').click();
  await expect(page.locator('.cm-content')).toContainText('Two videos show at least 41');

  // the first public edition, as an HTML page
  await page.locator('[data-guide="notebook.pdf"]').click();
  let dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  await dialog.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'HTML' }).click();
  dialog = page.getByRole('dialog', { name: 'Export note as HTML' });
  await expect(dialog).toContainText('About 391 KB.');
  await expect(dialog.getByLabel('What changed since the last public edition')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Export HTML' }).click();
  await expect(dialog).toHaveCount(0);

  // corrected, then a second edition, as a PDF this time
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' A second count.');
  await page.locator('[data-guide="notebook.pdf"]').click();
  dialog = page.getByRole('dialog', { name: 'Export note as HTML' });
  await dialog.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'PDF' }).click();
  dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  await dialog.getByRole('button', { name: 'Export PDF' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.exported.map((made) => made.format)).toEqual(['html', 'pdf']);

  // the note's Editions offer the two texts it kept, the newest against the note now at first
  await page.locator('button[aria-label="More"]').click();
  await page.getByRole('button', { name: 'Editions' }).click();
  const editions = page.getByRole('dialog', { name: 'Editions' });
  const bar = editions.getByRole('region', { name: 'What changed' });
  const [from, to] = [bar.locator('select').first(), bar.locator('select').nth(1)];
  await expect(from).toHaveValue(B);
  await expect(to).toHaveValue('now');
  expect(state.compared).toEqual([]);
  await from.selectOption(A);
  await to.selectOption(B);
  await bar.getByRole('button', { name: 'Compare' }).click();

  const compared = page.getByRole('dialog', { name: 'What changed' });
  await expect(compared.locator('.sentences li')).toHaveText([
    'The chart “At least 41 armoured vehicles…” now counts at least 42, not 41.',
    '“Figure 1” shows another picture: “tygor” in place of “m-atv”.',
  ]);
  expect(state.compared).toEqual([{ before: A, after: B }]);
  const words = compared.locator('.para').first();
  await expect(words.locator('.place')).toHaveText('Under “Summary”');
  await expect(words.locator('del')).toHaveText('41');
  await expect(words.locator('ins')).toHaveText('42');
  await expect(compared).toContainText('9 paragraphs unchanged.');

  // the correction is drafted from it, edited, and taken to the next export
  await compared.getByRole('button', { name: 'Write the correction from this' }).click();
  const line = compared.getByLabel('What changed, for the next export');
  await expect(line).toHaveValue('The chart “At least 41 armoured vehicles…” now counts at least 42, not 41. '
    + '“Figure 1” shows another picture. Text revised in “Summary”.');
  const written = 'Corrected: at least 42 armoured vehicles, not 41; Figure 1 shows the Tygor.';
  await line.fill(written);
  await compared.getByRole('button', { name: 'Export with this line…' }).click();
  await expect(compared).toHaveCount(0);

  // the export opens on a public HTML page, which prints the line, the line in place
  dialog = page.getByRole('dialog', { name: 'Export note as HTML' });
  await expect(dialog.getByLabel('What changed since the last public edition')).toHaveValue(written);
  expect(await page.evaluate(() => localStorage.getItem('azimut:note-export-format'))).toBe('html');
  await dialog.getByRole('button', { name: 'Export HTML' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.exported.at(-1)).toMatchObject({ format: 'html', notes: ['n1'], changes: written });

  // it went out with that page: the next export starts with nothing said
  await page.locator('[data-guide="notebook.pdf"]').click();
  dialog = page.getByRole('dialog', { name: 'Export note as HTML' });
  await expect(dialog.getByLabel('What changed since the last public edition')).toHaveValue('');
});
